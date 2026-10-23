import seedrandom from "seedrandom";
import type { Store } from "./db.ts";
import { clubPolicySnapshot } from "./club-policy.ts";
import { acquirePlayerAsset, assessFinances, signingHeadroomCost } from "./finance.ts";
import { activeEmbargo } from "./sanctions.ts";
import { endSpells } from "./eligibility.ts";
import { publishTransferRumour, publishTransferStory } from "./media.ts";
import {
  assessPlayerInterest,
  buyerGoingRate,
  MARKET_WAGE_PREMIUM_CAP,
  marketMoveInterest,
  marketWageOffer,
  MOVE_REFUSAL_THRESHOLD,
  PERSONAL_TERMS_THRESHOLD,
} from "./recruitment.ts";
import { assessRegistration } from "./registration.ts";
import {
  closeNegotiation,
  contractEndDate,
  ledger,
  news,
  settingsOf,
  stateOf,
  transferProceeds,
  weeklyWages,
} from "./systems.ts";
import { optionalReleaseClause, releaseClauseFor } from "../shared/release-clauses.ts";
import { addDays, clamp, money, transferWindow } from "../shared/rules.ts";
import { MIN_GOALKEEPERS, SQUAD_MINIMUMS } from "../shared/world-rules.ts";
import type {
  Club,
  GameState,
  Negotiation,
  NegotiationData,
  Player,
  PlayerInterest,
  PlayerProfile,
  RivalBid,
  RivalInterest,
  TransferBattle,
  TransferBattleView,
} from "../shared/types.ts";

/** Stages in which rival clubs can still compete for a player the director is buying. */
export const BATTLE_STAGES = ["Enquiry", "Club talks", "Agent talks", "Contract review"];
const ACTIVE: RivalBid["status"][] = ["monitoring", "bid", "fee-agreed"];
export const MAX_RIVALS = 2;
const RIVAL_COOLDOWN_DAYS = 5;
const NEW_RIVALS_PER_DAY = 2;
/** Most recent open purchases examined per day (bounds the daily cost however many enquiries the director opens). */
export const MAX_BATTLES_PER_DAY = 40;
const FINAL_OFFERS_DAYS = 3;
const DECISION_DAYS = 2;
/** On a near-tie the player stays with the club that approached him first (the director's). */
export const PREFERENCE_MARGIN = 3;
/** Share of the asking price a selling club accepts from a rival (the director's floor also reflects skills). */
const SELLER_FLOOR = 0.88;
/** Final offers within this share of the best bid are accepted too; the player then chooses. */
const FINAL_OFFER_BAND = 0.95;
/** Days a shortlisted player's pending AI bid waits before it completes, giving the director time to compete. */
export const SHORTLIST_BID_DAYS = 3;
const MAX_MARKET_BIDS = 20;
const MARKET_BIDS_KEY = "rivalMarketBids";
/** Same senior-squad ceiling the world market applies to buyers. */
const BUYER_SQUAD_CAP = 28;

/** A pending AI bid outside the director's talks (shortlist alert or rivals handed over after talks closed). */
export interface MarketBid {
  playerId: number;
  clubId: number;
  fee: number;
  wage: number;
  date: string;
  due: string;
  source: "shortlist" | "handover";
}

const isActive = (rival: RivalBid) => ACTIVE.includes(rival.status);

export function deadlineWeek(date: string) {
  const month = date.slice(5, 7);
  return ((month === "08" || month === "01") && Number(date.slice(8)) >= 25) || date.slice(5) === "09-01";
}

/** Daily chance that a new rival joins a negotiation: public talks and deadline week each double it. */
export function rivalChance(input: { publicTalks: boolean; deadlineWeek: boolean }) {
  return 0.04 * (input.publicTalks ? 2 : 1) * (input.deadlineWeek ? 2 : 1);
}

/** Whether another rival may join: at most MAX_RIVALS active, and RIVAL_COOLDOWN_DAYS since the last one. */
export function canAddRival(rivals: RivalBid[], date: string) {
  const latest = rivals.reduce((last, rival) => (rival.since > last ? rival.since : last), "");
  return (
    rivals.filter(isActive).length < MAX_RIVALS &&
    (!latest || addDays(latest, RIVAL_COOLDOWN_DAYS) <= date)
  );
}

/** The player's choice once a rival has an agreed fee and terms: the director wins only with terms he accepts. */
export function playerChoice(input: {
  userStage: string;
  userScore: number | null;
  rivalInterest: number;
}): "user" | "rival" {
  const userCanSign =
    ["Agent talks", "Contract review"].includes(input.userStage) &&
    input.userScore !== null &&
    input.userScore >= PERSONAL_TERMS_THRESHOLD;
  return userCanSign && input.userScore! + PREFERENCE_MARGIN >= input.rivalInterest ? "user" : "rival";
}

/** A selling club's verdict on best-and-final offers: every bid within 5% of the best (and above its floor) stands. */
export function finalOffersResult(input: {
  floor: number;
  user: number | null;
  rivals: { clubId: number; fee: number }[];
}) {
  const best = Math.max(input.user ?? 0, ...input.rivals.map((rival) => rival.fee));
  const threshold = Math.max(input.floor, best * FINAL_OFFER_BAND);
  return {
    best,
    userAccepted: input.user !== null && input.user >= threshold,
    accepted: input.rivals.filter((rival) => rival.fee >= threshold).map((rival) => rival.clubId),
  };
}

/**
 * Where a date sits in the registration calendar. On the last day of a window, final offers and the player's
 * decision are brought forward; outside a window rivals cannot register the player and withdraw.
 */
export function windowPhase(date: string): "closed" | "open" | "last-day" {
  if (!transferWindow(date)) return "closed";
  return transferWindow(addDays(date, 1)) ? "open" : "last-day";
}

export interface Contender {
  clubId: number;
  interest: number;
  fee: number;
  since: string;
}

/**
 * The player's decision between the clubs with an agreed fee and terms on the table: he only joins a package he
 * accepts (>= PERSONAL_TERMS_THRESHOLD), takes the best one (then higher fee, earlier approach), and on a near-tie
 * stays with the director. null = he accepts no rival package: nobody wins and the director's talks continue.
 */
export function battleWinner(input: {
  userStage: string;
  userScore: number | null;
  rivals: Contender[];
}): { winner: "user" } | { winner: "rival"; clubId: number } | null {
  const best = input.rivals
    .filter((rival) => rival.interest >= PERSONAL_TERMS_THRESHOLD)
    .sort(
      (left, right) =>
        right.interest - left.interest ||
        right.fee - left.fee ||
        left.since.localeCompare(right.since) ||
        left.clubId - right.clubId,
    )[0];
  if (!best) return null;
  return playerChoice({ userStage: input.userStage, userScore: input.userScore, rivalInterest: best.interest }) ===
    "user"
    ? { winner: "user" }
    : { winner: "rival", clubId: best.clubId };
}

/**
 * Estimated fee range that always contains `fee`: ±~20% for an unscouted player, ~±5% with full knowledge,
 * ±3% when the selling club itself indicates it. `u` (0-1, seeded) places the true fee inside the range.
 */
export function fuzzyFeeRange(
  fee: number,
  knowledge: number,
  certainty: RivalInterest["certainty"],
  u: number,
) {
  if (fee <= 0) return null;
  const width = certainty === "confirmed" ? 0.06 : 0.4 - (0.3 * clamp(knowledge, 0, 100)) / 100;
  const step = fee < 1_000_000 ? 10_000 : fee < 10_000_000 ? 50_000 : 250_000;
  const share = 0.15 + 0.7 * clamp(u, 0, 1);
  return {
    low: Math.max(0, Math.floor((fee * (1 - width * share)) / step) * step),
    high: Math.ceil((fee * (1 + width * (1 - share))) / step) * step,
  };
}

function leaning(rivalInterest: number, userScore: number | null): RivalInterest["preference"] {
  if (userScore === null) return rivalInterest >= PERSONAL_TERMS_THRESHOLD ? "rival" : "undecided";
  if (rivalInterest > userScore + PREFERENCE_MARGIN) return "rival";
  if (userScore > rivalInterest + PREFERENCE_MARGIN) return "you";
  return "undecided";
}

export interface RivalClub {
  id: number;
  name: string;
  reputation: number;
  country_name: string;
}

/** What the director knows about one rival (pure; `u` is a seeded 0-1 draw fixing the fee-range position). */
export function rivalView(
  rival: RivalBid,
  context: {
    club: RivalClub | undefined;
    knowledge: number;
    battle: TransferBattle | undefined;
    stage: string;
    userScore: number | null;
    negotiationId: number | null;
    u: number;
  },
): RivalInterest {
  const signedFirst =
    isActive(rival) && ["Scheduled", "Medical", "Registration", "Completed"].includes(context.stage);
  const status: RivalBid["status"] = signedFirst ? "lost" : rival.status;
  const everBid = rival.fee > 0 || rival.status === "fee-agreed" || rival.status === "won";
  const contested = !!context.battle && context.battle.status !== "open" && isActive(rival);
  const certainty: RivalInterest["certainty"] =
    status === "won" || contested
      ? "confirmed"
      : everBid || context.knowledge >= 40
        ? "reported"
        : "rumoured";
  const named = certainty !== "rumoured" && !!context.club;
  return {
    key: `${context.negotiationId ?? "market"}:${rival.clubId}`,
    clubId: named ? rival.clubId : null,
    clubName: named ? context.club!.name : `A club in ${context.club?.country_name ?? "another country"}`,
    countryName: context.club?.country_name ?? null,
    reputation: named ? Math.round(context.club!.reputation) : null,
    certainty,
    status,
    feeRange: fuzzyFeeRange(rival.fee, context.knowledge, certainty, context.u),
    preference:
      status === "won"
        ? "rival"
        : !ACTIVE.includes(status) || status === "monitoring"
          ? "unknown"
          : context.battle?.status === "decision" || context.knowledge >= 60
            ? leaning(rival.interest, context.userScore)
            : "unknown",
    since: rival.since,
    negotiationId: context.negotiationId,
    outcome: signedFirst ? "You reached an agreement with the player first." : (rival.outcome ?? null),
  };
}

/** The director's current standing with the player: his accepted interest once personal terms are under way. */
function directorScore(negotiation: Pick<Negotiation, "stage">, data: NegotiationData) {
  return ["Agent talks", "Contract review"].includes(negotiation.stage)
    ? (data.interestDetails?.score ?? null)
    : null;
}

async function rivalClubs(store: Store, ids: number[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<number, RivalClub>();
  return new Map(
    (
      await store.all<RivalClub>(
        "SELECT clubs.id,clubs.name,clubs.reputation,countries.name AS country_name FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE clubs.id = ANY(?::integer[])",
        unique,
      )
    ).map((club) => [club.id, club]),
  );
}

async function marketBids(store: Store) {
  const row = await store.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", MARKET_BIDS_KEY);
  return row ? (JSON.parse(row.value) as MarketBid[]) : [];
}

const seededDraw = (seed: string, ...parts: (string | number | null)[]) =>
  seedrandom(`${seed}:rival:${parts.join(":")}`)();

function battleView(
  battle: TransferBattle | undefined,
  rivals: RivalInterest[],
  sellerName: string,
  best: { low: number; high: number } | null,
): TransferBattleView | null {
  if (!battle && !rivals.length) return null;
  const status = battle?.status ?? "open";
  const active = rivals.filter((rival) => ACTIVE.includes(rival.status)).length;
  return {
    status,
    finalOffersDeadline: status === "final-offers" ? (battle!.finalOffersDeadline ?? null) : null,
    yourFinalOffer: status === "final-offers" ? (battle!.userFinalOffer ?? null) : null,
    decisionDeadline: status === "decision" ? (battle!.decisionDeadline ?? null) : null,
    leadingBid: status === "final-offers" ? best : null,
    message:
      status === "final-offers"
        ? `${sellerName} want best and final offers by ${battle!.finalOffersDeadline}. Submit your fee in club talks; bids within 5% of the best stand and the player then chooses.`
        : status === "decision"
          ? `The player will choose between the clubs with agreed fees on ${battle!.decisionDeadline}. Agree personal terms he accepts (or sign) to keep him.`
          : active
            ? `${active} rival club${active === 1 ? " is" : "s are"} involved.`
            : "No active rival interest.",
  };
}

/** Transfer-desk rows with the director's view of rivals; the stored rival truth is removed from `data`. */
export async function withBattleViews(store: Store, negotiations: Negotiation[]) {
  const parsed = negotiations.map((negotiation) => ({
    negotiation,
    data: JSON.parse(negotiation.data) as NegotiationData,
  }));
  const contested = parsed.filter((entry) => entry.data.rivals?.length || entry.data.battle);
  if (!contested.length) return negotiations;
  const state = await stateOf(store);
  const clubs = await rivalClubs(
    store,
    contested.flatMap((entry) => (entry.data.rivals ?? []).map((rival) => rival.clubId)),
  );
  const ids = [...new Set(contested.map((entry) => entry.negotiation.player_id))];
  const knowledge = new Map(
    (
      await store.all<{ id: number; knowledge: number }>(
        "SELECT id,knowledge FROM players WHERE id = ANY(?::integer[])",
        ids,
      )
    ).map((player) => [player.id, player.knowledge]),
  );
  return parsed.map(({ negotiation, data }) => {
    if (!data.rivals?.length && !data.battle) return negotiation;
    const { rivals: stored = [], battle, ...rest } = data;
    const known = knowledge.get(negotiation.player_id) ?? 0;
    const rivals = stored.map((rival) =>
      rivalView(rival, {
        club: clubs.get(rival.clubId),
        knowledge: known,
        battle,
        stage: negotiation.stage,
        userScore: directorScore(negotiation, data),
        negotiationId: negotiation.id,
        u: seededDraw(state.seed, negotiation.id, rival.clubId, rival.fee),
      }),
    );
    const leader = stored
      .filter((rival) => rival.status === "bid" || rival.status === "fee-agreed")
      .sort((left, right) => right.fee - left.fee)[0];
    return {
      ...negotiation,
      data: JSON.stringify(rest),
      rivals,
      battle: battleView(
        battle,
        rivals,
        negotiation.seller_name ?? "The selling club",
        leader ? fuzzyFeeRange(leader.fee, known, "confirmed", seededDraw(state.seed, negotiation.id, "lead", leader.fee)) : null,
      ),
    };
  });
}

/** Removes the stored rival truth from a raw negotiation row (e.g. an enquiry returning existing talks). */
export function withoutRivalTruth(negotiation: Negotiation): Negotiation {
  const data = JSON.parse(negotiation.data) as NegotiationData;
  if (!data.rivals && !data.battle) return negotiation;
  delete data.rivals;
  delete data.battle;
  return { ...negotiation, data: JSON.stringify(data) };
}

/** Adds the rivals the director knows about (his active talks and pending market bids) to an interest assessment. */
export async function withRivals(store: Store, playerId: number, interest: PlayerInterest): Promise<PlayerInterest> {
  const state = await stateOf(store);
  const negotiation = await store.get<Negotiation>(
    "SELECT * FROM negotiations WHERE player_id = ? AND buying_club_id = ? AND stage NOT IN ('Completed','Rejected','Withdrawn','Expired','Hijacked') ORDER BY id DESC LIMIT 1",
    playerId,
    state.clubId,
  );
  const data = negotiation ? (JSON.parse(negotiation.data) as NegotiationData) : undefined;
  const pending = (await marketBids(store)).filter((bid) => bid.playerId === playerId);
  if (!data?.rivals?.length && !pending.length) return { ...interest, rivals: [] };
  const clubs = await rivalClubs(store, [
    ...(data?.rivals ?? []).map((rival) => rival.clubId),
    ...pending.map((bid) => bid.clubId),
  ]);
  const known = (await store.get<{ knowledge: number }>("SELECT knowledge FROM players WHERE id = ?", playerId))?.knowledge ?? 0;
  return {
    ...interest,
    rivals: [
      ...(data?.rivals ?? []).map((rival) =>
        rivalView(rival, {
          club: clubs.get(rival.clubId),
          knowledge: known,
          battle: data!.battle,
          stage: negotiation!.stage,
          userScore: directorScore(negotiation!, data!),
          negotiationId: negotiation!.id,
          u: seededDraw(state.seed, negotiation!.id, rival.clubId, rival.fee),
        }),
      ),
      ...pending.map((bid) =>
        rivalView(
          {
            clubId: bid.clubId,
            since: bid.date,
            status: "bid",
            fee: bid.fee,
            wage: bid.wage,
            interest: PERSONAL_TERMS_THRESHOLD,
            raises: 0,
            nextAction: bid.due,
            source: "shortlist",
          },
          {
            club: clubs.get(bid.clubId),
            knowledge: known,
            battle: undefined,
            stage: "Enquiry",
            userScore: null,
            negotiationId: null,
            u: seededDraw(state.seed, "market", playerId, bid.clubId, bid.fee),
          },
        ),
      ),
    ],
  };
}

/** Whether the selling squad can release the player: first team 25 (B-team 20) and two goalkeepers stay. */
export async function sellerCanRelease(store: Store, player: Player, date: string) {
  const squad = (await store.get<{ type: string; players: number; keepers: number }>(
    "SELECT clubs.type,count(players.id) AS players,coalesce(sum(CASE WHEN players.position = 'GK' THEN 1 ELSE 0 END),0) AS keepers FROM clubs LEFT JOIN players ON players.playing_club_id = clubs.id AND players.age_group = 'Senior' AND players.role != 'Retired' AND (players.contract_end >= ? OR players.parent_club_id IS NOT NULL) WHERE clubs.id = ? GROUP BY clubs.type",
    date,
    player.squad_club_id ?? player.club_id,
  ))!;
  if (squad.players <= (squad.type === "bteam" ? SQUAD_MINIMUMS.BTeam : SQUAD_MINIMUMS.Senior)) return false;
  return !(player.position === "GK" && squad.keepers <= MIN_GOALKEEPERS);
}

/** Fresh registration, budget, wage and squad checks before an AI club completes a move. */
async function marketTransferAllowed(store: Store, playerId: number, buyerId: number, sellerId: number, fee: number, wage: number) {
  const state = await stateOf(store);
  const player = await store.get<Player>("SELECT * FROM players WHERE id = ?", playerId);
  const buyer = await store.get<Club>("SELECT * FROM clubs WHERE id = ?", buyerId);
  if (
    !player ||
    !buyer ||
    buyer.type !== "club" ||
    !transferWindow(state.date) ||
    player.club_id !== sellerId ||
    player.parent_club_id ||
    player.role === "Retired" ||
    buyer.transfer_budget < fee ||
    buyer.balance < fee ||
    (await weeklyWages(store, buyer.id)) + wage > buyer.wage_budget ||
    (await store.get<{ total: number }>(
      "SELECT count(*) AS total FROM players WHERE club_id = ? AND age_group = 'Senior' AND role != 'Retired'",
      buyer.id,
    ))!.total >= BUYER_SQUAD_CAP ||
    !(await assessRegistration(store, player, buyer)).allowed ||
    !(await sellerCanRelease(store, player, state.date)) ||
    (await activeEmbargo(store, buyer.id, state.date))
  )
    return null;
  // Hard FFP gate: the signing may not take the buyer past its limit.
  if (
    (await settingsOf(store)).ffp !== false &&
    (await assessFinances(store, buyer.id, { fee, annualWages: wage * 52, years: marketContractYears(player.age) })).ffpHeadroom < 0
  )
    return null;
  return { player, buyer };
}

/** Seasons an AI club offers on a permanent signing: shorter deals from 28, one-year deals from 32. */
export const marketContractYears = (age: number) => (age >= 32 ? 1 : age >= 30 ? 2 : age >= 28 ? 3 : 4);

/** Completes an AI club's permanent signing (fee, asset, registration, history and optional signing story). */
export async function executeMarketTransfer(
  store: Store,
  player: Player,
  buyer: Club,
  fee: number,
  wage: number,
  storyKey?: string,
) {
  const state = await stateOf(store);
  const contractEnd = contractEndDate(state.date, marketContractYears(player.age), player.age);
  await ledger(store, buyer.id, -fee, "Transfer fees", `${player.name}: recruitment`);
  await transferProceeds(store, player.id, player.club_id!, fee, `${player.name}: sale`);
  await acquirePlayerAsset(store, buyer.id, player.id, fee, state.date, contractEnd);
  await store.run(
    "UPDATE clubs SET transfer_budget = transfer_budget - ?, season_spend = season_spend + ? WHERE id = ?",
    fee,
    fee,
    buyer.id,
  );
  const spanish = (await store.get<{ code: string }>("SELECT code FROM countries WHERE id = ?", buyer.country_id))?.code === "ES";
  const clause =
    spanish || optionalReleaseClause(player.id, buyer.id) ? releaseClauseFor({ ...player, value: Math.max(player.value, fee) }, spanish) : null;
  await store.run(
    `UPDATE players SET club_id = ?, squad_club_id = NULL, wage = ?, contract_end = ?, role = 'Squad player', morale = LEAST(99,morale + 4),
       listed = 0, available_loan = 0, profile = jsonb_set(profile::jsonb, '{contract}',
         (CASE WHEN jsonb_typeof(profile::jsonb -> 'contract') = 'object' THEN profile::jsonb -> 'contract' ELSE '{}'::jsonb END - 'releaseClause')
         || jsonb_build_object('status', 'professional', 'signedDate', ?::text)
         || CASE WHEN ?::double precision IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('releaseClause', ?::double precision) END)::text
     WHERE id = ?`,
    buyer.id,
    wage,
    contractEnd,
    state.date,
    clause,
    clause,
    player.id,
  );
  await endSpells(store, [player.id]);
  await store.run(
    "INSERT INTO history(season, entity_type, entity_id, date, data) VALUES (?, ?, ?, ?, ?)",
    state.season,
    "transfer",
    player.id,
    state.date,
    JSON.stringify({ name: player.name, from: player.club_id, to: buyer.id, club: buyer.name, fee }),
  );
  if (storyKey)
    await publishTransferStory(store, {
      key: storyKey,
      phase: "signing",
      playerId: player.id,
      buyerId: buyer.id,
      sellerId: player.club_id,
      fee,
    });
}

/**
 * Called by the world market instead of completing a move for a player on the director's shortlist: the bid waits
 * SHORTLIST_BID_DAYS so the director can open talks and compete. Returns false when a bid is already pending.
 */
export async function recordShortlistBid(store: Store, player: Player, buyer: Club, fee: number, wage: number) {
  const state = await stateOf(store);
  const bids = await marketBids(store);
  if (bids.some((bid) => bid.playerId === player.id) || bids.length >= MAX_MARKET_BIDS) return false;
  bids.push({
    playerId: player.id,
    clubId: buyer.id,
    fee,
    wage,
    date: state.date,
    due: addDays(state.date, SHORTLIST_BID_DAYS),
    source: "shortlist",
  });
  await store.setMeta(MARKET_BIDS_KEY, bids);
  const range = fuzzyFeeRange(fee, player.knowledge, "reported", seededDraw(state.seed, "market", player.id, buyer.id, fee));
  await news(
    store,
    "Transfers",
    `Shortlist alert: ${buyer.name} bid for ${player.name}`,
    `${buyer.name} have made an offer${range ? ` reported at ${money(range.low)}-${money(range.high)}` : ""} for ${player.name}. Open talks within ${SHORTLIST_BID_DAYS} days to compete; otherwise the move is expected to go through.`,
    "important",
    "transfers",
    {
      playerId: player.id,
      clubId: buyer.id,
      rival: true,
      shortlist: true,
      feeLow: range?.low,
      feeHigh: range?.high,
      deadline: addDays(state.date, SHORTLIST_BID_DAYS),
    },
  );
  await publishTransferRumour(store, {
    key: `market:${player.id}:${buyer.id}:${state.date}:bid`,
    phase: "bid",
    playerId: player.id,
    rivalId: buyer.id,
    named: true,
    sellerId: player.club_id,
    directorClubId: state.clubId,
    feeRange: range,
  });
  return true;
}

async function findRival(
  store: Store,
  negotiation: Negotiation,
  player: Player,
  rivals: RivalBid[],
  state: GameState,
  random: seedrandom.PRNG,
): Promise<RivalBid | null> {
  const seller = (await store.get<Club>("SELECT * FROM clubs WHERE id = ?", negotiation.selling_club_id))!;
  const candidates = await store.all<Club>(
    "SELECT * FROM clubs WHERE type = 'club' AND id NOT IN (?,?) AND reputation BETWEEN ? AND ? AND transfer_budget >= ? AND balance > ? AND (SELECT count(*) FROM players WHERE players.club_id = clubs.id AND age_group = 'Senior' AND role != 'Retired') < 28 ORDER BY (SELECT count(*) FROM players WHERE players.club_id = clubs.id AND players.position = ? AND age_group = 'Senior'),abs(reputation - ?),id LIMIT 6",
    state.clubId,
    seller.id,
    Math.max(1, player.ability - 12),
    player.ability + 14,
    Math.round(negotiation.asking_price * 0.9),
    Math.round(negotiation.asking_price * 0.9),
    player.position,
    player.ability + random() * 10,
  );
  const profile = JSON.parse(player.profile) as PlayerProfile;
  const policies = await clubPolicySnapshot(store, state.date);
  const ffp = (await settingsOf(store)).ffp !== false;
  for (const club of candidates) {
    if (rivals.some((rival) => rival.clubId === club.id)) continue;
    const policy = policies.get(club.id);
    if (policy?.embargo) continue;
    const moveScore = marketMoveInterest(player, profile, club, seller, state.date);
    if (moveScore < MOVE_REFUSAL_THRESHOLD) continue;
    const wage = marketWageOffer(player.wage, moveScore, await buyerGoingRate(store, player, club));
    if (wage === null) continue;
    // FFP: a rival only bids what its squad-cost headroom can carry.
    if (ffp && policy && signingHeadroomCost({ wage, fee: negotiation.asking_price * 0.9, years: marketContractYears(player.age) }, policy.feeCashShare) > policy.ffpHeadroom)
      continue;
    if ((await weeklyWages(store, club.id)) + wage > club.wage_budget) continue;
    if (!(await assessRegistration(store, player, club)).allowed) continue;
    return {
      clubId: club.id,
      since: state.date,
      status: "monitoring",
      fee: 0,
      wage,
      // The wage is sized to reach the acceptance band, so this is the estimate until terms are put to him.
      interest: Math.max(moveScore, PERSONAL_TERMS_THRESHOLD),
      raises: 0,
      nextAction: addDays(state.date, 2 + Math.floor(random() * 3)),
      source: "market",
    };
  }
  return null;
}

interface BattleContext {
  store: Store;
  state: GameState;
  negotiation: Negotiation;
  data: NegotiationData;
  battle: TransferBattle;
  player: Player;
  random: seedrandom.PRNG;
  phase: ReturnType<typeof windowPhase>;
  /** Row changes written with the data at the end of the day. */
  row: { stage: string; offer: number; asking_price: number };
}

async function announce(
  context: BattleContext,
  rival: RivalBid,
  phase: "monitoring" | "bid" | "final-offers" | "decision" | "refused",
  title: string,
  body: string,
  severity: string,
  extra: Record<string, unknown> = {},
) {
  const { store, state, negotiation, player } = context;
  const named = phase !== "monitoring" || player.knowledge >= 40;
  const range =
    rival.fee > 0
      ? fuzzyFeeRange(
          rival.fee,
          player.knowledge,
          phase === "final-offers" || phase === "decision" ? "confirmed" : "reported",
          seededDraw(state.seed, negotiation.id, rival.clubId, rival.fee),
        )
      : null;
  if (phase !== "monitoring")
    await news(store, "Transfers", title, body, severity, "transfers", {
      playerId: player.id,
      clubId: named ? rival.clubId : undefined,
      negotiationId: negotiation.id,
      rival: true,
      shortlist: !!player.shortlisted,
      feeLow: range?.low,
      feeHigh: range?.high,
      ...extra,
    });
  await publishTransferRumour(store, {
    key: `rival:${negotiation.id}:${rival.clubId}:${phase}${phase === "bid" ? `:${rival.fee}` : ""}`,
    phase,
    playerId: player.id,
    rivalId: rival.clubId,
    named,
    sellerId: negotiation.selling_club_id,
    directorClubId: state.clubId,
    feeRange: range,
    negotiationId: negotiation.id,
  });
}

function log(context: BattleContext, message: string) {
  context.data.log.push({ date: context.state.date, type: "Rival", message });
}

async function rivalClub(store: Store, id: number) {
  return (await store.get<Club>("SELECT * FROM clubs WHERE id = ?", id))!;
}

async function stepRival(context: BattleContext, rival: RivalBid) {
  const { store, state, battle, player, random, row } = context;
  const club = await rivalClub(store, rival.clubId);
  const floor = row.asking_price * SELLER_FLOOR;
  if (rival.status === "monitoring") {
    if (club.transfer_budget < row.asking_price * 0.8) {
      rival.status = "withdrawn";
      rival.outcome = "The club could not fund a bid.";
      return;
    }
    rival.status = "bid";
    rival.fee = Math.min(club.transfer_budget, Math.round(row.asking_price * (0.9 + random() * 0.12)));
    rival.nextAction = addDays(state.date, 1);
    log(context, `${club.name} have made a rival bid for ${player.name}.`);
    await announce(
      context,
      rival,
      "bid",
      `Rival bid for ${player.name}`,
      `${club.name} have bid for ${player.name}, a player you are negotiating for. The selling club must accept a fee and the player chooses between the clubs with agreed fees.`,
      "important",
    );
    return;
  }
  if (rival.status === "bid") {
    if (battle.status === "final-offers") {
      rival.nextAction = battle.finalOffersDeadline!;
      return;
    }
    const directorBidding = row.stage === "Club talks" && (context.data.offerCount ?? 0) > 0;
    if (directorBidding && context.phase === "open" && !battle.finalOffersRequested && random() < 0.7) {
      battle.status = "final-offers";
      battle.finalOffersRequested = true;
      battle.finalOffersDeadline = addDays(state.date, FINAL_OFFERS_DAYS);
      for (const other of context.data.rivals!)
        if (other.status === "bid") other.nextAction = battle.finalOffersDeadline;
      log(
        context,
        `The selling club has received competing bids and asks for best and final offers by ${battle.finalOffersDeadline}.`,
      );
      await announce(
        context,
        rival,
        "final-offers",
        `Final offers requested for ${player.name}`,
        `The selling club has competing bids and wants best and final offers by ${battle.finalOffersDeadline}. Bids within 5% of the best stand; the player then chooses.`,
        "important",
        { deadline: battle.finalOffersDeadline },
      );
      return;
    }
    if (rival.fee >= floor) {
      rival.status = "fee-agreed";
      rival.nextAction = addDays(state.date, 1);
      if (rival.fee > row.asking_price) row.asking_price = rival.fee;
      log(context, `The selling club has accepted ${club.name}'s bid. The player will now discuss terms with them.`);
      return;
    }
    const raised = Math.min(
      club.transfer_budget,
      Math.round(Math.max(rival.fee * 1.06, floor * (0.98 + random() * 0.06))),
    );
    if (rival.raises < 2 && raised > rival.fee && random() < 0.6) {
      rival.fee = raised;
      rival.raises++;
      rival.nextAction = addDays(state.date, 2);
      log(context, `${club.name} have improved their bid for ${player.name}.`);
      await announce(
        context,
        rival,
        "bid",
        `${club.name} raise their bid for ${player.name}`,
        `${club.name} have improved their offer after an initial rejection.`,
        "important",
      );
      return;
    }
    rival.status = "withdrawn";
    rival.outcome = "The selling club rejected the bid and the club withdrew.";
    log(context, `${club.name} have withdrawn from the race for ${player.name}.`);
    return;
  }
  // fee-agreed: the rival puts personal terms to the player.
  if (battle.status === "decision") {
    rival.nextAction = battle.decisionDeadline!;
    return;
  }
  let interest = await assessPlayerInterest(store, player, club, { wage: rival.wage, years: 4 });
  const cap = interest.expectedWage * MARKET_WAGE_PREMIUM_CAP;
  if (interest.refuses || interest.wageToAgree == null || interest.wageToAgree > cap) {
    rival.status = "lost";
    rival.outcome = interest.refuses
      ? `${player.name} is not interested in joining ${club.name}.`
      : `${club.name} would not meet ${player.name}'s personal demands.`;
    log(context, rival.outcome);
    await announce(context, rival, "refused", `${player.name} turns down ${club.name}`, rival.outcome, "info");
    return;
  }
  if (interest.wageToAgree > rival.wage) {
    rival.wage = interest.wageToAgree;
    interest = await assessPlayerInterest(store, player, club, { wage: rival.wage, years: 4 });
  }
  rival.interest = interest.score;
  rival.termsOffered = true;
  battle.status = "decision";
  battle.decisionDeadline = addDays(state.date, DECISION_DAYS);
  rival.nextAction = battle.decisionDeadline;
  const standing = directorScore({ stage: row.stage }, context.data);
  const prefers = leaning(rival.interest, standing);
  log(
    context,
    `${club.name} have an agreed fee and have offered personal terms. ${player.name} will choose by ${battle.decisionDeadline}.`,
  );
  await announce(
    context,
    rival,
    "decision",
    `${player.name} must choose: ${club.name} have agreed terms`,
    `${club.name} have an agreed fee and personal terms on the table. ${player.name} will decide by ${battle.decisionDeadline}. ${
      prefers === "you"
        ? "His agent says he currently prefers your project."
        : "His agent says your current proposal is not enough: agree personal terms he accepts, or sign, before the deadline."
    }`,
    "warning",
    { deadline: battle.decisionDeadline, preference: prefers },
  );
}

async function resolveFinalOffers(context: BattleContext) {
  const { store, state, battle, data, player, random, row } = context;
  const bidders = data.rivals!.filter((rival) => rival.status === "bid");
  for (const rival of bidders) {
    const club = await rivalClub(store, rival.clubId);
    rival.fee = Math.min(club.transfer_budget, Math.max(rival.fee, Math.round(rival.fee * (1 + random() * 0.08))));
  }
  const lodged = row.stage === "Club talks" ? (battle.userFinalOffer ?? null) : null;
  const result = finalOffersResult({
    floor: row.asking_price * SELLER_FLOOR,
    user: lodged,
    rivals: bidders.map((rival) => ({ clubId: rival.clubId, fee: rival.fee })),
  });
  for (const rival of bidders) {
    if (result.accepted.includes(rival.clubId)) {
      rival.status = "fee-agreed";
      rival.nextAction = addDays(state.date, context.phase === "last-day" ? 0 : 1);
      // The director cannot later agree a lower fee than the one the seller already accepted from a rival.
      row.asking_price = Math.max(row.asking_price, rival.fee);
    } else {
      rival.status = "lost";
      rival.outcome = "Outbid in the final offers.";
    }
  }
  if (result.userAccepted) {
    row.stage = "Agent talks";
    row.offer = lodged!;
    data.log.push({
      date: state.date,
      type: "Agent talks",
      message: `Final offers: the selling club accepted your fee of ${money(lodged!)}. Personal terms decide the race now.`,
    });
  } else
    log(
      context,
      lodged === null
        ? "Final offers closed without a fee from you. The selling club dealt with the other bidders."
        : `Final offers: your ${money(lodged)} was outbid. You can still improve your bid in club talks.`,
    );
  battle.status = "open";
  delete battle.finalOffersDeadline;
  delete battle.userFinalOffer;
  await news(
    store,
    "Transfers",
    `${player.name}: final offers decided`,
    result.userAccepted
      ? "The selling club accepted your final offer. The player will choose between the clubs with agreed fees."
      : "Your final offer was not accepted. Rival clubs with agreed fees will now talk to the player.",
    result.userAccepted ? "success" : "warning",
    "transfers",
    { playerId: player.id, negotiationId: context.negotiation.id, rival: true },
  );
}

async function decide(context: BattleContext) {
  const { store, battle, data, player, negotiation, row } = context;
  const contenders = data.rivals!.filter((rival) => rival.status === "fee-agreed" && rival.termsOffered);
  battle.status = "open";
  delete battle.decisionDeadline;
  if (!contenders.length) return false;
  const result = battleWinner({
    userStage: row.stage,
    userScore: directorScore({ stage: row.stage }, data),
    rivals: contenders,
  });
  if (!result) {
    for (const rival of contenders) {
      rival.status = "lost";
      rival.outcome = `${player.name} turned down their terms.`;
    }
    log(context, `${player.name} has turned down every rival package. Your talks continue.`);
    return false;
  }
  const best =
    result.winner === "rival"
      ? contenders.find((rival) => rival.clubId === result.clubId)!
      : contenders.reduce((top, rival) => (rival.interest > top.interest ? rival : top));
  const club = await rivalClub(store, best.clubId);
  if (result.winner === "user") {
    for (const rival of contenders) {
      rival.status = "lost";
      rival.outcome = `${player.name} chose your project.`;
    }
    log(context, `${player.name} has chosen your project over ${club.name}.`);
    await news(store, "Transfers", `${player.name} chooses your club`, `${player.name} turned down ${club.name}. Complete the agreement before anything changes.`, "success", "transfers", {
      playerId: player.id,
      clubId: club.id,
      negotiationId: negotiation.id,
      rival: true,
    });
    return false;
  }
  const allowed = await marketTransferAllowed(store, player.id, club.id, negotiation.selling_club_id!, best.fee, best.wage);
  if (!allowed) {
    best.status = "withdrawn";
    best.outcome = `${club.name}'s move fell through before registration.`;
    log(context, best.outcome);
    return false;
  }
  await executeMarketTransfer(store, allowed.player, allowed.buyer, best.fee, best.wage, `rival:${negotiation.id}:${club.id}:signing`);
  best.status = "won";
  best.outcome = `${player.name} chose ${club.name}.`;
  for (const rival of data.rivals!)
    if (isActive(rival)) {
      rival.status = "lost";
      rival.outcome = `${player.name} joined ${club.name}.`;
    }
  return true;
}

async function saveBattle(context: BattleContext) {
  await context.store.run(
    "UPDATE negotiations SET stage = ?, offer = ?, asking_price = ?, data = ? WHERE id = ?",
    context.row.stage,
    context.row.offer,
    context.row.asking_price,
    JSON.stringify(context.data),
    context.negotiation.id,
  );
}

/**
 * Daily transfer battles for the director's permanent purchases: rivals appear (bounded, need- and budget-driven),
 * bid, raise or withdraw; the selling club may call for final offers; a rival with an agreed fee puts terms to the
 * player, who then chooses by his interest in each club. Also settles pending market bids (shortlist alerts and
 * rivals left over when the director's talks closed). Uses its own seeded stream so other daily systems keep theirs.
 */
export async function processTransferBattles(store: Store) {
  const state = await stateOf(store);
  const random = seedrandom(`${state.seed}:battles:${state.date}`);
  const phase = windowPhase(state.date);
  let pending = await marketBids(store);
  const pendingBefore = JSON.stringify(pending);
  const negotiations = await store.all<Negotiation>(
    `SELECT * FROM negotiations WHERE buying_club_id = ? AND selling_club_id IS NOT NULL AND type = 'Permanent transfer' AND stage IN ('Enquiry','Club talks','Agent talks','Contract review') AND deadline >= ? ORDER BY id DESC LIMIT ${MAX_BATTLES_PER_DAY}`,
    state.clubId,
    state.date,
  );
  let created = 0;
  for (const negotiation of negotiations) {
    const data = JSON.parse(negotiation.data) as NegotiationData;
    const rivals = data.rivals ?? [];
    const waiting = pending.find((bid) => bid.playerId === negotiation.player_id);
    const drawRival =
      phase !== "closed" &&
      created < NEW_RIVALS_PER_DAY &&
      canAddRival(rivals, state.date) &&
      random() < rivalChance({ publicTalks: !!negotiation.public, deadlineWeek: deadlineWeek(state.date) });
    if (!waiting && !drawRival && !rivals.some(isActive)) continue;
    const player = (await store.get<Player>("SELECT * FROM players WHERE id = ?", negotiation.player_id))!;
    if (player.club_id !== negotiation.selling_club_id || player.parent_club_id) continue;
    let changed = false;
    if (waiting) {
      pending = pending.filter((bid) => bid !== waiting);
      if (!rivals.some((rival) => rival.clubId === waiting.clubId))
        rivals.push({
          clubId: waiting.clubId,
          since: waiting.date,
          status: "bid",
          fee: waiting.fee,
          wage: waiting.wage,
          interest: PERSONAL_TERMS_THRESHOLD,
          raises: 0,
          nextAction: state.date,
          source: "shortlist",
        });
      changed = true;
    }
    if (drawRival) {
      const rival = await findRival(store, negotiation, player, rivals, state, random);
      if (rival) {
        rivals.push(rival);
        created++;
        changed = true;
      }
    }
    if (!rivals.length) continue;
    data.rivals = rivals;
    const context: BattleContext = {
      store,
      state,
      negotiation,
      data,
      battle: (data.battle ??= { status: "open" }),
      player,
      random,
      phase,
      row: { stage: negotiation.stage, offer: negotiation.offer, asking_price: negotiation.asking_price },
    };
    let hijacked = false;
    if (phase === "closed") {
      // Rivals cannot register him until the next window: their pursuit ends; the director may still agree a deal.
      for (const rival of rivals.filter(isActive)) {
        rival.status = "withdrawn";
        rival.outcome = "The transfer window closed before the club could complete a move.";
        changed = true;
      }
      if (changed) {
        context.battle.status = "open";
        delete context.battle.finalOffersDeadline;
        delete context.battle.userFinalOffer;
        delete context.battle.decisionDeadline;
        log(context, `The transfer window has closed: rival clubs are no longer pursuing ${player.name}.`);
      }
    } else {
      const fresh = rivals.filter((rival) => rival.since === state.date && rival.status === "monitoring");
      for (const rival of fresh) {
        if (player.knowledge >= 40)
          log(context, `${(await rivalClub(store, rival.clubId)).name} are reported to be monitoring ${player.name}.`);
        await announce(context, rival, "monitoring", "", "", "info");
      }
      const closing = phase === "last-day";
      if (
        context.battle.status === "final-offers" &&
        (context.battle.finalOffersDeadline! <= state.date || closing)
      ) {
        await resolveFinalOffers(context);
        changed = true;
      }
      for (const rival of rivals.filter((entry) => isActive(entry) && entry.nextAction <= state.date)) {
        await stepRival(context, rival);
        changed = true;
      }
      if (context.battle.status === "decision" && (context.battle.decisionDeadline! <= state.date || closing)) {
        hijacked = await decide(context);
        changed = true;
      }
    }
    if (!changed) continue;
    await saveBattle(context);
    if (hijacked) {
      const winner = rivals.find((rival) => rival.status === "won")!;
      const club = await rivalClub(store, winner.clubId);
      await closeNegotiation(
        store,
        negotiation,
        "Hijacked",
        `${player.name} chose ${club.name}: their agreed fee and personal terms beat your proposal.`,
      );
      await news(store, "Transfers", `${player.name} joins ${club.name}`, `${player.name} chose ${club.name} over your club. Your negotiation has closed.`, "warning", "transfers", {
        playerId: player.id,
        clubId: club.id,
        negotiationId: negotiation.id,
        rival: true,
      });
    }
  }
  pending = await handOverRivals(store, state, pending);
  pending = await settleMarketBids(store, state, pending);
  if (JSON.stringify(pending) !== pendingBefore) await store.setMeta(MARKET_BIDS_KEY, pending);
}

/** Rivals with live bids keep chasing the player after the director withdraws or his talks expire. */
async function handOverRivals(store: Store, state: GameState, pending: MarketBid[]) {
  for (const negotiation of await store.all<Negotiation>(
    `SELECT * FROM negotiations WHERE buying_club_id = ? AND stage IN ('Withdrawn','Rejected','Expired') AND deadline >= ? AND data LIKE ? AND data NOT LIKE ? ORDER BY id DESC LIMIT ${MAX_BATTLES_PER_DAY}`,
    state.clubId,
    addDays(state.date, -14),
    '%"rivals":[{%',
    '%"handedOver":true%',
  )) {
    const data = JSON.parse(negotiation.data) as NegotiationData;
    const live = (data.rivals ?? [])
      .filter((rival) => rival.status === "bid" || rival.status === "fee-agreed")
      .sort((left, right) => right.fee - left.fee)[0];
    for (const rival of data.rivals ?? [])
      if (isActive(rival)) {
        rival.status = "lost";
        rival.outcome = "Your talks closed before the race was decided.";
      }
    data.battle = { ...(data.battle ?? { status: "open" }), status: "open", handedOver: true };
    await store.run("UPDATE negotiations SET data = ? WHERE id = ?", JSON.stringify(data), negotiation.id);
    if (live && !pending.some((bid) => bid.playerId === negotiation.player_id) && pending.length < MAX_MARKET_BIDS)
      pending.push({
        playerId: negotiation.player_id,
        clubId: live.clubId,
        fee: live.fee,
        wage: live.wage,
        date: state.date,
        due: addDays(state.date, 1),
        source: "handover",
      });
  }
  return pending;
}

/** Completes pending market bids when due (fresh checks); drops the ones that are no longer possible. */
async function settleMarketBids(store: Store, state: GameState, pending: MarketBid[]) {
  const remaining: MarketBid[] = [];
  for (const bid of pending) {
    if (bid.due > state.date) {
      remaining.push(bid);
      continue;
    }
    // Due: the move completes now if it is still possible, otherwise the bid lapses.
    if (!transferWindow(state.date)) continue;
    const talks = await store.get<{ id: number }>(
      "SELECT id FROM negotiations WHERE player_id = ? AND stage NOT IN ('Completed','Rejected','Withdrawn','Expired','Hijacked') LIMIT 1",
      bid.playerId,
    );
    const player = await store.get<Player>("SELECT * FROM players WHERE id = ?", bid.playerId);
    if (talks || !player?.club_id) continue;
    const family = await store.get<{ id: number }>(
      "SELECT id FROM clubs WHERE id = ? AND (id = ? OR parent_id = ?)",
      player.club_id,
      state.clubId,
      state.clubId,
    );
    if (family) continue;
    const buyer = await rivalClub(store, bid.clubId);
    const profile = JSON.parse(player.profile) as PlayerProfile;
    const seller = await rivalClub(store, player.club_id);
    if (marketWageOffer(player.wage, marketMoveInterest(player, profile, buyer, seller, state.date)) === null) continue;
    const allowed = await marketTransferAllowed(store, player.id, buyer.id, player.club_id, bid.fee, bid.wage);
    if (!allowed) continue;
    await executeMarketTransfer(store, allowed.player, allowed.buyer, bid.fee, bid.wage, `market:${player.id}:${buyer.id}:signing`);
    if (player.shortlisted)
      await news(store, "Transfers", `Shortlist: ${player.name} joins ${buyer.name}`, `${player.name} has completed a move to ${buyer.name}. He remains on your shortlist at his new club.`, "important", "transfers", {
        playerId: player.id,
        clubId: buyer.id,
        rival: true,
        shortlist: true,
      });
  }
  return remaining;
}
