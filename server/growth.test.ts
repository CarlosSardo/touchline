import seedrandom from "seedrandom";
import { describe, expect, it } from "vitest";
import {
  developBody,
  exactAge,
  growBody,
  heightAt,
  heightShare,
  initialBody,
  peakHeightVelocityAge,
  potentialVolatility,
  weeklyDevelopment,
  weightAt,
  type BodyGrowth,
  type DevelopmentInput,
} from "./growth.ts";
import { addDays, currentAttributes, potentialInfluences } from "../shared/rules.ts";
import type { NationSpec } from "../shared/world-catalog/index.ts";
import type { Player, PlayerProfile } from "../shared/types.ts";

const average: BodyGrowth = { adultHeight: 181, adultWeight: 76, maturation: 0 };
const catalog = (height: number) => ({
  nationByCode: () => ({ physique: { height, heightSd: 6 } }) as NationSpec,
});

/** Four-weekly development steps, as developPlayers applies them to other clubs' players. */
function career(growth: BodyGrowth, birthDate: string, from: string, years: number, seed: string) {
  const random = seedrandom(seed);
  const age = exactAge(birthDate, from);
  let body = {
    height: Math.round(heightAt(growth, age)),
    weight: Math.round(weightAt(growth, age)),
    growth,
  };
  const trace = [{ date: from, ...body }];
  let date = from;
  for (let step = 0; step < Math.round((years * 365.25) / 28); step++) {
    const to = addDays(date, 28);
    body = { ...growBody(body, { birthDate, from: date, to, random }), growth };
    trace.push({ date: to, ...body });
    date = to;
  }
  return trace;
}

describe("adolescent growth curve", () => {
  it("follows boys' share-of-adult-height norms and plateaus by 19-21", () => {
    expect(heightShare(12)).toBeGreaterThan(0.82);
    expect(heightShare(12)).toBeLessThan(0.86);
    expect(heightShare(14)).toBeGreaterThan(0.9);
    expect(heightShare(14)).toBeLessThan(0.935);
    expect(heightShare(16)).toBeGreaterThan(0.975);
    expect(heightShare(18)).toBeGreaterThan(0.996);
    expect(heightShare(19)).toBeGreaterThan(0.999);
    expect(heightShare(21)).toBeGreaterThan(0.9999);
    for (let age = 10; age < 24; age += 0.25)
      expect(heightShare(age + 0.25)).toBeGreaterThanOrEqual(heightShare(age));
  });

  it("peaks at about 13.5-14.5 and shifts with maturation tempo", () => {
    const mean = peakHeightVelocityAge(average);
    expect(mean).toBeGreaterThanOrEqual(13.5);
    expect(mean).toBeLessThanOrEqual(14.5);
    const early = peakHeightVelocityAge({ ...average, maturation: -1 });
    const late = peakHeightVelocityAge({ ...average, maturation: 1 });
    expect(early).toBeLessThan(mean - 1);
    expect(late).toBeGreaterThan(mean + 1);
  });
});

describe("growBody", () => {
  it("never shrinks youths and reaches adult height by 21", () => {
    for (const maturation of [-1, -0.4, 0, 0.5, 1]) {
      const growth = { ...average, maturation };
      const trace = career(growth, "2012-03-10", "2026-07-01", 9, `grow:${maturation}`);
      for (let index = 1; index < trace.length; index++)
        expect(trace[index].height).toBeGreaterThanOrEqual(trace[index - 1].height);
      const at = (age: number) =>
        trace.find((entry) => entry.date >= `${2012 + age}-03-10`)!.height;
      expect(Math.abs(at(21) - growth.adultHeight)).toBeLessThanOrEqual(1);
      expect(at(21) - at(19)).toBeLessThanOrEqual(maturation > 0.5 ? 2 : 1);
      expect(at(17) - at(14)).toBeGreaterThanOrEqual(maturation < 0 ? 3 : 8);
      expect(trace.every((entry) => entry.height >= 140 && entry.height <= 210)).toBe(true);
    }
  });

  it("puts on weight with height and muscle, then drifts at most about 2 kg a year", () => {
    const growth = { ...average, maturation: 0.2 };
    const trace = career(growth, "2012-03-10", "2026-07-01", 21, "weight");
    const at = (age: number) =>
      trace.find((entry) => entry.date >= `${2012 + age}-03-10`)!;
    expect(at(18).weight).toBeGreaterThan(at(14).weight + 8);
    expect(Math.abs(at(25).weight - growth.adultWeight)).toBeLessThanOrEqual(4);
    for (let age = 26; age < 34; age++)
      expect(Math.abs(at(age + 1).weight - at(age).weight)).toBeLessThanOrEqual(3);
    expect(Math.abs(at(33).weight - growth.adultWeight)).toBeLessThanOrEqual(6);
  });

  it("keeps adult height fixed", () => {
    const random = seedrandom("adult");
    const body = { height: 184, weight: 80, growth: { adultHeight: 184, adultWeight: 80, maturation: 0 } };
    const next = growBody(body, { birthDate: "1998-01-01", from: "2026-07-01", to: "2027-07-01", random });
    expect(next.height).toBe(184);
    expect(Math.abs(next.weight - 80)).toBeLessThanOrEqual(2);
  });
});

describe("initialBody and developBody", () => {
  it("uses the nation's physique and position, deterministically", () => {
    const heights = (height: number, position: "GK" | "LW") =>
      Array.from({ length: 300 }, (_, index) =>
        initialBody(seedrandom(`body:${index}`), { nationCode: "XX", position, birthDate: "1998-05-01", date: "2026-07-01" }, catalog(height)).height,
      ).reduce((total, value) => total + value, 0) / 300;
    expect(heights(186, "LW") - heights(174, "LW")).toBeGreaterThan(9);
    expect(heights(181, "GK") - heights(181, "LW")).toBeGreaterThan(8);
    const first = initialBody(seedrandom("same"), { nationCode: "XX", position: "CB", birthDate: "2012-01-01", date: "2026-07-01" }, catalog(181));
    const second = initialBody(seedrandom("same"), { nationCode: "XX", position: "CB", birthDate: "2012-01-01", date: "2026-07-01" }, catalog(181));
    expect(second).toEqual(first);
    expect(first.height).toBeLessThan(first.growth.adultHeight);
    expect(first.growth.maturation).toBeGreaterThanOrEqual(-1);
    expect(first.growth.maturation).toBeLessThanOrEqual(1);
  });

  it("infers targets for bodies stored without them and reports the spurt", () => {
    const identity = { height: 165, weight: 52 } as Parameters<typeof developBody>[0];
    const result = developBody(identity, {
      birthDate: "2012-06-01",
      from: "2026-07-01",
      to: "2026-07-29",
      random: seedrandom("infer"),
    });
    expect(result.changed).toBe(true);
    expect(identity.growth?.adultHeight).toBeGreaterThan(170);
    expect(identity.height).toBeGreaterThanOrEqual(165);
    expect(result.spurt).toBe(true);
  });
});

type Career = Partial<DevelopmentInput> & { from: number; to: number };

/** Season-end abilities of a player developed weekly from `from` to `to` (no potential noise unless given). */
function footballCareer(input: Career) {
  let state = { ability: input.ability ?? 30, potential: input.potential ?? 75, bank: 0 };
  const trace = new Map<number, number>([[input.from, state.ability]]);
  for (let week = 0; week < (input.to - input.from) * 52; week++) {
    state = weeklyDevelopment({
      goalkeeper: false,
      minutesShare: 0.5,
      environment: 1,
      professionalism: 50,
      injured: false,
      drift: 0,
      volatility: 0,
      noise: 0,
      ...input,
      ...state,
      age: input.from + week / 52,
    });
    if ((week + 1) % 52 === 0) trace.set(input.from + (week + 1) / 52, state.ability);
  }
  return trace;
}

describe("football development", () => {
  it("grows steeply from 16 to 21, peaks in the mid-to-late twenties and declines gradually from 30", () => {
    const trace = footballCareer({ from: 15, to: 37 });
    const at = (age: number) => trace.get(age)!;
    expect(at(18) - at(15)).toBeGreaterThan(at(27) - at(24));
    expect((at(21) - at(15)) / (75 - 30)).toBeGreaterThan(0.4);
    const peak = [...trace].reduce((best, entry) => (entry[1] > best[1] ? entry : best));
    expect(peak[0]).toBeGreaterThanOrEqual(24);
    expect(peak[0]).toBeLessThanOrEqual(31);
    expect(at(30) - at(31)).toBeLessThan(1.5);
    expect(at(30) - at(35)).toBeGreaterThan(4);
    expect(at(30) - at(35)).toBeLessThan(16);
    expect(at(33) - at(34)).toBeGreaterThan(at(30) - at(31));
  });

  it("develops and ages goalkeepers later", () => {
    const outfield = footballCareer({ from: 28, to: 34, ability: 75, potential: 75 });
    const keeper = footballCareer({ from: 28, to: 34, ability: 75, potential: 75, goalkeeper: true });
    expect(keeper.get(34)!).toBeGreaterThan(outfield.get(34)! + 2);
    expect(keeper.get(31)!).toBeGreaterThanOrEqual(74);
  });

  it("grows faster with minutes, training and professionalism", () => {
    const grown = (input: Partial<DevelopmentInput>) => footballCareer({ from: 17, to: 20, ...input }).get(20)!;
    expect(grown({ minutesShare: 0.9 })).toBeGreaterThan(grown({ minutesShare: 0.05 }) + 3);
    expect(grown({ environment: 1.3 })).toBeGreaterThan(grown({ environment: 0.7 }));
    expect(grown({ professionalism: 90 })).toBeGreaterThan(grown({ professionalism: 20 }));
  });

  it("declines slower with professionalism and good staff, faster when injured", () => {
    const lost = (input: Partial<DevelopmentInput>) =>
      80 - footballCareer({ from: 33, to: 34, ability: 80, potential: 80, ...input }).get(34)!;
    expect(lost({ professionalism: 90 })).toBeLessThan(lost({ professionalism: 20 }));
    expect(lost({ environment: 1.3 })).toBeLessThan(lost({ environment: 0.7 }));
    expect(lost({ injured: true })).toBeGreaterThan(lost({}));
    expect(lost({})).toBeGreaterThan(0.5);
  });

  it("keeps potential centred: no drift without influences, and unrealised potential fades after the early twenties", () => {
    const young = weeklyDevelopment({ age: 18, goalkeeper: false, ability: 50, potential: 70, bank: 0, minutesShare: 0.5, environment: 1, professionalism: 50, injured: false, drift: 0, volatility: 15, noise: 0 });
    expect(young.potential).toBe(70);
    let state = { ability: 60, potential: 75, bank: 0 };
    for (let week = 0; week < 52; week++)
      state = weeklyDevelopment({ age: 27, goalkeeper: false, ...state, minutesShare: 0.5, environment: 1, professionalism: 50, injured: false, drift: 0, volatility: 5, noise: 0 });
    expect(state.potential).toBeLessThan(72);
    expect(state.potential).toBeGreaterThanOrEqual(state.ability);
    expect(potentialVolatility(16)).toBeGreaterThan(potentialVolatility(26));
  });

  it("scores an average player at an average club close to zero on potential influences", () => {
    const player = { age: 17, position: "CM", injury_until: null, morale: 70, potential: 70, volatility: 10 } as unknown as Player;
    const profile = {
      personality: { professionalism: 57, ambition: 57, discipline: 58, pressureHandling: 57 },
      lifestyle: "gym-rat",
      mentalHealth: { motivation: 75, burnout: 12, anxiety: 24, confidence: 65 },
    } as unknown as PlayerProfile;
    const context = { staff: 50, academy: 53, chemistry: 69, fit: 77, culture: "Family", director: 40, fans: 72, media: 50, tournament: 0, intensity: 60, lifestyleImpact: 60, performance: 0, minutesShare: 0.5 };
    const average = potentialInfluences(player, profile, context);
    expect(Math.abs(average.change * 52)).toBeLessThan(0.3);
    expect(average.factors.lifestyle).toBe(0);
    const starring = potentialInfluences(player, profile, { ...context, performance: 1, minutesShare: 0.95 });
    const benched = potentialInfluences(player, profile, { ...context, performance: -0.5, minutesShare: 0.05 });
    expect(starring.change).toBeGreaterThan(0);
    expect(benched.change).toBeLessThan(0);
    const veteran = potentialInfluences({ ...player, age: 31 } as Player, profile, { ...context, performance: 1, minutesShare: 0.95 });
    expect(veteran.change).toBeLessThan(starring.change / 5);
  });

  it("gives the engine the attributes the player page shows", () => {
    const profile = { baseAbility: 30, attributes: { technical: { finishing: 40 }, mental: {}, physical: { pace: 95 }, tactical: {}, goalkeeper: { reflexes: 20 } } } as unknown as PlayerProfile;
    const current = currentAttributes(profile, 70);
    expect(current.technical.finishing).toBe(80);
    expect(current.physical.pace).toBe(99);
    expect(currentAttributes(profile, 10).goalkeeper.reflexes).toBe(1);
  });
});
