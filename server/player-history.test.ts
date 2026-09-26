import { describe, expect, it } from "vitest";
import { buildPlayerHistory, referencedClubIds, type HistoryLoanRow, type HistoryMoveRow } from "./player-history.ts";

const clubs = [
  { id: 1, name: "Home FC", color: "#111111" },
  { id: 2, name: "Loan Town", color: "#222222" },
  { id: 3, name: "Buyers United", color: "#333333" },
  { id: 4, name: "Home FC B", color: "#444444" },
];
const move = (id: number, date: string, entity_type: string, data: object): HistoryMoveRow => ({
  id,
  season: Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 7 ? 1 : 0),
  date,
  entity_type,
  data: JSON.stringify(data),
});
const loan = (row: Partial<HistoryLoanRow> & Pick<HistoryLoanRow, "id" | "status">): HistoryLoanRow => ({
  parent_id: 1,
  destination_id: 2,
  type: "Standard loan",
  start_date: "2027-08-01",
  end_date: "2028-06-30",
  terms: "{}",
  data: "{}",
  ...row,
});
const build = (input: Partial<Parameters<typeof buildPlayerHistory>[0]>) =>
  buildPlayerHistory({
    playerId: 9,
    moves: [],
    loans: [],
    seasonStats: [],
    appearanceStats: [],
    clubs,
    competitions: [
      { id: 10, name: "Premier Division", age_group: "Senior" },
      { id: 11, name: "Cup", age_group: "Senior" },
    ],
    movesTruncated: false,
    ...input,
  });

describe("player history assembly (no database)", () => {
  it("classifies recorded moves and dates loan spells from the loan rows, never inventing a date", () => {
    const history = build({
      moves: [
        move(5, "2028-07-02", "transfer", { from: 1, to: 3, fee: 4_000_000 }),
        move(1, "2026-07-01", "transfer", { from: null, to: 1, fee: 0, type: "Free transfer" }),
        move(2, "2026-09-01", "transfer", { from: 1, to: 4, fee: 0, type: "Squad registration" }),
        move(3, "2027-01-15", "squad", { fromClubId: 4, fromAgeGroup: "U19", toClubId: 1, ageGroup: "Senior", label: "Senior squad" }),
        move(4, "2027-08-01", "loan", { from: 1, to: 2, fee: 50_000, type: "Standard loan" }),
      ],
      loans: [
        loan({ id: 1, status: "completed" }),
        loan({ id: 2, status: "recalled", start_date: "2028-08-01", end_date: "2029-06-30", destination_id: 3 }),
        loan({ id: 3, status: "purchased", start_date: "2029-08-01", terms: JSON.stringify({ optionFee: 900_000 }), data: JSON.stringify({ endedOn: "2029-12-01" }) }),
        loan({ id: 4, status: "active", start_date: "2030-01-01", destination_id: 99 }),
      ],
    });
    expect(history.moves.map((entry) => [entry.kind, entry.date, entry.from?.id ?? null, entry.to?.id ?? null, entry.fee])).toEqual([
      ["free", "2026-07-01", null, 1, 0],
      ["registration", "2026-09-01", 1, 4, 0],
      ["squad", "2027-01-15", 4, 1, null],
      ["loan", "2027-08-01", 1, 2, 50_000],
      ["loanReturn", "2028-06-30", 2, 1, null],
      ["transfer", "2028-07-02", 1, 3, 4_000_000],
      ["loan", "2028-08-01", 1, 3, null],
      ["loanRecall", null, 3, 1, null],
      ["loan", "2029-08-01", 1, 2, null],
      ["loanPurchase", "2029-12-01", 1, 2, 900_000],
      ["loan", "2030-01-01", 1, 99, null],
    ]);
    const [, , squad, recordedLoan, returned] = history.moves;
    expect(squad.ageGroup).toEqual({ from: "U19", to: "Senior" });
    expect(recordedLoan).toMatchObject({ dealType: "Standard loan", loanUntil: "2028-06-30", dateEstimated: false, season: 2027 });
    expect(returned.dateEstimated).toBe(true);
    expect(history.moves.find((entry) => entry.kind === "loanPurchase")?.dateEstimated).toBe(false);
    expect(history.moves.at(-1)?.to).toEqual({ id: 99, name: "Unknown club", color: null });
    expect(referencedClubIds(
      [move(1, "2026-07-01", "squad", { fromClubId: 4, toClubId: 1 })],
      [loan({ id: 1, status: "active", destination_id: 2 })],
      [{ season: 2026, club_id: 3, league_id: 10, appearances: 1, minutes: 90 }],
    ).sort()).toEqual([1, 2, 3, 4]);
  });

  it("passes call-up markers through on squad moves only when recorded", () => {
    const history = build({
      moves: [
        move(1, "2027-01-10", "squad", { fromClubId: 4, toClubId: 1, label: "First team", callUp: true, until: "2027-01-14" }),
        move(2, "2027-01-15", "squad", { fromClubId: 1, toClubId: 4, label: "B team", callUpReturn: true }),
        move(3, "2027-02-01", "squad", { fromClubId: 4, toClubId: 1, label: "First team" }),
      ],
    });
    expect(history.moves.map(({ callUp, callUpReturn, until }) => ({ callUp, callUpReturn, until }))).toEqual([
      { callUp: true, callUpReturn: undefined, until: "2027-01-14" },
      { callUp: undefined, callUpReturn: true, until: undefined },
      { callUp: undefined, callUpReturn: undefined, until: undefined },
    ]);
    expect(Object.keys(history.moves[2])).not.toContain("callUp");
  });

  it("reports goals, assists and ratings only from full-engine matches and tells 0 from not recorded", () => {
    const history = build({
      seasonStats: [
        { season: 2027, club_id: 1, league_id: 10, appearances: 30, minutes: 2500 },
        { season: 2027, club_id: 2, league_id: 11, appearances: 4, minutes: 300 },
        { season: 2026, club_id: 1, league_id: 10, appearances: 20, minutes: 1500 },
      ],
      appearanceStats: [
        // Current season: 30 league games, 12 of them full-engine.
        { season: 2027, club_id: 1, league_id: 10, appearances: 30, minutes: 2500, recorded: 12, goals: 0, assists: 2, rating_sum: 84 },
        { season: 2027, club_id: 1, league_id: 0, appearances: 2, minutes: 120, recorded: 2, goals: 1, assists: 0, rating_sum: 14.5 },
        // Cup games were all fast-model.
        { season: 2027, club_id: 2, league_id: 11, appearances: 4, minutes: 300, recorded: 0, goals: 0, assists: 0, rating_sum: 0 },
      ],
    });
    const [current, previous] = history.seasons;
    expect(current.season).toBe(2027);
    expect(current.competitions.map((line) => [line.club.id, line.competition.id, line.appearances, line.coverage, line.goals, line.assists, line.averageRating])).toEqual([
      [1, 10, 30, "partial", 0, 2, 7],
      [2, 11, 4, "none", null, null, null],
      [1, null, 2, "full", 1, 0, 7.25],
    ]);
    expect(current.competitions[2].competition).toEqual({ id: null, name: "Friendlies", ageGroup: null });
    expect(current.total).toEqual({
      appearances: 36, minutes: 2920, recordedAppearances: 14, goals: 1, assists: 2, averageRating: 7.04, coverage: "partial",
    });
    expect(previous.competitions[0]).toMatchObject({ appearances: 20, recordedAppearances: 0, goals: null, averageRating: null, coverage: "none" });
    expect(previous.total.goals).toBeNull();
    expect(history.career).toMatchObject({ appearances: 56, minutes: 4420, recordedAppearances: 14, goals: 1, coverage: "partial" });
  });

  it("keeps appearances without a season-stat row and an empty history", () => {
    expect(build({}).career).toEqual({
      appearances: 0, minutes: 0, recordedAppearances: 0, goals: null, assists: null, averageRating: null, coverage: "none",
    });
    const history = build({
      appearanceStats: [{ season: 2026, club_id: 1, league_id: 10, appearances: 3, minutes: 270, recorded: 3, goals: 0, assists: 0, rating_sum: 19.5 }],
    });
    expect(history.seasons[0].total).toMatchObject({ appearances: 3, goals: 0, assists: 0, averageRating: 6.5, coverage: "full" });
  });
});
