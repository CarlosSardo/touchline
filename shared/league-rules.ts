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
    tiebreakers: [...DEFAULT_TIEBREAKERS],
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
    tiebreakers: Array.isArray(data.tiebreakers)
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
    (!avoid || !internationalBreak(date)) && date.slice(5) !== "12-25";
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

export type RankableRow = Pick<Standing, "club_id" | "points" | "gf" | "ga" | "group_name">;

export const compareStandings = (left: RankableRow, right: RankableRow) =>
  right.points - left.points ||
  right.gf - right.ga - (left.gf - left.ga) ||
  right.gf - left.gf ||
  left.club_id - right.club_id;

/** Final ranking: split groups keep their fixed order (top group first), then points, goal difference, goals. */
export function rankTable<Row extends RankableRow>(
  rows: readonly Row[],
  split?: LeagueSplitSpec,
): Row[] {
  const order = new Map((split?.groups ?? []).map((group, index) => [group.name, index]));
  const groupIndex = (row: RankableRow) => order.get(row.group_name) ?? order.size;
  return [...rows].sort(
    (left, right) => groupIndex(left) - groupIndex(right) || compareStandings(left, right),
  );
}

/** Rank within one conference (or the whole table without conferences). */
export function conferenceTables<Row extends RankableRow>(
  rows: readonly Row[],
  conferences: readonly string[] = [],
): Map<string, Row[]> {
  const tables = new Map<string, Row[]>();
  for (const row of [...rows].sort(compareStandings)) {
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
  from: number;
  /** Destination league id, or null when a B-team has no legal modeled tier (it leaves the pyramid). */
  to: number | null;
  promoted: boolean;
  reason: "automatic" | "playoff" | "reserve-ceiling" | "replacement";
}

export const boundaryKey = (upper: number, index: number, conference?: number) =>
  conference === undefined ? `${upper}:${index}` : `${upper}:${index}:${conference}`;

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
 * league sizes stay constant; closed tiers never move; B-teams stay below their parent (pushed down with a
 * replacement moving up when the parent drops onto or below them).
 */
export function planMovement(input: MovementInput): Move[] {
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
    for (const clubId of movingUp) {
      destination.set(clubId, upper.tier);
      reason.set(clubId, viaPlayoff.has(clubId) ? "playoff" : "automatic");
    }
    for (const clubId of movingDown) {
      destination.set(clubId, lower.tier);
      reason.set(clubId, viaPlayoff.has(clubId) ? "playoff" : "automatic");
    }
  }
  // Reserve ceilings after all boundaries: push B-teams below their parent, replacing them with a first team.
  const leaving = new Set<number>();
  const reserves = [...input.clubs.values()]
    .filter((club) => club.reserve && destination.has(club.clubId))
    .sort((left, right) => destination.get(left.clubId)! - destination.get(right.clubId)!);
  for (const club of reserves) {
    const reserve = club.reserve!;
    let current = destination.get(club.clubId)!;
    while (!reserveTierAllowed(reserve, current, tierOf(reserve.parentId))) {
      const lower = byTier.get(current + 1);
      const candidates = lower
        ? [...destination.keys()].filter(
            (clubId) => destination.get(clubId) === lower.tier && !input.clubs.get(clubId)?.reserve,
          )
        : [];
      const rank = (clubId: number) => {
        const from = origin.get(clubId)!;
        // Clubs that stayed in the lower tier (the nearest misses) come first, then relegated clubs.
        return (from.tier === lower!.tier ? 0 : 100_000) + from.tier * 1000 + from.table.indexOf(clubId);
      };
      const replacement = candidates.sort((left, right) => rank(left) - rank(right))[0];
      if (!lower || replacement === undefined) {
        leaving.add(club.clubId);
        break;
      }
      destination.set(replacement, current);
      reason.set(replacement, "replacement");
      destination.set(club.clubId, lower.tier);
      reason.set(club.clubId, "reserve-ceiling");
      current = lower.tier;
    }
  }
  const moves: Move[] = [];
  for (const [clubId, tier] of destination) {
    const from = origin.get(clubId)!;
    if (leaving.has(clubId)) {
      moves.push({ clubId, from: from.leagueId, to: null, promoted: false, reason: "reserve-ceiling" });
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
      const ties = Math.min(Math.floor(playing / 2), playing - slots);
      rounds.push({ stage, playing, ties });
      playing -= ties;
    }
  }
  return rounds;
}

/**
 * Pairs one qualifying round: the best seeds get byes, the others meet top-v-bottom within their path
 * (Champions/League); only odd leftovers cross paths. `seeds` is ordered best first.
 */
export function pairQualifyingRound(
  seeds: readonly number[],
  ties: number,
  path: (clubId: number) => string = () => "",
): { byes: number[]; pairs: [number, number][] } {
  const count = Math.max(0, Math.min(ties, Math.floor(seeds.length / 2)));
  const byes = seeds.slice(0, seeds.length - count * 2);
  const playing = seeds.slice(byes.length);
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
