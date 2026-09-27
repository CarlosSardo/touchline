import { describe, expect, it } from "vitest";
import {
  loanBorrowerWillingness,
  loanEndDate,
  loanTermsIssue,
} from "./systems.ts";
import type { LoanTerms } from "../shared/types.ts";

const terms: LoanTerms = {
  playingTime: 65,
  position: "CM",
  role: "Squad player",
  developmentPlan: "Balanced",
  recall: true,
  injuryRecall: true,
  salarySplit: 60,
  fee: 120_000,
  bonus: 0,
  mandatoryMinutes: 1200,
  tacticalFit: 70,
  managerTrust: 65,
  relationship: 50,
  optionFee: 0,
  sellOn: 0,
  duration: 365,
  obligationCondition: "Unconditional",
};

describe("loan offer borrower willingness", () => {
  const base = {
    type: "Standard loan",
    playerValue: 5_000_000,
    playerWage: 10_000,
    playerAbility: 68,
    playerAge: 20,
    borrowerReputation: 62,
    borrowerTransferBudget: 2_000_000,
    borrowerWageBudget: 250_000,
    borrowerCurrentWages: 120_000,
    seniorSquadSize: 23,
    positionCount: 1,
    days: 365,
    fee: 120_000,
    terms,
  };

  it("accepts affordable loan packages when the borrower has squad need", () => {
    const result = loanBorrowerWillingness(base);
    expect(result.willing).toBe(true);
    expect(result.maximumFee).toBeGreaterThanOrEqual(base.fee);
    expect(result.maximumSalarySplit).toBe(100);
  });

  it("counters fees and wage shares above the borrower's ceiling", () => {
    const result = loanBorrowerWillingness({
      ...base,
      borrowerTransferBudget: 150_000,
      borrowerWageBudget: 128_000,
      fee: 400_000,
      terms: { ...terms, salarySplit: 95 },
    });
    expect(result.willing).toBe(false);
    expect(result.maximumFee).toBe(150_000);
    expect(result.maximumSalarySplit).toBe(80);
    expect(result.reasons.join(" ")).toContain("wage");
  });

  it("refuses clubs with full squads or no credible level fit", () => {
    const result = loanBorrowerWillingness({
      ...base,
      playerAbility: 44,
      borrowerReputation: 75,
      seniorSquadSize: 28,
      positionCount: 4,
    });
    expect(result.willing).toBe(false);
    expect(result.reasons.join(" ")).toContain("full senior squad");
    expect(result.reasons.join(" ")).toContain("below the borrowing club");
  });

  it("refuses unaffordable or unrealistic purchase clauses", () => {
    const obligation = loanBorrowerWillingness({
      ...base,
      type: "Loan with obligation",
      borrowerTransferBudget: 4_000_000,
      terms: { ...terms, optionFee: 6_000_000 },
    });
    expect(obligation.willing).toBe(false);
    expect(obligation.maximumOptionFee).toBe(4_000_000);
    expect(obligation.reasons.join(" ")).toContain("purchase clause");

    const option = loanBorrowerWillingness({
      ...base,
      type: "Loan with option",
      borrowerTransferBudget: 20_000_000,
      terms: { ...terms, optionFee: 6_500_000 },
    });
    expect(option.willing).toBe(false);
    expect(option.maximumOptionFee).toBe(6_250_000);
  });
});

describe("loan purchase clause hard caps", () => {
  it("caps parent-club purchase clauses at three times player value", () => {
    expect(
      loanTermsIssue(
        { type: "Loan with option", value: 5_000_000, days: 365, international: false },
        { ...terms, optionFee: 15_000_000 },
      ),
    ).toBeNull();
    expect(
      loanTermsIssue(
        { type: "Loan with obligation", value: 5_000_000, days: 365, international: false },
        { ...terms, optionFee: 15_001_000 },
      ),
    ).toContain("cannot exceed");
  });
});

describe("loan offer end dates", () => {
  it("uses season-end dates for standard loans and fixed windows for short loans", () => {
    expect(loanEndDate("Standard loan", "2026-08-15", 365)).toBe("2027-06-30");
    expect(loanEndDate("Standard loan", "2027-01-20", 365)).toBe("2027-06-30");
    expect(loanEndDate("Short loan", "2027-01-20", 182)).toBe("2027-07-21");
    expect(loanEndDate("Two-year loan", "2026-08-15", 730)).toBe("2028-06-30");
  });
});
