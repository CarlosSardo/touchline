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
  weightAt,
  type BodyGrowth,
} from "./growth.ts";
import { addDays } from "../shared/rules.ts";
import type { NationSpec } from "../shared/world-catalog/index.ts";

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
