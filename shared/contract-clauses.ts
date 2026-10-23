import { clamp } from "./rules.ts";

/**
 * Relegation wage-cut clauses: common in lower-division and relegation-threatened top-flight contracts (typically a
 * 25-50% cut), rare at established top-flight clubs. Whether a contract carries one and its size are a deterministic
 * function of the player and the contract club (server/contract-clauses.ts mirrors this in SQL).
 */
export const RELEGATION_CLAUSE = {
  minCut: 0.25,
  maxCut: 0.5,
  /** Top-flight clubs at or above this reputation do not insist on the clause. */
  establishedReputation: 72,
  lowerTierShare: 0.8,
  amateurTier: 5,
  amateurShare: 0.45,
  /** Morale lost when the cut is applied. */
  morale: 6,
} as const;

/** Share of contracts at a club of this tier and reputation that include a relegation wage cut. */
export function relegationClauseShare(tier: number, reputation: number) {
  if (tier <= 1) return clamp((RELEGATION_CLAUSE.establishedReputation - reputation) / 30, 0, 0.85);
  return tier >= RELEGATION_CLAUSE.amateurTier ? RELEGATION_CLAUSE.amateurShare : RELEGATION_CLAUSE.lowerTierShare;
}

/** Uniform draws in [0, 1) from a player and his contract club; the SQL in server/contract-clauses.ts computes the same. */
export function relegationClauseDraws(playerId: number, clubId: number): [presence: number, size: number] {
  return [
    ((playerId * 2654435761 + clubId * 40503) % 1000003) / 1000003,
    ((playerId * 40503 + clubId * 2654435761 + 7) % 999983) / 999983,
  ];
}

/** The relegation wage cut of a contract with this club (25-50% in 5-point steps), or null without the clause. */
export function relegationWageCutFor(playerId: number, clubId: number, tier: number, reputation: number) {
  const [presence, size] = relegationClauseDraws(playerId, clubId);
  if (presence >= relegationClauseShare(tier, reputation)) return null;
  const steps = Math.round((RELEGATION_CLAUSE.maxCut - RELEGATION_CLAUSE.minCut) / 0.05) + 1;
  return Math.round((RELEGATION_CLAUSE.minCut + Math.floor(size * steps) * 0.05) * 100) / 100;
}

/** Contract wording of a player's relegation clause, or null without one. */
export function relegationClauseText(contract?: {
  relegationWageCut?: number | null;
  relegationCutApplied?: { season: number; cut: number };
}) {
  const cut = contract?.relegationWageCut;
  const applied = contract?.relegationCutApplied;
  const terms = cut ? `${Math.round(cut * 100)}% wage reduction on relegation` : null;
  if (!applied) return terms;
  const note = `${Math.round(applied.cut * 100)}% cut applied from ${applied.season}/${String(applied.season + 1).slice(-2)} after relegation`;
  return terms ? `${terms} (${note})` : note;
}
