import { describe, expect, it } from "vitest";
import {
  buildPlayerHistory,
  foldSquadMoves,
  referencedClubIds,
  registrationEntry,
  squadEntry,
  type FamilyClub,
  type HistoryLoanRow,
  type HistoryMoveRow,
} from "./player-history.ts";

const clubs: FamilyClub[] = [
  { id: 1, name: "Home FC", color: "#111111", parent_id: null },
  { id: 2, name: "Loan Town", color: "#222222", parent_id: null },
  { id: 3, name: "Buyers United", color: "#333333", parent_id: null },
  { id: 4, name: "Home FC B", color: "#444444", parent_id: 1 },
  { id: 5, name: "Academy Town", color: "#555555", parent_id: null },
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
        move(6, "2026-07-01", "transfer", { from: 5, to: 1, fee: 0, type: "Squad registration" }),
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
    // Family moves (B-team registration, squad assignment) are squad movements, never transfers.
    expect(history.transfers.map((entry) => [entry.kind, entry.date, entry.from?.id ?? null, entry.to?.id ?? null, entry.fee])).toEqual([
      ["free", "2026-07-01", null, 1, 0],
      ["registration", "2026-07-01", 5, 1, 0],
      ["loan", "2027-08-01", 1, 2, 50_000],
      ["loanReturn", "2028-06-30", 2, 1, null],
      ["transfer", "2028-07-02", 1, 3, 4_000_000],
      ["loan", "2028-08-01", 1, 3, null],
      ["loanRecall", null, 3, 1, null],
      ["loan", "2029-08-01", 1, 2, null],
      ["loanPurchase", "2029-12-01", 1, 2, 900_000],
      ["loan", "2030-01-01", 1, 99, null],
    ]);
    expect(history.squadMoves).toEqual([
      {
        kind: "registration", date: "2026-09-01", season: 2026, from: { id: 1, name: "Home FC", color: "#111111" }, fromGroup: null,
        to: { id: 4, name: "Home FC B", color: "#444444" }, toGroup: null, label: null, direction: "down",
      },
      {
        kind: "move", date: "2027-01-15", season: 2026, from: { id: 4, name: "Home FC B", color: "#444444" }, fromGroup: "U19",
        to: { id: 1, name: "Home FC", color: "#111111" }, toGroup: "Senior", label: "Senior squad", direction: "up",
      },
    ]);
    const [, , recordedLoan, returned] = history.transfers;
    expect(recordedLoan).toMatchObject({ dealType: "Standard loan", loanUntil: "2028-06-30", dateEstimated: false, season: 2027 });
    expect(returned.dateEstimated).toBe(true);
    expect(history.transfers.find((entry) => entry.kind === "loanPurchase")?.dateEstimated).toBe(false);
    expect(history.transfers.at(-1)?.to).toEqual({ id: 99, name: "Unknown club", color: null });
    expect(referencedClubIds(
      [move(1, "2026-07-01", "squad", { fromClubId: 4, toClubId: 1 })],
      [loan({ id: 1, status: "active", destination_id: 2 })],
      [{ season: 2026, club_id: 3, league_id: 10, appearances: 1, minutes: 90, goals: 0, assists: 0 }],
    ).sort()).toEqual([1, 2, 3, 4]);
  });

  it("folds each call-up with its return into one squad movement and keeps every call-up out of the transfers", () => {
    const history = build({
      moves: [
        move(1, "2027-01-10", "squad", { fromClubId: 4, toClubId: 1, ageGroup: "Senior", label: "First team", callUp: true, until: "2027-01-14", debut: true }),
        move(2, "2027-01-15", "squad", { fromClubId: 1, toClubId: 4, ageGroup: "Senior", label: "B team", callUpReturn: true }),
        move(3, "2027-02-01", "squad", { fromClubId: 4, toClubId: 1, label: "First team" }),
        // Returned and called up again on the same day: history order decides.
        move(4, "2027-03-01", "squad", { fromClubId: 1, fromAgeGroup: "U19", toClubId: 1, ageGroup: "Senior", label: "First team", callUp: true, until: "2027-03-02" }),
        move(5, "2027-03-03", "squad", { fromClubId: 1, toClubId: 1, ageGroup: "U19", label: "U19", callUpReturn: true }),
        move(6, "2027-03-03", "squad", { fromClubId: 1, fromAgeGroup: "U19", toClubId: 1, ageGroup: "Senior", label: "First team", callUp: true, until: "2027-03-10" }),
      ],
    });
    expect(history.transfers).toEqual([]);
    expect(history.squadMoves.map(({ kind, date, direction, until, returnedOn, days, debut }) => ({ kind, date, direction, until, returnedOn, days, debut }))).toEqual([
      { kind: "callUp", date: "2027-01-10", direction: "up", until: "2027-01-14", returnedOn: "2027-01-15", days: 5, debut: true },
      { kind: "move", date: "2027-02-01", direction: "up", until: undefined, returnedOn: undefined, days: undefined, debut: undefined },
      { kind: "callUp", date: "2027-03-01", direction: "up", until: "2027-03-02", returnedOn: "2027-03-03", days: 2, debut: undefined },
      { kind: "callUp", date: "2027-03-03", direction: "up", until: "2027-03-10", returnedOn: null, days: null, debut: undefined },
    ]);
    expect(Object.keys(history.squadMoves[1])).not.toContain("returnedOn");
  });

  it("closes an open call-up with any later move of the same player and treats an orphan return as a move", () => {
    const row = (id: number, date: string, data: object) => move(id, date, "squad", data);
    const family = (id: number | null) => clubs.find((entry) => entry.id === id) ?? null;
    const folded = foldSquadMoves(
      [
        squadEntry(row(1, "2027-01-02", { fromClubId: 1, toClubId: 4, callUpReturn: true }), 7),
        squadEntry(row(2, "2027-01-10", { fromClubId: 4, toClubId: 1, callUp: true, until: "2027-01-20" }), 7),
        squadEntry(row(3, "2027-01-10", { fromClubId: 4, toClubId: 1, callUp: true }), 8),
        registrationEntry(move(4, "2027-01-12", "transfer", { from: 1, to: 4, name: "Seven" }), 7),
      ],
      family,
    );
    expect(folded.map(({ key, playerId, kind, returnedOn, days }) => [key, playerId, kind, returnedOn, days])).toEqual([
      ["h1", 7, "move", undefined, undefined],
      ["h2", 7, "callUp", "2027-01-12", 2],
      ["h3", 8, "callUp", null, null],
      ["h4", 7, "registration", undefined, undefined],
    ]);
  });

  it("counts goals and assists of every competitive match from the season stats, ratings only where match rows exist", () => {
    const history = build({
      seasonStats: [
        { season: 2027, club_id: 1, league_id: 10, appearances: 30, minutes: 2500, goals: 14, assists: 5 },
        // Cup games of a loan spell: the borrower's line.
        { season: 2027, club_id: 2, league_id: 11, appearances: 4, minutes: 300, goals: 2, assists: 1 },
        // A finished season of another club: its match rows were pruned, the totals stay.
        { season: 2026, club_id: 3, league_id: 10, appearances: 20, minutes: 1500, goals: 9, assists: 2 },
      ],
      appearanceStats: [
        // The current season keeps every match row; 28 of the 30 league games carry a rating.
        { season: 2027, club_id: 1, league_id: 10, appearances: 30, minutes: 2500, goals: 14, assists: 5, rated: 28, rating_sum: 196 },
        { season: 2027, club_id: 1, league_id: 0, appearances: 2, minutes: 120, goals: 1, assists: 0, rated: 2, rating_sum: 14.5 },
        { season: 2027, club_id: 2, league_id: 11, appearances: 4, minutes: 300, goals: 2, assists: 1, rated: 4, rating_sum: 26 },
      ],
    });
    const [current, previous] = history.seasons;
    expect(current.season).toBe(2027);
    expect(current.clubs.map(({ club, competitions, total }) => [
      club.id,
      total.appearances,
      competitions.map((line) => [line.competition.id, line.appearances, line.goals, line.assists, line.averageRating, line.ratingCoverage]),
    ])).toEqual([
      [1, 30, [[10, 30, 14, 5, 7, "partial"]]],
      [2, 4, [[11, 4, 2, 1, 6.5, "full"]]],
    ]);
    // Friendlies are listed apart and never part of the competitive totals.
    expect(current.friendlies.map((line) => [line.club.id, line.competition, line.appearances, line.goals])).toEqual([
      [1, { id: null, name: "Friendlies", ageGroup: null }, 2, 1],
    ]);
    expect(current.total).toEqual({
      appearances: 34, minutes: 2800, goals: 16, assists: 6, ratedAppearances: 32, averageRating: 6.94, ratingCoverage: "partial",
    });
    expect(previous.clubs[0].competitions[0]).toMatchObject({
      club: { id: 3 }, appearances: 20, goals: 9, assists: 2, ratedAppearances: 0, averageRating: null, ratingCoverage: "none",
    });
    expect(previous.total).toMatchObject({ goals: 9, averageRating: null });
    // Career: every competitive line once (the current season is not counted from both sources).
    expect(history.career).toEqual({
      appearances: 54, minutes: 4300, goals: 25, assists: 8, ratedAppearances: 32, averageRating: 6.94, ratingCoverage: "partial",
    });
    expect(history.careerFriendlies).toMatchObject({ appearances: 2, minutes: 120, goals: 1, averageRating: 7.25, ratingCoverage: "full" });
  });

  it("adds up season, club and competition subtotals into the career across moves, loans and the national team", () => {
    const history = build({
      clubs: [...clubs, { id: 50, name: "Nation", color: "#505050", parent_id: null }],
      competitions: [
        { id: 10, name: "Premier Division", age_group: "Senior" },
        { id: 11, name: "Cup", age_group: "Senior" },
        { id: 12, name: "Second Division", age_group: "Senior" },
        { id: 13, name: "Nations Cup", age_group: "Senior" },
      ],
      seasonStats: [
        // 2027: first half at Home FC, then on loan to Loan Town (second division and its cup).
        { season: 2027, club_id: 1, league_id: 10, appearances: 15, minutes: 1200, goals: 6, assists: 2 },
        { season: 2027, club_id: 1, league_id: 11, appearances: 2, minutes: 180, goals: 1, assists: 0 },
        { season: 2027, club_id: 2, league_id: 12, appearances: 16, minutes: 1400, goals: 9, assists: 4 },
        { season: 2027, club_id: 2, league_id: 11, appearances: 1, minutes: 90, goals: 0, assists: 1 },
        { season: 2027, club_id: 50, league_id: 13, appearances: 3, minutes: 200, goals: 2, assists: 0 },
        // 2026: the B-team.
        { season: 2026, club_id: 4, league_id: 12, appearances: 25, minutes: 2000, goals: 11, assists: 3 },
      ],
    });
    const [current, previous] = history.seasons;
    const shape = (season: (typeof history.seasons)[number]) =>
      season.clubs.map(({ club, total, competitions }) => [
        club.id,
        [total.appearances, total.minutes, total.goals, total.assists],
        competitions.map((line) => [line.competition.id, line.appearances, line.goals]),
      ]);
    expect(shape(current)).toEqual([
      // Equal appearances: by club id.
      [1, [17, 1380, 7, 2], [[10, 15, 6], [11, 2, 1]]],
      [2, [17, 1490, 9, 5], [[12, 16, 9], [11, 1, 0]]],
      [50, [3, 200, 2, 0], [[13, 3, 2]]],
    ]);
    expect(current.total).toMatchObject({ appearances: 37, minutes: 3070, goals: 18, assists: 7 });
    expect(shape(previous)).toEqual([[4, [25, 2000, 11, 3], [[12, 25, 11]]]]);
    // Club subtotals add up to the season, seasons to the career.
    for (const season of history.seasons)
      for (const key of ["appearances", "minutes", "goals", "assists"] as const)
        expect(season.clubs.reduce((sum, entry) => sum + entry.total[key], 0)).toBe(season.total[key]);
    expect(history.career).toMatchObject({ appearances: 62, minutes: 5070, goals: 29, assists: 10, averageRating: null, ratingCoverage: "none" });
    expect(history.careerFriendlies).toBeNull();
  });

  it("groups a season by club with club subtotals, clubs and competitions by appearances", () => {
    const history = build({
      seasonStats: [
        { season: 2027, club_id: 1, league_id: 10, appearances: 5, minutes: 400, goals: 1, assists: 0 },
        { season: 2027, club_id: 1, league_id: 11, appearances: 3, minutes: 200, goals: 2, assists: 1 },
        { season: 2027, club_id: 2, league_id: 10, appearances: 12, minutes: 1000, goals: 0, assists: 0 },
      ],
    });
    const [season] = history.seasons;
    expect(season.clubs.map(({ club, total, competitions }) => [club.id, total.appearances, total.minutes, total.goals, competitions.map((line) => line.competition.id)])).toEqual([
      [2, 12, 1000, 0, [10]],
      [1, 8, 600, 3, [10, 11]],
    ]);
    expect(season.total).toMatchObject({ appearances: 20, goals: 3, assists: 1 });
    expect(season.friendlies).toEqual([]);
    expect(history.careerFriendlies).toBeNull();
  });

  it("falls back to match rows for a line without season totals, and reads an empty history", () => {
    expect(build({}).career).toEqual({
      appearances: 0, minutes: 0, goals: 0, assists: 0, ratedAppearances: 0, averageRating: null, ratingCoverage: "none",
    });
    expect(build({})).toMatchObject({ transfers: [], squadMoves: [], seasons: [], honours: [], milestones: [] });
    const history = build({
      appearanceStats: [
        { season: 2026, club_id: 1, league_id: 10, appearances: 3, minutes: 270, goals: 2, assists: 1, rated: 3, rating_sum: 19.5 },
      ],
    });
    expect(history.seasons[0].total).toEqual({
      appearances: 3, minutes: 270, goals: 2, assists: 1, ratedAppearances: 3, averageRating: 6.5, ratingCoverage: "full",
    });
  });
});
