import { describe, expect, it } from "vitest";
import {
  academyDebut,
  aiLineupCallUps,
  aiMeritChance,
  aiNeedsLower,
  bTeamIneligible,
  callUpDue,
  callUpUntil,
  coachCallUpPlan,
  coachCallUps,
  debutBudget,
  debutStanding,
  levelOf,
  lineOf,
  lowerTeam,
  matchdayNeeds,
  meritChance,
  minSeniorAge,
  positionSettled,
  prospectFloorPick,
  restCutoff,
  unavailableReason,
  usedDebuts,
  type CoachCandidate,
  type CoachContext,
} from "./callups.ts";
import { minorMayJoin } from "./youth.ts";
import { peopleContext } from "./people.ts";
import { clubRegistration } from "./registration.ts";
import { simulateMatch } from "./match.ts";
import { callUpBandMisses, callUpSeasonProbe, type ProbeFamily, type ProbePlayer } from "./callup-probe.ts";
import { CALL_UP_RULES, debutSubAllowed } from "../shared/features/callups.ts";
import type { Country, MatchPlayer, MatchTeam, PlayerProfile, Position } from "../shared/types.ts";

// A full matchday squad: 2 GK, 6 DEF, 5 MID, 4 ATT at the given ability.
const squadOf = (ability: number, drop: Partial<Record<"GK" | "DEF" | "MID" | "ATT", number>> = {}) => {
  const lines: [Position, number][] = [
    ["GK", 2 - (drop.GK ?? 0)],
    ["CB", 6 - (drop.DEF ?? 0)],
    ["CM", 5 - (drop.MID ?? 0)],
    ["ST", 4 - (drop.ATT ?? 0)],
  ];
  return lines.flatMap(([position, count]) => Array.from({ length: count }, () => ({ position, ability })));
};

const candidate = (overrides: Partial<CoachCandidate> & Pick<CoachCandidate, "id">): CoachCandidate => ({
  position: "CB",
  ability: 50,
  potential: 60,
  age: 18,
  form: 7,
  sourceRank: 0,
  debut: false,
  ...overrides,
});

const context = (overrides: Partial<CoachContext> = {}): CoachContext => ({
  level: "Senior",
  available: squadOf(70),
  squad: squadOf(70),
  candidates: [],
  endOfSeason: false,
  deadRubber: false,
  congestion: false,
  debuts: { used: 0, limit: 2 },
  room: 10,
  random: () => 0,
  ...overrides,
});

describe("coach call-ups: need", () => {
  it("covers a thin line with the best player of the most senior source, for the next match only", () => {
    const decisions = coachCallUps(
      context({
        available: squadOf(70, { DEF: 2 }),
        candidates: [
          candidate({ id: 1, sourceRank: 1, ability: 64 }),
          candidate({ id: 2, sourceRank: 0, ability: 58 }),
          candidate({ id: 3, sourceRank: 0, ability: 61 }),
        ],
      }),
    );
    expect(decisions.map((entry) => [entry.playerId, entry.reason, entry.duration])).toEqual([
      [3, "need", "match"],
      [2, "need", "match"],
    ]);
  });

  it("calls up no more than the per-fixture need cap and never past the squad cap", () => {
    const candidates = Array.from({ length: 8 }, (_, index) => candidate({ id: index + 1, ability: 40 }));
    const short = context({ available: squadOf(70, { DEF: 6 }), candidates });
    expect(coachCallUps(short)).toHaveLength(CALL_UP_RULES.maxNeedPerFixture);
    expect(coachCallUps({ ...short, room: 1 })).toHaveLength(1);
  });

  it("adds outfield cover in congested weeks", () => {
    expect(matchdayNeeds(true)).toEqual({ GK: 2, DEF: 7, MID: 6, ATT: 5 });
    const decisions = coachCallUps(
      context({ congestion: true, candidates: [candidate({ id: 1, position: "ST", ability: 30 })] }),
    );
    expect(decisions.map((entry) => [entry.playerId, entry.line])).toEqual([[1, "ATT"]]);
  });

  it("prefers players who already debuted; a debutant needs debut budget unless no goalkeeper is left", () => {
    const debutants = [candidate({ id: 1, debut: true }), candidate({ id: 2, position: "GK", debut: true })];
    expect(
      coachCallUps(context({ available: squadOf(70, { DEF: 1 }), candidates: debutants, debuts: { used: 2, limit: 2 } })),
    ).toEqual([]);
    const noKeeper = coachCallUps(
      context({ available: squadOf(70, { GK: 2 }), candidates: debutants, debuts: { used: 2, limit: 2 } }),
    );
    expect(noKeeper.map((entry) => entry.playerId)).toEqual([2]);
    const mixed = coachCallUps(
      context({
        available: squadOf(70, { DEF: 1 }),
        candidates: [candidate({ id: 1, debut: true, ability: 66 }), candidate({ id: 3, debut: false, ability: 52 })],
        // No merit roll: only need decides here.
        random: () => 0.99,
      }),
    );
    expect(mixed.map((entry) => entry.playerId)).toEqual([3]);
  });
});

describe("coach call-ups: merit", () => {
  it("ignores candidates who are not clearly better than the incumbents", () => {
    expect(coachCallUps(context({ candidates: [candidate({ id: 1, ability: 72, age: 20 })] }))).toEqual([]);
  });

  it("calls up a player clearly above the line median who is in form; a clear edge earns a period, otherwise one match", () => {
    const strong = candidate({ id: 1, ability: 75, age: 20 });
    const decisions = coachCallUps(context({ candidates: [strong] }));
    expect(decisions).toEqual([{ playerId: 1, reason: "merit", duration: "match", debut: false, line: "DEF" }]);
    expect(coachCallUps(context({ candidates: [{ ...strong, ability: 80 }] }))[0].duration).toBe("until");
    expect(coachCallUps(context({ candidates: [{ ...strong, form: 6.5 }] }))).toEqual([]);
    expect(coachCallUps(context({ candidates: [strong], random: () => 0.99 }))).toEqual([]);
  });

  it("measures merit against the player's own line", () => {
    const squad = [...squadOf(60).filter((player) => player.position !== "ST"), ...Array(4).fill({ position: "ST", ability: 80 })];
    const striker = candidate({ id: 1, position: "ST", ability: 75, age: 20 });
    const defender = candidate({ id: 2, position: "CB", ability: 65, age: 20 });
    expect(coachCallUps(context({ squad, available: squad, candidates: [striker, defender] })).map((entry) => entry.playerId)).toEqual([2]);
  });

  it("gives first-team debuts within the season budget, on Fact Checker's gate (90% of the weakest at the line)", () => {
    const prospect = candidate({ id: 1, ability: 64, potential: 82, age: 17, debut: true });
    expect(coachCallUps(context({ candidates: [prospect] })).map((entry) => [entry.debut, entry.duration])).toEqual([[true, "match"]]);
    expect(coachCallUps(context({ candidates: [prospect], debuts: { used: 2, limit: 2 } }))).toEqual([]);
    expect(coachCallUps(context({ candidates: [{ ...prospect, ability: 62 }] }))).toEqual([]);
    // A B-team senior who already played for the first team is not a debut: he needs the median margin, not budget.
    expect(coachCallUps(context({ candidates: [{ ...prospect, debut: false }] }))).toEqual([]);
    expect(coachCallUps(context({ candidates: [{ ...prospect, ability: 76, debut: false }], debuts: { used: 2, limit: 2 } }))).toHaveLength(1);
  });

  it("caps merit call-ups per fixture and respects the association's senior age floor", () => {
    const strong = [candidate({ id: 1, ability: 80, age: 20 }), candidate({ id: 2, ability: 79, age: 20 })];
    expect(coachCallUps(context({ candidates: strong }))).toHaveLength(CALL_UP_RULES.merit.perFixture.Senior);
    const fifteen = candidate({ id: 3, ability: 90, age: 15 });
    expect(coachCallUps(context({ candidates: [fifteen] }))).toEqual([]);
    expect(coachCallUps(context({ candidates: [fifteen], minAge: minSeniorAge("DE") }))).toEqual([]);
    expect(coachCallUps(context({ candidates: [fifteen], minAge: minSeniorAge("EN") })).map((entry) => entry.playerId)).toEqual([3]);
    // Need never fills a line with a player under the floor either.
    expect(coachCallUps(context({ available: squadOf(70, { DEF: 1 }), candidates: [{ ...fifteen, ability: 40 }] }))).toEqual([]);
  });
});

describe("coach call-ups: end of season", () => {
  const u19 = context({ level: "U19", squad: squadOf(55), available: squadOf(55) });
  const u17 = [candidate({ id: 1, ability: 55, age: 16, form: 6.4 }), candidate({ id: 2, ability: 54, age: 16 }), candidate({ id: 3, ability: 53, age: 15 })];

  it("youth teams call up more freely in the last rounds, capped per fixture", () => {
    expect(coachCallUps({ ...u19, candidates: u17 })).toEqual([]);
    const late = coachCallUps({ ...u19, candidates: u17, endOfSeason: true });
    expect(late.map((entry) => [entry.playerId, entry.reason, entry.duration])).toEqual([
      [1, "end-of-season", "until"],
      [2, "end-of-season", "until"],
    ]);
    expect(late).toHaveLength(CALL_UP_RULES.endOfSeason.perFixture.U19);
  });

  it("the first team relaxes only in dead rubbers", () => {
    const player = candidate({ id: 1, ability: 71, potential: 80, age: 18, form: 6.5 });
    const late = context({ candidates: [player], endOfSeason: true });
    expect(coachCallUps(late)).toEqual([]);
    const deadRubber = coachCallUps({ ...late, deadRubber: true });
    expect(deadRubber.map((entry) => [entry.reason, entry.duration])).toEqual([["end-of-season", "until"]]);
  });
});

describe("call-up chances (Fact Checker multipliers)", () => {
  const base = { level: "U19" as const, endOfSeason: false, deadRubber: false };

  it("multiplies the base chance for the last rounds, the final round, finished youth leagues, cups and requests", () => {
    const chance = CALL_UP_RULES.merit.chance.U19;
    expect(meritChance(base)).toBeCloseTo(chance);
    expect(meritChance({ ...base, endOfSeason: true })).toBeCloseTo(chance * 2.5);
    expect(meritChance({ ...base, endOfSeason: true, finalRound: true })).toBeCloseTo(chance * 3);
    expect(meritChance({ ...base, youthSeasonOver: true })).toBeCloseTo(chance * 1.5);
    expect(meritChance({ ...base, level: "BTeam", youthSeasonOver: true })).toBeCloseTo(CALL_UP_RULES.merit.chance.BTeam * 2);
    expect(meritChance({ ...base, cupVsLower: true })).toBeCloseTo(chance * 1.5);
    expect(meritChance({ ...base, strongAcademy: true })).toBeCloseTo(chance * CALL_UP_RULES.strongAcademyMult.U19);
    expect(meritChance(base, true)).toBeCloseTo(chance * CALL_UP_RULES.development.mult);
    expect(meritChance({ ...base, level: "BTeam", endOfSeason: true, finalRound: true }, true)).toBe(CALL_UP_RULES.maxChance);
  });

  it("lifts the first team's end-of-season chance only when its position is settled, more at poorer clubs", () => {
    const senior = { ...base, level: "Senior" as const, endOfSeason: true };
    expect(meritChance(senior)).toBeCloseTo(CALL_UP_RULES.merit.chance.Senior);
    expect(meritChance({ ...senior, deadRubber: true })).toBeCloseTo(CALL_UP_RULES.merit.chance.Senior * 2.5);
    expect(meritChance({ ...senior, endOfSeason: false, standing: "lower" })).toBeCloseTo(
      CALL_UP_RULES.merit.chance.Senior * CALL_UP_RULES.standingMult.lower,
    );
  });
});

describe("development requests and the academy-prospect floor", () => {
  it("a requested player gets the relaxed gate, a higher chance and the development flag", () => {
    const youngster = candidate({ id: 1, ability: 64, age: 18, requested: true });
    const plan = coachCallUpPlan(context({ candidates: [youngster], random: () => 0.3 }));
    expect(plan.decisions).toEqual([{ playerId: 1, reason: "merit", duration: "match", debut: false, line: "DEF", development: true }]);
    expect(coachCallUps(context({ candidates: [{ ...youngster, requested: false }], random: () => 0.3 }))).toEqual([]);
  });

  it("explains why a requested player is not called up", () => {
    const reason = (overrides: Partial<CoachCandidate>, extra: Partial<CoachContext> = {}) =>
      coachCallUpPlan(context({ candidates: [candidate({ id: 1, requested: true, ...overrides })], ...extra })).reasons.get(1);
    const wingers = [...squadOf(70), ...Array.from({ length: 3 }, () => ({ position: "LW" as Position, ability: 70 }))];
    expect(reason({ ability: 55, position: "LW" }, { available: wingers, squad: wingers })).toBe("3 better options at LW.");
    expect(reason({ ability: 75, form: 6.2 })).toBe("Form 6.2 is below the 6.9 the coach wants.");
    expect(reason({ ability: 75, debut: true }, { debuts: { used: 2, limit: 2 } })).toBe("The first-team debut budget for this season is used up.");
    expect(reason({ ability: 75 }, { random: () => 0.99 })).toMatch(/kept faith/);
    expect(reason({ ability: 75, age: 15 })).toBe("Too young for first-team football (15; minimum 16).");
    expect(reason({ ability: 75 }, { merit: false })).toMatch(/settled this squad/);
    expect(coachCallUpPlan(context({ candidates: [candidate({ id: 1, ability: 55 })] })).reasons.size).toBe(0);
  });

  it("explains a requested player the query left out", () => {
    expect(unavailableReason({ id: 1, fitness: 90, injury_until: "2027-03-10" }, "2027-03-01", new Set())).toBe("Injured until 2027-03-10.");
    expect(unavailableReason({ id: 1, fitness: 60, injury_until: null }, "2027-03-01", new Set())).toMatch(/Fitness 60/);
    expect(unavailableReason({ id: 1, fitness: 90, injury_until: null }, "2027-03-01", new Set([1]))).toMatch(/Already on a call-up/);
  });

  it("guarantees tier 1-2 top prospects one late-season bench call-up", () => {
    const prospects = [candidate({ id: 1, topProspect: true, age: 17 }), candidate({ id: 2, topProspect: true, age: 17 })];
    const pick = (overrides: Partial<Parameters<typeof prospectFloorPick>[0]> = {}) =>
      prospectFloorPick({ tier: 1, remaining: 6, candidates: prospects, calledThisSeason: () => false, minAge: 16, ...overrides })?.id;
    expect(pick()).toBe(1);
    expect(pick({ calledThisSeason: (id) => id === 1 })).toBe(2);
    expect(pick({ remaining: 7 })).toBeUndefined();
    expect(pick({ tier: 3 })).toBeUndefined();
    expect(pick({ minAge: 18 })).toBeUndefined();
  });
});

describe("debut context in the full engine", () => {
  it("lets a gated debutant on late: leading by two, or in an open game; never while held", () => {
    expect(debutSubAllowed("lead", 74, 3)).toBe(false);
    expect(debutSubAllowed("lead", 82, 2)).toBe(true);
    expect(debutSubAllowed("lead", 82, 1)).toBe(false);
    expect(debutSubAllowed("open", 82, -1)).toBe(true);
    expect(debutSubAllowed("hold", 90, 5)).toBe(false);
  });

  const positions: Position[] = ["GK", "RB", "CB", "CB", "LB", "DM", "CM", "CM", "LW", "ST", "RW"];
  const side = (id: number, ability: number, bench: MatchPlayer[] = []): MatchTeam => ({
    id,
    name: `Club ${id}`,
    color: "#087f6d",
    ability,
    style: "Possession",
    formation: "4-3-3",
    chemistry: 70,
    momentum: 0,
    pressure: 30,
    lineup: positions.map((position, index) => ({ id: id * 100 + index, name: `P${id}-${index}`, position, ability, fitness: 95, confidence: 70 })),
    bench,
    setPieces: { routine: "Near post", target: "Centre-back", risk: 50 },
  });
  const benchOf = (gate?: "lead" | "open" | "hold"): MatchPlayer[] => [
    ...(["GK", "CB", "CM", "ST", "LW"] as Position[]).map((position, index) => ({
      id: 150 + index,
      name: `S${index}`,
      position,
      ability: 60,
      fitness: 95,
      confidence: 70,
    })),
    { id: 199, name: "Debutant", position: "CM", ability: 90, fitness: 99, confidence: 70, ...(gate ? { callUpDebut: gate } : {}) },
  ];
  const entries = (gate?: "lead" | "open" | "hold") =>
    Array.from({ length: 30 }, (_, index) => {
      const result = simulateMatch(
        { rulesVersion: 3, home: side(1, 85, benchOf(gate)), away: side(2, 55), weather: "Clear", importance: 65, detail: "full" },
        `debut-${index}`,
      );
      const on = result.substitutions?.find((change) => change.onId === 199);
      if (!on) return undefined;
      const goals = (teamId: number) =>
        result.events.filter((event) => event.type === "goal" && event.teamId === teamId && (event.elapsed ?? 0) < on.elapsed).length;
      return { minute: on.minute, lead: goals(1) - goals(2) };
    }).filter((entry) => entry !== undefined);

  it("keeps a gated debutant on the bench until a late, comfortable moment", () => {
    // Without a gate the 90-rated bench player is the first substitute on.
    expect(entries().some((entry) => entry.minute < CALL_UP_RULES.debutMatch.subMinute)).toBe(true);
    const lead = entries("lead");
    expect(lead.length).toBeGreaterThan(0);
    expect(lead.every((entry) => entry.minute >= CALL_UP_RULES.debutMatch.subMinute && entry.lead >= CALL_UP_RULES.debutMatch.leadBy)).toBe(true);
    const open = entries("open");
    expect(open.length).toBeGreaterThanOrEqual(lead.length);
    expect(open.every((entry) => entry.minute >= CALL_UP_RULES.debutMatch.subMinute)).toBe(true);
    expect(entries("hold")).toEqual([]);
  });
});

describe("call-up season probe (pure)", () => {
  const lines: Position[] = ["GK", "GK", "CB", "CB", "CB", "LB", "RB", "DM", "CM", "CM", "AM", "LW", "RW", "ST", "ST"];
  const squad = (start: number, size: number, ability: number, age: number): ProbePlayer[] =>
    Array.from({ length: size }, (_, index) => ({
      id: start + index,
      position: lines[index % lines.length],
      ability: ability + (index % 7) - 3,
      potential: ability + 8,
      age,
    }));
  const families: ProbeFamily[] = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    tier: 1 + (index % 3),
    standing: (["elite", "second", "lower"] as const)[index % 3],
    academy: index % 2 ? 85 : 50,
    philosophy: "Win now",
    code: "EN",
    first: squad(index * 1000, 25, 70, 26),
    bteam: index % 3 === 0 ? squad(index * 1000 + 100, 22, 60, 20) : undefined,
    u19: squad(index * 1000 + 200, 22, 58, 18),
    u17: squad(index * 1000 + 300, 22, 50, 16),
  }));

  it("never exceeds a club's debut budget (plus the crisis bonus) and is deterministic", () => {
    const probe = callUpSeasonProbe(families);
    expect(probe.clubs).toBe(12);
    expect(probe.overBudgetClubs).toBe(0);
    for (const standing of ["elite", "second", "lower"] as const)
      expect(probe.byStanding[standing].maxDebuts).toBeLessThanOrEqual(CALL_UP_RULES.debutBudget.max[standing] + 2);
    expect(Array.isArray(callUpBandMisses(probe))).toBe(true);
    expect(callUpSeasonProbe(families)).toEqual(probe);
  });
});

describe("call-up rules", () => {
  it("sizes the debut budget by club standing (Fact Checker bands), academy, and injury crisis", () => {
    const plain = { academy: 40, philosophy: "Win now" };
    const academy = { academy: 85, philosophy: "Win now" };
    expect(debutBudget(plain, "elite")).toBe(2);
    expect(debutBudget(academy, "elite")).toBe(3);
    expect(debutBudget(plain, "mid")).toBe(2);
    expect(debutBudget(plain, "bottom")).toBe(3);
    expect(debutBudget(academy, "second")).toBe(3);
    expect(debutBudget(plain, "lower")).toBe(3);
    expect(debutBudget({ academy: 85, philosophy: "Develop and sell" }, "lower")).toBe(4);
    expect(debutBudget(plain, "elite", 15)).toBe(3);
    expect(debutBudget(plain, "elite", 12)).toBe(4);
    expect(debutBudget(plain, "elite", 16)).toBe(2);
  });

  it("places clubs by tier and reputation rank", () => {
    expect(debutStanding(1, 0, 20)).toBe("elite");
    expect(debutStanding(1, 8, 20)).toBe("mid");
    expect(debutStanding(1, 15, 20)).toBe("bottom");
    expect(debutStanding(2, 0, 24)).toBe("second");
    expect(debutStanding(4, 0, 24)).toBe("lower");
    expect(debutStanding(null, 0, 0)).toBe("lower");
  });

  it("counts played debuts and running debut call-ups against the budget", () => {
    const to = { clubId: 5, ageGroup: "Senior" as const };
    expect(usedDebuts({ debuts: { 5: 1 }, active: [{ debut: true, to }, { to }, { debut: true, to: { clubId: 5, ageGroup: "U19" } }] }, 5)).toBe(2);
  });

  it("treats only an academy-age player's first senior first-team games as a debut", () => {
    expect(academyDebut(17, 0)).toBe(true);
    expect(academyDebut(CALL_UP_RULES.debutMaxAge, 0)).toBe(true);
    expect(academyDebut(CALL_UP_RULES.debutMaxAge + 1, 0)).toBe(false);
    expect(academyDebut(19, 1)).toBe(false);
  });

  it("rules out candidates who played on the rest day before (and today)", () => {
    expect(CALL_UP_RULES.restDays).toBe(1);
    expect(restCutoff("2027-03-01")).toBe("2027-02-28");
  });

  it("applies the association's senior age floor and Italy's second-team appearance bar", () => {
    expect(["EN", "ES", "DE", "IT", "NL", undefined].map((code) => minSeniorAge(code))).toEqual([15, 15, 16, 16, 16, 16]);
    expect(bTeamIneligible("IT", 51)).toMatch(/more than 50 top-flight appearances \(51\)/);
    expect(bTeamIneligible("IT", 50)).toBeNull();
    expect(bTeamIneligible("ES", 200)).toBeNull();
  });

  it("maps positions to lines", () => {
    expect((["GK", "LB", "DM", "AM", "LW", "ST"] as Position[]).map(lineOf)).toEqual(["GK", "DEF", "MID", "MID", "ATT", "ATT"]);
  });

  it("recognises a settled league position", () => {
    const table = [
      { club_id: 1, points: 80, played: 34 },
      { club_id: 2, points: 60, played: 34 },
      { club_id: 3, points: 40, played: 34 },
      { club_id: 4, points: 38, played: 34 },
    ];
    expect(positionSettled(table, 2, 4)).toBe(true);
    expect(positionSettled(table, 3, 4)).toBe(false);
    expect(positionSettled(table, 1, 4)).toBe(true);
    expect(positionSettled(table, 9, 4)).toBe(false);
  });

  it("ends a single-match call-up once the fixture is played, a period after its last day", () => {
    expect(callUpDue({ duration: "match", until: "2027-03-05" }, "2027-03-05", true)).toBe(false);
    expect(callUpDue({ duration: "match", until: "2027-03-05" }, "2027-03-06", false)).toBe(true);
    expect(callUpDue({ duration: "match", until: "2027-03-05" }, "2027-03-13", true)).toBe(true);
    expect(callUpDue({ duration: "until", until: "2027-03-20" }, "2027-03-20", undefined)).toBe(false);
    expect(callUpDue({ duration: "until", until: "2027-03-20" }, "2027-03-21", undefined)).toBe(true);
  });

  it("bounds temporary call-ups", () => {
    expect(callUpUntil({ kind: "days", days: 10 }, "2027-03-01")).toBe("2027-03-11");
    expect(callUpUntil({ kind: "until", date: "2027-04-01" }, "2027-03-01")).toBe("2027-04-01");
    expect(() => callUpUntil({ kind: "until", date: "2027-03-01" }, "2027-03-01")).toThrow(/after today/);
    expect(() => callUpUntil({ kind: "days", days: 200 }, "2027-03-01")).toThrow(/at most/);
  });

  it("finds the team below each level", () => {
    expect(levelOf({ type: "club" }, "Senior")).toBe("Senior");
    expect(levelOf({ type: "bteam" }, "Senior")).toBe("BTeam");
    expect(levelOf({ type: "club" }, "U17")).toBeUndefined();
    expect(levelOf({ type: "national" }, "Senior")).toBeUndefined();
    expect(lowerTeam({ id: 5, type: "club", parent_id: null }, "Senior")).toEqual({ clubId: 5, ageGroup: "U19" });
    expect(lowerTeam({ id: 6, type: "bteam", parent_id: 5 }, "BTeam")).toEqual({ clubId: 5, ageGroup: "U19" });
    expect(lowerTeam({ id: 5, type: "club", parent_id: null }, "U19")).toEqual({ clubId: 5, ageGroup: "U17" });
  });
});

describe("AI lineup call-ups (fast model)", () => {
  const lower = [
    { id: 1, position: "CB" as Position, ability: 50, age: 18 },
    { id: 2, position: "ST" as Position, ability: 76, age: 18 },
    { id: 3, position: "GK" as Position, ability: 45, age: 18 },
  ];

  it("looks below only when a line is short or the merit roll passes", () => {
    expect(aiNeedsLower(squadOf(70))).toBe(false);
    expect(aiNeedsLower(squadOf(70, { GK: 1 }))).toBe(true);
    expect(aiNeedsLower(squadOf(70).slice(0, 15))).toBe(true);
  });

  it("fills line gaps first, then adds clear merit on a passing roll", () => {
    expect(aiLineupCallUps({ level: "Senior", pool: squadOf(70, { GK: 1 }), lower, lateSeason: false, roll: 0.9 })).toEqual([3]);
    expect(aiLineupCallUps({ level: "Senior", pool: squadOf(70), lower, lateSeason: false, roll: 0.9 })).toEqual([]);
    expect(aiLineupCallUps({ level: "Senior", pool: squadOf(70), lower, lateSeason: false, roll: 0.01 })).toEqual([2]);
  });

  it("lowers the bar in the league's last rounds, spreads the picks and caps additions", () => {
    const youth = [
      { id: 4, position: "CM" as Position, ability: 52, age: 16 },
      { id: 5, position: "CB" as Position, ability: 53, age: 16 },
      { id: 6, position: "ST" as Position, ability: 54, age: 16 },
      { id: 7, position: "LW" as Position, ability: 55, age: 16 },
    ];
    const pool = squadOf(55);
    expect(aiLineupCallUps({ level: "U19", pool, lower: youth, lateSeason: false, roll: 0.05 })).toEqual([]);
    // Qualifying late: 7, 6, 5; the roll (0.3 of 0.45) starts at the third, capped at two per fixture.
    expect(aiLineupCallUps({ level: "U19", pool, lower: youth, lateSeason: true, roll: 0.3 })).toEqual([5, 7]);
    expect(aiLineupCallUps({ level: "U19", pool, lower: youth, lateSeason: true, roll: 0 })).toEqual([7, 6]);
  });

  it("keeps senior sides above the age floor and calls up more often below the top flight", () => {
    const lower = [
      { id: 1, position: "GK" as Position, ability: 45, age: 15 },
      { id: 2, position: "GK" as Position, ability: 40, age: 17 },
    ];
    expect(aiLineupCallUps({ level: "Senior", pool: squadOf(70, { GK: 1 }), lower, lateSeason: false, roll: 0.9, minAge: 16 })).toEqual([2]);
    expect(aiLineupCallUps({ level: "Senior", pool: squadOf(70, { GK: 1 }), lower, lateSeason: false, roll: 0.9, minAge: 15 })).toEqual([1]);
    expect(aiMeritChance("Senior", false, 3)).toBeCloseTo(CALL_UP_RULES.ai.meritChance.Senior * CALL_UP_RULES.standingMult.lower);
    expect(aiMeritChance("Senior", false, 1)).toBe(CALL_UP_RULES.ai.meritChance.Senior);
  });
});

describe("minors changing registered club within the family", () => {
  const countries = [
    { id: 1, code: "EN", name: "England", continent: "EU", confederation: "UEFA", reputation: 90, language: "English", region: "Western Europe" },
    { id: 2, code: "BR", name: "Brazil", continent: "SA", confederation: "CONMEBOL", reputation: 90, language: "Portuguese", region: "South America" },
  ] as Country[];
  const people = peopleContext(countries);
  const profile = (birthCountryId: number) => ({ identity: { birthCountryId, heritage: [] } }) as unknown as PlayerProfile;

  it("goes through minorMayJoin: a national may join, a foreign minor without residence may not", () => {
    const destination = clubRegistration("EN", "{}");
    const member = { age: 16, birth_date: "2010-09-01" };
    expect(minorMayJoin(member, profile(1), ["EN"], destination, people, "2027-01-10")).toBe(true);
    expect(minorMayJoin(member, profile(2), ["BR"], destination, people, "2027-01-10")).toBe(false);
    expect(minorMayJoin({ ...member, age: 18 }, profile(2), ["BR"], destination, people, "2027-01-10")).toBe(true);
  });
});
