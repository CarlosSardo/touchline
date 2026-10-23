import { describe, expect, it } from "vitest";
import {
  goalsText,
  leaderLine,
  nextScorersLimit,
  rankLabel,
  SCORERS_MAX,
  SCORERS_STEP,
  scorersPath,
  teamHeading,
  teamSummary,
} from "./top-scorers.ts";
import type { CompetitionScorer, CompetitionScorerTeam } from "../shared/api.ts";

const team = (overrides: Partial<CompetitionScorerTeam> = {}): CompetitionScorerTeam => ({
  id: 1, name: "Harbour FC", color: "#123456", type: "club", goals: 3, appearances: 4, minutes: 300, ...overrides,
});
const scorer = (rank: number, goals: number, name = `Player ${rank}`): CompetitionScorer => ({
  rank, playerId: rank * 10 + goals, name, position: "ST", age: 24, nationality: "Scotland", countryCode: "SCO",
  goals, assists: 0, appearances: 5, minutes: 400, minutesPerGoal: Math.round(400 / goals), teams: [team()],
});

describe("top scorers", () => {
  it("requests the current season unless one is chosen", () => {
    expect(scorersPath(7, null, SCORERS_STEP)).toBe("competitions/7/scorers?limit=20");
    expect(scorersPath(7, 2025, 40)).toBe("competitions/7/scorers?limit=40&season=2025");
  });

  it("shows twenty more scorers until all of them, or the server maximum, are listed", () => {
    expect(nextScorersLimit(20, 20)).toBeNull();
    expect(nextScorersLimit(5, 5)).toBeNull();
    expect(nextScorersLimit(20, 33)).toBe(33);
    expect(nextScorersLimit(20, 90)).toBe(40);
    expect(nextScorersLimit(SCORERS_MAX - 10, 900)).toBe(SCORERS_MAX);
    expect(nextScorersLimit(SCORERS_MAX, 900)).toBeNull();
  });

  it("describes the Golden Boot leader's margin or a shared lead", () => {
    expect(leaderLine({ leaders: 1, scorers: [scorer(1, 9), scorer(2, 7, "Ann Next")] })).toBe("2 goals clear of Ann Next");
    expect(leaderLine({ leaders: 1, scorers: [scorer(1, 4), scorer(2, 3, "Ben Next")] })).toBe("1 goal clear of Ben Next");
    expect(leaderLine({ leaders: 3, scorers: [scorer(1, 5), scorer(1, 5), scorer(1, 5)] })).toBe("Level with 2 others on 5 goals");
    expect(leaderLine({ leaders: 2, scorers: [scorer(1, 1), scorer(1, 1)] })).toBe("Level with 1 other on 1 goal");
    expect(leaderLine({ leaders: 1, scorers: [scorer(1, 2)] })).toBe("The only scorer");
    expect(leaderLine({ leaders: 0, scorers: [] })).toBe("");
  });

  it("labels shared ranks as joint places", () => {
    const scorers = [scorer(1, 6), scorer(2, 5), scorer(2, 5), scorer(4, 3), scorer(11, 1), scorer(12, 1), scorer(13, 1), scorer(21, 1), scorer(22, 1)];
    expect(scorers.map((_, index) => rankLabel(scorers, index))).toEqual([
      "1st", "Joint 2nd", "Joint 2nd", "4th", "11th", "12th", "13th", "21st", "22nd",
    ]);
  });

  it("names the team column after the competition's teams and summarises each club of a moved player", () => {
    expect(teamHeading([scorer(1, 2)])).toBe("Club");
    expect(teamHeading([{ ...scorer(1, 2), teams: [team({ type: "national", name: "Scotland" })] }])).toBe("Team");
    expect(teamSummary(team())).toBe("Harbour FC: 3 goals in 4 apps, 300 min");
    expect(teamSummary(team({ goals: 1, appearances: 1, minutes: 90 }))).toBe("Harbour FC: 1 goal in 1 app, 90 min");
    expect(goalsText(0)).toBe("0 goals");
  });
});
