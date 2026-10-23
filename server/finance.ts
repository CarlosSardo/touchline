import { Store, type SqlParameter } from "./db.ts";
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
  /**
   * Additional annual squad cost (GBP) before the binding rule is breached: the planning gate for new spending (from
   * 15 June to the rollover, also within next season's projection; for a club in Europe now, a top-half top-flight club
   * or a domestic cup winner, under both the UEFA and its domestic rules, since continental places are resolved at the
   * rollover: preseasonHeadroom).
   */
  ffpHeadroom: number;
  /** Share of a transfer fee that uses headroom besides its amortisation: the cash a domestic solvency gate counts (signingHeadroomCost). */
  feeCashShare: number;
  /** Weekly player wage bill after loan wage splits (staff excluded). */
  weeklyWages: number;
  /** Projected weekly operating cash result at today's payroll (revenue less wages and running costs; fees are paid from the transfer budget); 0 once the season is closed. */
  weeklySurplus: number;
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

/**
 * Income of lower divisions beyond the gate and the national commercial market: league central distributions and
 * solidarity payments, sponsorship, hospitality and bar income, as a share of a season of 20 home gates. Nothing in
 * the top two tiers (their broadcast and commercial deals are the commercial term), 15% in the third, 40% in the
 * fourth, 60% in the fifth and 120% from the sixth, where semi-professional clubs live on community income (2023-25
 * EFL basic award and solidarity of about £1.5-2.5M per League One/Two club; National League clubs report
 * commercial and other income at or above their gate receipts).
 */
export const OTHER_INCOME_SHARE = [0, 0, 0.15, 0.4, 0.6, 1.2] as const;

/** Home league matches of a club in a season: one against each other club of its league group, plus two cup or play-off ties. */
export const seasonHomeMatches = (groupSize: number) => Math.max(0, groupSize - 1) + 2;

/** Size of each club's league table group (grouped divisions share a league id), from the standings. */
export async function leagueGroupSizes(store: Store, clubIds?: readonly number[]) {
  return new Map(
    (
      await store.all<{ club_id: number; size: number }>(
        `SELECT club_id, size FROM (
           SELECT standings.club_id, standings.league_id, count(*) OVER (PARTITION BY standings.league_id, standings.group_name) AS size
           FROM standings) AS groups
         JOIN clubs ON clubs.id = groups.club_id AND clubs.league_id = groups.league_id
         ${clubIds ? "WHERE groups.club_id = ANY(?::integer[])" : ""}`,
        ...(clubIds ? [[...clubIds]] : []),
      )
    ).map((row) => [row.club_id, row.size]),
  );
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
  const other = Math.round(matchdayPerHomeMatch * 20 * OTHER_INCOME_SHARE[Math.min(tier, OTHER_INCOME_SHARE.length) - 1]);
  return {
    currency: "GBP",
    annualCommercial: annualCommercial + other,
    matchdayPerHomeMatch,
    annualMatchday,
    annualOperatingRevenue: annualCommercial + other + annualMatchday,
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

/** Most of its expected revenue a club spends on backroom staff: semi-professional clubs employ them part-time (top flights spend well under 1%). */
export const STAFF_REVENUE_SHARE = 0.15;
/** Least of its expected revenue a board keeps for player wages, so a semi-professional club keeps a small professional core. */
export const PLAYER_WAGE_FLOOR_SHARE = 0.45;

/** Share of full-time pay a club's staff draw (1, or less where their wages exceed STAFF_REVENUE_SHARE of revenue). */
export const partTimeStaffFactor = (staffWages: number, annualRevenue: number) =>
  staffWages > 0 ? Math.min(1, (STAFF_REVENUE_SHARE * Math.max(0, annualRevenue)) / 52 / staffWages) : 1;

/**
 * AI clubs whose backroom staff cost more than STAFF_REVENUE_SHARE of their expected revenue put them on part-time
 * terms (wages scaled pro rata, at least 10 a week). Set-based; returns each club's staff wages after the change.
 */
export async function alignPartTimeStaff(store: Store, revenues: Map<number, number>, excluded: ReadonlySet<number>) {
  const totals = new Map(
    (await store.all<{ club_id: number; total: number }>("SELECT club_id, sum(wage) AS total FROM staff WHERE club_id IS NOT NULL GROUP BY club_id")).map(
      (row) => [row.club_id, row.total],
    ),
  );
  const changes = [...totals].flatMap(([clubId, total]) => {
    const revenue = revenues.get(clubId);
    if (revenue === undefined || excluded.has(clubId)) return [];
    const factor = partTimeStaffFactor(total, revenue);
    return factor < 0.98 ? [{ clubId, factor }] : [];
  });
  if (!changes.length) return totals;
  const updated = await store.all<{ club_id: number; total: number }>(
    `WITH changed AS (
       UPDATE staff AS target SET wage = GREATEST(10, round(target.wage * changes.factor))
       FROM unnest(?::integer[], ?::double precision[]) AS changes(club_id, factor) WHERE target.club_id = changes.club_id
       RETURNING target.club_id, target.wage)
     SELECT club_id, sum(wage) AS total FROM changed GROUP BY club_id`,
    changes.map((change) => change.clubId),
    changes.map((change) => change.factor),
  );
  for (const row of updated) totals.set(row.club_id, row.total);
  return totals;
}

/**
 * The weekly wage budget a board can sustain: a full player payroll (the world market fills the budget) plus staff
 * wages and facilities/academy upkeep within the club's spend ratio of its expected revenue. AI boards cap next
 * season's wage budget at it, so a club paying more than it earns shrinks its payroll through sales, releases and
 * expiring contracts. Staff count at most STAFF_REVENUE_SHARE (part-time terms, alignPartTimeStaff) and the budget never
 * falls below PLAYER_WAGE_FLOOR_SHARE of revenue.
 */
export function sustainableWageBudget(input: { annualRevenue: number; spendRatio: number; staffWages: number; facilities: number; academy: number }) {
  const weekly = Math.max(0, input.annualRevenue) / 52;
  const upkeep = weeklyOperatingCosts({ ...input, wageShare: 0, balance: input.annualRevenue });
  const staff = Math.min(input.staffWages, STAFF_REVENUE_SHARE * weekly);
  return Math.round(Math.max(PLAYER_WAGE_FLOOR_SHARE * weekly, input.spendRatio * weekly - staff - upkeep.facilities - upkeep.academy));
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
  return (await annualAmortizations(store, [clubId], date)).get(clubId) ?? 0;
}

/** annualAmortization for many clubs with one query; clubs without active assets are absent. */
export async function annualAmortizations(
  store: Store,
  clubIds: readonly number[],
  date: string,
) {
  const totals = new Map<number, number>();
  if (!clubIds.length) return totals;
  for (const asset of await store.all<{ club_id: number; cost: number; acquired: string; expires: string }>(
    "SELECT club_id, cost, acquired, expires FROM player_assets WHERE club_id = ANY(?::integer[]) AND status = 'active' AND expires > ? ORDER BY club_id, id",
    clubIds,
    date,
  ))
    totals.set(
      asset.club_id,
      (totals.get(asset.club_id) ?? 0) +
        (daysBetween(asset.acquired, date) <
        Math.min(5 * 365.25, daysBetween(asset.acquired, asset.expires))
          ? assetAmortization(asset.cost, asset.acquired, asset.expires)
          : 0),
    );
  return totals;
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
  const size = (await leagueGroupSizes(store, [club.id])).get(club.id) ?? 0;
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
    homeMatches: seasonHomeMatches(size),
    countryCode: country?.code,
  }).annualOperatingRevenue;
}

export interface ProposedSpend {
  annualWages?: number;
  fee?: number;
  agentFee?: number;
  years?: number;
}

/** Everything the regulations read about one club, loaded for many clubs at once by assessFinancesBatch. */
type FinanceClub = Pick<Club, "id" | "reputation" | "capacity" | "fan_mood" | "balance" | "wage_budget" | "facilities" | "academy"> & {
  operating_wage_budget: number | null;
};

interface FinanceInputs {
  club: FinanceClub;
  clubCode: string;
  revenueCode: string | undefined;
  leagueReputation: number | null;
  tier: number | null;
  leagueSize: number;
  continental: boolean;
  periods: FinancialPeriod[];
  playerWages: number;
  loanAdjustment: number;
  staffWages: number;
  amortization: number;
}

/**
 * Share of its cash a club without a league or UEFA cost rule may commit to added annual squad cost on top of the
 * season's projected operating result (domestic solvency: a board does not plan to run out of money). A planning gate
 * on new spending only, never a regulatory breach.
 */
export const SOLVENCY_CASH_SHARE = 0.5;
const EURO_TO_POUND = 0.86;

/** The rules applied to one club's season `season` (state.season, or an earlier closed season at the year-end review). */
function financialAssessment(
  input: FinanceInputs,
  state: Pick<GameState, "season" | "date">,
  season: number,
  proposed: ProposedSpend,
): FinancialAssessment {
  const { club, periods } = input;
  const premier = input.clubCode === "EN" && input.tier === 1;
  const current = periods.find((period) => period.season === season);
  const elapsedWeeks = Math.max(1, daysBetween(`${state.season}-07-01`, state.date) / 7);
  const remainingWeeks = Math.max(0, 52 - elapsedWeeks);
  const projected = !current?.closed;
  const recordedRevenue = current?.revenue ?? 0;
  const operatingRevenue = estimateClubRevenue({
    reputation: club.reputation,
    leagueReputation: input.leagueReputation ?? club.reputation,
    tier: input.tier ?? 1,
    capacity: club.capacity,
    fanMood: club.fan_mood,
    homeMatches: seasonHomeMatches(input.leagueSize),
    countryCode: input.revenueCode,
  }).annualOperatingRevenue;
  const revenue = projected
    ? Math.max(recordedRevenue, recordedRevenue + (operatingRevenue * remainingWeeks) / 52)
    : recordedRevenue;
  const weeklyWages = input.playerWages + input.loanAdjustment + input.staffWages;
  const wages = projected ? (current?.wages ?? 0) + weeklyWages * remainingWeeks : current.wages;
  const newAmortization = (proposed.fee ?? 0) / Math.min(5, Math.max(1, proposed.years ?? 4));
  const proposedCost = (proposed.annualWages ?? 0) + newAmortization + (proposed.agentFee ?? 0);
  const squadCost =
    wages +
    (current?.amortization ?? 0) +
    (projected ? (input.amortization * remainingWeeks) / 52 : 0) +
    (current?.agent_fees ?? 0) +
    proposedCost;
  const saleProfit = periods.reduce((total, period) => total + period.sale_profit, 0) / 3;
  const footballRevenue = Math.max(1, revenue + saleProfit);
  const ratio = squadCost / footballRevenue;
  const earningsOf = (period: FinancialPeriod) =>
    period.revenue + period.sale_profit - period.wages - period.operating - period.amortization - period.agent_fees;
  const earnings = periods.reduce((total, period) => total + earningsOf(period), 0);
  const equity = periods.reduce((total, period) => total + period.equity, 0);
  const allowableLoss = input.continental ? (5_000_000 + Math.min(55_000_000, equity / EURO_TO_POUND)) * EURO_TO_POUND : null;
  const squadCostLimit = input.continental ? 0.7 : premier && state.season >= 2026 ? 0.85 : null;
  const issues: string[] = [];
  if (squadCostLimit !== null && ratio > squadCostLimit)
    issues.push(`Squad costs are ${round(ratio * 100)}% of football revenue against a ${squadCostLimit * 100}% limit.`);
  if (allowableLoss !== null && earnings < -allowableLoss)
    issues.push("Recorded football earnings exceed the equity-supported acceptable deviation.");
  if (club.balance < 0) issues.push("Negative cash balance requires a funding or recovery plan.");
  const costHeadroom = squadCostLimit === null ? null : footballRevenue * squadCostLimit - squadCost;
  // The board's planning view: the rest of this season's result projected from the weekly accounts.
  let remainingResult = 0;
  let weeklySurplus = 0;
  if (projected) {
    const reference = club.operating_wage_budget ?? club.wage_budget;
    const operating = weeklyOperatingCosts({
      annualRevenue: operatingRevenue,
      wageShare: (0.88 * reference * 52) / Math.max(1, operatingRevenue),
      spendRatio: spendRatio(club.id, input.tier ?? 1),
      facilities: club.facilities,
      academy: club.academy,
      balance: club.balance,
      staffWages: input.staffWages,
    });
    weeklySurplus = operatingRevenue / 52 - weeklyWages - operating.facilities - operating.operations;
    remainingResult = remainingWeeks * weeklySurplus - (input.amortization * remainingWeeks) / 52;
  }
  const lossGate = allowableLoss === null ? null : allowableLoss + earnings + remainingResult - proposedCost;
  const gates = [
    costHeadroom,
    lossGate,
    squadCostLimit === null ? Math.max(0, club.balance - (proposed.fee ?? 0)) * SOLVENCY_CASH_SHARE + remainingResult - proposedCost : null,
  ].filter((value): value is number => value !== null);
  return {
    policy: input.continental
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
    costHeadroom,
    ffpHeadroom: Math.round(Math.min(...gates)),
    feeCashShare: squadCostLimit === null ? SOLVENCY_CASH_SHARE : 0,
    weeklyWages: input.playerWages + input.loanAdjustment,
    weeklySurplus: Math.round(weeklySurplus),
    yearsObserved: periods.length,
    projected,
    status: issues.length ? (projected ? "monitoring" : "review") : "compliant",
    issues,
    periods,
    annualAmortization: input.amortization + newAmortization,
    levyApplies: premier && state.season >= 2027,
    source: input.continental
      ? "UEFA Club Licensing and Financial Sustainability Regulations; fixed game FX EUR 1 = GBP 0.86"
      : premier
        ? "Premier League Handbook 2026/27, Appendix 2, A.1.6, A.1.9 and transitional application"
        : "Local solvency and agreed club budgets; no unverified national FFP threshold",
  };
}

/**
 * The financial regulations of many clubs (all non-national clubs by default) with one query per input, for the
 * daily club policy snapshot and the year-end review. `season` defaults to the current season; an earlier, closed
 * season is assessed on its recorded accounts.
 */
export async function assessFinancesBatch(
  store: Store,
  options: {
    clubIds?: readonly number[];
    season?: number;
    proposed?: ProposedSpend;
    /** Weekly player wages by owning club (coalesce(parent_club_id, club_id)) when the caller has them already. */
    playerWages?: ReadonlyMap<number, number>;
  } = {},
) {
  const state = await store.meta<GameState>("state");
  const season = options.season ?? state.season;
  const ids = options.clubIds ? [...options.clubIds] : null;
  const filter = (column: string) => (ids ? `AND ${column} = ANY(?::integer[])` : "");
  const bind = ids ? [ids] : [];
  const clubs = await store.all<FinanceClub & { club_code: string; revenue_code: string | null; league_reputation: number | null; tier: number | null }>(
    `SELECT clubs.id, clubs.reputation, clubs.capacity, clubs.fan_mood, clubs.balance, clubs.wage_budget, clubs.facilities, clubs.academy,
       (clubs.data::jsonb ->> 'operatingWageBudget')::double precision AS operating_wage_budget, own.code AS club_code, home.code AS revenue_code, leagues.reputation AS league_reputation, leagues.tier
     FROM clubs JOIN countries AS own ON own.id = clubs.country_id
     LEFT JOIN leagues ON leagues.id = clubs.league_id
     LEFT JOIN countries AS home ON home.id = coalesce(leagues.country_id, clubs.country_id)
     WHERE clubs.type != 'national' ${filter("clubs.id")} ORDER BY clubs.id`,
    ...bind,
  );
  const clubIds = clubs.map((club) => club.id);
  const groupSizes = await leagueGroupSizes(store, ids ?? undefined);
  const totals = async (sql: string, ...parameters: SqlParameter[]) =>
    new Map((await store.all<{ club_id: number; total: number }>(sql, ...parameters)).map((row) => [row.club_id, row.total]));
  const continental = new Set(
    (
      await store.all<{ club_id: number }>(
        `SELECT DISTINCT standings.club_id FROM standings JOIN leagues ON leagues.id = standings.league_id
         WHERE leagues.kind = 'continental' AND leagues.confederation = 'UEFA' ${filter("standings.club_id")}`,
        ...bind,
      )
    ).map((row) => row.club_id),
  );
  const periods = new Map<number, FinancialPeriod[]>();
  for (const period of await store.all<FinancialPeriod>(
    `SELECT * FROM financial_periods WHERE season BETWEEN ? AND ? ${filter("club_id")} ORDER BY club_id, season`,
    season - 2,
    season,
    ...bind,
  ))
    periods.set(period.club_id, [...(periods.get(period.club_id) ?? []), period]);
  // A loaned-out player's full wage stays with the parent; the loan split moves the borrower's share (below).
  const playerWages = options.playerWages ?? await totals(
    `SELECT coalesce(parent_club_id, club_id) AS club_id, coalesce(sum(wage),0) AS total FROM players
     WHERE ${ids ? "(club_id = ANY(?::integer[]) AND parent_club_id IS NULL) OR parent_club_id = ANY(?::integer[])" : "club_id IS NOT NULL"}
     GROUP BY coalesce(parent_club_id, club_id)`,
    ...(ids ? [ids, ids] : []),
  );
  // `runningAfter`: only loans still running after that date (next season's split; world loans expire on their end date).
  const loanShares = (runningAfter?: string) =>
    totals(
      `SELECT club_id, sum(amount) AS total FROM (
         SELECT CASE WHEN side.borrower THEN loans.destination_id ELSE loans.parent_id END AS club_id,
           CASE WHEN side.borrower THEN 1 ELSE -1 END * players.wage *
             (jsonb_path_query_first(loans.terms::jsonb, '$.salarySplit ? (@.type() == "number")') #>> '{}')::double precision / 100 AS amount
         FROM loans JOIN players ON players.id = loans.player_id CROSS JOIN (VALUES (true), (false)) AS side(borrower)
         WHERE loans.status = 'active' ${runningAfter ? "AND loans.end_date > ?" : ""}) AS shares
       WHERE amount IS NOT NULL ${filter("club_id")} GROUP BY club_id`,
      ...(runningAfter ? [runningAfter] : []),
      ...bind,
    );
  const loanAdjustment = await loanShares();
  const staffWages = await totals(
    `SELECT club_id, coalesce(sum(wage),0) AS total FROM staff WHERE club_id IS NOT NULL ${filter("club_id")} GROUP BY club_id`,
    ...bind,
  );
  const amortization = await annualAmortizations(store, clubIds, state.date);
  // From the summer window's opening to the rollover, deals also count against next season (preseasonHeadroom).
  const preseason = season === state.season && state.date >= `${season + 1}-06-15`;
  const moves = preseason ? await (await import("./calendar.ts")).plannedLeagueMoves(store, season) : null;
  const destinations = new Map(
    moves
      ? (
          await store.all<{ id: number; tier: number; reputation: number }>(
            "SELECT id, tier, reputation FROM leagues WHERE id = ANY(?::integer[])",
            [...new Set([...moves.values()].map((move) => move.leagueId))],
          )
        ).map((league) => [league.id, league])
      : [],
  );
  const ownerPayments = preseason ? await (await import("./ownership.ts")).rolloverOwnerPayments(store, season, clubIds) : null;
  const relegated = moves ? [...moves].filter(([, move]) => move.movement === "relegated").map(([id]) => id) : [];
  const clauseSavings = relegated.length ? await (await import("./contract-clauses.ts")).relegationWageSavings(store, relegated) : null;
  const expiring = preseason
    ? await totals(
        `SELECT coalesce(parent_club_id, club_id) AS club_id, sum(wage) AS total FROM players
         WHERE club_id IS NOT NULL AND role <> 'Retired' AND contract_end < ? ${filter("coalesce(parent_club_id, club_id)")} GROUP BY 1`,
        `${season + 1}-07-01`,
        ...bind,
      )
    : null;
  // Loans ending by the rollover hand their wages back to the parent next season.
  const nextLoanAdjustment = preseason ? await loanShares(`${season + 1}-07-01`) : null;
  // A continental place is won at the rollover from the top half of a top-flight table or a domestic cup (any tier).
  const contenders = preseason
    ? new Set(
        (
          await store.all<{ club_id: number }>(
            `SELECT club_id FROM (
               SELECT standings.club_id, rank() OVER (PARTITION BY standings.league_id, standings.group_name
                 ORDER BY standings.points DESC, standings.gf - standings.ga DESC) AS position,
                 count(*) OVER (PARTITION BY standings.league_id, standings.group_name) AS size
               FROM standings JOIN leagues ON leagues.id = standings.league_id
               WHERE leagues.kind = 'league' AND leagues.age_group = 'Senior' AND leagues.tier = 1) AS tables
             WHERE 2 * position <= size + 1 ${filter("club_id")}
             UNION
             SELECT club_id FROM (
               SELECT (history.data::jsonb ->> 'clubId')::integer AS club_id FROM history JOIN leagues ON leagues.id = history.entity_id
               WHERE history.entity_type = 'champion' AND history.season = ? AND leagues.kind = 'cup' AND leagues.age_group = 'Senior'
                 AND leagues.country_id IS NOT NULL) AS cups
             WHERE true ${filter("club_id")}`,
            ...bind,
            season,
            ...bind,
          )
        ).map((row) => row.club_id),
      )
    : null;
  return new Map(
    clubs.map((club) => {
      const input: FinanceInputs = {
        club,
        clubCode: club.club_code,
        revenueCode: club.revenue_code ?? undefined,
        leagueReputation: club.league_reputation,
        tier: club.tier,
        leagueSize: groupSizes.get(club.id) ?? 0,
        continental: continental.has(club.id),
        periods: periods.get(club.id) ?? [],
        playerWages: playerWages.get(club.id) ?? 0,
        loanAdjustment: loanAdjustment.get(club.id) ?? 0,
        staffWages: staffWages.get(club.id) ?? 0,
        amortization: amortization.get(club.id) ?? 0,
      };
      const closing = financialAssessment(input, state, season, options.proposed ?? {});
      if (!moves) return [club.id, closing];
      const move = moves.get(club.id);
      const league = move && destinations.get(move.leagueId);
      const next = nextSeasonInputs(input, season, {
        move: move && league ? { movement: move.movement, tier: league.tier, reputation: league.reputation } : undefined,
        ownerPayments: ownerPayments?.get(club.id) ?? 0,
        expiringWages: expiring?.get(club.id) ?? 0,
        clauseSavings: clauseSavings?.get(club.id) ?? 0,
        loanAdjustment: nextLoanAdjustment?.get(club.id) ?? 0,
      });
      // Continental places are resolved at the rollover: a club in Europe now may drop out and a contender may
      // qualify, so either set of rules may apply to them next season.
      const uncertain = next.continental || Boolean(contenders?.has(club.id));
      const projection = (uncertain ? [next, { ...next, continental: !next.continental }] : [next])
        .map((inputs) => financialAssessment(inputs, { season: season + 1, date: `${season + 1}-07-01` }, season + 1, options.proposed ?? {}))
        .reduce((strictest, candidate) => (candidate.ffpHeadroom < strictest.ffpHeadroom ? candidate : strictest));
      return [club.id, projection.ffpHeadroom < closing.ffpHeadroom ? { ...closing, ffpHeadroom: projection.ffpHeadroom, feeCashShare: projection.feeCashShare } : closing];
    }),
  );
}

/** Share of next season's wage budget an AI club fills with running contracts and renewals (youth.ts uses the same). */
export const RENEWAL_BUDGET_SHARE = 0.95;

/**
 * Between the summer window's opening (15 June) and the rollover a deal runs into next season at once: the closing
 * season's accounts alone would let a club sign what next season cannot carry, and the rollover would find it over its
 * limit. The planning gate (assessFinancesBatch) is then the stricter of the closing season and next season from its
 * first day, as the rollover will set it up: the league the club moves to (tier, reputation and rules; with or without
 * a continental place, which the rollover resolves), the club's reputation and fan mood after the move
 * (seasonRollover), the operating plan on next season's budget (MOVEMENT_BUDGET_FACTOR, as resetSeasonBudgets sets it),
 * the cash after the owners' interest and dividends, the payroll of the contracts running on (after relegation clauses,
 * with the wage splits of the loans still running) plus the expiring ones the club can renew within that budget (as the
 * rollover's renewals do, youth.ts aiRenewalTerms), amortisation for the full year and the rolling periods without the
 * oldest.
 */
function nextSeasonInputs(
  input: FinanceInputs,
  season: number,
  next: {
    move?: { movement: "promoted" | "relegated"; tier: number; reputation: number };
    ownerPayments: number;
    expiringWages: number;
    /** Weekly wages relegation clauses cut (contract-clauses.ts). */
    clauseSavings: number;
    /** Weekly loan wage splits of the loans still running next season. */
    loanAdjustment: number;
  },
): FinanceInputs {
  const { move } = next;
  const step = move ? (move.movement === "promoted" ? 1 : -1) : 0;
  const factor = MOVEMENT_BUDGET_FACTOR[move?.movement ?? "none"];
  const running = input.playerWages - next.expiringWages - next.clauseSavings;
  const renewed = Math.min(next.expiringWages, Math.max(0, input.club.wage_budget * factor * RENEWAL_BUDGET_SHARE - running));
  return {
    ...input,
    playerWages: running + renewed,
    loanAdjustment: next.loanAdjustment,
    club: {
      ...input.club,
      reputation: clamp(input.club.reputation + 4 * step, 1, 99),
      fan_mood: clamp(input.club.fan_mood + 15 * step, 1, 99),
      balance: input.club.balance - next.ownerPayments,
      operating_wage_budget: (input.club.operating_wage_budget ?? input.club.wage_budget) * factor,
    },
    ...(move ? { tier: move.tier, leagueReputation: move.reputation } : {}),
    periods: input.periods.filter((period) => period.season > season - 2),
  };
}

export async function assessFinances(store: Store, clubId: number, proposed: ProposedSpend = {}): Promise<FinancialAssessment> {
  const assessment = (await assessFinancesBatch(store, { clubIds: [clubId], proposed })).get(clubId);
  if (!assessment) throw new Error(`Club ${clubId} has no financial assessment.`);
  return assessment;
}

/**
 * The fee a regulator recognises for a deal between related parties (clubs of the same owner group): the agreed fee
 * when it is within 15% of the player's market value, otherwise the market value. The difference is excluded from
 * football earnings.
 */
export function fairValueForFfp(fee: number, value: number) {
  return Math.abs(fee - value) <= value * 0.15 ? fee : Math.round(value);
}

/** Annual squad cost a signing adds under the rules: wages, amortisation of the fee over the contract (max 5 years), agent fee. */
export const annualSigningCost = (input: { wage: number; fee: number; years: number; agentFee?: number }) =>
  input.wage * 52 + input.fee / Math.min(5, Math.max(1, input.years)) + (input.agentFee ?? 0);

/** FFP headroom a signing uses: its annual squad cost plus the fee's cash where a solvency gate binds (FinancialAssessment.feeCashShare). */
export const signingHeadroomCost = (input: { wage: number; fee: number; years: number; agentFee?: number }, feeCashShare: number) =>
  annualSigningCost(input) + feeCashShare * input.fee;

export async function postWeeklyAccounts(
  store: Store,
  clubId: number,
  revenue: number,
  wages: number,
  operating: number,
  academy: number,
) {
  await postWeeklyAccountsBatch(store, [{ clubId, revenue, wages, operating, academy }]);
}

export interface WeeklyAccount {
  clubId: number;
  revenue: number;
  wages: number;
  operating: number;
  academy: number;
}

/**
 * Adds a week to many clubs' financial periods in one statement (amortization from one asset query) and returns
 * each club's season FFP deficit after posting: max(0, costs counted by the rules − revenue − sale profit).
 */
export async function postWeeklyAccountsBatch(store: Store, accounts: readonly WeeklyAccount[]) {
  const deficits = new Map<number, number>();
  if (!accounts.length) return deficits;
  const state = await store.meta<GameState>("state");
  const clubIds = accounts.map((account) => account.clubId);
  const amortization = await annualAmortizations(store, clubIds, state.date);
  for (const row of await store.all<{ club_id: number; deficit: number }>(
    `INSERT INTO financial_periods (club_id, season, revenue, wages, operating, amortization, excluded_investment)
     SELECT week.club_id, ?::integer, week.revenue, week.wages, week.operating, week.amortization, week.academy
     FROM unnest(?::integer[], ?::double precision[], ?::double precision[], ?::double precision[], ?::double precision[], ?::double precision[])
       AS week(club_id, revenue, wages, operating, amortization, academy)
     ON CONFLICT (club_id, season) DO UPDATE SET revenue = financial_periods.revenue + EXCLUDED.revenue,
       wages = financial_periods.wages + EXCLUDED.wages, operating = financial_periods.operating + EXCLUDED.operating,
       amortization = financial_periods.amortization + EXCLUDED.amortization,
       excluded_investment = financial_periods.excluded_investment + EXCLUDED.excluded_investment
     RETURNING club_id, GREATEST(0, wages + operating + amortization + agent_fees - revenue - sale_profit) AS deficit`,
    state.season,
    clubIds,
    accounts.map((account) => account.revenue),
    accounts.map((account) => account.wages),
    accounts.map((account) => account.operating),
    clubIds.map((clubId) => (amortization.get(clubId) ?? 0) / 52),
    accounts.map((account) => account.academy),
  ))
    deficits.set(row.club_id, row.deficit);
  return deficits;
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
