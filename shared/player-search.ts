/**
 * Numeric player-database ranges, shared by the search API and the Database page: each is an inclusive pair of
 * query parameters `${key}Min` / `${key}Max` over its domain [low, high]. A bound at the edge of the domain
 * restricts nothing, so it is left out of the SQL.
 */
export const PLAYER_SEARCH_RANGES = {
  age: { low: 0, high: 100, integer: true },
  ability: { low: 1, high: 99 },
  potential: { low: 1, high: 99 },
  value: { low: 0, high: 1_000_000_000 },
  wage: { low: 0, high: 1_000_000_000 },
  /** Whole months from today until the contract ends. */
  contractMonths: { low: 0, high: 120, integer: true },
  /** Division of the club's league: 1 is the top flight (reserve leagues are tier 0 and never match). */
  tier: { low: 1, high: 20, integer: true },
  /** Whole centimetres and kilograms (players.height / players.weight). */
  height: { low: 0, high: 230, integer: true },
  weight: { low: 0, high: 200, integer: true },
  /** The attribute chosen by `attribute`. */
  attribute: { low: 0, high: 99 },
  /** The personality trait chosen by `personality`. */
  personality: { low: 0, high: 99 },
  /** Average match rating this season. */
  form: { low: 0, high: 10 },
  appearances: { low: 0, high: 1000, integer: true },
  minutes: { low: 0, high: 100_000, integer: true },
  goals: { low: 0, high: 1000, integer: true },
  assists: { low: 0, high: 1000, integer: true },
} as const satisfies Record<string, { low: number; high: number; integer?: boolean }>;

export type PlayerSearchRange = keyof typeof PLAYER_SEARCH_RANGES;
export const PLAYER_SEARCH_RANGE_KEYS = Object.keys(PLAYER_SEARCH_RANGES) as PlayerSearchRange[];

export interface SearchBounds {
  /** Lower bound, undefined when it restricts nothing. */
  from?: number;
  /** Upper bound, undefined when it restricts nothing. */
  to?: number;
  /** The pair was given as max < min and has been put in order. */
  swapped: boolean;
}

/**
 * Normalizes one range: puts a reversed pair in order, rounds integer bounds inward (integer columns reject
 * fractional parameters, and 17.5–23.9 years means 18–23) and drops a bound at the edge of the domain.
 */
export function searchBounds(key: PlayerSearchRange, min?: number, max?: number): SearchBounds {
  const domain: { low: number; high: number; integer?: boolean } = PLAYER_SEARCH_RANGES[key];
  const swapped = min !== undefined && max !== undefined && min > max;
  let from = swapped ? max : min;
  let to = swapped ? min : max;
  if (domain.integer) {
    if (from !== undefined) from = Math.ceil(from);
    if (to !== undefined) to = Math.floor(to);
  }
  return {
    from: from !== undefined && from > domain.low ? from : undefined,
    to: to !== undefined && to < domain.high ? to : undefined,
    swapped,
  };
}
