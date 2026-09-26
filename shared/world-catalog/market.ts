// Transfer-market price level by league nation, relative to the big European leagues (world version 4).
// Applied by valuation(): leagues that pay far less for equal quality than a European league of the same reputation.

/** Market value factor by league nation code; nations not listed price at 1. Calibrated on tier-1 top-10 values. */
export const MARKET_VALUE_FACTOR: Record<string, number> = {
  NL: 0.75,
  BE: 0.75,
  CH: 0.6,
  AT: 0.7,
  DK: 0.8,
  NO: 0.85,
  SCO: 0.45,
  TR: 0.75,
  GR: 0.7,
  BR: 0.85,
  AR: 0.5,
  MX: 0.55,
  SA: 0.7,
  JP: 0.27,
  KR: 0.25,
  CN: 0.3,
  AU: 0.35,
  MA: 0.3,
  EG: 0.3,
  TN: 0.3,
  DZ: 0.3,
};

export const marketValueFactor = (code: string | null | undefined) =>
  (code ? MARKET_VALUE_FACTOR[code] : undefined) ?? 1;
