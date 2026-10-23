import { z } from "zod";
import type { Store } from "./db.ts";
import { GameError, stateOf } from "./systems.ts";
import type { CompetitionScorer, CompetitionScorers } from "../shared/api.ts";

/** Rows per "show more" step on the competition page. */
export const SCORERS_PAGE = 20;
export const MAX_SCORERS = 500;

export const scorersQuery = z.object({
  season: z.coerce.number().int().min(1900).max(9999).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_SCORERS).default(SCORERS_PAGE),
});

/**
 * One competition season's scorers from the season totals (player_season_stats), each player summed over every club
 * he played for in it. The partial index player_season_scorers (migration 10) finds the scorers; lateral aggregates
 * (never flattened into a scan of the whole competition) add their other rows, such as a goalless spell before a
 * move, by primary key. Only the returned page lists its clubs.
 */
const SCORERS_SQL = `
  WITH scorers AS (
    SELECT DISTINCT player_id FROM player_season_stats WHERE league_id = ? AND season = ? AND goals > 0
  ),
  ranked AS (
    SELECT scorers.player_id, totals.goals, totals.assists, totals.appearances, totals.minutes,
      player.name, player.position, player.age, player.nationality, player.country_id,
      rank() OVER (ORDER BY totals.goals DESC) AS rank,
      row_number() OVER (ORDER BY totals.goals DESC, totals.minutes, totals.assists DESC, player.name, player.id) AS ordinal
    FROM scorers
    CROSS JOIN LATERAL (
      SELECT sum(goals) AS goals, sum(assists) AS assists, sum(appearances) AS appearances, sum(minutes) AS minutes
      FROM player_season_stats WHERE player_id = scorers.player_id AND season = ? AND league_id = ?
    ) AS totals
    JOIN players AS player ON player.id = scorers.player_id
    ORDER BY ordinal LIMIT ?
  )
  SELECT ranked.rank, ranked.player_id AS "playerId", ranked.name, ranked.position, ranked.age, ranked.nationality,
    country.code AS "countryCode", ranked.goals, ranked.assists, ranked.appearances, ranked.minutes,
    round(ranked.minutes::numeric / ranked.goals) AS "minutesPerGoal", spells.teams
  FROM ranked
  LEFT JOIN countries AS country ON country.id = ranked.country_id
  CROSS JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('id', team.id, 'name', team.name, 'color', team.color, 'type', team.type,
        'goals', stats.goals, 'appearances', stats.appearances, 'minutes', stats.minutes)
      ORDER BY stats.goals DESC, stats.minutes DESC, team.id) AS teams
    FROM player_season_stats AS stats
    JOIN clubs AS team ON team.id = stats.club_id
    WHERE stats.player_id = ranked.player_id AND stats.season = ? AND stats.league_id = ?
  ) AS spells
  ORDER BY ranked.ordinal`;

/** Scorers, their goals and how many share the lead (goalless spells add no goals, so only scoring rows are read). */
const SUMMARY_SQL = `
  WITH totals AS (
    SELECT player_id, sum(goals) AS goals FROM player_season_stats
    WHERE league_id = ? AND season = ? AND goals > 0 GROUP BY player_id
  )
  SELECT count(*) AS total, coalesce(sum(goals), 0) AS goals,
    count(*) FILTER (WHERE goals = (SELECT max(goals) FROM totals)) AS leaders
  FROM totals`;

/** Seasons with at least one goal, newest first: a loose index scan that skips from season to season. */
const SEASONS_SQL = `
  WITH RECURSIVE seasons(season) AS (
    (SELECT season FROM player_season_stats WHERE league_id = ? AND goals > 0 ORDER BY season DESC LIMIT 1)
    UNION ALL
    SELECT (SELECT stats.season FROM player_season_stats AS stats
        WHERE stats.league_id = ? AND stats.goals > 0 AND stats.season < seasons.season
        ORDER BY stats.season DESC LIMIT 1)
    FROM seasons WHERE seasons.season IS NOT NULL
  )
  SELECT season FROM seasons WHERE season IS NOT NULL`;

/** GET /api/competitions/:id/scorers: the competition's top-scorer race for a season (the current one by default). */
export async function competitionScorers(
  store: Store,
  leagueId: number,
  query: unknown,
): Promise<CompetitionScorers> {
  const filter = scorersQuery.parse(query);
  const league = await store.get<{ id: number }>("SELECT id FROM leagues WHERE id = ?", leagueId);
  if (!league) throw Object.assign(new GameError("Competition not found."), { status: 404 });
  const currentSeason = (await stateOf(store)).season;
  const season = filter.season ?? currentSeason;
  const recorded = await store.all<{ season: number }>(SEASONS_SQL, leagueId, leagueId);
  const summary = (await store.get<{ total: number; goals: number; leaders: number }>(SUMMARY_SQL, leagueId, season))!;
  const scorers = summary.total
    ? await store.all<CompetitionScorer>(SCORERS_SQL, leagueId, season, season, leagueId, filter.limit, season, leagueId)
    : [];
  return {
    leagueId,
    season,
    currentSeason,
    seasons: [...new Set([currentSeason, ...recorded.map((row) => row.season)])].sort(
      (first, second) => second - first,
    ),
    total: summary.total,
    goals: summary.goals,
    leaders: summary.leaders,
    scorers,
  };
}
