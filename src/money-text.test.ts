import { describe, expect, it } from "vitest";
import { dateLabel, money } from "../shared/rules.ts";
import {
  localizeDateText,
  localizeMoneyText,
  localizeServerText,
} from "./money-text.ts";

describe("localizeDateText", () => {
  it("formats calendar dates written by the server", () => {
    expect(
      localizeDateText("Final offer lodged. The selling club decides on 2026-08-20; bids stand."),
    ).toBe(`Final offer lodged. The selling club decides on ${dateLabel("2026-08-20")}; bids stand.`);
    expect(localizeDateText("Due 2027-01-03.")).toBe(`Due ${dateLabel("2027-01-03")}.`);
  });

  it("leaves timestamps, invalid dates and other numbers alone", () => {
    for (const text of [
      "Saved at 2026-08-20T10:00:00Z",
      "Reference 12026-08-20",
      "Score 2026-13-01",
      "Tension 65% after 3 offers",
    ])
      expect(localizeDateText(text)).toBe(text);
  });
});

describe("localizeServerText", () => {
  it("converts amounts and dates together", () => {
    expect(localizeServerText("Bid of £1.2M due 2026-09-01.", "EUR")).toBe(
      `Bid of ${money(1_200_000, false, "EUR")} due ${dateLabel("2026-09-01")}.`,
    );
  });
});

describe("localizeMoneyText", () => {
  it("leaves GBP careers untouched", () => {
    const text = "Offer rejected. The club counters at £1.2M.";
    expect(localizeMoneyText(text, "GBP")).toBe(text);
  });

  it("converts compact server amounts into the display currency", () => {
    expect(
      localizeMoneyText("Offer rejected. The club counters at £1.2M.", "EUR"),
    ).toBe(`Offer rejected. The club counters at ${money(1_200_000, false, "EUR")}.`);
    expect(
      localizeMoneyText(
        "Proposed £850K per week against an expectation of £12.5K.",
        "USD",
      ),
    ).toBe(
      `Proposed ${money(850_000, false, "USD")} per week against an expectation of ${money(12_500, false, "USD")}.`,
    );
  });

  it("handles plain, grouped and negative amounts and ignores other text", () => {
    expect(localizeMoneyText("Bonus £950, fee £1,234,567", "EUR")).toBe(
      `Bonus ${money(950, false, "EUR")}, fee ${money(1_234_567, false, "EUR")}`,
    );
    expect(localizeMoneyText("Balance -£2B", "JPY")).toBe(
      `Balance ${money(-2_000_000_000, false, "JPY")}`,
    );
    expect(localizeMoneyText("Tension 65% after 3 offers", "EUR")).toBe(
      "Tension 65% after 3 offers",
    );
  });
});
