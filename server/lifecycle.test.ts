import { describe, expect, it } from "vitest";
import seedrandom from "seedrandom";
import {
  CAREER_RULES,
  contractYearsLeft,
  retirementOnset,
  seniorRetirementChance,
  staffCareerDefaults,
  staffDevelopment,
  staffMorale,
  staffRetirementChance,
} from "./people.ts";
import { decayedKnowledge, SCOUTING_KNOWLEDGE_DECAY, starterAffiliateEligible } from "./club-support.ts";
import { eventWeights, pickEventKind, type EventContext } from "./events.ts";
import { resultLine } from "./media.ts";
import { plannedRetirement } from "./notifications.ts";

describe("senior retirement", () => {
  const chance = (input: Partial<Parameters<typeof seniorRetirementChance>[0]>) =>
    seniorRetirementChance({ age: 34, ability: 60, position: "CM", contractYears: 0, ...input });

  it("starts later for goalkeepers and for better players", () => {
    expect(retirementOnset(60, "GK") - retirementOnset(60, "CM")).toBe(CAREER_RULES.retirement.keeperDelay);
    expect(retirementOnset(85, "ST")).toBeGreaterThan(retirementOnset(40, "ST"));
    expect(chance({ position: "GK" })).toBeLessThan(chance({}));
    expect(chance({ age: 30 })).toBe(0);
  });

  it("is rare for a player with years left and higher for club-less or long-injured veterans", () => {
    expect(chance({ contractYears: 1 })).toBeLessThan(chance({}) * 0.5);
    expect(chance({ contractYears: 3 })).toBeLessThan(chance({ contractYears: 1 }));
    expect(chance({ clubless: true })).toBeGreaterThan(chance({}));
    expect(chance({ injuryDays: 200 })).toBeGreaterThan(chance({}));
  });

  it("ends every career by the position's last age", () => {
    expect(chance({ age: CAREER_RULES.retirement.last.outfield })).toBe(1);
    expect(chance({ age: CAREER_RULES.retirement.last.outfield, position: "GK" })).toBeLessThan(1);
    expect(chance({ age: CAREER_RULES.retirement.last.keeper, position: "GK" })).toBe(1);
  });

  it("gives a realistic retirement-age distribution (keepers ~2 years later, some outfielders at 37+)", () => {
    const random = seedrandom("retirement-distribution");
    const ages = { GK: [] as number[], OUT: [] as number[] };
    for (let index = 0; index < 6000; index++) {
      const keeper = index % 8 === 0;
      let ability = 45 + random() * 35;
      let years = Math.floor(random() * 3);
      for (let age = 30; age <= 45; age++) {
        if (random() < seniorRetirementChance({ age, ability, position: keeper ? "GK" : "CB", contractYears: years })) {
          ages[keeper ? "GK" : "OUT"].push(age);
          break;
        }
        years = years > 0 ? years - 1 : random() < 0.6 ? 1 : 0;
        ability -= keeper ? (age >= 33 ? 1.5 : 0) : 2;
      }
    }
    const mean = (list: number[]) => list.reduce((total, age) => total + age, 0) / list.length;
    const share = (list: number[], min: number) => list.filter((age) => age >= min).length / list.length;
    // A 30-year-old cohort (no earlier exits): /tmp probe of full careers gives outfield 34.6, keepers 36.7.
    expect(mean(ages.OUT)).toBeGreaterThan(33.5);
    expect(mean(ages.OUT)).toBeLessThan(36.5);
    expect(mean(ages.GK) - mean(ages.OUT)).toBeGreaterThan(1.5);
    expect(share(ages.OUT, 37)).toBeGreaterThan(0.03);
    expect(share(ages.GK, 39)).toBeGreaterThan(0.05);
    expect(Math.max(...ages.OUT)).toBeLessThanOrEqual(CAREER_RULES.retirement.last.outfield);
  });

  it("counts contract years from the rollover day", () => {
    expect(contractYearsLeft("2027-06-30", "2027-07-01")).toBe(0);
    expect(contractYearsLeft("2028-06-30", "2027-07-01")).toBe(1);
    expect(contractYearsLeft("2030-06-30", "2027-07-01")).toBe(3);
    expect(contractYearsLeft(null, "2027-07-01")).toBe(0);
  });

  it("decides the spring notice deterministically per player and season", () => {
    const player = { id: 7, birth_date: "1990-03-01", ability: 55, position: "CB" as const, contract_end: "2027-06-30", injury_until: null };
    const first = plannedRetirement("seed", 2026, player, "2027-05-01");
    expect(plannedRetirement("seed", 2026, player, "2027-05-01")).toBe(first);
    expect(plannedRetirement("seed", 2026, { ...player, birth_date: "2000-03-01" }, "2027-05-01")).toBe(false);
    expect(plannedRetirement("seed", 2026, { ...player, birth_date: "1980-03-01" }, "2027-05-01")).toBe(true);
  });
});

describe("staff careers", () => {
  it("draws an age and a personal ceiling at or above today's ability", () => {
    const random = seedrandom("staff-defaults");
    for (let index = 0; index < 200; index++) {
      const ability = 20 + Math.floor(random() * 79);
      const career = staffCareerDefaults({ ability, ambition: 25 + Math.floor(random() * 66) }, 2027, random);
      const age = 2027 - career.birthYear;
      expect(age).toBeGreaterThanOrEqual(CAREER_RULES.staff.startAge[0]);
      expect(age).toBeLessThanOrEqual(CAREER_RULES.staff.startAge[1]);
      expect(career.ceiling).toBeGreaterThanOrEqual(Math.min(ability, CAREER_RULES.staff.maxCeiling));
      expect(career.ceiling).toBeLessThanOrEqual(CAREER_RULES.staff.maxCeiling);
    }
  });

  it("grows toward the ceiling without passing it, then declines slowly from 60", () => {
    const random = seedrandom("staff-growth");
    let ability = 50;
    for (let pass = 0; pass < 13 * 10; pass++) ability = staffDevelopment({ ability, ceiling: 64, age: 40, ambition: 90 }, random());
    expect(ability).toBe(64);
    let season = 0;
    let first = 50;
    for (let pass = 0; pass < 13; pass++) {
      const next = staffDevelopment({ ability: first, ceiling: 64, age: 40, ambition: 50 }, random());
      season += next - first;
      first = next;
    }
    expect(season).toBeGreaterThan(1);
    expect(season).toBeLessThan(8);
    const old = { ability: 70, ceiling: 90, age: 64, ambition: 90 };
    expect(staffDevelopment(old, 0.1)).toBe(69);
    expect(staffDevelopment(old, 0.9)).toBe(70);
    expect(staffDevelopment({ ability: 99, ceiling: 80, age: 45, ambition: 50 }, 0.5)).toBe(98);
  });

  it("pulls morale back from the extremes within a season", () => {
    for (const start of [1, 99]) {
      let morale = start;
      for (let pass = 0; pass < 13; pass++) morale = staffMorale(morale, "Ambitious");
      expect(Math.abs(morale - CAREER_RULES.staff.moraleTarget.Ambitious)).toBeLessThan(10);
    }
  });

  it("retires staff from 63 and always by 70", () => {
    expect(staffRetirementChance(62)).toBe(0);
    expect(staffRetirementChance(63)).toBeGreaterThan(0);
    expect(staffRetirementChance(67)).toBeGreaterThan(staffRetirementChance(64));
    expect(staffRetirementChance(70)).toBe(1);
  });
});

describe("scouting knowledge and affiliates", () => {
  it("fades unrefreshed knowledge down to the public floor", () => {
    expect(decayedKnowledge(100)).toBe(100 - SCOUTING_KNOWLEDGE_DECAY.perPass);
    expect(decayedKnowledge(SCOUTING_KNOWLEDGE_DECAY.floor + 1)).toBe(SCOUTING_KNOWLEDGE_DECAY.floor);
    expect(decayedKnowledge(10)).toBe(10);
    let knowledge = 100;
    for (let pass = 0; pass < 13; pass++) knowledge = decayedKnowledge(knowledge);
    expect(knowledge).toBeGreaterThan(60);
  });

  it("gives starter affiliates to professional-level clubs only", () => {
    expect(starterAffiliateEligible({ tier: 1, reputation: 80 })).toBe(true);
    expect(starterAffiliateEligible({ tier: 4, reputation: 30 })).toBe(true);
    expect(starterAffiliateEligible({ tier: 9, reputation: 20 })).toBe(false);
    expect(starterAffiliateEligible({ tier: 6, reputation: 60 })).toBe(true);
  });
});

describe("unexpected events", () => {
  const base: EventContext = { month: 10, countryCode: "EN", confederation: "UEFA", fixture: null, hasPlayers: true, recent: [] };
  const weight = (context: Partial<EventContext>, kind: string) =>
    eventWeights({ ...base, ...context }).find(([entry]) => entry === kind)![1];

  it("fits the season and the fixture list", () => {
    expect(weight({ month: 7, fixture: { home: true } }, "frozen-pitch")).toBe(0);
    expect(weight({ month: 1, fixture: { home: true } }, "frozen-pitch")).toBeGreaterThan(0);
    expect(weight({ month: 1, fixture: { home: false } }, "frozen-pitch")).toBe(0);
    expect(weight({ month: 1 }, "heatwave")).toBe(0);
    expect(weight({ month: 7 }, "heatwave")).toBeGreaterThan(0);
    expect(weight({ month: 6 }, "training-ground")).toBe(0);
    expect(weight({ fixture: null }, "travel")).toBe(0);
    expect(weight({ fixture: { home: false } }, "travel")).toBeGreaterThan(0);
    expect(weight({ hasPlayers: false }, "agent-interview")).toBe(0);
  });

  it("flips the seasons in the southern hemisphere and keeps frost to cold-winter leagues", () => {
    expect(weight({ month: 1, countryCode: "AR", confederation: "CONMEBOL" }, "heatwave")).toBeGreaterThan(0);
    expect(weight({ month: 7, countryCode: "BR", confederation: "CONMEBOL", fixture: { home: true } }, "frozen-pitch")).toBe(0);
  });

  it("does not repeat one of the last four kinds and offers at least eight kinds over a year", () => {
    expect(weight({ recent: ["sponsor", "travel", "community", "illness"] }, "sponsor")).toBe(0);
    expect(weight({ recent: ["travel", "community", "illness", "heatwave", "sponsor"] }, "sponsor")).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (let month = 1; month <= 12; month++)
      for (const fixture of [null, { home: true }, { home: false }])
        for (let roll = 0; roll < 1; roll += 0.05) seen.add(pickEventKind({ ...base, month, fixture }, roll)!);
    expect(seen.size).toBeGreaterThanOrEqual(8);
  });
});

describe("media", () => {
  it("tells the score from the subject's side", () => {
    expect(resultLine({ home_id: 2, home_goals: 3, away_goals: 0 }, 1, "Rovers")).toBe("0-3 defeat at Rovers");
    expect(resultLine({ home_id: 1, home_goals: 2, away_goals: 1 }, 1, "Rovers")).toBe("2-1 win against Rovers");
    expect(resultLine({ home_id: 2, home_goals: 1, away_goals: 1 }, 1)).toBe("1-1 draw");
  });
});
