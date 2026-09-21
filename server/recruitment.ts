import { Store } from "./db.ts";
import {
  addDays,
  clamp,
  daysBetween,
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

export const YOUTH_TRANSFER_SOURCE =
  "FIFA RSTP January 2025, articles 2, 18, 19 and 20, Annexe 4; simplified game implementation";
export const YOUTH_TRANSFER_URL =
  "https://digitalhub.fifa.com/m/696d877ea35ca761/original/Regulations-on-the-Status-and-Transfer-of-Players-January-2025-edition.pdf";
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
      : clamp(
          (buyer.reputation -
            (seller?.reputation ?? Math.max(20, player.ability - 8))) *
            (0.45 + ambition / 150),
          -35,
          22,
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
  const development =
    player.age < 24
      ? (buyer.facilities +
          buyer.academy -
          ((seller?.facilities ?? 40) + (seller?.academy ?? 40))) /
        16
      : 0;
  factor(
    "development",
    "Development environment",
    clamp(development + (offer.loan && player.age < 23 ? 5 : 0), -10, 12),
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
  const familiar =
    seller?.country_id === buyer.country_id ||
    player.country_id === buyer.country_id;
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
  const settled =
    !player.listed &&
    player.morale >= 65 &&
    daysBetween(state.date, player.contract_end) > 365;
  factor(
    "loyalty",
    "Current situation and loyalty",
    renewal
      ? loyalty / 15
      : player.listed
        ? 8
        : player.morale < 50
          ? 6
          : settled
            ? -loyalty / 9
            : 0,
    renewal
      ? "A renewal supports continuity and loyalty."
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
  const expectedBase = Math.max(
    player.wage,
    Math.round(((player.ability / 100) ** 7 * 190000) / 10) * 10 + 50,
  );
  const expectedWage = Math.round(
    expectedBase *
      (offer.loan
        ? 1
        : 1.1 +
          ((profile.agent.difficulty / 500) *
            Number(settings.agentIntensity ?? 60)) /
            60 +
          difficulty -
          state.director.skills.negotiations * 0.012),
  );
  factor(
    "wages",
    "Personal terms",
    offer.wage === undefined
      ? 0
      : clamp(
          Math.log2(Math.max(1, offer.wage) / Math.max(1, expectedWage)) * 12,
          -24,
          15,
        ),
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
  return {
    score,
    stance:
      score >= 75
        ? "Very interested"
        : score >= 60
          ? "Interested"
          : score >= 40
            ? "Open to talks"
            : score >= 25
              ? "Needs convincing"
              : "Not interested",
    expectedRole,
    expectedWage,
    factors,
    concerns: factors
      .filter((entry) => entry.impact <= -5)
      .sort((left, right) => left.impact - right.impact)
      .map((entry) => entry.reason),
  };
}
const EEA = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "IS",
  "LI",
  "NO",
]);
const HOME_ASSOCIATIONS = new Set(["EN", "SCO", "WAL", "NIR"]);
const SAFEGUARDS = [
  "football",
  "education",
  "care",
  "mentor",
  "parentalConsent",
] as const;

export function minorTransferRoute(
  age: number,
  source: string,
  destination: string,
  independentParentMove = false,
): Pick<
  YouthTransferAssessment,
  "route" | "reasons" | "minor" | "international" | "eligibleToApply"
> {
  if (age >= 18)
    return {
      route: "adult",
      reasons: ["Adult player; minor-transfer restrictions do not apply."],
      minor: false,
      international: source !== destination,
      eligibleToApply: true,
    };
  if (source === destination)
    return {
      route: "domestic",
      reasons: [
        "Same-association move. Domestic youth registration rules still apply.",
      ],
      minor: true,
      international: false,
      eligibleToApply: true,
    };
  if (independentParentMove)
    return {
      route: "parent-relocation",
      reasons: [
        "An independently recorded parental move for non-football reasons is available. Prior minor-registration approval is required.",
      ],
      minor: true,
      international: true,
      eligibleToApply: true,
    };
  if (age >= 16 && EEA.has(source) && EEA.has(destination))
    return {
      route: "eu-eea",
      reasons: [
        "Age 16-17 and both associations are in the EU/EEA. Football training, academic education, accommodation/care and a mentor must be provided, with prior approval.",
      ],
      minor: true,
      international: true,
      eligibleToApply: true,
    };
  if (
    age >= 16 &&
    HOME_ASSOCIATIONS.has(source) &&
    HOME_ASSOCIATIONS.has(destination)
  )
    return {
      route: "same-country",
      reasons: [
        "Age 16-17 and moving between associations within the same country. Education, welfare and prior approval are required.",
      ],
      minor: true,
      international: true,
      eligibleToApply: true,
    };
  return {
    route: "blocked",
    reasons: [
      "No supported exception to the under-18 international-transfer restriction is recorded. Parents merely accompanying a football move does not qualify; EU nationality alone is not enough.",
    ],
    minor: true,
    international: true,
    eligibleToApply: false,
  };
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
  const source = (await store.get<Country>(
    "SELECT * FROM countries WHERE id = ?",
    sourceCountryId,
  ))!;
  const destination = (await store.get<Country>(
    "SELECT * FROM countries WHERE id = ?",
    buyer.country_id,
  ))!;
  const family = profile.familyMove;
  const route = minorTransferRoute(
    player.age,
    source.code,
    destination.code,
    !!family &&
      family.verified &&
      family.reason !== "football" &&
      family.countryId === buyer.country_id &&
      family.date <= state.date,
  );
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
  const trainingYears = Math.max(
    1,
    Math.min(player.age, 21) - (profile.contract?.trainingStartAge ?? 12),
  );
  const compensation =
    trainingClubId && trainingClubId !== buyer.id
      ? Math.round(trainingYears * clamp(buyer.academy * 150, 2500, 15000))
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
