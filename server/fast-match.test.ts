import seedrandom from "seedrandom";
import { describe, expect, it } from "vitest";
import { simulateMatchV3 } from "./match-v3.ts";
import {
  fastExpectedGoals,
  followsFixture,
  simulateFastMatch,
  simulateFixture,
} from "./fast-match.ts";
import type {
  MatchPlayer,
  MatchResult,
  MatchSnapshot,
  MatchTeam,
  Position,
} from "../shared/types.ts";

const POSITIONS: Position[] = ["GK", "RB", "CB", "CB", "LB", "DM", "CM", "CM", "RW", "ST", "LW"];
const BENCH: Position[] = ["GK", "CB", "RB", "CM", "AM", "LW", "ST"];
const KEYS = ["finishing", "passing", "positioning", "reflexes", "penalties", "heading", "stamina", "dribbling", "tackling"];

function syntheticTeam(id: number, ability: number, seed: string): MatchTeam {
  const random = seedrandom(seed);
  const noise = (spread: number) => (random() + random() + random() - 1.5) * spread;
  const player = (index: number, position: Position): MatchPlayer => {
    const level = Math.round(ability + noise(6));
    return {
      id: id * 100 + index,
      name: `P${id}-${index}`,
      position,
      ability: level,
      fitness: Math.round(88 + random() * 11),
      confidence: Math.round(65 + noise(10)),
      discipline: Math.round(60 + noise(20)),
      pressureHandling: Math.round(50 + noise(20)),
      attributes: Object.fromEntries(KEYS.map((key) => [key, Math.round(level + noise(12))])),
    };
  };
  return {
    id,
    name: `Team ${id}`,
    color: "#000000",
    ability,
    style: "Balanced",
    formation: "4-3-3",
    chemistry: 60,
    momentum: 0,
    pressure: 40,
    lineup: POSITIONS.map((position, index) => player(index, position)),
    bench: BENCH.map((position, index) => player(20 + index, position)),
    setPieces: { routine: "Near post", target: "Centre-back", risk: 50 },
  };
}

function snapshot(home: number, away: number, index: number, decisive = false): MatchSnapshot {
  return {
    rulesVersion: 3,
    home: syntheticTeam(1, home, `h:${home}:${index % 40}`),
    away: syntheticTeam(2, away, `a:${away}:${index % 40}`),
    weather: "Clear",
    importance: 65,
    detail: "50",
    rules: {
      decisive,
      extraTime: true,
      neutral: false,
      awayGoals: false,
      substitutions: 5,
      substitutionWindows: 3,
      extraSubstitution: true,
      aggregate: { home: 0, away: 0, homeAwayGoals: 0, awayAwayGoals: 0 },
      injuryFrequency: 50,
    },
  };
}

function tally(count: number, play: (index: number) => MatchResult) {
  let home = 0;
  let draw = 0;
  let goals = 0;
  for (let index = 0; index < count; index++) {
    const result = play(index);
    if (result.homeGoals > result.awayGoals) home++;
    else if (result.homeGoals === result.awayGoals) draw++;
    goals += result.homeGoals + result.awayGoals;
  }
  return { home: home / count, draw: draw / count, away: 1 - (home + draw) / count, goals: goals / count };
}

describe("fast match model", () => {
  it("matches the full engine's result distribution and scoring rate", () => {
    for (const [home, away] of [
      [65, 65],
      [72, 62],
      [60, 70],
      [80, 60],
    ]) {
      const engine = tally(500, (index) => simulateMatchV3(snapshot(home, away, index), `seed:${index}`, false));
      const fast = tally(500, (index) => simulateFastMatch(snapshot(home, away, index), `seed:${index}`));
      const label = `${home} v ${away}`;
      expect(Math.abs(fast.home - engine.home), `${label} home wins`).toBeLessThan(0.06);
      expect(Math.abs(fast.draw - engine.draw), `${label} draws`).toBeLessThan(0.06);
      expect(Math.abs(fast.away - engine.away), `${label} away wins`).toBeLessThan(0.06);
      expect(Math.abs(fast.goals - engine.goals), `${label} goals`).toBeLessThan(0.3);
    }
  }, 120_000);

  it("orders expected goals and results by team strength", () => {
    const even = fastExpectedGoals(snapshot(65, 65, 0));
    const stronger = fastExpectedGoals(snapshot(75, 65, 0));
    const weaker = fastExpectedGoals(snapshot(55, 65, 0));
    expect(even[0]).toBeGreaterThan(even[1]);
    expect(stronger[0] - stronger[1]).toBeGreaterThan(even[0] - even[1]);
    expect(weaker[0]).toBeLessThan(weaker[1]);
    const favourite = tally(400, (index) => simulateFastMatch(snapshot(78, 62, index), `order:${index}`));
    const underdog = tally(400, (index) => simulateFastMatch(snapshot(62, 78, index), `order:${index}`));
    expect(favourite.home).toBeGreaterThan(0.55);
    expect(underdog.away).toBeGreaterThan(favourite.away + 0.25);
  });

  it("produces consistent player lines for season statistics", () => {
    for (let index = 0; index < 200; index++) {
      const match = snapshot(66, 64, index);
      const result = simulateFastMatch(match, `lines:${index}`);
      for (const [side, team] of [match.home, match.away].entries()) {
        const lines = [...team.lineup, ...(team.bench ?? [])].map((player) => result.players[player.id]);
        const goals = lines.reduce((sum, line) => sum + line.goals, 0);
        expect(goals).toBe(side ? result.awayGoals : result.homeGoals);
        expect(lines.reduce((sum, line) => sum + line.assists, 0)).toBeLessThanOrEqual(goals);
        for (const line of lines) {
          expect(line.minutes).toBeGreaterThanOrEqual(0);
          expect(line.minutes).toBeLessThanOrEqual(result.duration!);
          if (line.minutes) expect(line.rating).toBeGreaterThanOrEqual(1);
        }
        expect(result.substitutions!.filter((change) => change.teamId === team.id).length).toBeLessThanOrEqual(5);
        for (const player of team.bench ?? [])
          if (result.players[player.id].minutes)
            expect(result.substitutions!.some((change) => change.onId === player.id)).toBe(true);
      }
      expect(result.events.filter((event) => event.type === "goal")).toHaveLength(result.homeGoals + result.awayGoals);
    }
  });

  it("always decides knockout fixtures", () => {
    for (let index = 0; index < 200; index++) {
      const result = simulateFastMatch(snapshot(65, 65, index, true), `cup:${index}`);
      expect([1, 2]).toContain(result.winnerId);
      if (result.shootout) expect(result.wentToExtraTime).toBe(true);
    }
  });

  it("is deterministic and forfeits short-handed teams", () => {
    const match = snapshot(65, 65, 3);
    expect(simulateFastMatch(match, "same")).toEqual(simulateFastMatch(match, "same"));
    const short = { ...match, away: { ...match.away, lineup: match.away.lineup.slice(0, 6) } };
    expect(simulateFastMatch(short, "short").abandoned?.teamId).toBe(2);
  });

  it("keeps the full engine for the user's club family", () => {
    const family = new Set([10, 11]);
    expect(followsFixture({ home_id: 10, away_id: 40 }, family)).toBe(true);
    expect(followsFixture({ home_id: 40, away_id: 11 }, family)).toBe(true);
    expect(followsFixture({ home_id: 40, away_id: 41 }, family)).toBe(false);
    const match = snapshot(65, 65, 1);
    const full = simulateFixture(match, "family", true);
    expect(full).toEqual(simulateMatchV3(match, "family", false));
    expect(full.momentum.length).toBeGreaterThan(0);
    const fast = simulateFixture(match, "family", false);
    expect(fast).toEqual(simulateFastMatch(match, "family"));
    expect(fast.momentum).toHaveLength(0);
  });
});
