// Governing Body Endorsement criteria as data, one ruleset per association and season. A later season's criteria
// are a new entry in GBE_RULESETS; the calculator (calculate.ts) reads only these tables.

/** Table 4 rows: the Last Club's final league position in the Last Season. */
export type GbeFinish =
  | "title"
  | "band1_group"
  | "band1_qualifiers"
  | "band2_group"
  | "band2_qualifiers"
  | "mid_table"
  | "relegation"
  | "promotion";

/** Table 5 rows: the Last Club's continental progression. */
export type GbeStage = "final" | "semi_final" | "quarter_final" | "round_of_16" | "round_of_32" | "group" | "other";

/** A Table 1-3 row: applies from `min` percent (rounded per ¶33); cells by column. */
export interface GbePercentRow<Cell> {
  min: number;
  cells: readonly Cell[];
}

export interface GbeRuleset {
  id: string;
  title: string;
  /** Association whose clubs need the endorsement (registration association code). */
  association: string;
  effectiveFrom: string;
  /** Last day the ruleset is known to apply; later dates reuse it as an assumption. */
  effectiveTo: string;
  source: { title: string; url: string };
  passMark: number;
  /** Exceptions Panel band (¶25): these points may be referred with evidence of exceptional circumstances. */
  panel: readonly [number, number];
  /** Youth Player: born on or after this date (shorter international window, debut row of Table 2). */
  youthBornOnOrAfter: string;
  /** Elite Significant Contribution (Appendix 1): born on or after this date. */
  escBornOnOrAfter: string;
  referenceMonths: number;
  internationalMonths: number;
  internationalYouthMonths: number;
  escMonths: number;
  /** Friendlies count as available international matches when competitive matches are below this share. */
  friendliesBelowCompetitiveShare: number;
  /** Passport groups that are not "Players" under the criteria (British and Irish citizens). */
  exemptPassportGroups: readonly string[];
  /** Leagues (country code and lowest tier) whose clubs may hold a Sponsor's Licence (¶3). */
  sponsorLeagues: readonly { country: string; maxTier: number }[];
  /** League bands 1-5 by `${country code}:${tier}`; every other league is band 6. */
  leagueBands: Readonly<Record<string, number>>;
  /** Continental club competitions in bands 1-2 by catalog id; every other continental competition is band 3. */
  continentalBands: Readonly<Record<string, number>>;
  /** Upper ranks of the Table 1 columns; the last column holds every lower-ranked association. */
  rankColumns: readonly number[];
  table1: readonly GbePercentRow<number | "auto">[];
  table2: readonly GbePercentRow<number>[];
  /** Debut for a Youth Player, by league band (Table 2, last row). */
  youthDebut: readonly number[];
  table3: readonly GbePercentRow<number>[];
  /** Points by league band; null = not applicable (promotion from Band 1). */
  table4: Readonly<Record<GbeFinish, readonly (number | null)[]>>;
  /** Points by continental band. */
  table5: Readonly<Record<GbeStage, readonly number[]>>;
  /** Points by league band of the Current Club. */
  table6: readonly number[];
  /** ESC places by `${country code}:${tier}` and Weighted EQP Minutes Percentage (Appendix 1, Table 1). */
  escPlaces: Readonly<Record<string, readonly { minEqp: number; places: number }[]>>;
}

const band = (bandNumber: number, entries: string) =>
  Object.fromEntries(entries.split(" ").map((key) => [key, bandNumber]));

const ESC_TOP = [
  { minEqp: 35, places: 4 },
  { minEqp: 30, places: 3 },
  { minEqp: 25, places: 2 },
  { minEqp: 20, places: 1 },
];
const ESC_LOWER = [
  { minEqp: 35, places: 2 },
  { minEqp: 30, places: 1 },
];

/** FA Men's Players Points Based System 2026/27 (effective 15 June 2026). */
export const FA_2026_27: GbeRuleset = {
  id: "fa-2026-27",
  title: "FA men's GBE criteria 2026/27",
  association: "EN",
  effectiveFrom: "2026-06-15",
  effectiveTo: "2027-06-14",
  source: {
    title: "The FA: Governing Body Endorsement Requirements for Men's Players, 2026/27",
    url: "https://www.thefa.com/-/media/files/thefaportal/governance-docs/registrations/gbe-2026-27/fa-mens-players-gbe-criteria-202627.ashx",
  },
  passMark: 15,
  panel: [10, 14],
  youthBornOnOrAfter: "2005-01-01",
  escBornOnOrAfter: "2003-01-01",
  referenceMonths: 12,
  internationalMonths: 24,
  internationalYouthMonths: 12,
  escMonths: 24,
  friendliesBelowCompetitiveShare: 0.3,
  exemptPassportGroups: ["GB", "IE"],
  sponsorLeagues: [{ country: "EN", maxTier: 4 }],
  leagueBands: {
    ...band(1, "EN:1 DE:1 ES:1 IT:1 FR:1"),
    ...band(2, "PT:1 NL:1 BE:1 BR:1 EN:2"),
    ...band(3, "US:1 AR:1 MX:1 TR:1 SCO:1"),
    ...band(4, "CZ:1 HR:1 CH:1 ES:2 DE:2 UA:1 GR:1 CO:1 AT:1 DK:1 RU:1 JP:1 FR:2"),
    ...band(5, "RS:1 PL:1 CL:1 UY:1 SE:1 NO:1 IT:2 HU:1 KR:1 AU:1 EN:3"),
  },
  continentalBands: {
    "uefa-champions-league": 1,
    "copa-libertadores": 1,
    "uefa-europa-league": 2,
    "uefa-conference-league": 2,
    "copa-sudamericana": 2,
    "fifa-club-world-cup": 2,
  },
  rankColumns: [10, 20, 30, 50],
  table1: [
    { min: 90, cells: ["auto", "auto", "auto", "auto", 2] },
    { min: 80, cells: ["auto", "auto", "auto", "auto", 1] },
    { min: 70, cells: ["auto", "auto", "auto", "auto", 0] },
    { min: 60, cells: ["auto", "auto", "auto", 10, 0] },
    { min: 50, cells: ["auto", "auto", 10, 8, 0] },
    { min: 40, cells: ["auto", "auto", 9, 7, 0] },
    { min: 30, cells: ["auto", 10, 8, 6, 0] },
    { min: 20, cells: [10, 9, 7, 0, 0] },
    { min: 10, cells: [9, 8, 0, 0, 0] },
    { min: 1, cells: [8, 7, 0, 0, 0] },
  ],
  table2: [
    { min: 90, cells: [12, 10, 8, 6, 4, 2] },
    { min: 80, cells: [11, 9, 7, 5, 3, 1] },
    { min: 70, cells: [10, 8, 6, 4, 2, 0] },
    { min: 60, cells: [9, 7, 5, 3, 1, 0] },
    { min: 50, cells: [8, 6, 4, 2, 0, 0] },
    { min: 40, cells: [7, 5, 3, 1, 0, 0] },
    { min: 30, cells: [6, 4, 2, 0, 0, 0] },
  ],
  youthDebut: [6, 5, 4, 3, 2, 1],
  table3: [
    { min: 90, cells: [10, 5, 2] },
    { min: 80, cells: [9, 4, 1] },
    { min: 70, cells: [8, 3, 0] },
    { min: 60, cells: [7, 2, 0] },
    { min: 50, cells: [6, 1, 0] },
    { min: 40, cells: [5, 0, 0] },
    { min: 30, cells: [4, 0, 0] },
  ],
  table4: {
    title: [6, 5, 4, 3, 2, 1],
    band1_group: [5, 4, 3, 2, 1, 0],
    band1_qualifiers: [4, 3, 2, 1, 0, 0],
    band2_group: [3, 2, 1, 0, 0, 0],
    band2_qualifiers: [2, 1, 0, 0, 0, 0],
    mid_table: [1, 0, 0, 0, 0, 0],
    relegation: [0, 0, 0, 0, 0, 0],
    promotion: [null, 1, 1, 1, 1, 1],
  },
  table5: {
    final: [10, 7, 2],
    semi_final: [9, 6, 1],
    quarter_final: [8, 5, 0],
    round_of_16: [7, 4, 0],
    round_of_32: [6, 3, 0],
    group: [5, 2, 0],
    other: [0, 0, 0],
  },
  table6: [12, 10, 8, 6, 4, 2],
  escPlaces: { "EN:1": ESC_TOP, "EN:2": ESC_TOP, "EN:3": ESC_LOWER, "EN:4": ESC_LOWER },
};

export const GBE_RULESETS: readonly GbeRuleset[] = [FA_2026_27];

const shiftYears = (date: string, years: number) => `${Number(date.slice(0, 4)) + years}${date.slice(4)}`;

/**
 * The ruleset of an association on a date. Before the first known season the earliest applies (assumed); after the
 * last, the latest is reused as an assumption with its dates and age cutoffs moved forward one year per season
 * (the FA reissues the criteria each summer).
 */
export function gbeRulesetFor(date: string, association = "EN"): { ruleset: GbeRuleset; assumed: boolean } | undefined {
  const own = GBE_RULESETS.filter((ruleset) => ruleset.association === association).sort((left, right) =>
    left.effectiveFrom.localeCompare(right.effectiveFrom),
  );
  if (!own.length) return undefined;
  const current = [...own].reverse().find((ruleset) => ruleset.effectiveFrom <= date) ?? own[0];
  if (date <= current.effectiveTo || current !== own.at(-1)) return { ruleset: current, assumed: date < current.effectiveFrom };
  let years = 0;
  while (date > shiftYears(current.effectiveTo, years)) years++;
  return {
    ruleset: {
      ...current,
      effectiveFrom: shiftYears(current.effectiveFrom, years),
      effectiveTo: shiftYears(current.effectiveTo, years),
      youthBornOnOrAfter: shiftYears(current.youthBornOnOrAfter, years),
      escBornOnOrAfter: shiftYears(current.escBornOnOrAfter, years),
    },
    assumed: true,
  };
}

/** League band 1-6 of a senior domestic league (country code and tier); reserve and unlisted leagues are band 6. */
export const gbeLeagueBand = (ruleset: GbeRuleset, countryCode: string | null | undefined, tier: number | null | undefined) =>
  (countryCode && tier ? ruleset.leagueBands[`${countryCode}:${tier}`] : undefined) ?? 6;

/** Continental band 1-3 by catalog competition id. */
export const gbeContinentalBand = (ruleset: GbeRuleset, catalogId: string | null | undefined) =>
  (catalogId ? ruleset.continentalBands[catalogId] : undefined) ?? 3;

/** Whether a club in this league may sponsor a player (¶3: Premier League and EFL clubs only). */
export const gbeSponsorLeague = (ruleset: GbeRuleset, countryCode: string | null | undefined, tier: number | null | undefined) =>
  !!countryCode && !!tier && ruleset.sponsorLeagues.some((entry) => entry.country === countryCode && tier <= entry.maxTier);

/** ESC places of a club by its league and Weighted EQP Minutes Percentage (0 when its league has none). */
export const gbeEscPlaces = (ruleset: GbeRuleset, countryCode: string, tier: number, eqpPercent: number) =>
  ruleset.escPlaces[`${countryCode}:${tier}`]?.find((row) => eqpPercent >= row.minEqp)?.places ?? 0;

/** Game stage names → Table 5 rows (¶43: rounds before the Round of 32 of a knockout-only competition count as groups). */
export function gbeStage(stage: string, knockoutOnly = false): GbeStage {
  if (stage === "Final") return "final";
  if (stage === "Semi-final") return "semi_final";
  if (stage === "Quarter-final") return "quarter_final";
  if (stage === "Round of 16") return "round_of_16";
  if (stage === "Round of 32" || /^Knockout (round )?play-offs?$/.test(stage)) return "round_of_32";
  if (stage === "League phase" || stage === "Group stage") return "group";
  if (knockoutOnly && /^Round of \d+$/.test(stage)) return "group";
  return "other";
}

export const GBE_STAGE_ORDER: readonly GbeStage[] = ["other", "group", "round_of_32", "round_of_16", "quarter_final", "semi_final", "final"];

export const GBE_STAGE_LABEL: Readonly<Record<GbeStage, string>> = {
  final: "final",
  semi_final: "semi-finals",
  quarter_final: "quarter-finals",
  round_of_16: "round of 16",
  round_of_32: "round of 32 / knockout play-offs",
  group: "group stage / league phase",
  other: "no group stage",
};

export const GBE_FINISH_LABEL: Readonly<Record<GbeFinish, string>> = {
  title: "title winner",
  band1_group: "qualified for the group stage of a Band 1 continental competition",
  band1_qualifiers: "qualified for the qualifiers of a Band 1 continental competition",
  band2_group: "qualified for the group stage of a Band 2 continental competition",
  band2_qualifiers: "qualified for the qualifiers of a Band 2 continental competition",
  mid_table: "mid-table",
  relegation: "relegated",
  promotion: "promoted",
};
