import { describe, expect, it } from "vitest";
import type {
  PlayerCompetitionStats,
  PlayerHistory,
  PlayerHonour,
  PlayerMilestone,
  PlayerMove,
  PlayerSquadMove,
  PlayerStatLine,
} from "../shared/api.ts";
import {
  ALL_CLUBS,
  ALL_COMPETITIONS,
  FRIENDLIES,
  NO_STAT_FILTER,
  blockTotals,
  competitionLabel,
  historyClubs,
  historyCompetitions,
  honourSummary,
  milestoneText,
  moveFee,
  NO_RATING,
  ordinal,
  ratingNote,
  seasonBlocks,
  seasonLabel,
  squadMovePeriod,
  squadMoveTitle,
  squadName,
  totalStatLine,
} from "./player-history.ts";

const club = (id: number) => ({ id, name: `Club ${id}`, color: null });
const line = (patch: Partial<PlayerStatLine>): PlayerStatLine => ({
  appearances: 10,
  minutes: 900,
  goals: 2,
  assists: 1,
  ratedAppearances: 10,
  averageRating: 7,
  ratingCoverage: "full",
  ...patch,
});
const competition = (
  id: number | null,
  name: string,
  stats: Partial<PlayerStatLine> = {},
  clubId = 1,
  ageGroup: string | null = "Senior",
): PlayerCompetitionStats => ({
  ...line(stats),
  club: club(clubId),
  competition: { id, name, ageGroup },
});
const history: PlayerHistory = {
  playerId: 7,
  transfers: [],
  squadMoves: [],
  movesTruncated: false,
  seasons: [
    {
      season: 2027,
      clubs: [
        { club: club(1), competitions: [competition(3, "Premier League")], total: line({ appearances: 99 }) },
        {
          club: club(2),
          competitions: [
            // An earlier spell of another club's matches: counted from the season totals, no ratings kept.
            competition(9, "FA Cup", { appearances: 2, minutes: 180, goals: 3, assists: 0, ratedAppearances: 0, averageRating: null, ratingCoverage: "none" }, 2),
          ],
          total: line({ appearances: 2 }),
        },
      ],
      friendlies: [competition(null, "Friendlies", { averageRating: 6 })],
      total: line({ appearances: 12 }),
    },
    {
      season: 2026,
      clubs: [
        {
          club: club(1),
          competitions: [competition(3, "Premier League", { appearances: 20, goals: 6, ratedAppearances: 5, averageRating: 8, ratingCoverage: "partial" })],
          total: line({ appearances: 20 }),
        },
      ],
      friendlies: [],
      total: line({ appearances: 20 }),
    },
  ],
  career: line({ appearances: 32 }),
  careerFriendlies: line({}),
  honours: [],
  milestones: [],
};
const move = (patch: Partial<PlayerMove>): PlayerMove => ({
  kind: "transfer",
  date: "2026-07-01",
  dateEstimated: false,
  season: 2026,
  from: club(1),
  to: club(2),
  fee: 1_000_000,
  dealType: null,
  loanUntil: null,
  ...patch,
});
const squadMove = (patch: Partial<PlayerSquadMove>): PlayerSquadMove => ({
  kind: "callUp",
  date: "2026-10-03",
  season: 2026,
  from: club(1),
  fromGroup: "U17",
  to: club(1),
  toGroup: "U19",
  label: "Club 1 / U19",
  direction: "up",
  until: "2026-10-10",
  returnedOn: "2026-10-10",
  days: 7,
  ...patch,
});

describe("player history view helpers", () => {
  it("groups seasons by club and keeps the server totals until a filter is set", () => {
    const blocks = seasonBlocks(history);
    expect(blocks.map((block) => [block.season, block.clubs.map((entry) => [entry.club.id, entry.total.appearances]), block.friendlies.length, block.total.appearances])).toEqual([
      [2027, [[1, 99], [2, 2]], 1, 12],
      [2026, [[1, 20]], 0, 20],
    ]);
    expect(blockTotals(history, blocks, NO_STAT_FILTER)).toEqual({ competitive: history.career, friendlies: history.careerFriendlies });
  });

  it("filters by competition or club and recomputes subtotals from the shown lines", () => {
    const league = seasonBlocks(history, { competition: "3", club: ALL_CLUBS });
    expect(league.map((block) => [block.season, block.clubs.length, block.friendlies.length, block.total.appearances])).toEqual([
      [2027, 1, 0, 10],
      [2026, 1, 0, 20],
    ]);
    const totals = blockTotals(history, league, { competition: "3", club: ALL_CLUBS });
    // Goals add up over every appearance; the rating only over the rated ones (10 at 7, 5 at 8).
    expect(totals.competitive).toEqual({
      appearances: 30, minutes: 1800, goals: 8, assists: 2, ratedAppearances: 15, averageRating: 7.33, ratingCoverage: "partial",
    });
    expect(totals.friendlies).toBeNull();
    const friendlies = seasonBlocks(history, { competition: FRIENDLIES, club: ALL_CLUBS });
    expect(friendlies.map((block) => [block.season, block.clubs.length, block.friendlies.length, block.total.appearances])).toEqual([[2027, 0, 1, 0]]);
    expect(blockTotals(history, friendlies, { competition: FRIENDLIES, club: ALL_CLUBS }).friendlies).toMatchObject({ appearances: 10 });
    const clubTwo = seasonBlocks(history, { competition: ALL_COMPETITIONS, club: "2" });
    expect(clubTwo.map((block) => [block.season, block.clubs.map((entry) => entry.club.id)])).toEqual([[2027, [2]]]);
    expect(totalStatLine(clubTwo[0].clubs[0].lines)).toEqual({
      appearances: 2, minutes: 180, goals: 3, assists: 0, ratedAppearances: 0, averageRating: null, ratingCoverage: "none",
    });
  });

  it("sums every count across clubs, competitions and seasons and averages ratings over rated matches only", () => {
    const lines = [
      line({ appearances: 12, minutes: 1000, goals: 7, assists: 3, ratedAppearances: 12, averageRating: 7.5 }),
      // A season or spell without match rows (another club's finished season): counts, no rating.
      line({ appearances: 30, minutes: 2500, goals: 11, assists: 4, ratedAppearances: 0, averageRating: null, ratingCoverage: "none" }),
      line({ appearances: 4, minutes: 200, goals: 0, assists: 1, ratedAppearances: 2, averageRating: 6, ratingCoverage: "partial" }),
    ];
    expect(totalStatLine(lines)).toEqual({
      appearances: 46, minutes: 3700, goals: 18, assists: 8, ratedAppearances: 14, averageRating: 7.29, ratingCoverage: "partial",
    });
    expect(totalStatLine([])).toEqual({
      appearances: 0, minutes: 0, goals: 0, assists: 0, ratedAppearances: 0, averageRating: null, ratingCoverage: "none",
    });
    expect(ratingNote(totalStatLine(lines))).toBe("Rated in 14 of 46 appearances");
    expect(ratingNote(lines[1])).toBe(NO_RATING);
    expect(ratingNote(lines[0])).toBeUndefined();
    expect(ratingNote(totalStatLine([]))).toBeUndefined();
  });

  it("lists competitions (friendlies last) and clubs for the filters", () => {
    expect(historyCompetitions(history)).toEqual([
      { key: "9", label: "FA Cup" },
      { key: "3", label: "Premier League" },
      { key: FRIENDLIES, label: "Friendlies" },
    ]);
    expect(historyClubs(history).map((entry) => entry.id)).toEqual([1, 2]);
  });

  it("shows a fee only where one can apply", () => {
    expect(moveFee(move({}))).toEqual({ kind: "amount", value: 1_000_000 });
    expect(moveFee(move({ kind: "free", fee: 0 }))).toEqual({ kind: "none" });
    expect(moveFee(move({ fee: null }))).toEqual({ kind: "unrecorded" });
    expect(moveFee(move({ kind: "registration", fee: 0 }))).toEqual({ kind: "notApplicable" });
    expect(moveFee(move({ kind: "loanReturn", fee: null }))).toEqual({ kind: "notApplicable" });
  });

  it("describes squad movements with their direction and a call-up's length", () => {
    expect(squadMoveTitle(squadMove({}))).toBe("Called up to Club 1 / U19");
    expect(squadMovePeriod(squadMove({}))).toBe("3–10 Oct · 7 days");
    expect(squadMovePeriod(squadMove({ returnedOn: "2026-10-04", days: 1 }))).toBe("3–4 Oct · 1 day");
    expect(squadMovePeriod(squadMove({ returnedOn: "2026-10-03", days: 0 }))).toBe("3 Oct · same day");
    expect(squadMovePeriod(squadMove({ returnedOn: null, days: null }))).toBe("Since 3 Oct · until 10 Oct");
    expect(squadMoveTitle(squadMove({ kind: "callUp", direction: "down", label: null, to: club(5), toGroup: "Senior" }))).toBe("Sent down to Club 5");
    expect(squadMoveTitle(squadMove({ kind: "move", direction: "up", label: null, toGroup: "U19" }))).toBe("Promoted to Club 1 U19");
    expect(squadMoveTitle(squadMove({ kind: "registration", direction: "down", label: null, to: club(4), toGroup: null }))).toBe("Registered with Club 4");
    expect(squadMovePeriod(squadMove({ kind: "move" }))).toBe("3 Oct 2026");
    expect(squadName({ id: 1, name: "Spain U19", color: null }, "U19")).toBe("Spain U19");
  });

  it("summarises honours and reads milestones", () => {
    const honour = (title: string, ageGroup: string | null = null): PlayerHonour => ({
      season: 2026, kind: "league", title, club: club(1), competitionId: 3, ageGroup, appearances: 30, matches: 38, role: "regular",
    });
    expect(honourSummary([honour("Premier League"), honour("FA Cup"), honour("Premier League"), honour("Youth League", "U19")])).toEqual([
      { title: "Premier League", kind: "league", count: 2 },
      { title: "FA Cup", kind: "league", count: 1 },
      { title: "Youth League (U19)", kind: "league", count: 1 },
    ]);
    const milestone = (patch: Partial<PlayerMilestone>): PlayerMilestone => ({
      kind: "seniorDebut", value: null, date: "2026-08-10", dateEstimated: false, season: 2026, club: club(1), competition: "Premier League", fixtureId: 5, age: 17, ...patch,
    });
    expect(milestoneText(milestone({}))).toBe("Senior debut for Club 1");
    expect(milestoneText(milestone({ kind: "appearances", value: 100 }))).toBe("100th senior appearance");
    expect(milestoneText(milestone({ kind: "clubAppearances", value: 200 }))).toBe("200th appearance for Club 1");
    expect(milestoneText(milestone({ kind: "caps", value: 50, club: { id: 9, name: "Spain", color: null } }))).toBe("50th cap for Spain");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
  });

  it("labels competitions with their age group once and seasons as 2026/27", () => {
    expect(competitionLabel({ id: 4, name: "Premier League 2", ageGroup: "U21" })).toBe("Premier League 2 (U21)");
    expect(competitionLabel({ id: 5, name: "U19 League", ageGroup: "U19" })).toBe("U19 League");
    expect(seasonLabel(2026)).toBe("2026/27");
  });
});
