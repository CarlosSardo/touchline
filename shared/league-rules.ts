// Pure domestic-league planning (world v4, architecture §4): formats, splits, play-offs, promotion/relegation.
import { addDays, internationalBreak } from "./rules.ts";
import type { Standing } from "./types.ts";
import type {
  ChampionshipPlayoffSpec,
  DomesticFootballSpec,
  LeagueSplitSpec,
  LeagueStatus,
  LeagueTierSpec,
  MovementPlayoffSpec,
  TierBoundarySpec,
} from "./world-catalog/types.ts";

export const DEFAULT_TIEBREAKERS = ["Points", "Goal difference", "Goals scored"];

/** Real ranking criteria that differ from the default (2026/27 regulations: RFEF, FIGC, FFF Ligue 3, MLS). */
export const LEAGUE_TIEBREAKERS: Readonly<Record<string, readonly string[]>> = {
  "ES:1": ["Points", "Head-to-head points", "Head-to-head goal difference", "Goal difference", "Goals scored"],
  "ES:2": ["Points", "Head-to-head points", "Head-to-head goal difference", "Goal difference", "Goals scored"],
  "IT:1": ["Points", "Head-to-head points", "Head-to-head goal difference", "Goal difference", "Goals scored"],
  "FR:3": ["Points", "Head-to-head points", "Head-to-head goal difference", "Goal difference", "Goals scored"],
  "US:1": ["Points", "Wins", "Goal difference", "Goals scored"],
};

/** Ranking criteria of a league by catalog key (`L:ES:1`), default points, goal difference, goals scored. */
export const leagueTiebreakers = (catalogKey: string): string[] => [
  ...(LEAGUE_TIEBREAKERS[catalogKey.replace(/^L:/, "")] ?? DEFAULT_TIEBREAKERS),
];

/**
 * Goals per match relative to the engine's reference (~2.75): approximate long-run top-flight averages
 * (2019/20–2024/25); second tiers score ~7% less, lower tiers ~3% less. Unlisted nations use 1.
 */
const NATION_GOAL_FACTOR: Readonly<Record<string, number>> = {
  DE: 1.12,
  NL: 1.14,
  EN: 1.04,
  NO: 1.08,
  CH: 1.08,
  AT: 1.08,
  BE: 1.04,
  US: 1.08,
  IT: 0.98,
  FR: 0.99,
  ES: 0.93,
  PT: 0.94,
  AR: 0.84,
  BR: 0.92,
  GR: 0.88,
};
export function matchGoalFactor(nationCode: string | undefined, tier: number | undefined) {
  const nation = (nationCode && NATION_GOAL_FACTOR[nationCode]) || 1;
  return nation * (!tier || tier <= 1 ? 1 : tier === 2 ? 0.93 : 0.97);
}

/** Senior league.data snapshot written at generation and read by calendar, qualification and rollover. */
export interface SeniorLeagueData {
  worldVersion: 4;
  catalogKey: string;
  shortName: string;
  status: LeagueStatus;
  roundRobins: number;
  conferences?: string[];
  interConference?: number;
  split?: LeagueSplitSpec;
  championship?: ChampionshipPlayoffSpec;
  closed: boolean;
  /** Total places up / down (automatic plus play-off), for compatibility and UI zones. */
  promotion: number;
  relegation: number;
  /** Boundary with the tier above (this league is the lower tier) and below (this league is the upper tier). */
  movementUp: TierBoundarySpec | null;
  movementDown: TierBoundarySpec | null;
  bTeamsAllowed: boolean;
  targetFirstTeams: number;
  tiebreakers: string[];
}

export const placesUp = (boundary: TierBoundarySpec) =>
  boundary.promoted +
  (boundary.playoffs ?? []).reduce(
    (total, playoff) =>
      total +
      (playoff.type === "promotion"
        ? playoff.places
        : playoff.type === "cross-tier"
          ? playoff.upperPositions.length
          : 0),
    0,
  );
export const placesDown = (boundary: TierBoundarySpec) =>
  boundary.relegated +
  (boundary.playoffs ?? []).reduce(
    (total, playoff) =>
      total +
      (playoff.type === "relegation"
        ? playoff.places
        : playoff.type === "cross-tier"
          ? playoff.upperPositions.length
          : 0),
    0,
  );

/** Builds the league.data snapshot of one own tier (same catalogKey format as world-catalog leagueKey). */
export function seniorLeagueData(
  code: string,
  football: Pick<DomesticFootballSpec, "movement" | "reserves">,
  tier: LeagueTierSpec,
): SeniorLeagueData {
  const up = football.movement.find((boundary) => boundary.upper === tier.tier - 1) ?? null;
  const down = football.movement.find((boundary) => boundary.upper === tier.tier) ?? null;
  const pyramid =
    football.reserves.mode === "pyramid" ? football.reserves.pyramid : undefined;
  return {
    worldVersion: 4,
    catalogKey: `L:${code}:${tier.tier}`,
    shortName: tier.shortName,
    status: tier.status,
    roundRobins: tier.roundRobins ?? 2,
    ...(tier.conferences && tier.conferences.length > 1
      ? { conferences: [...tier.conferences] }
      : {}),
    ...(tier.interConference ? { interConference: tier.interConference } : {}),
    ...(tier.split ? { split: tier.split } : {}),
    ...(tier.championship ? { championship: tier.championship } : {}),
    closed: Boolean(tier.closed),
    promotion: up ? placesUp(up) : 0,
    relegation: down ? placesDown(down) : 0,
    movementUp: up,
    movementDown: down,
    bTeamsAllowed: Boolean(pyramid && tier.tier >= pyramid.highestTier),
    targetFirstTeams: tier.size - (tier.bTeams ?? 0),
    tiebreakers: leagueTiebreakers(`${code}:${tier.tier}`),
  };
}

/** Reads a senior snapshot, deriving automatic boundaries for pre-v4 data (promotion/relegation counts only). */
export function readLeagueData(
  raw: string | Record<string, unknown>,
  tier: number,
  neighbours: { above?: Record<string, unknown>; below?: Record<string, unknown> } = {},
): SeniorLeagueData {
  const data = (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<SeniorLeagueData> &
    Record<string, unknown>;
  const count = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
  };
  const legacy = (upper: number, relegation: unknown, promotion: unknown): TierBoundarySpec => {
    const moves = Math.min(count(relegation, 2), count(promotion, 2));
    return { upper, promoted: moves, relegated: moves };
  };
  const movementUp =
    data.movementUp !== undefined
      ? data.movementUp
      : tier > 1 && neighbours.above
        ? legacy(tier - 1, neighbours.above.relegation, data.promotion)
        : null;
  const movementDown =
    data.movementDown !== undefined
      ? data.movementDown
      : neighbours.below
        ? legacy(tier, data.relegation, neighbours.below.promotion)
        : null;
  return {
    worldVersion: 4,
    catalogKey: String(data.catalogKey ?? ""),
    shortName: String(data.shortName ?? ""),
    status: (data.status as LeagueStatus) ?? "professional",
    roundRobins: [1, 2, 3, 4].includes(Number(data.roundRobins)) ? Number(data.roundRobins) : 2,
    ...(Array.isArray(data.conferences) && data.conferences.length > 1
      ? { conferences: data.conferences.map(String) }
      : {}),
    ...(Number(data.interConference) > 0 ? { interConference: Number(data.interConference) } : {}),
    ...(data.split?.groups?.length ? { split: data.split } : {}),
    ...(data.championship ? { championship: data.championship } : {}),
    closed: data.closed === true,
    promotion: count(data.promotion, movementUp ? placesUp(movementUp) : 0),
    relegation: count(data.relegation, movementDown ? placesDown(movementDown) : 0),
    movementUp,
    movementDown,
    bTeamsAllowed: data.bTeamsAllowed !== false,
    targetFirstTeams: count(data.targetFirstTeams, 0),
    // Catalog rules win over the snapshot, so older saves rank with the real criteria too.
    tiebreakers: LEAGUE_TIEBREAKERS[String(data.catalogKey ?? "").replace(/^L:/, "")]
      ? leagueTiebreakers(String(data.catalogKey))
      : Array.isArray(data.tiebreakers)
        ? data.tiebreakers.map(String)
        : [...DEFAULT_TIEBREAKERS],
  };
}

// ------------------------------------------------------------ schedules

const rounds = (teams: number, cycles: number) =>
  (teams % 2 === 0 ? teams - 1 : teams) * cycles;

/** Base matchdays: round robins within the largest conference plus inter-conference games. */
export const baseMatchdays = (
  size: number,
  roundRobins = 2,
  conferences = 0,
  interConference = 0,
) =>
  rounds(conferences > 1 ? Math.ceil(size / conferences) : size, roundRobins) +
  (conferences > 1 ? interConference : 0);

/** Longest split group schedule. */
export const splitMatchdays = (split: LeagueSplitSpec | undefined) =>
  Math.max(
    0,
    ...(split?.groups ?? []).map((group) =>
      rounds(group.positions[1] - group.positions[0] + 1, group.roundRobins),
    ),
  );

/** Matchdays of a round-robin title play-off (0 for knockout play-offs). */
export function miniLeagueRounds(
  championship: ChampionshipPlayoffSpec | undefined,
  conferences = 1,
) {
  if (championship?.format !== "round-robin") return 0;
  const [from, to] = championship.positions;
  const clubs = (to - from + 1) * (championship.perConference ? Math.max(1, conferences) : 1);
  return rounds(clubs, championship.roundRobins ?? 2);
}

/**
 * Circle-method round robin (Berger tables): every pair meets once per cycle, home/away alternate by cycle and each
 * team's home count per cycle differs by at most one. Odd fields get a bye each round.
 */
export function roundRobinRounds<Team>(
  teams: readonly Team[],
  cycles = 2,
): [Team, Team][][] {
  if (teams.length < 2) return [];
  const list: (Team | null)[] = [...teams];
  if (list.length % 2) list.push(null);
  const size = list.length;
  const rotating = size - 1;
  const fixed = list[rotating];
  const single: [Team, Team][][] = [];
  for (let round = 0; round < rotating; round++) {
    const pairs: [Team, Team][] = [];
    const add = (home: Team | null, away: Team | null) => {
      if (home !== null && away !== null) pairs.push([home, away]);
    };
    if (round % 2 === 0) add(list[round], fixed);
    else add(fixed, list[round]);
    for (let offset = 1; offset < size / 2; offset++) {
      const first = list[(round + offset) % rotating];
      const second = list[(round - offset + rotating) % rotating];
      if (offset % 2) add(first, second);
      else add(second, first);
    }
    single.push(pairs);
  }
  const schedule: [Team, Team][][] = [];
  for (let cycle = 0; cycle < cycles; cycle++)
    for (const pairs of single)
      schedule.push(
        pairs.map(([home, away]) =>
          cycle % 2 === 0 ? [home, away] : [away, home],
        ),
      );
  return schedule;
}

/**
 * Base league rounds: every conference plays its round robins on the same matchdays, then `interConference` rounds
 * pair clubs across conferences with rotating opponents and alternating venues. One group is a plain round robin.
 */
export function baseSchedule(
  groups: readonly (readonly number[])[],
  roundRobins = 2,
  interConference = 0,
): [number, number][][] {
  const perGroup = groups.map((group) => roundRobinRounds(group, roundRobins));
  const length = Math.max(0, ...perGroup.map((rounds) => rounds.length));
  const schedule = Array.from({ length }, (_, round) =>
    perGroup.flatMap((rounds) => rounds[round] ?? []),
  );
  if (groups.length < 2 || interConference <= 0) return schedule;
  const pairings = roundRobinRounds(groups.map((_, index) => index), 1);
  for (let round = 0; round < interConference; round++) {
    const shift = Math.floor(round / pairings.length);
    const pairs: [number, number][] = [];
    for (const [first, second] of pairings[round % pairings.length]) {
      const left = groups[first];
      const right = groups[second];
      for (let index = 0; index < Math.min(left.length, right.length); index++) {
        const home = left[index];
        const away = right[(index + shift) % right.length];
        pairs.push(shift % 2 === 0 ? [home, away] : [away, home]);
      }
    }
    schedule.push(pairs);
  }
  return schedule;
}

/** Monday-based weekday helpers on ISO dates (UTC noon). */
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const nextWeekday = (date: string, day: number) => {
  let next = date;
  while (weekday(next) !== day) next = addDays(next, 1);
  return next;
};

export interface LeagueDateOptions {
  /** First possible matchday (default Saturday on/after 8 August). */
  from?: string;
  /** Last possible matchday (default 17 May, leaving late May and late June for play-offs). */
  to?: string;
  /** Senior club football avoids international windows. */
  avoidBreaks?: boolean;
  /** Inclusive ISO date ranges without league football (winter breaks). */
  breaks?: [string, string][];
  /** Single ISO dates kept free (1 May in Germany). */
  blocked?: string[];
}

interface LeagueCalendarSpec {
  /** MM-DD of the opening weekend and the last matchday. */
  start?: string;
  end?: string;
  winterBreak?: [string, string];
  blocked?: string[];
}

/** 2026/27 framework calendars (Premier League, LaLiga, Serie A, DFB Rahmenterminkalender, Eredivisie). */
export const LEAGUE_CALENDARS: Readonly<Record<string, LeagueCalendarSpec>> = {
  "EN:1": { start: "08-21", end: "05-30" },
  "ES:1": { start: "08-15", end: "05-30" },
  "IT:1": { start: "08-22", end: "05-30" },
  "DE:1": { start: "08-28", end: "05-22", winterBreak: ["12-21", "01-08"], blocked: ["05-01"] },
  "DE:2": { start: "08-07", winterBreak: ["12-21", "01-14"], blocked: ["05-01"] },
  "DE:3": { start: "08-07", winterBreak: ["12-21", "01-14"], blocked: ["05-01"] },
  "NL:1": { start: "08-07", end: "05-23" },
};

const inSeason = (season: number, monthDay: string) =>
  `${Number(monthDay.slice(0, 2)) >= 7 ? season : season + 1}-${monthDay}`;

/** Date options of one senior league (catalog key `L:DE:1`); unlisted leagues keep the defaults. */
export function leagueDateOptions(catalogKey: string, season: number): LeagueDateOptions {
  const spec = LEAGUE_CALENDARS[catalogKey.replace(/^L:/, "")];
  if (!spec) return {};
  return {
    ...(spec.start ? { from: inSeason(season, spec.start) } : {}),
    ...(spec.end ? { to: inSeason(season, spec.end) } : {}),
    ...(spec.winterBreak
      ? { breaks: [[inSeason(season, spec.winterBreak[0]), inSeason(season, spec.winterBreak[1])]] }
      : {}),
    ...(spec.blocked ? { blocked: spec.blocked.map((day) => inSeason(season, day)) } : {}),
  };
}

/**
 * Matchday dates for one season: Saturdays first, then Wednesday rounds spread evenly when there are more matchdays
 * than weekends. Dates are strictly increasing and at least three days apart; at most 46 are ever needed.
 */
export function leagueDates(
  season: number,
  count: number,
  options: LeagueDateOptions = {},
): string[] {
  if (count <= 0) return [];
  const from = options.from ?? nextWeekday(`${season}-08-08`, 6);
  const to = options.to ?? `${season + 1}-05-17`;
  const avoid = options.avoidBreaks !== false;
  const free = (date: string) =>
    (!avoid || !internationalBreak(date)) &&
    date.slice(5) !== "12-25" &&
    !options.blocked?.includes(date) &&
    !options.breaks?.some(([first, last]) => date >= first && date <= last);
  const weekends: string[] = [];
  for (let date = nextWeekday(from, 6); date <= to; date = addDays(date, 7))
    if (free(date)) weekends.push(date);
  if (count <= weekends.length) {
    return Array.from(
      { length: count },
      (_, index) => weekends[Math.floor((index * weekends.length) / count)],
    );
  }
  const midweeks: string[] = [];
  for (let date = nextWeekday(from, 3); date <= to; date = addDays(date, 7))
    if (free(date) && date.slice(5) !== "12-23") midweeks.push(date);
  const needed = count - weekends.length;
  const chosen = new Set<string>();
  for (let index = 0; index < needed && index < midweeks.length; index++)
    chosen.add(
      midweeks[Math.min(midweeks.length - 1, Math.floor(((index + 0.5) * midweeks.length) / needed))],
    );
  for (const date of midweeks) {
    if (chosen.size >= needed) break;
    chosen.add(date);
  }
  return [...weekends, ...chosen].sort().slice(0, count);
}

/** Play-off dates after `after` (exclusive): every `gap` days up to 30 June, skipping the June window for seniors. */
export function postseasonDates(
  season: number,
  after: string,
  gap = 3,
  avoidBreaks = true,
): string[] {
  const dates: string[] = [];
  let date = addDays(after, gap);
  const end = `${season + 1}-06-30`;
  while (date <= end) {
    if (avoidBreaks && internationalBreak(date)) {
      date = addDays(date, 1);
      continue;
    }
    dates.push(date);
    date = addDays(date, gap);
  }
  return dates;
}

/** Base-round dates plus the split-round dates that follow them, from one strictly increasing season list. */
export function regularSeasonDates(
  season: number,
  base: number,
  split: number,
  options: LeagueDateOptions = {},
) {
  const dates = leagueDates(season, base + split, options);
  return { base: dates.slice(0, base), split: dates.slice(base) };
}

// --------------------------------------------------------------- tables

export type RankableRow = Pick<Standing, "club_id" | "points" | "gf" | "ga" | "group_name"> & {
  wins?: number;
};

export const compareStandings = (left: RankableRow, right: RankableRow) =>
  right.points - left.points ||
  right.gf - right.ga - (left.gf - left.ga) ||
  right.gf - left.gf ||
  left.club_id - right.club_id;

/** A played league match, for head-to-head criteria. */
export interface LeagueResult {
  home_id: number;
  away_id: number;
  home_goals: number | null;
  away_goals: number | null;
}

export interface RankOptions {
  /** Criteria in order (see LEAGUE_TIEBREAKERS); omitted = points, goal difference, goals scored. */
  tiebreakers?: readonly string[];
  results?: readonly LeagueResult[];
}

export const needsHeadToHead = (tiebreakers: readonly string[] | undefined) =>
  Boolean(tiebreakers?.some((criterion) => criterion.startsWith("Head-to-head")));

/** Sorts rows by the league's criteria; head-to-head criteria use matches among the clubs tied on points. */
function sortByCriteria<Row extends RankableRow>(rows: Row[], options: RankOptions): Row[] {
  const criteria = options.tiebreakers ?? DEFAULT_TIEBREAKERS;
  if (!criteria.some((criterion) => criterion !== "Points" && !DEFAULT_TIEBREAKERS.includes(criterion)))
    return rows.sort(compareStandings);
  const sorted = [...rows].sort((left, right) => right.points - left.points);
  const ranked: Row[] = [];
  for (let start = 0; start < sorted.length; ) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].points === sorted[start].points) end++;
    const block = sorted.slice(start, end);
    const ids = new Set(block.map((row) => row.club_id));
    const mini = new Map(block.map((row) => [row.club_id, { points: 0, difference: 0, scored: 0 }]));
    if (block.length > 1 && needsHeadToHead(criteria))
      for (const match of options.results ?? []) {
        if (!ids.has(match.home_id) || !ids.has(match.away_id) || match.home_goals === null || match.away_goals === null)
          continue;
        const home = mini.get(match.home_id)!;
        const away = mini.get(match.away_id)!;
        home.scored += match.home_goals;
        away.scored += match.away_goals;
        home.difference += match.home_goals - match.away_goals;
        away.difference += match.away_goals - match.home_goals;
        home.points += match.home_goals > match.away_goals ? 3 : match.home_goals === match.away_goals ? 1 : 0;
        away.points += match.away_goals > match.home_goals ? 3 : match.home_goals === match.away_goals ? 1 : 0;
      }
    const value = (row: Row, criterion: string) => {
      const own = mini.get(row.club_id)!;
      switch (criterion) {
        case "Head-to-head points":
          return own.points;
        case "Head-to-head goal difference":
          return own.difference;
        case "Head-to-head goals scored":
          return own.scored;
        case "Goal difference":
          return row.gf - row.ga;
        case "Goals scored":
          return row.gf;
        case "Wins":
          return row.wins ?? 0;
        default:
          return 0;
      }
    };
    block.sort((left, right) => {
      for (const criterion of criteria) {
        const difference = value(right, criterion) - value(left, criterion);
        if (difference) return difference;
      }
      return compareStandings(left, right);
    });
    ranked.push(...block);
    start = end;
  }
  return ranked;
}

/** Final ranking: split groups keep their fixed order (top group first), then the league's criteria. */
export function rankTable<Row extends RankableRow>(
  rows: readonly Row[],
  split?: LeagueSplitSpec,
  options: RankOptions = {},
): Row[] {
  const order = new Map((split?.groups ?? []).map((group, index) => [group.name, index]));
  const groupIndex = (row: RankableRow) => order.get(row.group_name) ?? order.size;
  const groups = new Map<number, Row[]>();
  for (const row of rows) groups.set(groupIndex(row), [...(groups.get(groupIndex(row)) ?? []), row]);
  return [...groups.keys()].sort((left, right) => left - right).flatMap((key) => sortByCriteria(groups.get(key)!, options));
}

/** Rank within one conference (or the whole table without conferences). */
export function conferenceTables<Row extends RankableRow>(
  rows: readonly Row[],
  conferences: readonly string[] = [],
  options: RankOptions = {},
): Map<string, Row[]> {
  const tables = new Map<string, Row[]>();
  for (const row of sortByCriteria([...rows], options)) {
    const key = conferences.length > 1 ? row.group_name : "";
    tables.set(key, [...(tables.get(key) ?? []), row]);
  }
  return tables;
}

export interface SplitAssignment {
  name: string;
  clubs: number[];
  roundRobins: 1 | 2;
  points: "full" | "halved";
}

/** Split groups from the base table (positions are 1-based ranks after the base round robins). */
export function planSplit(
  ranked: readonly RankableRow[],
  split: LeagueSplitSpec,
): SplitAssignment[] {
  return split.groups.map((group) => ({
    name: group.name,
    clubs: ranked
      .slice(group.positions[0] - 1, group.positions[1])
      .map((row) => row.club_id),
    roundRobins: group.roundRobins,
    points: group.points,
  }));
}

/** Points carried into a "halved" split group (rounded up). */
export const halvedPoints = (points: number) => Math.ceil(points / 2);

/** Balanced conference placement: entering clubs take the conference places left by departing clubs. */
export function assignConferences(
  conferences: readonly string[],
  current: ReadonlyMap<number, string>,
  leaving: readonly number[],
  entering: readonly number[],
): Map<number, string> {
  const result = new Map(current);
  const vacancies = leaving.flatMap((clubId) => {
    const conference = result.get(clubId);
    result.delete(clubId);
    return conference ? [conference] : [];
  });
  for (const clubId of entering) {
    let conference = vacancies.shift();
    if (!conference) {
      const counts = conferences.map(
        (name) => [...result.values()].filter((value) => value === name).length,
      );
      conference = conferences[counts.indexOf(Math.min(...counts))];
    }
    result.set(clubId, conference);
  }
  return result;
}

// ------------------------------------------------------------ play-offs

export type PlayoffKind = "promotion" | "relegation" | "cross-tier" | "championship";

export interface PlayoffRound {
  /** [better seed, worse seed]: the better seed hosts single legs and second legs. */
  pairs: [number, number][];
  legs: 1 | 2;
  neutral: boolean;
  /** Last round of the play-off with a single tie. */
  final: boolean;
}

export interface PlayoffResult {
  /** promotion: promoted; relegation: safe; cross-tier: in the upper tier next season; championship: [champion]. */
  winners: number[];
  /** promotion: stay down; relegation: relegated; cross-tier: in the lower tier next season. */
  losers: number[];
}

export interface PlayoffState {
  kind: PlayoffKind;
  places: number;
  legs: 1 | 2;
  finalLegs: 1 | 2;
  neutralFinal: boolean;
  /** Every participant, best seed first (cross-tier: upper-tier clubs first, then lower-tier clubs). */
  seeds: number[];
  /** Winner track (promotion, championship, cross-tier challengers) or at-risk track (relegation). */
  alive: number[];
  upper?: number[];
  /** Championship per conference: each group is reduced to one club before the final rounds. */
  groups?: number[][];
  round: number;
  pending?: PlayoffRound;
  result?: PlayoffResult;
}

export interface PlayoffInput {
  kind: PlayoffKind;
  places?: number;
  legs: 1 | 2;
  finalLegs?: 1 | 2;
  neutralFinal?: boolean;
  seeds: readonly number[];
  upper?: readonly number[];
  groups?: readonly (readonly number[])[];
}

/** Ties that reduce `alive` (best first) towards `target` survivors, giving byes to the best seeds. */
export function reduceBracket(alive: readonly number[], target: number): [number, number][] {
  const count = alive.length;
  if (count <= target || target < 1) return [];
  const full = target * 2 ** Math.floor(Math.log2(count / target));
  const ties = count === full ? count / 2 : count - full;
  const players = alive.slice(count - ties * 2);
  return Array.from({ length: ties }, (_, index) => [
    players[index],
    players[players.length - 1 - index],
  ]);
}

function nextRound(state: PlayoffState): PlayoffState {
  const order = new Map(state.seeds.map((clubId, index) => [clubId, index]));
  const bySeed = (values: Iterable<number>) =>
    [...values].sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
  const round = (pairs: [number, number][], last: boolean, finalLegs = state.finalLegs): PlayoffState => {
    const final = last && pairs.length === 1;
    return {
      ...state,
      pending: {
        pairs,
        legs: final ? finalLegs : state.legs,
        neutral: final && state.neutralFinal,
        final,
      },
    };
  };
  const done = (winners: number[]): PlayoffState => ({
    ...state,
    pending: undefined,
    result: {
      winners: bySeed(winners),
      losers: bySeed(state.seeds.filter((clubId) => !winners.includes(clubId))),
    },
  });
  if (state.kind === "relegation") {
    const atRisk = bySeed(state.alive);
    if (atRisk.length <= state.places)
      return done(state.seeds.filter((clubId) => !atRisk.includes(clubId)));
    const ties = Math.min(Math.floor(atRisk.length / 2), atRisk.length - state.places);
    const players = atRisk.slice(atRisk.length - ties * 2);
    const pairs = Array.from({ length: ties }, (_, index): [number, number] => [
      players[index],
      players[players.length - 1 - index],
    ]);
    return round(pairs, atRisk.length - ties === state.places, state.legs);
  }
  if (state.kind === "cross-tier") {
    const upper = state.upper ?? [];
    const challengers = bySeed(state.alive);
    if (challengers.length > upper.length)
      return round(reduceBracket(challengers, upper.length), false);
    const pairs = upper
      .slice(0, challengers.length)
      .map((clubId, index): [number, number] => [
        clubId,
        challengers[challengers.length - 1 - index],
      ]);
    // Upper-tier clubs without a challenger keep their place.
    if (!pairs.length) return done([...upper]);
    return { ...round(pairs, true), alive: challengers };
  }
  if (state.groups?.some((group) => group.length > 1)) {
    const pairs = state.groups.flatMap((group) => reduceBracket(bySeed(group), 1));
    return round(pairs, false);
  }
  const alive = state.groups ? bySeed(state.groups.flat()) : bySeed(state.alive);
  const target = state.kind === "championship" ? 1 : state.places;
  if (alive.length <= target) return done(alive);
  const pairs = reduceBracket(alive, target);
  return round(pairs, alive.length - pairs.length === target);
}

export function createPlayoff(input: PlayoffInput): PlayoffState {
  const upper = [...(input.upper ?? [])];
  const seeds = [...upper, ...input.seeds.filter((clubId) => !upper.includes(clubId))];
  const state: PlayoffState = {
    kind: input.kind,
    places:
      input.kind === "championship"
        ? 1
        : input.kind === "cross-tier"
          ? upper.length
          : Math.max(1, input.places ?? 1),
    legs: input.legs,
    finalLegs: input.finalLegs ?? input.legs,
    neutralFinal: Boolean(input.neutralFinal),
    seeds,
    alive:
      input.kind === "cross-tier"
        ? input.seeds.filter((clubId) => !upper.includes(clubId))
        : [...input.seeds],
    ...(input.kind === "cross-tier" ? { upper } : {}),
    ...(input.groups ? { groups: input.groups.map((group) => [...group]) } : {}),
    round: 0,
  };
  return nextRound(state);
}

/** Applies the winners of the pending round and computes the next round or the result. */
export function advancePlayoff(state: PlayoffState, winners: Iterable<number>): PlayoffState {
  if (!state.pending) return state;
  const won = new Set(winners);
  const pairs = state.pending.pairs;
  for (const [first, second] of pairs)
    if (won.has(first) === won.has(second))
      throw new Error(`Play-off tie ${first}-${second} needs exactly one winner.`);
  const played = new Set(pairs.flat());
  const losers = new Set(pairs.flat().filter((clubId) => !won.has(clubId)));
  let next: PlayoffState;
  if (state.kind === "relegation") {
    next = { ...state, alive: state.alive.filter((clubId) => losers.has(clubId)) };
  } else if (
    state.kind === "cross-tier" &&
    pairs.some(([first]) => state.upper?.includes(first))
  ) {
    const upperTier = new Set(
      state.seeds.filter(
        (clubId) =>
          won.has(clubId) ||
          (state.upper?.includes(clubId) && !played.has(clubId)),
      ),
    );
    const order = new Map(state.seeds.map((clubId, index) => [clubId, index]));
    const sorted = (values: number[]) =>
      values.sort((left, right) => order.get(left)! - order.get(right)!);
    return {
      ...state,
      round: state.round + 1,
      pending: undefined,
      result: {
        winners: sorted([...upperTier]),
        losers: sorted(state.seeds.filter((clubId) => !upperTier.has(clubId))),
      },
    };
  } else if (state.kind === "cross-tier") {
    next = { ...state, alive: state.alive.filter((clubId) => !losers.has(clubId)) };
  } else if (state.groups?.some((group) => group.length > 1)) {
    next = {
      ...state,
      groups: state.groups.map((group) => group.filter((clubId) => !losers.has(clubId))),
    };
  } else {
    next = {
      ...state,
      ...(state.groups ? { groups: undefined } : {}),
      alive: (state.groups ? state.groups.flat() : state.alive).filter((clubId) => !losers.has(clubId)),
    };
  }
  return nextRound({ ...next, round: state.round + 1, pending: undefined });
}

/** Resolves a play-off without matches (better seed wins every tie): fallback when a season ends unresolved. */
export function resolvePlayoffBySeed(state: PlayoffState): PlayoffResult {
  let current = state;
  for (let guard = 0; current.pending && guard < 64; guard++)
    current = advancePlayoff(current, current.pending.pairs.map(([better]) => better));
  return current.result ?? { winners: [], losers: [...state.seeds] };
}

/** Knockout stage label understood by the match engine ("Final", "Semi-final", "Quarter-final", "Round of N"). */
export function knockoutStage(teams: number, final: boolean) {
  if (final || teams === 2) return "Final";
  if (teams === 4) return "Semi-final";
  if (teams === 8) return "Quarter-final";
  if (teams >= 16 && 2 ** Math.round(Math.log2(teams)) === teams) return `Round of ${teams}`;
  return "Qualifying";
}

// ---------------------------------------------------- promotion/relegation

export interface ReserveCeiling {
  parentId: number;
  highestTier: number;
  minGapBelowParent: number;
  maxPerTier?: number;
}

/** B-teams never play at or above the parent's division, never above highestTier. */
export function reserveTierAllowed(
  rule: ReserveCeiling,
  targetTier: number,
  parentTier: number | undefined,
) {
  if (targetTier < Math.max(2, rule.highestTier)) return false;
  if (parentTier === undefined) return true;
  return targetTier >= parentTier + Math.max(1, rule.minGapBelowParent);
}

export interface PyramidTier {
  leagueId: number;
  tier: number;
  closed: boolean;
  /** Boundary with tier + 1 (null for the bottom tier). */
  movementDown: TierBoundarySpec | null;
  /** Final ranked club ids (split-aware combined table). */
  table: number[];
  /** Final ranked club ids per conference (conference tiers), used by perConference boundaries. */
  conferenceTables?: number[][];
  /** Title play-off winner, used by `championPromoted` boundaries. */
  champion?: number;
}

export interface PyramidClub {
  clubId: number;
  reserve?: ReserveCeiling;
  /** League a parked B-team was withdrawn from; it has no league place until its parent's division allows it back. */
  parkedLeagueId?: number;
}

export interface BoundaryPlayoffPlan {
  /** Boundary upper tier and play-off index within TierBoundarySpec.playoffs. */
  upper: number;
  index: number;
  /** Conference index of a perConference play-off. */
  conference?: number;
  spec: MovementPlayoffSpec;
  upperLeagueId: number;
  lowerLeagueId: number;
  input: PlayoffInput;
}

export interface BoundaryPlan {
  upper: number;
  upperLeagueId: number;
  lowerLeagueId: number;
  /** Automatic moves. */
  promoted: number[];
  relegated: number[];
  playoffs: BoundaryPlayoffPlan[];
}

export interface MovementInput {
  tiers: readonly PyramidTier[];
  clubs: ReadonlyMap<number, PyramidClub>;
  /** Plans fixed when the regular seasons ended; recomputed from the final tables when absent. */
  boundaries?: readonly BoundaryPlan[];
  /** Results of boundary play-offs by `${upper}:${index}`; missing play-offs are resolved by seed. */
  results?: ReadonlyMap<string, PlayoffResult>;
}

export interface Move {
  clubId: number;
  /** Origin league id, or null when a parked B-team is re-admitted. */
  from: number | null;
  /** Destination league id, or null when a B-team with no legal modeled tier is parked for the season. */
  to: number | null;
  /** League whose place a parked B-team gives up (the league it is re-admitted to). */
  parkedIn?: number;
  promoted: boolean;
  reason: "automatic" | "playoff" | "reserve-ceiling" | "replacement" | "parked" | "readmitted";
}

export const boundaryKey = (upper: number, index: number, conference?: number) =>
  conference === undefined ? `${upper}:${index}` : `${upper}:${index}:${conference}`;

/** Moves a boundary always makes each way, plus the cross-tier ties that may add up to `cross` more. */
export function boundaryMoves(boundary: TierBoundarySpec) {
  const playoffs = boundary.playoffs ?? [];
  const places = (type: "promotion" | "relegation") =>
    playoffs.reduce((total, playoff) => total + (playoff.type === type ? playoff.places : 0), 0);
  return {
    up: boundary.promoted + places("promotion"),
    down: boundary.relegated + places("relegation"),
    cross: playoffs.reduce(
      (total, playoff) => total + (playoff.type === "cross-tier" ? playoff.upperPositions.length : 0),
      0,
    ),
  };
}

/** Ranked groups a boundary counts in: each conference when perConference applies, else the combined table. */
const movementGroups = (tier: PyramidTier, perConference: boolean | undefined) =>
  perConference && (tier.conferenceTables?.length ?? 0) > 1 ? tier.conferenceTables! : [tier.table];

function pyramidContext(input: Pick<MovementInput, "tiers" | "clubs">) {
  const tiers = [...input.tiers].sort((left, right) => left.tier - right.tier);
  const byTier = new Map(tiers.map((tier) => [tier.tier, tier]));
  const home = new Map<number, number>();
  for (const tier of tiers) for (const clubId of tier.table) home.set(clubId, tier.tier);
  return { tiers, byTier, home };
}

/** Clubs that may move up into `targetTier`, in table order (ineligible B-teams are skipped, lower clubs move up). */
function eligibleForTier(
  table: readonly number[],
  targetTier: number,
  clubs: ReadonlyMap<number, PyramidClub>,
  parentTier: (parentId: number) => number | undefined,
) {
  return table.filter((clubId) => {
    const reserve = clubs.get(clubId)?.reserve;
    return !reserve || reserveTierAllowed(reserve, targetTier, parentTier(reserve.parentId));
  });
}

/**
 * Automatic moves and play-off seeds per boundary, fixed when the regular seasons end. B-team eligibility uses the
 * parent's worst case (automatic relegation or a relegation play-off counts as one tier lower); ineligible B-teams
 * are removed from the order so the clubs below them move up, as federations do.
 */
export function planBoundaries(input: Pick<MovementInput, "tiers" | "clubs">): BoundaryPlan[] {
  const { tiers, byTier, home } = pyramidContext(input);
  const worstTier = (clubId: number) => {
    const tier = home.get(clubId);
    if (tier === undefined) return undefined;
    const table = byTier.get(tier)!;
    const boundary = table.movementDown;
    if (!boundary || table.closed || byTier.get(tier + 1)?.closed) return tier;
    const groups = movementGroups(table, boundary.perConference);
    const group = groups.find((rows) => rows.includes(clubId)) ?? table.table;
    const rank = group.indexOf(clubId) + 1;
    const atRisk =
      rank > group.length - boundary.relegated / groups.length ||
      (boundary.playoffs ?? []).some((playoff) =>
        playoff.type === "relegation"
          ? rank >= playoff.positions[0] && rank <= playoff.positions[1]
          : playoff.type === "cross-tier" && playoff.upperPositions.includes(rank),
      );
    return atRisk ? tier + 1 : tier;
  };
  const plans: BoundaryPlan[] = [];
  // championPromoted: the lower tier's champion ranks first, so it takes the first automatic place.
  const championFirst = (tier: PyramidTier): PyramidTier => {
    const first = (table: number[]) =>
      table.includes(tier.champion!) ? [tier.champion!, ...table.filter((id) => id !== tier.champion)] : table;
    return {
      ...tier,
      table: first(tier.table),
      ...(tier.conferenceTables ? { conferenceTables: tier.conferenceTables.map(first) } : {}),
    };
  };
  for (const upper of tiers) {
    const boundary = upper.movementDown;
    const next = byTier.get(upper.tier + 1);
    const lower =
      next && boundary?.championPromoted && next.champion !== undefined ? championFirst(next) : next;
    if (!lower || !boundary || upper.closed || lower.closed) continue;
    const lowerGroups = movementGroups(lower, boundary.perConference);
    const upperGroups = movementGroups(upper, boundary.perConference);
    const relegatedPer = boundary.relegated / upperGroups.length;
    const promotedPer = boundary.promoted / lowerGroups.length;
    let reserves = upperGroups
      .flatMap((group) => group.slice(0, group.length - relegatedPer))
      .filter((clubId) => input.clubs.get(clubId)?.reserve).length;
    const promoted: number[] = [];
    // Eligible clubs per lower group after the automatic places, in table order.
    const orders = lowerGroups.map((group) => {
      const eligible = eligibleForTier(group, upper.tier, input.clubs, worstTier);
      const taken: number[] = [];
      for (const clubId of eligible) {
        if (taken.length >= promotedPer) break;
        const cap = input.clubs.get(clubId)?.reserve?.maxPerTier;
        if (input.clubs.get(clubId)?.reserve) {
          if (cap !== undefined && reserves >= cap) continue;
          reserves++;
        }
        taken.push(clubId);
      }
      promoted.push(...taken);
      return eligible.filter((clubId) => !taken.includes(clubId));
    });
    const plan: BoundaryPlan = {
      upper: upper.tier,
      upperLeagueId: upper.leagueId,
      lowerLeagueId: lower.leagueId,
      promoted,
      relegated: relegatedPer ? upperGroups.flatMap((group) => group.slice(-relegatedPer)) : [],
      playoffs: [],
    };
    const combined = eligibleForTier(lower.table, upper.tier, input.clubs, worstTier).filter(
      (clubId) => !promoted.includes(clubId),
    );
    (boundary.playoffs ?? []).forEach((spec, index) => {
      const groups =
        spec.type === "promotion" ? orders : spec.type === "relegation" ? upperGroups : [combined];
      groups.forEach((group, conference) => {
        let seeds: number[] = [];
        let upperSeeds: number[] | undefined;
        // Promotion ranks count after the automatic places among eligible clubs.
        const skipped = spec.type === "promotion" ? promotedPer : boundary.promoted;
        const lowerAt = (rank: number) => group[rank - 1 - skipped];
        if (spec.type === "promotion")
          seeds = Array.from(
            { length: spec.positions[1] - spec.positions[0] + 1 },
            (_, offset) => lowerAt(spec.positions[0] + offset),
          ).filter((clubId) => clubId !== undefined);
        else if (spec.type === "relegation") seeds = group.slice(spec.positions[0] - 1, spec.positions[1]);
        else {
          upperSeeds = spec.upperPositions
            .map((rank) => upper.table[rank - 1])
            .filter((clubId) => clubId !== undefined);
          seeds = spec.lowerPositions.map(lowerAt).filter((clubId) => clubId !== undefined);
        }
        if (seeds.length + (upperSeeds?.length ?? 0) < 2) return;
        plan.playoffs.push({
          upper: upper.tier,
          index,
          ...(groups.length > 1 ? { conference } : {}),
          spec,
          upperLeagueId: upper.leagueId,
          lowerLeagueId: lower.leagueId,
          input: {
            kind: spec.type,
            places:
              spec.type === "cross-tier" ? upperSeeds!.length : spec.places / groups.length,
            legs: spec.legs,
            finalLegs: "finalLegs" in spec ? spec.finalLegs : undefined,
            neutralFinal: "neutralFinal" in spec ? spec.neutralFinal : undefined,
            seeds,
            upper: upperSeeds,
          },
        });
      });
    });
    plans.push(plan);
  }
  return plans;
}

/**
 * Promotion and relegation for one national pyramid. Every boundary moves the same number of clubs each way, so
 * league sizes stay constant; closed tiers never move. Parents always move on merit and B-teams stay below them:
 * a B-team whose parent drops onto its tier goes down one tier and the best-placed club relegated from that tier is
 * reprieved (RFEF); with no legal open tier below, the B-team is parked (no league place, that tier one club short)
 * and re-admitted to the same league once its parent's division allows it again.
 * `shortfalls` receives, per upper league id, the places each way below the boundary's fixed moves.
 */
export function planMovement(input: MovementInput, shortfalls?: Map<number, number>): Move[] {
  const { tiers, byTier } = pyramidContext(input);
  const destination = new Map<number, number>();
  const origin = new Map<number, PyramidTier>();
  const reason = new Map<number, Move["reason"]>();
  for (const tier of tiers)
    for (const clubId of tier.table) {
      destination.set(clubId, tier.tier);
      origin.set(clubId, tier);
    }
  const tierOf = (clubId: number) => destination.get(clubId);
  const boundaries = [...(input.boundaries ?? planBoundaries(input))].sort(
    (left, right) => left.upper - right.upper,
  );
  for (const plan of boundaries) {
    const upper = byTier.get(plan.upper);
    const lower = byTier.get(plan.upper + 1);
    if (!upper || !lower || upper.closed || lower.closed) continue;
    const up = [...plan.promoted];
    const down = [...plan.relegated];
    const viaPlayoff = new Set<number>();
    for (const playoff of plan.playoffs) {
      const result =
        input.results?.get(boundaryKey(plan.upper, playoff.index, playoff.conference)) ??
        resolvePlayoffBySeed(createPlayoff(playoff.input));
      const uppers = new Set(playoff.input.upper ?? []);
      if (playoff.spec.type === "promotion") up.push(...result.winners);
      else if (playoff.spec.type === "relegation") down.push(...result.losers);
      else {
        up.push(...result.winners.filter((clubId) => !uppers.has(clubId)));
        down.push(...result.losers.filter((clubId) => uppers.has(clubId)));
      }
      for (const clubId of [...playoff.input.seeds, ...uppers]) viaPlayoff.add(clubId);
    }
    const upperRank = (clubId: number) => upper.table.indexOf(clubId);
    const lowerRank = (clubId: number) => lower.table.indexOf(clubId);
    const movingUp = [...new Set(up)]
      .filter((clubId) => lowerRank(clubId) >= 0 && destination.get(clubId) === lower.tier)
      .sort((left, right) => lowerRank(left) - lowerRank(right));
    const movingDown = [...new Set(down)]
      .filter((clubId) => upperRank(clubId) >= 0 && destination.get(clubId) === upper.tier)
      .sort((left, right) => upperRank(left) - upperRank(right));
    // Keep sizes constant: reprieve the best-placed relegated clubs, or cancel the weakest promotions.
    while (movingDown.length > movingUp.length) movingDown.shift();
    while (movingUp.length > movingDown.length) movingUp.pop();
    if (upper.movementDown) {
      const fixed = boundaryMoves(upper.movementDown);
      const short = Math.max(fixed.up, fixed.down) - movingUp.length;
      if (short > 0) shortfalls?.set(upper.leagueId, short);
    }
    for (const clubId of movingUp) {
      destination.set(clubId, upper.tier);
      reason.set(clubId, viaPlayoff.has(clubId) ? "playoff" : "automatic");
    }
    for (const clubId of movingDown) {
      destination.set(clubId, lower.tier);
      reason.set(clubId, viaPlayoff.has(clubId) ? "playoff" : "automatic");
    }
  }
  // Reserve ceilings after all boundaries: B-teams go below their parent, one tier at a time.
  const parked = new Set<number>();
  const reserves = [...input.clubs.values()]
    .filter((club) => club.reserve && destination.has(club.clubId))
    .sort((left, right) => destination.get(left.clubId)! - destination.get(right.clubId)!);
  const allowedIn = (clubId: number, tier: number) => {
    const reserve = input.clubs.get(clubId)?.reserve;
    return !reserve || reserveTierAllowed(reserve, tier, tierOf(reserve.parentId));
  };
  for (const club of reserves) {
    let current = destination.get(club.clubId)!;
    if (allowedIn(club.clubId, current)) continue;
    let target: number | undefined;
    for (let tier = current + 1; byTier.has(tier) && !byTier.get(tier)!.closed; tier++)
      if (allowedIn(club.clubId, tier)) {
        target = tier;
        break;
      }
    while (target !== undefined && current < target) {
      const lower = byTier.get(current + 1)!;
      const from = current;
      // Relegated clubs of this tier come first (the best placed is reprieved), then the lower tier's nearest misses.
      const rank = (clubId: number) =>
        (origin.get(clubId)!.tier === from ? 0 : 100_000) + origin.get(clubId)!.table.indexOf(clubId);
      const replacement = [...destination.keys()]
        .filter(
          (clubId) =>
            destination.get(clubId) === lower.tier &&
            (origin.get(clubId)!.tier === from || origin.get(clubId)!.tier === lower.tier) &&
            clubId !== club.reserve!.parentId &&
            reason.get(clubId) !== "reserve-ceiling" &&
            allowedIn(clubId, from),
        )
        .sort((left, right) => rank(left) - rank(right))[0];
      if (replacement === undefined) break;
      destination.set(replacement, from);
      reason.set(replacement, "replacement");
      destination.set(club.clubId, lower.tier);
      reason.set(club.clubId, "reserve-ceiling");
      current = lower.tier;
    }
    if (!allowedIn(club.clubId, current)) parked.add(club.clubId);
  }
  const moves: Move[] = [];
  for (const club of input.clubs.values()) {
    if (club.parkedLeagueId === undefined || destination.has(club.clubId)) continue;
    const league = tiers.find((tier) => tier.leagueId === club.parkedLeagueId);
    if (league && !league.closed && allowedIn(club.clubId, league.tier))
      moves.push({ clubId: club.clubId, from: null, to: league.leagueId, promoted: false, reason: "readmitted" });
  }
  for (const [clubId, tier] of destination) {
    const from = origin.get(clubId)!;
    if (parked.has(clubId)) {
      const parkedIn = byTier.get(tier)!.leagueId;
      moves.push({ clubId, from: from.leagueId, to: null, parkedIn, promoted: false, reason: "parked" });
      continue;
    }
    if (tier === from.tier) continue;
    moves.push({
      clubId,
      from: from.leagueId,
      to: byTier.get(tier)!.leagueId,
      promoted: tier < from.tier,
      reason: reason.get(clubId) ?? "automatic",
    });
  }
  return moves.sort((left, right) => left.clubId - right.clubId);
}

// ------------------------------------------------ continental qualifying

export const QUALIFYING_STAGES = ["q1", "q2", "q3", "q4", "playoff"] as const;
export type QualifyingStage = (typeof QUALIFYING_STAGES)[number];
export interface QualifyingRound {
  stage: QualifyingStage;
  playing: number;
  ties: number;
}

/**
 * Ties in a round of the repeating last stage. Byes fall only in its first round, so every later round halves
 * exactly (CAF: round 1 byes bring round 2 to 32; 60 → 32 → 16).
 */
export function lastStageTies(playing: number, slots: number) {
  if (slots <= 0 || playing <= slots) return 0;
  let after = slots;
  while (after * 2 < playing) after *= 2;
  return playing - after;
}

/**
 * Knockout qualifying by entry stage: each stage's entrants join the previous winners and the lowest seeds play.
 * The last entry stage repeats until exactly `slots` clubs remain (fewer only when there are not enough entrants).
 */
export function qualifyingPlan(entrants: Partial<Record<QualifyingStage, number>>, slots: number): QualifyingRound[] {
  if (slots <= 0) return [];
  let last = -1;
  QUALIFYING_STAGES.forEach((stage, index) => {
    if ((entrants[stage] ?? 0) > 0) last = index;
  });
  const rounds: QualifyingRound[] = [];
  let carried = 0;
  for (let index = 0; index <= last; index++) {
    const stage = QUALIFYING_STAGES[index];
    let playing = carried + (entrants[stage] ?? 0);
    if (!playing) continue;
    if (index < last) {
      if (!entrants[stage]) continue;
      const ties = Math.floor(playing / 2);
      if (ties) rounds.push({ stage, playing, ties });
      carried = playing - ties;
      continue;
    }
    while (playing > slots) {
      const ties = lastStageTies(playing, slots);
      rounds.push({ stage, playing, ties });
      playing -= ties;
    }
  }
  return rounds;
}

/**
 * Pairs one qualifying round: the best seeds get byes (an odd path's best seed first, so odd rounds after vacancies
 * keep their paths apart), the others meet top-v-bottom within their path (Champions/League); only odd leftovers
 * cross paths. `seeds` is ordered best first.
 */
export function pairQualifyingRound(
  seeds: readonly number[],
  ties: number,
  path: (clubId: number) => string = () => "",
): { byes: number[]; pairs: [number, number][] } {
  const count = Math.max(0, Math.min(ties, Math.floor(seeds.length / 2)));
  let free = seeds.length - count * 2;
  const groups = new Map<string, number[]>();
  for (const clubId of seeds) groups.set(path(clubId), [...(groups.get(path(clubId)) ?? []), clubId]);
  const bye = new Set<number>();
  for (const group of groups.values())
    if (group.length % 2 && free > 0) {
      bye.add(group[0]);
      free--;
    }
  const order = new Map(seeds.map((clubId, index) => [clubId, index]));
  while (free >= 2) {
    const [best] = [...groups.values()]
      .map((group) => group.filter((clubId) => !bye.has(clubId)))
      .filter((group) => group.length >= 2)
      .sort((left, right) => order.get(left[0])! - order.get(right[0])!);
    bye.add(best[0]).add(best[1]);
    free -= 2;
  }
  const byes = seeds.filter((clubId) => bye.has(clubId));
  const playing = seeds.filter((clubId) => !bye.has(clubId));
  const paths = new Map<string, number[]>();
  for (const clubId of playing) paths.set(path(clubId), [...(paths.get(path(clubId)) ?? []), clubId]);
  const pairs: [number, number][] = [];
  const leftovers: number[] = [];
  for (const group of paths.values()) {
    for (let index = 0; index < Math.floor(group.length / 2); index++)
      pairs.push([group[index], group[group.length - 1 - index]]);
    if (group.length % 2) leftovers.push(group[Math.floor(group.length / 2)]);
  }
  for (let index = 0; index + 1 < leftovers.length; index += 2) pairs.push([leftovers[index], leftovers[index + 1]]);
  return { byes, pairs };
}
