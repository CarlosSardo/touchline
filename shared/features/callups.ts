// Call-ups inside one club family (U17 -> U19 -> B-team -> first team, and back). State lives in meta `callUps`.
import type { AgeGroup, Position } from "../types.ts";

export type CallUpGroup = Extract<AgeGroup, "Senior" | "U19" | "U17">;
/** Team level inside a club family; `BTeam` is a B-team's senior squad. */
export type CallUpLevel = "Senior" | "BTeam" | "U19" | "U17";
export type CallUpReason = "need" | "merit" | "end-of-season" | "instruction";
export type CallUpDuration =
  | { kind: "match" }
  | { kind: "days"; days: number }
  | { kind: "until"; date: string }
  | { kind: "permanent" };

export interface CallUpTeam {
  clubId: number;
  ageGroup: CallUpGroup;
}

/** Active temporary call-up (a permanent move is a plain squad move and is not listed). */
export interface CallUp {
  playerId: number;
  /** Primary position at the time of the call-up. */
  position: Position;
  from: CallUpTeam;
  to: CallUpTeam;
  since: string;
  /** Last day of a `days`/`until` call-up; the target fixture's date for a single match. */
  until: string;
  duration: "match" | "until";
  /** Fixture the single-match call-up is for (auto-return once it is no longer scheduled). */
  fixtureId?: number;
  by: "user" | "coach";
  reason: CallUpReason;
  /** First senior appearance for the first team would be a debut (counts against the season's debut budget once he plays). */
  debut?: boolean;
  /** The director asked for this player's development (`call-up-development`), or the season's academy-prospect floor. */
  development?: boolean;
}

/** Coach suggestion while automatic call-ups are off; expires after `expires`. */
export interface CallUpProposal extends Omit<CallUp, "by" | "since"> {
  id: string;
  expires: string;
  /** Short coach explanation (no amounts). */
  note: string;
}

export interface CallUpMeta {
  season: number;
  active: CallUp[];
  proposals: CallUpProposal[];
  /** First-team debuts played this season (counted when a debut call-up ends after an appearance), by first-team club id. */
  debuts: Record<string, number>;
  /** Players the director sent back early: the coach leaves them alone until the date. */
  vetoes: Record<string, string>;
  /** Fixture whose merit call-ups were already decided, by team key `clubId:ageGroup` (merit is rolled once). */
  reviewed?: Record<string, number>;
  /** First-team call-ups this season by player id (the academy-prospect floor). */
  firstTeamCalls?: Record<string, number>;
  /** Director development requests by player id; the coach's latest verdict in `status`. */
  requests?: Record<string, CallUpDevelopment>;
}

export interface CallUpDevelopment {
  since: string;
  /** Coach's latest verdict, e.g. "First team: 3 fitter options at LW." */
  status?: string;
  /** Date of `status`. */
  checked?: string;
}

export interface CallUpDevelopmentView extends CallUpDevelopment {
  playerId: number;
  player: CallUpPlayerView;
  fromLabel: string;
}

export interface CallUpPlayerView {
  id: number;
  name: string;
  position: Position;
  age: number;
  ability: number;
  potential: number;
  fitness: number;
  injuryUntil: string | null;
}

export interface CallUpView extends CallUp {
  player: CallUpPlayerView;
  fromLabel: string;
  toLabel: string;
}

export interface CallUpProposalView extends CallUpProposal {
  player: CallUpPlayerView;
  fromLabel: string;
  toLabel: string;
}

/** GET /api/call-ups */
export interface CallUpDesk {
  autoCallUps: boolean;
  active: CallUpView[];
  proposals: CallUpProposalView[];
  /** `used` = debuts played + pending debut call-ups; `played` = debuts already made. */
  debutBudgets: { clubId: number; clubName: string; used: number; limit: number; played?: number }[];
  teams: (CallUpTeam & { label: string; level: CallUpLevel })[];
  /** Active development requests (`call-up-development`), at most `CALL_UP_RULES.development.maxRequests`. */
  requests?: CallUpDevelopmentView[];
}

/** POST /api/action { type: "call-up-development", playerId, active } → { message } */
export interface CallUpDevelopmentRequest {
  type: "call-up-development";
  playerId: number;
  active: boolean;
}

/** POST /api/action { type: "call-up", ... } */
export interface CallUpRequest {
  type: "call-up";
  playerId: number;
  clubId: number;
  ageGroup: CallUpGroup;
  duration: CallUpDuration;
}

/** Club standing for the debut budget: top flight split by reputation rank in its league, then tier 2 and below. */
export type DebutStanding = "elite" | "mid" | "bottom" | "second" | "lower";

/**
 * Every tunable rate of the call-up model, in one place. Calibrated against Fact Checker's 2026-09-26 brief
 * (decisions inbox fact-checker-callup-realism.md): most numbers there are heuristics (⚠️), tuned by the pure
 * season probe (server/callup-probe.ts), not real-world statistics.
 */
export const CALL_UP_RULES = {
  /** Matchday squad the coach wants available per line (18 names: 11 + 7). */
  matchday: { GK: 2, DEF: 6, MID: 5, ATT: 4 },
  /** U19 sides make do with a leaner matchday (14 names) before calling up U17 players. */
  youthMatchday: { GK: 2, DEF: 5, MID: 4, ATT: 3 },
  /** Extra outfield cover per line with two fixtures within four days. */
  congestionExtra: 1,
  congestionDays: 4,
  /** Candidates below this fitness, or who played within `restDays`, are not called up. */
  minFitness: 70,
  restDays: 1,
  /**
   * Academy debut (counts against the debut budget and meets the debut gate): a player of at most this age with no
   * senior first-team appearance for any club. Older reserves stepping up are ordinary call-ups.
   */
  debutMaxAge: 21,
  /** The coach looks at fixtures up to this many days ahead (so proposals reach the director before the match). */
  lookaheadDays: 2,
  /** Need call-ups per target fixture. */
  maxNeedPerFixture: 3,
  merit: {
    /** Ability above the target team's median at the player's line. */
    margin: { Senior: 4, BTeam: 0, U19: 2 },
    minForm: 6.9,
    chance: { Senior: 0.2, BTeam: 0.4, U19: 0.06 },
    perFixture: { Senior: 1, BTeam: 1, U19: 2 },
    /** U19 merit age; senior levels (first team, B-team) use the association floor `minSeniorAge`. */
    minAge: { U19: 15 },
    /**
     * Relaxed gate for first-team debutants, top academy prospects and development requests: ability at least this
     * share of the weakest incumbent at his line (Fact Checker's DEBUT_MERIT_GATE) instead of the median margin.
     */
    prospectShareOfWeakest: 0.9,
    /** Merit call-ups last `days` only for a clear edge (margin + this); otherwise the next match (Fact Checker: ~70% single). */
    extendedEdge: 4,
    days: 21,
  },
  endOfSeason: {
    /** The target team's last league rounds (scheduled league fixtures left, today's included). */
    lastRounds: 4,
    /** Chance multipliers: last rounds / final round. The first team only when its position is settled. */
    lastRoundsMult: 2.5,
    finalRoundMult: 3,
    /** Merit margin change in the last rounds (youth teams; the first team only in dead rubbers). */
    marginDelta: -4,
    perFixture: { Senior: 2, BTeam: 2, U19: 2 },
  },
  /** Once the source team's league is over: U19 -> B-team x2, U17 -> U19 x1.5 (by target level). */
  youthSeasonOverMult: { BTeam: 2, U19: 1.5, Senior: 1 },
  /** Clubs with a strong academy (`debutBudget.strongAcademy`) play youngsters up more often (U17 -> U19). */
  strongAcademyMult: { Senior: 1, BTeam: 1, U19: 1.6 },
  /** First-team merit chance by club standing: poorer clubs blood more youth (Fact Checker, ⚠️ heuristic). */
  standingMult: { elite: 1, mid: 1, bottom: 1.3, second: 1.3, lower: 1.8 } as Readonly<Record<DebutStanding, number>>,
  /** Cup ties against lower-tier opposition. */
  cupVsLowerMult: 1.5,
  /** Upper bound of any multiplied per-candidate chance. */
  maxChance: 0.9,
  /**
   * First-team academy debuts per season by club standing (Fact Checker: elite top flight 2-3, mid 2, bottom / tier 2
   * 3, tier 3+ 3-4). A strong academy or a youth philosophy adds 1 (not cumulative) up to `max`; an injury crisis
   * (fit senior outfielders below `crisisBelow` / `severeBelow`) adds 1 / 2 on top of the cap.
   */
  debutBudget: {
    base: { elite: 2, mid: 2, bottom: 3, second: 3, lower: 3 },
    max: { elite: 3, mid: 3, bottom: 3, second: 3, lower: 4 },
    strongAcademy: 80,
    youthPhilosophy: "Develop and sell",
    /** Top-flight reputation rank share: below `eliteShare` elite, at or above `bottomShare` bottom. */
    eliteShare: 0.25,
    bottomShare: 0.75,
    crisisBelow: 16,
    severeBelow: 13,
  },
  /** Hard floor for senior football (first team, B-team) by association code; others `default`. */
  minSeniorAge: { EN: 15, ES: 15, DE: 16, default: 16 } as Readonly<Record<string, number>>,
  /**
   * Debut context in the full engine (user's first team): a debutant is a late substitute (from `subMinute`) when
   * leading by `leadBy`+, in a dead rubber or a cup tie against lower-tier opposition; an injury crisis lifts it.
   */
  debutMatch: { subMinute: 75, leadBy: 2 },
  /** Director development requests: call-up chance multiplier and how many players at once. */
  development: { mult: 2.5, maxRequests: 3 },
  /** Tier 1-2 clubs give each of their top academy prospects a bench call-up in the last league rounds if none yet. */
  prospectFloor: { maxTier: 2, top: 3, lastRounds: 6 },
  /**
   * Per-country B-team eligibility (only rules Fact Checker rated ✅). Italy (Serie C second teams): not with more than
   * `maxTopFlightApps` Serie A appearances. TODO (⚠️, not modelled, no UI claims): Germany 4-game stand-down between a
   * club's teams (relaxed for U23), Netherlands <15 first-team apps outside windows, Spain U23 / U25-pro switch rule,
   * Italy 25-man-list exclusion, England PL2 current over-age count.
   */
  bTeamEligibility: { IT: { maxTopFlightApps: 50 } } as Readonly<Record<string, { maxTopFlightApps: number }>>,
  /** Registered squad caps a call-up may not exceed. */
  squadCaps: { Senior: 32, BTeam: 30, U19: 26, U17: 26 },
  maxDays: 120,
  /** AI clubs (fast model): lineup-only call-ups, no persisted state. */
  ai: {
    /** Fewer available players than this triggers a need check. */
    needPool: 16,
    /** Per-line cover below which an AI side looks at the team below (leaner than the user's coach). */
    minimum: { GK: 2, DEF: 5, MID: 4, ATT: 3 },
    meritChance: { Senior: 0.08, BTeam: 0.25, U19: 0.1 },
    endOfSeasonChance: { Senior: 0.15, BTeam: 0.45, U19: 0.45 },
    maxAdded: 3,
    /** End of season for the fast model: the last rounds of the league (covered-index lookup, no date scan). */
    lateRounds: 4,
  },
} as const;

/**
 * Engine gate for a called-up first-team debutant (MatchPlayer.callUpDebut): `lead` comes on from the 75th minute
 * when leading by two, `open` (dead rubber, cup tie against lower-tier opposition) from the 75th at any score, `hold`
 * (debut budget spent) stays on the bench.
 */
export function debutSubAllowed(gate: "lead" | "open" | "hold", minute: number, lead: number) {
  if (gate === "hold" || minute < CALL_UP_RULES.debutMatch.subMinute) return false;
  return gate === "open" || lead >= CALL_UP_RULES.debutMatch.leadBy;
}
