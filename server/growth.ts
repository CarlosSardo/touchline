// Pure physical-growth model for players (world version 4): adult targets, adolescent growth curve, adult weight drift.
import type seedrandom from "seedrandom";
import { nationByCode, type CatalogLookup } from "../shared/world-catalog/index.ts";
import { clamp, daysBetween } from "../shared/rules.ts";
import type { PlayerProfile, Position } from "../shared/types.ts";

/** Adult targets plus maturation tempo (-1 early … 1 late). */
export type BodyGrowth = NonNullable<PlayerProfile["identity"]["growth"]>;

// Preece–Baines model 1 expressed as a share of adult height, fitted to boys' percentage-of-adult-height norms
// (12: 84%, 13: 87%, 14: 92%, 15: 96%, 16: 98%, 17: 99.3%, 18: 99.8%); peak height velocity ≈ 14.0 on the mean curve.
const CURVE = { theta: 14.3, share: 0.929, s0: 0.08206, s1: 1.152 };
/** Years of tempo shift for maturation ±1 (age at peak height velocity ≈ 12.75–15.25). */
export const MATURATION_YEARS = 1.25;
/** Muscle and body-composition maturity is reached at about this age. */
export const FULL_MUSCLE_AGE = 25;
const DEFAULT_HEIGHT = 181;
const DEFAULT_HEIGHT_SD = 6.5;
const BASE_BMI = 23.1;

// Adult height offsets (cm) by position around the nation's footballer mean; centred on the 25-player roster mix.
const POSITION_HEIGHT: Record<Position, number> = {
  GK: 7.5,
  CB: 4.5,
  LB: -3,
  RB: -3,
  DM: 0,
  CM: -1.5,
  AM: -4,
  LW: -4.5,
  RW: -4.5,
  ST: 1.5,
};
/** Between-position variance of the offsets above; removed from the nation's total spread. */
const POSITION_VARIANCE = 16.5;
const POSITION_BMI: Record<Position, number> = {
  GK: 0.3,
  CB: 0.5,
  LB: -0.2,
  RB: -0.2,
  DM: 0.1,
  CM: -0.1,
  AM: -0.4,
  LW: -0.5,
  RW: -0.5,
  ST: 0.4,
};

const round1 = (value: number) => Math.round(value * 10) / 10;

function gaussian(random: () => number) {
  const u = Math.max(1e-12, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/** Unbiased integer rounding: small drifts accumulate in expectation instead of vanishing. */
function stochasticRound(value: number, random: () => number) {
  const floor = Math.floor(value);
  return floor + (random() < value - floor ? 1 : 0);
}

export const exactAge = (birthDate: string, date: string) =>
  daysBetween(birthDate, date) / 365.2425;

/** Share of adult height reached at a biological age. */
export function heightShare(biologicalAge: number) {
  const tau = biologicalAge - CURVE.theta;
  return clamp(
    1 -
      (2 * (1 - CURVE.share)) /
        (Math.exp(CURVE.s0 * tau) + Math.exp(CURVE.s1 * tau)),
    0.4,
    1,
  );
}

/** Early developers (maturation < 0) are biologically older than their calendar age. */
export const biologicalAge = (growth: BodyGrowth, age: number) =>
  age - growth.maturation * MATURATION_YEARS;

export const heightAt = (growth: BodyGrowth, age: number) =>
  growth.adultHeight * heightShare(biologicalAge(growth, age));

/** Height velocity in cm per year at an age. */
export function heightVelocity(growth: BodyGrowth, age: number) {
  const step = 1 / 52;
  return (heightAt(growth, age + step) - heightAt(growth, age - step)) / (2 * step);
}

/** Age of peak height velocity (numerical search on the curve). */
export function peakHeightVelocityAge(growth: BodyGrowth) {
  let best = 10;
  let velocity = -1;
  for (let age = 10; age <= 19; age += 0.02) {
    const current = heightVelocity(growth, age);
    if (current > velocity) {
      velocity = current;
      best = age;
    }
  }
  return Math.round(best * 100) / 100;
}

/** BMI relative to the adult value while muscle and body composition mature (0.86 at 14, 1 at 25). */
function bmiShare(age: number) {
  if (age >= FULL_MUSCLE_AGE) return 1;
  if (age < 14) return Math.max(0.78, 0.86 - 0.012 * (14 - age));
  return 1 - 0.14 * ((FULL_MUSCLE_AGE - age) / 11) ** 1.6;
}

/** Expected weight on the growth curve; the maturation tempo fades out by FULL_MUSCLE_AGE. */
export function weightAt(growth: BodyGrowth, age: number) {
  if (age >= FULL_MUSCLE_AGE) return growth.adultWeight;
  const adultBmi = growth.adultWeight / (growth.adultHeight / 100) ** 2;
  const muscleAge =
    age -
    growth.maturation *
      MATURATION_YEARS *
      clamp((FULL_MUSCLE_AGE - age) / 10, 0, 1);
  return adultBmi * bmiShare(muscleAge) * (heightAt(growth, age) / 100) ** 2;
}

function bodyType(bmi: number, adultHeight: number) {
  if (bmi < 22.3) return "Lean";
  if (bmi < 23.9) return "Athletic";
  return adultHeight >= 181 ? "Powerful" : "Compact";
}

/** Adult targets from the nation's footballer physique (catalog) and position; body at `date`. */
export function initialBody(
  random: seedrandom.PRNG,
  input: {
    nationCode: string;
    position: Position;
    birthDate: string;
    date: string;
  },
  catalog: Pick<CatalogLookup, "nationByCode"> = { nationByCode },
): { height: number; weight: number; bodyType: string; growth: BodyGrowth } {
  const physique = catalog.nationByCode(input.nationCode)?.physique;
  const mean = physique?.height ?? DEFAULT_HEIGHT;
  const spread = physique?.heightSd ?? DEFAULT_HEIGHT_SD;
  const withinPosition = Math.sqrt(Math.max(9, spread ** 2 - POSITION_VARIANCE));
  const adultHeight = round1(
    clamp(
      mean + POSITION_HEIGHT[input.position] + gaussian(random) * withinPosition,
      158,
      206,
    ),
  );
  const maturation = Math.round(clamp(gaussian(random) * 0.45, -1, 1) * 100) / 100;
  const bmi = clamp(
    BASE_BMI + POSITION_BMI[input.position] + gaussian(random) * 0.95,
    20.3,
    27,
  );
  const growth: BodyGrowth = {
    adultHeight,
    adultWeight: round1(bmi * (adultHeight / 100) ** 2),
    maturation,
  };
  const age = exactAge(input.birthDate, input.date);
  const height = Math.round(heightAt(growth, age));
  const weight = Math.round(
    age < FULL_MUSCLE_AGE
      ? weightAt(growth, age) + gaussian(random) * 1.2
      : growth.adultWeight + 0.3 * Math.max(0, age - 30) + gaussian(random) * 1.5,
  );
  return { height, weight, bodyType: bodyType(bmi, adultHeight), growth };
}

/** Growth targets for a body recorded without them (pre-v4 data): assumes average tempo. */
export function inferGrowth(
  body: { height: number; weight: number },
  input: { birthDate: string; date: string },
): BodyGrowth {
  const age = exactAge(input.birthDate, input.date);
  const adultHeight = round1(
    clamp(body.height / heightShare(age), body.height, 206),
  );
  const adultBmi = clamp(
    body.weight / (body.height / 100) ** 2 / bmiShare(age),
    20.3,
    27,
  );
  return {
    adultHeight,
    adultWeight: round1(adultBmi * (adultHeight / 100) ** 2),
    maturation: 0,
  };
}

/**
 * Body change between two dates. Height follows the curve and never decreases; weight tracks the curve plus muscle
 * gain to FULL_MUSCLE_AGE, then drifts at most about ±2 kg a year around the adult weight (age, injury, fitness).
 */
export function growBody(
  body: { height: number; weight: number; growth: BodyGrowth },
  input: {
    birthDate: string;
    from: string;
    to: string;
    random: seedrandom.PRNG;
    physicalTraining?: boolean;
    fitness?: number;
    injured?: boolean;
  },
): { height: number; weight: number } {
  const years = daysBetween(input.from, input.to) / 365.2425;
  if (!(years > 0)) return { height: body.height, weight: body.weight };
  const { growth } = body;
  const { random } = input;
  const from = exactAge(input.birthDate, input.from);
  const to = exactAge(input.birthDate, input.to);
  const height =
    to < 23
      ? Math.max(
          body.height,
          Math.min(
            Math.round(heightAt(growth, to)),
            body.height + Math.ceil(14 * years),
          ),
        )
      : body.height;
  let change: number;
  if (to < FULL_MUSCLE_AGE) {
    change =
      weightAt(growth, to) -
      weightAt(growth, from) +
      0.5 * (weightAt(growth, from) - body.weight) * Math.min(1, years * 2) +
      gaussian(random) * 0.5 * Math.sqrt(years) +
      ((input.physicalTraining ? 0.4 : 0) + (input.injured ? 0.6 : 0)) * years;
  } else {
    const setPoint =
      growth.adultWeight +
      0.3 * Math.max(0, to - 30) +
      (input.injured ? 1.5 : 0) +
      ((input.fitness ?? 90) < 60 ? 1 : 0) -
      (input.physicalTraining ? 0.8 : 0);
    change = clamp(
      0.6 * (setPoint - body.weight) * years +
        gaussian(random) * Math.sqrt(years),
      -2 * years,
      2 * years,
    );
  }
  const minimum = 16.5 * (height / 100) ** 2;
  return {
    height,
    weight: Math.round(
      clamp(body.weight + stochasticRound(change, random), minimum, 135),
    ),
  };
}

/** Height velocity (cm/yr) at which a youth is in the adolescent growth spurt. */
export const SPURT_VELOCITY = 7;

/**
 * Advances a stored identity's body in place (growth targets are inferred and stored for pre-v4 bodies).
 * `spurt` reports that the player is currently in the adolescent growth spurt.
 */
export function developBody(
  identity: PlayerProfile["identity"],
  input: {
    birthDate: string;
    from: string;
    to: string;
    random: seedrandom.PRNG;
    physicalTraining?: boolean;
    fitness?: number;
    injured?: boolean;
  },
): { changed: boolean; spurt: boolean } {
  const inferred = !identity.growth;
  const growth =
    identity.growth ??
    (identity.growth = inferGrowth(identity, {
      birthDate: input.birthDate,
      date: input.from,
    }));
  const next = growBody(
    { height: identity.height, weight: identity.weight, growth },
    input,
  );
  const changed =
    inferred ||
    next.height !== identity.height ||
    next.weight !== identity.weight;
  identity.height = next.height;
  identity.weight = next.weight;
  const age = exactAge(input.birthDate, input.to);
  return {
    changed,
    spurt: age < 18 && heightVelocity(growth, age) >= SPURT_VELOCITY,
  };
}
