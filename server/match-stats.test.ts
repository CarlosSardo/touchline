import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import { createCalendar } from "./calendar.ts";
import { advance } from "./simulation.ts";
import { stateOf } from "./systems.ts";
import { playerHistory } from "./player-history.ts";
import { ensureMatchStatRepair, repairMatchStats } from "./stat-repair.ts";

/** Both sides of every played fixture of the season (awarded results excepted: their scores are not the goals scored). */
const SIDES = `sides AS (
  SELECT fixture.id, fixture.league_id, side.club_id, side.goals, fixture.data::jsonb AS doc
  FROM fixtures AS fixture
  CROSS JOIN LATERAL (VALUES (fixture.home_id, fixture.home_goals), (fixture.away_id, fixture.away_goals)) AS side(club_id, goals)
  WHERE fixture.status = 'played' AND fixture.season = ?
    AND jsonb_typeof(fixture.data::jsonb -> 'awarded') IS DISTINCT FROM 'object')`;

interface StatLine {
  player_id: number;
  season: number;
  club_id: number;
  league_id: number;
  appearances: number;
  minutes: number;
  goals: number;
  assists: number;
}

describe("match statistics of both match paths", () => {
  let store: Store;
  let season: number;
  beforeAll(async () => {
    store = await Store.createTest("match_stats");
    await generateWorld(store, { nations: ["EN"] });
    await createCalendar(store);
    // Pre-season friendlies, then the first league and cup rounds (EN leagues start on 8 August).
    await advance(store, 28);
    await advance(store, 21);
    season = (await stateOf(store)).season;
  }, 900_000);
  afterAll(async () => {
    await store?.close();
  });

  it("records every goal of every fixture for its scorer, on the full engine and the fast model alike", async () => {
    const paths = (await store.get<{ detailed: number; fast: number; competitive: number; friendlies: number; goals: number }>(
      `WITH ${SIDES}
       SELECT count(DISTINCT id) FILTER (WHERE jsonb_typeof(doc -> 'snapshot') = 'object') AS detailed,
         count(DISTINCT id) FILTER (WHERE jsonb_typeof(doc -> 'scorers') = 'array') AS fast,
         count(DISTINCT id) FILTER (WHERE league_id IS NOT NULL) AS competitive,
         count(DISTINCT id) FILTER (WHERE league_id IS NULL) AS friendlies, sum(goals) AS goals FROM sides`,
      season,
    ))!;
    expect(paths.detailed).toBeGreaterThan(3);
    expect(paths.fast).toBeGreaterThan(300);
    expect(paths.competitive).toBeGreaterThan(100);
    expect(paths.friendlies).toBeGreaterThan(50);
    expect(paths.goals).toBeGreaterThan(500);
    // Each side's goals are its players' goals; assists never exceed them; a side fields 7 to 11 starters.
    expect(
      await store.all(
        `WITH ${SIDES}
         SELECT sides.id, sides.club_id, sides.goals, match_rows.goals AS recorded, match_rows.assists, match_rows.starters FROM sides
         CROSS JOIN LATERAL (SELECT coalesce(sum(goals), 0) AS goals, coalesce(sum(assists), 0) AS assists,
           coalesce(sum(started), 0) AS starters
           FROM player_match_appearances AS match_row WHERE match_row.fixture_id = sides.id AND match_row.club_id = sides.club_id) AS match_rows
         WHERE match_rows.goals <> sides.goals OR match_rows.assists > sides.goals OR match_rows.starters NOT BETWEEN 7 AND 11`,
        season,
      ),
    ).toEqual([]);
    // Every scorer named in a fixture's goal list has exactly those goals in his match row.
    expect(
      await store.all(
        `WITH ${SIDES},
         listed AS (
           SELECT sides.id AS fixture_id, (goal.value ->> 'playerId')::integer AS player_id, count(*) AS goals
           FROM sides CROSS JOIN LATERAL jsonb_array_elements(CASE
             WHEN jsonb_typeof(sides.doc -> 'scorers') = 'array' THEN sides.doc -> 'scorers'
             ELSE sides.doc -> 'events' END) AS goal(value)
           WHERE (goal.value ->> 'teamId')::integer = sides.club_id
             AND (jsonb_typeof(sides.doc -> 'scorers') = 'array' OR goal.value ->> 'type' = 'goal')
           GROUP BY 1, 2),
         recorded AS (
           SELECT match_row.fixture_id, match_row.player_id, match_row.goals FROM player_match_appearances AS match_row
           WHERE match_row.goals > 0 AND match_row.fixture_id IN (SELECT id FROM sides))
         SELECT * FROM listed FULL JOIN recorded USING (fixture_id, player_id) WHERE listed.goals IS DISTINCT FROM recorded.goals`,
        season,
      ),
    ).toEqual([]);
  });

  it("gives every starter and every substitute who came on one match row with minutes, and nobody else", async () => {
    expect(
      await store.all(
        `WITH detailed AS (
           SELECT fixture.id, fixture.data::jsonb AS doc FROM fixtures AS fixture
           WHERE fixture.status = 'played' AND fixture.season = ? AND jsonb_typeof(fixture.data::jsonb -> 'snapshot') = 'object'),
         expected AS (
           SELECT detailed.id AS fixture_id, (player.value ->> 'id')::integer AS player_id FROM detailed
           CROSS JOIN LATERAL jsonb_array_elements((detailed.doc #> '{snapshot,home,lineup}') || (detailed.doc #> '{snapshot,away,lineup}')) AS player(value)
           UNION
           SELECT detailed.id, (change.value ->> 'onId')::integer FROM detailed
           CROSS JOIN LATERAL jsonb_array_elements(coalesce(detailed.doc -> 'substitutions', '[]'::jsonb)) AS change(value)),
         actual AS (SELECT fixture_id, player_id FROM player_match_appearances WHERE fixture_id IN (SELECT id FROM detailed))
         SELECT 'missing' AS kind, * FROM (SELECT * FROM expected EXCEPT SELECT * FROM actual) AS missing
         UNION ALL SELECT 'extra', * FROM (SELECT * FROM actual EXCEPT SELECT * FROM expected) AS extra`,
        season,
      ),
    ).toEqual([]);
    expect(await store.get("SELECT count(*) AS count FROM player_match_appearances WHERE minutes < 1")).toEqual({ count: 0 });
  });

  it("adds up competitive match rows into the season lines and all match rows into the players' season counters", async () => {
    // Season lines: competitive matches only, per club played for and competition.
    expect(
      await store.all(
        `WITH match_rows AS (
           SELECT match_row.player_id, match_row.season, match_row.club_id, fixture.league_id, count(*) AS appearances, sum(match_row.minutes) AS minutes,
             sum(match_row.goals) AS goals, sum(match_row.assists) AS assists
           FROM player_match_appearances AS match_row JOIN fixtures AS fixture ON fixture.id = match_row.fixture_id
           WHERE fixture.league_id IS NOT NULL GROUP BY 1, 2, 3, 4),
         lines AS (SELECT * FROM player_season_stats)
         SELECT * FROM match_rows FULL JOIN lines USING (player_id, season, club_id, league_id)
         WHERE (match_rows.appearances, match_rows.minutes, match_rows.goals, match_rows.assists)
           IS DISTINCT FROM (lines.appearances, lines.minutes, lines.goals, lines.assists)`,
      ),
    ).toEqual([]);
    expect(
      await store.get("SELECT count(*) AS count FROM player_season_stats WHERE league_id NOT IN (SELECT id FROM leagues)"),
    ).toEqual({ count: 0 });
    // players.appearances/minutes/goals/assists: this season's matches, friendlies included.
    expect(
      await store.all(
        `WITH match_rows AS (SELECT player_id, count(*) AS appearances, sum(minutes) AS minutes, sum(goals) AS goals, sum(assists) AS assists
           FROM player_match_appearances WHERE season = ? GROUP BY player_id)
         SELECT player.id FROM players AS player LEFT JOIN match_rows ON match_rows.player_id = player.id
         WHERE (player.appearances, player.minutes, player.goals, player.assists)
           IS DISTINCT FROM (coalesce(match_rows.appearances, 0), coalesce(match_rows.minutes, 0), coalesce(match_rows.goals, 0), coalesce(match_rows.assists, 0))`,
        season,
      ),
    ).toEqual([]);
  });

  it("shows the season lines' goals and assists in every scorer's history, friendlies apart", async () => {
    const scorers = await store.all<{ player_id: number }>(
      "SELECT player_id FROM player_season_stats GROUP BY player_id ORDER BY sum(goals) DESC, player_id LIMIT 12",
    );
    expect(scorers).toHaveLength(12);
    for (const { player_id } of scorers) {
      const lines = await store.all<StatLine>("SELECT * FROM player_season_stats WHERE player_id = ?", player_id);
      const friendlies = (await store.get<{ appearances: number; goals: number }>(
        `SELECT count(*) AS appearances, coalesce(sum(match_row.goals), 0) AS goals FROM player_match_appearances AS match_row
         JOIN fixtures AS fixture ON fixture.id = match_row.fixture_id WHERE match_row.player_id = ? AND fixture.league_id IS NULL`,
        player_id,
      ))!;
      const history = await playerHistory(store, player_id);
      const sum = (key: "appearances" | "minutes" | "goals" | "assists") => lines.reduce((total, line) => total + line[key], 0);
      expect(history.career).toMatchObject({
        appearances: sum("appearances"),
        minutes: sum("minutes"),
        goals: sum("goals"),
        assists: sum("assists"),
        ratingCoverage: "full",
      });
      expect(history.career.goals).toBeGreaterThan(0);
      expect(
        history.seasons.flatMap((entry) =>
          entry.clubs.flatMap((club) => club.competitions.map((line) => [club.club.id, line.competition.id, line.goals, line.assists])),
        ).sort(),
      ).toEqual(lines.map((line) => [line.club_id, line.league_id, line.goals, line.assists]).sort());
      expect(history.careerFriendlies?.appearances ?? 0).toBe(friendlies.appearances);
      expect(history.careerFriendlies?.goals ?? 0).toBe(friendlies.goals);
    }
  });

  it("restores goals lost by stoppage-time substitutes once, from the fixtures' goal lists", async () => {
    expect(await store.meta("matchStatsRepair")).toEqual({ version: 1, appearances: 0, lines: 0 });
    const lineOf = (line: Pick<StatLine, "player_id" | "season" | "club_id" | "league_id">) =>
      store.get<StatLine>(
        "SELECT * FROM player_season_stats WHERE player_id = ? AND season = ? AND club_id = ? AND league_id = ?",
        line.player_id,
        line.season,
        line.club_id,
        line.league_id,
      );
    type Row = StatLine & { fixture_id: number; rating: number };
    const pick = (path: "scorers" | "snapshot", exclude: number[]) =>
      store.get<Row>(
        `SELECT match_row.fixture_id, match_row.player_id, match_row.season, match_row.club_id, fixture.league_id, 1 AS appearances, match_row.minutes,
           match_row.goals, match_row.assists, match_row.rating
         FROM player_match_appearances AS match_row JOIN fixtures AS fixture ON fixture.id = match_row.fixture_id
         WHERE match_row.goals > 0 AND fixture.league_id IS NOT NULL AND match_row.club_id <> ALL(?::integer[])
           AND jsonb_typeof(fixture.data::jsonb -> ?::text) = ?::text
         ORDER BY match_row.fixture_id, match_row.player_id LIMIT 1`,
        exclude,
        path,
        path === "scorers" ? "array" : "object",
      );
    const fast = (await pick("scorers", [0]))!;
    const detailed = (await pick("snapshot", [fast.club_id]))!;
    expect(fast && detailed).toBeTruthy();
    // A finished season of another club keeps no match rows: drop one club's league rows as retention would.
    const pruned = (await pick("scorers", [fast.club_id, detailed.club_id]))!;
    const before = await store.all<StatLine>("SELECT * FROM player_season_stats ORDER BY player_id, season, club_id, league_id");
    const counters = async (id: number) =>
      (await store.get<{ appearances: number; minutes: number; goals: number; assists: number }>(
        "SELECT appearances, minutes, goals, assists FROM players WHERE id = ?",
        id,
      ))!;
    const countersBefore = [await counters(fast.player_id), await counters(detailed.player_id)];
    // The old engines' loss: a substitute sent on in stoppage time got no minute, so no row, line or counter entry.
    for (const lost of [fast, detailed]) {
      await store.run("DELETE FROM player_match_appearances WHERE fixture_id = ? AND player_id = ?", lost.fixture_id, lost.player_id);
      await store.run(
        `UPDATE player_season_stats SET appearances = appearances - 1, minutes = minutes - ?, goals = goals - ?, assists = assists - ?
         WHERE player_id = ? AND season = ? AND club_id = ? AND league_id = ?`,
        lost.minutes,
        lost.goals,
        lost.assists,
        lost.player_id,
        lost.season,
        lost.club_id,
        lost.league_id,
      );
      await store.run(
        "UPDATE players SET appearances = appearances - 1, minutes = minutes - ?, goals = goals - ?, assists = assists - ? WHERE id = ?",
        lost.minutes,
        lost.goals,
        lost.assists,
        lost.player_id,
      );
    }
    await store.run(
      `DELETE FROM player_match_appearances AS match_row USING fixtures AS fixture
       WHERE fixture.id = match_row.fixture_id AND match_row.club_id = ? AND fixture.league_id = ?`,
      pruned.club_id,
      pruned.league_id,
    );
    await store.run(
      "UPDATE player_season_stats SET goals = goals - 1 WHERE player_id = ? AND season = ? AND club_id = ? AND league_id = ?",
      pruned.player_id,
      pruned.season,
      pruned.club_id,
      pruned.league_id,
    );
    await ensureMatchStatRepair(store);
    expect(await store.meta("matchStatsRepair")).toEqual({ version: 1, appearances: 0, lines: 0 });
    await store.run("DELETE FROM meta WHERE key = 'matchStatsRepair'");
    await ensureMatchStatRepair(store);
    expect(await store.meta("matchStatsRepair")).toEqual({ version: 1, appearances: 2, lines: 1 });

    // Restored as one-minute appearances; a compacted fixture lists scorers but not assists, a detailed one has both.
    expect(
      await store.get("SELECT minutes, started, goals, assists, stats FROM player_match_appearances WHERE fixture_id = ? AND player_id = ?", fast.fixture_id, fast.player_id),
    ).toEqual({ minutes: 1, started: 0, goals: fast.goals, assists: 0, stats: '{"repaired":true}' });
    expect(
      await store.get("SELECT minutes, goals, assists, rating FROM player_match_appearances WHERE fixture_id = ? AND player_id = ?", detailed.fixture_id, detailed.player_id),
    ).toEqual({ minutes: 1, goals: detailed.goals, assists: detailed.assists, rating: detailed.rating });
    const expected = new Map(before.map((line) => [`${line.player_id}:${line.season}:${line.club_id}:${line.league_id}`, line]));
    for (const [lost, assists] of [[fast, 0], [detailed, detailed.assists]] as const) {
      const key = `${lost.player_id}:${lost.season}:${lost.club_id}:${lost.league_id}`;
      const line = expected.get(key)!;
      expected.set(key, { ...line, minutes: line.minutes - lost.minutes + 1, assists: line.assists - lost.assists + assists });
    }
    expect(await store.all("SELECT * FROM player_season_stats ORDER BY player_id, season, club_id, league_id")).toEqual([
      ...expected.values(),
    ]);
    expect(await lineOf(pruned)).toEqual(expected.get(`${pruned.player_id}:${pruned.season}:${pruned.club_id}:${pruned.league_id}`));
    expect(await counters(fast.player_id)).toEqual({
      ...countersBefore[0],
      minutes: countersBefore[0].minutes - fast.minutes + 1,
      assists: countersBefore[0].assists - fast.assists,
    });
    expect(await counters(detailed.player_id)).toEqual({ ...countersBefore[1], minutes: countersBefore[1].minutes - detailed.minutes + 1 });
    // Nothing left to repair.
    expect(await repairMatchStats(store, season)).toEqual({ version: 1, appearances: 0, lines: 0 });
  });
});
