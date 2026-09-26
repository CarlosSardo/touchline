import { POSITIONS } from "../shared/rules.ts";
import type { Player } from "../shared/types.ts";
import { bodyOf } from "./players.ts";

export type SortDirection = "asc" | "desc";
export interface SortState<Key extends string = string> {
  key: Key;
  direction: SortDirection;
}
export type SortScalar = number | string | null | undefined;
/** A tuple compares element by element, e.g. goals then assists. */
export type SortValue = SortScalar | readonly SortScalar[];
export interface SortColumn<Row, Key extends string = string> {
  key: Key;
  /** Raw value to order by; null, undefined, "" and NaN always sort last. */
  value: (row: Row) => SortValue;
  /** Direction used by the first click on the column. */
  defaultDirection?: SortDirection;
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function isMissing(value: SortScalar): value is null | undefined | "" {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (typeof value === "number" && Number.isNaN(value))
  );
}

function parts(value: SortValue): readonly SortScalar[] {
  return typeof value === "object" && value !== null ? value : [value];
}

function compareScalar(
  first: SortScalar,
  second: SortScalar,
  direction: SortDirection,
) {
  const firstMissing = isMissing(first);
  const secondMissing = isMissing(second);
  if (firstMissing || secondMissing)
    return firstMissing === secondMissing ? 0 : firstMissing ? 1 : -1;
  const order =
    typeof first === "number" && typeof second === "number"
      ? first - second
      : collator.compare(String(first), String(second));
  return direction === "asc" ? order : -order;
}

/** Compares two sort values in a direction; missing values are last either way. */
export function compareSortValues(
  first: SortValue,
  second: SortValue,
  direction: SortDirection = "asc",
) {
  const left = parts(first);
  const right = parts(second);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const result = compareScalar(left[index], right[index], direction);
    if (result) return Math.sign(result);
  }
  return 0;
}

/** Returns a sorted copy. Ties use the tie-breakers in their own direction, then input order. */
export function sortRows<Row>(
  rows: readonly Row[],
  column: Pick<SortColumn<Row>, "value"> | null | undefined,
  direction: SortDirection,
  tieBreakers: readonly Pick<SortColumn<Row>, "value" | "defaultDirection">[] = [],
): Row[] {
  if (!column) return [...rows];
  return rows
    .map((row, index) => ({
      row,
      index,
      primary: column.value(row),
      ties: tieBreakers.map((tie) => tie.value(row)),
    }))
    .sort(
      (first, second) =>
        compareSortValues(first.primary, second.primary, direction) ||
        first.ties.reduce<number>(
          (result, value, index) =>
            result ||
            compareSortValues(
              value,
              second.ties[index],
              tieBreakers[index].defaultDirection ?? "asc",
            ),
          0,
        ) ||
        first.index - second.index,
    )
    .map((entry) => entry.row);
}

/** First click uses the column default; clicking the sorted column again reverses it. */
export function nextSort<Key extends string>(
  current: SortState<Key> | null | undefined,
  key: Key,
  defaultDirection: SortDirection = "asc",
): SortState<Key> {
  return current?.key === key
    ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
    : { key, direction: defaultDirection };
}

export function ariaSort(state: SortState | null | undefined, key: string) {
  if (state?.key !== key) return undefined;
  return state.direction === "asc" ? "ascending" : "descending";
}

/** Football order (GK, CB, LB, RB, DM, CM, AM, LW, RW, ST); unknown positions are missing. */
export function positionRank(position: string | null | undefined) {
  const index = (POSITIONS as readonly string[]).indexOf(position ?? "");
  return index < 0 ? null : index;
}

export function dateValue(date: string | null | undefined) {
  if (!date) return null;
  const time = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00Z` : date);
  return Number.isNaN(time) ? null : time;
}

/** Age, then exact birth date, so ascending always means youngest first. */
export function ageValue(age: number | null | undefined, birthDate?: string | null) {
  const born = dateValue(birthDate);
  return [age, born === null ? null : -born] as const;
}

export function rankOf(order: readonly string[], value: string | null | undefined) {
  const index = order.indexOf(value ?? "");
  return index < 0 ? null : index;
}

export const PLAYER_TIE_BREAKERS: SortColumn<Pick<Player, "id" | "name">>[] = [
  { key: "name", value: (player) => player.name },
  { key: "id", value: (player) => player.id },
];

export type PlayerSortKey =
  | "name"
  | "position"
  | "age"
  | "nationality"
  | "club"
  | "ability"
  | "potential"
  | "value"
  | "wage"
  | "form"
  | "contract"
  | "fitness"
  | "morale"
  | "appearances"
  | "goals"
  | "height"
  | "weight";

export const PLAYER_COLUMNS: { [Key in PlayerSortKey]: SortColumn<Player, Key> } = {
  name: { key: "name", value: (player) => player.name, defaultDirection: "asc" },
  position: {
    key: "position",
    value: (player) => positionRank(player.position),
    defaultDirection: "asc",
  },
  age: {
    key: "age",
    value: (player) => ageValue(player.age, player.birth_date),
    defaultDirection: "asc",
  },
  nationality: {
    key: "nationality",
    value: (player) => player.nationality,
    defaultDirection: "asc",
  },
  club: {
    key: "club",
    value: (player) => player.club_name ?? null,
    defaultDirection: "asc",
  },
  ability: { key: "ability", value: (player) => player.ability, defaultDirection: "desc" },
  potential: {
    key: "potential",
    value: (player) => player.potential,
    defaultDirection: "desc",
  },
  value: { key: "value", value: (player) => player.value, defaultDirection: "desc" },
  wage: { key: "wage", value: (player) => player.wage, defaultDirection: "desc" },
  form: { key: "form", value: (player) => player.form, defaultDirection: "desc" },
  contract: {
    key: "contract",
    value: (player) => (player.club_id ? dateValue(player.contract_end) : null),
    defaultDirection: "asc",
  },
  fitness: { key: "fitness", value: (player) => player.fitness, defaultDirection: "desc" },
  morale: { key: "morale", value: (player) => player.morale, defaultDirection: "desc" },
  appearances: {
    key: "appearances",
    value: (player) => player.appearances,
    defaultDirection: "desc",
  },
  goals: {
    key: "goals",
    value: (player) => [player.goals, player.assists],
    defaultDirection: "desc",
  },
  height: {
    key: "height",
    value: (player) => bodyOf(player).height,
    defaultDirection: "desc",
  },
  weight: {
    key: "weight",
    value: (player) => bodyOf(player).weight,
    defaultDirection: "desc",
  },
};

/** Sorts players by a standard column with the shared name/id tie-breakers. */
export function sortPlayers<Row extends Player>(
  players: readonly Row[],
  key: PlayerSortKey,
  direction: SortDirection = PLAYER_COLUMNS[key].defaultDirection ?? "asc",
) {
  return sortRows(players, PLAYER_COLUMNS[key], direction, PLAYER_TIE_BREAKERS);
}
