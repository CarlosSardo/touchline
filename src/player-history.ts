import type {
  HonourKind,
  InjurySeverity,
  MilestoneKind,
  PlayerCompetitionStats,
  PlayerHistory,
  PlayerHistoryClub,
  PlayerHonour,
  PlayerMilestone,
  PlayerMove,
  PlayerMoveKind,
  PlayerSquadMove,
  PlayerStatLine,
  SquadMoveKind,
} from "../shared/api.ts";
import { dateLabel } from "../shared/rules.ts";
import { dateRange, shortDate } from "./callups.ts";

export const ALL_COMPETITIONS = "";
export const ALL_CLUBS = "";
export const FRIENDLIES = "friendlies";

export const MOVE_KIND_LABELS: Record<PlayerMoveKind, string> = {
  transfer: "Transfer",
  free: "Free transfer",
  loan: "Loan",
  loanReturn: "Loan return",
  loanRecall: "Loan recall",
  loanPurchase: "Loan made permanent",
  registration: "Registration",
};

export const SQUAD_KIND_LABELS: Record<SquadMoveKind, string> = {
  callUp: "Call-up",
  move: "Squad move",
  registration: "Family registration",
};

/** Moves where a transfer fee can apply; for the rest a zero fee is not meaningful. */
const FEE_KINDS = new Set<PlayerMoveKind>(["transfer", "free", "loan", "loanPurchase"]);

export type FeeDisplay =
  | { kind: "amount"; value: number }
  | { kind: "none" }
  | { kind: "unrecorded" }
  | { kind: "notApplicable" };

export function moveFee(move: PlayerMove): FeeDisplay {
  if (!FEE_KINDS.has(move.kind)) return move.fee ? { kind: "amount", value: move.fee } : { kind: "notApplicable" };
  if (move.fee === null) return { kind: "unrecorded" };
  return move.fee > 0 ? { kind: "amount", value: move.fee } : { kind: "none" };
}

/** "Harbour FC / U19" as recorded, else the club and its age group ("Harbour FC U19"; senior squads by name). */
export function squadName(club: PlayerHistoryClub | null, group: string | null, label: string | null = null) {
  if (label) return label;
  const name = club?.name ?? "another squad";
  return group && group !== "Senior" && !name.includes(group) ? `${name} ${group}` : name;
}

const VERBS: Record<SquadMoveKind, Record<PlayerSquadMove["direction"], string>> = {
  callUp: { up: "Called up to", down: "Sent down to", across: "Moved to" },
  move: { up: "Promoted to", down: "Moved down to", across: "Moved to" },
  registration: { up: "Registered with", down: "Registered with", across: "Registered with" },
};

/** "Called up to Harbour FC / First team". */
export const squadMoveTitle = (move: PlayerSquadMove) =>
  `${VERBS[move.kind][move.direction]} ${squadName(move.to, move.toGroup, move.label)}`;

/** Call-ups: "3–10 Oct · 7 days", "since 3 Oct · until 10 Oct"; other moves: their date. */
export function squadMovePeriod(move: PlayerSquadMove) {
  if (move.kind !== "callUp") return dateLabel(move.date);
  if (move.returnedOn)
    return `${dateRange(move.date, move.returnedOn)} · ${!move.days ? "same day" : move.days === 1 ? "1 day" : `${move.days} days`}`;
  return `Since ${shortDate(move.date)}${move.until ? ` · until ${shortDate(move.until)}` : ""}`;
}

export const competitionKey = (competition: PlayerCompetitionStats["competition"]) =>
  competition.id === null ? FRIENDLIES : String(competition.id);

export function competitionLabel(competition: PlayerCompetitionStats["competition"]) {
  const group = competition.ageGroup;
  return group && group !== "Senior" && !competition.name.includes(group)
    ? `${competition.name} (${group})`
    : competition.name;
}

export interface StatFilter {
  /** ALL_COMPETITIONS, FRIENDLIES or a competition id. */
  competition: string;
  /** ALL_CLUBS or a club id. */
  club: string;
}
export const NO_STAT_FILTER: StatFilter = { competition: ALL_COMPETITIONS, club: ALL_CLUBS };

export interface ClubBlock {
  club: PlayerHistoryClub;
  lines: PlayerCompetitionStats[];
  total: PlayerStatLine;
}
export interface SeasonBlock {
  season: number;
  clubs: ClubBlock[];
  friendlies: PlayerCompetitionStats[];
  /** Competitive matches of the shown lines. */
  total: PlayerStatLine;
}

/** Season -> club -> competition blocks for the filter; totals recomputed from the shown lines when filtered. */
export function seasonBlocks(history: Pick<PlayerHistory, "seasons">, filter: StatFilter = NO_STAT_FILTER): SeasonBlock[] {
  const filtered = filter.competition !== ALL_COMPETITIONS || filter.club !== ALL_CLUBS;
  const keep = (line: PlayerCompetitionStats) =>
    (filter.competition === ALL_COMPETITIONS || competitionKey(line.competition) === filter.competition) &&
    (filter.club === ALL_CLUBS || String(line.club.id) === filter.club);
  return history.seasons.flatMap((season): SeasonBlock[] => {
    const clubs = season.clubs.flatMap((group): ClubBlock[] => {
      const lines = group.competitions.filter(keep);
      return lines.length ? [{ club: group.club, lines, total: filtered ? totalStatLine(lines) : group.total }] : [];
    });
    const friendlies = season.friendlies.filter(keep);
    if (!clubs.length && !friendlies.length) return [];
    return [
      {
        season: season.season,
        clubs,
        friendlies,
        total: filtered ? totalStatLine(clubs.flatMap((club) => club.lines)) : season.total,
      },
    ];
  });
}

/** Competitive and friendly totals of the shown blocks (the server's career lines when unfiltered). */
export function blockTotals(history: Pick<PlayerHistory, "career" | "careerFriendlies">, blocks: readonly SeasonBlock[], filter: StatFilter) {
  if (filter.competition === ALL_COMPETITIONS && filter.club === ALL_CLUBS)
    return { competitive: history.career, friendlies: history.careerFriendlies };
  const friendlies = blocks.flatMap((block) => block.friendlies);
  return {
    competitive: totalStatLine(blocks.flatMap((block) => block.clubs.flatMap((club) => club.lines))),
    friendlies: friendlies.length ? totalStatLine(friendlies) : null,
  };
}

const allLines = (history: Pick<PlayerHistory, "seasons">) =>
  history.seasons.flatMap((season) => [...season.clubs.flatMap((club) => club.competitions), ...season.friendlies]);

/** Competitions the player has statistics in, alphabetical, friendlies last. */
export function historyCompetitions(history: Pick<PlayerHistory, "seasons">) {
  const found = new Map<string, string>();
  for (const line of allLines(history)) {
    const key = competitionKey(line.competition);
    if (!found.has(key)) found.set(key, competitionLabel(line.competition));
  }
  return [...found.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort(
      (left, right) =>
        Number(left.key === FRIENDLIES) - Number(right.key === FRIENDLIES) || left.label.localeCompare(right.label),
    );
}

/** Clubs (and national teams) the player has statistics for, alphabetical. */
export function historyClubs(history: Pick<PlayerHistory, "seasons">) {
  const found = new Map<number, PlayerHistoryClub>();
  for (const line of allLines(history)) found.set(line.club.id, line.club);
  return [...found.values()].sort((left, right) => left.name.localeCompare(right.name) || left.id - right.id);
}

/** Sums lines the way the server does: every count adds up; the rating averages over rated appearances only. */
export function totalStatLine(lines: readonly PlayerStatLine[]): PlayerStatLine {
  let appearances = 0;
  let minutes = 0;
  let goals = 0;
  let assists = 0;
  let rated = 0;
  let ratingSum = 0;
  for (const line of lines) {
    appearances += line.appearances;
    minutes += line.minutes;
    goals += line.goals;
    assists += line.assists;
    if (line.averageRating === null || !line.ratedAppearances) continue;
    rated += line.ratedAppearances;
    ratingSum += line.averageRating * line.ratedAppearances;
  }
  return {
    appearances,
    minutes,
    goals,
    assists,
    ratedAppearances: rated,
    averageRating: rated ? Math.round((ratingSum / rated) * 100) / 100 : null,
    ratingCoverage: !rated ? "none" : rated >= appearances ? "full" : "partial",
  };
}

export const NO_RATING = "No match ratings on record for these matches";

/** Why a rating is missing or partial ("Rated in 3 of 10 appearances"); undefined when every appearance is rated. */
export function ratingNote(line: PlayerStatLine) {
  return line.ratingCoverage === "partial"
    ? `Rated in ${line.ratedAppearances} of ${line.appearances} appearances`
    : line.ratingCoverage === "none" && line.appearances
      ? NO_RATING
      : undefined;
}

export const seasonLabel = (season: number) => `${season}/${String(season + 1).slice(-2)}`;

export const HONOUR_KIND_LABELS: Record<HonourKind, string> = {
  international: "International",
  continental: "Continental",
  league: "League title",
  cup: "Cup",
  youthInternational: "Youth international",
};
export const HONOUR_ROLE_LABELS: Record<PlayerHonour["role"], string> = {
  regular: "Regular",
  squad: "Squad player",
  fringe: "Limited role",
};

/** Trophies by title, most won first: "Premier Division ×2". */
export function honourSummary(honours: readonly PlayerHonour[]) {
  const counts = new Map<string, { title: string; kind: HonourKind; count: number }>();
  for (const honour of honours) {
    const title = honour.ageGroup && !honour.title.includes(honour.ageGroup) ? `${honour.title} (${honour.ageGroup})` : honour.title;
    const entry = counts.get(title) ?? { title, kind: honour.kind, count: 0 };
    entry.count++;
    counts.set(title, entry);
  }
  return [...counts.values()].sort((left, right) => right.count - left.count || left.title.localeCompare(right.title));
}

export const ordinal = (value: number) => {
  const tens = value % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[value % 10] ?? "th";
  return `${value}${suffix}`;
};

const MILESTONE_TEXT: Record<MilestoneKind, (milestone: PlayerMilestone) => string> = {
  seniorDebut: (entry) => `Senior debut for ${entry.club?.name ?? "his club"}`,
  clubDebut: (entry) => `Debut for ${entry.club?.name ?? "a new club"}`,
  internationalDebut: (entry) => `International debut for ${entry.club?.name ?? "his country"}`,
  firstGoal: () => "First senior goal",
  firstInternationalGoal: (entry) => `First goal for ${entry.club?.name ?? "his country"}`,
  appearances: (entry) => `${ordinal(entry.value ?? 0)} senior appearance`,
  clubAppearances: (entry) => `${ordinal(entry.value ?? 0)} appearance for ${entry.club?.name ?? "the club"}`,
  goals: (entry) => `${ordinal(entry.value ?? 0)} senior goal`,
  caps: (entry) => `${ordinal(entry.value ?? 0)} cap for ${entry.club?.name ?? "his country"}`,
};
export const milestoneText = (milestone: PlayerMilestone) => MILESTONE_TEXT[milestone.kind](milestone);

export const SEVERITY_LABELS: Record<InjurySeverity, string> = {
  minor: "Minor",
  moderate: "Moderate",
  serious: "Serious",
  "long-term": "Long-term",
};
export const SEVERITY_TONES: Record<InjurySeverity, "green" | "amber" | "red" | "violet"> = {
  minor: "green",
  moderate: "amber",
  serious: "red",
  "long-term": "violet",
};
