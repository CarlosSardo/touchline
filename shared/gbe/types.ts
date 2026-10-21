// Governing Body Endorsement: the assessment returned by the calculator, cached per player and served by the API.

export type GbeCriterion =
  | "international"
  | "domestic_minutes"
  | "continental_minutes"
  | "league_position"
  | "continental_progression"
  | "league_standard";

/**
 * `scored`: points from recorded play; `zero`: the data exists and earns nothing; `no_data`: the input is missing
 * (it still counts 0, as for the FA); `estimate`: derived (at least partly) from the pre-game career estimate.
 */
export type GbeCriterionStatus = "scored" | "zero" | "no_data" | "estimate";

export interface GbeCriterionResult {
  criterion: GbeCriterion;
  points: number;
  detail: string;
  status: GbeCriterionStatus;
  /** FA table and heading, e.g. "Table 2: domestic league minutes". */
  label?: string;
  /** Highest points the table can award (international: 0 when an automatic pass is the only higher outcome). */
  max?: number;
  /** Table 1 automatic pass reached (international only). */
  autoPass?: boolean;
}

export type GbeOutcome = "auto_pass" | "pass" | "panel" | "fail" | "exempt" | "no_data";

export interface GbeAssessment {
  playerId: number;
  asOf: string;
  /** Ruleset id, e.g. "fa-2026-27". */
  ruleset: string;
  rulesetTitle?: string;
  /** The criteria for this date are not published yet; the latest known ones are applied. */
  rulesetAssumed?: boolean;
  source?: { title: string; url: string };
  points: number;
  passMark: number;
  autoPass: boolean;
  outcome: GbeOutcome;
  /** British/Irish etc. */
  exemptReason?: string;
  breakdown: GbeCriterionResult[];
  dataQuality: "complete" | "partial" | "estimate" | "none";
  /** Elite Significant Contribution route (Appendix 1): eligibility only; ESC places are the registering club's. */
  esc?: { eligible: boolean; detail: string };
  /** Plain-language notes on the outcome (panel, ESC, pre-game estimate, assumed ruleset). */
  notes?: string[];
}
