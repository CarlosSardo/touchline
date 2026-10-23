import seedrandom from "seedrandom";
import type { Store } from "./db.ts";
import {
  clubValuation,
  estimateClubRevenue,
  fairValueForFfp,
  leagueGroupSizes,
  projectedOperatingRevenue,
  recordFinancialItem,
  seasonHomeMatches,
} from "./finance.ts";
import { personName } from "./people.ts";
import { news, stateOf } from "./systems.ts";
import { worldNewsBatch, type WorldNewsInput } from "./world-news.ts";
import {
  CONTROL_STAKE,
  GULF_CAPITALS,
  MEMBER_CONTROL,
  OWNER_TYPES,
  ownerName,
  ownerProfile,
  planOwnership,
  privateOwnerType,
  termYears,
  type OwnerType,
  type PlanClub,
} from "./ownership-plan.ts";
import { CONTINENTAL } from "../shared/world-catalog/index.ts";
import { addDays, clamp, daysBetween, money } from "../shared/rules.ts";
import type { Club, GameState } from "../shared/types.ts";

export { OWNER_TYPES, type OwnerType };
type Rng = seedrandom.PRNG;

const META = "ownership";
const VERSION = 1;
/** Grace period the new owners (or a new president) give the director before their review. */
export const REVIEW_DAYS = 120;
/** Takeovers started per week across the whole world at most (each runs for several weeks). */
const MAX_NEW_DEALS = 8;
/** Sister clubs are preferred partners for loans and transfers (W-market's matching multiplies pair scores). */
export const SISTER_PREFERENCE = 1.75;

export interface Deal {
  kind: "takeover" | "minority" | "supporters_trust";
  stage: "rumour" | "talks";
  buyerId?: number;
  buyer?: { name: string; type: OwnerType; country_id: number | null; wealth: number; ambition: number; patience: number; data: Record<string, unknown> };
  buyerName: string;
  buyerType: OwnerType;
  price: number;
  stake: number;
  rumoured: string;
  talks: string;
  completes: string;
}

export interface Campaign {
  date: string;
  candidates: { name: string; promise: PresidentPromise; incumbent: boolean }[];
}

export const PROMISES = ["continuity", "star signing", "balance the books", "academy pathway", "stadium"] as const;
export type PresidentPromise = (typeof PROMISES)[number];

export interface OwnershipData {
  debt?: number;
  rule?: "50+1" | "51%";
  exemption?: string;
  investors?: { ownerId: number; name: string; stake: number }[];
  termYears?: number;
  presidentSince?: string;
  presidentTerms?: number;
  deal?: Deal;
  election?: Campaign;
  promise?: PresidentPromise;
  policyHint?: "youth" | "stars" | "value";
  frustration?: number;
  selling?: boolean;
  stripper?: boolean;
  acquired?: string;
}

export interface Review {
  clubId: number;
  ownerName: string;
  reason: "takeover" | "election";
  started: string;
  due: string;
  target: number;
}

interface OwnershipMeta {
  version: number;
  generated: string;
  lastWeekly?: string;
  blindTrustSeason?: number;
  review?: Review;
}

export interface OwnershipInfo {
  clubId: number;
  /** First team the club belongs to (reserve teams follow their parent's owner). */
  rootId: number;
  ownerId: number;
  ownerType: OwnerType;
  ownerName: string;
  /** Owner id when the owner controls two or more first teams (a multi-club group), else null. */
  groupId: number | null;
  groupClubIds: number[];
  ambition: number;
  patience: number;
  memberOwned: boolean;
  blindTrust: boolean;
}

const parse = <Value>(text: string | null | undefined, fallback: Value): Value => {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as Value;
  } catch {
    return fallback;
  }
};

const snapshots = new WeakMap<Store, { key: string; value: Map<number, OwnershipInfo> }>();
let generation = 0;
const changed = () => generation++;

/** Forgets the cached ownership snapshot (the world was replaced: a save loaded, a career started or deleted). */
export function forgetOwnership(store: Store) {
  snapshots.delete(store);
}

async function ownershipMeta(store: Store) {
  const row = await store.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", META);
  return row ? parse<OwnershipMeta | undefined>(row.value, undefined) : undefined;
}

/** The new owners' (or president's) review of the director in progress, if any. */
export async function currentReview(store: Store) {
  return (await ownershipMeta(store))?.review;
}

/**
 * Owners for every first team, once per world: deterministic from the world seed, so a new world and an older
 * world or save that predates ownership get the same owners. `fund` applies the owners' first-season funding.
 */
export async function ensureOwnership(store: Store, options: { fund?: boolean } = {}) {
  if (await ownershipMeta(store)) return false;
  const state = await store.meta<GameState | undefined>("state").catch(() => undefined);
  if (!state) return false;
  const world = await store.meta<{ seed?: string; options?: { structureOnly?: boolean } } | undefined>("world").catch(() => undefined);
  if (world?.options?.structureOnly) return false;
  await store.transaction(async () => {
    if ((await store.get("SELECT 1 AS present FROM club_ownership LIMIT 1")) || (await ownershipMeta(store))) return;
    const clubs = await store.all<PlanClub & { founded_text: string | null }>(
      `SELECT clubs.id, clubs.name, clubs.city, countries.code, countries.name AS "countryName", countries.language,
         leagues.tier, clubs.reputation, clubs.data::jsonb ->> 'founded' AS founded_text,
         coalesce(clubs.data::jsonb ->> 'worldKey', clubs.id::text) AS key
       FROM clubs JOIN countries ON countries.id = clubs.country_id LEFT JOIN leagues ON leagues.id = clubs.league_id
       WHERE clubs.type = 'club' ORDER BY clubs.id`,
    );
    const countries = await store.all<{ id: number; code: string; name: string; capital: string }>(
      "SELECT id, code, name, region AS capital FROM countries ORDER BY id",
    );
    const plan = planOwnership(
      world?.seed ?? state.seed,
      clubs.map(({ founded_text, ...club }) => ({ ...club, founded: founded_text && /^\d{4}$/.test(founded_text) ? Number(founded_text) : null })),
      countries,
      state.date,
    );
    await store.bulkInsert("owners", plan.owners.map((owner) => ({ ...owner, data: JSON.stringify(owner.data) })));
    await store.bulkInsert(
      "club_ownership",
      plan.ownership.map((row) => ({ ...row, blind_trust: false, data: JSON.stringify(row.data) })),
    );
    await store.setMeta(META, { version: VERSION, generated: state.date } satisfies OwnershipMeta);
    if (options.fund) await applySeasonFunding(store, state, { initial: true });
  });
  changed();
  return true;
}

/** Every non-national club's owner, keyed by club id (reserve teams map to their parent); cached per date. */
export async function ownershipSnapshot(store: Store): Promise<Map<number, OwnershipInfo>> {
  const state = await stateOf(store);
  const key = `${store.schemaName}:${state.date}:${generation}`;
  const cached = snapshots.get(store);
  if (cached?.key === key) return cached.value;
  const rows = await store.all<{
    club_id: number;
    root_id: number;
    owner_id: number;
    type: OwnerType;
    name: string;
    ambition: number;
    patience: number;
    member_owned: boolean;
    blind_trust: boolean;
    controls: boolean;
  }>(
    `SELECT clubs.id AS club_id, root.club_id AS root_id, root.owner_id, owners.type, owners.name, owners.ambition,
       owners.patience, root.member_owned, root.blind_trust, (NOT root.member_owned AND root.stake >= ?) AS controls
     FROM clubs JOIN club_ownership AS root ON root.club_id = coalesce(clubs.parent_id, clubs.id)
     JOIN owners ON owners.id = root.owner_id
     WHERE clubs.type <> 'national'`,
    CONTROL_STAKE,
  );
  const controlled = new Map<number, Set<number>>();
  for (const row of rows)
    if (row.controls) controlled.set(row.owner_id, (controlled.get(row.owner_id) ?? new Set()).add(row.root_id));
  const value = new Map<number, OwnershipInfo>();
  for (const row of rows) {
    const group = row.controls ? [...controlled.get(row.owner_id)!].sort((left, right) => left - right) : [row.root_id];
    value.set(row.club_id, {
      clubId: row.club_id,
      rootId: row.root_id,
      ownerId: row.owner_id,
      ownerType: row.type,
      ownerName: row.name,
      groupId: group.length > 1 ? row.owner_id : null,
      groupClubIds: group,
      ambition: row.ambition,
      patience: row.patience,
      memberOwned: row.member_owned,
      blindTrust: row.blind_trust,
    });
  }
  snapshots.set(store, { key, value });
  return value;
}

/** The owner of a club and the first teams it controls (the club itself included); null before owners exist. */
export async function ownerGroupOf(
  store: Store,
  clubId: number,
): Promise<{ ownerId: number; groupClubIds: number[]; type: string } | null> {
  const row = await store.get<{ owner_id: number; type: string; group_ids: number[] }>(
    `SELECT target.owner_id, owners.type,
       CASE WHEN NOT target.member_owned AND target.stake >= ? THEN ARRAY(
         SELECT other.club_id FROM club_ownership AS other
         WHERE other.owner_id = target.owner_id AND NOT other.member_owned AND other.stake >= ? ORDER BY other.club_id)
       ELSE ARRAY[target.club_id] END AS group_ids
     FROM clubs JOIN club_ownership AS target ON target.club_id = coalesce(clubs.parent_id, clubs.id)
     JOIN owners ON owners.id = target.owner_id WHERE clubs.id = ?`,
    CONTROL_STAKE,
    CONTROL_STAKE,
    clubId,
  );
  return row ? { ownerId: row.owner_id, groupClubIds: row.group_ids, type: row.type } : null;
}

/** Two different first teams (or their reserve teams) controlled by the same owner: related parties under FFP. */
export async function sameOwnerGroup(store: Store, a: number, b: number): Promise<boolean> {
  if (a === b) return false;
  const row = await store.get<{ same: boolean }>(
    `SELECT count(DISTINCT ownership.club_id) = 2 AND count(DISTINCT ownership.owner_id) = 1
       AND bool_and(NOT ownership.member_owned AND ownership.stake >= ?) AS same
     FROM clubs JOIN club_ownership AS ownership ON ownership.club_id = coalesce(clubs.parent_id, clubs.id)
     WHERE clubs.id = ANY(?::integer[])`,
    CONTROL_STAKE,
    [a, b],
  );
  return Boolean(row?.same);
}

/**
 * Pair multiplier for the market's matching: sister clubs (one group, different first teams) are preferred
 * partners for development loans and transfers; clubs placed in a blind trust may not deal with their group.
 */
export function sisterPreference(snapshot: ReadonlyMap<number, OwnershipInfo>, buyerId: number, sellerId: number): number {
  const buyer = snapshot.get(buyerId);
  const seller = snapshot.get(sellerId);
  if (!buyer?.groupId || buyer.groupId !== seller?.groupId || buyer.rootId === seller.rootId) return 1;
  return buyer.blindTrust || seller.blindTrust ? 0 : SISTER_PREFERENCE;
}

/**
 * Related-party pricing (UEFA/PL rules): a deal between sister clubs counts at fair value in the FFP accounts;
 * the difference to the agreed fee is the non-football adjustment the market records.
 */
export async function relatedPartyTerms(store: Store, buyerId: number, sellerId: number, fee: number, value: number) {
  if (!(await sameOwnerGroup(store, buyerId, sellerId))) return { related: false, ffpFee: fee, adjustment: 0 };
  const ffpFee = fairValueForFfp(fee, value);
  return { related: true, ffpFee, adjustment: ffpFee - fee };
}

/** Owner money paid into the club: cash, a ledger line and FFP equity (raises UEFA's acceptable deviation). */
export async function injectEquity(store: Store, clubId: number, amount: number, reason: string): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("An equity injection must be a positive amount.");
  const state = await stateOf(store);
  await store.run("UPDATE clubs SET balance = balance + ? WHERE id = ?", amount, clubId);
  await store.run(
    "INSERT INTO ledger(club_id, date, category, amount, description) VALUES (?, ?, 'Owner equity', ?, ?)",
    clubId,
    state.date,
    amount,
    reason,
  );
  await recordFinancialItem(store, clubId, "equity", amount, state.season);
}

const TYPE_LABEL: Record<OwnerType, string> = {
  local: "local business owner",
  billionaire: "billionaire investor",
  state: "state-backed fund",
  private_equity: "private equity fund",
  members: "members' association",
};
export const ownerTypeLabel = (type: string) => TYPE_LABEL[type as OwnerType] ?? type;

/**
 * A season of owner money: state funds and ambitious billionaires inject equity (FFP equity), private equity
 * charges interest on the debt it placed on the club and a management fee, asset strippers take dividends;
 * `factor` scales the next transfer budget. Members' clubs live on their own revenue.
 */
export function seasonFunding(input: {
  type: OwnerType;
  wealth: number;
  ambition: number;
  revenue: number;
  balance: number;
  debt: number;
  stripper: boolean;
}) {
  const revenue = Math.max(250_000, input.revenue);
  const drive = clamp((input.ambition - 40) / 60, 0, 1);
  const cap = { state: 0.002, billionaire: 0.01, local: 0.03, private_equity: 0.001, members: 0 }[input.type] * input.wealth;
  const share = { state: 0.1 + 0.25 * drive, billionaire: 0.02 + 0.2 * drive, local: 0.08 * drive, private_equity: drive > 0.5 ? 0.04 : 0, members: 0 }[input.type];
  return {
    injection: Math.round(Math.min(cap, revenue * share) / 1000) * 1000,
    interest: Math.round(Math.max(0, input.debt) * 0.06),
    dividend: Math.round((input.type === "private_equity" ? revenue * 0.015 : 0) + (input.stripper ? Math.max(0, input.balance) * 0.08 : 0)),
    factor: (input.type === "private_equity" ? 0.9 : 1) * (input.stripper ? 0.6 : 1),
  };
}

const NOTABLE_INJECTION = 20_000_000;

/**
 * Cash each club pays its owners at the coming rollover for the finished `season` (interest on acquisition debt and
 * dividends, seasonFunding; new equity is left out): the pre-season FFP projection plans without it.
 */
export async function rolloverOwnerPayments(store: Store, season: number, clubIds: readonly number[]) {
  const rows = await store.all<{ club_id: number; data: string; type: OwnerType; wealth: number; ambition: number; balance: number; revenue: number }>(
    `SELECT ownership.club_id, ownership.data, owners.type, owners.wealth, owners.ambition, clubs.balance, coalesce(periods.revenue, 0) AS revenue
     FROM club_ownership AS ownership JOIN owners ON owners.id = ownership.owner_id JOIN clubs ON clubs.id = ownership.club_id
     LEFT JOIN financial_periods AS periods ON periods.club_id = ownership.club_id AND periods.season = ?
     WHERE ownership.club_id = ANY(?::integer[])`,
    season,
    [...clubIds],
  );
  return new Map(
    rows.map((row) => {
      const data = parse<OwnershipData>(row.data, {});
      const funding = seasonFunding({ ...row, debt: data.debt ?? 0, stripper: Boolean(data.stripper) });
      return [row.club_id, funding.interest + funding.dividend];
    }),
  );
}

/** Annual operating revenue estimate of every first team (finance.projectedOperatingRevenue, in one query). */
async function revenueEstimates(store: Store) {
  const rows = await store.all<{ id: number; reputation: number; league_reputation: number | null; tier: number | null; capacity: number; fan_mood: number; code: string }>(
    `SELECT clubs.id, clubs.reputation, leagues.reputation AS league_reputation, leagues.tier, clubs.capacity, clubs.fan_mood,
       countries.code
     FROM clubs LEFT JOIN leagues ON leagues.id = clubs.league_id
     JOIN countries ON countries.id = coalesce(leagues.country_id, clubs.country_id)
     WHERE clubs.type = 'club'`,
  );
  const groups = await leagueGroupSizes(store);
  return new Map(
    rows.map((row) => [
      row.id,
      estimateClubRevenue({
        reputation: row.reputation,
        leagueReputation: row.league_reputation ?? row.reputation,
        tier: row.tier ?? 1,
        capacity: row.capacity,
        fanMood: row.fan_mood,
        homeMatches: seasonHomeMatches(groups.get(row.id) ?? 0),
        countryCode: row.code,
      }).annualOperatingRevenue,
    ]),
  );
}

/** Applies every owner's season funding in a few set-based statements (rollover, or a new world's first season). */
async function applySeasonFunding(store: Store, state: GameState, options: { initial?: boolean } = {}) {
  const rows = await store.all<{
    club_id: number;
    name: string;
    data: string;
    since: string;
    owner_id: number;
    owner_name: string;
    type: OwnerType;
    wealth: number;
    ambition: number;
    patience: number;
    owner_data: string;
    balance: number;
    transfer_budget: number;
    wage_budget: number;
    board_confidence: number;
    revenue: number;
  }>(
    `SELECT ownership.club_id, clubs.name, ownership.data, ownership.since, owners.id AS owner_id, owners.name AS owner_name,
       owners.type, owners.wealth, owners.ambition, owners.patience, owners.data AS owner_data, clubs.balance,
       clubs.transfer_budget, clubs.wage_budget, clubs.board_confidence, coalesce(periods.revenue, 0) AS revenue
     FROM club_ownership AS ownership JOIN owners ON owners.id = ownership.owner_id JOIN clubs ON clubs.id = ownership.club_id
     LEFT JOIN financial_periods AS periods ON periods.club_id = ownership.club_id AND periods.season = ?
     ORDER BY ownership.club_id`,
    state.season - 1,
  );
  const changes: { id: number; injection: number; interest: number; dividend: number; transfer: number; wage: number }[] = [];
  const updates: { id: number; data: string }[] = [];
  const ledger: { club_id: number; date: string; category: string; amount: number; description: string }[] = [];
  const events: { date: string; club_id: number; kind: string; from_owner_id: number | null; to_owner_id: number | null; data: string }[] = [];
  const estimates = rows.some((row) => row.revenue <= 0) ? await revenueEstimates(store) : new Map<number, number>();
  for (const row of rows) {
    const data = parse<OwnershipData>(row.data, {});
    const revenue = row.revenue > 0 ? row.revenue : (estimates.get(row.club_id) ?? 0);
    const funding = seasonFunding({
      type: row.type,
      wealth: row.wealth,
      ambition: row.ambition,
      revenue,
      balance: row.balance,
      debt: data.debt ?? 0,
      stripper: Boolean(data.stripper),
    });
    const change =
      funding.injection || funding.interest || funding.dividend || funding.factor !== 1
        ? {
            id: row.club_id,
            ...funding,
            transfer: Math.max(0, Math.round(row.transfer_budget * funding.factor + funding.injection * 0.6)),
            wage: Math.round(
              row.wage_budget * (1 + Math.min(0.1, (funding.injection / Math.max(250_000, revenue)) * 0.3)) * (funding.factor < 1 ? 0.97 : 1),
            ),
          }
        : undefined;
    if (change) changes.push(change);
    if (funding.injection)
      ledger.push({ club_id: row.club_id, date: state.date, category: "Owner equity", amount: funding.injection, description: `${row.owner_name}: season funding` });
    if (funding.interest)
      ledger.push({ club_id: row.club_id, date: state.date, category: "Owner debt interest", amount: -funding.interest, description: `Interest on the acquisition debt placed on the club by ${row.owner_name}` });
    if (funding.dividend)
      ledger.push({ club_id: row.club_id, date: state.date, category: "Owner dividend", amount: -funding.dividend, description: `Fees and dividends paid to ${row.owner_name}` });
    if (funding.injection >= NOTABLE_INJECTION)
      events.push({ date: state.date, club_id: row.club_id, kind: "equity_injection", from_owner_id: null, to_owner_id: row.owner_id, data: JSON.stringify({ amount: funding.injection, season: state.season }) });
    if (!options.initial && row.type !== "members") {
      const frustration = row.board_confidence < 40 ? (data.frustration ?? 0) + (100 - row.patience) / 40 : Math.max(0, (data.frustration ?? 0) - 0.75);
      const held = daysBetween(data.acquired ?? row.since, state.date) / 365;
      const exit = row.type === "private_equity" && held >= Number(parse<{ holdYears?: number }>(row.owner_data, {}).holdYears ?? 6);
      const selling = frustration >= 2.5 || exit;
      if (frustration !== (data.frustration ?? 0) || selling !== Boolean(data.selling))
        updates.push({ id: row.club_id, data: JSON.stringify({ ...data, frustration: Math.round(frustration * 100) / 100, selling }) });
    }
    if (!options.initial && row.club_id === state.clubId && (funding.injection || funding.interest || funding.dividend))
      await news(
        store,
        "Board",
        `Owner funding for ${state.season}/${String(state.season + 1).slice(-2)}`,
        [
          funding.injection ? `${row.owner_name} has paid ${money(funding.injection)} of new equity into the club; it counts as owner investment under the financial rules.` : "",
          funding.interest ? `${money(funding.interest)} of interest is due on the acquisition debt carried by the club.` : "",
          funding.dividend ? `${money(funding.dividend)} leaves the club in fees and dividends to the owners.` : "",
          `Your transfer budget for the season is ${money(change?.transfer ?? row.transfer_budget)}.`,
        ].filter(Boolean).join(" "),
        "important",
        "finances",
      );
  }
  if (changes.length)
    await store.run(
      `UPDATE clubs AS target SET balance = target.balance + change.injection - change.interest - change.dividend,
         transfer_budget = change.transfer, wage_budget = change.wage
       FROM unnest(?::integer[], ?::double precision[], ?::double precision[], ?::double precision[], ?::double precision[], ?::double precision[])
         AS change(id, injection, interest, dividend, transfer, wage)
       WHERE target.id = change.id`,
      changes.map((change) => change.id),
      changes.map((change) => change.injection),
      changes.map((change) => change.interest),
      changes.map((change) => change.dividend),
      changes.map((change) => change.transfer),
      changes.map((change) => change.wage),
    );
  const accounts = changes.filter((change) => change.injection || change.interest);
  if (accounts.length)
    await store.run(
      `INSERT INTO financial_periods (club_id, season, equity, operating)
       SELECT item.club_id, ?::integer, item.equity, item.operating
       FROM unnest(?::integer[], ?::double precision[], ?::double precision[]) AS item(club_id, equity, operating)
       ON CONFLICT (club_id, season) DO UPDATE SET equity = financial_periods.equity + EXCLUDED.equity,
         operating = financial_periods.operating + EXCLUDED.operating`,
      state.season,
      accounts.map((change) => change.id),
      accounts.map((change) => change.injection),
      accounts.map((change) => change.interest),
    );
  await store.bulkInsert("ledger", ledger);
  await store.bulkInsert("ownership_events", events);
  if (updates.length)
    await store.run(
      `UPDATE club_ownership AS target SET data = change.data FROM unnest(?::integer[], ?::text[]) AS change(id, data)
       WHERE target.club_id = change.id`,
      updates.map((update) => update.id),
      updates.map((update) => update.data),
    );
  changed();
}

/**
 * The director asks the board for funds: a wealthy, ambitious owner (billionaire or state) adds new equity once a
 * season on top of the board's own allocation. Returns the amount injected (0 when the owner declines).
 */
export async function requestOwnerBacking(store: Store, clubId: number) {
  const state = await stateOf(store);
  const row = await store.get<{ name: string; type: OwnerType; wealth: number; ambition: number; data: string }>(
    `SELECT owners.name, owners.type, owners.wealth, owners.ambition, ownership.data
     FROM club_ownership AS ownership JOIN owners ON owners.id = ownership.owner_id WHERE ownership.club_id = ?`,
    clubId,
  );
  if (!row || !["billionaire", "state"].includes(row.type) || row.ambition < 60) return 0;
  const data = parse<OwnershipData & { backedSeason?: number }>(row.data, {});
  if (data.backedSeason === state.season) return 0;
  const club = (await store.get<Club>("SELECT * FROM clubs WHERE id = ?", clubId))!;
  const amount = Math.round(Math.min(row.wealth * 0.002, (await projectedOperatingRevenue(store, club)) * 0.08) / 100_000) * 100_000;
  if (amount <= 0) return 0;
  await injectEquity(store, clubId, amount, `${row.name}: funds released at the director's request`);
  await store.run("UPDATE club_ownership SET data = ? WHERE club_id = ?", JSON.stringify({ ...data, backedSeason: state.season }), clubId);
  return amount;
}

/** Season rollover: owners fund (or drain) their clubs and decide whether to sell. */
export async function ownershipRollover(store: Store) {
  await ensureOwnership(store);
  await applySeasonFunding(store, await stateOf(store));
}

interface ClubRow {
  club_id: number;
  owner_id: number;
  stake: number;
  since: string;
  member_owned: boolean;
  president: string | null;
  next_election: string | null;
  data: string;
  name: string;
  city: string;
  reputation: number;
  balance: number;
  board_confidence: number;
  fan_mood: number;
  expectations: number;
  transfer_budget: number;
  code: string;
  capital: string;
  tier: number | null;
  owner_name: string;
  type: OwnerType;
  wealth: number;
  ambition: number;
  patience: number;
  owner_data: string;
}

interface EventRow {
  date: string;
  club_id: number;
  kind: string;
  from_owner_id: number | null;
  to_owner_id: number | null;
  data: string;
}

interface Pass {
  store: Store;
  state: GameState;
  rng: Rng;
  meta: OwnershipMeta;
  world: WorldNewsInput[];
  events: EventRow[];
  names: Set<string>;
  /** Countries of the Gulf state funds (id null when the nation is not in this world). */
  gulf: { id: number | null; code: string }[];
}

interface Investor {
  ownerId: number;
  name: string;
  type: OwnerType;
  ambition: number;
  wealth: number;
  clubs: number;
  countries: Set<string>;
  flagship: number;
}

const between = (rng: Rng, low: number, high: number) => low + (high - low) * rng();
const hundredths = (value: number) => Math.round(value * 100) / 100;
const notable = (row: Pick<ClubRow, "tier" | "reputation">) => (row.tier ?? 9) <= 2 || row.reputation >= 55;
const seasonLabel = (season: number) => `${season}/${String(season + 1).slice(-2)}`;
const percent = (stake: number) => `${Math.round(stake * 100)}%`;

function event(pass: Pass, row: Pick<ClubRow, "club_id">, kind: string, data: object, from: number | null = null, to: number | null = null) {
  pass.events.push({ date: pass.state.date, club_id: row.club_id, kind, from_owner_id: from, to_owner_id: to, data: JSON.stringify(data) });
}

function world(pass: Pass, row: Pick<ClubRow, "club_id">, title: string, body: string, data: object = {}) {
  pass.world.push({ kind: "ownership", title, body, clubIds: [row.club_id], date: pass.state.date, data: { ownership: true, ...data } });
}

async function setOwnershipData(store: Store, clubId: number, data: OwnershipData) {
  await store.run("UPDATE club_ownership SET data = ? WHERE club_id = ?", JSON.stringify(data), clubId);
}

/** Annual chance that a club's owner opens a sale (members' clubs: a minority investment or a vote to sell). */
export function saleRate(row: Pick<ClubRow, "member_owned" | "code" | "tier" | "balance" | "type" | "since">, data: OwnershipData, date: string) {
  if (data.deal) return 0;
  const tier = row.tier ?? 9;
  if (row.member_owned) {
    if (MEMBER_CONTROL[row.code]) return tier <= 2 && !data.investors?.length ? 0.04 : 0;
    return row.code === "BR" && tier <= 2 ? 0.05 : 0;
  }
  const held = daysBetween(data.acquired ?? row.since, date) / 365;
  if (held < 2 && row.balance >= 0) return 0;
  // Top flights change hands most (about one club in ten a year in Europe's big leagues), amateur clubs least.
  let rate = data.selling ? 0.5 : { local: 0.05, billionaire: 0.06, state: 0.015, private_equity: 0.05, members: 0 }[row.type];
  if (row.balance < 0) rate *= 2.5;
  rate *= tier === 1 ? 1.6 : tier === 2 ? 1.2 : tier >= 4 ? 0.6 : 1;
  return Math.min(0.8, rate);
}

function newBuyer(pass: Pass, row: ClubRow, type: OwnerType): NonNullable<Deal["buyer"]> {
  const { rng } = pass;
  const gulf = type === "state" && !(row.code in GULF_CAPITALS) ? pass.gulf[Math.floor(rng() * pass.gulf.length)] : undefined;
  const foreign = type === "billionaire" && rng() < 0.45 ? ["US", "EN", "SA", "AE", "CN", "IN", "BR", "TR", "MX"][Math.floor(rng() * 9)] : undefined;
  const name =
    type === "members"
      ? `${row.name} supporters' trust`
      : ownerName(type, { code: row.code, city: row.city, capital: gulf ? GULF_CAPITALS[gulf.code] : row.capital, foreignCode: foreign }, rng, pass.names);
  return {
    name,
    type,
    country_id: gulf?.id ?? null,
    ...ownerProfile(type, row.reputation, rng, { global: Boolean(gulf) }),
    data: {
      ...(type === "private_equity" ? { holdYears: 4 + Math.floor(rng() * 4) } : {}),
      ...((type === "private_equity" && rng() < 0.12) || (type === "local" && rng() < 0.05) ? { stripper: true } : {}),
    },
  };
}

/** Buyer, stake and price of a new sale of `row` (an existing investor expanding, a new owner, a trust...). */
async function proposeDeal(pass: Pass, row: ClubRow, investors: Investor[]): Promise<Deal> {
  const { store, state, rng } = pass;
  const data = parse<OwnershipData>(row.data, {});
  const club = (await store.get<Club>("SELECT * FROM clubs WHERE id = ?", row.club_id))!;
  const revenue = await projectedOperatingRevenue(store, club);
  const value = Math.max(
    100_000,
    clubValuation({ annualOperatingRevenue: revenue, reputation: row.reputation, cashBalance: row.balance, financialDebt: Math.max(0, data.debt ?? 0) }).equityValue,
  );
  const talks = addDays(state.date, 14 + Math.floor(rng() * 15));
  const timing = { stage: "rumour" as const, rumoured: state.date, talks, completes: addDays(talks, 14 + Math.floor(rng() * 22)) };
  const pick = <Value extends string>(weights: Partial<Record<Value, number>>) => {
    const entries = Object.entries(weights) as [Value, number][];
    let roll = rng() * entries.reduce((total, [, weight]) => total + weight, 0);
    for (const [key, weight] of entries) if ((roll -= weight) <= 0) return key;
    return entries[0][0];
  };
  if (row.member_owned && MEMBER_CONTROL[row.code]) {
    const buyer = newBuyer(pass, row, pick<OwnerType>({ local: 0.5, billionaire: 0.3, private_equity: 0.2 }));
    const stake = hundredths(between(rng, 0.1, Math.min(0.49, row.stake - 0.51)));
    return { kind: "minority", ...timing, buyer, buyerName: buyer.name, buyerType: buyer.type, stake, price: Math.round(value * stake * between(rng, 1, 1.3)) };
  }
  if (!row.member_owned && row.balance < 0 && (row.tier ?? 9) >= 3 && rng() < 0.15) {
    const buyer = newBuyer(pass, row, "members");
    return { kind: "supporters_trust", ...timing, buyer, buyerName: buyer.name, buyerType: "members", stake: 1, price: Math.round(Math.max(1, value * 0.1)) };
  }
  const expanding = investors.filter(
    (investor) =>
      investor.ownerId !== row.owner_id &&
      investor.type !== "local" &&
      investor.ambition >= 60 &&
      investor.wealth >= value * 4 &&
      !investor.countries.has(row.code) &&
      investor.flagship > row.reputation + 5,
  );
  const groupBuyer = expanding.length && rng() < (expanding.some((investor) => investor.clubs >= 2) ? 0.3 : 0.1)
    ? expanding[Math.floor(rng() * expanding.length)]
    : undefined;
  const stake = row.member_owned ? hundredths(between(rng, 0.6, 0.9)) : rng() < 0.75 ? 1 : hundredths(between(rng, 0.51, 0.95));
  const price = Math.round(value * stake * between(rng, 0.95, 1.45));
  if (groupBuyer)
    return { kind: "takeover", ...timing, buyerId: groupBuyer.ownerId, buyerName: groupBuyer.name, buyerType: groupBuyer.type, stake, price };
  const type = row.member_owned ? pick<OwnerType>({ billionaire: 0.5, private_equity: 0.35, local: 0.15 }) : privateOwnerType(row.code, row.tier, row.reputation, rng);
  const buyer = newBuyer(pass, row, type);
  return { kind: "takeover", ...timing, buyer, buyerName: buyer.name, buyerType: type, stake, price };
}

function dealOutlook(deal: Deal, ambition?: number) {
  if (deal.kind === "minority") return "The members keep voting control; the investment is paid into the club as new capital.";
  if (deal.kind === "supporters_trust") return "The supporters' trust would run the club on its own revenue, with an elected president.";
  if (deal.buyer?.data.stripper) return "Analysts fear the buyers are more interested in the club's assets than its football: expect cuts.";
  switch (deal.buyerType) {
    case "private_equity":
      return "The purchase would be financed with debt placed on the club: expect interest costs and a tighter budget.";
    case "state":
      return "A state-backed owner would bring heavy investment and very high expectations.";
    case "billionaire":
      return (ambition ?? 60) >= 60 ? "The buyer intends to invest in the squad and expects quick progress." : "The buyer promises a sustainable approach.";
    default:
      return "A local owner would keep the club's finances close to its own revenue.";
  }
}

async function startDeal(pass: Pass, row: ClubRow, investors: Investor[]) {
  const deal = await proposeDeal(pass, row, investors);
  const data = parse<OwnershipData>(row.data, {});
  await setOwnershipData(pass.store, row.club_id, { ...data, deal });
  event(pass, row, "takeover_rumour", { kind: deal.kind, buyerType: deal.buyerType }, row.owner_id);
  if (row.club_id === pass.state.clubId)
    await news(
      pass.store,
      "Board",
      deal.kind === "minority" ? `Investor talks at ${row.name}` : `Takeover talk at ${row.name}`,
      `${deal.kind === "minority" ? "The board confirms an approach from an outside investor for a minority stake." : `${row.owner_name} ${row.member_owned ? "and the members' assembly are considering" : "is considering"} offers for the club.`} Talks could reach a formal bid around ${deal.talks}. Nothing changes for now: your budget and objectives stand until any deal completes, and you will be told at every step.`,
      "important",
      "board",
      { ownership: { clubId: row.club_id, stage: "rumour" } },
    );
  else if ((row.tier ?? 9) === 1 && row.reputation >= 60)
    world(pass, row, `Takeover talk at ${row.name}`, `${row.name}'s owners are said to be open to offers. Interest from a ${ownerTypeLabel(deal.buyerType)} is reported.`);
}

async function collapseDeal(pass: Pass, row: ClubRow, deal: Deal) {
  const data = parse<OwnershipData>(row.data, {});
  delete data.deal;
  await setOwnershipData(pass.store, row.club_id, data);
  event(pass, row, "takeover_collapsed", { kind: deal.kind, buyer: deal.buyerName, stage: deal.stage }, row.owner_id);
  if (row.club_id === pass.state.clubId)
    await news(pass.store, "Board", `Takeover talks collapse at ${row.name}`, `The talks with ${deal.buyerName} have ended without a deal. ${row.owner_name} remains in charge and your objectives and budget are unchanged.`, "important", "board", { ownership: { clubId: row.club_id, stage: "collapsed" } });
  else if (notable(row) && deal.stage === "talks")
    world(pass, row, `${row.name} takeover collapses`, `Talks between ${row.owner_name} and ${deal.buyerName} over ${row.name} have ended without agreement.`);
}

async function advanceDeal(pass: Pass, row: ClubRow, deal: Deal) {
  const { store, state, rng } = pass;
  if (deal.stage === "rumour" && state.date >= deal.talks) {
    if (rng() < 0.15) return collapseDeal(pass, row, deal);
    const data = parse<OwnershipData>(row.data, {});
    const next: Deal = { ...deal, stage: "talks" };
    await setOwnershipData(store, row.club_id, { ...data, deal: next });
    event(pass, row, "takeover_bid", { kind: deal.kind, buyer: deal.buyerName, buyerType: deal.buyerType, price: deal.price, stake: deal.stake }, row.owner_id, deal.buyerId ?? null);
    if (row.club_id === state.clubId)
      await news(
        store,
        "Board",
        `Exclusive talks: ${deal.buyerName} bids for ${row.name}`,
        `${deal.buyerName}, a ${ownerTypeLabel(deal.buyerType)}, has agreed terms in principle for ${percent(deal.stake)} of the club at about ${money(deal.price)}. Completion is expected around ${deal.completes}. ${dealOutlook(deal, deal.buyer?.ambition)}${deal.kind === "minority" ? "" : ` New owners review the sporting director: you would have ${REVIEW_DAYS} days to show progress.`}`,
        "important",
        "board",
        { ownership: { clubId: row.club_id, stage: "talks" } },
      );
    else if (notable(row))
      world(pass, row, `${deal.buyerName} in exclusive talks for ${row.name}`, `${deal.buyerName} (${ownerTypeLabel(deal.buyerType)}) has agreed terms in principle for ${percent(deal.stake)} of ${row.name}, valued at about ${money(deal.price)}.`);
    return;
  }
  if (deal.stage === "talks" && state.date >= deal.completes) {
    if (rng() < 0.1) return collapseDeal(pass, row, deal);
    await completeDeal(pass, row, deal);
  }
}

const reviewTarget = (ambition: number) => clamp(Math.round(40 + (ambition - 50) / 2), 35, 60);

async function startReview(pass: Pass, row: ClubRow, ownerName: string, ambition: number, reason: Review["reason"]) {
  const review: Review = { clubId: row.club_id, ownerName, reason, started: pass.state.date, due: addDays(pass.state.date, REVIEW_DAYS), target: reviewTarget(ambition) };
  pass.meta.review = review;
  event(pass, row, "director_review", { stage: "started", due: review.due, target: review.target, reason });
  return review;
}

async function completeDeal(pass: Pass, row: ClubRow, deal: Deal) {
  const { store, state, rng } = pass;
  const buyerId =
    deal.buyerId ??
    Number(
      (
        await store.run(
          "INSERT INTO owners(name, type, country_id, wealth, ambition, patience, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
          deal.buyer!.name,
          deal.buyer!.type,
          deal.buyer!.country_id,
          deal.buyer!.wealth,
          deal.buyer!.ambition,
          deal.buyer!.patience,
          JSON.stringify(deal.buyer!.data),
        )
      ).lastInsertRowid,
    );
  const buyer = (await store.get<{ name: string; type: OwnerType; wealth: number; ambition: number; data: string }>(
    "SELECT name, type, wealth, ambition, data FROM owners WHERE id = ?",
    buyerId,
  ))!;
  const buyerData = parse<{ stripper?: boolean; group?: string }>(buyer.data, {});
  const data = parse<OwnershipData>(row.data, {});
  const club = (await store.get<Club>("SELECT * FROM clubs WHERE id = ?", row.club_id))!;
  const revenue = await projectedOperatingRevenue(store, club);
  const drive = clamp((buyer.ambition - 40) / 60, 0, 1);
  let injection = 0;
  let dividend = 0;
  let debt = 0;
  let transfer = club.transfer_budget;
  let expectations = club.expectations;
  if (deal.kind === "minority") {
    injection = deal.price;
    await store.run(
      "UPDATE club_ownership SET stake = ?, data = ? WHERE club_id = ?",
      hundredths(Math.max(0.51, row.stake - deal.stake)),
      JSON.stringify({ ...data, deal: undefined, investors: [...(data.investors ?? []), { ownerId: buyerId, name: buyer.name, stake: deal.stake }] }),
      row.club_id,
    );
  } else {
    const trust = deal.kind === "supporters_trust";
    const stripper = !trust && Boolean(buyerData.stripper);
    debt = buyer.type === "private_equity" ? Math.round(deal.price * 0.5) : 0;
    const term = termYears(row.code);
    await store.run(
      `UPDATE club_ownership SET owner_id = ?, stake = ?, since = ?, member_owned = ?, president = ?, next_election = ?,
         blind_trust = false, data = ? WHERE club_id = ?`,
      buyerId,
      deal.stake,
      state.date,
      trust,
      trust ? personName(rng, row.code) : null,
      trust ? addDays(state.date, term * 365) : null,
      JSON.stringify({
        acquired: state.date,
        ...(data.exemption ? { exemption: data.exemption } : {}),
        ...(debt ? { debt } : {}),
        ...(stripper ? { stripper } : {}),
        ...(trust ? { termYears: term, presidentSince: state.date, presidentTerms: 1 } : {}),
      } satisfies OwnershipData),
      row.club_id,
    );
    const share = { state: between(rng, 0.3, 0.8), billionaire: drive >= 0.33 ? between(rng, 0.1, 0.4) : 0, local: between(rng, 0, 0.08), private_equity: 0, members: 0 }[buyer.type];
    injection = Math.round(Math.min(buyer.wealth * 0.02, revenue * share) / 1000) * 1000;
    transfer = transfer * (buyer.type === "private_equity" ? 0.75 : 1) * (stripper ? 0.5 : 1) + injection * 0.7;
    if (stripper) dividend = Math.round(Math.max(0, club.balance + injection) * 0.25);
    expectations = trust ? club.expectations + 1 : Math.max(1, Math.round(club.expectations - (buyer.ambition - 55) / 12));
  }
  if (injection >= 1000)
    await injectEquity(store, row.club_id, injection, `${buyer.name}: investment on completing the ${deal.kind === "minority" ? "minority investment" : "takeover"}`);
  if (dividend)
    await store.run(
      "INSERT INTO ledger(club_id, date, category, amount, description) VALUES (?, ?, 'Owner dividend', ?, ?)",
      row.club_id,
      state.date,
      -dividend,
      `Special dividend to ${buyer.name}`,
    );
  const user = row.club_id === state.clubId;
  const confidence = deal.kind === "minority" ? club.board_confidence : user ? Math.max(55, club.board_confidence) : 65;
  await store.run(
    "UPDATE clubs SET transfer_budget = ?, expectations = ?, board_confidence = ?, balance = balance - ? WHERE id = ?",
    Math.max(0, Math.round(transfer)),
    expectations,
    confidence,
    dividend,
    row.club_id,
  );
  const kind = deal.kind === "minority" ? "minority_investment" : deal.kind === "supporters_trust" ? "supporters_trust" : buyerData.group || deal.buyerId ? "group_acquisition" : "takeover";
  event(
    pass,
    row,
    kind,
    { price: deal.price, stake: deal.stake, buyer: buyer.name, buyerType: buyer.type, seller: row.owner_name, injection, debt, ...(dividend ? { dividend } : {}) },
    deal.kind === "minority" ? null : row.owner_id,
    buyerId,
  );
  if (dividend) event(pass, row, "asset_stripping", { dividend, owner: buyer.name }, null, buyerId);
  changed();
  const summary =
    deal.kind === "minority"
      ? `${buyer.name} has bought ${percent(deal.stake)} of ${row.name} for about ${money(deal.price)}, paid in as new capital. ${MEMBER_CONTROL[row.code] === "50+1" ? "Under the 50+1 rule the members keep the majority of the voting rights." : "The members keep voting control."}`
      : deal.kind === "supporters_trust"
        ? `${row.name}'s supporters' trust has taken control from ${row.owner_name}. The club will be run by an elected president on its own revenue.`
        : `${buyer.name} (${ownerTypeLabel(buyer.type)}) has completed the purchase of ${percent(deal.stake)} of ${row.name} from ${row.owner_name} for about ${money(deal.price)}.${injection ? ` ${money(injection)} of new equity goes straight into the club.` : ""}${debt ? ` ${money(debt)} of acquisition debt is placed on the club.` : ""}${dividend ? ` The new owners have taken a ${money(dividend)} dividend.` : ""}`;
  if (user) {
    const lines = [
      summary,
      deal.kind === "minority" ? "" : `New objective: a top-${expectations} finish (was top-${club.expectations}). Transfer budget: ${money(club.transfer_budget)} → ${money(Math.max(0, Math.round(transfer)))}.`,
    ];
    if (deal.kind !== "minority") {
      const review = await startReview(pass, row, buyer.name, buyer.ambition, "takeover");
      lines.push(`The new owners will review your work on ${review.due}: board confidence of at least ${review.target} keeps you in post. The usual board review continues meanwhile.`);
    }
    await news(store, "Board", deal.kind === "minority" ? `Minority investment completed at ${row.name}` : `Takeover completed: ${buyer.name} now own ${row.name}`, lines.filter(Boolean).join(" "), "important", "board", { ownership: { clubId: row.club_id, stage: "completed" } });
  } else if (notable(row) || kind === "group_acquisition")
    world(pass, row, deal.kind === "minority" ? `${buyer.name} invest in ${row.name}` : `${buyer.name} take over ${row.name}`, summary, { kind });
}

function campaignPromise(row: ClubRow, rng: Rng): PresidentPromise {
  const weights: [PresidentPromise, number][] = [
    ["star signing", row.fan_mood < 50 ? 3 : 1.5],
    ["balance the books", row.balance < 0 ? 3 : 1],
    ["academy pathway", 1.2],
    ["stadium", 0.8],
  ];
  let roll = rng() * weights.reduce((total, [, weight]) => total + weight, 0);
  for (const [promise, weight] of weights) if ((roll -= weight) <= 0) return promise;
  return "star signing";
}

const PROMISE_TEXT: Record<PresidentPromise, string> = {
  continuity: "continuity",
  "star signing": "a marquee signing",
  "balance the books": "balanced books",
  "academy pathway": "an academy-first pathway",
  stadium: "stadium investment",
};

async function callElection(pass: Pass, row: ClubRow) {
  const { rng } = pass;
  const data = parse<OwnershipData>(row.data, {});
  const incumbent = Boolean(row.president) && (data.presidentTerms ?? 1) < 3 && rng() < 0.85;
  const candidates: Campaign["candidates"] = incumbent ? [{ name: row.president!, promise: "continuity", incumbent: true }] : [];
  for (let index = 0, count = 1 + (incumbent ? 0 : 1) + (rng() < 0.4 ? 1 : 0); index < count; index++)
    candidates.push({ name: personName(rng, row.code), promise: campaignPromise(row, rng), incumbent: false });
  const campaign: Campaign = { date: row.next_election!, candidates };
  await setOwnershipData(pass.store, row.club_id, { ...data, election: campaign });
  const field = candidates.map((candidate) => `${candidate.name}${candidate.incumbent ? " (president)" : ""}, promising ${PROMISE_TEXT[candidate.promise]}`).join("; ");
  if (row.club_id === pass.state.clubId)
    await news(pass.store, "Board", `Presidential election at ${row.name} on ${campaign.date}`, `The members vote for the club's president on ${campaign.date}. Candidates: ${field}. A new president may review the sporting director.`, "important", "board", { ownership: { clubId: row.club_id, stage: "election" } });
  else if (notable(row)) world(pass, row, `${row.name} presidential election called`, `${row.name}'s members vote on ${campaign.date}. Candidates: ${field}.`, { kind: "election" });
}

async function holdElection(pass: Pass, row: ClubRow) {
  const { store, state, rng } = pass;
  const data = parse<OwnershipData>(row.data, {});
  const campaign = data.election ?? { date: state.date, candidates: [{ name: personName(rng, row.code), promise: campaignPromise(row, rng), incumbent: false }] };
  const weights = campaign.candidates.map((candidate) =>
    (candidate.incumbent
      ? clamp(1 + (row.fan_mood - 50) / 40 + (row.board_confidence - 50) / 50, 0.2, 3)
      : between(rng, 0.6, 1.4) + (candidate.promise === "star signing" && row.fan_mood < 50 ? 0.3 : 0) + (candidate.promise === "balance the books" && row.balance < 0 ? 0.4 : 0)) *
    between(rng, 0.7, 1.3),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const results = campaign.candidates.map((candidate, index) => ({ ...candidate, share: Math.round((weights[index] / total) * 1000) / 10 }));
  const winner = results.reduce((best, candidate) => (candidate.share > best.share ? candidate : best));
  const term = data.termYears ?? termYears(row.code);
  await store.run(
    "UPDATE club_ownership SET president = ?, next_election = ?, data = ? WHERE club_id = ?",
    winner.name,
    addDays(state.date, term * 365),
    JSON.stringify({
      ...data,
      election: undefined,
      termYears: term,
      presidentSince: winner.incumbent ? data.presidentSince : state.date,
      presidentTerms: winner.incumbent ? (data.presidentTerms ?? 1) + 1 : 1,
      promise: winner.promise,
      ...(winner.promise === "academy pathway" ? { policyHint: "youth" } : winner.promise === "star signing" ? { policyHint: "stars" } : winner.promise === "balance the books" ? { policyHint: "value" } : {}),
    } satisfies OwnershipData),
    row.club_id,
  );
  const ambition = { continuity: 0, "star signing": 8, "balance the books": -6, "academy pathway": 0, stadium: 3 }[winner.promise];
  if (ambition) await store.run("UPDATE owners SET ambition = LEAST(99, GREATEST(1, ambition + ?)) WHERE id = ?", ambition, row.owner_id);
  if (winner.promise === "star signing")
    await store.run("UPDATE clubs SET transfer_budget = transfer_budget + GREATEST(0, balance) * 0.1 WHERE id = ?", row.club_id);
  else if (winner.promise === "balance the books")
    await store.run("UPDATE clubs SET transfer_budget = round(transfer_budget * 0.7) WHERE id = ?", row.club_id);
  event(pass, row, "election", { winner: winner.name, incumbent: winner.incumbent, promise: winner.promise, results });
  changed();
  const line = results.map((candidate) => `${candidate.name} ${candidate.share}%`).join(", ");
  const body = winner.incumbent
    ? `${winner.name} has been re-elected president of ${row.name} (${line}).`
    : `${winner.name} is the new president of ${row.name} after promising ${PROMISE_TEXT[winner.promise]} (${line}).`;
  if (row.club_id === state.clubId) {
    const review = winner.incumbent ? undefined : await startReview(pass, row, winner.name, row.ambition + ambition, "election");
    await news(store, "Board", `${row.name} election: ${winner.name} ${winner.incumbent ? "re-elected" : "wins"}`, review ? `${body} The new president will review your work on ${review.due}: board confidence of at least ${review.target} keeps you in post.` : body, "important", "board", { ownership: { clubId: row.club_id, stage: "election_result" } });
  } else if (notable(row)) world(pass, row, `${row.name}: ${winner.name} ${winner.incumbent ? "re-elected" : "elected"} president`, body, { kind: "election" });
}

/** A motion of censure: members force an early election when results and the mood collapse. */
async function snapElection(pass: Pass, row: ClubRow) {
  const date = addDays(pass.state.date, 35);
  await pass.store.run("UPDATE club_ownership SET next_election = ? WHERE club_id = ?", date, row.club_id);
  event(pass, row, "election_called", { date, reason: "motion of censure" });
  const body = `A motion of censure has forced an early presidential election at ${row.name} on ${date}.`;
  if (row.club_id === pass.state.clubId) await news(pass.store, "Board", `Early election called at ${row.name}`, body, "important", "board", { ownership: { clubId: row.club_id, stage: "election" } });
  else if (notable(row)) world(pass, row, `Early election at ${row.name}`, body, { kind: "election" });
}

/**
 * Before UEFA's deadline (1 March) a group with two clubs in European contention may place the weaker one in a
 * blind trust (no influence, no transfers between them), so both can enter the same competition.
 */
async function structureBlindTrusts(pass: Pass) {
  const { store, state, rng } = pass;
  const rows = await store.all<{ club_id: number; owner_id: number; owner_name: string; owner_data: string; name: string; reputation: number; position: number }>(
    `WITH positions AS (
       SELECT standings.club_id, rank() OVER (PARTITION BY standings.league_id, standings.group_name
         ORDER BY standings.points DESC, standings.gf - standings.ga DESC, standings.gf DESC) AS position
       FROM standings JOIN leagues ON leagues.id = standings.league_id JOIN countries ON countries.id = leagues.country_id
       WHERE leagues.kind = 'league' AND leagues.tier = 1 AND leagues.age_group = 'Senior' AND countries.confederation = 'UEFA')
     SELECT ownership.club_id, ownership.owner_id, owners.name AS owner_name, owners.data AS owner_data, clubs.name,
       clubs.reputation, positions.position
     FROM club_ownership AS ownership JOIN owners ON owners.id = ownership.owner_id
     JOIN clubs ON clubs.id = ownership.club_id JOIN positions ON positions.club_id = ownership.club_id
     WHERE NOT ownership.member_owned AND ownership.stake >= ? AND NOT ownership.blind_trust AND positions.position <= 7
     ORDER BY ownership.owner_id, positions.position, clubs.reputation DESC, ownership.club_id`,
    CONTROL_STAKE,
  );
  const byOwner = new Map<number, typeof rows>();
  for (const row of rows) byOwner.set(row.owner_id, [...(byOwner.get(row.owner_id) ?? []), row]);
  for (const clubs of byOwner.values()) {
    if (clubs.length < 2) continue;
    const readiness = Number(parse<{ blindTrust?: number }>(clubs[0].owner_data, {}).blindTrust ?? 0.5);
    for (const row of clubs.slice(1)) {
      if (rng() >= readiness) continue;
      await store.run("UPDATE club_ownership SET blind_trust = true WHERE club_id = ?", row.club_id);
      event(pass, row, "blind_trust", { season: state.season, sister: clubs[0].club_id, owner: row.owner_name });
      const body = `${row.owner_name} has placed its stake in ${row.name} in a blind trust ahead of UEFA's multi-club deadline, so it can enter the same competition as ${clubs[0].name}. No transfers or loans between the two clubs while it lasts.`;
      if (row.club_id === state.clubId || clubs[0].club_id === state.clubId)
        await news(store, "Board", `${row.name} placed in a blind trust`, body, "important", "board", { ownership: { clubId: row.club_id, stage: "blind_trust" } });
      else world(pass, row, `${row.name} placed in a blind trust`, body, { kind: "uefa" });
    }
  }
  changed();
}

async function resolveReview(pass: Pass, review: Review) {
  const { store, state } = pass;
  const club = await store.get<{ name: string; board_confidence: number }>("SELECT name, board_confidence FROM clubs WHERE id = ?", review.clubId);
  delete pass.meta.review;
  if (!club || review.clubId !== state.clubId || state.gameOver) return;
  const confirmed = club.board_confidence >= review.target;
  pass.events.push({ date: state.date, club_id: review.clubId, kind: "director_review", from_owner_id: null, to_owner_id: null, data: JSON.stringify({ stage: confirmed ? "confirmed" : "dismissed", confidence: Math.round(club.board_confidence), target: review.target }) });
  if (confirmed) {
    await news(store, "Board", `${review.ownerName} back you`, `The review is complete: with board confidence at ${Math.round(club.board_confidence)} (target ${review.target}) ${review.ownerName} confirm you as sporting director of ${club.name}.`, "success", "board");
    return;
  }
  const latest = await stateOf(store);
  latest.gameOver = true;
  await store.setMeta("state", latest);
  await news(
    store,
    "Board",
    `${review.ownerName} end your tenure`,
    `The review is complete: board confidence stood at ${Math.round(club.board_confidence)} against the target of ${review.target} set ${daysBetween(review.started, state.date)} days ago, and ${review.ownerName} have appointed their own sporting director. Your career record remains available, and you can accept a new role at another club from Career settings.`,
    "warning",
    "settings",
  );
}

async function ownershipRows(store: Store, clubId?: number) {
  return store.all<ClubRow>(
    `SELECT ownership.club_id, ownership.owner_id, ownership.stake, ownership.since, ownership.member_owned, ownership.president,
       ownership.next_election, ownership.data, clubs.name, clubs.city, clubs.reputation, clubs.balance, clubs.board_confidence,
       clubs.fan_mood, clubs.expectations, clubs.transfer_budget, countries.code, countries.region AS capital, leagues.tier,
       owners.name AS owner_name, owners.type, owners.wealth, owners.ambition, owners.patience, owners.data AS owner_data
     FROM club_ownership AS ownership JOIN clubs ON clubs.id = ownership.club_id JOIN countries ON countries.id = clubs.country_id
     LEFT JOIN leagues ON leagues.id = clubs.league_id JOIN owners ON owners.id = ownership.owner_id
     ${clubId === undefined ? "" : "WHERE ownership.club_id = ?"}
     ORDER BY ownership.club_id`,
    ...(clubId === undefined ? [] : [clubId]),
  );
}

/** Owners able to buy more clubs: every controlling owner with its clubs' countries and best reputation. */
function investorsOf(rows: readonly ClubRow[]) {
  const investors = new Map<number, Investor>();
  for (const row of rows) {
    if (row.member_owned || row.stake < CONTROL_STAKE) continue;
    const investor = investors.get(row.owner_id) ?? { ownerId: row.owner_id, name: row.owner_name, type: row.type, ambition: row.ambition, wealth: row.wealth, clubs: 0, countries: new Set<string>(), flagship: 0 };
    investor.clubs++;
    investor.countries.add(row.code);
    investor.flagship = Math.max(investor.flagship, row.reputation);
    investors.set(row.owner_id, investor);
  }
  return [...investors.values()];
}

async function gulfCountries(store: Store) {
  const ids = new Map(
    (await store.all<{ id: number; code: string }>("SELECT id, code FROM countries WHERE code = ANY(?::text[])", Object.keys(GULF_CAPITALS))).map((row) => [row.code, row.id]),
  );
  return Object.keys(GULF_CAPITALS).map((code) => ({ code, id: ids.get(code) ?? null }));
}

async function flush(pass: Pass) {
  await pass.store.bulkInsert("ownership_events", pass.events);
  await worldNewsBatch(pass.store, pass.world);
  pass.events = [];
  pass.world = [];
}

/**
 * Opens a sale of a club now (rumour stage; bid and completion follow on their own dates): an owner forced to sell,
 * e.g. by administrators. Members' clubs under 50+1/51% only take a minority investor. Null if a sale is running.
 */
export async function startSale(store: Store, clubId: number, random: seedrandom.PRNG) {
  if (!(await ownershipMeta(store))) await ensureOwnership(store);
  const meta = await ownershipMeta(store);
  const [row] = await ownershipRows(store, clubId);
  if (!meta || !row || parse<OwnershipData>(row.data, {}).deal) return null;
  const pass: Pass = { store, state: await stateOf(store), rng: random, meta, world: [], events: [], names: new Set(), gulf: await gulfCountries(store) };
  for (const owner of await store.all<{ name: string }>("SELECT name FROM owners")) pass.names.add(owner.name);
  await startDeal(pass, row, investorsOf(await ownershipRows(store)));
  await flush(pass);
  changed();
  return parse<OwnershipData>((await store.get<{ data: string }>("SELECT data FROM club_ownership WHERE club_id = ?", clubId))!.data, {}).deal ?? null;
}

async function weeklyOwnership(pass: Pass) {
  const { state, rng } = pass;
  const rows = await ownershipRows(pass.store);
  for (const row of rows) pass.names.add(row.owner_name);
  const investors = investorsOf(rows);
  const candidates: ClubRow[] = [];
  for (const row of rows) {
    const data = parse<OwnershipData>(row.data, {});
    if (data.deal) {
      await advanceDeal(pass, row, data.deal);
      continue;
    }
    if (row.member_owned && row.next_election) {
      if (row.next_election <= state.date) {
        await holdElection(pass, row);
        continue;
      }
      if (!data.election && row.next_election <= addDays(state.date, 28)) await callElection(pass, row);
      else if (
        !data.election &&
        row.fan_mood < 25 &&
        row.board_confidence < 25 &&
        row.next_election > addDays(state.date, 60) &&
        daysBetween(data.presidentSince ?? row.since, state.date) >= 365 &&
        rng() < 0.03
      ) {
        await snapElection(pass, row);
        continue;
      }
    }
    const rate = saleRate(row, data, state.date);
    if (rate > 0 && rng() < 1 - (1 - rate) ** (1 / 52)) candidates.push(row);
  }
  for (const row of candidates.slice(0, MAX_NEW_DEALS)) await startDeal(pass, row, investors);
  const march = `${state.season + 1}-03-01`;
  if (pass.meta.blindTrustSeason !== state.season && state.date >= addDays(march, -14) && state.date <= march) {
    await structureBlindTrusts(pass);
    pass.meta.blindTrustSeason = state.season;
  }
}

/** Daily ownership step (advance): weekly market for clubs, elections and blind trusts; the director's review daily. */
export async function ownershipDaily(store: Store, state: GameState, random: seedrandom.PRNG) {
  let meta = await ownershipMeta(store);
  if (!meta && (await ensureOwnership(store))) meta = await ownershipMeta(store);
  if (!meta) return;
  const before = JSON.stringify(meta);
  const pass: Pass = { store, state, rng: random, meta, world: [], events: [], names: new Set(), gulf: [] };
  if (meta.review && (meta.review.clubId !== state.clubId || state.date >= meta.review.due)) await resolveReview(pass, meta.review);
  else if (meta.review && daysBetween(state.date, meta.review.due) === 30) {
    const club = await store.get<{ board_confidence: number }>("SELECT board_confidence FROM clubs WHERE id = ?", state.clubId);
    await news(store, "Board", "Owners' review in 30 days", `${meta.review.ownerName} will review your work on ${meta.review.due}. Board confidence is ${Math.round(club?.board_confidence ?? 0)}; the target is ${meta.review.target}.`, "important", "board", { ownership: { clubId: state.clubId, stage: "review" } });
  }
  if (!meta.lastWeekly || daysBetween(meta.lastWeekly, state.date) >= 7) {
    pass.gulf = await gulfCountries(store);
    await weeklyOwnership(pass);
    meta.lastWeekly = state.date;
  }
  await flush(pass);
  if (JSON.stringify(meta) !== before) await store.setMeta(META, meta);
}

/** UEFA senior club competitions under the multi-club integrity rule. */
const UEFA_CLUB_COMPETITIONS = CONTINENTAL.competitions.filter(
  (competition) => competition.confederation === "UEFA" && competition.age === "Senior" && competition.kind === "club" && !competition.feeder,
);

export interface MultiClubEntrant {
  competition: string;
  clubId: number;
  domesticPosition: number;
  associationRank: number;
}

/**
 * UEFA multi-club rule (Art. 5 of the competition regulations): two clubs under common control may not play in the
 * same UEFA competition. A club placed in a blind trust before the deadline is independent; otherwise the club
 * with the better domestic league position (then the better-ranked association) keeps its place and the other is
 * excluded, its place going to the next eligible club. Records each application once per season.
 */
export async function multiClubExclusions(store: Store, season: number, entrants: readonly MultiClubEntrant[]): Promise<Set<number>> {
  const excluded = new Set<number>();
  const relevant = entrants.filter((entry) => UEFA_CLUB_COMPETITIONS.some((competition) => competition.id === entry.competition));
  if (relevant.length < 2) return excluded;
  const control = new Map(
    (
      await store.all<{ club_id: number; owner_id: number; blind_trust: boolean; owner_name: string; name: string }>(
        `SELECT ownership.club_id, ownership.owner_id, ownership.blind_trust, owners.name AS owner_name, clubs.name
         FROM club_ownership AS ownership JOIN owners ON owners.id = ownership.owner_id JOIN clubs ON clubs.id = ownership.club_id
         WHERE ownership.club_id = ANY(?::integer[]) AND NOT ownership.member_owned AND ownership.stake >= ?`,
        [...new Set(relevant.map((entry) => entry.clubId))],
        CONTROL_STAKE,
      )
    ).map((row) => [row.club_id, row]),
  );
  const applications: { clubId: number; kind: "uefa_exclusion" | "uefa_blind_trust"; competition: string; sister: number }[] = [];
  for (const competition of UEFA_CLUB_COMPETITIONS) {
    const byOwner = new Map<number, MultiClubEntrant[]>();
    for (const entry of relevant)
      if (entry.competition === competition.id && control.has(entry.clubId)) {
        const owner = control.get(entry.clubId)!.owner_id;
        byOwner.set(owner, [...(byOwner.get(owner) ?? []), entry]);
      }
    for (const clubs of byOwner.values()) {
      if (new Set(clubs.map((entry) => entry.clubId)).size < 2) continue;
      const ranked = [...clubs].sort(
        (left, right) =>
          (left.domesticPosition || 99) - (right.domesticPosition || 99) || left.associationRank - right.associationRank || left.clubId - right.clubId,
      );
      const open = ranked.filter((entry) => !control.get(entry.clubId)!.blind_trust);
      for (const entry of ranked)
        if (control.get(entry.clubId)!.blind_trust)
          applications.push({ clubId: entry.clubId, kind: "uefa_blind_trust", competition: competition.id, sister: ranked.find((other) => other.clubId !== entry.clubId)!.clubId });
      for (const entry of open.slice(1)) {
        excluded.add(entry.clubId);
        applications.push({ clubId: entry.clubId, kind: "uefa_exclusion", competition: competition.id, sister: open[0].clubId });
      }
    }
  }
  if (!applications.length) return excluded;
  const recorded = new Set(
    (
      await store.all<{ club_id: number; kind: string }>(
        "SELECT club_id, kind FROM ownership_events WHERE kind IN ('uefa_exclusion', 'uefa_blind_trust') AND data::jsonb ->> 'season' = ?",
        String(season),
      )
    ).map((row) => `${row.kind}:${row.club_id}`),
  );
  const state = await stateOf(store);
  const fresh = applications.filter((entry) => !recorded.has(`${entry.kind}:${entry.clubId}`));
  const names = new Map<number, string>([...control.values()].map((row) => [row.club_id, row.name]));
  const items: WorldNewsInput[] = [];
  for (const entry of fresh) {
    const owner = control.get(entry.clubId)!.owner_name;
    const competition = CONTINENTAL.competitions.find((item) => item.id === entry.competition)?.name ?? entry.competition;
    const title =
      entry.kind === "uefa_exclusion"
        ? `${names.get(entry.clubId)} excluded from the ${competition}`
        : `${names.get(entry.clubId)} cleared for the ${competition}`;
    const body =
      entry.kind === "uefa_exclusion"
        ? `UEFA's multi-club rule: ${owner} controls both ${names.get(entry.clubId)} and ${names.get(entry.sister)}, which finished higher. ${names.get(entry.clubId)} lose their ${seasonLabel(season)} place to the next eligible club.`
        : `The blind trust structured before the deadline satisfies UEFA: ${names.get(entry.clubId)} and ${names.get(entry.sister)} (both linked to ${owner}) may play in the ${competition} in ${seasonLabel(season)}.`;
    if (entry.clubId === state.clubId || entry.sister === state.clubId)
      await news(store, "Board", title, body, entry.kind === "uefa_exclusion" ? "warning" : "important", "board", { ownership: { clubId: entry.clubId, stage: entry.kind } });
    items.push({ kind: "ownership", title, body, clubIds: [entry.clubId, entry.sister], date: state.date, data: { ownership: true, kind: "uefa" } });
  }
  await store.bulkInsert(
    "ownership_events",
    fresh.map((entry) => ({
      date: state.date,
      club_id: entry.clubId,
      kind: entry.kind,
      from_owner_id: null,
      to_owner_id: control.get(entry.clubId)!.owner_id,
      data: JSON.stringify({ season, competition: entry.competition, sister: entry.sister }),
    })),
  );
  await worldNewsBatch(store, items);
  return excluded;
}
