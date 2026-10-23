import { describe, expect, it } from "vitest";
import { PLAYER_SEARCH_RANGE_KEYS, PLAYER_SEARCH_RANGES } from "../shared/player-search.ts";
import {
  amountText,
  defaultFilters,
  FILTER_GROUPS,
  parseAmount,
  playerQuery,
  RANGE_FILTERS,
  rangeHint,
  rangeSpec,
  rangeText,
  readRange,
  SELECT_FILTERS,
  withFilter,
} from "./database-filters.ts";

const filters = (values: Record<string, string>) => ({ ...defaultFilters, ...values });

describe("player database filters", () => {
  it("offers a min–max pair for every numeric range the API accepts, inside its domain", () => {
    expect(RANGE_FILTERS.map((spec) => spec.key).sort()).toEqual([...PLAYER_SEARCH_RANGE_KEYS].sort());
    for (const spec of RANGE_FILTERS) {
      const domain = PLAYER_SEARCH_RANGES[spec.key];
      expect(spec.min).toBeGreaterThanOrEqual(0);
      expect(spec.max ?? domain.high).toBeLessThanOrEqual(domain.high);
      expect(defaultFilters).toMatchObject({ [`${spec.key}Min`]: "", [`${spec.key}Max`]: "" });
    }
    const groups = new Set(FILTER_GROUPS.map((group) => group.id));
    for (const field of [...RANGE_FILTERS, ...SELECT_FILTERS]) expect(groups.has(field.group)).toBe(true);
    // Every group has something in it, and the always-visible groups come first.
    for (const group of groups)
      expect([...RANGE_FILTERS, ...SELECT_FILTERS].some((field) => field.group === group)).toBe(true);
    expect(FILTER_GROUPS.map((group) => group.advanced)).toEqual([false, false, false, true, true, true, true]);
  });

  it("builds the API query from set filters only", () => {
    expect(playerQuery(defaultFilters)).toEqual({});
    expect(
      playerQuery(
        filters({
          position: "ST",
          ageMin: "18",
          ageMax: "21",
          valueMax: "5000000",
          availability: "availableLoan",
          league: "4",
          tierMax: "2",
          formMin: "6.5",
        }),
      ),
    ).toEqual({
      position: "ST",
      ageMin: "18",
      ageMax: "21",
      valueMax: "5000000",
      availableLoan: "1",
      league: "4",
      tierMax: "2",
      formMin: "6.5",
    });
    expect(playerQuery(filters({ availability: "everything" }))).toEqual({});
  });

  it("orders a reversed pair, clamps out-of-range values and ignores unreadable text", () => {
    expect(playerQuery(filters({ ageMin: "25", ageMax: "18" }))).toEqual({ ageMin: "18", ageMax: "25" });
    expect(playerQuery(filters({ abilityMin: "0", abilityMax: "150" }))).toEqual({ abilityMin: "1", abilityMax: "99" });
    expect(playerQuery(filters({ heightMin: "abc", heightMax: " " }))).toEqual({});
    expect(playerQuery(filters({ goalsMin: "007" }))).toEqual({ goalsMin: "7" });
  });

  it("applies a skill level only once its attribute or personality is chosen", () => {
    expect(playerQuery(filters({ attributeMin: "70", personalityMax: "40" }))).toEqual({});
    expect(playerQuery(filters({ attribute: "passing", attributeMin: "70", attributeMax: "60" }))).toEqual({
      attribute: "passing",
      attributeMin: "60",
      attributeMax: "70",
    });
  });

  it("explains corrected ranges inline and stays quiet otherwise", () => {
    const age = rangeSpec("age");
    expect(rangeHint(age, readRange(age, "21", "18"))).toBe("Minimum above maximum: searching 18–21.");
    expect(rangeHint(age, readRange(age, "10", ""))).toBe("Age is 14–45: searching ≥ 14.");
    expect(rangeHint(age, readRange(age, "18", "21"))).toBeNull();
    expect(rangeHint(age, readRange(age, "", ""))).toBeNull();
    const height = rangeSpec("height");
    expect(rangeHint(height, readRange(height, "", "250"))).toBe("Height is 140–220 cm: searching ≤ 220 cm.");
    const value = rangeSpec("value");
    expect(rangeHint(value, readRange(value, "2000000000", ""), (amount) => `£${amount / 1e6}m`)).toBe(
      "Value is £0m–£1000m: searching ≥ £1000m.",
    );
  });

  it("writes chip ranges as both ends, an open top or an open bottom", () => {
    expect(rangeText({ from: 18, to: 21 })).toBe("18–21");
    expect(rangeText({ from: 18 })).toBe("≥ 18");
    expect(rangeText({ to: 6 }, String, "months")).toBe("≤ 6 months");
    expect(rangeText({ from: 20, to: 20 })).toBe("20");
    expect(rangeText({ from: 1e6, to: 5e6 }, (amount) => `£${amount / 1e6}M`)).toBe("£1M–£5M");
    expect(rangeText({})).toBe("");
  });

  it("clears dependent filters when their parent changes", () => {
    const scoped = filters({ clubCountry: "3", league: "7", club: "11", attribute: "passing", attributeMin: "70", attributeMax: "80" });
    expect(withFilter(scoped, "clubCountry", "4")).toMatchObject({ clubCountry: "4", league: "", club: "" });
    expect(withFilter(scoped, "league", "8")).toMatchObject({ clubCountry: "3", league: "8", club: "" });
    expect(withFilter(scoped, "attribute", "")).toMatchObject({ attribute: "", attributeMin: "", attributeMax: "" });
    expect(withFilter(scoped, "attribute", "passing")).toEqual(scoped);
    expect(withFilter(scoped, "position", "GK")).toEqual({ ...scoped, position: "GK" });
  });

  it("reads typed amounts with k/m/bn suffixes and writes them back compactly", () => {
    expect(parseAmount("")).toBeUndefined();
    expect(parseAmount("750k")).toBe(750_000);
    expect(parseAmount("2.5M")).toBe(2_500_000);
    expect(parseAmount("1,200,000")).toBe(1_200_000);
    expect(parseAmount("1bn")).toBe(1e9);
    expect(parseAmount(".5m")).toBe(500_000);
    expect(parseAmount("-5")).toBeNull();
    expect(parseAmount("five")).toBeNull();
    for (const [amount, text] of [
      [2_500_000, "2.5m"],
      [750_000, "750k"],
      [1_000_000, "1m"],
      [1_234_567, "1234567"],
      [1_500, "1.5k"],
      [950, "950"],
      [1_162_790.7, "1162790.7"],
    ] as const) {
      expect(amountText(amount)).toBe(text);
      expect(parseAmount(text)).toBe(amount);
    }
  });
});
