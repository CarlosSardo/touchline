import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import {
  compactMatchData,
  databaseFootprint,
  databaseSpace,
  pruneAppearances,
  pruneSeason,
  storedAppearanceStats,
  storedMatchData,
} from "./retention.ts";
import { generateWorld } from "./world.ts";

describe("match data compaction (no database)", () => {
  it("keeps the result and a scorers summary and drops replay detail", () => {
    const payload = {
      homeGoals: 2,
      awayGoals: 1,
      xg: { home: 1.4, away: 0.8 },
      snapshot: { home: { lineup: [{ id: 7, name: "A. Scorer" }], bench: [] }, away: { lineup: [], bench: [] } },
      events: [{ minute: 12, type: "goal", teamId: 1, playerId: 7 }, { minute: 30, type: "yellow card", teamId: 2, playerId: 9 }],
      players: { 7: { rating: 8 } },
      momentum: [1, 2, 3],
    };
    const compact = compactMatchData(payload);
    expect(compact).toMatchObject({ homeGoals: 2, awayGoals: 1, xg: { home: 1.4, away: 0.8 }, compact: true });
    expect(compact.scorers).toEqual([{ minute: 12, teamId: 1, playerId: 7, name: "A. Scorer" }]);
    for (const key of ["snapshot", "events", "players", "momentum"]) expect(compact).not.toHaveProperty(key);
    expect(compactMatchData(compact)).toBe(compact);
    expect(JSON.parse(storedMatchData(payload, true))).toEqual(payload);
    expect(storedAppearanceStats({ passes: 40 }, false)).toBe("{}");
    expect(storedAppearanceStats({ passes: 40 }, true)).toBe('{"passes":40}');
  });
});

describe("season retention (SQL)", () => {
  let store: Store;
  const ids: Record<string, number> = {};
  let maxId = 0;
  let clubs: number[] = [];
  let names: Record<number, string> = {};
  let expected = { appearances: 0, goals: 0, clubs: 0 };
  const fixtures: Record<string, number> = {};
  let unmarked = 0;

  const leave = async (id: number, season: number, age: number, homeBased: boolean) => {
    const { profile } = (await store.get<{ profile: string }>("SELECT profile FROM players WHERE id = ?", id))!;
    const { homeBased: _previous, ...rest } = JSON.parse(profile) as Record<string, unknown>;
    await store.run(
      `UPDATE players SET role = 'Retired', club_id = NULL, parent_club_id = NULL, squad_club_id = NULL, age = ?, profile = ?
       WHERE id = ?`,
      age,
      JSON.stringify({
        ...rest,
        retirement: { season, date: `${season}-06-30`, reason: "retired" },
        ...(homeBased ? { homeBased: { countryId: 1 } } : {}),
      }),
      id,
    );
  };

  const negotiation = async (playerId: number) =>
    (await store.run(
      `INSERT INTO negotiations (player_id, buying_club_id, selling_club_id, type, stage, asking_price, interest, created, deadline)
       VALUES (?, ?, ?, 'Transfer', 'Completed', 1000000, 60, '2025-07-01', '2025-08-31')`,
      playerId,
      clubs[0],
      clubs[1],
    )).lastInsertRowid!;

  beforeAll(async () => {
    store = await Store.createTest("retention");
    await generateWorld(store, { nations: ["SCO"], squads: "minimum", seed: "retention-world" });
    clubs = (await store.all<{ id: number }>("SELECT id FROM clubs WHERE type = 'club' ORDER BY id LIMIT 2")).map((row) => row.id);
    const players = await store.all<{ id: number; name: string }>(
      `SELECT player.id, player.name FROM players AS player WHERE player.club_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM loans WHERE loans.player_id = player.id)
         AND NOT EXISTS (SELECT 1 FROM player_assets WHERE player_assets.player_id = player.id)
         AND NOT EXISTS (SELECT 1 FROM negotiations WHERE negotiations.player_id = player.id)
         AND NOT EXISTS (SELECT 1 FROM promises WHERE promises.player_id = player.id)
         AND NOT EXISTS (SELECT 1 FROM minor_applications WHERE minor_applications.player_id = player.id)
       ORDER BY player.id LIMIT 7`,
    );
    maxId = (await store.get<{ id: number }>("SELECT MAX(id) AS id FROM players"))!.id;
    names = Object.fromEntries(players.map((player) => [player.id, player.name]));
    ["pruned", "unpaid", "clause", "homeYoung", "homeOld", "fresh"].forEach((key, index) => (ids[key] = players[index].id));
    await leave(ids.pruned, 2025, 34, false);
    await leave(ids.unpaid, 2025, 34, false);
    await leave(ids.clause, 2025, 34, false);
    await leave(ids.homeYoung, 2025, 35, true);
    await leave(ids.homeOld, 2025, 36, true);
    await leave(ids.fresh, 2026, 34, false);
    await leave(maxId, 2025, 34, false);
    const settled = await negotiation(ids.pruned);
    await store.run(
      `INSERT INTO transfer_payments (negotiation_id, player_id, payer_id, payee_id, amount, due_date, paid_date)
       VALUES (?, ?, ?, ?, 500000, '2025-08-01', '2025-08-01')`,
      settled, ids.pruned, clubs[0], clubs[1],
    );
    const owed = await negotiation(ids.unpaid);
    await store.run(
      `INSERT INTO transfer_payments (negotiation_id, player_id, payer_id, payee_id, amount, due_date, paid_date)
       VALUES (?, ?, ?, ?, 500000, '2027-08-01', NULL)`,
      owed, ids.unpaid, clubs[0], clubs[1],
    );
    await store.run(
      "INSERT INTO sell_on_clauses (player_id, beneficiary_id, owner_id, percentage, status) VALUES (?, ?, ?, 15, 'active')",
      ids.clause, clubs[0], clubs[1],
    );
    for (const [season, appearances, goals] of [[2023, 30, 4], [2024, 28, 6]])
      await store.run(
        `INSERT INTO player_season_stats (player_id, season, club_id, league_id, minutes, appearances, goals, assists)
         VALUES (?, ?, ?, 0, ?, ?, ?, 1)`,
        ids.pruned, season, clubs[0], appearances * 80, appearances, goals,
      );
    const totals = await store.get<{ appearances: number; goals: number; clubs: number }>(
      `SELECT SUM(appearances) AS appearances, SUM(goals) AS goals, COUNT(DISTINCT club_id) AS clubs
       FROM player_season_stats WHERE player_id = ?`,
      ids.pruned,
    );
    expected = { appearances: totals!.appearances, goals: totals!.goals, clubs: totals!.clubs };
    await store.run(
      `INSERT INTO relationships (club_id, source_type, source_id, target_type, target_id, strength, kind)
       VALUES (?, 'player', ?, 'retention-probe', 0, 40, 'Professional')`,
      clubs[0], ids.pruned,
    );
    await store.run(
      "INSERT INTO history (season, entity_type, entity_id, date, data) VALUES (2024, 'appearance', ?, '2024-09-01', '{}')",
      ids.pruned,
    );
    const { clubId } = await store.meta<{ clubId: number }>("state");
    const others = (await store.all<{ id: number }>(
      "SELECT id FROM clubs WHERE type = 'club' AND id <> ? AND (parent_id IS NULL OR parent_id <> ?) ORDER BY id LIMIT 2",
      clubId, clubId,
    )).map((row) => row.id);
    const detailed = JSON.stringify({
      homeGoals: 1, awayGoals: 0, padding: "x".repeat(9000),
      snapshot: { home: { lineup: [{ id: ids.homeYoung, name: "Scorer" }], bench: [] }, away: { lineup: [], bench: [] } },
      events: [{ minute: 5, type: "goal", teamId: others[0], playerId: ids.homeYoung }],
    });
    for (const [key, home, away] of [["others", others[0], others[1]], ["user", clubId, others[1]]] as const)
      fixtures[key] = (await store.run(
        `INSERT INTO fixtures (date, season, home_id, away_id, stage, round, status, seed, data)
         VALUES ('2026-09-01', 2026, ?, ?, 'League', 1, 'played', 'retention', ?)`,
        home, away, detailed,
      )).lastInsertRowid!;
    unmarked = players[6].id;
    await store.run(
      "UPDATE players SET role = 'Retired', club_id = NULL, parent_club_id = NULL, squad_club_id = NULL WHERE id = ?",
      unmarked,
    );
  });

  afterAll(async () => {
    await store?.close();
  });

  it("prunes old leavers with a career summary, keeps protected players and leaves no orphans", async () => {
    const result = await pruneSeason(store, 2026, "2027-06-30");
    expect(result.players).toBeGreaterThanOrEqual(2);
    const remaining = new Set((await store.all<{ id: number }>(
      "SELECT id FROM players WHERE id = ANY(?::int[])",
      [...Object.values(ids), maxId],
    )).map((row) => row.id));
    expect(remaining.has(ids.pruned)).toBe(false);
    expect(remaining.has(ids.homeOld)).toBe(false);
    for (const kept of ["unpaid", "clause", "homeYoung", "fresh"]) expect(remaining.has(ids[kept]), kept).toBe(true);
    expect(remaining.has(maxId)).toBe(true);
    expect((await store.get<{ id: number }>("SELECT MAX(id) AS id FROM players"))?.id).toBe(maxId);

    const summaries = await store.all<{ entity_id: number; season: number; data: string }>(
      "SELECT entity_id, season, data FROM history WHERE entity_type = 'careerSummary' ORDER BY entity_id",
    );
    const summary = summaries.find((row) => row.entity_id === ids.pruned);
    expect(summary?.season).toBe(2026);
    const parsed = JSON.parse(summary!.data) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      name: names[ids.pruned], appearances: expected.appearances, goals: expected.goals, lastSeason: 2025, reason: "retired",
    });
    expect(parsed.clubs).toHaveLength(Math.min(12, expected.clubs));
    expect(parsed.clubs).toEqual([expect.objectContaining({ clubId: clubs[0], from: 2023, to: 2024, appearances: 58, goals: 10 })]);
    const homeOld = JSON.parse(summaries.find((row) => row.entity_id === ids.homeOld)!.data) as Record<string, unknown>;
    // Like FOR JSON PATH before it, the summary omits what a player without season stats does not have.
    expect(homeOld).not.toHaveProperty("clubs");
    expect(homeOld).not.toHaveProperty("appearances");

    const pruned = [ids.pruned, ids.homeOld];
    for (const table of ["reports", "assignments", "discipline", "player_assets", "registration_records", "minor_applications",
      "player_season_stats", "player_match_appearances", "promises", "negotiations", "loans", "sell_on_clauses",
      "transfer_payments", "buy_back_clauses"]) {
      const row = await store.get<{ total: number }>(
        `SELECT COUNT(*) AS total FROM ${table} WHERE player_id = ANY(?::int[])`,
        pruned,
      );
      expect(row?.total, table).toBe(0);
    }
    expect((await store.get<{ total: number }>(
      `SELECT COUNT(*) AS total FROM relationships WHERE (source_type = 'player' AND source_id = ANY(?::int[]))
         OR (target_type = 'player' AND target_id = ANY(?::int[]))`,
      pruned, pruned,
    ))?.total).toBe(0);
    expect((await store.get<{ total: number }>(
      "SELECT COUNT(*) AS total FROM history WHERE entity_type = 'appearance' AND entity_id = ANY(?::int[])",
      pruned,
    ))?.total).toBe(0);
    expect(await store.all(
      `SELECT conname FROM pg_catalog.pg_constraint
       WHERE connamespace = to_regnamespace(?) AND contype = 'f' AND NOT convalidated`,
      store.schemaName,
    )).toEqual([]);

    expect((await store.get<{ total: number }>(
      "SELECT COUNT(*) AS total FROM transfer_payments WHERE player_id = ? AND paid_date IS NULL", ids.unpaid,
    ))?.total).toBe(1);
    expect((await store.get<{ total: number }>(
      "SELECT COUNT(*) AS total FROM sell_on_clauses WHERE player_id = ? AND status = 'active'", ids.clause,
    ))?.total).toBe(1);
    expect(await store.meta<{ season: number }>("lastRetention")).toMatchObject({ season: 2026, players: result.players });

    expect(result.fixtures).toBe(1);
    const stored = Object.fromEntries((await store.all<{ id: number; data: string }>(
      "SELECT id, data FROM fixtures WHERE id = ANY(?::int[])", Object.values(fixtures),
    )).map((row) => [row.id, JSON.parse(row.data) as Record<string, unknown>]));
    expect(stored[fixtures.others]).toMatchObject({ compact: true, homeGoals: 1, scorers: [{ minute: 5, playerId: ids.homeYoung }] });
    expect(stored[fixtures.others]).not.toHaveProperty("snapshot");
    expect(stored[fixtures.user]).toHaveProperty("snapshot");
    const stamped = await store.get<{ profile: string }>("SELECT profile FROM players WHERE id = ?", unmarked);
    expect(JSON.parse(stamped!.profile).retirement).toEqual({ season: 2026, date: "2027-06-30", reason: "retired" });
  });

  it("prunes a leaver once outstanding obligations are settled, and never reuses the highest id", async () => {
    await store.run("UPDATE transfer_payments SET paid_date = '2027-08-01' WHERE player_id = ?", ids.unpaid);
    await store.run("UPDATE sell_on_clauses SET status = 'expired' WHERE player_id = ?", ids.clause);
    await pruneSeason(store, 2027, "2028-06-30");
    const left = (await store.all<{ id: number }>(
      "SELECT id FROM players WHERE id = ANY(?::int[])",
      [ids.unpaid, ids.clause, ids.fresh, ids.homeYoung, maxId],
    )).map((row) => row.id).sort((first, second) => first - second);
    expect(left).toEqual([ids.homeYoung, maxId].sort((first, second) => first - second));
    expect((await store.get<{ id: number }>("SELECT MAX(id) AS id FROM players"))?.id).toBe(maxId);
  });

  it.each(["auto", "rebuild", "delete"] as const)(
    "keeps only the user's and later seasons' appearances (%s)",
    async (strategy) => {
      const { clubId } = await store.meta<{ clubId: number }>("state");
      const other = (await store.get<{ id: number }>(
        "SELECT id FROM clubs WHERE type = 'club' AND id <> ? AND (parent_id IS NULL OR parent_id <> ?) ORDER BY id LIMIT 1",
        clubId, clubId,
      ))!.id;
      const squad = async (club: number) => (await store.all<{ id: number }>(
        "SELECT id FROM players WHERE club_id = ? ORDER BY id LIMIT 3", club,
      )).map((row) => row.id);
      const [mine, theirs] = [await squad(clubId), await squad(other)];
      const fixture = async (season: number) => (await store.run(
        `INSERT INTO fixtures (date, season, home_id, away_id, stage, round, status, seed)
         VALUES (?, ?, ?, ?, 'League', 1, 'played', 'retention')`,
        `${season}-09-01`, season, clubId, other,
      )).lastInsertRowid!;
      const finished = await fixture(2027);
      const later = await fixture(2028);
      await store.exec("DELETE FROM player_match_appearances");
      const appearance = (fixtureId: number, playerId: number, club: number, season: number) => ({
        fixture_id: fixtureId, player_id: playerId, club_id: club, season, date: `${season}-09-01`, position: "CM",
        started: 1, minutes: 90, minute_on: 0, minute_off: null, rating: 7.1, goals: 0, assists: 0, stats: "{}",
      });
      await store.bulkInsert("player_match_appearances", [
        ...mine.map((id) => appearance(finished, id, clubId, 2027)),
        ...theirs.map((id) => appearance(finished, id, other, 2027)),
        ...theirs.map((id) => appearance(later, id, other, 2028)),
      ]);
      const removed = await store.transaction(() => pruneAppearances(store, 2027, [clubId], strategy));
      expect(removed).toBe(theirs.length);
      const kept = await store.all<{ fixture_id: number; player_id: number; rating: number }>(
        "SELECT fixture_id, player_id, rating FROM player_match_appearances ORDER BY fixture_id, player_id",
      );
      expect(kept).toEqual([
        ...mine.map((id) => ({ fixture_id: finished, player_id: id, rating: 7.1 })),
        ...theirs.map((id) => ({ fixture_id: later, player_id: id, rating: 7.1 })),
      ]);
      expect(await store.transaction(() => pruneAppearances(store, 2027, [clubId], strategy))).toBe(0);
    },
  );

  it("reports the world's on-disk footprint from the PostgreSQL catalog", async () => {
    const [footprint] = await databaseFootprint(store);
    expect(footprint.schema).toBe(store.schemaName);
    expect(footprint.tables.map((table) => table.table)).toEqual(expect.arrayContaining(["players", "save_chunks"]));
    expect(footprint.worldMB).toBeGreaterThan(0);
    expect(footprint.usedMB).toBeLessThanOrEqual(footprint.reservedMB);
    expect(footprint.tables.find((table) => table.table === "players")!.reservedMB).toBeGreaterThan(0);
    expect((await databaseSpace(store)).dataMB).toBeGreaterThan(0);
  });
});
