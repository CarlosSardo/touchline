import { describe, expect, it, vi } from "vitest";
import {
  FULL_WORLD_FIXTURES,
  MIN_SEASON_BUDGET_MB,
  PLAYER_ROW_BUDGET_BYTES,
  reportFootprint,
  seasonBudgetMB,
  squadCheckpoints,
  squadShortfalls,
  type SquadCount,
} from "./check-simulation.ts";
import { Store } from "./db.ts";
import { FOOTPRINT_BUDGET } from "./retention.ts";
import { generateWorld } from "./world.ts";

const squad = (id: number, type: string, group: SquadCount["squad"], players: number, keepers = 2): SquadCount => ({
  id,
  name: `Club ${id}`,
  type,
  squad: group,
  players,
  keepers,
});

describe("in-season squad check", () => {
  it("dates the quarterly checkpoints inside the season", () => {
    expect(squadCheckpoints(2026)).toEqual(["2026-10-01", "2027-01-01", "2027-04-01"]);
  });

  it("holds first teams to 25, B-teams and youth squads to 20, with two goalkeepers", () => {
    const report = squadShortfalls(
      [
        squad(1, "club", "Senior", 25),
        squad(2, "club", "Senior", 24, 3),
        squad(3, "bteam", "Senior", 20),
        squad(4, "club", "U19", 22, 1),
        squad(5, "club", "U17", 20),
        squad(6, "club", "U17", 17, 0),
      ],
      "2026-10-07",
    );
    expect(report).toMatchObject({ squads: 6, short: 3, allowed: 0, ok: false, bySquad: { "first team": 1, U19: 1, U17: 1 } });
    expect(report.worst).toEqual([
      "Club 6 (6) U17 17/20 players, 0 GK",
      "Club 2 (2) first team 24/25 players, 3 GK",
      "Club 4 (4) U19 22/20 players, 1 GK",
    ]);
    expect(report.smallest).toEqual({
      "first team": { players: 24, keepers: 2 },
      "B-team": { players: 20, keepers: 2 },
      U19: { players: 22, keepers: 1 },
      U17: { players: 17, keepers: 0 },
    });
  });

  it("tolerates shortfalls in up to 0.5% of squads", () => {
    const rows = Array.from({ length: 400 }, (_, index) => squad(index + 1, "club", "U19", index < 2 ? 19 : 20));
    expect(squadShortfalls(rows, "2027-01-06")).toMatchObject({ short: 2, allowed: 2, ok: true });
    rows[2] = squad(3, "club", "U19", 20, 1);
    expect(squadShortfalls(rows, "2027-01-06")).toMatchObject({ short: 3, ok: false });
  });
});

describe("season footprint budget", () => {
  it("scales decision 11's full-world season budget by fixtures played, with a floor", () => {
    expect(seasonBudgetMB(FULL_WORLD_FIXTURES)).toBe(FOOTPRINT_BUDGET.seasonMB);
    expect(seasonBudgetMB(FULL_WORLD_FIXTURES * 2)).toBe(FOOTPRINT_BUDGET.seasonMB);
    expect(seasonBudgetMB(FULL_WORLD_FIXTURES / 2)).toBe(FOOTPRINT_BUDGET.seasonMB / 2);
    expect(seasonBudgetMB(0)).toBe(MIN_SEASON_BUDGET_MB);
  });

  it.skipIf(process.env.SQL_INTEGRATION_TESTS !== "true")(
    "fails a season whose other tables outgrew the budget, or whose players table bloated past its per-row budget",
    async () => {
      const store = await Store.createTest("footprint");
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        await store.schema();
        await generateWorld(store, { nations: ["FO"], squads: "minimum", seed: "footprint" });
        const start = await reportFootprint(store, "start");
        expect(start.playerBytesPerRow).toBeGreaterThan(0);
        expect(start.playerBytesPerRow).toBeLessThan(PLAYER_ROW_BUDGET_BYTES);
        expect(await reportFootprint(store, "steady", start.accumulatedMB, 1000)).toMatchObject({
          seasonMB: 0,
          over: false,
          budgetMB: MIN_SEASON_BUDGET_MB,
        });
        const grown = await reportFootprint(store, "grown", start.accumulatedMB - MIN_SEASON_BUDGET_MB - 1, 1000);
        expect(grown).toMatchObject({ over: true, budgetMB: MIN_SEASON_BUDGET_MB });
        // On GitHub Actions an ::error annotation follows the plain line, so search every logged line.
        const logged = () => log.mock.calls.map((call) => String(call[0]));
        expect(logged()).toContainEqual(
          expect.stringMatching(/other tables \+\d+(\.\d)? MB this season \(budget 32 MB for 1000 fixtures\) OVER BUDGET/),
        );
        // Issue 1: whole-squad rewrites of an indexed column inside one transaction leave every old version behind.
        await store.transaction(async () => {
          for (let round = 0; round < 30; round++) await store.run("UPDATE players SET ability = ability + 0");
        });
        const bloated = await reportFootprint(store, "bloated", start.accumulatedMB, 1000);
        expect(bloated.playerBytesPerRow).toBeGreaterThan(PLAYER_ROW_BUDGET_BYTES);
        expect(bloated).toMatchObject({ seasonMB: 0, over: true });
        expect(logged()).toContainEqual(
          expect.stringContaining(`bytes per row (budget ${PLAYER_ROW_BUDGET_BYTES}) OVER BUDGET`),
        );
      } finally {
        log.mockRestore();
        await store.close();
      }
    },
    120_000,
  );
});
