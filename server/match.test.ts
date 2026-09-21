import { describe, expect, it } from "vitest";
import { expectedPoints, simulateMatch } from "./match.ts";
import { calibrationSample } from "./check-simulation.ts";
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

describe("version-three match laws", () => {
  const fullTeam = (id: number) => ({
    ...team(id),
    bench: positions
      .slice(0, 9)
      .map((position, index) => ({
        id: id * 100 + 20 + index,
        name: `Substitute ${id}-${index}`,
        position,
        ability: 74,
        fitness: 99,
        confidence: 70,
      })),
  });
  const modern: MatchSnapshot = {
    ...snapshot,
    rulesVersion: 3,
    home: fullTeam(1),
    away: fullTeam(2),
  };
  it("uses five substitutions in at most three windows and records actual minutes", () => {
    const result = simulateMatch(modern, "match-laws");
    expect(result.duration).toBeGreaterThan(90);
    for (const side of [modern.home, modern.away]) {
      const changes = result.substitutions!.filter(
        (sub) => sub.teamId === side.id,
      );
      expect(changes.length).toBeLessThanOrEqual(5);
      expect(changes.length).toBeGreaterThan(0);
      expect(
        new Set(
          changes.filter((sub) => sub.window > 0).map((sub) => sub.window),
        ).size,
      ).toBeLessThanOrEqual(3);
      for (const sub of changes) {
        expect(result.players[sub.onId].minutes).toBeGreaterThan(0);
        expect(
          result.actions.filter(
            (action) =>
              action.playerId === sub.offId &&
              action.type !== "substitution" &&
              action.elapsed! >= sub.elapsed,
          ),
        ).toHaveLength(0);
        expect(
          result.actions.filter(
            (action) =>
              action.playerId === sub.onId && action.elapsed! < sub.elapsed,
          ),
        ).toHaveLength(0);
      }
    }
    expect(simulateMatch(modern, "match-laws", false).stats).toEqual(
      result.stats,
    );
    expect(simulateMatch(modern, "match-laws")).toEqual(result);
  });
  it("does not play a team with fewer than seven eligible players", () => {
    const result = simulateMatch(
      {
        ...modern,
        home: { ...modern.home, lineup: modern.home.lineup.slice(0, 6) },
      },
      "short-squad",
    );
    expect(result.abandoned?.teamId).toBe(modern.home.id);
    expect(result.actions).toHaveLength(0);
    expect(result.duration).toBe(0);
  });
  it("plays extra time before a shootout and keeps shootout goals out of match statistics", () => {
    let shootouts = 0;
    for (let index = 0; index < 45; index++) {
      const rules: NonNullable<MatchSnapshot["rules"]> = {
        decisive: true,
        extraTime: true,
        neutral: true,
        awayGoals: false,
        substitutions: 5,
        substitutionWindows: 3,
        extraSubstitution: true,
        aggregate: { home: 0, away: 0, homeAwayGoals: 0, awayAwayGoals: 0 },
        injuryFrequency: 0,
      };
      const result = simulateMatch({ ...modern, rules }, `knockout-${index}`);
      if (!result.shootout) continue;
      shootouts++;
      expect(result.wentToExtraTime).toBe(true);
      expect(result.duration).toBeGreaterThanOrEqual(120);
      expect(result.shootout.home).not.toBe(result.shootout.away);
      expect(
        result.actions.filter(
          (action) => action.type === "shot" && action.outcome === "goal",
        ).length,
      ).toBe(result.homeGoals + result.awayGoals);
      expect(result.winnerId).toBeTruthy();
    }
    expect(shootouts).toBeGreaterThan(0);
  });
  it("removes sent-off players and gives them no later actions", () => {
    let dismissals = 0;
    for (let index = 0; index < 45; index++) {
      const result = simulateMatch(modern, `discipline-${index}`);
      for (const card of result.events.filter(
        (event) => event.type === "red card",
      )) {
        dismissals++;
        expect(
          result.actions.filter(
            (action) =>
              action.playerId === card.playerId &&
              action.elapsed! > card.elapsed!,
          ),
        ).toHaveLength(0);
        expect(result.players[card.playerId].redCards).toBe(1);
      }
    }
    expect(dismissals).toBeGreaterThan(0);
  });
});

it("keeps goals, results and discipline inside reproducible statistical envelopes", () => {
  expect(calibrationSample(600).matches).toBe(600);
}, 30000);
