import seedrandom from "seedrandom";
import { describe, expect, it } from "vitest";
import {
  aiRenewalTerms,
  AI_YOUTH_TARGET,
  ageGroupFor,
  competitionGroup,
  freeAgentChance,
  INTAKE,
  intakeSize,
  keepScore,
  leavesFreeAgency,
  leaveThreshold,
  missingPositions,
  selectSquad,
  SQUAD_CAPS,
  youthBirthCutoff,
  youthRatings,
} from "./youth.ts";
import { birthDateForAge, seniorRetirementChance } from "./people.ts";
import { deadlineDay, disciplineScope, LEGACY_DISCIPLINE_SCOPE, transferWindow, winterWindowClose } from "../shared/rules.ts";
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
});

describe("AI contract renewals", () => {
  const base = { wage: 10_000, market: 10_000, floor: 100, age: 26, position: "CM" as Position, rank: 8, minutesShare: 0.7, room: 1e6, random: 0.99 };

  it("prices a renewal on role, form and age around the club's going rate", () => {
    expect(aiRenewalTerms(base)).toEqual({ wage: 11_030 });
    expect(aiRenewalTerms({ ...base, rank: 22, minutesShare: 0.1 })).toEqual({ wage: 7_820 });
    // Past the peak the wage falls 6% a year; a keeper peaks later.
    expect(aiRenewalTerms({ ...base, age: 32, rank: 15, minutesShare: 0.4 })).toEqual({ wage: 7_790 });
    expect(aiRenewalTerms({ ...base, age: 32, rank: 15, minutesShare: 0.4, position: "GK" })).toEqual({ wage: 9_500 });
    // Within 60-130% of the current wage, never below the club's floor.
    expect(aiRenewalTerms({ ...base, market: 50_000 })).toEqual({ wage: 13_000 });
    expect(aiRenewalTerms({ ...base, market: 1_000, rank: 20 })).toEqual({ wage: 6_000 });
    expect(aiRenewalTerms({ ...base, wage: 50, market: 40, floor: 300 })).toEqual({ wage: 300 });
  });

  it("keeps within the budget: a fifth less at most, otherwise the club lets him go", () => {
    expect(aiRenewalTerms({ ...base, room: 9_500 })).toEqual({ wage: 9_500 });
    expect(aiRenewalTerms({ ...base, room: 8_000 })).toEqual({ leaves: "club" });
    expect(aiRenewalTerms({ ...base, room: -5_000 })).toEqual({ leaves: "club" });
  });

  it("lets players refuse, more often after a deeper cut and when a starter in his prime", () => {
    const refusals = (input: Partial<typeof base>) =>
      Array.from({ length: 100 }, (_, index) => aiRenewalTerms({ ...base, ...input, random: index / 100 })).filter((terms) => "leaves" in terms).length;
    expect(refusals({ rank: 15 })).toBe(6);
    expect(refusals({ rank: 5 })).toBe(12);
    expect(refusals({ rank: 15, age: 33, minutesShare: 0.1 })).toBeGreaterThan(30);
    expect(aiRenewalTerms({ ...base, random: 0 })).toEqual({ leaves: "player" });
  });
});

describe("season calendar and discipline rules", () => {
  it("closes the winter window on 1 February, or the Monday after when 31 January is a weekend", () => {
    expect(winterWindowClose(2027)).toBe("2027-02-01");
    expect(winterWindowClose(2026)).toBe("2026-02-02");
    expect(winterWindowClose(2028)).toBe("2028-02-01");
    expect(transferWindow("2027-01-31")).toBe(true);
    expect(transferWindow("2027-02-01")).toBe(true);
    expect(transferWindow("2027-02-02")).toBe(false);
    expect(deadlineDay("2027-02-01")).toBe(true);
    expect(deadlineDay("2027-01-31")).toBe(false);
    expect(deadlineDay("2026-09-01")).toBe(true);
  });

  it("scopes cautions and bans per competition, play-offs with their league", () => {
    const league = (id: number, kind: string, data = "{}") => ({ id, kind, confederation: "UEFA", data });
    expect(disciplineScope(undefined)).toBe("friendly");
    expect(disciplineScope(league(4, "league"))).toBe("league:4");
    expect(disciplineScope(league(5, "league"))).not.toBe(disciplineScope(league(4, "league")));
    expect(disciplineScope(league(9, "cup"))).toBe("cup:9");
    expect(disciplineScope(league(10, "cup", JSON.stringify({ playoff: true, leagueId: 4 })))).toBe("league:4");
    expect(disciplineScope(league(11, "continental"))).toBe("UEFA:senior");
    expect(disciplineScope(league(12, "international"))).toBe("national:12");
    expect(LEGACY_DISCIPLINE_SCOPE).toBe("%:%:%");
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
    expect(freeAgentChance({ age: 19, ability: threshold + 30, potential: 80 }, threshold)).toBeLessThan(0.4);
  });

  it("lets unwanted or long-unsigned free agents leave football when a window closes", () => {
    const threshold = leaveThreshold(40);
    expect(leavesFreeAgency({ age: 25, ability: threshold + 5, potential: 70 }, threshold, 60)).toBe(true);
    expect(leavesFreeAgency({ age: 25, ability: threshold + 20, potential: 70 }, threshold, 60)).toBe(false);
    expect(leavesFreeAgency({ age: 25, ability: threshold + 20, potential: 70 }, threshold, 215)).toBe(true);
    expect(leavesFreeAgency({ age: 33, ability: threshold + 20, potential: 70 }, threshold, 60)).toBe(true);
    expect(leavesFreeAgency({ age: 17, ability: 40, potential: threshold + 25 }, threshold, 60)).toBe(false);
    expect(leavesFreeAgency({ age: 17, ability: 40, potential: threshold + 5 }, threshold, 60)).toBe(true);
  });

  it("keeps a synthetic league within 3% per season over six seasons with loans, in-season checks, intake, targets and caps", () => {
    const seasons = projectPopulation("population-balance", 6);
    let previous = seasons[0].start;
    for (const season of seasons) {
      // Inflow (intake, top-ups, trialists) replaces outflow (retirements, left football) instead of inflating.
      const change = (season.end - previous) / previous;
      expect(Math.abs(change), `season ${season.season}: ${season.end} vs ${previous} (${JSON.stringify(season)})`).toBeLessThanOrEqual(0.03);
      expect(Math.abs(season.end - seasons[0].start) / seasons[0].start, `season ${season.season} vs start`).toBeLessThanOrEqual(0.05);
      expect(season.inflow).toBeGreaterThan(0);
      expect(season.outflow).toBeGreaterThan(0);
      previous = season.end;
    }
    // Contracted retirements start at 32+ (people.ts); released veterans leave as free agents in this projection.
    expect(seasons.reduce((total, season) => total + season.retired, 0)).toBeGreaterThan(0);
  });
});

/**
 * Pure projection of one league's population (30 clubs) through the rollover rules and the in-season squad check:
 * generated squads (first team 27, U19/U17 20-24 by 1-July age), season-long loans of first-team players to the user's
 * club in the windows, crisis promotions of youths to the first team, weekly checks (first teams to 25 from spare U19
 * players aged 17+, free agents at the club's level, then U19 players anyway; U19 from spare U17 players, then
 * grassroots trialists; nothing from June), free agents leaving when a window closes, and rollovers (loans back,
 * retirements, AI targets, intake 5-12, first teams from spare U19 players, then released players or trialists, youth
 * top-ups to the minimums, released players).
 */
function projectPopulation(seed: string, seasonCount: number) {
  const random = seedrandom(seed);
  const positions: Position[] = ["GK", "CB", "CB", "LB", "RB", "DM", "CM", "CM", "AM", "LW", "RW", "ST", "GK"];
  type Group = "U17" | "U19" | "Senior";
  type Person = { age: number; early: boolean; ability: number; potential: number; position: Position; club: number | null; group: Group; since?: number; loanFrom?: number };
  const USER_CLUB = -1;
  const levels = Array.from({ length: 30 }, (_, index) => 40 + index);
  const threshold = leaveThreshold(levels[0]);
  const rank: Record<Group, number> = { U17: 0, U19: 1, Senior: 2 };
  // Birth-year competitions: a 16 (18) year-old on 1 July is still U17 (U19) when born in January-June.
  const eligible = (person: Person): Group =>
    person.age <= 15 || (person.age === 16 && person.early) ? "U17" : person.age <= 17 || (person.age === 18 && person.early) ? "U19" : "Senior";
  let people: Person[] = [];
  const add = (club: number, age: number, level: number, group: Group, index: number) => {
    const youth = age < 19 ? youthRatings(random, { reputation: level, academy: level, headOfYouth: 50, age }) : undefined;
    const ability = youth?.ability ?? Math.round(level * 0.66 + 22 + (random() - 0.5) * 12);
    const person: Person = { age, early: random() < 0.5, ability, potential: youth?.potential ?? ability + Math.max(0, 24 - age), position: positions[index % positions.length], club, group };
    people.push(person);
    return person;
  };
  const squad = (club: number, group: Group) => people.filter((person) => person.club === club && person.group === group);
  const keepers = (list: Person[]) => list.filter((person) => person.position === "GK").length;
  const byAbility = (left: Person, right: Person) => right.ability - left.ability;
  const needsOf = (members: Person[], minimum: number) => {
    const goalkeepers = Math.max(0, 2 - keepers(members));
    return [...Array(Math.max(goalkeepers, minimum - members.length)).keys()].map((index): Position => (index < goalkeepers ? "GK" : "CM"));
  };
  levels.forEach((level, id) => {
    for (let index = 0; index < 27; index++) add(id, 19 + (index % 16), level, "Senior", index);
    for (const [group, young] of [["U19", 16], ["U17", 14]] as const)
      for (let index = 0, size = 20 + Math.floor(random() * 5); index < size; index++)
        add(id, random() < 0.1 ? young : young + 1 + Math.floor(random() * 2), level, group, index);
  });
  const flows = { signed: 0 };
  const check = () => {
    let created = 0;
    for (const person of people) if (person.club !== null && rank[eligible(person)] > rank[person.group]) person.group = eligible(person);
    levels.forEach((level, id) => {
      // First teams: a U19 player aged 17+ the U19 can spare, a free agent at the club's level, then a U19 player anyway.
      const band = level * 0.66 + 22;
      for (const need of needsOf(squad(id, "Senior"), SQUAD_MINIMUMS.Senior)) {
        const fits = (person: Person) => (need === "GK") === (person.position === "GK");
        const u19 = squad(id, "U19");
        const ready = u19.filter((person) => person.age >= 17 && fits(person)).sort(byAbility);
        const spare = u19.length > SQUAD_MINIMUMS.U19 && (need !== "GK" || keepers(u19) > 2) ? ready[0] : undefined;
        const free = spare
          ? undefined
          : people.find((person) => person.club === null && eligible(person) === "Senior" && person.age <= 34 && person.ability >= band - 10 && person.ability <= band + 6 && fits(person));
        if (free) {
          free.club = id;
          free.group = "Senior";
          flows.signed++;
        } else if (spare ?? ready[0]) (spare ?? ready[0]).group = "Senior";
      }
      for (const group of ["U19", "U17"] as const) {
        const members = squad(id, group);
        for (const need of needsOf(members, SQUAD_MINIMUMS[group])) {
          const spare = group === "U19" ? squad(id, "U17") : [];
          const fits = spare.filter((person) => (need === "GK") === (person.position === "GK"));
          if (spare.length > SQUAD_MINIMUMS.U17 && fits.length && (need !== "GK" || keepers(spare) > 2)) fits[0].group = "U19";
          else {
            add(id, group === "U17" ? 14 + Math.floor(random() * 2) : 16 + Math.floor(random() * 2), level, group, need === "GK" ? 0 : 6);
            created++;
          }
        }
      }
    });
    return created;
  };
  // Every AI squad at its minimum with two goalkeepers after each weekly check.
  const assertMinimums = (label: string) => {
    for (const id of levels.keys())
      for (const group of ["Senior", "U19", "U17"] as const) {
        const members = squad(id, group);
        expect(members.length, `${label} club ${id} ${group}`).toBeGreaterThanOrEqual(SQUAD_MINIMUMS[group]);
        expect(keepers(members), `${label} club ${id} ${group} GK`).toBeGreaterThanOrEqual(2);
      }
  };
  const results: { season: number; start: number; end: number; inflow: number; outflow: number; trialists: number; created: number; retired: number; left: number; loans: number; signed: number }[] = [];
  for (let season = 1; season <= seasonCount; season++) {
    const start = people.length;
    flows.signed = 0;
    // In season: weekly checks, loans to the user's club and crisis promotions of the best youth aged 16+, windows closing in weeks 9 and 31.
    let trialists = check();
    const crisis = new Set([...levels.keys()].filter(() => random() < 0.15));
    let left = 0;
    let loans = 0;
    for (let week = 1; week <= 44; week++) {
      if ((week <= 9 || (week >= 27 && week <= 31)) && random() < 0.5) {
        const from = Math.floor(random() * levels.length);
        const players = squad(from, "Senior").filter((person) => person.age <= 31);
        const loanee = players[Math.floor(random() * players.length)];
        if (loanee) {
          loanee.loanFrom = from;
          loanee.club = USER_CLUB;
          loans++;
        }
      }
      for (const id of crisis) {
        // Only a youth his squad can spare (the minimum and two goalkeepers stay).
        const youth = people
          .filter((person) => person.club === id && person.group !== "Senior" && person.age >= 16)
          .sort(byAbility)
          .find((person) => {
            const mates = squad(id, person.group);
            return mates.length > SQUAD_MINIMUMS[person.group as "U17" | "U19"] && (person.position !== "GK" || keepers(mates) > 2);
          });
        if (youth && week >= 10 && week < 30) youth.group = "Senior";
      }
      if (week === 9 || week === 31)
        people = people.filter((person) => person.club !== null || !leavesFreeAgency(person, threshold, week === 9 ? 63 : 215) || (left++, false));
      if (week < 44) {
        trialists += check();
        assertMinimums(`season ${season} week ${week}`);
      }
    }
    // Rollover: season-long loans end first.
    for (const person of people)
      if (person.loanFrom !== undefined) {
        person.club = person.loanFrom;
        person.loanFrom = undefined;
      }
    let retired = 0;
    let created = 0;
    const leavers = new Set<Person>();
    for (const person of people) {
      person.age++;
      person.ability = Math.min(person.potential, person.ability + (person.age <= 23 ? (person.potential - person.ability) * 0.3 : person.age >= 31 ? -2 : 0));
      if (person.club === null) leavers.add(person);
      else if (person.group === "Senior" && random() < seniorRetirementChance({ age: person.age, ability: person.ability, position: person.position })) {
        leavers.add(person);
        retired++;
      } else if (rank[eligible(person)] > rank[person.group]) person.group = eligible(person);
    }
    const released: Person[] = [];
    levels.forEach((level, id) => {
      const intake = intakeSize(club(level), context(50), random);
      const current = (group: Group) => squad(id, group).filter((person) => !leavers.has(person));
      released.push(...selectSquad(current("Senior"), 27, 3).rest);
      released.push(...selectSquad(current("U19"), AI_YOUTH_TARGET, 2).rest);
      released.push(...selectSquad(current("U17"), AI_YOUTH_TARGET - intake, 2).rest);
      for (const person of released) person.club = null;
      for (let index = 0; index < intake; index++) add(id, random() < 0.55 ? 14 : 15, level, "U17", index + season);
      created += intake;
    });
    for (const person of released)
      if (person.age >= 18 && person.ability < threshold) leavers.add(person);
    levels.forEach((level, id) => {
      const current = (group: Group) => squad(id, group).filter((person) => !leavers.has(person));
      for (const group of ["Senior", "U19", "U17"] as const) {
        for (let gap = SQUAD_MINIMUMS[group] - current(group).length; gap > 0; gap--) {
          // First teams call up a U19 player aged 17+ the U19 can spare before a released player or a trialist.
          const u19 = group === "Senior" ? current("U19") : [];
          const prospect = u19.length > SQUAD_MINIMUMS.U19
            ? u19.filter((person) => person.age >= 17 && (person.position !== "GK" || keepers(u19) > 2)).sort(byAbility)[0]
            : undefined;
          const free = prospect ? undefined : released.find((person) => person.club === null && !leavers.has(person) && eligible(person) === group);
          if (prospect) prospect.group = "Senior";
          else if (free) {
            free.club = id;
            free.group = group;
          } else {
            add(id, group === "Senior" ? 19 : group === "U19" ? 17 : 15, level, group, gap);
            created++;
          }
        }
      }
    });
    for (const person of released)
      if (person.club === null && !leavers.has(person)) {
        if (random() >= freeAgentChance(person, threshold)) leavers.add(person);
        else person.since = season;
      }
    left += leavers.size - retired;
    people = people.filter((person) => !leavers.has(person));
    for (const id of levels.keys())
      for (const group of ["Senior", "U19", "U17"] as const) {
        const size = squad(id, group).length;
        expect(size, `season ${season} club ${id} ${group}`).toBeGreaterThanOrEqual(SQUAD_MINIMUMS[group]);
        expect(size, `season ${season} club ${id} ${group}`).toBeLessThanOrEqual(group === "Senior" ? SQUAD_CAPS.firstTeam : SQUAD_CAPS.youth);
      }
    results.push({ season, start, end: people.length, inflow: trialists + created, outflow: retired + left, trialists, created, retired, left, loans, signed: flows.signed });
  }
  return results;
}
