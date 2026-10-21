import { Store } from "./db.ts";
import { daysBetween } from "../shared/rules.ts";
import { nationByCode } from "../shared/world-catalog/index.ts";
import type {
  Club,
  Country,
  Player,
  PlayerProfile,
} from "../shared/types.ts";
import type { YouthTransferAssessment } from "../shared/api.ts";
import type { GbeAssessment } from "../shared/gbe/types.ts";
import { gbeAssessments } from "./gbe.ts";

// ------------------------------------------------ nationality facts (all held nationalities count)

// Fallbacks keep the rules usable for nations a partial catalog does not describe yet.
const EU_EEA_FALLBACK = new Set(
  "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO".split(" "),
);
const GROUP_FALLBACK: Record<string, string> = { EN: "GB", SCO: "GB", WAL: "GB", NIR: "GB" };

/** Passport group of a nation (EN/SCO/WAL/NIR → GB, FO → DK...). */
export const passportGroup = (code: string) =>
  nationByCode(code)?.nationality.citizenship.group ?? GROUP_FALLBACK[code] ?? code;
export const isEuEea = (code: string) =>
  nationByCode(code)?.euEea ?? EU_EEA_FALLBACK.has(code);

/** Sporting nationality plus every recorded citizenship. */
export function heldNationalities(
  sportingCode: string,
  profile: Pick<PlayerProfile, "identity">,
): string[] {
  return [
    ...new Set([
      sportingCode,
      ...(profile.identity.nationalities ?? []).map((entry) => entry.code),
    ]),
  ];
}

export const holdsNationalityOf = (nationalities: readonly string[], code: string) =>
  nationalities.some((held) => passportGroup(held) === passportGroup(code));

export interface ClubRegistration {
  /** Nation the club belongs to (clubs.country_id). */
  home: string;
  /** Association that registers its players: the host for cross-border clubs registered abroad. */
  association: string;
}

/** Registration association of a club (club.data.hosted, world v4). */
export function clubRegistration(homeCode: string, data: string | Record<string, unknown> | null | undefined): ClubRegistration {
  const parsed = typeof data === "string" ? (JSON.parse(data || "{}") as Record<string, unknown>) : (data ?? {});
  const hosted = parsed.hosted as { host?: string; registration?: string } | undefined;
  return {
    home: homeCode,
    association: hosted?.host && hosted.registration === "host" ? hosted.host : homeCode,
  };
}

/** Country id of the association that registers a club's players (the host for cross-border clubs). */
export async function registrationAssociationId(store: Store, club: Pick<Club, "country_id" | "data">) {
  const { association } = clubRegistration("", club.data);
  if (!association) return club.country_id;
  return (
    (await store.get<{ id: number }>("SELECT id FROM countries WHERE code = ?", association))?.id ??
    club.country_id
  );
}

type Residence = Pick<PlayerProfile, "familyMove"> & { identity: Pick<PlayerProfile["identity"], "birthCountryId"> };

/** Where the family lives: the recorded move once made, else the birthplace. */
function livedIn(profile: Residence, birthDate: string, date: string) {
  const move = profile.familyMove && profile.familyMove.date <= date ? profile.familyMove : undefined;
  return {
    countryId: move ? move.countryId : profile.identity.birthCountryId,
    since: move?.date ?? birthDate,
    parentsMoved: !!move?.verified && move.reason !== "football",
  };
}

/** Continuous years lived in a country, from the fictional identity (birthplace and recorded family moves). */
export function residenceYears(profile: Residence, countryId: number, birthDate: string, date: string) {
  const lived = livedIn(profile, birthDate, date);
  return lived.countryId === countryId ? daysBetween(lived.since, date) / 365.25 : 0;
}

/** The family's nation for `minorPresenceLegal` (`codeOf` maps country ids to codes). */
export function familyResidence(
  profile: Residence,
  birthDate: string,
  date: string,
  codeOf: (countryId: number) => string | undefined,
): MinorPresence["residence"] {
  const lived = livedIn(profile, birthDate, date);
  const code = lived.countryId === undefined ? undefined : codeOf(lived.countryId);
  return code ? { code, years: daysBetween(lived.since, date) / 365.25, parentsMoved: lived.parentsMoved } : undefined;
}

// ------------------------------------------------------------ minors: FIFA RSTP Article 19

export type MinorRoute =
  | YouthTransferAssessment["route"]
  | "first-registration"
  | "border"
  | "humanitarian";

export interface MinorMove {
  age: number;
  /** Every nationality the player holds (sporting nationality included). */
  nationalities: readonly string[];
  /** Registration association of the new club and the nation it belongs to. */
  destination: ClubRegistration;
  /** Current or last registration; omitted for a first registration. */
  source?: ClubRegistration | null;
  /** Continuous years lived in the new club's country (Art. 19(3)). */
  residenceYears?: number;
  /** Verified move of the parents to the new club's country for reasons not linked to football (Art. 19(2)(a)). */
  parentsMoved?: boolean;
  /** Distances from the player's home and the new club to their shared national border, in km (Art. 19(2)(c)). */
  border?: { home: number; club: number };
  /** Fled the home country without parents for humanitarian reasons (Art. 19(2)(d)). */
  humanitarian?: boolean;
}

export interface MinorRouteResult {
  route: MinorRoute;
  minor: boolean;
  international: boolean;
  eligibleToApply: boolean;
  reasons: string[];
}

const result = (
  route: MinorRoute,
  minor: boolean,
  international: boolean,
  eligibleToApply: boolean,
  reason: string,
): MinorRouteResult => ({ route, minor, international, eligibleToApply, reasons: [reason] });

/**
 * Article 19: international transfers and first registrations of non-national minors only through the listed
 * exceptions. Nationality alone never permits an international transfer (it only exempts a first registration);
 * the EU/EEA exception needs an EU/EEA nationality and both associations inside the EU/EEA, so never the UK.
 */
export function minorRoute(move: MinorMove): MinorRouteResult {
  const { age, nationalities, destination } = move;
  const source = move.source ?? null;
  if (age >= 18)
    return result("adult", false, !!source && source.association !== destination.association, true, "Adult player; minor-transfer restrictions do not apply.");
  if (source && source.association === destination.association)
    return result("domestic", true, false, true, "Same-association move. Domestic youth registration rules still apply.");
  if (source && source.home === destination.home)
    return result("domestic", true, false, true, `Both clubs are based in the same country; the ${destination.association} registration follows the club's cross-border arrangement.`);
  const national =
    holdsNationalityOf(nationalities, destination.association) ||
    holdsNationalityOf(nationalities, destination.home);
  if (!source && national)
    return result("first-registration", true, false, true, "First registration of a national of this country; Article 19 does not restrict it.");
  if (!source && (move.residenceYears ?? 0) >= 5)
    return result("first-registration", true, false, true, "First registration after at least five years' continuous residence in this country.");
  if (move.parentsMoved)
    return result("parent-relocation", true, true, true, "The parents moved to this country for reasons not linked to football. Prior minor-registration approval is required.");
  const euNational = nationalities.some(isEuEea);
  if (age >= 16 && euNational && isEuEea(destination.association) && (!source || isEuEea(source.association)))
    return result("eu-eea", true, true, true, "Age 16-17, an EU/EEA national and a move within the EU/EEA. Football training, academic education, accommodation/care and a mentor must be provided, with prior approval.");
  if (age >= 16 && source && passportGroup(source.association) === "GB" && passportGroup(destination.association) === "GB")
    return result("same-country", true, true, true, "Age 16-17 and moving between associations within the same country. Education, welfare and prior approval are required.");
  if (move.border && move.border.home <= 50 && move.border.club <= 50 && move.border.home + move.border.club <= 100)
    return result("border", true, true, true, "The player lives within 50 km of the border and the club is within 50 km on the other side; the player must keep living at home and both associations must consent.");
  if (move.humanitarian)
    return result("humanitarian", true, true, true, "The player fled the home country for humanitarian reasons and may reside here. Prior approval is required.");
  return result(
    "blocked",
    true,
    true,
    false,
    national
      ? "Holding this nationality does not by itself permit an international transfer of a minor; a recorded exception such as a non-football parental move is needed."
      : "No supported exception to the under-18 international-transfer restriction is recorded. Parents merely accompanying a football move does not qualify; EU nationality alone is not enough.",
  );
}

export interface MinorPresence {
  age: number;
  nationalities: readonly string[];
  destination: ClubRegistration;
  /** Nation the family lives in, continuous years there and whether the parents moved there for non-football reasons. */
  residence?: { code: string; years: number; parentsMoved: boolean };
}

/**
 * Whether a minor's current registration could have been made lawfully, without the move history: nationals,
 * residents, verified family moves, EU/EEA nationals aged 16-17 in the EU/EEA, and at 16-17 anyone lawfully
 * registrable where the family lives in the UK (a move between home nations, Art. 19(2)(b)(ii), needs no passport).
 */
export function minorPresenceLegal({ age, nationalities, destination, residence }: MinorPresence): boolean {
  if (age >= 18) return true;
  // Cross-border clubs are local to both nations, as for nationality in minorRoute.
  const here = residence?.code === destination.home || residence?.code === destination.association ? residence : undefined;
  const first = minorRoute({ age, nationalities, destination, residenceYears: here?.years, parentsMoved: here?.parentsMoved });
  if (first.route === "first-registration" || first.route === "parent-relocation") return true;
  if (age < 16) return false;
  if (isEuEea(destination.association) && nationalities.some(isEuEea)) return true;
  return (
    !!residence &&
    passportGroup(destination.association) === "GB" &&
    passportGroup(residence.code) === "GB" &&
    (residence.years >= 5 || residence.parentsMoved)
  );
}

// ---------------------------------------------------------------- foreign-player quotas

export interface ForeignQuota {
  limit: number;
  /** "non-eu": players without any EU/EEA nationality (ACP nationals exempt where noted); "international": no domestic nationality. */
  counts: "non-eu" | "international";
  acpExempt?: boolean;
  /** Extra nationalities treated as domestic (US players at Canadian MLS clubs). */
  domestic?: string[];
  source: string;
}

// Cotonou/Samoa agreement (ACP) nationals among the FIFA members; exempt from the Spanish and French non-EU limits.
const ACP = new Set(
  "SN NG CI CM CD ZA GH CV AO MZ GQ ZW CG GW ET BJ BW BF BI CF TD KM DJ ER SZ GA GM GN KE LS LR MG MW ML MR MU NA NE RW ST SC SL SO SS SD TZ TG UG ZM AG BS BB BZ CU DM DO GD GY HT JM KN LC VC SR TT CK FJ PG WS SB TO VU TL".split(" "),
);

/** Squad registration limits by the registering club's association and tier (2025/26 rules, simplified). */
export function foreignQuota(association: string, tier: number, home = association): ForeignQuota | undefined {
  if (association === "ES" && tier >= 1 && tier <= 2)
    return { limit: tier === 1 ? 3 : 2, counts: "non-eu", acpExempt: true, source: "RFEF/LaLiga: three non-EU players in Primera, two in Segunda" };
  if (association === "FR" && tier >= 1 && tier <= 2)
    return { limit: 4, counts: "non-eu", acpExempt: true, source: "LFP: four non-EU players in Ligue 1 and Ligue 2" };
  if (association === "US" && tier === 1)
    return { limit: 8, counts: "international", domestic: home === "CA" ? ["CA", "US"] : ["US"], source: "MLS: eight international roster slots" };
  if (association === "AU" && tier === 1)
    return { limit: 5, counts: "international", domestic: home === "NZ" ? ["NZ", "AU"] : ["AU"], source: "A-League: five visa players" };
  return undefined;
}

/** Whether a player occupies a quota place, judged on every nationality held. */
export function countsTowardQuota(quota: ForeignQuota, nationalities: readonly string[], home: string) {
  if (quota.counts === "non-eu")
    return !nationalities.some((code) => isEuEea(code) || (quota.acpExempt && ACP.has(code)));
  const domestic = quota.domestic ?? [home];
  return !nationalities.some((code) => domestic.some((entry) => passportGroup(entry) === passportGroup(code)));
}

export interface RegistrationAssessment {
  allowed: boolean;
  status: string;
  points: number;
  threshold: number;
  automatic: boolean;
  breakdown: Record<string, number>;
  reasons: string[];
  /** The FA GBE assessment (server/gbe.ts) when the endorsement decided the verdict. */
  gbe?: GbeAssessment;
  source: string;
}

const GBE_OUTCOME_STATUS: Record<GbeAssessment["outcome"], string> = {
  auto_pass: "International automatic pass",
  pass: "Points threshold met",
  exempt: "No FA endorsement required",
  panel: "Exceptions Panel range",
  fail: "Endorsement not met",
  no_data: "No GBE evidence yet",
};

/**
 * Predicted registration of `player` at `buyer` (AI market preferences and the cross-border loan review): domestic
 * work rights, an existing registration in the same association or the FA GBE verdict (server/gbe.ts, cached per
 * day), plus the association's foreign-player quota. Signings are never refused on this (server/eligibility.ts).
 */
export async function assessRegistration(
  store: Store,
  player: Player,
  buyer: Club,
): Promise<RegistrationAssessment> {
  const country = (await store.get<Country>(
    "SELECT * FROM countries WHERE id = ?",
    player.country_id,
  ))!;
  const destination = (await store.get<Country>(
    "SELECT * FROM countries WHERE id = ?",
    buyer.country_id,
  ))!;
  const currentClub = player.club_id
    ? await store.get<Club>("SELECT * FROM clubs WHERE id = ?", player.club_id)
    : undefined;
  const currentCountry = currentClub
    ? await store.get<Country>(
        "SELECT * FROM countries WHERE id = ?",
        currentClub.country_id,
      )
    : undefined;
  const profile = JSON.parse(player.profile) as PlayerProfile;
  const nationalities = heldNationalities(country.code, profile);
  const target = clubRegistration(destination.code, buyer.data);
  // A registration on file in the same association carries over (a refused or pending one does not).
  const existing =
    !!currentClub &&
    !!currentCountry &&
    clubRegistration(currentCountry.code, currentClub.data).association === target.association &&
    !(await store.get(
      "SELECT 1 AS refused FROM player_registrations WHERE player_id = ? AND club_id = ? AND status IN ('pending','not_registered','refused')",
      player.id,
      currentClub.id,
    ));
  const verdict = (allowed: boolean, status: string, gbe?: GbeAssessment): RegistrationAssessment => ({
    allowed,
    status,
    points: gbe?.points ?? 0,
    threshold: gbe?.passMark ?? 15,
    automatic: gbe?.autoPass ?? false,
    breakdown: Object.fromEntries((gbe?.breakdown ?? []).map((row) => [row.label ?? row.criterion, row.points])),
    reasons: allowed
      ? [status]
      : [
          `${gbe?.points ?? 0}/${gbe?.passMark ?? 15} points (${status}). Ability rating is not an eligibility criterion.`,
          "No verified exception or unused Elite Significant Contribution place is recorded.",
        ],
    ...(gbe ? { gbe } : {}),
    source: gbe?.source?.title ?? gbe?.rulesetTitle ?? "FA Men's Players Governing Body Endorsement Criteria",
  });
  const assessment =
    target.association !== "EN"
      ? verdict(true, "No FA endorsement required")
      : nationalities.some((code) => ["GB", "IE"].includes(passportGroup(code)))
        ? verdict(true, "Domestic work rights")
        : existing
          ? verdict(true, "Existing valid registration permission")
          : await (async () => {
              const gbe = (await gbeAssessments(store, [player.id])).get(player.id)!;
              return verdict(["exempt", "auto_pass", "pass"].includes(gbe.outcome), GBE_OUTCOME_STATUS[gbe.outcome], gbe);
            })();
  const quota = await quotaCheck(store, player, buyer, target, nationalities);
  return quota
    ? {
        ...assessment,
        allowed: false,
        status: "Foreign-player quota full",
        reasons: [quota, ...(assessment.allowed ? [] : assessment.reasons)],
      }
    : assessment;
}

/** Reason the buyer cannot register another quota player, or null. */
async function quotaCheck(
  store: Store,
  player: Player,
  buyer: Club,
  target: ClubRegistration,
  nationalities: readonly string[],
) {
  if (player.age_group !== "Senior" || player.club_id === buyer.id) return null;
  const tier = buyer.league_id
    ? (
        await store.get<{ tier: number }>(
          "SELECT tier FROM leagues WHERE id = ?",
          buyer.league_id,
        )
      )?.tier
    : undefined;
  const quota = tier ? foreignQuota(target.association, tier, target.home) : undefined;
  if (!quota || !countsTowardQuota(quota, nationalities, target.home)) return null;
  const squad = await store.all<{ profile: string; code: string }>(
    "SELECT players.profile,countries.code FROM players JOIN countries ON countries.id = players.country_id WHERE players.club_id = ? AND players.id != ? AND players.age_group = 'Senior' AND players.role != 'Retired'",
    buyer.id,
    player.id,
  );
  const used = squad.filter((entry) =>
    countsTowardQuota(
      quota,
      heldNationalities(entry.code, JSON.parse(entry.profile) as PlayerProfile),
      target.home,
    ),
  ).length;
  return used >= quota.limit
    ? `${quota.source}: all ${quota.limit} places are taken, judged on every nationality each player holds.`
    : null;
}
