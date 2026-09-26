import { describe, expect, it } from "vitest";
import { leagueZones, zoneAt, zoneLegend } from "./table-zones.ts";

const championship = {
  closed: false,
  promotion: 3,
  relegation: 3,
  movementUp: { upper: 1, promoted: 2, relegated: 3, playoffs: [{ type: "promotion", positions: [3, 6], places: 1, legs: 2 }] },
  movementDown: { upper: 2, promoted: 3, relegated: 3, playoffs: [{ type: "promotion", positions: [4, 7], places: 1, legs: 2 }] },
};

describe("leagueZones", () => {
  it("reads promotion, play-off and relegation places from the league's boundaries", () => {
    const zones = leagueZones(championship);
    expect(zones).toEqual({ promoted: 2, promotionPlayoff: [3, 4, 5, 6], titlePlayoff: [], relegationPlayoff: [], relegated: 3 });
    expect([1, 2, 3, 6, 7, 21, 22, 24].map((position) => zoneAt(zones, position, 24))).toEqual([
      "promoted", "promoted", "promotion-playoff", "promotion-playoff", null, null, "relegated", "relegated",
    ]);
    expect(zoneLegend(zones, 24)).toEqual(["promoted", "promotion-playoff", "relegated"]);
  });

  it("marks a top flight's relegation play-off but invents no continental zone", () => {
    const bundesliga = {
      closed: false,
      movementUp: null,
      movementDown: { upper: 1, promoted: 2, relegated: 2, playoffs: [{ type: "cross-tier", upperPositions: [16], lowerPositions: [3], legs: 2 }] },
    };
    const zones = leagueZones(bundesliga);
    expect([1, 4, 15, 16, 17, 18].map((position) => zoneAt(zones, position, 18))).toEqual([
      null, null, null, "relegation-playoff", "relegated", "relegated",
    ]);
    expect(zoneAt(leagueZones({ ...bundesliga, movementDown: { upper: 1, promoted: 2, relegated: 2 } }), 2, 18)).toBeNull();
  });

  it("uses the lower tier's cross-tier challengers as promotion play-off places", () => {
    const zones = leagueZones({ movementUp: { upper: 1, promoted: 2, relegated: 2, playoffs: [{ type: "cross-tier", upperPositions: [16], lowerPositions: [3] }] }, movementDown: null });
    expect(zoneAt(zones, 3, 18)).toBe("promotion-playoff");
  });

  it("splits per-conference movement and shows title play-offs in closed leagues", () => {
    const mls = { closed: true, conferences: ["East", "West"], championship: { positions: [1, 9] }, movementUp: null, movementDown: null };
    const zones = leagueZones(mls);
    expect(zoneAt(zones, 9, 15)).toBe("title-playoff");
    expect(zoneAt(zones, 10, 15)).toBeNull();
    const national = leagueZones({ conferences: ["North", "South"], movementUp: { upper: 5, promoted: 2, relegated: 2, perConference: true }, movementDown: null });
    expect(zoneAt(national, 1, 24)).toBe("promoted");
    expect(zoneAt(national, 2, 24)).toBeNull();
  });

  it("falls back to legacy counts and shows nothing without rules", () => {
    expect(leagueZones({ promotion: 2, relegation: 3 })).toMatchObject({ promoted: 2, relegated: 3 });
    expect(leagueZones({ phase: "groups" })).toBeNull();
    expect(leagueZones(null)).toBeNull();
    expect(zoneAt(null, 1, 20)).toBeNull();
    expect(zoneLegend(null, 20)).toEqual([]);
  });

  it("applies split-league offsets through the caller's position", () => {
    const zones = leagueZones({ movementUp: null, movementDown: { upper: 1, promoted: 1, relegated: 1 } });
    // Relegation round covers overall places 7–12: its 6th row is 12th of 12.
    expect(zoneAt(zones, 6 + 6, 12)).toBe("relegated");
    expect(zoneAt(zones, 6 + 5, 12)).toBeNull();
  });
});
