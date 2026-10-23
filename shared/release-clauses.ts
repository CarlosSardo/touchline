/**
 * Release clauses (cláusula de rescisión): every professional contract at a Spanish club carries one by law (Real
 * Decreto 1006/1985); elsewhere a minority of contracts include a negotiated exit clause. A buyer that pays the clause
 * cannot be refused by the club; the player still agrees personal terms. Amounts are deterministic per player.
 */
export const OPTIONAL_CLAUSE_SHARE = 0.12;

const draw = (playerId: number, salt: number) => (((playerId * 2654435761 + salt * 40503) >>> 0) % 1000) / 1000;

const roundClause = (amount: number) => (amount >= 1_000_000 ? Math.round(amount / 100_000) * 100_000 : Math.round(amount / 10_000) * 10_000);

/**
 * Clause for a contract signed now: Spanish clubs protect prospects with 5-8x their value, established players with
 * 2.5-4.5x and veterans with 1.5-2.5x; negotiated clauses elsewhere are 1.5-3x (they exist to let the player leave).
 */
export function releaseClauseFor(
  player: { id: number; age: number; ability: number; potential: number; value: number },
  spanish: boolean,
) {
  const spread = draw(player.id, 1);
  const prospect = player.age <= 23 && player.potential - player.ability >= 6;
  const multiple = spanish
    ? prospect
      ? 5 + 3 * spread
      : player.age >= 31
        ? 1.5 + spread
        : 2.5 + 2 * spread
    : 1.5 + 1.5 * spread;
  return Math.max(10_000, roundClause(Math.max(100, player.value) * multiple));
}

/** Whether a non-Spanish contract signed now includes a negotiated release clause. */
export const optionalReleaseClause = (playerId: number, salt = 0) => draw(playerId, 7 + salt) < OPTIONAL_CLAUSE_SHARE;
