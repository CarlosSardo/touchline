import { describe, expect, it } from "vitest";
import { INTEREST_BANDS } from "../shared/rules.ts";
import type { PlayerInterest } from "../shared/types.ts";
import { interestState } from "./interest-state.ts";

const interest = (patch: Partial<PlayerInterest>): PlayerInterest => ({
  score: 70,
  stance: "Open to talks",
  expectedRole: "Rotation",
  expectedWage: 10_000,
  factors: [],
  concerns: [],
  ...patch,
});

describe("interestState", () => {
  it("uses the thresholds sent with the assessment", () => {
    const thresholds = { negotiate: 50, agree: 85 };
    expect(interestState(interest({ score: 90, moveScore: 49, thresholds })).kind).toBe("refuses");
    expect(interestState(interest({ score: 84, moveScore: 50, thresholds }))).toMatchObject({
      kind: "talking",
      tone: "amber",
      label: "Talking — needs 85 to sign",
    });
    expect(interestState(interest({ score: 85, moveScore: 60, thresholds }))).toMatchObject({
      kind: "agrees",
      tone: "green",
      label: "Will sign (85+)",
    });
  });

  it("labels a refusal with the negotiation threshold", () => {
    expect(interestState(interest({ refuses: true, moveScore: 40, thresholds: { negotiate: 50, agree: 85 } })))
      .toMatchObject({ kind: "refuses", tone: "red", label: "Won't negotiate (below 50)" });
  });

  it("trusts an explicit refusal even when the scores look high", () => {
    expect(interestState(interest({ refuses: true, score: 95, moveScore: 95 })).kind).toBe("refuses");
  });

  it("falls back to INTEREST_BANDS and the overall score for older saves", () => {
    expect(interestState(interest({ score: INTEREST_BANDS.refuse - 1 })).kind).toBe("refuses");
    expect(interestState(interest({ score: INTEREST_BANDS.refuse })).kind).toBe("talking");
    expect(interestState(interest({ score: INTEREST_BANDS.agree }))).toMatchObject({
      kind: "agrees",
      agree: INTEREST_BANDS.agree,
      negotiate: INTEREST_BANDS.refuse,
    });
  });

  it("no longer applies the old 60 / 35 colours", () => {
    expect(interestState(interest({ score: 60, moveScore: 60 })).tone).toBe("amber");
    expect(interestState(interest({ score: 40, moveScore: 40 })).tone).toBe("red");
  });
});
