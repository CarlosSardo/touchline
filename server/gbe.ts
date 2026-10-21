// Governing Body Endorsement data: the monthly minutes ledger written by every senior match, the club season outcome
// archive, national-team months (ranking and matches), the pre-game career estimate (world generation, and lazily
// for older worlds and saves), the evidence loader for shared/gbe's calculator and the per-player assessment cache.
import seedrandom from "seedrandom";
import type { Store } from "./db.ts";
import { passportGroup } from "./registration.ts";
import { GameError } from "./systems.ts";
import { addDays, clamp, disciplineScope, START_DATE } from "../shared/rules.ts";
import { allNations } from "../shared/world-catalog/index.ts";
import { selectNationalSquad, type SquadCandidate } from "../shared/features/youth-internationals.ts";
import {
  calculateGbe,
  gbeLeagueBand,
  gbeRulesetFor,
  gbeWindowStart,
  type GbeAssessment,
  type GbeContinentalRun,
  type GbeCriterion,
  type GbeCriterionStatus,
  type GbeEvidence,
  type GbeSpell,
} from "../shared/gbe/index.ts";
import type { GameState, League, MatchResult, MatchTeam, Position } from "../shared/types.ts";

export type LedgerKind = "league" | "cup" | "continental" | "qualifying" | "international" | "friendly";

/** The senior international friendlies competition (one league row, scheduled in the FIFA windows). */
export const FRIENDLIES_NAME = "International Friendlies";
const META = "gbeBaseline";
const BASELINE_VERSION = 1;
/** Ledger months kept: the longest window (24 months) plus the current month. */
const KEPT_MONTHS = 25;
/**
 * A cached assessment older than this (days since the last refresh) is recalculated on request. The whole cache is
 * refreshed once a month (the ledger's granularity) and at rollover; caps, moves and requests refresh single players.
 */
const STALE_DAYS = 38;

// ------------------------------------------------------------------------------------------- dates

const monthOf = (date: string) => date.slice(0, 7);
export function addMonths(month: string, months: number) {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}
const seasonLabel = (season: number) => `${season}/${String((season + 1) % 100).padStart(2, "0")}`;

// ------------------------------------------------------------------------------------------- shared lookups

interface LeagueInfo {
  id: number;
  name: string;
  kind: League["kind"];
  tier: number;
  age_group: string;
  country_code: string | null;
  catalog_id: string | null;
  catalog_format: string | null;
  catalog_kind: string | null;
  playoff_league: number | null;
  qualifying: boolean;
  friendly: boolean;
}

async function leagueInfo(store: Store, ids?: readonly number[]) {
  const rows = await store.all<LeagueInfo>(
    `SELECT leagues.id, leagues.name, leagues.kind, leagues.tier, leagues.age_group, countries.code AS country_code,
       doc #>> '{spec,catalog,id}' AS catalog_id, doc #>> '{spec,catalog,format}' AS catalog_format,
       doc #>> '{spec,catalog,kind}' AS catalog_kind,
       CASE WHEN doc ->> 'playoff' = 'true' AND doc ->> 'leagueId' ~ '^[0-9]+$' THEN (doc ->> 'leagueId')::integer END AS playoff_league,
       (doc ->> 'catalogQualifying' = 'true' OR leagues.name LIKE '% Qualifying') AS qualifying,
       COALESCE(doc #>> '{spec,friendly}' = 'true', false) AS friendly
     FROM leagues LEFT JOIN countries ON countries.id = leagues.country_id
     CROSS JOIN LATERAL (SELECT leagues.data::jsonb AS doc OFFSET 0) AS parsed
     ${ids ? "WHERE leagues.id = ANY(?::integer[])" : ""}`,
    ...(ids ? [ids] : []),
  );
  return new Map(rows.map((row) => [row.id, { ...row, qualifying: !!row.qualifying, friendly: !!row.friendly }]));
}

/** Ledger kind and competition row of a senior fixture, or null when GBE does not count it (youth, friendlies of clubs). */
export function ledgerCompetition(league: LeagueInfo | undefined, stage: string): { kind: LedgerKind; leagueId: number } | null {
  if (!league || league.age_group !== "Senior") return null;
  if (league.kind === "league") return { kind: "league", leagueId: league.id };
  if (league.kind === "cup")
    return league.playoff_league ? { kind: "league", leagueId: league.playoff_league } : { kind: "cup", leagueId: league.id };
  if (league.kind === "continental")
    return {
      kind: league.qualifying || stage === "Qualifying" || league.catalog_kind === "super" ? "qualifying" : "continental",
      leagueId: league.id,
    };
  if (league.kind === "international") return { kind: league.friendly ? "friendly" : "international", leagueId: league.id };
  return null;
}

/** Aggregated ranking of every FIFA member: the world's senior national teams by reputation, the rest from the catalog. */
async function nationalRanks(store: Store) {
  const world = new Map(
    (
      await store.all<{ code: string; reputation: number }>(
        "SELECT countries.code, clubs.reputation FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE clubs.type = 'national' AND clubs.age_group = 'Senior'",
      )
    ).map((row) => [row.code, row.reputation]),
  );
  const strength = new Map(allNations().map((nation) => [nation.code, nation.reputation.national]));
  for (const [code, reputation] of world) strength.set(code, reputation);
  const order = [...strength].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return new Map(order.map(([code], index) => [code, index + 1]));
}

// ------------------------------------------------------------------------------------------- match ledger

export interface GbeMatch {
  fixture: { league_id: number | null; stage: string; date: string };
  league: Pick<League, "id" | "kind" | "confederation" | "data"> | undefined;
  teams: readonly MatchTeam[];
  result: Pick<MatchResult, "players" | "wentToExtraTime">;
}

/** One month of a player at a team in a competition (merged into the season row of player_minutes_monthly). */
interface LedgerRow {
  player_id: number;
  month: string;
  club_id: number;
  league_id: number;
  kind: LedgerKind;
  available: number;
  minutes: number;
  appearances: number;
  listed: number;
  unavailable: number;
}

const MEASURES = ["available", "minutes", "appearances", "listed", "unavailable"] as const;

/** Club season (July-June, by its starting year) of a month, and the month's place in it (0 = July). */
export function ledgerSeason(month: string): [season: number, index: number] {
  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5, 7));
  return number >= 7 ? [year, number - 7] : [year - 1, number + 5];
}

/**
 * The ledger as one row per player, team, competition and month with any activity (player_id, club_id, league_id,
 * kind, estimated, month 'YYYY-MM' and the five measures). `where` filters the season rows (alias `ledger`).
 */
export const monthlyLedger = (where: string) => `(
  SELECT ledger.player_id, ledger.club_id, ledger.league_id, ledger.kind, ledger.estimated,
    (ledger.season + (m.i + 5) / 12)::text || '-' || lpad(((m.i + 5) % 12 + 1)::text, 2, '0') AS month,
    v[m.i] AS available, v[12 + m.i] AS minutes, v[24 + m.i] AS appearances, v[36 + m.i] AS listed, v[48 + m.i] AS unavailable
  FROM player_minutes_monthly AS ledger
  CROSS JOIN LATERAL (SELECT array_replace(string_to_array(ledger.data, ',', '')::integer[], NULL, 0) AS v) AS parsed
  CROSS JOIN generate_series(1, 12) AS m(i)
  WHERE (${where}) AND v[m.i] + v[12 + m.i] + v[24 + m.i] + v[36 + m.i] + v[48 + m.i] > 0
) AS monthly`;

/** Writes and empties `rows` once it holds many (keeps world-sized seeding and rebuilds within a small memory budget). */
async function spill(store: Store, rows: LedgerRow[], estimated = false) {
  if (rows.length >= 50_000) await upsertLedger(store, rows.splice(0), estimated);
}

/** Adds monthly rows to their season rows (values are summed with what is stored). */
async function upsertLedger(store: Store, rows: readonly LedgerRow[], estimated = false) {
  const merged = new Map<string, { player_id: number; season: number; club_id: number; league_id: number; kind: string; data: number[] }>();
  for (const row of rows) {
    const [season, index] = ledgerSeason(row.month);
    const key = `${row.player_id}:${season}:${row.club_id}:${row.league_id}:${row.kind}`;
    let entry = merged.get(key);
    if (!entry) {
      entry = { player_id: row.player_id, season, club_id: row.club_id, league_id: row.league_id, kind: row.kind, data: Array(60).fill(0) };
      merged.set(key, entry);
    }
    MEASURES.forEach((measure, offset) => (entry.data[offset * 12 + index] += Math.round(Number(row[measure]))));
  }
  const all = [...merged.values()];
  for (let offset = 0; offset < all.length; offset += 5000) {
    const chunk = all.slice(offset, offset + 5000);
    await store.run(
      `INSERT INTO player_minutes_monthly AS target (player_id, season, club_id, league_id, kind, data, estimated)
       SELECT *, ?::boolean FROM unnest(?::integer[], ?::integer[], ?::integer[], ?::integer[], ?::text[], ?::text[])
       ON CONFLICT (player_id, season, club_id, league_id, kind) DO UPDATE SET
         data = (SELECT string_agg(COALESCE(NULLIF(COALESCE(stored, 0) + COALESCE(added, 0), 0)::text, ''), ',' ORDER BY position)
                 FROM unnest(string_to_array(target.data, ',', '')::integer[], string_to_array(EXCLUDED.data, ',', '')::integer[])
                   WITH ORDINALITY AS pair(stored, added, position)),
         estimated = target.estimated AND EXCLUDED.estimated`,
      estimated,
      chunk.map((row) => row.player_id),
      chunk.map((row) => row.season),
      chunk.map((row) => row.club_id),
      chunk.map((row) => row.league_id),
      chunk.map((row) => row.kind),
      chunk.map((row) => row.data.map((value) => value || "").join(",")),
    );
  }
}

/**
 * Records senior competitive matches for GBE (one statement per batch): every first-team player of a club side gets
 * the match's available minutes, minus the minutes of matches he was unavailable for (injured, suspended or on
 * international duty), plus the matchday-squad listing (unused substitutes included) and his minutes. National sides
 * record their named matchday squad; the matches available to a nation come from its fixtures.
 */
export async function recordGbeMatches(store: Store, date: string, matches: readonly GbeMatch[], onDuty: ReadonlySet<number>) {
  const counted = matches.flatMap((match) => {
    if (!match.fixture.league_id || !match.league) return [];
    return [{ match }];
  });
  if (!counted.length) return;
  const leagues = await leagueInfo(store, [...new Set(counted.map(({ match }) => match.fixture.league_id!))]);
  const sides: { club_id: number; scope: string; k: number }[] = [];
  const plans = counted.flatMap(({ match }) => {
    const competition = ledgerCompetition(leagues.get(match.fixture.league_id!), match.fixture.stage);
    if (!competition) return [];
    const length = match.result.wentToExtraTime ? 120 : 90;
    return [{ match, competition, length }];
  });
  if (!plans.length) return;
  const clubs = new Map(
    (
      await store.all<{ id: number; type: string }>(
        "SELECT id, type FROM clubs WHERE id = ANY(?::integer[])",
        [...new Set(plans.flatMap(({ match }) => match.teams.map((team) => team.id)))],
      )
    ).map((club) => [club.id, club.type]),
  );
  plans.forEach(({ match }, index) => {
    for (const team of match.teams)
      if (clubs.get(team.id) !== "national") sides.push({ club_id: team.id, scope: disciplineScope(match.league), k: index });
  });
  const squads = new Map<number, { id: number; injured: boolean; suspended: boolean }[]>();
  if (sides.length)
    for (const row of await store.all<{ club_id: number; id: number; injured: boolean; suspended: boolean }>(
      `SELECT side.club_id, players.id, COALESCE(players.injury_until > ?, false) AS injured,
         EXISTS (SELECT 1 FROM discipline WHERE discipline.player_id = players.id AND discipline.scope = side.scope AND discipline.suspension > 0) AS suspended
       FROM unnest(?::integer[], ?::text[]) AS side(club_id, scope)
       JOIN players ON players.playing_club_id = side.club_id AND players.age_group = 'Senior' AND players.role <> 'Retired'`,
      date,
      sides.map((side) => side.club_id),
      sides.map((side) => side.scope),
    ))
      squads.set(row.club_id, [...(squads.get(row.club_id) ?? []), row]);
  const month = monthOf(date);
  const rows: LedgerRow[] = [];
  for (const { match, competition, length } of plans)
    for (const team of match.teams) {
      const listed = new Set([...team.lineup, ...(team.bench ?? [])].map((player) => player.id));
      const base = { month, club_id: team.id, league_id: competition.leagueId, kind: competition.kind };
      const minutesOf = (id: number) => Math.round(Number(match.result.players[id]?.minutes ?? 0));
      if (clubs.get(team.id) === "national") {
        for (const id of listed) {
          const played = minutesOf(id);
          rows.push({ ...base, player_id: id, available: 0, minutes: played, appearances: played > 0 ? 1 : 0, listed: 1, unavailable: 0 });
        }
        continue;
      }
      const squad = squads.get(team.id) ?? [];
      const members = new Set(squad.map((player) => player.id));
      for (const player of squad) {
        const named = listed.has(player.id);
        const away = !named && (player.injured || player.suspended || onDuty.has(player.id));
        const played = named ? minutesOf(player.id) : 0;
        rows.push({
          ...base,
          player_id: player.id,
          available: away ? 0 : length,
          minutes: played,
          appearances: played > 0 ? 1 : 0,
          listed: named ? 1 : 0,
          unavailable: away ? length : 0,
        });
      }
      // Called-up youngsters and players of another squad who were named for this team.
      for (const id of listed)
        if (!members.has(id)) {
          const played = minutesOf(id);
          rows.push({ ...base, player_id: id, available: length, minutes: played, appearances: played > 0 ? 1 : 0, listed: 1, unavailable: 0 });
        }
    }
  await upsertLedger(store, rows);
}

// ------------------------------------------------------------------------------------------- season archive

interface ArchivedTable {
  name?: string;
  table?: { club_id: number }[];
  champion?: number;
}

/** Best stage per (club, competition) in a season's senior continental fixtures (played or drawn). */
async function continentalRuns(store: Store, season: number, leagues: Map<number, LeagueInfo>) {
  const ids = [...leagues.values()].filter((league) => league.kind === "continental" && league.age_group === "Senior" && !league.qualifying && league.catalog_kind !== "super").map((league) => league.id);
  if (!ids.length) return new Map<number, { leagueId: number; stages: string[] }[]>();
  const rows = await store.all<{ club_id: number; league_id: number; stages: string[] }>(
    `SELECT side.club_id, fixtures.league_id, array_agg(DISTINCT fixtures.stage) AS stages
     FROM fixtures CROSS JOIN LATERAL (VALUES (fixtures.home_id), (fixtures.away_id)) AS side(club_id)
     WHERE fixtures.season = ? AND fixtures.league_id = ANY(?::integer[]) AND fixtures.status IN ('played', 'scheduled')
     GROUP BY side.club_id, fixtures.league_id`,
    season,
    ids,
  );
  const runs = new Map<number, { leagueId: number; stages: string[] }[]>();
  for (const row of rows) runs.set(row.club_id, [...(runs.get(row.club_id) ?? []), { leagueId: row.league_id, stages: row.stages }]);
  return runs;
}

const STAGE_RANK = ["Qualifying", "League phase", "Group stage", "Knockout round play-offs", "Knockout play-off", "Round of 32", "Round of 16", "Quarter-final", "Semi-final", "Final"];
const bestStage = (stages: readonly string[]) =>
  [...stages].sort((left, right) => STAGE_RANK.indexOf(right) - STAGE_RANK.indexOf(left))[0] ?? "Qualifying";

/**
 * Archives every senior club's season (final position, title, promotion/relegation, continental run) from the
 * season's league archives and the clubs' leagues after the season's movements. Called at rollover; also rebuilds
 * the last season for worlds that predate the archive.
 */
export async function archiveClubSeasons(store: Store, season: number) {
  const archives = await store.all<{ entity_id: number; data: ArchivedTable }>(
    "SELECT DISTINCT ON (entity_id) entity_id, data::jsonb AS data FROM history WHERE entity_type = 'league' AND season = ? ORDER BY entity_id, id DESC",
    season,
  );
  if (!archives.length) return 0;
  const leagues = await leagueInfo(store);
  const current = new Map(
    (await store.all<{ id: number; league_id: number | null }>("SELECT id, league_id FROM clubs WHERE type <> 'national'")).map((club) => [club.id, club.league_id]),
  );
  const runs = await continentalRuns(store, season, leagues);
  const rows: Record<string, unknown>[] = [];
  for (const archive of archives) {
    const league = leagues.get(archive.entity_id);
    if (!league || league.kind !== "league" || league.age_group !== "Senior" || !league.country_code) continue;
    const table = archive.data.table ?? [];
    const champion = archive.data.champion ?? table[0]?.club_id;
    table.forEach((entry, index) => {
      const now = current.get(entry.club_id);
      const nowLeague = now ? leagues.get(now) : undefined;
      const sameCountry = nowLeague?.country_code === league.country_code;
      rows.push({
        club_id: entry.club_id,
        season,
        league_id: league.id,
        country_code: league.country_code,
        tier: league.tier,
        position: index + 1,
        clubs: table.length,
        champion: entry.club_id === champion,
        promoted: !!nowLeague && sameCountry && nowLeague.tier < league.tier,
        relegated: !!nowLeague && sameCountry && nowLeague.tier > league.tier,
        continental: JSON.stringify(
          (runs.get(entry.club_id) ?? []).map((run) => ({
            leagueId: run.leagueId,
            catalogId: leagues.get(run.leagueId)?.catalog_id ?? null,
            competition: leagues.get(run.leagueId)?.name ?? "",
            stage: bestStage(run.stages),
            knockoutOnly: leagues.get(run.leagueId)?.catalog_format === "knockout",
          })),
        ),
        qualified: null,
        estimated: false,
      });
    });
  }
  await writeClubSeasons(store, rows);
  return rows.length;
}

async function writeClubSeasons(store: Store, rows: readonly Record<string, unknown>[]) {
  const columns = ["club_id", "season", "league_id", "country_code", "tier", "position", "clubs", "champion", "promoted", "relegated", "continental", "qualified", "estimated"];
  const types: Record<string, string> = { country_code: "text", continental: "text", qualified: "text", champion: "boolean", promoted: "boolean", relegated: "boolean", estimated: "boolean" };
  for (let offset = 0; offset < rows.length; offset += 5000) {
    const chunk = rows.slice(offset, offset + 5000);
    await store.run(
      `INSERT INTO club_season_outcomes (${columns.join(", ")})
       SELECT * FROM unnest(${columns.map((column) => `?::${types[column] ?? "integer"}[]`).join(", ")})
       ON CONFLICT (club_id, season) DO UPDATE SET ${columns.slice(2).map((column) => `${column} = EXCLUDED.${column}`).join(", ")}`,
      ...columns.map((column) => chunk.map((row) => (row[column] ?? null) as string | number | boolean | null)),
    );
  }
}

/** Rollover: the finished season's outcomes, then ledger rows that left every window (or whose player is gone). */
export async function closeGbeSeason(store: Store, season: number, date: string) {
  await archiveClubSeasons(store, season);
  const oldest = addMonths(monthOf(date), -(KEPT_MONTHS - 1));
  await store.run("DELETE FROM player_minutes_monthly WHERE season < ?", ledgerSeason(oldest)[0]);
  await store.run("DELETE FROM national_team_months WHERE month < ?", oldest);
  await store.run("DELETE FROM club_season_outcomes WHERE season < ?", season - 2);
  await store.run(
    "DELETE FROM player_minutes_monthly AS ledger WHERE NOT EXISTS (SELECT 1 FROM players WHERE players.id = ledger.player_id)",
  );
  await store.run("DELETE FROM player_gbe WHERE NOT EXISTS (SELECT 1 FROM players WHERE players.id = player_gbe.player_id)");
}

// ------------------------------------------------------------------------------------------- pre-game baseline

interface BaselineMeta {
  version: number;
  /** Month from which the ledger was recorded by matches (months before are estimated or rebuilt). */
  recordedFrom: string;
  /** First month the ledger covers (the pre-game estimate starts 24 months before the world). */
  coverageFrom: string;
  continental: boolean;
}

/** Months of the club season (August-May) of season `season` (starting year). */
const seasonMonths = (season: number) => Array.from({ length: 10 }, (_, index) => addMonths(`${season}-08`, index));

/** Expected share of a club's league minutes by depth in the position line, for the pre-game estimate. */
function minutesShare(random: () => number, depth: number, slots: number, goalkeeper: boolean, starter: boolean) {
  const between = (low: number, high: number) => low + (high - low) * random();
  if (goalkeeper) return starter || depth === 0 ? between(0.85, 0.98) : depth === 1 ? between(0.02, 0.14) : between(0, 0.03);
  if (starter || depth < slots) return between(0.62, 0.93);
  if (depth < slots + Math.ceil(slots / 2)) return between(0.25, 0.52);
  if (depth < slots * 2) return between(0.06, 0.24);
  return between(0, 0.07);
}

/** Minutes share by age in that season: debuts come at 17-19, veterans play a little less. */
const ageFactor = (age: number) => (age <= 16 ? 0 : age === 17 ? 0.3 : age === 18 ? 0.55 : age === 19 ? 0.8 : age === 20 ? 0.92 : age >= 35 ? 0.85 : 1);

const LINE: Record<Position, "GK" | "DEF" | "MID" | "ATT"> = {
  GK: "GK", CB: "DEF", RB: "DEF", LB: "DEF", DM: "MID", CM: "MID", AM: "MID", RW: "ATT", LW: "ATT", ST: "ATT",
} as Record<Position, "GK" | "DEF" | "MID" | "ATT">;
const LINE_SLOTS = { GK: 1, DEF: 4, MID: 3, ATT: 3 };

interface BaselinePlayer {
  id: number;
  club_id: number;
  position: Position;
  ability: number;
  potential: number;
  birth_date: string;
  role: string;
  league_id: number;
  league_clubs: number;
}

/** Birth dates from which a debut or an ESC record can still matter (ESC: born on or after 1 January 2003). */
const YOUNG_FROM = "2003-01-01";

/** Pre-game club minutes for the two seasons before the world began (current squads, deterministic per seed). */
async function seedClubMinutes(store: Store, seed: string, generated: string) {
  const players = await store.all<BaselinePlayer>(
    `SELECT players.id, players.playing_club_id AS club_id, players.position, players.ability, players.potential, players.birth_date, players.role,
       clubs.league_id, (SELECT count(*) FROM standings WHERE standings.league_id = clubs.league_id) AS league_clubs
     FROM players JOIN clubs ON clubs.id = players.playing_club_id JOIN leagues ON leagues.id = clubs.league_id
     WHERE players.age_group = 'Senior' AND players.role <> 'Retired' AND clubs.type <> 'national'
       AND leagues.kind = 'league' AND leagues.age_group = 'Senior'
     ORDER BY players.playing_club_id, players.ability DESC, players.id`,
  );
  const byClub = new Map<number, BaselinePlayer[]>();
  for (const player of players) byClub.set(player.club_id, [...(byClub.get(player.club_id) ?? []), player]);
  const startSeason = Number(generated.slice(0, 4));
  const shares = new Map<number, Map<number, number>>();
  const rows: LedgerRow[] = [];
  for (const [clubId, squad] of byClub) {
    await spill(store, rows, true);
    const random = seedrandom(`${seed}:gbe:club:${clubId}`);
    const matches = clamp(2 * (Number(squad[0].league_clubs) - 1), 10, 46);
    for (const season of [startSeason - 2, startSeason - 1]) {
      const months = seasonMonths(season);
      const perMonth = months.map((_, index) => Math.floor(matches / 10) + (index < matches % 10 ? 1 : 0));
      const depth = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
      // Abilities a season or two earlier: young players were weaker, so they rank lower in their line.
      const then = squad
        .map((player) => {
          const age = season - Number(player.birth_date.slice(0, 4));
          const growth = Math.max(0, Math.min(player.potential - player.ability, (startSeason - season) * Math.max(0, 24 - age) * 0.9));
          return { player, age, ability: player.ability - growth };
        })
        .sort((left, right) => right.ability - left.ability || left.player.id - right.player.id);
      for (const { player, age } of then) {
        const line = LINE[player.position] ?? "MID";
        const starter = player.role === "Regular starter" || player.role === "Key player" || player.role === "Captain";
        let share = minutesShare(random, depth[line], LINE_SLOTS[line], line === "GK", starter && season === startSeason - 1) * ageFactor(age);
        depth[line]++;
        const injured = random() < 0.12 ? 0.2 + random() * 0.3 : random() * 0.05;
        const injuryStart = Math.floor(random() * 10);
        const injuryMonths = Math.round(injured * 10);
        // Fringe players are on the bench now and then; about half of the deepest reserves never make a squad.
        const listedRate =
          share < 0.03 ? (ageFactor(age) > 0 && random() < 0.5 ? random() * 0.2 : 0) : Math.min(1, share + 0.2 + random() * 0.15);
        if (season === startSeason - 1) {
          const owner = shares.get(clubId) ?? new Map<number, number>();
          owner.set(player.id, share);
          shares.set(clubId, owner);
        }
        const seasonRows = months.flatMap((month, index): LedgerRow[] => {
          const count = perMonth[index];
          if (!count) return [];
          const away = index >= injuryStart && index < injuryStart + injuryMonths ? count : 0;
          const fit = count - away;
          share = clamp(share, 0, 1);
          const listed = Math.round(fit * listedRate);
          const played = Math.round(fit * 90 * share * (0.85 + random() * 0.3));
          const appearances = Math.min(listed, Math.round(fit * Math.min(1, share * 1.25)));
          return [{
            player_id: player.id,
            month,
            club_id: clubId,
            league_id: player.league_id,
            kind: "league",
            available: fit * 90,
            minutes: Math.min(fit * 90, appearances ? played : 0),
            appearances,
            listed: Math.max(listed, appearances),
            unavailable: away * 90,
          }];
        });
        if (season === startSeason - 1) rows.push(...seasonRows);
        // The season before only matters for young players (a Youth Player's debut, ESC matches): one summary row.
        else if (player.birth_date >= YOUNG_FROM && seasonRows.some((row) => Number(row.listed) > 0))
          rows.push({
            ...seasonRows[0],
            month: `${season + 1}-05`,
            available: 0,
            minutes: seasonRows.reduce((total, row) => total + Number(row.minutes), 0),
            appearances: seasonRows.reduce((total, row) => total + Number(row.appearances), 0),
            listed: seasonRows.reduce((total, row) => total + Number(row.listed), 0),
            unavailable: 0,
          });
      }
    }
  }
  await upsertLedger(store, rows, true);
  return shares;
}

/** Estimated FIFA-window matches per month: eight competitive and two friendlies a year. */
const WINDOW_MATCHES: Record<string, { competitive: number; friendlies: number }> = {
  "09": { competitive: 2, friendlies: 0 },
  "10": { competitive: 2, friendlies: 0 },
  "11": { competitive: 2, friendlies: 0 },
  "03": { competitive: 1, friendlies: 1 },
  "06": { competitive: 1, friendlies: 1 },
};

/** Pre-game national-team months (ranking and matches) and caps from the national-team selection logic. */
async function seedInternationals(store: Store, seed: string, generated: string) {
  const ranks = await nationalRanks(store);
  const teams = await store.all<{ id: number; country_id: number; code: string }>(
    "SELECT clubs.id, clubs.country_id, countries.code FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE clubs.type = 'national' AND clubs.age_group = 'Senior' ORDER BY clubs.id",
  );
  const end = addMonths(monthOf(generated), -1);
  const months = Array.from({ length: 24 }, (_, index) => addMonths(end, index - 23));
  await store.run(
    `INSERT INTO national_team_months (country_id, month, rank, competitive, friendlies, estimated)
     SELECT country_id, month, rank, competitive, friendlies, true
     FROM unnest(?::integer[], ?::text[], ?::integer[], ?::integer[], ?::integer[]) AS source(country_id, month, rank, competitive, friendlies)
     ON CONFLICT (country_id, month) DO NOTHING`,
    teams.flatMap((team) => months.map(() => team.country_id)),
    teams.flatMap(() => months),
    teams.flatMap((team) => months.map(() => ranks.get(team.code) ?? null)),
    teams.flatMap(() => months.map((month) => WINDOW_MATCHES[month.slice(5)]?.competitive ?? 0)),
    teams.flatMap(() => months.map((month) => WINDOW_MATCHES[month.slice(5)]?.friendlies ?? 0)),
  );
  const rows: LedgerRow[] = [];
  const startYear = Number(generated.slice(0, 4));
  for (const team of teams) {
    await spill(store, rows, true);
    const pool = await store.all<SquadCandidate & { birth_date: string }>(
      "SELECT id, position, ability, potential, form, birth_date FROM players WHERE country_id = ? AND role <> 'Retired' AND age >= 17 ORDER BY ability DESC, id LIMIT 120",
      team.country_id,
    );
    const random = seedrandom(`${seed}:gbe:nation:${team.code}`);
    for (const yearsBack of [1, 0]) {
      const year = startYear - yearsBack;
      const candidates = pool
        .map((player) => {
          const age = year - 1 - Number(player.birth_date.slice(0, 4));
          const growth = yearsBack ? Math.max(0, Math.min(player.potential - player.ability, Math.max(0, 24 - age) * 0.9)) : 0;
          return { ...player, ability: player.ability - growth, age };
        })
        .filter((player) => player.age >= 17);
      for (const month of months.slice(yearsBack ? 0 : 12, yearsBack ? 12 : 24)) {
        const window = WINDOW_MATCHES[month.slice(5)];
        if (!window) continue;
        // Each window's squad: form and fitness vary, so fringe places rotate between call-ups.
        const squad = selectNationalSquad(
          candidates.map((player) => ({ ...player, form: 6.5 + (random() - 0.5) * 3 })),
          { ageGroup: "Senior", size: 26, goalkeepers: 3 },
        );
        const keepers = new Set(candidates.filter((player) => player.position === "GK").map((player) => player.id));
        let outfield = 0;
        let keeper = 0;
        const chance = new Map(
          squad.map((id) => {
            if (keepers.has(id)) return [id, keeper++ === 0 ? 0.88 : 0.06];
            const place = outfield++;
            return [id, place < 10 ? 0.8 : place < 15 ? 0.5 : place < 19 ? 0.25 : 0.08];
          }),
        );
        for (const [kind, count] of [["international", window.competitive], ["friendly", window.friendlies]] as const) {
          if (!count) continue;
          for (const id of squad) {
            let appearances = 0;
            let played = 0;
            for (let match = 0; match < count; match++)
              if (random() < (kind === "friendly" ? Math.min(0.9, chance.get(id)! + 0.15) : chance.get(id)!)) {
                appearances++;
                played += 45 + Math.round(random() * 45);
              }
            rows.push({ player_id: id, month, club_id: team.id, league_id: 0, kind, available: 0, minutes: played, appearances, listed: count, unavailable: 0 });
          }
        }
      }
    }
  }
  await upsertLedger(store, rows, true);
}

/** Pre-game last season of every senior league club: the reputation order (with noise) of its current league. */
async function seedClubSeasons(store: Store, seed: string, season: number) {
  const clubs = await store.all<{ id: number; league_id: number; reputation: number; code: string; tier: number }>(
    `SELECT clubs.id, clubs.league_id, clubs.reputation, countries.code, leagues.tier
     FROM clubs JOIN leagues ON leagues.id = clubs.league_id JOIN countries ON countries.id = leagues.country_id
     WHERE clubs.type <> 'national' AND leagues.kind = 'league' AND leagues.age_group = 'Senior'`,
  );
  const byLeague = new Map<number, typeof clubs>();
  for (const club of clubs) byLeague.set(club.league_id, [...(byLeague.get(club.league_id) ?? []), club]);
  const rows: Record<string, unknown>[] = [];
  for (const [leagueId, members] of byLeague) {
    const random = seedrandom(`${seed}:gbe:league:${leagueId}`);
    const table = members
      .map((club) => ({ club, score: club.reputation + (random() - 0.5) * 8 }))
      .sort((left, right) => right.score - left.score);
    table.forEach(({ club }, index) =>
      rows.push({
        club_id: club.id,
        season,
        league_id: leagueId,
        country_code: club.code,
        tier: club.tier,
        position: index + 1,
        clubs: table.length,
        champion: index === 0,
        // The current divisions are the result of last season: no club is known to have moved.
        promoted: false,
        relegated: false,
        continental: "[]",
        qualified: null,
        estimated: true,
      }),
    );
  }
  await writeClubSeasons(store, rows);
}

const KNOCKOUT_ROUNDS = ["Knockout round play-offs", "Round of 16", "Quarter-final", "Semi-final", "Final"];

/**
 * Pre-game continental football: the current season's main-phase entrants are taken to have played the last one
 * too, reaching a stage by strength; their squads get minutes in proportion to their league share.
 */
async function seedContinental(store: Store, seed: string, generatedSeason: number, shares: Map<number, Map<number, number>> | null) {
  const competitions = await store.all<{ id: number; name: string; catalog_id: string; format: string | null; matchdays: number | null; qualification: { clubId: number; stage: string }[] | null }>(
    `SELECT id, name, data::jsonb #>> '{spec,catalog,id}' AS catalog_id, data::jsonb #>> '{spec,catalog,format}' AS format,
       (data::jsonb #>> '{spec,catalog,matchdays}')::integer AS matchdays, data::jsonb -> 'qualification' AS qualification
     FROM leagues WHERE kind = 'continental' AND age_group = 'Senior' AND data::jsonb #>> '{spec,catalog,id}' IS NOT NULL
       AND COALESCE(data::jsonb #>> '{spec,catalog,kind}', '') <> 'super' AND data::jsonb ->> 'catalogQualifying' IS NULL
       AND (data::jsonb ->> 'season')::integer = ?`,
    generatedSeason,
  );
  if (!competitions.length) return false;
  const reputations = new Map(
    (await store.all<{ id: number; reputation: number }>("SELECT id, reputation FROM clubs WHERE type <> 'national'")).map((club) => [club.id, club.reputation]),
  );
  const season = generatedSeason - 1;
  const runs = new Map<number, Record<string, unknown>[]>();
  const rows: LedgerRow[] = [];
  const squads = new Map<number, { id: number }[]>();
  for (const row of await store.all<{ id: number; club_id: number }>(
    "SELECT id, playing_club_id AS club_id FROM players WHERE age_group = 'Senior' AND role <> 'Retired' AND playing_club_id IS NOT NULL",
  ))
    squads.set(row.club_id, [...(squads.get(row.club_id) ?? []), row]);
  for (const competition of competitions) {
    await spill(store, rows, true);
    const random = seedrandom(`${seed}:gbe:continental:${competition.catalog_id}`);
    const entrants = (competition.qualification ?? []).filter((entry) => entry.stage === "main").map((entry) => entry.clubId);
    const ranked = entrants
      .map((clubId) => ({ clubId, score: (reputations.get(clubId) ?? 50) + (random() - 0.5) * 10 }))
      .sort((left, right) => right.score - left.score);
    const groupMatches = competition.matchdays ?? 6;
    const knockoutOnly = competition.format === "knockout";
    ranked.forEach(({ clubId }, index) => {
      const share = index / Math.max(1, ranked.length);
      const stage = knockoutOnly
        ? index < 1 ? "Final" : index < 2 ? "Final" : index < 4 ? "Semi-final" : index < 8 ? "Quarter-final" : "Round of 16"
        : share < 2 / 36 ? "Final" : share < 4 / 36 ? "Semi-final" : share < 8 / 36 ? "Quarter-final" : share < 16 / 36 ? "Round of 16" : share < 24 / 36 ? "Knockout round play-offs" : "League phase";
      const reached = KNOCKOUT_ROUNDS.indexOf(stage);
      const matches = (knockoutOnly ? 0 : groupMatches) + Math.max(0, reached + (knockoutOnly ? 1 : 0)) * 2 - (stage === "Final" ? 1 : 0);
      runs.set(clubId, [
        ...(runs.get(clubId) ?? []),
        { leagueId: competition.id, catalogId: competition.catalog_id, competition: competition.name, stage, knockoutOnly },
      ]);
      // Group matches September-December, knockouts February-May.
      const months = [...seasonMonths(season).slice(1, 5), ...seasonMonths(season).slice(6, 10)];
      const perMonth = months.map(() => 0);
      for (let match = 0; match < matches; match++) perMonth[match < (knockoutOnly ? 0 : groupMatches) ? match % 4 : 4 + Math.min(3, Math.floor((match - groupMatches) / 2))]++;
      for (const player of squads.get(clubId) ?? []) {
        const base = shares?.get(clubId)?.get(player.id) ?? 0;
        months.forEach((month, monthIndex) => {
          const count = perMonth[monthIndex];
          if (!count) return;
          const played = Math.round(count * 90 * clamp(base * (0.85 + random() * 0.3), 0, 1));
          const appearances = played ? Math.min(count, Math.max(1, Math.round(count * Math.min(1, base * 1.25)))) : 0;
          rows.push({
            player_id: player.id,
            month,
            club_id: clubId,
            league_id: competition.id,
            kind: "continental",
            available: count * 90,
            minutes: played,
            appearances,
            listed: Math.max(appearances, Math.round(count * Math.min(1, base + 0.25))),
            unavailable: 0,
          });
        });
      }
    });
  }
  await upsertLedger(store, rows, true);
  for (const [clubId, list] of runs)
    await store.run("UPDATE club_season_outcomes SET continental = ? WHERE club_id = ? AND season = ? AND estimated", JSON.stringify(list), clubId, season);
  return true;
}

/**
 * Rebuilds the ledger for matches played before it existed (worlds and saves older than migration 3): exact
 * minutes from the appearance index where it is kept, season statistics spread over the club's match months
 * otherwise; available minutes from fixtures for the club's current senior squad.
 */
async function rebuildPlayedMonths(store: Store, from: string, through: string) {
  const fixtures = await store.all<{ id: number; league_id: number; stage: string; date: string; season: number; home_id: number; away_id: number; extra: boolean }>(
    `SELECT id, league_id, stage, date, season, home_id, away_id, jsonb_path_exists(data::jsonb, '$.duration ? (@ >= 120)') AS extra
     FROM fixtures WHERE status = 'played' AND league_id IS NOT NULL AND date >= ? AND date <= ?`,
    from,
    through,
  );
  if (!fixtures.length) return;
  const leagues = await leagueInfo(store);
  const counted = fixtures.flatMap((fixture) => {
    const competition = ledgerCompetition(leagues.get(fixture.league_id), fixture.stage);
    return competition ? [{ fixture, competition }] : [];
  });
  const national = new Set((await store.all<{ id: number }>("SELECT id FROM clubs WHERE type = 'national'")).map((club) => club.id));
  const squads = new Map<number, number[]>();
  for (const row of await store.all<{ id: number; club_id: number }>(
    "SELECT id, playing_club_id AS club_id FROM players WHERE age_group = 'Senior' AND role <> 'Retired' AND playing_club_id IS NOT NULL",
  ))
    squads.set(row.club_id, [...(squads.get(row.club_id) ?? []), row.id]);
  const rows: LedgerRow[] = [];
  const byFixture = new Map(counted.map((entry) => [entry.fixture.id, entry]));
  const exact = new Set<string>();
  for (const appearance of await store.all<{ fixture_id: number; player_id: number; club_id: number; minutes: number }>(
    "SELECT fixture_id, player_id, club_id, minutes FROM player_match_appearances WHERE date >= ? AND date <= ? AND minutes > 0",
    from,
    through,
  )) {
    const entry = byFixture.get(appearance.fixture_id);
    if (!entry) continue;
    exact.add(`${entry.fixture.season}:${appearance.player_id}:${appearance.club_id}`);
    rows.push({
      player_id: appearance.player_id,
      month: monthOf(entry.fixture.date),
      club_id: appearance.club_id,
      league_id: entry.competition.leagueId,
      kind: entry.competition.kind,
      available: 0,
      minutes: appearance.minutes,
      appearances: 1,
      listed: 1,
      unavailable: 0,
    });
  }
  // Seasons whose appearance index was pruned: season totals over the months the club played that competition.
  const months = new Map<string, Map<string, number>>();
  for (const { fixture, competition } of counted) {
    await spill(store, rows);
    for (const clubId of [fixture.home_id, fixture.away_id]) {
      const key = `${fixture.season}:${clubId}:${competition.leagueId}:${competition.kind}`;
      const perMonth = months.get(key) ?? new Map<string, number>();
      perMonth.set(monthOf(fixture.date), (perMonth.get(monthOf(fixture.date)) ?? 0) + 1);
      months.set(key, perMonth);
      if (!national.has(clubId))
        for (const playerId of squads.get(clubId) ?? [])
          rows.push({
            player_id: playerId,
            month: monthOf(fixture.date),
            club_id: clubId,
            league_id: competition.leagueId,
            kind: competition.kind,
            available: fixture.extra ? 120 : 90,
            minutes: 0,
            appearances: 0,
            listed: 0,
            unavailable: 0,
          });
    }
  }
  for (const stat of await store.all<{ player_id: number; season: number; club_id: number; league_id: number; minutes: number; appearances: number }>(
    "SELECT player_id, season, club_id, league_id, minutes, appearances FROM player_season_stats WHERE season BETWEEN ? AND ?",
    Number(from.slice(0, 4)) - 1,
    Number(through.slice(0, 4)),
  )) {
    await spill(store, rows);
    if (exact.has(`${stat.season}:${stat.player_id}:${stat.club_id}`)) continue;
    const competition = ledgerCompetition(leagues.get(stat.league_id), "");
    if (!competition) continue;
    const perMonth = months.get(`${stat.season}:${stat.club_id}:${competition.leagueId}:${competition.kind}`);
    if (!perMonth) continue;
    const total = [...perMonth.values()].reduce((sum, count) => sum + count, 0);
    for (const [month, count] of perMonth) {
      const appearances = Math.round((stat.appearances * count) / total);
      rows.push({
        player_id: stat.player_id,
        month,
        club_id: stat.club_id,
        league_id: competition.leagueId,
        kind: competition.kind,
        available: 0,
        minutes: Math.round((stat.minutes * count) / total),
        appearances,
        listed: appearances,
        unavailable: 0,
      });
    }
  }
  await upsertLedger(store, rows);
}

/**
 * Idempotent: seeds the pre-game career estimate (club minutes, caps, national-team months, last season's club
 * outcomes) once per world, rebuilds months played before the ledger existed, archives a finished season that
 * predates the archive, and adds the continental estimate once the season's competitions exist. Cheap when done.
 */
export async function ensureGbeBaseline(store: Store) {
  const state = await store.meta<GameState | undefined>("state").catch(() => undefined);
  if (!state) return;
  const meta = await store.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", META);
  const current: BaselineMeta | undefined = meta ? JSON.parse(meta.value) : undefined;
  if (current?.version === BASELINE_VERSION && current.continental) return;
  const world = await store.meta<{ generated?: string; seed?: string; options?: { structureOnly?: boolean } } | undefined>("world").catch(() => undefined);
  if (world?.options?.structureOnly) return;
  const generated = world?.generated ?? START_DATE;
  const seed = world?.seed ?? state.seed;
  const generatedSeason = Number(generated.slice(0, 4));
  await store.transaction(async () => {
    const coverageFrom = addMonths(monthOf(generated), -24);
    let next: BaselineMeta = current ?? { version: BASELINE_VERSION, recordedFrom: monthOf(addDays(state.date, 1)), coverageFrom, continental: false };
    let shares: Map<number, Map<number, number>> | null = null;
    if (!current) {
      const existing = (await store.get<{ present: number }>("SELECT count(*) AS present FROM (SELECT 1 FROM player_minutes_monthly WHERE estimated LIMIT 1) AS any_row"))!.present;
      if (!existing) {
        shares = await seedClubMinutes(store, seed, generated);
        await seedInternationals(store, seed, generated);
        await seedClubSeasons(store, seed, generatedSeason - 1);
      }
      // Matches played before this code ran (an older world or save) are rebuilt from the stored results.
      if (state.started && state.date >= generated) await rebuildPlayedMonths(store, generated, state.date);
      for (let season = generatedSeason; season < state.season; season++)
        if (!(await store.get("SELECT 1 FROM club_season_outcomes WHERE season = ? LIMIT 1", season))) await archiveClubSeasons(store, season);
      next = { version: BASELINE_VERSION, recordedFrom: monthOf(state.date), coverageFrom, continental: false };
    }
    if (!next.continental) {
      if (!shares) {
        shares = new Map();
        for (const row of await store.all<{ player_id: number; club_id: number; share: number }>(
          `SELECT player_id, club_id, sum(minutes)::double precision / NULLIF(sum(available), 0) AS share
           FROM ${monthlyLedger("ledger.estimated AND ledger.kind = 'league' AND ledger.season = ?")} GROUP BY player_id, club_id`,
          generatedSeason - 1,
        )) {
          const owner = shares.get(row.club_id) ?? new Map<number, number>();
          owner.set(row.player_id, row.share ?? 0);
          shares.set(row.club_id, owner);
        }
      }
      // Worlds already past their first season have no use for a pre-game continental season.
      next.continental = state.season > generatedSeason || (await seedContinental(store, seed, generatedSeason, shares));
    }
    await store.setMeta(META, next);
  });
}

// ------------------------------------------------------------------------------------------- evidence

interface LedgerAggregate {
  player_id: number;
  club_id: number;
  league_id: number;
  kind: LedgerKind;
  ref_available: number | null;
  ref_minutes: number | null;
  ref_appearances: number | null;
  ref_listed: number | null;
  ref_unavailable: number | null;
  ref_estimated: boolean | null;
  ref_simulated: boolean | null;
  half_active: string | null;
  ref_active: string | null;
  last_listed: number | null;
  last_available: number | null;
  last_minutes: number | null;
  last_month: string | null;
  intl_apps: number | null;
  intl_youth_apps: number | null;
  intl_estimated: boolean | null;
  esc_apps: number | null;
  first_appearance: string | null;
  current_apps: number | null;
}

interface PlayerRow {
  id: number;
  birth_date: string;
  club_id: number | null;
  parent_club_id: number | null;
  country_id: number;
  nationalities: string[] | null;
}

interface ClubRow {
  id: number;
  name: string;
  type: string;
  league_id: number | null;
}

interface NationalMonth {
  competitive: number;
  friendlies: number;
  estimated: boolean;
  rank: number | null;
}

interface OutcomeRow {
  club_id: number;
  country_code: string;
  tier: number;
  position: number | null;
  clubs: number | null;
  champion: boolean;
  promoted: boolean;
  relegated: boolean;
  continental: { catalogId: string | null; competition: string; stage: string; knockoutOnly?: boolean }[];
  qualified: { catalogId: string | null; competition: string; phase: "group" | "qualifiers" }[] | null;
  estimated: boolean;
}

interface Context {
  asOf: string;
  state: GameState;
  ruleset: NonNullable<ReturnType<typeof gbeRulesetFor>>;
  leagues: Map<number, LeagueInfo>;
  countries: Map<number, { code: string; name: string }>;
  coverageFrom: string | null;
  national: Map<number, { teamId: number; months: Map<string, NationalMonth> }>;
  ranks: Map<string, number>;
  qualified: Map<number, OutcomeRow["qualified"] & object> | null;
  currentRuns: Map<number, { leagueId: number; stages: string[] }[]>;
}

/** World-level inputs of one assessment date; national data limited to `countryIds` when given. */
async function context(store: Store, asOf: string, countryIds?: readonly number[]): Promise<Context> {
  const state = await store.meta<GameState>("state");
  const ruleset = gbeRulesetFor(asOf)!;
  const from = gbeWindowStart(asOf, ruleset.ruleset.internationalMonths);
  const scoped = countryIds ? " AND clubs.country_id = ANY(?::integer[])" : "";
  const teams = await store.all<{ id: number; country_id: number }>(
    `SELECT id, country_id FROM clubs WHERE type = 'national' AND age_group = 'Senior'${scoped}`,
    ...(countryIds ? [countryIds] : []),
  );
  const national = new Map(teams.map((team) => [team.country_id, { teamId: team.id, months: new Map<string, NationalMonth>() }]));
  const byTeam = new Map(teams.map((team) => [team.id, team.country_id]));
  for (const row of await store.all<{ country_id: number; month: string; rank: number | null; competitive: number; friendlies: number; estimated: boolean }>(
    `SELECT country_id, month, rank, competitive, friendlies, estimated FROM national_team_months
     WHERE month >= ? AND month <= ?${countryIds ? " AND country_id = ANY(?::integer[])" : ""}`,
    from,
    monthOf(asOf),
    ...(countryIds ? [countryIds] : []),
  ))
    national.get(row.country_id)?.months.set(row.month, {
      competitive: row.estimated ? row.competitive : 0,
      friendlies: row.estimated ? row.friendlies : 0,
      estimated: row.estimated,
      rank: row.rank,
    });
  // Played months: the national team's own fixtures (competitive, or the friendlies competition).
  if (teams.length)
    for (const row of await store.all<{ club_id: number; month: string; competitive: number; friendlies: number }>(
      `SELECT side.club_id, left(fixtures.date, 7) AS month,
         count(*) FILTER (WHERE COALESCE(leagues.data::jsonb #>> '{spec,friendly}', '') <> 'true') AS competitive,
         count(*) FILTER (WHERE leagues.data::jsonb #>> '{spec,friendly}' = 'true') AS friendlies
       FROM fixtures JOIN leagues ON leagues.id = fixtures.league_id AND leagues.kind = 'international' AND leagues.age_group = 'Senior'
       CROSS JOIN LATERAL (VALUES (fixtures.home_id), (fixtures.away_id)) AS side(club_id)
       WHERE fixtures.status = 'played' AND fixtures.date >= ? AND fixtures.date <= ? AND side.club_id = ANY(?::integer[])
       GROUP BY side.club_id, left(fixtures.date, 7)`,
      `${from}-01`,
      asOf,
      teams.map((team) => team.id),
    )) {
      const entry = national.get(byTeam.get(row.club_id)!)!;
      const month = entry.months.get(row.month);
      entry.months.set(row.month, {
        competitive: (month?.competitive ?? 0) + row.competitive,
        friendlies: (month?.friendlies ?? 0) + row.friendlies,
        estimated: false,
        rank: month?.rank ?? null,
      });
    }
  const baseline = await store.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", META);
  const coverageFrom = baseline ? ((JSON.parse(baseline.value) as BaselineMeta).coverageFrom ?? null) : null;
  const leagues = await leagueInfo(store);
  const countries = new Map(
    (await store.all<{ id: number; code: string; name: string }>("SELECT id, code, name FROM countries")).map((country) => [country.id, country]),
  );
  return {
    asOf,
    state,
    ruleset,
    leagues,
    countries,
    coverageFrom,
    national,
    ranks: await nationalRanks(store),
    qualified: await qualifiedPlaces(store, state.season),
    currentRuns: await continentalRuns(store, state.season, leagues),
  };
}

/** Continental places of the current season (earned in the last one), or null before the season's draw. */
async function qualifiedPlaces(store: Store, season: number) {
  const rows = await store.all<{ name: string; catalog_id: string | null; season: number | null; qualification: { clubId: number; stage: string }[] | null }>(
    `SELECT name, data::jsonb #>> '{spec,catalog,id}' AS catalog_id,
       CASE WHEN data::jsonb ->> 'season' ~ '^[0-9]+$' THEN (data::jsonb ->> 'season')::integer END AS season,
       data::jsonb -> 'qualification' AS qualification
     FROM leagues WHERE kind = 'continental' AND age_group = 'Senior' AND data::jsonb ->> 'catalogQualifying' IS NULL
       AND jsonb_typeof(data::jsonb -> 'qualification') = 'array'`,
  );
  if (!rows.some((row) => row.season === season)) return null;
  const places = new Map<number, { catalogId: string | null; competition: string; phase: "group" | "qualifiers" }[]>();
  for (const row of rows)
    if (row.season === season)
      for (const entry of row.qualification ?? [])
        places.set(entry.clubId, [
          ...(places.get(entry.clubId) ?? []),
          { catalogId: row.catalog_id, competition: row.name, phase: entry.stage === "main" ? "group" : "qualifiers" },
        ]);
  return places;
}

interface Windows {
  ref: string;
  half: string;
  lastFrom: string;
  lastTo: string;
  lastSeason: number;
  intl: string;
  intlYouth: string;
  esc: string;
  currentFrom: string;
  asOfMonth: string;
}

function windowsOf(ctx: Context): Windows {
  const { asOf, state } = ctx;
  const ruleset = ctx.ruleset.ruleset;
  // FA seasons run June-May; the game archives a season at its 1 July rollover.
  const faLast = Number(asOf.slice(5, 7)) >= 6 ? Number(asOf.slice(0, 4)) - 1 : Number(asOf.slice(0, 4)) - 2;
  const lastSeason = Math.min(faLast, state.season - 1);
  return {
    ref: gbeWindowStart(asOf, ruleset.referenceMonths),
    half: gbeWindowStart(asOf, 6),
    lastFrom: `${lastSeason}-07`,
    lastTo: `${lastSeason + 1}-06`,
    lastSeason,
    intl: gbeWindowStart(asOf, ruleset.internationalMonths),
    intlYouth: gbeWindowStart(asOf, ruleset.internationalYouthMonths),
    esc: gbeWindowStart(asOf, ruleset.escMonths),
    currentFrom: `${state.season}-07`,
    asOfMonth: monthOf(asOf),
  };
}

/** Per player, team, competition and kind: the ledger's months folded into the windows (decoded here, not in SQL). */
async function ledgerFor(store: Store, ids: readonly number[], windows: Windows) {
  const { ref, half, lastFrom, lastTo, intl, intlYouth, esc, currentFrom, asOfMonth } = windows;
  const aggregates = new Map<string, LedgerAggregate>();
  const later = (left: string | null, right: string) => (left === null || right > left ? right : left);
  for (const row of await store.all<{ player_id: number; season: number; club_id: number; league_id: number; kind: LedgerKind; estimated: boolean; data: string }>(
    "SELECT player_id, season, club_id, league_id, kind, estimated, data FROM player_minutes_monthly WHERE player_id = ANY(?::integer[])",
    ids,
  )) {
    const key = `${row.player_id}:${row.club_id}:${row.league_id}:${row.kind}`;
    let entry = aggregates.get(key);
    if (!entry) {
      entry = {
        player_id: row.player_id, club_id: row.club_id, league_id: row.league_id, kind: row.kind,
        ref_available: 0, ref_minutes: 0, ref_appearances: 0, ref_listed: 0, ref_unavailable: 0, ref_estimated: false, ref_simulated: false,
        half_active: null, ref_active: null, last_listed: 0, last_available: 0, last_minutes: 0, last_month: null,
        intl_apps: 0, intl_youth_apps: 0, intl_estimated: false, esc_apps: 0, first_appearance: null, current_apps: 0,
      };
      aggregates.set(key, entry);
    }
    const values = row.data.split(",").map(Number);
    for (let index = 0; index < 12; index++) {
      const [available, minutes, appearances, listed, unavailable] = [0, 12, 24, 36, 48].map((offset) => values[offset + index]);
      if (available + minutes + appearances + listed + unavailable === 0) continue;
      const month = addMonths(`${row.season}-07`, index);
      if (month > asOfMonth) continue;
      if (month >= ref) {
        entry.ref_available! += available;
        entry.ref_minutes! += minutes;
        entry.ref_appearances! += appearances;
        entry.ref_listed! += listed;
        entry.ref_unavailable! += unavailable;
        if (row.estimated) entry.ref_estimated = true;
        else entry.ref_simulated = true;
        if (listed > 0) entry.ref_active = later(entry.ref_active, month);
      }
      if (month >= half && (listed > 0 || available > 0)) entry.half_active = later(entry.half_active, month);
      if (month >= lastFrom && month <= lastTo) {
        entry.last_listed! += listed;
        entry.last_available! += available;
        entry.last_minutes! += minutes;
        if (listed > 0 || available > 0) entry.last_month = later(entry.last_month, month);
      }
      if (month >= intl) {
        entry.intl_apps! += appearances;
        if (row.estimated && appearances > 0) entry.intl_estimated = true;
      }
      if (month >= intlYouth) entry.intl_youth_apps! += appearances;
      if (month >= esc) entry.esc_apps! += appearances;
      if (appearances > 0 && (entry.first_appearance === null || month < entry.first_appearance)) entry.first_appearance = month;
      if (month >= currentFrom) entry.current_apps! += appearances;
    }
  }
  return [...aggregates.values()];
}

const sum = (rows: readonly LedgerAggregate[], pick: (row: LedgerAggregate) => number | null) =>
  rows.reduce((total, row) => total + Number(pick(row) ?? 0), 0);

const CLUB_KINDS: ReadonlySet<LedgerKind> = new Set(["league", "cup", "continental", "qualifying"]);

async function evidenceFor(store: Store, ctx: Context, ids: readonly number[]): Promise<Map<number, GbeEvidence>> {
  const windows = windowsOf(ctx);
  const ruleset = ctx.ruleset.ruleset;
  const players = await store.all<PlayerRow>(
    // The held nationalities' codes, cut from the profile text (a full JSON parse of every profile is far slower).
    `SELECT id, birth_date, club_id, parent_club_id, country_id,
       ARRAY(SELECT match[1] FROM regexp_matches(substring(profile from '"nationalities":\\[[^\\]]*\\]'), '"code":"([A-Z]+)"', 'g') AS match) AS nationalities
     FROM players WHERE id = ANY(?::integer[])`,
    ids,
  );
  const ledger = await ledgerFor(store, ids, windows);
  const byPlayer = new Map<number, LedgerAggregate[]>();
  for (const row of ledger) byPlayer.set(row.player_id, [...(byPlayer.get(row.player_id) ?? []), row]);
  const clubIds = new Set<number>();
  for (const player of players) for (const id of [player.club_id, player.parent_club_id]) if (id) clubIds.add(id);
  for (const row of ledger) clubIds.add(row.club_id);
  const clubs = new Map(
    (await store.all<ClubRow>("SELECT id, name, type, league_id FROM clubs WHERE id = ANY(?::integer[])", [...clubIds])).map((club) => [club.id, club]),
  );
  const outcomes = new Map(
    (
      await store.all<Omit<OutcomeRow, "continental" | "qualified"> & { continental: string; qualified: string | null }>(
        "SELECT club_id, country_code, tier, position, clubs, champion, promoted, relegated, continental, qualified, estimated FROM club_season_outcomes WHERE season = ? AND club_id = ANY(?::integer[])",
        windows.lastSeason,
        [...clubIds],
      )
    ).map((row) => [row.club_id, { ...row, continental: JSON.parse(row.continental), qualified: row.qualified ? JSON.parse(row.qualified) : null } as OutcomeRow]),
  );
  const youngIds = players.filter((player) => player.birth_date >= ruleset.escBornOnOrAfter).map((player) => player.id);
  const youth = new Map<number, { internationals: number; continental: number; domestic: number }>();
  if (youngIds.length)
    for (const row of await store.all<{ player_id: number; kind: string; catalog: boolean; code: string | null; tier: number; appearances: number }>(
      `SELECT stats.player_id, leagues.kind, (leagues.data::jsonb #>> '{spec,catalog,id}') IS NOT NULL AS catalog, countries.code, leagues.tier,
         sum(stats.appearances) AS appearances
       FROM player_season_stats AS stats JOIN leagues ON leagues.id = stats.league_id LEFT JOIN countries ON countries.id = leagues.country_id
       WHERE stats.player_id = ANY(?::integer[]) AND stats.season >= ? AND leagues.age_group <> 'Senior'
       GROUP BY stats.player_id, leagues.kind, catalog, countries.code, leagues.tier`,
      youngIds,
      ctx.state.season - 1,
    )) {
      const entry = youth.get(row.player_id) ?? { internationals: 0, continental: 0, domestic: 0 };
      if (row.kind === "international") entry.internationals += row.appearances;
      else if (row.catalog) entry.continental += row.appearances;
      // Youth competitions of a football nation with a Band 1-5 league.
      else if (row.code && Object.entries(ruleset.leagueBands).some(([key, band]) => key.startsWith(`${row.code}:`) && band <= 5))
        entry.domestic += row.appearances;
      youth.set(row.player_id, entry);
    }
  const evidence = new Map<number, GbeEvidence>();
  for (const player of players) {
    const rows = byPlayer.get(player.id) ?? [];
    evidence.set(player.id, assemble(ctx, windows, player, rows, clubs, outcomes, youth.get(player.id)));
  }
  return evidence;
}

function assemble(
  ctx: Context,
  windows: Windows,
  player: PlayerRow,
  rows: readonly LedgerAggregate[],
  clubs: Map<number, ClubRow>,
  outcomes: Map<number, OutcomeRow>,
  youth: { internationals: number; continental: number; domestic: number } | undefined,
): GbeEvidence {
  const ruleset = ctx.ruleset.ruleset;
  const country = ctx.countries.get(player.country_id);
  const codes = [...new Set([country?.code, ...(player.nationalities ?? [])].filter((code): code is string => !!code))];
  const youthPlayer = player.birth_date >= ruleset.youthBornOnOrAfter;
  const leagueOf = (leagueId: number | null | undefined) => (leagueId ? ctx.leagues.get(leagueId) : undefined);
  const clubLeague = (clubId: number) => leagueOf(clubs.get(clubId)?.league_id);
  const clubName = (clubId: number) => clubs.get(clubId)?.name ?? "Unknown club";
  const isClub = (row: LedgerAggregate) => CLUB_KINDS.has(row.kind) && clubs.get(row.club_id)?.type !== "national";

  // Table 1
  const nation = ctx.national.get(player.country_id);
  let international: GbeEvidence["international"] = null;
  if (nation) {
    const start = youthPlayer ? windows.intlYouth : windows.intl;
    const months = [...nation.months].filter(([month]) => month >= start);
    const ranks = months.map(([, month]) => month.rank).filter((rank): rank is number => rank !== null);
    if (!nation.months.has(windows.asOfMonth) && country) ranks.push(ctx.ranks.get(country.code) ?? ranks.at(-1) ?? 0);
    const apps = rows.filter((row) => row.club_id === nation.teamId);
    const appsOf = (kind: LedgerKind) =>
      sum(apps.filter((row) => row.kind === kind), (row) => (youthPlayer ? row.intl_youth_apps : row.intl_apps));
    international = {
      rank: ranks.length ? Math.round(ranks.reduce((total, rank) => total + rank, 0) / ranks.length) : null,
      competitive: months.reduce((total, [, month]) => total + month.competitive, 0),
      friendlies: months.reduce((total, [, month]) => total + month.friendlies, 0),
      competitiveApps: appsOf("international"),
      friendlyApps: appsOf("friendly"),
      unavailable: 0,
      estimated: months.some(([, month]) => month.estimated && month.competitive + month.friendlies > 0) || apps.some((row) => !!row.intl_estimated),
      simulated: months.some(([, month]) => !month.estimated && month.competitive + month.friendlies > 0),
    };
  }

  const spell = (row: LedgerAggregate): GbeSpell => {
    const league = leagueOf(row.league_id);
    return {
      clubId: row.club_id,
      club: clubName(row.club_id),
      competition: league?.name ?? "League",
      countryCode: league?.country_code ?? null,
      tier: league?.tier ?? null,
      catalogId: league?.catalog_id ?? null,
      available: Number(row.ref_available ?? 0),
      minutes: Number(row.ref_minutes ?? 0),
      appearances: Number(row.ref_appearances ?? 0),
      listed: Number(row.ref_listed ?? 0),
      unavailable: Number(row.ref_unavailable ?? 0),
      estimated: !!row.ref_estimated,
      simulated: !!row.ref_simulated,
    };
  };
  const active = (row: LedgerAggregate) => Number(row.ref_available ?? 0) + Number(row.ref_minutes ?? 0) + Number(row.ref_listed ?? 0) > 0;
  const domestic = rows.filter((row) => row.kind === "league" && isClub(row) && active(row)).map(spell);
  const continental = rows.filter((row) => row.kind === "continental" && isClub(row) && active(row)).map(spell);

  // Table 2 debut row: the first senior appearance for a club, inside the Reference Period.
  let debut: GbeEvidence["debut"] = null;
  if (youthPlayer) {
    const first = rows
      .filter((row) => isClub(row) && row.first_appearance)
      .sort((left, right) => left.first_appearance!.localeCompare(right.first_appearance!))[0];
    if (first && first.first_appearance! >= windows.ref) {
      const league = first.kind === "league" ? leagueOf(first.league_id) : clubLeague(first.club_id);
      debut = {
        month: first.first_appearance!,
        club: clubName(first.club_id),
        countryCode: league?.country_code ?? null,
        tier: league?.tier ?? null,
        estimated: !!first.ref_estimated && !first.ref_simulated,
      };
    }
  }

  const cups = rows.filter((row) => row.kind === "cup" && isClub(row));
  const percent = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
  const cupPercent = {
    reference: percent(sum(cups, (row) => row.ref_minutes), sum(cups, (row) => row.ref_available)),
    lastSeason: percent(sum(cups, (row) => row.last_minutes), sum(cups, (row) => row.last_available)),
  };

  // Last Club: the club played for at the end of the Last Season (league rows first).
  const lastRows = rows.filter((row) => isClub(row) && row.last_month);
  const latest = (list: readonly LedgerAggregate[]) =>
    [...list].sort((left, right) => right.last_month!.localeCompare(left.last_month!) || Number(right.last_listed ?? 0) - Number(left.last_listed ?? 0))[0];
  const lastRow = latest(lastRows.filter((row) => row.kind === "league")) ?? latest(lastRows);
  let lastClub: GbeEvidence["lastClub"] = null;
  if (lastRow) {
    const clubId = lastRow.club_id;
    const at = rows.filter((row) => row.club_id === clubId);
    const outcome = outcomes.get(clubId);
    const league = clubLeague(clubId);
    const qualified =
      windows.lastSeason === ctx.state.season - 1 ? (ctx.qualified ? (ctx.qualified.get(clubId) ?? []) : null) : (outcome?.qualified ?? null);
    lastClub = {
      club: clubName(clubId),
      countryCode: outcome?.country_code ?? league?.country_code ?? null,
      tier: outcome?.tier ?? league?.tier ?? null,
      archived: !!outcome,
      position: outcome?.position ?? null,
      clubs: outcome?.clubs ?? null,
      champion: !!outcome?.champion,
      promoted: !!outcome?.promoted,
      relegated: !!outcome?.relegated,
      qualified,
      continental: (outcome?.continental ?? []).map((run) => ({ ...run, club: clubName(clubId), estimated: !!outcome?.estimated })),
      listedLeague: sum(at.filter((row) => row.kind === "league"), (row) => row.last_listed) > 0,
      listedAny: sum(at.filter((row) => row.kind === "league" || row.kind === "continental"), (row) => row.last_listed) > 0,
      estimated: !!outcome?.estimated,
    };
  }

  // ¶42: continental competitions of this season in which the player has appeared.
  const currentRuns: GbeContinentalRun[] = rows
    .filter((row) => row.kind === "continental" && Number(row.current_apps ?? 0) > 0)
    .flatMap((row) => {
      const run = ctx.currentRuns.get(row.club_id)?.find((entry) => entry.leagueId === row.league_id);
      const league = leagueOf(row.league_id);
      return run && league
        ? [{ club: clubName(row.club_id), competition: league.name, catalogId: league.catalog_id, stage: bestStage(run.stages), knockoutOnly: league.catalog_format === "knockout", estimated: false }]
        : [];
    });

  // Current Club (Table 6): the registered club once it names him in a squad, else the club he last played for.
  const squadRows = rows.filter((row) => isClub(row) && (row.kind === "league" || row.kind === "continental"));
  const listedAt = (clubId: number) => sum(squadRows.filter((row) => row.club_id === clubId), (row) => row.ref_listed) > 0;
  const recent = [...squadRows]
    .filter((row) => row.ref_active)
    .sort((left, right) => right.ref_active!.localeCompare(left.ref_active!))[0];
  let currentId: number | null = null;
  let fallback = false;
  if (player.club_id && listedAt(player.club_id)) currentId = player.club_id;
  else if (recent && (player.club_id || (recent.half_active ?? "") >= windows.half)) {
    currentId = recent.club_id;
    fallback = player.club_id !== null;
  } else currentId = player.club_id;
  let currentClub: GbeEvidence["currentClub"] = null;
  if (currentId) {
    const league = clubLeague(currentId);
    const at = squadRows.filter((row) => row.club_id === currentId);
    const parentApps = player.parent_club_id ? sum(squadRows.filter((row) => row.club_id === player.parent_club_id), (row) => row.ref_appearances) : 0;
    const parentLeague = player.parent_club_id ? clubLeague(player.parent_club_id) : undefined;
    currentClub = {
      club: clubName(currentId),
      countryCode: league?.country_code ?? null,
      tier: league?.tier ?? null,
      listed: listedAt(currentId),
      estimated: at.some((row) => row.ref_estimated && Number(row.ref_listed ?? 0) > 0) && !at.some((row) => row.ref_simulated && Number(row.ref_listed ?? 0) > 0),
      fallback,
      parent:
        player.parent_club_id && parentApps > 0
          ? { club: clubName(player.parent_club_id), countryCode: parentLeague?.country_code ?? null, tier: parentLeague?.tier ?? null }
          : null,
    };
  }

  const escRows = (kinds: readonly LedgerKind[], filter: (row: LedgerAggregate) => boolean = () => true) =>
    sum(rows.filter((row) => kinds.includes(row.kind) && filter(row)), (row) => row.esc_apps);
  return {
    playerId: player.id,
    asOf: ctx.asOf,
    birthDate: player.birth_date,
    passportGroups: [...new Set(codes.map(passportGroup))],
    nation: country?.name ?? "The national team",
    international,
    domestic,
    debut,
    continental,
    cupPercent,
    lastSeason: { season: windows.lastSeason, label: seasonLabel(windows.lastSeason) },
    lastClub,
    currentRuns,
    currentClub,
    esc: {
      seniorCompetitiveCaps: escRows(["international"], (row) => row.club_id === nation?.teamId),
      youthInternationals: youth?.internationals ?? 0,
      continentalMatches: escRows(["continental", "qualifying"], isClub),
      continentalYouthMatches: youth?.continental ?? 0,
      domesticSeniorMatches: escRows(["league"], (row) => {
        const league = leagueOf(row.league_id);
        return isClub(row) && gbeLeagueBand(ruleset, league?.country_code, league?.tier) <= 5;
      }),
      domesticYouthMatches: youth?.domestic ?? 0,
    },
    coverageFrom: ctx.coverageFrom,
  };
}

// ------------------------------------------------------------------------------------------- assessments and cache

const CRITERIA: readonly GbeCriterion[] = [
  "international",
  "domestic_minutes",
  "continental_minutes",
  "league_position",
  "continental_progression",
  "league_standard",
];
const STATUS_CODE: Record<GbeCriterionStatus, string> = { scored: "s", zero: "z", no_data: "n", estimate: "e" };
const QUALITY_CODE: Record<GbeAssessment["dataQuality"], string> = { complete: "c", partial: "p", estimate: "e", none: "n" };
const decode = <Value extends string>(codes: Record<Value, string>, code: string) =>
  (Object.keys(codes) as Value[]).find((value) => codes[value] === code)!;

/**
 * What the cache keeps per player besides points and outcome: data quality, ESC eligibility, each criterion's
 * points and status (`!` = automatic pass) and the exemption, e.g. `e1|8e,12e!,0z,0n,5e,12e|`. No explanations.
 */
function compact(assessment: GbeAssessment) {
  const rows = new Map(assessment.breakdown.map((row) => [row.criterion, row]));
  const criteria = CRITERIA.map((criterion) => {
    const row = rows.get(criterion)!;
    return `${row.points}${STATUS_CODE[row.status]}${row.autoPass ? "!" : ""}`;
  });
  return `${QUALITY_CODE[assessment.dataQuality]}${assessment.esc?.eligible ? 1 : 0}|${criteria.join(",")}|${assessment.exemptReason ?? ""}`;
}

const CACHED_DETAIL = "Cached summary; open the player's GBE breakdown for the explanation.";

function expand(
  row: { player_id: number; as_of: string; ruleset: string; points: number; outcome: GbeAssessment["outcome"]; assessment: string },
  passMark: number,
): GbeAssessment {
  const [flags, criteria, exemptReason] = row.assessment.split("|");
  const breakdown = criteria.split(",").map((entry, index): GbeAssessment["breakdown"][number] => {
    const [, points, status, auto] = /^(\d+)([a-z])(!?)$/.exec(entry)!;
    return { criterion: CRITERIA[index], points: Number(points), status: decode(STATUS_CODE, status), detail: CACHED_DETAIL, ...(auto ? { autoPass: true } : {}) };
  });
  return {
    playerId: row.player_id,
    asOf: row.as_of,
    ruleset: row.ruleset,
    points: row.points,
    passMark,
    autoPass: breakdown.some((entry) => entry.autoPass),
    outcome: row.outcome,
    ...(exemptReason ? { exemptReason } : {}),
    breakdown,
    dataQuality: decode(QUALITY_CODE, flags[0]),
    esc: { eligible: flags[1] === "1", detail: CACHED_DETAIL },
  };
}

async function calculate(store: Store, ids: readonly number[], asOf: string, countryIds?: readonly number[]) {
  const results = new Map<number, GbeAssessment>();
  if (!ids.length) return results;
  const ctx = await context(store, asOf, countryIds);
  for (let offset = 0; offset < ids.length; offset += 4000) {
    const evidence = await evidenceFor(store, ctx, ids.slice(offset, offset + 4000));
    for (const [id, entry] of evidence)
      results.set(id, calculateGbe(entry, ctx.ruleset.ruleset, { assumed: ctx.ruleset.assumed }));
  }
  return results;
}

/** Full assessment of one player with the explanation of every criterion (always calculated, never cached). */
export async function gbeAssessment(store: Store, playerId: number, asOf?: string): Promise<GbeAssessment> {
  const date = asOf ?? (await store.meta<GameState>("state")).date;
  const player = await store.get<{ country_id: number }>("SELECT country_id FROM players WHERE id = ?", playerId);
  if (!player) throw Object.assign(new GameError("Player not found."), { status: 404 });
  return (await calculate(store, [playerId], date, [player.country_id])).get(playerId)!;
}

/**
 * Assessments of many players (registration checks, AI markets): today's come from the cache refreshed by
 * refreshGbe (breakdown points and statuses, without explanations); other dates, missing or stale rows are
 * calculated (not stored, so this also works in read-only transactions).
 */
export async function gbeAssessments(store: Store, playerIds: readonly number[], asOf?: string): Promise<Map<number, GbeAssessment>> {
  const state = await store.meta<GameState>("state");
  const date = asOf ?? state.date;
  const ids = [...new Set(playerIds)];
  const results = new Map<number, GbeAssessment>();
  if (!ids.length) return results;
  const ruleset = gbeRulesetFor(date)!.ruleset;
  if (date === state.date) {
    const refreshed = await store.get<{ value: string }>("SELECT value FROM meta WHERE key = 'gbeRefresh'");
    const last = refreshed ? (JSON.parse(refreshed.value) as { date: string }).date : "";
    for (const row of await store.all<{ player_id: number; ruleset: string; as_of: string; points: number; outcome: GbeAssessment["outcome"]; same_club: boolean; assessment: string }>(
      `SELECT player_gbe.player_id, player_gbe.ruleset, player_gbe.as_of, player_gbe.points, player_gbe.outcome,
         player_gbe.club_id IS NOT DISTINCT FROM players.club_id AS same_club, player_gbe.assessment
       FROM player_gbe JOIN players ON players.id = player_gbe.player_id WHERE player_gbe.player_id = ANY(?::integer[])`,
      ids,
    )) {
      const asOfRow = row.as_of > last ? row.as_of : last;
      // A player who changed club since has another Current Club (Table 6): recalculated.
      if (row.same_club && row.ruleset === ruleset.id && asOfRow >= addDays(date, -STALE_DAYS) && asOfRow <= date)
        results.set(row.player_id, expand({ ...row, as_of: asOfRow }, ruleset.passMark));
    }
  }
  const missing = ids.filter((id) => !results.has(id));
  for (const [id, assessment] of await calculate(store, missing, date)) results.set(id, assessment);
  return results;
}

/** Ranking of the world's senior national teams this month (the FA aggregates rankings over its windows). */
async function recordRanks(store: Store, date: string) {
  const ranks = await nationalRanks(store);
  const teams = await store.all<{ country_id: number; code: string }>(
    "SELECT clubs.country_id, countries.code FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE clubs.type = 'national' AND clubs.age_group = 'Senior'",
  );
  if (!teams.length) return;
  await store.run(
    `INSERT INTO national_team_months (country_id, month, rank)
     SELECT * FROM unnest(?::integer[], ?::text[], ?::integer[])
     ON CONFLICT (country_id, month) DO UPDATE SET rank = EXCLUDED.rank WHERE NOT national_team_months.estimated`,
    teams.map((team) => team.country_id),
    teams.map(() => monthOf(date)),
    teams.map((team) => ranks.get(team.code) ?? null),
  );
}

/** Weekly: the whole cache once the month (the ledger's granularity) or the ruleset changed since the last refresh. */
export async function refreshGbeIfDue(store: Store) {
  const date = (await store.meta<GameState>("state")).date;
  const refreshed = await store.get<{ value: string }>("SELECT value FROM meta WHERE key = 'gbeRefresh'");
  const last = refreshed ? (JSON.parse(refreshed.value) as { date?: string; ruleset?: string }) : undefined;
  if (last?.date && monthOf(last.date) === monthOf(date) && last.ruleset === gbeRulesetFor(date)!.ruleset.id) return false;
  await refreshGbe(store);
  return true;
}

/**
 * Recalculates and caches assessments: every senior player (and anyone with ledger rows) when `playerIds` is
 * omitted — monthly (refreshGbeIfDue) and at rollover — or the given players (after an international window, on
 * demand). Rows are rewritten only when the result or the player's club changed.
 */
export async function refreshGbe(store: Store, playerIds?: readonly number[]): Promise<void> {
  await ensureGbeBaseline(store);
  const state = await store.meta<GameState>("state");
  const date = state.date;
  const ruleset = gbeRulesetFor(date)!.ruleset;
  await store.transaction(async () => {
    await recordRanks(store, date);
    const ids =
      playerIds ??
      (
        await store.all<{ id: number }>(
          // A UNION, not `OR id IN (…)`: with a large ledger PostgreSQL may not hash that subquery and rescans it per player.
          `SELECT id FROM players WHERE role <> 'Retired' AND age_group = 'Senior'
           UNION
           SELECT players.id FROM players WHERE role <> 'Retired' AND age_group <> 'Senior'
             AND EXISTS (SELECT 1 FROM player_minutes_monthly AS ledger WHERE ledger.player_id = players.id AND ledger.season >= ?)
           ORDER BY id`,
          ledgerSeason(gbeWindowStart(date, ruleset.internationalMonths))[0],
        )
      ).map((row) => row.id);
    for (let offset = 0; offset < ids.length; offset += 4000) {
      const chunk = ids.slice(offset, offset + 4000);
      const assessments = [...(await calculate(store, chunk, date)).values()];
      const clubs = new Map(
        (await store.all<{ id: number; club_id: number | null }>("SELECT id, club_id FROM players WHERE id = ANY(?::integer[])", chunk)).map(
          (row) => [row.id, row.club_id],
        ),
      );
      await store.run(
        `INSERT INTO player_gbe AS target (player_id, ruleset, as_of, club_id, points, outcome, assessment)
         SELECT * FROM unnest(?::integer[], ?::text[], ?::text[], ?::integer[], ?::integer[], ?::text[], ?::text[])
         ON CONFLICT (player_id) DO UPDATE SET ruleset = EXCLUDED.ruleset, as_of = EXCLUDED.as_of, club_id = EXCLUDED.club_id,
           points = EXCLUDED.points, outcome = EXCLUDED.outcome, assessment = EXCLUDED.assessment
         WHERE target.ruleset IS DISTINCT FROM EXCLUDED.ruleset OR target.assessment IS DISTINCT FROM EXCLUDED.assessment
           OR target.club_id IS DISTINCT FROM EXCLUDED.club_id OR (? AND target.as_of < EXCLUDED.as_of)`,
        assessments.map((entry) => entry.playerId),
        assessments.map(() => ruleset.id),
        assessments.map(() => date),
        assessments.map((entry) => clubs.get(entry.playerId) ?? null),
        assessments.map((entry) => entry.points),
        assessments.map((entry) => entry.outcome),
        assessments.map(compact),
        playerIds !== undefined,
      );
    }
    if (!playerIds) await store.setMeta("gbeRefresh", { date, ruleset: ruleset.id, players: ids.length });
  });
}
