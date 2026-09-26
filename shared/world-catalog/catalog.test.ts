import { describe, expect, it } from "vitest";
import { WORLD_CATALOG, clubNameKey, worldCatalog } from "./index.ts";
import {
  CATALOG_ASSIGNMENT,
  CATALOG_FILE_KEYS,
  summarizeCatalog,
  validateCatalog,
} from "./validate.ts";
import { UEFA_NORTH_REAL_CLUB_NAMES } from "./uefa-north.ts";
import type { CatalogFile, NationSpec, WorldCatalog } from "./types.ts";

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
    expect(summary.bTeams).toBeLessThanOrEqual(150);
    expect(summary.estimatedPlayers).toBeLessThanOrEqual(210_000);
  });

  it("compares club names without case, diacritics, punctuation or a club affix", () => {
    expect(clubNameKey("Malmö FF")).toBe(clubNameKey("Malmo"));
    expect(clubNameKey("FC København")).toBe(clubNameKey("Kobenhavn"));
    expect(clubNameKey("Al-Rayyan SC")).toBe(clubNameKey("Al Rayyan"));
    expect(clubNameKey("Luton Town")).not.toBe(clubNameKey("Luton"));
    const english = UEFA_NORTH_REAL_CLUB_NAMES.EN ?? [];
    expect(english.length).toBeGreaterThan(0);
    expect(worldCatalog().avoidedClubNames("EN").has(clubNameKey(english[0]))).toBe(true);
  });

  it("accepts 48-club conference tiers with per-conference movement", () => {
    const north = WORLD_CATALOG.files.find((file) => file.file === "uefa-north")!;
    const original = north.nations.find((nation) => nation.code === "EN");
    if (!original) return;
    const withEngland = (england: NationSpec): WorldCatalog => ({
      ...WORLD_CATALOG,
      files: WORLD_CATALOG.files.map((file) =>
        file === north ? { ...file, nations: file.nations.map((nation) => (nation.code === "EN" ? england : nation)) } : file,
      ),
    });
    const movementErrors = (england: NationSpec) =>
      validateCatalog(withEngland(england), { nations: ["EN"] })
        .filter((issue) => issue.level === "error" && /leagues|movement/.test(issue.path))
        .map((issue) => `${issue.path}: ${issue.message}`);
    const england = structuredClone(original);
    const lowest = england.football!.leagues.at(-1)!;
    Object.assign(lowest, { size: 48, conferences: ["North", "South"], split: undefined, championship: undefined });
    const boundary = england.football!.movement.find((entry) => entry.upper === lowest.tier - 1)!;
    Object.assign(boundary, {
      perConference: true,
      promoted: 2,
      relegated: 4,
      playoffs: [{ type: "promotion", positions: [2, 7], places: 2, legs: 1 }],
    });
    expect(movementErrors(england)).toEqual([]);
    boundary.promoted = 3;
    expect(movementErrors(england).join("\n")).toContain("split evenly");
    lowest.size = 50;
    expect(movementErrors(england).join("\n")).toContain("size must be 6-48");
  });

  it("validates regional name lists, city prepositions and {cityAdj} templates", () => {
    const west = WORLD_CATALOG.files.find((file) => file.file === "uefa-west")!;
    const original = west.nations.find((nation) => nation.code === "ES");
    if (!original?.names.regional) return;
    const errors = (spain: NationSpec) =>
      validateCatalog(
        {
          ...WORLD_CATALOG,
          files: WORLD_CATALOG.files.map((file) =>
            file === west ? { ...file, nations: file.nations.map((nation) => (nation.code === "ES" ? spain : nation)) } : file,
          ),
        },
        { nations: ["ES"] },
      )
        .filter((issue) => issue.level === "error")
        .map((issue) => issue.message)
        .join("\n");
    const spain = structuredClone(original);
    expect(errors(spain)).not.toMatch(/regional names|preposition|\{cityAdj\}/);
    spain.names.regional!.push({ regions: ["Atlantis"], given: spain.names.given });
    spain.cities.major[0].preposition = "Do";
    const naming = spain.football!.clubNaming;
    naming.templates = naming.templates.map((template) => ({ ...template, pattern: `{cityAdj} ${template.pattern}` }));
    expect(errors(spain)).toContain('no city has region "Atlantis"');
    expect(errors(spain)).toContain("preposition must be one lowercase word");
    expect(errors(spain)).toContain("needs a template without {demonym} and {cityAdj}");
  });
});
