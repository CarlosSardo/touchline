import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { MATCH_RULES_VERSION, simulateMatch } from "./match.ts";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import { checkSqlConstraints } from "./check-world.ts";
import { advance } from "./simulation.ts";
import { stateOf } from "./systems.ts";
import { firstTeamCap, INTAKE, SQUAD_CAPS, youthBirthCutoff } from "./youth.ts";
import {
  clubRegistration,
  familyResidence,
  heldNationalities,
  minorPresenceLegal,
} from "./registration.ts";
import { databaseFootprint, FOOTPRINT_BUDGET } from "./retention.ts";
import { COMPETITIONS } from "./calendar.ts";
import { continentalEntries } from "./qualification.ts";
import { ageOn, daysBetween, VALUE_RANGE } from "../shared/rules.ts";
import { clubCompetitionEligible } from "../shared/competition-rules.ts";
import { boundaryMoves, readLeagueData, reserveTierAllowed } from "../shared/league-rules.ts";
import { MIN_GOALKEEPERS, SQUAD_MINIMUMS } from "../shared/world-rules.ts";
import type { MatchTeam, PlayerProfile, Position } from "../shared/types.ts";

export const CALIBRATION_REFERENCE = {
  source: "openfootball/football.json",
  license: "CC0-1.0",
  revision: "40b3e1b7391932d133287115106304444bf297e1",
  samples: [
    {
      season: "2023-24",
      matches: 380,
      goals: 1246,
      homeWins: 175,
      draws: 82,
      awayWins: 123,
      sha256:
        "03e13eafbf78dfe00d7e89dd3bf6643986eb6e8fd86c7664aeb8c5bc0bed88d0",
    },
    {
      season: "2024-25",
      matches: 380,
      goals: 1115,
      homeWins: 155,
      draws: 93,
      awayWins: 132,
      sha256:
        "c3d18f552d83382cd4b6b21127adbbfe38e7f8618ddc979fb5404f2df07d0a75",
    },
  ],
};

function referenceTeam(id: number, ability: number): MatchTeam {
  const positions: Position[] = [
    "GK",
    "RB",
    "CB",
    "CB",
    "LB",
    "DM",
    "CM",
    "AM",
    "RW",
    "ST",
    "LW",
  ];
  return {
    id,
    name: `Calibration ${id}`,
    color: "#087f6d",
    ability,
    style: "Balanced",
    formation: "4-3-3",
    chemistry: 70,
    momentum: 0,
    pressure: 30,
    lineup: positions.map((position, index) => ({
      id: id * 100 + index,
      name: `Player ${id}-${index}`,
      position,
      ability,
      fitness: 95,
      confidence: 70,
    })),
    bench: positions.slice(0, 9).map((position, index) => ({
      id: id * 100 + 20 + index,
      name: `Substitute ${id}-${index}`,
      position,
      ability: ability - 1,
      fitness: 99,
      confidence: 70,
    })),
    setPieces: { routine: "Near post", target: "Centre-back", risk: 50 },
  };
}

export function calibrationSample(matches = 600) {
  const totals = {
    goals: 0,
    expectedGoals: 0,
    shots: 0,
    passes: 0,
    completed: 0,
    homeWins: 0,
    awayWins: 0,
    draws: 0,
    redCards: 0,
    yellowCards: 0,
  };
  for (let index = 0; index < matches; index++) {
    const homeAbility = 65 + (index % 21);
    const awayAbility = 65 + ((index * 7 + 3) % 21);
    const result = simulateMatch(
      {
        rulesVersion: MATCH_RULES_VERSION,
        home: referenceTeam(1, homeAbility),
        away: referenceTeam(2, awayAbility),
        weather: "Clear",
        importance: 60,
        detail: "full",
      },
      `calibration-${index}`,
      false,
    );
    totals.goals += result.homeGoals + result.awayGoals;
    totals.expectedGoals += result.homeXg + result.awayXg;
    for (const side of [1, 2]) {
      totals.shots += result.stats[side].shots;
      totals.passes += result.stats[side].passes;
      totals.completed += result.stats[side].completedPasses;
      totals.redCards += result.stats[side].redCards;
      totals.yellowCards += result.stats[side].yellowCards;
    }
    totals[
      result.homeGoals > result.awayGoals
        ? "homeWins"
        : result.homeGoals < result.awayGoals
          ? "awayWins"
          : "draws"
    ]++;
  }
  const reference = {
    matches: 760,
    // Engine reference level (goalFactor 1); the pinned Premier League seasons (3.11) run at 1.04 plus two freak seasons.
    goalsPerMatch: 2.75,
    homeWinRate: 330 / 760,
    drawRate: 175 / 760,
  };
  const report = {
    matches,
    goalsPerMatch: totals.goals / matches,
    expectedGoalsPerMatch: totals.expectedGoals / matches,
    shotsPerMatch: totals.shots / matches,
    passesPerMatch: totals.passes / matches,
    passCompletion: totals.completed / totals.passes,
    homeWinRate: totals.homeWins / matches,
    awayWinRate: totals.awayWins / matches,
    drawRate: totals.draws / matches,
    redCardsPerMatch: totals.redCards / matches,
    yellowCardsPerMatch: totals.yellowCards / matches,
    reference,
  };
  assert(
    Math.abs(report.goalsPerMatch - reference.goalsPerMatch) < 0.3,
    "Goals per match outside the recorded reference envelope",
  );
  assert(
    Math.abs(report.homeWinRate - reference.homeWinRate) < 0.05,
    "Home advantage outside the recorded reference envelope",
  );
  assert(
    Math.abs(report.drawRate - reference.drawRate) < 0.05,
    "Draw rate outside the recorded reference envelope",
  );
  assert(report.homeWinRate > report.awayWinRate, "Home advantage is missing");
  assert(
    report.passCompletion >= 0.7 && report.passCompletion <= 0.9,
    "Pass completion outside sanity limits",
  );
  assert(
    report.redCardsPerMatch >= 0.03 && report.redCardsPerMatch <= 0.3,
    "Dismissal frequency outside sanity limits",
  );
  assert(
    Math.abs(report.goalsPerMatch - report.expectedGoalsPerMatch) < 0.2,
    "Goals and expected goals are not calibrated",
  );
  return report;
}

/** Default soak subset: B-teams and EU rules (PT), a cross-border club (NIR → IE), UK rules (SCO), a home pool (FO). */
export const SOAK_NATIONS = ["PT", "IE", "NIR", "SCO", "FO"] as const;

const activePlayers = async (store: Store) =>
  (await store.get<{ total: number }>(
    "SELECT count(*) AS total FROM players WHERE role != 'Retired'",
  ))!.total;

/** Same report as `npm run db:footprint`; a season growing the world by more than the budget is flagged. */
export async function reportFootprint(store: Store, label: string, previousMB?: number) {
  const [footprint] = await databaseFootprint(store);
  const seasonMB = previousMB === undefined ? undefined : Math.round((footprint.worldMB - previousMB) * 10) / 10;
  const over = seasonMB !== undefined && seasonMB > FOOTPRINT_BUDGET.seasonMB;
  const largest = footprint.tables.slice(0, 4).map((table) => `${table.table} ${table.reservedMB}`).join(", ");
  console.log(
    `Footprint ${label}: world ${footprint.worldMB} MB, ${footprint.rows} rows` +
      (seasonMB === undefined ? "" : `, ${seasonMB >= 0 ? "+" : ""}${seasonMB} MB this season`) +
      (over ? ` OVER the ${FOOTPRINT_BUDGET.seasonMB} MB season budget` : "") +
      ` (largest: ${largest})`,
  );
  if (over && process.env.GITHUB_ACTIONS === "true")
    console.log(`::warning title=DB footprint::${label} added ${seasonMB} MB (budget ${FOOTPRINT_BUDGET.seasonMB} MB).`);
  return { worldMB: footprint.worldMB, seasonMB };
}

/** Section 8 squad invariant: minimums with two goalkeepers everywhere, youth and AI first-team caps. */
export async function checkSquads(store: Store, label: string) {
  const state = await stateOf(store);
  const rows = await store.all<{
    id: number;
    type: string;
    parent_id: number | null;
    league_code: string | null;
    tier: number | null;
    squad: "Senior" | "U19" | "U17";
    players: number;
    keepers: number;
    contracted: number;
  }>(
    "SELECT clubs.id,clubs.type,clubs.parent_id,league_country.code AS league_code,leagues.tier,squads.squad,count(players.id) AS players,coalesce(sum(CASE WHEN players.position = 'GK' THEN 1 ELSE 0 END),0) AS keepers,coalesce(sum(CASE WHEN players.parent_club_id IS NULL THEN 1 ELSE 0 END),0) AS contracted FROM clubs CROSS JOIN (VALUES ('Senior'),('U19'),('U17')) AS squads(squad) LEFT JOIN leagues ON leagues.id = clubs.league_id LEFT JOIN countries AS league_country ON league_country.id = leagues.country_id LEFT JOIN players ON players.playing_club_id = clubs.id AND players.age_group = squads.squad AND players.role != 'Retired' WHERE clubs.type = 'club' OR (clubs.type = 'bteam' AND squads.squad = 'Senior') GROUP BY clubs.id,clubs.type,clubs.parent_id,league_country.code,leagues.tier,squads.squad",
  );
  const failures: string[] = [];
  for (const row of rows) {
    const minimum = row.type === "bteam" ? SQUAD_MINIMUMS.BTeam : SQUAD_MINIMUMS[row.squad];
    if (row.players < minimum || row.keepers < MIN_GOALKEEPERS)
      failures.push(`${row.type} ${row.id} ${row.squad}: ${row.players} players, ${row.keepers} GK`);
    const ai = row.id !== state.clubId && row.parent_id !== state.clubId;
    if (ai && row.squad !== "Senior" && row.contracted > SQUAD_CAPS.youth)
      failures.push(`club ${row.id} ${row.squad}: ${row.contracted} over the youth cap`);
    if (ai && row.type === "club" && row.squad === "Senior" && row.contracted > firstTeamCap(row.league_code, row.tier))
      failures.push(`club ${row.id}: ${row.contracted} seniors over the AI cap`);
  }
  assert.equal(failures.length, 0, `Squad invariants failed (${label}): ${failures.slice(0, 8).join("; ")}`);
  return rows.length;
}

/** Quarterly in-season squad checkpoints (month-day): after the summer window, as the winter window opens, after it. */
export const SQUAD_CHECKPOINTS = ["10-01", "01-01", "04-01"] as const;
/** Share of AI squads that may be short at a checkpoint (erosion between two weekly repairs) before the soak fails. */
export const SQUAD_SHORTFALL_TOLERANCE = 0.005;

/** Checkpoint dates of the season that starts in July of `season`. */
export const squadCheckpoints = (season: number) =>
  SQUAD_CHECKPOINTS.map((day) => `${day >= "07-01" ? season : season + 1}-${day}`);

export interface SquadCount {
  id: number;
  name: string;
  type: string;
  squad: "Senior" | "U19" | "U17";
  players: number;
  keepers: number;
}

const squadLabel = (row: Pick<SquadCount, "type" | "squad">) =>
  row.type === "bteam" ? "B-team" : row.squad === "Senior" ? "first team" : row.squad;

/** Eligible counts against the minimums (first team 25, B-team 20, U19/U17 20, two goalkeepers each), worst squads first. */
export function squadShortfalls(rows: readonly SquadCount[], date: string) {
  const minimum = (row: SquadCount) => (row.type === "bteam" ? SQUAD_MINIMUMS.BTeam : SQUAD_MINIMUMS[row.squad]);
  const gap = (row: SquadCount) => Math.max(0, minimum(row) - row.players) + Math.max(0, MIN_GOALKEEPERS - row.keepers);
  const short = rows.filter((row) => gap(row) > 0).sort((left, right) => gap(right) - gap(left) || left.id - right.id);
  const bySquad: Record<string, number> = {};
  for (const row of short) bySquad[squadLabel(row)] = (bySquad[squadLabel(row)] ?? 0) + 1;
  const smallest: Record<string, { players: number; keepers: number }> = {};
  for (const row of rows) {
    const size = (smallest[squadLabel(row)] ??= { players: row.players, keepers: row.keepers });
    size.players = Math.min(size.players, row.players);
    size.keepers = Math.min(size.keepers, row.keepers);
  }
  const allowed = Math.floor(rows.length * SQUAD_SHORTFALL_TOLERANCE);
  return {
    date,
    squads: rows.length,
    short: short.length,
    allowed,
    ok: short.length <= allowed,
    bySquad,
    smallest,
    worst: short.slice(0, 10).map((row) => `${row.name} (${row.id}) ${squadLabel(row)} ${row.players}/${minimum(row)} players, ${row.keepers} GK`),
  };
}

export type SquadCheck = ReturnType<typeof squadShortfalls>;

export const describeSquadCheck = (report: SquadCheck) =>
  `${report.date}: ${report.short} of ${report.squads} AI squads short of the minimums (tolerance ${report.allowed})` +
  (report.short
    ? `; ${Object.entries(report.bySquad).map(([label, count]) => `${label} ${count}`).join(", ")}; worst ${report.worst.join("; ")}`
    : "") +
  `; fewest players/GK: ${Object.entries(report.smallest).map(([label, size]) => `${label} ${size.players}/${size.keepers}`).join(", ")}`;

/**
 * In-season squad minimums of AI clubs (the user's club family and national teams excluded), counted as
 * `maintainSquads` counts them: running contract or on loan, U19/U17 players born on or after the season's cutoff.
 */
export async function checkInSeasonSquads(store: Store) {
  const state = await stateOf(store);
  const rows = await store.all<SquadCount>(
    "SELECT clubs.id,clubs.name,clubs.type,squads.squad,count(players.id) AS players,coalesce(sum(CASE WHEN players.position = 'GK' THEN 1 ELSE 0 END),0) AS keepers FROM clubs CROSS JOIN (VALUES ('Senior'),('U19'),('U17')) AS squads(squad) LEFT JOIN players ON players.playing_club_id = clubs.id AND players.club_id IS NOT NULL AND players.age_group = squads.squad AND players.role != 'Retired' AND (players.contract_end >= ? OR players.parent_club_id IS NOT NULL) AND (squads.squad = 'Senior' OR players.birth_date >= CASE squads.squad WHEN 'U17' THEN ?::text ELSE ?::text END) WHERE (clubs.type = 'club' OR (clubs.type = 'bteam' AND squads.squad = 'Senior')) AND clubs.id != ? AND coalesce(clubs.parent_id,0) != ? GROUP BY clubs.id,clubs.name,clubs.type,squads.squad",
    state.date,
    youthBirthCutoff("U17", state.season),
    youthBirthCutoff("U19", state.season),
    state.clubId,
    state.clubId,
  );
  return squadShortfalls(rows, state.date);
}

type InSeasonTotals = Record<"moved" | "left" | "promoted" | "signed" | "registered", number>;

/** Season totals of the weekly in-season squad check (`maintainSquads`), undefined if none were recorded for `season`. */
async function inSeasonTotals(store: Store, season: number) {
  const row = await store.get<{ value: string }>("SELECT value FROM meta WHERE key = 'youthSquadCheck'");
  const check = row ? (JSON.parse(row.value) as { season: number; totals?: InSeasonTotals }) : undefined;
  return check?.season === season ? check.totals : undefined;
}

const describeInSeason = (totals: InSeasonTotals | undefined) =>
  totals
    ? `${totals.registered} trialists registered, ${totals.signed} free agents signed, ${totals.left} free agents left football, ${totals.promoted} academy promotions, ${totals.moved} over-age youths moved up`
    : "none recorded";

/** Every minor's registration could have been made under Article 19 (nationality, residence, family move, 16+ EU/UK). */
export async function checkMinors(store: Store, date: string) {
  const cutoff = `${Number(date.slice(0, 4)) - 18}${date.slice(4)}`;
  const codes = new Map((await store.all<{ id: number; code: string }>("SELECT id,code FROM countries")).map((row) => [row.id, row.code]));
  const minors = await store.all<{
    id: number;
    birth_date: string;
    code: string;
    club_code: string;
    club_data: string;
    identity: PlayerProfile["identity"];
    family: PlayerProfile["familyMove"] | null;
  }>(
    "SELECT players.id,players.birth_date,countries.code,club_country.code AS club_code,clubs.data AS club_data,players.profile::jsonb -> 'identity' AS identity,players.profile::jsonb -> 'familyMove' AS family FROM players JOIN countries ON countries.id = players.country_id JOIN clubs ON clubs.id = players.club_id JOIN countries AS club_country ON club_country.id = clubs.country_id WHERE players.birth_date > ? AND players.role != 'Retired' AND clubs.type != 'national'",
    cutoff,
  );
  const illegal = minors.filter((minor) => {
    const profile = {
      identity: minor.identity,
      ...(minor.family ? { familyMove: minor.family } : {}),
    };
    return !minorPresenceLegal({
      age: ageOn(minor.birth_date, date),
      nationalities: heldNationalities(minor.code, profile),
      destination: clubRegistration(minor.club_code, minor.club_data),
      residence: familyResidence(profile, minor.birth_date, date, (id) => codes.get(id)),
    });
  });
  assert.equal(illegal.length, 0, `Illegal U18 registrations on ${date}: players ${illegal.slice(0, 10).map((minor) => minor.id).join(",")}`);
  return minors.length;
}

/** Heights of players under 21: within bounds, and never lower than at the previous check. */
export async function checkYouthHeights(store: Store, date: string, previous: ReadonlyMap<number, number>) {
  const cutoff = `${Number(date.slice(0, 4)) - 21}${date.slice(4)}`;
  const rows = await store.all<{ id: number; height: number | null }>(
    "SELECT id,jsonb_path_query_first(profile::jsonb, '$.identity.height.double()', silent => true)::double precision AS height FROM players WHERE birth_date > ? AND role != 'Retired'",
    cutoff,
  );
  const failures = rows.filter(
    (row) => row.height === null || row.height < 125 || row.height > 210 || row.height < (previous.get(row.id) ?? 0),
  );
  assert.equal(failures.length, 0, `Youth height invariants failed on ${date}: players ${failures.slice(0, 10).map((row) => `${row.id}=${row.height}`).join(",")}`);
  return new Map(rows.map((row) => [row.id, row.height!]));
}

export interface SeniorPlace {
  league_id: number;
  club_id: number;
}

/** Senior domestic league place of every club (one standings row per club and league). */
export const seniorPlaces = (store: Store) =>
  store.all<SeniorPlace>(
    "SELECT standings.league_id,standings.club_id FROM standings JOIN leagues ON leagues.id = standings.league_id WHERE leagues.kind = 'league' AND leagues.age_group = 'Senior'",
  );

export const leagueSizes = (places: readonly SeniorPlace[]) => {
  const sizes = new Map<number, number>();
  for (const place of places) sizes.set(place.league_id, (sizes.get(place.league_id) ?? 0) + 1);
  return sizes;
};

/**
 * Section 8 invariant 6 after a rollover: league sizes as at world start less one per parked B-team, closed tiers
 * unchanged, moves per boundary equal to the movement spec (less the planner's recorded shortfalls, plus B-team
 * ceiling swaps), B-teams below their parent, parked B-teams without a league place.
 */
export async function checkMovement(store: Store, before: readonly SeniorPlace[], initialSizes: ReadonlyMap<number, number>) {
  const state = await stateOf(store);
  const after = await seniorPlaces(store);
  const audit = await store.meta<{ season: number; shortfalls: Record<string, number> }>("movementAudit");
  assert.equal(audit.season, state.season, "The rollover did not record its movement audit");
  const leagues = await store.all<{ id: number; name: string; country_id: number | null; tier: number; data: string }>(
    "SELECT id,name,country_id,tier,data FROM leagues WHERE kind = 'league' AND age_group = 'Senior'",
  );
  const failures: string[] = [];
  const sizes = leagueSizes(after);
  const parked = (
    await store.all<{ id: number; parent_id: number | null; league_id: number | null; data: string }>(
      "SELECT id,parent_id,league_id,data FROM clubs WHERE type = 'bteam' AND data::jsonb ->> 'parkedLeagueId' IS NOT NULL",
    )
  ).map((club) => ({ ...club, leagueId: Number(JSON.parse(club.data).parkedLeagueId) }));
  const parkedIn = new Map<number, number>();
  for (const club of parked) parkedIn.set(club.leagueId, (parkedIn.get(club.leagueId) ?? 0) + 1);
  for (const league of leagues)
    if ((sizes.get(league.id) ?? 0) !== (initialSizes.get(league.id) ?? 0) - (parkedIn.get(league.id) ?? 0))
      failures.push(
        `${league.name} has ${sizes.get(league.id) ?? 0} clubs (${initialSizes.get(league.id) ?? 0} at world start, ${parkedIn.get(league.id) ?? 0} B-teams parked)`,
      );
  const raw = new Map(leagues.map((league) => [league.id, JSON.parse(league.data) as Record<string, unknown>]));
  const own = leagues.filter((league) => league.tier > 0 && !["true", true, 1].includes(raw.get(league.id)!.reserveOnly as string));
  const byId = new Map(leagues.map((league) => [league.id, league]));
  const from = new Map(before.map((place) => [place.club_id, place.league_id]));
  const to = new Map(after.map((place) => [place.club_id, place.league_id]));
  const parents = new Map(
    (await store.all<{ id: number; parent_id: number; data: string }>(
      "SELECT id,parent_id,data FROM clubs WHERE type = 'bteam' AND parent_id IS NOT NULL",
    )).map((club) => [club.id, club]),
  );
  const tierAfter = (clubId: number) => byId.get(to.get(clubId) ?? 0)?.tier;
  for (const league of own) {
    const neighbour = (tier: number) =>
      raw.get(own.find((entry) => entry.country_id === league.country_id && entry.tier === tier)?.id ?? 0);
    const format = readLeagueData(raw.get(league.id)!, league.tier, { above: neighbour(league.tier - 1), below: neighbour(league.tier + 1) });
    const lower = own.find((entry) => entry.country_id === league.country_id && entry.tier === league.tier + 1);
    if (format.closed) {
      const changed = [...from, ...to].filter(
        ([clubId, leagueId]) => leagueId === league.id && (from.get(clubId) !== league.id || to.get(clubId) !== league.id),
      );
      if (changed.length) failures.push(`closed ${league.name} changed: clubs ${[...new Set(changed.map(([clubId]) => clubId))].slice(0, 6).join(",")}`);
    }
    if (!lower || !format.movementDown || format.closed || readLeagueData(raw.get(lower.id)!, lower.tier).closed) continue;
    // Clubs crossing this boundary, whatever tier they came from or went to.
    const crossing = (downwards: boolean) =>
      [...to.keys()].filter((clubId) => {
        const origin = byId.get(from.get(clubId) ?? 0);
        const destination = byId.get(to.get(clubId)!)!;
        if (!origin || origin.country_id !== league.country_id || destination.country_id !== league.country_id) return false;
        return downwards
          ? origin.tier <= league.tier && destination.tier > league.tier
          : origin.tier > league.tier && destination.tier <= league.tier;
      });
    const up = crossing(false);
    const down = crossing(true);
    const pushed = down.filter((clubId) => {
      const parent = parents.get(clubId)?.parent_id;
      return parent !== undefined && (tierAfter(parent) ?? 0) >= byId.get(from.get(clubId)!)!.tier;
    }).length;
    const fixed = boundaryMoves(format.movementDown);
    const short = audit.shortfalls[league.id] ?? 0;
    if (
      up.length !== down.length ||
      up.length < fixed.up - short ||
      down.length < fixed.down - short ||
      up.length > fixed.up + fixed.cross + pushed ||
      down.length > fixed.down + fixed.cross + pushed
    )
      failures.push(
        `${league.name} / ${lower.name}: ${up.length} up, ${down.length} down (spec ${fixed.up} up, ${fixed.down} down, ${fixed.cross} cross-tier; recorded shortfall ${short}; ${pushed} B-team ceiling moves)`,
      );
  }
  for (const club of parents.values()) {
    const league = byId.get(to.get(club.id) ?? 0);
    const parent = byId.get(to.get(club.parent_id) ?? 0);
    if (!league || !parent || league.country_id !== parent.country_id || !own.includes(league) || !own.includes(parent)) continue;
    const pyramid = JSON.parse(club.data).reservePolicy?.pyramid;
    const legal = pyramid
      ? reserveTierAllowed(
          { parentId: club.parent_id, highestTier: Number(pyramid.highestTier), minGapBelowParent: Number(pyramid.minGapBelowParent) },
          league.tier,
          parent.tier,
        )
      : league.tier > parent.tier;
    if (!legal) failures.push(`B-team ${club.id} in ${league.name} (tier ${league.tier}), parent in ${parent.name} (tier ${parent.tier})`);
  }
  // Parked B-teams hold no league place and stay parked only while their parent's division rules their league out.
  for (const club of parked) {
    const league = byId.get(club.leagueId);
    if (club.league_id !== null || to.has(club.id)) {
      failures.push(`parked B-team ${club.id} still has a league place`);
      continue;
    }
    if (!league) {
      failures.push(`parked B-team ${club.id} left unknown league ${club.leagueId}`);
      continue;
    }
    const parent = byId.get(to.get(club.parent_id ?? 0) ?? 0);
    const pyramid = JSON.parse(club.data).reservePolicy?.pyramid;
    const parentTier = parent && parent.country_id === league.country_id && own.includes(parent) ? parent.tier : undefined;
    if (
      !pyramid ||
      reserveTierAllowed(
        { parentId: club.parent_id ?? 0, highestTier: Number(pyramid.highestTier), minGapBelowParent: Number(pyramid.minGapBelowParent) },
        league.tier,
        parentTier,
      )
    )
      failures.push(`parked B-team ${club.id} was not re-admitted to ${league.name} (parent tier ${parentTier ?? "none"})`);
  }
  assert.equal(failures.length, 0, `Movement invariants failed after the ${state.season} rollover: ${failures.slice(0, 8).join("; ")}`);
  return { leagues: leagues.length, moved: [...to].filter(([clubId, leagueId]) => from.get(clubId) !== leagueId).length };
}

/**
 * Section 8 invariant 7 for the season the rollover created: entries equal the access lists (recomputed in calendar
 * order), no Russian club, no OFC club competition, Liechtenstein clubs only as the cup winner in UECL Q1, no club in
 * two senior club competitions.
 */
export async function checkContinentalEntries(store: Store) {
  const { season } = await stateOf(store);
  const failures: string[] = [];
  const codes = new Map(
    (await store.all<{ id: number; code: string }>(
      "SELECT clubs.id,countries.code FROM clubs JOIN countries ON countries.id = clubs.country_id",
    )).map((row) => [row.id, row.code]),
  );
  const ofc = await store.all<{ name: string }>("SELECT name FROM leagues WHERE kind = 'continental' AND confederation = 'OFC'");
  if (ofc.length) failures.push(`OFC club competitions: ${ofc.map((league) => league.name).join(", ")}`);
  const used = new Set<number>();
  const entered = new Map<number, string>();
  let total = 0;
  for (const spec of COMPETITIONS) {
    const catalog = spec.catalog;
    if (!catalog) continue;
    const separate = Boolean(catalog.feeder) || catalog.kind === "super" || spec.age !== "Senior";
    const expected = (await continentalEntries(store, catalog.id, season, separate ? new Set() : used)).filter(
      (entry) => clubCompetitionEligible(entry.club, spec.kind, season),
    );
    if (!separate) for (const entry of expected) used.add(entry.club.id);
    const main = await store.get<{ data: string }>("SELECT data FROM leagues WHERE name = ? AND country_id IS NULL", spec.name);
    const data = JSON.parse(main?.data ?? "{}") as {
      season?: number;
      phase?: string;
      qualification?: { clubId: number; stage: string }[];
    };
    if (data.season !== season) {
      if (expected.length) failures.push(`${spec.name} was not created for ${season} (${expected.length} clubs qualify)`);
      continue;
    }
    if (!Array.isArray(data.qualification)) {
      // The calendar stores every access list; only a competition not held, with nobody qualifying, may lack one.
      if (data.phase !== "not held" || expected.length)
        failures.push(
          `${spec.name}: no stored qualification list for ${season} (phase ${data.phase ?? "none"}, ${expected.length} clubs qualify)`,
        );
      continue;
    }
    const entries = data.qualification;
    total += entries.length;
    const want = expected.map((entry) => `${entry.club.id}:${entry.stage}`).sort();
    const got = entries.map((entry) => `${entry.clubId}:${entry.stage}`).sort();
    if (want.join() !== got.join())
      failures.push(
        `${spec.name}: ${got.length} entries, access list ${want.length} (missing ${want.filter((key) => !got.includes(key)).slice(0, 4).join(",")}; extra ${got.filter((key) => !want.includes(key)).slice(0, 4).join(",")})`,
      );
    if (new Set(entries.map((entry) => entry.clubId)).size !== entries.length) failures.push(`${spec.name}: a club is listed twice`);
    const russian = entries.filter((entry) => codes.get(entry.clubId) === "RU");
    if (russian.length) failures.push(`${spec.name}: Russian clubs ${russian.map((entry) => entry.clubId).join(",")}`);
    const liechtenstein = entries.filter((entry) => codes.get(entry.clubId) === "LI");
    if (liechtenstein.length && (spec.name !== "UEFA Conference League" || liechtenstein.length > 1 || liechtenstein[0].stage !== "q1"))
      failures.push(`${spec.name}: Liechtenstein entries ${liechtenstein.map((entry) => `${entry.clubId}:${entry.stage}`).join(",")}`);
    if (entries.filter((entry) => entry.stage === "main").length > catalog.teams)
      failures.push(`${spec.name}: more direct entrants than its ${catalog.teams} places`);
    if (separate) continue;
    for (const entry of entries) {
      if (entered.has(entry.clubId)) failures.push(`club ${entry.clubId} in ${entered.get(entry.clubId)} and ${spec.name}`);
      entered.set(entry.clubId, spec.name);
    }
  }
  assert.equal(failures.length, 0, `Continental entries for ${season} failed: ${failures.slice(0, 8).join("; ")}`);
  return total;
}

/** Forfeits (sides below seven eligible players) may not exceed this share of the season's played fixtures. */
export const FORFEIT_LIMIT = 0.005;

/** Forfeits of one finished season, with the worst clubs and age groups. */
export async function checkForfeits(store: Store, season: number) {
  const fixtures = (await store.get<{ total: number }>(
    "SELECT count(*) AS total FROM fixtures WHERE season = ? AND status = 'played'",
    season,
  ))!.total;
  const rows = await store.all<{ club_id: number; name: string; age_group: string; forfeits: number }>(
    "SELECT forfeited.club_id,clubs.name,forfeited.age_group,count(*) AS forfeits FROM (SELECT CASE WHEN fixtures.data::jsonb #> '{awarded,home}' = '0'::jsonb THEN fixtures.home_id ELSE fixtures.away_id END AS club_id,coalesce(leagues.age_group,'Senior') AS age_group FROM fixtures LEFT JOIN leagues ON leagues.id = fixtures.league_id WHERE fixtures.season = ? AND fixtures.status = 'played' AND jsonb_typeof(fixtures.data::jsonb -> 'awarded') = 'object') AS forfeited JOIN clubs ON clubs.id = forfeited.club_id GROUP BY forfeited.club_id,clubs.name,forfeited.age_group ORDER BY count(*) DESC,forfeited.club_id",
    season,
  );
  const forfeits = rows.reduce((total, row) => total + row.forfeits, 0);
  const ageGroups: Record<string, number> = {};
  for (const row of rows) ageGroups[row.age_group] = (ageGroups[row.age_group] ?? 0) + row.forfeits;
  const worst = rows.slice(0, 5).map((row) => `${row.name} (${row.club_id}) ${row.age_group} ${row.forfeits}`);
  const report = { season, fixtures, forfeits, rate: Math.round((forfeits / Math.max(1, fixtures)) * 10_000) / 10_000, ageGroups, worst };
  assert(
    forfeits <= fixtures * FORFEIT_LIMIT,
    `Forfeits in ${season}: ${forfeits} of ${fixtures} fixtures (limit ${FORFEIT_LIMIT * 100}%); by age group ${JSON.stringify(ageGroups)}; worst ${worst.join("; ")}`,
  );
  return report;
}

/**
 * Rollover checks: movement (invariant 6), the new season's continental entries (7), intake 5-12 per club aged
 * 14-15, squads, population ±10%, values and wages in bounds, and the finished season's forfeits.
 */
export async function checkRollover(
  store: Store,
  initialPlayers: number,
  heights: ReadonlyMap<number, number>,
  movement: { before: readonly SeniorPlace[]; initialSizes: ReadonlyMap<number, number> },
) {
  const state = await stateOf(store);
  const moved = await checkMovement(store, movement.before, movement.initialSizes);
  const continental = await checkContinentalEntries(store);
  const intake = await store.meta<{ season: number; clubs: Record<string, number> }>("youthIntake");
  assert.equal(intake.season, state.season, "Youth intake did not run for the new season");
  const clubs = await store.all<{ id: number }>("SELECT id FROM clubs WHERE type = 'club'");
  const outside = clubs.filter((club) => {
    const count = intake.clubs[club.id] ?? 0;
    return count < INTAKE.min || count > INTAKE.max;
  });
  assert.equal(outside.length, 0, `Intake outside ${INTAKE.min}-${INTAKE.max} at clubs ${outside.slice(0, 10).map((club) => club.id).join(",")}`);
  const cutoff = (years: number) => `${Number(state.date.slice(0, 4)) - years}${state.date.slice(4)}`;
  const wrongAge = (await store.get<{ total: number }>(
    "SELECT count(*) AS total FROM players WHERE profile::jsonb #>> '{intake,source}' = 'academy' AND profile::jsonb #>> '{intake,season}' = ? AND (birth_date > ? OR birth_date <= ?)",
    String(state.season),
    cutoff(14),
    cutoff(16),
  ))!.total;
  assert.equal(wrongAge, 0, "Academy intake players must be aged 14-15");
  await checkSquads(store, `after the ${state.season} rollover`);
  const players = await activePlayers(store);
  const flows = await store.meta<{ count: number; academy: number; topUps: number; pools: number; retired: number; leftFootball: number }>("lastIntake");
  const inSeason = await inSeasonTotals(store, state.season - 1);
  assert(
    Math.abs(players - initialPlayers) <= initialPlayers * 0.1,
    `Population ${players} is more than 10% from the initial ${initialPlayers} (rollover: ${flows.count} created, ${flows.retired} retired, ${flows.leftFootball} left football; weekly squad check ${state.season - 1}: ${describeInSeason(inSeason)})`,
  );
  const badMoney = (await store.get<{ total: number }>(
    `SELECT count(*) AS total FROM players WHERE role != 'Retired' AND (value IS NULL OR value < ${VALUE_RANGE.min} OR value > ${VALUE_RANGE.max} OR wage IS NULL OR wage < 0 OR wage > 1200000)`,
  ))!.total;
  assert.equal(badMoney, 0, "Player values or wages outside the section 8 bounds");
  const minors = await checkMinors(store, state.date);
  const forfeits = await checkForfeits(store, state.season - 1);
  return {
    season: state.season,
    players,
    flows,
    inSeason,
    academy: Object.values(intake.clubs).reduce((total, count) => total + count, 0),
    minors,
    moved: moved.moved,
    continentalEntries: continental,
    forfeits,
    heights: await checkYouthHeights(store, state.date, heights),
  };
}

export async function seasonSoak(seasons: number, fullWorld = false, nations: readonly string[] = SOAK_NATIONS) {
  assert(
    Number.isInteger(seasons) && seasons > 0,
    "Choose a positive number of seasons",
  );
  const store = await Store.createTest("simulation-check");
  try {
    assert(
      store.testMode && store.schemaName !== "public",
      "Simulation checks cannot use gameplay schemas",
    );
    await store.schema();
    await generateWorld(store, fullWorld ? {} : { nations: [...nations] });
    await store.setMeta("settings", {
      ...(await store.meta<Record<string, unknown>>("settings")),
      autosave: "off",
    });
    const end = `${2026 + seasons}-07-02`;
    const initialPlayers = await activePlayers(store);
    const initialSizes = leagueSizes(await seniorPlaces(store));
    const generated = await reportFootprint(store, "after generation");
    let worldMB = generated.worldMB;
    await checkSquads(store, "world start");
    await checkMinors(store, (await stateOf(store)).date);
    let heights = await checkYouthHeights(store, (await stateOf(store)).date, new Map());
    const rollovers: (Omit<Awaited<ReturnType<typeof checkRollover>>, "heights"> & {
      worldMB: number;
      seasonMB: number | undefined;
      seasonStartPlayers: number;
      playersBeforeRollover: number;
    })[] = [];
    const squadChecks: SquadCheck[] = [];
    let seasonStartPlayers = initialPlayers;
    let simulated = 0;
    let weeks = 0;
    let advanceSeconds = 0;
    const timing = () => {
      const perWeek = advanceSeconds / Math.max(1, weeks);
      return {
        matchesPerSecond: Math.round((simulated / Math.max(0.01, advanceSeconds)) * 10) / 10,
        secondsPerWeek: Math.round(perWeek * 10) / 10,
        // First-order scaling by fixture volume: ~110k fixtures a season in the full v4 world.
        fullWorldSecondsPerWeek: Math.round((perWeek * (110_000 / 52)) / Math.max(1, simulated / Math.max(1, weeks))),
      };
    };
    while ((await stateOf(store)).date < end) {
      const current = await stateOf(store);
      if (current.gameOver)
        await store.setMeta("state", { ...current, gameOver: false });
      // Steps end on 1 July so every rollover is checked on the day it runs.
      const step = Math.min(
        7,
        daysBetween(current.date, end),
        Math.max(1, daysBetween(current.date, `${current.season + 1}-07-01`)),
      );
      const before =
        daysBetween(current.date, `${current.season + 1}-07-01`) <= step ? await seniorPlaces(store) : undefined;
      const playersBeforeRollover = before ? await activePlayers(store) : undefined;
      const result = await advance(store, step);
      const now = await stateOf(store);
      if (now.season !== current.season) {
        assert(before && playersBeforeRollover !== undefined, "A rollover ran before the step that reaches 1 July");
        const { heights: next, ...summary } = await checkRollover(store, initialPlayers, heights, { before, initialSizes });
        heights = next;
        console.log(
          `Rollover ${summary.season}: ${summary.players} players, ${summary.academy} academy intake, ${summary.minors} minors checked, ${summary.moved} clubs moved, ${summary.continentalEntries} continental entries, ${summary.forfeits.forfeits} forfeits in ${summary.forfeits.fixtures} fixtures`,
        );
        const change = (value: number) => `${value >= 0 ? "+" : ""}${value}`;
        const { flows, inSeason } = summary;
        console.log(
          `Population ${summary.season - 1}/${String(summary.season).slice(-2)}: ${seasonStartPlayers} at the start; ${playersBeforeRollover} before the rollover (${change(playersBeforeRollover - seasonStartPlayers)}; weekly squad check: ${describeInSeason(inSeason)}); ` +
            `${summary.players} after it (${change(summary.players - playersBeforeRollover)}; ${flows.count} created incl. ${flows.academy} academy, ${flows.topUps} top-up places, ${flows.pools} home-pool entrants, ${flows.retired} retired, ${flows.leftFootball} left football)`,
        );
        const footprint = await reportFootprint(store, `after the ${summary.season} rollover`, worldMB);
        worldMB = footprint.worldMB;
        rollovers.push({ ...summary, ...footprint, seasonStartPlayers, playersBeforeRollover });
        seasonStartPlayers = summary.players;
      }
      simulated += result.matches;
      advanceSeconds += result.seconds;
      weeks++;
      const invalid = (await store.get<{ total: number }>(
        "SELECT count(*) AS total FROM players WHERE ability < 1 OR ability > 99 OR potential < ability OR potential > 99 OR morale < 0 OR morale > 100",
      ))!.total;
      assert.equal(invalid, 0, `Player invariants failed on ${result.date}`);
      const badTable = (await store.get<{ total: number }>(
        "SELECT count(*) AS total FROM standings WHERE played != wins + draws + losses OR points != wins * 3 + draws - deducted",
      ))!.total;
      assert.equal(badTable, 0, `Table conservation failed on ${result.date}`);
      // First step on or after each checkpoint; failures are reported now and fail the soak at the end.
      if (squadCheckpoints(now.season).some((date) => date <= now.date && !squadChecks.some((check) => check.date >= date))) {
        const report = await checkInSeasonSquads(store);
        squadChecks.push(report);
        console.log(`In-season squads ${describeSquadCheck(report)}`);
        if (!report.ok && process.env.GITHUB_ACTIONS === "true")
          console.log(`::error title=In-season squads::${describeSquadCheck(report)}`);
      }
      if (weeks % 13 === 0) {
        const { matchesPerSecond, secondsPerWeek, fullWorldSecondsPerWeek } = timing();
        console.log(
          `Soak ${result.date}: ${simulated} matches; ${await activePlayers(store)} active players; ${matchesPerSecond} matches/s, ${secondsPerWeek} s per simulated week (full world ≈ ${fullWorldSecondsPerWeek} s/week)`,
        );
      }
    }
    assert.equal(rollovers.length, seasons, "Every season must roll over");
    await checkSqlConstraints(store);
    const failedChecks = squadChecks.filter((check) => !check.ok);
    assert.equal(
      failedChecks.length,
      0,
      `In-season squad minimums failed at ${failedChecks.length} of ${squadChecks.length} checkpoints: ${failedChecks.map(describeSquadCheck).join(" | ")}`,
    );
    const result = {
      seasons,
      fullWorld,
      nations: fullWorld ? "all" : nations.join(","),
      date: (await stateOf(store)).date,
      matches: simulated,
      timing: timing(),
      initialPlayers,
      players: await activePlayers(store),
      generatedWorldMB: generated.worldMB,
      rollovers,
      squadChecks,
      archivedLeagueSeasons: (await store.get<{ total: number }>(
        "SELECT count(*) AS total FROM history WHERE entity_type = 'league'",
      ))!.total,
      closedFinancialPeriods: (await store.get<{ total: number }>(
        "SELECT count(*) AS total FROM financial_periods WHERE closed = 1",
      ))!.total,
      integrity: "ok",
    };
    return result;
  } finally {
    await store.close();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const seasons = Number(
    process.argv
      .find((value) => value.startsWith("--seasons="))
      ?.split("=")[1] ?? 0,
  );
  const fullWorld = process.argv.includes("--full-world");
  const nations = process.argv
    .find((value) => value.startsWith("--nations="))
    ?.split("=")[1]
    ?.split(",")
    .filter(Boolean);
  const start = performance.now();
  console.log(
    JSON.stringify(
      {
        calibration: calibrationSample(),
        ...(seasons > 0 ? { soak: await seasonSoak(seasons, fullWorld, nations?.length ? nations : SOAK_NATIONS) } : {}),
        seconds: Math.round((performance.now() - start) / 1000),
      },
      null,
      2,
    ),
  );
}
