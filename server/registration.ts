import { Store } from "./db.ts";
import { clamp } from "../shared/rules.ts";
import type {
  Club,
  Country,
  GameState,
  League,
  Player,
  PlayerProfile,
  Standing,
} from "../shared/types.ts";

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

const continentalBand = (name: string) =>
  name.startsWith("UEFA Champions League") ||
  name.startsWith("Copa Libertadores")
    ? 1
    : /UEFA Europa|UEFA Conference|Copa Sudamericana|FIFA Club World/.test(name)
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
  const band =
    league && currentCountry ? leagueBand(currentCountry.code, league.tier) : 6;
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
  const ranking =
    (
      await store.all<Country>(
        "SELECT * FROM countries ORDER BY reputation DESC,id",
      )
    ).findIndex((item) => item.id === country.id) + 1;
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
  const existing =
    !!(await store.get(
      "SELECT player_id FROM registration_records WHERE player_id = ? AND country_id = ? AND status = 'approved'",
      player.id,
      buyer.country_id,
    )) || currentCountry?.code === destination.code;
  return endorsementPoints({
    nationalityCode:
      (
        JSON.parse(player.profile) as PlayerProfile
      ).identity.nationalities?.find((entry) =>
        ["EN", "SCO", "WAL", "NIR", "IE"].includes(entry.code),
      )?.code ?? country.code,
    destinationCode: destination.code,
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
}
