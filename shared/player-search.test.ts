import { describe, expect, it } from "vitest";
import { PLAYER_SEARCH_RANGE_KEYS, PLAYER_SEARCH_RANGES, searchBounds } from "./player-search.ts";

describe("player search ranges", () => {
  it("leaves open ends and bounds at the edge of the domain unrestricted", () => {
    for (const key of PLAYER_SEARCH_RANGE_KEYS) {
      const { low, high } = PLAYER_SEARCH_RANGES[key];
      expect(searchBounds(key)).toEqual({ from: undefined, to: undefined, swapped: false });
      expect(searchBounds(key, low, high)).toEqual({ from: undefined, to: undefined, swapped: false });
    }
    expect(searchBounds("ability", 1, 99)).toEqual({ from: undefined, to: undefined, swapped: false });
    expect(searchBounds("ability", 2, 98)).toEqual({ from: 2, to: 98, swapped: false });
  });

  it("puts a reversed pair in order and rounds integer bounds inward", () => {
    expect(searchBounds("age", 25, 18)).toEqual({ from: 18, to: 25, swapped: true });
    expect(searchBounds("age", 17.5, 23.9)).toEqual({ from: 18, to: 23, swapped: false });
    expect(searchBounds("age", 23.9, 17.5)).toEqual({ from: 18, to: 23, swapped: true });
    // Fractional columns keep the typed bound.
    expect(searchBounds("form", 6.5, 7.25)).toEqual({ from: 6.5, to: 7.25, swapped: false });
    expect(searchBounds("minutes", 90.5)).toEqual({ from: 91, to: undefined, swapped: false });
  });
});
