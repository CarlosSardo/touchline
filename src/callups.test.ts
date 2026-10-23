import { describe, expect, it } from "vitest";
import {
  buildDuration,
  callUpBadge,
  callUpsByTeam,
  dateRange,
  debutText,
  developmentStatusText,
  moveTargets,
  shortTeamLabel,
  untilText,
} from "./callups.ts";

const teams = [
  { clubId: 1, ageGroup: "Senior" as const, label: "Harbour / First team", level: "Senior" as const },
  { clubId: 2, ageGroup: "Senior" as const, label: "Harbour B / Reserve team", level: "BTeam" as const },
  { clubId: 1, ageGroup: "U19" as const, label: "Harbour / U19", level: "U19" as const },
  { clubId: 1, ageGroup: "U17" as const, label: "Harbour / U17", level: "U17" as const },
];
const destination = (clubId: number, ageGroup: "Senior" | "U19" | "U17", extra: Partial<{ eligible: boolean; reason: string | null; current: boolean }> = {}) => ({
  clubId,
  ageGroup,
  label: teams.find((team) => team.clubId === clubId && team.ageGroup === ageGroup)!.label,
  eligible: true,
  reason: null,
  current: false,
  ...extra,
});

describe("call-up dates", () => {
  it("formats ranges compactly", () => {
    expect(dateRange("2026-10-03", "2026-10-10")).toBe("3–10 Oct");
    expect(dateRange("2026-10-28", "2026-11-04")).toBe("28 Oct – 4 Nov");
    expect(dateRange("2026-12-28", "2027-01-04")).toBe("28 Dec 2026 – 4 Jan 2027");
    expect(dateRange("2026-10-03", "2026-10-03")).toBe("3 Oct");
  });

  it("describes when a call-up ends", () => {
    expect(untilText({ duration: "match", until: "2026-10-03" }, "2026-10-01")).toBe("Next match · 3 Oct");
    expect(untilText({ duration: "until", until: "2026-10-10" }, "2026-10-06")).toBe("Until 10 Oct · 4 days left");
    expect(untilText({ duration: "until", until: "2026-10-07" }, "2026-10-06")).toBe("Until 7 Oct · 1 day left");
    expect(untilText({ duration: "until", until: "2026-10-06" }, "2026-10-06")).toBe("Until 6 Oct · last day");
  });
});

describe("buildDuration", () => {
  const today = "2026-10-01";
  it("passes match and permanent through", () => {
    expect(buildDuration("match", { days: 0, date: "" }, today)).toEqual({ duration: { kind: "match" } });
    expect(buildDuration("permanent", { days: 0, date: "" }, today)).toEqual({ duration: { kind: "permanent" } });
  });
  it("bounds days to 1..120", () => {
    expect(buildDuration("days", { days: 7, date: "" }, today)).toEqual({ duration: { kind: "days", days: 7 } });
    expect(buildDuration("days", { days: 0, date: "" }, today)).toHaveProperty("error");
    expect(buildDuration("days", { days: 121, date: "" }, today)).toHaveProperty("error");
    expect(buildDuration("days", { days: 2.5, date: "" }, today)).toHaveProperty("error");
  });
  it("needs an end date after today and within 120 days", () => {
    expect(buildDuration("until", { days: 0, date: "2026-10-15" }, today)).toEqual({
      duration: { kind: "until", date: "2026-10-15" },
    });
    expect(buildDuration("until", { days: 0, date: "2026-10-01" }, today)).toEqual({
      error: "The end date must be after today.",
    });
    expect(buildDuration("until", { days: 0, date: "2027-03-01" }, today)).toHaveProperty("error");
    expect(buildDuration("until", { days: 0, date: "" }, today)).toEqual({ error: "Choose an end date." });
  });
});

describe("moveTargets", () => {
  it("orders targets most senior first and marks the direction", () => {
    const targets = moveTargets(
      [destination(1, "Senior"), destination(2, "Senior", { eligible: false, reason: "Full" }), destination(1, "U19", { current: true }), destination(1, "U17")],
      teams,
      null,
    );
    expect(targets.map((target) => [target.label, target.direction, target.eligible])).toEqual([
      ["Harbour / First team", "up", true],
      ["Harbour B / Reserve team", "up", false],
      ["Harbour / U17", "down", true],
    ]);
  });

  it("marks the original team of an active call-up as the way back", () => {
    const targets = moveTargets(
      [destination(1, "Senior", { current: true }), destination(1, "U19")],
      teams,
      { from: { clubId: 1, ageGroup: "U19" } },
    );
    expect(targets).toEqual([expect.objectContaining({ label: "Harbour / U19", direction: "back" })]);
  });
});

describe("desk helpers", () => {
  it("groups active call-ups by the team the player now plays for", () => {
    const active = [
      { playerId: 5, to: { clubId: 1, ageGroup: "U19" as const } },
      { playerId: 6, to: { clubId: 1, ageGroup: "Senior" as const } },
    ];
    const groups = callUpsByTeam({ teams, active: active as never });
    expect(groups.map((group) => group.callUps.map((entry) => entry.playerId))).toEqual([[6], [], [5], []]);
  });

  it("labels debut budgets", () => {
    const budget = { clubId: 1, clubName: "Harbour", used: 1, limit: 2 };
    expect(debutText(budget, false)).toBe("Debuts this season: 1 / 2");
    expect(debutText(budget, true)).toBe("Harbour debuts: 1 / 2");
    expect(debutText({ ...budget, used: 2, played: 1 }, false)).toBe("Debuts this season: 1 played · 1 pending / 2");
    expect(debutText({ ...budget, used: 1, played: 1 }, true)).toBe("Harbour debuts: 1 played / 2");
    expect(debutText({ ...budget, used: 1, played: 0 }, false)).toBe("Debuts this season: 0 played · 1 pending / 2");
    expect(developmentStatusText({ since: "2026-10-01" })).toBe(
      "Requested 1 Oct · waiting for the coach's next review.",
    );
    expect(
      developmentStatusText({ since: "2026-10-01", status: "First team: 3 fitter options at LW.", checked: "2026-10-03" }),
    ).toBe("Coach, 3 Oct: First team: 3 fitter options at LW.");
    expect(shortTeamLabel("Harbour / U19")).toBe("U19");
    expect(callUpBadge({ fromLabel: "Harbour / U17", duration: "match", until: "2026-10-03" }, "2026-10-01")).toBe(
      "From U17 · Next match · 3 Oct",
    );
  });
});
