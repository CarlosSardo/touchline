import { Store } from "./db.ts";
import { clamp, daysBetween } from "../shared/rules.ts";
import { nationByCode } from "../shared/world-catalog/index.ts";
import type {
  Club,
  Country,
  GameState,
  League,
  Player,
  PlayerProfile,
  Standing,
} from "../shared/types.ts";
import type { YouthTransferAssessment } from "../shared/api.ts";

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

export interface EndorsementEvidence {
  nationalityCode: string;
  destinationCode: string;
  age: number;
  leagueBand: number;
  domesticMinutesPercent: number;
  internationalAppearancesPercent: number;
  internationalRank: number;
  continentalMinutesPercent: number;
  continentalBand: number;
  domesticFinish:
    | "champion"
    | "band1-league"
    | "band1-qualifying"
    | "band2-league"
    | "band2-qualifying"
    | "mid-table"
    | "relegation"
    | "promotion";
  continentalStage: string;
  seniorAppearance: boolean;
  youthDebut: boolean;
  existingPermission: boolean;
}

export interface RegistrationAssessment {
  allowed: boolean;
  status: string;
  points: number;
  threshold: number;
  automatic: boolean;
  breakdown: Record<string, number>;
  reasons: string[];
  evidence: EndorsementEvidence;
  source: string;
}
export const GBE_SOURCE =
  "FA Men's Players Governing Body Endorsement Criteria 2026/27, Tables 1-6 (effective 15 June 2026)";

export function leagueBand(code: string, tier: number) {
  if (tier === 1 && ["EN", "DE", "ES", "IT", "FR"].includes(code)) return 1;
  if (
    (tier === 1 && ["PT", "NL", "BE", "BR"].includes(code)) ||
    (code === "EN" && tier === 2)
  )
    return 2;
  if (tier === 1 && ["US", "AR", "MX", "TR", "SCO"].includes(code)) return 3;
  if (
    (tier === 1 &&
      ["CZ", "HR", "CH", "UA", "GR", "CO", "AT", "DK", "RU", "JP"].includes(
        code,
      )) ||
    (tier === 2 && ["ES", "DE", "FR"].includes(code))
  )
    return 4;
  if (
    (tier === 1 &&
      ["RS", "PL", "CL", "UY", "SE", "NO", "HU", "KR", "AU"].includes(code)) ||
    (code === "IT" && tier === 2) ||
    (code === "EN" && tier === 3)
  )
    return 5;
  return 6;
}

export const continentalBand = (name: string) =>
  name.startsWith("UEFA Champions League") ||
  (name.startsWith("CONMEBOL Libertadores") && !name.includes("Sub-20"))
    ? 1
    : /UEFA Europa|UEFA Conference|CONMEBOL Sudamericana|FIFA Club World/.test(name)
      ? 2
      : 3;

export function endorsementPoints(
  evidence: EndorsementEvidence,
): RegistrationAssessment {
  const band = Math.round(clamp(evidence.leagueBand, 1, 6));
  const percent = Math.round(
    clamp(evidence.internationalAppearancesPercent, 0, 100),
  );
  const rank = Math.max(1, evidence.internationalRank);
  const domesticPercent = Math.round(
    clamp(evidence.domesticMinutesPercent, 0, 100),
  );
  const continentalPercent = Math.round(
    clamp(evidence.continentalMinutesPercent, 0, 100),
  );
  const automatic =
    (rank <= 10 && percent >= 30) ||
    (rank <= 20 && percent >= 40) ||
    (rank <= 30 && percent >= 60) ||
    (rank <= 50 && percent >= 70);
  const internationalRows: Record<number, number[]> = {
    90: [20, 20, 20, 20, 2],
    80: [20, 20, 20, 20, 1],
    70: [20, 20, 20, 20, 0],
    60: [20, 20, 20, 10, 0],
    50: [20, 20, 10, 8, 0],
    40: [20, 20, 9, 7, 0],
    30: [20, 10, 8, 6, 0],
    20: [10, 9, 7, 0, 0],
    10: [9, 8, 0, 0, 0],
    1: [8, 7, 0, 0, 0],
  };
  const row = [90, 80, 70, 60, 50, 40, 30, 20, 10, 1].find(
    (minimum) => percent >= minimum,
  );
  const rankColumn =
    rank <= 10 ? 0 : rank <= 20 ? 1 : rank <= 30 ? 2 : rank <= 50 ? 3 : 4;
  const domesticPoints =
    domesticPercent < 30
      ? 0
      : Math.max(
          0,
          Math.min(9, Math.floor(domesticPercent / 10)) + 3 - (band - 1) * 2,
        );
  const debut = evidence.age < 21 && evidence.youthDebut ? 7 - band : 0;
  const continentalPoints =
    continentalPercent < 30
      ? 0
      : Math.max(
          0,
          Math.min(9, Math.floor(continentalPercent / 10)) +
            1 -
            (evidence.continentalBand === 1
              ? 0
              : evidence.continentalBand === 2
                ? 5
                : 8),
        );
  const positions: Record<EndorsementEvidence["domesticFinish"], number[]> = {
    champion: [6, 5, 4, 3, 2, 1],
    "band1-league": [5, 4, 3, 2, 1, 0],
    "band1-qualifying": [4, 3, 2, 1, 0, 0],
    "band2-league": [3, 2, 1, 0, 0, 0],
    "band2-qualifying": [2, 1, 0, 0, 0, 0],
    "mid-table": [1, 0, 0, 0, 0, 0],
    relegation: [0, 0, 0, 0, 0, 0],
    promotion: [0, 1, 1, 1, 1, 1],
  };
  const stagePoints: Record<string, number[]> = {
    Final: [10, 7, 2],
    "Semi-final": [9, 6, 1],
    "Quarter-final": [8, 5, 0],
    "Round of 16": [7, 4, 0],
    "Round of 32": [6, 3, 0],
    "Knockout play-off": [6, 3, 0],
    "League phase": [5, 2, 0],
    "Group stage": [5, 2, 0],
  };
  const breakdown = {
    "International appearances": row ? internationalRows[row][rankColumn] : 0,
    "Domestic league minutes": Math.max(domesticPoints, debut),
    "Continental minutes": continentalPoints,
    "Final league position": evidence.seniorAppearance
      ? positions[evidence.domesticFinish][band - 1]
      : 0,
    "Continental progression": evidence.seniorAppearance
      ? (stagePoints[evidence.continentalStage]?.[
          evidence.continentalBand - 1
        ] ?? 0)
      : 0,
    "Current league quality": evidence.seniorAppearance
      ? [12, 10, 8, 6, 4, 2][band - 1]
      : 0,
  };
  const points = Object.values(breakdown).reduce(
    (total, value) => total + value,
    0,
  );
  const citizenship = ["EN", "SCO", "WAL", "NIR", "IE"].includes(
    evidence.nationalityCode,
  );
  const required = evidence.destinationCode === "EN";
  const allowed =
    !required ||
    citizenship ||
    evidence.existingPermission ||
    automatic ||
    points >= 15;
  const status = !required
    ? "No FA endorsement required"
    : citizenship
      ? "Domestic work rights"
      : evidence.existingPermission
        ? "Existing valid registration permission"
        : automatic
          ? "International automatic pass"
          : points >= 15
            ? "Points threshold met"
            : "Endorsement not met";
  return {
    allowed,
    status,
    points,
    threshold: 15,
    automatic,
    breakdown,
    reasons: allowed
      ? [status]
      : [
          `${points}/15 points. Ability rating is not an eligibility criterion.`,
          "No verified exception or unused Elite Significant Contribution place is recorded.",
        ],
    evidence,
    source: GBE_SOURCE,
  };
}

export async function assessRegistration(
  store: Store,
  player: Player,
  buyer: Club,
): Promise<RegistrationAssessment> {
  const state = await store.meta<GameState>("state");
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
  const league = currentClub?.league_id
    ? await store.get<League>(
        "SELECT * FROM leagues WHERE id = ?",
        currentClub.league_id,
      )
    : undefined;
  const leagueCountry = league?.country_id
    ? await store.get<Country>(
        "SELECT * FROM countries WHERE id = ?",
        league.country_id,
      )
    : undefined;
  const band =
    league && leagueCountry ? leagueBand(leagueCountry.code, league.tier) : 6;
  const records = await store.all<{
    minutes: number;
    appearances: number;
    league_id: number;
    club_id: number;
    age_group: string;
    kind: string;
    name: string;
  }>(
    "SELECT player_season_stats.*,leagues.age_group,leagues.kind,leagues.name FROM player_season_stats JOIN leagues ON leagues.id = player_season_stats.league_id WHERE player_id = ? AND season BETWEEN ? AND ?",
    player.id,
    state.season - (player.age < 21 ? 1 : 2),
    state.season,
  );
  const domestic = records.filter(
    (record) => record.kind === "league" && record.age_group === "Senior",
  );
  const domesticMinutes = domestic.reduce(
    (sum, record) => sum + record.minutes,
    0,
  );
  const appearances = domestic.reduce(
    (sum, record) => sum + record.appearances,
    0,
  );
  const availableDomestic = currentClub
    ? (await store.get<{ minutes: number }>(
        "SELECT coalesce(sum(coalesce(TRY_CONVERT(float, JSON_VALUE(fixtures.data,'$.duration')),90)),0) AS minutes FROM fixtures JOIN leagues ON leagues.id = fixtures.league_id WHERE leagues.kind = 'league' AND leagues.age_group = 'Senior' AND fixtures.status = 'played' AND (home_id = ? OR away_id = ?) AND fixtures.season >= ?",
        currentClub.id,
        currentClub.id,
        state.season - 1,
      ))!.minutes
    : 0;
  const seniorInternational = records.filter(
    (record) =>
      record.kind === "international" && record.age_group === "Senior",
  );
  const nationalTeam = await store.get<Club>(
    "SELECT * FROM clubs WHERE country_id = ? AND type = 'national' AND age_group = 'Senior'",
    player.country_id,
  );
  const internationalMatches = nationalTeam
    ? (await store.get<{ total: number }>(
        "SELECT count(*) AS total FROM fixtures WHERE (home_id = ? OR away_id = ?) AND status = 'played' AND season >= ?",
        nationalTeam.id,
        nationalTeam.id,
        state.season - (player.age < 21 ? 1 : 2),
      ))!.total
    : 0;
  // FIFA ranking proxy: senior national-team strength (countries.reputation is league strength in world v4).
  const nationalOrder = await store.all<{ country_id: number }>(
    "SELECT country_id FROM clubs WHERE type = 'national' AND age_group = 'Senior' ORDER BY reputation DESC,country_id",
  );
  const ranking =
    nationalOrder.findIndex((item) => item.country_id === country.id) + 1 ||
    nationalOrder.length + 1;
  const tableData = league
    ? await store.get<{ data: string }>(
        "SELECT TOP (1) data FROM history WHERE entity_type = 'league' AND entity_id = ? AND season = ? ORDER BY id DESC",
        league.id,
        state.season - 1,
      )
    : undefined;
  const table = tableData
    ? (JSON.parse(tableData.data).table as Standing[])
    : [];
  const position = table.findIndex(
    (entry) => entry.club_id === currentClub?.id,
  );
  let finish: EndorsementEvidence["domesticFinish"] =
    position === 0
      ? "champion"
      : position >= 0 && position >= table.length - 2
        ? "relegation"
        : "mid-table";
  let bestContinental = { band: 3, percent: 0, stage: "Other", points: 0 };
  const continentalRecords = records.filter(
    (item) => item.kind === "continental",
  );
  const continentalFixtures = continentalRecords.length
    ? await store.all<{
        league_id: number;
        club_id: number;
        stage: string;
        minutes: number;
      }>(
        "SELECT series.league_id,series.club_id,fixtures.stage,sum(coalesce(TRY_CONVERT(float, JSON_VALUE(fixtures.data,'$.duration')),90)) AS minutes FROM (SELECT DISTINCT player_season_stats.league_id,player_season_stats.club_id FROM player_season_stats JOIN leagues ON leagues.id = player_season_stats.league_id WHERE player_id = ? AND season BETWEEN ? AND ? AND leagues.kind = 'continental') AS series JOIN fixtures ON fixtures.league_id = series.league_id AND (fixtures.home_id = series.club_id OR fixtures.away_id = series.club_id) WHERE fixtures.status = 'played' GROUP BY series.league_id,series.club_id,fixtures.stage",
        player.id,
        state.season - (player.age < 21 ? 1 : 2),
        state.season,
      )
    : [];
  for (const record of continentalRecords) {
    const fixtures = continentalFixtures.filter(
      (fixture) =>
        fixture.league_id === record.league_id &&
        fixture.club_id === record.club_id,
    );
    const available = fixtures.reduce(
      (total, fixture) =>
        total + (fixture.stage === "Qualifying" ? 0 : fixture.minutes),
      0,
    );
    const band = continentalBand(record.name);
    const percent = available
      ? Math.min(100, (record.minutes / available) * 100)
      : 0;
    const stages = fixtures.map((fixture) => fixture.stage);
    const stage =
      [
        "Final",
        "Semi-final",
        "Quarter-final",
        "Round of 16",
        "Round of 32",
        "League phase",
        "Group stage",
      ].find((value) => stages.includes(value)) ?? "Other";
    const points = percent / band;
    if (points >= bestContinental.points)
      bestContinental = { band, percent, stage, points };
  }
  if (currentClub && finish !== "champion") {
    const qualified = await store.get<{ name: string }>(
      "SELECT TOP (1) leagues.name FROM standings JOIN leagues ON leagues.id = standings.league_id WHERE standings.club_id = ? AND leagues.kind = 'continental' AND leagues.name NOT LIKE '%Qualifying' ORDER BY leagues.reputation DESC",
      currentClub.id,
    );
    if (qualified)
      finish =
        continentalBand(qualified.name) === 1 ? "band1-league" : "band2-league";
  }
  const profile = JSON.parse(player.profile) as PlayerProfile;
  const nationalities = heldNationalities(country.code, profile);
  const target = clubRegistration(destination.code, buyer.data);
  const existing =
    !!(await store.get(
      "SELECT player_id FROM registration_records WHERE player_id = ? AND country_id = ? AND status = 'approved'",
      player.id,
      buyer.country_id,
    )) ||
    (!!currentClub &&
      !!currentCountry &&
      clubRegistration(currentCountry.code, currentClub.data).association ===
        target.association);
  const assessment = endorsementPoints({
    nationalityCode:
      nationalities.find((code) => ["GB", "IE"].includes(passportGroup(code))) ??
      country.code,
    destinationCode: target.association,
    age: player.age,
    leagueBand: band,
    domesticMinutesPercent: availableDomestic
      ? (domesticMinutes / availableDomestic) * 100
      : 0,
    internationalAppearancesPercent: internationalMatches
      ? (seniorInternational.reduce(
          (sum, record) => sum + record.appearances,
          0,
        ) /
          internationalMatches) *
        100
      : 0,
    internationalRank: ranking,
    continentalMinutesPercent: bestContinental.percent,
    continentalBand: bestContinental.band,
    domesticFinish: finish,
    continentalStage: bestContinental.stage,
    seniorAppearance: appearances > 0 || seniorInternational.length > 0,
    youthDebut: player.age < 21 && appearances > 0,
    existingPermission: existing,
  });
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
