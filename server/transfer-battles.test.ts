import { describe, expect, it } from "vitest";
import { PERSONAL_TERMS_THRESHOLD } from "./recruitment.ts";
import {
  battleWinner,
  canAddRival,
  deadlineWeek,
  finalOffersResult,
  fuzzyFeeRange,
  MAX_RIVALS,
  playerChoice,
  PREFERENCE_MARGIN,
  rivalChance,
  rivalView,
  windowPhase,
} from "./transfer-battles.ts";
import type { RivalBid } from "../shared/types.ts";

const rival = (overrides: Partial<RivalBid> = {}): RivalBid => ({
  clubId: 7,
  since: "2026-08-01",
  status: "bid",
  fee: 10_000_000,
  wage: 40_000,
  interest: 88,
  raises: 0,
  nextAction: "2026-08-02",
  source: "market",
  ...overrides,
});

const contender = (clubId: number, interest: number, fee = 10_000_000, since = "2026-08-01") => ({
  clubId,
  interest,
  fee,
  since,
});

describe("who the player joins", () => {
  it("joins the rival whose accepted package beats the director's by more than the preference margin", () => {
    expect(PREFERENCE_MARGIN).toBe(3);
    expect(
      battleWinner({ userStage: "Agent talks", userScore: 86, rivals: [contender(7, 90)] }),
    ).toEqual({ winner: "rival", clubId: 7 });
  });

  it("stays with the director on a tie or near-tie once the director's terms reach the agree band", () => {
    for (const userScore of [88, 87])
      expect(battleWinner({ userStage: "Contract review", userScore, rivals: [contender(7, 90)] })).toEqual({
        winner: "user",
      });
    expect(battleWinner({ userStage: "Agent talks", userScore: 90, rivals: [contender(7, 90)] })).toEqual({
      winner: "user",
    });
  });

  it("does not wait for a director who has no acceptable terms yet: an agreed rival package wins", () => {
    for (const [userStage, userScore] of [
      ["Enquiry", null],
      ["Club talks", null],
      ["Agent talks", PERSONAL_TERMS_THRESHOLD - 1],
    ] as const)
      expect(battleWinner({ userStage, userScore, rivals: [contender(7, 86)] })).toEqual({
        winner: "rival",
        clubId: 7,
      });
    // Even a high score only counts in personal-terms stages.
    expect(playerChoice({ userStage: "Club talks", userScore: 99, rivalInterest: 86 })).toBe("rival");
  });

  it("refuses every rival package below the agree band, leaving the director's talks open", () => {
    expect(
      battleWinner({
        userStage: "Agent talks",
        userScore: 70,
        rivals: [contender(7, PERSONAL_TERMS_THRESHOLD - 1), contender(8, 60)],
      }),
    ).toBeNull();
    expect(battleWinner({ userStage: "Contract review", userScore: 95, rivals: [] })).toBeNull();
  });

  it("breaks ties between rivals by interest, then fee, then who approached first, then club id", () => {
    expect(
      battleWinner({ userStage: "Enquiry", userScore: null, rivals: [contender(7, 88), contender(8, 91)] }),
    ).toEqual({ winner: "rival", clubId: 8 });
    expect(
      battleWinner({
        userStage: "Enquiry",
        userScore: null,
        rivals: [contender(7, 90, 9_000_000), contender(8, 90, 11_000_000)],
      }),
    ).toEqual({ winner: "rival", clubId: 8 });
    expect(
      battleWinner({
        userStage: "Enquiry",
        userScore: null,
        rivals: [contender(9, 90, 10_000_000, "2026-08-05"), contender(8, 90, 10_000_000, "2026-08-02")],
      }),
    ).toEqual({ winner: "rival", clubId: 8 });
    expect(
      battleWinner({ userStage: "Enquiry", userScore: null, rivals: [contender(9, 90), contender(4, 90)] }),
    ).toEqual({ winner: "rival", clubId: 4 });
  });
});

describe("best and final offers", () => {
  it("outbids the director when his fee is more than 5% below the best rival bid", () => {
    expect(
      finalOffersResult({ floor: 8_800_000, user: 9_000_000, rivals: [{ clubId: 7, fee: 10_000_000 }] }),
    ).toEqual({ best: 10_000_000, userAccepted: false, accepted: [7] });
  });

  it("keeps every bid within 5% of the best so the player chooses between them", () => {
    expect(
      finalOffersResult({
        floor: 8_800_000,
        user: 9_600_000,
        rivals: [
          { clubId: 7, fee: 10_000_000 },
          { clubId: 8, fee: 9_400_000 },
        ],
      }),
    ).toEqual({ best: 10_000_000, userAccepted: true, accepted: [7] });
  });

  it("accepts nobody below the selling club's floor, and handles a director who lodged nothing", () => {
    expect(
      finalOffersResult({ floor: 8_800_000, user: null, rivals: [{ clubId: 7, fee: 8_000_000 }] }),
    ).toEqual({ best: 8_000_000, userAccepted: false, accepted: [] });
    expect(finalOffersResult({ floor: 8_800_000, user: 9_000_000, rivals: [] })).toMatchObject({
      userAccepted: true,
      accepted: [],
    });
  });
});

describe("rival pacing and the registration calendar", () => {
  it("brings final offers and decisions forward on the last window day and ends pursuits once it closes", () => {
    expect(windowPhase("2026-08-31")).toBe("open");
    expect(windowPhase("2026-09-01")).toBe("last-day");
    expect(windowPhase("2026-09-02")).toBe("closed");
    // The winter window closes on 1 February (winterWindowClose), a day later when 31 January is a Saturday.
    expect(windowPhase("2027-01-31")).toBe("open");
    expect(windowPhase("2027-02-01")).toBe("last-day");
    expect(windowPhase("2027-02-02")).toBe("closed");
    expect(windowPhase("2027-01-01")).toBe("open");
    expect(windowPhase("2026-11-10")).toBe("closed");
    expect(deadlineWeek("2026-08-25")).toBe(true);
    expect(deadlineWeek("2026-08-24")).toBe(false);
    expect(deadlineWeek("2026-09-01")).toBe(true);
  });

  it("doubles the daily rival chance for public talks and deadline week", () => {
    expect(rivalChance({ publicTalks: false, deadlineWeek: false })).toBeCloseTo(0.04);
    expect(rivalChance({ publicTalks: true, deadlineWeek: true })).toBeCloseTo(0.16);
  });

  it("allows at most two active rivals, five days apart", () => {
    expect(MAX_RIVALS).toBe(2);
    expect(canAddRival([], "2026-08-01")).toBe(true);
    const one = [rival({ since: "2026-08-01" })];
    expect(canAddRival(one, "2026-08-05")).toBe(false);
    expect(canAddRival(one, "2026-08-06")).toBe(true);
    const two = [rival({ clubId: 7 }), rival({ clubId: 8, since: "2026-07-20" })];
    expect(canAddRival(two, "2026-08-20")).toBe(false);
    expect(canAddRival([two[0], { ...two[1], status: "withdrawn" }], "2026-08-20")).toBe(true);
  });
});

describe("what the director sees", () => {
  it("gives a fee range that always contains the real bid and narrows with knowledge", () => {
    for (const fee of [400_000, 6_500_000, 42_000_000])
      for (const knowledge of [0, 50, 100])
        for (const certainty of ["rumoured", "reported", "confirmed"] as const)
          for (const u of [0, 0.37, 1]) {
            const range = fuzzyFeeRange(fee, knowledge, certainty, u)!;
            expect(range.low).toBeLessThanOrEqual(fee);
            expect(range.high).toBeGreaterThanOrEqual(fee);
          }
    const width = (knowledge: number) => {
      const range = fuzzyFeeRange(20_000_000, knowledge, "reported", 0.5)!;
      return range.high - range.low;
    };
    expect(width(100)).toBeLessThan(width(0));
    expect(fuzzyFeeRange(0, 50, "reported", 0.5)).toBeNull();
  });

  const club = { id: 7, name: "Real Ejemplo", reputation: 81.4, country_name: "Spain" };
  const context = {
    club,
    knowledge: 10,
    battle: undefined,
    stage: "Club talks",
    userScore: null,
    negotiationId: 12,
    u: 0.5,
  };

  it("keeps an unscouted monitoring club anonymous and never exposes its package", () => {
    const view = rivalView(rival({ status: "monitoring", fee: 0 }), context);
    expect(view).toMatchObject({
      key: "12:7",
      clubId: null,
      clubName: "A club in Spain",
      reputation: null,
      certainty: "rumoured",
      feeRange: null,
      preference: "unknown",
    });
    expect(Object.keys(view)).not.toContain("interest");
    expect(Object.keys(view)).not.toContain("wage");
  });

  it("names a bidding club, confirms it in a contested battle and reveals the player's leaning at decision time", () => {
    expect(rivalView(rival(), context)).toMatchObject({ clubId: 7, certainty: "reported", preference: "unknown" });
    const decision = rivalView(rival({ status: "fee-agreed", interest: 92 }), {
      ...context,
      stage: "Agent talks",
      userScore: 86,
      battle: { status: "decision", decisionDeadline: "2026-08-10" },
    });
    expect(decision).toMatchObject({ certainty: "confirmed", reputation: 81, preference: "rival" });
    expect(
      rivalView(rival({ status: "fee-agreed", interest: 88 }), {
        ...context,
        stage: "Agent talks",
        userScore: 87,
        battle: { status: "decision", decisionDeadline: "2026-08-10" },
      }).preference,
    ).toBe("undecided");
  });

  it("marks active rivals as lost once the director has signed first", () => {
    expect(rivalView(rival(), { ...context, stage: "Scheduled" })).toMatchObject({
      status: "lost",
      outcome: "You reached an agreement with the player first.",
    });
  });
});
