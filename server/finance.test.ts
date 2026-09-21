import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import {
  accountingAmount,
  addMonths,
  compactNumber,
  currencyCode,
  DEFAULT_TRANSFER_TERMS,
  displayAmount,
  money,
  transferPaymentPlan,
} from "../shared/rules.ts";
import {
  acquirePlayerAsset,
  annualAmortization,
  assessFinances,
  assetAmortization,
  closeFinancialYear,
  postWeeklyAccounts,
  recordFinancialItem,
  sellPlayerAsset,
} from "./finance.ts";

describe("currency presentation", () => {
  it("uses compact values without changing accounting amounts", () => {
    expect(compactNumber(2400)).toBe("2.4K");
    expect(compactNumber(1200000)).toBe("1.2M");
    expect(compactNumber(-2400)).toBe("-2.4K");
    expect(compactNumber(45)).toBe("45");
    expect(money(2400)).toBe("£2.4K");
    expect(money(2400, false, "EUR")).toContain("€2.8K");
    expect(displayAmount(10000, "USD")).toBe(13000);
    expect(accountingAmount(13000, "USD")).toBe(10000);
    expect(
      accountingAmount(displayAmount(123456.78, "EUR"), "EUR"),
    ).toBeCloseTo(123456.78, 2);
    expect(currencyCode(undefined)).toBe("GBP");
  });
  it("schedules exact instalment totals and clamps month-end due dates", () => {
    const terms = {
      ...DEFAULT_TRANSFER_TERMS,
      upfrontPercent: 25,
      installments: 3,
      intervalMonths: 1,
    };
    const plan = transferPaymentPlan(1000.03, terms, "2026-01-31");
    expect(plan.map((payment) => payment.date)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
    expect(
      plan.reduce(
        (total, payment) => total + Math.round(payment.amount * 100),
        0,
      ),
    ).toBe(100003);
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(
      transferPaymentPlan(2400, DEFAULT_TRANSFER_TERMS, "2026-07-01"),
    ).toEqual([{ date: "2026-07-01", amount: 2400 }]);
  });
});

describe("financial regulatory accounting", () => {
  let store: Store;
  beforeAll(async () => {
    store = await Store.createTest("finance");
  });
  beforeEach(async () =>
    store.transaction(async () => {
      await store.clearWorld();
      await store.schema();
      await generateWorld(store, {
        countryLimit: 1,
        seniors: 1200,
        youth: 500,
      });
    }),
  );
  afterAll(async () => await store?.close());
  it("caps player-registration amortization at five years and does not expense the cash price twice", async () => {
    expect(assetAmortization(50_000_000, "2026-07-01", "2034-07-01")).toBe(
      10_000_000,
    );
    await acquirePlayerAsset(
      store,
      1,
      1,
      40_000_000,
      "2026-07-01",
      "2030-07-01",
    );
    expect(await annualAmortization(store, 1, "2026-07-01")).toBeCloseTo(
      10_000_000,
      -3,
    );
    await postWeeklyAccounts(store, 1, 1_000_000, 400_000, 100_000, 100_000);
    const assessment = await assessFinances(store, 1);
    expect(assessment.periods[0].amortization).toBeCloseTo(10_000_000 / 52, -2);
    expect(assessment.periods[0].operating).toBe(100000);
    expect(assessment.periods[0].excluded_investment).toBe(100000);
  });
  it("uses remaining book value when recognizing a sale profit", async () => {
    await acquirePlayerAsset(
      store,
      1,
      1,
      40_000_000,
      "2026-07-01",
      "2030-07-01",
    );
    const sale = await sellPlayerAsset(store, 1, 1, 35_000_000, "2028-07-01");
    expect(sale.bookValue).toBeCloseTo(20_000_000, -5);
    expect(sale.profit).toBeCloseTo(15_000_000, -5);
    expect(await annualAmortization(store, 1, "2028-07-01")).toBe(0);
  });
  it("applies the 2026 Premier League 85% squad-cost limit, not a fixed cash-deficit embargo", async () => {
    await recordFinancialItem(store, 1, "revenue", 100_000_000);
    await recordFinancialItem(store, 1, "wages", 90_000_000);
    await closeFinancialYear(store, 2026);
    const report = await assessFinances(store, 1);
    expect(report.policy).toBe("Premier League SCR 2026/27");
    expect(report.squadCostLimit).toBe(0.85);
    expect(report.squadCostRatio).toBe(0.9);
    expect(report.costHeadroom).toBe(-5_000_000);
    expect(report.levyApplies).toBe(false);
    expect(report.status).toBe("review");
  });
  it("averages sale profits across three seasons rather than treating every receipt as recurring revenue", async () => {
    for (const season of [2024, 2025, 2026])
      await recordFinancialItem(store, 1, "sale_profit", 9_000_000, season);
    await recordFinancialItem(store, 1, "revenue", 100_000_000);
    await closeFinancialYear(store, 2026);
    expect((await assessFinances(store, 1)).footballRevenue).toBe(109_000_000);
  });
});
