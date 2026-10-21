import type { Store } from "./db.ts";
import { playerOf } from "./systems.ts";
import type {
  PlayerCompetitionStats,
  PlayerHistory,
  PlayerHistoryClub,
  PlayerMove,
  PlayerMoveKind,
  PlayerSeasonStats,
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
export interface SeasonStatRow {
  season: number;
  club_id: number;
  /** 0: friendlies. */
  league_id: number;
  appearances: number;
  minutes: number;
}
export interface AppearanceStatRow extends SeasonStatRow {
  recorded: number;
  goals: number;
  assists: number;
  rating_sum: number;
}
export interface CompetitionRow {
  id: number;
  name: string;
  age_group: string | null;
}

// Full-engine appearance stats carry passing data; fast-model rows keep {} or only goals/assists/cards/rating.
const FULL_ENGINE = "(CASE WHEN appearance.stats::jsonb ->> 'passes' IS NOT NULL THEN 1 ELSE 0 END)";

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
/** Call-up markers of a history 'squad' row (callups.ts), only the ones present. */
export const callUpFlags = (data: Record<string, unknown>): Pick<PlayerMove, "callUp" | "callUpReturn" | "until"> => ({
  ...(data.callUp === true ? { callUp: true, until: textOrNull(data.until) } : {}),
  ...(data.callUpReturn === true ? { callUpReturn: true } : {}),
});

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

interface Totals {
  appearances: number;
  minutes: number;
  recorded: number;
  goals: number;
  assists: number;
  ratingSum: number;
}
const emptyTotals = (): Totals => ({ appearances: 0, minutes: 0, recorded: 0, goals: 0, assists: 0, ratingSum: 0 });
const addTotals = (target: Totals, source: Totals) => {
  for (const key of Object.keys(target) as (keyof Totals)[]) target[key] += source[key];
};
const statLine = (totals: Totals): PlayerStatLine => ({
  appearances: totals.appearances,
  minutes: totals.minutes,
  recordedAppearances: totals.recorded,
  goals: totals.recorded ? totals.goals : null,
  assists: totals.recorded ? totals.assists : null,
  averageRating: totals.recorded ? Math.round((totals.ratingSum / totals.recorded) * 100) / 100 : null,
  coverage: !totals.recorded ? "none" : totals.recorded >= totals.appearances ? "full" : "partial",
});

/** Pure assembly of a player's moves and statistics from the rows playerHistory() reads. */
export function buildPlayerHistory(input: {
  playerId: number;
  moves: HistoryMoveRow[];
  loans: HistoryLoanRow[];
  seasonStats: SeasonStatRow[];
  appearanceStats: AppearanceStatRow[];
  clubs: PlayerHistoryClub[];
  competitions: CompetitionRow[];
  movesTruncated: boolean;
}): PlayerHistory {
  const clubs = new Map(input.clubs.map((club) => [Number(club.id), club]));
  const club = (id: number | null): PlayerHistoryClub | null =>
    id === null ? null : (clubs.get(id) ?? { id, name: "Unknown club", color: null });
  const ordered: { move: PlayerMove; order: string; rank: number; sequence: number }[] = [];
  const push = (move: PlayerMove, order: string, rank: number) =>
    ordered.push({ move, order, rank, sequence: ordered.length });
  const blank = { dateEstimated: false, season: null, fee: null, dealType: null, loanUntil: null, ageGroup: null };
  const matchedLoans = new Set<number>();
  for (const row of [...input.moves].sort((left, right) => left.date.localeCompare(right.date) || left.id - right.id)) {
    const data = parse(row.data);
    const recorded = { ...blank, date: row.date, season: Number(row.season) };
    if (row.entity_type === "squad")
      push(
        {
          ...recorded,
          kind: "squad",
          from: club(idOrNull(data.fromClubId)),
          to: club(idOrNull(data.toClubId)),
          dealType: textOrNull(data.label),
          ageGroup: { from: textOrNull(data.fromAgeGroup), to: textOrNull(data.ageGroup) },
          ...callUpFlags(data),
        },
        row.date,
        1,
      );
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
      push(
        {
          ...recorded,
          kind: transferKind(type, from),
          from: club(from),
          to: club(idOrNull(data.to)),
          fee: numberOrNull(data.fee),
          dealType: type,
        },
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

  const competitions = new Map(input.competitions.map((row) => [Number(row.id), row]));
  const lines = new Map<string, { season: number; clubId: number; leagueId: number; totals: Totals }>();
  const lineOf = (row: SeasonStatRow) => {
    const season = Number(row.season);
    const clubId = Number(row.club_id);
    const leagueId = Number(row.league_id);
    const key = `${season}:${clubId}:${leagueId}`;
    let line = lines.get(key);
    if (!line) {
      line = { season, clubId, leagueId, totals: emptyTotals() };
      lines.set(key, line);
    }
    return line.totals;
  };
  // player_season_stats keeps every competitive appearance; appearance rows add friendlies and full-engine detail.
  for (const row of [...input.seasonStats, ...input.appearanceStats]) {
    const totals = lineOf(row);
    totals.appearances = Math.max(totals.appearances, Number(row.appearances));
    totals.minutes = Math.max(totals.minutes, Number(row.minutes));
  }
  for (const row of input.appearanceStats) {
    const totals = lineOf(row);
    totals.recorded = Number(row.recorded);
    totals.goals = Number(row.goals);
    totals.assists = Number(row.assists);
    totals.ratingSum = Number(row.rating_sum);
  }
  const bySeason = new Map<number, { competitions: PlayerCompetitionStats[]; totals: Totals }>();
  const career = emptyTotals();
  for (const line of lines.values()) {
    let season = bySeason.get(line.season);
    if (!season) {
      season = { competitions: [], totals: emptyTotals() };
      bySeason.set(line.season, season);
    }
    const competition = competitions.get(line.leagueId);
    season.competitions.push({
      ...statLine(line.totals),
      club: club(line.clubId)!,
      competition: line.leagueId
        ? { id: line.leagueId, name: competition?.name ?? "Unknown competition", ageGroup: competition?.age_group ?? null }
        : { id: null, name: "Friendlies", ageGroup: null },
    });
    addTotals(season.totals, line.totals);
    addTotals(career, line.totals);
  }
  const seasons: PlayerSeasonStats[] = [...bySeason.entries()]
    .sort(([left], [right]) => right - left)
    .map(([season, entry]) => ({
      season,
      competitions: entry.competitions.sort(
        (left, right) =>
          right.appearances - left.appearances ||
          left.club.id - right.club.id ||
          (left.competition.id ?? Infinity) - (right.competition.id ?? Infinity),
      ),
      total: statLine(entry.totals),
    }));
  return {
    playerId: input.playerId,
    moves: ordered.map((entry) => entry.move),
    movesTruncated: input.movesTruncated,
    seasons,
    career: statLine(career),
  };
}

/** GET /api/players/:id/history: every read seeks by player id (history_entity, loan_player and primary keys). */
export async function playerHistory(store: Store, playerId: number): Promise<PlayerHistory> {
  await playerOf(store, playerId);
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
    "SELECT season,club_id,league_id,appearances,minutes FROM player_season_stats WHERE player_id = ?",
    playerId,
  );
  const appearanceStats = await store.all<AppearanceStatRow>(
    `SELECT appearance.season,appearance.club_id,coalesce(fixtures.league_id,0) AS league_id,count(*) AS appearances,sum(appearance.minutes) AS minutes,sum(${FULL_ENGINE}) AS recorded,sum(${FULL_ENGINE} * appearance.goals) AS goals,sum(${FULL_ENGINE} * appearance.assists) AS assists,sum(${FULL_ENGINE} * appearance.rating) AS rating_sum FROM player_match_appearances AS appearance JOIN fixtures ON fixtures.id = appearance.fixture_id WHERE appearance.player_id = ? GROUP BY appearance.season,appearance.club_id,coalesce(fixtures.league_id,0)`,
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
      ? await store.all<PlayerHistoryClub>(
          "SELECT id,name,color FROM clubs WHERE id = ANY(?::int[])",
          clubIds,
        )
      : [],
    competitions: leagueIds.length
      ? await store.all<CompetitionRow>(
          "SELECT id,name,age_group FROM leagues WHERE id = ANY(?::int[])",
          leagueIds,
        )
      : [],
    movesTruncated,
  });
}
