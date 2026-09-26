import { describe, expect, it } from "vitest";
import {
  advancePlayoff,
  assignConferences,
  baseMatchdays,
  baseSchedule,
  boundaryKey,
  createPlayoff,
  halvedPoints,
  lastStageTies,
  leagueDates,
  miniLeagueRounds,
  pairQualifyingRound,
  planBoundaries,
  planMovement,
  planSplit,
  postseasonDates,
  qualifyingPlan,
  rankTable,
  readLeagueData,
  reduceBracket,
  regularSeasonDates,
  resolvePlayoffBySeed,
  roundRobinRounds,
  seniorLeagueData,
  splitMatchdays,
  type PlayoffState,
  type PyramidClub,
  type PyramidTier,
} from "./league-rules.ts";
import { addDays, daysBetween, internationalBreak } from "./rules.ts";
import type { TierBoundarySpec } from "./world-catalog/types.ts";

const ids = (from: number, count: number) =>
  Array.from({ length: count }, (_, index) => from + index);

/** Plays every pending round with the better seed winning unless `upsets` names the winner. */
function playOut(state: PlayoffState, upsets: number[] = []) {
  const rounds: [number, number][][] = [];
  let current = state;
  while (current.pending) {
    rounds.push(current.pending.pairs);
    current = advancePlayoff(
      current,
      current.pending.pairs.map(([better, worse]) =>
        upsets.includes(worse) ? worse : better,
      ),
    );
  }
  return { rounds, result: current.result! };
}

describe("round robins", () => {
  it("meets every opponent once per cycle with balanced venues", () => {
    const teams = ids(1, 20);
    const rounds = roundRobinRounds(teams, 2);
    expect(rounds).toHaveLength(38);
    expect(rounds.every((pairs) => pairs.length === 10)).toBe(true);
    const ordered = new Set(rounds.flat().map(([home, away]) => `${home}:${away}`));
    expect(ordered.size).toBe(20 * 19);
    for (const team of teams) {
      const firstCycle = rounds.slice(0, 19).flat();
      const home = firstCycle.filter(([host]) => host === team).length;
      expect(Math.abs(home - (19 - home))).toBeLessThanOrEqual(1);
      expect(rounds.flat().filter(([host]) => host === team)).toHaveLength(19);
      for (const pairs of rounds)
        expect(pairs.filter((pair) => pair.includes(team))).toHaveLength(1);
    }
  });

  it("gives odd fields one bye per round and supports three and four cycles", () => {
    const odd = roundRobinRounds(ids(1, 15), 2);
    expect(odd).toHaveLength(30);
    expect(odd.every((pairs) => pairs.length === 7)).toBe(true);
    const triple = roundRobinRounds(ids(1, 12), 3);
    expect(triple).toHaveLength(33);
    const meetings = new Map<string, number>();
    for (const [home, away] of triple.flat()) {
      const key = `${Math.min(home, away)}:${Math.max(home, away)}`;
      meetings.set(key, (meetings.get(key) ?? 0) + 1);
    }
    expect([...meetings.values()].every((count) => count === 3)).toBe(true);
    expect(baseMatchdays(30, 2, 2)).toBe(30);
    expect(baseMatchdays(24, 2)).toBe(46);
  });
});

describe("season dates", () => {
  for (const count of [18, 30, 38, 46]) {
    it(`fits ${count} matchdays between August and mid-May without international windows`, () => {
      const dates = leagueDates(2026, count);
      expect(dates).toHaveLength(count);
      expect(dates[0] >= "2026-08-08").toBe(true);
      expect(dates.at(-1)! <= "2027-05-17").toBe(true);
      expect(dates.every((date) => !internationalBreak(date))).toBe(true);
      for (let index = 1; index < dates.length; index++)
        expect(daysBetween(dates[index - 1], dates[index])).toBeGreaterThanOrEqual(3);
    });
  }

  it("leaves a play-off window that ends by 30 June and skips the June window", () => {
    const dates = postseasonDates(2026, "2027-05-17");
    expect(dates[0]).toBe("2027-05-20");
    expect(dates.at(-1)! <= "2027-06-30").toBe(true);
    expect(dates.every((date) => !internationalBreak(date))).toBe(true);
    expect(dates.length).toBeGreaterThanOrEqual(8);
    expect(addDays(dates[0], 3)).toBe(dates[1]);
  });
});

describe("tables, splits and conferences", () => {
  const row = (club_id: number, points: number, group_name = "", gf = 10, ga = 10) => ({
    club_id,
    points,
    gf,
    ga,
    group_name,
  });
  const split = {
    groups: [
      { name: "Championship round", positions: [1, 6] as [number, number], roundRobins: 1 as const, points: "full" as const },
      { name: "Relegation round", positions: [7, 12] as [number, number], roundRobins: 1 as const, points: "halved" as const },
    ],
  };

  it("keeps the split group order in the final ranking", () => {
    const ranked = rankTable(
      [row(1, 40, "Relegation round"), row(2, 38, "Championship round"), row(3, 39, "Championship round")],
      split,
    );
    expect(ranked.map((entry) => entry.club_id)).toEqual([3, 2, 1]);
    expect(rankTable([row(1, 30, "", 20, 10), row(2, 30, "", 25, 10), row(3, 31)]).map((entry) => entry.club_id)).toEqual([3, 2, 1]);
  });

  it("splits the base table by positions and halves points upwards", () => {
    const base = rankTable(ids(1, 12).map((club) => row(club, 100 - club)));
    const groups = planSplit(base, split);
    expect(groups.map((group) => group.clubs)).toEqual([ids(1, 6), ids(7, 6)]);
    expect(halvedPoints(33)).toBe(17);
    expect(splitMatchdays(split)).toBe(5);
    expect(baseMatchdays(12, 3) + splitMatchdays(split)).toBe(38);
  });

  it("keeps conferences equal when clubs are promoted and relegated", () => {
    const current = new Map([[1, "East"], [2, "East"], [3, "West"], [4, "West"]]);
    const next = assignConferences(["East", "West"], current, [2, 3], [10, 11]);
    const counts = ["East", "West"].map((name) => [...next.values()].filter((value) => value === name).length);
    expect(counts).toEqual([2, 2]);
    expect(next.has(2)).toBe(false);
  });
});

describe("play-off brackets", () => {
  it("runs a four-team promotion play-off with two-legged semi-finals and a neutral final", () => {
    const state = createPlayoff({ kind: "promotion", places: 1, legs: 2, finalLegs: 1, neutralFinal: true, seeds: [3, 4, 5, 6] });
    expect(state.pending).toMatchObject({ pairs: [[3, 6], [4, 5]], legs: 2, final: false });
    const semis = advancePlayoff(state, [6, 4]);
    expect(semis.pending).toMatchObject({ pairs: [[4, 6]], legs: 1, neutral: true, final: true });
    expect(advancePlayoff(semis, [6]).result).toEqual({ winners: [6], losers: [3, 4, 5] });
  });

  it("gives the top seeds byes in a six-team play-off (Serie B format)", () => {
    const { rounds, result } = playOut(
      createPlayoff({ kind: "promotion", places: 1, legs: 2, seeds: [13, 14, 15, 16, 17, 18] }),
    );
    expect(rounds).toEqual([[[15, 18], [16, 17]], [[13, 16], [14, 15]], [[13, 14]]]);
    expect(result.winners).toEqual([13]);
    expect(reduceBracket(ids(1, 5), 2)).toEqual([[4, 5]]);
  });

  it("gives the leader a bye in three- and two-team title play-offs (Uruguay, Peru)", () => {
    const uruguay = playOut(createPlayoff({ kind: "championship", places: 1, legs: 1, seeds: [1, 2, 3] }));
    expect(uruguay.rounds).toEqual([[[2, 3]], [[1, 2]]]);
    expect(uruguay.result.winners).toEqual([1]);
    const peru = playOut(createPlayoff({ kind: "championship", places: 1, legs: 2, seeds: [1, 2] }));
    expect(peru.rounds).toEqual([[[1, 2]]]);
  });

  it("promotes two winners from four teams in a single round", () => {
    const state = createPlayoff({ kind: "promotion", places: 2, legs: 2, seeds: [1, 2, 3, 4] });
    expect(state.pending!.pairs).toEqual([[1, 4], [2, 3]]);
    expect(advancePlayoff(state, [4, 2]).result).toEqual({ winners: [2, 4], losers: [1, 3] });
  });

  it("relegates the losers of a play-out, including a double play-out", () => {
    const single = createPlayoff({ kind: "relegation", places: 1, legs: 2, seeds: [16, 17] });
    expect(advancePlayoff(single, [17]).result).toEqual({ winners: [17], losers: [16] });
    const { rounds, result } = playOut(createPlayoff({ kind: "relegation", places: 1, legs: 1, seeds: [1, 2, 3, 4] }));
    expect(rounds).toEqual([[[1, 4], [2, 3]], [[3, 4]]]);
    expect(result.losers).toEqual([4]);
    const three = createPlayoff({ kind: "relegation", places: 1, legs: 1, seeds: [7, 8, 9] });
    expect(three.pending!.pairs).toEqual([[8, 9]]);
  });

  it("plays cross-tier ties with a lower-tier ladder first (Ligue 1/Ligue 2 barrage)", () => {
    let state = createPlayoff({ kind: "cross-tier", legs: 1, finalLegs: 2, upper: [116], seeds: [203, 204, 205] });
    expect(state.pending).toMatchObject({ pairs: [[204, 205]], legs: 1, final: false });
    state = advancePlayoff(state, [205]);
    expect(state.pending!.pairs).toEqual([[203, 205]]);
    state = advancePlayoff(state, [205]);
    expect(state.pending).toMatchObject({ pairs: [[116, 205]], legs: 2, final: true });
    expect(advancePlayoff(state, [116]).result).toEqual({ winners: [116], losers: [203, 204, 205] });
    expect(playOut(state, [205]).result).toEqual({ winners: [205], losers: [116, 203, 204] });
    const bundesliga = createPlayoff({ kind: "cross-tier", legs: 2, upper: [16], seeds: [23] });
    expect(bundesliga.pending).toMatchObject({ pairs: [[16, 23]], legs: 2, final: true });
    expect(advancePlayoff(bundesliga, [23]).result).toEqual({ winners: [23], losers: [16] });
  });

  it("decides title play-offs per conference before the final", () => {
    const state = createPlayoff({
      kind: "championship",
      legs: 1,
      neutralFinal: false,
      seeds: [1, 2, 3, 4, 5, 6, 7, 8],
      groups: [[1, 3, 5, 7], [2, 4, 6, 8]],
    });
    expect(state.pending!.pairs).toEqual([[1, 7], [3, 5], [2, 8], [4, 6]]);
    const { result } = playOut(state);
    expect(result.winners).toEqual([1]);
    expect(resolvePlayoffBySeed(state).winners).toEqual([1]);
  });
});

describe("promotion and relegation", () => {
  const tier = (
    leagueId: number,
    level: number,
    table: number[],
    movementDown: TierBoundarySpec | null,
    closed = false,
  ): PyramidTier => ({ leagueId, tier: level, closed, movementDown, table });
  const sizes = (tiers: PyramidTier[], moves: ReturnType<typeof planMovement>) =>
    tiers.map(
      (entry) =>
        entry.table.length -
        moves.filter((move) => move.from === entry.leagueId).length +
        moves.filter((move) => move.to === entry.leagueId).length,
    );

  it("balances automatic moves and every play-off type", () => {
    const tiers = [
      tier(1, 1, ids(100, 18), { upper: 1, promoted: 2, relegated: 2, playoffs: [{ type: "cross-tier", upperPositions: [16], lowerPositions: [3], legs: 2 }] }),
      tier(2, 2, ids(200, 18), { upper: 2, promoted: 2, relegated: 2, playoffs: [{ type: "cross-tier", upperPositions: [16], lowerPositions: [3], legs: 2 }] }),
      tier(3, 3, ids(300, 20), { upper: 3, promoted: 1, relegated: 2, playoffs: [{ type: "promotion", positions: [2, 5], places: 2, legs: 2 }, { type: "relegation", positions: [15, 16], places: 1, legs: 2 }] }),
      tier(4, 4, ids(400, 20), null),
    ];
    const plans = planBoundaries({ tiers, clubs: new Map() });
    expect(plans.map((plan) => plan.playoffs.length)).toEqual([1, 1, 2]);
    expect(plans[2].playoffs[0].input.seeds).toEqual([401, 402, 403, 404]);
    const results = new Map([
      [boundaryKey(1, 0), { winners: [202], losers: [115] }],
      [boundaryKey(3, 0), { winners: [403, 404], losers: [401, 402] }],
    ]);
    const moves = planMovement({ tiers, clubs: new Map(), boundaries: plans, results });
    expect(sizes(tiers, moves)).toEqual([18, 18, 20, 20]);
    expect(moves.filter((move) => move.to === 1).map((move) => move.clubId)).toEqual([200, 201, 202]);
    expect(moves.filter((move) => move.from === 1).map((move) => move.clubId)).toEqual([115, 116, 117]);
    // Missing cross-tier result: the upper club keeps its place by seed.
    expect(moves.some((move) => move.clubId === 215)).toBe(false);
    const upToThree = moves.filter((move) => move.from === 4 && move.to === 3).map((move) => move.clubId);
    expect(upToThree).toEqual([400, 403, 404]);
    const downFromThree = moves.filter((move) => move.from === 3 && move.to === 4).map((move) => move.clubId);
    expect(downFromThree).toEqual([315, 318, 319]);
  });

  it("never moves clubs into or out of closed tiers", () => {
    const tiers = [
      tier(1, 1, ids(100, 10), { upper: 1, promoted: 0, relegated: 0 }, true),
      tier(2, 2, ids(200, 10), null, true),
    ];
    expect(planMovement({ tiers, clubs: new Map() })).toEqual([]);
  });

  it("moves per conference: each champion plus one play-off winner per division (National League North/South)", () => {
    const north = ids(600, 24);
    const south = ids(700, 24);
    const boundary: TierBoundarySpec = {
      upper: 5,
      promoted: 2,
      relegated: 4,
      perConference: true,
      playoffs: [{ type: "promotion", positions: [2, 7], places: 2, legs: 1, finalLegs: 1 }],
    };
    const tiers = [
      tier(5, 5, ids(500, 24), boundary),
      { ...tier(6, 6, [...north, ...south].sort((left, right) => (left % 100) - (right % 100)), null), conferenceTables: [north, south] },
    ];
    const plans = planBoundaries({ tiers, clubs: new Map() });
    expect(plans[0].promoted).toEqual([600, 700]);
    expect(plans[0].relegated).toEqual([520, 521, 522, 523]);
    expect(plans[0].playoffs.map((playoff) => [playoff.conference, playoff.input.places, playoff.input.seeds])).toEqual([
      [0, 1, [601, 602, 603, 604, 605, 606]],
      [1, 1, [701, 702, 703, 704, 705, 706]],
    ]);
    const results = new Map([
      [boundaryKey(5, 0, 0), { winners: [603], losers: [601, 602, 604, 605, 606] }],
      [boundaryKey(5, 0, 1), { winners: [701], losers: [702, 703, 704, 705, 706] }],
    ]);
    const moves = planMovement({ tiers, clubs: new Map(), boundaries: plans, results });
    expect(sizes(tiers, moves)).toEqual([24, 48]);
    expect(moves.filter((move) => move.to === 5).map((move) => move.clubId)).toEqual([600, 603, 700, 701]);
  });

  it("relegates per conference when the upper tier has conferences (Linafoot zones)", () => {
    const east = ids(100, 10);
    const west = ids(150, 10);
    const tiers = [
      { ...tier(1, 1, [...east, ...west], { upper: 1, promoted: 4, relegated: 4, perConference: true }), conferenceTables: [east, west] },
      { ...tier(2, 2, [...ids(200, 12), ...ids(250, 12)], null), conferenceTables: [ids(200, 12), ids(250, 12)] },
    ];
    const moves = planMovement({ tiers, clubs: new Map() });
    expect(moves.filter((move) => move.to === 2).map((move) => move.clubId)).toEqual([108, 109, 158, 159]);
    expect(moves.filter((move) => move.to === 1).map((move) => move.clubId)).toEqual([200, 201, 250, 251]);
    expect(sizes(tiers, moves)).toEqual([20, 24]);
  });

  it("keeps B-teams below their parent and passes their promotion place to the next club", () => {
    const tiers = [
      tier(1, 1, ids(100, 10), { upper: 1, promoted: 2, relegated: 2 }),
      tier(2, 2, [900, ...ids(200, 9)], { upper: 2, promoted: 2, relegated: 3, playoffs: [{ type: "promotion", positions: [3, 6], places: 1, legs: 2 }] }),
      tier(3, 3, ids(300, 10), null),
    ];
    const clubs = new Map<number, PyramidClub>([
      [900, { clubId: 900, reserve: { parentId: 100, highestTier: 2, minGapBelowParent: 1 } }],
    ]);
    const plans = planBoundaries({ tiers, clubs });
    expect(plans[0].promoted).toEqual([200, 201]);
    expect(plans[1].playoffs[0].input.seeds).toEqual([302, 303, 304, 305]);
    const moves = planMovement({ tiers, clubs, boundaries: plans });
    expect(moves.some((move) => move.clubId === 900)).toBe(false);
    expect(sizes(tiers, moves)).toEqual([10, 10, 10]);
  });

  it("pushes a B-team down when its parent is relegated onto its tier, with a replacement moving up", () => {
    const tiers = [
      tier(1, 1, ids(100, 10), { upper: 1, promoted: 1, relegated: 1 }),
      tier(2, 2, [...ids(200, 5), 900, ...ids(205, 4)], { upper: 2, promoted: 1, relegated: 1 }),
      tier(3, 3, ids(300, 10), null),
    ];
    const clubs = new Map<number, PyramidClub>([
      [900, { clubId: 900, reserve: { parentId: 109, highestTier: 2, minGapBelowParent: 1 } }],
    ]);
    const moves = planMovement({ tiers, clubs });
    expect(moves.find((move) => move.clubId === 109)).toMatchObject({ to: 2, promoted: false });
    expect(moves.find((move) => move.clubId === 900)).toMatchObject({ to: 3, reason: "reserve-ceiling" });
    expect(moves.find((move) => move.clubId === 301)).toMatchObject({ to: 2, reason: "replacement" });
    expect(sizes(tiers, moves)).toEqual([10, 10, 10]);
  });

  it("caps B-teams per tier and withdraws a B-team without a legal modeled tier", () => {
    const tiers = [
      tier(1, 1, ids(100, 8), { upper: 1, promoted: 1, relegated: 1 }),
      tier(2, 2, [901, ...ids(200, 6), 902], { upper: 2, promoted: 2, relegated: 2 }),
      tier(3, 3, [903, 904, ...ids(300, 6)], null),
    ];
    const reserve = (parentId: number) => ({ parentId, highestTier: 2, minGapBelowParent: 1, maxPerTier: 2 });
    const clubs = new Map<number, PyramidClub>([
      [901, { clubId: 901, reserve: reserve(100) }],
      [902, { clubId: 902, reserve: reserve(101) }],
      [903, { clubId: 903, reserve: reserve(102) }],
      [904, { clubId: 904, reserve: reserve(103) }],
    ]);
    const plans = planBoundaries({ tiers, clubs });
    expect(plans[1].promoted).toEqual([903, 300]);
    const bottom = [tier(1, 1, ids(100, 4), { upper: 1, promoted: 1, relegated: 1 }), tier(2, 2, [905, ...ids(200, 3)], null)];
    const moves = planMovement({
      tiers: bottom,
      clubs: new Map([[905, { clubId: 905, reserve: { parentId: 103, highestTier: 2, minGapBelowParent: 1 } }]]),
    });
    expect(moves.find((move) => move.clubId === 905)).toMatchObject({ to: null });
  });

  it("reprieves relegated clubs when a play-off cannot be staged", () => {
    const tiers = [
      tier(1, 1, ids(100, 10), { upper: 1, promoted: 1, relegated: 2, playoffs: [{ type: "promotion", positions: [2, 5], places: 1, legs: 1 }] }),
      tier(2, 2, [200, 201], null),
    ];
    const moves = planMovement({ tiers, clubs: new Map() });
    expect(moves.filter((move) => move.from === 1).map((move) => move.clubId)).toEqual([109]);
    expect(sizes(tiers, moves)).toEqual([10, 2]);
  });
});

describe("league snapshots", () => {
  it("records totals, boundaries and B-team access from the catalog tier", () => {
    const movement: TierBoundarySpec[] = [
      { upper: 1, promoted: 2, relegated: 2, playoffs: [{ type: "cross-tier", upperPositions: [16], lowerPositions: [3], legs: 2 }] },
      { upper: 2, promoted: 2, relegated: 2 },
    ];
    const clubs = {
      reputation: { top: 80, bottom: 60 },
      capacity: { top: 70000, bottom: 15000 },
      facilities: { top: 90, bottom: 60 },
      academy: { top: 90, bottom: 60 },
      wageBill: { top: 1e8, bottom: 1e7 },
      transferBudget: { top: 5e7, bottom: 1e6 },
      foreignShare: 0.4,
    };
    const data = seniorLeagueData(
      "DE",
      { movement, reserves: { mode: "pyramid", pyramid: { highestTier: 3, minGapBelowParent: 1 } } },
      { tier: 2, name: "2. Bundesliga", shortName: "2. BL", size: 18, status: "professional", reputation: 70, clubs },
    );
    expect(data).toMatchObject({ catalogKey: "L:DE:2", promotion: 3, relegation: 2, bTeamsAllowed: false, closed: false });
    expect(data.movementUp).toBe(movement[0]);
    const legacy = readLeagueData({ promotion: 3, relegation: 3 }, 2, { above: { relegation: 2 }, below: { promotion: 4 } });
    expect(legacy.movementUp).toEqual({ upper: 1, promoted: 2, relegated: 2 });
    expect(legacy.movementDown).toEqual({ upper: 2, promoted: 3, relegated: 3 });
  });
});

describe("season schedules", () => {
  it("promotes the lower tier's champion first and sends the beaten finalist to the play-off (Primera Nacional)", () => {
    const reducido: TierBoundarySpec = {
      upper: 1,
      promoted: 1,
      relegated: 2,
      championPromoted: true,
      playoffs: [{ type: "promotion", positions: [2, 16], places: 1, legs: 1, finalLegs: 2 }],
    };
    const tiers: PyramidTier[] = [
      { leagueId: 1, tier: 1, closed: false, movementDown: reducido, table: ids(100, 28) },
      { leagueId: 2, tier: 2, closed: false, movementDown: null, table: ids(200, 36), champion: 205 },
    ];
    const [plan] = planBoundaries({ tiers, clubs: new Map() });
    expect(plan.promoted).toEqual([205]);
    expect(plan.playoffs[0].input.seeds).toEqual([...ids(200, 5), ...ids(206, 10)]);
    const moves = planMovement({
      tiers,
      clubs: new Map(),
      results: new Map([[boundaryKey(1, 0), { winners: [200], losers: [] }]]),
    });
    expect(moves.filter((move) => move.promoted).map((move) => move.clubId)).toEqual([200, 205]);
    expect(moves.filter((move) => !move.promoted).map((move) => move.clubId)).toEqual([126, 127]);
  });
  const opponents = (schedule: [number, number][][]) => {
    const met = new Map<number, number[]>();
    for (const pairs of schedule)
      for (const [home, away] of pairs) {
        met.set(home, [...(met.get(home) ?? []), away]);
        met.set(away, [...(met.get(away) ?? []), home]);
      }
    return met;
  };

  it("plays conferences in parallel and adds inter-conference rounds (MLS 15 + 15, 6 games)", () => {
    const east = ids(1, 15);
    const west = ids(101, 15);
    const schedule = baseSchedule([east, west], 2, 6);
    expect(schedule).toHaveLength(baseMatchdays(30, 2, 2, 6));
    const met = opponents(schedule);
    for (const clubId of [...east, ...west]) {
      const own = east.includes(clubId) ? east : west;
      const games = met.get(clubId)!;
      expect(games).toHaveLength(28 + 6);
      expect(games.filter((other) => !own.includes(other))).toHaveLength(6);
      expect(new Set(games.filter((other) => !own.includes(other))).size).toBe(6);
    }
    for (const pairs of schedule) {
      const playing = pairs.flat();
      expect(new Set(playing).size).toBe(playing.length);
    }
  });

  it("keeps a single group as a plain round robin and balances venues across conferences", () => {
    expect(baseSchedule([ids(1, 21)], 1)).toHaveLength(21);
    const inter = baseSchedule([ids(1, 4), ids(11, 4)], 2, 4).slice(6);
    const homes = new Map<number, number>();
    for (const pairs of inter) for (const [home] of pairs) homes.set(home, (homes.get(home) ?? 0) + 1);
    for (const clubId of [...ids(1, 4), ...ids(11, 4)]) expect(homes.get(clubId) ?? 0).toBe(2);
  });

  it("reserves split and mini-league dates after the base rounds within the season", () => {
    const split = splitMatchdays({
      groups: [
        { name: "Championship Group", positions: [1, 7], roundRobins: 2, points: "full" },
        { name: "Relegation Group", positions: [8, 21], roundRobins: 1, points: "full" },
      ],
    });
    expect(split).toBe(14);
    const title = miniLeagueRounds({ positions: [1, 4], perConference: true, format: "round-robin", roundRobins: 2, legs: 1 }, 2);
    expect(title).toBe(14);
    expect(miniLeagueRounds({ positions: [1, 8], legs: 2 })).toBe(0);
    const dates = regularSeasonDates(2026, 21, split + title);
    expect(dates.base).toHaveLength(21);
    expect(dates.split).toHaveLength(28);
    expect(dates.base.at(-1)! < dates.split[0]).toBe(true);
    expect(dates.split.at(-1)! <= "2027-05-17").toBe(true);
    const all = [...dates.base, ...dates.split];
    for (let index = 1; index < all.length; index++) expect(daysBetween(all[index - 1], all[index])).toBeGreaterThanOrEqual(3);
  });
});

describe("continental qualifying plan", () => {
  const winners = (rounds: ReturnType<typeof qualifyingPlan>, entrants: Record<string, number>) =>
    Object.values(entrants).reduce((total, count) => total + count, 0) -
    rounds.reduce((total, round) => total + round.ties, 0);

  it("leaves exactly the open main-phase places after the last entry stage", () => {
    const entrants = { q1: 28, q2: 10, q3: 6, playoff: 4 };
    const rounds = qualifyingPlan(entrants, 7);
    expect(rounds.map((round) => round.stage)).toEqual(["q1", "q2", "q3", "playoff"]);
    expect(winners(rounds, entrants)).toBe(7);
    expect(rounds.every((round) => round.ties * 2 <= round.playing)).toBe(true);
  });

  it("adds rounds at the last stage when the field is more than twice the places, and plays nothing without places", () => {
    const rounds = qualifyingPlan({ q1: 22 }, 11);
    expect(rounds).toEqual([{ stage: "q1", playing: 22, ties: 11 }]);
    const long = qualifyingPlan({ q1: 40 }, 4);
    expect(long.length).toBeGreaterThan(1);
    expect(winners(long, { q1: 40 })).toBe(4);
    expect(qualifyingPlan({ q1: 12 }, 0)).toEqual([]);
    expect(winners(qualifyingPlan({ q2: 3 }, 8), { q2: 3 })).toBe(3);
  });

  it("gives byes to the best seeds and keeps paths apart except for odd leftovers", () => {
    const paths: Record<number, string> = { 1: "league", 2: "champions", 3: "champions", 4: "champions", 5: "champions", 6: "league", 7: "league" };
    const { byes, pairs } = pairQualifyingRound([1, 2, 3, 4, 5, 6, 7], 3, (id) => paths[id]);
    expect(byes).toEqual([1]);
    expect(pairs).toHaveLength(3);
    expect(new Set(pairs.flat())).toEqual(new Set([2, 3, 4, 5, 6, 7]));
    expect(pairs.filter(([home, away]) => paths[home] !== paths[away])).toHaveLength(0);
    const mixed = pairQualifyingRound([1, 2, 3, 4], 2, (id) => (id === 1 ? "league" : "champions"));
    expect(mixed.pairs.flat().sort()).toEqual([1, 2, 3, 4]);
    expect(mixed.pairs.filter(([home, away]) => (home === 1) !== (away === 1))).toHaveLength(1);
  });

  it("gives byes only in the first round of the last stage (CAF round 2 = 32; UYL 20 → 10, 30 + 10 → 20 → 10)", () => {
    expect([lastStageTies(60, 16), lastStageTies(32, 16), lastStageTies(3, 2), lastStageTies(2, 2), lastStageTies(5, 0)]).toEqual([
      28, 16, 1, 0, 0,
    ]);
    expect(qualifyingPlan({ q1: 60 }, 16)).toEqual([
      { stage: "q1", playing: 60, ties: 28 },
      { stage: "q1", playing: 32, ties: 16 },
    ]);
    expect(qualifyingPlan({ q1: 20, q2: 30 }, 10)).toEqual([
      { stage: "q1", playing: 20, ties: 10 },
      { stage: "q2", playing: 40, ties: 20 },
      { stage: "q2", playing: 20, ties: 10 },
    ]);
  });

  it("gives an odd path's best seed the bye, so an odd round after vacancies keeps its paths apart", () => {
    const paths: Record<number, string> = { 1: "league", 2: "champions", 3: "league", 4: "champions", 5: "champions", 6: "league", 7: "league" };
    const odd = pairQualifyingRound([1, 2, 3, 4, 5, 6, 7], 3, (id) => paths[id]);
    expect(odd.byes).toEqual([2]);
    expect(odd.pairs.filter(([home, away]) => paths[home] !== paths[away])).toHaveLength(0);
    const side = (id: number) => ([2, 6].includes(id) ? "b" : "a");
    const two = pairQualifyingRound([1, 2, 3, 4, 5, 6], 2, side);
    expect(two.byes).toEqual([1, 3]);
    expect(two.pairs.filter(([home, away]) => side(home) !== side(away))).toHaveLength(0);
  });
});
