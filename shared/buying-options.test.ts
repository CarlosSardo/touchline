import { describe, expect, it } from "vitest";
import {
  loanBackBuyerCeilingPenalty,
  loanBackEndDate,
  loanBackSellerFloorDiscount,
  loanBackValidationIssue,
  preContractValidationIssue,
} from "./rules.ts";

describe("loan-back buying option", () => {
  it("prices seller flexibility and buyer delay with documented 3/5/7 percent bases", () => {
    expect(loanBackSellerFloorDiscount("season", 0.8)).toBeCloseTo(0.03);
    expect(loanBackSellerFloorDiscount("year", 0.95)).toBeCloseTo(0.07);
    expect(loanBackSellerFloorDiscount("two-seasons", 1)).toBeCloseTo(0.1);
    expect(loanBackBuyerCeilingPenalty("season")).toBeCloseTo(0.03);
    expect(loanBackBuyerCeilingPenalty("year")).toBeCloseTo(0.05);
    expect(loanBackBuyerCeilingPenalty("two-seasons")).toBeCloseTo(0.07);
  });

  it("calculates season, one-year and two-season end dates", () => {
    expect(loanBackEndDate("season", "2027-01-15")).toBe("2027-06-30");
    expect(loanBackEndDate("year", "2027-01-15")).toBe("2028-01-15");
    expect(loanBackEndDate("two-seasons", "2027-01-15")).toBe("2028-06-30");
  });

  it("rejects loan-backs where football rules or deal structure do not fit", () => {
    expect(
      loanBackValidationIssue({
        loanBack: "two-seasons",
        type: "Permanent transfer",
        date: "2027-01-15",
        contractEnd: "2030-06-30",
        international: true,
        age: 24,
      }),
    ).toMatch(/cap international loan-backs/);
    expect(
      loanBackValidationIssue({
        loanBack: "year",
        type: "Future transfer",
        date: "2027-01-15",
        contractEnd: "2030-06-30",
        international: false,
        age: 17,
      }),
    ).toMatch(/immediate permanent transfers/);
    expect(
      loanBackValidationIssue({
        loanBack: "season",
        type: "Permanent transfer",
        date: "2027-01-15",
        contractEnd: "2030-06-30",
        international: false,
        age: 19,
        onwardLoan: true,
      }),
    ).toMatch(/onward affiliate loan/);
  });
});

describe("pre-contract buying option", () => {
  it("allows international Bosman agreements in the final six months", () => {
    expect(
      preContractValidationIssue({
        date: "2027-01-01",
        contractEnd: "2027-06-30",
        ageAtArrival: 24,
        sourceAssociation: "FR",
        destinationAssociation: "EN",
      }),
    ).toBeNull();
  });

  it("rejects early, under-age, on-loan and UK same-association pre-contracts", () => {
    expect(
      preContractValidationIssue({
        date: "2026-12-01",
        contractEnd: "2027-06-30",
        ageAtArrival: 24,
        sourceAssociation: "FR",
        destinationAssociation: "EN",
      }),
    ).toMatch(/final six months/);
    expect(
      preContractValidationIssue({
        date: "2027-01-01",
        contractEnd: "2027-06-30",
        ageAtArrival: 17,
        sourceAssociation: "FR",
        destinationAssociation: "EN",
      }),
    ).toMatch(/18 or older/);
    expect(
      preContractValidationIssue({
        date: "2027-01-01",
        contractEnd: "2027-06-30",
        ageAtArrival: 24,
        sourceAssociation: "EN",
        destinationAssociation: "EN",
      }),
    ).toMatch(/UK associations/);
    expect(
      preContractValidationIssue({
        date: "2027-01-01",
        contractEnd: "2027-06-30",
        ageAtArrival: 24,
        sourceAssociation: "FR",
        destinationAssociation: "EN",
        onLoan: true,
      }),
    ).toMatch(/on loan/);
  });
});
