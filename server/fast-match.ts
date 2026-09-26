import seedrandom from "seedrandom";
import { clamp, round } from "../shared/rules.ts";
import { expectedPoints, simulateMatch } from "./match.ts";
import type {
  MatchPlayer,
  MatchResult,
  MatchSnapshot,
  MatchTeam,
} from "../shared/types.ts";

// Calibrated against simulateMatchV3 on synthetic squads; fast-match.test.ts guards the parity.
export const FAST_GOAL_RATE = 118.8;
export const FAST_ASSIST_SHARE = 0.828;
const FATIGUE_DROP = 12;
const STAT_KEYS = ["goals", "assists", "yellowCards", "redCards", "minutes", "rating"];

type Random = () => number;

/** The user's club family: the club (all its age groups share its id) and clubs whose parent it is. */
export const followsFixture = (
  fixture: { home_id: number; away_id: number },
  family: ReadonlySet<number>,
) => family.has(fixture.home_id) || family.has(fixture.away_id);

export const simulateFixture = (snapshot: MatchSnapshot, seed: string, followed: boolean) =>
  followed ? simulateMatch(snapshot, seed, false) : simulateFastMatch(snapshot, seed);

const attribute = (player: MatchPlayer, key: string) =>
  player.attributes?.[key] ?? player.ability;
const outfield = (team: MatchTeam) =>
  team.lineup.filter((player) => player.position !== "GK");
const weightedMean = (
  players: MatchPlayer[],
  value: (player: MatchPlayer) => number,
  weight: (player: MatchPlayer) => number,
) => {
  let total = 0;
  let weights = 0;
  for (const player of players) {
    total += value(player) * weight(player);
    weights += weight(player);
  }
  return weights ? total / weights : 50;
};
const playmakerWeight = (player: MatchPlayer) =>
  ["CM", "DM", "AM"].includes(player.position) ? 2.2 : 1;
const defenderWeight = (player: MatchPlayer) =>
  ["CB", "DM", "LB", "RB"].includes(player.position) ? 2 : 1;
const shooterWeight = (player: MatchPlayer) =>
  player.position === "ST"
    ? 7
    : ["RW", "LW", "AM"].includes(player.position)
      ? 4
      : player.position === "CB"
        ? 0.4
        : player.position === "GK"
          ? 0
          : 1.2;
const assistWeight = (player: MatchPlayer) =>
  player.position === "GK"
    ? 0.05
    : ["CM", "DM", "AM"].includes(player.position)
      ? 2.2
      : ["RW", "LW"].includes(player.position)
        ? 1.6
        : player.position === "CB"
          ? 0.5
          : 1;

/** Mirrors the per-phase strength of match-v3 at the average in-match fatigue. */
export function fastStrength(team: MatchTeam) {
  return (
    team.lineup.reduce(
      (sum, player) =>
        sum +
        player.ability *
          (0.78 + clamp(player.fitness - FATIGUE_DROP, 0, 100) / 450),
      0,
    ) /
      11 +
    team.chemistry / 18 +
    team.momentum / 15
  );
}

/** Expected goals of both sides, derived from the same inputs that drive the full engine. */
export function fastExpectedGoals(snapshot: MatchSnapshot) {
  const teams = [snapshot.home, snapshot.away];
  const neutral = snapshot.rules?.neutral ?? false;
  const homeShare = clamp(
    0.5 +
      (fastStrength(teams[0]) - fastStrength(teams[1])) / 180 +
      (neutral ? 0 : 0.05) +
      (teams[0].style === "Possession" ? 0.04 : 0) -
      (teams[1].style === "Possession" ? 0.04 : 0),
    0.18,
    0.82,
  );
  // A side below seven players forfeits; an empty lineup has no keeper to read.
  if (teams.some((team) => team.lineup.length < 7)) return [0, 0, homeShare] as const;
  const weather =
    snapshot.weather === "Heavy rain" ? 0.03 : snapshot.weather === "Wind" ? 0.02 : 0;
  const sides = teams.map((team, index) => {
    const opponent = teams[1 - index];
    const attackers = outfield(team);
    const defenders = outfield(opponent);
    const keeper =
      opponent.lineup.find((player) => player.position === "GK") ??
      opponent.lineup[0];
    const fitness = weightedMean(attackers, (player) => player.fitness, () => 1);
    const pressing = opponent.style === "High press" ? 1 : 0.28;
    const passing =
      weightedMean(attackers, (player) => attribute(player, "passing"), playmakerWeight) -
      weightedMean(defenders, (player) => attribute(player, "positioning"), defenderWeight);
    const completion = clamp(
      0.86 +
        passing / 500 +
        (weightedMean(attackers, (player) => player.confidence ?? 65, () => 1) - 65) / 1000 -
        pressing * 0.025 -
        (100 - (fitness - FATIGUE_DROP)) / 800 -
        weather,
      0.5,
      0.96,
    ) - 0.025;
    const shots =
      completion * 0.029 +
      (1 - completion) * 0.008 +
      0.012 * (0.23 + team.setPieces.risk / 1000) * 0.75 +
      (team.style === "Counter attack" ? 0.004 * (1 - pressing) : 0);
    const finishing =
      weightedMean(attackers, (player) => attribute(player, "finishing"), shooterWeight) -
      attribute(keeper, "reflexes");
    return {
      chances: shots * (0.87 + (fitness - FATIGUE_DROP) / 770),
      quality: finishing + passing,
    };
  });
  // Log ratio of home to away goals and total goals, fitted to the full engine's outcomes.
  const ratio =
    4.52 * (homeShare - 0.5) + 0.0032 * (sides[0].quality - sides[1].quality);
  const total =
    FAST_GOAL_RATE * ((sides[0].chances + sides[1].chances) / 2) * (1 + 0.055 * Math.abs(ratio));
  const home = total / (1 + Math.exp(-ratio));
  return [Math.max(0.05, home), Math.max(0.05, total - home), homeShare] as const;
}

function poisson(random: Random, mean: number) {
  const limit = Math.exp(-mean);
  let product = random();
  let count = 0;
  while (product > limit && count < 20) {
    product *= random();
    count++;
  }
  return count;
}

function pickWeighted<Value>(
  random: Random,
  values: Value[],
  weight: (value: Value) => number,
) {
  let total = 0;
  for (const value of values) total += Math.max(0.01, weight(value));
  let remaining = random() * total;
  for (const value of values) {
    remaining -= Math.max(0.01, weight(value));
    if (remaining <= 0) return value;
  }
  return values.at(-1)!;
}

interface Stint {
  player: MatchPlayer;
  team: number;
  on: number;
  off: number;
}

/**
 * Statistical result for fixtures the user does not follow: Poisson goals from the engine's
 * possession and chance model, then scorers, cards, substitutions and injuries for season stats.
 */
export function simulateFastMatch(snapshot: MatchSnapshot, seed: string): MatchResult {
  const random = seedrandom(`${seed}:fast-v1`);
  const rules = snapshot.rules;
  const teams = [snapshot.home, snapshot.away];
  const result: MatchResult = {
    homeGoals: 0,
    awayGoals: 0,
    homeXg: 0,
    awayXg: 0,
    homeXpts: 0,
    awayXpts: 0,
    actions: [],
    stats: {},
    players: {},
    momentum: [],
    events: [],
    stoppageTime: [],
    wentToExtraTime: false,
    winnerId: null,
    substitutions: [],
    injuries: [],
  };
  const seen = new Set<number>();
  for (const team of teams) {
    result.stats[team.id] = { goals: 0, xG: 0, possession: 50, yellowCards: 0, redCards: 0 };
    for (const player of [...team.lineup, ...(team.bench ?? [])]) {
      if (seen.has(player.id)) throw new Error("A match squad contains duplicate players.");
      seen.add(player.id);
      result.players[player.id] = Object.fromEntries(STAT_KEYS.map((key) => [key, 0]));
    }
    if (team.lineup.length < 7 && !result.abandoned)
      result.abandoned = { teamId: team.id, reason: "Fewer than seven eligible players" };
  }
  const [homeXg, awayXg, homeShare] = fastExpectedGoals(snapshot);
  const firstAdded = 3 + Math.floor(random() * 4);
  const secondAdded = 7 + Math.floor(random() * 4);
  result.stoppageTime = [firstAdded, secondAdded];
  let duration = 90 + firstAdded + secondAdded;
  const event = (team: number, player: MatchPlayer, elapsed: number, type: string, text: string, playerOnId?: number) => {
    const period = elapsed <= 45 + firstAdded ? 1 : elapsed <= duration ? 2 : elapsed <= duration + 15 ? 3 : 4;
    result.events.push({
      minute: period === 1 ? Math.min(45, elapsed) : period === 2 ? Math.min(90, elapsed - firstAdded) : 90 + elapsed - duration,
      period,
      addedTime: period === 1 ? Math.max(0, elapsed - 45) : period === 2 ? Math.max(0, elapsed - firstAdded - 90) : 0,
      elapsed,
      second: 0,
      teamId: teams[team].id,
      playerId: player.id,
      type,
      text,
      ...(playerOnId ? { playerOnId } : {}),
    });
  };
  if (result.abandoned) {
    result.duration = 0;
    result.homeXpts = result.awayXpts = 0;
    return result;
  }

  const stints: Stint[] = teams.flatMap((team, index) =>
    team.lineup.map((player) => ({ player, team: index, on: 0, off: Infinity })),
  );
  const onPitch = (team: number, elapsed: number) =>
    stints.filter((stint) => stint.team === team && stint.on < elapsed && stint.off >= elapsed);
  const benches = teams.map((team) => [...(team.bench ?? [])]);
  const subsUsed = [0, 0];
  const substitute = (team: number, off: Stint, elapsed: number, window: number) => {
    if (subsUsed[team] >= (rules?.substitutions ?? 5)) return false;
    const replacement = benches[team]
      .filter((player) => (off.player.position === "GK") === (player.position === "GK"))
      .sort(
        (left, right) =>
          (right.position === off.player.position ? 20 : 0) + right.ability + right.fitness / 4 -
          ((left.position === off.player.position ? 20 : 0) + left.ability + left.fitness / 4),
      )[0];
    if (!replacement) return false;
    benches[team] = benches[team].filter((player) => player.id !== replacement.id);
    off.off = elapsed - 1;
    const on = { ...replacement, position: off.player.position };
    stints.push({ player: on, team, on: elapsed - 1, off: Infinity });
    subsUsed[team]++;
    const minute = Math.min(90, elapsed - firstAdded);
    result.substitutions!.push({ teamId: teams[team].id, offId: off.player.id, onId: on.id, minute, elapsed, window });
    event(team, off.player, elapsed, "substitution", `${on.name} replaces ${off.player.name}`, on.id);
    return true;
  };

  for (const team of [0, 1]) {
    const injuryChance =
      ((0.00075 * (rules?.injuryFrequency ?? 50)) / 50) * (snapshot.weather === "Heat" ? 1.2 : 1);
    if (random() < 1 - (1 - injuryChance) ** duration) {
      const elapsed = 2 + Math.floor(random() * (duration - 2));
      const players = onPitch(team, elapsed);
      const victim = players[Math.floor(random() * players.length)];
      if (victim) {
        const days = random() < 0.9 ? 3 + Math.floor(random() * 25) : 35 + Math.floor(random() * 120);
        result.injuries!.push({ playerId: victim.player.id, days });
        event(team, victim.player, elapsed, "injury", `${victim.player.name} cannot continue`);
        if (!substitute(team, victim, elapsed, 0)) victim.off = elapsed;
      }
    }
    const windows = [
      [60, 2],
      [72, 2],
      [82, 1],
    ] as const;
    for (const [index, [minute, count]] of windows.entries()) {
      const elapsed = minute + firstAdded;
      for (let change = 0; change < count; change++) {
        const tired = onPitch(team, elapsed)
          .filter((stint) => stint.player.position !== "GK" && elapsed - stint.on > 15)
          .sort(
            (left, right) =>
              left.player.fitness - attribute(left.player, "stamina") / 8 -
              (right.player.fitness - attribute(right.player, "stamina") / 8),
          )[0];
        if (!tired || !substitute(team, tired, elapsed, index + 1)) break;
      }
    }
  }

  for (const team of [0, 1]) {
    const discipline = weightedMean(teams[team].lineup, (player) => player.discipline ?? 60, () => 1);
    const opponentShare = team ? homeShare : 1 - homeShare;
    const fouls = duration * 8.4 * opponentShare * 0.026 * (1 + (60 - discipline) / 140);
    const direct = random() < 1 - Math.exp(-fouls * 0.004);
    const bookings = poisson(random, fouls * 0.2) + (direct ? 1 : 0);
    for (let card = 0; card < bookings; card++) {
      const elapsed = 1 + Math.floor(random() * duration);
      const candidates = onPitch(team, elapsed).filter((stint) => stint.player.position !== "GK");
      if (!candidates.length) continue;
      const stint = pickWeighted(random, candidates, (candidate) =>
        defenderWeight(candidate.player) *
        (1 + (60 - (candidate.player.discipline ?? 60)) / 140) *
        (result.players[candidate.player.id].yellowCards ? 0.2 : 1),
      );
      const stats = result.players[stint.player.id];
      const red = card === bookings - 1 && direct;
      if (red) {
        stats.redCards++;
        result.stats[teams[team].id].redCards++;
        event(team, stint.player, elapsed, "red card", `${stint.player.name} sent off (serious foul play)`);
        stint.off = elapsed;
        continue;
      }
      stats.yellowCards++;
      result.stats[teams[team].id].yellowCards++;
      event(team, stint.player, elapsed, "yellow card", `${stint.player.name} booked`);
      if (stats.yellowCards >= 2) {
        stats.redCards++;
        result.stats[teams[team].id].redCards++;
        event(team, stint.player, elapsed, "red card", `${stint.player.name} sent off (second caution)`);
        stint.off = elapsed;
      }
    }
  }

  const score = [0, 0];
  const scoreGoals = (team: number, count: number, from: number, to: number) => {
    for (let goal = 0; goal < count; goal++) {
      const elapsed = from + 1 + Math.floor(random() * Math.max(1, to - from));
      const players = onPitch(team, elapsed);
      const shooters = players.filter((stint) => stint.player.position !== "GK");
      if (!shooters.length) continue;
      const shooter = pickWeighted(random, shooters, (stint) =>
        shooterWeight(stint.player) * (1 + (attribute(stint.player, "finishing") - 60) / 350),
      );
      score[team]++;
      result.players[shooter.player.id].goals++;
      result.stats[teams[team].id].goals++;
      event(team, shooter.player, elapsed, "goal", `${shooter.player.name} scores`);
      const helpers = players.filter((stint) => stint.player.id !== shooter.player.id);
      if (helpers.length && random() < FAST_ASSIST_SHARE)
        result.players[pickWeighted(random, helpers, (stint) => assistWeight(stint.player)).player.id].assists++;
    }
  };
  scoreGoals(0, poisson(random, homeXg), 0, duration);
  scoreGoals(1, poisson(random, awayXg), 0, duration);
  result.regulationScore = { home: score[0], away: score[1] };
  const aggregate = rules?.aggregate ?? { home: 0, away: 0, homeAwayGoals: 0, awayAwayGoals: 0 };
  const winner = () => {
    const home = score[0] + aggregate.home;
    const away = score[1] + aggregate.away;
    if (home !== away) return home > away ? teams[0].id : teams[1].id;
    if (rules?.awayGoals && aggregate.homeAwayGoals !== aggregate.awayAwayGoals + score[1])
      return aggregate.homeAwayGoals > aggregate.awayAwayGoals + score[1] ? teams[0].id : teams[1].id;
    return null;
  };
  let xgScale = 1;
  if (rules?.decisive && rules.extraTime && !winner()) {
    result.wentToExtraTime = true;
    result.stoppageTime.push(0, 1);
    const start = duration;
    duration += 31;
    xgScale += 31 / 95;
    scoreGoals(0, poisson(random, homeXg * 0.3), start, duration);
    scoreGoals(1, poisson(random, awayXg * 0.3), start, duration);
  }
  result.winnerId = winner();
  if (rules?.decisive && !result.winnerId) {
    const takers = [0, 1].map((team) =>
      onPitch(team, duration).map((stint) => stint.player).sort(
        (left, right) => attribute(right, "penalties") - attribute(left, "penalties"),
      ),
    );
    const count = Math.max(1, Math.min(takers[0].length, takers[1].length));
    const scores = [0, 0];
    const kicks: NonNullable<MatchResult["shootout"]>["kicks"] = [];
    for (let kick = 0; kick < 200; kick++) {
      const team = kick % 2;
      const roundNumber = Math.floor(kick / 2);
      const taker = takers[team][roundNumber % count] ?? teams[team].lineup[0];
      const keeper = takers[1 - team].find((player) => player.position === "GK") ?? taker;
      const probability = clamp(
        0.76 +
          (attribute(taker, "penalties") - attribute(keeper, "reflexes")) / 550 +
          ((taker.pressureHandling ?? 50) - 50) / 1250,
        0.5,
        0.94,
      );
      const scored = random() < probability;
      if (scored) scores[team]++;
      kicks.push({ teamId: teams[team].id, playerId: taker.id, scored, probability });
      const takenHome = Math.ceil(kicks.length / 2);
      const takenAway = Math.floor(kicks.length / 2);
      if (roundNumber < 5 && (scores[0] > scores[1] + 5 - takenAway || scores[1] > scores[0] + 5 - takenHome)) break;
      if (roundNumber >= 4 && team === 1 && scores[0] !== scores[1]) break;
    }
    result.shootout = { home: scores[0], away: scores[1], kicks };
    result.winnerId = teams[scores[0] > scores[1] ? 0 : 1].id;
  }

  result.duration = duration;
  result.homeGoals = score[0];
  result.awayGoals = score[1];
  result.homeXg = round(homeXg * xgScale, 2);
  result.awayXg = round(awayXg * xgScale, 2);
  result.stats[teams[0].id].possession = Math.round(homeShare * 100);
  result.stats[teams[1].id].possession = 100 - result.stats[teams[0].id].possession;
  result.stats[teams[0].id].xG = result.homeXg;
  result.stats[teams[1].id].xG = result.awayXg;
  for (const stint of stints) {
    const stats = result.players[stint.player.id];
    stats.minutes += Math.max(0, Math.min(stint.off, duration) - stint.on);
  }
  for (const [index, team] of teams.entries()) {
    const difference = score[index] - score[1 - index];
    for (const player of [...team.lineup, ...(team.bench ?? [])]) {
      const stats = result.players[player.id];
      if (!stats.minutes) continue;
      const involvement = Math.min(1, stats.minutes / 90);
      stats.rating = round(
        clamp(
          6.3 +
            involvement * (0.11 + (random() + random() + random() - 1.5) * 0.45) +
            stats.goals * 0.8 +
            stats.assists * 0.45 -
            stats.yellowCards * 0.15 -
            stats.redCards * 1.2 +
            difference * 0.12,
          1,
          10,
        ),
      );
    }
  }
  [result.homeXpts, result.awayXpts] = expectedPoints(result.homeXg, result.awayXg);
  result.events.sort((left, right) => (left.elapsed ?? 0) - (right.elapsed ?? 0));
  return result;
}
