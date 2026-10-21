import { Store } from "./db.ts";
import { addDays, clamp, daysBetween, round } from "../shared/rules.ts";
import type { Club, GameState, League, Player } from "../shared/types.ts";

/** Section 5 base weekly wage (GBP) before a club's payroll calibration. */
export const baseWage = (ability: number) =>
  Math.round(((clamp(ability) / 100) ** 7 * 190_000) / 10) * 10 + 50;

/** people.ts professionalBaseWage in SQL (youth professionals at 8%). */
const BASE_WAGE_SQL =
  "round(power(players.ability / 100, 7) * CASE WHEN players.age_group = 'Senior' THEN 19000 ELSE 1520 END) * 10 + 50";
const PROFESSIONAL =
  "coalesce(players.profile::jsonb #>> '{contract,status}', 'professional') = 'professional'";
const REGISTERED = "players.club_id IS NOT NULL AND players.role != 'Retired'";
/** The generator's payroll inputs: professional base wages, and amateur allowances (the amateurs' wages). */
const PAYROLL_SQL = `coalesce(sum(CASE WHEN ${PROFESSIONAL} THEN ${BASE_WAGE_SQL} ELSE 0 END),0) AS base,coalesce(sum(CASE WHEN ${PROFESSIONAL} THEN 0 ELSE players.wage END),0) AS allowances`;

/** Section 5 payroll calibration: professional wages ≈ 88% of the weekly wage budget less amateur allowances, factor 0.02–4 as generated. */
export const payrollScale = (wageBudget: number, baseTotal: number, allowances = 0) =>
  clamp((0.88 * Math.max(0, wageBudget) - allowances) / Math.max(1, baseTotal), 0.02, 4);

/** Weekly professional wage floor as generated: 50, or 10–50 where 88% of the budget cannot pay 50 each. */
export const professionalWageFloor = (wageBudget: number, allowances: number, professionals: number) =>
  professionals > 0
    ? clamp(Math.floor((0.88 * wageBudget - allowances) / professionals / 10) * 10, 10, 50)
    : 50;

/** Scale of a club without professionals: its going rate is the professional minimum, not 4x the English base. */
export const AMATEUR_CLUB_SCALE = 0.02;

/** payrollScale, except that a squad with no professional base wages pays the professional minimum. */
export const clubPayrollScale = (wageBudget: number, baseTotal: number, allowances = 0) =>
  baseTotal < 1 ? AMATEUR_CLUB_SCALE : payrollScale(wageBudget, baseTotal, allowances);

export async function wageScale(store: Store, clubId: number) {
  const row = (await store.get<{ budget: number; base: number; allowances: number }>(
    `SELECT clubs.wage_budget AS budget,payroll.base,payroll.allowances FROM clubs,(SELECT ${PAYROLL_SQL} FROM players WHERE ((players.club_id = ? AND players.parent_club_id IS NULL) OR players.parent_club_id = ?) AND ${REGISTERED}) AS payroll WHERE clubs.id = ?`,
    clubId,
    clubId,
    clubId,
  ))!;
  return clubPayrollScale(row.budget, row.base, row.allowances);
}

/** payrollScale for every non-national club in one pass. */
export async function wageScales(store: Store) {
  const payroll = new Map(
    (
      await store.all<{ club_id: number; base: number; allowances: number }>(
        `SELECT coalesce(players.parent_club_id,players.club_id) AS club_id,${PAYROLL_SQL} FROM players WHERE ${REGISTERED} GROUP BY coalesce(players.parent_club_id,players.club_id)`,
      )
    ).map((row) => [row.club_id, row]),
  );
  return new Map(
    (
      await store.all<{ id: number; wage_budget: number }>(
        "SELECT id,wage_budget FROM clubs WHERE type != 'national'",
      )
    ).map((club) => [
      club.id,
      clubPayrollScale(club.wage_budget, payroll.get(club.id)?.base ?? 0, payroll.get(club.id)?.allowances ?? 0),
    ]),
  );
}

/** What a club with payroll factor `scale` pays for this player; never below the current wage. */
export function marketWage(
  player: Pick<Player, "ability" | "age" | "age_group" | "wage">,
  scale: number,
) {
  const stage =
    player.age_group !== "Senior" ? 0.25 : player.age <= 20 ? 0.75 : 1;
  return Math.max(
    player.wage,
    50,
    Math.round((baseWage(player.ability) * scale * stage) / 10) * 10,
  );
}

export interface FinancialPeriod {
  club_id: number;
  season: number;
  revenue: number;
  wages: number;
  operating: number;
  amortization: number;
  agent_fees: number;
  sale_profit: number;
  excluded_investment: number;
  equity: number;
  closed: number;
}
export interface FinancialAssessment {
  policy: string;
  currency: "GBP";
  squadCostLimit: number | null;
  squadCostRatio: number;
  squadCost: number;
  footballRevenue: number;
  rollingEarnings: number;
  allowableLoss: number | null;
  lossHeadroom: number | null;
  costHeadroom: number | null;
  yearsObserved: number;
  projected: boolean;
  status: "compliant" | "monitoring" | "review";
  issues: string[];
  periods: FinancialPeriod[];
  annualAmortization: number;
  levyApplies: boolean;
  source: string;
}

export interface ClubEconomyInput {
  reputation: number;
  leagueReputation: number;
  tier: number;
  capacity: number;
  fanMood: number;
  homeMatches?: number;
  /** Association code of the club's league; smaller football economies earn less at the same reputation. */
  countryCode?: string;
}

/**
 * Commercial/broadcast revenue relative to the big-five scale at equal reputation, calibrated so top-flight
 * medians land near real orders of magnitude (Deloitte/UEFA club licensing benchmarks 2023-25: PT ~£15-25M,
 * NL ~£25M, SCO ~£10M, BE ~£25M, DK ~£12M, JP ~£25-30M outside the few rich clubs). Unlisted codes use 1.
 */
export const REVENUE_MARKET_FACTOR: Record<string, number> = {
  PT: 0.25,
  NL: 0.3,
  SCO: 0.3,
  BE: 0.45,
  DK: 0.4,
  JP: 0.45,
};

/** The national factor at `tier`: full in the top flight, half-way in the second tier, none from the third down. */
export const revenueMarketFactor = (code?: string, tier = 1) => {
  const factor = code ? REVENUE_MARKET_FACTOR[code] ?? 1 : 1;
  return factor + (1 - factor) * clamp((tier - 1) / 2, 0, 1);
};

export interface ClubRevenueEstimate {
  currency: "GBP";
  annualCommercial: number;
  matchdayPerHomeMatch: number;
  annualMatchday: number;
  annualOperatingRevenue: number;
}

export function estimateClubRevenue(
  input: ClubEconomyInput,
): ClubRevenueEstimate {
  const homeMatches = input.homeMatches ?? 19;
  if (
    ![
      input.reputation,
      input.leagueReputation,
      input.tier,
      input.capacity,
      input.fanMood,
      homeMatches,
    ].every(Number.isFinite)
  )
    throw new Error("Club revenue inputs must be finite.");
  const reputation = clamp(input.reputation, 0, 100) / 100;
  const league = clamp(input.leagueReputation, 0, 100) / 100;
  const tier = clamp(input.tier, 1, 10);
  const market = revenueMarketFactor(input.countryCode, tier);
  const annualCommercial = Math.round(
    Math.max(
      2500,
      500_000_000 * reputation ** 3 * league ** 3 * 0.45 ** (tier - 1) * market,
    ),
  );
  const attendance = clamp(
    0.2 + reputation * 0.2 + clamp(input.fanMood, 0, 100) / 200,
    0.2,
    0.9,
  );
  const ticketPrice = (5 + (55 * reputation * league) / Math.sqrt(tier)) * (0.5 + market / 2);
  const matchdayPerHomeMatch = Math.round(
    clamp(input.capacity, 0, 150_000) * attendance * ticketPrice,
  );
  const annualMatchday =
    matchdayPerHomeMatch * Math.floor(clamp(homeMatches, 0, 40));
  return {
    currency: "GBP",
    annualCommercial,
    matchdayPerHomeMatch,
    annualMatchday,
    annualOperatingRevenue: annualCommercial + annualMatchday,
  };
}

/** Share of expected revenue a board spends on player wages and non-staff running costs: 0.90–0.98 in top flights, 0.855–0.935 from the fourth tier, where staff wages take a larger share. */
export const spendRatio = (clubId: number, tier: number) =>
  0.9 -
  0.015 * clamp(Math.round(tier) - 1, 0, 3) +
  (0.08 * (Math.imul(clubId, 0x9e3779b1) >>> 0)) / 2 ** 32;

export interface OperatingCostInput {
  /** Expected annual operating revenue (neutral fan mood, league home matches + 2). */
  annualRevenue: number;
  /** Budgeted player payroll (88% of the reference wage budget) / expected annual revenue. */
  wageShare: number;
  spendRatio: number;
  facilities: number;
  academy: number;
  balance: number;
  /** Weekly staff wages charged separately; they are part of the spend ratio, so operations exclude them. */
  staffWages?: number;
}

/**
 * Weekly non-player costs (GBP): facilities and academy upkeep, plus matchday, commercial and admin costs up to
 * the spend ratio less the budgeted payroll share and the (separately charged) staff wages. Upkeep is capped at
 * 8% / 6% of revenue scaled by the rating, so small clubs are not charged elite running costs. Wages above or
 * below the budget change profit. Cash below 10% of revenue cuts up to 6 points of that spend.
 */
export function weeklyOperatingCosts(input: OperatingCostInput) {
  const revenue = Math.max(0, input.annualRevenue);
  const weekly = revenue / 52;
  const facilities = Math.round(Math.min(input.facilities ** 2 * 2.2, (weekly * 0.08 * clamp(input.facilities, 0, 99)) / 99));
  const academy = Math.round(Math.min(input.academy ** 2 * 1.6, (weekly * 0.06 * clamp(input.academy, 0, 99)) / 99));
  const cushion = clamp(input.balance / Math.max(1, revenue * 0.1), 0, 1);
  const budget = ((input.spendRatio - 0.06 * (1 - cushion) - input.wageShare) * revenue) / 52 - Math.max(0, input.staffWages ?? 0);
  const operations = Math.max(0, Math.round(budget - facilities - academy));
  return { facilities, academy, operations, total: facilities + academy + operations };
}

/** League merit payment: 0 for last place up to 10% of the club's expected revenue for the champion. */
export function leaguePrizeMoney(position: number, size: number, annualRevenue: number) {
  if (size < 2 || position < 1) return 0;
  return Math.round((Math.max(0, annualRevenue) * 0.1 * clamp(size - position, 0, size - 1)) / (size - 1));
}

/**
 * Solidarity for a club relegated from the top flight, as a share of its last top-flight revenue. Only England's
 * Premier League parachute is modelled (about £49M/£40M/£17M on ~£140M: 35%, 28%, then 12% only after two or more
 * top-flight seasons); other leagues' relegation aid is unverified and not paid.
 */
export function parachutePayment(
  countryCode: string,
  seasonsSinceRelegation: number,
  topFlightSeasons: number,
  lastTopFlightRevenue: number,
) {
  if (countryCode !== "EN" || lastTopFlightRevenue <= 0) return 0;
  const share = [0.35, 0.28, topFlightSeasons >= 2 ? 0.12 : 0][seasonsSinceRelegation - 1] ?? 0;
  return Math.round(lastTopFlightRevenue * share);
}

/** Budget multipliers after a league move (1 when the club stayed up/down). */
export const MOVEMENT_BUDGET_FACTOR = { promoted: 1.25, relegated: 0.75, none: 1 } as const;

export interface SeasonBudgetInput {
  balance: number;
  /** Transfer allocation reserved by signed future/pending deals. */
  reserved: number;
  /** Unpaid instalments this club owes (transfer_payments where it is the payer). */
  owedInstalments: number;
  /** The reference wage budget fixed at the start of the previous season (clubs.data.operatingWageBudget). */
  wageReference: number;
  movement: keyof typeof MOVEMENT_BUDGET_FACTOR;
}

/**
 * Next season's budgets: 40% of cash less reserved deals and ALL unpaid instalments (deferred fees are debt),
 * scaled by promotion/relegation; the wage budget returns to the reference × movement factor, so a budget slider
 * move lasts one season instead of turning each expiring transfer budget into permanent wage room.
 */
export function seasonBudgets(input: SeasonBudgetInput) {
  const factor = MOVEMENT_BUDGET_FACTOR[input.movement];
  return {
    transferBudget: Math.round(
      Math.max(0, input.balance * 0.4 - Math.max(0, input.reserved) - Math.max(0, input.owedInstalments)) * factor,
    ),
    wageBudget: Math.round(Math.max(0, input.wageReference) * factor),
  };
}

/** Unpaid transfer instalments owed by a club. */
export async function owedInstalments(store: Store, clubId: number) {
  return (
    await store.get<{ total: number }>(
      "SELECT coalesce(sum(amount),0) AS total FROM transfer_payments WHERE payer_id = ? AND paid_date IS NULL",
      clubId,
    )
  )!.total;
}

/** A club with a negative cash balance may not pay transfer fees (simplified embargo); free and fee-less deals remain. */
export const transferEmbargo = (balance: number, fee: number) => balance < 0 && fee > 0;

export function initialClubFinances(
  input: ClubEconomyInput,
): Pick<Club, "balance" | "transfer_budget" | "wage_budget"> {
  const { annualOperatingRevenue } = estimateClubRevenue(input);
  return {
    balance: Math.round(annualOperatingRevenue * 0.2),
    transfer_budget: Math.round(annualOperatingRevenue * 0.08),
    wage_budget: Math.round((annualOperatingRevenue * 0.55) / 52),
  };
}

export interface ClubValuationInput {
  annualOperatingRevenue: number;
  reputation: number;
  cashBalance: number;
  financialDebt: number;
}

export interface ClubValuation {
  currency: "GBP";
  revenueMultiple: number;
  enterpriseValue: number;
  netDebt: number;
  equityValue: number;
  fundingGap: number;
}

export function clubValuation(input: ClubValuationInput): ClubValuation {
  if (
    ![
      input.annualOperatingRevenue,
      input.reputation,
      input.cashBalance,
      input.financialDebt,
    ].every(Number.isFinite) ||
    input.annualOperatingRevenue < 0 ||
    input.financialDebt < 0
  )
    throw new Error(
      "Club valuation requires finite inputs and non-negative revenue and debt.",
    );
  const revenueMultiple = 0.5 + 4 * (clamp(input.reputation, 0, 100) / 100) ** 2;
  const enterpriseValue = Math.round(
    input.annualOperatingRevenue * revenueMultiple,
  );
  const netDebt = round(input.financialDebt - input.cashBalance, 2);
  return {
    currency: "GBP",
    revenueMultiple,
    enterpriseValue,
    netDebt,
    equityValue: Math.max(0, round(enterpriseValue - netDebt, 2)),
    fundingGap: Math.max(0, round(netDebt - enterpriseValue, 2)),
  };
}

export async function recordFinancialItem(
  store: Store,
  clubId: number,
  field: keyof Pick<
    FinancialPeriod,
    | "revenue"
    | "wages"
    | "operating"
    | "amortization"
    | "agent_fees"
    | "sale_profit"
    | "excluded_investment"
    | "equity"
  >,
  amount: number,
  season?: number,
) {
  if (!Number.isFinite(amount))
    throw new Error("Non-finite financial posting.");
  const postingSeason = season ?? (await store.meta<GameState>("state")).season;
  await store.run(
    `INSERT INTO financial_periods (club_id, season, ${field}) VALUES (?, ?, ?)
     ON CONFLICT (club_id, season) DO UPDATE SET ${field} = financial_periods.${field} + EXCLUDED.${field}`,
    clubId,
    postingSeason,
    amount,
  );
}

export function assetAmortization(
  cost: number,
  acquired: string,
  expires: string,
) {
  const years = clamp(daysBetween(acquired, expires) / 365.25, 1 / 365.25, 5);
  return cost / years;
}

export async function annualAmortization(
  store: Store,
  clubId: number,
  date: string,
) {
  return (
    await store.all<{ cost: number; acquired: string; expires: string }>(
      "SELECT * FROM player_assets WHERE club_id = ? AND status = 'active' AND expires > ?",
      clubId,
      date,
    )
  ).reduce(
    (total, asset) =>
      total +
      (daysBetween(asset.acquired, date) <
      Math.min(5 * 365.25, daysBetween(asset.acquired, asset.expires))
        ? assetAmortization(asset.cost, asset.acquired, asset.expires)
        : 0),
    0,
  );
}

export async function acquirePlayerAsset(
  store: Store,
  clubId: number,
  playerId: number,
  cost: number,
  date: string,
  expires: string,
) {
  if (cost < 0 || expires <= date)
    throw new Error("Invalid player registration asset.");
  await store.run(
    "INSERT INTO player_assets(club_id,player_id,cost,acquired,expires) VALUES (?,?,?,?,?)",
    clubId,
    playerId,
    cost,
    date,
    expires,
  );
}

export async function sellPlayerAsset(
  store: Store,
  clubId: number,
  playerId: number,
  proceeds: number,
  date: string,
) {
  const assets = await store.all<{
    id: number;
    cost: number;
    acquired: string;
    expires: string;
  }>(
    "SELECT * FROM player_assets WHERE player_id = ? AND club_id = ? AND status = 'active'",
    playerId,
    clubId,
  );
  const bookValue = assets.reduce(
    (sum, asset) =>
      sum +
      Math.max(
        0,
        asset.cost -
          (assetAmortization(asset.cost, asset.acquired, asset.expires) *
            Math.max(0, daysBetween(asset.acquired, date))) /
            365.25,
      ),
    0,
  );
  const profit = proceeds - bookValue;
  await recordFinancialItem(store, clubId, "sale_profit", profit);
  await store.run(
    "UPDATE player_assets SET status = 'sold' WHERE player_id = ? AND club_id = ? AND status = 'active'",
    playerId,
    clubId,
  );
  return { proceeds, bookValue, profit };
}

export async function projectedOperatingRevenue(store: Store, club: Club) {
  const league = await store.get<League>(
    "SELECT * FROM leagues WHERE id = ?",
    club.league_id,
  );
  const size = (await store.get<{ total: number }>(
    "SELECT count(*) AS total FROM standings WHERE league_id = ?",
    club.league_id,
  ))!.total;
  const country = await store.get<{ code: string }>(
    "SELECT code FROM countries WHERE id = ?",
    league?.country_id ?? club.country_id,
  );
  return estimateClubRevenue({
    reputation: club.reputation,
    leagueReputation: league?.reputation ?? club.reputation,
    tier: league?.tier ?? 1,
    capacity: club.capacity,
    fanMood: club.fan_mood,
    homeMatches: Math.max(0, size - 1) + 2,
    countryCode: country?.code,
  }).annualOperatingRevenue;
}

export async function assessFinances(
  store: Store,
  clubId: number,
  proposed: {
    annualWages?: number;
    fee?: number;
    agentFee?: number;
    years?: number;
  } = {},
): Promise<FinancialAssessment> {
  const state = await store.meta<GameState>("state");
  const club = (await store.get<Club>(
    "SELECT * FROM clubs WHERE id = ?",
    clubId,
  ))!;
  const country = (await store.get<{ code: string }>(
    "SELECT code FROM countries WHERE id = ?",
    club.country_id,
  ))!;
  const league = await store.get<League>(
    "SELECT * FROM leagues WHERE id = ?",
    club.league_id,
  );
  const continental = !!(await store.get(
    "SELECT standings.club_id FROM standings JOIN leagues ON leagues.id = standings.league_id WHERE standings.club_id = ? AND leagues.kind = 'continental' AND leagues.confederation = 'UEFA' LIMIT 1",
    clubId,
  ));
  const premier = country.code === "EN" && league?.tier === 1;
  const periods = await store.all<FinancialPeriod>(
    "SELECT * FROM financial_periods WHERE club_id = ? AND season BETWEEN ? AND ? ORDER BY season",
    clubId,
    state.season - 2,
    state.season,
  );
  const current = periods.find((period) => period.season === state.season);
  const elapsedWeeks = Math.max(
    1,
    daysBetween(`${state.season}-07-01`, state.date) / 7,
  );
  const projected = !current?.closed;
  const recordedRevenue = current?.revenue ?? 0;
  const revenue = projected
    ? Math.max(
        recordedRevenue,
        recordedRevenue +
          ((await projectedOperatingRevenue(store, club)) *
            Math.max(0, 52 - elapsedWeeks)) /
            52,
      )
    : recordedRevenue;
  const playerWages = (await store.get<{ total: number }>(
    "SELECT coalesce(sum(wage),0) AS total FROM players WHERE (club_id = ? AND parent_club_id IS NULL) OR parent_club_id = ?",
    clubId,
    clubId,
  ))!.total;
  const loanAdjustment = (await store.get<{ total: number }>(
    `SELECT coalesce(sum(CASE WHEN loans.destination_id = ? THEN 1 ELSE -1 END * players.wage * (
       jsonb_path_query_first(loans.terms::jsonb, '$.salarySplit ? (@.type() == "number")') #>> '{}')::double precision / 100), 0) AS total
     FROM loans JOIN players ON players.id = loans.player_id
     WHERE loans.status = 'active' AND (loans.parent_id = ? OR loans.destination_id = ?)`,
    clubId,
    clubId,
    clubId,
  ))!.total;
  const staffWages = (await store.get<{ total: number }>(
    "SELECT coalesce(sum(wage),0) AS total FROM staff WHERE club_id = ?",
    clubId,
  ))!.total;
  const wages = projected
    ? (current?.wages ?? 0) +
      (playerWages + loanAdjustment + staffWages) *
        Math.max(0, 52 - elapsedWeeks)
    : current.wages;
  const amortization = await annualAmortization(store, clubId, state.date);
  const newAmortization =
    (proposed.fee ?? 0) / Math.min(5, Math.max(1, proposed.years ?? 4));
  const squadCost =
    wages +
    (current?.amortization ?? 0) +
    (projected ? (amortization * Math.max(0, 52 - elapsedWeeks)) / 52 : 0) +
    (current?.agent_fees ?? 0) +
    (proposed.annualWages ?? 0) +
    newAmortization +
    (proposed.agentFee ?? 0);
  const saleProfit =
    periods.reduce((total, period) => total + period.sale_profit, 0) / 3;
  const footballRevenue = Math.max(1, revenue + saleProfit);
  const ratio = squadCost / footballRevenue;
  const earnings = periods.reduce(
    (total, period) =>
      total +
      period.revenue +
      period.sale_profit -
      period.wages -
      period.operating -
      period.amortization -
      period.agent_fees,
    0,
  );
  const equity = periods.reduce((total, period) => total + period.equity, 0);
  const euroToPound = 0.86;
  const allowableLoss = continental
    ? (5_000_000 + Math.min(55_000_000, equity / euroToPound)) * euroToPound
    : null;
  const squadCostLimit = continental
    ? 0.7
    : premier && state.season >= 2026
      ? 0.85
      : null;
  const issues: string[] = [];
  if (squadCostLimit !== null && ratio > squadCostLimit)
    issues.push(
      `Squad costs are ${round(ratio * 100)}% of football revenue against a ${squadCostLimit * 100}% limit.`,
    );
  if (allowableLoss !== null && earnings < -allowableLoss)
    issues.push(
      "Recorded football earnings exceed the equity-supported acceptable deviation.",
    );
  if (club.balance < 0)
    issues.push("Negative cash balance requires a funding or recovery plan.");
  return {
    policy: continental
      ? "UEFA financial sustainability"
      : premier && state.season >= 2026
        ? "Premier League SCR 2026/27"
        : "Domestic club solvency",
    currency: "GBP",
    squadCostLimit,
    squadCostRatio: ratio,
    squadCost,
    footballRevenue,
    rollingEarnings: earnings,
    allowableLoss,
    lossHeadroom: allowableLoss === null ? null : allowableLoss + earnings,
    costHeadroom:
      squadCostLimit === null
        ? null
        : footballRevenue * squadCostLimit - squadCost,
    yearsObserved: periods.length,
    projected,
    status: issues.length ? (projected ? "monitoring" : "review") : "compliant",
    issues,
    periods,
    annualAmortization: amortization + newAmortization,
    levyApplies: premier && state.season >= 2027,
    source: continental
      ? "UEFA Club Licensing and Financial Sustainability Regulations; fixed game FX EUR 1 = GBP 0.86"
      : premier
        ? "Premier League Handbook 2026/27, Appendix 2, A.1.6, A.1.9 and transitional application"
        : "Local solvency and agreed club budgets; no unverified national FFP threshold",
  };
}

export async function postWeeklyAccounts(
  store: Store,
  clubId: number,
  revenue: number,
  wages: number,
  operating: number,
  academy: number,
) {
  const state = await store.meta<GameState>("state");
  const amortization =
    (await annualAmortization(store, clubId, state.date)) / 52;
  await store.run(
    `INSERT INTO financial_periods (club_id, season, revenue, wages, operating, amortization, excluded_investment)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (club_id, season) DO UPDATE SET revenue = financial_periods.revenue + EXCLUDED.revenue,
       wages = financial_periods.wages + EXCLUDED.wages, operating = financial_periods.operating + EXCLUDED.operating,
       amortization = financial_periods.amortization + EXCLUDED.amortization,
       excluded_investment = financial_periods.excluded_investment + EXCLUDED.excluded_investment`,
    clubId,
    state.season,
    revenue,
    wages,
    operating,
    amortization,
    academy,
  );
}

export async function closeFinancialYear(store: Store, season: number) {
  await store.run(
    "UPDATE financial_periods SET closed = 1 WHERE season = ?",
    season,
  );
  await store.run(
    "UPDATE player_assets SET status = 'expired' WHERE status = 'active' AND expires < ?",
    addDays(`${season + 1}-07-01`, 0),
  );
}
