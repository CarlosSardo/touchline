import seedrandom from "seedrandom";
import type { Store } from "./db.ts";
import { assessFinancesBatch, assetAmortization, baseWage, fairValueForFfp, signingHeadroomCost } from "./finance.ts";
import { marketSnapshot, saleCreditOf, sellerSquadFloor, SNAPSHOT_MAX_AGE, squadNeeds, windowClose, type ClubPolicy, type SupplyPlayer } from "./club-policy.ts";
import { endSpells, refreshQuotaLists } from "./eligibility.ts";
import { gbeAssessments } from "./gbe.ts";
import type { GbeAssessment } from "../shared/gbe/types.ts";
import { publishTransferStory } from "./media.ts";
import { reviewSolvency } from "./sanctions.ts";
import { sisterPreference, type OwnershipInfo } from "./ownership.ts";
import { marketMoveInterest, marketWageOffer, MOVE_REFUSAL_THRESHOLD } from "./recruitment.ts";
import { passportGroup } from "./registration.ts";
import { closeNegotiation, contractEndDate, loanAskingFee, loanEndDate, MIN_LOAN_DAYS, MIN_LOAN_SALARY_SPLIT, news, settingsOf } from "./systems.ts";
import { marketContractYears, recordShortlistBid } from "./transfer-battles.ts";
import { worldNewsBatch, type WorldNewsInput } from "./world-news.ts";
import { firstTeamCap } from "./youth.ts";
import { optionalReleaseClause, releaseClauseFor } from "../shared/release-clauses.ts";
import { addDays, clamp, daysBetween, deadlineDay, money, tacticalFit, transferWindow, winterWindowClose } from "../shared/rules.ts";
import { MIN_GOALKEEPERS } from "../shared/world-rules.ts";
import type { Club, GameState, LoanTerms, Negotiation, NegotiationData, Player, Position } from "../shared/types.ts";

/**
 * Incoming senior moves (transfers, loans and free signings) a club plans in a market season, by league tier: 14 in a
 * top flight down to 4.5 at the bottom of a pyramid. Owner ambition and the director of football's policy scale it
 * (0.8-1.2). Wage room, FFP and willing players stop about half of the attempts, so clubs realise roughly 6-9
 * moves at the top and 3-6 lower down (server/check-simulation.ts reports the bands).
 */
export const TIER_APPETITE = [14, 11, 8, 6, 5, 4.5] as const;
/** Most players a club has on loan from other clubs at once. */
const LOANS_IN_CAP = 6;
/** Candidates priced per acting club and need. */
const SHORTLIST = 3;
/** Minimum sell-to-buy attempts and the release-clause searches per day (each costs a query). */
const DAILY_SALES = 12;
const DAILY_CLAUSE_SEARCHES = 3;
/** World feed items about completed moves per day (the biggest fees). */
const DAILY_HEADLINES = 6;
/** Chance a club with a position short looks for a free agent on a between-window market day (two a week). */
const FREE_AGENT_COVER = 0.15;
/** Personal-terms bar a loan move must clear (the wage is the parent's; playing time is the attraction). */
const LOAN_INTEREST = 57;
const WORLD_LOAN = "world";

export type MarketPhase = "window" | "deadline" | "closed";

/**
 * Share of a market season's moves (15 June to 14 June) made on each day: the summer window carries most, quiet in
 * its first fortnight and busiest in the last week; the winter window about a third of that; deadline days spike;
 * between windows only free agents move.
 */
function dayWeight(date: string) {
  const monthDay = date.slice(5);
  const year = Number(date.slice(0, 4));
  if (deadlineDay(date)) return monthDay === "09-01" ? 20 : 12;
  if (monthDay >= "06-15" && monthDay <= "09-01") {
    if (monthDay < "06-29") return 0.6;
    return monthDay >= "08-25" ? 2.5 : 1;
  }
  if (transferWindow(date)) return daysBetween(date, winterWindowClose(year)) <= 5 ? 2 : 0.55;
  return 0.04;
}

const seasonStart = (date: string) => (date.slice(5) >= "06-15" ? `${date.slice(0, 4)}-06-15` : `${Number(date.slice(0, 4)) - 1}-06-15`);
const cumulative = new Map<string, Map<string, number>>();

/** Fraction of the season's moves due by the end of `date`. */
export function seasonShare(date: string) {
  const start = seasonStart(date);
  let table = cumulative.get(start);
  if (!table) {
    table = new Map();
    const days: [string, number][] = [];
    for (let day = start; days.length < 366 && seasonStart(day) === start; day = addDays(day, 1)) days.push([day, dayWeight(day)]);
    const total = days.reduce((sum, [, weight]) => sum + weight, 0);
    let running = 0;
    for (const [day, weight] of days) table.set(day, (running += weight) / total);
    cumulative.set(start, table);
  }
  return table.get(date) ?? 1;
}

export function marketPhase(date: string): MarketPhase {
  if (!transferWindow(date)) return "closed";
  return deadlineDay(date) ? "deadline" : "window";
}

/** A club's season appetite for incoming senior moves. */
export function seasonAppetite(policy: Pick<ClubPolicy, "tier" | "ambition" | "dofPolicy">) {
  const base = TIER_APPETITE[clamp((policy.tier ?? TIER_APPETITE.length) - 1, 0, TIER_APPETITE.length - 1)];
  const dof = policy.dofPolicy === "balanced" ? 1 : policy.dofPolicy === "youth" ? 1.05 : 1.1;
  return base * (0.8 + clamp(policy.ambition, 0, 100) / 250) * dof;
}

type Mode = "transfer" | "loan" | "free";

interface Candidate extends Omit<SupplyPlayer, "clubId" | "reason"> {
  clubId: number | null;
  reason: SupplyPlayer["reason"] | "free-agent" | "release-clause";
  releaseClause?: number;
}

interface Details {
  id: number;
  name: string;
  club_id: number | null;
  parent_club_id: number | null;
  role: string;
  contract_end: string;
  injury_until: string | null;
  birth_date: string;
  wage: number;
  personality: Record<string, number> | null;
  codes: string[];
  last_association: number | null;
  busy: boolean;
}

interface Deal {
  mode: Mode;
  label: string;
  candidate: Candidate;
  details: Details;
  buyer: ClubPolicy;
  seller: ClubPolicy | null;
  fee: number;
  wage: number;
  contractEnd: string;
  role: string;
  releaseClause: number | null;
  loan?: { type: string; endDate: string; terms: LoanTerms };
  sellOn: number;
  swapWith?: number;
}

export interface MarketActivity {
  transfers: number;
  loans: number;
  free: number;
  swaps: number;
  clauses: number;
  returns: number;
  /** Contracts ended by mutual consent on deadline day (the players become free agents). */
  releases: number;
}

interface Context {
  store: Store;
  state: GameState;
  random: seedrandom.PRNG;
  phase: MarketPhase;
  policies: Map<number, ClubPolicy>;
  ownership: ReadonlyMap<number, OwnershipInfo>;
  /** Per position, sorted by ability: the players a club may buy or sign free (`buy`) and those it may borrow (`loan`). */
  byPosition: Map<string, { buy: Candidate[]; loan: Candidate[] }>;
  supplyById: Map<number, Candidate>;
  /** The snapshot's own supply (kept in the per-world cache). */
  supply: Map<number, SupplyPlayer>;
  details: Map<number, Details>;
  gbe: Map<number, GbeAssessment>;
  taken: Set<number>;
  deals: Deal[];
  loansIn: Map<number, number>;
  countries: Map<string, number>;
  ffp: boolean;
  /** First day the world market ran in this world. */
  marketStart: string | null;
  sales: number;
  /** Sell-to-buy attempts allowed today (each may cost a query): one per two acting clubs, at least DAILY_SALES. */
  salesCap: number;
  clauseSearches: number;
}

/** Clubs of one multi-club group: related parties whose deals FFP counts at fair value. */
const relatedParties = (buyer: ClubPolicy, seller: ClubPolicy | null) => !!seller && seller.ownerGroupId !== null && seller.ownerGroupId === buyer.ownerGroupId;

/** The fee the buyer's FFP accounts carry: from a sister club at least the fair value (no advantage from a cheap deal). */
const buyerFfpFee = (buyer: ClubPolicy, seller: ClubPolicy | null, fee: number, value: number) =>
  relatedParties(buyer, seller) ? Math.max(fee, fairValueForFfp(fee, value)) : fee;

/** Weekly wages a club can add today: its wage room plus, in a window, the planned sales it may sign ahead of. */
const roomOf = (context: Context, policy: ClubPolicy) => policy.wageRoom + (context.phase === "closed" ? 0 : policy.saleCredit);

const goingRate = (policy: ClubPolicy, candidate: Pick<Candidate, "ability" | "age">) =>
  Math.max(50, Math.round((baseWage(candidate.ability) * policy.payScale * (candidate.age <= 20 ? 0.75 : 1)) / 10) * 10);

const spanish = (policy: ClubPolicy) => policy.leagueCode === "ES" || policy.association === "ES";

const clubLike = (policy: ClubPolicy) => ({
  reputation: policy.reputation,
  facilities: policy.facilities,
  academy: policy.academy,
  country_id: policy.countryId,
  formation: policy.formation,
  tactical_style: policy.tacticalStyle,
});

/** Rank the player would take at the buyer's position (1 = first choice). */
function rankAt(policy: ClubPolicy, candidate: Pick<Candidate, "position" | "ability">) {
  const stats = policy.positions[candidate.position];
  if (!stats || candidate.ability > stats.best) return 1;
  return candidate.ability > stats.second ? 2 : 3;
}

/** Fee a selling club asks from an AI buyer: discounted for listed, expiring and forced sales, a premium for a club's best. */
function askingFee(candidate: Candidate, buyer: ClubPolicy, seller: ClubPolicy | null, random: () => number) {
  if (!seller) return 0;
  const [low, high] =
    candidate.reason === "listed"
      ? [0.8, 0.95]
      : candidate.reason === "expiring"
        ? [0.55, 0.8]
        : candidate.reason === "over-budget"
          ? [0.8, 0.95]
          : candidate.reason === "outgrown"
            ? [1.15, 1.4]
            : candidate.reason === "weak" || candidate.reason === "surplus"
              ? [0.85, 1]
              : [0.95, 1.1];
  const wealth = 1 + clamp((buyer.reputation - seller.reputation) / 100, 0, 0.15);
  const fee = candidate.value * (low + (high - low) * random()) * wealth;
  return fee >= 1_000_000 ? Math.round(fee / 50_000) * 50_000 : Math.round(fee / 5_000) * 5_000;
}

function fitScore(buyer: ClubPolicy, candidate: Candidate, mode: Mode, need: number) {
  const gap = candidate.ability - buyer.level;
  if (mode === "loan") {
    if (gap < -6 || gap > 8) return 0;
  } else if (gap < (mode === "free" ? -8 : -5) || gap > 10) return 0;
  const target = mode === "loan" ? 0 : 2;
  const fit = 1 - clamp(Math.abs(gap - target) / 14, 0, 0.8);
  const rank = rankAt(buyer, candidate);
  // A depth need takes a squad player; without one only an upgrade on the current starter is worth it.
  if (need < 1 && rank > 1) return 0;
  const policy =
    buyer.dofPolicy === "youth"
      ? candidate.age <= 23 ? 1.5 : candidate.age >= 30 ? 0.6 : 1
      : buyer.dofPolicy === "value"
        ? candidate.potential - candidate.ability >= 5 || ["listed", "expiring", "free-agent"].includes(candidate.reason) ? 1.4 : 0.9
        : buyer.dofPolicy === "stars"
          ? mode === "loan" ? 0.7 : 1 + clamp(gap / 20, 0, 0.5)
          : 1;
  return fit * policy * (rank === 1 ? 1.4 : rank === 2 ? 1.1 : 0.8) * Math.max(0.5, need);
}

/**
 * Share of a club's attempts that look for a loan: about a seventh at wealthy top-flight clubs, a fifth in general and
 * a quarter lower down the pyramid or with little money (loans are the cheap way to strengthen). Loans succeed more
 * often than purchases, so the realised loan share of moves is higher (calibrated to 30-45%).
 */
export function loanPropensity(policy: Pick<ClubPolicy, "tier" | "reputation" | "transferBudget" | "dofPolicy">) {
  const base = (policy.tier ?? 4) >= 3 || policy.transferBudget < 500_000 ? 0.26 : policy.tier === 1 && policy.reputation >= 75 ? 0.15 : 0.2;
  return clamp(base + (policy.dofPolicy === "stars" ? -0.1 : policy.dofPolicy === "value" ? 0.05 : 0), 0.1, 0.6);
}

/** How the buyer would take the player when it wants a loan or a signing: young or surplus players at bigger clubs come on loan. */
function modeFor(buyer: ClubPolicy, candidate: Candidate, seller: ClubPolicy | null, loan: boolean): Mode | null {
  if (!seller) return loan ? null : "free";
  if (!loan) return candidate.mode === "loan" ? null : "transfer";
  if (candidate.mode === "transfer") return null;
  return seller.reputation >= buyer.reputation - 3 || candidate.reason === "loan-listed" ? "loan" : null;
}

/** The first market day of this world (stored once). */
async function marketStartDate(store: Store, date: string) {
  const stored = await store.get<{ value: string }>("SELECT value FROM meta WHERE key = 'marketStart'");
  if (stored) return JSON.parse(stored.value) as string;
  await store.setMeta("marketStart", date);
  return date;
}

/** Clubs that act today and how many moves each attempts. */
function actingClubs(context: Context) {
  const { policies, state, phase, random } = context;
  // A world that starts after the summer window opened (new careers start on 1 July) owes nothing for the days before.
  const share = seasonShare(state.date) - (context.marketStart && seasonStart(context.marketStart) === seasonStart(state.date) ? seasonShare(addDays(context.marketStart, -1)) : 0);
  const today = seasonShare(state.date) - seasonShare(addDays(state.date, -1));
  const cap = phase === "deadline" ? 4 : daysBetween(state.date, windowClose(state.date)) <= 7 ? 2 : 1;
  const actors: { policy: ClubPolicy; actions: number }[] = [];
  for (const policy of policies.values()) {
    if (policy.managed || policy.embargo || !policy.level) continue;
    const short = Math.max(...Object.values(policy.needs));
    if (phase === "closed") {
      // Between windows a club signs only free agents, as cover for a position left short (injuries, departures).
      if (short >= 1 && random() < FREE_AGENT_COVER) actors.push({ policy, actions: 1 });
      continue;
    }
    const appetite = seasonAppetite(policy);
    // A club behind schedule (failed attempts) catches up gradually (at most ten days' worth at once), except on deadline day.
    const due = appetite * share - policy.incoming;
    const deficit = phase === "deadline" ? due : Math.min(due, appetite * today * 10);
    const urgent = short >= 2 && random() < 0.25;
    const actions = Math.min(cap, Math.max(urgent ? 1 : 0, Math.floor(deficit + random())));
    if (actions > 0) actors.push({ policy, actions });
  }
  for (let index = actors.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [actors[index], actors[swap]] = [actors[swap], actors[index]];
  }
  return actors;
}

/** Positions the club looks at, most needed first (an upgrade at its weakest fielded position when nothing is short). */
function wantedPositions(policy: ClubPolicy, random: () => number) {
  const needs = Object.entries(policy.needs)
    .filter(([, need]) => need > 0)
    .map(([position, need]) => ({ position, need: need * (0.8 + random() * 0.4) }))
    .sort((left, right) => right.need - left.need);
  if (needs.length) return needs.slice(0, 2);
  const weakest = Object.entries(policy.positions)
    .filter(([position]) => policy.needs[position] !== undefined && (policy.needs[position] ?? 0) === 0)
    .sort((left, right) => left[1].best - right[1].best)[0];
  return weakest ? [{ position: weakest[0], need: 0.5 }] : [];
}

/**
 * The best SHORTLIST players for the buyer at a position. Every check is a pure function of buyer and candidate, so the
 * cheap arithmetic ones run first and the map lookups only for the few left; the random draw is made for each
 * candidate that passes them all, in list order, exactly as before.
 */
function shortlist(context: Context, buyer: ClubPolicy, position: string, need: number, loan: boolean) {
  const best: { candidate: Candidate; mode: Mode; score: number }[] = [];
  const lists = context.byPosition.get(position);
  const list = (loan ? lists?.loan : lists?.buy) ?? [];
  // fitScore's widest band is level - 8 (free agents as cover) to level + 10.
  let low = 0;
  for (let high = list.length; low < high; ) {
    const middle = (low + high) >> 1;
    if (list[middle].ability < buyer.level - 8) low = middle + 1;
    else high = middle;
  }
  const floor = sellerSquadFloor(context.state.date);
  const budget = buyer.transferBudget * 1.5;
  const room = Math.max(0, roomOf(context, buyer)) * 1.5;
  const headroom = Math.max(0, buyer.ffpHeadroom) * 1.5;
  for (let index = low; index < list.length && list[index].ability <= buyer.level + 10; index++) {
    const candidate = list[index];
    if (candidate.clubId === buyer.clubId || context.taken.has(candidate.id)) continue;
    if (context.phase === "closed" && candidate.clubId !== null) continue;
    // The mode modeFor gives whenever it allows the move (the lists hold only players it may allow).
    const mode: Mode = loan ? "loan" : candidate.clubId === null ? "free" : "transfer";
    const fit = fitScore(buyer, candidate, mode, need);
    if (!fit) continue;
    // Rough price, wage and FFP cost (priceDeal decides): sell-to-buy can cover a modest shortfall.
    const fee = mode === "transfer" ? candidate.value * 0.9 : 0;
    const wage = mode === "loan" ? candidate.wage * 0.5 : Math.max(candidate.wage * 1.1, goingRate(buyer, candidate));
    if (fee > budget || wage > room) continue;
    if (context.ffp && wage * 52 + fee / 4 > headroom) continue;
    const seller = candidate.clubId === null ? null : (context.policies.get(candidate.clubId) ?? null);
    if (candidate.clubId !== null && (!seller || seller.managed)) continue;
    const sister = seller ? sisterPreference(context.ownership, buyer.clubId, seller.clubId) : 1;
    if (!sister) continue;
    if (modeFor(buyer, candidate, seller, loan) !== mode) continue;
    // Cheap pre-checks of priceDeal: a club at its squad floor keeps its players; adult loans stay domestic.
    if (seller && candidate.rank < 99 && seller.seniors <= floor) continue;
    if (mode === "loan" && candidate.age > 21 && seller!.association !== buyer.association) continue;
    const reason = candidate.reason === "listed" ? 1.3 : candidate.reason === "free-agent" ? 0.9 : 1;
    const score = fit * reason * sister * (0.7 + context.random() * 0.6);
    // Top SHORTLIST by score; an equal score ranks after the earlier candidate (as a stable sort would).
    if (best.length === SHORTLIST && score <= best[SHORTLIST - 1].score) continue;
    let at = best.length;
    while (at > 0 && best[at - 1].score < score) at--;
    best.splice(at, 0, { candidate, mode, score });
    if (best.length > SHORTLIST) best.pop();
  }
  return best;
}

async function loadDetails(store: Store, ids: readonly number[]) {
  const details = new Map<number, Details>();
  if (!ids.length) return details;
  for (const row of await store.all<Omit<Details, "codes" | "busy"> & { code: string; nationalities: { code: string }[] | null; busy: boolean }>(
    `SELECT players.id, players.name, players.club_id, players.parent_club_id, players.role, players.contract_end, players.injury_until,
       players.birth_date, players.wage, countries.code, doc -> 'personality' AS personality,
       doc #> '{identity,nationalities}' AS nationalities, (doc #>> '{registration,lastAssociationId}')::integer AS last_association,
       EXISTS (SELECT 1 FROM negotiations WHERE negotiations.player_id = players.id
         AND negotiations.stage NOT IN ('Completed','Rejected','Withdrawn','Expired','Hijacked')) AS busy
     FROM players JOIN countries ON countries.id = players.country_id
     CROSS JOIN LATERAL (SELECT players.profile::jsonb AS doc OFFSET 0) AS parsed
     WHERE players.id = ANY(?::integer[])`,
    [...ids],
  ))
    details.set(row.id, {
      ...row,
      codes: [...new Set([row.code, ...(Array.isArray(row.nationalities) ? row.nationalities.map((entry) => entry.code) : [])])],
    });
  return details;
}

/** Whether a move into England needs a Governing Body Endorsement: no British or Irish nationality, joining from abroad. */
function needsEndorsement(context: Context, details: Details, seller: ClubPolicy | null) {
  if (details.codes.some((code) => ["GB", "IE"].includes(passportGroup(code)))) return false;
  if (seller) return seller.association !== "EN";
  return details.last_association !== context.countries.get("EN");
}

/** England registers players who need a Governing Body Endorsement only with a pass (cached assessments, one batch). */
async function registrable(context: Context, deal: Pick<Deal, "candidate" | "details" | "buyer" | "seller">) {
  if (deal.buyer.association !== "EN" || !needsEndorsement(context, deal.details, deal.seller)) return true;
  if (!context.gbe.has(deal.candidate.id))
    for (const [id, assessment] of await gbeAssessments(context.store, [deal.candidate.id])) context.gbe.set(id, assessment);
  return ["exempt", "auto_pass", "pass"].includes(context.gbe.get(deal.candidate.id)?.outcome ?? "");
}

/** Every check a move must pass, with the price and terms; null when the move fails. */
/** What stopped an otherwise possible move: the buyer may sell or lend a surplus player first and try again. */
type Shortfall = "funds" | "wages" | "ffp";

async function priceDeal(context: Context, buyer: ClubPolicy, candidate: Candidate, mode: Mode, label?: string): Promise<Deal | Shortfall | null> {
  const { state, random } = context;
  const details = context.details.get(candidate.id);
  if (!details || details.busy || details.role === "Retired" || details.parent_club_id !== null) return null;
  if (details.club_id !== candidate.clubId) return null;
  if (details.injury_until && details.injury_until > addDays(state.date, 14)) return null;
  const seller = candidate.clubId === null ? null : (context.policies.get(candidate.clubId) ?? null);
  if ((candidate.clubId !== null && (!seller || seller.managed)) || buyer.embargo) return null;
  if (buyer.seniors >= firstTeamCap(buyer.leagueCode, buyer.tier)) return null;
  // Paying a release clause overrides the selling club's squad planning.
  if (seller && candidate.rank < 99 && candidate.reason !== "release-clause") {
    if (seller.seniors <= sellerSquadFloor(state.date)) return null;
    if (candidate.position === "GK" && (seller.positions.GK?.depth ?? 0) <= MIN_GOALKEEPERS) return null;
  }
  const personality = { personality: details.personality ?? {} };
  const player = {
    age: candidate.age,
    listed: candidate.listed ? 1 : 0,
    morale: candidate.morale,
    contract_end: details.contract_end,
    ability: candidate.ability,
    country_id: candidate.countryId,
    position: candidate.position,
  };
  const loan = mode === "loan";
  const rank = rankAt(buyer, candidate);
  // Playing time: a first-choice place elsewhere matters to a player his club is moving on (the role factor of personal terms).
  const minutes = (rank === 1 ? 8 : rank === 2 ? 4 : 0) + (candidate.reason === "free-agent" || candidate.reason === "outgrown" || candidate.reason === "release-clause" || candidate.reason === "listed" ? 0 : 6);
  const score = marketMoveInterest(player, personality, clubLike(buyer), seller ? clubLike(seller) : undefined, state.date, loan) + minutes;
  if (score < MOVE_REFUSAL_THRESHOLD) return null;
  if (loan) {
    if (rank > 2) return null;
    if (score + (rank === 1 ? 6 : 3) < LOAN_INTEREST) return null;
    if ((context.loansIn.get(buyer.clubId) ?? 0) >= LOANS_IN_CAP) return null;
    // International loans of players aged 22+ count against FIFA's loan limits: AI clubs keep those domestic.
    if (seller!.association !== buyer.association && candidate.age > 21) return null;
    const type = candidate.age <= 21 ? "Development loan" : candidate.age >= 22 && random() < 0.2 && buyer.transferBudget >= candidate.value ? "Loan with option" : "Standard loan";
    const endDate = loanEndDate(type, state.date, 365);
    if (endDate > details.contract_end || daysBetween(state.date, endDate) < MIN_LOAN_DAYS) return null;
    // The parent pays the rest of the wage; for a development loan it covers more when the borrower cannot.
    const wanted = clamp(Math.round(((rank === 1 ? 85 : 65) + (random() - 0.5) * 30) / 5) * 5, 30, 100);
    const room = roomOf(context, buyer);
    const affordable = Math.floor((Math.max(0, room) / Math.max(1, details.wage)) * 20) * 5;
    const split = type === "Development loan" ? Math.min(wanted, Math.max(MIN_LOAN_SALARY_SPLIT, affordable)) : wanted;
    const addedWage = (details.wage * split) / 100;
    if (addedWage > room) return "wages";
    const terms: LoanTerms = {
      playingTime: rank === 1 ? 70 : 50,
      position: candidate.position,
      role: rank === 1 ? "Regular starter" : "Squad player",
      developmentPlan: "Balanced",
      recall: type !== "Loan with option",
      injuryRecall: true,
      salarySplit: split,
      fee: 0,
      bonus: 0,
      mandatoryMinutes: 0,
      tacticalFit: Math.round(tacticalFit(player, clubLike(buyer))),
      managerTrust: 60,
      relationship: 50,
      optionFee: type === "Loan with option" ? Math.round((candidate.value * (1.1 + random() * 0.2)) / 10_000) * 10_000 : 0,
      sellOn: 0,
      duration: 365,
      obligationCondition: "Unconditional",
    };
    const days = daysBetween(state.date, endDate);
    const asking = loanAskingFee({ type, value: candidate.value, wage: details.wage, days, referenceSplit: 70 }, terms);
    const fee = Math.round((type === "Development loan" ? asking * 0.3 : asking) / 1_000) * 1_000;
    terms.fee = fee;
    if (fee > buyer.transferBudget) return "funds";
    if (context.ffp && addedWage * 52 * (days / 365) + fee * (1 + buyer.feeCashShare) > buyer.ffpHeadroom) return "ffp";
    const deal: Deal = {
      mode,
      label: type,
      candidate,
      details,
      buyer,
      seller,
      fee,
      wage: details.wage,
      contractEnd: details.contract_end,
      role: terms.role,
      releaseClause: null,
      loan: { type, endDate, terms },
      sellOn: 0,
    };
    return (await registrable(context, deal)) ? deal : null;
  }
  const wage = marketWageOffer(seller ? details.wage : 0, score, goingRate(buyer, candidate));
  if (wage === null) return null;
  if (wage > roomOf(context, buyer)) return "wages";
  const fee = candidate.reason === "release-clause" ? candidate.releaseClause! : askingFee(candidate, buyer, seller, random);
  const years = seller ? marketContractYears(candidate.age) : candidate.age >= 30 ? 1 : 1 + Math.floor(random() * 3);
  if (fee > buyer.transferBudget) return "funds";
  if (context.ffp && signingHeadroomCost({ wage, fee: buyerFfpFee(buyer, seller, fee, candidate.value), years }, buyer.feeCashShare) > buyer.ffpHeadroom)
    return "ffp";
  const contractEnd = contractEndDate(state.date, years, candidate.age);
  const clause = spanish(buyer)
    ? releaseClauseFor({ id: candidate.id, age: candidate.age, ability: candidate.ability, potential: candidate.potential, value: Math.max(candidate.value, fee) }, true)
    : optionalReleaseClause(candidate.id, buyer.clubId)
      ? releaseClauseFor({ id: candidate.id, age: candidate.age, ability: candidate.ability, potential: candidate.potential, value: Math.max(candidate.value, fee) }, false)
      : null;
  const deal: Deal = {
    mode,
    label: label ?? (seller ? "Permanent transfer" : "Free transfer"),
    candidate,
    details,
    buyer,
    seller,
    fee,
    wage,
    contractEnd,
    role: rank === 1 ? "Regular starter" : "Squad player",
    releaseClause: clause,
    // Smaller clubs selling young players up keep a share of the next sale.
    sellOn: seller && candidate.age <= 23 && seller.reputation < buyer.reputation - 8 && random() < 0.4 ? 10 + Math.round(random() * 2) * 5 : 0,
  };
  return (await registrable(context, deal)) ? deal : null;
}

/** Books a priced deal in the day's in-memory model (budgets, squads, needs) so later decisions see it. */
function commit(context: Context, deal: Deal) {
  const { buyer, seller, candidate } = deal;
  context.deals.push(deal);
  context.taken.add(candidate.id);
  // The cached snapshot serves the next days too.
  context.supply.delete(candidate.id);
  const annual = deal.loan
    ? ((deal.wage * deal.loan.terms.salarySplit) / 100) * 52 + deal.fee * (1 + buyer.feeCashShare)
    : signingHeadroomCost(
        {
          wage: deal.wage,
          fee: buyerFfpFee(buyer, seller, deal.fee, candidate.value),
          years: Math.max(1, daysBetween(context.state.date, deal.contractEnd) / 365),
        },
        buyer.feeCashShare,
      );
  const weekly = deal.loan ? (deal.wage * deal.loan.terms.salarySplit) / 100 : deal.wage;
  buyer.transferBudget -= deal.fee;
  buyer.balance -= deal.fee;
  buyer.wageRoom -= weekly;
  buyer.weeklyWages += weekly;
  buyer.ffpHeadroom -= annual;
  buyer.incoming++;
  buyer.seniors++;
  const stats = (buyer.positions[candidate.position] ??= { depth: 0, available: 0, best: 0, second: 0, old: 0 });
  stats.depth++;
  stats.available++;
  if (candidate.ability > stats.best) [stats.best, stats.second] = [candidate.ability, stats.best];
  else if (candidate.ability > stats.second) stats.second = candidate.ability;
  if (candidate.age >= 31) stats.old++;
  buyer.needs = squadNeeds(buyer.formation, buyer.positions, buyer.level);
  if (deal.loan) context.loansIn.set(buyer.clubId, (context.loansIn.get(buyer.clubId) ?? 0) + 1);
  if (seller) {
    seller.transferBudget += deal.fee * 0.85;
    seller.balance += deal.fee;
    const shed = deal.loan ? (candidate.wage * deal.loan.terms.salarySplit) / 100 : candidate.wage;
    seller.wageRoom += shed;
    seller.weeklyWages -= shed;
    seller.ffpHeadroom += shed * 52 + seller.feeCashShare * deal.fee;
    if (seller.surplus.includes(candidate.id)) seller.saleCredit = Math.max(0, seller.saleCredit - saleCreditOf(candidate));
    if (candidate.rank < 99) {
      seller.seniors--;
      const own = seller.positions[candidate.position];
      if (own) {
        own.depth--;
        own.available = Math.max(0, own.available - 1);
      }
      seller.needs = squadNeeds(seller.formation, seller.positions, seller.level);
    }
    seller.surplus = seller.surplus.filter((id) => id !== candidate.id);
  }
}

/**
 * Sell-to-buy: a club short of the fee, the wage room or the FFP headroom for a move first moves on one of its own
 * surplus players to a club that needs him (a sale; for wages or FFP also a loan, which takes most of his wage off
 * the books), then tries again. Returns whether room was made.
 */
async function makeRoom(context: Context, club: ClubPolicy, shortfall: Shortfall) {
  if (context.sales >= context.salesCap) return false;
  const own = club.surplus
    .map((id) => context.supplyById.get(id))
    .filter((candidate): candidate is Candidate => !!candidate && !context.taken.has(candidate.id) && (shortfall !== "funds" || candidate.mode !== "loan"))
    .sort((left, right) => (shortfall === "funds" ? right.value - left.value : right.wage - left.wage))[0];
  if (!own) return false;
  context.sales++;
  if (!context.details.has(own.id)) for (const [id, row] of await loadDetails(context.store, [own.id])) context.details.set(id, row);
  const modes: Mode[] = own.mode === "loan" ? ["loan"] : own.mode === "transfer" || shortfall === "funds" ? ["transfer"] : ["transfer", "loan"];
  const details = context.details.get(own.id);
  const endorsement = !!details && needsEndorsement(context, details, club);
  const takers = [...context.policies.values()]
    // An English taker would need an endorsement assessment for a foreign player: sell-to-buy keeps to simple deals.
    .filter((policy) => !policy.managed && !policy.embargo && policy.clubId !== club.clubId && (policy.needs[own.position] ?? 0) > 0)
    .filter((policy) => !endorsement || policy.association !== "EN")
    .flatMap((policy) =>
      modes
        .filter((mode) => (mode === "transfer" ? policy.transferBudget >= own.value * 0.8 : club.reputation >= policy.reputation - 3))
        .map((mode) => ({ policy, mode, fit: fitScore(policy, own, mode, policy.needs[own.position]) })),
    )
    .filter((entry) => entry.fit > 0)
    // A sale first; a loan only when nobody buys.
    .sort((left, right) => (left.mode === right.mode ? right.fit - left.fit : left.mode === "transfer" ? -1 : 1))
    .slice(0, 5);
  for (const { policy, mode } of takers) {
    const deal = await priceDeal(context, policy, own, mode);
    if (deal && typeof deal === "object") {
      commit(context, deal);
      return true;
    }
  }
  return false;
}

/**
 * Part-exchange: a buyer with a surplus player the selling club needs offers him as part of the deal (the cash fee
 * falls by his valuation). Both players agree terms and register as separate moves recorded as a swap.
 */
async function partExchange(context: Context, deal: Deal) {
  const { buyer, seller } = deal;
  if (!seller || context.random() > 0.2) return null;
  const offered = buyer.surplus
    .map((id) => context.supplyById.get(id))
    .find(
      (candidate): candidate is Candidate =>
        !!candidate &&
        !context.taken.has(candidate.id) &&
        candidate.mode !== "loan" &&
        (seller.needs[candidate.position] ?? 0) > 0 &&
        candidate.value >= deal.fee * 0.3 &&
        candidate.value <= deal.fee * 1.1 &&
        fitScore(seller, candidate, "transfer", seller.needs[candidate.position]) > 0,
    );
  if (!offered) return null;
  if (!context.details.has(offered.id)) for (const [id, row] of await loadDetails(context.store, [offered.id])) context.details.set(id, row);
  const back = await priceDeal(context, seller, offered, "transfer", "Swap deal");
  if (!back || typeof back !== "object") return null;
  back.fee = Math.min(back.fee, deal.fee);
  return back;
}

/** Big clubs occasionally pay a rival's release clause for an upgrade the selling club would not sell. */
async function clauseTargets(context: Context, buyer: ClubPolicy, position: string) {
  if (context.clauseSearches >= DAILY_CLAUSE_SEARCHES || buyer.reputation < 70 || buyer.transferBudget < 5_000_000 || context.random() > 0.2) return [];
  context.clauseSearches++;
  const best = buyer.positions[position]?.best ?? 0;
  const rows = await context.store.all<{ id: number; club_id: number; position: Position; secondary_position: string; age: number; ability: number; potential: number; value: number; wage: number; contract_end: string; morale: number; country_id: number; clause: number }>(
    `SELECT players.id, players.club_id, players.position, players.secondary_position, players.age, players.ability, players.potential,
       players.value, players.wage, players.contract_end, players.morale, players.country_id,
       (players.profile::jsonb #>> '{contract,releaseClause}')::double precision AS clause
     FROM players WHERE players.position = ? AND players.ability BETWEEN ? AND ? AND players.age BETWEEN 18 AND 29
       AND players.club_id IS NOT NULL AND players.club_id <> ? AND players.parent_club_id IS NULL AND players.role <> 'Retired'
       AND (players.profile::jsonb #>> '{contract,releaseClause}')::double precision <= ?
     ORDER BY players.ability DESC, players.id LIMIT 3`,
    position,
    Math.max(best + 3, buyer.level),
    buyer.level + 12,
    buyer.clubId,
    buyer.transferBudget,
  );
  return rows.map((row) => ({
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
    listed: false,
    shortlisted: false,
    minutes: 0,
    morale: row.morale,
    countryId: row.country_id,
    rank: 1,
    reason: "release-clause" as const,
    mode: "transfer" as const,
    releaseClause: row.clause,
  }));
}

/** Days between two release-clause triggers on the director's players. */
const DIRECTOR_CLAUSE_DAYS = 60;

/**
 * An AI club pays the release clause of one of the director's players: the club cannot refuse, so the deal goes
 * straight to personal terms (the buying club negotiates them; the player may still say no), with the fee reserved.
 */
async function directorClause(context: Context, buyer: ClubPolicy, candidate: Candidate) {
  const { store, state } = context;
  const details = context.details.get(candidate.id);
  const clause = candidate.releaseClause ?? 0;
  if (!details || details.busy || details.parent_club_id !== null || clause <= 0 || clause > buyer.transferBudget) return false;
  if (
    await store.get(
      "SELECT 1 FROM negotiations WHERE selling_club_id = ? AND created >= ? AND data::jsonb ->> 'releaseClause' = 'true' LIMIT 1",
      state.clubId,
      addDays(state.date, -DIRECTOR_CLAUSE_DAYS),
    )
  )
    return false;
  const seller = context.policies.get(candidate.clubId!)!;
  const player = { age: candidate.age, listed: 0, morale: candidate.morale, contract_end: details.contract_end, ability: candidate.ability, country_id: candidate.countryId, position: candidate.position };
  const score = marketMoveInterest(player, { personality: details.personality ?? {} }, clubLike(buyer), clubLike(seller), state.date);
  const wage = marketWageOffer(details.wage, score, goingRate(buyer, candidate));
  const years = marketContractYears(candidate.age);
  if (wage === null || wage > roomOf(context, buyer) || (context.ffp && signingHeadroomCost({ wage, fee: clause, years }, buyer.feeCashShare) > buyer.ffpHeadroom)) return false;
  const profile = await store.get<{ agent: Negotiation["data"] }>("SELECT (profile::jsonb -> 'agent')::text AS agent FROM players WHERE id = ?", candidate.id);
  const data: NegotiationData = {
    workflowVersion: 2,
    origin: "approach",
    releaseClause: true,
    buyerManaged: true,
    nextStageDate: addDays(state.date, 1),
    reason: { code: "upgrade", text: `${buyer.name} have paid the release clause of ${money(clause)}; the club cannot refuse.` },
    log: [{ date: state.date, type: "Release clause", message: `${buyer.name} have deposited the ${money(clause)} release clause. The club cannot block the move; the player decides on personal terms.` }],
    agent: JSON.parse(profile?.agent ?? "null") ?? { name: "Representative", commission: 5, personality: "Pragmatic", frustration: 0 },
    years,
    role: "Regular starter",
    promises: [],
    terms: {
      playingTime: 70, position: candidate.position, role: "Regular starter", developmentPlan: "Balanced", recall: false, injuryRecall: false,
      salarySplit: 100, fee: 0, bonus: 0, mandatoryMinutes: 0, tacticalFit: 60, managerTrust: 60, relationship: 50, optionFee: 0, sellOn: 0,
      duration: 365, obligationCondition: "Unconditional",
    },
    reservedBudget: clause,
  };
  const inserted = await store.run(
    "INSERT INTO negotiations(player_id, buying_club_id, selling_club_id, type, stage, asking_price, offer, wage, interest, created, deadline, data) VALUES (?, ?, ?, 'Permanent transfer', 'Agent talks', ?, ?, ?, ?, ?, ?, ?)",
    candidate.id,
    buyer.clubId,
    state.clubId,
    clause,
    clause,
    wage,
    score,
    state.date,
    addDays(state.date, 28),
    JSON.stringify(data),
  );
  await store.run("UPDATE clubs SET transfer_budget = transfer_budget - ? WHERE id = ?", clause, buyer.clubId);
  buyer.transferBudget -= clause;
  for (const other of await store.all<Negotiation>(
    "SELECT * FROM negotiations WHERE player_id = ? AND id <> ? AND stage = 'Offer received'",
    candidate.id,
    Number(inserted.lastInsertRowid),
  ))
    await closeNegotiation(store, other, "Withdrawn", `${buyer.name} have triggered the release clause, so this offer has been withdrawn.`, "accepted-elsewhere");
  await news(
    store,
    "Transfers",
    `${buyer.name} trigger ${details.name}'s release clause`,
    `${buyer.name} have paid the ${money(clause)} release clause. The club cannot refuse; ${details.name} is now discussing personal terms with them.`,
    "important",
    "transfers",
    { playerId: candidate.id, clubId: buyer.clubId, fee: clause, releaseClause: true },
  );
  return true;
}

/** Club-less adults clubs may sign: free agents (between windows only those out of contract before the last window closed). */
async function freeAgents(store: Store, date: string, phase: MarketPhase): Promise<Candidate[]> {
  const year = Number(date.slice(0, 4));
  const closed = date.slice(5) > "09-01" ? `${year}-09-01` : date > winterWindowClose(year) ? winterWindowClose(year) : `${year - 1}-09-01`;
  const rows = await store.all<{ id: number; position: Position; secondary_position: string; age: number; ability: number; potential: number; value: number; contract_end: string; morale: number; country_id: number }>(
    `SELECT id, position, secondary_position, age, ability, potential, value, contract_end, morale, country_id FROM players
     WHERE club_id IS NULL AND role = 'Free agent' AND age_group = 'Senior' AND age BETWEEN 18 AND 34 AND contract_end <= ?
       AND (injury_until IS NULL OR injury_until <= ?)`,
    phase === "closed" ? closed : date,
    addDays(date, 14),
  );
  return rows.map((row) => ({
    id: row.id,
    clubId: null,
    position: row.position,
    secondary: row.secondary_position,
    age: row.age,
    ability: row.ability,
    potential: row.potential,
    value: row.value,
    wage: 0,
    contractEnd: row.contract_end,
    listed: false,
    shortlisted: false,
    minutes: 0,
    morale: row.morale,
    countryId: row.country_id,
    rank: 99,
    reason: "free-agent",
    mode: "transfer",
  }));
}

/**
 * The AI market, once a day from the simulation pipeline (replaces worldTransfers): ends due world loans, then in a
 * window every club whose season appetite is behind schedule looks for its most needed positions among the players
 * other clubs would move on (and free agents), pays the price, wage and FFP cost it can afford, and signs, borrows
 * or swaps. Wage room counts the wages leaving before the window closes and, in a window, half of the planned sales:
 * a club may sign first and then sells or lends a surplus player (the same day, or later as an over-budget seller);
 * clubs short of funds sell first. On deadline day clubs still over budget end surplus contracts by mutual consent.
 * Between windows clubs sign free agents twice a week. Every move is applied set-based at the end of the day with its
 * ledger, assets, history and world news.
 */
export async function worldMarket(store: Store, state: GameState, random: seedrandom.PRNG): Promise<MarketActivity> {
  const activity: MarketActivity = { transfers: 0, loans: 0, free: 0, swaps: 0, clauses: 0, returns: 0, releases: 0 };
  if ((await store.get<{ value: string }>("SELECT value FROM meta WHERE key = 'lastMarketDate'"))?.value === JSON.stringify(state.date))
    return activity;
  await store.setMeta("lastMarketDate", state.date);
  await ensureReleaseClauses(store, state.date);
  activity.returns = await expireWorldLoans(store, state);
  const phase = marketPhase(state.date);
  // Between windows only free agents sign, twice a week.
  if (phase === "closed" && ![0, 3].includes(daysBetween("2026-07-01", state.date) % 7)) return activity;
  // Squads and supply are re-read every other window day (daily in the last week) and weekly between windows.
  const snapshot = await marketSnapshot(store, state.date, phase === "closed" ? SNAPSHOT_MAX_AGE : daysBetween(state.date, windowClose(state.date)) <= 7 ? 1 : 2);
  const supply = phase === "closed" ? [] : [...snapshot.supply.values()].map((player): Candidate => ({ ...player }));
  const free = await freeAgents(store, state.date, phase);
  const byPosition = new Map<string, Candidate[]>();
  const add = (position: string, candidate: Candidate) => {
    const list = byPosition.get(position);
    if (list) list.push(candidate);
    else byPosition.set(position, [candidate]);
  };
  for (const candidate of [...supply, ...free]) {
    add(candidate.position, candidate);
    if (candidate.secondary && candidate.secondary !== candidate.position) add(candidate.secondary, { ...candidate, position: candidate.secondary as Position });
  }
  // Sorted by ability: a club only looks at the players within its level band. Split by what modeFor allows (loans
  // need a lending club and a player not for sale only), so a search skips the players it could never take.
  const lists = new Map<string, { buy: Candidate[]; loan: Candidate[] }>();
  for (const [position, list] of byPosition) {
    list.sort((left, right) => left.ability - right.ability || left.id - right.id);
    lists.set(position, {
      buy: list.filter((candidate) => candidate.mode !== "loan"),
      loan: list.filter((candidate) => candidate.clubId !== null && candidate.mode !== "transfer"),
    });
  }
  const context: Context = {
    store,
    state,
    random,
    phase,
    policies: snapshot.policies,
    ownership: snapshot.ownership,
    byPosition: lists,
    supplyById: new Map(supply.map((candidate) => [candidate.id, candidate])),
    supply: snapshot.supply,
    details: new Map(),
    gbe: new Map(),
    taken: new Set(),
    deals: [],
    loansIn: new Map(
      (await store.all<{ club_id: number; total: number }>("SELECT destination_id AS club_id, count(*) AS total FROM loans WHERE status = 'active' GROUP BY 1")).map(
        (row) => [row.club_id, row.total],
      ),
    ),
    countries: new Map((await store.all<{ id: number; code: string }>("SELECT id, code FROM countries")).map((row) => [row.code, row.id])),
    ffp: (await settingsOf(store)).ffp !== false,
    marketStart: await marketStartDate(store, state.date),
    sales: 0,
    salesCap: DAILY_SALES,
    clauseSearches: 0,
  };
  const actors = actingClubs(context);
  context.salesCap = Math.max(DAILY_SALES, Math.round(actors.length / 2));
  const plans = actors.map(({ policy, actions }) => ({
    policy,
    actions,
    lists: wantedPositions(policy, random).map(({ position, need }) => {
      // Deadline-day business leans on loans (no time for long negotiations, clubs trim squads).
      const loan = random() < loanPropensity(policy) * (phase === "deadline" ? 1.75 : 1);
      const picks = shortlist(context, policy, position, need, loan);
      // Nothing suitable of the wanted kind: a club looking for a signing settles for a loan only sometimes.
      return { position, picks: picks.length || (!loan && random() > 0.3) ? picks : shortlist(context, policy, position, need, !loan).slice(0, 2) };
    }),
  }));
  const ids = new Set(plans.flatMap((plan) => plan.lists.flatMap((list) => list.picks.map((pick) => pick.candidate.id))));
  // Sell-to-buy offers a club's best-paid or most valuable surplus player: load them with the targets.
  for (const plan of plans) {
    const own = plan.policy.surplus.map((id) => context.supplyById.get(id)).filter((candidate): candidate is Candidate => !!candidate);
    for (const key of ["wage", "value"] as const) {
      const top = own.reduce<Candidate | undefined>((best, candidate) => (!best || candidate[key] > best[key] ? candidate : best), undefined);
      if (top) ids.add(top.id);
    }
  }
  context.details = await loadDetails(store, [...ids]);
  const endorsements = plans.flatMap((plan) =>
    plan.policy.association !== "EN"
      ? []
      : plan.lists.flatMap((list) =>
          list.picks
            .filter((pick) => {
              const details = context.details.get(pick.candidate.id);
              const seller = pick.candidate.clubId === null ? null : (context.policies.get(pick.candidate.clubId) ?? null);
              return !!details && needsEndorsement(context, details, seller);
            })
            .map((pick) => pick.candidate.id),
        ),
  );
  if (endorsements.length) context.gbe = await gbeAssessments(store, endorsements);
  for (const plan of plans) {
    let done = 0;
    for (const list of plan.lists) {
      if (done >= plan.actions) break;
      const picks = [...list.picks];
      if (phase !== "closed") for (const target of await clauseTargets(context, plan.policy, list.position)) picks.unshift({ candidate: target, mode: "transfer", score: 1 });
      for (const pick of picks) {
        if (context.taken.has(pick.candidate.id)) continue;
        if (!context.details.has(pick.candidate.id))
          for (const [id, row] of await loadDetails(store, [pick.candidate.id])) context.details.set(id, row);
        if (pick.candidate.reason === "release-clause" && context.policies.get(pick.candidate.clubId ?? 0)?.managed) {
          if (await directorClause(context, plan.policy, pick.candidate)) done++;
          context.taken.add(pick.candidate.id);
          break;
        }
        let deal = await priceDeal(context, plan.policy, pick.candidate, pick.mode, pick.candidate.reason === "release-clause" ? "Release clause" : undefined);
        if (typeof deal === "string" && (await makeRoom(context, plan.policy, deal)))
          deal = await priceDeal(context, plan.policy, pick.candidate, pick.mode);
        if (!deal || typeof deal === "string") continue;
        // A player on the director's shortlist is not taken at once: the bid waits for him to compete.
        if (deal.mode === "transfer" && pick.candidate.shortlisted) {
          const [player, buyer] = await Promise.all([
            store.get<Player>("SELECT * FROM players WHERE id = ?", pick.candidate.id),
            store.get<Club>("SELECT * FROM clubs WHERE id = ?", plan.policy.clubId),
          ]);
          if (player && buyer) await recordShortlistBid(store, player, buyer, deal.fee, deal.wage);
          context.taken.add(pick.candidate.id);
          break;
        }
        const back = deal.mode === "transfer" && deal.candidate.reason !== "release-clause" ? await partExchange(context, deal) : null;
        if (back) {
          deal.label = "Swap deal";
          deal.swapWith = back.candidate.id;
          back.swapWith = deal.candidate.id;
          commit(context, back);
        }
        commit(context, deal);
        // Signed ahead of planned sales: the club now moves a surplus player on (later this window if nobody takes him today).
        if (plan.policy.wageRoom < 0 && phase !== "closed") await makeRoom(context, plan.policy, "wages");
        done++;
        break;
      }
    }
  }
  await applyDeals(store, state, context.deals, context.countries);
  if (phase === "deadline") activity.releases = await releaseSurplus(context);
  for (const deal of context.deals) {
    if (deal.mode === "loan") activity.loans++;
    else if (deal.mode === "free") activity.free++;
    else activity.transfers++;
    if (deal.label === "Swap deal") activity.swaps++;
    if (deal.label === "Release clause") activity.clauses++;
  }
  await headlines(store, state, context.deals, phase);
  return activity;
}

const contractJson = (deal: Deal, date: string) =>
  JSON.stringify({ status: "professional", signedDate: date, ...(deal.releaseClause ? { releaseClause: deal.releaseClause } : {}) });

/**
 * Applies a day's moves set-based: player rows, loan records, fees (with sell-on payouts, voided buy-backs and the
 * seller's asset disposal), ledgers and budgets, the buyers' new registration assets, new sell-on clauses, history,
 * and the buyers' foreign-quota lists. Related-party sales count at fair value in the seller's FFP accounts.
 */
async function applyDeals(store: Store, state: GameState, deals: readonly Deal[], countries: Map<string, number>) {
  if (!deals.length) return;
  const permanent = deals.filter((deal) => !deal.loan);
  const loans = deals.filter((deal) => deal.loan);
  if (permanent.length)
    await store.run(
      `UPDATE players AS target SET club_id = moved.club_id, squad_club_id = NULL, parent_club_id = NULL, wage = moved.wage,
         contract_end = moved.contract_end, role = moved.role, listed = 0, available_loan = 0, morale = LEAST(99, target.morale + 4),
         profile = ((target.profile::jsonb - 'homeBased') || jsonb_build_object(
           'contract', (CASE WHEN jsonb_typeof(target.profile::jsonb -> 'contract') = 'object' THEN target.profile::jsonb -> 'contract' ELSE '{}'::jsonb END - 'releaseClause')
             || moved.contract::jsonb,
           'registration', CASE WHEN jsonb_typeof(target.profile::jsonb -> 'registration') = 'object' THEN target.profile::jsonb -> 'registration' ELSE '{}'::jsonb END
             || jsonb_build_object('lastAssociationId', moved.association)))::text
       FROM unnest(?::integer[], ?::integer[], ?::double precision[], ?::text[], ?::text[], ?::text[], ?::integer[])
         AS moved(id, club_id, wage, contract_end, role, contract, association)
       WHERE target.id = moved.id`,
      permanent.map((deal) => deal.candidate.id),
      permanent.map((deal) => deal.buyer.clubId),
      permanent.map((deal) => deal.wage),
      permanent.map((deal) => deal.contractEnd),
      permanent.map((deal) => deal.role),
      permanent.map((deal) => contractJson(deal, state.date)),
      permanent.map((deal) => countries.get(deal.buyer.association) ?? deal.buyer.countryId),
    );
  if (loans.length) {
    const parents = new Map(
      (
        await store.all<{ id: number; role: string; training: string; ability: number; potential: number; minutes: number }>(
          "SELECT id, role, training, ability, potential, minutes FROM players WHERE id = ANY(?::integer[])",
          loans.map((deal) => deal.candidate.id),
        )
      ).map((row) => [row.id, row]),
    );
    await store.bulkInsert(
      "loans",
      loans.map((deal) => {
        const before = parents.get(deal.candidate.id)!;
        return {
          player_id: deal.candidate.id,
          parent_id: deal.seller!.clubId,
          destination_id: deal.buyer.clubId,
          type: deal.loan!.type,
          start_date: state.date,
          end_date: deal.loan!.endDate,
          fit: deal.loan!.terms.tacticalFit,
          relationship: 50,
          terms: JSON.stringify(deal.loan!.terms),
          data: JSON.stringify({
            [WORLD_LOAN]: true,
            startingAbility: before.ability,
            startingPotential: before.potential,
            startingMinutes: before.minutes,
            parentRole: before.role,
            parentTraining: before.training,
          }),
        };
      }),
    );
    await store.run(
      `UPDATE players AS target SET parent_club_id = moved.parent_id, club_id = moved.club_id, squad_club_id = NULL, role = moved.role,
         training = 'Balanced', listed = 0, available_loan = 0, morale = LEAST(99, target.morale + 3), loan_progress = 0
       FROM unnest(?::integer[], ?::integer[], ?::integer[], ?::text[]) AS moved(id, parent_id, club_id, role) WHERE target.id = moved.id`,
      loans.map((deal) => deal.candidate.id),
      loans.map((deal) => deal.seller!.clubId),
      loans.map((deal) => deal.buyer.clubId),
      loans.map((deal) => deal.role),
    );
  }
  const ledger: { club_id: number; date: string; category: string; amount: number; description: string }[] = [];
  const cash = new Map<number, { balance: number; income: number; spending: number; budget: number; spend: number }>();
  const items = new Map<number, { sale_profit: number; revenue: number }>();
  const book = (clubId: number, amount: number, category: string, description: string, budget: number) => {
    if (!amount) return;
    ledger.push({ club_id: clubId, date: state.date, category, amount, description });
    const entry = cash.get(clubId) ?? { balance: 0, income: 0, spending: 0, budget: 0, spend: 0 };
    entry.balance += amount;
    entry.income += Math.max(0, amount);
    entry.spending += Math.max(0, -amount);
    entry.budget += budget;
    if (amount < 0) entry.spend -= amount;
    cash.set(clubId, entry);
  };
  const item = (clubId: number, field: "sale_profit" | "revenue", amount: number) => {
    const entry = items.get(clubId) ?? { sale_profit: 0, revenue: 0 };
    entry[field] += amount;
    items.set(clubId, entry);
  };
  const sold = permanent.filter((deal) => deal.seller);
  const soldIds = sold.map((deal) => deal.candidate.id);
  const clauses = soldIds.length
    ? await store.all<{ id: number; player_id: number; beneficiary_id: number; owner_id: number; percentage: number }>(
        "SELECT id, player_id, beneficiary_id, owner_id, percentage FROM sell_on_clauses WHERE status = 'active' AND player_id = ANY(?::integer[]) ORDER BY id",
        soldIds,
      )
    : [];
  const assets = soldIds.length
    ? await store.all<{ id: number; player_id: number; club_id: number; cost: number; acquired: string; expires: string }>(
        "SELECT id, player_id, club_id, cost, acquired, expires FROM player_assets WHERE status = 'active' AND player_id = ANY(?::integer[])",
        soldIds,
      )
    : [];
  const paidClauses: { id: number; paid: number }[] = [];
  const disposed: number[] = [];
  for (const deal of deals) {
    const name = deal.details.name;
    if (deal.fee > 0) book(deal.buyer.clubId, -deal.fee, deal.loan ? "Loan fees" : "Transfer fees", `${name}: ${deal.loan ? "loan" : "recruitment"}`, -deal.fee);
    if (!deal.seller || deal.fee <= 0) continue;
    if (deal.loan) {
      book(deal.seller.clubId, deal.fee, "Loan income", `${name}: loan to ${deal.buyer.name}`, deal.fee * 0.85);
      item(deal.seller.clubId, "revenue", deal.fee);
      continue;
    }
    let proceeds = deal.fee;
    for (const clause of clauses.filter((entry) => entry.player_id === deal.candidate.id && entry.owner_id === deal.seller!.clubId)) {
      const payment = Math.min(proceeds, Math.round((deal.fee * clause.percentage) / 100));
      proceeds -= payment;
      paidClauses.push({ id: clause.id, paid: payment });
      book(clause.beneficiary_id, payment, "Sell-on income", `${name}: sell-on`, payment * 0.85);
      item(clause.beneficiary_id, "sale_profit", payment);
      if (clause.beneficiary_id === state.clubId)
        await news(store, "Loans", "Development sell-on payment received", `${name}'s transfer has triggered a ${money(payment)} payment from an earlier agreement.`, "success", "finances");
    }
    book(deal.seller.clubId, proceeds, "Player sales", `${name}: sale to ${deal.buyer.name}`, proceeds * 0.85);
    // Sister clubs: the regulator counts the sale at fair value (the difference is a non-football adjustment).
    const counted = relatedParties(deal.buyer, deal.seller) ? Math.min(proceeds, fairValueForFfp(proceeds, deal.candidate.value)) : proceeds;
    let bookValue = 0;
    for (const asset of assets.filter((entry) => entry.player_id === deal.candidate.id && entry.club_id === deal.seller!.clubId)) {
      bookValue += Math.max(0, asset.cost - (assetAmortization(asset.cost, asset.acquired, asset.expires) * Math.max(0, daysBetween(asset.acquired, state.date))) / 365.25);
      disposed.push(asset.id);
    }
    item(deal.seller.clubId, "sale_profit", counted - bookValue);
  }
  if (paidClauses.length)
    await store.run(
      "UPDATE sell_on_clauses AS target SET status = 'paid', paid = changes.paid FROM unnest(?::integer[], ?::double precision[]) AS changes(id, paid) WHERE target.id = changes.id",
      paidClauses.map((entry) => entry.id),
      paidClauses.map((entry) => entry.paid),
    );
  if (disposed.length) await store.run("UPDATE player_assets SET status = 'sold' WHERE id = ANY(?::integer[])", disposed);
  if (sold.length)
    await store.run(
      "UPDATE buy_back_clauses AS target SET status = 'void' FROM unnest(?::integer[], ?::integer[]) AS sale(player_id, owner_id) WHERE target.player_id = sale.player_id AND target.owner_id = sale.owner_id AND target.status = 'active'",
      sold.map((deal) => deal.candidate.id),
      sold.map((deal) => deal.seller!.clubId),
    );
  if (cash.size) {
    const rows = [...cash];
    await store.run(
      `UPDATE clubs AS target SET balance = target.balance + changes.balance, income = target.income + changes.income,
         spending = target.spending + changes.spending, transfer_budget = GREATEST(0, target.transfer_budget + changes.budget),
         season_spend = target.season_spend + changes.spend
       FROM unnest(?::integer[], ?::double precision[], ?::double precision[], ?::double precision[], ?::double precision[], ?::double precision[])
         AS changes(id, balance, income, spending, budget, spend) WHERE target.id = changes.id`,
      rows.map(([id]) => id),
      rows.map(([, entry]) => entry.balance),
      rows.map(([, entry]) => entry.income),
      rows.map(([, entry]) => entry.spending),
      rows.map(([, entry]) => entry.budget),
      rows.map(([, entry]) => entry.spend),
    );
    await store.bulkInsert("ledger", ledger);
  }
  if (items.size) {
    const rows = [...items];
    await store.run(
      `INSERT INTO financial_periods (club_id, season, sale_profit, revenue)
       SELECT item.club_id, ?::integer, item.sale_profit, item.revenue FROM unnest(?::integer[], ?::double precision[], ?::double precision[]) AS item(club_id, sale_profit, revenue)
       ON CONFLICT (club_id, season) DO UPDATE SET sale_profit = financial_periods.sale_profit + EXCLUDED.sale_profit,
         revenue = financial_periods.revenue + EXCLUDED.revenue`,
      state.season,
      rows.map(([id]) => id),
      rows.map(([, entry]) => entry.sale_profit),
      rows.map(([, entry]) => entry.revenue),
    );
  }
  const newAssets = deals
    .filter((deal) => deal.fee > 0)
    .map((deal) => ({
      club_id: deal.buyer.clubId,
      player_id: deal.candidate.id,
      cost: deal.fee,
      acquired: state.date,
      expires: deal.loan ? deal.loan.endDate : deal.contractEnd,
    }));
  if (newAssets.length) await store.bulkInsert("player_assets", newAssets);
  const sellOns = sold.filter((deal) => deal.sellOn > 0);
  if (sellOns.length)
    await store.bulkInsert(
      "sell_on_clauses",
      sellOns.map((deal) => ({ player_id: deal.candidate.id, beneficiary_id: deal.seller!.clubId, owner_id: deal.buyer.clubId, percentage: deal.sellOn })),
    );
  await store.bulkInsert(
    "history",
    deals.map((deal) => ({
      season: state.season,
      entity_type: deal.loan ? "loan" : "transfer",
      entity_id: deal.candidate.id,
      date: state.date,
      data: JSON.stringify({
        name: deal.details.name,
        from: deal.seller?.clubId ?? null,
        to: deal.buyer.clubId,
        club: deal.buyer.name,
        fee: deal.fee,
        type: deal.label,
        ...(deal.swapWith ? { swapWith: deal.swapWith } : {}),
        ...(relatedParties(deal.buyer, deal.seller) ? { relatedParty: true, fairValue: Math.round(deal.candidate.value) } : {}),
        ...(deal.loan ? { until: deal.loan.endDate } : {}),
      }),
    })),
  );
  await endSpells(store, deals.map((deal) => deal.candidate.id));
  // Sellers' freed quota places are refilled by processRegistrations later today; the buyers' lists include the signings.
  await refreshQuotaLists(store, [...new Set(deals.map((deal) => deal.buyer.clubId))]);
}

async function headlines(store: Store, state: GameState, deals: readonly Deal[], phase: MarketPhase) {
  const notable = [...deals]
    .filter((deal) => deal.mode !== "free" || deal.candidate.ability >= deal.buyer.level)
    .sort((left, right) => right.fee - left.fee || right.candidate.ability - left.candidate.ability)
    .slice(0, DAILY_HEADLINES);
  const items: WorldNewsInput[] = notable.map((deal) => {
    const from = deal.seller ? ` from ${deal.seller.name}` : " as a free agent";
    const fee = deal.fee > 0 ? ` for ${money(deal.fee)}` : "";
    const kind = deal.loan ? "loan" : "transfer";
    const title = deal.loan
      ? `${deal.buyer.name} borrow ${deal.details.name}${from}`
      : deal.label === "Release clause"
        ? `${deal.buyer.name} trigger ${deal.details.name}'s release clause`
        : `${deal.buyer.name} sign ${deal.details.name}${from}`;
    const body = deal.loan
      ? `${deal.details.name} joins ${deal.buyer.name} on a ${deal.loan.type.toLowerCase()} until ${deal.loan.endDate}${fee ? `; the loan fee is ${money(deal.fee)}` : ""}.`
      : `${deal.details.name} (${deal.candidate.age}, ${deal.candidate.position}) moves to ${deal.buyer.name}${from}${fee}${deal.label === "Swap deal" ? " in a part-exchange" : ""}.`;
    return {
      kind,
      title,
      body,
      clubIds: [deal.buyer.clubId, ...(deal.seller ? [deal.seller.clubId] : [])],
      date: state.date,
      data: { playerId: deal.candidate.id, playerName: deal.details.name, fee: deal.fee, type: deal.label },
    };
  });
  if (phase === "deadline" && deals.length)
    items.push({
      kind: "transfer",
      title: "Deadline day round-up",
      body: `${deals.length} moves completed on deadline day: ${deals.filter((deal) => !deal.loan).length} transfers and ${deals.filter((deal) => deal.loan).length} loans.`,
      clubIds: [],
      date: state.date,
    });
  await worldNewsBatch(store, items);
  for (const deal of notable.slice(0, 2).filter((entry) => entry.fee > 0))
    await publishTransferStory(store, {
      key: `world:${deal.candidate.id}:${state.date}`,
      phase: "signing",
      playerId: deal.candidate.id,
      buyerId: deal.buyer.clubId,
      sellerId: deal.seller?.clubId ?? null,
      fee: deal.fee,
      loan: !!deal.loan,
    });
}

/** Most contracts a club ends by mutual consent on one deadline day (two for a club in the red). */
const DEADLINE_RELEASES = 1;
/** A club releases players when its payroll exceeds its wage budget by more than this share (at all when in the red). */
const RELEASE_MARGIN = 0.05;
/** Share of the remaining wages (at most half a year's) a released player is paid to leave. */
const SEVERANCE_SHARE = 0.5;

/**
 * Deadline day: a club still well over its wage budget after the window (it signed ahead of sales that did not
 * happen) ends the contract of its best-paid surplus squad player by mutual consent (a club in the red up to two, as
 * soon as it is over budget), paying half of his remaining wages up to six months. He becomes a free agent who can
 * sign anywhere between windows; the remaining book value of his registration is written off.
 */
async function releaseSurplus(context: Context) {
  const { store, state } = context;
  const released: { candidate: Candidate; club: ClubPolicy; severance: number }[] = [];
  for (const club of context.policies.values()) {
    const overdrawn = club.balance < 0;
    if (club.managed || club.wageRoom >= (overdrawn ? 0 : -RELEASE_MARGIN * club.wageBudget)) continue;
    let count = 0;
    const own = club.surplus
      .map((id) => context.supplyById.get(id))
      .filter(
        (candidate): candidate is Candidate =>
          !!candidate && !context.taken.has(candidate.id) && candidate.age >= 21 && candidate.rank >= 3 && !["development", "loan-listed"].includes(candidate.reason),
      )
      .sort((left, right) => right.wage - left.wage);
    for (const candidate of own) {
      if (club.wageRoom >= 0 || count >= DEADLINE_RELEASES + (overdrawn ? 1 : 0)) break;
      if (club.seniors <= sellerSquadFloor(state.date) + 1) break;
      const weeks = Math.min(26, Math.max(0, daysBetween(state.date, candidate.contractEnd) / 7));
      released.push({ candidate, club, severance: Math.round((candidate.wage * weeks * SEVERANCE_SHARE) / 100) * 100 });
      count++;
      context.taken.add(candidate.id);
      context.supply.delete(candidate.id);
      club.wageRoom += candidate.wage;
      club.weeklyWages -= candidate.wage;
      club.seniors--;
      club.surplus = club.surplus.filter((id) => id !== candidate.id);
    }
  }
  if (!released.length) return 0;
  const ids = released.map((entry) => entry.candidate.id);
  const names = new Map((await store.all<{ id: number; name: string }>("SELECT id, name FROM players WHERE id = ANY(?::integer[])", ids)).map((row) => [row.id, row.name]));
  // As at a contract's expiry: the player keeps the association of his last club for registration.
  await store.run(
    `UPDATE players AS target SET profile = jsonb_set(target.profile::jsonb, '{registration}',
       COALESCE(CASE WHEN jsonb_typeof(target.profile::jsonb -> 'registration') = 'object' THEN target.profile::jsonb -> 'registration' END, '{}'::jsonb)
       || jsonb_build_object('lastAssociationId', moved.association))::text,
       club_id = NULL, squad_club_id = NULL, wage = 0, value = 100, listed = 0, available_loan = 0, role = 'Free agent', contract_end = ?
     FROM unnest(?::integer[], ?::integer[]) AS moved(id, association) WHERE target.id = moved.id`,
    state.date,
    ids,
    released.map((entry) => context.countries.get(entry.club.association) ?? entry.club.countryId),
  );
  const assets = await store.all<{ id: number; player_id: number; cost: number; acquired: string; expires: string }>(
    "SELECT id, player_id, cost, acquired, expires FROM player_assets WHERE status = 'active' AND player_id = ANY(?::integer[])",
    ids,
  );
  const writeOff = new Map<number, number>();
  for (const asset of assets)
    writeOff.set(
      asset.player_id,
      (writeOff.get(asset.player_id) ?? 0) +
        Math.max(0, asset.cost - (assetAmortization(asset.cost, asset.acquired, asset.expires) * Math.max(0, daysBetween(asset.acquired, state.date))) / 365.25),
    );
  if (assets.length) await store.run("UPDATE player_assets SET status = 'sold' WHERE id = ANY(?::integer[])", assets.map((asset) => asset.id));
  const paid = released.filter((entry) => entry.severance > 0);
  if (paid.length)
    await store.bulkInsert(
      "ledger",
      paid.map((entry) => ({ club_id: entry.club.clubId, date: state.date, category: "Wages", amount: -entry.severance, description: `${names.get(entry.candidate.id)}: contract ended by mutual consent` })),
    );
  await store.run(
    `UPDATE clubs AS target SET balance = target.balance - changes.amount, spending = target.spending + changes.amount
     FROM (SELECT id, sum(amount) AS amount FROM unnest(?::integer[], ?::double precision[]) AS rows(id, amount) GROUP BY id) AS changes WHERE target.id = changes.id`,
    released.map((entry) => entry.club.clubId),
    released.map((entry) => entry.severance),
  );
  await store.run(
    `INSERT INTO financial_periods (club_id, season, wages, sale_profit)
     SELECT id, ?::integer, sum(wages), -sum(loss) FROM unnest(?::integer[], ?::double precision[], ?::double precision[]) AS item(id, wages, loss) GROUP BY id
     ON CONFLICT (club_id, season) DO UPDATE SET wages = financial_periods.wages + EXCLUDED.wages, sale_profit = financial_periods.sale_profit + EXCLUDED.sale_profit`,
    state.season,
    released.map((entry) => entry.club.clubId),
    released.map((entry) => entry.severance),
    released.map((entry) => writeOff.get(entry.candidate.id) ?? 0),
  );
  await endSpells(store, ids);
  await refreshQuotaLists(store, [...new Set(released.map((entry) => entry.club.clubId))]);
  return released.length;
}

/** World loans (between two AI clubs) not involving the director's club family. */
const WORLD_LOANS = `loans.status = 'active' AND loans.data::jsonb ->> '${WORLD_LOAN}' = 'true'
  AND loans.parent_id NOT IN (SELECT id FROM clubs WHERE id = ? OR parent_id = ?)
  AND loans.destination_id NOT IN (SELECT id FROM clubs WHERE id = ? OR parent_id = ?)`;

/**
 * Ends the world loans due today, set-based: an unconditional obligation or an option the borrower takes after a
 * successful spell (it can afford it, he is at its level and fee and wage fit its FFP headroom) makes the move
 * permanent; every other player returns to his parent club in his old role and training.
 */
export async function expireWorldLoans(store: Store, state: GameState) {
  const due = await store.all<{ id: number; player_id: number; parent_id: number; destination_id: number; type: string; score: number; option_fee: number | null; ability: number; wage: number; age: number; transfer_budget: number; balance: number; reputation: number }>(
    `SELECT loans.id, loans.player_id, loans.parent_id, loans.destination_id, loans.type, loans.score,
       (loans.terms::jsonb ->> 'optionFee')::double precision AS option_fee, players.ability, players.wage, players.age,
       clubs.transfer_budget, clubs.balance, clubs.reputation
     FROM loans JOIN players ON players.id = loans.player_id JOIN clubs ON clubs.id = loans.destination_id
     WHERE ${WORLD_LOANS} AND loans.end_date <= ?`,
    state.clubId,
    state.clubId,
    state.clubId,
    state.clubId,
    state.date,
  );
  if (!due.length) return 0;
  const options = due.filter(
    (loan) =>
      loan.option_fee &&
      loan.type === "Loan with option" &&
      loan.score >= 60 &&
      loan.option_fee <= Math.min(loan.transfer_budget, loan.balance) &&
      loan.ability >= loan.reputation * 0.66 + 16,
  );
  // An option is a new signing: the borrower takes it up only within its FFP headroom (an obligation was agreed).
  const headroom = options.length && (await settingsOf(store)).ffp !== false
    ? await assessFinancesBatch(store, { clubIds: [...new Set(options.map((loan) => loan.destination_id))] })
    : null;
  const taken = new Set(
    options
      .filter((loan) => {
        if (!headroom) return true;
        const assessment = headroom.get(loan.destination_id);
        if (!assessment) return false;
        const cost = signingHeadroomCost({ wage: loan.wage * 1.1, fee: loan.option_fee!, years: marketContractYears(loan.age) }, assessment.feeCashShare);
        if (cost > assessment.ffpHeadroom) return false;
        assessment.ffpHeadroom -= cost;
        return true;
      })
      .map((loan) => loan.id),
  );
  const purchases = due.filter((loan) => loan.option_fee && (loan.type === "Loan with obligation" || taken.has(loan.id)));
  const bought = new Set(purchases.map((loan) => loan.id));
  if (purchases.length) {
    const names = new Map(
      (await store.all<{ id: number; name: string }>("SELECT id, name FROM players WHERE id = ANY(?::integer[])", purchases.map((loan) => loan.player_id))).map((row) => [row.id, row.name]),
    );
    const clubs = new Map((await store.all<{ id: number; name: string }>("SELECT id, name FROM clubs WHERE id = ANY(?::integer[])", purchases.flatMap((loan) => [loan.parent_id, loan.destination_id]))).map((row) => [row.id, row.name]));
    const contractEnd = (age: number) => `${Number(state.date.slice(0, 4)) + marketContractYears(age)}-06-30`;
    await store.run(
      `UPDATE players AS target SET parent_club_id = NULL, contract_end = moved.contract_end, wage = round((target.wage * 1.1)::numeric)
       FROM unnest(?::integer[], ?::text[]) AS moved(id, contract_end) WHERE target.id = moved.id`,
      purchases.map((loan) => loan.player_id),
      purchases.map((loan) => contractEnd(loan.age)),
    );
    const ledgerRows = purchases.flatMap((loan) => [
      { club_id: loan.destination_id, date: state.date, category: "Transfer fees", amount: -loan.option_fee!, description: `${names.get(loan.player_id)}: loan made permanent` },
      { club_id: loan.parent_id, date: state.date, category: "Player sales", amount: loan.option_fee!, description: `${names.get(loan.player_id)}: loan made permanent` },
    ]);
    await store.bulkInsert("ledger", ledgerRows);
    await store.run(
      `UPDATE clubs AS target SET balance = target.balance + changes.amount, income = target.income + GREATEST(0, changes.amount),
         spending = target.spending + GREATEST(0, -changes.amount),
         transfer_budget = GREATEST(0, target.transfer_budget + CASE WHEN changes.amount > 0 THEN changes.amount * 0.85 ELSE changes.amount END)
       FROM (SELECT id, sum(amount) AS amount FROM unnest(?::integer[], ?::double precision[]) AS rows(id, amount) GROUP BY id) AS changes WHERE target.id = changes.id`,
      ledgerRows.map((row) => row.club_id),
      ledgerRows.map((row) => row.amount),
    );
    await store.run(
      `INSERT INTO financial_periods (club_id, season, sale_profit)
       SELECT id, ?::integer, sum(amount) FROM unnest(?::integer[], ?::double precision[]) AS item(id, amount) GROUP BY id
       ON CONFLICT (club_id, season) DO UPDATE SET sale_profit = financial_periods.sale_profit + EXCLUDED.sale_profit`,
      state.season,
      purchases.map((loan) => loan.parent_id),
      purchases.map((loan) => loan.option_fee!),
    );
    await store.bulkInsert(
      "player_assets",
      purchases.map((loan) => ({ club_id: loan.destination_id, player_id: loan.player_id, cost: loan.option_fee!, acquired: state.date, expires: contractEnd(loan.age) })),
    );
    await store.bulkInsert(
      "history",
      purchases.map((loan) => ({
        season: state.season,
        entity_type: "transfer",
        entity_id: loan.player_id,
        date: state.date,
        data: JSON.stringify({ name: names.get(loan.player_id), from: loan.parent_id, to: loan.destination_id, club: clubs.get(loan.destination_id), fee: loan.option_fee, type: loan.type === "Loan with option" ? "Option exercised" : "Obligation to buy" }),
      })),
    );
  }
  await store.run(
    `UPDATE players AS target SET club_id = target.parent_club_id, parent_club_id = NULL, squad_club_id = NULL,
       role = coalesce(loans.data::jsonb ->> 'parentRole', 'Squad player'), training = coalesce(loans.data::jsonb ->> 'parentTraining', 'Balanced')
     FROM loans WHERE loans.id = ANY(?::integer[]) AND target.id = loans.player_id AND target.parent_club_id = loans.parent_id`,
    due.filter((loan) => !bought.has(loan.id)).map((loan) => loan.id),
  );
  await endSpells(store, due.map((loan) => loan.player_id));
  await refreshQuotaLists(store, [...new Set(due.flatMap((loan) => [loan.parent_id, loan.destination_id]))]);
  await store.run(
    `UPDATE loans SET status = CASE WHEN id = ANY(?::integer[]) THEN 'purchased' ELSE 'completed' END,
       data = (data::jsonb || jsonb_build_object('endedOn', ?::text))::text WHERE id = ANY(?::integer[])`,
    [...bought],
    state.date,
    due.map((loan) => loan.id),
  );
  return due.length;
}

/**
 * Weekly review of world loans, set-based (the director's loans have their detailed weekly review): the success
 * score follows the minutes against the promised playing time, and a successful spell develops the player as
 * reviewLoans does (loan progress, morale and value).
 */
export async function reviewWorldLoans(store: Store, state: GameState) {
  await store.run(
    `UPDATE loans SET score = review.score FROM (
       SELECT loans.id, LEAST(100, GREATEST(0, 100 * GREATEST(0, players.minutes - coalesce((loans.data::jsonb ->> 'startingMinutes')::integer, 0))
         / GREATEST(90, GREATEST(1, ?::date - loans.start_date::date) / 7.0 * 90 * coalesce((loans.terms::jsonb ->> 'playingTime')::double precision, 60) / 100))) AS score
       FROM loans JOIN players ON players.id = loans.player_id WHERE ${WORLD_LOANS}) AS review
     WHERE loans.id = review.id`,
    state.date,
    state.clubId,
    state.clubId,
    state.clubId,
    state.clubId,
  );
  await store.run(
    `UPDATE players SET morale = LEAST(99, players.morale + 1), loan_progress = players.loan_progress + 0.03, value = players.value * 1.003
     FROM loans WHERE loans.player_id = players.id AND loans.score > 75 AND ${WORLD_LOANS}`,
    state.clubId,
    state.clubId,
    state.clubId,
    state.clubId,
  );
}

const CLAUSE_SCAN = "releaseClauseScan";
/** Moves write their clause at once; this catch-all covers academy graduates and other new professional contracts. */
const CLAUSE_SCAN_DAYS = 28;

/**
 * Spanish contracts must carry a release clause: assigns the missing ones of players whose contract club is Spanish
 * (older worlds and saves, academy graduates, free signings by squad top-ups). Every four weeks, and on the first market
 * day of a world without the scan.
 */
export async function ensureReleaseClauses(store: Store, date: string) {
  const last = await store.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", CLAUSE_SCAN);
  if (last && daysBetween(JSON.parse(last.value) as string, date) < CLAUSE_SCAN_DAYS) return 0;
  await store.setMeta(CLAUSE_SCAN, date);
  const clubs = (
    await store.all<{ id: number }>("SELECT clubs.id FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE countries.code = 'ES' AND clubs.type <> 'national'")
  ).map((club) => club.id);
  if (!clubs.length) return 0;
  // Index lookups by club first; only those players' contracts are read.
  const missing = await store.all<{ id: number; age: number; ability: number; potential: number; value: number }>(
    `SELECT id, age, ability, potential, value FROM (
       SELECT id, age, ability, potential, value, profile FROM players WHERE club_id = ANY(?::integer[]) AND parent_club_id IS NULL AND role <> 'Retired'
       UNION ALL SELECT id, age, ability, potential, value, profile FROM players WHERE parent_club_id = ANY(?::integer[])
       OFFSET 0) AS spanish
     WHERE coalesce(profile::jsonb #>> '{contract,status}', 'professional') = 'professional'
       AND NOT jsonb_exists(CASE WHEN jsonb_typeof(profile::jsonb -> 'contract') = 'object' THEN profile::jsonb -> 'contract' ELSE '{}'::jsonb END, 'releaseClause')`,
    clubs,
    clubs,
  );
  if (!missing.length) return 0;
  await store.run(
    `UPDATE players AS target SET profile = jsonb_set(target.profile::jsonb, '{contract}',
       CASE WHEN jsonb_typeof(target.profile::jsonb -> 'contract') = 'object' THEN target.profile::jsonb -> 'contract' ELSE '{"status":"professional"}'::jsonb END
         || jsonb_build_object('releaseClause', clause.amount))::text
     FROM unnest(?::integer[], ?::double precision[]) AS clause(id, amount) WHERE target.id = clause.id`,
    missing.map((player) => player.id),
    missing.map((player) => releaseClauseFor(player, true)),
  );
  return missing.length;
}

/**
 * An AI board's weekly wage budget. The budget set for the season (`base`) is a soft target. A club whose operations
 * earn more than they cost (strong revenue, promotion or European money) with FFP headroom and two months of wages in
 * cash may pay up to half of its projected weekly operating surplus in extra wages: the budget rises by up to 3% of the
 * base a week, to 5-20% above it with the owner's ambition (owner equity shows up as cash and headroom). Over the FFP
 * limit or overdrawn the board cuts 3% a week (down to 85% of the base); an operating loss trims 1% a week (down to
 * 90%), and a raised budget the surplus no longer covers drifts back. FFP and solvency stay the hard limits on every
 * signing.
 */
export function boardWageBudget(input: {
  budget: number;
  base: number;
  payroll: number;
  weeklySurplus: number;
  ffpHeadroom: number;
  balance: number;
  ambition: number;
}) {
  const { budget, base } = input;
  const affordable = input.payroll + input.weeklySurplus * 0.5;
  let next = budget;
  if (input.ffpHeadroom < 0 || input.balance < 0) next = Math.min(budget, Math.max(base * 0.85, budget * 0.97));
  else if (input.weeklySurplus < 0) next = Math.min(budget, Math.max(base * 0.9, budget * 0.99));
  else if (affordable > budget && input.ffpHeadroom / 52 > budget * 0.1 && input.balance > budget * 8)
    next = Math.max(budget, Math.min(base * (1.05 + (0.15 * clamp(input.ambition, 0, 100)) / 100), budget + Math.min(base * 0.03, affordable - budget)));
  else if (affordable < budget && budget > base) next = Math.max(base, budget * 0.99);
  return Math.round(next / 10) * 10;
}

/** The weekly board review of every AI club's wage budget (boardWageBudget); the season's base is kept in clubs.data. */
async function reviewWageBudgets(store: Store, state: GameState) {
  const policies = (await marketSnapshot(store, state.date, SNAPSHOT_MAX_AGE)).policies;
  const rows = await store.all<{ id: number; wage_budget: number; base: number | null; season: number | null }>(
    `SELECT id, wage_budget, (data::jsonb #>> '{boardWage,base}')::double precision AS base, (data::jsonb #>> '{boardWage,season}')::integer AS season
     FROM clubs WHERE type = 'club'`,
  );
  const changes = rows.flatMap((row) => {
    const policy = policies.get(row.id);
    if (!policy || policy.managed) return [];
    const base = row.season === state.season && row.base ? row.base : row.wage_budget;
    const budget = boardWageBudget({
      budget: row.wage_budget,
      base,
      payroll: policy.weeklyWages,
      weeklySurplus: policy.weeklySurplus,
      ffpHeadroom: policy.ffpHeadroom,
      balance: policy.balance,
      ambition: policy.ambition,
    });
    return budget === row.wage_budget && row.season === state.season ? [] : [{ id: row.id, budget, base }];
  });
  if (!changes.length) return;
  await store.run(
    `UPDATE clubs AS target SET wage_budget = changes.budget,
       data = jsonb_set(target.data::jsonb, '{boardWage}', jsonb_build_object('season', ?::integer, 'base', changes.base))::text
     FROM unnest(?::integer[], ?::double precision[], ?::double precision[]) AS changes(id, budget, base) WHERE target.id = changes.id`,
    state.season,
    changes.map((change) => change.id),
    changes.map((change) => change.budget),
    changes.map((change) => change.base),
  );
}

/** Weekly market housekeeping: world loan reviews, the boards' wage budgets and the solvency check of the sanctions engine. */
export async function weeklyMarket(store: Store, state: GameState) {
  await reviewWorldLoans(store, state);
  await reviewWageBudgets(store, state);
  await reviewSolvency(store);
}
