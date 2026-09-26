import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { compactMatchData, pruneSeason, storedAppearanceStats, storedMatchData } from "./retention.ts";
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

  const leave = (id: number, season: number, age: number, homeBased: boolean) =>
    store.run(
      `UPDATE players SET [role] = N'Retired', [club_id] = NULL, [parent_club_id] = NULL, [squad_club_id] = NULL, [age] = ?,
         [profile] = JSON_MODIFY(JSON_MODIFY([profile], '$.retirement', JSON_QUERY(?)), '$.homeBased', JSON_QUERY(?))
       WHERE [id] = ?`,
      age,
      JSON.stringify({ season, date: `${season}-06-30`, reason: "retired" }),
      homeBased ? JSON.stringify({ countryId: 1 }) : null,
      id,
    );

  const negotiation = async (playerId: number) =>
    (await store.run(
      `INSERT INTO negotiations ([player_id], [buying_club_id], [selling_club_id], [type], [stage], [asking_price], [interest], [created], [deadline])
       VALUES (?, ?, ?, N'Transfer', N'Completed', 1000000, 60, N'2025-07-01', N'2025-08-31')`,
      playerId,
      clubs[0],
      clubs[1],
    )).lastInsertRowid!;

  beforeAll(async () => {
    store = await Store.createTest("retention");
    await generateWorld(store, { nations: ["SCO"], squads: "minimum", seed: "retention-world" });
    clubs = (await store.all<{ id: number }>("SELECT TOP (2) [id] FROM clubs WHERE [type] = N'club' ORDER BY [id]")).map((row) => row.id);
    const players = await store.all<{ id: number; name: string }>(
      `SELECT TOP (7) player.[id], player.[name] FROM players AS player WHERE player.[club_id] IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM loans WHERE loans.[player_id] = player.[id])
         AND NOT EXISTS (SELECT 1 FROM player_assets WHERE player_assets.[player_id] = player.[id])
         AND NOT EXISTS (SELECT 1 FROM negotiations WHERE negotiations.[player_id] = player.[id])
         AND NOT EXISTS (SELECT 1 FROM promises WHERE promises.[player_id] = player.[id])
         AND NOT EXISTS (SELECT 1 FROM minor_applications WHERE minor_applications.[player_id] = player.[id])
       ORDER BY player.[id]`,
    );
    maxId = (await store.get<{ id: number }>("SELECT MAX([id]) AS [id] FROM players"))!.id;
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
      `INSERT INTO transfer_payments ([negotiation_id], [player_id], [payer_id], [payee_id], [amount], [due_date], [paid_date])
       VALUES (?, ?, ?, ?, 500000, N'2025-08-01', N'2025-08-01')`,
      settled, ids.pruned, clubs[0], clubs[1],
    );
    const owed = await negotiation(ids.unpaid);
    await store.run(
      `INSERT INTO transfer_payments ([negotiation_id], [player_id], [payer_id], [payee_id], [amount], [due_date], [paid_date])
       VALUES (?, ?, ?, ?, 500000, N'2027-08-01', NULL)`,
      owed, ids.unpaid, clubs[0], clubs[1],
    );
    await store.run(
      "INSERT INTO sell_on_clauses ([player_id], [beneficiary_id], [owner_id], [percentage], [status]) VALUES (?, ?, ?, 15, N'active')",
      ids.clause, clubs[0], clubs[1],
    );
    for (const [season, appearances, goals] of [[2023, 30, 4], [2024, 28, 6]])
      await store.run(
        `INSERT INTO player_season_stats ([player_id], [season], [club_id], [league_id], [minutes], [appearances], [goals], [assists])
         VALUES (?, ?, ?, 0, ?, ?, ?, 1)`,
        ids.pruned, season, clubs[0], appearances * 80, appearances, goals,
      );
    const totals = await store.get<{ appearances: number; goals: number; clubs: number }>(
      `SELECT SUM([appearances]) AS [appearances], SUM([goals]) AS [goals], COUNT(DISTINCT [club_id]) AS [clubs]
       FROM player_season_stats WHERE [player_id] = ?`,
      ids.pruned,
    );
    expected = { appearances: totals!.appearances, goals: totals!.goals, clubs: totals!.clubs };
    await store.run(
      `INSERT INTO relationships ([club_id], [source_type], [source_id], [target_type], [target_id], [strength], [kind])
       VALUES (?, N'player', ?, N'retention-probe', 0, 40, N'Professional')`,
      clubs[0], ids.pruned,
    );
    await store.run(
      "INSERT INTO history ([season], [entity_type], [entity_id], [date], [data]) VALUES (2024, N'appearance', ?, N'2024-09-01', N'{}')",
      ids.pruned,
    );
  });

  afterAll(async () => {
    await store?.close();
  });

  it("prunes old leavers with a career summary, keeps protected players and leaves no orphans", async () => {
    const result = await pruneSeason(store, 2026, "2027-06-30");
    expect(result.players).toBeGreaterThanOrEqual(2);
    const remaining = new Set((await store.all<{ id: number }>(
      "SELECT [id] FROM players WHERE [id] IN (SELECT [value] FROM OPENJSON(?))",
      JSON.stringify([...Object.values(ids), maxId]),
    )).map((row) => row.id));
    expect(remaining.has(ids.pruned)).toBe(false);
    expect(remaining.has(ids.homeOld)).toBe(false);
    for (const kept of ["unpaid", "clause", "homeYoung", "fresh"]) expect(remaining.has(ids[kept]), kept).toBe(true);
    expect(remaining.has(maxId)).toBe(true);
    expect((await store.get<{ id: number }>("SELECT MAX([id]) AS [id] FROM players"))?.id).toBe(maxId);

    const summaries = await store.all<{ entity_id: number; season: number; data: string }>(
      "SELECT [entity_id], [season], [data] FROM history WHERE [entity_type] = N'careerSummary' ORDER BY [entity_id]",
    );
    const summary = summaries.find((row) => row.entity_id === ids.pruned);
    expect(summary?.season).toBe(2026);
    expect(JSON.parse(summary!.data)).toMatchObject({
      name: names[ids.pruned], appearances: expected.appearances, goals: expected.goals, lastSeason: 2025,
    });
    expect(JSON.parse(summary!.data).clubs).toHaveLength(Math.min(12, expected.clubs));
    expect(summaries.some((row) => row.entity_id === ids.homeOld)).toBe(true);

    const pruned = JSON.stringify([ids.pruned, ids.homeOld]);
    for (const table of ["reports", "assignments", "discipline", "player_assets", "registration_records", "minor_applications",
      "player_season_stats", "player_match_appearances", "promises", "negotiations", "loans", "sell_on_clauses",
      "transfer_payments", "buy_back_clauses"]) {
      const row = await store.get<{ total: number }>(
        `SELECT COUNT(*) AS [total] FROM ${table} WHERE [player_id] IN (SELECT [value] FROM OPENJSON(?))`,
        pruned,
      );
      expect(row?.total, table).toBe(0);
    }
    expect((await store.get<{ total: number }>(
      `SELECT COUNT(*) AS [total] FROM relationships WHERE ([source_type] = N'player' AND [source_id] IN (SELECT [value] FROM OPENJSON(?)))
         OR ([target_type] = N'player' AND [target_id] IN (SELECT [value] FROM OPENJSON(?)))`,
      pruned, pruned,
    ))?.total).toBe(0);
    expect((await store.get<{ total: number }>(
      "SELECT COUNT(*) AS [total] FROM history WHERE [entity_type] = N'appearance' AND [entity_id] IN (SELECT [value] FROM OPENJSON(?))",
      pruned,
    ))?.total).toBe(0);
    expect(await store.all(
      "SELECT [name] FROM sys.foreign_keys WHERE [schema_id] = SCHEMA_ID(?) AND ([is_not_trusted] = 1 OR [is_disabled] = 1)",
      store.schemaName,
    )).toEqual([]);

    expect((await store.get<{ total: number }>(
      "SELECT COUNT(*) AS [total] FROM transfer_payments WHERE [player_id] = ? AND [paid_date] IS NULL", ids.unpaid,
    ))?.total).toBe(1);
    expect((await store.get<{ total: number }>(
      "SELECT COUNT(*) AS [total] FROM sell_on_clauses WHERE [player_id] = ? AND [status] = N'active'", ids.clause,
    ))?.total).toBe(1);
    expect(await store.meta<{ season: number }>("lastRetention")).toMatchObject({ season: 2026, players: result.players });
  });

  it("prunes a leaver once outstanding obligations are settled, and never reuses the highest id", async () => {
    await store.run("UPDATE transfer_payments SET [paid_date] = N'2027-08-01' WHERE [player_id] = ?", ids.unpaid);
    await store.run("UPDATE sell_on_clauses SET [status] = N'expired' WHERE [player_id] = ?", ids.clause);
    await pruneSeason(store, 2027, "2028-06-30");
    const left = (await store.all<{ id: number }>(
      "SELECT [id] FROM players WHERE [id] IN (SELECT [value] FROM OPENJSON(?))",
      JSON.stringify([ids.unpaid, ids.clause, ids.fresh, ids.homeYoung, maxId]),
    )).map((row) => row.id).sort((first, second) => first - second);
    expect(left).toEqual([ids.homeYoung, maxId].sort((first, second) => first - second));
    expect((await store.get<{ id: number }>("SELECT MAX([id]) AS [id] FROM players"))?.id).toBe(maxId);
  });
});
