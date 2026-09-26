import { describe, expect, it } from "vitest";
import { drawGroups, drawZoneLeaguePhase, type DrawEntrant } from "./draw.ts";

const field = (countries: number[]): DrawEntrant[] =>
  countries.map((countryId, index) => ({ id: index + 1, countryId, coefficient: 100 - index }));

describe("ACL Elite zone league stage", () => {
  // West zone: three Saudi and three Qatari clubs spread over the pots, two Emirati and two Iranian.
  const countries = [1, 2, 3, 1, 2, 4, 1, 2, 3, 4, 5, 6];
  const draw = drawZoneLeaguePhase(field(countries), "2026:acle:west");

  it("gives every club eight different opponents, two from each pot, four at home, one match per round", () => {
    expect(draw.fixtures).toHaveLength(48);
    for (let id = 1; id <= 12; id++) {
      const own = draw.fixtures.filter((fixture) => fixture.homeId === id || fixture.awayId === id);
      const opponents = own.map((fixture) => (fixture.homeId === id ? fixture.awayId : fixture.homeId));
      expect(new Set(opponents).size).toBe(8);
      expect(own.filter((fixture) => fixture.homeId === id)).toHaveLength(4);
      expect(new Set(own.map((fixture) => fixture.round)).size).toBe(8);
      for (const pot of draw.pots) expect(opponents.filter((opponent) => pot.includes(opponent))).toHaveLength(2);
    }
  });

  it("avoids same-association pairings", () => {
    expect(draw.constraints.associationProtection).toBe(true);
    expect(draw.fixtures.some((fixture) => countries[fixture.homeId - 1] === countries[fixture.awayId - 1])).toBe(false);
  });
});

describe("group-stage draw", () => {
  // 32 clubs as in the Libertadores: six each from two associations, the rest spread over eight.
  const countries = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10];
  const entrants = field(countries);

  it("seeds pots by coefficient, puts one club per pot in each group and protects associations", () => {
    const draw = drawGroups(entrants, 8, "2026:libertadores");
    expect(draw.pots[0]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(draw.maxSameAssociation).toBe(1);
    for (const group of draw.groups) {
      expect(group).toHaveLength(4);
      expect(group.map((id, pot) => draw.pots[pot].includes(id))).toEqual([true, true, true, true]);
      expect(new Set(group.map((id) => countries[id - 1])).size).toBe(4);
    }
    expect(new Set(draw.groups.flat()).size).toBe(32);
  });

  it("is deterministic per seed and relaxes protection only when an association outnumbers the groups", () => {
    expect(drawGroups(entrants, 8, "seed").groups).toEqual(drawGroups(entrants, 8, "seed").groups);
    const crowded = drawGroups(field([1, 1, 1, 1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), 4, "crowded");
    expect(crowded.maxSameAssociation).toBe(2);
    for (const group of crowded.groups)
      expect(group.filter((id) => id <= 6).length).toBeLessThanOrEqual(2);
  });
});
