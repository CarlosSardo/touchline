import { describe, expect, it } from "vitest";
import type { PlayerCompetitionStats, PlayerHistory, PlayerMove, PlayerStatLine } from "../shared/api.ts";
import {
  ALL_COMPETITIONS,
  competitionLabel,
  historyCompetitions,
  moveFee,
  seasonLabel,
  seasonRows,
  totalStatLine,
} from "./player-history.ts";

const club = (id: number) => ({ id, name: `Club ${id}`, color: null });
const line = (patch: Partial<PlayerStatLine>): PlayerStatLine => ({
  appearances: 10,
  minutes: 900,
  recordedAppearances: 10,
  goals: 2,
  assists: 1,
  averageRating: 7,
  coverage: "full",
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
  moves: [],
  movesTruncated: false,
  seasons: [
    {
      season: 2027,
      competitions: [
        competition(3, "Premier League"),
        competition(null, "Friendlies", { averageRating: 6 }),
        competition(9, "FA Cup", { appearances: 2, recordedAppearances: 0, goals: null, assists: null, averageRating: null, coverage: "none" }, 2),
      ],
      total: line({}),
    },
    {
      season: 2026,
      competitions: [competition(3, "Premier League", { appearances: 20, recordedAppearances: 5, averageRating: 8, coverage: "partial" })],
      total: line({}),
    },
  ],
  career: line({}),
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
  ageGroup: null,
  ...patch,
});

describe("player history view helpers", () => {
  it("flattens every season line and filters one competition", () => {
    expect(seasonRows(history).map((row) => row.key)).toEqual([
      "2027:1:3",
      "2027:1:friendlies",
      "2027:2:9",
      "2026:1:3",
    ]);
    expect(seasonRows(history, "3").map((row) => row.season)).toEqual([2027, 2026]);
    expect(seasonRows(history, "friendlies")).toHaveLength(1);
    expect(seasonRows(history, ALL_COMPETITIONS)).toHaveLength(4);
  });

  it("lists competitions once, alphabetically, friendlies last", () => {
    expect(historyCompetitions(history)).toEqual([
      { key: "9", label: "FA Cup" },
      { key: "3", label: "Premier League" },
      { key: "friendlies", label: "Friendlies" },
    ]);
  });

  it("totals goals and ratings only over recorded appearances", () => {
    const total = totalStatLine(seasonRows(history, "3"));
    expect(total).toMatchObject({ appearances: 30, minutes: 1800, recordedAppearances: 15, goals: 4, assists: 2, coverage: "partial" });
    expect(total.averageRating).toBeCloseTo((7 * 10 + 8 * 5) / 15, 2);
    expect(totalStatLine(seasonRows(history, "9"))).toMatchObject({ goals: null, assists: null, averageRating: null, coverage: "none" });
  });

  it("describes fees without inventing them", () => {
    expect(moveFee(move({}))).toEqual({ kind: "amount", value: 1_000_000 });
    expect(moveFee(move({ kind: "free", fee: 0 }))).toEqual({ kind: "none" });
    expect(moveFee(move({ fee: null }))).toEqual({ kind: "unrecorded" });
    expect(moveFee(move({ kind: "squad", fee: 0 }))).toEqual({ kind: "notApplicable" });
    expect(moveFee(move({ kind: "loanReturn", fee: null }))).toEqual({ kind: "notApplicable" });
  });

  it("labels youth competitions and seasons", () => {
    expect(competitionLabel({ id: 4, name: "Premier League 2", ageGroup: "U21" })).toBe("Premier League 2 (U21)");
    expect(competitionLabel({ id: 5, name: "U19 League", ageGroup: "U19" })).toBe("U19 League");
    expect(seasonLabel(2026)).toBe("2026/27");
  });
});
