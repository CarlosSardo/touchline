import { describe, expect, it } from "vitest";
import { expectedPoints, simulateMatch } from "./match.ts";
import type { MatchSnapshot, Position } from "../shared/types.ts";

const positions: Position[] = [
  "GK",
  "RB",
  "CB",
  "CB",
  "LB",
  "DM",
  "CM",
  "CM",
  "LW",
  "ST",
  "RW",
];
const team = (id: number) => ({
  id,
  name: `Club ${id}`,
  color: "#087f6d",
  ability: 75,
  style: "High press",
  formation: "4-3-3",
  chemistry: 70,
  momentum: 0,
  pressure: 30,
  lineup: positions.map((position, index) => ({
    id: id * 100 + index,
    name: `Player ${id}-${index}`,
    position,
    ability: 75,
    fitness: 95,
    confidence: 70,
  })),
  setPieces: { routine: "Near post", target: "Centre-back", risk: 55 },
});
const snapshot: MatchSnapshot = {
  home: team(1),
  away: team(2),
  weather: "Clear",
  importance: 65,
  detail: "full",
};

describe("deterministic event-level match engine", () => {
  it("replays identical results and event streams from a stored snapshot", () => {
    expect(simulateMatch(snapshot, "test-2026")).toEqual(
      simulateMatch(snapshot, "test-2026"),
    );
  });
  it("preserves the same outcome and statistics without retaining event objects", () => {
    const full = simulateMatch(snapshot, "streaming");
    const compact = simulateMatch(snapshot, "streaming", false);
    expect(compact.actions).toHaveLength(0);
    expect(compact.stats).toEqual(full.stats);
    expect(compact.homeGoals).toBe(full.homeGoals);
  });
  it("derives goals, shots and passing from events with valid coordinates and timestamps", () => {
    const result = simulateMatch(snapshot, "events");
    expect(result.actions.length).toBeGreaterThan(500);
    for (const side of [snapshot.home, snapshot.away]) {
      const events = result.actions.filter(
        (action) => action.teamId === side.id,
      );
      expect(
        events.filter(
          (action) => action.type === "shot" && action.outcome === "goal",
        ).length,
      ).toBe(result.stats[side.id].goals);
      expect(events.filter((action) => action.type === "pass").length).toBe(
        result.stats[side.id].passes,
      );
      expect(events.filter((action) => action.type === "shot").length).toBe(
        result.stats[side.id].shots,
      );
      expect(
        events.reduce(
          (total, action) =>
            total + (action.type === "shot" ? (action.xg ?? 0) : 0),
          0,
        ),
      ).toBeCloseTo(result.stats[side.id].xG, 1);
    }
    for (const event of result.actions) {
      expect(event.x).toBeGreaterThanOrEqual(0);
      expect(event.x).toBeLessThanOrEqual(100);
      expect(event.y).toBeGreaterThanOrEqual(0);
      expect(event.y).toBeLessThanOrEqual(100);
      expect(event.minute).toBeGreaterThan(0);
      expect(event.minute).toBeLessThanOrEqual(90);
      expect(event.difficulty).toBeGreaterThanOrEqual(1);
      expect(event.difficulty).toBeLessThanOrEqual(99);
    }
    expect(result.stats[1].possession + result.stats[2].possession).toBe(100);
  });
  it("calculates symmetric Poisson expected points for equal xG", () => {
    const [home, away] = expectedPoints(1.4, 1.4);
    expect(home).toBe(away);
    expect(home + away).toBeGreaterThan(2);
    expect(home + away).toBeLessThan(3);
  });

  it("uses traits and trained attributes in versioned match behavior", () => {
    const baseline: MatchSnapshot = { ...snapshot, rulesVersion: 2 };
    const dribblers: MatchSnapshot = {
      ...baseline,
      home: {
        ...baseline.home,
        lineup: baseline.home.lineup.map((player) => ({
          ...player,
          traits: ["Dribbles often", "Cuts inside"],
          pressureHandling: 90,
          attributes: { passing: 90, finishing: 88 },
        })),
      },
    };
    let baselineDribbles = 0;
    let enhancedDribbles = 0;
    for (let index = 0; index < 12; index++) {
      baselineDribbles += simulateMatch(baseline, `traits-${index}`).stats[1]
        .dribbles;
      enhancedDribbles += simulateMatch(dribblers, `traits-${index}`).stats[1]
        .dribbles;
    }
    expect(enhancedDribbles).toBeGreaterThan(baselineDribbles * 1.5);
    expect(simulateMatch(dribblers, "replay-v2")).toEqual(
      simulateMatch(dribblers, "replay-v2"),
    );
  });

  it("preserves legacy snapshot replay and counts version-two events consistently", () => {
    expect(simulateMatch({ ...snapshot, rulesVersion: 1 }, "legacy")).toEqual(
      simulateMatch(snapshot, "legacy"),
    );
    const result = simulateMatch({ ...snapshot, rulesVersion: 2 }, "version-2");
    expect(
      result.actions.filter(
        (action) => action.type === "shot" && action.outcome === "goal",
      ).length,
    ).toBe(result.homeGoals + result.awayGoals);
    expect(
      result.stats[1].completedPasses / result.stats[1].passes,
    ).toBeGreaterThan(0.65);
  });
});
