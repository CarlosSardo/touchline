import seedrandom from "seedrandom";
import { describe, expect, it } from "vitest";
import {
  ageGroupFor,
  INTAKE,
  intakeSize,
  keepScore,
  missingPositions,
  retirementChance,
  selectSquad,
  youthRatings,
} from "./youth.ts";
import type { Position } from "../shared/types.ts";

const club = (level: number) => ({ academy: level, facilities: level, reputation: level });
const context = (level: number) => ({ nationLevel: level, headOfYouth: level, recruitment: level });

describe("academy intake size", () => {
  it("stays within 5-12 for every club, however extreme", () => {
    const random = seedrandom("intake-bounds");
    for (let index = 0; index < 5000; index++) {
      const size = intakeSize(
        { academy: random() * 120 - 10, facilities: random() * 120 - 10, reputation: random() * 120 - 10 },
        { nationLevel: random() * 120 - 10, headOfYouth: random() * 120 - 10, recruitment: random() * 120 - 10 },
        random,
      );
      expect(Number.isInteger(size)).toBe(true);
      expect(size).toBeGreaterThanOrEqual(INTAKE.min);
      expect(size).toBeLessThanOrEqual(INTAKE.max);
    }
  });

  it("grows with academy, youth staff, facilities, recruitment, reputation and nation", () => {
    const mean = (level: number, overrides: Partial<ReturnType<typeof context>> = {}) => {
      const random = seedrandom(`intake-mean-${level}`);
      let total = 0;
      for (let index = 0; index < 2000; index++) total += intakeSize(club(level), { ...context(level), ...overrides }, random);
      return total / 2000;
    };
    const weak = mean(20);
    const average = mean(55);
    const elite = mean(95);
    expect(weak).toBeLessThan(average);
    expect(average).toBeLessThan(elite);
    expect(elite - weak).toBeGreaterThan(3);
    expect(weak).toBeGreaterThan(INTAKE.min);
    expect(elite).toBeLessThan(INTAKE.max);
    expect(mean(55, { headOfYouth: 95 })).toBeGreaterThan(average);
  });

  it("differs between comparable clubs", () => {
    const random = seedrandom("intake-spread");
    const sizes = new Set(Array.from({ length: 200 }, () => intakeSize(club(60), context(60), random)));
    expect(sizes.size).toBeGreaterThanOrEqual(4);
  });
});

describe("youth ratings", () => {
  it("rate 14-15 year-olds well below the club's senior level with room to grow", () => {
    const random = seedrandom("ratings");
    for (let index = 0; index < 500; index++) {
      const age = index % 2 ? 14 : 15;
      const { ability, potential } = youthRatings(random, { reputation: 80, academy: 80, headOfYouth: 70, age });
      expect(ability).toBeLessThan(80 * 0.66 + 22);
      expect(potential).toBeGreaterThanOrEqual(ability + 10);
      expect(potential).toBeLessThanOrEqual(99);
    }
  });
});

describe("squad planning", () => {
  it("adds goalkeepers first and fills to the minimum", () => {
    expect(missingPositions(new Map(), 20).length).toBe(20);
    expect(missingPositions(new Map(), 20).filter((position) => position === "GK").length).toBe(2);
    const outfield = new Map<Position, number>([["CM", 19]]);
    expect(missingPositions(outfield, 20)).toEqual(["GK", "GK"]);
    const keepers = new Map<Position, number>([["GK", 2], ["CB", 10], ["ST", 6]]);
    const added = missingPositions(keepers, 25, true);
    expect(added.length).toBe(7);
    expect(added).not.toContain("CB");
  });

  it("keeps the best players and at least two goalkeepers", () => {
    const players = [
      ...Array.from({ length: 30 }, (_, index) => ({ position: "CM" as Position, ability: 70 - index, potential: 72, age: 25 })),
      { position: "GK" as Position, ability: 40, potential: 45, age: 30 },
      { position: "GK" as Position, ability: 35, potential: 40, age: 31 },
    ];
    const { kept, rest } = selectSquad(players, 20, 2);
    expect(kept.length).toBe(20);
    expect(kept.filter((player) => player.position === "GK").length).toBe(2);
    expect(rest.length).toBe(12);
    expect(keepScore({ ability: 60, potential: 85, age: 18 })).toBeGreaterThan(keepScore({ ability: 60, potential: 62, age: 28 }));
  });

  it("assigns age groups by the age at the season start", () => {
    expect(ageGroupFor("2011-07-02", "2026-07-01")).toBe("U17");
    expect(ageGroupFor("2009-07-02", "2026-07-01")).toBe("U17");
    expect(ageGroupFor("2009-07-01", "2026-07-01")).toBe("U19");
    expect(ageGroupFor("2007-07-02", "2026-07-01")).toBe("U19");
    expect(ageGroupFor("2007-07-01", "2026-07-01")).toBe("Senior");
  });

  it("retires contracted players only from 33 and everyone by 40", () => {
    expect(retirementChance(32, 60, false)).toBe(0);
    expect(retirementChance(40, 90, false)).toBe(1);
    expect(retirementChance(36, 60, false)).toBeGreaterThan(retirementChance(34, 60, false));
    expect(retirementChance(34, 60, true)).toBeGreaterThan(retirementChance(34, 60, false));
  });
});
