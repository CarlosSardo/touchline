import { describe, expect, it } from "vitest";
import { squadCheckpoints, squadShortfalls, type SquadCount } from "./check-simulation.ts";

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
