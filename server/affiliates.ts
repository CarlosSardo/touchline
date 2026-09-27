import { Store } from "./db.ts";
import { acquirePlayerAsset } from "./finance.ts";
import {
  clubRegistration,
  familyResidence,
  heldNationalities,
  minorPresenceLegal,
  registrationAssociationId,
} from "./registration.ts";
import {
  clubOf,
  contractEndDate,
  defaultLoanTerms,
  GameError,
  ledger,
  news,
  playerOf,
  startLoanSpell,
  stateOf,
  transferProceeds,
} from "./systems.ts";
import {
  addDays,
  addMonths,
  ageOn,
  daysBetween,
  money,
  tacticalFit,
  transferWindow,
} from "../shared/rules.ts";
import type {
  AffiliateOption,
  Club,
  LoanTerms,
  Negotiation,
  NegotiationData,
  Player,
  PlayerProfile,
} from "../shared/types.ts";

export const AFFILIATE_BRIDGE_DAYS = 112;
export const AFFILIATE_MIN_STRENGTH = 45;
export const AFFILIATE_SQUAD_CAP = 35;
export const AFFILIATE_LOAN_MIN_STRENGTH = 35;

export interface AffiliateCandidate {
  clubId: number;
  clubName: string;
  type: Club["type"];
  associationId: number;
  partnershipStrength: number | null;
  squadCount: number;
  minorPresenceLegal?: boolean;
}

export interface PlacementEligibilityContext {
  date: string;
  playerAge: number;
  sellingClubId: number;
  sellingAssociationId: number;
  futureArrivalDate: string;
  alreadyPlaced: boolean;
}

export interface OnwardLoanEligibilityContext {
  buyerAssociationId: number;
  contractEnd: string;
  loanEnd: string;
  hasLoanBack: boolean;
}

function withReason(reasons: string[], condition: boolean, reason: string) {
  if (condition) reasons.push(reason);
}

export function nextOpenTransferDate(date: string) {
  let cursor = date;
  for (let days = 0; days <= 370; days++) {
    if (transferWindow(cursor)) return cursor;
    cursor = addDays(cursor, 1);
  }
  return cursor;
}

export function bridgeProtectedArrival(arrival: string, placementDate: string) {
  const bridgeSafe = addDays(placementDate, AFFILIATE_BRIDGE_DAYS);
  return nextOpenTransferDate(arrival < bridgeSafe ? bridgeSafe : arrival);
}

export function assessAffiliatePlacements(
  candidates: AffiliateCandidate[],
  context: PlacementEligibilityContext,
): AffiliateOption[] {
  return candidates.map((candidate) => {
    const reasons: string[] = [];
    withReason(reasons, context.alreadyPlaced, "Player is already registered at an affiliate for this agreement.");
    withReason(reasons, candidate.partnershipStrength === null, "No active partnership with this club.");
    withReason(reasons, candidate.type !== "club", "Affiliate must be a senior club, not a reserve or national side.");
    withReason(reasons, candidate.clubId === context.sellingClubId, "The selling club cannot also be the affiliate placement.");
    withReason(reasons, candidate.associationId !== context.sellingAssociationId, "Affiliate must register players in the same association as the selling club.");
    withReason(reasons, !transferWindow(context.date), "Affiliate placements can only be registered during an open transfer window.");
    withReason(reasons, context.playerAge >= 18, "Affiliate placement is only for future arrivals before the player turns 18.");
    withReason(reasons, candidate.minorPresenceLegal === false, "The minor could not be legally present for a registration in this association.");
    withReason(reasons, candidate.squadCount >= AFFILIATE_SQUAD_CAP, `Affiliate squad is full (${AFFILIATE_SQUAD_CAP} registered players).`);
    withReason(
      reasons,
      (candidate.partnershipStrength ?? 0) < AFFILIATE_MIN_STRENGTH,
      `Partnership strength must be at least ${AFFILIATE_MIN_STRENGTH} for a genuine placement.`,
    );
    const adjustedArrival = bridgeProtectedArrival(context.futureArrivalDate, context.date);
    if (adjustedArrival !== context.futureArrivalDate)
      reasons.push(`Bridge-transfer rule: arrival moves to ${adjustedArrival} (at least ${AFFILIATE_BRIDGE_DAYS} days after placement, inside a window).`);
    return {
      clubId: candidate.clubId,
      clubName: candidate.clubName,
      eligible: reasons.every((reason) => reason.startsWith("Bridge-transfer rule:")),
      reasons: reasons.length ? reasons : ["Eligible domestic affiliate placement."],
      strength: candidate.partnershipStrength ?? 0,
      squadCount: candidate.squadCount,
      adjustedArrival,
    };
  });
}

export function affiliateLoanEndDate(startDate: string, until: "season" | "year") {
  if (until === "year") return addMonths(startDate, 12);
  const seasonEndYear = Number(startDate.slice(0, 4)) + (startDate.slice(5) >= "06-01" ? 1 : 0);
  const end = `${seasonEndYear}-06-30`;
  return daysBetween(startDate, end) < 120 ? `${seasonEndYear + 1}-06-30` : end;
}

export function assessOnwardLoanAffiliates(
  candidates: AffiliateCandidate[],
  context: OnwardLoanEligibilityContext,
): AffiliateOption[] {
  return candidates.map((candidate) => {
    const reasons: string[] = [];
    withReason(reasons, context.hasLoanBack, "Cannot combine an onward affiliate loan with a seller loan-back.");
    withReason(reasons, candidate.partnershipStrength === null, "No active partnership with this club.");
    withReason(reasons, candidate.type !== "club", "Borrower must be a senior club.");
    withReason(reasons, candidate.associationId !== context.buyerAssociationId, "On-arrival affiliate loans must be domestic to the buying club's registration association.");
    withReason(reasons, candidate.squadCount >= AFFILIATE_SQUAD_CAP, `Affiliate squad is full (${AFFILIATE_SQUAD_CAP} registered players).`);
    withReason(
      reasons,
      (candidate.partnershipStrength ?? 0) < AFFILIATE_LOAN_MIN_STRENGTH,
      `Partnership strength must be at least ${AFFILIATE_LOAN_MIN_STRENGTH} for an affiliate loan.`,
    );
    withReason(reasons, context.loanEnd >= context.contractEnd, "The affiliate loan must end before the player's new contract.");
    return {
      clubId: candidate.clubId,
      clubName: candidate.clubName,
      eligible: reasons.length === 0,
      reasons: reasons.length ? reasons : ["Eligible domestic affiliate loan."],
      strength: candidate.partnershipStrength ?? 0,
      squadCount: candidate.squadCount,
    };
  });
}

async function countryCodes(store: Store) {
  return new Map(
    (await store.all<{ id: number; code: string }>("SELECT id, code FROM countries")).map((row) => [row.id, row.code]),
  );
}

export async function affiliateSquadCounts(store: Store) {
  return new Map(
    (await store.all<{ club_id: number; total: number }>(
      "SELECT club_id, count(*) AS total FROM players WHERE club_id IS NOT NULL AND role != 'Retired' GROUP BY club_id",
    )).map((row) => [row.club_id, row.total]),
  );
}

async function affiliateCandidates(
  store: Store,
  clubId: number,
  player?: Player,
  squadCounts?: Map<number, number>,
): Promise<AffiliateCandidate[]> {
  const rows = await store.all<Club & { strength: number }>(
    "SELECT clubs.*, partnerships.strength FROM partnerships JOIN clubs ON clubs.id = CASE WHEN partnerships.club_id = ? THEN partnerships.partner_id ELSE partnerships.club_id END WHERE partnerships.club_id = ? OR partnerships.partner_id = ? ORDER BY partnerships.strength DESC, clubs.name",
    clubId,
    clubId,
    clubId,
  );
  const counts = squadCounts ?? (await affiliateSquadCounts(store));
  const state = await stateOf(store);
  const codes = player ? await countryCodes(store) : new Map<number, string>();
  const profile = player ? (JSON.parse(player.profile) as PlayerProfile) : null;
  const nationalities = player && profile ? heldNationalities(player.nationality, profile) : [];
  return await Promise.all(
    rows.map(async (club) => {
      const destination = clubRegistration(codes.get(club.country_id) ?? "", club.data);
      return {
        clubId: club.id,
        clubName: club.name,
        type: club.type,
        associationId: await registrationAssociationId(store, club),
        partnershipStrength: club.strength,
        squadCount: counts.get(club.id) ?? 0,
        minorPresenceLegal: player && profile
          ? minorPresenceLegal({
              age: ageOn(player.birth_date, state.date),
              nationalities,
              destination,
              residence: familyResidence(profile, player.birth_date, state.date, (id) => codes.get(id)),
            })
          : undefined,
      };
    }),
  );
}

function asData(negotiation: Negotiation) {
  return JSON.parse(negotiation.data) as NegotiationData;
}

function hasLoanBack(data: NegotiationData) {
  const loanBack = data.transferTerms?.loanBack;
  return !!loanBack && loanBack !== "none";
}

export async function affiliateOptionsForNegotiation(
  store: Store,
  negotiation: Negotiation,
  squadCounts?: Map<number, number>,
) {
  const state = await stateOf(store);
  if (negotiation.buying_club_id !== state.clubId)
    return { placementOptions: [], onwardLoanOptions: [] };
  const data = asData(negotiation);
  const placementCouldApply =
    negotiation.type === "Future transfer" &&
    negotiation.stage === "Scheduled" &&
    !!data.futureArrivalDate &&
    !!negotiation.selling_club_id &&
    !data.affiliatePlacement;
  const stages = ["Contract review", "Scheduled", "Medical", "Registration"];
  const onwardLoanCouldApply =
    stages.includes(negotiation.stage) &&
    !["Contract renewal", "Youth approach"].includes(negotiation.type);
  if (!placementCouldApply && !onwardLoanCouldApply)
    return { placementOptions: [], onwardLoanOptions: [] };
  const player = await playerOf(store, negotiation.player_id);
  const buyer = await clubOf(store, negotiation.buying_club_id);
  const candidates = await affiliateCandidates(store, buyer.id, player, squadCounts);
  const placementSellingClubId = negotiation.selling_club_id ?? 0;
  const placementArrival = data.futureArrivalDate ?? state.date;
  const placementOptions = placementCouldApply
    ? assessAffiliatePlacements(candidates, {
        date: state.date,
        playerAge: ageOn(player.birth_date, state.date),
        sellingClubId: placementSellingClubId,
        sellingAssociationId: await registrationAssociationId(store, await clubOf(store, placementSellingClubId)),
        futureArrivalDate: placementArrival,
        alreadyPlaced: !!data.affiliatePlacement,
      })
    : [];
  const onwardLoanOptions = onwardLoanCouldApply
    ? assessOnwardLoanAffiliates(candidates, {
        buyerAssociationId: await registrationAssociationId(store, buyer),
        contractEnd: contractEndDate(data.futureArrivalDate ?? state.date, data.years, ageOn(player.birth_date, data.futureArrivalDate ?? state.date)),
        loanEnd: affiliateLoanEndDate(data.futureArrivalDate && state.date < data.futureArrivalDate ? data.futureArrivalDate : state.date, data.onwardLoan?.until ?? "season"),
        hasLoanBack: hasLoanBack(data),
      })
    : [];
  return { placementOptions, onwardLoanOptions };
}

export async function placeFutureTransferAtAffiliate(store: Store, negotiationId: number, affiliateId: number) {
  const state = await stateOf(store);
  let negotiation = await store.get<Negotiation>("SELECT * FROM negotiations WHERE id = ?", negotiationId);
  if (!negotiation || negotiation.buying_club_id !== state.clubId)
    throw new GameError("This future agreement is not yours.");
  if (negotiation.type !== "Future transfer")
    throw new GameError("Affiliate placement is only available for future transfer agreements.");
  if (negotiation.stage !== "Scheduled")
    throw new GameError("Affiliate placement is only available after a future agreement is scheduled.");
  const data = asData(negotiation);
  if (!data.futureArrivalDate || !negotiation.selling_club_id)
    throw new GameError("Only incoming future transfers can be placed with an affiliate.");
  if (hasLoanBack(data))
    throw new GameError("Affiliate placement cannot be combined with a seller loan-back.");
  if (data.affiliatePlacement)
    throw new GameError("This player is already placed at an affiliate.");
  const player = await playerOf(store, negotiation.player_id);
  if (ageOn(player.birth_date, state.date) >= 18)
    throw new GameError("Affiliate placement is only for players who have not turned 18.");
  if (player.club_id !== negotiation.selling_club_id || player.parent_club_id)
    throw new GameError("The player's registration has changed.");
  const seller = await clubOf(store, negotiation.selling_club_id);
  const affiliate = await clubOf(store, affiliateId);
  const options = (await affiliateOptionsForNegotiation(store, negotiation)).placementOptions;
  const option = options.find((entry) => entry.clubId === affiliateId);
  if (!option?.eligible) throw new GameError(option?.reasons.join(" ") ?? "This affiliate is not eligible.");

  const fee = negotiation.offer;
  const originalReserved = data.reservedBudget ?? 0;
  if (fee > originalReserved) throw new GameError("Reserved transfer allocation no longer covers the agreed fee.");
  if (fee > 0) {
    await ledger(store, negotiation.buying_club_id, -fee, "Transfer fees", `${player.name}: affiliate placement`);
    await transferProceeds(store, player.id, seller.id, fee, `${player.name}: transfer to affiliate`);
    await store.run(
      "UPDATE clubs SET season_spend = season_spend + ? WHERE id = ?",
      fee,
      negotiation.buying_club_id,
    );
  }
  data.reservedBudget = Math.max(0, originalReserved - fee);
  data.futureArrivalDate = option.adjustedArrival ?? data.futureArrivalDate;
  data.medicalDate = addDays(data.futureArrivalDate, -2);
  data.affiliatePlacement = {
    clubId: affiliate.id,
    clubName: affiliate.name,
    date: state.date,
    originalSellerId: seller.id,
    originalSellerName: seller.name,
    fee,
  };
  data.log.push({
    date: state.date,
    type: "Affiliate placement",
    message: `${player.name} moved domestically from ${seller.name} to affiliate ${affiliate.name}. The original fee of ${money(fee)} has been settled now; the onward move remains scheduled for ${data.futureArrivalDate}.`,
  });
  const profile = JSON.parse(player.profile) as PlayerProfile;
  profile.contract = {
    ...profile.contract,
    status: ageOn(player.birth_date, state.date) >= 16 ? "professional" : "amateur",
    signedDate: state.date,
  };
  profile.registration = {
    workPermitPoints: profile.registration?.workPermitPoints ?? 0,
    adaptedCountries: profile.registration?.adaptedCountries ?? [],
    lastAssociationId: await registrationAssociationId(store, affiliate),
  };
  const contractEnd = contractEndDate(state.date, 3, ageOn(player.birth_date, state.date));
  await acquirePlayerAsset(store, affiliate.id, player.id, 0, state.date, contractEnd);
  await store.run(
    "UPDATE players SET club_id = ?, squad_club_id = NULL, parent_club_id = NULL, wage = ?, contract_end = ?, role = 'Prospect', listed = 0, available_loan = 0, profile = ? WHERE id = ?",
    affiliate.id,
    Math.max(player.wage, 500),
    contractEnd,
    JSON.stringify(profile),
    player.id,
  );
  await store.run(
    "UPDATE negotiations SET selling_club_id = ?, offer = 0, data = ? WHERE id = ?",
    affiliate.id,
    JSON.stringify(data),
    negotiation.id,
  );
  await store.run(
    "INSERT INTO history(season,entity_type,entity_id,date,data) VALUES (?,?,?,?,?)",
    state.season,
    "transfer",
    player.id,
    state.date,
    JSON.stringify({
      name: player.name,
      from: seller.id,
      to: affiliate.id,
      club: affiliate.name,
      fee,
      type: "Transfer to affiliate",
    }),
  );
  await news(
    store,
    "Transfers",
    `${player.name}: affiliate placement`,
    `${affiliate.name} have registered the player domestically. The future move to ${(await clubOf(store, state.clubId)).name} cannot register until at least ${AFFILIATE_BRIDGE_DAYS} days after this placement and inside a transfer window.`,
    "success",
    "transfers",
    { playerId: player.id, clubId: affiliate.id },
  );
  negotiation = (await store.get<Negotiation>("SELECT * FROM negotiations WHERE id = ?", negotiation.id))!;
  return { id: negotiation.id, message: `${player.name} has joined ${affiliate.name} until the future transfer can register.` };
}

export async function setOnwardLoanPlan(
  store: Store,
  negotiationId: number,
  clubId: number | null,
  until: "season" | "year" = "season",
) {
  const state = await stateOf(store);
  const negotiation = await store.get<Negotiation>("SELECT * FROM negotiations WHERE id = ?", negotiationId);
  if (!negotiation || negotiation.buying_club_id !== state.clubId)
    throw new GameError("This incoming agreement is not yours.");
  if (!["Contract review", "Scheduled", "Medical", "Registration"].includes(negotiation.stage))
    throw new GameError("On-arrival affiliate loans can only be set on agreements awaiting signature or registration.");
  const data = asData(negotiation);
  if (clubId !== null && hasLoanBack(data))
    throw new GameError("An onward affiliate loan cannot be combined with a seller loan-back.");
  if (clubId === null) {
    delete data.onwardLoan;
    data.log.push({ date: state.date, type: "Affiliate loan", message: "The on-arrival affiliate loan plan was cleared." });
  } else {
    const options = (
      await affiliateOptionsForNegotiation(store, {
        ...negotiation,
        data: JSON.stringify({
          ...data,
          onwardLoan: { clubId, clubName: "", until, setOn: state.date },
        } satisfies NegotiationData),
      })
    ).onwardLoanOptions;
    const option = options.find((entry) => entry.clubId === clubId);
    if (!option?.eligible) throw new GameError(option?.reasons.join(" ") ?? "This affiliate is not eligible for an onward loan.");
    data.onwardLoan = { clubId, clubName: option.clubName, until, setOn: state.date };
    data.log.push({ date: state.date, type: "Affiliate loan", message: `${option.clubName} will take the player on a domestic development loan after registration.` });
  }
  await store.run("UPDATE negotiations SET data = ? WHERE id = ?", JSON.stringify(data), negotiation.id);
  return { id: negotiation.id, message: clubId === null ? "Affiliate loan plan cleared." : "Affiliate loan plan saved." };
}

function developmentLoanTerms(player: Player, borrower: Club, strength: number): LoanTerms {
  const terms = defaultLoanTerms(player, borrower);
  terms.role = player.age < 21 ? "Prospect" : "Regular starter";
  terms.playingTime = player.age < 21 ? 50 : 65;
  terms.recall = true;
  terms.salarySplit = strength >= 60 ? 50 : 60;
  terms.fee = 0;
  terms.bonus = 0;
  terms.relationship = strength;
  terms.tacticalFit = Math.round(tacticalFit(player, borrower));
  return terms;
}

export async function startOnwardLoan(store: Store, negotiation: Negotiation, data: NegotiationData) {
  if (!data.onwardLoan) return;
  const state = await stateOf(store);
  try {
    const player = await playerOf(store, negotiation.player_id);
    const buyer = await clubOf(store, negotiation.buying_club_id);
    const options = (await affiliateOptionsForNegotiation(store, { ...negotiation, data: JSON.stringify(data) })).onwardLoanOptions;
    const option = options.find((entry) => entry.clubId === data.onwardLoan!.clubId);
    if (!option?.eligible || player.club_id !== buyer.id || player.parent_club_id) {
      data.log.push({
        date: state.date,
        type: "Affiliate loan",
        message: `The planned affiliate loan could not start: ${option?.reasons.join(" ") ?? "the player's registration changed"}.`,
      });
      await news(store, "Transfers", `${player.name}: affiliate loan skipped`, data.log.at(-1)!.message, "warning", "transfers", { playerId: player.id });
      return;
    }
    const borrower = await clubOf(store, data.onwardLoan.clubId);
    const endDate = affiliateLoanEndDate(state.date, data.onwardLoan.until);
    const terms = developmentLoanTerms(player, borrower, option.strength);
    await startLoanSpell(store, {
      player,
      parentId: buyer.id,
      borrower,
      type: "Development loan",
      startDate: state.date,
      endDate,
      terms,
    });
    await store.run(
      "INSERT INTO history(season,entity_type,entity_id,date,data) VALUES (?,?,?,?,?)",
      state.season,
      "loan",
      player.id,
      state.date,
      JSON.stringify({
        name: player.name,
        from: buyer.id,
        to: borrower.id,
        club: borrower.name,
        fee: 0,
        type: "Affiliate loan",
      }),
    );
    data.log.push({
      date: state.date,
      type: "Affiliate loan",
      message: `${player.name} joined ${borrower.name} on a domestic development loan until ${endDate}.`,
    });
    await news(store, "Loans", `${player.name}: affiliate loan`, `${borrower.name} will give him minutes on a development loan until ${endDate}.`, "success", "loans", { playerId: player.id, clubId: borrower.id });
  } catch (error) {
    const player = await playerOf(store, negotiation.player_id).catch(() => null);
    data.log.push({
      date: state.date,
      type: "Affiliate loan",
      message: `The planned affiliate loan could not start, but the signing was completed. ${error instanceof Error ? error.message : ""}`.trim(),
    });
    await news(store, "Transfers", `${player?.name ?? "Signing"}: affiliate loan skipped`, data.log.at(-1)!.message, "warning", "transfers", player ? { playerId: player.id } : {});
  }
}
