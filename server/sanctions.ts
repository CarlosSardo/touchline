import type { Store } from "./db.ts";
import { assessFinancesBatch, type FinancialAssessment } from "./finance.ts";
import { ledger, news, settingsOf, stateOf } from "./systems.ts";
import { worldNewsBatch, type WorldNewsInput } from "./world-news.ts";
import { addDays, money, round, winterWindowClose } from "../shared/rules.ts";
import type { GameState } from "../shared/types.ts";

export type SanctionKind = "points" | "embargo" | "fine" | "settlement";

export interface SanctionInput {
  clubId: number;
  kind: SanctionKind;
  reason: string;
  points?: number;
  amount?: number;
  /** Last day of an embargo (inclusive); open-ended until lifted when absent. */
  until?: string;
  season?: number;
  /** Rule and terms kept with the sanction (e.g. { rule: "cash" } or settlement targets). */
  data?: Record<string, unknown>;
}

export interface Sanction {
  id: number;
  club_id: number;
  season: number;
  kind: SanctionKind;
  points: number;
  amount: number;
  start_date: string;
  end_date: string | null;
  reason: string;
  data: string;
}

/** Cash below this many weeks of the wage budget triggers a registration embargo (EFL-style unpaid-liabilities embargo). */
export const CASH_EMBARGO_WEEKS = 4;

const TITLES: Record<SanctionKind, (points: number, amount: number) => string> = {
  points: (points) => `${points}-point deduction`,
  embargo: () => "Registration embargo",
  fine: (_, amount) => `Fined ${money(amount)}`,
  settlement: (_, amount) => `Settlement agreement (${money(amount)})`,
};

async function announce(store: Store, state: GameState, rows: { sanction: SanctionInput; id: number }[]) {
  if (!rows.length) return;
  const clubs = new Map(
    (
      await store.all<{ id: number; name: string; parent_id: number | null }>(
        "SELECT id,name,parent_id FROM clubs WHERE id = ANY(?::integer[])",
        [...new Set(rows.map((row) => row.sanction.clubId))],
      )
    ).map((club) => [club.id, club]),
  );
  const world: WorldNewsInput[] = [];
  for (const { sanction, id } of rows) {
    const club = clubs.get(sanction.clubId);
    if (!club) continue;
    const title = `${club.name}: ${TITLES[sanction.kind](sanction.points ?? 0, sanction.amount ?? 0).toLowerCase()}`;
    const until = sanction.until ? ` It applies until ${sanction.until}.` : sanction.kind === "embargo" ? " It stays until the conditions are met." : "";
    const body = `${sanction.reason}${until}`;
    if (club.id === state.clubId || club.parent_id === state.clubId)
      await news(store, "Finance", `${TITLES[sanction.kind](sanction.points ?? 0, sanction.amount ?? 0)} imposed`, body, "important", "finances", {
        sanctionId: id,
        kind: sanction.kind,
      });
    world.push({ kind: "sanction", title, body, clubIds: [club.id], date: state.date, data: { sanctionId: id, sanction: sanction.kind } });
  }
  await worldNewsBatch(store, world);
}

async function insertSanction(store: Store, state: GameState, input: SanctionInput) {
  const id = Number(
    (
      await store.run(
        "INSERT INTO sanctions(club_id,season,kind,points,amount,start_date,end_date,reason,data) VALUES (?,?,?,?,?,?,?,?,?)",
        input.clubId,
        input.season ?? state.season,
        input.kind,
        Math.max(0, Math.round(input.points ?? 0)),
        Math.max(0, Math.round(input.amount ?? 0)),
        state.date,
        input.until ?? null,
        input.reason,
        JSON.stringify(input.data ?? {}),
      )
    ).lastInsertRowid,
  );
  if (input.kind === "points" && input.points)
    // Points are stored net in standings (points = wins × 3 + draws − deducted) in the club's league table.
    await store.run(
      "UPDATE standings SET deducted = deducted + ?, points = points - ? FROM clubs WHERE clubs.id = standings.club_id AND standings.league_id = clubs.league_id AND clubs.id = ?",
      Math.round(input.points),
      Math.round(input.points),
      input.clubId,
    );
  if ((input.kind === "fine" || input.kind === "settlement") && input.amount && !input.data?.conditional)
    await ledger(store, input.clubId, -Math.round(input.amount), "Regulatory fines", input.reason);
  return id;
}

/**
 * Records a sanction and applies it: a points deduction in the club's current league table, a fine or the paid part of
 * a settlement charged to the club, or an embargo on registering new signings (activeEmbargo). Announced in the world
 * feed and, for the director's club, in the inbox. Returns the sanction id.
 */
export async function applySanction(store: Store, input: SanctionInput): Promise<number> {
  const state = await stateOf(store);
  const id = await insertSanction(store, state, input);
  await announce(store, state, [{ sanction: input, id }]);
  return id;
}

/** Whether `clubId` may not register new signings on `date` (regulatory or administration embargo). */
export async function activeEmbargo(store: Store, clubId: number, date: string): Promise<boolean> {
  return !!(await store.get(
    "SELECT 1 FROM sanctions WHERE club_id = ? AND kind = 'embargo' AND start_date <= ? AND (end_date IS NULL OR end_date >= ?) LIMIT 1",
    clubId,
    date,
    date,
  ));
}

/** Every club under an embargo on `date` (one query, for the daily club policy snapshot). */
export async function activeEmbargoes(store: Store, date: string) {
  return new Set(
    (
      await store.all<{ club_id: number }>(
        "SELECT DISTINCT club_id FROM sanctions WHERE kind = 'embargo' AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)",
        date,
        date,
      )
    ).map((row) => row.club_id),
  );
}

/** Last day of the registration period after next (a season of windows): the summer and the winter window. */
const seasonOfWindows = (date: string) => winterWindowClose(Number(date.slice(0, 4)) + (date.slice(5) >= "02-03" ? 1 : 0));

export interface SeasonReviewDecision {
  clubId: number;
  sanctions: SanctionInput[];
}

/**
 * Year-end regulatory review of `season` (run by the rollover right after the accounts close, before promotion and
 * relegation change leagues). UEFA-registered clubs: squad-cost ratio over 70% is settled with a fine (up to 10
 * points over) or a fine and a season's registration embargo; football earnings below the acceptable deviation
 * mean a settlement agreement, an embargo when the loss is more than twice the deviation. Premier League clubs over
 * the 85% squad-cost ratio pay a levy up to 15 points over, then lose points (6, or 10 from 30 points over). Clubs
 * sanctioned for the same rule last season are punished one step harder, and an open settlement whose target was
 * missed is charged and becomes an embargo. Nothing is decided when FFP enforcement is off.
 */
export async function reviewSeasonFinances(store: Store, season: number): Promise<SeasonReviewDecision[]> {
  if ((await settingsOf(store)).ffp === false) return [];
  const state = await stateOf(store);
  const first = new Set(
    (await store.all<{ id: number }>("SELECT id FROM clubs WHERE type = 'club'")).map((club) => club.id),
  );
  const assessments = await assessFinancesBatch(store, { clubIds: [...first], season });
  const previous = new Map<number, Sanction[]>();
  for (const row of await store.all<Sanction>(
    "SELECT * FROM sanctions WHERE season = ? AND coalesce(data::jsonb ->> 'rule', '') <> 'cash' ORDER BY id",
    season,
  ))
    previous.set(row.club_id, [...(previous.get(row.club_id) ?? []), row]);
  const until = seasonOfWindows(state.date);
  const decisions: SeasonReviewDecision[] = [];
  for (const [clubId, assessment] of assessments) {
    const sanctions = decide(assessment, previous.get(clubId) ?? [], season, until);
    if (sanctions.length) decisions.push({ clubId, sanctions });
  }
  return decisions;
}

function rulesBroken(assessment: FinancialAssessment) {
  const excess = assessment.squadCostLimit === null ? 0 : assessment.squadCostRatio - assessment.squadCostLimit;
  const lossExcess = assessment.allowableLoss === null ? 0 : -(assessment.rollingEarnings + assessment.allowableLoss);
  return { excess, lossExcess };
}

function decide(assessment: FinancialAssessment, previous: Sanction[], season: number, until: string): SanctionInput[] {
  const { excess, lossExcess } = rulesBroken(assessment);
  const repeat = (rule: string) => previous.some((row) => (JSON.parse(row.data) as { rule?: string }).rule === rule);
  const sanctions: SanctionInput[] = [];
  const revenue = assessment.footballRevenue;
  const ratio = `${round(assessment.squadCostRatio * 100)}% of football revenue against a ${(assessment.squadCostLimit ?? 0) * 100}% limit`;
  const base = { clubId: 0 };
  // A settlement agreed last year whose target was missed is charged in full and becomes a registration embargo.
  for (const settlement of previous.filter((row) => row.kind === "settlement")) {
    const terms = JSON.parse(settlement.data) as { rule?: string; conditional?: number };
    if (!terms.conditional || (terms.rule === "squad-cost" ? excess <= 0 : lossExcess <= 0)) continue;
    sanctions.push(
      { ...base, kind: "fine", amount: terms.conditional, reason: `Settlement targets for ${season}/${String(season + 1).slice(-2)} were missed: the conditional amount is now due.`, data: { rule: terms.rule } },
      { ...base, kind: "embargo", until, reason: "Settlement agreement breached: no new registrations for a season.", data: { rule: terms.rule } },
    );
  }
  if (excess > 0 && assessment.policy === "UEFA financial sustainability") {
    const severe = excess > 0.1 || repeat("squad-cost");
    const fine = Math.round(excess * revenue * (severe ? 0.5 : 0.25));
    sanctions.push({
      ...base,
      kind: "settlement",
      amount: fine,
      reason: `UEFA squad-cost rule breached: ${ratio}. Settlement: ${money(fine)} paid now, a further ${money(fine)} conditional on compliance next season.`,
      data: { rule: "squad-cost", conditional: fine, targetRatio: assessment.squadCostLimit },
    });
    if (severe)
      sanctions.push({ ...base, kind: "embargo", until, reason: `UEFA squad-cost breach of ${round(excess * 100)} points: registration of new players restricted for a season.`, data: { rule: "squad-cost" } });
  }
  if (excess > 0 && assessment.policy.startsWith("Premier League")) {
    const levy = Math.round(excess * revenue * 0.3);
    sanctions.push({ ...base, kind: "fine", amount: levy, reason: `Premier League squad-cost ratio breached: ${ratio}. A levy of ${money(levy)} is charged.`, data: { rule: "squad-cost" } });
    if (excess > 0.15 || repeat("squad-cost")) {
      const points = (excess > 0.3 ? 10 : 6) + (repeat("squad-cost") ? 4 : 0);
      sanctions.push({ ...base, kind: "points", points, reason: `Significant squad-cost breach (${ratio}): ${points} points deducted.`, data: { rule: "squad-cost" } });
    }
  }
  if (lossExcess > 0) {
    const fine = Math.round(lossExcess * 0.1);
    sanctions.push({
      ...base,
      kind: "settlement",
      amount: fine,
      reason: `UEFA football earnings rule breached: losses exceed the acceptable deviation by ${money(lossExcess)}. Settlement: ${money(fine)} paid now and the same again if the target is missed.`,
      data: { rule: "earnings", conditional: fine },
    });
    if (lossExcess > 2 * (assessment.allowableLoss ?? 0) || repeat("earnings"))
      sanctions.push({ ...base, kind: "embargo", until, reason: "Persistent football losses: registration of new players restricted for a season.", data: { rule: "earnings" } });
  }
  return sanctions;
}

/** Applies the year-end decisions after the new season's tables exist (points count in the new season). */
export async function applySeasonSanctions(store: Store, decisions: readonly SeasonReviewDecision[]) {
  const state = await stateOf(store);
  const applied: { sanction: SanctionInput; id: number }[] = [];
  for (const decision of decisions)
    for (const sanction of decision.sanctions) {
      const input = { ...sanction, clubId: decision.clubId, season: state.season };
      applied.push({ sanction: input, id: await insertSanction(store, state, input) });
    }
  await announce(store, state, applied);
  return applied.length;
}

/**
 * Weekly solvency check (EFL-style): a club whose cash has fallen more than CASH_EMBARGO_WEEKS of its wage budget
 * below zero may not register new signings until the balance is positive again; the embargo is lifted then.
 */
export async function reviewSolvency(store: Store) {
  if ((await settingsOf(store)).ffp === false) return { imposed: 0, lifted: 0 };
  const state = await stateOf(store);
  const lifted = await store.all<{ id: number; club_id: number; name: string; parent_id: number | null }>(
    `UPDATE sanctions SET end_date = ? FROM clubs WHERE clubs.id = sanctions.club_id AND sanctions.kind = 'embargo'
       AND sanctions.end_date IS NULL AND sanctions.data::jsonb ->> 'rule' = 'cash' AND clubs.balance >= 0
     RETURNING sanctions.id, sanctions.club_id, clubs.name, clubs.parent_id`,
    addDays(state.date, -1),
  );
  for (const row of lifted)
    if (row.club_id === state.clubId || row.parent_id === state.clubId)
      await news(store, "Finance", "Registration embargo lifted", "The cash balance is positive again: new signings can be registered.", "success", "finances");
  if (lifted.length)
    await worldNewsBatch(
      store,
      lifted.map((row) => ({ kind: "sanction", title: `${row.name}: embargo lifted`, body: "The club's cash balance has recovered; it may register new signings again.", clubIds: [row.club_id], date: state.date })),
    );
  const insolvent = await store.all<{ id: number; balance: number }>(
    `SELECT clubs.id, clubs.balance FROM clubs WHERE clubs.type = 'club' AND clubs.balance < -(?::double precision) * clubs.wage_budget
       AND NOT EXISTS (SELECT 1 FROM sanctions WHERE sanctions.club_id = clubs.id AND sanctions.kind = 'embargo' AND (sanctions.end_date IS NULL OR sanctions.end_date >= ?))
     ORDER BY clubs.id`,
    CASH_EMBARGO_WEEKS,
    state.date,
  );
  const applied: { sanction: SanctionInput; id: number }[] = [];
  for (const club of insolvent) {
    const sanction: SanctionInput = {
      clubId: club.id,
      kind: "embargo",
      reason: `Cash balance of ${money(club.balance)}: unpaid liabilities mean no new registrations until the balance is positive.`,
      data: { rule: "cash" },
    };
    applied.push({ sanction, id: await insertSanction(store, state, sanction) });
  }
  await announce(store, state, applied);
  return { imposed: applied.length, lifted: lifted.length };
}

/** Sanctions of a club, newest first (club office). */
export async function clubSanctions(store: Store, clubId: number) {
  return store.all<Sanction>("SELECT * FROM sanctions WHERE club_id = ? ORDER BY start_date DESC, id DESC LIMIT 50", clubId);
}
