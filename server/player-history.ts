import type { Store } from "./db.ts";
import { playerOf } from "./systems.ts";
import { playerRecords } from "./player-records.ts";
import { daysBetween } from "../shared/rules.ts";
import type {
  PlayerCompetitionStats,
  PlayerHistory,
  PlayerHistoryClub,
  PlayerHonour,
  PlayerMilestone,
  PlayerMove,
  PlayerMoveKind,
  PlayerSeasonStats,
  PlayerSquadMove,
  PlayerStatLine,
} from "../shared/api.ts";

export const PLAYER_HISTORY_MOVE_LIMIT = 500;

export interface HistoryMoveRow {
  id: number;
  season: number;
  date: string;
  entity_type: string;
  data: string;
}
export interface HistoryLoanRow {
  id: number;
  parent_id: number;
  destination_id: number;
  type: string;
  start_date: string;
  end_date: string;
  status: string;
  terms: string;
  data: string;
}
/** A player_season_stats row: every competitive appearance, goal and assist (retention never prunes them). */
export interface SeasonStatRow {
  season: number;
  club_id: number;
  /** 0: friendlies (match rows only). */
  league_id: number;
  appearances: number;
  minutes: number;
  goals: number;
  assists: number;
}
/** player_match_appearances per season, club and competition: the current season, and the user's teams' matches. */
export interface AppearanceStatRow extends SeasonStatRow {
  /** Appearances with a match rating; rating_sum adds exactly these. */
  rated: number;
  rating_sum: number;
}
export interface CompetitionRow {
  id: number;
  name: string;
  age_group: string | null;
}

export const parse = (text: string): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
export const numberOrNull = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
export const idOrNull = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
export const textOrNull = (value: unknown) => (typeof value === "string" && value ? value : null);
/** Kind of a history 'transfer' row from its recorded deal type and selling club. */
export const transferKind = (type: string | null, from: number | null): PlayerMoveKind =>
  type === "Squad registration" ? "registration" : from === null || /free/i.test(type ?? "") ? "free" : "transfer";

/** Club ids named by history rows, loans and stat rows, for one name lookup. */
export function referencedClubIds(moves: HistoryMoveRow[], loans: HistoryLoanRow[], stats: SeasonStatRow[]) {
  const ids = new Set<number>();
  for (const row of moves) {
    const data = parse(row.data);
    for (const value of [data.from, data.to, data.fromClubId, data.toClubId]) {
      const id = idOrNull(value);
      if (id) ids.add(id);
    }
  }
  for (const loan of loans) ids.add(loan.parent_id).add(loan.destination_id);
  for (const row of stats) ids.add(Number(row.club_id));
  return [...ids];
}

/** A club with its family (parent_id: the first team of a B-team; null for a first team or national team). */
export interface FamilyClub extends PlayerHistoryClub {
  parent_id: number | null;
}
export const familyRoot = (club: Pick<FamilyClub, "id" | "parent_id">) => club.parent_id ?? club.id;

/** U17 < U19 < B-team < first team. */
const LEVELS: Record<string, number> = { U17: 0, U19: 1, U21: 1.5 };
const squadLevel = (club: Pick<FamilyClub, "parent_id"> | undefined, group: string | null) =>
  group && group in LEVELS ? LEVELS[group] : club?.parent_id ? 2 : 3;

/** One recorded move inside a club family, before call-ups are folded. */
export interface SquadEntry {
  key: string;
  playerId: number;
  /** As recorded with the move (registrations only). */
  name: string | null;
  date: string;
  season: number;
  fromClubId: number | null;
  fromGroup: string | null;
  toClubId: number | null;
  toGroup: string | null;
  label: string | null;
  registration: boolean;
  callUp: boolean;
  callUpReturn: boolean;
  until: string | null;
  debut: boolean;
}

/** A 'squad' history row (callups.ts, systems.ts) as a family move. */
export function squadEntry(row: HistoryMoveRow, playerId: number): SquadEntry {
  const data = parse(row.data);
  return {
    key: `h${row.id}`,
    playerId,
    name: null,
    date: row.date,
    season: Number(row.season),
    fromClubId: idOrNull(data.fromClubId),
    fromGroup: textOrNull(data.fromAgeGroup),
    toClubId: idOrNull(data.toClubId),
    toGroup: textOrNull(data.ageGroup),
    label: textOrNull(data.label),
    registration: false,
    callUp: data.callUp === true,
    callUpReturn: data.callUpReturn === true,
    until: data.callUp === true ? textOrNull(data.until) : null,
    debut: data.debut === true,
  };
}

/** A 'transfer' history row between two clubs of the same family (an automatic registration). */
export function registrationEntry(row: HistoryMoveRow, playerId: number): SquadEntry {
  const data = parse(row.data);
  return {
    key: `h${row.id}`,
    playerId,
    name: textOrNull(data.name),
    date: row.date,
    season: Number(row.season),
    fromClubId: idOrNull(data.from),
    fromGroup: null,
    toClubId: idOrNull(data.to),
    toGroup: null,
    label: textOrNull(data.club),
    registration: true,
    callUp: false,
    callUpReturn: false,
    until: null,
    debut: false,
  };
}

/**
 * Pure: squad movements oldest first (history order), each call-up folded with its return (per player). Any later
 * move of the same player closes an open call-up; a return without its call-up (older than the rows read) is a move.
 */
export function foldSquadMoves(
  entries: readonly SquadEntry[],
  club: (id: number | null) => FamilyClub | null,
): (PlayerSquadMove & { key: string; playerId: number })[] {
  const ordered = [...entries].sort(
    (left, right) => left.date.localeCompare(right.date) || left.key.localeCompare(right.key, undefined, { numeric: true }),
  );
  const moves: (PlayerSquadMove & { key: string; playerId: number })[] = [];
  const open = new Map<number, PlayerSquadMove>();
  const close = (playerId: number, date: string) => {
    const call = open.get(playerId);
    if (!call) return;
    call.returnedOn = date;
    call.days = daysBetween(call.date, date);
    open.delete(playerId);
  };
  for (const entry of ordered) {
    if (entry.callUpReturn && open.has(entry.playerId)) {
      close(entry.playerId, entry.date);
      continue;
    }
    close(entry.playerId, entry.date);
    const from = club(entry.fromClubId);
    const to = club(entry.toClubId);
    const fromLevel = squadLevel(from ?? undefined, entry.fromGroup);
    const toLevel = squadLevel(to ?? undefined, entry.toGroup);
    const move: PlayerSquadMove & { key: string; playerId: number } = {
      key: entry.key,
      playerId: entry.playerId,
      kind: entry.callUp ? "callUp" : entry.registration ? "registration" : "move",
      date: entry.date,
      season: entry.season,
      from: from && { id: from.id, name: from.name, color: from.color },
      fromGroup: entry.fromGroup,
      to: to && { id: to.id, name: to.name, color: to.color },
      toGroup: entry.toGroup,
      label: entry.label,
      direction: toLevel > fromLevel ? "up" : toLevel < fromLevel ? "down" : "across",
      ...(entry.callUp ? { until: entry.until, returnedOn: null, days: null } : {}),
      ...(entry.debut ? { debut: true } : {}),
    };
    moves.push(move);
    if (entry.callUp) open.set(entry.playerId, move);
  }
  return moves;
}

interface Totals {
  appearances: number;
  minutes: number;
  goals: number;
  assists: number;
  rated: number;
  ratingSum: number;
}
const emptyTotals = (): Totals => ({ appearances: 0, minutes: 0, goals: 0, assists: 0, rated: 0, ratingSum: 0 });
const addTotals = (target: Totals, source: Totals) => {
  for (const key of Object.keys(target) as (keyof Totals)[]) target[key] += source[key];
};
/** Counts as recorded; the average rating covers rated appearances only and is null without any. */
const statLine = (totals: Totals): PlayerStatLine => ({
  appearances: totals.appearances,
  minutes: totals.minutes,
  goals: totals.goals,
  assists: totals.assists,
  ratedAppearances: totals.rated,
  averageRating: totals.rated ? Math.round((totals.ratingSum / totals.rated) * 100) / 100 : null,
  ratingCoverage: !totals.rated ? "none" : totals.rated >= totals.appearances ? "full" : "partial",
});

/** Pure assembly of a player's moves and statistics from the rows playerHistory() reads. */
export function buildPlayerHistory(input: {
  playerId: number;
  moves: HistoryMoveRow[];
  loans: HistoryLoanRow[];
  seasonStats: SeasonStatRow[];
  appearanceStats: AppearanceStatRow[];
  clubs: FamilyClub[];
  competitions: CompetitionRow[];
  movesTruncated: boolean;
  honours?: PlayerHonour[];
  milestones?: PlayerMilestone[];
}): PlayerHistory {
  const clubs = new Map(input.clubs.map((club) => [Number(club.id), club]));
  const family = (id: number | null): FamilyClub | null =>
    id === null ? null : (clubs.get(id) ?? { id, name: "Unknown club", color: null, parent_id: null });
  const club = (id: number | null): PlayerHistoryClub | null => {
    const found = family(id);
    return found && { id: found.id, name: found.name, color: found.color };
  };
  const sameFamily = (from: number | null, to: number | null) =>
    from !== null && to !== null && familyRoot(family(from)!) === familyRoot(family(to)!);
  const ordered: { move: PlayerMove; order: string; rank: number; sequence: number }[] = [];
  const push = (move: PlayerMove, order: string, rank: number) =>
    ordered.push({ move, order, rank, sequence: ordered.length });
  const squad: SquadEntry[] = [];
  const blank = { dateEstimated: false, season: null, fee: null, dealType: null, loanUntil: null };
  const matchedLoans = new Set<number>();
  for (const row of [...input.moves].sort((left, right) => left.date.localeCompare(right.date) || left.id - right.id)) {
    const data = parse(row.data);
    const recorded = { ...blank, date: row.date, season: Number(row.season) };
    if (row.entity_type === "squad") squad.push(squadEntry(row, input.playerId));
    else if (row.entity_type === "loan") {
      const to = idOrNull(data.to);
      const loan = input.loans.find(
        (entry) => !matchedLoans.has(entry.id) && entry.destination_id === to && entry.start_date === row.date,
      );
      if (loan) matchedLoans.add(loan.id);
      push(
        {
          ...recorded,
          kind: "loan",
          from: club(idOrNull(data.from)),
          to: club(to),
          fee: numberOrNull(data.fee),
          dealType: textOrNull(data.type),
          loanUntil: loan?.end_date ?? null,
        },
        row.date,
        1,
      );
    } else {
      const type = textOrNull(data.type);
      const from = idOrNull(data.from);
      const to = idOrNull(data.to);
      if (sameFamily(from, to)) squad.push(registrationEntry(row, input.playerId));
      else
        push(
          { ...recorded, kind: transferKind(type, from), from: club(from), to: club(to), fee: numberOrNull(data.fee), dealType: type },
          row.date,
          1,
        );
    }
  }
  for (const loan of input.loans) {
    const parent = club(loan.parent_id);
    const destination = club(loan.destination_id);
    const spell = { ...blank, dealType: loan.type, loanUntil: loan.end_date };
    // Loans recorded before their start was written to history (or older than the listed moves) come from the loan row.
    if (!matchedLoans.has(loan.id) && !input.movesTruncated)
      push({ ...spell, kind: "loan", date: loan.start_date, from: parent, to: destination }, loan.start_date, 1);
    const endedOn = textOrNull(parse(loan.data).endedOn);
    const undated = `${loan.start_date}~`;
    if (loan.status === "completed")
      push(
        {
          ...spell,
          kind: "loanReturn",
          date: endedOn ?? loan.end_date,
          dateEstimated: !endedOn,
          from: destination,
          to: parent,
        },
        endedOn ?? loan.end_date,
        0,
      );
    else if (loan.status === "recalled")
      push({ ...spell, kind: "loanRecall", date: endedOn, from: destination, to: parent }, endedOn ?? undated, 0);
    else if (loan.status === "purchased")
      push(
        {
          ...spell,
          kind: "loanPurchase",
          date: endedOn,
          from: parent,
          to: destination,
          fee: numberOrNull(parse(loan.terms).optionFee),
        },
        endedOn ?? undated,
        0,
      );
  }
  ordered.sort(
    (left, right) =>
      left.order.localeCompare(right.order) || left.rank - right.rank || left.sequence - right.sequence,
  );
  const stats = groupSeasonStats(input.seasonStats, input.appearanceStats, input.competitions, (id) => club(id)!);
  return {
    playerId: input.playerId,
    transfers: ordered.map((entry) => entry.move),
    squadMoves: foldSquadMoves(squad, family).map(({ key: _key, playerId: _player, ...move }) => move),
    movesTruncated: input.movesTruncated,
    ...stats,
    honours: input.honours ?? [],
    milestones: input.milestones ?? [],
  };
}

const byAppearances = (left: PlayerCompetitionStats, right: PlayerCompetitionStats) =>
  right.appearances - left.appearances ||
  left.club.id - right.club.id ||
  (left.competition.id ?? Infinity) - (right.competition.id ?? Infinity);

/** Pure: season -> club -> competition, with season and career totals of competitive matches; friendlies apart. */
export function groupSeasonStats(
  seasonStats: SeasonStatRow[],
  appearanceStats: AppearanceStatRow[],
  competitionRows: CompetitionRow[],
  club: (id: number) => PlayerHistoryClub,
): Pick<PlayerHistory, "seasons" | "career" | "careerFriendlies"> {
  const competitions = new Map(competitionRows.map((row) => [Number(row.id), row]));
  const lines = new Map<string, { season: number; clubId: number; leagueId: number; totals: Totals; counted: boolean }>();
  const lineOf = (row: SeasonStatRow) => {
    const season = Number(row.season);
    const clubId = Number(row.club_id);
    const leagueId = Number(row.league_id);
    const key = `${season}:${clubId}:${leagueId}`;
    let line = lines.get(key);
    if (!line) {
      line = { season, clubId, leagueId, totals: emptyTotals(), counted: false };
      lines.set(key, line);
    }
    return line;
  };
  const count = (totals: Totals, row: SeasonStatRow) => {
    totals.appearances = Number(row.appearances);
    totals.minutes = Number(row.minutes);
    totals.goals = Number(row.goals);
    totals.assists = Number(row.assists);
  };
  // A competitive line counts from player_season_stats (every match, never pruned); its match rows, where retained,
  // only add ratings. Friendlies have match rows only, so both sources never add up the same matches.
  for (const row of seasonStats) {
    const line = lineOf(row);
    count(line.totals, row);
    line.counted = true;
  }
  for (const row of appearanceStats) {
    const line = lineOf(row);
    if (!line.counted) count(line.totals, row);
    line.totals.rated = Number(row.rated);
    line.totals.ratingSum = Number(row.rating_sum);
  }
  interface SeasonGroup {
    clubs: Map<number, { lines: PlayerCompetitionStats[]; totals: Totals }>;
    friendlies: PlayerCompetitionStats[];
    totals: Totals;
  }
  const bySeason = new Map<number, SeasonGroup>();
  const career = emptyTotals();
  const friendlies = emptyTotals();
  for (const line of lines.values()) {
    let season = bySeason.get(line.season);
    if (!season) bySeason.set(line.season, (season = { clubs: new Map(), friendlies: [], totals: emptyTotals() }));
    const competition = competitions.get(line.leagueId);
    const entry: PlayerCompetitionStats = {
      ...statLine(line.totals),
      club: club(line.clubId),
      competition: line.leagueId
        ? { id: line.leagueId, name: competition?.name ?? "Unknown competition", ageGroup: competition?.age_group ?? null }
        : { id: null, name: "Friendlies", ageGroup: null },
    };
    if (!line.leagueId) {
      season.friendlies.push(entry);
      addTotals(friendlies, line.totals);
      continue;
    }
    let group = season.clubs.get(line.clubId);
    if (!group) season.clubs.set(line.clubId, (group = { lines: [], totals: emptyTotals() }));
    group.lines.push(entry);
    addTotals(group.totals, line.totals);
    addTotals(season.totals, line.totals);
    addTotals(career, line.totals);
  }
  const seasons: PlayerSeasonStats[] = [...bySeason.entries()]
    .sort(([left], [right]) => right - left)
    .map(([season, entry]) => ({
      season,
      clubs: [...entry.clubs.entries()]
        .map(([clubId, group]) => ({ club: club(clubId), competitions: group.lines.sort(byAppearances), total: statLine(group.totals) }))
        .sort((left, right) => right.total.appearances - left.total.appearances || left.club.id - right.club.id),
      friendlies: entry.friendlies.sort(byAppearances),
      total: statLine(entry.totals),
    }));
  return { seasons, career: statLine(career), careerFriendlies: friendlies.appearances ? statLine(friendlies) : null };
}

/** GET /api/players/:id/history: every read seeks by player id (history_entity, loan_player and primary keys). */
export async function playerHistory(store: Store, playerId: number): Promise<PlayerHistory> {
  const player = await playerOf(store, playerId);
  const recent = await store.all<HistoryMoveRow>(
    `SELECT id,season,date,entity_type,data FROM history WHERE entity_type IN ('transfer','loan','squad') AND entity_id = ? ORDER BY date DESC,id DESC LIMIT ${PLAYER_HISTORY_MOVE_LIMIT + 1}`,
    playerId,
  );
  const movesTruncated = recent.length > PLAYER_HISTORY_MOVE_LIMIT;
  const moves = recent.slice(0, PLAYER_HISTORY_MOVE_LIMIT);
  const loans = await store.all<HistoryLoanRow>(
    "SELECT id,parent_id,destination_id,type,start_date,end_date,status,terms,data FROM loans WHERE player_id = ? ORDER BY start_date,id",
    playerId,
  );
  const seasonStats = await store.all<SeasonStatRow>(
    "SELECT season,club_id,league_id,appearances,minutes,goals,assists FROM player_season_stats WHERE player_id = ?",
    playerId,
  );
  const appearanceStats = await store.all<AppearanceStatRow>(
    `SELECT appearance.season,appearance.club_id,coalesce(fixtures.league_id,0) AS league_id,count(*) AS appearances,
       sum(appearance.minutes) AS minutes,sum(appearance.goals) AS goals,sum(appearance.assists) AS assists,
       count(*) FILTER (WHERE appearance.rating > 0) AS rated,
       coalesce(sum(appearance.rating) FILTER (WHERE appearance.rating > 0),0) AS rating_sum
     FROM player_match_appearances AS appearance JOIN fixtures ON fixtures.id = appearance.fixture_id
     WHERE appearance.player_id = ? GROUP BY appearance.season,appearance.club_id,coalesce(fixtures.league_id,0)`,
    playerId,
  );
  const clubIds = referencedClubIds(moves, loans, [...seasonStats, ...appearanceStats]);
  const leagueIds = [
    ...new Set([...seasonStats, ...appearanceStats].map((row) => Number(row.league_id)).filter((id) => id > 0)),
  ];
  return buildPlayerHistory({
    playerId,
    moves,
    loans,
    seasonStats,
    appearanceStats,
    clubs: clubIds.length
      ? await store.all<FamilyClub>("SELECT id,name,color,parent_id FROM clubs WHERE id = ANY(?::int[])", clubIds)
      : [],
    competitions: leagueIds.length
      ? await store.all<CompetitionRow>(
          "SELECT id,name,age_group FROM leagues WHERE id = ANY(?::int[])",
          leagueIds,
        )
      : [],
    movesTruncated,
    ...(await playerRecords(store, playerId, player.birth_date)),
  });
}
