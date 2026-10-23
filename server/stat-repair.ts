import type { Store } from "./db.ts";
import type { GameState } from "../shared/types.ts";

const META = "matchStatsRepair";
const VERSION = 1;
const GOALS = "pg_temp.touchline_match_goals";

const int = (expression: string) => `(CASE WHEN (${expression}) ~ '^-?[0-9]+$' THEN (${expression})::integer END)`;
const number = (expression: string) =>
  `(CASE WHEN (${expression}) ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${expression})::double precision END)`;

export interface MatchStatRepair {
  version: number;
  /** Appearances restored from fixtures whose side still has its match rows. */
  appearances: number;
  /** Season lines whose goals were raised to the fixtures' goal lists (finished seasons of other clubs). */
  lines: number;
}

/**
 * Every scorer of a played fixture from its stored goal list (`scorers` once compacted, else the goal events), and the
 * substitutes of detailed fixtures who have no match row. `kept`: the side still has match rows (the current season,
 * the user's teams); `recorded`: the player has one.
 */
const collectSql = `CREATE TEMP TABLE touchline_match_goals ON COMMIT DROP AS
  SELECT * FROM (
    SELECT fixture.id AS fixture_id, fixture.season, fixture.date, fixture.league_id, item.club_id, item.player_id,
      item.goals, item.assists, item.rating, item.minute_on,
      EXISTS (SELECT 1 FROM player_match_appearances AS match_row
        WHERE match_row.fixture_id = fixture.id AND match_row.club_id = item.club_id) AS kept,
      EXISTS (SELECT 1 FROM player_match_appearances AS match_row
        WHERE match_row.fixture_id = fixture.id AND match_row.player_id = item.player_id) AS recorded
    FROM fixtures AS fixture
    -- OFFSET 0 keeps the subquery from being pulled up: the document is parsed once per fixture.
    CROSS JOIN LATERAL (SELECT fixture.data::jsonb AS doc OFFSET 0) AS parsed
    CROSS JOIN LATERAL (
      SELECT involved.player_id, involved.club_id, sum(involved.goals)::integer AS goals,
        min(involved.minute_on) AS minute_on,
        coalesce(${int("parsed.doc -> 'players' -> involved.player_id::text ->> 'assists'")}, 0) AS assists,
        ${number("parsed.doc -> 'players' -> involved.player_id::text ->> 'rating'")} AS rating
      FROM (
        SELECT ${int("goal.value ->> 'playerId'")} AS player_id, ${int("goal.value ->> 'teamId'")} AS club_id,
          1 AS goals, NULL::integer AS minute_on
        FROM jsonb_array_elements(CASE
          WHEN jsonb_typeof(parsed.doc -> 'scorers') = 'array' THEN parsed.doc -> 'scorers'
          WHEN jsonb_typeof(parsed.doc -> 'events') = 'array' THEN parsed.doc -> 'events'
          ELSE '[]'::jsonb END) AS goal(value)
        WHERE jsonb_typeof(parsed.doc -> 'scorers') = 'array' OR goal.value ->> 'type' = 'goal'
        UNION ALL
        SELECT ${int("change.value ->> 'onId'")}, ${int("change.value ->> 'teamId'")}, 0,
          ${int("change.value ->> 'minute'")}
        FROM jsonb_array_elements(CASE
          WHEN jsonb_typeof(parsed.doc -> 'substitutions') = 'array' THEN parsed.doc -> 'substitutions'
          ELSE '[]'::jsonb END) AS change(value)
      ) AS involved
      WHERE involved.player_id IS NOT NULL AND involved.club_id IS NOT NULL
      GROUP BY involved.player_id, involved.club_id
    ) AS item
    WHERE fixture.status = 'played' AND item.club_id IN (fixture.home_id, fixture.away_id)
      AND (fixture.home_goals + fixture.away_goals > 0 OR strpos(fixture.data, '"substitutions"') > 0)
  ) AS candidate
  WHERE candidate.goals > 0 OR NOT candidate.recorded`;

/**
 * A side with match rows lacks a scorer or substitute: one sent on in stoppage time, credited no minute (and so no
 * appearance, goal or assist) before the engines gave him one. Restores his match row (one minute), competitive season
 * line and, for this season, his counters.
 */
const restoreSql = `WITH dropped AS (
    SELECT goal.*, player.position FROM ${GOALS} AS goal
    JOIN players AS player ON player.id = goal.player_id
    JOIN clubs AS club ON club.id = goal.club_id
    WHERE goal.kept AND NOT goal.recorded
  ),
  appearances AS (
    INSERT INTO player_match_appearances (fixture_id, player_id, club_id, season, date, position, started, minutes,
      minute_on, minute_off, rating, goals, assists, stats)
    SELECT fixture_id, player_id, club_id, season, date, position, 0, 1, coalesce(minute_on, 90), NULL,
      coalesce(NULLIF(rating, 0), round(least(10, 6.3 + 0.8 * goals + 0.45 * assists)::numeric, 1)::double precision),
      goals, assists, '{"repaired":true}'
    FROM dropped
    ON CONFLICT (fixture_id, player_id) DO NOTHING
    RETURNING 1
  ),
  lines AS (
    INSERT INTO player_season_stats AS target (player_id, season, club_id, league_id, minutes, appearances, goals, assists)
    SELECT player_id, season, club_id, league_id, count(*), count(*), sum(goals), sum(assists) FROM dropped
    WHERE league_id IS NOT NULL
    GROUP BY player_id, season, club_id, league_id
    ON CONFLICT (player_id, season, club_id, league_id) DO UPDATE SET minutes = target.minutes + EXCLUDED.minutes,
      appearances = target.appearances + EXCLUDED.appearances, goals = target.goals + EXCLUDED.goals,
      assists = target.assists + EXCLUDED.assists
    RETURNING 1
  ),
  counters AS (
    UPDATE players AS target SET appearances = target.appearances + changes.appearances,
      minutes = target.minutes + changes.appearances, goals = target.goals + changes.goals,
      assists = target.assists + changes.assists
    FROM (SELECT player_id, count(*) AS appearances, sum(goals) AS goals, sum(assists) AS assists FROM dropped
      WHERE season = ?::integer GROUP BY player_id) AS changes
    WHERE target.id = changes.player_id
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM appearances) AS appearances, (SELECT count(*) FROM lines) AS lines,
    (SELECT count(*) FROM counters) AS players`;

/**
 * Finished seasons of other clubs keep no match rows, only the goal lists of their fixtures: a season line with fewer
 * goals than its fixtures credit the player is raised to them (assists are not on record). A line missing altogether
 * gets one appearance and minute per fixture he scored in.
 */
const raiseSql = `WITH derived AS (
    SELECT player_id, season, club_id, league_id, sum(goals) AS goals, count(*) AS fixtures FROM ${GOALS}
    WHERE league_id IS NOT NULL AND goals > 0
    GROUP BY player_id, season, club_id, league_id
    HAVING NOT bool_or(kept)
  )
  INSERT INTO player_season_stats AS target (player_id, season, club_id, league_id, minutes, appearances, goals, assists)
  SELECT derived.player_id, derived.season, derived.club_id, derived.league_id, derived.fixtures, derived.fixtures,
    derived.goals, 0
  FROM derived
  JOIN players AS player ON player.id = derived.player_id
  JOIN clubs AS club ON club.id = derived.club_id
  LEFT JOIN player_season_stats AS stats ON stats.player_id = derived.player_id AND stats.season = derived.season
    AND stats.club_id = derived.club_id AND stats.league_id = derived.league_id
  WHERE derived.goals > coalesce(stats.goals, 0)
  ON CONFLICT (player_id, season, club_id, league_id) DO UPDATE SET goals = EXCLUDED.goals`;

/** Repairs match statistics recorded before stoppage-time substitutes were credited a minute (see restoreSql). */
export async function repairMatchStats(store: Store, season: number): Promise<MatchStatRepair> {
  return store.transaction(async () => {
    // One pass over every played fixture: a world of many seasons may need longer than the per-statement timeout.
    await store.exec(`SET LOCAL statement_timeout = 0; DROP TABLE IF EXISTS ${GOALS}; ${collectSql};`);
    const restored = await store.get<{ appearances: number }>(restoreSql, season);
    const raised = await store.run(raiseSql);
    await store.exec(`DROP TABLE ${GOALS};`);
    return { version: VERSION, appearances: Number(restored?.appearances ?? 0), lines: raised.changes };
  });
}

/** Once per world (and per older save loaded): repairMatchStats, on the next advance. */
export async function ensureMatchStatRepair(store: Store) {
  const state = await store.meta<GameState | undefined>("state").catch(() => undefined);
  if (!state) return;
  const present = await store.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", META);
  if (present && (JSON.parse(present.value) as MatchStatRepair).version === VERSION) return;
  await store.transaction(async () => store.setMeta(META, await repairMatchStats(store, state.season)));
}
