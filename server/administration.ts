import type { Store } from "./db.ts";
import type seedrandom from "seedrandom";
import { applySanction } from "./sanctions.ts";
import { injectEquity, startSale } from "./ownership.ts";
import { patchClubData, type LifeClub } from "./club-life-context.ts";
import { worldNewsBatch, type WorldNewsInput } from "./world-news.ts";
import { GameError, news, stateOf } from "./systems.ts";
import { addDays, daysBetween, money } from "../shared/rules.ts";
import { MIN_GOALKEEPERS } from "../shared/world-rules.ts";
import type { GameState } from "../shared/types.ts";
import type { ClubAdministration } from "../shared/api.ts";

export const ADMINISTRATION_RULES = {
  /** Cash position (balance less instalments due within this many days) below -tolerance counts as insolvent. */
  obligationsDays: 91,
  /** Tolerated deficit: 40% of a season's revenue, at least this much. */
  toleranceShare: 0.4,
  minimumTolerance: 250_000,
  /** Consecutive weekly checks below the tolerance before the club enters administration. */
  weeks: 10,
  /** Earliest exit (cash position back to zero) and the latest, through a creditors' agreement. */
  exitWeeks: 12,
  agreementWeeks: 26,
  /** Forced sales: the highest earners until this share of the senior wage bill, keeping a minimum squad. */
  forcedWageShare: 0.25,
  forcedMaximum: 5,
  squadFloor: 18,
  /** An owner rescues the club (equity covering the deficit and a tenth of a season's revenue) at most once a year,
   * when his wealth is at least this multiple of the cheque, with a chance of his patience (0-100) in percent. */
  rescueWealth: 5,
  rescueDays: 365,
} as const;

/**
 * Points deducted on entering administration: EFL 12, National League 10, SPFL 15, German licensing 9; a Spanish
 * concurso de acreedores carries no sporting sanction (the embargo still applies). Elsewhere 10.
 */
export function administrationPoints(code: string, tier: number) {
  if (code === "EN") return tier <= 4 ? 12 : 10;
  if (code === "SCO") return 15;
  if (code === "DE") return 9;
  if (code === "ES") return 0;
  return 10;
}

/**
 * Weekly insolvency review: a club whose cash position stays beyond its tolerance for ten weeks enters
 * administration (points deduction, or next season's when its league season is over; registration embargo; the
 * highest earners put up for sale; budgets frozen; projects halt; the club is offered for sale). It exits once its cash position is back in credit
 * after twelve weeks, or through a creditors' agreement writing off the remaining debt after 26 weeks.
 */
export async function administrationWeekly(
  store: Store,
  state: GameState,
  random: seedrandom.PRNG,
  clubs: readonly LifeClub[],
) {
  const owed = new Map(
    (
      await store.all<{ club_id: number; total: number }>(
        "SELECT payer_id AS club_id,sum(amount) AS total FROM transfer_payments WHERE paid_date IS NULL AND due_date <= ? GROUP BY payer_id",
        addDays(state.date, ADMINISTRATION_RULES.obligationsDays),
      )
    ).map((row) => [row.club_id, row.total]),
  );
  const patches = new Map<number, Record<string, unknown>>();
  const items: WorldNewsInput[] = [];
  const entering: LifeClub[] = [];
  const exiting: { club: LifeClub; outcome: string; writeOff: number }[] = [];
  for (const club of clubs) {
    const position = club.balance - (owed.get(club.id) ?? 0);
    const administration = club.data.administration;
    if (administration) {
      const weeks = daysBetween(administration.since, state.date) / 7;
      if (weeks >= ADMINISTRATION_RULES.exitWeeks && position >= 0) exiting.push({ club, outcome: "recovered", writeOff: 0 });
      else if (weeks >= ADMINISTRATION_RULES.agreementWeeks)
        exiting.push({ club, outcome: "creditors' agreement", writeOff: Math.max(0, -club.balance) });
      continue;
    }
    const tolerance = Math.max(ADMINISTRATION_RULES.minimumTolerance, club.revenue * ADMINISTRATION_RULES.toleranceShare);
    if (position >= -tolerance) {
      if (club.data.insolvency) patches.set(club.id, { insolvency: null });
      continue;
    }
    const weeks = (club.data.insolvency?.weeks ?? 0) + 1;
    if (weeks >= ADMINISTRATION_RULES.weeks) entering.push(Object.assign(club, { position }));
    else patches.set(club.id, { insolvency: { weeks, since: club.data.insolvency?.since ?? state.date } });
  }
  const rescued = await ownerRescues(store, state, random, entering as (LifeClub & { position: number })[], patches, items);
  entering.splice(0, entering.length, ...entering.filter((club) => !rescued.has(club.id)));
  const seasonOver = new Set(
    entering.length
      ? (
          await store.all<{ id: number }>(
            `SELECT entering.id FROM unnest(?::integer[]) AS entering(id) WHERE NOT EXISTS (
               SELECT 1 FROM fixtures JOIN leagues ON leagues.id = fixtures.league_id
               WHERE fixtures.season = ? AND fixtures.status = 'scheduled' AND leagues.kind = 'league'
                 AND (fixtures.home_id = entering.id OR fixtures.away_id = entering.id))`,
            entering.map((club) => club.id),
            state.season,
          )
        ).map((row) => row.id)
      : [],
  );
  for (const club of entering) {
    const points = administrationPoints(club.code, club.tier);
    const pending = seasonOver.has(club.id) ? points : 0;
    const reason = `Administration: ${club.name} cannot meet its obligations`;
    if (points && !pending)
      await applySanction(store, { clubId: club.id, kind: "points", points, reason, season: state.season, data: { rule: "administration" } });
    const embargoUntil = addDays(state.date, ADMINISTRATION_RULES.agreementWeeks * 7);
    await applySanction(store, {
      clubId: club.id,
      kind: "embargo",
      reason,
      until: embargoUntil,
      season: state.season,
      data: { rule: "administration" },
    });
    const forcedSales = await forceSales(store, club.id);
    // The administrators look for a buyer (members' clubs cannot be sold; the ownership rules decide).
    await startSale(store, club.id, random);
    await store.run(
      "UPDATE clubs SET transfer_budget = 0, board_confidence = GREATEST(0, board_confidence - 10), fan_mood = GREATEST(1, fan_mood - 10) WHERE id = ?",
      club.id,
    );
    const administration: ClubAdministration = {
      since: state.date,
      season: state.season,
      reason: `Cash deficit of ${money(-club.balance)} beyond what the club can sustain.`,
      points: points - pending,
      pendingPoints: pending,
      embargoUntil,
      forcedSales,
    };
    patches.set(club.id, { administration, insolvency: null });
    await store.run(
      "INSERT INTO history(season, entity_type, entity_id, date, data) VALUES (?, 'administration', ?, ?, ?)",
      state.season,
      club.id,
      state.date,
      JSON.stringify({ event: "entered", ...administration }),
    );
    const sanction = points ? (pending ? `a ${points}-point deduction next season` : `a ${points}-point deduction`) : "no points deduction";
    items.push({
      kind: "administration",
      date: state.date,
      clubIds: [club.id],
      title: `${club.name} enter administration`,
      body: `${club.name} have entered administration with ${sanction} and a registration embargo. The administrators have put ${forcedSales.length} players up for sale.`,
      data: { points, pending: !!pending },
    });
    if (club.user)
      await news(
        store,
        "Board",
        "The club has entered administration",
        `Administrators now control the club's finances: ${sanction}, a registration embargo until ${embargoUntil} at the latest, no transfer budget, and ${forcedSales.length} players placed on the transfer list by the administrators (${forcedSales.map((sale) => sale.name).join(", ") || "none"}). They stay listed until the club exits administration.`,
        "warning",
        "board",
        { administration: true },
      );
  }
  for (const { club, outcome, writeOff } of exiting) {
    const administration = club.data.administration!;
    if (writeOff) await store.run("UPDATE clubs SET balance = GREATEST(balance, 0) WHERE id = ?", club.id);
    await store.run(
      "UPDATE sanctions SET end_date = ? WHERE club_id = ? AND kind = 'embargo' AND data::jsonb ->> 'rule' = 'administration' AND (end_date IS NULL OR end_date > ?)",
      state.date,
      club.id,
      state.date,
    );
    if (club.user && administration.forcedSales.length)
      await store.run(
        "UPDATE players SET listed = 0 WHERE id = ANY(?::integer[]) AND club_id = ?",
        administration.forcedSales.map((sale) => sale.playerId),
        club.id,
      );
    patches.set(club.id, {
      administration: null,
      administrations: [
        ...(club.data.administrations ?? []),
        { since: administration.since, until: state.date, points: administration.points + administration.pendingPoints, outcome },
      ].slice(-5),
    });
    await store.run(
      "INSERT INTO history(season, entity_type, entity_id, date, data) VALUES (?, 'administration', ?, ?, ?)",
      state.season,
      club.id,
      state.date,
      JSON.stringify({ event: "exited", outcome, writeOff }),
    );
    const detail =
      outcome === "recovered"
        ? "The club's cash position is back in credit."
        : `A creditors' agreement writes off ${money(writeOff)} of debt.`;
    items.push({
      kind: "administration",
      date: state.date,
      clubIds: [club.id],
      title: `${club.name} exit administration`,
      body: `${detail} The registration embargo is lifted.`,
      data: { outcome },
    });
    if (club.user)
      await news(store, "Board", "The club exits administration", `${detail} The embargo is lifted and the board resumes control of the transfer list.`, "success", "board");
  }
  await patchClubData(store, patches);
  await worldNewsBatch(store, items);
  return { entered: entering.length, exited: exiting.length, rescued: rescued.size };
}

/**
 * Before administration, a patient owner with the means writes a cheque (FFP equity) covering the deficit and a tenth of
 * a season's revenue; members' clubs and owners who rescued the club within the year do not.
 */
async function ownerRescues(
  store: Store,
  state: GameState,
  random: seedrandom.PRNG,
  clubs: readonly (LifeClub & { position: number })[],
  patches: Map<number, Record<string, unknown>>,
  items: WorldNewsInput[],
) {
  const rescued = new Set<number>();
  if (!clubs.length) return rescued;
  const owners = new Map(
    (
      await store.all<{ club_id: number; name: string; type: string; wealth: number; patience: number }>(
        `SELECT club_ownership.club_id, owners.name, owners.type, owners.wealth, owners.patience FROM club_ownership
         JOIN owners ON owners.id = club_ownership.owner_id
         WHERE club_ownership.club_id = ANY(?::integer[]) AND NOT club_ownership.member_owned`,
        clubs.map((club) => club.id),
      )
    ).map((row) => [row.club_id, row]),
  );
  for (const club of clubs) {
    const owner = owners.get(club.id);
    const amount = Math.round((-club.position + club.revenue * 0.1) / 1000) * 1000;
    const last = club.data.ownerRescue as string | undefined;
    if (!owner || owner.type === "members" || (last && daysBetween(last, state.date) < ADMINISTRATION_RULES.rescueDays)) continue;
    if (owner.wealth < amount * ADMINISTRATION_RULES.rescueWealth || random() >= owner.patience / 100) continue;
    await injectEquity(store, club.id, amount, "Owner rescue: deficit covered to avoid administration");
    rescued.add(club.id);
    patches.set(club.id, { insolvency: null, ownerRescue: state.date });
    items.push({
      kind: "ownership",
      date: state.date,
      clubIds: [club.id],
      title: `${owner.name} rescue ${club.name} from administration`,
      body: `The owner pays ${money(amount)} into the club to clear its cash deficit.`,
      data: { amount },
    });
    if (club.user)
      await news(store, "Board", "The owner covers the club's deficit", `${owner.name} has paid ${money(amount)} into the club to avoid administration. The board expects the finances to be put right.`, "warning", "board");
  }
  return rescued;
}

/** Lists the highest earners for sale until a quarter of the senior wage bill, keeping a minimum squad and two keepers. */
async function forceSales(store: Store, clubId: number) {
  const squad = await store.all<{ id: number; name: string; position: string; wage: number }>(
    "SELECT id,name,position,wage FROM players WHERE club_id = ? AND parent_club_id IS NULL AND age_group = 'Senior' AND role <> 'Retired' ORDER BY wage DESC,id",
    clubId,
  );
  const bill = squad.reduce((total, player) => total + player.wage, 0);
  let keepers = squad.filter((player) => player.position === "GK").length;
  let remaining = squad.length;
  let released = 0;
  const sales: ClubAdministration["forcedSales"] = [];
  for (const player of squad) {
    if (sales.length >= ADMINISTRATION_RULES.forcedMaximum || released >= bill * ADMINISTRATION_RULES.forcedWageShare) break;
    if (remaining <= ADMINISTRATION_RULES.squadFloor) break;
    if (player.position === "GK" && keepers <= MIN_GOALKEEPERS) continue;
    sales.push({ playerId: player.id, name: player.name });
    released += player.wage;
    remaining--;
    if (player.position === "GK") keepers--;
  }
  if (sales.length)
    await store.run("UPDATE players SET listed = 1 WHERE id = ANY(?::integer[])", sales.map((sale) => sale.playerId));
  return sales;
}

/** Season rollover: deductions deferred because the club's league season was over apply to the new season. */
export async function applyPendingDeductions(store: Store, season: number) {
  const pending = await store.all<{ id: number; name: string; data: string }>(
    "SELECT id,name,data FROM clubs WHERE type = 'club' AND (data::jsonb #>> '{administration,pendingPoints}')::integer > 0 ORDER BY id",
  );
  const patches = new Map<number, Record<string, unknown>>();
  for (const club of pending) {
    const administration = (JSON.parse(club.data) as { administration: ClubAdministration }).administration;
    await applySanction(store, {
      clubId: club.id,
      kind: "points",
      points: administration.pendingPoints,
      reason: `Administration: ${club.name} cannot meet its obligations`,
      season,
      data: { rule: "administration" },
    });
    patches.set(club.id, { administration: { ...administration, points: administration.points + administration.pendingPoints, pendingPoints: 0 } });
  }
  await patchClubData(store, patches);
  return pending.length;
}

/** The director cannot take a player the administrators listed off the transfer list while the club is in administration. */
export async function guardForcedSale(store: Store, playerId: number, listed: boolean) {
  if (listed) return;
  const state = await stateOf(store);
  const club = await store.get<{ data: string }>("SELECT data FROM clubs WHERE id = ?", state.clubId);
  const administration = club && (JSON.parse(club.data) as { administration?: ClubAdministration }).administration;
  if (administration?.forcedSales.some((sale) => sale.playerId === playerId))
    throw new GameError("The administrators have listed this player for sale. He stays on the transfer list until the club exits administration.");
}
