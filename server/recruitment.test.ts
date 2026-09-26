import { describe, expect, it } from "vitest";
import { baseWage } from "./finance.ts";
import {
  clublessWageExpectation,
  interestStance,
  marketWageOffer,
  moveInterest,
  MOVE_REFUSAL_THRESHOLD,
  PERSONAL_TERMS_THRESHOLD,
  personalTermsOutcome,
  WAGE_INTEREST_CAP,
  WAGE_INTEREST_FLOOR,
  wageForInterest,
  wageInterest,
} from "./recruitment.ts";
import { buyerFeeCeiling, clubCounter } from "./systems.ts";
import { DEFAULT_TRANSFER_TERMS, INTEREST_BANDS } from "../shared/rules.ts";
import type { PlayerInterest } from "../shared/types.ts";

const interest = (impacts: Record<string, number>): Pick<PlayerInterest, "score" | "factors"> => {
  const factors = Object.entries(impacts).map(([id, impact]) => ({ id, label: id, impact, reason: id }));
  return {
    factors,
    score: Math.round(Math.min(99, Math.max(1, 60 + factors.reduce((total, entry) => total + entry.impact, 0)))),
  };
};

describe("personal terms decisions", () => {
  it("use the 50/85 bands from the user directive", () => {
    expect(MOVE_REFUSAL_THRESHOLD).toBe(50);
    expect(PERSONAL_TERMS_THRESHOLD).toBe(85);
    expect(INTEREST_BANDS).toMatchObject({ refuse: 50, agree: 85 });
  });

  it("measure interest in the move without the wage factor", () => {
    expect(moveInterest(interest({ ambition: -30, wages: 15 }).factors)).toBe(30);
    expect(moveInterest(interest({ ambition: -30, wages: -24 }).factors)).toBe(30);
    expect(moveInterest(interest({ ambition: -80 }).factors)).toBe(1);
  });

  it("refuse below 50% move interest even at the maximum wage", () => {
    const unwilling = interest({ ambition: -11, wages: WAGE_INTEREST_CAP });
    expect(moveInterest(unwilling.factors)).toBe(49);
    expect(personalTermsOutcome(unwilling, true)).toBe("refused");
    expect(interestStance(unwilling.score, true)).toBe("Not interested");
  });

  it("keep a 50-84% player talking and accept only from 85% with the wage floor met", () => {
    expect(personalTermsOutcome(interest({ ambition: -10, wages: 0 }), true)).toBe("hesitant");
    const almost = interest({ ambition: -10, wages: WAGE_INTEREST_CAP - 1 });
    expect(almost.score).toBe(84);
    expect(personalTermsOutcome(almost, true)).toBe("hesitant");
    const convinced = interest({ ambition: -10, wages: WAGE_INTEREST_CAP });
    expect(convinced.score).toBe(85);
    expect(personalTermsOutcome(convinced, false)).toBe("wage");
    expect(personalTermsOutcome(convinced, true)).toBe("agreed");
  });

  it("do not refuse because of a low wage offer alone", () => {
    const lowball = interest({ ambition: -5, wages: WAGE_INTEREST_FLOOR });
    expect(lowball.score).toBeLessThan(MOVE_REFUSAL_THRESHOLD);
    expect(personalTermsOutcome(lowball, false)).toBe("hesitant");
  });

  it("cap what wages add, so a 50% move needs about a two-thirds premium", () => {
    expect(wageInterest(1000, 1000)).toBe(0);
    expect(wageInterest(1_000_000, 1000)).toBe(WAGE_INTEREST_CAP);
    expect(wageInterest(1, 1000)).toBe(WAGE_INTEREST_FLOOR);
    expect(wageForInterest(1000, 0)).toBe(1000);
    expect(wageForInterest(1000, WAGE_INTEREST_CAP)).toBe(1660);
    expect(wageForInterest(1000, WAGE_INTEREST_CAP + 1)).toBeNull();
    expect(wageInterest(wageForInterest(1000, 20)!, 1000)).toBeGreaterThanOrEqual(20);
  });

  it("let AI buyers raise the wage to 1.5x the expectation, and no further, to reach 85%", () => {
    // Expectation = current wage + 10%; 1.5x adds ~28 points, so the move itself must interest him at 57%.
    expect(marketWageOffer(1000, MOVE_REFUSAL_THRESHOLD - 1)).toBeNull();
    expect(marketWageOffer(1000, 56)).toBeNull();
    expect(marketWageOffer(1000, 57)).toBe(1650);
    expect(marketWageOffer(1000, PERSONAL_TERMS_THRESHOLD)).toBe(1100);
    for (const move of [57, 65, 75, 90])
      expect(wageInterest(marketWageOffer(1000, move)!, 1100) + move).toBeGreaterThanOrEqual(PERSONAL_TERMS_THRESHOLD);
  });
});

describe("transfer fee negotiation values", () => {
  it("counter above the club's floor without eroding the asking price", () => {
    expect(clubCounter(1_000_000, 880_000)).toBe(960_000);
    // A strict club floor above 96% is respected, so offering the counter is always accepted.
    expect(clubCounter(1_000_000, 985_000.4)).toBe(985_001);
    for (const floor of [700_000, 880_000, 990_000]) {
      expect(clubCounter(1_000_000, floor)).toBeGreaterThanOrEqual(floor);
      expect(clubCounter(1_000_000, floor)).toBeLessThanOrEqual(1_000_000);
    }
  });

  it("never let an incoming bidder decline a fee at or below its own bid for clause-free terms", () => {
    const terms = DEFAULT_TRANSFER_TERMS;
    // Unsolicited bids can exceed the player's value (the stored asking price).
    expect(buyerFeeCeiling(1_000_000, 1_200_000, terms)).toBeGreaterThanOrEqual(1_200_000);
    expect(buyerFeeCeiling(1_000_000, 900_000, terms)).toBe(1_060_000);
    // A whole-number ceiling: countering with the quoted maximum is accepted.
    expect(Number.isInteger(buyerFeeCeiling(1_000_001, 0, terms))).toBe(true);
    expect(buyerFeeCeiling(1_000_000, 0, { ...terms, sellOnPercent: 20, buyBackFee: 5_000_000 })).toBe(930_000);
  });
});

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
