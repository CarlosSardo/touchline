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
  valuation,
  VALUE_RANGE,
} from "../shared/rules.ts";
import {
  acquirePlayerAsset,
  annualAmortization,
  assessFinances,
  assetAmortization,
  baseWage,
  clubValuation,
  closeFinancialYear,
  estimateClubRevenue,
  initialClubFinances,
  marketWage,
  payrollScale,
  postWeeklyAccounts,
  professionalWageFloor,
  recordFinancialItem,
  sellPlayerAsset,
  type ClubEconomyInput,
} from "./finance.ts";
import type { AgeGroup } from "../shared/types.ts";

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

describe("heuristic player valuation", () => {
  const player: Parameters<typeof valuation>[0] = {
    ability: 65,
    potential: 70,
    age: 26,
    position: "CM",
    contract_end: "2029-07-01",
    form: 6.5,
    injury_until: null,
  };
  const context: Parameters<typeof valuation>[1] = {
    date: "2026-07-01",
    leagueReputation: 65,
    balance: 1_000_000,
    philosophy: "Sustainable growth",
    inflation: 0,
    crisis: 0,
    hype: 0,
  };
  function estimate(
    changes: Partial<typeof player> = {},
    market: Partial<typeof context> = {},
  ) {
    return valuation({ ...player, ...changes }, { ...context, ...market });
  }

  it.each([
    {
      label: "amateur-level players",
      player: { ability: 25, potential: 30 },
      reputation: 10,
      minimum: 500,
      maximum: 5000,
    },
    {
      label: "lower-division regulars",
      player: { ability: 45, potential: 50 },
      reputation: 25,
      minimum: 20_000,
      maximum: 90_000,
    },
    {
      label: "useful modest-league professionals",
      player: { ability: 55, potential: 60 },
      reputation: 45,
      minimum: 80_000,
      maximum: 300_000,
    },
    {
      label: "established professionals",
      player: { ability: 65, potential: 70 },
      reputation: 65,
      minimum: 600_000,
      maximum: 2_500_000,
    },
    {
      label: "strong top-division players",
      player: { ability: 75, potential: 78 },
      reputation: 80,
      minimum: 7_000_000,
      maximum: 20_000_000,
    },
    {
      label: "mid-table Premier League squad players",
      player: { ability: 74, potential: 76 },
      reputation: 92,
      minimum: 10_000_000,
      maximum: 25_000_000,
    },
    {
      label: "proven elite young forwards",
      player: { ability: 90, potential: 97, age: 22, position: "ST" },
      reputation: 95,
      minimum: 80_000_000,
      maximum: 180_000_000,
    },
    {
      label: "world-class prime forwards",
      player: { ability: 95, potential: 97, position: "ST" },
      reputation: 99,
      minimum: 130_000_000,
      maximum: 250_000_000,
    },
    {
      label: "unproven academy prospects",
      player: { ability: 45, potential: 99, age: 16 },
      reputation: 85,
      minimum: 150_000,
      maximum: 800_000,
    },
    {
      label: "older useful professionals",
      player: { ability: 65, potential: 70, age: 35 },
      reputation: 65,
      minimum: 100_000,
      maximum: 450_000,
    },
  ] as const)("calibrates $label in GBP", (scenario) => {
    const { value } = estimate(scenario.player, {
      leagueReputation: scenario.reputation,
    });
    expect(value).toBeGreaterThanOrEqual(scenario.minimum);
    expect(value).toBeLessThanOrEqual(scenario.maximum);
  });

  it("is monotonic in quality and league reputation, including band boundaries", () => {
    let previous = 0;
    for (let ability = 1; ability <= 99; ability++) {
      const { value } = estimate({ ability, potential: 99, age: 20 });
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    previous = 0;
    for (let reputation = 0; reputation <= 100; reputation++) {
      const { value } = estimate({}, { leagueReputation: reputation });
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(estimate({ ability: 1000 }).value).toBe(
      estimate({ ability: 99 }).value,
    );
    expect(estimate({}, { leagueReputation: 1000 }).value).toBe(
      estimate({}, { leagueReputation: 100 }).value,
    );
  });

  it("prices prospects on half their projected upside, fading out by 24", () => {
    const ordinary = estimate({ ability: 45, potential: 45, age: 16 });
    const prospect = estimate({ ability: 45, potential: 99, age: 16 });
    expect(prospect.value).toBeGreaterThan(ordinary.value * 3);
    expect(prospect.value).toBeLessThan(ordinary.value * 8);
    expect(prospect.layers["Potential value"]).toBeGreaterThan(3);
    expect(prospect.value).toBeLessThan(estimate().value / 2);
    expect(estimate({ potential: 99, age: 24 }).value).toBe(
      estimate({ potential: 65, age: 24 }).value,
    );
    expect(estimate({ potential: 99, age: 30 }).value).toBe(
      estimate({ potential: 65, age: 30 }).value,
    );
  });

  it("reduces older-player resale value while allowing later goalkeeper peaks", () => {
    const prime = estimate({ age: 26 }).value;
    const veteran = estimate({ age: 35 }).value;
    expect(estimate({ age: 30 }).value).toBeLessThan(prime);
    expect(veteran).toBeLessThan(prime * 0.25);
    expect(estimate({ age: 40 }).value).toBeLessThan(veteran);
    expect(estimate({ age: 18, potential: 65 }).value).toBeLessThan(prime);
    const keeperRetention =
      estimate({ position: "GK", age: 35 }).value /
      estimate({ position: "GK", age: 26 }).value;
    expect(keeperRetention).toBeGreaterThan(veteran / prime);
  });

  it("keeps position premiums modest for equally good prime-age players", () => {
    const goalkeeper = estimate({ position: "GK" }).value;
    const striker = estimate({ position: "ST" }).value;
    expect(striker).toBeGreaterThan(goalkeeper);
    expect(striker).toBeLessThan(goalkeeper * 1.5);
  });

  it("declines to the minimum value at contract expiry without a large minimum fee", () => {
    const contracted = estimate().value;
    let previous = -1;
    for (const months of [0, 1, 6, 12, 24, 36, 60]) {
      const { value } = estimate({
        contract_end: addMonths(context.date, months),
      });
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
    expect(estimate({ contract_end: context.date }).value).toBe(VALUE_RANGE.min);
    expect(estimate({ contract_end: "2026-01-01" }).value).toBe(VALUE_RANGE.min);
    expect(
      estimate(
        {
          ability: 99,
          potential: 99,
          position: "ST",
          form: 10,
          contract_end: context.date,
        },
        { leagueReputation: 100, hype: 10000, balance: 1_000_000_000 },
      ).value,
    ).toBe(VALUE_RANGE.min);
    expect(
      estimate({ contract_end: addMonths(context.date, 1) }).value,
    ).toBeLessThan(contracted * 0.05);
    expect(
      estimate({ contract_end: addMonths(context.date, 6) }).value,
    ).toBeLessThan(contracted * 0.25);
    expect(
      estimate({ contract_end: addMonths(context.date, 61) }).value,
    ).toBe(estimate({ contract_end: addMonths(context.date, 120) }).value);
    expect(estimate({ ability: 1, potential: 1, age: 40 }).value).toBe(VALUE_RANGE.min);
  });

  it("keeps every value between 100 and 250M", () => {
    expect(
      estimate(
        { ability: 99, potential: 99, age: 23, position: "ST", form: 10, contract_end: "2035-07-01" },
        { date: "2030-07-01", leagueReputation: 100, hype: 1000, inflation: 10, balance: 1e9, philosophy: "Win now" },
      ).value,
    ).toBe(VALUE_RANGE.max);
    for (const ability of [1, 20, 40, 60, 80, 99])
      for (const age of [14, 18, 24, 30, 38])
        for (const leagueReputation of [0, 50, 100]) {
          const { value } = estimate({ ability, potential: 99, age }, { leagueReputation });
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(VALUE_RANGE.min);
          expect(value).toBeLessThanOrEqual(VALUE_RANGE.max);
        }
  });

  it("bounds hype, form, injuries and selling-club pressure", () => {
    const baseline = estimate().value;
    const inflated = estimate(
      { form: 10000 },
      {
        hype: 10000,
        crisis: -10000,
        balance: 1_000_000_000,
        philosophy: "Win now",
      },
    ).value;
    const distressed = estimate(
      { form: -10000, injury_until: "2099-07-01" },
      {
        hype: -10000,
        crisis: 10000,
        balance: -1_000_000_000,
        philosophy: "Develop and sell",
      },
    ).value;
    expect(inflated).toBeLessThan(baseline * 1.35);
    expect(distressed).toBeGreaterThan(baseline * 0.35);
    expect(distressed).toBeLessThan(baseline);
    expect(estimate({ injury_until: "2025-07-01" }).value).toBe(baseline);
    expect(estimate({ injury_until: "2026-07-08" }).value).toBeGreaterThan(
      estimate({ injury_until: "2027-07-01" }).value,
    );
    expect(estimate({ injury_until: "2028-07-01" }).value).toBe(
      estimate({ injury_until: "2099-07-01" }).value,
    );
  });

  it("bounds long-career inflation and deflation", () => {
    const future = { date: "2076-07-01" };
    const contract = { contract_end: "2079-07-01" };
    expect(
      estimate(contract, { ...future, inflation: 10000 }).layers[
        "Market context"
      ],
    ).toBe(1.75);
    expect(
      estimate(contract, { ...future, inflation: -10000 }).layers[
        "Market context"
      ],
    ).toBe(0.75);
  });

  it("ignores identity and does not rewrite persisted wages or prior prices", () => {
    const persisted = Object.freeze({
      ...player,
      country_id: 1,
      name: "Player One",
      wage: 1500,
      value: 8_000_000,
      profile: JSON.stringify({ identity: { nationalities: [1, 2] } }),
    });
    const alternate = {
      ...persisted,
      country_id: 243,
      name: "Player Two",
      profile: JSON.stringify({ identity: { nationalities: [242, 243] } }),
    };
    expect(valuation(persisted, context)).toEqual(valuation(alternate, context));
    expect(persisted.wage).toBe(1500);
    expect(persisted.value).toBe(8_000_000);
  });
});

describe("wage levels", () => {
  it("scales payroll to 88% of the wage budget less amateur allowances, within 0.02-4", () => {
    expect(payrollScale(100_000, 100_000)).toBeCloseTo(0.88);
    expect(payrollScale(100_000, 100_000, 8_000)).toBeCloseTo(0.8);
    expect(payrollScale(1_000, 100, 900)).toBe(0.02);
    expect(payrollScale(10, 1_000_000)).toBe(0.02);
    expect(payrollScale(100_000_000, 1)).toBe(4);
    expect(payrollScale(-5, 100)).toBe(0.02);
  });

  it("lowers the professional wage floor to 10-50 on thin budgets, as generated", () => {
    expect(professionalWageFloor(100_000, 500, 30)).toBe(50);
    expect(professionalWageFloor(1_500, 900, 20)).toBe(20);
    expect(professionalWageFloor(200, 300, 20)).toBe(10);
    expect(professionalWageFloor(0, 0, 0)).toBe(50);
  });

  it("prices weekly wages by ability, club budget and age group, never below 50 or the current wage", () => {
    const player = { ability: 74, age: 26, age_group: "Senior" as AgeGroup, wage: 0 };
    // Mid-table Premier League payroll factor ≈ 2.5: about £55k a week for a squad player.
    expect(marketWage(player, 2.5)).toBeGreaterThan(40_000);
    expect(marketWage(player, 2.5)).toBeLessThan(80_000);
    expect(marketWage({ ...player, ability: 92 }, 4)).toBeGreaterThan(250_000);
    expect(marketWage({ ...player, ability: 99 }, 4)).toBeLessThanOrEqual(1_200_000);
    expect(marketWage({ ...player, ability: 55 }, 0.3)).toBeLessThan(1500);
    expect(marketWage({ ...player, ability: 20 }, 0.02)).toBe(50);
    expect(marketWage({ ...player, age_group: "U19" as AgeGroup }, 2.5)).toBeLessThan(marketWage(player, 2.5) / 3);
    expect(marketWage({ ...player, wage: 90_000 }, 2.5)).toBe(90_000);
    expect(baseWage(90)).toBeGreaterThan(baseWage(80) * 2);
  });
});

describe("club economic estimates", () => {
  const economy: ClubEconomyInput = {
    reputation: 65,
    leagueReputation: 75,
    tier: 1,
    capacity: 15_000,
    fanMood: 65,
    homeMatches: 19,
  };
  const business = {
    annualOperatingRevenue: 10_000_000,
    reputation: 50,
    cashBalance: 2_000_000,
    financialDebt: 5_000_000,
  };

  it.each([
    ["lower divisions", 18, 30, 7, 1500, 25_000, 300_000],
    ["small top-flight markets", 35, 30, 1, 3500, 500_000, 3_000_000],
    ["regional professionals", 48, 55, 3, 7500, 2_000_000, 7_000_000],
    ["strong second divisions", 65, 80, 2, 25_000, 15_000_000, 75_000_000],
    ["elite clubs", 95, 95, 1, 75_000, 350_000_000, 650_000_000],
  ] as const)(
    "calibrates annual operating revenue for %s",
    (_label, reputation, leagueReputation, tier, capacity, minimum, maximum) => {
      const revenue = estimateClubRevenue({
        ...economy,
        reputation,
        leagueReputation,
        tier,
        capacity,
      });
      expect(revenue.currency).toBe("GBP");
      expect(revenue.annualOperatingRevenue).toBeGreaterThanOrEqual(minimum);
      expect(revenue.annualOperatingRevenue).toBeLessThanOrEqual(maximum);
      expect(revenue.annualOperatingRevenue).toBe(
        revenue.annualCommercial + revenue.annualMatchday,
      );
      expect(revenue.annualMatchday).toBe(revenue.matchdayPerHomeMatch * 19);
    },
  );

  it("increases revenue with reputation and reduces it down the pyramid", () => {
    const revenue = estimateClubRevenue(economy).annualOperatingRevenue;
    expect(
      estimateClubRevenue({ ...economy, reputation: 75 }).annualOperatingRevenue,
    ).toBeGreaterThan(revenue);
    expect(
      estimateClubRevenue({ ...economy, leagueReputation: 85 })
        .annualOperatingRevenue,
    ).toBeGreaterThan(revenue);
    expect(
      estimateClubRevenue({ ...economy, tier: 2 }).annualOperatingRevenue,
    ).toBeLessThan(revenue);
    expect(estimateClubRevenue({ ...economy, homeMatches: 0 }).annualMatchday).toBe(
      0,
    );
  });

  it("seeds affordable budgets without mutating existing cash or commitments", () => {
    const existing = Object.freeze({
      ...economy,
      balance: -500_000,
      transfer_budget: 300_000,
      wage_budget: 250_000,
    });
    const budgets = initialClubFinances(existing);
    const revenue = estimateClubRevenue(economy).annualOperatingRevenue;
    expect(budgets.balance).toBe(Math.round(revenue * 0.2));
    expect(budgets.transfer_budget).toBe(Math.round(revenue * 0.08));
    expect(budgets.wage_budget).toBe(Math.round((revenue * 0.55) / 52));
    expect(budgets.transfer_budget).toBeLessThan(budgets.balance);
    expect(existing.balance).toBe(-500_000);
    expect(existing.transfer_budget).toBe(300_000);
    expect(existing.wage_budget).toBe(250_000);
  });

  it("separates enterprise value from cash, transfer budget and squad value", () => {
    const estimate = clubValuation(business);
    expect(estimate).toEqual({
      currency: "GBP",
      revenueMultiple: 1.5,
      enterpriseValue: 15_000_000,
      netDebt: 3_000_000,
      equityValue: 12_000_000,
      fundingGap: 0,
    });
    const withOtherMetrics = {
      ...business,
      transfer_budget: 20_000_000,
      wage_budget: 200_000,
      squadValue: 500_000_000,
    };
    expect(clubValuation(withOtherMetrics)).toEqual(estimate);
    expect(
      clubValuation({ ...business, cashBalance: 20_000_000 }).enterpriseValue,
    ).toBe(estimate.enterpriseValue);
    expect(
      clubValuation({ ...business, financialDebt: 30_000_000 }).enterpriseValue,
    ).toBe(estimate.enterpriseValue);
  });

  it("values stronger businesses more highly without requiring player-value sums", () => {
    const baseline = clubValuation(business).enterpriseValue;
    expect(
      clubValuation({ ...business, reputation: 75 }).enterpriseValue,
    ).toBeGreaterThan(baseline);
    expect(
      clubValuation({ ...business, annualOperatingRevenue: 20_000_000 })
        .enterpriseValue,
    ).toBe(baseline * 2);
    expect(clubValuation({ ...business, reputation: 1000 }).revenueMultiple).toBe(
      4.5,
    );
    expect(clubValuation({ ...business, reputation: -1000 }).revenueMultiple).toBe(
      0.5,
    );
  });

  it("keeps lower-division enterprises modest and elite businesses in the billions", () => {
    const local = {
      ...economy,
      reputation: 18,
      leagueReputation: 30,
      tier: 7,
      capacity: 1500,
    };
    const elite = {
      ...economy,
      reputation: 95,
      leagueReputation: 95,
      capacity: 75_000,
      homeMatches: 21,
    };
    const localValue = clubValuation({
      ...business,
      reputation: local.reputation,
      annualOperatingRevenue: estimateClubRevenue(local).annualOperatingRevenue,
    }).enterpriseValue;
    const eliteValue = clubValuation({
      ...business,
      reputation: elite.reputation,
      annualOperatingRevenue: estimateClubRevenue(elite).annualOperatingRevenue,
    }).enterpriseValue;
    expect(localValue).toBeGreaterThan(25_000);
    expect(localValue).toBeLessThan(250_000);
    expect(eliteValue).toBeGreaterThan(1_000_000_000);
    expect(eliteValue).toBeLessThan(3_000_000_000);
  });

  it("handles net cash, overdrafts and debt exceeding the enterprise value", () => {
    expect(clubValuation({ ...business, financialDebt: 0 })).toMatchObject({
      netDebt: -2_000_000,
      equityValue: 17_000_000,
      fundingGap: 0,
    });
    expect(
      clubValuation({ ...business, cashBalance: -2_000_000, financialDebt: 0 }),
    ).toEqual(
      clubValuation({ ...business, cashBalance: 0, financialDebt: 2_000_000 }),
    );
    expect(
      clubValuation({ ...business, financialDebt: 30_000_000 }),
    ).toMatchObject({ equityValue: 0, fundingGap: 13_000_000 });
    expect(
      clubValuation({
        ...business,
        cashBalance: business.cashBalance + 8_000_000,
        financialDebt: business.financialDebt + 8_000_000,
      }),
    ).toEqual(clubValuation(business));
    expect(
      clubValuation({ ...business, annualOperatingRevenue: 0, cashBalance: 0 }),
    ).toMatchObject({ enterpriseValue: 0, equityValue: 0, fundingGap: 5_000_000 });
  });

  it("rejects invalid estimates instead of creating non-finite money", () => {
    expect(() => estimateClubRevenue({ ...economy, capacity: NaN })).toThrow();
    expect(() => initialClubFinances({ ...economy, fanMood: Infinity })).toThrow();
    expect(() => clubValuation({ ...business, financialDebt: -1 })).toThrow();
    expect(() => clubValuation({ ...business, cashBalance: NaN })).toThrow();
    expect(() =>
      clubValuation({ ...business, annualOperatingRevenue: Infinity }),
    ).toThrow();
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
      await generateWorld(store, { nations: ["EN"] });
    }),
  );
  afterAll(async () => await store?.close());
  it("uses league size and the calibrated revenue model for live club projections", async () => {
    const { projectedOperatingRevenue } = await import("./finance.ts");
    const club = (await store.get<import("../shared/types.ts").Club>(
      "SELECT * FROM clubs WHERE id = 1",
    ))!;
    const league = (await store.get<import("../shared/types.ts").League>(
      "SELECT * FROM leagues WHERE id = ?", club.league_id,
    ))!;
    const size = (await store.get<{ total: number }>(
      "SELECT count(*) AS total FROM standings WHERE league_id = ?", club.league_id,
    ))!.total;
    expect(await projectedOperatingRevenue(store, club)).toBe(
      estimateClubRevenue({
        reputation: club.reputation,
        leagueReputation: league.reputation,
        tier: league.tier,
        capacity: club.capacity,
        fanMood: club.fan_mood,
        homeMatches: size + 1,
      }).annualOperatingRevenue,
    );
  });

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
