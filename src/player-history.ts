import type {
  PlayerCompetitionStats,
  PlayerHistory,
  PlayerMove,
  PlayerMoveKind,
  PlayerStatLine,
} from "../shared/api.ts";

export const ALL_COMPETITIONS = "";

export const MOVE_KIND_LABELS: Record<PlayerMoveKind, string> = {
  transfer: "Transfer",
  free: "Free transfer",
  loan: "Loan",
  loanReturn: "Loan return",
  loanRecall: "Loan recall",
  loanPurchase: "Loan made permanent",
  registration: "Registration",
  squad: "Squad move",
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

export const competitionKey = (competition: PlayerCompetitionStats["competition"]) =>
  competition.id === null ? "friendlies" : String(competition.id);

export function competitionLabel(competition: PlayerCompetitionStats["competition"]) {
  const group = competition.ageGroup;
  return group && group !== "Senior" && !competition.name.includes(group)
    ? `${competition.name} (${group})`
    : competition.name;
}

export interface SeasonStatRow extends PlayerCompetitionStats {
  key: string;
  season: number;
}

export function seasonRows(history: PlayerHistory, competition = ALL_COMPETITIONS): SeasonStatRow[] {
  return history.seasons.flatMap((season) =>
    season.competitions
      .filter((line) => competition === ALL_COMPETITIONS || competitionKey(line.competition) === competition)
      .map((line) => ({
        ...line,
        season: season.season,
        key: `${season.season}:${line.club.id}:${competitionKey(line.competition)}`,
      })),
  );
}

/** Competitions the player has statistics in, alphabetical, friendlies last. */
export function historyCompetitions(history: PlayerHistory) {
  const found = new Map<string, string>();
  for (const season of history.seasons)
    for (const line of season.competitions) {
      const key = competitionKey(line.competition);
      if (!found.has(key)) found.set(key, competitionLabel(line.competition));
    }
  return [...found.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort(
      (left, right) =>
        Number(left.key === "friendlies") - Number(right.key === "friendlies") ||
        left.label.localeCompare(right.label),
    );
}

/** Sums lines the way the server does: goals, assists and rating only over recorded (full-detail) appearances. */
export function totalStatLine(lines: readonly PlayerStatLine[]): PlayerStatLine {
  let appearances = 0;
  let minutes = 0;
  let recorded = 0;
  let goals = 0;
  let assists = 0;
  let ratingSum = 0;
  for (const line of lines) {
    appearances += line.appearances;
    minutes += line.minutes;
    if (!line.recordedAppearances) continue;
    recorded += line.recordedAppearances;
    goals += line.goals ?? 0;
    assists += line.assists ?? 0;
    ratingSum += (line.averageRating ?? 0) * line.recordedAppearances;
  }
  return {
    appearances,
    minutes,
    recordedAppearances: recorded,
    goals: recorded ? goals : null,
    assists: recorded ? assists : null,
    averageRating: recorded ? Math.round((ratingSum / recorded) * 100) / 100 : null,
    coverage: !recorded ? "none" : recorded >= appearances ? "full" : "partial",
  };
}

export const seasonLabel = (season: number) => `${season}/${String(season + 1).slice(-2)}`;
