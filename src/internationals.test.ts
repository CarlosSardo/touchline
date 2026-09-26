import { describe, expect, it } from "vitest";
import {
  capSeasons,
  capsText,
  dutyByPlayer,
  dutyText,
  phaseText,
  phaseTone,
  tournamentsByAge,
} from "./internationals.ts";

const tournament = (id: string, ageGroup: "U17" | "U19" | "U20" | "U21", held: boolean, start: string, phase: string | null = null) => ({
  id,
  name: id,
  confederation: "UEFA",
  ageGroup,
  leagueId: held ? 1 : null,
  qualifyingLeagueId: null,
  held,
  edition: Number(start.slice(0, 4)),
  start,
  phase,
  championName: null,
});

describe("tournament display", () => {
  it("words phases and rest years", () => {
    expect(phaseText({ held: false, phase: "rest year" })).toBe("Not held this season");
    expect(phaseText({ held: true, phase: "awaiting qualifiers" })).toBe("Awaiting qualifiers");
    expect(phaseText({ held: true, phase: null })).toBe("Scheduled");
    expect(phaseTone({ held: true, phase: "knockout" })).toBe("blue");
    expect(phaseTone({ held: true, phase: "complete" })).toBe("green");
    expect(phaseTone({ held: false, phase: "rest year" })).toBe("neutral");
  });

  it("groups by age oldest first, held editions first, then by start", () => {
    const groups = tournamentsByAge([
      tournament("u17-euro", "U17", true, "2027-05-25"),
      tournament("u21-euro", "U21", false, "2027-06-12", "rest year"),
      tournament("u17-wc", "U17", true, "2026-11-19"),
      tournament("u19-euro", "U19", true, "2027-07-02"),
      tournament("afc-u17", "U17", false, "2027-04-03", "rest year"),
    ]);
    expect(groups.map((group) => [group.ageGroup, group.tournaments.map((entry) => entry.id)])).toEqual([
      ["U21", ["u21-euro"]],
      ["U19", ["u19-euro"]],
      ["U17", ["u17-wc", "u17-euro", "afc-u17"]],
    ]);
  });
});

describe("duty and caps", () => {
  const away = { playerId: 7, name: "A", teamId: 3, teamName: "England U19", competition: "UEFA U19", from: "2027-03-20", until: "2027-03-28", status: "selected" as const };
  it("maps club players and words the badge", () => {
    expect(dutyByPlayer([away]).get(7)).toBe(away);
    expect(dutyByPlayer(undefined).size).toBe(0);
    expect(dutyText(away)).toBe("England U19 · until 28 Mar");
    expect(dutyText({ ...away, status: "withheld" })).toBe("Kept back from England U19");
  });

  it("summarises caps", () => {
    expect(capsText({ appearances: 0, goals: 0 })).toBe("Uncapped");
    expect(capsText({ appearances: 1, goals: 0 })).toBe("1 cap");
    expect(capsText({ appearances: 12, goals: 1 })).toBe("12 caps · 1 goal");
    expect(capsText({ appearances: 12, goals: 3 })).toBe("12 caps · 3 goals");
    expect(capSeasons({ firstSeason: 2026, lastSeason: 2026 })).toBe("2026/27");
    expect(capSeasons({ firstSeason: 2025, lastSeason: 2027 })).toBe("2025/26–2027/28");
  });
});
