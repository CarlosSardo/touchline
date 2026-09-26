// Youth national teams and tournaments: catalog, eligibility, squad selection, release and exposure rules.
// Facts and ratings: .squad/decisions (Fact Checker, youth national-team tournaments, 2026-09-26). Every number marked
// "tunable" is a heuristic; the catalog rows follow the verified formats unless a comment says otherwise.
import type { AgeGroup, Position } from "../types.ts";

export type NationalAgeGroup = Extract<AgeGroup, "U17" | "U19" | "U20" | "U21">;
export type Confederation = "UEFA" | "CONMEBOL" | "AFC" | "CAF" | "CONCACAF" | "OFC";

/** National teams per association, oldest first: a player plays for the oldest team that selects him in a window. */
export const NATIONAL_TEAM_AGES: readonly AgeGroup[] = ["Senior", "U21", "U20", "U19", "U17"];

export interface YouthQualifyingSpec {
  /** "previous": played in the season before the finals (the result is carried over); "same": before the finals. */
  season: "same" | "previous";
  /** First matchday (MM-DD) of single-venue mini-tournaments, 3 days apart. */
  start?: string;
  /** Fixed matchdays (MM-DD, July–June order) for home-and-away groups in the international windows. */
  matchdays?: string[];
  groupSize: number;
  legs: 1 | 2;
  venue: "single" | "home-away";
}

export interface YouthTournamentSpec {
  id: string;
  name: string;
  confederation: Confederation | "FIFA";
  /** National team that plays it. */
  team: NationalAgeGroup;
  /** Eligible when born on or after 1 January of (edition year − cohort). */
  cohort: number;
  /** Edition year = calendar year of the first matchday; "even"/"odd" editions are held every other year. */
  cycle: "annual" | "even" | "odd";
  /** First matchday (MM-DD). Finals must end by 30 June or start in July (the season rolls over on 1 July). */
  start: string;
  teams: number;
  groupSize: number;
  /** Teams entering the knockout (group winners, runners-up, then best of the rest). */
  advance: number;
  /** CONMEBOL: the top `finalRound` teams play a round-robin final round instead of knockouts. */
  finalRound?: number;
  extraTime: boolean;
  squad: number;
  goalkeepers: number;
  /** FIFA finals: places per confederation, hosts included. */
  slots?: Partial<Record<Confederation, number>>;
  /** Known hosts by edition year (automatic entry). */
  hosts?: Record<number, string[]>;
  qualifying?: YouthQualifyingSpec;
  /** Exposure weight of a deep run (value/visibility), 0–1. */
  prestige: number;
}

// U21 qualifying: groups of six, home and away, over the international windows of the season before the finals.
const U21_QUALIFYING_DATES = ["09-24", "09-27", "10-01", "10-04", "11-12", "11-15", "03-24", "03-27", "06-08", "06-11"];

export const YOUTH_TOURNAMENTS: readonly YouthTournamentSpec[] = [
  {
    id: "fifa-u17-world-cup",
    name: "FIFA U-17 World Cup",
    confederation: "FIFA",
    team: "U17",
    cohort: 17,
    cycle: "annual",
    start: "11-19",
    teams: 48,
    groupSize: 4,
    advance: 32,
    extraTime: false,
    squad: 21,
    goalkeepers: 3,
    slots: { AFC: 9, CAF: 10, CONCACAF: 8, CONMEBOL: 7, OFC: 3, UEFA: 11 },
    hosts: { 2026: ["QA"], 2027: ["QA"], 2028: ["QA"], 2029: ["QA"] },
    prestige: 0.8,
  },
  {
    id: "fifa-u20-world-cup",
    name: "FIFA U-20 World Cup",
    confederation: "FIFA",
    team: "U20",
    cohort: 20,
    cycle: "odd",
    // ⚠️ 2027 dates unconfirmed; Sept–Oct is typical.
    start: "09-27",
    teams: 24,
    groupSize: 4,
    advance: 16,
    extraTime: true,
    squad: 21,
    goalkeepers: 3,
    // 2027: the inter-confederation play-off place goes to the next best AFC/CONMEBOL/OFC/UEFA side (see allocateEntrants).
    slots: { AFC: 5, CAF: 4, CONCACAF: 4, CONMEBOL: 4, OFC: 1, UEFA: 5 },
    hosts: { 2027: ["AZ", "UZ"], 2029: ["AM", "GE"] },
    prestige: 1,
  },
  {
    id: "uefa-u21-euro",
    name: "UEFA European Under-21 Championship",
    confederation: "UEFA",
    team: "U21",
    cohort: 23,
    cycle: "odd",
    // Real finals 17 Jun–4 Jul; moved to 12–27 June so they end before the 1 July rollover.
    start: "06-12",
    teams: 16,
    groupSize: 4,
    advance: 8,
    extraTime: true,
    squad: 23,
    goalkeepers: 3,
    hosts: { 2027: ["AL", "RS"] },
    qualifying: { season: "previous", matchdays: U21_QUALIFYING_DATES, groupSize: 6, legs: 2, venue: "home-away" },
    prestige: 1,
  },
  {
    id: "uefa-u19-euro",
    name: "UEFA European Under-19 Championship",
    confederation: "UEFA",
    team: "U19",
    cohort: 19,
    cycle: "annual",
    // Real finals 28 Jun–11 Jul; played from 2 July so the whole edition sits in one season.
    start: "07-02",
    teams: 8,
    groupSize: 4,
    advance: 4,
    extraTime: true,
    squad: 20,
    goalkeepers: 2,
    hosts: { 2026: ["WAL"] },
    // Elite round: spring of the finals year, single-venue groups of four, winners qualify.
    qualifying: { season: "previous", start: "03-22", groupSize: 4, legs: 1, venue: "single" },
    prestige: 0.7,
  },
  {
    id: "uefa-u17-euro",
    name: "UEFA European Under-17 Championship",
    confederation: "UEFA",
    team: "U17",
    cohort: 17,
    cycle: "annual",
    start: "05-25",
    teams: 8,
    groupSize: 4,
    advance: 4,
    extraTime: false,
    squad: 20,
    goalkeepers: 2,
    hosts: { 2026: ["EE"] },
    // Round 2 League A in spring; the autumn round 1 is folded into it (one mini-tournament stage).
    qualifying: { season: "same", start: "03-22", groupSize: 4, legs: 1, venue: "single" },
    prestige: 0.6,
  },
  // ---- other confederations: finals only, entrants by strength (⚠️ months and sizes where noted).
  {
    id: "afc-u17-asian-cup",
    name: "AFC U17 Asian Cup",
    confederation: "AFC",
    team: "U17",
    cohort: 17,
    cycle: "annual",
    start: "04-03",
    teams: 16,
    groupSize: 4,
    advance: 8,
    extraTime: false,
    squad: 21,
    goalkeepers: 3,
    prestige: 0.5,
  },
  {
    id: "afc-u20-asian-cup",
    name: "AFC U20 Asian Cup",
    confederation: "AFC",
    team: "U20",
    cohort: 20,
    cycle: "odd",
    start: "02-12",
    teams: 16,
    groupSize: 4,
    advance: 8,
    extraTime: true,
    squad: 23,
    goalkeepers: 3,
    hosts: { 2027: ["CN"] },
    prestige: 0.6,
  },
  {
    id: "afc-u23-asian-cup",
    name: "AFC U23 Asian Cup",
    confederation: "AFC",
    team: "U21",
    cohort: 23,
    cycle: "even",
    start: "01-07",
    teams: 16,
    groupSize: 4,
    advance: 8,
    extraTime: true,
    squad: 23,
    goalkeepers: 3,
    prestige: 0.6,
  },
  {
    id: "caf-u17-afcon",
    name: "U-17 Africa Cup of Nations",
    confederation: "CAF",
    team: "U17",
    cohort: 17,
    cycle: "annual",
    start: "03-30",
    teams: 12,
    groupSize: 4,
    advance: 8,
    extraTime: false,
    squad: 21,
    goalkeepers: 3,
    prestige: 0.5,
  },
  {
    id: "caf-u20-afcon",
    name: "U-20 Africa Cup of Nations",
    confederation: "CAF",
    team: "U20",
    cohort: 20,
    cycle: "odd",
    start: "04-27",
    teams: 12,
    groupSize: 4,
    advance: 8,
    extraTime: true,
    squad: 21,
    goalkeepers: 3,
    hosts: { 2027: ["GH"] },
    prestige: 0.6,
  },
  {
    id: "conmebol-sub-17",
    name: "South American U-17 Championship",
    confederation: "CONMEBOL",
    team: "U17",
    cohort: 17,
    cycle: "annual",
    start: "03-27",
    teams: 10,
    groupSize: 5,
    advance: 6,
    finalRound: 6,
    extraTime: false,
    squad: 23,
    goalkeepers: 3,
    prestige: 0.6,
  },
  {
    id: "conmebol-sub-20",
    name: "South American U-20 Championship",
    confederation: "CONMEBOL",
    team: "U20",
    cohort: 20,
    cycle: "odd",
    start: "01-20",
    teams: 10,
    groupSize: 5,
    advance: 6,
    finalRound: 6,
    extraTime: true,
    squad: 23,
    goalkeepers: 3,
    prestige: 0.7,
  },
  {
    id: "concacaf-u17",
    name: "CONCACAF U-17 Championship",
    confederation: "CONCACAF",
    team: "U17",
    cohort: 17,
    cycle: "annual",
    start: "02-07",
    teams: 16,
    groupSize: 4,
    advance: 8,
    extraTime: false,
    squad: 20,
    goalkeepers: 2,
    prestige: 0.4,
  },
  {
    id: "concacaf-u20",
    name: "CONCACAF U-20 Championship",
    confederation: "CONCACAF",
    team: "U20",
    cohort: 20,
    cycle: "even",
    start: "07-25",
    teams: 12,
    groupSize: 4,
    advance: 8,
    extraTime: true,
    squad: 21,
    goalkeepers: 3,
    hosts: { 2026: ["MX"] },
    prestige: 0.5,
  },
  {
    id: "ofc-u16",
    name: "OFC U-16 Championship",
    confederation: "OFC",
    team: "U17",
    cohort: 16,
    cycle: "annual",
    start: "08-10",
    teams: 8,
    groupSize: 4,
    advance: 4,
    extraTime: false,
    squad: 20,
    goalkeepers: 2,
    prestige: 0.3,
  },
  {
    id: "ofc-u19",
    name: "OFC U-19 Championship",
    confederation: "OFC",
    team: "U20",
    cohort: 19,
    cycle: "even",
    start: "08-03",
    teams: 8,
    groupSize: 4,
    advance: 4,
    extraTime: true,
    squad: 20,
    goalkeepers: 2,
    prestige: 0.3,
  },
];

export const YOUTH_TOURNAMENT_BY_NAME = new Map(YOUTH_TOURNAMENTS.map((spec) => [spec.name, spec]));

/** Pre-rebuild league names renamed in place, so old saves keep one league row per tournament. */
export const LEGACY_YOUTH_NAMES: Record<string, string> = {
  "FIFA U17 World Cup": "FIFA U-17 World Cup",
  "FIFA U20 World Cup": "FIFA U-20 World Cup",
  "UEFA U17 Championship": "UEFA European Under-17 Championship",
  "UEFA U19 Championship": "UEFA European Under-19 Championship",
  "AFC U17 Championship": "AFC U17 Asian Cup",
  "AFC U19 Championship": "AFC U20 Asian Cup",
  "CAF U17 Championship": "U-17 Africa Cup of Nations",
  "CAF U19 Championship": "U-20 Africa Cup of Nations",
  "CONMEBOL U17 Championship": "South American U-17 Championship",
  "CONMEBOL U19 Championship": "South American U-20 Championship",
  "CONCACAF U17 Championship": "CONCACAF U-17 Championship",
  "CONCACAF U19 Championship": "CONCACAF U-20 Championship",
  "OFC U17 Championship": "OFC U-16 Championship",
  "OFC U19 Championship": "OFC U-19 Championship",
};

// ------------------------------------------------------------------ calendar arithmetic

/** Date of `monthDay` inside the July–June season starting in `season`. */
export const seasonDay = (season: number, monthDay: string) =>
  `${Number(monthDay.slice(0, 2)) >= 7 ? season : season + 1}-${monthDay}`;

export const editionYear = (spec: Pick<YouthTournamentSpec, "start">, season: number) =>
  Number(seasonDay(season, spec.start).slice(0, 4));

export function heldInSeason(spec: Pick<YouthTournamentSpec, "start" | "cycle">, season: number) {
  if (spec.cycle === "annual") return true;
  return (editionYear(spec, season) % 2 === 0) === (spec.cycle === "even");
}

/** First eligible birth date of an edition (born on or after 1 January of edition year − cohort). */
export const cohortCutoff = (spec: Pick<YouthTournamentSpec, "start" | "cohort">, season: number) =>
  `${editionYear(spec, season) - spec.cohort}-01-01`;

/** Season whose qualifying feeds the finals of `season` (the finals' own season, or the one before). */
export const qualifyingSeason = (spec: YouthTournamentSpec, season: number) =>
  spec.qualifying?.season === "previous" ? season - 1 : season;

/** Seeded choice of a host among members when the catalog names none: strong associations host more often. */
export function editionHosts(
  spec: Pick<YouthTournamentSpec, "id" | "hosts">,
  year: number,
  members: readonly { code: string; reputation: number }[],
): string[] {
  const known = spec.hosts?.[year];
  if (known) return known.filter((code) => members.some((member) => member.code === code));
  if (!members.length) return [];
  const ranked = [...members].sort((left, right) => right.reputation - left.reputation || left.code.localeCompare(right.code));
  const pool = ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 2)));
  let hash = 0;
  for (const char of `${spec.id}:${year}`) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return [pool[hash % pool.length].code];
}

export interface EntrantTeam {
  id: number;
  code: string;
  confederation: string;
  reputation: number;
}

/**
 * Finals entrants: hosts, then FIFA places per confederation (hosts count against their confederation), or the
 * strongest `teams` members. Unfilled places (small worlds) go to the next strongest teams of the four play-off
 * confederations, then anyone.
 */
export function allocateEntrants(spec: YouthTournamentSpec, teams: readonly EntrantTeam[], hosts: readonly string[]) {
  const ranked = [...teams].sort((left, right) => right.reputation - left.reputation || left.id - right.id);
  const chosen: EntrantTeam[] = ranked.filter((team) => hosts.includes(team.code));
  const take = (pool: EntrantTeam[], count: number) => {
    for (const team of pool) {
      if (count <= 0) break;
      if (chosen.includes(team)) continue;
      chosen.push(team);
      count--;
    }
  };
  if (spec.slots)
    for (const [confederation, places] of Object.entries(spec.slots))
      take(
        ranked.filter((team) => team.confederation === confederation),
        places - chosen.filter((team) => team.confederation === confederation).length,
      );
  take(ranked.filter((team) => ["AFC", "CONMEBOL", "OFC", "UEFA"].includes(team.confederation)), spec.teams - chosen.length);
  take(ranked, spec.teams - chosen.length);
  return chosen.slice(0, spec.teams);
}

/**
 * Qualifying advancers: group winners first (best record first), then runners-up, and so on, until `slots` are
 * filled. `groups` lists each group's clubs in table order; `record` ranks across groups.
 */
export function qualifyingAdvancers(
  groups: readonly (readonly number[])[],
  record: (clubId: number) => { points: number; difference: number; scored: number },
  slots: number,
) {
  const advancers: number[] = [];
  const depth = Math.max(0, ...groups.map((group) => group.length));
  for (let place = 0; place < depth && advancers.length < slots; place++) {
    const tier = groups
      .map((group) => group[place])
      .filter((id): id is number => id !== undefined)
      .sort((left, right) => {
        const a = record(left);
        const b = record(right);
        return b.points - a.points || b.difference - a.difference || b.scored - a.scored || left - right;
      });
    advancers.push(...tier.slice(0, slots - advancers.length));
  }
  return advancers;
}

// ------------------------------------------------------------------ selection

export const NATIONAL_DUTY_RULES = {
  /** Squads are named this many days before a team's next fixture; duty ends when none is this close. */
  lookaheadDays: 4,
  /** Days a squad may stay unchecked when nothing international is scheduled (tunable). */
  idleCheckDays: 7,
  /** Senior squad size in the international windows. */
  seniorSquad: 26,
  seniorGoalkeepers: 3,
  /** Qualifying and window squads by team. */
  windowSquad: { U21: 23, U20: 21, U19: 20, U17: 20 } as Record<NationalAgeGroup, number>,
  /** Selection score = ability + potentialWeight × upside + form weight × (form − 6.5) (tunable). */
  potentialWeight: { Senior: 0, U21: 0.15, U20: 0.2, U19: 0.25, U17: 0.35 } as Record<AgeGroup, number>,
  formWeight: 1.5,
  /** Selection needs fitness for the first match (injured until after it = not picked). */
  minimumLines: { DEF: 6, MID: 5, ATT: 4 },
  candidatePool: 60,
  /** Discretionary release (outside the FIFA windows, during the club season) by the player's club role (tunable). */
  releaseByRole: { "Key player": 0.2, Captain: 0.15, "Regular starter": 0.45, default: 0.85 } as Record<string, number>,
  /** Youth-squad players (not in the senior squad) are nearly always released. */
  youthRelease: 0.97,
  /** Elite clubs (reputation ≥ 80) keep more first-team youngsters; prestige tournaments get more players. */
  eliteClubPenalty: 0.15,
  prestigeBonus: 0.15,
  /** Morale cost of a refused call-up (the player wanted to go). */
  refusalMorale: -3,
  /** Fitness lost on the trip home by players who played for their country. */
  travelFitness: 5,
  /** Scouting knowledge every director gets of a finals player with minutes (TV coverage). */
  exposureKnowledge: 25,
} as const;

export const NATIONAL_LINE: Record<Position, "GK" | "DEF" | "MID" | "ATT"> = {
  GK: "GK",
  CB: "DEF",
  LB: "DEF",
  RB: "DEF",
  DM: "MID",
  CM: "MID",
  AM: "MID",
  LW: "ATT",
  RW: "ATT",
  ST: "ATT",
};

export interface SquadCandidate {
  id: number;
  position: Position;
  ability: number;
  potential: number;
  form: number;
}

export const selectionScore = (candidate: SquadCandidate, ageGroup: AgeGroup) =>
  candidate.ability +
  NATIONAL_DUTY_RULES.potentialWeight[ageGroup] * Math.max(0, candidate.potential - candidate.ability) +
  NATIONAL_DUTY_RULES.formWeight * (candidate.form - 6.5);

/**
 * Picks a national squad: the best goalkeepers, then the minimum per line, then the best of the rest. `excluded`
 * holds players already with an older team or withheld by their clubs; the next best candidate replaces them.
 */
export function selectNationalSquad(
  candidates: readonly SquadCandidate[],
  options: { ageGroup: AgeGroup; size: number; goalkeepers: number; excluded?: ReadonlySet<number> },
) {
  const pool = candidates
    .filter((candidate) => !options.excluded?.has(candidate.id))
    .map((candidate) => ({ candidate, score: selectionScore(candidate, options.ageGroup) }))
    .sort((left, right) => right.score - left.score || left.candidate.id - right.candidate.id);
  const chosen = new Set<number>();
  const pick = (line: string, count: number) => {
    for (const { candidate } of pool) {
      if (count <= 0 || chosen.size >= options.size) break;
      if (chosen.has(candidate.id) || NATIONAL_LINE[candidate.position] !== line) continue;
      chosen.add(candidate.id);
      count--;
    }
  };
  pick("GK", options.goalkeepers);
  for (const [line, count] of Object.entries(NATIONAL_DUTY_RULES.minimumLines)) pick(line, count);
  for (const { candidate } of pool) {
    if (chosen.size >= options.size) break;
    if (NATIONAL_LINE[candidate.position] !== "GK") chosen.add(candidate.id);
  }
  return pool.filter(({ candidate }) => chosen.has(candidate.id)).map(({ candidate }) => candidate.id);
}

export type ReleasePolicy = "club policy" | "always" | "mandatory only";

export interface ReleaseInput {
  /** Every matchday inside a FIFA window, or the finals start after the club season: clubs must/do release. */
  mandatory: boolean;
  clubless: boolean;
  /** Player is in his club's senior squad (not a youth-team player). */
  senior: boolean;
  role: string;
  clubReputation: number;
  prestige: number;
  /** Uniform roll in [0, 1), seeded per player and edition. */
  roll: number;
  /** The user's club answers with its own policy (settings.youthRelease). */
  policy?: ReleasePolicy;
}

export function releaseChance(input: Omit<ReleaseInput, "roll" | "policy">) {
  if (input.mandatory || input.clubless) return 1;
  const rules = NATIONAL_DUTY_RULES;
  const base = input.senior ? (rules.releaseByRole[input.role] ?? rules.releaseByRole.default) : rules.youthRelease;
  const elite = input.senior && input.clubReputation >= 80 ? rules.eliteClubPenalty : 0;
  return Math.min(1, Math.max(0, base - elite + rules.prestigeBonus * input.prestige * (input.senior ? 1 : 0)));
}

/** Whether the club lets a called-up player go. FIFA window matches are mandatory; other youth finals are not. */
export function releaseDecision(input: ReleaseInput) {
  if (input.mandatory || input.clubless) return true;
  if (input.policy === "always") return true;
  if (input.policy === "mandatory only") return false;
  return input.roll < releaseChance(input);
}

// ------------------------------------------------------------------ exposure

/** Stage reached → exposure gained (before prestige); modest by design (real growth comes from minutes). */
export const EXPOSURE_BY_STAGE: Record<string, number> = {
  Qualifying: 0,
  "Group stage": 0.01,
  "Final round": 0.03,
  "Round of 32": 0.015,
  "Round of 16": 0.02,
  "Quarter-final": 0.03,
  "Semi-final": 0.04,
  Final: 0.05,
  Champion: 0.06,
};
/** Standout finals performers (average rating, minimum matches) gain extra exposure. */
export const STANDOUT = { rating: 7.3, matches: 3, bonus: 0.02 } as const;
export const EXPOSURE_CAP = 0.08;
/** Exposure fades to nothing over this many days. */
export const EXPOSURE_FADE_DAYS = 540;

export function tournamentExposure(stage: string, prestige: number, standout: boolean) {
  return Math.min(EXPOSURE_CAP, ((EXPOSURE_BY_STAGE[stage] ?? 0.01) + (standout ? STANDOUT.bonus : 0)) * prestige);
}

/** Value multiplier of stored exposure, fading linearly from the day it was earned. */
export function exposureValueFactor(exposure: { value: number; date: string } | undefined, today: string) {
  if (!exposure) return 1;
  const days = (Date.parse(today) - Date.parse(exposure.date)) / 86_400_000;
  const left = Math.max(0, 1 - Math.max(0, days) / EXPOSURE_FADE_DAYS);
  return 1 + Math.min(EXPOSURE_CAP, Math.max(0, exposure.value)) * left;
}

/** Youth national-team reputation after a finals run: champions rise, early exits fall, bounded around the senior side. */
export const TEAM_REPUTATION_BY_STAGE: Record<string, number> = {
  "Group stage": -0.5,
  "Round of 32": 0,
  "Round of 16": 0.25,
  "Final round": 0.75,
  "Quarter-final": 0.5,
  "Semi-final": 1,
  Final: 1.5,
  Champion: 2,
};
export const TEAM_REPUTATION_BAND = 10;

// ------------------------------------------------------------------ API contract (additive; see lead-youth-internationals-contract)

export interface NationalDutyRecord {
  teamId: number;
  countryId: number;
  ageGroup: AgeGroup;
  leagueId: number;
  competition: string;
  /** Squad named on / last known fixture of the team in this competition. */
  from: string;
  until: string;
  cutoff: string;
  mandatory: boolean;
  players: number[];
  withheld: { playerId: number; clubId: number }[];
}

export interface NationalDutyMeta {
  season: number;
  nextCheck?: string;
  squads: NationalDutyRecord[];
  /** International leagues whose finals rewards were applied this season. */
  rewarded?: number[];
}

export interface NationalSquadPlayer {
  id: number;
  name: string;
  position: Position;
  age: number;
  birthDate: string;
  ability: number;
  potential: number;
  clubId: number | null;
  clubName: string | null;
  caps: number;
  goals: number;
  /** "selected" (on duty now), "provisional" (would be picked for the next fixture), "withheld" (club refused). */
  status: "selected" | "provisional" | "withheld";
}

export interface NationalTeamView {
  team: { id: number; name: string; ageGroup: AgeGroup; countryId: number; countryName: string; reputation: number };
  /** Active duty record, or null between windows/tournaments (then `players` is a provisional squad). */
  duty: Omit<NationalDutyRecord, "players" | "withheld"> | null;
  cutoff: string;
  players: NationalSquadPlayer[];
  competitions: { leagueId: number; name: string; phase: string | null; season: number | null; held: boolean }[];
  fixtures: { id: number; date: string; leagueId: number; competition: string; stage: string; homeId: number; awayId: number; homeName: string; awayName: string; status: string; homeGoals: number | null; awayGoals: number | null }[];
}

export interface InternationalsDesk {
  date: string;
  /** Youth tournaments this season (held or not), with their league rows. */
  tournaments: {
    id: string;
    name: string;
    confederation: string;
    ageGroup: NationalAgeGroup;
    leagueId: number | null;
    qualifyingLeagueId: number | null;
    held: boolean;
    edition: number;
    start: string;
    phase: string | null;
    championName: string | null;
  }[];
  /** Players of the user's club family on duty now or withheld by the club. */
  clubPlayers: {
    playerId: number;
    name: string;
    teamId: number;
    teamName: string;
    competition: string;
    from: string;
    until: string;
    status: "selected" | "withheld";
  }[];
  releasePolicy: ReleasePolicy;
}

export interface PlayerCapLine {
  teamId: number;
  teamName: string;
  ageGroup: AgeGroup;
  appearances: number;
  minutes: number;
  goals: number;
  assists: number;
  firstSeason: number;
  lastSeason: number;
}

export interface PlayerCaps {
  playerId: number;
  /** Senior caps first, then youth teams oldest first. */
  teams: PlayerCapLine[];
  total: { appearances: number; goals: number };
  exposure: { value: number; date: string; tournament: string } | null;
}
