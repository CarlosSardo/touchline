import { describe, expect, it } from "vitest";
import { CONTINENTAL } from "./world-catalog/continental.ts";
import {
  coefficientSeedRows,
  coefficientTotal,
  rankAssociations,
  resolveContinentalAccess,
  type AccessEntrant,
  type AccessNation,
} from "./competition-rules.ts";

const nation = (code: string, index: number, size = 20): AccessNation => {
  const table = Array.from({ length: size }, (_, position) => (index + 1) * 100 + position);
  return { code, table, champion: table[0], cupWinner: table[6], u19Champion: 90_000 + index, u20Champion: 95_000 + index };
};
const count = (entrants: AccessEntrant[], competition: string, stage?: string) =>
  entrants.filter((item) => item.competition === competition && (!stage || item.stage === stage)).length;
const expectOnePlacePerClub = (entrants: AccessEntrant[], competitions: string[]) => {
  const ids = entrants.filter((item) => competitions.includes(item.competition)).map((item) => item.clubId);
  expect(new Set(ids).size).toBe(ids.length);
};

describe("continental catalog", () => {
  it("has no OFC club competition and records no OFC coefficients", () => {
    expect(CONTINENTAL.competitions.some((item) => item.confederation === "OFC")).toBe(false);
    expect(CONTINENTAL.coefficientConfederations).not.toContain("OFC");
    expect(JSON.stringify(CONTINENTAL.access)).not.toContain('"RU"');
  });
});

describe("UEFA access list 2024–27", () => {
  const codes = Array.from({ length: 54 }, (_, index) => `N${String(index + 1).padStart(2, "0")}`);
  codes[39] = "LI";
  const nations = codes.map((code, index) => (code === "LI" ? { code, table: [], cupWinner: 4_000 } : nation(code, index)));
  nations.push(nation("RU", 60));
  const byCode = new Map(nations.map((item) => [item.code, item]));
  const entrants = resolveContinentalAccess(CONTINENTAL, {
    confederation: "UEFA",
    ranking: codes,
    nations,
    titleholders: {
      "uefa-champions-league": byCode.get("N10")!.table[2],
      "uefa-europa-league": byCode.get("N20")!.table[1],
      "uefa-conference-league": byCode.get("N30")!.table[1],
    },
    performanceSpots: ["N01", "N02"],
  });

  it("fills the 36-team league phases from the list, titleholders and performance spots", () => {
    expect(count(entrants, "uefa-champions-league", "main")).toBe(29);
    expect(count(entrants, "uefa-champions-league", "playoff")).toBe(4);
    expect(count(entrants, "uefa-champions-league", "q3")).toBe(8);
    expect(count(entrants, "uefa-champions-league", "q2")).toBe(10);
    expect(count(entrants, "uefa-champions-league", "q1")).toBe(33);
    expect(count(entrants, "uefa-europa-league", "main")).toBe(14);
    expect(count(entrants, "uefa-conference-league", "main")).toBe(0);
    expect(count(entrants, "uefa-super-cup")).toBe(2);
    expect(entrants.filter((item) => item.basis === "European Performance Spot").map((item) => item.clubId))
      .toEqual([byCode.get("N01")!.table[4], byCode.get("N02")!.table[4]]);
  });

  it("passes places down the table and keeps every club in one competition", () => {
    const english = entrants.filter((item) => item.nation === "N01" && item.competition !== "uefa-youth-league");
    expect(english.map((item) => `${item.competition}:${item.domesticPosition}`).sort()).toEqual([
      "uefa-champions-league:1", "uefa-champions-league:2", "uefa-champions-league:3", "uefa-champions-league:4",
      "uefa-champions-league:5", "uefa-conference-league:8", "uefa-europa-league:6", "uefa-europa-league:7",
    ]);
    expectOnePlacePerClub(entrants, ["uefa-champions-league", "uefa-europa-league", "uefa-conference-league"]);
  });

  it("sends the Liechtenstein Cup winner to Conference League qualifying and excludes Russia", () => {
    expect(entrants.filter((item) => item.nation === "LI").map((item) => `${item.competition}:${item.stage}`))
      .toEqual(["uefa-conference-league:q1"]);
    expect(entrants.some((item) => item.nation === "RU" || item.clubId >= 6_100 && item.clubId < 6_200)).toBe(false);
  });

  it("rebalances a titleholder that already qualified through its league", () => {
    const rebalanced = resolveContinentalAccess(CONTINENTAL, {
      confederation: "UEFA",
      ranking: codes,
      nations,
      titleholders: { "uefa-champions-league": byCode.get("N01")!.table[0] },
    });
    expect(count(rebalanced, "uefa-champions-league", "main")).toBe(26);
    const promoted = rebalanced.find((item) => item.basis.includes("rebalancing"))!;
    expect([promoted.nation, promoted.domesticPosition, promoted.stage]).toEqual(["N11", 1, "main"]);
  });

  it("builds the Youth League from the UCL league phase and 32 domestic champions", () => {
    expect(count(entrants, "uefa-youth-league", "main")).toBe(29);
    expect(count(entrants, "uefa-youth-league", "q1")).toBe(32);
  });
});

describe("other confederations", () => {
  it("resolves CONMEBOL fixed entries", () => {
    const codes = ["BR", "AR", "EC", "CO", "UY", "PY", "CL", "PE", "BO", "VE"];
    const entrants = resolveContinentalAccess(CONTINENTAL, {
      confederation: "CONMEBOL", ranking: codes, nations: codes.map((code, index) => nation(code, index)),
    });
    expect(count(entrants, "copa-libertadores", "main")).toBe(26);
    expect(count(entrants, "copa-libertadores")).toBe(26 + 13 + 6);
    expect(count(entrants, "copa-sudamericana", "main")).toBe(12);
    expect(count(entrants, "copa-sudamericana", "q1")).toBe(32);
    expect(count(entrants, "libertadores-sub-20")).toBe(10);
    expectOnePlacePerClub(entrants, ["copa-libertadores", "copa-sudamericana"]);
  });

  it("ranks CAF bands over the modeled associations", () => {
    const codes = Array.from({ length: 19 }, (_, index) => `C${index}`);
    const entrants = resolveContinentalAccess(CONTINENTAL, { confederation: "CAF", ranking: codes, nations: codes.map((code, index) => nation(code, index)) });
    expect(count(entrants, "caf-champions-league")).toBe(31);
    expect(count(entrants, "caf-champions-league", "q2")).toBe(8);
    expect(count(entrants, "caf-confederation-cup")).toBe(31);
    expectOnePlacePerClub(entrants, ["caf-champions-league", "caf-confederation-cup"]);
  });

  it("ranks AFC associations within the West and East zones", () => {
    const codes = ["SA", "JP", "KR", "QA", "AE", "IR", "UZ", "TH", "CN", "AU", "IQ", "VN", "IN", "ID", "PH"];
    const entrants = resolveContinentalAccess(CONTINENTAL, { confederation: "AFC", ranking: codes, nations: codes.map((code, index) => nation(code, index)) });
    expect(count(entrants, "afc-champions-league-elite", "main")).toBe(22);
    expect(count(entrants, "afc-champions-league-elite", "playoff")).toBe(4);
    expect(count(entrants, "afc-champions-league-two")).toBe(30);
    expect(count(entrants, "afc-challenge-league")).toBe(8);
    expectOnePlacePerClub(entrants, ["afc-champions-league-elite", "afc-champions-league-two", "afc-challenge-league"]);
  });

  it("fills the CONCACAF Champions Cup from leagues and the regional cups", () => {
    const codes = ["MX", "US", "CR", "CA", "HN", "PA", "GT", "SV", "JM", "DO", "HT", "PR"];
    const nations = codes.map((code, index) => nation(code, index));
    const feeder = (offset: number) => Array.from({ length: 6 }, (_, index) => 50_000 + offset + index);
    const entrants = resolveContinentalAccess(CONTINENTAL, {
      confederation: "CONCACAF", ranking: codes, nations,
      feederResults: {
        "leagues-cup": feeder(0), "concacaf-central-american-cup": feeder(10), "concacaf-caribbean-cup": feeder(20),
      },
    });
    expect(count(entrants, "concacaf-champions-cup", "main")).toBe(5);
    expect(count(entrants, "concacaf-champions-cup", "q1")).toBe(22);
    expect(count(entrants, "leagues-cup")).toBe(36);
    expect(count(entrants, "concacaf-central-american-cup")).toBe(20);
    expect(count(entrants, "campeones-cup")).toBe(2);
    expectOnePlacePerClub(entrants, ["concacaf-champions-cup"]);
  });
});

describe("association coefficients", () => {
  it("sums five seasons and ranks by total, then last season", () => {
    expect(coefficientTotal(new Map([[2021, 10], [2025, 5], [2026, 99]]), 2026)).toBe(15);
    expect(rankAssociations([
      { code: "B", points: 50, previous: 9 },
      { code: "A", points: 50, previous: 10 },
      { code: "C", points: 60, previous: 1 },
    ])).toEqual(["C", "A", "B"]);
  });

  it("writes seeds once and never for suspended or OFC nations", () => {
    const countries = [
      { id: 1, code: "EN", confederation: "UEFA" },
      { id: 2, code: "RU", confederation: "UEFA" },
      { id: 3, code: "NZ", confederation: "OFC" },
    ];
    const seeds = (code: string) => (code === "NZ" ? [1, 1, 1, 1, 1] : [20, 21, 22, 23, 24]) as [number, number, number, number, number];
    const suspended = (code: string) => code === "RU";
    const first = coefficientSeedRows(countries, new Set(), 2026, seeds, suspended);
    expect(first.map((row) => `${row.entityId}:${row.season}`)).toEqual(["1:2021", "1:2022", "1:2023", "1:2024", "1:2025"]);
    const existing = new Set(first.map((row) => `${row.entityId}:${row.season}`));
    expect(coefficientSeedRows(countries, existing, 2026, seeds, suspended)).toEqual([]);
  });
});
