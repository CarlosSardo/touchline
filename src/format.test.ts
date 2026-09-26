import { describe, expect, it } from "vitest";
import { expectationText, ordinal, plural, seasonText, showsGbe, unreadLabel } from "./format.ts";

describe("ordinal", () => {
  it("handles teens and the twenties of 24-club leagues", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 24, 101, 111, 112].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "24th", "101st", "111th", "112th",
    ]);
  });
});

describe("text helpers", () => {
  it("pluralises counts", () => {
    expect(plural(1, "year")).toBe("1 year");
    expect(plural(3, "year")).toBe("3 years");
    expect(plural(0, "day")).toBe("0 days");
    expect(plural(1200, "player")).toBe("1,200 players");
    expect(plural(2, "match", "matches")).toBe("2 matches");
  });

  it("formats seasons one way", () => {
    expect(seasonText(2026)).toBe("2026/27");
    expect(seasonText(2029, true)).toBe("2029/30 pre-season");
    expect(seasonText(2099)).toBe("2099/00");
  });

  it("words the board target and unread counter", () => {
    expect(expectationText(1)).toBe("Win the league");
    expect(expectationText(4)).toBe("Finish in the top 4");
    expect(unreadLabel(7, 100)).toBe("7");
    expect(unreadLabel(100, 100)).toBe("99+");
  });

  it("shows GBE points only where the FA endorsement applies", () => {
    expect(showsGbe({ status: "No FA endorsement required" })).toBe(false);
    expect(showsGbe({ status: "Points threshold met" })).toBe(true);
    expect(showsGbe({ status: "Endorsement not met" })).toBe(true);
  });
});
