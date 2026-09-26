import type {
  CallUp,
  CallUpDesk,
  CallUpDevelopment,
  CallUpDuration,
  CallUpLevel,
  CallUpReason,
  CallUpTeam,
} from "../shared/features/callups.ts";
import type { PlayerDetail } from "../shared/api.ts";
import { addDays, daysBetween } from "../shared/rules.ts";

/** Longest `days`/`until` call-up the server accepts (CALL_UP_RULES.maxDays). */
export const MAX_CALL_UP_DAYS = 120;

export const CALL_UPS_PATH = "call-ups";

export const teamKey = (team: CallUpTeam) => `${team.clubId}:${team.ageGroup}`;

export const REASON_LABELS: Record<CallUpReason, string> = {
  need: "Squad cover",
  merit: "On merit",
  "end-of-season": "End-of-season chance",
  instruction: "Your instruction",
};

export type DurationKind = CallUpDuration["kind"];

export const DURATION_OPTIONS: readonly [DurationKind, string][] = [
  ["match", "Next match"],
  ["days", "Days"],
  ["until", "Until date"],
  ["permanent", "Permanent"],
];

function dayParts(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return {
    day: date.getUTCDate(),
    month: date.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }),
    year: date.getUTCFullYear(),
  };
}

export function shortDate(value: string) {
  const { day, month } = dayParts(value);
  return `${day} ${month}`;
}

/** "3–10 Oct", "28 Oct – 4 Nov", "28 Dec 2026 – 4 Jan 2027"; one day renders once. */
export function dateRange(start: string, end: string) {
  const from = dayParts(start);
  const to = dayParts(end);
  if (start.slice(0, 10) === end.slice(0, 10)) return `${from.day} ${from.month}`;
  if (from.year !== to.year) return `${from.day} ${from.month} ${from.year} – ${to.day} ${to.month} ${to.year}`;
  if (from.month === to.month) return `${from.day}–${to.day} ${from.month}`;
  return `${from.day} ${from.month} – ${to.day} ${to.month}`;
}

/** Last segment of a team label: "Harbour FC / U19" -> "U19". */
export const shortTeamLabel = (label: string) => label.split(" / ").at(-1) ?? label;

export function untilText(callUp: Pick<CallUp, "duration" | "until">, today: string) {
  if (callUp.duration === "match") return `Next match · ${shortDate(callUp.until)}`;
  const left = daysBetween(today, callUp.until);
  return `Until ${shortDate(callUp.until)} · ${left <= 0 ? "last day" : left === 1 ? "1 day left" : `${left} days left`}`;
}

export interface DurationForm {
  days: number;
  date: string;
}

export function defaultDurationForm(today: string): DurationForm {
  return { days: 7, date: today ? addDays(today, 14) : "" };
}

export function buildDuration(
  kind: DurationKind,
  form: DurationForm,
  today: string,
): { duration: CallUpDuration } | { error: string } {
  if (kind === "match" || kind === "permanent") return { duration: { kind } };
  if (kind === "days") {
    if (!Number.isInteger(form.days) || form.days < 1 || form.days > MAX_CALL_UP_DAYS)
      return { error: `Choose between 1 and ${MAX_CALL_UP_DAYS} days.` };
    return { duration: { kind, days: form.days } };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) return { error: "Choose an end date." };
  if (form.date <= today) return { error: "The end date must be after today." };
  if (daysBetween(today, form.date) > MAX_CALL_UP_DAYS)
    return { error: `A call-up can last at most ${MAX_CALL_UP_DAYS} days.` };
  return { duration: { kind, date: form.date } };
}

const LEVEL_RANK: Record<CallUpLevel, number> = { U17: 0, U19: 1, BTeam: 2, Senior: 3 };

export type MoveDirection = "up" | "down" | "across" | "back";

export interface MoveTarget {
  clubId: number;
  ageGroup: CallUpTeam["ageGroup"];
  label: string;
  eligible: boolean;
  reason: string | null;
  direction: MoveDirection;
}

type Destination = PlayerDetail["squadDestinations"][number];

function levelOf(team: CallUpTeam, teams: CallUpDesk["teams"]): CallUpLevel {
  return teams.find((entry) => teamKey(entry) === teamKey(team))?.level ?? team.ageGroup;
}

/** Every other squad of the family, most senior first, with the direction of the move. */
export function moveTargets(
  destinations: readonly Destination[],
  teams: CallUpDesk["teams"],
  active: Pick<CallUp, "from"> | null,
): MoveTarget[] {
  const current = destinations.find((entry) => entry.current);
  const currentRank = current ? LEVEL_RANK[levelOf(current, teams)] : null;
  const rankOf = (team: CallUpTeam) => LEVEL_RANK[levelOf(team, teams)];
  return destinations
    .filter((entry) => !entry.current)
    .sort((left, right) => rankOf(right) - rankOf(left))
    .map((entry): MoveTarget => {
      const rank = rankOf(entry);
      const direction: MoveDirection =
        active && teamKey(active.from) === teamKey(entry)
          ? "back"
          : currentRank === null || rank === currentRank
            ? "across"
            : rank > currentRank
              ? "up"
              : "down";
      return {
        clubId: entry.clubId,
        ageGroup: entry.ageGroup,
        label: entry.label,
        eligible: entry.eligible,
        reason: entry.reason,
        direction,
      };
    });
}

export const DIRECTION_MARKS: Record<MoveDirection, string> = { up: "↑", down: "↓", across: "↔", back: "↩" };

/** Active call-ups grouped by the team the player now plays for, in the desk's team order. */
export function callUpsByTeam(desk: Pick<CallUpDesk, "teams" | "active">) {
  return desk.teams.map((team) => ({
    team,
    callUps: desk.active.filter((entry) => teamKey(entry.to) === teamKey(team)),
  }));
}

/**
 * Debut budget line: "Debuts this season: 1 played · 1 pending / 3". `played` counts debuts already made; `used` also
 * counts pending debut call-ups. Older servers without `played` show the combined count.
 */
export function debutText(budget: CallUpDesk["debutBudgets"][number], several: boolean) {
  const prefix = several ? `${budget.clubName} debuts` : "Debuts this season";
  if (budget.played === undefined) return `${prefix}: ${budget.used} / ${budget.limit}`;
  const pending = Math.max(0, budget.used - budget.played);
  return `${prefix}: ${budget.played} played${pending ? ` · ${pending} pending` : ""} / ${budget.limit}`;
}

/** Coach verdict on a development request: "Coach, 3 Oct: First team: 3 fitter options at LW." */
export function developmentStatusText(request: Pick<CallUpDevelopment, "since" | "status" | "checked">) {
  if (!request.status) return `Requested ${shortDate(request.since)} · waiting for the coach's next review.`;
  return `Coach${request.checked ? `, ${shortDate(request.checked)}` : ""}: ${request.status}`;
}

/** Squad-row note for a player on a call-up: "From U17 · Next match · 3 Oct". */
export function callUpBadge(entry: Pick<CallUp, "duration" | "until"> & { fromLabel: string }, today: string) {
  return `From ${shortTeamLabel(entry.fromLabel)} · ${untilText(entry, today)}`;
}

/** Optional fields a `squad` history row carries once the history API forwards the call-up flags. */
export interface CallUpFlags {
  callUp?: boolean;
  callUpReturn?: boolean;
  until?: string | null;
}

/** `returnedOn`: undefined = not a call-up row, null = still away, else the date he went back. */
export type Collapsed<Row> = Row & { returnedOn?: string | null };

/**
 * Folds each call-up and its return into one row (the call-up row), per `group` (one player).
 * Rows keep their input order; any later move of the same player closes an open call-up.
 */
export function collapseCallUps<Row extends CallUpFlags & { date: string | null }>(
  rows: readonly Row[],
  group: (row: Row) => string | number = () => 0,
): Collapsed<Row>[] {
  const order = rows
    .map((row, index) => ({ row, index }))
    .sort(
      (left, right) =>
        (left.row.date ?? "").localeCompare(right.row.date ?? "") ||
        Number(!!left.row.callUpReturn) - Number(!!right.row.callUpReturn) ||
        left.index - right.index,
    );
  const returned = new Map<number, string | null>();
  const absorbed = new Set<number>();
  const open = new Map<string | number, number>();
  for (const { row, index } of order) {
    const key = group(row);
    const openIndex = open.get(key);
    if (row.callUpReturn) {
      if (openIndex === undefined) continue;
      returned.set(openIndex, row.date);
      absorbed.add(index);
      open.delete(key);
      continue;
    }
    if (openIndex !== undefined) {
      returned.set(openIndex, row.date);
      open.delete(key);
    }
    if (row.callUp) {
      returned.set(index, null);
      open.set(key, index);
    }
  }
  return rows.flatMap((row, index) =>
    absorbed.has(index) ? [] : returned.has(index) ? [{ ...row, returnedOn: returned.get(index) ?? null }] : [row],
  );
}

const GROUP_RANK: Record<string, number> = { U17: 0, U19: 1 };

/** One-line summary of a collapsed call-up: "Called up to U19 · 3–10 Oct". */
export function callUpSummary(input: {
  toLabel: string | null;
  fromGroup: string | null;
  toGroup: string | null;
  start: string | null;
  returnedOn: string | null | undefined;
  until?: string | null;
}) {
  const target = shortTeamLabel(input.toLabel ?? input.toGroup ?? "another squad");
  const toRank =
    input.toGroup && input.toGroup in GROUP_RANK
      ? GROUP_RANK[input.toGroup]
      : /reserve/i.test(input.toLabel ?? "")
        ? 2
        : 3;
  const fromRank =
    input.fromGroup && input.fromGroup in GROUP_RANK
      ? GROUP_RANK[input.fromGroup]
      : input.fromGroup
        ? toRank === 3
          ? 2
          : 3
        : null;
  const verb =
    fromRank === null
      ? toRank === 3
        ? "Called up to"
        : "Moved to"
      : toRank > fromRank
        ? "Called up to"
        : "Sent down to";
  if (!input.start) return `${verb} ${target}`;
  const when = input.returnedOn
    ? dateRange(input.start, input.returnedOn)
    : input.until
      ? `${dateRange(input.start, input.until)} (ongoing)`
      : `since ${shortDate(input.start)}`;
  return `${verb} ${target} · ${when}`;
}
