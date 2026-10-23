import type {
  CompetitionScorer,
  CompetitionScorers,
  CompetitionScorerTeam,
} from "../shared/api.ts";

/** Rows shown first and added by each "Show more". */
export const SCORERS_STEP = 20;
/** The most rows the server returns (server/competition-scorers.ts MAX_SCORERS). */
export const SCORERS_MAX = 500;

/** API path of a competition's race; no season means the current one. */
export function scorersPath(leagueId: number, season: number | null, limit: number) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (season !== null) params.set("season", String(season));
  return `competitions/${leagueId}/scorers?${params}`;
}

/** Row count after "Show more", or null when every scorer (up to the server maximum) is listed. */
export function nextScorersLimit(shown: number, total: number) {
  const available = Math.min(total, SCORERS_MAX);
  return shown >= available ? null : Math.min(available, shown + SCORERS_STEP);
}

export const goalsText = (goals: number) =>
  `${goals} goal${goals === 1 ? "" : "s"}`;

/** National-team tournaments list teams, everything else clubs. */
export const teamHeading = (scorers: readonly CompetitionScorer[]) =>
  scorers.some((scorer) => scorer.teams.some((team) => team.type === "national"))
    ? "Team"
    : "Club";

export const teamSummary = (team: CompetitionScorerTeam) =>
  `${team.name}: ${goalsText(team.goals)} in ${team.appearances} app${team.appearances === 1 ? "" : "s"}, ${team.minutes} min`;

/** The Golden Boot line under the leader: his margin, or how many share the lead. */
export function leaderLine(
  race: Pick<CompetitionScorers, "leaders" | "scorers">,
) {
  const [leader, next] = race.scorers;
  if (!leader) return "";
  if (race.leaders > 1) {
    const others = race.leaders - 1;
    return `Level with ${others} other${others === 1 ? "" : "s"} on ${goalsText(leader.goals)}`;
  }
  if (!next) return "The only scorer";
  return `${goalsText(leader.goals - next.goals)} clear of ${next.name}`;
}

/** Ordinal rank text for screen readers: "joint 2nd" when the rank is shared. */
export function rankLabel(scorers: readonly CompetitionScorer[], index: number) {
  const rank = scorers[index].rank;
  const shared =
    scorers[index - 1]?.rank === rank || scorers[index + 1]?.rank === rank;
  const suffix =
    rank % 100 >= 11 && rank % 100 <= 13
      ? "th"
      : (["th", "st", "nd", "rd"][rank % 10] ?? "th");
  return `${shared ? "Joint " : ""}${rank}${suffix}`;
}
