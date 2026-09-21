import { Store } from "./db.ts";
import { addDays, clamp, daysBetween, round } from "../shared/rules.ts";
import type { Club, GameState, League } from "../shared/types.ts";

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
    `MERGE financial_periods WITH (HOLDLOCK) AS target USING (VALUES (?,?,?)) AS source(club_id,season,amount) ON target.club_id = source.club_id AND target.season = source.season WHEN MATCHED THEN UPDATE SET ${field} = target.${field} + source.amount WHEN NOT MATCHED THEN INSERT (club_id,season,${field}) VALUES (source.club_id,source.season,source.amount);`,
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
  const annualCommercial = Math.round(club.reputation ** 3 * 0.9) * 52;
  const size = (await store.get<{ total: number }>(
    "SELECT count(*) AS total FROM standings WHERE league_id = ?",
    club.league_id,
  ))!.total;
  const homeMatches = Math.max(7, size - 1) + 2;
  const gates =
    homeMatches *
    club.capacity *
    (0.25 + club.fan_mood / 250) *
    Math.max(5, club.reputation / 3);
  return Math.round(annualCommercial + gates);
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
    "SELECT TOP (1) standings.club_id FROM standings JOIN leagues ON leagues.id = standings.league_id WHERE standings.club_id = ? AND leagues.kind = 'continental' AND leagues.confederation = 'UEFA'",
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
    "SELECT coalesce(sum(CASE WHEN loans.destination_id = ? THEN players.wage * TRY_CONVERT(float, JSON_VALUE(loans.terms,'$.salarySplit'))/100.0 ELSE -players.wage * TRY_CONVERT(float, JSON_VALUE(loans.terms,'$.salarySplit'))/100.0 END),0) AS total FROM loans JOIN players ON players.id = loans.player_id WHERE loans.status = 'active' AND (loans.parent_id = ? OR loans.destination_id = ?)",
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
    "MERGE financial_periods WITH (HOLDLOCK) AS target USING (VALUES (?,?,?,?,?,?,?)) AS source(club_id,season,revenue,wages,operating,amortization,excluded_investment) ON target.club_id = source.club_id AND target.season = source.season WHEN MATCHED THEN UPDATE SET revenue = target.revenue + source.revenue, wages = target.wages + source.wages, operating = target.operating + source.operating, amortization = target.amortization + source.amortization, excluded_investment = target.excluded_investment + source.excluded_investment WHEN NOT MATCHED THEN INSERT (club_id,season,revenue,wages,operating,amortization,excluded_investment) VALUES (source.club_id,source.season,source.revenue,source.wages,source.operating,source.amortization,source.excluded_investment);",
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
