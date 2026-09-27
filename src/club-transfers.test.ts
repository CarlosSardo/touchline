import { describe, expect, it } from "vitest";
import type { ClubTransfer, ClubTransferSeasonSummary } from "../shared/api.ts";
import type { TransferTerms } from "../shared/types.ts";
import {
  DEFAULT_TRANSFER_FILTER,
  TYPE_OPTIONS,
  clauseBadges,
  clubTransfersPath,
  isFiltered,
  signedMoney,
  sumTotals,
  transferClauses,
  transferDetail,
  transferFee,
  transferSections,
  updateFilter,
} from "./club-transfers.ts";

const move = (patch: Partial<ClubTransfer>): ClubTransfer => ({
  key: "k",
  kind: "transfer",
  direction: "in",
  date: "2026-07-01",
  dateEstimated: false,
  season: 2026,
  player: { id: 1, name: "A Player", position: "ST", ageAtMove: 23 },
  club: { id: 2, name: "Other FC", color: null, country: null },
  fee: 1_000_000,
  dealType: null,
  loanUntil: null,
  terms: null,
  ...patch,
});

const terms = (patch: Partial<TransferTerms>): TransferTerms => ({
  upfrontPercent: 100,
  installments: 0,
  intervalMonths: 0,
  buyBackFee: 0,
  buyBackYears: 0,
  sellOnPercent: 0,
  ...patch,
});

const fakeMoney = (value: number) => `£${value}`;

describe("clubTransfersPath", () => {
  it("omits defaults and always sends the page size", () => {
    expect(clubTransfersPath(7, DEFAULT_TRANSFER_FILTER)).toBe("clubs/7/transfers?pageSize=100");
  });
  it("encodes every active filter", () => {
    expect(
      clubTransfersPath(7, { season: 2025, direction: "out", type: "loanReturn", page: 3 }),
    ).toBe("clubs/7/transfers?season=2025&direction=out&type=loanReturn&page=3&pageSize=100");
  });
});

describe("updateFilter / isFiltered", () => {
  it("resets to the first page on any filter change", () => {
    const paged = { ...DEFAULT_TRANSFER_FILTER, page: 4 };
    expect(updateFilter(paged, { direction: "in" })).toEqual({ ...DEFAULT_TRANSFER_FILTER, direction: "in", page: 1 });
  });
  it("treats paging alone as unfiltered", () => {
    expect(isFiltered({ ...DEFAULT_TRANSFER_FILTER, page: 2 })).toBe(false);
    expect(isFiltered({ ...DEFAULT_TRANSFER_FILTER, season: 2024 })).toBe(true);
    expect(isFiltered({ ...DEFAULT_TRANSFER_FILTER, type: "free" })).toBe(true);
  });
  it("offers every move kind with the player-history labels", () => {
    expect(TYPE_OPTIONS.map((option) => option.kind)).toHaveLength(8);
    expect(TYPE_OPTIONS.find((option) => option.kind === "loanPurchase")?.label).toBe("Loan made permanent");
  });
});

describe("transferFee", () => {
  it("follows the fee semantics: 0 = free, null = undisclosed", () => {
    expect(transferFee(move({ fee: 5 }))).toEqual({ kind: "amount", value: 5 });
    expect(transferFee(move({ fee: 0 }))).toEqual({ kind: "free" });
    expect(transferFee(move({ fee: null }))).toEqual({ kind: "undisclosed" });
    expect(transferFee(move({ kind: "loan", fee: 0 }))).toEqual({ kind: "noFee" });
    expect(transferFee(move({ kind: "free", fee: null }))).toEqual({ kind: "free" });
  });
  it("shows no fee for returns, recalls and internal moves", () => {
    expect(transferFee(move({ kind: "loanReturn", fee: null }))).toEqual({ kind: "notApplicable" });
    expect(transferFee(move({ kind: "registration", fee: 0 }))).toEqual({ kind: "notApplicable" });
    expect(transferFee(move({ kind: "loanRecall", fee: 250 }))).toEqual({ kind: "amount", value: 250 });
  });
});

describe("transfer clauses", () => {
  it("is empty for AI deals and plain deals", () => {
    expect(transferClauses(null, fakeMoney)).toEqual([]);
    expect(transferClauses(terms({}), fakeMoney)).toEqual([]);
    expect(clauseBadges(null)).toEqual([]);
  });
  it("describes instalments, sell-on, buy-back and loan-back", () => {
    const deal = terms({
      upfrontPercent: 40,
      installments: 3,
      intervalMonths: 6,
      sellOnPercent: 15,
      buyBackFee: 9_000_000,
      buyBackYears: 2,
      loanBack: "year",
    });
    expect(transferClauses(deal, fakeMoney)).toEqual([
      "40% upfront, then 3 instalments every 6 months",
      "15% sell-on",
      "Buy-back £9000000 for 2 years",
      "One-year loan-back",
    ]);
    expect(clauseBadges(deal)).toEqual(["Instalments", "Sell-on 15%", "Buy-back", "Loan-back"]);
    expect(transferClauses(terms({ installments: 1, intervalMonths: 1 }), fakeMoney)).toEqual([
      "100% upfront, then 1 instalment every 1 month",
    ]);
  });
});

describe("transferSections", () => {
  const transfers = [
    move({ key: "a", direction: "out" }),
    move({ key: "b", direction: "in" }),
    move({ key: "c", direction: "out" }),
  ];
  it("splits all moves into arrivals then departures, keeping server order", () => {
    const sections = transferSections(transfers, "all");
    expect(sections.map((section) => [section.id, section.title, section.clubLabel])).toEqual([
      ["in", "Arrivals", "From"],
      ["out", "Departures", "To"],
    ]);
    expect(sections[1].rows.map((row) => [row.key, row.index])).toEqual([
      ["a", 0],
      ["c", 2],
    ]);
  });
  it("renders a single table when a direction is chosen", () => {
    const sections = transferSections(transfers, "out");
    expect(sections).toHaveLength(1);
    expect(sections[0].rows.map((row) => row.key)).toEqual(["a", "c"]);
  });
  it("keeps an empty arrivals section so the season still reads in/out", () => {
    expect(transferSections([move({ direction: "out" })], "all")[0].rows).toEqual([]);
  });
});

describe("totals formatting", () => {
  const season = (season: number, spent: number, received: number, unknownFees = 0): ClubTransferSeasonSummary => ({
    season,
    totals: { spent, received, net: received - spent, countIn: 2, countOut: 1, unknownFees },
  });
  it("sums every season", () => {
    expect(sumTotals([season(2026, 10, 4, 1), season(2025, 0, 20)])).toEqual({
      spent: 10,
      received: 24,
      net: 14,
      countIn: 4,
      countOut: 2,
      unknownFees: 1,
    });
    expect(sumTotals([]).net).toBe(0);
  });
  it("signs the net balance", () => {
    expect(signedMoney(5, fakeMoney)).toBe("+£5");
    expect(signedMoney(-5, fakeMoney)).toBe("−£5");
    expect(signedMoney(0, fakeMoney)).toBe("£0");
  });
});

describe("transferDetail", () => {
  const date = (value: string) => `D${value}`;
  it("shows the loan end, a distinct deal type, or nothing", () => {
    expect(transferDetail(move({ kind: "loan", loanUntil: "2027-06-30" }), date)).toBe("Until D2027-06-30");
    expect(transferDetail(move({ dealType: "Squad registration", kind: "registration" }), date)).toBe(
      "Squad registration",
    );
    expect(transferDetail(move({ dealType: "Transfer" }), date)).toBeNull();
    expect(transferDetail(move({}), date)).toBeNull();
  });
});
