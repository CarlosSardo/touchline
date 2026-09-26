// Pure season probe for the call-up model: per-club debuts and youth call-up shares against Fact Checker's bands.
import { pathToFileURL } from "node:url";
import seedrandom from "seedrandom";
import {
  aiLineupCallUps,
  aiMeritChance,
  aiNeedsLower,
  coachCallUpPlan,
  debutBudget,
  debutStanding,
  minSeniorAge,
  prospectFloorPick,
  usedDebuts,
  type CoachCandidate,
  type TargetLevel,
} from "./callups.ts";
import { CALL_UP_RULES, type DebutStanding } from "../shared/features/callups.ts";
import type { Position } from "../shared/types.ts";

export interface ProbePlayer {
  id: number;
  position: Position;
  ability: number;
  potential: number;
  age: number;
}

export interface ProbeFamily {
  id: number;
  tier: number;
  standing: DebutStanding;
  academy: number;
  philosophy: string;
  code: string;
  first: ProbePlayer[];
  bteam?: ProbePlayer[];
  u19: ProbePlayer[];
  u17: ProbePlayer[];
}

/**
 * Fact Checker's bands (fact-checker-callup-realism.md, all ⚠️ heuristics): first-team debuts per club and season by
 * standing, and the share of a youth squad that gets any minutes one level up during the season.
 */
export const CALL_UP_TARGETS = {
  debuts: { elite: [1, 3], mid: [1, 2.5], bottom: [1.5, 3], second: [1.5, 3], lower: [1.5, 4] } as Record<DebutStanding, [number, number]>,
  u17ToU19: { big: [0.15, 0.35], other: [0.08, 0.22] },
  u19ToBTeam: [0.25, 0.45],
  singleMatchShare: [0.55, 0.85],
} as const;

/** Heuristic engine outcomes the probe needs (no match engine here). */
const PLAY = {
  /** A gated debutant comes on: leading by 2 at the 82' window, by standing; open context; injury crisis. */
  lead: { elite: 0.35, mid: 0.22, bottom: 0.15, second: 0.22, lower: 0.22 } as Record<DebutStanding, number>,
  open: 0.55,
  crisis: 0.7,
  seniorOther: 0.5,
  youthNeed: 0.6,
  /** A called-up goalkeeper is usually the bench keeper. */
  youthKeeper: 0.1,
  youthMerit: 0.8,
};

const WEEKS = { Senior: 34, BTeam: 34, U19: 30, U17: 28 };
const CUP_WEEKS = [6, 14];

type Team = "Senior" | "BTeam" | "U19" | "U17";

interface Movement {
  player: ProbePlayer;
  home: Team;
  at: Team;
  until: number;
  debut: boolean;
}

interface FamilyResult {
  standing: DebutStanding;
  big: boolean;
  debuts: number;
  budget: number;
  overBudget: boolean;
  u17: number;
  u17Up: number;
  u19: number;
  u19Up: number;
  hasBTeam: boolean;
  firstTeamCalls: number;
  singleMatch: number;
  calls: number;
  floorCalls: number;
}

const reasons = new Map<string, number>();

function simulateFamily(family: ProbeFamily, mode: "coach" | "ai", seed: string): FamilyResult {
  const random = seedrandom(`${seed}:${mode}:${family.id}`);
  const home = new Map<number, Team>();
  const add = (team: Team, players: readonly ProbePlayer[] = []) => players.forEach((player) => home.set(player.id, team));
  add("Senior", family.first);
  add("BTeam", family.bteam);
  add("U19", family.u19);
  add("U17", family.u17);
  const all = [...family.first, ...(family.bteam ?? []), ...family.u19, ...family.u17];
  const injured = new Map<number, number>();
  const form = new Map(all.map((player) => [player.id, 6.8 + (random() - 0.5) * 0.5]));
  const debuted = new Set([...family.first, ...(family.bteam ?? []).filter((player) => player.age >= 22)].map((player) => player.id));
  const moves = new Map<number, Movement>();
  const playedUp = { u17: new Set<number>(), u19: new Set<number>() };
  const meta = { debuts: {} as Record<string, number>, active: [] as { debut?: boolean; to: { clubId: number; ageGroup: "Senior" } }[] };
  const firstCalls = new Map<number, number>();
  let singleMatch = 0;
  let calls = 0;
  let floorCalls = 0;
  let settled = false;
  const floor = minSeniorAge(family.code);
  const where = (player: ProbePlayer) => moves.get(player.id)?.at ?? home.get(player.id)!;
  const fit = (player: ProbePlayer) => !injured.has(player.id);
  const members = (team: Team) => all.filter((player) => where(player) === team);
  const sources: Record<TargetLevel, Team[]> = { Senior: family.bteam ? ["BTeam", "U19"] : ["U19"], BTeam: ["U19"], U19: ["U17"] };
  const budgetOf = (ownOutfield?: number) => debutBudget(family, family.standing, ownOutfield);
  const syncActive = () => {
    meta.active = [...moves.values()].filter((move) => move.debut && move.at === "Senior").map(() => ({ debut: true, to: { clubId: family.id, ageGroup: "Senior" } }));
  };
  const endMove = (move: Movement) => {
    moves.delete(move.player.id);
    syncActive();
  };
  const play = (move: Movement, target: TargetLevel, reason: string, context: { crisis: boolean; open: boolean }) => {
    const player = move.player;
    if (target === "Senior") {
      if (!debuted.has(player.id)) {
        const spent = (meta.debuts[family.id] ?? 0) >= budgetOf(context.crisis ? 0 : undefined);
        const chance = mode === "ai" ? PLAY.youthMerit : context.crisis ? PLAY.crisis : spent ? 0 : context.open ? PLAY.open : PLAY.lead[family.standing];
        if (random() < chance) {
          debuted.add(player.id);
          meta.debuts[family.id] = (meta.debuts[family.id] ?? 0) + 1;
        }
      } else random();
      return;
    }
    if (random() < (move.player.position === "GK" ? PLAY.youthKeeper : reason === "need" ? PLAY.youthNeed : PLAY.youthMerit)) {
      if (move.home === "U17" && target === "U19") playedUp.u17.add(player.id);
      if (move.home === "U19" && target === "BTeam") playedUp.u19.add(player.id);
    }
  };
  for (let week = 1; week <= WEEKS.Senior; week++) {
    for (const player of all) {
      const left = injured.get(player.id);
      if (left !== undefined) {
        if (left <= 1) injured.delete(player.id);
        else injured.set(player.id, left - 1);
      } else if (random() < 0.035) injured.set(player.id, 1 + Math.floor(random() * 6));
    }
    for (const move of [...moves.values()]) if (move.until < week) endMove(move);
    const fixtures: { target: TargetLevel; cup: boolean }[] = [];
    if (CUP_WEEKS.includes(week) && family.tier <= 2) fixtures.push({ target: "Senior", cup: true });
    fixtures.push({ target: "Senior", cup: false });
    if (family.bteam && family.bteam.length) fixtures.push({ target: "BTeam", cup: false });
    if (week <= WEEKS.U19) fixtures.push({ target: "U19", cup: false });
    const remainingSenior = WEEKS.Senior - week + 1;
    if (remainingSenior <= CALL_UP_RULES.endOfSeason.lastRounds && !settled && random() < 0.25 + 0.12 * (5 - remainingSenior)) settled = true;
    for (const { target, cup } of fixtures) {
      const weeks = WEEKS[target];
      const remaining = cup ? remainingSenior : weeks - week + 1;
      const squad = members(target);
      const available = squad.filter(fit);
      const ownOutfield = available.filter((player) => !moves.has(player.id) && player.position !== "GK").length;
      const crisis = target === "Senior" && ownOutfield < CALL_UP_RULES.debutBudget.crisisBelow;
      const pool = sources[target].flatMap((team, rank) =>
        members(team)
          .filter((player) => fit(player) && !moves.has(player.id))
          .map((player): CoachCandidate & { team: Team } => ({
            id: player.id,
            position: player.position,
            ability: player.ability,
            potential: player.potential,
            age: player.age,
            form: form.get(player.id)! + (random() - 0.5) * 0.6,
            sourceRank: rank,
            debut: target === "Senior" && !debuted.has(player.id),
            team,
          })),
      );
      const endOfSeason = remaining <= CALL_UP_RULES.endOfSeason.lastRounds;
      const deadRubber = target === "Senior" && settled;
      const open = deadRubber || cup;
      const sourceTeam = sources[target][0];
      const youthSeasonOver = target !== "Senior" && week > WEEKS[sourceTeam];
      let picks: { id: number; reason: string; duration: "match" | "until" }[];
      if (mode === "coach") {
        const prospects = [...family.u19, ...family.u17, ...(family.bteam ?? []).filter((player) => player.age <= 21)]
          .sort((left, right) => right.potential - left.potential || left.id - right.id)
          .slice(0, CALL_UP_RULES.prospectFloor.top)
          .map((player) => player.id);
        for (const candidate of pool) if (target === "Senior" && prospects.includes(candidate.id)) candidate.topProspect = true;
        const plan = coachCallUpPlan({
          level: target,
          available,
          squad,
          candidates: pool,
          endOfSeason,
          finalRound: remaining === 1,
          deadRubber,
          congestion: cup,
          youthSeasonOver,
          cupVsLower: cup,
          strongAcademy: family.academy >= CALL_UP_RULES.debutBudget.strongAcademy,
          standing: family.standing,
          minAge: target === "U19" ? undefined : floor,
          debuts: { used: usedDebuts(meta, family.id), limit: target === "Senior" ? budgetOf(ownOutfield) : 0 },
          room: CALL_UP_RULES.squadCaps[target] - squad.length,
          random,
        });
        picks = plan.decisions.map((decision) => ({ id: decision.playerId, reason: decision.reason, duration: decision.duration }));
        if (target === "Senior") {
          const floorPick = prospectFloorPick({
            tier: family.tier,
            remaining,
            candidates: pool.filter((entry) => !picks.some((pick) => pick.id === entry.id)),
            calledThisSeason: (id) => (firstCalls.get(id) ?? 0) > 0,
            minAge: floor,
          });
          if (floorPick) {
            picks.push({ id: floorPick.id, reason: "merit", duration: "match" });
            floorCalls++;
          }
        }
      } else {
        const roll = random();
        const late = remaining <= CALL_UP_RULES.ai.lateRounds;
        if (!aiNeedsLower(available) && roll >= aiMeritChance(target, late, family.tier)) continue;
        const lowerTeam: Team = target === "U19" ? "U17" : "U19";
        const lower = pool.filter((entry) => entry.team === lowerTeam).sort((left, right) => right.ability - left.ability || left.id - right.id);
        picks = aiLineupCallUps({
          level: target,
          pool: available,
          lower: lower.slice(0, 8),
          lateSeason: late,
          roll,
          minAge: target === "U19" ? undefined : floor,
          tier: family.tier,
        }).map(
          (id) => ({ id, reason: "merit", duration: "match" as const }),
        );
      }
      for (const pick of picks) {
        const candidate = pool.find((entry) => entry.id === pick.id)!;
        const player = all.find((entry) => entry.id === pick.id)!;
        const move: Movement = {
          player,
          home: candidate.team,
          at: target,
          until: pick.duration === "match" ? week : pick.reason === "end-of-season" ? WEEKS[target] : week + 2,
          debut: candidate.debut,
        };
        moves.set(player.id, move);
        syncActive();
        calls++;
        reasons.set(`${target}:${pick.reason}`, (reasons.get(`${target}:${pick.reason}`) ?? 0) + 1);
        if (pick.duration === "match") singleMatch++;
        if (target === "Senior") firstCalls.set(player.id, (firstCalls.get(player.id) ?? 0) + 1);
      }
      // Everyone on a call-up to this team this week gets his chance to play.
      for (const move of moves.values())
        if (move.at === target) play(move, target, picks.find((pick) => pick.id === move.player.id)?.reason ?? "merit", { crisis, open });
    }
  }
  const budget = budgetOf();
  return {
    standing: family.standing,
    big: family.academy >= CALL_UP_RULES.debutBudget.strongAcademy,
    debuts: meta.debuts[family.id] ?? 0,
    budget,
    overBudget: (meta.debuts[family.id] ?? 0) > budget + 2,
    u17: family.u17.length,
    u17Up: playedUp.u17.size,
    u19: family.u19.length,
    u19Up: playedUp.u19.size,
    hasBTeam: !!family.bteam?.length,
    firstTeamCalls: [...firstCalls.values()].reduce((sum, count) => sum + count, 0),
    singleMatch,
    calls,
    floorCalls,
  };
}

const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
const round2 = (value: number) => Math.round(value * 100) / 100;

export function callUpSeasonProbe(families: readonly ProbeFamily[], mode: "coach" | "ai" = "coach", seed = "probe") {
  reasons.clear();
  const results = families.map((family) => simulateFamily(family, mode, seed));
  const byStanding = Object.fromEntries(
    (["elite", "mid", "bottom", "second", "lower"] as DebutStanding[]).map((standing) => {
      const rows = results.filter((row) => row.standing === standing);
      return [
        standing,
        {
          clubs: rows.length,
          meanDebuts: round2(mean(rows.map((row) => row.debuts))),
          maxDebuts: Math.max(0, ...rows.map((row) => row.debuts)),
          meanBudget: round2(mean(rows.map((row) => row.budget))),
          meanFirstTeamCalls: round2(mean(rows.map((row) => row.firstTeamCalls))),
        },
      ];
    }),
  ) as Record<DebutStanding, { clubs: number; meanDebuts: number; maxDebuts: number; meanBudget: number; meanFirstTeamCalls: number }>;
  const share = (rows: FamilyResult[], up: "u17Up" | "u19Up", size: "u17" | "u19") =>
    round2(rows.reduce((sum, row) => sum + row[up], 0) / Math.max(1, rows.reduce((sum, row) => sum + row[size], 0)));
  return {
    mode,
    clubs: results.length,
    byStanding,
    u17ToU19: { big: share(results.filter((row) => row.big), "u17Up", "u17"), other: share(results.filter((row) => !row.big), "u17Up", "u17") },
    u19ToBTeam: share(results.filter((row) => row.hasBTeam), "u19Up", "u19"),
    singleMatchShare: round2(results.reduce((sum, row) => sum + row.singleMatch, 0) / Math.max(1, results.reduce((sum, row) => sum + row.calls, 0))),
    overBudgetClubs: results.filter((row) => row.overBudget).length,
    floorCallsPerClub: round2(mean(results.map((row) => row.floorCalls))),
    callsPerClub: Object.fromEntries([...reasons].sort().map(([key, count]) => [key, round2(count / Math.max(1, results.length))])),
  };
}

export type CallUpProbe = ReturnType<typeof callUpSeasonProbe>;

/** Bands the probe misses (empty = inside every band). */
export function callUpBandMisses(probe: CallUpProbe) {
  const misses: string[] = [];
  const check = (label: string, value: number, [low, high]: readonly [number, number]) => {
    if (value < low || value > high) misses.push(`${label} ${value} outside [${low}, ${high}]`);
  };
  for (const [standing, band] of Object.entries(CALL_UP_TARGETS.debuts) as [DebutStanding, [number, number]][])
    if (probe.byStanding[standing].clubs) check(`debuts/${standing}`, probe.byStanding[standing].meanDebuts, band);
  check("u17->u19 big", probe.u17ToU19.big, CALL_UP_TARGETS.u17ToU19.big);
  check("u17->u19 other", probe.u17ToU19.other, CALL_UP_TARGETS.u17ToU19.other);
  check("u19->bteam", probe.u19ToBTeam, CALL_UP_TARGETS.u19ToBTeam);
  // AI call-ups are lineup-only (always one match) and have no budget.
  if (probe.mode === "coach") check("single-match share", probe.singleMatchShare, CALL_UP_TARGETS.singleMatchShare);
  if (probe.mode === "coach" && probe.overBudgetClubs) misses.push(`${probe.overBudgetClubs} clubs over budget + crisis bonus`);
  return misses;
}

/** Families of a planned world (tiers 1-4 with U19 and U17 squads). */
export async function worldFamilies(nations: string[]) {
  const { planWorld, worldPlayers } = await import("./world.ts");
  const plan = planWorld({ nations });
  const squads = new Map<string, ProbePlayer[]>();
  let id = 0;
  for (const row of worldPlayers(plan)) {
    if (row.club_id == null) continue;
    const key = `${row.squad_club_id ?? row.club_id}:${row.age_group}`;
    const list = squads.get(key) ?? [];
    // Plan rows get their ids from the database; the probe numbers them itself.
    list.push({ id: ++id, position: row.position as Position, ability: Number(row.ability), potential: Number(row.potential), age: Number(row.age) });
    squads.set(key, list);
  }
  const clubs = plan.clubs.filter((club) => club.type === "club" && club.tier >= 1 && club.tier <= 4);
  const leagueRank = new Map<number, number[]>();
  for (const club of clubs) {
    const league = Number(club.row.league_id);
    leagueRank.set(league, [...(leagueRank.get(league) ?? []), Number(club.row.reputation)]);
  }
  return clubs.flatMap((club): ProbeFamily[] => {
    const u19 = squads.get(`${club.id}:U19`) ?? [];
    const u17 = squads.get(`${club.id}:U17`) ?? [];
    const first = squads.get(`${club.id}:Senior`) ?? [];
    if (u19.length < 15 || u17.length < 15 || first.length < 18) return [];
    const reputations = leagueRank.get(Number(club.row.league_id)) ?? [];
    const rank = reputations.filter((reputation) => reputation > Number(club.row.reputation)).length;
    const bteam = plan.clubs.find((entry) => entry.type === "bteam" && entry.parent?.id === club.id);
    return [
      {
        id: club.id,
        tier: club.tier,
        standing: debutStanding(club.tier, rank, reputations.length),
        academy: Number(club.row.academy),
        philosophy: String(club.row.philosophy),
        code: club.code,
        first,
        bteam: bteam ? squads.get(`${bteam.id}:Senior`) : undefined,
        u19,
        u17,
      },
    ];
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const nations = (process.argv[2] ?? "EN,ES,DE,IT,NL,FR,PT").split(",");
  const started = performance.now();
  const families = await worldFamilies(nations);
  for (const mode of ["coach", "ai"] as const) {
    const probe = callUpSeasonProbe(families, mode);
    console.log(JSON.stringify(probe, null, 1));
    console.log(`${mode} misses: ${JSON.stringify(callUpBandMisses(probe))}`);
  }
  console.log(`families ${families.length}, ${((performance.now() - started) / 1000).toFixed(1)} s`);
}
