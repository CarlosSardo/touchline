import { describe, expect, it } from "vitest";
import seedrandom from "seedrandom";
import { CONTINENTAL } from "./world-catalog/continental.ts";
import { internationalBreak } from "./rules.ts";
import {
  coefficientSeedRows,
  coefficientTotal,
  cupEntryPlan,
  cupRoundDates,
  frozenAssociationPoints,
  isKnockoutStage,
  KNOCKOUT_PLAYOFF_STAGE,
  knockoutRules,
  nextSeededRound,
  openDraw,
  rankAssociations,
  resolveContinentalAccess,
  seededPairs,
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
    expect(count(entrants, "uefa-champions-league", "q3")).toBe(5);
    expect(count(entrants, "uefa-champions-league", "q2")).toBe(14);
    expect(count(entrants, "uefa-champions-league", "q1")).toBe(31);
    expect(count(entrants, "uefa-europa-league", "main")).toBe(13);
    expect(count(entrants, "uefa-europa-league", "q1")).toBe(18);
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
    // With club coefficients the best champions-path club moves up (2026/27: Shakhtar from CP Q2), never a league-path club.
    const strong = nations.map((item) => item.code === "N20" ? { ...item, coefficients: { [item.table[0]]: 95 } }
      : item.code === "N12" ? { ...item, coefficients: { [item.table[0]]: 90, [item.table[1]]: 99 } } : item);
    const byCoefficient = resolveContinentalAccess(CONTINENTAL, {
      confederation: "UEFA", ranking: codes, nations: strong,
      titleholders: { "uefa-champions-league": byCode.get("N01")!.table[0] },
    }).find((item) => item.basis.includes("titleholder rebalancing"))!;
    expect([byCoefficient.nation, byCoefficient.domesticPosition]).toEqual(["N20", 1]);
  });

  it("builds the Youth League from the UCL league phase and every U19 champion", () => {
    expect(count(entrants, "uefa-youth-league", "main")).toBe(29);
    expect(count(entrants, "uefa-youth-league", "q2")).toBe(30);
    expect(count(entrants, "uefa-youth-league", "q1")).toBe(23);
  });

  it("enters the Youth League Domestic Champions Path by its own ranking", () => {
    const youth = [...codes];
    [youth[29], youth[30]] = [youth[30], youth[29]];
    const plain = resolveContinentalAccess(CONTINENTAL, { confederation: "UEFA", ranking: codes, nations });
    const shifted = resolveContinentalAccess(CONTINENTAL, {
      confederation: "UEFA", ranking: codes, rankings: { "uefa-youth-league": youth }, nations,
    });
    const stages = (list: AccessEntrant[], code: string, competition: string) =>
      list.filter((item) => item.nation === code && item.competition === competition).map((item) => item.stage);
    expect(stages(shifted, "N31", "uefa-youth-league")).toEqual(["q2"]);
    expect(stages(shifted, "N30", "uefa-youth-league")).toEqual(["q1"]);
    expect(shifted.filter((item) => item.competition !== "uefa-youth-league"))
      .toEqual(plain.filter((item) => item.competition !== "uefa-youth-league"));
  });
});

describe("real association positions (no rank compression)", () => {
  // 2025 ranking: IL 18, RU 26 (suspended), AZ 30, FO 40 and MK 51 have no clubs in the game; LI 44 has only a cup.
  const absent = new Map([[18, "IL"], [26, "RU"], [30, "AZ"], [40, "FO"], [51, "MK"], [44, "LI"]]);
  const ranking = Array.from({ length: 55 }, (_, index) => absent.get(index + 1) ?? `N${String(index + 1).padStart(2, "0")}`);
  const nations = ranking.filter((code) => code.startsWith("N")).map((code) => nation(code, Number(code.slice(1))));
  nations.push({ code: "LI", table: [], cupWinner: 4_000 });
  const entrants = resolveContinentalAccess(CONTINENTAL, { confederation: "UEFA", ranking, nations });
  const ofNation = (code: string) => entrants.filter((item) => item.nation === code && item.competition !== "uefa-youth-league");

  it("keeps every association at its real rank", () => {
    expect(ofNation("N19").map((item) => `${item.competition}:${item.stage}:${item.associationRank}`)).toEqual([
      "uefa-champions-league:q2:19", "uefa-europa-league:q1:19", "uefa-conference-league:q2:19", "uefa-conference-league:q2:19",
    ]);
    // Rank 34: cup winner in UECL Q2 by the list; both league clubs move up into places vacated by IL, RU and AZ.
    expect(ofNation("N34").map((item) => `${item.competition}:${item.stage}`)).toEqual([
      "uefa-champions-league:q1", "uefa-conference-league:q2", "uefa-conference-league:q2", "uefa-conference-league:q2",
    ]);
    expect(entrants.some((item) => ["IL", "RU", "AZ", "FO", "MK"].includes(item.nation))).toBe(false);
  });

  it("moves vacated places to the best entrants of the previous round", () => {
    const championsQ2 = entrants.filter((item) => item.competition === "uefa-champions-league" && item.stage === "q2" && item.path === "champions");
    expect(championsQ2).toHaveLength(8);
    expect(championsQ2.filter((item) => item.basis.includes("vacancy")).map((item) => item.associationRank)).toEqual([23]);
    expect(count(entrants, "uefa-champions-league", "q1")).toBe(27);
    expect(count(entrants, "uefa-europa-league", "q1")).toBe(15);
    // UECL Q2: IL and RU (two each) and AZ (one) vacate five places, filled from Q1.
    expect(entrants.filter((item) => item.competition === "uefa-conference-league" && item.basis.includes("vacancy"))).toHaveLength(5);
  });
});

describe("other confederations", () => {
  it("resolves CONMEBOL fixed entries", () => {
    const codes = ["BR", "AR", "EC", "CO", "UY", "PY", "CL", "PE", "BO", "VE"];
    const entrants = resolveContinentalAccess(CONTINENTAL, {
      confederation: "CONMEBOL", ranking: codes, nations: codes.map((code, index) => nation(code, index)),
    });
    expect(count(entrants, "copa-libertadores", "main")).toBe(26);
    expect(count(entrants, "copa-libertadores", "q2")).toBe(13);
    expect(count(entrants, "copa-libertadores", "q1")).toBe(6);
    expect(entrants.filter((item) => item.competition === "copa-libertadores" && item.stage === "main" && item.nation === "AR")).toHaveLength(5);
    expect(entrants.filter((item) => item.competition === "copa-libertadores" && item.stage === "main" && item.nation === "CL")).toHaveLength(2);
    expect(count(entrants, "copa-sudamericana", "main")).toBe(12);
    expect(count(entrants, "copa-sudamericana", "q1")).toBe(32);
    expect(count(entrants, "libertadores-sub-20")).toBe(10);
    expectOnePlacePerClub(entrants, ["copa-libertadores", "copa-sudamericana"]);
  });

  it("ranks CAF bands over the modeled associations", () => {
    const codes = Array.from({ length: 19 }, (_, index) => `C${index}`);
    const entrants = resolveContinentalAccess(CONTINENTAL, { confederation: "CAF", ranking: codes, nations: codes.map((code, index) => nation(code, index)) });
    expect(count(entrants, "caf-champions-league")).toBe(31);
    expect(count(entrants, "caf-champions-league", "q1")).toBe(31);
    expect(count(entrants, "caf-confederation-cup")).toBe(31);
    expectOnePlacePerClub(entrants, ["caf-champions-league", "caf-confederation-cup"]);
    // 2026/27: Champions League second-round losers are eliminated (no Confederation Cup play-off round).
    expect(CONTINENTAL.competitions.find((item) => item.id === "caf-champions-league")?.drops).toBeUndefined();
  });

  it("ranks AFC associations within the West and East zones", () => {
    const codes = ["SA", "JP", "KR", "AE", "QA", "IR", "TH", "CN", "UZ", "AU", "IQ", "VN", "IN", "ID", "PH"];
    const entrants = resolveContinentalAccess(CONTINENTAL, { confederation: "AFC", ranking: codes, nations: codes.map((code, index) => nation(code, index)) });
    // 2026/27: 14 league-stage places and 4 preliminary-round clubs per zone (16 per zone after 2 ties).
    expect(count(entrants, "afc-champions-league-elite", "main")).toBe(28);
    expect(count(entrants, "afc-champions-league-elite", "playoff")).toBe(8);
    expect(entrants.filter((item) => item.competition === "afc-champions-league-elite" && item.nation === "SA")).toHaveLength(5);
    expect(count(entrants, "afc-champions-league-two", "main")).toBe(14);
    expect(count(entrants, "afc-champions-league-two", "playoff")).toBe(1);
    expect(count(entrants, "afc-challenge-league")).toBe(0);
    expectOnePlacePerClub(entrants, ["afc-champions-league-elite", "afc-champions-league-two", "afc-challenge-league"]);
  });

  it("builds ACL Two 2026/27 from real zone positions (JO and MY have no clubs in the game)", () => {
    const codes = ["SA", "JP", "KR", "AE", "QA", "IR", "TH", "CN", "UZ", "AU", "MY", "IQ", "JO", "VN", "IN", "ID", "PH"];
    const nations = codes.filter((code) => code !== "JO" && code !== "MY").map((code, index) => nation(code, index));
    const entrants = resolveContinentalAccess(CONTINENTAL, { confederation: "AFC", ranking: codes, nations });
    const acl2 = entrants.filter((item) => item.competition === "afc-champions-league-two");
    // Ranks 1-7 one group-stage club each; the JO and MY places go to the best preliminary-stage entrant of the zone.
    expect(acl2.filter((item) => item.stage === "main")).toHaveLength(14);
    expect(acl2.filter((item) => item.basis.includes("vacancy")).map((item) => item.nation)).toEqual(["IN", "ID"]);
    expect(acl2.filter((item) => item.stage === "playoff").map((item) => `${item.nation}:${item.domesticPosition}`))
      .toEqual(["IN:7", "PH:1"]);
    expect(count(entrants, "afc-challenge-league")).toBe(0);
    const spec = CONTINENTAL.competitions.find((item) => item.id === "afc-champions-league-two")!;
    expect([spec.qualifyingLegs, spec.drops]).toEqual([1, [{ from: "playoff", to: "afc-challenge-league", stage: "main" }]]);
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
    const byNation = (code: string) => entrants.filter((item) => item.competition === "concacaf-champions-cup" && item.nation === code && item.basis !== "Leagues Cup qualifier");
    expect([byNation("US").length, byNation("CA").length]).toEqual([6, 3]);
    expect(count(entrants, "leagues-cup")).toBe(36);
    expect(count(entrants, "concacaf-central-american-cup")).toBe(20);
    expect(count(entrants, "campeones-cup")).toBe(2);
    expectOnePlacePerClub(entrants, ["concacaf-champions-cup"]);
  });
});

describe("association coefficients", () => {
  it("plays Youth League qualifying over two legs and the ACL Elite preliminary round as one match", () => {
    expect(knockoutRules("UEFA Youth League", "Qualifying").legs).toBe(2);
    expect(knockoutRules("UEFA Youth League", "Round of 32").legs).toBe(1);
    expect(knockoutRules("AFC Champions League Elite", "Qualifying").legs).toBe(1);
    expect(knockoutRules("UEFA Champions League Qualifying", "Qualifying").legs).toBe(2);
  });

  it("ranks with the five seasons before last (one-season lag), then the latest ranked season", () => {
    expect(coefficientTotal(new Map([[2020, 10], [2024, 5], [2025, 99]]), 2026)).toBe(15);
    expect(coefficientTotal(new Map([[2020, 10], [2024, 5], [2025, 99]]), 2026, true)).toBe(35);
    expect(rankAssociations([
      { code: "B", points: 50, previous: 9 },
      { code: "A", points: 50, previous: 10 },
      { code: "C", points: 60, previous: 1 },
    ])).toEqual(["C", "A", "B"]);
  });

  it("writes seeds once, including 2025/26 and suspended nations, never OFC", () => {
    const countries = [
      { id: 1, code: "EN", confederation: "UEFA" },
      { id: 2, code: "RU", confederation: "UEFA" },
      { id: 3, code: "NZ", confederation: "OFC" },
    ];
    const seeds = (code: string) => code === "EN"
      ? { association: [20, 21, 22, 23, 24] as [number, number, number, number, number], season2025: 25 }
      : { association: [4.333, 5.3, 4.333, 4.333, 4.333] as [number, number, number, number, number] };
    const first = coefficientSeedRows(countries, new Set(), 2026, seeds);
    expect(first.map((row) => `${row.entityId}:${row.season}`)).toEqual([
      "1:2020", "1:2021", "1:2022", "1:2023", "1:2024", "1:2025", "2:2020", "2:2021", "2:2022", "2:2023", "2:2024",
    ]);
    const existing = new Set(first.map((row) => `${row.entityId}:${row.season}`));
    expect(coefficientSeedRows(countries, existing, 2026, seeds)).toEqual([]);
    expect(frozenAssociationPoints(seeds("RU"), true)).toBe(4.333);
    expect(frozenAssociationPoints(seeds("EN"), false)).toBe(22.5);
  });

  it("seeds the real 2025/26 season for the ranking-only UEFA associations", () => {
    const uefa = ["IL", "AZ", "FO", "MK"].map((code) => CONTINENTAL.rankingOnly?.[code as "IL"]);
    expect(uefa.every((seed) => seed?.season2025 !== undefined)).toBe(true);
  });
});

describe("knockout brackets and domestic cup draws", () => {
  it("keeps the top seeds apart after byes: seed 1 meets the weakest first-round winner, 8 meets 9", () => {
    const seeds = Array.from({ length: 20 }, (_, index) => index + 1);
    const first = seededPairs(seeds);
    expect(first.byes).toEqual(seeds.slice(0, 12));
    expect(first.pairs).toEqual([[13, 20], [14, 19], [15, 18], [16, 17]]);
    const second = seededPairs(nextSeededRound(first.pairs.map(([better]) => better), first.byes));
    expect(second.byes).toEqual([]);
    expect(second.pairs).toEqual([[1, 16], [2, 15], [3, 14], [4, 13], [5, 12], [6, 11], [7, 10], [8, 9]]);
    const third = seededPairs(nextSeededRound(second.pairs.map(([better]) => better)));
    expect(third.pairs).toEqual([[1, 8], [2, 7], [3, 6], [4, 5]]);
  });

  it("gives every round an even field and lets whole top tiers join later (FA Cup: 8 rounds, tiers 1–2 in round 3)", () => {
    const random = seedrandom("cup-plans");
    for (let count = 2; count <= 160; count++) {
      const perTier = 4 + Math.floor(random() * 20);
      const entrants = Array.from({ length: count }, (_, index) => ({ id: index + 1, tier: 1 + Math.floor(index / perTier) }));
      for (const seeded of [false, true]) {
        const plan = cupEntryPlan(entrants, seeded);
        expect(Object.values(plan.entry).filter((entry) => entry === 1).length, `${count} clubs round one`).toBeGreaterThanOrEqual(2);
        let field = 0;
        for (let round = 1; round <= plan.rounds; round++) {
          field = field / 2 + Object.values(plan.entry).filter((entry) => entry === round).length;
          expect(field % 2, `${count} clubs, seeded ${seeded}, round ${round}`).toBe(0);
        }
        expect(field, `${count} clubs final`).toBe(2);
        const byTier = (tier: number) => entrants.filter((club) => club.tier === tier).map((club) => plan.entry[club.id]);
        const lowest = Math.max(...entrants.map((club) => club.tier));
        if (lowest > 1) expect(Math.min(...byTier(1))).toBeGreaterThanOrEqual(Math.max(...byTier(lowest)));
      }
    }
    const tiers = [20, 24, 24, 24, 24, 8];
    const lone = cupEntryPlan([...Array.from({ length: 40 }, (_, index) => ({ id: index, tier: 1 })), { id: 99, tier: 2 }], true);
    expect(Object.values(lone.entry).filter((entry) => entry === 1).length % 2).toBe(0);
    const facup = tiers.flatMap((size, tier) => Array.from({ length: size }, (_, index) => ({ id: tier * 100 + index, tier: tier + 1 })));
    const plan = cupEntryPlan(facup, true);
    expect(plan.rounds).toBe(8);
    const entries = (tier: number) => new Set(facup.filter((club) => club.tier === tier).map((club) => plan.entry[club.id]));
    expect([...entries(1)]).toEqual([3]);
    expect([...entries(2)]).toEqual([3]);
    expect([...entries(3)]).toEqual([1]);
    expect(Object.values(plan.entry).filter((entry) => entry === 1)).toHaveLength(80);
  });

  it("draws openly with the first club drawn at home, unless the other is far enough down the pyramid", () => {
    const clubs = Array.from({ length: 32 }, (_, index) => index + 1);
    const pairs = openDraw(clubs, seedrandom("draw"));
    expect(pairs).toHaveLength(16);
    expect(new Set(pairs.flat()).size).toBe(32);
    expect(pairs.some(([home, away]) => home > away)).toBe(true);
    expect(pairs.some(([home, away]) => home < away)).toBe(true);
    expect(openDraw(clubs, seedrandom("draw"))).toEqual(pairs);
    const tiers = Object.fromEntries(clubs.map((id) => [id, id <= 16 ? 1 : 3]));
    for (const [home, away] of openDraw(clubs, seedrandom("home rule"), tiers, 2))
      expect(tiers[home]).toBeGreaterThanOrEqual(tiers[away]);
  });

  it("spreads cup rounds to a May final (national) and a late-February final (league cup), midweek rounds", () => {
    const national = cupRoundDates(2026, "10-21", "05-22", 8);
    expect(national[0]).toBe("2026-10-21");
    expect(national.at(-1)).toBe("2027-05-22");
    expect(national.every((date, index) => !index || date > national[index - 1])).toBe(true);
    expect(national.slice(1, -1).every((date) => new Date(`${date}T12:00:00Z`).getUTCDay() === 3)).toBe(true);
    expect(national.every((date) => !internationalBreak(date))).toBe(true);
    const league = cupRoundDates(2026, "08-26", "02-28", 7);
    expect(league.at(-1)! >= "2027-02-27" && league.at(-1)! <= "2027-03-06").toBe(true);
    expect(cupRoundDates(2026, "07-25", undefined, 3)).toEqual(["2026-07-25", "2026-08-08", "2026-08-22"]);
  });

  it("names the UEFA knockout play-offs and sends CONMEBOL two-legged ties straight to penalties", () => {
    expect(isKnockoutStage(KNOCKOUT_PLAYOFF_STAGE)).toBe(true);
    expect(isKnockoutStage("Round of 80")).toBe(true);
    expect(isKnockoutStage("League phase")).toBe(false);
    for (const name of ["CONMEBOL Libertadores", "CONMEBOL Sudamericana"]) {
      expect(knockoutRules(name, "Round of 16"), name).toMatchObject({ legs: 2, extraTime: false });
      expect(knockoutRules(`${name} Qualifying`, "Qualifying").extraTime, name).toBe(false);
      expect(knockoutRules(name, "Final"), name).toMatchObject({ legs: 1, extraTime: true });
    }
    expect(knockoutRules("UEFA Champions League", "Round of 16").extraTime).toBe(true);
  });
});
