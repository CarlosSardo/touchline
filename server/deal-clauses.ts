import type { Store } from "./db.ts";
import { clubPolicySnapshot } from "./club-policy.ts";
import { acquirePlayerAsset, recordFinancialItem, sellPlayerAsset, transferEmbargo } from "./finance.ts";
import { currentSpell, registerSpell } from "./eligibility.ts";
import { buyerGoingRate, marketMoveInterest, marketWageOffer, MOVE_REFUSAL_THRESHOLD } from "./recruitment.ts";
import { activeEmbargo } from "./sanctions.ts";
import { clubOf, contractEndDate, GameError, playerOf, requireOwnPlayer, stateOf, weeklyWages } from "./systems.ts";
import { marketContractYears } from "./transfer-battles.ts";
import { optionalReleaseClause, releaseClauseFor } from "../shared/release-clauses.ts";
import { clamp, money } from "../shared/rules.ts";
import type { Club, ExchangePart, Negotiation, NegotiationData, Player, PlayerProfile } from "../shared/types.ts";

const OPEN_STAGES = ["Enquiry", "Club talks", "Agent talks", "Contract review", "Scheduled", "Medical", "Registration", "Offer received"];

const countryCode = async (store: Store, club: Pick<Club, "country_id">) =>
  (await store.get<{ code: string }>("SELECT code FROM countries WHERE id = ?", club.country_id))?.code;

/**
 * The release clause of a contract signed or renewed at `club`: the amount agreed in the talks, otherwise mandatory
 * at Spanish clubs (the default for the player), kept on a renewal elsewhere, and absent on a new contract elsewhere
 * unless the player negotiated one.
 */
export async function contractReleaseClause(
  store: Store,
  club: Pick<Club, "id" | "country_id">,
  player: Pick<Player, "id" | "age" | "ability" | "potential" | "value" | "profile">,
  agreed: number | null | undefined,
  renewal: boolean,
) {
  const spanish = (await countryCode(store, club)) === "ES";
  if (agreed) return Math.round(agreed);
  if (spanish) return releaseClauseFor(player, true);
  if (renewal) return (JSON.parse(player.profile) as PlayerProfile).contract?.releaseClause ?? null;
  return agreed === null ? null : optionalReleaseClause(player.id, club.id) ? releaseClauseFor(player, false) : null;
}

/**
 * The director pays a player's release clause in club talks: the selling club cannot refuse, so the deal moves
 * straight to personal terms (the player may still say no). The clause is the fee; the budget and any embargo apply.
 */
export async function payReleaseClause(store: Store, id: number) {
  const state = await stateOf(store);
  const negotiation = await store.get<Negotiation>("SELECT * FROM negotiations WHERE id = ?", id);
  if (!negotiation || negotiation.buying_club_id !== state.clubId) throw new GameError("Only your own purchase can trigger a release clause.");
  if (negotiation.type !== "Permanent transfer" || !negotiation.selling_club_id)
    throw new GameError("A release clause is paid for a permanent transfer from another club.");
  if (negotiation.stage !== "Club talks") throw new GameError("Open formal talks with the club before paying the release clause.");
  const player = await playerOf(store, negotiation.player_id);
  const clause = (JSON.parse(player.profile) as PlayerProfile).contract?.releaseClause;
  if (!clause) throw new GameError(`${player.name}'s contract has no release clause.`);
  const buyer = await clubOf(store, state.clubId);
  const data = JSON.parse(negotiation.data) as NegotiationData;
  if (clause > buyer.transfer_budget + (data.reservedBudget ?? 0))
    throw new GameError(`The ${money(clause)} release clause exceeds your transfer budget.`);
  if (transferEmbargo(buyer.balance, clause) || (await activeEmbargo(store, buyer.id, state.date)))
    throw new GameError("Your club is under a transfer embargo and cannot pay a release clause.");
  if (negotiation.interest < MOVE_REFUSAL_THRESHOLD)
    throw new GameError(`${player.name} is not interested in joining, so paying his clause would not bring him.`);
  data.releaseClause = true;
  data.counter = undefined;
  const seller = await clubOf(store, negotiation.selling_club_id);
  const message = `Release clause of ${money(clause)} paid. ${seller.name} cannot block the move; personal terms and the medical remain.`;
  data.log.push({ date: state.date, type: "Release clause", message });
  await store.run(
    "UPDATE negotiations SET stage = 'Agent talks', offer = ?, asking_price = ?, tension = GREATEST(5, tension - 10), data = ? WHERE id = ?",
    clause,
    clause,
    JSON.stringify(data),
    id,
  );
  return { message, stage: "Agent talks" };
}

/**
 * Prices a player the director offers as part of a purchase (player-plus-cash or a swap): the selling club credits
 * him at his value when it needs his position (less without a need, and less the further he is from its level),
 * provided he is willing to join and the club can pay his wage. Throws the reason it cannot work.
 */
export async function exchangePart(store: Store, playerId: number, seller: Club, target: Player): Promise<ExchangePart> {
  const state = await stateOf(store);
  const own = await requireOwnPlayer(store, playerId);
  if (own.id === target.id) throw new GameError("The player you are buying cannot be part of the payment.");
  if (own.parent_club_id || own.club_id !== state.clubId) throw new GameError(`${own.name} must be registered to your first team to be offered.`);
  if (own.age < 18) throw new GameError("Minors cannot be included in a transfer as part-exchange.");
  if (own.contract_end <= state.date) throw new GameError(`${own.name}'s contract has expired.`);
  if (await store.get("SELECT 1 FROM negotiations WHERE player_id = ? AND stage = ANY(?::text[]) LIMIT 1", own.id, OPEN_STAGES))
    throw new GameError(`${own.name} is already involved in other talks.`);
  const profile = JSON.parse(own.profile) as PlayerProfile;
  const user = await clubOf(store, state.clubId);
  const score = marketMoveInterest(own, profile, seller, user, state.date);
  const wage = marketWageOffer(own.wage, score, await buyerGoingRate(store, own, seller));
  if (wage === null) throw new GameError(`${own.name} does not want to join ${seller.name}.`);
  if ((await weeklyWages(store, seller.id)) - target.wage + wage > seller.wage_budget)
    throw new GameError(`${seller.name} cannot fit ${own.name}'s wage into their budget.`);
  const policy = (await clubPolicySnapshot(store, state.date)).get(seller.id);
  const need = policy?.needs[own.position] ?? 0;
  const fit = policy ? clamp(1 - Math.abs(own.ability - policy.level - 2) / 20, 0.3, 1) : 0.7;
  const valuation = Math.round((own.value * (need >= 1 ? 1 : need > 0 ? 0.85 : 0.6) * fit) / 10_000) * 10_000;
  return { playerId: own.id, name: own.name, valuation, wage, years: marketContractYears(own.age) };
}

/** Whether the part-exchange player can still move (checked before the deal registers). */
export async function exchangeIssue(store: Store, exchange: ExchangePart, buyerId: number) {
  const player = await store.get<Player>("SELECT * FROM players WHERE id = ?", exchange.playerId);
  const state = await stateOf(store);
  if (!player || player.club_id !== buyerId || player.parent_club_id || player.role === "Retired" || player.contract_end < state.date)
    return `${exchange.name} is no longer available for the part-exchange.`;
  return null;
}

/**
 * Registers the part-exchange player at the selling club when the main deal completes: his new contract (with the
 * club's release clause), the buyer's asset disposal and the seller's new asset at the agreed valuation, the seller's
 * profit on the whole consideration, registration and history.
 */
export async function completeExchange(store: Store, exchange: ExchangePart, buyer: Club, seller: Club, targetId: number) {
  const state = await stateOf(store);
  const player = (await store.get<Player>("SELECT * FROM players WHERE id = ?", exchange.playerId))!;
  const previous = await currentSpell(store, player.id);
  const contractEnd = contractEndDate(state.date, exchange.years, player.age);
  const clause = await contractReleaseClause(store, seller, player, undefined, false);
  await store.run(
    `UPDATE players SET club_id = ?, squad_club_id = NULL, parent_club_id = NULL, wage = ?, contract_end = ?, role = 'Squad player',
       listed = 0, available_loan = 0, profile = jsonb_set(profile::jsonb, '{contract}',
         (CASE WHEN jsonb_typeof(profile::jsonb -> 'contract') = 'object' THEN profile::jsonb -> 'contract' ELSE '{}'::jsonb END - 'releaseClause')
         || jsonb_build_object('status', 'professional', 'signedDate', ?::text)
         || CASE WHEN ?::double precision IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('releaseClause', ?::double precision) END)::text
     WHERE id = ?`,
    seller.id,
    exchange.wage,
    contractEnd,
    state.date,
    clause,
    clause,
    player.id,
  );
  await store.run("UPDATE buy_back_clauses SET status = 'void' WHERE player_id = ? AND owner_id = ? AND status = 'active'", player.id, buyer.id);
  await sellPlayerAsset(store, buyer.id, player.id, exchange.valuation, state.date);
  if (exchange.valuation > 0) {
    await acquirePlayerAsset(store, seller.id, player.id, exchange.valuation, state.date, contractEnd);
    await recordFinancialItem(store, seller.id, "sale_profit", exchange.valuation);
  }
  await registerSpell(store, player.id, "signing", previous);
  await store.run(
    "INSERT INTO history(season,entity_type,entity_id,date,data) VALUES (?,'transfer',?,?,?)",
    state.season,
    player.id,
    state.date,
    JSON.stringify({ name: player.name, from: buyer.id, to: seller.id, club: seller.name, fee: exchange.valuation, type: "Part-exchange", swapWith: targetId }),
  );
}
