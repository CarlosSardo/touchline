import { describe, expect, it } from "vitest";
import {
  clubMoves,
  clubTransfersQuerySchema,
  filterClubMoves,
  mergeClubRows,
  seasonOfDate,
  seasonSummaries,
  type ClubHistoryRow,
  type ClubLoanRow,
} from "./club-transfers.ts";

const CLUB = 1;
const row = (id: number, date: string, entity_type: string, data: object, entity_id = 9): ClubHistoryRow => ({
  id,
  season: seasonOfDate(date),
  date,
  entity_type,
  entity_id,
  data: JSON.stringify(data),
});
const loan = (entry: Partial<ClubLoanRow> & Pick<ClubLoanRow, "id" | "status">): ClubLoanRow => ({
  player_id: 9,
  parent_id: CLUB,
  destination_id: 2,
  type: "Standard loan",
  start_date: "2027-08-01",
  end_date: "2028-06-30",
  terms: "{}",
  data: "{}",
  ...entry,
});
const summary = (moves: ReturnType<typeof clubMoves>["moves"]) =>
  moves.map((move) => [move.key, move.kind, move.direction, move.date, move.season, move.fee]);

describe("club transfer list (no database)", () => {
  it("classifies every move with another club, newest first, and keeps family moves apart", () => {
    const { moves, squad } = clubMoves(
      CLUB,
      [
        row(1, "2026-07-01", "transfer", { from: null, to: CLUB, fee: 0, type: "Free transfer" }),
        row(2, "2026-09-01", "transfer", { from: CLUB, to: 4, fee: 0, type: "Squad registration" }),
        row(3, "2027-01-15", "squad", { fromClubId: 4, toClubId: CLUB, label: "Senior squad" }),
        row(4, "2027-02-01", "squad", { fromClubId: CLUB, toClubId: CLUB, label: "U19 squad" }),
        row(5, "2027-08-01", "loan", { from: CLUB, to: 2, fee: 50_000, type: "Standard loan" }),
        row(6, "2028-07-02", "transfer", { from: CLUB, to: 3, fee: 4_000_000, type: "Permanent transfer" }),
        row(7, "2028-07-03", "transfer", { from: 3, to: CLUB, type: "Permanent transfer" }, 10),
      ],
      [
        loan({ id: 1, status: "completed" }),
        loan({ id: 2, status: "recalled", start_date: "2028-08-01", end_date: "2029-06-30", destination_id: 3 }),
        loan({
          id: 3,
          status: "purchased",
          start_date: "2029-08-01",
          terms: JSON.stringify({ optionFee: 900_000 }),
          data: JSON.stringify({ endedOn: "2029-12-01" }),
        }),
        loan({ id: 4, status: "active", start_date: "2030-01-01", player_id: 11, parent_id: 5, destination_id: CLUB }),
      ],
      false,
      new Set([CLUB, 4]),
    );
    expect(summary(moves)).toEqual([
      ["l4", "loan", "in", "2030-01-01", 2029, null],
      ["l3e", "loanPurchase", "out", "2029-12-01", 2029, 900_000],
      ["l3", "loan", "out", "2029-08-01", 2029, null],
      ["l2e", "loanRecall", "in", null, 2028, null],
      ["l2", "loan", "out", "2028-08-01", 2028, null],
      ["h7", "transfer", "in", "2028-07-03", 2028, null],
      ["h6", "transfer", "out", "2028-07-02", 2028, 4_000_000],
      ["l1e", "loanReturn", "in", "2028-06-30", 2027, null],
      ["h5", "loan", "out", "2027-08-01", 2027, 50_000],
      ["h1", "free", "in", "2026-07-01", 2026, 0],
    ]);
    // The B-team registration and both squad moves (one inside the club itself) are family moves, not transfers.
    expect(squad.map((entry) => [entry.key, entry.registration, entry.fromClubId, entry.toClubId])).toEqual([
      ["h2", true, CLUB, 4],
      ["h3", false, 4, CLUB],
      ["h4", false, CLUB, CLUB],
    ]);
    expect(moves.find((move) => move.key === "l1e")?.dateEstimated).toBe(true);
    expect(moves.find((move) => move.key === "h5")?.loanUntil).toBe("2028-06-30");
    expect(moves.find((move) => move.key === "h1")).toMatchObject({ fromClubId: null, toClubId: CLUB, dealType: "Free transfer" });
  });

  it("never lists a loan start from the loan row when older history rows were not read", () => {
    const { moves } = clubMoves(CLUB, [], [loan({ id: 1, status: "completed", data: JSON.stringify({ endedOn: "2028-05-20" }) })], true);
    expect(summary(moves)).toEqual([["l1e", "loanReturn", "in", "2028-05-20", 2027, null]]);
    expect(moves[0].dateEstimated).toBe(false);
  });

  it("totals every season (always including the current one), filters and pages", () => {
    const { moves } = clubMoves(
      CLUB,
      [
        row(1, "2026-08-01", "transfer", { from: 2, to: CLUB, fee: 3_000_000 }),
        row(2, "2026-08-02", "transfer", { from: CLUB, to: 3, fee: 1_200_000.5 }),
        row(3, "2026-08-03", "loan", { from: CLUB, to: 4 }),
        row(4, "2026-08-04", "transfer", { from: null, to: CLUB, fee: 0, type: "Free transfer" }),
        row(5, "2025-08-04", "transfer", { from: CLUB, to: 2, fee: 700_000 }),
      ],
      [],
      false,
    );
    expect(seasonSummaries(moves, 2027)).toEqual([
      {
        season: 2027,
        totals: { spent: 0, received: 0, net: 0, countIn: 0, countOut: 0, countInternal: 0, countLoanEnds: 0, unknownFees: 0 },
      },
      {
        season: 2026,
        totals: {
          spent: 3_000_000,
          received: 1_200_000.5,
          net: -1_799_999.5,
          countIn: 2,
          countOut: 2,
          countInternal: 0,
          countLoanEnds: 0,
          unknownFees: 1,
        },
      },
      {
        season: 2025,
        totals: { spent: 0, received: 700_000, net: 700_000, countIn: 0, countOut: 1, countInternal: 0, countLoanEnds: 0, unknownFees: 0 },
      },
    ]);
    const query = (input: Record<string, string>) => clubTransfersQuerySchema.parse(input);
    expect(filterClubMoves(moves, query({ direction: "out" })).page.map((move) => move.key)).toEqual(["h3", "h2", "h5"]);
    expect(filterClubMoves(moves, query({ season: "2026", type: "transfer,free" })).page.map((move) => move.key)).toEqual([
      "h4",
      "h2",
      "h1",
    ]);
    const paged = filterClubMoves(moves, query({ pageSize: "2", page: "3" }));
    expect([paged.total, paged.pages, paged.page.map((move) => move.key)]).toEqual([5, 3, ["h5"]]);
    expect(filterClubMoves(moves, query({ page: "9" })).page).toEqual([]);
    expect(filterClubMoves([], query({})).pages).toBe(1);
  });

  it("keeps call-ups and family moves out of the transfer list and its in/out counts", () => {
    const { moves, squad } = clubMoves(
      CLUB,
      [
        row(1, "2026-08-01", "transfer", { from: 2, to: CLUB, fee: 1_000_000 }),
        row(2, "2026-08-02", "transfer", { from: CLUB, to: 4, fee: 0, type: "Squad registration" }),
        row(3, "2026-09-01", "squad", { fromClubId: 4, toClubId: CLUB, label: "First team", callUp: true, until: "2026-09-05" }),
        row(4, "2026-09-06", "squad", { fromClubId: CLUB, toClubId: 4, label: "B team", callUpReturn: true }),
        row(5, "2026-10-01", "squad", { fromClubId: 4, toClubId: CLUB, label: "First team" }),
        // Moves of other players between two other clubs of the family do not concern this club.
        row(6, "2026-10-02", "squad", { fromClubId: 4, toClubId: 6, label: "U19" }, 12),
      ],
      [loan({ id: 1, status: "completed", start_date: "2026-08-03", end_date: "2027-01-31", data: JSON.stringify({ endedOn: "2027-01-31" }) })],
      false,
      new Set([CLUB, 4, 6]),
    );
    expect(summary(moves)).toEqual([
      ["l1e", "loanReturn", "in", "2027-01-31", 2026, null],
      ["l1", "loan", "out", "2026-08-03", 2026, null],
      ["h1", "transfer", "in", "2026-08-01", 2026, 1_000_000],
    ]);
    expect(squad.map((entry) => [entry.key, entry.callUp, entry.callUpReturn])).toEqual([
      ["h2", false, false],
      ["h3", true, false],
      ["h4", false, true],
      ["h5", false, false],
    ]);
    expect(seasonSummaries(moves, 2026, squad)[0].totals).toEqual({
      spent: 1_000_000,
      received: 0,
      net: -1_000_000,
      countIn: 1,
      countOut: 1,
      countInternal: 2,
      countLoanEnds: 1,
      unknownFees: 1,
    });
  });

  it("merges an incremental scan in front of the cached rows and keeps the newest rows", () => {
    const cached = [row(3, "2026-08-03", "transfer", {}), row(2, "2026-08-02", "transfer", {}), row(1, "2026-08-01", "transfer", {})];
    expect(mergeClubRows({ rows: cached, truncated: false }, [], 3).rows).toBe(cached);
    const merged = mergeClubRows({ rows: cached, truncated: false }, [row(5, "2026-08-05", "transfer", {}), row(4, "2026-08-04", "transfer", {})], 4);
    expect([merged.rows.map((entry) => entry.id), merged.truncated]).toEqual([[5, 4, 3, 2], true]);
    const fits = mergeClubRows({ rows: cached.slice(0, 1), truncated: false }, [row(4, "2026-08-04", "transfer", {})], 4);
    expect([fits.rows.map((entry) => entry.id), fits.truncated]).toEqual([[4, 3], false]);
    const overflow = [5, 4, 3].map((id) => row(10 + id, "2026-09-01", "transfer", {}));
    expect(mergeClubRows({ rows: [], truncated: false }, overflow, 2)).toMatchObject({ truncated: true });
    expect(mergeClubRows({ rows: [], truncated: true }, [], 2).truncated).toBe(true);
  });

  it("validates query parameters", () => {
    expect(clubTransfersQuerySchema.parse({})).toEqual({ direction: "all", type: [], page: 1, pageSize: 100 });
    expect(clubTransfersQuerySchema.parse({ type: "loan, loan,transfer" }).type).toEqual(["loan", "transfer"]);
    for (const input of [
      { page: "0" },
      { page: "1.5" },
      { pageSize: "501" },
      { direction: "both" },
      { type: "gift" },
      { type: "squad" },
      { season: "abc" },
      { season: "20260" },
    ])
      expect(clubTransfersQuerySchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
  });
});
