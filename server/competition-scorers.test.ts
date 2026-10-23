import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Store } from "./db.ts";
import { createApp } from "./app.ts";
import { createCalendar } from "./calendar.ts";
import { competitionScorers, MAX_SCORERS, SCORERS_PAGE, scorersQuery } from "./competition-scorers.ts";
import { schemaMigrations } from "./sql-schema.ts";
import { stateOf } from "./systems.ts";
import { generateWorld } from "./world.ts";
import type { CompetitionScorers } from "../shared/api.ts";

describe("competition scorers query (no database)", () => {
  it("defaults to the first page of the current season and bounds the request", () => {
    expect(scorersQuery.parse({})).toEqual({ limit: SCORERS_PAGE });
    expect(scorersQuery.parse({ season: "2025", limit: "40" })).toEqual({ season: 2025, limit: 40 });
    for (const query of [{ season: "next" }, { season: "2025.5" }, { limit: "0" }, { limit: String(MAX_SCORERS + 1) }])
      expect(() => scorersQuery.parse(query)).toThrow();
  });

  it("indexes only scorers' rows of a competition season in migration 10", () => {
    const migration = schemaMigrations("touchline_test_scorers").find((entry) => entry.version === 10);
    expect(migration?.statements).toEqual([
      `CREATE INDEX IF NOT EXISTS "player_season_scorers" ON "touchline_test_scorers"."player_season_stats" (league_id, season, goals DESC) WHERE goals > 0;`,
    ]);
  });
});

// Runs with SQL only (npm run test:local, CI backend job).
describe.skipIf(process.env.SQL_INTEGRATION_TESTS !== "true")("competition scorers on PostgreSQL", () => {
  let store: Store;
  let season: number;
  const competitions: Record<
    "league" | "youthLeague" | "cup" | "continental" | "international" | "youth" | "empty",
    number
  > = { league: 0, youthLeague: 0, cup: 0, continental: 0, international: 0, youth: 0, empty: 0 };
  let clubs: number[];
  let nationalTeam: number;
  let players: number[];
  const race = (leagueId: number, query: Record<string, unknown> = {}) =>
    store.readTransaction(() => competitionScorers(store, leagueId, query));
  const order = (result: CompetitionScorers) => result.scorers.map((scorer) => [scorer.rank, scorer.playerId]);

  beforeAll(async () => {
    store = await Store.createTest("scorers");
    await generateWorld(store, { nations: ["SCO"], squads: "minimum", seed: "competition-scorers" });
    await createCalendar(store);
    season = (await stateOf(store)).season;
    for (const [key, kind, senior] of [
      ["league", "league", true],
      ["youthLeague", "league", false],
      ["cup", "cup", true],
      ["continental", "continental", true],
      ["international", "international", null],
      ["youth", "youth", null],
    ] as const) {
      const league = await store.get<{ id: number }>(
        `SELECT id FROM leagues WHERE kind = ? AND (?::boolean IS NULL OR (age_group = 'Senior') = ?::boolean)
         ORDER BY age_group = 'Senior' DESC, reputation DESC, id LIMIT 1`,
        kind,
        senior,
        senior,
      );
      expect(league, key).toBeDefined();
      competitions[key] = league!.id;
    }
    competitions.empty = (await store.get<{ id: number }>(
      "SELECT id FROM leagues WHERE id <> ALL(?::integer[]) ORDER BY id LIMIT 1",
      Object.values(competitions).filter(Boolean),
    ))!.id;
    clubs = (await store.all<{ id: number }>("SELECT id FROM clubs WHERE type = 'club' ORDER BY id LIMIT 3")).map(
      (row) => row.id,
    );
    nationalTeam = (await store.get<{ id: number }>("SELECT id FROM clubs WHERE type = 'national' ORDER BY id LIMIT 1"))!.id;
    players = (
      await store.all<{ id: number }>("SELECT id FROM players WHERE club_id IS NOT NULL ORDER BY id LIMIT 12")
    ).map((row) => row.id);
    const names = ["Carl Alpha", "Ben Bravo", "Cid Charlie", "Bert Delta", "Ed Echo", "Fred Fox", "Gil Golf", "Hal Hotel", "Ian India", "Jo Juliet", "Kim Kilo", "Lou Lima"];
    for (const [index, id] of players.entries())
      await store.run("UPDATE players SET name = ? WHERE id = ?", names[index], id);
    const [a, b, c, d, e, f, g, h, i, j, k, l] = players;
    const [x, y, z] = clubs;
    const { league, youthLeague, cup, continental, international, youth } = competitions;
    const row = (player: number, club: number, leagueId: number, goals: number, minutes: number, assists = 0, at = season) => ({
      player_id: player, season: at, club_id: club, league_id: leagueId,
      minutes, appearances: Math.max(1, Math.ceil(minutes / 90)), goals, assists,
    });
    await store.transaction(() =>
      store.bulkInsert("player_season_stats", [
        // League, current season: four players level on five goals, B after a mid-season move.
        row(a, x, league, 5, 400, 1),
        row(b, x, league, 2, 300, 0),
        row(b, y, league, 3, 200, 2),
        row(c, x, league, 5, 400, 3),
        row(d, z, league, 5, 400, 1),
        row(e, x, league, 1, 90),
        row(f, x, league, 0, 900),
        // G scored only after his move: the goalless spell still counts towards his minutes and is listed.
        row(g, x, league, 0, 270),
        row(g, y, league, 1, 90),
        // Earlier seasons that still have data (a gap in between), and a goalless one that has none.
        row(h, x, league, 7, 1800, 2, season - 1),
        row(i, y, league, 2, 900, 0, season - 3),
        row(j, y, league, 0, 900, 0, season - 4),
        // Every other competition keeps its own race.
        row(a, x, cup, 2, 180),
        row(e, x, cup, 1, 90, 1),
        row(k, z, continental, 3, 270),
        row(l, y, continental, 3, 270),
        row(k, nationalTeam, international, 4, 360, 1),
        row(j, z, youthLeague, 6, 540, 2),
        row(i, x, youth, 2, 180),
        row(j, z, youth, 2, 90),
      ]),
    );
  });
  afterAll(async () => {
    await store?.close();
  });

  it("ranks a league season by goals, sharing ranks, then fewer minutes, more assists and name", async () => {
    const [a, b, c, d, e, , g] = players;
    const result = await race(competitions.league);
    expect(result).toMatchObject({
      leagueId: competitions.league, season, currentSeason: season, total: 6, goals: 22, leaders: 4,
    });
    expect(order(result)).toEqual([[1, c], [1, d], [1, a], [1, b], [5, e], [5, g]]);
    expect(result.scorers.map((scorer) => scorer.minutesPerGoal)).toEqual([80, 80, 80, 100, 90, 360]);
    expect(result.scorers[0]).toMatchObject({
      name: "Cid Charlie", goals: 5, assists: 3, appearances: 5, minutes: 400,
      teams: [{ id: clubs[0], goals: 5, minutes: 400, appearances: 5, type: "club" }],
    });
    const player = (await store.get<{ position: string; age: number; nationality: string; code: string }>(
      "SELECT players.position, players.age, players.nationality, countries.code FROM players JOIN countries ON countries.id = players.country_id WHERE players.id = ?",
      c,
    ))!;
    expect(result.scorers[0]).toMatchObject({
      position: player.position, age: player.age, nationality: player.nationality, countryCode: player.code,
    });
  });

  it("adds up a player's clubs in the competition season and lists every club, most goals first", async () => {
    const [, b, , , , f, g] = players;
    const [x, y] = clubs;
    const scorers = (await race(competitions.league)).scorers;
    const moved = scorers.find((scorer) => scorer.playerId === b)!;
    expect(moved).toMatchObject({ goals: 5, assists: 2, minutes: 500, appearances: 7 });
    expect(moved.teams.map((team) => [team.id, team.goals, team.minutes])).toEqual([[y, 3, 200], [x, 2, 300]]);
    const late = scorers.find((scorer) => scorer.playerId === g)!;
    expect(late).toMatchObject({ goals: 1, minutes: 360, minutesPerGoal: 360 });
    expect(late.teams.map((team) => [team.id, team.goals])).toEqual([[y, 1], [x, 0]]);
    expect(late.teams[0].name).toBe(
      (await store.get<{ name: string }>("SELECT name FROM clubs WHERE id = ?", y))!.name,
    );
    expect(scorers.some((scorer) => scorer.playerId === f)).toBe(false);
  });

  it("pages the race without changing ranks or totals", async () => {
    const [, , c, d, e, , g] = players;
    const first = await race(competitions.league, { limit: 2 });
    expect(order(first)).toEqual([[1, c], [1, d]]);
    expect(first).toMatchObject({ total: 6, goals: 22, leaders: 4 });
    expect(order(await race(competitions.league, { limit: 40 })).slice(-2)).toEqual([[5, e], [5, g]]);
  });

  it("serves cups, continental, international and youth competitions with their own scorers and teams", async () => {
    const [a, , , , e, , , , i, j, k, l] = players;
    const cup = await race(competitions.cup);
    expect(order(cup)).toEqual([[1, a], [2, e]]);
    expect(cup).toMatchObject({ total: 2, goals: 3, leaders: 1 });
    const continental = await race(competitions.continental);
    // Level on goals, minutes and assists: the name decides the order, the rank is shared.
    expect(order(continental)).toEqual([[1, k], [1, l]]);
    expect(continental.leaders).toBe(2);
    const international = await race(competitions.international);
    expect(order(international)).toEqual([[1, k]]);
    expect(international.scorers[0].teams).toEqual([
      expect.objectContaining({ id: nationalTeam, type: "national", goals: 4, appearances: 4, minutes: 360 }),
    ]);
    expect(order(await race(competitions.youthLeague))).toEqual([[1, j]]);
    const youth = await race(competitions.youth);
    // Level on goals: fewer minutes first.
    expect(order(youth)).toEqual([[1, j], [1, i]]);
    expect(youth.scorers.map((scorer) => scorer.minutesPerGoal)).toEqual([45, 90]);
  });

  it("lists the current season and past seasons with goals, and opens a past season", async () => {
    const [, , , , , , , h, i] = players;
    const result = await race(competitions.league);
    expect(result.seasons).toEqual([season, season - 1, season - 3]);
    const past = await race(competitions.league, { season: season - 1 });
    expect(past).toMatchObject({ season: season - 1, currentSeason: season, total: 1, goals: 7, leaders: 1 });
    expect(order(past)).toEqual([[1, h]]);
    expect(order(await race(competitions.league, { season: season - 3 }))).toEqual([[1, i]]);
    expect(await race(competitions.league, { season: season - 4 })).toMatchObject({ total: 0, goals: 0, leaders: 0, scorers: [] });
  });

  it("returns an empty race before the first goal", async () => {
    expect(await race(competitions.empty)).toEqual({
      leagueId: competitions.empty, season, currentSeason: season, seasons: [season], total: 0, goals: 0, leaders: 0,
      scorers: [],
    });
  });

  it("finds the scorers through the partial index", async () => {
    const plan = await store.transaction(async () => {
      await store.exec("SET LOCAL enable_seqscan = off");
      return (await store.all<{ "QUERY PLAN": string }>(
        "EXPLAIN SELECT DISTINCT player_id FROM player_season_stats WHERE league_id = ? AND season = ? AND goals > 0",
        competitions.league,
        season,
      )).map((line) => line["QUERY PLAN"]).join("\n");
    });
    expect(plan).toContain("player_season_scorers");
  });

  it("serves the race over HTTP and validates the request", async () => {
    await store.setMeta("state", { ...(await stateOf(store)), started: true });
    const app = await createApp(store);
    const response = await request(app).get(`/api/competitions/${competitions.league}/scorers?limit=3`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ leagueId: competitions.league, season, total: 6 });
    expect(response.body.scorers).toHaveLength(3);
    const past = await request(app).get(`/api/competitions/${competitions.league}/scorers?season=${season - 1}`);
    expect(past.body.scorers.map((scorer: { playerId: number }) => scorer.playerId)).toEqual([players[7]]);
    expect((await request(app).get(`/api/competitions/${competitions.league}/scorers?season=soon`)).status).toBe(400);
    expect((await request(app).get(`/api/competitions/${competitions.league}/scorers?limit=0`)).status).toBe(400);
    expect((await request(app).get("/api/competitions/abc/scorers")).status).toBe(400);
    const missing = await request(app).get("/api/competitions/99999999/scorers");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Competition not found.");
  });
});
