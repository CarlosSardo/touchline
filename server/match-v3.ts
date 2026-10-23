import seedrandom from "seedrandom";
import { clamp, round } from "../shared/rules.ts";
import { debutSubAllowed } from "../shared/features/callups.ts";
import type {
  MatchAction,
  MatchPlayer,
  MatchResult,
  MatchSnapshot,
} from "../shared/types.ts";
import { expectedPoints } from "./match.ts";

const keys = [
  "passes",
  "completedPasses",
  "progressivePasses",
  "keyPasses",
  "dribbles",
  "successfulDribbles",
  "carries",
  "shots",
  "shotsOnTarget",
  "xG",
  "xA",
  "duels",
  "duelsWon",
  "tackles",
  "interceptions",
  "recoveries",
  "presses",
  "saves",
  "xGPrevented",
  "goals",
  "assists",
  "corners",
  "possession",
  "fouls",
  "yellowCards",
  "redCards",
  "rating",
  "minutes",
];
const blankStats = () => Object.fromEntries(keys.map((key) => [key, 0]));

export function shotProbability(
  distance: number,
  angle: number,
  header: boolean,
  pressured: boolean,
  offset = 0,
) {
  const logOdds =
    -1.18 +
    offset -
    distance * 0.095 +
    angle * 1.35 -
    (header ? 0.35 : 0) -
    (pressured ? 0.25 : 0);
  return round(clamp(1 / (1 + Math.exp(-logOdds)), 0.005, 0.9), 4);
}

/** Rules version 4 finishing: open-play shots convert ~11% (xG per shot ~0.11), as in the top five leagues. */
export const V4_SHOT_OFFSET = -0.22;
/** Share of open-play shooting chances that end in a foul in the box instead (~0.27 penalties per match). */
export const V4_PENALTY_SHARE = 0.014;

/** Rules 4 attacking intent by goal margin: a side ahead manages the game, a side behind pushes. */
export const gameStateFactor = (margin: number) =>
  margin >= 2 ? 0.85 : margin === 1 ? 0.95 : margin < 0 ? 1.03 : 1;

export interface SubstitutionPlan {
  /** Changes at half-time (they use no window). */
  halfTime: number;
  windows: { minute: number; count: number }[];
}

/**
 * One team's substitutions (rules version 4 and the fast model): ~4.3 of 5 used on average, a fifth of teams change
 * at half-time, then one to three windows spread over the second half.
 */
export function substitutionPlan(random: () => number, limit = 5, windows = 3): SubstitutionPlan {
  const roll = random();
  const unused = roll < 0.55 ? 0 : roll < 0.8 ? 1 : roll < 0.92 ? 2 : roll < 0.98 ? 3 : 4;
  let total = Math.max(0, limit - unused);
  const halfTime = total && random() < 0.22 ? (total >= 2 && random() < 0.2 ? 2 : 1) : 0;
  total -= halfTime;
  const spread = random();
  const used = Math.min(windows, total, spread < 0.15 ? 1 : spread < 0.55 ? 2 : 3);
  const ranges =
    used === 1 ? [[58, 76]] : used === 2 ? [[55, 69], [70, 85]] : [[54, 65], [66, 77], [78, 88]];
  const counts = Array.from({ length: used }, () => 1);
  for (let extra = total - used; extra > 0; extra--) counts[Math.floor(random() * used)]++;
  return {
    halfTime,
    windows: ranges.slice(0, used).map(([from, to], index) => ({
      minute: from + Math.floor(random() * (to - from + 1)),
      count: counts[index],
    })),
  };
}

export function simulateMatchV3(
  snapshot: MatchSnapshot,
  seed: string,
  retainActions = true,
): MatchResult {
  const random = seedrandom(`${seed}:laws-v3`);
  // Version 4 changes are gated so that stored version-3 snapshots replay exactly.
  const v4 = (snapshot.rulesVersion ?? 1) >= 4;
  const goalFactor = v4 ? clamp(snapshot.goalFactor ?? 1, 0.6, 1.5) : 1;
  const seconds = v4
    ? { foul: 10, yellow: 20, red: 60, substitution: 25, goal: 40, injury: 90 }
    : { foul: 12, yellow: 20, red: 75, substitution: 25, goal: 45, injury: 100 };
  const rules = snapshot.rules ?? {
    decisive: false,
    extraTime: true,
    neutral: false,
    awayGoals: false,
    substitutions: 5,
    substitutionWindows: 3,
    extraSubstitution: true,
    aggregate: { home: 0, away: 0, homeAwayGoals: 0, awayAwayGoals: 0 },
    injuryFrequency: 50,
  };
  const teams = [snapshot.home, snapshot.away];
  const result: MatchResult = {
    homeGoals: 0,
    awayGoals: 0,
    homeXg: 0,
    awayXg: 0,
    homeXpts: 0,
    awayXpts: 0,
    stats: {},
    players: {},
    actions: [],
    events: [],
    momentum: [],
    duration: 0,
    stoppageTime: [],
    wentToExtraTime: false,
    winnerId: null,
    substitutions: [],
    injuries: [],
  };
  const active = teams.map((team) =>
    team.lineup.map((player) => ({ ...player })),
  );
  const benches = teams.map((team) =>
    (team.bench ?? []).map((player) => ({ ...player })),
  );
  const teamByPlayer = new Map<number, number>();
  const entered = new Map<number, number>();
  const usedWindows = [0, 0];
  const usedSubs = [0, 0];
  const possession = [0, 0];
  const pressure = [0, 0];
  let elapsed = 0;
  let minute = 0;
  let period = 1;
  let addedTime = 0;
  let stoppageSeconds = 0;
  let attackTeam = 0;
  const pick = <Value>(values: Value[]) =>
    values[Math.floor(random() * values.length)];
  const weighted = (
    players: MatchPlayer[],
    weight: (player: MatchPlayer) => number,
  ) => {
    const total = players.reduce(
      (sum, player) => sum + Math.max(0.01, weight(player)),
      0,
    );
    let remaining = random() * total;
    for (const player of players) {
      remaining -= Math.max(0.01, weight(player));
      if (remaining <= 0) return player;
    }
    return players.at(-1)!;
  };
  const attribute = (player: MatchPlayer, key: string) =>
    player.attributes?.[key] ?? player.ability;
  const fatigue = (player: MatchPlayer, index: number) =>
    clamp(
      player.fitness -
        (elapsed - (entered.get(player.id) ?? 0)) *
          (0.18 +
            (100 - attribute(player, "stamina")) / 450 +
            (teams[index].style === "High press" ? 0.06 : 0) +
            (snapshot.weather === "Heat" ? 0.09 : 0)),
      0,
      100,
    );
  for (const [index, team] of teams.entries()) {
    result.stats[team.id] = blankStats();
    for (const player of [...team.lineup, ...(team.bench ?? [])]) {
      if (teamByPlayer.has(player.id))
        throw new Error("A match squad contains duplicate players.");
      teamByPlayer.set(player.id, index);
      result.players[player.id] = blankStats();
    }
    for (const player of team.lineup) entered.set(player.id, 0);
    if (team.lineup.length < 7)
      result.abandoned = {
        teamId: team.id,
        reason: "Fewer than seven eligible players",
      };
    if (team.lineup.length > 11)
      throw new Error("A team cannot start more than eleven players.");
    if (
      team.lineup.length >= 7 &&
      !team.lineup.some((player) => player.position === "GK")
    )
      throw new Error("A starting team must designate a goalkeeper.");
  }

  const bump = (
    index: number,
    player: MatchPlayer,
    key: string,
    amount = 1,
  ) => {
    result.stats[teams[index].id][key] += amount;
    result.players[player.id][key] += amount;
  };
  const record = (
    index: number,
    player: MatchPlayer,
    type: string,
    outcome: string,
    x: number,
    y: number,
    endX = x,
    endY = y,
    extras: Partial<MatchAction> = {},
  ) => {
    const event: MatchAction = {
      minute,
      second: Math.floor(random() * 60),
      period,
      addedTime,
      elapsed,
      teamId: teams[index].id,
      playerId: player.id,
      type,
      outcome,
      x: round(index ? 100 - x : x),
      y: round(y),
      endX: round(index ? 100 - endX : endX),
      endY: round(endY),
      difficulty: Math.round(clamp(extras.difficulty ?? 50)),
      fatigue: round(fatigue(player, index)),
      ...extras,
    };
    if (retainActions) result.actions.push(event);
    return event;
  };
  const event = (
    index: number,
    player: MatchPlayer,
    type: string,
    text: string,
    playerOnId?: number,
  ) =>
    result.events.push({
      minute,
      period,
      addedTime,
      elapsed,
      second: 0,
      teamId: teams[index].id,
      playerId: player.id,
      type,
      text,
      ...(playerOnId ? { playerOnId } : {}),
    });
  const ensureKeeper = (index: number) => {
    if (
      !active[index].some((player) => player.position === "GK") &&
      active[index].length
    ) {
      const emergency = [...active[index]].sort(
        (left, right) =>
          attribute(right, "reflexes") - attribute(left, "reflexes"),
      )[0];
      emergency.position = "GK";
      event(
        index,
        emergency,
        "goalkeeper change",
        `${emergency.name} takes over in goal`,
      );
    }
  };
  const dismiss = (index: number, player: MatchPlayer, reason: string) => {
    bump(index, player, "redCards");
    record(index, player, "red card", reason, 50, 50);
    event(index, player, "red card", `${player.name} sent off (${reason})`);
    active[index] = active[index].filter(
      (candidate) => candidate.id !== player.id,
    );
    ensureKeeper(index);
    stoppageSeconds += seconds.red;
    if (active[index].length < 7)
      result.abandoned = {
        teamId: teams[index].id,
        reason: "Fewer than seven players after a dismissal",
      };
  };
  const substitute = (
    index: number,
    replacements: number,
    freeWindow = false,
    injuredId?: number,
  ) => {
    const limit =
      rules.substitutions + (period >= 3 && rules.extraSubstitution ? 1 : 0);
    const windows =
      rules.substitutionWindows +
      (period >= 3 && rules.extraSubstitution ? 1 : 0);
    if (
      usedSubs[index] >= limit ||
      (!freeWindow && usedWindows[index] >= windows) ||
      !benches[index].length
    )
      return false;
    let made = 0;
    const replacedIds = new Set<number>();
    for (
      let count = 0;
      count < replacements && usedSubs[index] < limit;
      count++
    ) {
      const candidates = active[index].filter(
        (player) =>
          !replacedIds.has(player.id) &&
          (injuredId
            ? player.id === injuredId
            : player.position !== "GK" &&
              elapsed - (entered.get(player.id) ?? 0) > 15),
      );
      const off = candidates.sort(
        (left, right) =>
          fatigue(left, index) -
          (result.players[left.id].yellowCards ? 10 : 0) -
          (fatigue(right, index) -
            (result.players[right.id].yellowCards ? 10 : 0)),
      )[0];
      if (!off) break;
      const lead =
        result.stats[teams[index].id].goals -
        result.stats[teams[1 - index].id].goals;
      // A called-up debutant waits for a late, comfortable moment and is then the first choice.
      const debutant = (player: MatchPlayer) =>
        player.callUpDebut && debutSubAllowed(player.callUpDebut, minute, lead)
          ? 100
          : 0;
      const replacement = benches[index]
        .filter(
          (player) =>
            (off.position === "GK"
              ? player.position === "GK"
              : player.position !== "GK") &&
            (!player.callUpDebut ||
              debutSubAllowed(player.callUpDebut, minute, lead)),
        )
        .sort(
          (left, right) =>
            (right.position === off.position ? 20 : 0) +
            right.ability +
            right.fitness / 4 +
            debutant(right) -
            ((left.position === off.position ? 20 : 0) +
              left.ability +
              left.fitness / 4 +
              debutant(left)),
        )[0];
      if (!replacement) break;
      const on = { ...replacement, position: off.position };
      active[index][active[index].findIndex((player) => player.id === off.id)] =
        on;
      benches[index] = benches[index].filter((player) => player.id !== on.id);
      entered.set(on.id, elapsed);
      usedSubs[index]++;
      replacedIds.add(on.id);
      made++;
      result.substitutions!.push({
        teamId: teams[index].id,
        offId: off.id,
        onId: on.id,
        minute,
        elapsed,
        window: freeWindow ? 0 : usedWindows[index] + 1,
      });
      event(
        index,
        off,
        "substitution",
        `${on.name} replaces ${off.name}`,
        on.id,
      );
      record(index, off, "substitution", "off", 50, 0, 50, 0, {
        targetId: on.id,
        second: 0,
      });
      if (!freeWindow) stoppageSeconds += seconds.substitution;
    }
    if (made && !freeWindow) usedWindows[index]++;
    return made > 0;
  };
  const winner = () => {
    const home = result.stats[teams[0].id].goals + rules.aggregate.home;
    const away = result.stats[teams[1].id].goals + rules.aggregate.away;
    if (home !== away) return home > away ? teams[0].id : teams[1].id;
    if (
      rules.awayGoals &&
      rules.aggregate.homeAwayGoals !==
        rules.aggregate.awayAwayGoals + result.stats[teams[1].id].goals
    )
      return rules.aggregate.homeAwayGoals >
        rules.aggregate.awayAwayGoals + result.stats[teams[1].id].goals
        ? teams[0].id
        : teams[1].id;
    return null;
  };

  const shoot = (
    index: number,
    shooter: MatchPlayer,
    setPiece: boolean,
    pass: { player: MatchPlayer; action: MatchAction } | null,
    penalty = false,
  ) => {
    const opponentIndex = 1 - index;
    const keeper = active[opponentIndex].find(
      (player) => player.position === "GK",
    )!;
    const longShot =
      shooter.traits?.includes("Shoots from distance") &&
      !setPiece &&
      random() < 0.6;
    const shotX = penalty
      ? 89.5
      : longShot
        ? 72 + random() * 8
        : setPiece
          ? 89 + random() * 8
          : random() < 0.25
            ? 91 + random() * 6
            : 78 + random() * 15;
    const shotY = penalty ? 50 : 30 + random() * 40;
    const distance = Math.hypot((100 - shotX) * 1.05, (50 - shotY) * 0.68);
    const angle = Math.abs(
      Math.atan2(
        7.32 * (100 - shotX) * 1.05,
        ((100 - shotX) * 1.05) ** 2 + ((50 - shotY) * 0.68) ** 2 - 3.66 ** 2,
      ),
    );
    const header =
      setPiece &&
      teams[index].setPieces.routine !== "Short corner" &&
      teams[index].setPieces.routine !== "Edge of box";
    const pressured =
      random() < 0.4 + (active[opponentIndex].length - 11) * 0.045;
    const xg = penalty
      ? 0.76
      : shotProbability(distance, angle, header, pressured, v4 ? V4_SHOT_OFFSET : 0);
    const psychology =
      (((shooter.pressureHandling ?? 50) - 50) * snapshot.importance) / 90000 +
      (shooter.traits?.includes("Big-game player") && snapshot.importance > 70
        ? 0.04
        : 0);
    const quality =
      (attribute(
        shooter,
        penalty ? "penalties" : header ? "heading" : "finishing",
      ) -
        attribute(keeper, "reflexes")) /
      350;
    const chance = clamp(
      xg * (1 + quality + psychology) * (0.87 + fatigue(shooter, index) / 770),
      0.002,
      0.95,
    );
    const goal = random() < chance;
    const onTarget = goal || random() < 0.3;
    const outcome = goal
      ? "goal"
      : onTarget
        ? "saved"
        : random() < 0.3
          ? "blocked"
          : "off target";
    bump(index, shooter, "shots");
    bump(index, shooter, "xG", xg);
    if (onTarget) bump(index, shooter, "shotsOnTarget");
    if (pass && pass.player.id !== shooter.id && !penalty) {
      bump(index, pass.player, "keyPasses");
      bump(index, pass.player, "xA", xg);
      pass.action.key = true;
      pass.action.xa = xg;
      pass.action.targetId = shooter.id;
    }
    record(
      index,
      shooter,
      "shot",
      outcome,
      shotX,
      shotY,
      100,
      45 + random() * 10,
      { xg, difficulty: Math.round((1 - chance) * 99) },
    );
    pressure[index] += 15 + xg * 70;
    if (onTarget)
      bump(opponentIndex, keeper, "xGPrevented", xg - (goal ? 1 : 0));
    if (goal) {
      bump(index, shooter, "goals");
      if (pass && pass.player.id !== shooter.id && !penalty)
        bump(index, pass.player, "assists");
      event(
        index,
        shooter,
        "goal",
        `${shooter.name}${penalty ? " scores a penalty" : setPiece ? ` scores from a ${teams[index].setPieces.routine.toLowerCase()} routine` : " scores"}`,
      );
      stoppageSeconds += seconds.goal;
    } else if (onTarget) {
      bump(opponentIndex, keeper, "saves");
      record(opponentIndex, keeper, "save", "saved", 2, 50, 9, shotY, { xg });
    }
  };

  const plans = v4
    ? [0, 1].map(() => substitutionPlan(random, rules.substitutions, rules.substitutionWindows))
    : undefined;
  const simulateMinute = () => {
    if (result.abandoned) return;
    if (plans) {
      if (!addedTime && period === 2)
        for (const index of [0, 1])
          for (const window of plans[index].windows)
            if (window.minute === minute) substitute(index, window.count);
      if (!addedTime && minute === 105) for (const index of [0, 1]) substitute(index, 1);
    } else if (!addedTime && [60, 72, 82, 105].includes(minute))
      for (const index of [0, 1])
        substitute(index, minute === 60 || minute === 72 ? 2 : 1);
    for (const index of [0, 1])
      for (const player of active[index])
        if (!v4 || !addedTime) result.players[player.id].minutes++;
    const phases = 7 + Math.floor(random() * 5);
    for (let phase = 0; phase < phases && !result.abandoned; phase++) {
      const strength = (index: number) =>
        active[index].reduce(
          (sum, player) =>
            sum + player.ability * (0.78 + fatigue(player, index) / 450),
          0,
        ) /
          11 +
        teams[index].chemistry / 18 +
        teams[index].momentum / 15;
      const homeShare = clamp(
        0.5 +
          (strength(0) - strength(1)) / 180 +
          (rules.neutral ? 0 : 0.05) +
          (teams[0].style === "Possession" ? 0.04 : 0) -
          (teams[1].style === "Possession" ? 0.04 : 0) +
          clamp((pressure[0] - pressure[1]) / 2000, -0.04, 0.04),
        0.18,
        0.82,
      );
      attackTeam = random() < homeShare ? 0 : 1;
      const defendTeam = 1 - attackTeam;
      const team = teams[attackTeam];
      const players = active[attackTeam].filter(
        (player) => player.position !== "GK",
      );
      const defenders = active[defendTeam].filter(
        (player) => player.position !== "GK",
      );
      if (!players.length || !defenders.length) continue;
      const player = weighted(players, (candidate) =>
        ["CM", "DM", "AM"].includes(candidate.position) ? 2.2 : 1,
      );
      const defender = weighted(defenders, (candidate) =>
        ["CB", "DM", "LB", "RB"].includes(candidate.position) ? 2 : 1,
      );
      possession[attackTeam]++;
      const zones: Record<string, [number, number]> = {
        CB: [30, 50],
        LB: [40, 18],
        RB: [40, 82],
        DM: [43, 50],
        CM: [56, 50],
        AM: [71, 50],
        LW: [72, 18],
        RW: [72, 82],
        ST: [82, 50],
      };
      const zone = zones[player.position] ?? [50, 50];
      const x = clamp(
        zone[0] * 0.55 +
          random() * 90 * 0.45 +
          (team.style === "High press" ? 3 : 0),
        2,
        96,
      );
      const y = clamp(zone[1] * 0.6 + random() * 100 * 0.4, 2, 98);
      const pressing =
        teams[defendTeam].style === "High press" ||
        defender.traits?.includes("Aggressive presser") ||
        random() < 0.28;
      if (pressing) {
        bump(defendTeam, defender, "presses");
        record(
          defendTeam,
          defender,
          "press",
          random() < 0.35 ? "effective" : "bypassed",
          100 - x,
          y,
        );
      }
      const success = clamp(
        0.86 +
          (attribute(player, "passing") - attribute(defender, "positioning")) /
            500 +
          (player.confidence - 65) / 1000 -
          (pressing ? 0.025 : 0) -
          (100 - fatigue(player, attackTeam)) / 800 -
          (snapshot.weather === "Heavy rain"
            ? 0.03
            : snapshot.weather === "Wind"
              ? 0.02
              : 0),
        0.5,
        0.96,
      );
      if (
        random() <
        0.026 *
          (1 + (60 - (defender.discipline ?? 60)) / 140) *
          (result.players[defender.id].yellowCards ? 0.35 : 1)
      ) {
        bump(defendTeam, defender, "fouls");
        record(defendTeam, defender, "foul", "free kick", 100 - x, y);
        stoppageSeconds += seconds.foul;
        if (random() < 0.004)
          dismiss(defendTeam, defender, "serious foul play");
        else if (random() < 0.2) {
          bump(defendTeam, defender, "yellowCards");
          record(defendTeam, defender, "yellow card", "caution", 100 - x, y);
          event(defendTeam, defender, "yellow card", `${defender.name} booked`);
          stoppageSeconds += seconds.yellow;
          if (result.players[defender.id].yellowCards >= 2)
            dismiss(defendTeam, defender, "second caution");
        }
        if (!v4 && !result.abandoned && x >= 84 && y > 21 && y < 79 && random() < 0.4)
          shoot(
            attackTeam,
            weighted(players, (candidate) => attribute(candidate, "penalties")),
            false,
            null,
            true,
          );
        continue;
      }
      if (random() < 0.34) {
        bump(attackTeam, player, "carries");
        record(
          attackTeam,
          player,
          "carry",
          "complete",
          x,
          y,
          clamp(x + 5 + random() * 14, 0, 100),
          clamp(
            y +
              (player.traits?.includes("Cuts inside")
                ? (50 - y) * 0.4
                : random() * 10 - 5),
            0,
            100,
          ),
        );
      }
      if (
        random() < (player.traits?.includes("Dribbles often") ? 0.19 : 0.065)
      ) {
        const won =
          random() <
          clamp(
            0.55 +
              (attribute(player, "dribbling") -
                attribute(defender, "tackling")) /
                250,
            0.2,
            0.85,
          );
        for (const [index, actor] of [
          [attackTeam, player],
          [defendTeam, defender],
        ] as [number, MatchPlayer][])
          bump(index, actor, "duels");
        bump(attackTeam, player, "dribbles");
        bump(
          won ? attackTeam : defendTeam,
          won ? player : defender,
          "duelsWon",
        );
        if (won) bump(attackTeam, player, "successfulDribbles");
        else bump(defendTeam, defender, "tackles");
        record(
          attackTeam,
          player,
          "dribble",
          won ? "won" : "lost",
          x,
          y,
          clamp(x + 8, 0, 100),
          y,
        );
        record(
          defendTeam,
          defender,
          "tackle",
          won ? "missed" : "won",
          100 - x,
          y,
        );
        if (!won) continue;
      }
      let lastPass: { player: MatchPlayer; action: MatchAction } | null = null;
      let passer = player;
      let target = pick(
        players.filter((candidate) => candidate.id !== passer.id),
      );
      for (let touch = 0; touch < (random() < 0.2 ? 2 : 1); touch++) {
        target = pick(
          players.filter((candidate) => candidate.id !== passer.id),
        );
        const endX = clamp(
          x + random() * (team.style === "Direct" ? 55 : 40) - 13,
          1,
          99,
        );
        const endY = clamp(y + random() * 50 - 25, 1, 99);
        const distance = Math.hypot(endX - x, endY - y);
        const complete = random() < success - distance / 1100;
        bump(attackTeam, passer, "passes");
        const pass = record(
          attackTeam,
          passer,
          "pass",
          complete ? "complete" : "incomplete",
          x,
          y,
          endX,
          endY,
          {
            targetId: target.id,
            progressive: endX - x >= 10,
            difficulty: 20 + distance + (pressing ? 15 : 0),
          },
        );
        if (complete) {
          bump(attackTeam, passer, "completedPasses");
          if (pass.progressive) bump(attackTeam, passer, "progressivePasses");
          lastPass = { player: passer, action: pass };
          passer = target;
        } else {
          const type = random() < 0.6 ? "interception" : "recovery";
          bump(
            defendTeam,
            defender,
            type === "interception" ? "interceptions" : "recoveries",
          );
          record(defendTeam, defender, type, "won", 100 - endX, endY);
          lastPass = null;
          break;
        }
      }
      const corner = random() < 0.012;
      if (corner) {
        bump(attackTeam, player, "corners");
        record(
          attackTeam,
          player,
          "set piece",
          team.setPieces.routine,
          99,
          random() < 0.5 ? 0 : 100,
          93,
          50,
        );
      }
      // Rules 4 game state: a side two goals up manages the game, a trailing side pushes.
      const margin =
        result.stats[team.id].goals - result.stats[teams[defendTeam].id].goals;
      const gameState = v4 ? gameStateFactor(margin) : 1;
      const shotChance =
        ((lastPass ? 0.029 : 0.008) +
          (corner ? 0.23 + team.setPieces.risk / 1000 : 0) +
          (team.style === "Counter attack" && !pressing ? 0.004 : 0)) *
        goalFactor *
        gameState;
      if (random() < shotChance) {
        if (v4 && !corner && random() < V4_PENALTY_SHARE) {
          // Brought down in the box: the designated taker steps up.
          bump(defendTeam, defender, "fouls");
          record(defendTeam, defender, "foul", "penalty", 100 - 89, 50);
          stoppageSeconds += seconds.foul + 50;
          const caution = random();
          if (caution < 0.03) dismiss(defendTeam, defender, "denying an obvious goal-scoring opportunity");
          else if (caution < 0.33) {
            bump(defendTeam, defender, "yellowCards");
            record(defendTeam, defender, "yellow card", "caution", 11, 50);
            event(defendTeam, defender, "yellow card", `${defender.name} booked`);
            stoppageSeconds += seconds.yellow;
            if (result.players[defender.id].yellowCards >= 2)
              dismiss(defendTeam, defender, "second caution");
          }
          if (!result.abandoned)
            shoot(
              attackTeam,
              [...players].sort((left, right) => attribute(right, "penalties") - attribute(left, "penalties"))[0],
              false,
              null,
              true,
            );
          continue;
        }
        const targetPosition =
          team.setPieces.target === "Centre-back"
            ? "CB"
            : team.setPieces.target === "Midfielder"
              ? "CM"
              : "ST";
        const shooter = corner
          ? (players.find(
              (candidate) => candidate.position === targetPosition,
            ) ?? target)
          : weighted(players, (candidate) =>
              candidate.position === "ST"
                ? 7
                : ["RW", "LW", "AM"].includes(candidate.position)
                  ? 4
                  : candidate.position === "CB"
                    ? 0.4
                    : 1.2,
            );
        shoot(attackTeam, shooter, corner, lastPass);
      }
      pressure[attackTeam] += lastPass?.action.progressive ? 1.4 : 0.3;
    }
    if (!result.abandoned) {
      for (const index of [0, 1]) {
        if (
          random() <
          ((0.00075 * rules.injuryFrequency) / 50) *
            (snapshot.weather === "Heat" ? 1.2 : 1)
        ) {
          const injured = pick(active[index]);
          const days =
            random() < 0.9
              ? 3 + Math.floor(random() * 25)
              : 35 + Math.floor(random() * 120);
          result.injuries!.push({ playerId: injured.id, days });
          event(index, injured, "injury", `${injured.name} cannot continue`);
          stoppageSeconds += seconds.injury;
          if (!substitute(index, 1, false, injured.id)) {
            active[index] = active[index].filter(
              (player) => player.id !== injured.id,
            );
            ensureKeeper(index);
            if (active[index].length < 7)
              result.abandoned = {
                teamId: teams[index].id,
                reason: "Fewer than seven players after an injury",
              };
          }
        }
      }
    }
    if (elapsed % 5 === 0) {
      result.momentum.push({
        minute: elapsed,
        home: round(clamp(pressure[0], 0, 100)),
        away: round(clamp(pressure[1], 0, 100)),
      });
      pressure[0] *= 0.4;
      pressure[1] *= 0.4;
    }
  };

  const playPeriod = (number: number, length: number, startMinute: number) => {
    period = number;
    stoppageSeconds = 0;
    for (let current = 1; current <= length && !result.abandoned; current++) {
      minute = startMinute + current;
      addedTime = 0;
      elapsed++;
      simulateMinute();
    }
    const added =
      Math.ceil(stoppageSeconds / 60) +
      (number <= 2 ? Math.floor(random() * 2) : 0);
    result.stoppageTime!.push(added);
    for (let current = 1; current <= added && !result.abandoned; current++) {
      minute = startMinute + length;
      addedTime = current;
      elapsed++;
      simulateMinute();
    }
  };
  if (!result.abandoned) {
    playPeriod(1, 45, 0);
    if (plans)
      for (const index of [0, 1]) {
        if (plans[index].halfTime) substitute(index, plans[index].halfTime, true);
      }
    else
      for (const index of [0, 1])
        if (active[index].some((player) => fatigue(player, index) < 45))
          substitute(index, 1, true);
    playPeriod(2, 45, 45);
    result.regulationScore = {
      home: result.stats[teams[0].id].goals,
      away: result.stats[teams[1].id].goals,
    };
    if (rules.decisive && !winner() && rules.extraTime && !result.abandoned) {
      result.wentToExtraTime = true;
      period = 3;
      for (const index of [0, 1]) substitute(index, 1, true);
      playPeriod(3, 15, 90);
      playPeriod(4, 15, 105);
    }
  }
  result.winnerId = winner();
  if (rules.decisive && !result.winnerId && !result.abandoned) {
    const count = Math.min(active[0].length, active[1].length);
    const takers = active.map((players) =>
      [...players]
        .sort(
          (left, right) =>
            attribute(right, "penalties") - attribute(left, "penalties") ||
            (v4
              ? (right.pressureHandling ?? 50) - (left.pressureHandling ?? 50)
              : right.pressureHandling! - left.pressureHandling!),
        )
        .slice(0, count),
    );
    const scores = [0, 0];
    const kicks: NonNullable<MatchResult["shootout"]>["kicks"] = [];
    let completed = false;
    for (let roundNumber = 0; roundNumber < 100 && !completed; roundNumber++) {
      for (const index of [0, 1]) {
        const taker = takers[index][roundNumber % count];
        const keeper = active[1 - index].find(
          (player) => player.position === "GK",
        )!;
        const probability = clamp(
          0.76 +
            (attribute(taker, "penalties") - attribute(keeper, "reflexes")) /
              550 +
            ((taker.pressureHandling ?? 50) - 50) / 1250,
          0.5,
          0.94,
        );
        const scored = random() < probability;
        if (scored) scores[index]++;
        kicks.push({
          teamId: teams[index].id,
          playerId: taker.id,
          scored,
          probability,
        });
        const takenHome = Math.ceil(kicks.length / 2);
        const takenAway = Math.floor(kicks.length / 2);
        if (
          roundNumber < 5 &&
          (scores[0] > scores[1] + 5 - takenAway ||
            scores[1] > scores[0] + 5 - takenHome)
        ) {
          completed = true;
          break;
        }
        if (roundNumber >= 4 && index === 1 && scores[0] !== scores[1]) {
          completed = true;
          break;
        }
      }
    }
    if (!completed)
      throw new Error(
        "Penalty shootout exceeded the deterministic safety limit.",
      );
    result.shootout = { home: scores[0], away: scores[1], kicks };
    result.winnerId = teams[scores[0] > scores[1] ? 0 : 1].id;
  }
  result.duration = elapsed;
  // Rules 4 count regulation minutes only: a substitute sent on in stoppage time still appeared (and may have scored).
  if (v4) for (const change of result.substitutions!) result.players[change.onId].minutes ||= 1;
  for (const [index, team] of teams.entries()) {
    const stats = result.stats[team.id];
    stats.possession =
      possession[0] + possession[1]
        ? Math.round(
            (possession[index] / (possession[0] + possession[1])) * 100,
          )
        : 50;
    for (const key of ["xG", "xA", "xGPrevented"])
      stats[key] = round(stats[key], 2);
    for (const player of [...team.lineup, ...(team.bench ?? [])]) {
      const values = result.players[player.id];
      values.rating = values.minutes
        ? round(
            clamp(
              6.3 +
                values.goals * 0.8 +
                values.assists * 0.45 +
                values.tackles * 0.055 +
                values.saves * 0.07 +
                values.completedPasses * 0.003 -
                (values.passes - values.completedPasses) * 0.014 -
                values.yellowCards * 0.15 -
                values.redCards * 1.2 +
                (stats.goals - result.stats[teams[1 - index].id].goals) * 0.12,
              1,
              10,
            ),
          )
        : 0;
      for (const key of ["xG", "xA", "xGPrevented"])
        values[key] = round(values[key], 3);
    }
  }
  result.homeGoals = result.stats[teams[0].id].goals;
  result.awayGoals = result.stats[teams[1].id].goals;
  result.homeXg = result.stats[teams[0].id].xG;
  result.awayXg = result.stats[teams[1].id].xG;
  [result.homeXpts, result.awayXpts] = expectedPoints(
    result.homeXg,
    result.awayXg,
  );
  result.actions.sort(
    (left, right) =>
      (left.elapsed ?? 0) - (right.elapsed ?? 0) || left.second - right.second,
  );
  result.events.sort(
    (left, right) => (left.elapsed ?? 0) - (right.elapsed ?? 0),
  );
  return result;
}
