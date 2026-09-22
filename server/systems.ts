import seedrandom from "seedrandom";
import { z } from "zod";
import { Store } from "./db.ts";
import {
  acquirePlayerAsset,
  assessFinances,
  recordFinancialItem,
  sellPlayerAsset,
} from "./finance.ts";
import { assessRegistration } from "./registration.ts";
import { assessPlayerInterest, assessYouthTransfer } from "./recruitment.ts";
import {
  publishPlayerCoverage,
  publishPressReaction,
  publishTransferStory,
} from "./media.ts";
import {
  addDays,
  addMonths,
  adultTransferArrival,
  ageOn,
  affiliationWillingness,
  ASSISTANT_ROLE,
  clamp,
  daysBetween,
  DEFAULT_TRANSFER_TERMS,
  label,
  loanScore,
  LOAN_TYPES,
  money,
  PARTNERSHIP_TYPES,
  round,
  tacticalFit,
  transferPaymentPlan,
  transferWindow,
} from "../shared/rules.ts";
import type {
  Club,
  BuyBackClause,
  GameState,
  Loan,
  LoanTerms,
  Negotiation,
  NegotiationData,
  Player,
  PlayerProfile,
  Settings,
  Staff,
  TransferPayment,
  TransferTerms,
} from "../shared/types.ts";

export class GameError extends Error {
  status = 400;
}

export const transferTermsSchema = z
  .object({
    upfrontPercent: z.number().min(0).max(100),
    installments: z.number().int().min(0).max(8),
    intervalMonths: z.union([
      z.literal(1),
      z.literal(3),
      z.literal(6),
      z.literal(12),
    ]),
    buyBackFee: z.number().finite().min(0).max(1_000_000_000),
    buyBackYears: z.number().int().min(1).max(5),
    sellOnPercent: z.number().min(0).max(50),
  })
  .refine(
    (terms) =>
      terms.installments
        ? terms.upfrontPercent < 100
        : terms.upfrontPercent === 100,
    "Choose instalments for a deferred balance, or pay 100% upfront.",
  )
  .refine(
    (terms) => terms.installments * terms.intervalMonths <= 60,
    "Instalments must finish within five years.",
  );

function checkedTransferTerms(terms: TransferTerms | undefined) {
  const parsed = transferTermsSchema.safeParse(terms ?? DEFAULT_TRANSFER_TERMS);
  if (!parsed.success) throw new GameError(parsed.error.issues[0].message);
  return parsed.data;
}

export const stateOf = async (store: Store) =>
  await store.meta<GameState>("state");
export const settingsOf = async (store: Store) =>
  await store.meta<Settings>("settings");
export async function clubOf(store: Store, id?: number) {
  const club = await store.get<Club>(
    "SELECT * FROM clubs WHERE id = ?",
    id ?? (await stateOf(store)).clubId,
  );
  if (!club) throw new GameError("Club not found.");
  return club;
}
export async function playerOf(store: Store, id: number) {
  const player = await store.get<Player>(
    "SELECT * FROM players WHERE id = ?",
    id,
  );
  if (!player) throw new GameError("Player not found.");
  return player;
}
export async function clubSquads(store: Store) {
  const clubId = (await stateOf(store)).clubId;
  return await store.all<Club>(
    "SELECT * FROM clubs WHERE id = ? OR (parent_id = ? AND type = 'bteam') ORDER BY parent_id,id",
    clubId,
    clubId,
  );
}

export async function canManagePlayer(store: Store, player: Player) {
  return (await clubSquads(store)).some(
    (club) => player.club_id === club.id || player.parent_club_id === club.id,
  );
}

export async function requireOwnPlayer(store: Store, id: number) {
  const player = await playerOf(store, id);
  if (!(await canManagePlayer(store, player)))
    throw new GameError("This player is not contracted to your club.");
  return player;
}

export async function squadDestinations(store: Store, player: Player) {
  if (!(await canManagePlayer(store, player))) return [];
  const state = await stateOf(store);
  const loan = await store.get<Loan>(
    "SELECT * FROM loans WHERE player_id = ? AND status = 'active'",
    player.id,
  );
  return (await clubSquads(store)).flatMap((club) =>
    (["Senior", "U19", "U17"] as const).map((ageGroup) => {
      const cutoff =
        ageGroup === "Senior"
          ? null
          : `${state.season - (ageGroup === "U17" ? 16 : 18)}-01-01`;
      const reason =
        player.role === "Retired"
          ? "Retired players cannot change squad."
          : loan && loan.destination_id !== state.clubId
            ? "Return this player from their active loan first."
            : loan && club.id !== loan.destination_id
              ? "The loan agreement only permits the borrowing club's own squads."
              : cutoff && player.birth_date < cutoff
                ? `${ageGroup} requires a birth date on or after ${cutoff} for this season.`
                : null;
      return {
        clubId: club.id,
        ageGroup,
        label: `${club.name} / ${ageGroup === "Senior" ? (club.type === "bteam" ? "Reserve team" : "First team") : ageGroup}`,
        eligible: reason === null,
        reason,
        current:
          (player.squad_club_id ?? player.club_id) === club.id &&
          player.age_group === ageGroup,
      };
    }),
  );
}

export async function movePlayerSquad(
  store: Store,
  playerId: number,
  clubId: number,
  ageGroup: "Senior" | "U19" | "U17",
) {
  const player = await requireOwnPlayer(store, playerId);
  const destination = (await squadDestinations(store, player)).find(
    (entry) => entry.clubId === clubId && entry.ageGroup === ageGroup,
  );
  if (!destination)
    throw new GameError(
      "Choose a squad belonging to your club, not an affiliate or another club.",
    );
  if (!destination.eligible) throw new GameError(destination.reason!);
  if (destination.current)
    return { message: "This player is already assigned to that squad." };
  await store.run(
    "UPDATE players SET squad_club_id = ?,age_group = ? WHERE id = ?",
    clubId === player.club_id ? null : clubId,
    ageGroup,
    player.id,
  );
  const state = await stateOf(store);
  await store.run(
    "INSERT INTO history(season,entity_type,entity_id,date,data) VALUES (?,'squad',?,?,?)",
    state.season,
    player.id,
    state.date,
    JSON.stringify({
      fromClubId: player.squad_club_id ?? player.club_id,
      fromAgeGroup: player.age_group,
      toClubId: clubId,
      ageGroup,
      label: destination.label,
    }),
  );
  await news(
    store,
    "Squad",
    `${player.name}: squad assignment`,
    destination.label,
    "info",
    "squad",
    { playerId: player.id, clubId, ageGroup },
  );
  return {
    message: `Player moved to ${destination.label}. Contract and wage unchanged.`,
  };
}
export async function news(
  store: Store,
  category: string,
  title: string,
  body: string,
  severity = "info",
  action: string | null = null,
  data: unknown = {},
) {
  return Number(
    (
      await store.run(
        "INSERT INTO news(date, category, title, body, severity, action, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (await stateOf(store)).date,
        category,
        title,
        body,
        severity,
        action,
        JSON.stringify(data),
      )
    ).lastInsertRowid,
  );
}
export async function ledger(
  store: Store,
  clubId: number,
  amount: number,
  category: string,
  description: string,
) {
  await store.run(
    "UPDATE clubs SET balance = balance + ?, income = income + ?, spending = spending + ? WHERE id = ?",
    amount,
    Math.max(0, amount),
    Math.max(0, -amount),
    clubId,
  );
  await store.run(
    "INSERT INTO ledger(club_id, date, category, amount, description) VALUES (?, ?, ?, ?, ?)",
    clubId,
    (await stateOf(store)).date,
    category,
    amount,
    description,
  );
  if (category === "Agent fees")
    await recordFinancialItem(store, clubId, "agent_fees", -amount);
  else if (
    ["Infrastructure", "Staff development", "Player wellbeing"].includes(
      category,
    )
  )
    await recordFinancialItem(store, clubId, "excluded_investment", -amount);
  else if (category === "Sell-on income")
    await recordFinancialItem(store, clubId, "sale_profit", amount);
  else if (
    ![
      "Transfer fees",
      "Player sales",
      "Loan fees",
      "Transfer instalment",
      "Transfer receipt",
      "Sell-on receipt",
      "Training compensation",
    ].includes(category)
  )
    await recordFinancialItem(
      store,
      clubId,
      amount >= 0 ? "revenue" : "operating",
      Math.abs(amount),
    );
}
export async function weeklyWages(store: Store, clubId: number) {
  const salaries = (await store.get<{ total: number }>(
    "SELECT coalesce(sum(wage),0) AS total FROM players WHERE club_id = ?",
    clubId,
  ))!.total;
  const adjustments = (await store.get<{ total: number }>(
    `SELECT coalesce(sum(CASE WHEN loans.parent_id = ? THEN players.wage * (1 - TRY_CONVERT(float, JSON_VALUE(loans.terms,'$.salarySplit')) / 100.0) ELSE -players.wage * (1 - TRY_CONVERT(float, JSON_VALUE(loans.terms,'$.salarySplit')) / 100.0) END),0) AS total FROM loans JOIN players ON players.id = loans.player_id WHERE loans.status = 'active' AND (loans.parent_id = ? OR loans.destination_id = ?)`,
    clubId,
    clubId,
    clubId,
  ))!.total;
  return salaries + adjustments;
}

export async function transferProceeds(
  store: Store,
  playerId: number,
  sellerId: number,
  fee: number,
  description: string,
  schedule?: { negotiationId: number; buyerId: number; terms: TransferTerms },
) {
  await store.run(
    "UPDATE buy_back_clauses SET status = 'void' WHERE player_id = ? AND owner_id = ? AND status = 'active'",
    playerId,
    sellerId,
  );
  if (schedule)
    return await scheduleTransferReceipts(
      store,
      playerId,
      sellerId,
      fee,
      schedule,
    );
  let proceeds = fee;
  for (const clause of await store.all<{
    id: number;
    beneficiary_id: number;
    percentage: number;
  }>(
    "SELECT * FROM sell_on_clauses WHERE player_id = ? AND owner_id = ? AND status = 'active' ORDER BY id",
    playerId,
    sellerId,
  )) {
    const payment = Math.min(
      proceeds,
      Math.round((fee * clause.percentage) / 100),
    );
    proceeds -= payment;
    await ledger(
      store,
      clause.beneficiary_id,
      payment,
      "Sell-on income",
      description,
    );
    await store.run(
      "UPDATE clubs SET transfer_budget = transfer_budget + ? WHERE id = ?",
      payment * 0.85,
      clause.beneficiary_id,
    );
    await store.run(
      "UPDATE sell_on_clauses SET status = 'paid', paid = ? WHERE id = ?",
      payment,
      clause.id,
    );
    if (clause.beneficiary_id === (await stateOf(store)).clubId)
      await news(
        store,
        "Loans",
        "Development sell-on payment received",
        `${(await playerOf(store, playerId)).name}'s transfer has triggered a ${money(payment)} payment from an earlier loan agreement.`,
        "success",
        "finances",
      );
  }
  await ledger(store, sellerId, proceeds, "Player sales", description);
  await sellPlayerAsset(
    store,
    sellerId,
    playerId,
    proceeds,
    (await stateOf(store)).date,
  );
  await store.run(
    "UPDATE clubs SET transfer_budget = transfer_budget + ? WHERE id = ?",
    proceeds * 0.85,
    sellerId,
  );
  return proceeds;
}

async function scheduleTransferReceipts(
  store: Store,
  playerId: number,
  sellerId: number,
  fee: number,
  schedule: { negotiationId: number; buyerId: number; terms: TransferTerms },
) {
  if (
    await store.get(
      "SELECT id FROM transfer_payments WHERE negotiation_id = ?",
      schedule.negotiationId,
    )
  )
    throw new GameError("This payment schedule is already registered.");
  let proceeds = fee;
  const clauses = await store.all<{
    id: number;
    beneficiary_id: number;
    percentage: number;
  }>(
    "SELECT * FROM sell_on_clauses WHERE player_id = ? AND owner_id = ? AND status = 'active' ORDER BY id",
    playerId,
    sellerId,
  );
  const claims: ((typeof clauses)[number] & {
    amount: number;
    remaining: number;
  })[] = [];
  for (const clause of clauses) {
    const amount = Math.min(
      proceeds,
      round((fee * clause.percentage) / 100, 2),
    );
    proceeds = round(proceeds - amount, 2);
    await store.run(
      "UPDATE sell_on_clauses SET status = 'triggered', paid = 0 WHERE id = ?",
      clause.id,
    );
    await recordFinancialItem(
      store,
      clause.beneficiary_id,
      "sale_profit",
      amount,
    );
    claims.push({ ...clause, amount, remaining: amount });
  }
  const plan = transferPaymentPlan(
    fee,
    schedule.terms,
    (await stateOf(store)).date,
  );
  async function invoice(
    payeeId: number,
    amount: number,
    due: string,
    clauseId: number | null = null,
  ) {
    if (amount <= 0) return;
    await store.run(
      "INSERT INTO transfer_payments(negotiation_id,player_id,payer_id,payee_id,amount,due_date,kind,sell_on_clause_id) VALUES (?,?,?,?,?,?,?,?)",
      schedule.negotiationId,
      playerId,
      schedule.buyerId,
      payeeId,
      amount,
      due,
      clauseId === null ? "fee" : "sell-on",
      clauseId,
    );
  }
  for (const [index, payment] of plan.entries()) {
    let remainder = payment.amount;
    for (const claim of claims) {
      const amount = Math.min(
        remainder,
        claim.remaining,
        index === plan.length - 1
          ? claim.remaining
          : round((claim.amount * payment.amount) / fee, 2),
      );
      claim.remaining = round(claim.remaining - amount, 2);
      remainder = round(remainder - amount, 2);
      await invoice(claim.beneficiary_id, amount, payment.date, claim.id);
    }
    await invoice(sellerId, remainder, payment.date);
  }
  await sellPlayerAsset(
    store,
    sellerId,
    playerId,
    proceeds,
    (await stateOf(store)).date,
  );
  await processTransferPayments(store);
  return proceeds;
}

export async function processTransferPayments(store: Store) {
  const state = await stateOf(store);
  const due = await store.all<TransferPayment>(
    "SELECT * FROM transfer_payments WHERE paid_date IS NULL AND due_date <= ? ORDER BY due_date,id",
    state.date,
  );
  for (const payment of due) {
    const description = `${(await playerOf(store, payment.player_id)).name}: transfer payment due ${payment.due_date}`;
    await ledger(
      store,
      payment.payer_id,
      -payment.amount,
      "Transfer instalment",
      description,
    );
    await ledger(
      store,
      payment.payee_id,
      payment.amount,
      payment.kind === "sell-on" ? "Sell-on receipt" : "Transfer receipt",
      description,
    );
    await store.run(
      "UPDATE clubs SET transfer_budget = transfer_budget + ? WHERE id = ?",
      payment.amount * 0.85,
      payment.payee_id,
    );
    await store.run(
      "UPDATE transfer_payments SET paid_date = ? WHERE id = ?",
      state.date,
      payment.id,
    );
    if (payment.sell_on_clause_id !== null) {
      await store.run(
        "UPDATE sell_on_clauses SET paid = ROUND(paid + ?, 2) WHERE id = ?",
        payment.amount,
        payment.sell_on_clause_id,
      );
      if (
        !(await store.get(
          "SELECT id FROM transfer_payments WHERE sell_on_clause_id = ? AND paid_date IS NULL",
          payment.sell_on_clause_id,
        ))
      )
        await store.run(
          "UPDATE sell_on_clauses SET status = 'paid' WHERE id = ?",
          payment.sell_on_clause_id,
        );
    }
    if ([payment.payer_id, payment.payee_id].includes(state.clubId))
      await news(
        store,
        "Finance",
        "Transfer payment settled",
        `${description}: ${money(payment.amount)}.`,
        "info",
        "finances",
        { playerId: payment.player_id },
      );
  }
  await store.run(
    "UPDATE buy_back_clauses SET status = 'expired' WHERE status = 'active' AND expires < ?",
    state.date,
  );
  await store.run(
    "UPDATE buy_back_clauses SET status = 'void' WHERE status = 'active' AND NOT EXISTS (SELECT 1 FROM players WHERE players.id = buy_back_clauses.player_id AND (players.club_id = buy_back_clauses.owner_id OR players.parent_club_id = buy_back_clauses.owner_id) AND players.role != 'Retired')",
  );
  return due.length;
}

const expectedWage = (player: Player) =>
  Math.max(
    player.wage,
    Math.round(((player.ability / 100) ** 7 * 190_000) / 10) * 10 + 50,
  );

function loanEndDate(type: string, date: string, duration: number) {
  if (type === "Short loan") return addDays(date, 182);
  if (type === "Emergency loan") return addDays(date, 90);
  const seasonEndYear =
    Number(date.slice(0, 4)) + (date.slice(5) >= "06-01" ? 1 : 0);
  if (type === "Two-year loan") return `${seasonEndYear + 1}-06-30`;
  if (type === "Standard loan" || duration === 365)
    return `${seasonEndYear}-06-30`;
  return addDays(date, duration);
}

export async function experience(store: Store, amount: number, reputation = 0) {
  const state = await stateOf(store);
  const settings = await settingsOf(store);
  const before = Math.floor(state.director.experience / 100);
  state.director.experience += amount;
  state.director.skillPoints +=
    Math.floor(state.director.experience / 100) - before;
  const speed =
    settings.reputationGrowth === "slow"
      ? 0.5
      : settings.reputationGrowth === "fast"
        ? 1.7
        : 1;
  state.director.reputation = clamp(
    state.director.reputation + reputation * speed,
    0,
    100,
  );
  await store.setMeta("state", state);
}

export async function initialInbox(store: Store) {
  if (
    !(await store.get(
      "SELECT [key] FROM meta WHERE [key] = 'mediaCoverageVersion'",
    ))
  ) {
    await publishPlayerCoverage(store);
    await store.setMeta("mediaCoverageVersion", 1);
  }
  if (
    await store.get(
      "SELECT [key] FROM meta WHERE [key] = ?",
      "inboxInitialized",
    )
  )
    return;
  const club = await clubOf(store);
  const scout = (await store.get<Staff>(
    "SELECT TOP (1) * FROM staff WHERE club_id = ? AND role = 'Scout' ORDER BY id",
    club.id,
  ))!;
  const prospects = await store.all<Player>(
    "SELECT TOP (5) * FROM players WHERE club_id != ? AND age BETWEEN 18 AND 23 AND ability BETWEEN 65 AND 77 AND potential >= 82 ORDER BY potential DESC, value ASC,id",
    club.id,
  );
  for (const player of prospects) {
    await store.run(
      "UPDATE players SET shortlisted = 1 WHERE id = ?",
      player.id,
    );
    await createReport(store, player, scout);
  }
  await news(
    store,
    "Board",
    "Your summer mandate",
    `Welcome to ${club.name}. The board expects a top-${club.expectations} finish, sustainable recruitment and a clear academy pathway. Your transfer budget is ${money(club.transfer_budget)}.`,
    "important",
    "board",
  );
  await news(
    store,
    "Scouting",
    "The first shortlist is on your desk",
    `${scout.name} has prepared ${prospects.length} initial reports. There are still unknowns around personality, adaptation and development.`,
    "info",
    "scouting",
  );
  await news(
    store,
    "Squad",
    "Pre-season starts here",
    `${club.manager} has requested a squad review before the first friendly. Agree roles, identify succession needs and set the training emphasis.`,
    "info",
    "squad",
  );
  await news(
    store,
    "Academy",
    "A pathway, not just potential",
    "Your head of youth is ready to pair academy prospects with senior mentors. U17 and U19 competition calendars are confirmed.",
    "info",
    "academy",
  );
  await store.setMeta("inboxInitialized", true);
}

export async function createReport(store: Store, player: Player, scout: Staff) {
  const state = await stateOf(store);
  const club = await clubOf(store);
  const profile = JSON.parse(player.profile) as PlayerProfile;
  const scoutData = JSON.parse(scout.data);
  const random = seedrandom(
    `${state.seed}:report:${player.id}:${scout.id}:${state.date}`,
  );
  const accuracy = Math.round(
    clamp(
      (scoutData.accuracy ?? scout.ability) +
        state.director.skills.scouting * 3 +
        (player.country_id === scoutData.preferredRegion ? 7 : 0),
      15,
      98,
    ),
  );
  const error = Math.max(2, Math.round((100 - accuracy) / 5));
  const bias =
    scoutData.bias === "Youth" && player.age < 21
      ? 3
      : scoutData.bias === "Physical" &&
          profile.attributes.physical.strength > 75
        ? 3
        : scoutData.bias === "Home nation" &&
            player.country_id === club.country_id
          ? 3
          : scoutData.bias === "Reputation" && player.value > 30_000_000
            ? 4
            : 0;
  const estimation = Math.round((random() - 0.5) * error * 2) + bias;
  const ratings = Object.entries(profile.attributes)
    .filter(([group]) => group !== "goalkeeper" || player.position === "GK")
    .flatMap(([, attributes]) => Object.entries(attributes));
  ratings.sort((left, right) => right[1] - left[1]);
  const fit = Math.round(tacticalFit(player, club));
  const risk = Math.round(
    clamp(
      player.volatility * 2 +
        profile.agent.difficulty / 5 +
        profile.mentalHealth.anxiety / 5 +
        (profile.lifestyle === "nightlife" ? 20 : 0) -
        (scoutData.riskTolerance ?? 50) / 8,
      0,
      100,
    ),
  );
  const data = {
    strengths: ratings
      .slice(0, scoutData.detail > 70 ? 5 : 3)
      .map(([key]) => label(key)),
    weaknesses: ratings.slice(-3).map(([key]) => label(key)),
    riskFactors: [
      player.volatility > 10
        ? "Wide development range"
        : "Relatively stable development",
      profile.lifestyle === "nightlife"
        ? "Lifestyle consistency needs support"
        : "No major lifestyle concern observed",
      player.injury_until
        ? "Current injury requires medical review"
        : "Medical history remains subject to verification",
    ],
    projection:
      player.age < 23
        ? `${Math.max(1, Math.round((player.potential - player.ability) / 5))}-year development horizon; minutes and environment are decisive.`
        : "Near peak ability; the emphasis is on immediate contribution and retention.",
    tacticalFit: fit,
    resale: Math.round(
      player.value *
        (1 + Math.max(0, player.potential - player.ability) / 30) *
        (player.age < 24 ? 1.2 : 0.85),
    ),
    personalityNotes: `${profile.personality.professionalism > 65 ? "Professional habits" : "Needs clear support and boundaries"}. ${profile.personality.ambition > 70 ? "Highly ambitious and expects progression" : "Values a stable role"}.`,
    agentDifficulty: profile.agent.difficulty,
    agentPersonality: profile.agent.personality,
    bias: scoutData.bias,
    detail: scoutData.detail,
    riskTolerance: scoutData.riskTolerance,
    recommendation:
      fit > 75 && risk < 55
        ? "Priority target"
        : risk > 70
          ? "Monitor closely"
          : "Worth following",
  };
  await store.run(
    "INSERT INTO reports(player_id, staff_id, date, accuracy, ability_low, ability_high, potential_low, potential_high, fit, risk, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    player.id,
    scout.id,
    state.date,
    accuracy,
    clamp(Math.floor(player.ability + estimation - error)),
    clamp(Math.ceil(player.ability + estimation + error)),
    clamp(
      Math.floor(player.potential + estimation - error - player.volatility / 3),
    ),
    clamp(
      Math.ceil(player.potential + estimation + error + player.volatility / 3),
    ),
    fit,
    risk,
    JSON.stringify(data),
  );
  await store.run(
    "UPDATE players SET knowledge = GREATEST(knowledge, ?) WHERE id = ?",
    accuracy,
    player.id,
  );
}

export async function assignScout(
  store: Store,
  input: {
    staffId: number;
    playerId?: number;
    countryId?: number;
    position?: string;
    maxAge: number;
    budget: number;
  },
) {
  const state = await stateOf(store);
  const scout = await store.get<Staff>(
    "SELECT * FROM staff WHERE id = ? AND club_id = ? AND role = 'Scout'",
    input.staffId,
    state.clubId,
  );
  if (!scout) throw new GameError("Choose a scout employed by your club.");
  if (
    await store.get(
      "SELECT id FROM assignments WHERE staff_id = ? AND status = ?",
      scout.id,
      "active",
    )
  )
    throw new GameError("This scout already has an active assignment.");
  if (input.playerId) await playerOf(store, input.playerId);
  const due = addDays(
    state.date,
    input.playerId ? 3 + Math.round((100 - scout.ability) / 20) : 7,
  );
  await store.run(
    "INSERT INTO assignments(staff_id, player_id, country_id, position, max_age, budget, start_date, due_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    scout.id,
    input.playerId ?? null,
    input.countryId ?? null,
    input.position ?? null,
    input.maxAge,
    input.budget,
    state.date,
    due,
  );
  await ledger(
    store,
    state.clubId,
    -2500,
    "Scouting",
    `${scout.name}: recruitment assignment`,
  );
  return { message: `${scout.name} will report on ${due}.` };
}

export async function finishScouting(store: Store) {
  const state = await stateOf(store);
  const assignments = await store.all<{
    id: number;
    staff_id: number;
    player_id: number | null;
    country_id: number | null;
    position: string | null;
    max_age: number;
    budget: number;
  }>(
    "SELECT * FROM assignments WHERE status = ? AND due_date <= ? ORDER BY id",
    "active",
    state.date,
  );
  for (const assignment of assignments) {
    const scout = (await store.get<Staff>(
      "SELECT * FROM staff WHERE id = ?",
      assignment.staff_id,
    ))!;
    const players = assignment.player_id
      ? [await playerOf(store, assignment.player_id)]
      : await store.all<Player>(
          `SELECT TOP (5) * FROM players WHERE club_id != ? AND age <= ? AND value <= ? ${assignment.country_id ? "AND country_id = ?" : ""} ${assignment.position ? "AND position = ?" : ""} ORDER BY potential - ability + potential / 4 DESC,id`,
          state.clubId,
          assignment.max_age,
          assignment.budget,
          ...(assignment.country_id ? [assignment.country_id] : []),
          ...(assignment.position ? [assignment.position] : []),
        );
    for (const player of players) await createReport(store, player, scout);
    await store.run(
      "UPDATE assignments SET status = 'complete' WHERE id = ?",
      assignment.id,
    );
    await news(
      store,
      "Scouting",
      `${scout.name}: assignment complete`,
      `${players.length} detailed reports are ready, including tactical fit, personality observations and risk assessment.`,
      "success",
      "scouting",
    );
    await experience(store, 8);
  }
}

export function defaultLoanTerms(player: Player, club: Club): LoanTerms {
  return {
    playingTime: 65,
    position: player.position,
    role: "Regular starter",
    developmentPlan: "Balanced",
    recall: true,
    injuryRecall: true,
    salarySplit: 70,
    fee: Math.round(player.value * 0.03),
    bonus: 100000,
    mandatoryMinutes: 1800,
    tacticalFit: Math.round(tacticalFit(player, club)),
    managerTrust: 60,
    relationship: 50,
    optionFee: Math.round(player.value * 1.1),
    sellOn: 15,
    duration: 365,
    obligationCondition: "Unconditional",
  };
}

export async function enquire(
  store: Store,
  playerId: number,
  type: string,
  destinationId?: number,
  guardianConsent = false,
) {
  const state = await stateOf(store);
  const player = await playerOf(store, playerId);
  if (player.role === "Retired")
    throw new GameError("This player has retired.");
  if (player.parent_club_id)
    throw new GameError(
      "The player is already on loan. Resolve that agreement first.",
    );
  const buyingClub = await clubOf(store, destinationId ?? state.clubId);
  const sellingClub = player.club_id
    ? await clubOf(store, player.club_id)
    : null;
  if (destinationId && player.club_id !== state.clubId)
    throw new GameError("You can only offer your own players to another club.");
  if (buyingClub.type !== "club")
    throw new GameError("Choose a senior club for negotiations.");
  const renewal = type === "Contract renewal";
  const youthApproach = type === "Youth approach";
  const future = type === "Future transfer";
  if (
    future &&
    (ageOn(player.birth_date, state.date) < 14 ||
      ageOn(player.birth_date, state.date) >= 18)
  )
    throw new GameError(
      "Future youth agreements are for players aged 14-17, with arrival no earlier than 18.",
    );
  if (future && !guardianConsent)
    throw new GameError(
      "Guardian consent is required for a conditional future youth agreement.",
    );
  const youth = await assessYouthTransfer(store, player, buyingClub);
  if (youthApproach && !youth.canApproachWithoutFee)
    throw new GameError(
      "A no-fee youth approach requires a recorded amateur registration without a future professional agreement. Existing professional contracts remain protected.",
    );
  if (!renewal && buyingClub.id === player.club_id)
    throw new GameError("Use a contract renewal for your own player.");
  if (renewal && player.club_id !== state.clubId)
    throw new GameError("You cannot renew another club's player.");
  const existing = await store.get<Negotiation>(
    "SELECT * FROM negotiations WHERE player_id = ? AND stage NOT IN ('Completed','Withdrawn','Rejected','Expired','Hijacked')",
    player.id,
  );
  if (existing) return existing;
  const loan = LOAN_TYPES.includes(type);
  if (loan && !sellingClub)
    throw new GameError(
      "Free agents can sign a contract, but cannot be loaned.",
    );
  if (loan && player.age < 16)
    throw new GameError("Players must be at least 16 for a domestic loan.");
  if (!renewal && !future && !youth.eligibleToApply)
    throw new GameError(youth.reasons.join(" "));
  if (
    type === "Cross-border loan" &&
    sellingClub?.country_id === buyingClub.country_id
  )
    throw new GameError("A cross-border loan needs a club in another country.");
  if (type === "Emergency loan") {
    const injuries = (await store.get<{ count: number }>(
      "SELECT count(*) AS count FROM players WHERE club_id = ? AND injury_until > ?",
      buyingClub.id,
      state.date,
    ))!.count;
    if (injuries < 3)
      throw new GameError(
        "An emergency loan requires at least three unavailable senior players at the receiving club.",
      );
  }
  const profile = JSON.parse(player.profile) as PlayerProfile;
  const partnership = sellingClub
    ? await store.get<{ strength: number }>(
        "SELECT strength FROM partnerships WHERE (club_id = ? AND partner_id = ?) OR (club_id = ? AND partner_id = ?)",
        buyingClub.id,
        sellingClub.id,
        sellingClub.id,
        buyingClub.id,
      )
    : null;
  const interestDetails = await assessPlayerInterest(
    store,
    player,
    buyingClub,
    {
      loan,
      playingTime: loan ? 65 : undefined,
    },
  );
  const interest = interestDetails.score;
  const terms = defaultLoanTerms(player, buyingClub);
  if (type === "Short loan") terms.duration = 182;
  if (type === "Two-year loan") terms.duration = 730;
  if (type === "Two-year loan") terms.mandatoryMinutes = 3600;
  if (type === "Emergency loan") terms.duration = 90;
  if (
    loan &&
    loanEndDate(type, state.date, terms.duration) > player.contract_end
  )
    throw new GameError(
      "The proposed loan outlasts the parent contract. Renew the contract or choose a shorter loan.",
    );
  if (partnership) {
    terms.relationship = partnership.strength;
    terms.salarySplit = clamp(70 - partnership.strength / 5, 20, 100);
  }
  const asking =
    renewal || youthApproach || !sellingClub
      ? 0
      : loan
        ? terms.fee
        : Math.round(
            player.value *
              (sellingClub?.balance && sellingClub.balance < 0 ? 0.85 : 1.1),
          );
  const data: NegotiationData = {
    workflowVersion: 2,
    ...(future
      ? {
          futureArrivalDate: adultTransferArrival(player.birth_date),
          originalContractEnd: player.contract_end,
          guardianConsent,
        }
      : {}),
    interestDetails,
    ...(youthApproach
      ? {
          trainingCompensation: youth.trainingCompensation,
          trainingClubId: youth.trainingClubId ?? undefined,
        }
      : {}),
    log: [
      {
        date: state.date,
        message:
          interest < 25
            ? "The player is reluctant to discuss a move. A credible pathway or improved terms will be essential."
            : `${sellingClub?.name ?? "The agent"} is open to a formal proposal. No agreement has been reached.`,
        type: "Enquiry",
      },
    ],
    agent: profile.agent,
    terms,
    years: player.age < 18 ? 3 : 4,
    role: loan ? "Regular starter" : "Squad player",
    promises: [],
  };
  const id = Number(
    (
      await store.run(
        "INSERT INTO negotiations(player_id, buying_club_id, selling_club_id, type, stage, asking_price, wage, interest, created, deadline, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        player.id,
        buyingClub.id,
        player.club_id,
        type,
        "Enquiry",
        asking,
        expectedWage(player),
        interest,
        state.date,
        addDays(state.date, 14),
        JSON.stringify(data),
      )
    ).lastInsertRowid,
  );
  return (await store.get<Negotiation>(
    "SELECT * FROM negotiations WHERE id = ?",
    id,
  ))!;
}

export async function exerciseBuyBack(store: Store, id: number) {
  const state = await stateOf(store);
  const clause = await store.get<BuyBackClause>(
    "SELECT * FROM buy_back_clauses WHERE id = ?",
    id,
  );
  if (!clause || clause.beneficiary_id !== state.clubId)
    throw new GameError("This buy-back right does not belong to your club.");
  const player = await playerOf(store, clause.player_id);
  if (clause.status !== "active" || clause.expires < state.date)
    throw new GameError(
      "This buy-back clause has expired or is no longer active.",
    );
  if (
    player.club_id !== clause.owner_id ||
    player.parent_club_id ||
    player.role === "Retired"
  )
    throw new GameError(
      "The player's registration does not allow this buy-back.",
    );
  if (!transferWindow(state.date))
    throw new GameError(
      "Buy-back clauses can only be exercised during a transfer window.",
    );
  if (clause.fee > (await clubOf(store)).transfer_budget)
    throw new GameError(
      "The buy-back fee exceeds your available transfer budget.",
    );
  const existing = await store.get<Negotiation>(
    "SELECT * FROM negotiations WHERE player_id = ? AND stage NOT IN ('Completed','Withdrawn','Rejected','Expired','Hijacked')",
    player.id,
  );
  if (existing) {
    if ((JSON.parse(existing.data) as NegotiationData).buyBackClauseId !== id)
      throw new GameError(
        "Resolve the player's current negotiation before exercising a buy-back.",
      );
    return {
      id: existing.id,
      stage: existing.stage,
      message: "Buy-back talks are already open.",
    };
  }
  const enquiry = await enquire(store, player.id, "Permanent transfer");
  const data = JSON.parse(enquiry.data) as NegotiationData;
  data.buyBackClauseId = id;
  data.transferTerms = { ...DEFAULT_TRANSFER_TERMS };
  data.log.push({
    date: state.date,
    type: "Agent talks",
    message: `Buy-back clause exercised at ${money(clause.fee)}. Club consent is already binding; player terms, medical and registration remain required.`,
  });
  await store.run(
    "UPDATE negotiations SET stage = 'Agent talks', asking_price = ?, offer = ?, deadline = ?, data = ? WHERE id = ?",
    clause.fee,
    clause.fee,
    clause.expires < enquiry.deadline ? clause.expires : enquiry.deadline,
    JSON.stringify(data),
    enquiry.id,
  );
  return {
    id: enquiry.id,
    stage: "Agent talks",
    message:
      "Buy-back price secured. Negotiate personal terms with the player.",
  };
}

export async function counterIncomingOffer(
  store: Store,
  id: number,
  fee: number,
  terms: TransferTerms,
) {
  const negotiation = await store.get<Negotiation>(
    "SELECT * FROM negotiations WHERE id = ?",
    id,
  );
  const state = await stateOf(store);
  if (
    !negotiation ||
    negotiation.stage !== "Offer received" ||
    negotiation.selling_club_id !== state.clubId ||
    negotiation.type !== "Permanent transfer"
  )
    throw new GameError(
      "Only a permanent incoming offer can be countered here.",
    );
  if (state.date > negotiation.deadline)
    throw new GameError("The negotiation deadline has passed.");
  const proposed = checkedTransferTerms(terms);
  if (proposed.buyBackFee && proposed.buyBackFee < fee)
    throw new GameError(
      "The buy-back price cannot be below the agreed transfer fee.",
    );
  const buyer = await clubOf(store, negotiation.buying_club_id);
  if (!Number.isFinite(fee) || fee < 0 || fee > buyer.transfer_budget)
    throw new GameError("The counteroffer exceeds the buying club's budget.");
  const data = JSON.parse(negotiation.data) as NegotiationData;
  const clausePremium =
    (proposed.sellOnPercent / 100) * 0.4 + (proposed.buyBackFee ? 0.05 : 0);
  const ceiling = negotiation.asking_price * (1.12 - clausePremium);
  if (fee > ceiling) {
    data.counter = Math.round(ceiling);
    data.log.push({
      date: state.date,
      type: "Counteroffer",
      message: `The buyer declines the package. Their maximum fee with these clauses is ${money(data.counter)}.`,
    });
    await store.run(
      "UPDATE negotiations SET tension = LEAST(99,tension + 10), data = ? WHERE id = ?",
      JSON.stringify(data),
      id,
    );
    return { id, stage: "Offer received", message: data.log.at(-1)!.message };
  }
  data.transferTerms = proposed;
  data.log.push({
    date: state.date,
    type: "Club talks",
    message: `The buyer accepted your fee of ${money(fee)}, payment schedule and future-transfer clauses.`,
  });
  await store.run(
    "UPDATE negotiations SET offer = ?, data = ? WHERE id = ?",
    fee,
    JSON.stringify(data),
    id,
  );
  return { id, ...(await negotiationStep(store, id, "accept")) };
}

export async function closeNegotiation(
  store: Store,
  negotiation: Negotiation,
  stage: "Rejected" | "Withdrawn" | "Expired" | "Hijacked",
  message: string,
) {
  const current = (await store.get<Negotiation>(
    "SELECT * FROM negotiations WHERE id = ?",
    negotiation.id,
  ))!;
  if (
    ["Completed", "Rejected", "Withdrawn", "Expired", "Hijacked"].includes(
      current.stage,
    )
  )
    return;
  const data = JSON.parse(current.data) as NegotiationData;
  if ((data.reservedBudget ?? 0) > 0) {
    await store.run(
      "UPDATE clubs SET transfer_budget = transfer_budget + ? WHERE id = ?",
      data.reservedBudget!,
      current.buying_club_id,
    );
    data.reservedBudget = 0;
    message += " The reserved transfer allocation has been released.";
  }
  data.log.push({ date: (await stateOf(store)).date, type: stage, message });
  await store.run(
    "UPDATE negotiations SET stage = ?,data = ? WHERE id = ?",
    stage,
    JSON.stringify(data),
    current.id,
  );
}

export async function negotiationStep(
  store: Store,
  id: number,
  action: "formalize" | "sign" | "revise" | "accept",
  automated = false,
) {
  const state = await stateOf(store);
  const negotiation = await store.get<Negotiation>(
    "SELECT * FROM negotiations WHERE id = ?",
    id,
  );
  if (
    !negotiation ||
    ![negotiation.buying_club_id, negotiation.selling_club_id].includes(
      state.clubId,
    )
  )
    throw new GameError("This negotiation is not yours.");
  if (state.date > negotiation.deadline)
    throw new GameError("The negotiation deadline has passed.");
  const data = JSON.parse(negotiation.data) as NegotiationData;
  let stage: string;
  let message: string;
  if (
    data.buyerManaged &&
    negotiation.buying_club_id !== state.clubId &&
    !automated &&
    ["sign", "revise"].includes(action)
  )
    throw new GameError("The buying club controls personal terms and signing.");
  if (action === "accept") {
    if (
      negotiation.stage !== "Offer received" ||
      negotiation.selling_club_id !== state.clubId
    )
      throw new GameError("Only an incoming offer can be accepted here.");
    data.workflowVersion = 2;
    data.buyerManaged = true;
    data.nextStageDate = addDays(state.date, 1);
    data.log.push({
      date: state.date,
      type: "Club talks",
      message: `The selling club accepted the fee of ${money(negotiation.offer)}. No funds have changed hands.`,
    });
    stage = "Agent talks";
    message =
      "Club terms accepted. The buying club will negotiate personal terms with the agent before signing, medical and registration.";
  } else if (action === "formalize") {
    if (negotiation.stage !== "Enquiry")
      throw new GameError("An enquiry must precede formal talks.");
    stage =
      negotiation.interest < 20
        ? "Rejected"
        : negotiation.type === "Contract renewal" ||
            negotiation.type === "Youth approach" ||
            negotiation.selling_club_id === null
          ? "Agent talks"
          : "Club talks";
    message =
      stage === "Rejected"
        ? "The player has declined formal discussions: the proposed career pathway is not attractive."
        : stage === "Agent talks"
          ? "Permission to discuss personal terms confirmed. No club transfer fee is required."
          : "The selling club has authorized formal discussions. Submit a fee and any loan guarantees.";
  } else if (action === "revise") {
    if (negotiation.stage !== "Contract review")
      throw new GameError("Only an unsigned contract can be revised.");
    stage = "Agent talks";
    data.contractRevision = (data.contractRevision ?? 0) + 1;
    message =
      "The draft has been returned to the agent. Club terms remain agreed; personal terms must be reconfirmed.";
  } else {
    if (negotiation.stage !== "Contract review")
      throw new GameError(
        "Both club and agent terms must be agreed before signing.",
      );
    stage = "Medical";
    data.signedDate = state.date;
    data.medicalDate = addDays(state.date, 2);
    message = `Conditional agreement signed. Medical scheduled for ${data.medicalDate}; registration and payment follow only after clearance.`;
    if (data.futureArrivalDate) {
      if (!data.guardianConsent)
        throw new GameError(
          "Guardian consent is required for this future agreement.",
        );
      const reserved =
        negotiation.offer +
        (data.signingBonus ?? 0) +
        Math.round((negotiation.wage * 52 * data.agent.commission) / 100) +
        (data.trainingCompensation ?? 0);
      if (
        reserved >
        (await clubOf(store, negotiation.buying_club_id)).transfer_budget
      )
        throw new GameError(
          "The transfer allocation cannot cover this future commitment.",
        );
      data.reservedBudget = reserved;
      await store.run(
        "UPDATE clubs SET transfer_budget = transfer_budget - ? WHERE id = ?",
        reserved,
        negotiation.buying_club_id,
      );
      stage = "Scheduled";
      data.medicalDate = addDays(data.futureArrivalDate, -2);
      message = `Future agreement signed. Earliest arrival: ${data.futureArrivalDate}. ${money(reserved)} is reserved, not paid. The player remains at the current club; medical and registration clearance still apply.`;
    }
  }
  data.log.push({ date: state.date, type: stage, message });
  await store.run(
    "UPDATE negotiations SET stage = ?, tension = LEAST(99,tension + ?), data = ? WHERE id = ?",
    stage,
    action === "revise" ? 4 : 0,
    JSON.stringify(data),
    id,
  );
  if (action === "sign" && negotiation.type !== "Contract renewal")
    await publishTransferStory(store, {
      key: `negotiation:${id}:agreement`,
      phase: "agreement",
      playerId: negotiation.player_id,
      buyerId: negotiation.buying_club_id,
      sellerId: negotiation.selling_club_id,
      fee: negotiation.offer,
      loan: LOAN_TYPES.includes(negotiation.type),
      negotiationId: id,
      arrivalDate: data.futureArrivalDate,
    });
  return { stage, message };
}

export async function progressDealMilestones(
  store: Store,
  negotiation: Negotiation,
) {
  const state = await stateOf(store);
  const data = JSON.parse(negotiation.data) as NegotiationData;
  if (
    (
      await store.get<{ stage: string }>(
        "SELECT stage FROM negotiations WHERE id = ?",
        negotiation.id,
      )
    )?.stage !== negotiation.stage
  )
    return false;
  if (negotiation.stage === "Scheduled") {
    const player = await playerOf(store, negotiation.player_id);
    const expiredFreeAgent =
      player.club_id === null &&
      !!data.originalContractEnd &&
      data.originalContractEnd < state.date;
    if (
      (player.club_id !== negotiation.selling_club_id && !expiredFreeAgent) ||
      player.parent_club_id ||
      player.role === "Retired"
    ) {
      await closeNegotiation(
        store,
        negotiation,
        "Rejected",
        "The future agreement cannot proceed because the player's registration has changed.",
      );
      return true;
    }
    if (
      !data.futureArrivalDate ||
      !data.medicalDate ||
      state.date < data.medicalDate
    )
      return true;
    data.log.push({
      date: state.date,
      type: "Medical",
      message:
        "The future arrival is approaching. Medical checks have begun; registration cannot occur before adulthood.",
    });
    await store.run(
      "UPDATE negotiations SET stage = 'Medical',data = ? WHERE id = ?",
      JSON.stringify(data),
      negotiation.id,
    );
    return await progressDealMilestones(
      store,
      (await store.get<Negotiation>(
        "SELECT * FROM negotiations WHERE id = ?",
        negotiation.id,
      ))!,
    );
  }
  if (
    data.buyerManaged &&
    ["Agent talks", "Contract review"].includes(negotiation.stage)
  ) {
    if (data.nextStageDate && state.date < data.nextStageDate) return true;
    data.nextStageDate = addDays(state.date, 1);
    await store.run(
      "UPDATE negotiations SET data = ? WHERE id = ?",
      JSON.stringify(data),
      negotiation.id,
    );
    if (negotiation.stage === "Agent talks") {
      const player = await playerOf(store, negotiation.player_id);
      await negotiate(
        store,
        negotiation.id,
        {
          fee: negotiation.offer,
          wage: Math.max(
            negotiation.wage,
            data.requiredWage ?? Math.round(expectedWage(player) * 1.35),
          ),
          years: data.years,
          role: data.role,
          promises: data.promises,
          signingBonus: data.signingBonus,
        },
        true,
      );
    } else await negotiationStep(store, negotiation.id, "sign", true);
    return true;
  }
  if (
    negotiation.stage === "Medical" &&
    data.medicalDate &&
    state.date >= data.medicalDate
  ) {
    const player = await playerOf(store, negotiation.player_id);
    if (data.workflowVersion === 2) {
      if (
        player.injury_until &&
        daysBetween(state.date, player.injury_until) > 30
      ) {
        await closeNegotiation(
          store,
          negotiation,
          "Rejected",
          "The medical found an unresolved long-term injury. No fee has been paid.",
        );
        await news(
          store,
          "Transfers",
          `${player.name}: medical failed`,
          "The conditional agreement will not proceed. No funds or registration changed hands.",
          "warning",
          "transfers",
        );
      } else {
        data.medicalPassed = true;
        data.registrationDate = addDays(state.date, 1);
        if (
          data.futureArrivalDate &&
          data.registrationDate < data.futureArrivalDate
        )
          data.registrationDate = data.futureArrivalDate;
        data.log.push({
          date: state.date,
          type: "Registration",
          message: `Medical passed. Contract and registration documents submitted; clearance due no earlier than ${data.registrationDate}.`,
        });
        await store.run(
          "UPDATE negotiations SET stage = 'Registration', data = ? WHERE id = ?",
          JSON.stringify(data),
          negotiation.id,
        );
        if (
          [negotiation.buying_club_id, negotiation.selling_club_id].includes(
            state.clubId,
          )
        )
          await news(
            store,
            "Transfers",
            `${player.name}: medical passed`,
            "Registration checks, work permission and financial commitments are now being finalized.",
            "success",
            "transfers",
          );
      }
    } else await completeNegotiation(store, negotiation);
    return true;
  }
  if (
    negotiation.stage === "Registration" &&
    (!data.registrationDate || state.date >= data.registrationDate)
  ) {
    await completeNegotiation(store, negotiation);
    return true;
  }
  return ["Scheduled", "Medical", "Registration"].includes(negotiation.stage);
}

export async function declareInterest(store: Store, id: number) {
  const negotiation = await store.get<Negotiation>(
    "SELECT * FROM negotiations WHERE id = ?",
    id,
  );
  if (!negotiation) throw new GameError("Negotiation not found.");
  if (negotiation.public) throw new GameError("Interest is already public.");
  if (!["Enquiry", "Club talks", "Agent talks"].includes(negotiation.stage))
    throw new GameError("This negotiation is no longer open.");
  const data = JSON.parse(negotiation.data) as NegotiationData;
  data.log.push({
    date: (await stateOf(store)).date,
    message:
      "Interest was made public. The agent welcomes the attention; the selling club has raised its valuation.",
    type: "Media",
  });
  data.declared = true;
  await store.run(
    "UPDATE negotiations SET [public] = 1, tension = LEAST(100, tension + 12), interest = LEAST(100, interest + 8), asking_price = asking_price * 1.08, data = ? WHERE id = ?",
    JSON.stringify(data),
    id,
  );
  const player = await playerOf(store, negotiation.player_id);
  await news(
    store,
    "Media",
    `Public interest in ${player.name}`,
    "The declaration has increased attention from supporters and competing clubs. Expectations have risen.",
    "important",
    "transfers",
  );
  await publishTransferStory(store, {
    key: `negotiation:${id}:interest`,
    phase: "interest",
    playerId: player.id,
    buyerId: negotiation.buying_club_id,
    sellerId: negotiation.selling_club_id,
    fee: negotiation.asking_price,
    loan: LOAN_TYPES.includes(negotiation.type),
    negotiationId: id,
  });
  await store.run(
    "UPDATE clubs SET fan_mood = LEAST(100, fan_mood + 2) WHERE id = ?",
    (await stateOf(store)).clubId,
  );
}

export async function negotiate(
  store: Store,
  id: number,
  input: {
    fee: number;
    wage: number;
    years: number;
    role: string;
    promises: string[];
    terms?: LoanTerms;
    signingBonus?: number;
    transferTerms?: TransferTerms;
  },
  automated = false,
) {
  const negotiation = await store.get<Negotiation>(
    "SELECT * FROM negotiations WHERE id = ?",
    id,
  );
  if (!negotiation) throw new GameError("Negotiation not found.");
  const state = await stateOf(store);
  const settings = await settingsOf(store);
  if (
    negotiation.buying_club_id !== state.clubId &&
    negotiation.selling_club_id !== state.clubId
  )
    throw new GameError("You are not involved in this negotiation.");
  if (!["Club talks", "Agent talks"].includes(negotiation.stage))
    throw new GameError("This negotiation is not awaiting an offer.");
  if (state.date > negotiation.deadline)
    throw new GameError("The negotiation deadline has passed.");
  const player = await playerOf(store, negotiation.player_id);
  const buyer = await clubOf(store, negotiation.buying_club_id);
  const data = JSON.parse(negotiation.data) as NegotiationData;
  if (data.buyerManaged && buyer.id !== state.clubId && !automated)
    throw new GameError("The buying club controls personal terms and signing.");
  const loan = LOAN_TYPES.includes(negotiation.type);
  if (negotiation.type === "Youth approach" && input.fee !== 0)
    throw new GameError(
      "A youth approach has no transfer fee; training compensation is handled separately.",
    );
  if (input.transferTerms) {
    if (
      !["Permanent transfer", "Future transfer"].includes(negotiation.type) ||
      !negotiation.selling_club_id
    )
      throw new GameError(
        "Transfer clauses require a permanent move between clubs.",
      );
    const proposed = checkedTransferTerms(input.transferTerms);
    if (
      negotiation.stage !== "Club talks" &&
      JSON.stringify(proposed) !==
        JSON.stringify(checkedTransferTerms(data.transferTerms))
    )
      throw new GameError(
        "Club terms are already agreed; personal talks cannot change them.",
      );
    if (proposed.buyBackFee > 0 && proposed.buyBackFee < input.fee)
      throw new GameError(
        "The buy-back price cannot be below the agreed transfer fee.",
      );
    data.transferTerms = proposed;
  }
  const difficulty =
    settings.negotiationDifficulty === "relaxed"
      ? -0.1
      : settings.negotiationDifficulty === "ruthless"
        ? 0.07
        : 0;
  const skill = state.director.skills.negotiations * 0.012;
  let stage = negotiation.stage;
  let tension = negotiation.tension;
  let fee = negotiation.offer;
  let message: string;
  if (input.years > 3 && player.age < 18)
    throw new GameError("Under-18 contracts are limited to three years.");
  if (
    input.fee + (input.signingBonus ?? 0) + (data.trainingCompensation ?? 0) >
      buyer.transfer_budget &&
    negotiation.type !== "Contract renewal"
  )
    throw new GameError(
      "The total upfront commitment exceeds the buying club's transfer budget.",
    );
  if (input.terms && negotiation.stage === "Club talks")
    data.terms = input.terms;
  data.offerCount = (data.offerCount ?? 0) + 1;
  if (
    loan &&
    loanEndDate(negotiation.type, state.date, data.terms.duration) >
      player.contract_end
  )
    throw new GameError("The proposed loan outlasts the parent contract.");
  const actualRelationship = negotiation.selling_club_id
    ? ((
        await store.get<{ strength: number }>(
          "SELECT strength FROM partnerships WHERE (club_id = ? AND partner_id = ?) OR (club_id = ? AND partner_id = ?)",
          buyer.id,
          negotiation.selling_club_id,
          negotiation.selling_club_id,
          buyer.id,
        )
      )?.strength ?? 50)
    : 50;
  if (loan) data.terms.relationship = actualRelationship;
  if (
    loan &&
    data.terms.position !== player.position &&
    data.terms.position !== player.secondary_position
  )
    throw new GameError(
      "The position guarantee must match a trained position.",
    );
  if (loan && data.terms.tacticalFit > tacticalFit(player, buyer) + 10)
    throw new GameError(
      "The receiving club cannot meet that tactical-fit guarantee.",
    );
  if (loan && data.terms.managerTrust > buyer.manager_trust)
    throw new GameError(
      "The receiving manager does not meet the requested trust threshold.",
    );
  if (stage === "Club talks") {
    const guaranteeDiscount = loan
      ? (data.terms.playingTime - 50) / 500 + (actualRelationship - 50) / 1000
      : 0;
    const floor =
      negotiation.asking_price *
      (0.88 +
        difficulty -
        skill -
        guaranteeDiscount +
        (data.agent.personality === "Combative" ? 0.04 : 0));
    if (negotiation.interest < 20) {
      stage = "Rejected";
      message =
        "The player has declined: the proposed club and career pathway do not fit their ambitions.";
    } else if (input.fee >= floor) {
      fee = input.fee;
      stage = "Agent talks";
      tension = Math.max(5, tension - 8);
      message = `Club terms agreed at ${money(fee)}. Personal terms and the medical remain outstanding.`;
    } else {
      tension += input.fee < floor * 0.65 ? 24 : 12;
      data.counter = Math.round(
        Math.max(input.fee, negotiation.asking_price * 0.96),
      );
      await store.run(
        "UPDATE negotiations SET asking_price = ? WHERE id = ?",
        data.counter,
        id,
      );
      message = `Offer rejected. The club counters at ${money(data.counter)}.`;
    }
  } else {
    data.interestDetails = await assessPlayerInterest(store, player, buyer, {
      loan,
      role: loan ? data.terms.role : input.role,
      wage: input.wage,
      years: input.years,
      promises: input.promises,
      playingTime: loan ? data.terms.playingTime : undefined,
      tension,
    });
    const requiredWage = data.interestDetails.expectedWage;
    data.requiredWage = requiredWage;
    const currentWages = await weeklyWages(store, buyer.id);
    const addedWage = loan
      ? (player.wage * data.terms.salarySplit) / 100
      : input.wage;
    if (
      currentWages -
        (player.club_id === buyer.id ? player.wage : 0) +
        addedWage >
      buyer.wage_budget
    )
      throw new GameError(
        "The proposed wage exceeds the club's weekly wage budget. Rebalance the budget first.",
      );
    if (data.interestDetails.score < 35) {
      tension += 6;
      message = `The player is not ready to agree. ${data.interestDetails.concerns.slice(0, 2).join(" ")}`;
    } else if (
      input.wage >= requiredWage ||
      (loan && input.wage >= player.wage)
    ) {
      stage = data.workflowVersion === 2 ? "Contract review" : "Medical";
      if (data.workflowVersion !== 2) data.medicalDate = addDays(state.date, 2);
      data.years = input.years;
      data.role = input.role;
      data.promises = input.promises;
      data.signingBonus = input.signingBonus ?? 0;
      message =
        data.workflowVersion === 2
          ? "Personal terms agreed. Review the complete contract, agent commission and promises before signing the conditional agreement."
          : `Personal terms agreed. Medical and registration checks are scheduled for ${data.medicalDate}. Promises will be monitored.`;
    } else {
      tension += 15;
      message = `The agent requests ${money(requiredWage)} per week and a credible ${input.role.toLowerCase()} role.`;
    }
  }
  if (tension >= 90) {
    stage = "Rejected";
    message =
      "Talks have broken down. The relationship has been damaged by the negotiation.";
  }
  data.log.push({ date: state.date, message, type: stage });
  await store.run(
    "UPDATE negotiations SET stage = ?, tension = ?, offer = ?, wage = ?, interest = ?, data = ? WHERE id = ?",
    stage,
    clamp(tension, 0, 100),
    fee,
    negotiation.stage === "Club talks" ? negotiation.wage : input.wage,
    data.interestDetails?.score ?? negotiation.interest,
    JSON.stringify(data),
    id,
  );
  return { message, stage };
}

export async function completeNegotiation(
  store: Store,
  negotiation: Negotiation,
) {
  const state = await stateOf(store);
  const player = await playerOf(store, negotiation.player_id);
  const buyer = await clubOf(store, negotiation.buying_club_id);
  const data = JSON.parse(negotiation.data) as NegotiationData;
  const loan = LOAN_TYPES.includes(negotiation.type);
  const renewal = negotiation.type === "Contract renewal";
  const transferTerms = checkedTransferTerms(data.transferTerms);
  if (data.buyBackClauseId) {
    const clause = await store.get<BuyBackClause>(
      "SELECT * FROM buy_back_clauses WHERE id = ?",
      data.buyBackClauseId,
    );
    if (
      !clause ||
      clause.status !== "active" ||
      clause.expires < state.date ||
      clause.beneficiary_id !== buyer.id ||
      clause.owner_id !== player.club_id ||
      clause.fee !== negotiation.offer
    )
      throw new GameError(
        "The buy-back right is no longer valid for this registration.",
      );
  }
  const currentStage = (
    await store.get<{ stage: string }>(
      "SELECT stage FROM negotiations WHERE id = ?",
      negotiation.id,
    )
  )?.stage;
  if (
    currentStage !== (data.workflowVersion === 2 ? "Registration" : "Medical")
  )
    throw new GameError(
      "The agreement is not awaiting registration; registration has changed or already completed.",
    );
  if (data.medicalDate && state.date < data.medicalDate) return;
  if (data.workflowVersion === 2 && (!data.medicalPassed || !data.signedDate))
    throw new GameError(
      "A signed agreement and passed medical are required before registration.",
    );
  if (data.registrationDate && state.date < data.registrationDate) return;
  if (data.futureArrivalDate) {
    if (
      state.date < data.futureArrivalDate ||
      ageOn(player.birth_date, state.date) < 18 ||
      !transferWindow(state.date)
    )
      return;
    player.age = ageOn(player.birth_date, state.date);
    if (
      player.club_id === null &&
      data.originalContractEnd &&
      data.originalContractEnd < state.date
    ) {
      data.log.push({
        date: state.date,
        type: "Registration",
        message:
          "The previous club contract expired before arrival. Its transfer fee is waived and unused reserved allocation will be returned.",
      });
      negotiation = { ...negotiation, selling_club_id: null, offer: 0 };
      await store.run(
        "UPDATE negotiations SET offer = 0,selling_club_id = NULL WHERE id = ?",
        negotiation.id,
      );
    }
  }
  if (player.club_id !== negotiation.selling_club_id || player.parent_club_id)
    throw new GameError(
      "The player's registration has changed; this agreement cannot complete.",
    );
  const deferred =
    !loan &&
    !renewal &&
    !!negotiation.selling_club_id &&
    transferTerms.installments > 0;
  const youth = await assessYouthTransfer(store, player, buyer);
  if (!renewal && !youth.approved) {
    if (youth.application?.status === "pending") return;
    throw new GameError(`${youth.status}. ${youth.reasons.join(" ")}`);
  }
  if (player.age < 18 && data.years > 3)
    throw new GameError("Under-18 contracts cannot exceed three years.");
  if (
    negotiation.type === "Youth approach" &&
    (!youth.canApproachWithoutFee || negotiation.offer !== 0)
  )
    throw new GameError(
      "The no-fee youth registration is no longer available.",
    );
  if (
    !renewal &&
    !transferWindow(state.date) &&
    negotiation.type !== "Emergency loan" &&
    player.club_id
  )
    return;
  if (
    player.injury_until &&
    daysBetween(state.date, player.injury_until) > 30
  ) {
    await closeNegotiation(
      store,
      negotiation,
      "Rejected",
      "The medical found a significant injury.",
    );
    await news(
      store,
      "Transfers",
      `${player.name}: medical concern`,
      "A significant injury was identified. The deal has not completed and no transfer funds were spent.",
      "warning",
      "transfers",
    );
    return;
  }
  const playerProfile = JSON.parse(player.profile) as PlayerProfile;
  const registration = await assessRegistration(store, player, buyer);
  if (!renewal && !registration.allowed) {
    await closeNegotiation(
      store,
      negotiation,
      "Rejected",
      `Registration denied: ${registration.reasons.join(" ")}`,
    );
    await news(
      store,
      "Transfers",
      `${player.name}: registration denied`,
      `${registration.source}: ${registration.reasons.join(" ")}`,
      "warning",
      "loans",
    );
    return;
  }
  const agentFee = Math.round(
    ((loan ? negotiation.offer : negotiation.wage * 52) *
      data.agent.commission) /
      100,
  );
  const trainingCompensation =
    negotiation.type === "Youth approach"
      ? (data.trainingCompensation ?? youth.trainingCompensation)
      : 0;
  const total =
    negotiation.offer +
    (data.signingBonus ?? 0) +
    agentFee +
    trainingCompensation;
  if (total > buyer.transfer_budget + (data.reservedBudget ?? 0)) {
    await closeNegotiation(
      store,
      negotiation,
      "Rejected",
      "Funding is no longer available.",
    );
    await news(
      store,
      "Transfers",
      "Funding no longer available",
      `${player.name}'s deal could not be registered because the transfer budget changed before completion.`,
      "warning",
      "transfers",
    );
    return;
  }
  const compliance = await assessFinances(store, buyer.id, {
    annualWages:
      (loan
        ? (player.wage * data.terms.salarySplit) / 100
        : negotiation.wage - (renewal ? player.wage : 0)) * 52,
    fee: negotiation.offer + trainingCompensation,
    agentFee,
    years: loan ? data.terms.duration / 365.25 : data.years,
  });
  if (
    (await settingsOf(store)).ffp &&
    compliance.issues.length &&
    buyer.id === state.clubId
  ) {
    await news(
      store,
      "Finance",
      "Financial compliance assessment",
      `${compliance.policy}: ${compliance.issues.join(" ")} This is a forecast for review, not an automatic regulatory transfer embargo.`,
      "warning",
      "finances",
    );
    await store.run(
      "UPDATE clubs SET board_pressure = LEAST(100,board_pressure + 3) WHERE id = ?",
      buyer.id,
    );
  }
  const addedWage = loan
    ? (player.wage * data.terms.salarySplit) / 100
    : negotiation.wage;
  if (
    (await weeklyWages(store, buyer.id)) -
      (renewal ? player.wage : 0) +
      addedWage >
    buyer.wage_budget
  ) {
    await closeNegotiation(
      store,
      negotiation,
      "Rejected",
      "The wage allocation no longer supports the agreement.",
    );
    await news(
      store,
      "Transfers",
      "Wage allocation changed",
      `${player.name}'s agreement could not be registered because the club can no longer support the wage commitment.`,
      "warning",
      "finances",
    );
    return;
  }
  await store.run(
    "MERGE registration_records WITH (HOLDLOCK) AS target USING (VALUES (?,?,'approved',?,?)) AS source(player_id,country_id,status,date,data) ON target.player_id = source.player_id AND target.country_id = source.country_id WHEN MATCHED THEN UPDATE SET status = source.status,date = source.date,data = source.data WHEN NOT MATCHED THEN INSERT (player_id,country_id,status,date,data) VALUES (source.player_id,source.country_id,source.status,source.date,source.data);",
    player.id,
    buyer.country_id,
    state.date,
    JSON.stringify(registration),
  );
  await ledger(
    store,
    buyer.id,
    -(
      total -
      agentFee -
      trainingCompensation -
      (deferred ? negotiation.offer : 0)
    ),
    loan ? "Loan fees" : renewal ? "Contract bonus" : "Transfer fees",
    `${player.name}: ${negotiation.type.toLowerCase()}`,
  );
  await ledger(
    store,
    buyer.id,
    -agentFee,
    "Agent fees",
    `${player.name}: representation commission`,
  );
  if (trainingCompensation && youth.trainingClubId) {
    await ledger(
      store,
      buyer.id,
      -trainingCompensation,
      "Training compensation",
      `${player.name}: modeled youth training compensation`,
    );
    await ledger(
      store,
      youth.trainingClubId,
      trainingCompensation,
      "Player sales",
      `${player.name}: youth training compensation received`,
    );
    await recordFinancialItem(
      store,
      youth.trainingClubId,
      "sale_profit",
      trainingCompensation,
    );
    await store.run(
      "UPDATE clubs SET transfer_budget = transfer_budget + ? WHERE id = ?",
      trainingCompensation * 0.85,
      youth.trainingClubId,
    );
  }
  await store.run(
    "UPDATE clubs SET transfer_budget = transfer_budget - ?, season_spend = season_spend + ? WHERE id = ?",
    total - (data.reservedBudget ?? 0),
    total,
    buyer.id,
  );
  data.reservedBudget = 0;
  if (data.futureArrivalDate)
    await store.run(
      "UPDATE players SET age = ? WHERE id = ?",
      player.age,
      player.id,
    );
  if (negotiation.selling_club_id && !renewal) {
    if (loan) {
      await ledger(
        store,
        negotiation.selling_club_id,
        negotiation.offer,
        "Loan income",
        `${player.name}: agreement completed`,
      );
      await store.run(
        "UPDATE clubs SET transfer_budget = transfer_budget + ? WHERE id = ?",
        negotiation.offer * 0.85,
        negotiation.selling_club_id,
      );
    } else
      await transferProceeds(
        store,
        player.id,
        negotiation.selling_club_id,
        negotiation.offer,
        `${player.name}: agreement completed`,
        deferred
          ? {
              negotiationId: negotiation.id,
              buyerId: buyer.id,
              terms: transferTerms,
            }
          : undefined,
      );
  }
  if (loan) {
    const terms = data.terms;
    const duration =
      negotiation.type === "Short loan"
        ? 182
        : negotiation.type === "Two-year loan"
          ? 730
          : negotiation.type === "Emergency loan"
            ? 90
            : terms.duration;
    const loanId = Number(
      (
        await store.run(
          "INSERT INTO loans(player_id, parent_id, destination_id, type, start_date, end_date, fit, relationship, terms, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          player.id,
          negotiation.selling_club_id,
          buyer.id,
          negotiation.type,
          state.date,
          loanEndDate(negotiation.type, state.date, duration),
          tacticalFit(player, buyer),
          terms.relationship,
          JSON.stringify(terms),
          JSON.stringify({
            startingAbility: player.ability,
            startingPotential: player.potential,
            startingMinutes: player.minutes,
            startingMorale: player.morale,
            parentRole: player.role,
            parentTraining: player.training,
            startingPersonality: playerProfile.personality.professionalism,
            weeks: 0,
            failures: 0,
            injuryWeeks: 0,
            factors: {},
            history: [],
            bonusPaid: false,
          }),
        )
      ).lastInsertRowid,
    );
    await acquirePlayerAsset(
      store,
      buyer.id,
      player.id,
      negotiation.offer,
      state.date,
      loanEndDate(negotiation.type, state.date, duration),
    );
    await store.run(
      "UPDATE players SET parent_club_id = club_id, club_id = ?, role = ?, training = ?, morale = LEAST(99, morale + 3), loan_progress = 0 WHERE id = ?",
      buyer.id,
      terms.role,
      terms.developmentPlan,
      player.id,
    );
    if (negotiation.type === "Loan with sell-on" && terms.sellOn > 0)
      await store.run(
        "INSERT INTO sell_on_clauses(player_id, beneficiary_id, owner_id, percentage, source_loan_id) VALUES (?, ?, ?, ?, ?)",
        player.id,
        buyer.id,
        negotiation.selling_club_id,
        terms.sellOn,
        loanId,
      );
  } else {
    if (!renewal)
      await acquirePlayerAsset(
        store,
        buyer.id,
        player.id,
        negotiation.offer + trainingCompensation,
        state.date,
        `${Number(state.date.slice(0, 4)) + data.years}-06-30`,
      );
    await store.run(
      "UPDATE players SET club_id = ?, parent_club_id = NULL, wage = ?, contract_end = ?, role = ?, listed = 0, available_loan = 0, morale = LEAST(99, morale + 7) WHERE id = ?",
      buyer.id,
      negotiation.wage,
      `${Number(state.date.slice(0, 4)) + data.years}-06-30`,
      data.role,
      player.id,
    );
    playerProfile.contract = {
      ...playerProfile.contract,
      status: "professional",
      futureProfessionalContract: false,
      signedDate: state.date,
    };
    playerProfile.registration = {
      workPermitPoints: playerProfile.registration?.workPermitPoints ?? 0,
      adaptedCountries: playerProfile.registration?.adaptedCountries ?? [],
      lastAssociationId: buyer.country_id,
    };
    await store.run(
      "UPDATE players SET profile = ? WHERE id = ?",
      JSON.stringify(playerProfile),
      player.id,
    );
  }
  if (!loan && !renewal && negotiation.selling_club_id) {
    if (data.buyBackClauseId)
      await store.run(
        "UPDATE buy_back_clauses SET status = 'exercised' WHERE id = ?",
        data.buyBackClauseId,
      );
    if (transferTerms.sellOnPercent > 0)
      await store.run(
        "INSERT INTO sell_on_clauses(player_id,beneficiary_id,owner_id,percentage) VALUES (?,?,?,?)",
        player.id,
        negotiation.selling_club_id,
        buyer.id,
        transferTerms.sellOnPercent,
      );
    if (transferTerms.buyBackFee > 0)
      await store.run(
        "INSERT INTO buy_back_clauses(negotiation_id,player_id,beneficiary_id,owner_id,fee,expires) VALUES (?,?,?,?,?,?)",
        negotiation.id,
        player.id,
        negotiation.selling_club_id,
        buyer.id,
        transferTerms.buyBackFee,
        addMonths(state.date, transferTerms.buyBackYears * 12),
      );
  }
  for (const promise of data.promises)
    await store.run(
      "INSERT INTO promises(player_id, type, target, due_date, data) VALUES (?, ?, ?, ?, ?)",
      player.id,
      promise,
      promise === "First-team minutes"
        ? 1500
        : promise === "Captaincy"
          ? 1
          : 70,
      addDays(state.date, 180),
      JSON.stringify({ startMinutes: player.minutes, clubId: buyer.id }),
    );
  data.log.push({
    date: state.date,
    type: "Completed",
    message:
      "Registration approved. The agreed fee, contract and any loan guarantees are now effective.",
  });
  await store.run(
    "UPDATE negotiations SET stage = 'Completed', data = ? WHERE id = ?",
    JSON.stringify(data),
    negotiation.id,
  );
  if (!renewal) {
    await store.run(
      "INSERT INTO history(season,entity_type,entity_id,date,data) VALUES (?,?,?,?,?)",
      state.season,
      loan ? "loan" : "transfer",
      player.id,
      state.date,
      JSON.stringify({
        name: player.name,
        from: negotiation.selling_club_id,
        to: buyer.id,
        club: buyer.name,
        fee: negotiation.offer,
        type: negotiation.type,
      }),
    );
    await publishTransferStory(store, {
      key: `negotiation:${negotiation.id}:signing`,
      phase: "signing",
      playerId: player.id,
      buyerId: buyer.id,
      sellerId: negotiation.selling_club_id,
      fee: negotiation.offer,
      loan,
      negotiationId: negotiation.id,
    });
  }
  if (negotiation.selling_club_id !== buyer.id)
    await store.run(
      "UPDATE clubs SET chemistry = GREATEST(0, chemistry - 1.5) WHERE id = ?",
      buyer.id,
    );
  if (
    negotiation.buying_club_id === state.clubId ||
    negotiation.selling_club_id === state.clubId
  ) {
    await news(
      store,
      "Transfers",
      `${player.name}: deal completed`,
      `${negotiation.type} agreed with ${buyer.name}. ${loan ? "The loan guarantees and development plan are now being monitored." : "The contract, wage and promises are registered."}`,
      "success",
      loan ? "loans" : "squad",
      { playerId: player.id },
    );
    await experience(store, 25, 0.4);
  }
}

export async function createPartnership(
  store: Store,
  partnerId: number,
  type: string,
  clubId?: number,
) {
  const own = await clubOf(store, clubId);
  const partner = await clubOf(store, partnerId);
  if (partner.id === own.id || partner.type !== "club")
    throw new GameError("Choose another senior club.");
  if (!PARTNERSHIP_TYPES.includes(type))
    throw new GameError("Invalid partnership type.");
  if (
    await store.get(
      "SELECT id FROM partnerships WHERE (club_id = ? AND partner_id = ?) OR (club_id = ? AND partner_id = ?)",
      own.id,
      partnerId,
      partnerId,
      own.id,
    )
  )
    throw new GameError("A partnership already exists.");
  const networkSize = (await store.get<{ total: number }>(
    "SELECT count(*) AS total FROM partnerships WHERE club_id = ? OR partner_id = ?",
    partner.id,
    partner.id,
  ))!.total;
  const consent = affiliationWillingness(own, partner, type, networkSize);
  if (!consent.willing)
    throw new GameError(
      `${partner.name} declined the ${type.toLowerCase()} proposal. ${consent.reasons.join(" ")}`,
    );
  const cost = consent.annualFee;
  if (own.balance < cost)
    throw new GameError("The club cannot afford this partnership.");
  await ledger(
    store,
    own.id,
    -cost,
    "Partnerships",
    `${type}: ${partner.name}`,
  );
  await ledger(
    store,
    partner.id,
    cost,
    "Partnership income",
    `${type}: ${own.name}`,
  );
  await store.run(
    "INSERT INTO partnerships(club_id, partner_id, type, strength, data) VALUES (?, ?, ?, ?, ?)",
    own.id,
    partner.id,
    type,
    clamp(55 + (own.reputation - partner.reputation) / 3, 30, 85),
    JSON.stringify({
      since: (await stateOf(store)).date,
      annualFee: cost,
      loansCompleted: 0,
      affiliate: true,
      mutualConsent: {
        clubId: partner.id,
        score: consent.score,
        date: (await stateOf(store)).date,
        type,
      },
    }),
  );
  if (own.id === (await stateOf(store)).clubId)
    await news(
      store,
      "Loans",
      `${partner.name}: partnership agreed`,
      `${type} agreement signed. Relationship strength now influences loan acceptance, wage sharing and development guarantees.`,
      "success",
      "loans",
    );
}

export async function recallLoan(store: Store, id: number, injury = false) {
  const loan = await store.get<Loan>("SELECT * FROM loans WHERE id = ?", id);
  const state = await stateOf(store);
  if (!loan || loan.parent_id !== state.clubId || loan.status !== "active")
    throw new GameError("This active loan is not controlled by your club.");
  const terms = JSON.parse(loan.terms) as LoanTerms;
  const player = await playerOf(store, loan.player_id);
  if (injury && (!terms.injuryRecall || !player.injury_until))
    throw new GameError(
      "An injury recall requires an injury and the agreed clause.",
    );
  if (!injury && !terms.recall)
    throw new GameError("No standard recall clause was agreed.");
  if (!injury && !transferWindow(state.date))
    throw new GameError(
      "A standard recall must take place within a registration window.",
    );
  await store.run(
    "UPDATE loans SET status = 'recalled', relationship = GREATEST(0, relationship - 12) WHERE id = ?",
    id,
  );
  const details = JSON.parse(loan.data);
  await store.run(
    "UPDATE players SET club_id = parent_club_id, parent_club_id = NULL, role = ?, training = ? WHERE id = ?",
    details.parentRole ?? "Squad player",
    details.parentTraining ?? "Balanced",
    player.id,
  );
  await store.run(
    "UPDATE sell_on_clauses SET status = 'cancelled' WHERE source_loan_id = ? AND status = 'active'",
    loan.id,
  );
  await store.run(
    "UPDATE partnerships SET strength = GREATEST(0, strength - 8) WHERE club_id = ? AND partner_id = ?",
    loan.parent_id,
    loan.destination_id,
  );
  await news(
    store,
    "Loans",
    `${player.name} recalled`,
    injury
      ? "The player will complete injury rehabilitation at the parent club."
      : "The recall has ended the loan. The receiving club is unhappy with the disruption.",
    "important",
    "loans",
  );
}

export async function exerciseOption(
  store: Store,
  id: number,
  mandatory = false,
) {
  const loan = await store.get<Loan>("SELECT * FROM loans WHERE id = ?", id);
  if (!loan || loan.status !== "active")
    throw new GameError("Active loan not found.");
  if (!mandatory && loan.destination_id !== (await stateOf(store)).clubId)
    throw new GameError(
      "Only the borrowing club can exercise a purchase option.",
    );
  if (!["Loan with option", "Loan with obligation"].includes(loan.type))
    throw new GameError("This agreement has no purchase clause.");
  const terms = JSON.parse(loan.terms) as LoanTerms;
  const buyer = await clubOf(store, loan.destination_id);
  if (!mandatory && buyer.transfer_budget < terms.optionFee)
    throw new GameError("The purchase option exceeds the transfer budget.");
  await ledger(
    store,
    buyer.id,
    -terms.optionFee,
    "Transfer fees",
    `Loan ${mandatory ? "obligation" : "option"} exercised`,
  );
  await transferProceeds(
    store,
    loan.player_id,
    loan.parent_id,
    terms.optionFee,
    "Loan purchase clause",
  );
  await store.run(
    "UPDATE clubs SET transfer_budget = transfer_budget - ?, season_spend = season_spend + ? WHERE id = ?",
    terms.optionFee,
    terms.optionFee,
    buyer.id,
  );
  await acquirePlayerAsset(
    store,
    buyer.id,
    loan.player_id,
    terms.optionFee,
    (await stateOf(store)).date,
    `${(await stateOf(store)).season + 4}-06-30`,
  );
  await store.run(
    "UPDATE players SET parent_club_id = NULL, contract_end = ?, role = 'Regular starter' WHERE id = ?",
    `${(await stateOf(store)).season + 4}-06-30`,
    loan.player_id,
  );
  await store.run("UPDATE loans SET status = 'purchased' WHERE id = ?", id);
  if (
    [loan.parent_id, loan.destination_id].includes(
      (await stateOf(store)).clubId,
    )
  )
    await news(
      store,
      "Loans",
      "Purchase clause activated",
      `${(await playerOf(store, loan.player_id)).name} has joined ${buyer.name} permanently for ${money(terms.optionFee)}.`,
      "success",
      "loans",
    );
}

export async function reviewLoans(store: Store) {
  const state = await stateOf(store);
  for (const loan of await store.all<Loan>(
    "SELECT * FROM loans WHERE status = 'active' ORDER BY id",
  )) {
    const player = await playerOf(store, loan.player_id);
    const terms = JSON.parse(loan.terms) as LoanTerms;
    const data = JSON.parse(loan.data);
    const destination = await clubOf(store, loan.destination_id);
    const profile = JSON.parse(player.profile) as PlayerProfile;
    data.weeks = (data.weeks ?? 0) + 1;
    if (player.injury_until) data.injuryWeeks = (data.injuryWeeks ?? 0) + 1;
    const elapsed = Math.max(1, daysBetween(loan.start_date, state.date));
    const expected = Math.max(
      90,
      ((elapsed / 7) * 90 * terms.playingTime) / 100,
    );
    const positionUsage = (await store.get<{
      total: number;
      correct: number;
      minutes: number;
    }>(
      "SELECT count(*) AS total, coalesce(sum(CASE WHEN JSON_VALUE(data,'$.position') = ? THEN 1 ELSE 0 END),0) AS correct, coalesce(sum(TRY_CONVERT(float, JSON_VALUE(data,'$.minutes'))),0) AS minutes FROM history WHERE entity_type = 'appearance' AND entity_id = ? AND date >= ? AND TRY_CONVERT(int, JSON_VALUE(data,'$.clubId')) = ?",
      terms.position,
      player.id,
      loan.start_date,
      loan.destination_id,
    ))!;
    const minutes = positionUsage.total
      ? positionUsage.minutes
      : Math.max(0, player.minutes - data.startingMinutes);
    data.minutes = minutes;
    const factors = {
      minutes: clamp((minutes / expected) * 100, 0, 100),
      position: positionUsage.total
        ? (positionUsage.correct / positionUsage.total) * 100
        : 50,
      tacticalFit: tacticalFit(player, destination),
      development: clamp(
        50 + (player.ability - data.startingAbility) * 12,
        0,
        100,
      ),
      performance: clamp((player.form - 4) * 25, 0, 100),
      personality: clamp(
        50 +
          (profile.personality.professionalism - data.startingPersonality) * 5,
        0,
        100,
      ),
      lifestyle:
        profile.lifestyle === "nightlife"
          ? 35
          : profile.lifestyle === "luxury-obsessed"
            ? 55
            : 85,
      injury: Math.max(0, 100 - (data.injuryWeeks / data.weeks) * 100),
      environment: (destination.facilities + destination.chemistry) / 2,
      trust: destination.manager_trust,
      fans: destination.fan_mood,
    };
    const score = loanScore(factors);
    const pressure = clamp(
      (100 - factors.minutes) * 0.5 +
        (100 - factors.position) * 0.2 +
        (100 - score) * 0.3 +
        (terms.mandatoryMinutes > minutes && elapsed > 240 ? 15 : 0),
      0,
      100,
    );
    data.factors = factors;
    data.history = [
      ...(data.history ?? []),
      { date: state.date, score, minutes, pressure },
    ].slice(-104);
    if (score < 40 && elapsed > 28) {
      data.failures = (data.failures ?? 0) + 1;
      if (data.failures === 2) {
        profile.agent.frustration = clamp(
          profile.agent.frustration + 20,
          0,
          100,
        );
        profile.mentalHealth.confidence = clamp(
          profile.mentalHealth.confidence - 8,
          0,
          100,
        );
        await store.run(
          "UPDATE players SET morale = GREATEST(1, morale - 10), potential = GREATEST(ability, potential - 1.5), profile = ? WHERE id = ?",
          JSON.stringify(profile),
          player.id,
        );
        await store.run(
          "UPDATE clubs SET board_confidence = GREATEST(0, board_confidence - 3), fan_mood = GREATEST(0, fan_mood - 3) WHERE id = ?",
          loan.parent_id,
        );
        await store.run(
          "UPDATE partnerships SET strength = GREATEST(0, strength - 10) WHERE club_id = ? AND partner_id = ?",
          loan.parent_id,
          loan.destination_id,
        );
        await store.run(
          "UPDATE clubs SET data = JSON_MODIFY(data,'$.loanTrust',GREATEST(0,coalesce(TRY_CONVERT(float, JSON_VALUE(data,'$.loanTrust')),65) - 12)) WHERE id = ?",
          loan.parent_id,
        );
        loan.relationship = Math.max(0, loan.relationship - 15);
        if (loan.parent_id === state.clubId)
          await news(
            store,
            "Loans",
            `${player.name}: loan concern`,
            "Minutes, development or environment have fallen below the agreement. Confidence and potential have suffered; the agent and board want action.",
            "warning",
            "loans",
          );
      }
    } else if (score > 75) {
      await store.run(
        "UPDATE players SET morale = LEAST(99, morale + 1), loan_progress = loan_progress + 0.03, value = value * 1.003 WHERE id = ?",
        player.id,
      );
      if (data.weeks % 8 === 0) {
        profile.personality.adaptability = clamp(
          profile.personality.adaptability + 1,
        );
        profile.agent.frustration = Math.max(0, profile.agent.frustration - 5);
        await store.run(
          "UPDATE players SET profile = ? WHERE id = ?",
          JSON.stringify(profile),
          player.id,
        );
        if (loan.parent_id === state.clubId)
          await news(
            store,
            "Loans",
            `${player.name}: interest growing`,
            "Strong loan performances have attracted new scouting interest. The agent is discussing the next career step.",
            "success",
            "loans",
          );
      }
    }
    if (loan.type === "Cross-border loan" && data.weeks % 4 === 0) {
      profile.registration = {
        workPermitPoints: (
          await assessRegistration(
            store,
            player,
            await clubOf(store, loan.parent_id),
          )
        ).points,
        adaptedCountries: [
          ...new Set([
            ...(profile.registration?.adaptedCountries ?? []),
            destination.country_id,
          ]),
        ],
      };
      const language = (await store.get<{ language: string }>(
        "SELECT language FROM countries WHERE id = ?",
        destination.country_id,
      ))!.language;
      const existing = profile.identity.languages.find(
        (entry) => entry.language === language,
      );
      if (existing) existing.fluency = Math.min(5, existing.fluency + 1);
      else profile.identity.languages.push({ language, fluency: 1 });
      profile.personality.adaptability = clamp(
        profile.personality.adaptability + 1,
      );
      await store.run(
        "UPDATE players SET profile = ? WHERE id = ?",
        JSON.stringify(profile),
        player.id,
      );
    }
    if (
      !data.bonusPaid &&
      minutes >= terms.mandatoryMinutes &&
      terms.bonus > 0
    ) {
      await ledger(
        store,
        loan.parent_id,
        -terms.bonus,
        "Loan bonus",
        `${player.name}: development milestone`,
      );
      await ledger(
        store,
        loan.destination_id,
        terms.bonus,
        "Loan bonus",
        `${player.name}: minutes guarantee met`,
      );
      data.bonusPaid = true;
    }
    await store.run(
      "UPDATE loans SET score = ?, pressure = ?, fit = ?, relationship = ?, data = ? WHERE id = ?",
      score,
      pressure,
      factors.tacticalFit,
      loan.relationship,
      JSON.stringify(data),
      loan.id,
    );
    if (state.date >= loan.end_date) {
      const obligation =
        loan.type === "Loan with obligation" &&
        (terms.obligationCondition === "Unconditional" ||
          (terms.obligationCondition === "Minutes played" &&
            minutes >= terms.mandatoryMinutes) ||
          (terms.obligationCondition === "Avoid relegation" &&
            destination.crisis < 70));
      if (obligation) await exerciseOption(store, loan.id, true);
      else {
        await store.run(
          "UPDATE players SET club_id = parent_club_id, parent_club_id = NULL, role = ?, training = ? WHERE id = ?",
          data.parentRole ?? "Squad player",
          data.parentTraining ?? "Balanced",
          player.id,
        );
        await store.run(
          "UPDATE loans SET status = 'completed' WHERE id = ?",
          loan.id,
        );
        await store.run(
          "UPDATE partnerships SET strength = LEAST(100, GREATEST(0, strength + ?)) WHERE club_id = ? AND partner_id = ?",
          (score - 50) / 10,
          loan.parent_id,
          loan.destination_id,
        );
        if (loan.parent_id === state.clubId)
          await news(
            store,
            "Loans",
            `${player.name} returns`,
            `The loan concluded with a success score of ${score}/100 and ${minutes} minutes played.`,
            score > 65 ? "success" : "important",
            "loans",
          );
      }
    }
  }
}

export async function expireLoans(store: Store) {
  const state = await stateOf(store);
  for (const loan of await store.all<Loan>(
    "SELECT * FROM loans WHERE status = 'active' AND end_date <= ? ORDER BY id",
    state.date,
  )) {
    const terms = JSON.parse(loan.terms) as LoanTerms;
    const details = JSON.parse(loan.data);
    const minutes = (await store.get<{ total: number }>(
      "SELECT coalesce(sum(TRY_CONVERT(float, JSON_VALUE(data,'$.minutes'))),0) AS total FROM history WHERE entity_type = 'appearance' AND entity_id = ? AND date >= ? AND TRY_CONVERT(int, JSON_VALUE(data,'$.clubId')) = ?",
      loan.player_id,
      loan.start_date,
      loan.destination_id,
    ))!.total;
    const obligation =
      loan.type === "Loan with obligation" &&
      (terms.obligationCondition === "Unconditional" ||
        (terms.obligationCondition === "Minutes played" &&
          minutes >= terms.mandatoryMinutes) ||
        (terms.obligationCondition === "Avoid relegation" &&
          (await clubOf(store, loan.destination_id)).crisis < 70));
    if (obligation) await exerciseOption(store, loan.id, true);
    else {
      await store.run(
        "UPDATE players SET club_id = parent_club_id, parent_club_id = NULL, role = ?, training = ? WHERE id = ?",
        details.parentRole ?? "Squad player",
        details.parentTraining ?? "Balanced",
        loan.player_id,
      );
      await store.run(
        "UPDATE loans SET status = 'completed' WHERE id = ?",
        loan.id,
      );
      if (loan.parent_id === state.clubId)
        await news(
          store,
          "Loans",
          `${(await playerOf(store, loan.player_id)).name} returns`,
          `The agreement has expired. The player returns with a loan success score of ${Math.round(loan.score)}.`,
          "info",
          "loans",
        );
    }
  }
}

export async function mentorPlayer(
  store: Store,
  playerId: number,
  mentorId: number,
) {
  const player = await requireOwnPlayer(store, playerId);
  const mentor = await requireOwnPlayer(store, mentorId);
  if (
    player.id === mentor.id ||
    mentor.age <= player.age ||
    player.club_id !== mentor.club_id
  )
    throw new GameError(
      "A mentor must be older and currently at the same club.",
    );
  const profile = JSON.parse(player.profile) as PlayerProfile;
  let cursor: number | null = mentor.id;
  const seen = new Set([player.id]);
  while (cursor) {
    if (seen.has(cursor))
      throw new GameError("This pairing would create a mentorship cycle.");
    seen.add(cursor);
    const current: Player | undefined = await store.get<Player>(
      "SELECT * FROM players WHERE id = ?",
      cursor,
    );
    cursor = current
      ? (JSON.parse(current.profile) as PlayerProfile).development.mentorId
      : null;
  }
  profile.development.mentorId = mentor.id;
  await store.run(
    "UPDATE players SET profile = ? WHERE id = ?",
    JSON.stringify(profile),
    player.id,
  );
  await store.run(
    "MERGE relationships WITH (HOLDLOCK) AS target USING (VALUES (?, 'player', ?, 'player', ?, 65, 'Mentorship')) AS source(club_id,source_type,source_id,target_type,target_id,strength,kind) ON target.source_type = source.source_type AND target.source_id = source.source_id AND target.target_type = source.target_type AND target.target_id = source.target_id WHEN MATCHED THEN UPDATE SET strength = 65,kind = 'Mentorship' WHEN NOT MATCHED THEN INSERT (club_id,source_type,source_id,target_type,target_id,strength,kind) VALUES (source.club_id,source.source_type,source.source_id,source.target_type,source.target_id,source.strength,source.kind);",
    (await stateOf(store)).clubId,
    mentor.id,
    player.id,
  );
  await experience(store, 5);
}

export async function squadRole(store: Store, playerId: number, role: string) {
  const player = await requireOwnPlayer(store, playerId);
  if (!(await clubSquads(store)).some((club) => club.id === player.club_id))
    throw new GameError("The loan agreement controls this player's role.");
  if (role === "Captain")
    await store.run(
      "UPDATE players SET role = 'Regular starter' WHERE coalesce(squad_club_id,club_id) = ? AND age_group = ? AND role = 'Captain'",
      player.squad_club_id ?? player.club_id,
      player.age_group,
    );
  const profile = JSON.parse(player.profile) as PlayerProfile;
  const demotion =
    ["Fringe player", "Squad player"].includes(role) &&
    ["Key player", "Captain", "Regular starter"].includes(player.role);
  await store.run(
    "UPDATE players SET role = ?, morale = GREATEST(1, LEAST(99, morale + ?)) WHERE id = ?",
    role,
    demotion ? -5 - profile.personality.ego / 20 : 2,
    player.id,
  );
}

export async function promoteYouth(store: Store, playerId: number) {
  const player = await requireOwnPlayer(store, playerId);
  if (player.age_group === "Senior")
    throw new GameError("This player is already in the senior squad.");
  return await movePlayerSquad(
    store,
    player.id,
    (await stateOf(store)).clubId,
    "Senior",
  );
}

export async function staffAction(
  store: Store,
  id: number,
  action: "hire" | "release" | "mediate" | "develop",
) {
  const staff = await store.get<Staff>("SELECT * FROM staff WHERE id = ?", id);
  const club = await clubOf(store);
  if (!staff) throw new GameError("Staff member not found.");
  if (action === "hire") {
    if (staff.club_id)
      throw new GameError("This staff member is not available.");
    if (
      staff.role === ASSISTANT_ROLE &&
      (await store.get(
        "SELECT id FROM staff WHERE club_id = ? AND role = ?",
        club.id,
        ASSISTANT_ROLE,
      ))
    )
      throw new GameError(
        "Your club already employs a sporting director assistant. Release the current assistant before appointing a replacement.",
      );
    const fee = staff.wage * 12;
    if (club.balance < fee)
      throw new GameError("Insufficient funds for the signing fee.");
    await ledger(store, club.id, -fee, "Staff", `Signing ${staff.name}`);
    await store.run(
      "UPDATE staff SET club_id = ?, morale = 80 WHERE id = ?",
      club.id,
      id,
    );
    const peer = await store.get<Staff>(
      "SELECT TOP (1) * FROM staff WHERE club_id = ? AND id != ? ORDER BY influence DESC,id",
      club.id,
      id,
    );
    if (peer)
      await store.run(
        "MERGE relationships WITH (HOLDLOCK) AS target USING (VALUES (?, 'staff', ?, 'staff', ?, ?, ?)) AS source(club_id,source_type,source_id,target_type,target_id,strength,kind) ON target.source_type = source.source_type AND target.source_id = source.source_id AND target.target_type = source.target_type AND target.target_id = source.target_id WHEN NOT MATCHED THEN INSERT (club_id,source_type,source_id,target_type,target_id,strength,kind) VALUES (source.club_id,source.source_type,source.source_id,source.target_type,source.target_id,source.strength,source.kind);",
        club.id,
        id,
        peer.id,
        staff.personality === peer.personality
          ? 65
          : staff.ambition > 75 && peer.ambition > 75
            ? -40
            : 30,
        staff.ambition > 75 && peer.ambition > 75 ? "Rivalry" : "Alliance",
      );
  } else {
    if (staff.club_id !== club.id)
      throw new GameError("This staff member is not employed by your club.");
    if (action === "release") {
      const cost = staff.wage * 26;
      if (club.balance < cost)
        throw new GameError("The club cannot cover this severance payment.");
      await ledger(store, club.id, -cost, "Staff", `Severance: ${staff.name}`);
      await store.run("UPDATE staff SET club_id = NULL WHERE id = ?", id);
      await store.run(
        "UPDATE assignments SET status = 'cancelled' WHERE staff_id = ? AND status = 'active'",
        id,
      );
    } else if (action === "mediate") {
      await store.run(
        "UPDATE relationships SET strength = LEAST(99, strength + 18), kind = CASE WHEN strength + 18 > 0 THEN 'Professional' ELSE kind END WHERE club_id = ? AND (source_id = ? OR target_id = ?) AND source_type = 'staff'",
        club.id,
        id,
        id,
      );
      await store.run(
        "UPDATE staff SET morale = LEAST(99, morale + 6) WHERE id = ?",
        id,
      );
      await store.run(
        "UPDATE clubs SET chemistry = LEAST(99, chemistry + 1) WHERE id = ?",
        club.id,
      );
      await experience(store, 7);
    } else {
      if (club.balance < 50000)
        throw new GameError("Insufficient funds for professional development.");
      await ledger(
        store,
        club.id,
        -50000,
        "Staff development",
        `${staff.name}: development course`,
      );
      await store.run(
        "UPDATE staff SET ability = LEAST(99, ability + 1), communication = LEAST(99, communication + 1), tactical_knowledge = LEAST(99, tactical_knowledge + 1) WHERE id = ?",
        id,
      );
    }
  }
  return {
    message:
      action === "hire"
        ? `${staff.name} has joined the club.`
        : action === "release"
          ? `${staff.name} has left the club.`
          : action === "mediate"
            ? "The conversation has eased tensions."
            : "Professional development completed.",
  };
}

export async function mediaResponse(store: Store, approach: string) {
  const state = await stateOf(store);
  const last = await store.get<{ value: string }>(
    "SELECT value FROM meta WHERE [key] = ?",
    "lastMediaResponse",
  );
  if (last && JSON.parse(last.value) === state.date)
    throw new GameError("You have already addressed the media today.");
  const choices: Record<
    string,
    {
      fan: number;
      board: number;
      morale: number;
      pressure: number;
      title: string;
    }
  > = {
    measured: {
      fan: 1,
      board: 2,
      morale: 2,
      pressure: -3,
      title: "A measured message from the director",
    },
    ambitious: {
      fan: 5,
      board: 1,
      morale: 1,
      pressure: 7,
      title: "Director sets ambitious targets",
    },
    protect: {
      fan: -1,
      board: -1,
      morale: 6,
      pressure: -5,
      title: "Director shields the dressing room",
    },
    challenge: {
      fan: 2,
      board: 3,
      morale: -5,
      pressure: 5,
      title: "Standards must improve, says director",
    },
  };
  const choice = choices[approach];
  if (!choice) throw new GameError("Unknown media approach.");
  const media = Number((await settingsOf(store)).mediaPressure) / 50;
  await store.run(
    "UPDATE clubs SET fan_mood = LEAST(100,GREATEST(0,fan_mood + ?)), board_confidence = LEAST(100,GREATEST(0,board_confidence + ?)), board_pressure = LEAST(100,GREATEST(0,board_pressure + ?)) WHERE id = ?",
    choice.fan * media,
    choice.board,
    choice.pressure * media,
    state.clubId,
  );
  await store.run(
    "UPDATE players SET morale = LEAST(99,GREATEST(1,morale + ?)) WHERE club_id = ?",
    choice.morale * media,
    state.clubId,
  );
  const quote = {
    measured:
      "Our decisions are guided by a clear plan. We will judge progress over time.",
    ambitious:
      "This club should aim higher. We intend to compete at the next level.",
    protect:
      "The players and staff have our full support. Responsibility starts with me.",
    challenge:
      "We expect more. Everyone at this club must be accountable for improvement.",
  }[approach]!;
  await publishPressReaction(store, approach, choice.title, quote);
  await store.setMeta("lastMediaResponse", state.date);
  await experience(store, 5);
}

export function relationshipMatrix(players: Player[]) {
  return players.map((source) => {
    const sourceProfile = JSON.parse(source.profile) as PlayerProfile;
    return {
      id: source.id,
      name: source.name,
      group: sourceProfile.relationships.group,
      connections: players
        .filter((target) => target.id !== source.id)
        .map((target) => {
          const targetProfile = JSON.parse(target.profile) as PlayerProfile;
          const shared = sourceProfile.identity.languages.some((language) =>
            targetProfile.identity.languages.some(
              (other) =>
                other.language === language.language && other.fluency >= 3,
            ),
          );
          const mentor =
            sourceProfile.development.mentorId === target.id ||
            targetProfile.development.mentorId === source.id;
          const chemistry = clamp(
            50 +
              (shared ? 12 : -10) +
              (sourceProfile.relationships.group ===
              targetProfile.relationships.group
                ? 12
                : 0) +
              (mentor ? 20 : 0) -
              Math.abs(
                sourceProfile.personality.professionalism -
                  targetProfile.personality.professionalism,
              ) /
                4 -
              (sourceProfile.personality.ego > 75 &&
              targetProfile.personality.ego > 75
                ? 20
                : 0),
            0,
            100,
          );
          return {
            id: target.id,
            strength: Math.round(chemistry),
            kind: mentor
              ? "Mentorship"
              : chemistry < 35
                ? "Friction"
                : chemistry > 70
                  ? "Alliance"
                  : "Professional",
          };
        }),
    };
  });
}
