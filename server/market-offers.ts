import seedrandom from "seedrandom";
import { Store } from "./db.ts";
import { clubPolicySnapshot, plannedWageBudget, TARGET_DEPTH } from "./club-policy.ts";
import { signingHeadroomCost, transferEmbargo } from "./finance.ts";
import { publishTransferStory } from "./media.ts";
import { canSign, eligibilitySummaries, predictRegistration } from "./eligibility.ts";
import { registrationAssociationId } from "./registration.ts";
import { assessPlayerInterest, assessYouthTransfer, marketMoveInterest, personalTermsWage } from "./recruitment.ts";
import {
  closeNegotiation,
  defaultLoanTerms,
  fitsWageBudget,
  internationalLoanIssue,
  loanBorrowerWillingness,
  loanEndDate,
  loanTermsIssue,
  MIN_LOAN_SALARY_SPLIT,
  news,
  SEASON_MINUTES,
  settingsOf,
  weeklyWages,
} from "./systems.ts";
import {
  addDays,
  clamp,
  daysBetween,
  FORMATION_POSITIONS,
  LOAN_TYPES,
  money,
  tacticalFit,
  transferWindow,
  winterWindowClose,
} from "../shared/rules.ts";
import { blocking } from "../shared/eligibility.ts";
import type {
  Club,
  GameState,
  LoanTerms,
  Negotiation,
  NegotiationData,
  OfferReason,
  Player,
  PlayerProfile,
  Settings,
} from "../shared/types.ts";

/** settings.marketOfferFrequency: how often AI clubs approach the director about his players. */
export type OfferFrequency = "low" | "medium" | "high";

export interface FrequencyProfile {
  /** Relevant approaches per open-window week when the market supports them (a target, never a cap on demand). */
  weekly: number;
  /** Most new approaches on one day. */
  dailyMax: number;
  /** Most open approaches for one player at a time (above one, clubs compete for him). */
  perPlayer: number;
  /** Most open approaches from one club to the director at a time. */
  perClub: number;
  /** Daily interest in an unlisted key player (a premium bid of 115-130% of his value). */
  keyPlayerBids: number;
}

/**
 * Medium is calibrated to about five relevant approaches per window week, the volume a mid-sized club's director
 * handles when he has surplus or listed players. Low (0.4x) keeps only the clearest needs; High (1.8x) is a busy
 * agent network where several clubs can compete for the same player and unlisted stars draw occasional premium bids.
 * The supply of relevant player/club pairs caps every level: no approach is invented when no club needs the player.
 */
export const OFFER_FREQUENCIES: Record<OfferFrequency, FrequencyProfile> = {
  low: { weekly: 2, dailyMax: 1, perPlayer: 1, perClub: 1, keyPlayerBids: 0 },
  medium: { weekly: 5, dailyMax: 2, perPlayer: 2, perClub: 2, keyPlayerBids: 0.08 },
  high: { weekly: 9, dailyMax: 3, perPlayer: 3, perClub: 2, keyPlayerBids: 0.25 },
};

export function offerFrequency(settings: Settings): OfferFrequency {
  const value = settings.marketOfferFrequency;
  return value === "low" || value === "high" ? value : "medium";
}

/** Days an accepted approach needs before registration: agent talks, contract, medical (2 days) and registration. */
export const DEAL_PIPELINE_DAYS = 6;
/** Clubs line up pre-agreements this many days before a window opens; they register on the opening day. */
export const PRE_WINDOW_DAYS = 10;
/** The same club does not come back for the same player this soon after an approach. */
export const PAIR_COOLDOWN_DAYS = 42;
/** Interest points of slack an approach keeps above the personal-terms bar (see personalTermsWage). */
const PERSONAL_TERMS_MARGIN = 5;
/** Share of a club's remaining wage room one approach may use, leaving room for the rest of its market. */
const WAGE_ROOM_SHARE = 0.85;
const MAX_SENIORS = 28;
const MOVE_INTEREST_FLOOR = 52;
const MAX_VALIDATIONS = 14;

const NOMINAL_LOAN_TERMS = {
  playingTime: 55,
  role: "Squad player",
  mandatoryMinutes: 0,
  optionFee: 0,
  recall: true,
  injuryRecall: true,
};

const OPEN_STAGES = ["Enquiry", "Club talks", "Agent talks", "Contract review", "Scheduled", "Medical", "Registration", "Offer received"];

export interface MarketPhase {
  kind: "window" | "pre-window" | "closed";
  /** Multiplier on the weekly target: run-in to deadline day, quieter pre-agreements, emergency loans only. */
  multiplier: number;
  /** First day of the current or next window. */
  opens: string;
  /** Last day of the current or next window. */
  closes: string;
  /** Days since this phase began (caps the catch-up of the first days). */
  elapsed: number;
}

function windowFor(date: string) {
  const year = Number(date.slice(0, 4));
  const monthDay = date.slice(5);
  if (transferWindow(date))
    return monthDay >= "06-15"
      ? { opens: `${year}-06-15`, closes: `${year}-09-01` }
      : { opens: `${year}-01-01`, closes: winterWindowClose(year) };
  return monthDay < "06-15"
    ? { opens: `${year}-06-15`, closes: `${year}-09-01` }
    : { opens: `${year + 1}-01-01`, closes: winterWindowClose(year + 1) };
}

/**
 * Where `date` sits in the registration calendar for approaches. Window approaches stop DEAL_PIPELINE_DAYS before
 * deadline day so that an accepted offer still registers in the window; just before a window opens, clubs make
 * pre-agreements that register on the opening day; between windows only emergency loans (domestic, at a club with
 * three or more unavailable seniors) are possible.
 */
export function marketPhase(date: string): MarketPhase {
  const { opens, closes } = windowFor(date);
  if (transferWindow(date)) {
    const lastOffer = addDays(closes, -DEAL_PIPELINE_DAYS - 1);
    if (date <= lastOffer)
      return {
        kind: "window",
        multiplier: daysBetween(date, lastOffer) < 14 ? 1.25 : 1,
        opens,
        closes,
        elapsed: daysBetween(opens, date),
      };
    return { kind: "closed", multiplier: 0.15, opens, closes, elapsed: 7 };
  }
  const until = daysBetween(date, opens);
  if (until <= PRE_WINDOW_DAYS)
    return { kind: "pre-window", multiplier: 0.5, opens, closes, elapsed: PRE_WINDOW_DAYS - until };
  return { kind: "closed", multiplier: 0.15, opens, closes, elapsed: 7 };
}

/**
 * New approaches today: the week's target spread evenly (fractional days carried by `random`), corrected by half the
 * gap between the approaches of the last six days and the target for them (days without a viable match are made up
 * later, busy days are followed by quieter ones), never more than the daily maximum or 120% of the weekly target in
 * a rolling week.
 */
export function dailyOfferQuota(input: { weekly: number; dailyMax: number; recent: number; elapsed: number; random: number }) {
  if (input.weekly <= 0) return 0;
  const rate = input.weekly / 7;
  const expected = (input.weekly * clamp(input.elapsed, 0, 6)) / 7;
  const room = Math.max(0, Math.ceil(input.weekly * 1.2) - input.recent);
  return Math.max(0, Math.min(input.dailyMax, room, Math.floor(rate + (expected - input.recent) / 2 + input.random)));
}

type Kind = "transfer" | "loan";

interface Candidate {
  player: Player;
  profile: PlayerProfile;
  kind: Kind;
  weight: number;
  /** Rank by ability among the director's seniors in the player's position (99 for youth squads). */
  rank: number;
  key: boolean;
  surplus: boolean;
  development: boolean;
  unregistered: boolean;
  expiring: boolean;
}

interface PositionStats {
  depth: number;
  best: number;
  second: number;
  injured: number;
}

interface Demand {
  club: Club;
  level: number;
  seniors: number;
  injuredSeniors: number;
  positions: Map<string, PositionStats>;
  transferRoom: number;
  /** The weekly wage budget as the world market plans it (club-policy.ts plannedWageBudget). */
  wageBudget: number;
  wageRoom: number;
  wages: number;
  openApproaches: number;
  /** Annual squad cost the club may still add under its FFP limit (Infinity when enforcement is off). */
  ffpHeadroom: number;
  /** Share of a fee that also uses the headroom (finance.ts signingHeadroomCost). */
  feeCashShare: number;
}

interface Pair {
  demand: Demand;
  score: number;
  rankAt: number;
  gap: number;
  injuryCover: boolean;
}

/** Players the director signed who are not registered to play competitive football: natural loan targets. */
async function unregisteredPlayers(store: Store, players: readonly Player[]) {
  const summaries = await eligibilitySummaries(store, players);
  return new Set(
    players
      .filter((player) => ["not_registered", "ineligible_gbe"].includes(summaries.get(player.id)?.label ?? "eligible"))
      .map((player) => player.id),
  );
}

const roundTo = (value: number, step: number) => Math.round(value / step) * step;
const floorTo = (value: number, step: number) => Math.floor(value / step) * step;

function pickWeighted<T>(items: T[], weight: (item: T) => number, random: () => number) {
  const total = items.reduce((sum, item) => sum + Math.max(0, weight(item)), 0);
  if (total <= 0) return -1;
  let target = random() * total;
  for (let index = 0; index < items.length; index++) {
    target -= Math.max(0, weight(items[index]));
    if (target <= 0) return index;
  }
  return items.length - 1;
}

/** The director's players clubs could approach today, with how strongly each is "on the market" for a transfer or loan. */
async function offerSupply(store: Store, state: GameState, frequency: FrequencyProfile) {
  const players = await store.all<Player>(
    "SELECT * FROM players WHERE club_id = ? AND parent_club_id IS NULL AND role != 'Retired' AND age >= 16 AND contract_end > ? ORDER BY id",
    state.clubId,
    state.date,
  );
  if (!players.length) return [];
  const ids = players.map((player) => player.id);
  const busy = new Set(
    (
      await store.all<{ player_id: number }>(
        "SELECT DISTINCT player_id FROM negotiations WHERE player_id = ANY(?::integer[]) AND stage IN ('Enquiry','Club talks','Agent talks','Contract review','Scheduled','Medical','Registration')",
        ids,
      )
    ).map((row) => row.player_id),
  );
  const recentSignings = new Set(
    (
      await store.all<{ entity_id: number }>(
        "SELECT DISTINCT entity_id FROM history WHERE entity_type = 'transfer' AND entity_id = ANY(?::integer[]) AND date >= ?",
        ids,
        addDays(state.date, -365),
      )
    ).map((row) => row.entity_id),
  );
  const recentlyReturned = new Set(
    (
      await store.all<{ player_id: number }>(
        "SELECT DISTINCT player_id FROM loans WHERE player_id = ANY(?::integer[]) AND status <> 'active' AND end_date >= ?",
        ids,
        addDays(state.date, -30),
      )
    ).map((row) => row.player_id),
  );
  const unregistered = await unregisteredPlayers(store, players);
  const seniors = players.filter((player) => player.age_group === "Senior");
  const level = averageTop(seniors.map((player) => player.ability), 14);
  const rankOf = new Map<number, number>();
  for (const position of Object.keys(TARGET_DEPTH)) {
    seniors
      .filter((player) => player.position === position)
      .sort((left, right) => right.ability - left.ability || left.id - right.id)
      .forEach((player, index) => rankOf.set(player.id, index + 1));
  }
  const firstTeamMinutes = averageTop(seniors.map((player) => player.minutes), 11);
  const candidates: Candidate[] = [];
  for (const player of players) {
    if (busy.has(player.id)) continue;
    const injuredDays = player.injury_until ? daysBetween(state.date, player.injury_until) : 0;
    const rank = player.age_group === "Senior" ? (rankOf.get(player.id) ?? 99) : 99;
    const target = TARGET_DEPTH[player.position] ?? 2;
    const key = rank <= Math.max(1, Math.round(target / 2)) && player.ability >= level - 2;
    const surplus = player.age_group === "Senior" && rank > target;
    const lowMinutes = firstTeamMinutes >= 450 && player.minutes < firstTeamMinutes * 0.25;
    const development =
      player.age <= 21 && player.potential - player.ability >= 5 && (rank > 2 || player.age_group !== "Senior");
    const expiring = player.age >= 18 && daysBetween(state.date, player.contract_end) <= 365;
    const isUnregistered = unregistered.has(player.id);
    const base = {
      player,
      profile: JSON.parse(player.profile) as PlayerProfile,
      rank,
      key,
      surplus,
      development,
      unregistered: isUnregistered,
      expiring,
    };
    // Transfers: adults only (minors' moves need FIFA art. 19 clearance first), fit for a medical within 30 days, and
    // no flipping of a recent signing unless the director has listed him.
    if (player.age >= 18 && injuredDays <= 14 && (!recentSignings.has(player.id) || player.listed)) {
      const weight = player.listed
        ? 1
        : player.available_loan
          ? 0.05
          : Math.max(
              expiring ? 0.6 : 0,
              surplus ? 0.45 + (lowMinutes ? 0.15 : 0) : 0,
              key ? frequency.keyPlayerBids : frequency.keyPlayerBids / 3,
            );
      if (weight > 0) candidates.push({ ...base, kind: "transfer", weight });
    }
    // Loans: fit now, not just back from another loan, and only when the player is surplus, developing, unregistered
    // or offered by the director.
    if (injuredDays <= 0 && !recentlyReturned.has(player.id)) {
      const weight = Math.max(
        player.available_loan ? 1 : 0,
        isUnregistered ? 0.9 : 0,
        development && !key ? 0.5 : 0,
        surplus && player.age <= 23 ? 0.4 : 0,
        player.listed && player.age >= 19 ? 0.25 : 0,
      );
      if (weight > 0) candidates.push({ ...base, kind: "loan", weight });
    }
  }
  return candidates;
}

function averageTop(values: number[], count: number) {
  const top = [...values].sort((left, right) => right - left).slice(0, count);
  return top.length ? top.reduce((sum, value) => sum + value, 0) / top.length : 0;
}

/** One snapshot of every other first team's squad depth, level, budgets and wage room (open commitments included). */
async function demandSnapshot(store: Store, state: GameState) {
  const family = (
    await store.all<{ id: number }>("SELECT id FROM clubs WHERE id = ? OR parent_id = ?", state.clubId, state.clubId)
  ).map((club) => club.id);
  const clubs = await store.all<Club>(
    "SELECT * FROM clubs WHERE type = 'club' AND id <> ALL(?::integer[]) ORDER BY id",
    family,
  );
  const levels = new Map(
    (
      await store.all<{ club_id: number; level: number }>(
        "SELECT club_id,avg(ability) AS level FROM (SELECT playing_club_id AS club_id,ability,row_number() OVER (PARTITION BY playing_club_id ORDER BY ability DESC) AS rank FROM players WHERE playing_club_id IS NOT NULL AND age_group = 'Senior' AND role <> 'Retired') AS ranked WHERE rank <= 14 GROUP BY club_id",
      )
    ).map((row) => [row.club_id, row.level]),
  );
  const positions = new Map<number, Map<string, PositionStats>>();
  for (const row of await store.all<{ club_id: number; position: string; depth: number; best: number; second: number | null; injured: number }>(
    "SELECT playing_club_id AS club_id,position,count(*) AS depth,max(ability) AS best,(array_agg(ability ORDER BY ability DESC))[2] AS second,count(*) FILTER (WHERE injury_until > ?) AS injured FROM players WHERE playing_club_id IS NOT NULL AND age_group = 'Senior' AND role <> 'Retired' GROUP BY playing_club_id,position",
    addDays(state.date, 14),
  )) {
    if (!positions.has(row.club_id)) positions.set(row.club_id, new Map());
    positions.get(row.club_id)!.set(row.position, { depth: row.depth, best: row.best, second: row.second ?? 0, injured: row.injured });
  }
  const squads = new Map(
    (
      await store.all<{ club_id: number; seniors: number; injured: number; wages: number }>(
        "SELECT club_id,count(*) FILTER (WHERE age_group = 'Senior' AND role <> 'Retired') AS seniors,count(*) FILTER (WHERE injury_until > ?) AS injured,coalesce(sum(wage),0) AS wages FROM players WHERE club_id IS NOT NULL GROUP BY club_id",
        state.date,
      )
    ).map((row) => [row.club_id, row]),
  );
  const loanShares = new Map<number, number>();
  for (const loan of await store.all<{ parent_id: number; destination_id: number; share: number }>(
    "SELECT loans.parent_id,loans.destination_id,players.wage * (1 - (loans.terms::jsonb ->> 'salarySplit')::double precision / 100.0) AS share FROM loans JOIN players ON players.id = loans.player_id WHERE loans.status = 'active' ORDER BY loans.id",
  )) {
    loanShares.set(loan.parent_id, (loanShares.get(loan.parent_id) ?? 0) + loan.share);
    loanShares.set(loan.destination_id, (loanShares.get(loan.destination_id) ?? 0) - loan.share);
  }
  const committed = new Map<number, { fees: number; wages: number; approaches: number }>();
  for (const deal of await store.all<Negotiation & { player_wage: number }>(
    "SELECT negotiations.*,players.wage AS player_wage FROM negotiations JOIN players ON players.id = negotiations.player_id WHERE negotiations.stage = ANY(?::text[]) AND negotiations.buying_club_id <> ? ORDER BY negotiations.id",
    OPEN_STAGES,
    state.clubId,
  )) {
    const entry = committed.get(deal.buying_club_id) ?? { fees: 0, wages: 0, approaches: 0 };
    const data = JSON.parse(deal.data) as NegotiationData;
    const loan = LOAN_TYPES.includes(deal.type);
    entry.fees += Math.max(0, dealCost(deal, data) - (data.reservedBudget ?? 0));
    entry.wages += loan ? (deal.player_wage * (data.terms?.salarySplit ?? 100)) / 100 : deal.wage;
    if (deal.selling_club_id === state.clubId && deal.stage === "Offer received") entry.approaches++;
    committed.set(deal.buying_club_id, entry);
  }
  const policies = await clubPolicySnapshot(store, state.date);
  const ffp = (await settingsOf(store)).ffp !== false;
  const demand: Demand[] = [];
  for (const club of clubs) {
    const squad = squads.get(club.id);
    const policy = policies.get(club.id);
    // A club under a registration embargo cannot sign anyone.
    if (!squad || policy?.embargo) continue;
    const commitment = committed.get(club.id) ?? { fees: 0, wages: 0, approaches: 0 };
    const wages = squad.wages + (loanShares.get(club.id) ?? 0);
    const wageBudget = plannedWageBudget(club, policy);
    demand.push({
      club,
      level: levels.get(club.id) ?? 0,
      seniors: squad.seniors,
      injuredSeniors: squad.injured,
      positions: positions.get(club.id) ?? new Map(),
      transferRoom: Math.min(club.transfer_budget - commitment.fees, Math.max(0, club.balance)),
      wageBudget,
      wageRoom: wageBudget - wages - commitment.wages,
      wages: wages + commitment.wages,
      openApproaches: commitment.approaches,
      ffpHeadroom: ffp && policy ? policy.ffpHeadroom : Infinity,
      feeCashShare: policy?.feeCashShare ?? 0,
    });
  }
  return demand;
}

/** Upfront cost of a deal for the buyer: fee plus the agent commission (on the fee for loans, a year's wage otherwise). */
function dealCost(deal: Pick<Negotiation, "type" | "offer" | "wage">, data: Pick<NegotiationData, "agent" | "signingBonus">) {
  const loan = LOAN_TYPES.includes(deal.type);
  const commission = data.agent?.commission ?? 0;
  return deal.offer + (data.signingBonus ?? 0) + Math.round(((loan ? deal.offer : deal.wage * 52) * commission) / 100);
}

/** Cheap fit between a candidate and a club: positional need, level, squad room and rough affordability. */
function matchPair(candidate: Candidate, demand: Demand, user: Club, date: string, phase: MarketPhase): Pair | null {
  const { player } = candidate;
  if (demand.seniors >= MAX_SENIORS || !demand.level) return null;
  // Selection fills the club's formation slots: a position it does not field is no need (and no playing time).
  if (!(FORMATION_POSITIONS[demand.club.formation] ?? FORMATION_POSITIONS["4-3-3"]).includes(player.position)) return null;
  const stats = demand.positions.get(player.position) ?? { depth: 0, best: 0, second: 0, injured: 0 };
  const target = TARGET_DEPTH[player.position] ?? 2;
  const available = stats.depth - stats.injured;
  const gap = clamp(target - available, 0, 2);
  const injuryCover = stats.injured > 0 && stats.depth >= target && available < target;
  const rankAt = player.ability > stats.best ? 1 : player.ability > stats.second ? 2 : 3;
  const loan = candidate.kind === "loan";
  // FIFA art. 19: minors move only within their country here.
  if (player.age < 18 && demand.club.country_id !== user.country_id) return null;
  if (phase.kind === "closed") {
    // Emergency loans only: domestic cover for a club with three or more unavailable seniors.
    if (!loan || demand.injuredSeniors < 3 || available >= target || rankAt > 2) return null;
  }
  if (loan) {
    if (player.ability < demand.level - 6 || player.ability > demand.level + 10) return null;
    if (demand.club.reputation > user.reputation + 5) return null;
    if (rankAt > 2 || (gap < 1 && rankAt > 1)) return null;
    if (demand.wageRoom * WAGE_ROOM_SHARE < (player.wage * MIN_LOAN_SALARY_SPLIT) / 100) return null;
    // The borrower's own squad-need test (loanBorrowerWillingness) with a minimal package.
    const willing = loanBorrowerWillingness({
      type: "Standard loan",
      playerValue: player.value,
      playerWage: player.wage,
      playerAbility: player.ability,
      playerAge: player.age,
      borrowerReputation: demand.club.reputation,
      borrowerTransferBudget: Math.max(0, demand.transferRoom),
      borrowerWageBudget: demand.wageBudget,
      borrowerCurrentWages: demand.wages,
      seniorSquadSize: demand.seniors,
      positionCount: stats.depth,
      days: 300,
      fee: 0,
      terms: { ...NOMINAL_LOAN_TERMS, salarySplit: MIN_LOAN_SALARY_SPLIT },
    });
    if (!willing.willing) return null;
  } else {
    if (player.ability < demand.level - 4 || player.ability > demand.level + 12) return null;
    if (gap < 1 && rankAt > 2) return null;
    if (demand.transferRoom < player.value * 0.7 || demand.wageRoom * WAGE_ROOM_SHARE < player.wage) return null;
  }
  // Query-free estimate of the player's interest: personal terms need about 57 before the role and the wage
  // (see personalTermsWage), so clearly unwilling pairs are not priced at all.
  const willing = marketMoveInterest(player, candidate.profile, demand.club, user, date, loan);
  if (willing < MOVE_INTEREST_FLOOR) return null;
  const need = gap + (rankAt === 1 ? 1.5 : rankAt === 2 ? 0.7 : 0) + (injuryCover ? 0.5 : 0);
  const fit = 1 - clamp(Math.abs(player.ability - (demand.level + (loan ? 0 : 3))) / 14, 0, 0.8);
  return { demand, score: need * fit * clamp((willing - 45) / 15, 0.3, 1.5), rankAt, gap, injuryCover };
}

function reasonFor(candidate: Candidate, pair: Pair, extra: { type?: string; role?: string; playingTime?: number }): OfferReason {
  const { player } = candidate;
  const club = pair.demand.club.name;
  const stats = pair.demand.positions.get(player.position);
  const fit = Math.max(0, (stats?.depth ?? 0) - (stats?.injured ?? 0));
  const loan = candidate.kind === "loan";
  const sentences: OfferReason[] = [];
  if (loan && candidate.unregistered)
    sentences.push({
      code: "registration",
      text: `${player.name} is not registered to play competitive matches for you; ${club} can register him and play him.`,
    });
  if (pair.injuryCover)
    sentences.push({ code: "injury-cover", text: `${club} have ${stats?.injured ?? 0} ${player.position} injured and need cover.` });
  if (loan && (candidate.development || player.age <= 21))
    sentences.push({
      code: "development-pathway",
      text: `${club} offer a development pathway: ${extra.role?.toLowerCase()} at ${player.position} with about ${extra.playingTime}% of the minutes.`,
    });
  else if (pair.rankAt === 1 && pair.gap >= 1)
    sentences.push({ code: "starter-need", text: `${club} need a first-choice ${player.position} (${fit} fit senior ${player.position}); he would start.` });
  else if (pair.rankAt === 1)
    sentences.push({ code: "upgrade", text: `${club} see him as an upgrade on their best ${player.position}.` });
  else if (pair.gap >= 1)
    sentences.push({ code: "depth", text: `${club} are short of ${player.position} cover (${fit} fit senior ${player.position}).` });
  else sentences.push({ code: "depth", text: `${club} want competition for places at ${player.position}.` });
  if (extra.type === "Loan with option" || extra.type === "Loan with obligation")
    sentences.push({
      code: "option-to-buy",
      text: `They want ${extra.type === "Loan with option" ? "an option" : "an obligation"} to make the move permanent.`,
    });
  else if (!loan && player.listed) sentences.push({ code: "listed", text: "They responded to your transfer listing." });
  else if (!loan && candidate.expiring) sentences.push({ code: "contract-expiry", text: "His contract ends within a year." });
  return { code: sentences[0].code, text: sentences.slice(0, 2).map((sentence) => sentence.text).join(" ") };
}

interface BuiltOffer {
  type: string;
  fee: number;
  wage: number;
  terms: LoanTerms;
  role: string;
  years: number;
  plannedStart: string;
  deadline: string;
  interestScore: number;
  interestDetails: NegotiationData["interestDetails"];
  reason: OfferReason;
  cost: number;
  addedWage: number;
}

function loanTypeFor(
  candidate: Candidate,
  pair: Pair,
  phase: MarketPhase,
  plannedStart: string,
  international: boolean,
  userReputation: number,
  random: () => number,
) {
  const { player } = candidate;
  const room = pair.demand.transferRoom;
  if (phase.kind === "closed") return "Emergency loan";
  if (plannedStart.slice(5) < "06-01") {
    if (player.age >= 20 && room >= player.value && pair.rankAt === 1 && random() < 0.25) return "Loan with option";
    return random() < 0.5 ? "Short loan" : player.age <= 21 ? "Development loan" : "Standard loan";
  }
  const sellable = player.listed || candidate.surplus || candidate.expiring;
  if (sellable && player.age >= 19 && pair.rankAt === 1 && room >= player.value * 0.9 && random() < 0.35)
    return "Loan with obligation";
  if (player.age >= 20 && room >= player.value && random() < (player.listed ? 0.5 : 0.2)) return "Loan with option";
  if (international) return player.age <= 23 ? "Cross-border loan" : "Standard loan";
  if (player.age <= 21 && pair.rankAt === 1 && random() < 0.15) return "Two-year loan";
  if (player.age <= 20 && userReputation >= pair.demand.club.reputation + 10 && random() < 0.1) return "Loan with sell-on";
  return player.age <= 21 ? "Development loan" : "Standard loan";
}

/**
 * Prices and validates one approach from `pair.demand` for `candidate`, using exactly the checks the deal meets
 * after acceptance (registration, FIFA loan limits, loan rules, the borrower's own valuation, personal terms with a
 * margin, funds and wage room including the club's other open deals). Returns null when any would fail.
 */
async function buildOffer(
  store: Store,
  state: GameState,
  user: Club,
  candidate: Candidate,
  pair: Pair,
  phase: MarketPhase,
  random: () => number,
): Promise<BuiltOffer | null> {
  const { player, profile } = candidate;
  const buyer = pair.demand.club;
  const loan = candidate.kind === "loan";
  const userAssociation = await registrationAssociationId(store, user);
  const international = userAssociation !== (await registrationAssociationId(store, buyer));
  if (phase.kind === "closed" && international) return null;
  if (player.age < 18 && international) return null;
  const plannedStart =
    phase.kind === "pre-window" ? phase.opens : addDays(state.date, phase.kind === "closed" ? 3 : DEAL_PIPELINE_DAYS - 1);
  const deadline =
    phase.kind === "window"
      ? [addDays(state.date, 7), addDays(phase.closes, -DEAL_PIPELINE_DAYS)].sort()[0]
      : phase.kind === "pre-window"
        ? addDays(state.date, 7)
        : addDays(state.date, 3);
  // Contract-layer prerequisites only (never GBE): a pre-window approach registers when the window opens.
  const signing = await canSign(store, player.id, buyer.id, loan ? "loan_in" : "transfer", {
    emergency: phase.kind === "closed",
  });
  if (signing.codes.some((code) => code !== "window" || phase.kind !== "pre-window")) return null;
  if (player.age < 18 && !(await assessYouthTransfer(store, player, buyer)).approved) return null;
  const role = pair.rankAt === 1 ? "Regular starter" : "Squad player";
  if (loan) {
    const type = loanTypeFor(candidate, pair, phase, plannedStart, international, user.reputation, random);
    const terms = defaultLoanTerms(player, buyer);
    terms.duration = type === "Short loan" ? 182 : type === "Two-year loan" ? 730 : type === "Emergency loan" ? 90 : 365;
    const endDate = loanEndDate(type, plannedStart, terms.duration);
    if (endDate > player.contract_end) return null;
    const days = daysBetween(plannedStart, endDate);
    if (international) {
      const limit = await internationalLoanIssue(store, player, user, buyer, state.date);
      if (limit) return null;
    }
    terms.role = type === "Emergency loan" ? "Regular starter" : role;
    terms.playingTime = pair.rankAt === 1 ? (pair.gap >= 1 ? 75 : 65) : 50;
    terms.mandatoryMinutes = floorTo((SEASON_MINUTES * clamp(days / 365, 0.25, 2) * terms.playingTime * 0.5) / 100, 90);
    terms.bonus = 0;
    // Guarantees the borrower can keep through small changes before registration (negotiate() enforces them).
    terms.tacticalFit = Math.max(0, Math.floor(tacticalFit(player, buyer)) - 5);
    terms.managerTrust = clamp(Math.floor(buyer.manager_trust) - 10, 0, 60);
    terms.recall = !["Loan with option", "Loan with obligation", "Emergency loan"].includes(type);
    terms.injuryRecall = true;
    terms.sellOn = type === "Loan with sell-on" ? roundTo(10 + random() * 10, 5) : 0;
    terms.relationship =
      (
        await store.get<{ strength: number }>(
          "SELECT strength FROM partnerships WHERE (club_id = ? AND partner_id = ?) OR (club_id = ? AND partner_id = ?) ORDER BY id",
          user.id,
          buyer.id,
          buyer.id,
          user.id,
        )
      )?.strength ?? 50;
    const wageCapSplit = floorTo(((pair.demand.wageRoom * WAGE_ROOM_SHARE) / Math.max(1, player.wage)) * 100, 5);
    const wantedSplit = pair.rankAt === 1 ? 80 : 60;
    terms.salarySplit = clamp(Math.min(wantedSplit + roundTo(random() * 20 - 10, 5), wageCapSplit, 100), 0, 100);
    if (terms.salarySplit < MIN_LOAN_SALARY_SPLIT) return null;
    terms.obligationCondition =
      type === "Loan with obligation"
        ? buyer.reputation < 55 || buyer.crisis >= 40
          ? "Avoid relegation"
          : random() < 0.5
            ? "Minutes played"
            : "Unconditional"
        : "Unconditional";
    const willingnessInput = {
      type,
      playerValue: player.value,
      playerWage: player.wage,
      playerAbility: player.ability,
      playerAge: player.age,
      borrowerReputation: buyer.reputation,
      borrowerTransferBudget: Math.max(0, pair.demand.transferRoom),
      borrowerWageBudget: pair.demand.wageBudget,
      borrowerCurrentWages: pair.demand.wages,
      seniorSquadSize: pair.demand.seniors,
      positionCount: pair.demand.positions.get(player.position)?.depth ?? 0,
      days,
      fee: 0,
      terms,
    };
    const valuation = loanBorrowerWillingness(willingnessInput);
    if (type === "Loan with option")
      terms.optionFee = Math.min(
        valuation.maximumOptionFee,
        roundTo(player.value * (1.05 + random() * 0.15), 10_000),
      );
    else if (type === "Loan with obligation")
      terms.optionFee = Math.min(valuation.maximumOptionFee, roundTo(player.value * (0.95 + random() * 0.1), 10_000));
    else terms.optionFee = 0;
    if (type === "Loan with obligation" && pair.demand.transferRoom < terms.optionFee) return null;
    terms.fee = floorTo(valuation.maximumFee * (0.75 + random() * 0.15), 1_000);
    const issue = loanTermsIssue({ type, value: player.value, days, international }, terms);
    if (issue) return null;
    // The borrower's own valuation of this exact package: a counter at the same terms is always accepted.
    const willing = loanBorrowerWillingness({ ...willingnessInput, fee: terms.fee, terms });
    if (!willing.willing) return null;
    const commission = profile.agent?.commission ?? 0;
    const cost = terms.fee + Math.round((terms.fee * commission) / 100);
    if (cost > pair.demand.transferRoom || transferEmbargo(buyer.balance, terms.fee)) return null;
    const addedWage = (player.wage * terms.salarySplit) / 100;
    if (addedWage > pair.demand.wageRoom * WAGE_ROOM_SHARE) return null;
    if (addedWage * 52 * (days / 365) + terms.fee * (1 + pair.demand.feeCashShare) > pair.demand.ffpHeadroom) return null;
    const preview = await assessPlayerInterest(store, player, buyer, {
      loan: true,
      role: terms.role,
      years: player.age < 18 ? 3 : 4,
      promises: [],
      playingTime: terms.playingTime,
      tension: 0,
    });
    if (personalTermsWage(preview, PERSONAL_TERMS_MARGIN) === null) return null;
    return {
      type,
      fee: terms.fee,
      wage: player.wage,
      terms,
      role: terms.role,
      years: player.age < 18 ? 3 : 4,
      plannedStart,
      deadline,
      interestScore: preview.score,
      interestDetails: preview,
      reason: reasonFor(candidate, pair, { type, role: terms.role, playingTime: terms.playingTime }),
      cost,
      addedWage,
    };
  }
  const years = player.age >= 31 ? 2 : player.age >= 29 ? 3 : 4;
  const preview = await assessPlayerInterest(store, player, buyer, { loan: false, role, years, promises: [], tension: 0 });
  const termsWage = personalTermsWage(preview, PERSONAL_TERMS_MARGIN);
  if (termsWage === null) return null;
  const wage = Math.max(termsWage, Math.round(player.wage * 1.05));
  if (wage > pair.demand.wageRoom * WAGE_ROOM_SHARE) return null;
  const premium = player.listed
    ? 0.85 + random() * 0.15
    : candidate.key
      ? 1.15 + random() * 0.15
      : candidate.expiring
        ? 0.7 + random() * 0.2
        : 0.92 + random() * 0.13;
  const commission = profile.agent?.commission ?? 0;
  const agentFee = Math.round((wage * 52 * commission) / 100);
  let fee = roundTo(player.value * premium, 10_000);
  const room = pair.demand.transferRoom - agentFee;
  if (fee > room) {
    // A club short of the full price still bids what it can when the player is listed, surplus or expiring.
    if (candidate.key || room < player.value * 0.75) return null;
    fee = floorTo(room, 10_000);
  }
  if (fee <= 0 || transferEmbargo(buyer.balance, fee) || buyer.balance < fee) return null;
  if (signingHeadroomCost({ wage, fee, years, agentFee }, pair.demand.feeCashShare) > pair.demand.ffpHeadroom) return null;
  return {
    type: "Permanent transfer",
    fee,
    wage,
    terms: defaultLoanTerms(player, user),
    role,
    years,
    plannedStart,
    deadline,
    interestScore: preview.score,
    interestDetails: preview,
    reason: reasonFor(candidate, pair, {}),
    cost: fee + agentFee,
    addedWage: wage,
  };
}

/**
 * World-driven approaches for the director's players, run once a day from the simulation pipeline. Clubs approach
 * players the market can use (listed, loan-listed, surplus, developing, unregistered, expiring, occasionally a star)
 * when they need the position, are at a fitting level and can afford the fee, the wage and the player's personal
 * terms; the frequency setting sets the weekly target that this real demand fills.
 */
export async function generateUserClubOffers(store: Store, state: GameState) {
  const result = { transfers: 0, loans: 0 };
  const last = await store.get<{ value: string }>("SELECT value FROM meta WHERE key = 'lastOfferDate'");
  if (last?.value === JSON.stringify(state.date)) return result;
  await store.setMeta("lastOfferDate", state.date);
  await revalidateIncomingOffers(store, state);
  const settings = await settingsOf(store);
  const frequency = OFFER_FREQUENCIES[offerFrequency(settings)];
  const phase = marketPhase(state.date);
  const random = seedrandom(`${state.seed}:offers:${state.date}`);
  const history = await store.all<{ player_id: number; buying_club_id: number; stage: string; created: string; origin: string | null }>(
    "SELECT player_id,buying_club_id,stage,created,data::jsonb ->> 'origin' AS origin FROM negotiations WHERE selling_club_id = ? AND buying_club_id <> ? AND (stage = 'Offer received' OR created >= ?) ORDER BY id",
    state.clubId,
    state.clubId,
    addDays(state.date, -PAIR_COOLDOWN_DAYS),
  );
  const recent = history.filter((row) => row.origin === "approach" && row.created >= addDays(state.date, -6) && row.created < state.date).length;
  const weekly = frequency.weekly * phase.multiplier;
  const roll = random();
  if (!dailyOfferQuota({ weekly, dailyMax: frequency.dailyMax, recent, elapsed: phase.elapsed, random: roll })) return result;
  const candidates = await offerSupply(store, state, frequency);
  if (!candidates.length) return result;
  const user = (await store.get<Club>("SELECT * FROM clubs WHERE id = ?", state.clubId))!;
  const demand = await demandSnapshot(store, state);
  const openPerPlayer = new Map<number, number>();
  const blockedPairs = new Set<string>();
  for (const row of history) {
    blockedPairs.add(`${row.player_id}:${row.buying_club_id}`);
    if (row.stage === "Offer received") openPerPlayer.set(row.player_id, (openPerPlayer.get(row.player_id) ?? 0) + 1);
  }
  const options = candidates
    .filter((candidate) => (openPerPlayer.get(candidate.player.id) ?? 0) < frequency.perPlayer)
    .map((candidate) => ({
      candidate,
      pairs: demand
        .filter(
          (entry) =>
            entry.openApproaches < frequency.perClub && !blockedPairs.has(`${candidate.player.id}:${entry.club.id}`),
        )
        .map((entry) => matchPair(candidate, entry, user, state.date, phase))
        .filter((pair): pair is Pair => !!pair),
    }))
    .filter((option) => option.pairs.length);
  // The market's capacity this week: each relevant player absorbs up to his per-player limit of approaches,
  // in proportion to how clearly he is on the market. A thin market yields fewer approaches, never invented ones.
  const capacity = options.reduce(
    (sum, option) => sum + option.candidate.weight * Math.min(frequency.perPlayer, option.pairs.length),
    0,
  );
  const quota = dailyOfferQuota({
    weekly: Math.min(weekly, capacity),
    dailyMax: frequency.dailyMax,
    recent,
    elapsed: phase.elapsed,
    random: roll,
  });
  let validations = 0;
  const offeredToday = new Set<number>();
  // An unregistered player is only worth a move to a club whose association would register him (an English club
  // cannot play a player the FA refused at the director's English club). The verdict depends only on the association.
  const registrable = new Map<string, boolean>();
  const canRegister = async (candidate: Candidate, buyer: Club) => {
    if (!candidate.unregistered) return true;
    const key = `${candidate.player.id}:${await registrationAssociationId(store, buyer)}`;
    if (!registrable.has(key))
      registrable.set(key, !blocking((await predictRegistration(store, candidate.player.id, buyer.id)).status));
    return registrable.get(key)!;
  };
  while (result.transfers + result.loans < quota && options.length && validations < MAX_VALIDATIONS) {
    const index = pickWeighted(options, (option) => option.candidate.weight, random);
    const [option] = options.splice(index, 1);
    if (offeredToday.has(option.candidate.player.id)) continue;
    const pairs = option.pairs.filter(
      (pair) => pair.demand.openApproaches < frequency.perClub && !blockedPairs.has(`${option.candidate.player.id}:${pair.demand.club.id}`),
    );
    for (let attempt = 0; attempt < 3 && pairs.length && validations < MAX_VALIDATIONS; ) {
      const [pair] = pairs.splice(pickWeighted(pairs, (entry) => entry.score * (0.5 + random()), random), 1);
      if (!(await canRegister(option.candidate, pair.demand.club))) continue;
      attempt++;
      validations++;
      const offer = await buildOffer(store, state, user, option.candidate, pair, phase, random);
      if (!offer) continue;
      await insertApproach(store, state, option.candidate, pair.demand.club, offer);
      pair.demand.transferRoom -= offer.cost;
      pair.demand.ffpHeadroom -= offer.addedWage * 52 + offer.cost * (1 + pair.demand.feeCashShare);
      pair.demand.wageRoom -= offer.addedWage;
      pair.demand.wages += offer.addedWage;
      pair.demand.openApproaches++;
      blockedPairs.add(`${option.candidate.player.id}:${pair.demand.club.id}`);
      offeredToday.add(option.candidate.player.id);
      if (option.candidate.kind === "loan") result.loans++;
      else result.transfers++;
      break;
    }
  }
  return result;
}

async function insertApproach(store: Store, state: GameState, candidate: Candidate, buyer: Club, offer: BuiltOffer) {
  const { player, profile } = candidate;
  const loan = candidate.kind === "loan";
  const endDate = loan ? loanEndDate(offer.type, offer.plannedStart, offer.terms.duration) : undefined;
  const data: NegotiationData = {
    workflowVersion: 2,
    origin: "approach",
    reason: offer.reason,
    plannedStart: offer.plannedStart,
    interestDetails: offer.interestDetails,
    log: [
      {
        date: state.date,
        type: "Offer",
        message: loan
          ? `${buyer.name} have offered a ${offer.type.toLowerCase()} from ${offer.plannedStart} to ${endDate}: ${money(offer.fee)} fee, ${offer.terms.salarySplit}% of the wage, ${offer.terms.role.toLowerCase()} (${offer.terms.playingTime}% of minutes). ${offer.reason.text}`
          : `${buyer.name} have submitted a formal transfer offer of ${money(offer.fee)}. ${offer.reason.text}`,
      },
    ],
    agent: profile.agent,
    years: offer.years,
    role: offer.role,
    promises: [],
    terms: offer.terms,
    ...(loan ? { loanReferenceSplit: offer.terms.salarySplit } : {}),
  };
  const inserted = await store.run(
    "INSERT INTO negotiations(player_id, buying_club_id, selling_club_id, type, stage, asking_price, offer, wage, interest, created, deadline, data) VALUES (?, ?, ?, ?, 'Offer received', ?, ?, ?, ?, ?, ?, ?)",
    player.id,
    buyer.id,
    state.clubId,
    offer.type,
    loan ? offer.fee : player.value,
    offer.fee,
    Math.round(offer.wage),
    offer.interestScore,
    state.date,
    offer.deadline,
    JSON.stringify(data),
  );
  await news(
    store,
    "Transfers",
    loan ? `Loan offer for ${player.name}` : `An offer for ${player.name}`,
    loan
      ? `${buyer.name} want ${player.name} on a ${offer.type.toLowerCase()} until ${endDate} (${money(offer.fee)}, ${offer.terms.salarySplit}% of the wage). ${offer.reason.text} Reply by ${offer.deadline}.`
      : `${buyer.name} have bid ${money(offer.fee)}. ${offer.reason.text} Reply by ${offer.deadline}.`,
    "important",
    loan ? "loans" : "transfers",
    {
      playerId: player.id,
      clubId: buyer.id,
      fee: offer.fee,
      unsolicited: !player.listed && !player.available_loan,
    },
  );
  await publishTransferStory(store, {
    key: `negotiation:${inserted.lastInsertRowid}:bid`,
    phase: "bid",
    playerId: player.id,
    buyerId: buyer.id,
    sellerId: state.clubId,
    fee: offer.fee,
    loan,
    negotiationId: Number(inserted.lastInsertRowid),
  });
}

/** Weekly wages a club has agreed in deals still awaiting registration (accepted offers, signed contracts). */
export async function committedWages(store: Store, clubId: number, excludeId = 0) {
  let total = 0;
  for (const deal of await store.all<Pick<Negotiation, "type" | "wage" | "data"> & { player_wage: number }>(
    "SELECT negotiations.type,negotiations.wage,negotiations.data,players.wage AS player_wage FROM negotiations JOIN players ON players.id = negotiations.player_id WHERE negotiations.buying_club_id = ? AND negotiations.id <> ? AND negotiations.stage IN ('Agent talks','Contract review','Scheduled','Medical','Registration')",
    clubId,
    excludeId,
  ))
    total += LOAN_TYPES.includes(deal.type)
      ? (deal.player_wage * ((JSON.parse(deal.data) as NegotiationData).terms?.salarySplit ?? 100)) / 100
      : deal.wage;
  return total;
}

/** Why an open approach no longer holds (the club withdraws it), or null. */
export async function approachIssue(store: Store, negotiation: Negotiation, date: string) {
  const data = JSON.parse(negotiation.data) as NegotiationData;
  const player = await store.get<Player>("SELECT * FROM players WHERE id = ?", negotiation.player_id);
  const buyer = await store.get<Club>("SELECT * FROM clubs WHERE id = ?", negotiation.buying_club_id);
  if (!player || !buyer) return { reason: "unavailable" as const, message: "The deal is no longer possible." };
  const loan = LOAN_TYPES.includes(negotiation.type);
  if (player.club_id !== negotiation.selling_club_id || player.parent_club_id || player.role === "Retired")
    return { reason: "unavailable" as const, message: `${player.name} is no longer available.` };
  if (player.injury_until && daysBetween(date, player.injury_until) > (loan ? 7 : 21))
    return {
      reason: "injury" as const,
      message: `${player.name} is injured until ${player.injury_until}, so ${buyer.name} have withdrawn.`,
    };
  const cost = dealCost(negotiation, data) - (data.reservedBudget ?? 0);
  if (cost > buyer.transfer_budget || transferEmbargo(buyer.balance, negotiation.offer))
    return { reason: "budget" as const, message: `${buyer.name} no longer have the funds and have withdrawn.` };
  const addedWage = loan ? (player.wage * data.terms.salarySplit) / 100 : negotiation.wage;
  if (!(await fitsWageBudget(store, buyer, (await weeklyWages(store, buyer.id)) + (await committedWages(store, buyer.id, negotiation.id)) + addedWage, date)))
    return { reason: "budget" as const, message: `${buyer.name} can no longer fit the wage and have withdrawn.` };
  const signed = await store.get<{ name: string }>(
    "SELECT players.name FROM history JOIN players ON players.id = history.entity_id WHERE history.entity_type IN ('transfer','loan') AND history.date >= ? AND (history.data::jsonb ->> 'to')::integer = ? AND players.position = ? AND players.id <> ? LIMIT 1",
    negotiation.created,
    buyer.id,
    player.position,
    player.id,
  );
  if (signed)
    return {
      reason: "needs-changed" as const,
      message: `${buyer.name} have signed ${signed.name} for the position and withdrawn their offer.`,
    };
  return null;
}

/** Daily check of open approaches: clubs withdraw those that no longer hold (injury, funds, a signing elsewhere). */
export async function revalidateIncomingOffers(store: Store, state: GameState) {
  for (const negotiation of await store.all<Negotiation>(
    "SELECT * FROM negotiations WHERE selling_club_id = ? AND stage = 'Offer received' AND data::jsonb ->> 'origin' = 'approach' ORDER BY id",
    state.clubId,
  )) {
    const issue = await approachIssue(store, negotiation, state.date);
    if (issue) await withdrawApproach(store, negotiation, issue.reason, issue.message);
  }
}

async function withdrawApproach(
  store: Store,
  negotiation: Negotiation,
  reason: NonNullable<NegotiationData["closedReason"]>,
  message: string,
) {
  const player = await store.get<{ name: string }>("SELECT name FROM players WHERE id = ?", negotiation.player_id);
  await closeNegotiation(store, negotiation, "Withdrawn", message, reason);
  await news(
    store,
    "Transfers",
    `Offer for ${player?.name ?? "your player"} withdrawn`,
    message,
    "info",
    LOAN_TYPES.includes(negotiation.type) ? "loans" : "transfers",
    { playerId: negotiation.player_id, clubId: negotiation.buying_club_id },
  );
}

/**
 * The director accepts an incoming offer: an approach is re-checked first (returns the reason it no longer holds),
 * the buying club reserves the fee and agent commission from its transfer budget so its other business cannot
 * spend it before registration, and every other open offer for the player is withdrawn.
 */
export async function acceptIncomingOffer(store: Store, negotiation: Negotiation, data: NegotiationData, date: string) {
  if (data.origin === "approach") {
    const issue = await approachIssue(store, negotiation, date);
    if (issue) {
      await withdrawApproach(store, negotiation, issue.reason, issue.message);
      return issue.message;
    }
  }
  const reserved = Math.max(0, dealCost(negotiation, data) - (data.reservedBudget ?? 0));
  if (reserved > 0) {
    await store.run(
      "UPDATE clubs SET transfer_budget = transfer_budget - ? WHERE id = ?",
      reserved,
      negotiation.buying_club_id,
    );
    data.reservedBudget = (data.reservedBudget ?? 0) + reserved;
  }
  const buyer = await store.get<{ name: string }>("SELECT name FROM clubs WHERE id = ?", negotiation.buying_club_id);
  for (const other of await store.all<Negotiation>(
    "SELECT * FROM negotiations WHERE player_id = ? AND id <> ? AND stage = 'Offer received'",
    negotiation.player_id,
    negotiation.id,
  ))
    await withdrawApproach(
      store,
      other,
      "accepted-elsewhere",
      `You accepted ${buyer?.name ?? "another club"}'s offer, so this offer has been withdrawn.`,
    );
  return null;
}
