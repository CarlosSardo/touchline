import seedrandom from "seedrandom";
import { Store } from "./db.ts";
import {
  addDays,
  clamp,
  daysBetween,
  label,
  loanScore,
  LOAN_TYPES,
  money,
  PARTNERSHIP_TYPES,
  tacticalFit,
  transferWindow,
} from "../shared/rules.ts";
import type {
  Club,
  GameState,
  Loan,
  LoanTerms,
  Negotiation,
  NegotiationData,
  Player,
  PlayerProfile,
  Settings,
  Staff,
} from "../shared/types.ts";

export class GameError extends Error {
  status = 400;
}

export const stateOf = (store: Store) => store.meta<GameState>("state");
export const settingsOf = (store: Store) => store.meta<Settings>("settings");
export function clubOf(store: Store, id?: number) {
  const club = store.get<Club>(
    "SELECT * FROM clubs WHERE id = ?",
    id ?? stateOf(store).clubId,
  );
  if (!club) throw new GameError("Club not found.");
  return club;
}
export function playerOf(store: Store, id: number) {
  const player = store.get<Player>("SELECT * FROM players WHERE id = ?", id);
  if (!player) throw new GameError("Player not found.");
  return player;
}
export function requireOwnPlayer(store: Store, id: number) {
  const player = playerOf(store, id);
  if (
    player.club_id !== stateOf(store).clubId &&
    player.parent_club_id !== stateOf(store).clubId
  )
    throw new GameError("This player is not contracted to your club.");
  return player;
}
export function news(
  store: Store,
  category: string,
  title: string,
  body: string,
  severity = "info",
  action: string | null = null,
  data: unknown = {},
) {
  return Number(
    store.run(
      "INSERT INTO news(date, category, title, body, severity, action, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
      stateOf(store).date,
      category,
      title,
      body,
      severity,
      action,
      JSON.stringify(data),
    ).lastInsertRowid,
  );
}
export function ledger(
  store: Store,
  clubId: number,
  amount: number,
  category: string,
  description: string,
) {
  store.run(
    "UPDATE clubs SET balance = balance + ?, income = income + ?, spending = spending + ? WHERE id = ?",
    amount,
    Math.max(0, amount),
    Math.max(0, -amount),
    clubId,
  );
  store.run(
    "INSERT INTO ledger(club_id, date, category, amount, description) VALUES (?, ?, ?, ?, ?)",
    clubId,
    stateOf(store).date,
    category,
    amount,
    description,
  );
}
export function weeklyWages(store: Store, clubId: number) {
  const salaries = store.get<{ total: number }>(
    "SELECT coalesce(sum(wage),0) AS total FROM players WHERE club_id = ?",
    clubId,
  )!.total;
  const adjustments = store.get<{ total: number }>(
    `SELECT coalesce(sum(CASE WHEN loans.parent_id = ? THEN players.wage * (1 - json_extract(loans.terms,'$.salarySplit') / 100.0) ELSE -players.wage * (1 - json_extract(loans.terms,'$.salarySplit') / 100.0) END),0) AS total FROM loans JOIN players ON players.id = loans.player_id WHERE loans.status = 'active' AND (loans.parent_id = ? OR loans.destination_id = ?)`,
    clubId,
    clubId,
    clubId,
  )!.total;
  return salaries + adjustments;
}

export function transferProceeds(
  store: Store,
  playerId: number,
  sellerId: number,
  fee: number,
  description: string,
) {
  let proceeds = fee;
  for (const clause of store.all<{
    id: number;
    beneficiary_id: number;
    percentage: number;
  }>(
    "SELECT * FROM sell_on_clauses WHERE player_id = ? AND owner_id = ? AND status = 'active'",
    playerId,
    sellerId,
  )) {
    const payment = Math.min(
      proceeds,
      Math.round((fee * clause.percentage) / 100),
    );
    proceeds -= payment;
    ledger(
      store,
      clause.beneficiary_id,
      payment,
      "Sell-on income",
      description,
    );
    store.run(
      "UPDATE clubs SET transfer_budget = transfer_budget + ? WHERE id = ?",
      payment * 0.85,
      clause.beneficiary_id,
    );
    store.run(
      "UPDATE sell_on_clauses SET status = 'paid', paid = ? WHERE id = ?",
      payment,
      clause.id,
    );
    if (clause.beneficiary_id === stateOf(store).clubId)
      news(
        store,
        "Loans",
        "Development sell-on payment received",
        `${playerOf(store, playerId).name}'s transfer has triggered a ${money(payment)} payment from an earlier loan agreement.`,
        "success",
        "finances",
      );
  }
  ledger(store, sellerId, proceeds, "Player sales", description);
  store.run(
    "UPDATE clubs SET transfer_budget = transfer_budget + ? WHERE id = ?",
    proceeds * 0.85,
    sellerId,
  );
  return proceeds;
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

export function experience(store: Store, amount: number, reputation = 0) {
  const state = stateOf(store);
  const settings = settingsOf(store);
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
  store.setMeta("state", state);
}

export function initialInbox(store: Store) {
  if (store.get("SELECT key FROM meta WHERE key = ?", "inboxInitialized"))
    return;
  const club = clubOf(store);
  const scout = store.get<Staff>(
    "SELECT * FROM staff WHERE club_id = ? AND role = 'Scout' LIMIT 1",
    club.id,
  )!;
  const prospects = store.all<Player>(
    "SELECT * FROM players WHERE club_id != ? AND age BETWEEN 18 AND 23 AND ability BETWEEN 65 AND 77 AND potential >= 82 ORDER BY potential DESC, value ASC LIMIT 5",
    club.id,
  );
  for (const player of prospects) {
    store.run("UPDATE players SET shortlisted = 1 WHERE id = ?", player.id);
    createReport(store, player, scout);
  }
  news(
    store,
    "Board",
    "Your summer mandate",
    `Welcome to ${club.name}. The board expects a top-${club.expectations} finish, sustainable recruitment and a clear academy pathway. Your transfer budget is ${money(club.transfer_budget)}.`,
    "important",
    "board",
  );
  news(
    store,
    "Scouting",
    "The first shortlist is on your desk",
    `${scout.name} has prepared ${prospects.length} initial reports. There are still unknowns around personality, adaptation and development.`,
    "info",
    "scouting",
  );
  news(
    store,
    "Squad",
    "Pre-season starts here",
    `${club.manager} has requested a squad review before the first friendly. Agree roles, identify succession needs and set the training emphasis.`,
    "info",
    "squad",
  );
  news(
    store,
    "Academy",
    "A pathway, not just potential",
    "Your head of youth is ready to pair academy prospects with senior mentors. U17 and U19 competition calendars are confirmed.",
    "info",
    "academy",
  );
  store.setMeta("inboxInitialized", true);
}

export function createReport(store: Store, player: Player, scout: Staff) {
  const state = stateOf(store);
  const club = clubOf(store);
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
  store.run(
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
  store.run(
    "UPDATE players SET knowledge = max(knowledge, ?) WHERE id = ?",
    accuracy,
    player.id,
  );
}

export function assignScout(
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
  const state = stateOf(store);
  const scout = store.get<Staff>(
    "SELECT * FROM staff WHERE id = ? AND club_id = ? AND role = 'Scout'",
    input.staffId,
    state.clubId,
  );
  if (!scout) throw new GameError("Choose a scout employed by your club.");
  if (
    store.get(
      "SELECT id FROM assignments WHERE staff_id = ? AND status = ?",
      scout.id,
      "active",
    )
  )
    throw new GameError("This scout already has an active assignment.");
  if (input.playerId) playerOf(store, input.playerId);
  const due = addDays(
    state.date,
    input.playerId ? 3 + Math.round((100 - scout.ability) / 20) : 7,
  );
  store.run(
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
  ledger(
    store,
    state.clubId,
    -2500,
    "Scouting",
    `${scout.name}: recruitment assignment`,
  );
  return { message: `${scout.name} will report on ${due}.` };
}

export function finishScouting(store: Store) {
  const state = stateOf(store);
  const assignments = store.all<{
    id: number;
    staff_id: number;
    player_id: number | null;
    country_id: number | null;
    position: string | null;
    max_age: number;
    budget: number;
  }>(
    "SELECT * FROM assignments WHERE status = ? AND due_date <= ?",
    "active",
    state.date,
  );
  for (const assignment of assignments) {
    const scout = store.get<Staff>(
      "SELECT * FROM staff WHERE id = ?",
      assignment.staff_id,
    )!;
    const players = assignment.player_id
      ? [playerOf(store, assignment.player_id)]
      : store.all<Player>(
          `SELECT * FROM players WHERE club_id != ? AND age <= ? AND value <= ? ${assignment.country_id ? "AND country_id = ?" : ""} ${assignment.position ? "AND position = ?" : ""} ORDER BY potential - ability + potential / 4 DESC LIMIT 5`,
          state.clubId,
          assignment.max_age,
          assignment.budget,
          ...(assignment.country_id ? [assignment.country_id] : []),
          ...(assignment.position ? [assignment.position] : []),
        );
    for (const player of players) createReport(store, player, scout);
    store.run(
      "UPDATE assignments SET status = 'complete' WHERE id = ?",
      assignment.id,
    );
    news(
      store,
      "Scouting",
      `${scout.name}: assignment complete`,
      `${players.length} detailed reports are ready, including tactical fit, personality observations and risk assessment.`,
      "success",
      "scouting",
    );
    experience(store, 8);
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

export function enquire(
  store: Store,
  playerId: number,
  type: string,
  destinationId?: number,
) {
  const state = stateOf(store);
  const player = playerOf(store, playerId);
  if (player.role === "Retired")
    throw new GameError("This player has retired.");
  if (player.parent_club_id)
    throw new GameError(
      "The player is already on loan. Resolve that agreement first.",
    );
  const buyingClub = clubOf(store, destinationId ?? state.clubId);
  const sellingClub = player.club_id ? clubOf(store, player.club_id) : null;
  if (destinationId && player.club_id !== state.clubId)
    throw new GameError("You can only offer your own players to another club.");
  if (buyingClub.type !== "club")
    throw new GameError("Choose a senior club for negotiations.");
  const renewal = type === "Contract renewal";
  if (!renewal && buyingClub.id === player.club_id)
    throw new GameError("Use a contract renewal for your own player.");
  if (renewal && player.club_id !== state.clubId)
    throw new GameError("You cannot renew another club's player.");
  const existing = store.get<Negotiation>(
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
  if (
    !renewal &&
    sellingClub &&
    sellingClub.country_id !== buyingClub.country_id &&
    player.age < 18
  )
    throw new GameError(
      "International transfers and loans of minors require an exemption; none is available for this player.",
    );
  if (
    type === "Cross-border loan" &&
    sellingClub?.country_id === buyingClub.country_id
  )
    throw new GameError("A cross-border loan needs a club in another country.");
  if (type === "Emergency loan") {
    const injuries = store.get<{ count: number }>(
      "SELECT count(*) AS count FROM players WHERE club_id = ? AND injury_until > ?",
      buyingClub.id,
      state.date,
    )!.count;
    if (injuries < 3)
      throw new GameError(
        "An emergency loan requires at least three unavailable senior players at the receiving club.",
      );
  }
  const profile = JSON.parse(player.profile) as PlayerProfile;
  const partnership = sellingClub
    ? store.get<{ strength: number }>(
        "SELECT strength FROM partnerships WHERE (club_id = ? AND partner_id = ?) OR (club_id = ? AND partner_id = ?)",
        buyingClub.id,
        sellingClub.id,
        sellingClub.id,
        buyingClub.id,
      )
    : null;
  const interest = clamp(
    67 +
      (buyingClub.reputation - (sellingClub?.reputation ?? 50)) * 0.95 +
      (loan && player.age < 24 ? 15 : 0) +
      (partnership?.strength ?? 0) / 10 +
      (tacticalFit(player, buyingClub) - 75) / 3 -
      (profile.personality.ambition > 75 && buyingClub.reputation < 65
        ? 18
        : 0),
    5,
    98,
  );
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
  const asking = renewal
    ? 0
    : loan
      ? terms.fee
      : Math.round(
          player.value *
            (sellingClub?.balance && sellingClub.balance < 0 ? 0.85 : 1.1),
        );
  const data: NegotiationData = {
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
    store.run(
      "INSERT INTO negotiations(player_id, buying_club_id, selling_club_id, type, stage, asking_price, wage, interest, created, deadline, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      player.id,
      buyingClub.id,
      player.club_id,
      type,
      renewal ? "Agent talks" : "Club talks",
      asking,
      expectedWage(player),
      interest,
      state.date,
      addDays(state.date, 14),
      JSON.stringify(data),
    ).lastInsertRowid,
  );
  return store.get<Negotiation>("SELECT * FROM negotiations WHERE id = ?", id)!;
}

export function declareInterest(store: Store, id: number) {
  const negotiation = store.get<Negotiation>(
    "SELECT * FROM negotiations WHERE id = ?",
    id,
  );
  if (!negotiation) throw new GameError("Negotiation not found.");
  if (negotiation.public) throw new GameError("Interest is already public.");
  if (!["Club talks", "Agent talks"].includes(negotiation.stage))
    throw new GameError("This negotiation is no longer open.");
  const data = JSON.parse(negotiation.data) as NegotiationData;
  data.log.push({
    date: stateOf(store).date,
    message:
      "Interest was made public. The agent welcomes the attention; the selling club has raised its valuation.",
    type: "Media",
  });
  data.declared = true;
  store.run(
    "UPDATE negotiations SET public = 1, tension = min(100, tension + 12), interest = min(100, interest + 8), asking_price = asking_price * 1.08, data = ? WHERE id = ?",
    JSON.stringify(data),
    id,
  );
  const player = playerOf(store, negotiation.player_id);
  news(
    store,
    "Media",
    `Public interest in ${player.name}`,
    "The declaration has increased attention from supporters and competing clubs. Expectations have risen.",
    "important",
    "transfers",
  );
  store.run(
    "UPDATE clubs SET fan_mood = min(100, fan_mood + 2) WHERE id = ?",
    stateOf(store).clubId,
  );
}

export function negotiate(
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
  },
) {
  const negotiation = store.get<Negotiation>(
    "SELECT * FROM negotiations WHERE id = ?",
    id,
  );
  if (!negotiation) throw new GameError("Negotiation not found.");
  const state = stateOf(store);
  const settings = settingsOf(store);
  if (
    negotiation.buying_club_id !== state.clubId &&
    negotiation.selling_club_id !== state.clubId
  )
    throw new GameError("You are not involved in this negotiation.");
  if (!["Club talks", "Agent talks"].includes(negotiation.stage))
    throw new GameError("This negotiation is not awaiting an offer.");
  if (state.date > negotiation.deadline)
    throw new GameError("The negotiation deadline has passed.");
  const player = playerOf(store, negotiation.player_id);
  const buyer = clubOf(store, negotiation.buying_club_id);
  const data = JSON.parse(negotiation.data) as NegotiationData;
  const loan = LOAN_TYPES.includes(negotiation.type);
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
    input.fee + (input.signingBonus ?? 0) > buyer.transfer_budget &&
    negotiation.type !== "Contract renewal"
  )
    throw new GameError(
      "The total upfront commitment exceeds the buying club's transfer budget.",
    );
  if (input.terms) data.terms = input.terms;
  if (
    loan &&
    loanEndDate(negotiation.type, state.date, data.terms.duration) >
      player.contract_end
  )
    throw new GameError("The proposed loan outlasts the parent contract.");
  const actualRelationship = negotiation.selling_club_id
    ? (store.get<{ strength: number }>(
        "SELECT strength FROM partnerships WHERE (club_id = ? AND partner_id = ?) OR (club_id = ? AND partner_id = ?)",
        buyer.id,
        negotiation.selling_club_id,
        negotiation.selling_club_id,
        buyer.id,
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
      store.run(
        "UPDATE negotiations SET asking_price = ? WHERE id = ?",
        data.counter,
        id,
      );
      message = `Offer rejected. The club counters at ${money(data.counter)}.`;
    }
  } else {
    const wageFactor = loan
      ? 1
      : 1.1 +
        ((data.agent.difficulty / 500) * Number(settings.agentIntensity)) / 60 +
        difficulty -
        skill;
    const requiredWage = Math.round(expectedWage(player) * wageFactor);
    data.requiredWage = requiredWage;
    const currentWages = weeklyWages(store, buyer.id);
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
    if (input.wage >= requiredWage || (loan && input.wage >= player.wage)) {
      stage = "Medical";
      data.medicalDate = addDays(state.date, 2);
      data.years = input.years;
      data.role = input.role;
      data.promises = input.promises;
      data.signingBonus = input.signingBonus ?? 0;
      message = `Personal terms agreed. Medical and registration checks are scheduled for ${data.medicalDate}. Promises will be monitored.`;
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
  store.run(
    "UPDATE negotiations SET stage = ?, tension = ?, offer = ?, wage = ?, data = ? WHERE id = ?",
    stage,
    clamp(tension, 0, 100),
    fee,
    input.wage,
    JSON.stringify(data),
    id,
  );
  return { message, stage };
}

export function completeNegotiation(store: Store, negotiation: Negotiation) {
  const state = stateOf(store);
  const player = playerOf(store, negotiation.player_id);
  const buyer = clubOf(store, negotiation.buying_club_id);
  const data = JSON.parse(negotiation.data) as NegotiationData;
  const loan = LOAN_TYPES.includes(negotiation.type);
  const renewal = negotiation.type === "Contract renewal";
  const currentStage = store.get<{ stage: string }>(
    "SELECT stage FROM negotiations WHERE id = ?",
    negotiation.id,
  )?.stage;
  if (currentStage !== "Medical")
    throw new GameError(
      "The agreement is not awaiting registration; registration has changed or already completed.",
    );
  if (data.medicalDate && state.date < data.medicalDate) return;
  if (player.club_id !== negotiation.selling_club_id || player.parent_club_id)
    throw new GameError(
      "The player's registration has changed; this agreement cannot complete.",
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
    store.run(
      "UPDATE negotiations SET stage = 'Rejected' WHERE id = ?",
      negotiation.id,
    );
    news(
      store,
      "Transfers",
      `${player.name}: medical concern`,
      "A significant injury was identified. The deal has not completed and no transfer funds were spent.",
      "warning",
      "transfers",
    );
    return;
  }
  const buyerCountry = store.get<{ code: string }>(
    "SELECT code FROM countries WHERE id = ?",
    buyer.country_id,
  )!;
  const playerProfile = JSON.parse(player.profile) as PlayerProfile;
  if (
    !loan &&
    !renewal &&
    buyerCountry.code === "EN" &&
    player.country_id !== buyer.country_id &&
    player.ability < 62 &&
    player.appearances < 10 &&
    (playerProfile.registration?.workPermitPoints ?? 0) < 15
  ) {
    store.run(
      "UPDATE negotiations SET stage = 'Rejected' WHERE id = ?",
      negotiation.id,
    );
    news(
      store,
      "Transfers",
      `${player.name}: registration denied`,
      "The player did not meet the simulated work-permit points threshold. A qualifying overseas development loan may create a future route.",
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
  const total = negotiation.offer + (data.signingBonus ?? 0) + agentFee;
  if (total > buyer.transfer_budget) {
    store.run(
      "UPDATE negotiations SET stage = 'Rejected' WHERE id = ?",
      negotiation.id,
    );
    news(
      store,
      "Transfers",
      "Funding no longer available",
      `${player.name}'s deal could not be registered because the transfer budget changed before completion.`,
      "warning",
      "transfers",
    );
    return;
  }
  if (settingsOf(store).ffp && buyer.ffp > 100_000_000 && !renewal) {
    store.run(
      "UPDATE negotiations SET stage = 'Rejected' WHERE id = ?",
      negotiation.id,
    );
    news(
      store,
      "Finance",
      "Registration embargo",
      "The financial sustainability deficit has blocked a new registration.",
      "warning",
      "finances",
    );
    return;
  }
  const addedWage = loan
    ? (player.wage * data.terms.salarySplit) / 100
    : negotiation.wage;
  if (
    weeklyWages(store, buyer.id) - (renewal ? player.wage : 0) + addedWage >
    buyer.wage_budget
  ) {
    store.run(
      "UPDATE negotiations SET stage = 'Rejected' WHERE id = ?",
      negotiation.id,
    );
    news(
      store,
      "Transfers",
      "Wage allocation changed",
      `${player.name}'s agreement could not be registered because the club can no longer support the wage commitment.`,
      "warning",
      "finances",
    );
    return;
  }
  ledger(
    store,
    buyer.id,
    -(total - agentFee),
    loan ? "Loan fees" : renewal ? "Contract bonus" : "Transfer fees",
    `${player.name}: ${negotiation.type.toLowerCase()}`,
  );
  ledger(
    store,
    buyer.id,
    -agentFee,
    "Agent fees",
    `${player.name}: representation commission`,
  );
  store.run(
    "UPDATE clubs SET transfer_budget = transfer_budget - ?, season_spend = season_spend + ? WHERE id = ?",
    total,
    total,
    buyer.id,
  );
  if (negotiation.selling_club_id && !renewal) {
    if (loan) {
      ledger(
        store,
        negotiation.selling_club_id,
        negotiation.offer,
        "Loan income",
        `${player.name}: agreement completed`,
      );
      store.run(
        "UPDATE clubs SET transfer_budget = transfer_budget + ? WHERE id = ?",
        negotiation.offer * 0.85,
        negotiation.selling_club_id,
      );
    } else
      transferProceeds(
        store,
        player.id,
        negotiation.selling_club_id,
        negotiation.offer,
        `${player.name}: agreement completed`,
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
      store.run(
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
      ).lastInsertRowid,
    );
    store.run(
      "UPDATE players SET parent_club_id = club_id, club_id = ?, role = ?, training = ?, morale = min(99, morale + 3), loan_progress = 0 WHERE id = ?",
      buyer.id,
      terms.role,
      terms.developmentPlan,
      player.id,
    );
    if (negotiation.type === "Loan with sell-on" && terms.sellOn > 0)
      store.run(
        "INSERT INTO sell_on_clauses(player_id, beneficiary_id, owner_id, percentage, source_loan_id) VALUES (?, ?, ?, ?, ?)",
        player.id,
        buyer.id,
        negotiation.selling_club_id,
        terms.sellOn,
        loanId,
      );
  } else {
    store.run(
      "UPDATE players SET club_id = ?, parent_club_id = NULL, wage = ?, contract_end = ?, role = ?, listed = 0, available_loan = 0, morale = min(99, morale + 7) WHERE id = ?",
      buyer.id,
      negotiation.wage,
      `${Number(state.date.slice(0, 4)) + data.years}-06-30`,
      data.role,
      player.id,
    );
  }
  for (const promise of data.promises)
    store.run(
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
  store.run(
    "UPDATE negotiations SET stage = 'Completed' WHERE id = ?",
    negotiation.id,
  );
  if (negotiation.selling_club_id !== buyer.id)
    store.run(
      "UPDATE clubs SET chemistry = max(0, chemistry - 1.5) WHERE id = ?",
      buyer.id,
    );
  if (
    negotiation.buying_club_id === state.clubId ||
    negotiation.selling_club_id === state.clubId
  ) {
    news(
      store,
      "Transfers",
      `${player.name}: deal completed`,
      `${negotiation.type} agreed with ${buyer.name}. ${loan ? "The loan guarantees and development plan are now being monitored." : "The contract, wage and promises are registered."}`,
      "success",
      loan ? "loans" : "squad",
      { playerId: player.id },
    );
    experience(store, 25, 0.4);
  }
}

export function createPartnership(
  store: Store,
  partnerId: number,
  type: string,
) {
  const own = clubOf(store);
  const partner = clubOf(store, partnerId);
  if (partner.id === own.id || partner.type !== "club")
    throw new GameError("Choose another senior club.");
  if (!PARTNERSHIP_TYPES.includes(type))
    throw new GameError("Invalid partnership type.");
  if (
    store.get(
      "SELECT id FROM partnerships WHERE club_id = ? AND partner_id = ?",
      own.id,
      partnerId,
    )
  )
    throw new GameError("A partnership already exists.");
  if (partner.reputation > own.reputation + 12 && type === "Feeder club")
    throw new GameError(
      "This club will not accept a feeder relationship with a less established club.",
    );
  const cost = 100_000 + Math.round(partner.reputation ** 2 * 60);
  if (own.balance < cost)
    throw new GameError("The club cannot afford this partnership.");
  ledger(store, own.id, -cost, "Partnerships", `${type}: ${partner.name}`);
  store.run(
    "INSERT INTO partnerships(club_id, partner_id, type, strength, data) VALUES (?, ?, ?, ?, ?)",
    own.id,
    partner.id,
    type,
    clamp(55 + (own.reputation - partner.reputation) / 3, 30, 85),
    JSON.stringify({
      since: stateOf(store).date,
      annualFee: cost,
      loansCompleted: 0,
    }),
  );
  news(
    store,
    "Loans",
    `${partner.name}: partnership agreed`,
    `${type} agreement signed. Relationship strength now influences loan acceptance, wage sharing and development guarantees.`,
    "success",
    "loans",
  );
}

export function recallLoan(store: Store, id: number, injury = false) {
  const loan = store.get<Loan>("SELECT * FROM loans WHERE id = ?", id);
  const state = stateOf(store);
  if (!loan || loan.parent_id !== state.clubId || loan.status !== "active")
    throw new GameError("This active loan is not controlled by your club.");
  const terms = JSON.parse(loan.terms) as LoanTerms;
  const player = playerOf(store, loan.player_id);
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
  store.run(
    "UPDATE loans SET status = 'recalled', relationship = max(0, relationship - 12) WHERE id = ?",
    id,
  );
  const details = JSON.parse(loan.data);
  store.run(
    "UPDATE players SET club_id = parent_club_id, parent_club_id = NULL, role = ?, training = ? WHERE id = ?",
    details.parentRole ?? "Squad player",
    details.parentTraining ?? "Balanced",
    player.id,
  );
  store.run(
    "UPDATE sell_on_clauses SET status = 'cancelled' WHERE source_loan_id = ? AND status = 'active'",
    loan.id,
  );
  store.run(
    "UPDATE partnerships SET strength = max(0, strength - 8) WHERE club_id = ? AND partner_id = ?",
    loan.parent_id,
    loan.destination_id,
  );
  news(
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

export function exerciseOption(store: Store, id: number, mandatory = false) {
  const loan = store.get<Loan>("SELECT * FROM loans WHERE id = ?", id);
  if (!loan || loan.status !== "active")
    throw new GameError("Active loan not found.");
  if (!mandatory && loan.destination_id !== stateOf(store).clubId)
    throw new GameError(
      "Only the borrowing club can exercise a purchase option.",
    );
  if (!["Loan with option", "Loan with obligation"].includes(loan.type))
    throw new GameError("This agreement has no purchase clause.");
  const terms = JSON.parse(loan.terms) as LoanTerms;
  const buyer = clubOf(store, loan.destination_id);
  if (!mandatory && buyer.transfer_budget < terms.optionFee)
    throw new GameError("The purchase option exceeds the transfer budget.");
  ledger(
    store,
    buyer.id,
    -terms.optionFee,
    "Transfer fees",
    `Loan ${mandatory ? "obligation" : "option"} exercised`,
  );
  transferProceeds(
    store,
    loan.player_id,
    loan.parent_id,
    terms.optionFee,
    "Loan purchase clause",
  );
  store.run(
    "UPDATE clubs SET transfer_budget = transfer_budget - ?, season_spend = season_spend + ?, ffp = ffp + ? WHERE id = ?",
    terms.optionFee,
    terms.optionFee,
    terms.optionFee / 4,
    buyer.id,
  );
  store.run(
    "UPDATE players SET parent_club_id = NULL, contract_end = ?, role = 'Regular starter' WHERE id = ?",
    `${stateOf(store).season + 4}-06-30`,
    loan.player_id,
  );
  store.run("UPDATE loans SET status = 'purchased' WHERE id = ?", id);
  if ([loan.parent_id, loan.destination_id].includes(stateOf(store).clubId))
    news(
      store,
      "Loans",
      "Purchase clause activated",
      `${playerOf(store, loan.player_id).name} has joined ${buyer.name} permanently for ${money(terms.optionFee)}.`,
      "success",
      "loans",
    );
}

export function reviewLoans(store: Store) {
  const state = stateOf(store);
  for (const loan of store.all<Loan>(
    "SELECT * FROM loans WHERE status = 'active'",
  )) {
    const player = playerOf(store, loan.player_id);
    const terms = JSON.parse(loan.terms) as LoanTerms;
    const data = JSON.parse(loan.data);
    const destination = clubOf(store, loan.destination_id);
    const profile = JSON.parse(player.profile) as PlayerProfile;
    data.weeks = (data.weeks ?? 0) + 1;
    if (player.injury_until) data.injuryWeeks = (data.injuryWeeks ?? 0) + 1;
    const elapsed = Math.max(1, daysBetween(loan.start_date, state.date));
    const expected = Math.max(
      90,
      ((elapsed / 7) * 90 * terms.playingTime) / 100,
    );
    const positionUsage = store.get<{
      total: number;
      correct: number;
      minutes: number;
    }>(
      "SELECT count(*) AS total, coalesce(sum(CASE WHEN json_extract(data,'$.position') = ? THEN 1 ELSE 0 END),0) AS correct, coalesce(sum(json_extract(data,'$.minutes')),0) AS minutes FROM history WHERE entity_type = 'appearance' AND entity_id = ? AND date >= ? AND json_extract(data,'$.clubId') = ?",
      terms.position,
      player.id,
      loan.start_date,
      loan.destination_id,
    )!;
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
        store.run(
          "UPDATE players SET morale = max(1, morale - 10), potential = max(ability, potential - 1.5), profile = ? WHERE id = ?",
          JSON.stringify(profile),
          player.id,
        );
        store.run(
          "UPDATE clubs SET board_confidence = max(0, board_confidence - 3), fan_mood = max(0, fan_mood - 3) WHERE id = ?",
          loan.parent_id,
        );
        store.run(
          "UPDATE partnerships SET strength = max(0, strength - 10) WHERE club_id = ? AND partner_id = ?",
          loan.parent_id,
          loan.destination_id,
        );
        store.run(
          "UPDATE clubs SET data = json_set(data,'$.loanTrust',max(0,coalesce(json_extract(data,'$.loanTrust'),65) - 12)) WHERE id = ?",
          loan.parent_id,
        );
        loan.relationship = Math.max(0, loan.relationship - 15);
        if (loan.parent_id === state.clubId)
          news(
            store,
            "Loans",
            `${player.name}: loan concern`,
            "Minutes, development or environment have fallen below the agreement. Confidence and potential have suffered; the agent and board want action.",
            "warning",
            "loans",
          );
      }
    } else if (score > 75) {
      store.run(
        "UPDATE players SET morale = min(99, morale + 1), loan_progress = loan_progress + 0.03, value = value * 1.003 WHERE id = ?",
        player.id,
      );
      if (data.weeks % 8 === 0) {
        profile.personality.adaptability = clamp(
          profile.personality.adaptability + 1,
        );
        profile.agent.frustration = Math.max(0, profile.agent.frustration - 5);
        store.run(
          "UPDATE players SET profile = ? WHERE id = ?",
          JSON.stringify(profile),
          player.id,
        );
        if (loan.parent_id === state.clubId)
          news(
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
        workPermitPoints: Math.min(
          30,
          (profile.registration?.workPermitPoints ?? 0) +
            (minutes > 270 ? 3 : 1),
        ),
        adaptedCountries: [
          ...new Set([
            ...(profile.registration?.adaptedCountries ?? []),
            destination.country_id,
          ]),
        ],
      };
      const language = store.get<{ language: string }>(
        "SELECT language FROM countries WHERE id = ?",
        destination.country_id,
      )!.language;
      const existing = profile.identity.languages.find(
        (entry) => entry.language === language,
      );
      if (existing) existing.fluency = Math.min(5, existing.fluency + 1);
      else profile.identity.languages.push({ language, fluency: 1 });
      profile.personality.adaptability = clamp(
        profile.personality.adaptability + 1,
      );
      store.run(
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
      ledger(
        store,
        loan.parent_id,
        -terms.bonus,
        "Loan bonus",
        `${player.name}: development milestone`,
      );
      ledger(
        store,
        loan.destination_id,
        terms.bonus,
        "Loan bonus",
        `${player.name}: minutes guarantee met`,
      );
      data.bonusPaid = true;
    }
    store.run(
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
      if (obligation) exerciseOption(store, loan.id, true);
      else {
        store.run(
          "UPDATE players SET club_id = parent_club_id, parent_club_id = NULL, role = ?, training = ? WHERE id = ?",
          data.parentRole ?? "Squad player",
          data.parentTraining ?? "Balanced",
          player.id,
        );
        store.run(
          "UPDATE loans SET status = 'completed' WHERE id = ?",
          loan.id,
        );
        store.run(
          "UPDATE partnerships SET strength = min(100, max(0, strength + ?)) WHERE club_id = ? AND partner_id = ?",
          (score - 50) / 10,
          loan.parent_id,
          loan.destination_id,
        );
        if (loan.parent_id === state.clubId)
          news(
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

export function expireLoans(store: Store) {
  const state = stateOf(store);
  for (const loan of store.all<Loan>(
    "SELECT * FROM loans WHERE status = 'active' AND end_date <= ?",
    state.date,
  )) {
    const terms = JSON.parse(loan.terms) as LoanTerms;
    const details = JSON.parse(loan.data);
    const minutes = store.get<{ total: number }>(
      "SELECT coalesce(sum(json_extract(data,'$.minutes')),0) AS total FROM history WHERE entity_type = 'appearance' AND entity_id = ? AND date >= ? AND json_extract(data,'$.clubId') = ?",
      loan.player_id,
      loan.start_date,
      loan.destination_id,
    )!.total;
    const obligation =
      loan.type === "Loan with obligation" &&
      (terms.obligationCondition === "Unconditional" ||
        (terms.obligationCondition === "Minutes played" &&
          minutes >= terms.mandatoryMinutes) ||
        (terms.obligationCondition === "Avoid relegation" &&
          clubOf(store, loan.destination_id).crisis < 70));
    if (obligation) exerciseOption(store, loan.id, true);
    else {
      store.run(
        "UPDATE players SET club_id = parent_club_id, parent_club_id = NULL, role = ?, training = ? WHERE id = ?",
        details.parentRole ?? "Squad player",
        details.parentTraining ?? "Balanced",
        loan.player_id,
      );
      store.run("UPDATE loans SET status = 'completed' WHERE id = ?", loan.id);
      if (loan.parent_id === state.clubId)
        news(
          store,
          "Loans",
          `${playerOf(store, loan.player_id).name} returns`,
          `The agreement has expired. The player returns with a loan success score of ${Math.round(loan.score)}.`,
          "info",
          "loans",
        );
    }
  }
}

export function mentorPlayer(store: Store, playerId: number, mentorId: number) {
  const player = requireOwnPlayer(store, playerId);
  const mentor = requireOwnPlayer(store, mentorId);
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
    const current: Player | undefined = store.get<Player>(
      "SELECT * FROM players WHERE id = ?",
      cursor,
    );
    cursor = current
      ? (JSON.parse(current.profile) as PlayerProfile).development.mentorId
      : null;
  }
  profile.development.mentorId = mentor.id;
  store.run(
    "UPDATE players SET profile = ? WHERE id = ?",
    JSON.stringify(profile),
    player.id,
  );
  store.run(
    "INSERT INTO relationships(club_id, source_type, source_id, target_type, target_id, strength, kind) VALUES (?, 'player', ?, 'player', ?, 65, 'Mentorship') ON CONFLICT(source_type, source_id, target_type, target_id) DO UPDATE SET strength = 65, kind = 'Mentorship'",
    stateOf(store).clubId,
    mentor.id,
    player.id,
  );
  experience(store, 5);
}

export function squadRole(store: Store, playerId: number, role: string) {
  const player = requireOwnPlayer(store, playerId);
  if (player.club_id !== stateOf(store).clubId)
    throw new GameError("The loan agreement controls this player's role.");
  if (role === "Captain")
    store.run(
      "UPDATE players SET role = 'Regular starter' WHERE club_id = ? AND role = 'Captain'",
      stateOf(store).clubId,
    );
  const profile = JSON.parse(player.profile) as PlayerProfile;
  const demotion =
    ["Fringe player", "Squad player"].includes(role) &&
    ["Key player", "Captain", "Regular starter"].includes(player.role);
  store.run(
    "UPDATE players SET role = ?, morale = max(1, min(99, morale + ?)) WHERE id = ?",
    role,
    demotion ? -5 - profile.personality.ego / 20 : 2,
    player.id,
  );
}

export function promoteYouth(store: Store, playerId: number) {
  const player = requireOwnPlayer(store, playerId);
  if (player.age_group === "Senior")
    throw new GameError("This player is already in the senior squad.");
  if (player.age < 16)
    throw new GameError("Under-16 players remain in the academy pathway.");
  store.run(
    "UPDATE players SET age_group = 'Senior', role = 'Prospect', morale = min(99, morale + 7), wage = max(wage, 500) WHERE id = ?",
    player.id,
  );
  store.run(
    "UPDATE clubs SET fan_mood = min(100, fan_mood + 2) WHERE id = ?",
    stateOf(store).clubId,
  );
  news(
    store,
    "Academy",
    `${player.name} earns a first-team opportunity`,
    "Promotion raises confidence and expectations. Manage minutes and training load to avoid early burnout.",
    "success",
    "squad",
  );
  experience(store, 12, 0.2);
}

export function staffAction(
  store: Store,
  id: number,
  action: "hire" | "release" | "mediate" | "develop",
) {
  const staff = store.get<Staff>("SELECT * FROM staff WHERE id = ?", id);
  const club = clubOf(store);
  if (!staff) throw new GameError("Staff member not found.");
  if (action === "hire") {
    if (staff.club_id)
      throw new GameError("This staff member is not available.");
    const fee = staff.wage * 12;
    if (club.balance < fee)
      throw new GameError("Insufficient funds for the signing fee.");
    ledger(store, club.id, -fee, "Staff", `Signing ${staff.name}`);
    store.run(
      "UPDATE staff SET club_id = ?, morale = 80 WHERE id = ?",
      club.id,
      id,
    );
    const peer = store.get<Staff>(
      "SELECT * FROM staff WHERE club_id = ? AND id != ? ORDER BY influence DESC LIMIT 1",
      club.id,
      id,
    );
    if (peer)
      store.run(
        "INSERT OR IGNORE INTO relationships(club_id, source_type, source_id, target_type, target_id, strength, kind) VALUES (?, 'staff', ?, 'staff', ?, ?, ?)",
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
      ledger(store, club.id, -cost, "Staff", `Severance: ${staff.name}`);
      store.run("UPDATE staff SET club_id = NULL WHERE id = ?", id);
      store.run(
        "UPDATE assignments SET status = 'cancelled' WHERE staff_id = ? AND status = 'active'",
        id,
      );
    } else if (action === "mediate") {
      store.run(
        "UPDATE relationships SET strength = min(99, strength + 18), kind = CASE WHEN strength + 18 > 0 THEN 'Professional' ELSE kind END WHERE club_id = ? AND (source_id = ? OR target_id = ?) AND source_type = 'staff'",
        club.id,
        id,
        id,
      );
      store.run(
        "UPDATE staff SET morale = min(99, morale + 6) WHERE id = ?",
        id,
      );
      store.run(
        "UPDATE clubs SET chemistry = min(99, chemistry + 1) WHERE id = ?",
        club.id,
      );
      experience(store, 7);
    } else {
      if (club.balance < 50000)
        throw new GameError("Insufficient funds for professional development.");
      ledger(
        store,
        club.id,
        -50000,
        "Staff development",
        `${staff.name}: development course`,
      );
      store.run(
        "UPDATE staff SET ability = min(99, ability + 1), communication = min(99, communication + 1), tactical_knowledge = min(99, tactical_knowledge + 1) WHERE id = ?",
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

export function mediaResponse(store: Store, approach: string) {
  const state = stateOf(store);
  const last = store.get<{ value: string }>(
    "SELECT value FROM meta WHERE key = ?",
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
  const media = Number(settingsOf(store).mediaPressure) / 50;
  store.run(
    "UPDATE clubs SET fan_mood = min(100,max(0,fan_mood + ?)), board_confidence = min(100,max(0,board_confidence + ?)), board_pressure = min(100,max(0,board_pressure + ?)) WHERE id = ?",
    choice.fan * media,
    choice.board,
    choice.pressure * media,
    state.clubId,
  );
  store.run(
    "UPDATE players SET morale = min(99,max(1,morale + ?)) WHERE club_id = ?",
    choice.morale * media,
    state.clubId,
  );
  news(
    store,
    "Media",
    choice.title,
    approach === "ambitious"
      ? "Supporters have welcomed the ambition. The statement also raises expectations for the coming months."
      : approach === "challenge"
        ? "The board welcomed the message, but several players felt publicly criticised."
        : approach === "protect"
          ? "The dressing room appreciated your backing. Some supporters still want stronger accountability."
          : "The emphasis on patience and a clear plan has reduced immediate pressure.",
    "info",
    "media",
    { narrative: approach, bias: Number(settingsOf(store).mediaPressure) },
  );
  store.setMeta("lastMediaResponse", state.date);
  experience(store, 5);
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
