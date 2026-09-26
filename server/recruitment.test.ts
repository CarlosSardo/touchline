import { describe, expect, it } from "vitest";
import { baseWage } from "./finance.ts";
import { clublessWageExpectation } from "./recruitment.ts";

describe("club-less wage expectations", () => {
  it("take the buyer's going rate, floored by what comparable seniors earn in the buyer's league", () => {
    const reference = baseWage(80);
    // A payroll factor clamped at 0.02 no longer prices an ability-80 free agent at 2% of the base wage.
    expect(clublessWageExpectation(reference * 0.02, 30_000, 26)).toBe(22_500);
    expect(clublessWageExpectation(reference * 1.5, 30_000, 26)).toBe(Math.round((reference * 1.5) / 10) * 10);
    expect(clublessWageExpectation(reference * 0.02, 30_000, 19)).toBe(18_000);
    expect(clublessWageExpectation(reference * 0.02, 30_000, 34)).toBe(18_000);
    expect(clublessWageExpectation(20, null, 25)).toBe(50);
  });
});
