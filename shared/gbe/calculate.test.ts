import { describe, expect, it } from "vitest";
import {
  calculateGbe,
  FA_2026_27,
  gbeEscPlaces,
  gbeLeagueBand,
  gbePercent,
  gbeContinentalBand,
  gbeRulesetFor,
  gbeSponsorLeague,
  gbeStage,
  gbeTable1,
  gbeTable2,
  gbeTable3,
  type GbeEvidence,
} from "./index.ts";

const ruleset = FA_2026_27;

/** A 27-year-old Brazilian with no data at all on 1 October 2026; tests add what they need. */
function evidence(overrides: Partial<GbeEvidence> = {}): GbeEvidence {
  return {
    playerId: 1,
    asOf: "2026-10-01",
    birthDate: "1999-03-01",
    passportGroups: ["BR"],
    nation: "Brazil",
    international: null,
    domestic: [],
    debut: null,
    continental: [],
    cupPercent: { reference: 0, lastSeason: 0 },
    lastSeason: { season: 2025, label: "2025/26" },
    lastClub: null,
    currentRuns: [],
    currentClub: null,
    esc: { seniorCompetitiveCaps: 0, youthInternationals: 0, continentalMatches: 0, continentalYouthMatches: 0, domesticSeniorMatches: 0, domesticYouthMatches: 0 },
    coverageFrom: "2024-07",
    ...overrides,
  };
}

const spell = (overrides: Partial<GbeEvidence["domestic"][number]> = {}) => ({
  clubId: 7,
  club: "Porto Alegre",
  competition: "Serie A",
  countryCode: "BR",
  tier: 1,
  available: 3000,
  minutes: 0,
  appearances: 0,
  listed: 0,
  unavailable: 0,
  estimated: false,
  simulated: true,
  ...overrides,
});

const lastClub = (overrides: Partial<NonNullable<GbeEvidence["lastClub"]>> = {}): NonNullable<GbeEvidence["lastClub"]> => ({
  club: "Porto Alegre",
  countryCode: "BR",
  tier: 1,
  archived: true,
  position: 9,
  clubs: 20,
  champion: false,
  promoted: false,
  relegated: false,
  qualified: [],
  continental: [],
  listedLeague: true,
  listedAny: true,
  estimated: false,
  ...overrides,
});

const row = (result: ReturnType<typeof calculateGbe>, criterion: string) => result.breakdown.find((entry) => entry.criterion === criterion)!;

describe("FA 2026/27 tables (every cell of the published criteria)", () => {
  it("Table 1: international appearances by aggregated ranking", () => {
    const expected: [number, (number | "auto")[]][] = [
      [95, ["auto", "auto", "auto", "auto", 2]],
      [85, ["auto", "auto", "auto", "auto", 1]],
      [75, ["auto", "auto", "auto", "auto", 0]],
      [65, ["auto", "auto", "auto", 10, 0]],
      [55, ["auto", "auto", 10, 8, 0]],
      [45, ["auto", "auto", 9, 7, 0]],
      [35, ["auto", 10, 8, 6, 0]],
      [25, [10, 9, 7, 0, 0]],
      [15, [9, 8, 0, 0, 0]],
      [5, [8, 7, 0, 0, 0]],
      [0, [0, 0, 0, 0, 0]],
    ];
    const ranks = [1, 15, 25, 40, 80];
    for (const [percent, cells] of expected)
      expect(ranks.map((rank) => gbeTable1(ruleset, percent, rank))).toEqual(cells);
    // Column edges: 10 | 11, 20 | 21, 30 | 31, 50 | 51.
    expect([10, 11, 20, 21, 30, 31, 50, 51].map((rank) => gbeTable1(ruleset, 30, rank))).toEqual(["auto", 10, 10, 8, 8, 6, 6, 0]);
    // Auto-pass percentages: 30 / 40 / 60 / 70.
    expect([gbeTable1(ruleset, 29, 10), gbeTable1(ruleset, 30, 10)]).toEqual([10, "auto"]);
    expect([gbeTable1(ruleset, 39, 20), gbeTable1(ruleset, 40, 20)]).toEqual([10, "auto"]);
    expect([gbeTable1(ruleset, 59, 30), gbeTable1(ruleset, 60, 30)]).toEqual([10, "auto"]);
    expect([gbeTable1(ruleset, 69, 50), gbeTable1(ruleset, 70, 50)]).toEqual([10, "auto"]);
  });

  it("Table 2: domestic league minutes by band, youth debut row", () => {
    const expected: [number, number[]][] = [
      [90, [12, 10, 8, 6, 4, 2]],
      [80, [11, 9, 7, 5, 3, 1]],
      [70, [10, 8, 6, 4, 2, 0]],
      [60, [9, 7, 5, 3, 1, 0]],
      [50, [8, 6, 4, 2, 0, 0]],
      [40, [7, 5, 3, 1, 0, 0]],
      [30, [6, 4, 2, 0, 0, 0]],
      [29, [0, 0, 0, 0, 0, 0]],
      [1, [0, 0, 0, 0, 0, 0]],
    ];
    for (const [percent, cells] of expected) expect([1, 2, 3, 4, 5, 6].map((band) => gbeTable2(ruleset, percent, band))).toEqual(cells);
    expect(ruleset.youthDebut).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it("Table 3: continental minutes by competition band", () => {
    const expected: [number, number[]][] = [
      [90, [10, 5, 2]],
      [80, [9, 4, 1]],
      [70, [8, 3, 0]],
      [60, [7, 2, 0]],
      [50, [6, 1, 0]],
      [40, [5, 0, 0]],
      [30, [4, 0, 0]],
      [29, [0, 0, 0]],
    ];
    for (const [percent, cells] of expected) expect([1, 2, 3].map((band) => gbeTable3(ruleset, percent, band))).toEqual(cells);
  });

  it("Tables 4-6 as published", () => {
    expect(ruleset.table4).toEqual({
      title: [6, 5, 4, 3, 2, 1],
      band1_group: [5, 4, 3, 2, 1, 0],
      band1_qualifiers: [4, 3, 2, 1, 0, 0],
      band2_group: [3, 2, 1, 0, 0, 0],
      band2_qualifiers: [2, 1, 0, 0, 0, 0],
      mid_table: [1, 0, 0, 0, 0, 0],
      relegation: [0, 0, 0, 0, 0, 0],
      promotion: [null, 1, 1, 1, 1, 1],
    });
    expect(ruleset.table5).toEqual({
      final: [10, 7, 2],
      semi_final: [9, 6, 1],
      quarter_final: [8, 5, 0],
      round_of_16: [7, 4, 0],
      round_of_32: [6, 3, 0],
      group: [5, 2, 0],
      other: [0, 0, 0],
    });
    expect(ruleset.table6).toEqual([12, 10, 8, 6, 4, 2]);
  });

  it("bands from the glossary, ¶33 rounding and the sponsor restriction", () => {
    expect(["EN:1", "DE:1", "BR:1", "EN:2", "SCO:1", "US:1", "ES:2", "JP:1", "EN:3", "IT:2", "EN:4", "ES:3", "NG:1"].map((key) => {
      const [code, tier] = key.split(":");
      return gbeLeagueBand(ruleset, code, Number(tier));
    })).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6]);
    expect(["uefa-champions-league", "copa-libertadores", "uefa-europa-league", "uefa-conference-league", "copa-sudamericana", "afc-champions-league-elite"].map((id) => gbeContinentalBand(ruleset, id))).toEqual([1, 1, 2, 2, 2, 3]);
    expect([gbePercent(29.5, 100), gbePercent(29.49, 100), gbePercent(1, 3), gbePercent(5, 0)]).toEqual([30, 29, 33, 0]);
    expect([gbeSponsorLeague(ruleset, "EN", 1), gbeSponsorLeague(ruleset, "EN", 4), gbeSponsorLeague(ruleset, "EN", 5), gbeSponsorLeague(ruleset, "SCO", 1)]).toEqual([true, true, false, false]);
    expect([gbeEscPlaces(ruleset, "EN", 1, 36), gbeEscPlaces(ruleset, "EN", 2, 21), gbeEscPlaces(ruleset, "EN", 3, 31), gbeEscPlaces(ruleset, "EN", 4, 29), gbeEscPlaces(ruleset, "EN", 5, 50)]).toEqual([4, 1, 1, 0, 0]);
    expect(["Final", "Semi-final", "Knockout round play-offs", "League phase", "Qualifying", "Round of 64"].map((stage) => gbeStage(stage))).toEqual(["final", "semi_final", "round_of_32", "group", "other", "other"]);
    // ¶43: early rounds of a knockout-only competition count as the group stage.
    expect(gbeStage("Round of 64", true)).toBe("group");
  });

  it("applies the latest criteria after their season, moving the Youth Player and ESC cutoffs", () => {
    expect(gbeRulesetFor("2026-10-01")).toMatchObject({ assumed: false, ruleset: { id: "fa-2026-27", youthBornOnOrAfter: "2005-01-01" } });
    expect(gbeRulesetFor("2027-08-01")).toMatchObject({ assumed: true, ruleset: { id: "fa-2026-27", youthBornOnOrAfter: "2006-01-01", escBornOnOrAfter: "2004-01-01" } });
    expect(gbeRulesetFor("2026-10-01", "ES")).toBeUndefined();
  });
});

describe("calculateGbe", () => {
  it("separates missing data from a legitimate zero", () => {
    const missing = calculateGbe(evidence({ coverageFrom: null }), ruleset);
    expect(missing.outcome).toBe("no_data");
    expect(missing.dataQuality).toBe("none");
    expect(missing.breakdown.every((entry) => entry.status === "no_data")).toBe(true);
    const unused = calculateGbe(
      evidence({
        international: { rank: 5, competitive: 16, friendlies: 2, competitiveApps: 0, friendlyApps: 0, unavailable: 0, estimated: false, simulated: true },
        domestic: [spell({ countryCode: "NG", tier: 1, available: 3060 })],
        lastClub: lastClub({ countryCode: "NG", listedLeague: false, listedAny: false }),
        currentClub: { club: "Lagos City", countryCode: "NG", tier: 1, listed: false, estimated: false, fallback: false },
      }),
      ruleset,
    );
    expect(unused.points).toBe(0);
    expect(unused.outcome).toBe("fail");
    expect(unused.dataQuality).toBe("complete");
    expect(unused.breakdown.every((entry) => entry.status === "zero")).toBe(true);
    expect(row(unused, "league_standard").detail).toContain("Not named in a Lagos City matchday squad");
  });

  it("scores a Band 1 regular and international (estimate provenance kept)", () => {
    const result = calculateGbe(
      evidence({
        international: { rank: 4, competitive: 16, friendlies: 4, competitiveApps: 4, friendlyApps: 3, unavailable: 0, estimated: true, simulated: false },
        domestic: [spell({ club: "Lyon", countryCode: "FR", tier: 1, available: 2790, minutes: 2597, appearances: 30, listed: 31, unavailable: 270, estimated: true, simulated: false })],
        continental: [spell({ club: "Lyon", competition: "UEFA Champions League", countryCode: null, tier: null, catalogId: "uefa-champions-league", available: 1260, minutes: 1094, appearances: 13, listed: 14 })],
        lastClub: lastClub({ club: "Lyon", countryCode: "FR", position: 1, champion: true, continental: [{ club: "Lyon", competition: "UEFA Champions League", catalogId: "uefa-champions-league", stage: "Semi-final", estimated: true }] }),
        currentClub: { club: "Lyon", countryCode: "FR", tier: 1, listed: true, estimated: false, fallback: false },
      }),
      ruleset,
    );
    expect(result.breakdown.map((entry) => entry.points)).toEqual([10, 12, 9, 6, 9, 12]);
    expect(result.points).toBe(58);
    expect(result.outcome).toBe("pass");
    expect(row(result, "international").status).toBe("estimate");
    expect(row(result, "international").detail).toContain("4 of 16 available senior internationals (25%)");
    expect(row(result, "continental_minutes").status).toBe("scored");
    expect(result.dataQuality).toBe("estimate");
  });

  it("counts friendlies only when under 30% of the nation's matches were competitive, and auto-passes", () => {
    const friendlies = calculateGbe(
      evidence({ international: { rank: 45, competitive: 2, friendlies: 18, competitiveApps: 1, friendlyApps: 14, unavailable: 0, estimated: false, simulated: true } }),
      ruleset,
    );
    expect(row(friendlies, "international").detail).toContain("15 of 20");
    expect(friendlies.outcome).toBe("auto_pass");
    expect(friendlies.autoPass).toBe(true);
    const competitive = calculateGbe(
      evidence({ international: { rank: 45, competitive: 8, friendlies: 12, competitiveApps: 2, friendlyApps: 12, unavailable: 0, estimated: false, simulated: true } }),
      ruleset,
    );
    expect(row(competitive, "international").detail).toContain("2 of 8");
    expect(competitive.autoPass).toBe(false);
    const none = calculateGbe(evidence({ international: { rank: 120, competitive: 0, friendlies: 0, competitiveApps: 0, friendlyApps: 0, unavailable: 0, estimated: false, simulated: false } }), ruleset);
    expect(row(none, "international").status).toBe("no_data");
  });

  it("weights clubs by their share of the period and takes the higher band column (¶30-32, ¶37)", () => {
    const result = calculateGbe(
      evidence({
        domestic: [
          spell({ club: "Porto", countryCode: "PT", tier: 1, available: 1530, minutes: 1400, appearances: 17, listed: 17 }),
          spell({ club: "Gremio", countryCode: "BR", tier: 1, available: 1530, minutes: 1300, appearances: 16, listed: 17 }),
          spell({ club: "Arsenal", countryCode: "EN", tier: 1, available: 270, minutes: 0, appearances: 0, listed: 1 }),
        ],
      }),
      ruleset,
    );
    // 2,700 of 3,330 minutes = 81%; Arsenal's spell is under a quarter of the period, so its Band 1 column is not used.
    expect(row(result, "domestic_minutes").points).toBe(9);
  });

  it("gives a Youth Player the debut row and treats clubs below the Premier League and EFL as non-sponsors in the notes", () => {
    const result = calculateGbe(
      evidence({
        birthDate: "2008-02-01",
        domestic: [spell({ countryCode: "ES", tier: 1, available: 1800, minutes: 120, appearances: 3, listed: 9 })],
        debut: { month: "2026-02", club: "Valencia", countryCode: "ES", tier: 1, estimated: false },
        esc: { seniorCompetitiveCaps: 0, youthInternationals: 2, continentalMatches: 0, continentalYouthMatches: 0, domesticSeniorMatches: 3, domesticYouthMatches: 0 },
        international: { rank: 3, competitive: 8, friendlies: 2, competitiveApps: 0, friendlyApps: 0, unavailable: 0, estimated: false, simulated: true },
      }),
      ruleset,
    );
    expect(row(result, "domestic_minutes").points).toBe(6);
    expect(row(result, "domestic_minutes").detail).toContain("Youth Player debut for Valencia");
    expect(result.esc).toMatchObject({ eligible: true });
    expect(result.notes?.join(" ")).toContain("Premier League and EFL");
  });

  it("uses the Exceptions Panel band, the British/Irish exemption and loanee parent band (¶47)", () => {
    const loanee = evidence({
      currentClub: {
        club: "Hull",
        countryCode: "EN",
        tier: 2,
        listed: true,
        estimated: false,
        fallback: false,
        parent: { club: "Chelsea", countryCode: "EN", tier: 1 },
      },
      lastClub: lastClub({ club: "Hull", countryCode: "EN", tier: 2, promoted: false }),
    });
    const panel = calculateGbe(loanee, ruleset);
    expect(row(panel, "league_standard").points).toBe(12);
    expect(panel.points).toBe(12);
    expect(panel.outcome).toBe("panel");
    expect(calculateGbe({ ...loanee, passportGroups: ["BR", "IE"] }, ruleset)).toMatchObject({ outcome: "exempt", exemptReason: "Irish citizen" });
  });

  it("Table 4 and 5: best applicable row, squad gates, continental places unknown before the draw", () => {
    const promoted = calculateGbe(evidence({ lastClub: lastClub({ countryCode: "EN", tier: 2, position: 1, champion: true, promoted: true }) }), ruleset);
    expect(row(promoted, "league_position").points).toBe(5);
    const qualified = calculateGbe(
      evidence({ lastClub: lastClub({ countryCode: "ES", tier: 1, position: 5, qualified: [{ catalogId: "uefa-europa-league", competition: "UEFA Europa League", phase: "group" }] }) }),
      ruleset,
    );
    expect(row(qualified, "league_position").points).toBe(3);
    const unknown = calculateGbe(evidence({ lastClub: lastClub({ countryCode: "ES", tier: 1, qualified: null }) }), ruleset);
    expect(row(unknown, "league_position").detail).toContain("not known yet");
    const benchless = calculateGbe(evidence({ lastClub: lastClub({ countryCode: "ES", tier: 1, champion: true, listedLeague: false }) }), ruleset);
    expect(row(benchless, "league_position").points).toBe(0);
    const cup = calculateGbe(evidence({ cupPercent: { reference: 0, lastSeason: 2 }, lastClub: lastClub({ countryCode: "ES", tier: 1, champion: true, listedLeague: false }) }), ruleset);
    expect(row(cup, "league_position").points).toBe(6);
    const run = calculateGbe(
      evidence({
        lastClub: lastClub({ continental: [{ club: "Porto Alegre", competition: "CONMEBOL Libertadores", catalogId: "copa-libertadores", stage: "Quarter-final", estimated: false }] }),
        currentRuns: [{ club: "Porto Alegre", competition: "CONMEBOL Sudamericana", catalogId: "copa-sudamericana", stage: "Final", estimated: false }],
      }),
      ruleset,
    );
    expect(row(run, "continental_progression").points).toBe(8);
    const archive = calculateGbe(evidence({ lastClub: lastClub({ archived: false }) }), ruleset);
    expect(row(archive, "league_position").status).toBe("no_data");
    expect(archive.dataQuality).toBe("partial");
  });
});
