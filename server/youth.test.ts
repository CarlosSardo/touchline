import seedrandom from "seedrandom";
import { describe, expect, it } from "vitest";
import {
  ageGroupFor,
  competitionGroup,
  freeAgentChance,
  INTAKE,
  intakeSize,
  keepScore,
  leaveThreshold,
  missingPositions,
  retirementChance,
  selectSquad,
  SQUAD_CAPS,
  youthBirthCutoff,
  youthRatings,
} from "./youth.ts";
import { birthDateForAge } from "./people.ts";
import { SQUAD_MINIMUMS } from "../shared/world-rules.ts";
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

  it("admits youth competitions by birth year, as simulation lineups do", () => {
    // simulation.ts lineups: born on or after 1 January of season - limit + 1, limit 17 or 19.
    for (const season of [2026, 2031]) {
      expect(youthBirthCutoff("U17", season)).toBe(`${season - 17 + 1}-01-01`);
      expect(youthBirthCutoff("U19", season)).toBe(`${season - 19 + 1}-01-01`);
    }
    expect(competitionGroup("2010-01-01", 2026)).toBe("U17");
    expect(competitionGroup("2009-12-31", 2026)).toBe("U19");
    expect(competitionGroup("2008-01-01", 2026)).toBe("U19");
    expect(competitionGroup("2007-12-31", 2026)).toBe("Senior");
  });

  it("keeps 20 competition-eligible players and two eligible goalkeepers once over-age youths move up", () => {
    // World-generation ages at 1 July (U19 16-18, U17 14-16): about a fifth of each squad is born before its cutoff.
    const random = seedrandom("eligible-squads");
    const date = "2026-07-01";
    const season = 2026;
    type Youth = { position: Position; birthDate: string };
    const ages = { U19: () => (random() < 0.1 ? 16 : 17 + Math.floor(random() * 2)), U17: () => (random() < 0.1 ? 14 : 15 + Math.floor(random() * 2)) };
    let thin = 0;
    for (let club = 0; club < 300; club++) {
      const squads: Record<"U17" | "U19" | "Senior", Youth[]> = { U17: [], U19: [], Senior: [] };
      for (const group of ["U19", "U17"] as const)
        for (let index = 0; index < 20 + Math.floor(random() * 5); index++)
          squads[group].push({ position: index % 11 === 0 ? "GK" : "CM", birthDate: birthDateForAge(random, ages[group](), date) });
      const eligible = (group: "U17" | "U19") => squads[group].filter((youth) => youth.birthDate >= youthBirthCutoff(group, season));
      if (eligible("U19").length < SQUAD_MINIMUMS.U19 || eligible("U17").length < SQUAD_MINIMUMS.U17) thin++;
      // Over-age youths move up (U17 first, so they are checked against the U19 cutoff too).
      for (const group of ["U17", "U19"] as const)
        for (const youth of [...squads[group]])
          if (youth.birthDate < youthBirthCutoff(group, season)) {
            squads[group].splice(squads[group].indexOf(youth), 1);
            squads[competitionGroup(youth.birthDate, season) as "U19" | "Senior"].push(youth);
          }
      for (const group of ["U19", "U17"] as const) {
        const counts = new Map<Position, number>();
        for (const youth of eligible(group)) counts.set(youth.position, (counts.get(youth.position) ?? 0) + 1);
        for (const position of missingPositions(counts, SQUAD_MINIMUMS[group])) {
          const born = birthDateForAge(random, group === "U17" ? 14 + Math.floor(random() * 2) : 16 + Math.floor(random() * 2), date);
          squads[group].push({ position, birthDate: born < youthBirthCutoff(group, season) ? youthBirthCutoff(group, season) : born });
        }
        expect(eligible(group).length).toBe(squads[group].length);
        expect(eligible(group).length).toBeGreaterThanOrEqual(SQUAD_MINIMUMS[group]);
        expect(eligible(group).filter((youth) => youth.position === "GK").length).toBeGreaterThanOrEqual(2);
      }
    }
    expect(thin).toBeGreaterThan(0);
  });

  it("retires contracted players only from 33 and everyone by 40", () => {
    expect(retirementChance(32, 60, false)).toBe(0);
    expect(retirementChance(40, 90, false)).toBe(1);
    expect(retirementChance(36, 60, false)).toBeGreaterThan(retirementChance(34, 60, false));
    expect(retirementChance(34, 60, true)).toBeGreaterThan(retirementChance(34, 60, false));
  });
});

describe("population balance", () => {
  it("sends most released players out of football and good adults to the free-agent market", () => {
    const threshold = leaveThreshold(40);
    expect(freeAgentChance({ age: 16, ability: 30, potential: threshold + 10 }, threshold)).toBe(0);
    expect(freeAgentChance({ age: 16, ability: 40, potential: threshold + 25 }, threshold)).toBeLessThanOrEqual(0.25);
    expect(freeAgentChance({ age: 24, ability: threshold - 1, potential: 70 }, threshold)).toBe(0);
    expect(freeAgentChance({ age: 24, ability: threshold + 30, potential: 80 }, threshold)).toBe(0.9);
    expect(freeAgentChance({ age: 33, ability: threshold + 30, potential: 80 }, threshold)).toBeLessThan(0.5);
  });

  it("keeps a synthetic league within 10% over six rollovers with intake, squad targets and caps", () => {
    const random = seedrandom("population-balance");
    const positions: Position[] = ["GK", "CB", "CB", "LB", "RB", "DM", "CM", "CM", "AM", "LW", "RW", "ST", "GK"];
    type Person = { age: number; ability: number; potential: number; position: Position; club: number | null; freeSince?: number };
    const levels = Array.from({ length: 30 }, (_, index) => 40 + index);
    const threshold = leaveThreshold(levels[0]);
    const people: Person[] = [];
    const add = (club: number, age: number, level: number, index: number) => {
      const youth = age < 19 ? youthRatings(random, { reputation: level, academy: level, headOfYouth: 50, age }) : undefined;
      const ability = youth?.ability ?? Math.round(level * 0.66 + 22 + (random() - 0.5) * 12);
      people.push({ age, ability, potential: youth?.potential ?? ability + Math.max(0, 24 - age), position: positions[index % positions.length], club });
    };
    const group = (person: Person) => (person.age < 17 ? "U17" : person.age < 19 ? "U19" : "Senior");
    levels.forEach((level, id) => {
      for (let index = 0; index < 27; index++) add(id, 19 + (index % 16), level, index);
      for (let index = 0; index < 21; index++) add(id, 17 + (index % 2), level, index);
      for (let index = 0; index < 22; index++) add(id, 14 + (index % 3), level, index);
    });
    const initial = people.length;
    for (let season = 1; season <= 6; season++) {
      const leavers = new Set<Person>();
      for (const person of people) {
        person.age++;
        person.ability = Math.min(person.potential, person.ability + (person.age <= 23 ? (person.potential - person.ability) * 0.3 : person.age >= 31 ? -2 : 0));
        const clubless = person.club === null;
        if ((clubless && person.freeSince! < season) || (group(person) === "Senior" && random() < retirementChance(person.age, person.ability, clubless)))
          leavers.add(person);
      }
      const released: Person[] = [];
      levels.forEach((level, id) => {
        const squad = (name: string) => people.filter((person) => person.club === id && !leavers.has(person) && group(person) === name);
        const intake = intakeSize(club(level), context(50), random);
        expect(intake).toBeGreaterThanOrEqual(INTAKE.min);
        expect(intake).toBeLessThanOrEqual(INTAKE.max);
        released.push(...selectSquad(squad("Senior"), 27, 3).rest);
        released.push(...selectSquad(squad("U19"), SQUAD_CAPS.youth, 2).rest);
        released.push(...selectSquad(squad("U17"), SQUAD_CAPS.youth - intake, 2).rest);
        for (let index = 0; index < intake; index++) add(id, random() < 0.55 ? 14 : 15, level, index + season);
      });
      for (const person of released) {
        person.club = null;
        person.freeSince = season;
      }
      levels.forEach((level, id) => {
        for (const [name, minimum, age] of [["Senior", SQUAD_MINIMUMS.Senior, 19], ["U19", SQUAD_MINIMUMS.U19, 17], ["U17", SQUAD_MINIMUMS.U17, 15]] as const) {
          const size = people.filter((person) => person.club === id && !leavers.has(person) && group(person) === name).length;
          for (let gap = minimum - size; gap > 0; gap--) {
            const free = people.find((person) => person.club === null && !leavers.has(person) && group(person) === name);
            if (free) free.club = id;
            else add(id, age, level, gap);
          }
        }
      });
      for (const person of released)
        if (person.club === null && random() >= freeAgentChance(person, threshold)) leavers.add(person);
      const kept = people.filter((person) => !leavers.has(person));
      people.splice(0, people.length, ...kept);
      for (const id of levels.keys())
        for (const [name, minimum] of [["Senior", SQUAD_MINIMUMS.Senior], ["U19", SQUAD_MINIMUMS.U19], ["U17", SQUAD_MINIMUMS.U17]] as const) {
          const size = people.filter((person) => person.club === id && group(person) === name).length;
          expect(size, `season ${season} club ${id} ${name}`).toBeGreaterThanOrEqual(minimum);
          expect(size, `season ${season} club ${id} ${name}`).toBeLessThanOrEqual(name === "Senior" ? SQUAD_CAPS.firstTeam : SQUAD_CAPS.youth);
        }
      expect(Math.abs(people.length - initial) / initial, `season ${season}: ${people.length} vs ${initial}`).toBeLessThanOrEqual(0.1);
    }
  });
});
