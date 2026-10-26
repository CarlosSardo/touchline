import type { Store } from "./db.ts";
import { assessFinancesBatch } from "./finance.ts";
import { clubRegistration } from "./registration.ts";
import { ownershipSnapshot, type OwnershipInfo } from "./ownership.ts";
import { activeEmbargoes } from "./sanctions.ts";
import { addDays, clamp, daysBetween, FORMATION_POSITIONS, LOAN_TYPES, POSITIONS, transferWindow, winterWindowClose } from "../shared/rules.ts";
import { SQUAD_MINIMUMS } from "../shared/world-rules.ts";
import type { Position } from "../shared/types.ts";

export type DofPolicy = "balanced" | "youth" | "value" | "stars";

export interface ClubPolicy {
  clubId: number;
  tier: number | null;
  reputation: number;
  /** Position -> shortage score (0 = no need). */
  needs: Record<string, number>;
  /** Player ids the club is willing to move on. */
  surplus: number[];
  transferBudget: number;
  /**
   * Weekly: the wage budget less the payroll and open deals, plus the wages that leave before the window closes
   * (contracts ending, loans in ending, net of loans out returning).
   */
  wageRoom: number;
  /**
   * Weekly wages a club plans to shed in this window by moving on its surplus (half of a sale's wage, a little of a
   * loan's): with an operating surplus and cash it may sign first and sell after (sell-to-buy). Zero between windows.
   */
  saleCredit: number;
  /** Weekly wages leaving before the window closes (included in wageRoom). */
  departing: number;
  /** Projected weekly operating cash result at the current payroll (finance.ts weeklySurplus). */
  weeklySurplus: number;
  /** GBP of additional annual squad cost before breaching (may be negative). */
  ffpHeadroom: number;
  /** Share of a fee that also uses the headroom (finance.ts signingHeadroomCost). */
  feeCashShare: number;
  /** Sanctions/administration block on registrations of new signings. */
  embargo: boolean;
  dofPolicy: DofPolicy;
  ownerGroupId: number | null;
  ownerType: string | null;
  /** 0..100 (owner ambition, default from reputation). */
  ambition: number;
  // Market detail (server/world-market.ts).
  name: string;
  managed: boolean;
  countryId: number;
  /** Association code that registers the club's players (the host for cross-border clubs). */
  association: string;
  leagueCode: string | null;
  balance: number;
  wageBudget: number;
  weeklyWages: number;
  /** Weekly wages promised in open deals (already deducted from wageRoom and ffpHeadroom). */
  committedWages: number;
  /** Average ability of the 14 best seniors in the first-team squad. */
  level: number;
  seniors: number;
  positions: Record<string, PositionDepth>;
  /** Weekly wage the club pays per unit of base wage (its going rate: baseWage(ability) × payScale). */
  payScale: number;
  /** Senior moves in since the market season began (15 June). */
  incoming: number;
  formation: string;
  tacticalStyle: string;
  facilities: number;
  academy: number;
  managerTrust: number;
  crisis: number;
}

export interface PositionDepth {
  depth: number;
  available: number;
  best: number;
  second: number;
  old: number;
}

/** A player his club would let go today, with why and how (permanent sale, loan or either). */
export interface SupplyPlayer {
  id: number;
  clubId: number;
  position: Position;
  secondary: string;
  age: number;
  ability: number;
  potential: number;
  value: number;
  wage: number;
  contractEnd: string;
  listed: boolean;
  shortlisted: boolean;
  minutes: number;
  morale: number;
  countryId: number;
  /** Rank by ability in his position in the club's first-team squad (99 outside it). */
  rank: number;
  /** The club's B-team he plays for (registered at the first team), when he is not in its first-team squad. */
  squadClubId?: number;
  reason: "listed" | "loan-listed" | "surplus" | "weak" | "expiring" | "development" | "outgrown" | "over-budget";
  mode: "transfer" | "loan" | "both";
}

/** First-team depth a club wants per position (24 seniors). */
export const TARGET_DEPTH: Record<Position, number> = {
  GK: 2,
  CB: 4,
  LB: 2,
  RB: 2,
  DM: 2,
  CM: 3,
  AM: 2,
  LW: 2,
  RW: 2,
  ST: 3,
};

/** Last day of the transfer window open on `date` (summer: 1 September). */
export const windowClose = (date: string) =>
  date.slice(5) >= "06-15" ? `${date.slice(0, 4)}-09-01` : winterWindowClose(Number(date.slice(0, 4)));

/**
 * First-team size a club sells or lends down to. In the summer window two below the squad minimum: the weekly squad
 * check (youth.ts maintainSquads) promotes or signs the replacements before the season, as clubs do once a sale is
 * agreed. In the short winter window, with matches every week, the minimum itself (a club signs before it sells).
 */
export const sellerSquadFloor = (date: string) => SQUAD_MINIMUMS.Senior - (date.slice(5) >= "06-15" ? 2 : 0);

/** The same floor for a B-team's senior squad (SQUAD_MINIMUMS.BTeam, which maintainSquads keeps between windows). */
export const reserveSquadFloor = (date: string) => SQUAD_MINIMUMS.BTeam - (date.slice(5) >= "06-15" ? 2 : 0);

/** Senior players and goalkeepers of a B-team squad, as the market counts them against its floor. */
export interface ReserveSquad {
  seniors: number;
  keepers: number;
}

/** Most of the wage budget planned sales may cover before the players are gone. */
const SALE_CREDIT_SHARE = 0.15;

/** Market season: from the summer window opening (15 June) to the day before the next one. */
export const marketSeasonStart = (date: string) => {
  const year = Number(date.slice(0, 4));
  return date.slice(5) >= "06-15" ? `${year}-06-15` : `${year - 1}-06-15`;
};

const OPEN_STAGES = ["Enquiry", "Club talks", "Agent talks", "Contract review", "Scheduled", "Medical", "Registration", "Offer received"];
const BASE_WAGE_SQL = "round(power(ability / 100, 7) * 19000) * 10 + 50";

/** Needs of a squad: missing available depth, a starter well below the squad level, an ageing position group. */
export function squadNeeds(formation: string, positions: Record<string, PositionDepth>, level: number) {
  const fielded = new Set(FORMATION_POSITIONS[formation] ?? FORMATION_POSITIONS["4-3-3"]);
  const needs: Record<string, number> = {};
  for (const position of POSITIONS) {
    const stats = positions[position] ?? { depth: 0, available: 0, best: 0, second: 0, old: 0 };
    const target = TARGET_DEPTH[position];
    if (!fielded.has(position)) {
      needs[position] = 0;
      continue;
    }
    const shortage = Math.max(0, target - stats.available);
    const upgrade = stats.best < level - 3 ? 0.8 : 0;
    const succession = stats.depth > 0 && stats.old >= Math.max(1, stats.depth - 1) && stats.depth <= target ? 0.5 : 0;
    needs[position] = Math.round((shortage + upgrade + succession) * 10) / 10;
  }
  return needs;
}

interface Snapshot {
  schema: string;
  /** Day of the last full build (squads, finances, supply). */
  built: string;
  date: string;
  policies: Map<number, ClubPolicy>;
  supply: Map<number, SupplyPlayer>;
  /** B-team senior squads by club id (players the market moves on from them count down). */
  reserves: Map<number, ReserveSquad>;
  /** Owners and multi-club groups (server/ownership.ts) for sister-club pathways and related-party pricing. */
  ownership: ReadonlyMap<number, OwnershipInfo>;
}

/** Latest snapshot per world schema (several careers can share one process). */
const snapshots = new Map<string, Snapshot>();
const MAX_SNAPSHOTS = 4;
/** A full build (squads, finances, market supply) is reused with refreshed budgets for at most this many days. */
export const SNAPSHOT_MAX_AGE = 7;

interface ClubRow {
  id: number;
  name: string;
  reputation: number;
  balance: number;
  transfer_budget: number;
  wage_budget: number;
  formation: string;
  tactical_style: string;
  country_id: number;
  facilities: number;
  academy: number;
  manager_trust: number;
  crisis: number;
  tier: number | null;
  league_code: string | null;
  club_code: string;
  dof_policy: string | null;
  hosted: string | null;
}

const clubRows = (store: Store) =>
  store.all<ClubRow>(
    `SELECT clubs.id, clubs.name, clubs.reputation, clubs.balance, clubs.transfer_budget, clubs.wage_budget, clubs.formation,
       clubs.tactical_style, clubs.country_id, clubs.facilities, clubs.academy, clubs.manager_trust, clubs.crisis, leagues.tier,
       home.code AS league_code, own.code AS club_code, clubs.data::jsonb ->> 'dofPolicy' AS dof_policy,
       (clubs.data::jsonb -> 'hosted')::text AS hosted
     FROM clubs JOIN countries AS own ON own.id = clubs.country_id LEFT JOIN leagues ON leagues.id = clubs.league_id
     LEFT JOIN countries AS home ON home.id = leagues.country_id
     WHERE clubs.type = 'club' ORDER BY clubs.id`,
  );

/** Money and wages already promised in open deals (the director's targets and approaches for his players). */
async function commitments(store: Store) {
  const committed = new Map<number, { fees: number; wages: number }>();
  for (const deal of await store.all<{ buying_club_id: number; type: string; offer: number; wage: number; player_wage: number; split: number | null; reserved: number | null }>(
    `SELECT negotiations.buying_club_id, negotiations.type, negotiations.offer, negotiations.wage, players.wage AS player_wage,
       (negotiations.data::jsonb #>> '{terms,salarySplit}')::double precision AS split,
       (negotiations.data::jsonb ->> 'reservedBudget')::double precision AS reserved
     FROM negotiations JOIN players ON players.id = negotiations.player_id WHERE negotiations.stage = ANY(?::text[]) ORDER BY negotiations.id`,
    OPEN_STAGES,
  )) {
    const entry = committed.get(deal.buying_club_id) ?? { fees: 0, wages: 0 };
    entry.fees += Math.max(0, deal.offer - (deal.reserved ?? 0));
    entry.wages += LOAN_TYPES.includes(deal.type) ? (deal.player_wage * (deal.split ?? 100)) / 100 : deal.wage;
    committed.set(deal.buying_club_id, entry);
  }
  return committed;
}

const incomingMoves = async (store: Store, date: string) =>
  new Map(
    (
      await store.all<{ club_id: number; total: number }>(
        `SELECT (data::jsonb ->> 'to')::integer AS club_id, count(*) AS total FROM history
         WHERE entity_type IN ('transfer','loan') AND date >= ? AND data::jsonb ->> 'to' IS NOT NULL GROUP BY 1`,
        marketSeasonStart(date),
      )
    ).map((row) => [row.club_id, row.total]),
  );

/**
 * One pass over the registered players: first-team squad depth per position (a loaned-in player counts at the
 * borrower; a first-team player kept in the B-team does not) and the weekly wages of each owning club.
 */
async function squads(store: Store, date: string) {
  const positions = new Map<number, Record<string, PositionDepth & { abilities: number[] }>>();
  const payroll = new Map<number, { wages: number; base: number }>();
  for (const row of await store.all<{
    club_id: number;
    position: Position;
    depth: number;
    available: number;
    old: number;
    wages: number;
    base: number;
    abilities: number[];
  }>(
    `SELECT playing_club_id AS club_id, position, count(*) AS depth, count(*) FILTER (WHERE injury_until IS NULL OR injury_until <= ?) AS available,
       count(*) FILTER (WHERE age >= 31) AS old, sum(wage) AS wages, sum(${BASE_WAGE_SQL}) AS base, array_agg(ability) AS abilities
     FROM players WHERE playing_club_id IS NOT NULL AND age_group = 'Senior' AND role <> 'Retired' AND (contract_end >= ? OR parent_club_id IS NOT NULL)
     GROUP BY playing_club_id, position ORDER BY playing_club_id, position`,
    addDays(date, 14),
    date,
  )) {
    const club = positions.get(row.club_id) ?? {};
    const abilities = row.abilities.sort((left, right) => right - left);
    club[row.position] = { depth: row.depth, available: row.available, best: abilities[0] ?? 0, second: abilities[1] ?? 0, old: row.old, abilities };
    positions.set(row.club_id, club);
    const pay = payroll.get(row.club_id) ?? { wages: 0, base: 0 };
    pay.wages += row.wages;
    pay.base += row.base;
    payroll.set(row.club_id, pay);
  }
  const wages = new Map(
    (
      await store.all<{ club_id: number; total: number }>(
        "SELECT coalesce(parent_club_id, club_id) AS club_id, sum(wage) AS total FROM players WHERE club_id IS NOT NULL GROUP BY 1",
      )
    ).map((row) => [row.club_id, row.total]),
  );
  return { positions, payroll, wages };
}

const levelOf = (positions: Record<string, { abilities: number[] }>) => {
  const top = Object.values(positions)
    .flatMap((stats) => stats.abilities)
    .sort((left, right) => right - left)
    .slice(0, 14);
  return top.length ? top.reduce((sum, value) => sum + value, 0) / top.length : 0;
};

const policyMoney = (
  club: ClubRow,
  weeklyWages: number,
  ffpHeadroom: number,
  commitment: { fees: number; wages: number } = { fees: 0, wages: 0 },
  departing = 0,
) => ({
  reputation: club.reputation,
  balance: club.balance,
  wageBudget: club.wage_budget,
  transferBudget: Math.max(0, Math.min(club.transfer_budget - commitment.fees, club.balance)),
  wageRoom: club.wage_budget - weeklyWages - commitment.wages + departing,
  ffpHeadroom: ffpHeadroom - commitment.wages * 52,
  committedWages: commitment.wages,
});

/**
 * Weekly wages each club stops paying before the window closes: contracts that end, and the borrower's share of loans
 * that end (which the parent pays again). Empty between windows.
 */
async function departingWages(store: Store, date: string) {
  if (!transferWindow(date)) return new Map<number, number>();
  const close = windowClose(date);
  return new Map(
    (
      await store.all<{ club_id: number; total: number }>(
        `SELECT club_id, sum(amount) AS total FROM (
           SELECT club_id, wage AS amount FROM players
           WHERE club_id IS NOT NULL AND parent_club_id IS NULL AND role <> 'Retired' AND contract_end >= ? AND contract_end < ?
           UNION ALL
           SELECT CASE WHEN side.borrower THEN loans.destination_id ELSE loans.parent_id END,
             CASE WHEN side.borrower THEN 1 ELSE -1 END * players.wage * coalesce((loans.terms::jsonb ->> 'salarySplit')::double precision, 100) / 100
           FROM loans JOIN players ON players.id = loans.player_id CROSS JOIN (VALUES (true), (false)) AS side(borrower)
           WHERE loans.status = 'active' AND loans.end_date < ?) AS leaving
         GROUP BY club_id`,
        date,
        close,
        close,
      )
    ).map((row) => [row.club_id, row.total]),
  );
}

/**
 * An AI club's wage budget as the market plans it in a window: the wages leaving before it closes and the planned
 * sales count, so a deal agreed with the director is judged by the same room as the club's own signings.
 */
export const plannedWageBudget = (club: { wage_budget: number }, policy: Pick<ClubPolicy, "departing" | "saleCredit"> | undefined) =>
  club.wage_budget + (policy ? policy.departing + policy.saleCredit : 0);

/** Only a club with an operating surplus and two months of wages in cash signs before it has sold. */
const signsAhead = (policy: Pick<ClubPolicy, "weeklySurplus" | "balance" | "wageBudget">) =>
  policy.weeklySurplus > 0 && policy.balance > policy.wageBudget * 8;

/** Share of a supply player's wage his club may spend before he has gone: half of a sale, a little of a loan. */
export const saleCreditOf = (player: Pick<SupplyPlayer, "wage" | "mode">) => player.wage * (player.mode === "loan" ? 0.2 : 0.5);

async function build(store: Store, date: string): Promise<Snapshot> {
  const state = (await store.meta<{ clubId: number }>("state"))!;
  const clubs = await clubRows(store);
  const family = new Set(
    (await store.all<{ id: number }>("SELECT id FROM clubs WHERE id = ? OR parent_id = ?", state.clubId, state.clubId)).map((row) => row.id),
  );
  const squad = await squads(store, date);
  const finances = await assessFinancesBatch(store, { clubIds: clubs.map((club) => club.id), playerWages: squad.wages });
  const embargoes = await activeEmbargoes(store, date);
  const ownership = await ownershipSnapshot(store);
  const incoming = await incomingMoves(store, date);
  const committed = await commitments(store);
  const departing = await departingWages(store, date);
  const policies = new Map<number, ClubPolicy>();
  for (const club of clubs) {
    const positions = squad.positions.get(club.id) ?? {};
    const level = levelOf(positions);
    const finance = finances.get(club.id);
    const owner = ownership.get(club.id);
    const weeklyWages = finance?.weeklyWages ?? 0;
    const pay = squad.payroll.get(club.id);
    const dof = club.dof_policy;
    policies.set(club.id, {
      clubId: club.id,
      tier: club.tier,
      needs: squadNeeds(club.formation, positions, level),
      surplus: [],
      saleCredit: 0,
      departing: departing.get(club.id) ?? 0,
      weeklySurplus: finance?.weeklySurplus ?? 0,
      feeCashShare: finance?.feeCashShare ?? 0,
      embargo: embargoes.has(club.id),
      dofPolicy: dof === "youth" || dof === "value" || dof === "stars" ? dof : "balanced",
      ownerGroupId: owner?.groupId ?? null,
      ownerType: owner?.ownerType ?? null,
      ambition: Math.round(owner?.ambition ?? clamp(club.reputation * 0.9 + 5, 10, 95)),
      name: club.name,
      managed: family.has(club.id),
      countryId: club.country_id,
      association: clubRegistration(club.club_code, club.hosted ? { hosted: JSON.parse(club.hosted) } : {}).association,
      leagueCode: club.league_code,
      ...policyMoney(club, weeklyWages, finance?.ffpHeadroom ?? 0, committed.get(club.id), departing.get(club.id)),
      weeklyWages,
      level,
      seniors: Object.values(positions).reduce((sum, stats) => sum + stats.depth, 0),
      positions: Object.fromEntries(
        Object.entries(positions).map(([position, { depth, available, best, second, old }]) => [position, { depth, available, best, second, old }]),
      ),
      payScale: pay && pay.base > 0 ? pay.wages / pay.base : 0.02,
      incoming: incoming.get(club.id) ?? 0,
      formation: club.formation,
      tacticalStyle: club.tactical_style,
      facilities: club.facilities,
      academy: club.academy,
      managerTrust: club.manager_trust,
      crisis: club.crisis,
    });
  }
  const supply = await marketSupply(store, date, policies, squad.positions);
  const window = transferWindow(date);
  for (const player of supply.values()) {
    const policy = policies.get(player.clubId);
    if (!policy) continue;
    policy.surplus.push(player.id);
    if (window && signsAhead(policy)) policy.saleCredit = Math.min(policy.saleCredit + saleCreditOf(player), Math.max(0, policy.wageBudget) * SALE_CREDIT_SHARE);
  }
  // Every other club with seniors playing is a B-team (first teams have policies).
  const reserves = new Map<number, ReserveSquad>();
  for (const [clubId, positions] of squad.positions)
    if (!policies.has(clubId))
      reserves.set(clubId, {
        seniors: Object.values(positions).reduce((sum, stats) => sum + stats.depth, 0),
        keepers: positions.GK?.depth ?? 0,
      });
  return { schema: store.schemaName, built: date, date, policies, supply, reserves, ownership };
}

/** Next day with a full build still fresh: budgets, embargoes, open deals and season moves are re-read (no player scan). */
async function refresh(store: Store, snapshot: Snapshot, date: string) {
  const committed = await commitments(store);
  const embargoes = await activeEmbargoes(store, date);
  const incoming = await incomingMoves(store, date);
  const window = transferWindow(date);
  for (const club of await clubRows(store)) {
    const policy = snapshot.policies.get(club.id);
    if (!policy) continue;
    // A build from the window's last days serves the first days after it: nothing is planned any more.
    if (!window) Object.assign(policy, { departing: 0, saleCredit: 0 });
    const headroom = policy.ffpHeadroom + policy.committedWages * 52;
    Object.assign(policy, policyMoney(club, policy.weeklyWages, headroom, committed.get(club.id), policy.departing), {
      embargo: embargoes.has(club.id),
      incoming: incoming.get(club.id) ?? 0,
    });
  }
  snapshot.date = date;
  return snapshot;
}

/**
 * Players their (AI) clubs would move on today: listed or loan-listed, beyond the wanted depth in their position,
 * well below the squad level, in the last year of contract (veterans and fringe players), young players short of
 * minutes (development loans), players who have outgrown the club (sold at a premium) and, at clubs over their wage
 * budget or FFP limit, their better-paid non-starters. Excludes the director's club family, loans, recent moves, long
 * injuries, players in talks and players under 18. The SQL pre-filter uses the clubs' level anchor (reputation ×
 * 0.66 + 22); ranks come from the squad depth already loaded.
 */
async function marketSupply(
  store: Store,
  date: string,
  policies: Map<number, ClubPolicy>,
  positions: Map<number, Record<string, { abilities: number[] }>>,
) {
  const managed = [...policies.values()].filter((policy) => policy.managed).map((policy) => policy.clubId);
  const pressured = [...policies.values()].filter((policy) => !policy.managed && (policy.ffpHeadroom < 0 || policy.wageRoom < 0)).map((policy) => policy.clubId);
  const rows = await store.all<{
    id: number;
    club_id: number;
    playing_club_id: number;
    position: Position;
    secondary_position: string;
    age: number;
    ability: number;
    potential: number;
    value: number;
    wage: number;
    contract_end: string;
    listed: number;
    available_loan: number;
    shortlisted: number;
    minutes: number;
    morale: number;
    country_id: number;
  }>(
    `SELECT players.id, players.club_id, players.playing_club_id, players.position, players.secondary_position, players.age,
       players.ability, players.potential, players.value, players.wage, players.contract_end, players.listed, players.available_loan,
       players.shortlisted, players.minutes, players.morale, players.country_id
     FROM players JOIN clubs ON clubs.id = players.club_id AND clubs.type = 'club'
     WHERE players.age_group = 'Senior' AND players.role <> 'Retired' AND players.parent_club_id IS NULL AND players.age >= 18
       AND players.contract_end > ? AND (players.injury_until IS NULL OR players.injury_until <= ?) AND players.club_id <> ALL(?::integer[])
       AND (players.listed = 1 OR players.available_loan = 1 OR players.club_id = ANY(?::integer[])
         OR players.playing_club_id <> players.club_id OR players.ability < clubs.reputation * 0.66 + 16
         OR (players.contract_end <= ? AND (players.age >= 30 OR players.ability < clubs.reputation * 0.66 + 22))
         OR (players.age <= 21 AND players.potential - players.ability >= 5 AND players.ability < clubs.reputation * 0.66 + 22)
         OR (players.age <= 29 AND players.ability >= clubs.reputation * 0.66 + 26))
     ORDER BY players.id`,
    date,
    addDays(date, 14),
    managed,
    pressured,
    addDays(date, 365),
  );
  const recent = new Set(
    (
      await store.all<{ entity_id: number }>(
        "SELECT DISTINCT entity_id FROM history WHERE entity_type IN ('transfer','loan') AND date >= ?",
        addDays(date, -120),
      )
    ).map((row) => row.entity_id),
  );
  const busy = new Set(
    (await store.all<{ player_id: number }>("SELECT DISTINCT player_id FROM negotiations WHERE stage = ANY(?::text[])", OPEN_STAGES)).map(
      (row) => row.player_id,
    ),
  );
  const supply = new Map<number, SupplyPlayer>();
  for (const row of rows) {
    const policy = policies.get(row.club_id);
    if (!policy || recent.has(row.id) || busy.has(row.id)) continue;
    const abilities = row.playing_club_id === row.club_id ? positions.get(row.club_id)?.[row.position]?.abilities : undefined;
    const rank = abilities ? 1 + abilities.filter((ability) => ability > row.ability).length : 99;
    const target = TARGET_DEPTH[row.position] ?? 2;
    const pressure = (policy.ffpHeadroom < 0 || policy.wageRoom < 0) && rank > 1 && row.wage > policy.weeklyWages / Math.max(1, policy.seniors);
    const expiring = row.contract_end <= addDays(date, 365) && (row.age >= 30 || rank > 1);
    const development = row.age <= 21 && row.potential - row.ability >= 5 && rank > 2;
    const outgrown = rank <= 2 && row.ability >= policy.level + 4 && row.age <= 29;
    const reason: SupplyPlayer["reason"] | null = row.listed
      ? "listed"
      : row.available_loan
        ? "loan-listed"
        : pressure
          ? "over-budget"
          : development
            ? "development"
            : rank > target
              ? "surplus"
              : row.ability < policy.level - 8 && row.age >= 21
                ? "weak"
                : expiring
                  ? "expiring"
                  : outgrown
                    ? "outgrown"
                    : null;
    if (!reason) continue;
    // A club over its budget also lends a well-paid player out (the borrower takes a share of his wage) until 30.
    const mode: SupplyPlayer["mode"] =
      reason === "loan-listed" || reason === "development"
        ? "loan"
        : reason === "over-budget"
          ? row.age >= 31 ? "transfer" : "both"
          : reason === "expiring" || reason === "outgrown" || row.age >= 27
            ? "transfer"
            : "both";
    supply.set(row.id, {
      id: row.id,
      clubId: row.club_id,
      position: row.position,
      secondary: row.secondary_position,
      age: row.age,
      ability: row.ability,
      potential: row.potential,
      value: row.value,
      wage: row.wage,
      contractEnd: row.contract_end,
      listed: !!row.listed,
      shortlisted: !!row.shortlisted,
      minutes: row.minutes,
      morale: row.morale,
      countryId: row.country_id,
      rank,
      ...(row.playing_club_id !== row.club_id ? { squadClubId: row.playing_club_id } : {}),
      reason,
      mode,
    });
  }
  return supply;
}

function remember(snapshot: Snapshot) {
  snapshots.delete(snapshot.schema);
  snapshots.set(snapshot.schema, snapshot);
  for (const schema of snapshots.keys()) if (snapshots.size > MAX_SNAPSHOTS) snapshots.delete(schema);
  return snapshot;
}

/**
 * Today's snapshot: the latest full build of this world when it is at most SNAPSHOT_MAX_AGE days old (budgets,
 * embargoes, open deals and season moves refreshed once per day), otherwise a new full build.
 */
async function daySnapshot(store: Store, date: string, maxAge = SNAPSHOT_MAX_AGE) {
  const snapshot = snapshots.get(store.schemaName);
  // A registration window opening invalidates a build made while it was closed (the supply was not read then).
  const fresh =
    snapshot && snapshot.built <= date && daysBetween(snapshot.built, date) < maxAge && (transferWindow(snapshot.built) || !transferWindow(date));
  if (fresh && snapshot.date === date) return snapshot;
  if (fresh) return remember(await refresh(store, snapshot, date));
  return remember(await build(store, date));
}

/** The daily club policy snapshot (cached per date in-process). */
export async function clubPolicySnapshot(store: Store, date: string): Promise<Map<number, ClubPolicy>> {
  return (await daySnapshot(store, date)).policies;
}

/**
 * The market's view of the day (policies and supply): a full build (squads, finances, supply) younger than `maxAge`
 * days is reused with today's budgets; the market's own moves are applied to it in memory as they happen.
 */
export async function marketSnapshot(store: Store, date: string, maxAge: number) {
  return daySnapshot(store, date, maxAge);
}

/** Forgets this world's snapshot (after a save is loaded or a world is replaced in the same process). */
export function forgetClubPolicies(store: Store) {
  snapshots.delete(store.schemaName);
}
