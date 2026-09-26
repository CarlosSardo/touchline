import { describe, expect, it } from "vitest";
import {
  AMATEUR_CLUB_SCALE,
  clubPayrollScale,
  estimateClubRevenue,
  leaguePrizeMoney,
  parachutePayment,
  revenueMarketFactor,
  seasonBudgets,
  transferEmbargo,
  weeklyOperatingCosts,
} from "./finance.ts";
import {
  marketWageOffer,
  renewalContinuity,
  trainingCompensationFee,
} from "./recruitment.ts";
import {
  contractEndDate,
  deferralPremium,
  loanAskingFee,
  loanTermsIssue,
  maxLoanBonus,
  MAX_LOAN_SELL_ON,
  minimumOptionFee,
  MIN_LOAN_SALARY_SPLIT,
  sellerValueFloor,
} from "./systems.ts";
import { marketContractYears } from "./transfer-battles.ts";
import { addDays, addMonths } from "../shared/rules.ts";

describe("contract lengths (FIFA RSTP art. 18.2)", () => {
  it("anchor to 30 June of the last season and never exceed five years, or three under 18", () => {
    expect(contractEndDate("2027-01-15", 3, 25)).toBe("2029-06-30");
    expect(contractEndDate("2026-07-10", 5, 25)).toBe("2031-06-30");
    // Signed in June for the coming season: the five-year cap binds a few days early.
    expect(contractEndDate("2026-06-20", 5, 25)).toBe("2031-06-20");
    expect(contractEndDate("2026-06-20", 3, 16)).toBe("2029-06-20");
    expect(contractEndDate("2027-03-01", 5, 17)).toBe("2030-03-01");
    for (let day = 0; day < 365; day += 11)
      for (const [age, years] of [[16, 3], [17, 5], [25, 5], [30, 1]]) {
        const date = addDays("2026-07-01", day);
        const end = contractEndDate(date, years, age);
        expect(end > date).toBe(true);
        expect(end <= addMonths(date, (age < 18 ? 3 : 5) * 12)).toBe(true);
      }
  });

  it("give AI signings shorter deals with age", () => {
    expect([24, 28, 30, 33].map(marketContractYears)).toEqual([4, 3, 2, 1]);
  });
});

describe("loan packages priced by the parent club", () => {
  const pricing = { type: "Standard loan", value: 10_000_000, wage: 20_000, days: 365, referenceSplit: 70 };
  const terms = { salarySplit: 70, bonus: 0, sellOn: 0, optionFee: 0, mandatoryMinutes: 1800 };

  it("charge 3% of value per season plus every wage point the parent subsidises", () => {
    expect(loanAskingFee(pricing, terms)).toBe(300_000);
    const subsidised = loanAskingFee(pricing, { ...terms, salarySplit: MIN_LOAN_SALARY_SPLIT });
    expect(subsidised - 300_000).toBeCloseTo((20_000 * (365 / 7) * 45) / 100, -1);
    expect(loanAskingFee({ ...pricing, days: 182 }, terms)).toBeLessThan(160_000);
    expect(loanAskingFee({ ...pricing, type: "Loan with sell-on" }, { ...terms, sellOn: 50 })).toBe(2_800_000);
    expect(loanAskingFee(pricing, { ...terms, bonus: 400_000 })).toBe(500_000);
  });

  it("tie the minutes bonus to value and a real minutes requirement", () => {
    expect(maxLoanBonus(10_000_000, 365, 1800)).toBe(400_000);
    expect(maxLoanBonus(10_000_000, 365, 1000)).toBe(0);
    expect(maxLoanBonus(10_000_000, 730, 3600)).toBe(800_000);
  });

  it("refuse free-money and free-player terms", () => {
    const check = (overrides: Partial<typeof terms>, context: Partial<Parameters<typeof loanTermsIssue>[0]> = {}) =>
      loanTermsIssue({ type: "Standard loan", value: 10_000_000, days: 365, international: false, ...context }, { ...terms, ...overrides });
    expect(check({})).toBeNull();
    expect(check({ bonus: 100_000_000 })).toContain("at most");
    expect(check({ bonus: 100_000, mandatoryMinutes: 0 })).toContain("requirement");
    expect(check({ salarySplit: 0 })).toContain("75%");
    expect(check({ sellOn: MAX_LOAN_SELL_ON + 1 }, { type: "Loan with sell-on" })).toContain("50%");
    expect(check({ optionFee: 1 }, { type: "Loan with option" })).toContain("purchase clause");
    expect(check({ optionFee: 10_000_000 }, { type: "Loan with option" })).toBeNull();
    expect(check({ optionFee: 9_000_000 }, { type: "Loan with obligation" })).toBeNull();
    expect(minimumOptionFee("Loan with option", 10_000_000)).toBe(10_000_000);
    expect(check({}, { days: 30 })).toContain("registration period");
    expect(check({ mandatoryMinutes: 450 }, { type: "Emergency loan", days: 90 })).toBeNull();
  });

  it("limit international loans to one season (FIFA loan rules); domestic two-season loans stay", () => {
    const check = (type: string, days: number, international: boolean) =>
      loanTermsIssue({ type, value: 10_000_000, days, international }, { ...terms, mandatoryMinutes: 3600 });
    expect(check("Two-year loan", 725, true)).toContain("one year");
    expect(check("Development loan", 500, true)).toContain("one year");
    expect(check("Standard loan", 375, true)).toBeNull();
    expect(check("Two-year loan", 725, false)).toBeNull();
  });
});

describe("transfer fee realism", () => {
  it("price deferred payments and keep sellers near the player's value", () => {
    expect(deferralPremium({ upfrontPercent: 100, installments: 0, intervalMonths: 6 })).toBe(0);
    expect(deferralPremium({ upfrontPercent: 0, installments: 8, intervalMonths: 6 })).toBeCloseTo(0.1);
    expect(deferralPremium({ upfrontPercent: 50, installments: 4, intervalMonths: 6 })).toBeCloseTo(0.025);
    const player = { listed: 0, contract_end: "2030-06-30" };
    expect(sellerValueFloor(player, { balance: 1 }, "2026-08-01")).toBe(0.95);
    expect(sellerValueFloor({ ...player, listed: 1 }, { balance: 1 }, "2026-08-01")).toBe(0.8);
    expect(sellerValueFloor({ ...player, contract_end: "2027-06-30" }, { balance: 1 }, "2026-08-01")).toBe(0.7);
    expect(sellerValueFloor(player, { balance: -1 }, "2026-08-01")).toBe(0.8);
  });

  it("pay FIFA category training compensation, not a token fee", () => {
    expect(trainingCompensationFee(16, 12, 85)).toBe(4 * 8_600);
    expect(trainingCompensationFee(17, 12, 85)).toBe(4 * 8_600 + 77_400);
    expect(trainingCompensationFee(17, 12, 30)).toBe(5 * 8_600);
    expect(trainingCompensationFee(19, 16, 70)).toBe(3 * 51_600);
  });
});

describe("wage expectations on the buyer's pay scale", () => {
  it("anchor AI offers to the buyer's going rate when it pays more than a 10% raise", () => {
    expect(marketWageOffer(1000, 85, 3000)).toBe(3000);
    expect(marketWageOffer(1000, 85, 500)).toBe(1100);
    expect(marketWageOffer(0, 85, 0)).toBe(50);
    expect(marketWageOffer(0, 57, 2000)).toBe(3000);
    expect(marketWageOffer(0, 49, 2000)).toBeNull();
  });

  it("give settled players a continuity bonus in renewals, and unhappy or listed players none", () => {
    expect(renewalContinuity({ listed: 0, morale: 70 })).toBe(12);
    expect(renewalContinuity({ listed: 0, morale: 40 })).toBe(-6);
    expect(renewalContinuity({ listed: 1, morale: 70 })).toBe(-10);
  });

  it("price professionals at an all-amateur club at the professional minimum", () => {
    expect(clubPayrollScale(1_000, 0, 500)).toBe(AMATEUR_CLUB_SCALE);
    expect(clubPayrollScale(100_000, 10_000)).toBe(4);
  });
});

describe("club economy helpers", () => {
  const economy = { reputation: 80, leagueReputation: 75, tier: 1, capacity: 40_000, fanMood: 72, homeMatches: 19 };

  it("scale revenue to the national football market", () => {
    expect(revenueMarketFactor("PT")).toBe(0.25);
    expect(revenueMarketFactor("PT", 2)).toBe(0.625);
    expect(revenueMarketFactor("PT", 3)).toBe(1);
    expect(revenueMarketFactor("EN")).toBe(1);
    expect(revenueMarketFactor(undefined)).toBe(1);
    const english = estimateClubRevenue(economy);
    const portuguese = estimateClubRevenue({ ...economy, countryCode: "PT" });
    expect(portuguese.annualCommercial / english.annualCommercial).toBeCloseTo(0.25, 2);
    expect(portuguese.annualMatchday).toBeLessThan(english.annualMatchday);
    expect(estimateClubRevenue({ ...economy, countryCode: "EN" })).toEqual(english);
  });

  it("do not charge staff wages twice and scale upkeep to small clubs' income", () => {
    const input = { annualRevenue: 52_000_000, wageShare: 0.3, spendRatio: 0.94, facilities: 70, academy: 60, balance: 10_000_000 };
    const plain = weeklyOperatingCosts(input);
    expect(plain.operations - weeklyOperatingCosts({ ...input, staffWages: 50_000 }).operations).toBe(50_000);
    expect(plain.facilities).toBe(10_780);
    const small = weeklyOperatingCosts({ ...input, annualRevenue: 520_000, wageShare: 1.2 });
    expect(small.facilities).toBe(Math.round((10_000 * 0.08 * 70) / 99));
    expect(small.academy).toBe(Math.round((10_000 * 0.06 * 60) / 99));
    expect(small.operations).toBe(0);
  });

  it("pay merit prize money and English parachute payments", () => {
    expect(leaguePrizeMoney(1, 20, 10_000_000)).toBe(1_000_000);
    expect(leaguePrizeMoney(20, 20, 10_000_000)).toBe(0);
    expect(leaguePrizeMoney(11, 20, 10_000_000)).toBe(473_684);
    expect(parachutePayment("EN", 1, 1, 140_000_000)).toBe(49_000_000);
    expect(parachutePayment("EN", 2, 1, 140_000_000)).toBe(39_200_000);
    expect(parachutePayment("EN", 3, 1, 140_000_000)).toBe(0);
    expect(parachutePayment("EN", 3, 3, 140_000_000)).toBe(16_800_000);
    expect(parachutePayment("DE", 1, 5, 140_000_000)).toBe(0);
  });

  it("set next season's budgets net of deferred fees, movement-scaled, with slider moves reverted", () => {
    const base = { balance: 10_000_000, reserved: 1_000_000, owedInstalments: 2_000_000, wageReference: 50_000 };
    expect(seasonBudgets({ ...base, movement: "none" })).toEqual({ transferBudget: 1_000_000, wageBudget: 50_000 });
    expect(seasonBudgets({ ...base, movement: "relegated" })).toEqual({ transferBudget: 750_000, wageBudget: 37_500 });
    expect(seasonBudgets({ ...base, movement: "promoted" })).toEqual({ transferBudget: 1_250_000, wageBudget: 62_500 });
    expect(seasonBudgets({ ...base, owedInstalments: 9_000_000, movement: "none" }).transferBudget).toBe(0);
    expect(transferEmbargo(-1, 1)).toBe(true);
    expect(transferEmbargo(-1, 0)).toBe(false);
    expect(transferEmbargo(5, 100)).toBe(false);
  });
});
