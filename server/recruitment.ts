import { Store } from "./db.ts";
import {
  addDays,
  clamp,
  daysBetween,
  INTEREST_BANDS,
  money,
  tacticalFit,
} from "../shared/rules.ts";
import type {
  Club,
  Country,
  GameState,
  Player,
  PlayerInterest,
  PlayerProfile,
  Settings,
} from "../shared/types.ts";
import type { YouthTransferAssessment } from "../shared/api.ts";
import {
  clubRegistration,
  heldNationalities,
  minorRoute,
  passportGroup,
  residenceYears,
  type MinorRoute,
  type MinorRouteResult,
} from "./registration.ts";
import { marketWage, wageScale } from "./finance.ts";

/**
 * Weekly wage a club-less player expects: the buyer's going rate for his level, but at least a share of what
 * comparable seniors earn in the buyer's league nation (75%; 60% at 20 or younger and from 33) and never below 50.
 */
export function clublessWageExpectation(goingRate: number, comparableWage: number | null | undefined, age: number) {
  const share = age <= 20 || age >= 33 ? 0.6 : 0.75;
  return Math.max(50, Math.round(goingRate / 10) * 10, Math.round(((comparableWage ?? 0) * share) / 10) * 10);
}

export const YOUTH_TRANSFER_SOURCE =
  "FIFA RSTP January 2025, articles 2, 18, 19 and 20, Annexe 4; simplified game implementation";
export const YOUTH_TRANSFER_URL =
  "https://digitalhub.fifa.com/m/696d877ea35ca761/original/Regulations-on-the-Status-and-Transfer-of-Players-January-2025-edition.pdf";
/** Overall interest (wages included) a player needs before agreeing personal terms. */
export const PERSONAL_TERMS_THRESHOLD = INTEREST_BANDS.agree;
/**
 * Most a wage offer can add to interest. A player at the refusal floor (50) reaches the acceptance threshold (85)
 * on wages alone only with a ~66% premium over his expectation and fresh talks; a credible role, promises and
 * contract security reduce the premium needed.
 */
export const WAGE_INTEREST_CAP = 35;
/** Most a below-expectation wage can subtract from interest. */
export const WAGE_INTEREST_FLOOR = -24;
/** Interest points per doubling of the wage above (premium) and below (shortfall) the expectation. */
const WAGE_PREMIUM_SLOPE = 48;
const WAGE_SHORTFALL_SLOPE = 24;
/** Below this interest in the move itself (wages excluded) the player will not negotiate. */
export const MOVE_REFUSAL_THRESHOLD = INTEREST_BANDS.refuse;
/** AI clubs pay at most this multiple of the player's wage expectation to win him over. */
export const MARKET_WAGE_PREMIUM_CAP = 1.5;

/** Interest impact of a weekly wage offer against the player's expectation. */
export function wageInterest(wage: number, expected: number) {
  const doublings = Math.log2(Math.max(1, wage) / Math.max(1, expected));
  return doublings >= 0
    ? Math.min(WAGE_INTEREST_CAP, doublings * WAGE_PREMIUM_SLOPE)
    : Math.max(WAGE_INTEREST_FLOOR, doublings * WAGE_SHORTFALL_SLOPE);
}

/** Lowest weekly wage (whole tens, never below `expected`) adding `needed` interest; null when above the cap. */
export function wageForInterest(expected: number, needed: number) {
  if (needed > WAGE_INTEREST_CAP) return null;
  const floor = Math.max(1, Math.round(expected));
  if (needed <= 0) return floor;
  return Math.max(floor, Math.ceil((floor * 2 ** (needed / WAGE_PREMIUM_SLOPE)) / 10) * 10);
}

/** Interest in the move itself: the score with the personal-terms (wage) factor removed. */
export function moveInterest(factors: PlayerInterest["factors"]) {
  return Math.round(
    clamp(
      60 +
        factors.reduce(
          (total, entry) => total + (entry.id === "wages" ? 0 : entry.impact),
          0,
        ),
      1,
      99,
    ),
  );
}

export type PersonalTermsOutcome = "refused" | "hesitant" | "wage" | "agreed";

/** The player's answer to personal terms; `wageMet` is whether the offered wage meets the agent's demand. */
export function personalTermsOutcome(
  interest: Pick<PlayerInterest, "score" | "factors">,
  wageMet: boolean,
): PersonalTermsOutcome {
  if (moveInterest(interest.factors) < MOVE_REFUSAL_THRESHOLD) return "refused";
  if (interest.score < PERSONAL_TERMS_THRESHOLD) return "hesitant";
  return wageMet ? "agreed" : "wage";
}

/** Stance label for the interest bands (see INTEREST_BANDS). */
export function interestStance(score: number, refuses: boolean) {
  return refuses
    ? "Not interested"
    : score >= INTEREST_BANDS.agree
      ? "Very interested"
      : score >= INTEREST_BANDS.interested
        ? "Interested"
        : score >= INTEREST_BANDS.refuse
          ? "Open to talks"
          : "Needs convincing";
}

function ambitionImpact(buyerReputation: number, sellerReputation: number, ambition: number) {
  return clamp((buyerReputation - sellerReputation) * (0.45 + ambition / 150), -35, 22);
}

function developmentImpact(
  age: number,
  buyer: Pick<Club, "facilities" | "academy">,
  seller: Pick<Club, "facilities" | "academy"> | undefined,
  loan: boolean,
) {
  const development =
    age < 24 ? (buyer.facilities + buyer.academy - ((seller?.facilities ?? 40) + (seller?.academy ?? 40))) / 16 : 0;
  return clamp(development + (loan && age < 23 ? 5 : 0), -10, 12);
}

function settledAtClub(player: Pick<Player, "listed" | "morale" | "contract_end">, date: string) {
  return !player.listed && player.morale >= 65 && daysBetween(date, player.contract_end) > 365;
}

function situationImpact(player: Pick<Player, "listed" | "morale" | "contract_end">, date: string, loyalty: number) {
  return player.listed ? 8 : player.morale < 50 ? 6 : settledAtClub(player, date) ? -loyalty / 9 : 0;
}

/**
 * Query-free estimate of a player's interest in an AI club's move (wages excluded), for daily market loops:
 * the same ambition, development, situation and tactical-fit formulas as assessPlayerInterest, with the club's
 * credible role (no minutes factor), no continental factor and relocation judged on country alone.
 */
export function marketMoveInterest(
  player: Player,
  profile: PlayerProfile,
  buyer: Club,
  seller: Club | undefined,
  date: string,
) {
  const factors = [
    ambitionImpact(
      buyer.reputation,
      seller?.reputation ?? Math.max(20, player.ability - 8),
      profile.personality.ambition ?? 50,
    ),
    developmentImpact(player.age, buyer, seller, false),
    seller?.country_id === buyer.country_id || player.country_id === buyer.country_id
      ? 4
      : -(3 + (100 - (profile.personality.adaptability ?? 50)) / 16),
    situationImpact(player, date, profile.personality.loyalty ?? 50),
    clamp((tacticalFit(player, buyer) - 65) / 5, -9, 7),
  ];
  return Math.round(clamp(60 + factors.reduce((total, impact) => total + Math.round(impact), 0), 1, 99));
}

/**
 * Weekly wage an AI club offers to bring `moveScore` up to the acceptance threshold, from an expectation of the
 * current wage plus 10% or the buyer's going rate for the player (`goingRate`, its payroll scale), whichever is
 * higher; null when the player refuses or the premium needed exceeds MARKET_WAGE_PREMIUM_CAP.
 */
export function marketWageOffer(currentWage: number, moveScore: number, goingRate = 0) {
  if (moveScore < MOVE_REFUSAL_THRESHOLD) return null;
  const expected = Math.max(50, Math.round(currentWage * 1.1), Math.round(goingRate));
  const wage = wageForInterest(expected, PERSONAL_TERMS_THRESHOLD - moveScore);
  return wage === null || wage > expected * MARKET_WAGE_PREMIUM_CAP ? null : wage;
}

/** What `buyer` pays a player of this level on its own payroll scale (the AI's wage anchor for a move). */
export async function buyerGoingRate(store: Store, player: Pick<Player, "ability" | "age" | "age_group">, buyer: Pick<Club, "id">) {
  return marketWage({ ...player, wage: 0 }, await wageScale(store, buyer.id));
}

/** Interest a renewal adds for a player who is settled at his club (continuity, no relocation or new-role risk). */
export function renewalContinuity(player: Pick<Player, "listed" | "morale">) {
  return player.listed ? -10 : player.morale < 50 ? -6 : 12;
}

/** FIFA training-compensation rates per year (EUR 90k/60k/30k/10k at the game's EUR 1 = GBP 0.86), by academy rating. */
export function trainingCategoryRate(academy: number) {
  return academy >= 80 ? 77_400 : academy >= 65 ? 51_600 : academy >= 45 ? 25_800 : 8_600;
}

/**
 * Training compensation owed for a youth player's first professional registration elsewhere: years from the
 * training start age to 21, at the category IV rate for ages 12-15 and the new club's category rate from 16
 * (FIFA RSTP Annexe 4, arts. 4-5). England's EPPP fixed fees are not modelled.
 */
export function trainingCompensationFee(age: number, trainingStartAge: number, buyerAcademy: number) {
  const start = clamp(Math.round(trainingStartAge), 12, 21);
  const end = Math.max(start + 1, Math.min(Math.floor(age), 21));
  let total = 0;
  for (let year = start; year < end; year++) total += year < 16 ? 8_600 : trainingCategoryRate(buyerAcademy);
  return total;
}

const ROLES: Record<string, number> = {
  Prospect: 0,
  "Fringe player": 1,
  "Squad player": 2,
  "Regular starter": 3,
  "Key player": 4,
  Captain: 4,
};

export async function assessPlayerInterest(
  store: Store,
  player: Player,
  buyer: Club,
  offer: {
    loan?: boolean;
    role?: string;
    wage?: number;
    years?: number;
    promises?: string[];
    playingTime?: number;
    tension?: number;
  } = {},
): Promise<PlayerInterest> {
  const state = await store.meta<GameState>("state");
  const settings = await store.meta<Settings>("settings");
  const profile = JSON.parse(player.profile) as PlayerProfile;
  const seller = player.club_id
    ? await store.get<Club>(
        "SELECT * FROM clubs WHERE id = ?",
        player.parent_club_id ?? player.club_id,
      )
    : undefined;
  const renewal = seller?.id === buyer.id;
  const ambition = profile.personality.ambition ?? 50;
  const loyalty = profile.personality.loyalty ?? 50;
  const factors: PlayerInterest["factors"] = [];
  const factor = (id: string, label: string, impact: number, reason: string) =>
    factors.push({ id, label, impact: Math.round(impact), reason });
  const peerCount = (await store.get<{ count: number }>(
    "SELECT count(*) AS count FROM players WHERE club_id = ? AND id != ? AND parent_club_id IS NULL AND age_group = 'Senior' AND position = ? AND ability > ? AND role != 'Retired'",
    buyer.id,
    player.id,
    player.position,
    player.ability + 3,
  ))!.count;
  const credibleRole =
    peerCount === 0
      ? "Key player"
      : peerCount === 1
        ? "Regular starter"
        : peerCount < 4
          ? "Squad player"
          : "Fringe player";
  const expectedRole =
    player.age < 18
      ? "Prospect"
      : player.age < 22 && player.role === "Prospect"
        ? "Squad player"
        : player.role === "Captain"
          ? "Key player"
          : player.role;
  const wantedRank = ROLES[expectedRole] ?? 2;
  const credibleRank = ROLES[credibleRole];
  const offeredRank = ROLES[offer.role ?? credibleRole] ?? 2;
  factor(
    "ambition",
    "Sporting ambition",
    renewal
      ? 2
      : ambitionImpact(
          buyer.reputation,
          seller?.reputation ?? Math.max(20, player.ability - 8),
          ambition,
        ),
    renewal
      ? "Continuity at the current club."
      : `${buyer.name}'s reputation is ${Math.round(buyer.reputation)} versus ${Math.round(seller?.reputation ?? player.ability)} at the player's current level. Ambition changes how much this matters.`,
  );
  const unrealistic = !!offer.role && offeredRank > credibleRank + 1;
  factor(
    "minutes",
    "Role and playing time",
    unrealistic
      ? -12
      : clamp(
          (offeredRank - wantedRank) * 4 +
            (offer.loan ? ((offer.playingTime ?? 65) - 45) / 4 : 0),
          -16,
          14,
        ),
    unrealistic
      ? `${offer.role} is not credible with ${peerCount} stronger players in this position. A clearer route to minutes is needed.`
      : `${peerCount} stronger players compete in this position. Expected role: ${expectedRole.toLowerCase()}${offer.role ? `; proposed role: ${offer.role.toLowerCase()}` : `; likely role: ${credibleRole.toLowerCase()}`}.`,
  );
  factor(
    "development",
    "Development environment",
    developmentImpact(player.age, buyer, seller, !!offer.loan),
    player.age < 24
      ? `Training facilities ${buyer.facilities}/99 and academy ${buyer.academy}/99 ${offer.loan ? "are assessed alongside the loan pathway" : "shape the development opportunity"}.`
      : "Development infrastructure is a secondary concern at this career stage.",
  );
  const continentalClubs = new Set(
    (
      await store.all<{ club_id: number }>(
        "SELECT DISTINCT standings.club_id FROM standings JOIN leagues ON leagues.id = standings.league_id WHERE standings.club_id IN (?,?) AND leagues.kind = 'continental' AND leagues.age_group = 'Senior'",
        buyer.id,
        seller?.id ?? buyer.id,
      )
    ).map((entry) => entry.club_id),
  );
  const buyerEurope = continentalClubs.has(buyer.id);
  const sellerEurope = !!seller && continentalClubs.has(seller.id);
  const wantsEurope = profile.careerVision.some((goal) =>
    goal.includes("Champions League"),
  );
  factor(
    "competition",
    "Continental football",
    buyerEurope
      ? wantsEurope
        ? 9
        : 5
      : sellerEurope
        ? -10
        : wantsEurope
          ? -3
          : 0,
    buyerEurope
      ? "The destination has a continental competition entry."
      : sellerEurope
        ? "This move gives up a current continental place."
        : wantsEurope
          ? "The player's ambition includes Champions League football, which this offer does not currently provide."
          : "Neither club offers a current continental step up.",
  );
  const destination = (await store.get<Country>(
    "SELECT * FROM countries WHERE id = ?",
    buyer.country_id,
  ))!;
  const language =
    profile.identity.languages.find(
      (entry) => entry.language === destination.language,
    )?.fluency ?? 0;
  const nationality = (await store.get<{ code: string }>(
    "SELECT code FROM countries WHERE id = ?",
    player.country_id,
  ))?.code;
  // Cross-border clubs (Derry, Toronto, Monaco) play in their host league, which is familiar ground too.
  const market = buyer.league_id
    ? await store.get<{ id: number; code: string }>(
        "SELECT countries.id,countries.code FROM leagues JOIN countries ON countries.id = leagues.country_id WHERE leagues.id = ?",
        buyer.league_id,
      )
    : undefined;
  const destinationGroups = new Set([destination.code, market?.code ?? destination.code].map(passportGroup));
  const familiar =
    seller?.country_id === buyer.country_id ||
    (!!market && seller?.country_id === market.id) ||
    player.country_id === buyer.country_id ||
    profile.identity.birthCountryId === buyer.country_id ||
    (!!nationality &&
      heldNationalities(nationality, profile).some((code) => destinationGroups.has(passportGroup(code))));
  const family =
    profile.familyMove?.verified &&
    profile.familyMove.reason !== "football" &&
    profile.familyMove.countryId === buyer.country_id &&
    profile.familyMove.date <= state.date;
  factor(
    "relocation",
    "Language and family",
    renewal
      ? 0
      : family
        ? 8
        : familiar
          ? 4
          : language >= 3
            ? 1
            : -(3 + (100 - (profile.personality.adaptability ?? 50)) / 16),
    renewal
      ? "No relocation is needed."
      : family
        ? "A documented family move to this country reduces relocation concerns."
        : familiar
          ? "The destination is a familiar country."
          : language >= 3
            ? "The player speaks the destination's main language."
            : `A move to ${destination.name} requires language and cultural adaptation.`,
  );
  const settled = settledAtClub(player, state.date);
  factor(
    "loyalty",
    "Current situation and loyalty",
    renewal ? loyalty / 15 + renewalContinuity(player) : situationImpact(player, state.date, loyalty),
    renewal
      ? player.listed
        ? "The club has made him available, which undermines trust in a new contract."
        : player.morale < 50
          ? "He is unhappy at the club, so continuity counts against a new contract."
          : "A renewal keeps a settled player in a familiar role, team and city."
      : player.listed
        ? "The current club has made the player available."
        : player.morale < 50
          ? "Unhappiness at the current club creates interest in a fresh start."
          : settled
            ? "The player is settled and has time remaining on the current contract."
            : "The current contract situation does not strongly prevent a move.",
  );
  const fit = tacticalFit(player, buyer);
  factor(
    "fit",
    "Tactical fit",
    clamp((fit - 65) / 5, -9, 7),
    `The proposed club's style and positional fit score is ${Math.round(fit)}/100.`,
  );
  const difficulty =
    settings.negotiationDifficulty === "relaxed"
      ? -0.1
      : settings.negotiationDifficulty === "ruthless"
        ? 0.07
        : 0;
  // Club-less players have no wage to defend: the destination's going rate, floored by what their level earns there.
  // Contracted players expect at least their wage and the buyer's own going rate (its payroll scale), not an
  // English-scale base wage; for a renewal the buyer is the current club.
  const scale = await wageScale(store, buyer.id);
  const expectedBase =
    player.club_id === null
      ? clublessWageExpectation(
          marketWage({ ...player, age_group: "Senior", age: Math.max(21, player.age), wage: 0 }, scale),
          (await store.get<{ wage: number | null }>(
            "SELECT avg(CONVERT(float,players.wage)) AS wage FROM clubs JOIN leagues ON leagues.id = clubs.league_id JOIN players ON players.club_id = clubs.id WHERE leagues.country_id = coalesce((SELECT country_id FROM leagues WHERE id = ?),?) AND clubs.type != 'national' AND players.parent_club_id IS NULL AND players.age_group = 'Senior' AND players.role != 'Retired' AND players.ability BETWEEN ? AND ? AND coalesce(JSON_VALUE(players.profile,'$.contract.status'),'professional') = 'professional'",
            buyer.league_id ?? -1,
            buyer.country_id,
            player.ability - 2,
            player.ability + 2,
          ))?.wage,
          player.age,
        )
      : marketWage(player, scale);
  const agentPremium =
    ((profile.agent.difficulty / 500) * Number(settings.agentIntensity ?? 60)) / 60;
  // A renewal asks a modest raise over the current deal (half the agent premium); a move asks a 10% step up.
  const expectedWage = Math.round(
    expectedBase *
      (offer.loan
        ? 1
        : Math.max(
            renewal ? 1 : 0.9,
            (renewal ? 1 + agentPremium / 2 : 1.1 + agentPremium) +
              difficulty -
              state.director.skills.negotiations * 0.012,
          )),
  );
  factor(
    "wages",
    "Personal terms",
    offer.wage === undefined ? 0 : wageInterest(offer.wage, expectedWage),
    offer.wage === undefined
      ? `Indicative weekly expectation: ${money(expectedWage)}. Personal terms have not been offered.`
      : `Proposed ${money(offer.wage)} per week against an expectation of ${money(expectedWage)}. Financial attraction is capped.`,
  );
  const security =
    offer.years !== undefined &&
    profile.careerVision.includes("Wants long-term security")
      ? clamp((offer.years - 2) * 2, -4, 6)
      : 0;
  factor(
    "security",
    "Contract security",
    security,
    offer.years
      ? `A ${offer.years}-year term ${security > 0 ? "supports the player's preference for stability" : "is being considered alongside the career plan"}.`
      : "Contract duration has not been offered yet.",
  );
  const promises = offer.promises ?? [];
  const hollow =
    (promises.includes("European football") && !buyerEurope) ||
    (promises.includes("First-team minutes") && offeredRank < 3 && !offer.loan);
  factor(
    "promises",
    "Promise credibility",
    hollow ? -8 : promises.length ? 2 : 0,
    hollow
      ? "At least one promise is not backed by the club's current competition entry or proposed squad role."
      : promises.length
        ? "The promises are consistent with the current proposal, but will still need to be delivered."
        : "No additional promises have been made.",
  );
  factor(
    "talks",
    "Trust in negotiations",
    -clamp((offer.tension ?? 15) - 25, 0, 60) / 6,
    (offer.tension ?? 15) > 35
      ? "Repeated difficult talks are reducing trust."
      : "The negotiation relationship is still workable.",
  );
  const score = Math.round(
    clamp(
      60 + factors.reduce((total, entry) => total + entry.impact, 0),
      1,
      99,
    ),
  );
  const moveScore = moveInterest(factors);
  const refuses = moveScore < MOVE_REFUSAL_THRESHOLD;
  const concerns = factors
    .filter((entry) => entry.impact <= -5)
    .sort((left, right) => left.impact - right.impact)
    .map((entry) => entry.reason);
  const withoutWages =
    60 + factors.reduce((total, entry) => total + (entry.id === "wages" ? 0 : entry.impact), 0);
  return {
    score,
    moveScore,
    refuses,
    thresholds: { negotiate: MOVE_REFUSAL_THRESHOLD, agree: PERSONAL_TERMS_THRESHOLD },
    stance: interestStance(score, refuses),
    expectedRole,
    expectedWage,
    wageToAgree: refuses
      ? null
      : wageForInterest(expectedWage, PERSONAL_TERMS_THRESHOLD - withoutWages),
    factors,
    concerns: refuses
      ? [
          renewal
            ? `Not interested in a new contract at ${buyer.name}: better wages cannot change that.`
            : `Not interested in joining ${buyer.name}: better wages cannot make this move attractive.`,
          ...concerns,
        ]
      : concerns,
  };
}
const SAFEGUARDS = [
  "football",
  "education",
  "care",
  "mentor",
  "parentalConsent",
] as const;

// The shared API union has no "first-registration"/"border"/"humanitarian" values yet (shared/api.ts is Data's).
const API_ROUTE: Record<MinorRoute, YouthTransferAssessment["route"]> = {
  adult: "adult",
  domestic: "domestic",
  "first-registration": "domestic",
  "eu-eea": "eu-eea",
  "same-country": "same-country",
  "parent-relocation": "parent-relocation",
  border: "same-country",
  humanitarian: "parent-relocation",
  blocked: "blocked",
};

type RouteAssessment = Pick<
  YouthTransferAssessment,
  "route" | "reasons" | "minor" | "international" | "eligibleToApply"
>;
const apiRoute = (route: MinorRouteResult): RouteAssessment => ({
  ...route,
  route: API_ROUTE[route.route],
});

/** Association-level route for a national of `source` (see registration.minorRoute for nationality-aware rules). */
export function minorTransferRoute(
  age: number,
  source: string,
  destination: string,
  independentParentMove = false,
): RouteAssessment {
  return apiRoute(
    minorRoute({
      age,
      nationalities: [source],
      source: { home: source, association: source },
      destination: { home: destination, association: destination },
      parentsMoved: independentParentMove,
    }),
  );
}

/** Nationality-aware Article 19 route for moving `player` to `buyer` (or registering a club-less player there). */
export async function playerMinorRoute(
  store: Store,
  player: Player,
  buyer: Club,
  date: string,
) {
  const profile = JSON.parse(player.profile) as PlayerProfile;
  const countries = new Map(
    (
      await store.all<Country>(
        "SELECT * FROM countries WHERE id IN (?,?,?,?)",
        player.country_id,
        buyer.country_id,
        profile.registration?.lastAssociationId ?? player.country_id,
        profile.homeBased?.countryId ?? player.country_id,
      )
    ).map((country) => [country.id, country]),
  );
  const current = player.club_id
    ? await store.get<Club & { code: string }>(
        "SELECT clubs.*,countries.code FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE clubs.id = ?",
        player.parent_club_id ?? player.club_id,
      )
    : undefined;
  const lastCode = countries.get(
    profile.registration?.lastAssociationId ?? profile.homeBased?.countryId ?? -1,
  )?.code;
  const source = current
    ? clubRegistration(current.code, current.data)
    : lastCode
      ? { home: lastCode, association: lastCode }
      : null;
  const family = profile.familyMove;
  return minorRoute({
    age: player.age,
    nationalities: heldNationalities(countries.get(player.country_id)!.code, profile),
    source,
    destination: clubRegistration(countries.get(buyer.country_id)!.code, buyer.data),
    residenceYears: residenceYears(profile, buyer.country_id, player.birth_date, date),
    parentsMoved:
      !!family &&
      family.verified &&
      family.reason !== "football" &&
      family.countryId === buyer.country_id &&
      family.date <= date,
  });
}

export async function assessYouthTransfer(
  store: Store,
  player: Player,
  buyer: Club,
): Promise<YouthTransferAssessment> {
  const state = await store.meta<GameState>("state");
  const profile = JSON.parse(player.profile) as PlayerProfile;
  const currentClub = player.club_id
    ? await store.get<Club>(
        "SELECT * FROM clubs WHERE id = ?",
        player.parent_club_id ?? player.club_id,
      )
    : undefined;
  const sourceCountryId =
    currentClub?.country_id ??
    profile.registration?.lastAssociationId ??
    player.country_id;
  const route = apiRoute(await playerMinorRoute(store, player, buyer, state.date));
  const application = await store.get<{
    id: number;
    status: string;
    due_date: string;
    reason: string;
    source_country_id: number;
    route: string;
  }>(
    "SELECT * FROM minor_applications WHERE player_id = ? AND club_id = ?",
    player.id,
    buyer.id,
  );
  const relevant =
    application?.source_country_id === sourceCountryId &&
    application.route === route.route
      ? application
      : undefined;
  const approved =
    !route.minor ||
    !route.international ||
    (route.eligibleToApply && relevant?.status === "approved");
  const canApproachWithoutFee =
    player.age < 18 &&
    profile.contract?.status === "amateur" &&
    !profile.contract.futureProfessionalContract &&
    player.parent_club_id === null &&
    player.club_id !== buyer.id;
  const trainingClubId = canApproachWithoutFee
    ? (profile.contract?.trainingClubId ?? currentClub?.id ?? null)
    : null;
  const compensation =
    trainingClubId && trainingClubId !== buyer.id
      ? trainingCompensationFee(player.age, profile.contract?.trainingStartAge ?? 12, buyer.academy)
      : 0;
  return {
    ...route,
    approved: !!approved,
    status: approved
      ? route.international && route.minor
        ? "Minor application approved"
        : "No international minor application required"
      : relevant?.status === "pending"
        ? "Minor application pending"
        : relevant?.status === "rejected"
          ? "Minor application rejected"
          : route.eligibleToApply
            ? "Prior minor approval required"
            : "International move unavailable",
    source: YOUTH_TRANSFER_SOURCE,
    application: relevant
      ? {
          id: relevant.id,
          status: relevant.status,
          dueDate: relevant.due_date,
          reason: relevant.reason,
        }
      : undefined,
    contractStatus: profile.contract?.status ?? "professional",
    canApproachWithoutFee,
    trainingCompensation: compensation,
    trainingClubId,
  };
}

export async function submitMinorApplication(
  store: Store,
  playerId: number,
  safeguards: {
    football: boolean;
    education: boolean;
    care: boolean;
    mentor: boolean;
    parentalConsent: boolean;
  },
) {
  const state = await store.meta<GameState>("state");
  const player = await store.get<Player>(
    "SELECT * FROM players WHERE id = ?",
    playerId,
  );
  const buyer = (await store.get<Club>(
    "SELECT * FROM clubs WHERE id = ?",
    state.clubId,
  ))!;
  if (!player) return { error: "Player not found." };
  const assessment = await assessYouthTransfer(store, player, buyer);
  if (!assessment.minor || !assessment.international)
    return {
      error: "This move does not require an international minor application.",
    };
  if (!assessment.eligibleToApply) return { error: assessment.reasons[0] };
  if (assessment.application?.status === "pending" || assessment.approved)
    return {
      error: "An application is already pending or approved for this club.",
    };
  if (!SAFEGUARDS.every((key) => safeguards[key] === true))
    return {
      error:
        "The education, care, mentoring and parental-consent commitments are required.",
    };
  const source = player.club_id
    ? (await store.get<Club>(
        "SELECT * FROM clubs WHERE id = ?",
        player.parent_club_id ?? player.club_id,
      ))!.country_id
    : ((JSON.parse(player.profile) as PlayerProfile).registration
        ?.lastAssociationId ?? player.country_id);
  await store.run(
    "MERGE minor_applications WITH (HOLDLOCK) AS target USING (VALUES (?,?,?,?,?,?,?,?)) AS source(player_id,club_id,source_country_id,destination_country_id,route,requested_date,due_date,data) ON target.player_id = source.player_id AND target.club_id = source.club_id WHEN MATCHED THEN UPDATE SET source_country_id=source.source_country_id,destination_country_id=source.destination_country_id,route=source.route,requested_date=source.requested_date,due_date=source.due_date,status='pending',reason='',data=source.data WHEN NOT MATCHED THEN INSERT (player_id,club_id,source_country_id,destination_country_id,route,requested_date,due_date,data) VALUES (source.player_id,source.club_id,source.source_country_id,source.destination_country_id,source.route,source.requested_date,source.due_date,source.data);",
    player.id,
    buyer.id,
    source,
    buyer.country_id,
    assessment.route,
    state.date,
    addDays(state.date, 7),
    JSON.stringify(safeguards),
  );
  return {
    message:
      "Minor application submitted. The game registration review is due in seven days; no player can be registered before approval.",
  };
}

export async function processMinorApplications(store: Store) {
  const state = await store.meta<GameState>("state");
  for (const application of await store.all<{
    id: number;
    player_id: number;
    club_id: number;
    route: string;
    data: string;
  }>(
    "SELECT * FROM minor_applications WHERE status = 'pending' AND due_date <= ? ORDER BY id",
    state.date,
  )) {
    const player = (await store.get<Player>(
      "SELECT * FROM players WHERE id = ?",
      application.player_id,
    ))!;
    const club = (await store.get<Club>(
      "SELECT * FROM clubs WHERE id = ?",
      application.club_id,
    ))!;
    const eligibility = await assessYouthTransfer(store, player, club);
    const support = !!(await store.get(
      "SELECT TOP (1) staff.id FROM staff WHERE staff.club_id = ? AND staff.role = 'Head of youth' AND EXISTS (SELECT 1 FROM training_plans WHERE training_plans.club_id = staff.club_id)",
      club.id,
    ));
    const evidence = JSON.parse(application.data);
    const approved =
      eligibility.eligibleToApply &&
      eligibility.route === application.route &&
      SAFEGUARDS.every((key) => evidence[key] === true) &&
      support;
    const reason = approved
      ? "The recorded exception and club education/welfare commitments passed the simulated registration review."
      : "Eligibility or the club's education/welfare provision could not be confirmed.";
    await store.run(
      "UPDATE minor_applications SET status = ?,reason = ? WHERE id = ?",
      approved ? "approved" : "rejected",
      reason,
      application.id,
    );
    if (club.id === state.clubId)
      await store.run(
        "INSERT INTO news(date,category,title,body,severity,action,data) VALUES (?,'Transfers',?,?,?,'transfers',?)",
        state.date,
        `${player.name}: minor application ${approved ? "approved" : "rejected"}`,
        reason,
        approved ? "success" : "warning",
        JSON.stringify({ playerId: player.id }),
      );
  }
}
