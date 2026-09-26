// Pure helpers for the youth-internationals UI (contract: decisions inbox lead-youth-internationals-contract.md).
import type {
  InternationalsDesk,
  NationalTeamView,
  PlayerCaps,
  ReleasePolicy,
} from "../shared/features/youth-internationals.ts";
import { dateRange, shortDate } from "./callups.ts";

export const INTERNATIONALS_PATH = "internationals";
export const nationalTeamPath = (teamId: number) => `internationals/teams/${teamId}`;
export const playerCapsPath = (playerId: number) => `players/${playerId}/caps`;

export const RELEASE_OPTIONS: readonly [ReleasePolicy, string, string][] = [
  ["club policy", "Club policy", "Release youth-team players; key senior players may be kept back."],
  ["always", "Always release", "Every call-up is accepted."],
  ["mandatory only", "Only when mandatory", "Keep players outside FIFA windows and the close season."],
];

type Tournament = InternationalsDesk["tournaments"][number];
type ClubPlayer = InternationalsDesk["clubPlayers"][number];

const AGE_ORDER = ["U21", "U20", "U19", "U17"];

/** Tournament phase as shown to the director; a rest year of a biennial event reads "Not held this season". */
export function phaseText(tournament: Pick<Tournament, "held" | "phase">) {
  if (!tournament.held || tournament.phase === "rest year") return "Not held this season";
  if (!tournament.phase) return "Scheduled";
  return tournament.phase[0].toUpperCase() + tournament.phase.slice(1);
}

export function phaseTone(tournament: Pick<Tournament, "held" | "phase">) {
  if (!tournament.held || tournament.phase === "rest year") return "neutral" as const;
  if (tournament.phase === "complete") return "green" as const;
  if (tournament.phase === "groups" || tournament.phase === "knockout") return "blue" as const;
  return "amber" as const;
}

/** Tournaments by team age group (oldest first), held editions before rest years, then by start date. */
export function tournamentsByAge(tournaments: readonly Tournament[]) {
  const groups = new Map<string, Tournament[]>();
  for (const tournament of tournaments) {
    const list = groups.get(tournament.ageGroup) ?? [];
    list.push(tournament);
    groups.set(tournament.ageGroup, list);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => AGE_ORDER.indexOf(left) - AGE_ORDER.indexOf(right))
    .map(([ageGroup, list]) => ({
      ageGroup,
      tournaments: [...list].sort(
        (left, right) => Number(right.held) - Number(left.held) || left.start.localeCompare(right.start) || left.name.localeCompare(right.name),
      ),
    }));
}

/** Club players away or held back, keyed by player id (a player has at most one duty record). */
export function dutyByPlayer(players: readonly ClubPlayer[] | undefined) {
  return new Map((players ?? []).map((entry) => [entry.playerId, entry]));
}

/** Squad-row note: "England U19 · until 14 Jul" or "Kept back from England U19". */
export function dutyText(entry: Pick<ClubPlayer, "status" | "teamName" | "until">) {
  return entry.status === "withheld" ? `Kept back from ${entry.teamName}` : `${entry.teamName} · until ${shortDate(entry.until)}`;
}

export function dutyPeriod(entry: Pick<ClubPlayer, "from" | "until">) {
  return dateRange(entry.from, entry.until);
}

export const SQUAD_STATUS_LABELS: Record<NationalTeamView["players"][number]["status"], string> = {
  selected: "Selected",
  provisional: "Provisional",
  withheld: "Kept back by club",
};

/** "12 caps · 3 goals"; "Uncapped" without appearances. */
export function capsText(total: Pick<PlayerCaps["total"], "appearances" | "goals">) {
  if (!total.appearances) return "Uncapped";
  const caps = `${total.appearances} ${total.appearances === 1 ? "cap" : "caps"}`;
  return total.goals ? `${caps} · ${total.goals} ${total.goals === 1 ? "goal" : "goals"}` : caps;
}

/** Seasons a player represented a team: "2026/27" or "2025/26–2027/28". */
export function capSeasons(line: { firstSeason: number; lastSeason: number }) {
  const label = (season: number) => `${season}/${String(season + 1).slice(-2)}`;
  return line.firstSeason === line.lastSeason ? label(line.firstSeason) : `${label(line.firstSeason)}–${label(line.lastSeason)}`;
}
