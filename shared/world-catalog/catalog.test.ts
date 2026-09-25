import { describe, expect, it } from "vitest";
import { WORLD_CATALOG } from "./index.ts";
import {
  CATALOG_ASSIGNMENT,
  CATALOG_FILE_KEYS,
  summarizeCatalog,
  validateCatalog,
} from "./validate.ts";
import type { CatalogFile } from "./types.ts";

// Authors check one file while others are still empty: CATALOG_SCOPE=caf,afc npx vitest run shared/world-catalog
const scope = (process.env.CATALOG_SCOPE ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry): entry is CatalogFile =>
    CATALOG_FILE_KEYS.includes(entry as CatalogFile),
  );

describe("world catalog", () => {
  it("assigns the 211 FIFA members and the directive's league tiers", () => {
    const count = (confederation: string) =>
      CATALOG_ASSIGNMENT.filter((entry) => entry.confederation === confederation).length;
    expect(new Set(CATALOG_ASSIGNMENT.map((entry) => entry.code)).size).toBe(211);
    expect(CATALOG_ASSIGNMENT).toHaveLength(211);
    expect(
      ["UEFA", "CAF", "AFC", "CONCACAF", "CONMEBOL", "OFC"].map(count),
    ).toEqual([55, 54, 46, 35, 10, 11]);
    expect(CATALOG_ASSIGNMENT.filter((entry) => entry.tiers > 0)).toHaveLength(107);
    expect(CATALOG_ASSIGNMENT.reduce((total, entry) => total + entry.tiers, 0)).toBe(146);
  });

  it("has no validation errors in scope", () => {
    const issues = validateCatalog(WORLD_CATALOG, { scope });
    const errors = issues
      .filter((issue) => issue.level === "error")
      .map((issue) => `${issue.path}: ${issue.message}`);
    expect(errors).toEqual([]);
  });

  it("stays within the world-size budget once complete", () => {
    if (scope.length && scope.length < CATALOG_FILE_KEYS.length) return;
    const summary = summarizeCatalog(WORLD_CATALOG);
    expect(summary.nations).toBe(211);
    expect(summary.leagueTiers).toBe(146);
    expect(summary.firstTeamClubs).toBeLessThanOrEqual(2600);
    expect(summary.estimatedPlayers).toBeLessThanOrEqual(210_000);
  });
});
