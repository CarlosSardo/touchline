import {
  PLAYER_SEARCH_RANGES,
  type PlayerSearchRange,
} from "../shared/player-search.ts";

/** Raw form state of the player database filters: every value is the text of a control ("" = unset). */
export type Filters = Record<string, string>;

export type FilterGroupId =
  | "player"
  | "ability"
  | "contract"
  | "club"
  | "physical"
  | "personality"
  | "performance";

export const FILTER_GROUPS: { id: FilterGroupId; title: string; advanced: boolean }[] = [
  { id: "player", title: "Player", advanced: false },
  { id: "ability", title: "Ability & fitness", advanced: false },
  { id: "contract", title: "Contract & money", advanced: false },
  { id: "club", title: "Club & competition", advanced: true },
  { id: "physical", title: "Physical & attributes", advanced: true },
  { id: "personality", title: "Personality & traits", advanced: true },
  { id: "performance", title: "Season performance", advanced: true },
];

export interface RangeSpec {
  key: PlayerSearchRange;
  label: string;
  group: FilterGroupId;
  /** Accepted input; values outside are clamped (and the query never leaves the API domain). */
  min: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Short reading aid next to the label. */
  help?: string;
  /** Amounts in the accounting currency, typed in the display currency. */
  money?: boolean;
  /** Chosen with this select first (the range is disabled and ignored until then). */
  requires?: "attribute" | "personality";
}

export const RANGE_FILTERS: RangeSpec[] = [
  { key: "age", label: "Age", group: "player", min: 14, max: 45 },
  { key: "ability", label: "Current ability", group: "ability", min: 1, max: 99 },
  { key: "potential", label: "Potential", group: "ability", min: 1, max: 99 },
  { key: "value", label: "Value", group: "contract", min: 0, money: true },
  { key: "wage", label: "Wage / week", group: "contract", min: 0, money: true },
  { key: "contractMonths", label: "Contract left", group: "contract", min: 0, max: 120, unit: "months" },
  { key: "tier", label: "Division", group: "club", min: 1, max: 10, help: "1 = top flight" },
  { key: "height", label: "Height", group: "physical", min: 140, max: 220, unit: "cm" },
  { key: "weight", label: "Weight", group: "physical", min: 35, max: 130, unit: "kg" },
  { key: "attribute", label: "Attribute", group: "physical", min: 1, max: 99, requires: "attribute" },
  { key: "personality", label: "Personality", group: "personality", min: 1, max: 99, requires: "personality" },
  { key: "form", label: "Match rating", group: "performance", min: 0, max: 10, step: 0.1 },
  { key: "appearances", label: "Appearances", group: "performance", min: 0 },
  { key: "minutes", label: "Minutes", group: "performance", min: 0 },
  { key: "goals", label: "Goals", group: "performance", min: 0 },
  { key: "assists", label: "Assists", group: "performance", min: 0 },
];
export const rangeSpec = (key: PlayerSearchRange) =>
  RANGE_FILTERS.find((spec) => spec.key === key)!;

/** Single-choice filters; `availability` maps to the API flags listed / availableLoan / freeAgent. */
export const SELECT_FILTERS: { key: string; label: string; group: FilterGroupId }[] = [
  { key: "country", label: "Nationality", group: "player" },
  { key: "position", label: "Position", group: "player" },
  { key: "ageGroup", label: "Age group", group: "player" },
  { key: "foot", label: "Preferred foot", group: "player" },
  { key: "injured", label: "Fitness", group: "ability" },
  { key: "contractStatus", label: "Contract status", group: "contract" },
  { key: "availability", label: "Availability", group: "contract" },
  { key: "clubCountry", label: "Club country", group: "club" },
  { key: "league", label: "League", group: "club" },
  { key: "club", label: "Club", group: "club" },
  { key: "attribute", label: "Attribute", group: "physical" },
  { key: "personality", label: "Personality", group: "personality" },
  { key: "lifestyle", label: "Lifestyle", group: "personality" },
  { key: "trait", label: "Trait", group: "personality" },
];
export const AVAILABILITY = ["listed", "availableLoan", "freeAgent"] as const;

export const defaultFilters: Filters = Object.fromEntries([
  ...SELECT_FILTERS.map(({ key }) => [key, ""]),
  ...RANGE_FILTERS.flatMap(({ key }) => [
    [`${key}Min`, ""],
    [`${key}Max`, ""],
  ]),
]);

/** Filters that only mean something with their parent: clearing or changing the parent clears them. */
export const DEPENDENT_FILTERS: Record<string, string[]> = {
  attribute: ["attributeMin", "attributeMax"],
  personality: ["personalityMin", "personalityMax"],
  clubCountry: ["league", "club"],
  league: ["club"],
};

/** `key` set to `value`, with any filter that depended on its old value cleared. */
export function withFilter(filters: Filters, key: string, value: string): Filters {
  const next = { ...filters, [key]: value };
  if (filters[key] !== value)
    for (const dependent of DEPENDENT_FILTERS[key] ?? [])
      for (const cleared of [dependent, ...(DEPENDENT_FILTERS[dependent] ?? [])]) next[cleared] = "";
  return next;
}

export interface RangeReading {
  from?: number;
  to?: number;
  /** The minimum was above the maximum; from/to are in order. */
  swapped: boolean;
  /** A typed value was outside the accepted input and was clamped. */
  clamped: ("min" | "max")[];
}

/** Highest accepted input: the spec's own limit, never beyond what the API accepts. */
const highOf = (spec: RangeSpec) =>
  Math.min(spec.max ?? PLAYER_SEARCH_RANGES[spec.key].high, PLAYER_SEARCH_RANGES[spec.key].high);

const numberOf = (text: string | undefined) => {
  if (text === undefined || text.trim() === "") return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
};

/** The normalized range the query uses: blanks are open ends, values are clamped and a reversed pair is ordered. */
export function readRange(spec: RangeSpec, minText?: string, maxText?: string): RangeReading {
  const clamped: RangeReading["clamped"] = [];
  const high = highOf(spec);
  const clamp = (value: number | undefined, side: "min" | "max") => {
    if (value === undefined) return undefined;
    const bounded = Math.min(Math.max(value, spec.min), high);
    if (bounded !== value) clamped.push(side);
    return bounded;
  };
  const min = clamp(numberOf(minText), "min");
  const max = clamp(numberOf(maxText), "max");
  const swapped = min !== undefined && max !== undefined && min > max;
  return { from: swapped ? max : min, to: swapped ? min : max, swapped, clamped };
}

export const isActiveRange = (reading: RangeReading) =>
  reading.from !== undefined || reading.to !== undefined;

/** "18–21", "≥ 18", "≤ 21" (with the unit, if any); "" for an open range. */
export function rangeText(
  reading: Pick<RangeReading, "from" | "to">,
  format: (value: number) => string = String,
  unit?: string,
) {
  const { from, to } = reading;
  const text =
    from !== undefined && to !== undefined
      ? from === to
        ? format(from)
        : `${format(from)}–${format(to)}`
      : from !== undefined
        ? `≥ ${format(from)}`
        : to !== undefined
          ? `≤ ${format(to)}`
          : "";
  return text && unit ? `${text} ${unit}` : text;
}

/** Inline explanation when the typed range was corrected, or null. */
export function rangeHint(
  spec: RangeSpec,
  reading: RangeReading,
  format: (value: number) => string = String,
) {
  const shown = rangeText(reading, format, spec.unit);
  if (reading.swapped) return `Minimum above maximum: searching ${shown}.`;
  if (reading.clamped.length) {
    const limits = `${format(spec.min)}–${format(highOf(spec))}`;
    return `${spec.label} is ${limits}${spec.unit ? ` ${spec.unit}` : ""}: searching ${shown}.`;
  }
  return null;
}

/** The /api/players parameters of the filters (paging, sort and search are added by the page). */
export function playerQuery(filters: Filters): Record<string, string> {
  const query: Record<string, string> = {};
  for (const { key } of SELECT_FILTERS) {
    const value = filters[key];
    if (!value) continue;
    if (key === "availability") {
      if ((AVAILABILITY as readonly string[]).includes(value)) query[value] = "1";
    } else query[key] = value;
  }
  for (const spec of RANGE_FILTERS) {
    if (spec.requires && !filters[spec.requires]) continue;
    const { from, to } = readRange(spec, filters[`${spec.key}Min`], filters[`${spec.key}Max`]);
    if (from !== undefined) query[`${spec.key}Min`] = String(from);
    if (to !== undefined) query[`${spec.key}Max`] = String(to);
  }
  return query;
}

/**
 * A typed amount such as "750k", "2.5m" or "1,200,000": undefined when blank, null when it is not an amount.
 * Suffixes are case-insensitive; "bn" is a billion.
 */
export function parseAmount(text: string): number | null | undefined {
  const trimmed = text.trim().toLowerCase().replace(/[,_\s]/g, "");
  if (trimmed === "") return undefined;
  const match = /^(\d+(?:\.\d+)?|\.\d+)(k|m|bn|b)?$/.exec(trimmed);
  if (!match) return null;
  const scale = { k: 1e3, m: 1e6, b: 1e9, bn: 1e9 }[match[2] ?? ""] ?? 1;
  return Math.round(Number(match[1]) * scale * 100) / 100;
}

/** Short editable text of an amount: 2500000 → "2.5m", 750000 → "750k". */
export function amountText(value: number) {
  for (const [unit, suffix] of [[1e6, "m"], [1e3, "k"]] as const) {
    const tenths = (value / unit) * 10;
    if (value >= unit && Math.abs(tenths - Math.round(tenths)) < 1e-9)
      return `${Math.round(tenths) / 10}${suffix}`;
  }
  return String(Math.round(value * 100) / 100);
}
