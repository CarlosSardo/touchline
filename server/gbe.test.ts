import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import seedrandom from "seedrandom";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import { createCalendar } from "./calendar.ts";
import { readCheckpoint, writeCheckpoint, type RestoredValue } from "./save-format.ts";
import { checkpointSchema, Saves } from "./saves.ts";
import { advance } from "./simulation.ts";
import { GBE_TABLES } from "./sql-schema.ts";
import { friendlyPairs } from "./internationals.ts";
import {
  archiveClubSeasons,
  ensureGbeBaseline,
  FRIENDLIES_NAME,
  gbeAssessment,
  gbeAssessments,
  ledgerCompetition,
  ledgerSeason,
  monthlyLedger,
  recordGbeMatches,
  refreshGbe,
  refreshGbeIfDue,
} from "./gbe.ts";
import { FA_2026_27, gbeLeagueBand } from "../shared/gbe/index.ts";
import type { GameState, League, MatchPlayer, MatchTeam } from "../shared/types.ts";

describe("GBE ledger helpers (pure)", () => {
  const league = (patch: Record<string, unknown>) =>
    ({
      id: 7,
      name: "League",
      kind: "league",
      tier: 1,
      age_group: "Senior",
      country_code: "ES",
      catalog_id: null,
      catalog_format: null,
      catalog_kind: null,
      playoff_league: null,
      qualifying: false,
      friendly: false,
      ...patch,
    }) as Parameters<typeof ledgerCompetition>[0];

  it("maps senior competitions to ledger kinds and ignores youth football", () => {
    expect(ledgerCompetition(league({}), "Matchday 1")).toEqual({ kind: "league", leagueId: 7 });
    expect(ledgerCompetition(league({ age_group: "U19" }), "Matchday 1")).toBeNull();
    expect(ledgerCompetition(league({ kind: "cup" }), "Final")).toEqual({ kind: "cup", leagueId: 7 });
    // Promotion play-offs count as league football of the league they decide.
    expect(ledgerCompetition(league({ kind: "cup", playoff_league: 3 }), "Final")).toEqual({ kind: "league", leagueId: 3 });
    expect(ledgerCompetition(league({ kind: "continental" }), "League phase")).toEqual({ kind: "continental", leagueId: 7 });
    expect(ledgerCompetition(league({ kind: "continental" }), "Qualifying")).toEqual({ kind: "qualifying", leagueId: 7 });
    expect(ledgerCompetition(league({ kind: "continental", catalog_kind: "super" }), "Final")?.kind).toBe("qualifying");
    expect(ledgerCompetition(league({ kind: "international" }), "Group 1")?.kind).toBe("international");
    expect(ledgerCompetition(league({ kind: "international", friendly: true }), "Friendly")?.kind).toBe("friendly");
    expect(ledgerCompetition(undefined, "Friendly")).toBeNull();
  });

  it("files months under the July-June club season", () => {
    expect(ledgerSeason("2026-07")).toEqual([2026, 0]);
    expect(ledgerSeason("2026-12")).toEqual([2026, 5]);
    expect(ledgerSeason("2027-01")).toEqual([2026, 6]);
    expect(ledgerSeason("2027-06")).toEqual([2026, 11]);
  });

  it("pairs friendly opponents of similar strength, each team at most once", () => {
    const teams = Array.from({ length: 11 }, (_, index) => ({
      id: index + 1,
      confederation: index < 6 ? "UEFA" : "CAF",
      reputation: 90 - index * 4,
    }));
    const pairs = friendlyPairs(teams, seedrandom("friendlies"));
    const used = pairs.flat();
    expect(new Set(used).size).toBe(used.length);
    expect(used).toHaveLength(10);
    for (const [home, away] of pairs)
      expect(teams.find((team) => team.id === home)!.reputation).toBeGreaterThanOrEqual(teams.find((team) => team.id === away)!.reputation);
    // Eleven teams: one rests; the confederations pair internally, an odd team from each across them.
    expect(pairs.filter(([home, away]) => (home <= 6) !== (away <= 6)).length).toBeLessThanOrEqual(1);
  });
});

describe("GBE data in a world", () => {
  let store: Store;
  let state: GameState;

  const count = async (sql: string, ...params: (string | number)[]) =>
    Number((await store.get<{ n: number }>(sql, ...params))!.n);

  beforeAll(async () => {
    store = await Store.createTest("gbe");
    await generateWorld(store, { nations: ["EN", "ES", "NG"], squads: "minimum", seed: "gbe" });
    await createCalendar(store);
    state = await store.meta<GameState>("state");
  }, 240_000);
  afterAll(async () => await store?.close());

  it("seeds a pre-game career at world creation, marked as an estimate", async () => {
    const kinds = await store.all<{ kind: string; rows: number }>(
      "SELECT kind, count(*) AS rows FROM player_minutes_monthly WHERE estimated GROUP BY kind ORDER BY kind",
    );
    expect(kinds.map((row) => row.kind)).toEqual(expect.arrayContaining(["league", "international", "friendly", "continental"]));
    expect(await count("SELECT count(*) AS n FROM player_minutes_monthly WHERE NOT estimated")).toBe(0);
    expect(await count("SELECT count(DISTINCT month) AS n FROM national_team_months WHERE estimated")).toBe(24);
    expect(await count("SELECT count(*) AS n FROM club_season_outcomes WHERE estimated AND season = ? AND champion", state.season - 1)).toBeGreaterThan(0);
    // Idempotent: a second call (every advance, every save load) changes nothing.
    const before = await count("SELECT count(*) AS n FROM player_minutes_monthly");
    await ensureGbeBaseline(store);
    expect(await count("SELECT count(*) AS n FROM player_minutes_monthly")).toBe(before);
  });

  it("schedules senior friendlies in the March and June FIFA windows for every nation", async () => {
    const fixtures = await store.all<{ code: string; months: string[] }>(
      `SELECT countries.code, array_agg(DISTINCT substr(fixtures.date, 6, 2) ORDER BY substr(fixtures.date, 6, 2)) AS months
       FROM fixtures JOIN leagues ON leagues.id = fixtures.league_id JOIN clubs ON clubs.id IN (fixtures.home_id, fixtures.away_id)
       JOIN countries ON countries.id = clubs.country_id
       WHERE leagues.name = ? AND fixtures.season = ? GROUP BY countries.code ORDER BY countries.code`,
      FRIENDLIES_NAME,
      state.season,
    );
    expect(fixtures.map((row) => row.code)).toEqual(["EN", "ES", "NG"]);
    expect(new Set(fixtures.flatMap((row) => row.months))).toEqual(new Set(["03", "06"]));
  });

  it("gives a varied, rule-driven distribution from day one", async () => {
    await refreshGbe(store);
    const rows = await store.all<{ points: number; outcome: string; code: string; league_code: string; tier: number; quality: string }>(
      `SELECT player_gbe.points, player_gbe.outcome, countries.code, league_country.code AS league_code, leagues.tier,
         left(player_gbe.assessment, 1) AS quality
       FROM player_gbe JOIN players ON players.id = player_gbe.player_id JOIN countries ON countries.id = players.country_id
       JOIN clubs ON clubs.id = players.club_id AND clubs.type = 'club' JOIN leagues ON leagues.id = clubs.league_id
       JOIN countries AS league_country ON league_country.id = leagues.country_id
       WHERE players.age_group = 'Senior'`,
    );
    expect(rows.length).toBeGreaterThan(500);
    expect(rows.filter((row) => row.points === 0).length / rows.length).toBeLessThan(0.25);
    expect(new Set(rows.map((row) => row.quality))).toEqual(new Set(["e"]));
    const mean = (band: number) => {
      const list = rows.filter((row) => gbeLeagueBand(FA_2026_27, row.league_code, row.tier) === band);
      return list.reduce((total, row) => total + row.points, 0) / list.length;
    };
    expect(mean(1)).toBeGreaterThan(mean(6) + 8);
    // Spanish top-flight players mostly meet the criteria; English players are exempt; Nigerian league players do not.
    const laLiga = rows.filter((row) => row.league_code === "ES" && row.tier === 1 && row.code !== "EN");
    expect(laLiga.filter((row) => ["pass", "auto_pass"].includes(row.outcome)).length / laLiga.length).toBeGreaterThan(0.5);
    expect(rows.filter((row) => row.code === "EN").every((row) => row.outcome === "exempt")).toBe(true);
    expect(rows.filter((row) => row.league_code === "NG" && row.outcome === "pass").length).toBe(0);
    // Regular internationals of a top nation reach an automatic pass.
    expect(rows.some((row) => row.code === "ES" && row.outcome === "auto_pass")).toBe(true);
  });

  it("explains every criterion with its data status", async () => {
    const { id } = (await store.get<{ id: number }>(
      `SELECT players.id FROM player_gbe JOIN players ON players.id = player_gbe.player_id JOIN countries ON countries.id = players.country_id
       WHERE countries.code = 'ES' ORDER BY player_gbe.points DESC, players.id LIMIT 1`,
    ))!;
    const assessment = await gbeAssessment(store, id);
    expect(assessment).toMatchObject({ playerId: id, ruleset: "fa-2026-27", passMark: 15, dataQuality: "estimate" });
    expect(assessment.breakdown.map((row) => row.criterion)).toEqual([
      "international",
      "domestic_minutes",
      "continental_minutes",
      "league_position",
      "continental_progression",
      "league_standard",
    ]);
    for (const row of assessment.breakdown) {
      expect(row.label).toMatch(/^Table \d/);
      expect(row.detail.length).toBeGreaterThan(10);
    }
    expect(assessment.points).toBe(assessment.breakdown.reduce((total, row) => total + row.points, 0));
    expect(assessment.notes?.some((note) => note.includes("pre-game estimate"))).toBe(true);
    await expect(gbeAssessment(store, 99_999_999)).rejects.toThrow(/not found/);
  });

  it("serves cached assessments until the player moves club", async () => {
    const { id, club_id } = (await store.get<{ id: number; club_id: number }>(
      "SELECT players.id, players.club_id FROM players JOIN player_gbe ON player_gbe.player_id = players.id WHERE player_gbe.points > 10 ORDER BY players.id LIMIT 1",
    ))!;
    const cached = (await gbeAssessments(store, [id])).get(id)!;
    expect(cached.breakdown[0].detail).toMatch(/Cached summary/);
    const fresh = await gbeAssessment(store, id);
    expect(cached).toMatchObject({ points: fresh.points, outcome: fresh.outcome, autoPass: fresh.autoPass, dataQuality: fresh.dataQuality });
    expect(cached.esc?.eligible).toBe(fresh.esc?.eligible);
    expect(cached.breakdown.map(({ criterion, points, status }) => [criterion, points, status])).toEqual(
      fresh.breakdown.map(({ criterion, points, status }) => [criterion, points, status]),
    );
    const other = (await store.get<{ id: number }>(
      "SELECT clubs.id FROM clubs JOIN leagues ON leagues.id = clubs.league_id JOIN countries ON countries.id = leagues.country_id WHERE countries.code = 'NG' AND clubs.type = 'club' ORDER BY clubs.id LIMIT 1",
    ))!.id;
    await store.run("UPDATE players SET club_id = ? WHERE id = ?", other, id);
    try {
      expect((await gbeAssessments(store, [id])).get(id)!.breakdown[0].detail).not.toMatch(/Cached summary/);
    } finally {
      await store.run("UPDATE players SET club_id = ? WHERE id = ?", club_id, id);
    }
    // The monthly refresh is not due again within the same month.
    expect(await refreshGbeIfDue(store)).toBe(false);
  });

  it("records matchday squads, unused substitutes and unavailable players", async () => {
    const fixture = (await store.get<{ id: number; league_id: number; home_id: number; away_id: number; stage: string }>(
      `SELECT fixtures.id, fixtures.league_id, fixtures.home_id, fixtures.away_id, fixtures.stage FROM fixtures
       JOIN leagues ON leagues.id = fixtures.league_id JOIN countries ON countries.id = leagues.country_id
       WHERE leagues.kind = 'league' AND leagues.tier = 1 AND countries.code = 'ES' ORDER BY fixtures.date, fixtures.id LIMIT 1`,
    ))!;
    const league = (await store.get<League>("SELECT * FROM leagues WHERE id = ?", fixture.league_id))!;
    const squad = async (clubId: number) =>
      (
        await store.all<{ id: number }>(
          "SELECT id FROM players WHERE playing_club_id = ? AND age_group = 'Senior' AND role <> 'Retired' ORDER BY ability DESC, id",
          clubId,
        )
      ).map((row) => row.id);
    const home = await squad(fixture.home_id);
    const away = await squad(fixture.away_id);
    const team = (id: number, ids: number[]) =>
      ({ id, lineup: ids.slice(0, 11).map((player) => ({ id: player }) as MatchPlayer), bench: ids.slice(11, 13).map((player) => ({ id: player }) as MatchPlayer) }) as MatchTeam;
    const injured = home.at(-1)!;
    await store.run("UPDATE players SET injury_until = '2099-01-01' WHERE id = ?", injured);
    const players: Record<number, { minutes: number }> = {};
    for (const id of [...home.slice(0, 11), ...away.slice(0, 11)]) players[id] = { minutes: 90 };
    players[home[11]] = { minutes: 0 };
    const date = "2026-08-20";
    await recordGbeMatches(
      store,
      date,
      [{ fixture: { league_id: fixture.league_id, stage: fixture.stage, date }, league, teams: [team(fixture.home_id, home), team(fixture.away_id, away)], result: { players, wentToExtraTime: false } as never }],
      new Set(),
    );
    const row = async (player: number) =>
      store.get<{ available: number; minutes: number; appearances: number; listed: number; unavailable: number }>(
        `SELECT available, minutes, appearances, listed, unavailable FROM ${monthlyLedger("ledger.player_id = ? AND ledger.kind = 'league' AND NOT ledger.estimated")} WHERE month = '2026-08'`,
        player,
      );
    expect(await row(home[0])).toEqual({ available: 90, minutes: 90, appearances: 1, listed: 1, unavailable: 0 });
    // An unused substitute was named in the matchday squad (Tables 4-6) without minutes.
    expect(await row(home[11])).toEqual({ available: 90, minutes: 0, appearances: 0, listed: 1, unavailable: 0 });
    expect(await row(injured)).toEqual({ available: 0, minutes: 0, appearances: 0, listed: 0, unavailable: 90 });
    if (home.length > 14) expect(await row(home[13])).toMatchObject({ available: 90, listed: 0 });
    await store.run("UPDATE players SET injury_until = NULL WHERE id = ?", injured);
  });

  it("archives club seasons with promotion and relegation from the movements", async () => {
    const [top, second] = await store.all<{ id: number; tier: number }>(
      `SELECT leagues.id, leagues.tier FROM leagues JOIN countries ON countries.id = leagues.country_id
       WHERE countries.code = 'ES' AND leagues.kind = 'league' AND leagues.age_group = 'Senior' AND leagues.tier IN (1, 2) ORDER BY leagues.tier`,
    );
    const clubs = async (leagueId: number) =>
      (await store.all<{ id: number }>("SELECT id FROM clubs WHERE league_id = ? AND type = 'club' ORDER BY reputation DESC, id", leagueId)).map((row) => row.id);
    const upper = await clubs(top.id);
    const lower = await clubs(second.id);
    const season = state.season;
    for (const [leagueId, table] of [[top.id, upper], [second.id, lower]] as const)
      await store.run(
        "INSERT INTO history(entity_type, entity_id, season, date, data) VALUES ('league', ?, ?, ?, ?)",
        leagueId,
        season,
        `${season + 1}-06-30`,
        JSON.stringify({ table: table.map((club_id) => ({ club_id })), champion: table[0] }),
      );
    const relegated = upper.at(-1)!;
    const promoted = lower[0];
    await store.run("UPDATE clubs SET league_id = ? WHERE id = ?", second.id, relegated);
    await store.run("UPDATE clubs SET league_id = ? WHERE id = ?", top.id, promoted);
    try {
      expect(await archiveClubSeasons(store, season)).toBe(upper.length + lower.length);
      const outcome = (clubId: number) =>
        store.get<{ position: number; champion: boolean; promoted: boolean; relegated: boolean; estimated: boolean }>(
          "SELECT position, champion, promoted, relegated, estimated FROM club_season_outcomes WHERE club_id = ? AND season = ?",
          clubId,
          season,
        );
      expect(await outcome(upper[0])).toEqual({ position: 1, champion: true, promoted: false, relegated: false, estimated: false });
      expect(await outcome(relegated)).toMatchObject({ relegated: true, promoted: false });
      expect(await outcome(promoted)).toMatchObject({ promoted: true, champion: true });
    } finally {
      await store.run("UPDATE clubs SET league_id = ? WHERE id = ?", top.id, relegated);
      await store.run("UPDATE clubs SET league_id = ? WHERE id = ?", second.id, promoted);
      await store.run("DELETE FROM club_season_outcomes WHERE season = ?", season);
      await store.run("DELETE FROM history WHERE entity_type = 'league' AND season = ?", season);
    }
  });

  it("lets older checkpoints omit the GBE tables", async () => {
    const expected = await checkpointSchema(store);
    expect(expected.tables.filter((table) => table.optional).map((table) => table.name)).toEqual(expect.arrayContaining([...GBE_TABLES]));
  });

  it("rebuilds the months played before the ledger existed (older worlds and saves)", async () => {
    await advance(store, 28);
    await advance(store, 21);
    const played = async () =>
      new Map(
        (
          await store.all<{ player_id: number; minutes: number; appearances: number }>(
            `SELECT player_id, sum(minutes) AS minutes, sum(appearances) AS appearances FROM ${monthlyLedger("NOT ledger.estimated AND ledger.kind = 'league'")} GROUP BY player_id`,
          )
        ).map((row) => [row.player_id, row]),
      );
    const recorded = await played();
    expect(recorded.size).toBeGreaterThan(100);
    // As if the matches had been played before this code: no simulated ledger rows and no baseline marker.
    await store.exec("DELETE FROM player_minutes_monthly WHERE NOT estimated; DELETE FROM meta WHERE key = 'gbeBaseline'");
    await ensureGbeBaseline(store);
    const rebuilt = await played();
    let same = 0;
    for (const [id, row] of recorded) if (rebuilt.get(id)?.minutes === row.minutes && rebuilt.get(id)?.appearances === row.appearances) same++;
    expect(same / recorded.size).toBeGreaterThan(0.95);
  }, 300_000);

  it("imports an older checkpoint without the GBE tables and rebuilds the ledger on load", async () => {
    const recorded = await count("SELECT count(*) AS n FROM player_minutes_monthly WHERE NOT estimated");
    expect(recorded).toBeGreaterThan(100);
    const saves = new Saves(store);
    const exported = await saves.export();
    try {
      const rows = new Map<string, RestoredValue[][]>();
      const contents = await readCheckpoint(createReadStream(exported.file), {
        onRow(table, values) {
          rows.set(table.name, [...(rows.get(table.name) ?? []), values]);
        },
      });
      const gbe = new Set<string>(GBE_TABLES);
      const legacy = structuredClone(contents.manifest);
      legacy.tables = legacy.tables.filter((table) => !gbe.has(table.name));
      const markers = new Set(["gbeBaseline", "gbeRefresh"]);
      const meta = rows.get("meta")!.filter((row) => !markers.has(row[0] as string));
      legacy.tables.find((table) => table.name === "meta")!.rowCount = meta.length;
      const chunks: Buffer[] = [];
      await writeCheckpoint(
        new Writable({
          write(chunk, _encoding, callback) {
            chunks.push(Buffer.from(chunk));
            callback();
          },
        }),
        legacy,
        (table) => (table.name === "meta" ? meta : (rows.get(table.name) ?? [])),
      );
      await saves.import(Buffer.concat(chunks));
    } finally {
      await rm(exported.file, { force: true });
    }
    expect(await store.meta("gbeBaseline")).toBeTruthy();
    expect(await count("SELECT count(*) AS n FROM player_minutes_monthly WHERE estimated")).toBeGreaterThan(1000);
    // The months already played are rebuilt from the imported fixtures.
    expect(await count("SELECT count(*) AS n FROM player_minutes_monthly WHERE NOT estimated")).toBeGreaterThan(recorded * 0.9);
    await refreshGbe(store);
    expect(await count("SELECT count(*) AS n FROM player_gbe WHERE points > 0")).toBeGreaterThan(500);
  }, 300_000);

  it("migrates a live world to v3 and backfills its pre-game career lazily", async () => {
    await store.exec(
      `${GBE_TABLES.map((table) => `DROP TABLE ${table};`).join(" ")} DELETE FROM schema_migrations WHERE version = 3; DELETE FROM meta WHERE key IN ('gbeBaseline', 'gbeRefresh')`,
    );
    await store.schema();
    expect(await store.get("SELECT version FROM schema_migrations WHERE version = 3")).toBeTruthy();
    expect(await count("SELECT count(*) AS n FROM player_minutes_monthly")).toBe(0);
    // The first refresh (next advance or save load) seeds the estimate, then scores as in a new world.
    await refreshGbe(store);
    expect(await count("SELECT count(*) AS n FROM player_minutes_monthly WHERE estimated")).toBeGreaterThan(1000);
    expect(await count("SELECT count(*) AS n FROM player_gbe WHERE points > 0")).toBeGreaterThan(500);
  }, 120_000);
});
