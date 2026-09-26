import { describe, expect, it } from "vitest";
import {
  allocateEntrants,
  cohortCutoff,
  editionHosts,
  editionYear,
  exposureValueFactor,
  heldInSeason,
  NATIONAL_LINE,
  qualifyingAdvancers,
  qualifyingSeason,
  releaseChance,
  releaseDecision,
  selectNationalSquad,
  tournamentExposure,
  YOUTH_TOURNAMENTS,
  type EntrantTeam,
  type SquadCandidate,
  type YouthTournamentSpec,
} from "./youth-internationals.ts";
import { knockoutRules } from "../competition-rules.ts";
import type { Position } from "../types.ts";

const tournament = (id: string) => YOUTH_TOURNAMENTS.find((spec) => spec.id === id)!;

describe("youth tournament catalog", () => {
  it("keeps every edition inside one July–June season and sizes groups to the finals", () => {
    for (const spec of YOUTH_TOURNAMENTS) {
      const groups = Math.ceil(spec.teams / spec.groupSize);
      const groupRounds = spec.groupSize % 2 ? spec.groupSize : spec.groupSize - 1;
      const knockoutRounds = spec.finalRound ? (spec.finalRound % 2 ? spec.finalRound : spec.finalRound - 1) : Math.log2(spec.advance);
      expect(Number.isInteger(knockoutRounds), spec.id).toBe(true);
      expect(spec.advance, spec.id).toBeLessThanOrEqual(spec.teams);
      expect(groups * spec.groupSize, spec.id).toBeGreaterThanOrEqual(spec.teams);
      // Three days between matchdays: the edition must finish before the next season's first of July.
      const days = (groupRounds + knockoutRounds - 1) * 3;
      const start = Date.parse(`2027-${spec.start}`);
      const end = new Date(start + days * 86_400_000).toISOString().slice(5, 10);
      if (spec.start < "07-01") expect(end >= spec.start && end <= "06-30", `${spec.id} ends ${end}`).toBe(true);
      else expect(end >= spec.start, `${spec.id} ends ${end}`).toBe(true);
      expect(spec.squad).toBeGreaterThanOrEqual(18);
      if (spec.slots) expect(Object.values(spec.slots).reduce((sum, places) => sum + places, 0)).toBeLessThanOrEqual(spec.teams);
    }
  });

  it("follows the verified formats and cycles (U17 WC annual 48, U-20 WC odd years 24, U21 EURO 16 in odd years)", () => {
    const u17 = tournament("fifa-u17-world-cup");
    expect([u17.teams, u17.advance, u17.cycle, u17.extraTime]).toEqual([48, 32, "annual", false]);
    expect(u17.slots).toEqual({ AFC: 9, CAF: 10, CONCACAF: 8, CONMEBOL: 7, OFC: 3, UEFA: 11 });
    const u20 = tournament("fifa-u20-world-cup");
    expect([heldInSeason(u20, 2026), heldInSeason(u20, 2027), heldInSeason(u20, 2028)]).toEqual([false, true, false]);
    const u21 = tournament("uefa-u21-euro");
    // Finals in June 2027 belong to season 2026/27; 2029 to 2028/29.
    expect([heldInSeason(u21, 2026), heldInSeason(u21, 2027), heldInSeason(u21, 2028)]).toEqual([true, false, true]);
    expect(editionYear(u21, 2026)).toBe(2027);
    expect([tournament("uefa-u17-euro").teams, tournament("uefa-u19-euro").teams]).toEqual([8, 8]);
  });

  it("uses the cohort cutoffs: U17 Y−17, U19 Y−19, U-20 WC Y−20, U21 EURO Y−23", () => {
    expect(cohortCutoff(tournament("fifa-u17-world-cup"), 2026)).toBe("2009-01-01");
    expect(cohortCutoff(tournament("uefa-u17-euro"), 2026)).toBe("2010-01-01");
    expect(cohortCutoff(tournament("uefa-u19-euro"), 2026)).toBe("2007-01-01");
    expect(cohortCutoff(tournament("fifa-u20-world-cup"), 2027)).toBe("2007-01-01");
    expect(cohortCutoff(tournament("uefa-u21-euro"), 2026)).toBe("2004-01-01");
  });

  it("plays U21 and U19 qualifying the season before the finals, U17 qualifying in the finals season", () => {
    expect(qualifyingSeason(tournament("uefa-u21-euro"), 2028)).toBe(2027);
    expect(qualifyingSeason(tournament("uefa-u19-euro"), 2027)).toBe(2026);
    expect(qualifyingSeason(tournament("uefa-u17-euro"), 2026)).toBe(2026);
    expect(tournament("uefa-u21-euro").qualifying!.matchdays).toHaveLength(10);
  });

  it("uses catalog knockout rules: straight to penalties at U17, extra time at U21, U21 qualifiers home and away", () => {
    expect(knockoutRules("FIFA U-17 World Cup", "Quarter-final")).toMatchObject({ extraTime: false, neutral: true, legs: 1 });
    expect(knockoutRules("UEFA European Under-21 Championship", "Group stage")).toMatchObject({ extraTime: true, neutral: true });
    expect(knockoutRules("UEFA European Under-21 Championship Qualifying", "Group stage").neutral).toBe(false);
    expect(knockoutRules("UEFA European Under-17 Championship Qualifying", "Group stage").neutral).toBe(true);
  });
});

describe("entrants and hosts", () => {
  const confederations = ["UEFA", "AFC", "CAF", "CONCACAF", "CONMEBOL", "OFC"];
  const teams: EntrantTeam[] = confederations.flatMap((confederation, index) =>
    Array.from({ length: 20 }, (_, rank) => ({
      id: index * 100 + rank + 1,
      code: `${confederation.slice(0, 2)}${rank}`,
      confederation,
      reputation: 90 - rank - index,
    })),
  );

  it("fills FIFA places per confederation, hosts counted against their confederation", () => {
    const spec = tournament("fifa-u17-world-cup");
    const chosen = allocateEntrants(spec, teams, ["AF19"]);
    expect(chosen).toHaveLength(48);
    const count = (confederation: string) => chosen.filter((team) => team.confederation === confederation).length;
    expect(confederations.map(count)).toEqual([11, 9, 10, 8, 7, 3]);
    expect(chosen.some((team) => team.code === "AF19")).toBe(true);
    expect(chosen.filter((team) => team.confederation === "AFC").map((team) => team.code)).not.toContain("AF8");
  });

  it("gives unfilled places to the strongest remaining teams in small worlds", () => {
    const small = teams.filter((team) => team.confederation === "UEFA" || team.confederation === "OFC");
    const chosen = allocateEntrants(tournament("fifa-u20-world-cup"), small, []);
    expect(chosen).toHaveLength(24);
    // UEFA 5 + OFC 1 by right, the rest to the strongest of the play-off confederations.
    expect(chosen.filter((team) => team.confederation === "OFC").length).toBeGreaterThanOrEqual(1);
    expect(allocateEntrants(tournament("fifa-u20-world-cup"), small.slice(0, 10), [])).toHaveLength(10);
  });

  it("uses known hosts and a seeded, stable host otherwise", () => {
    const members = [{ code: "AL", reputation: 50 }, { code: "RS", reputation: 60 }, { code: "FR", reputation: 90 }];
    expect(editionHosts(tournament("uefa-u21-euro"), 2027, members)).toEqual(["AL", "RS"]);
    const first = editionHosts(tournament("uefa-u21-euro"), 2031, members);
    expect(first).toHaveLength(1);
    expect(editionHosts(tournament("uefa-u21-euro"), 2031, [...members].reverse())).toEqual(first);
  });

  it("advances group winners first, then the best runners-up", () => {
    const record = (id: number) => ({ points: id % 10, difference: 0, scored: 0 });
    // Four groups; winners 3, 9, 5, 1; runners-up 2, 8, 4, 0.
    const groups = [[3, 2, 30], [9, 8, 31], [5, 4, 32], [1, 0, 33]];
    expect(qualifyingAdvancers(groups, record, 6)).toEqual([9, 5, 3, 1, 8, 4]);
    expect(qualifyingAdvancers(groups, record, 2)).toEqual([9, 5]);
  });
});

const positions: Position[] = ["GK", "GK", "GK", "GK", "CB", "CB", "CB", "LB", "RB", "CB", "DM", "CM", "CM", "AM", "CM", "LW", "RW", "ST", "ST", "ST"];
const pool = (count: number, ability = (index: number) => 80 - index): SquadCandidate[] =>
  Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    position: positions[index % positions.length],
    ability: ability(index),
    potential: ability(index) + 5,
    form: 6.5,
  }));

describe("national squad selection", () => {
  it("names the squad size with its goalkeepers and every line covered", () => {
    const squad = selectNationalSquad(pool(60), { ageGroup: "U21", size: 23, goalkeepers: 3 });
    expect(squad).toHaveLength(23);
    const lines = (line: string) => squad.filter((id) => NATIONAL_LINE[pool(60)[id - 1].position] === line).length;
    expect(lines("GK")).toBe(3);
    expect(lines("DEF")).toBeGreaterThanOrEqual(6);
    expect(lines("MID")).toBeGreaterThanOrEqual(5);
    expect(lines("ATT")).toBeGreaterThanOrEqual(4);
  });

  it("weighs potential more for younger teams and skips excluded players", () => {
    const candidates: SquadCandidate[] = [
      { id: 1, position: "CM", ability: 60, potential: 60, form: 6.5 },
      { id: 2, position: "CM", ability: 57, potential: 85, form: 6.5 },
    ];
    expect(selectNationalSquad(candidates, { ageGroup: "U17", size: 1, goalkeepers: 0 })).toEqual([2]);
    expect(selectNationalSquad(candidates, { ageGroup: "Senior", size: 1, goalkeepers: 0 })).toEqual([1]);
    expect(selectNationalSquad(candidates, { ageGroup: "U17", size: 1, goalkeepers: 0, excluded: new Set([2]) })).toEqual([1]);
  });

  it("returns a short squad when a nation has too few eligible players", () => {
    expect(selectNationalSquad(pool(12), { ageGroup: "U17", size: 20, goalkeepers: 2 }).length).toBe(10);
  });
});

describe("club release", () => {
  const base = { mandatory: false, clubless: false, senior: true, role: "Key player", clubReputation: 85, prestige: 1 };

  it("always releases for FIFA-window matches and clubless players", () => {
    expect(releaseDecision({ ...base, mandatory: true, roll: 0.999 })).toBe(true);
    expect(releaseDecision({ ...base, clubless: true, roll: 0.999 })).toBe(true);
    expect(releaseDecision({ ...base, mandatory: true, policy: "mandatory only", roll: 0.999 })).toBe(true);
  });

  it("lets clubs keep key first-team players outside the windows, rarely youth-team players", () => {
    expect(releaseChance(base)).toBeLessThan(0.25);
    expect(releaseChance({ ...base, role: "Squad player", clubReputation: 60 })).toBeGreaterThan(0.9);
    expect(releaseChance({ ...base, senior: false })).toBeGreaterThan(0.95);
    expect(releaseDecision({ ...base, roll: 0.5 })).toBe(false);
    expect(releaseDecision({ ...base, roll: 0.05 })).toBe(true);
  });

  it("applies the user's release policy", () => {
    expect(releaseDecision({ ...base, roll: 0.99, policy: "always" })).toBe(true);
    expect(releaseDecision({ ...base, senior: false, roll: 0, policy: "mandatory only" })).toBe(false);
  });
});

describe("finals exposure", () => {
  it("rewards deep runs modestly and fades", () => {
    const champion = tournamentExposure("Champion", 1, true);
    expect(champion).toBeGreaterThan(tournamentExposure("Group stage", 1, false));
    expect(champion).toBeLessThanOrEqual(0.08);
    expect(tournamentExposure("Final", 0.5, false)).toBeCloseTo(0.025);
    expect(exposureValueFactor({ value: 0.06, date: "2027-06-27" }, "2027-06-27")).toBeCloseTo(1.06);
    expect(exposureValueFactor({ value: 0.06, date: "2027-06-27" }, "2028-12-31")).toBe(1);
    expect(exposureValueFactor(undefined, "2027-06-27")).toBe(1);
  });
});

it("types the catalog rows", () => {
  const specs: readonly YouthTournamentSpec[] = YOUTH_TOURNAMENTS;
  expect(new Set(specs.map((spec) => spec.name)).size).toBe(specs.length);
});
