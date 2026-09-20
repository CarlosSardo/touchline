import seedrandom from "seedrandom";
import { poissonDistribution } from "simple-statistics";
import { clamp, round } from "../shared/rules.ts";
import type {
  MatchAction,
  MatchPlayer,
  MatchResult,
  MatchSnapshot,
  MatchTeam,
} from "../shared/types.ts";

const statKeys = [
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
  "rating",
  "minutes",
];
const newStats = () => Object.fromEntries(statKeys.map((key) => [key, 0]));

export function expectedPoints(homeXg: number, awayXg: number) {
  const home = poissonDistribution(Math.max(0.001, homeXg));
  const away = poissonDistribution(Math.max(0.001, awayXg));
  let homePoints = 0;
  let awayPoints = 0;
  for (const [homeGoals, homeProbability] of Object.entries(home)) {
    for (const [awayGoals, awayProbability] of Object.entries(away)) {
      const probability = Number(homeProbability) * Number(awayProbability);
      if (Number(homeGoals) > Number(awayGoals)) homePoints += probability * 3;
      else if (Number(homeGoals) < Number(awayGoals))
        awayPoints += probability * 3;
      else {
        homePoints += probability;
        awayPoints += probability;
      }
    }
  }
  return [round(homePoints, 3), round(awayPoints, 3)];
}

export function simulateMatch(
  snapshot: MatchSnapshot,
  seed: string,
  retainActions = true,
): MatchResult {
  const random = seedrandom(seed);
  const enhanced = (snapshot.rulesVersion ?? 1) >= 2;
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
  };
  const teams = [snapshot.home, snapshot.away];
  const possessionCounts: Record<number, number> = {
    [teams[0].id]: 0,
    [teams[1].id]: 0,
  };
  const pressure: Record<number, number> = {
    [teams[0].id]: 0,
    [teams[1].id]: 0,
  };
  const pick = <Value>(values: Value[]) =>
    values[Math.floor(random() * values.length)];
  for (const team of teams) {
    result.stats[team.id] = newStats();
    for (const player of team.lineup)
      result.players[player.id] = { ...newStats(), minutes: 90 };
  }
  const fieldPlayers = (team: MatchTeam) =>
    team.lineup.filter((player) => player.position !== "GK");
  const outfields = teams.map(fieldPlayers);
  const goalkeepers = teams.map(
    (team) =>
      team.lineup.find((player) => player.position === "GK") ?? team.lineup[0],
  );
  const action = (
    team: MatchTeam,
    player: MatchPlayer,
    minute: number,
    second: number,
    type: string,
    outcome: string,
    x: number,
    y: number,
    endX = x,
    endY = y,
    difficulty = 50,
    extras: Partial<MatchAction> = {},
  ) => {
    const home = team.id === snapshot.home.id;
    const fatigue = clamp(
      player.fitness -
        minute * (team.style === "High press" ? 0.34 : 0.24) -
        (snapshot.weather === "Heat" ? minute * 0.1 : 0),
      0,
      100,
    );
    const event: MatchAction = {
      minute,
      second,
      teamId: team.id,
      playerId: player.id,
      x: round(home ? x : 100 - x),
      y: round(y),
      endX: round(home ? endX : 100 - endX),
      endY: round(endY),
      type,
      outcome,
      difficulty: Math.round(clamp(difficulty)),
      fatigue: round(fatigue),
      ...extras,
    };
    if (retainActions) result.actions.push(event);
    return event;
  };
  const bump = (
    team: MatchTeam,
    player: MatchPlayer,
    key: string,
    value = 1,
  ) => {
    result.stats[team.id][key] += value;
    result.players[player.id][key] += value;
  };
  const homeAdvantage = 0.035;
  let lastGoal = 0;
  for (let minute = 1; minute <= 90; minute++) {
    const phases = (enhanced ? 6 : 4) + Math.floor(random() * 4);
    for (let phase = 0; phase < phases; phase++) {
      const homeStrength =
        snapshot.home.ability +
        (snapshot.home.chemistry - 50) * 0.1 +
        snapshot.home.momentum * 0.06;
      const awayStrength =
        snapshot.away.ability +
        (snapshot.away.chemistry - 50) * 0.1 +
        snapshot.away.momentum * 0.06;
      const homePossession = clamp(
        0.5 +
          (homeStrength - awayStrength) / 160 +
          homeAdvantage +
          (snapshot.home.style === "Possession" ? 0.05 : 0) -
          (snapshot.away.style === "Possession" ? 0.05 : 0) +
          (enhanced
            ? clamp(
                (pressure[snapshot.home.id] - pressure[snapshot.away.id]) /
                  1600,
                -0.06,
                0.06,
              )
            : 0),
        0.23,
        0.77,
      );
      const teamIndex = random() < homePossession ? 0 : 1;
      const team = teams[teamIndex];
      const opponent = teams[1 - teamIndex];
      const player = pick(
        outfields[teamIndex].length ? outfields[teamIndex] : team.lineup,
      );
      const defender = pick(
        outfields[1 - teamIndex].length
          ? outfields[1 - teamIndex]
          : opponent.lineup,
      );
      const keeper = goalkeepers[1 - teamIndex];
      if (!player || !defender || !keeper) continue;
      possessionCounts[team.id]++;
      const second = Math.floor((phase * 60) / phases);
      const baseX = 12 + random() * 78;
      const baseY = 5 + random() * 90;
      const zones: Record<string, [number, number]> = {
        CB: [32, 50],
        LB: [42, 16],
        RB: [42, 84],
        DM: [43, 50],
        CM: [56, 50],
        AM: [70, 50],
        LW: [72, 17],
        RW: [72, 83],
        ST: [82, 50],
        GK: [8, 50],
      };
      const zone = zones[player.position] ?? [50, 50];
      const x = enhanced
        ? clamp(
            baseX * 0.48 +
              zone[0] * 0.52 +
              (team.style === "High press" ? 4 : 0),
            2,
            96,
          )
        : baseX;
      const y = enhanced ? clamp(baseY * 0.5 + zone[1] * 0.5, 3, 97) : baseY;
      const fatiguePenalty = minute / 600 + (100 - player.fitness) / 400;
      const scoreDifference =
        result.stats[team.id].goals - result.stats[opponent.id].goals;
      const psychology =
        (player.confidence - 60) / 600 -
        (team.pressure * snapshot.importance) / (enhanced ? 50000 : 20000) +
        (minute > 70 && scoreDifference < 0 ? 0.035 : 0) +
        (enhanced
          ? (((player.pressureHandling ?? 50) - 50) * snapshot.importance) /
              60000 +
            (player.traits?.includes("Big-game player") &&
            snapshot.importance > 70
              ? 0.06
              : 0) +
            (player.consistency ?? 60) / 4000 -
            0.015
          : 0);
      const weatherPenalty =
        snapshot.weather === "Heavy rain"
          ? 0.06
          : snapshot.weather === "Wind"
            ? 0.035
            : 0;
      const success = clamp(
        (enhanced ? 0.88 : 0.73) +
          ((enhanced
            ? (player.attributes?.passing ?? player.ability)
            : player.ability) -
            defender.ability) /
            170 +
          psychology -
          fatiguePenalty * 0.25 -
          weatherPenalty,
        0.45,
        0.94,
      );
      const press =
        opponent.style === "High press" ||
        (enhanced && defender.traits?.includes("Aggressive presser")) ||
        random() < 0.34;
      if (press) {
        bump(opponent, defender, "presses");
        action(
          opponent,
          defender,
          minute,
          second,
          "press",
          random() < 0.35 ? "effective" : "bypassed",
          100 - x,
          y,
          100 - x,
          y,
          player.ability,
        );
      }
      const carry = random() < 0.32;
      if (carry) {
        bump(team, player, "carries");
        action(
          team,
          player,
          minute,
          second,
          "carry",
          "complete",
          x,
          y,
          clamp(x + 5 + random() * 17, 0, 100),
          clamp(
            y +
              random() * 16 -
              8 +
              (enhanced && player.traits?.includes("Cuts inside")
                ? (50 - y) * 0.45
                : 0),
            0,
            100,
          ),
          defender.ability * 0.7,
        );
      }
      if (
        random() <
        (enhanced && player.traits?.includes("Dribbles often") ? 0.24 : 0.1)
      ) {
        bump(team, player, "dribbles");
        bump(opponent, defender, "duels");
        bump(team, player, "duels");
        const won = random() < success - 0.2;
        if (won) {
          bump(team, player, "successfulDribbles");
          bump(team, player, "duelsWon");
        } else {
          bump(opponent, defender, "duelsWon");
          bump(opponent, defender, "tackles");
        }
        action(
          team,
          player,
          minute,
          second,
          "dribble",
          won ? "won" : "lost",
          x,
          y,
          clamp(x + 9, 0, 100),
          clamp(y + random() * 12 - 6, 0, 100),
          defender.ability,
        );
        action(
          opponent,
          defender,
          minute,
          second,
          "tackle",
          won ? "missed" : "won",
          100 - x,
          y,
          100 - x,
          y,
          player.ability,
        );
      }
      const target =
        pick(
          outfields[teamIndex].filter((teammate) => teammate.id !== player.id),
        ) ?? player;
      const passEndX = clamp(x + random() * 44 - 14, 1, 98);
      const passEndY = clamp(y + random() * 50 - 25, 1, 99);
      const passLength = Math.hypot(passEndX - x, passEndY - y);
      const completed = random() < success - passLength / 600;
      const progressive = passEndX - x >= 10;
      bump(team, player, "passes");
      const passAction = action(
        team,
        player,
        minute,
        second,
        "pass",
        completed ? "complete" : "incomplete",
        x,
        y,
        passEndX,
        passEndY,
        20 + passLength + (press ? 15 : 0),
        { targetId: target.id, progressive },
      );
      if (completed) {
        bump(team, player, "completedPasses");
        if (progressive) bump(team, player, "progressivePasses");
      } else {
        bump(
          opponent,
          defender,
          random() < 0.6 ? "interceptions" : "recoveries",
        );
        action(
          opponent,
          defender,
          minute,
          second,
          "interception",
          "won",
          100 - passEndX,
          passEndY,
          100 - passEndX,
          passEndY,
          player.ability,
        );
        action(
          opponent,
          defender,
          minute,
          second,
          "recovery",
          "won",
          100 - passEndX,
          passEndY,
          100 - passEndX,
          passEndY,
          25,
        );
      }
      const setPiece = random() < (enhanced ? 0.018 : 0.026);
      if (setPiece) {
        bump(team, player, "corners");
        action(
          team,
          player,
          minute,
          second,
          "set piece",
          team.setPieces.routine,
          99,
          random() < 0.5 ? 0 : 100,
          team.setPieces.routine === "Short corner" ? 87 : 94,
          team.setPieces.routine === "Far post" ? 63 : 43,
          62,
        );
      }
      const shootingChance =
        (enhanced ? 0.031 : 0.044) +
        (setPiece ? 0.32 + team.setPieces.risk / 800 : 0) +
        (team.style === "Counter attack" && !press ? 0.01 : 0) +
        (minute > 75 && scoreDifference < 0 ? 0.01 : 0);
      if (random() < shootingChance) {
        let shooter =
          setPiece && team.setPieces.target === "Centre-back"
            ? (team.lineup.find((candidate) => candidate.position === "CB") ??
              target)
            : target;
        if (enhanced) {
          const targetPosition =
            team.setPieces.target === "Striker"
              ? "ST"
              : team.setPieces.target === "Midfielder"
                ? "CM"
                : "CB";
          if (setPiece)
            shooter =
              team.lineup.find(
                (candidate) => candidate.position === targetPosition,
              ) ?? target;
          else if (!["ST", "LW", "RW", "AM"].includes(target.position))
            shooter =
              team.lineup.find((candidate) => candidate.position === "ST") ??
              target;
        }
        const shotX = setPiece
          ? enhanced && team.setPieces.routine === "Edge of box"
            ? 78 + random() * 4
            : 91 + random() * 5
          : enhanced && shooter.traits?.includes("Shoots from distance")
            ? 70 + random() * 13
            : 74 + random() * 23;
        const shotY = 29 + random() * 42;
        const distance = Math.hypot((100 - shotX) * 1.05, (50 - shotY) * 0.68);
        const angle = Math.max(0.22, 1 - Math.abs(shotY - 50) / 34);
        const xg = round(
          clamp(
            0.32 * Math.exp(-distance / 20) * angle + (setPiece ? 0.015 : 0),
            0.015,
            0.65,
          ),
          3,
        );
        const chance = clamp(
          xg *
            (1 +
              ((enhanced
                ? (shooter.attributes?.finishing ?? shooter.ability)
                : shooter.ability) -
                (enhanced
                  ? (keeper.attributes?.reflexes ?? keeper.ability)
                  : keeper.ability)) /
                170 +
              psychology),
          0.01,
          0.8,
        );
        const goal = random() < chance;
        const onTarget = goal || random() < 0.34;
        bump(team, shooter, "shots");
        bump(team, shooter, "xG", xg);
        if (completed) {
          bump(team, player, "keyPasses");
          bump(team, player, "xA", xg);
          passAction.key = true;
          passAction.xa = xg;
          if (enhanced) passAction.targetId = shooter.id;
        }
        if (onTarget) bump(team, shooter, "shotsOnTarget");
        action(
          team,
          shooter,
          minute,
          Math.min(59, second + 1),
          "shot",
          goal
            ? "goal"
            : onTarget
              ? "saved"
              : random() < 0.4
                ? "blocked"
                : "off target",
          shotX,
          shotY,
          100,
          45 + random() * 10,
          100 - chance * 100,
          { xg },
        );
        pressure[team.id] += 12 + xg * 80;
        if (onTarget)
          bump(opponent, keeper, "xGPrevented", xg - (goal ? 1 : 0));
        if (goal) {
          bump(team, shooter, "goals");
          if (completed && shooter.id !== player.id)
            bump(team, player, "assists");
          lastGoal = minute;
          result.events.push({
            minute,
            type: "goal",
            teamId: team.id,
            playerId: shooter.id,
            text: `${shooter.name}${setPiece ? ` from a ${team.setPieces.routine.toLowerCase()} routine` : ""}`,
          });
        } else if (onTarget) {
          bump(opponent, keeper, "saves");
          action(
            opponent,
            keeper,
            minute,
            Math.min(59, second + 2),
            "save",
            "saved",
            2,
            50,
            8,
            shotY,
            shooter.ability,
            { xg },
          );
        }
      }
      if (random() < 0.025) {
        bump(opponent, defender, "fouls");
        action(
          opponent,
          defender,
          minute,
          second,
          "foul",
          "free kick",
          100 - x,
          y,
          100 - x,
          y,
          50,
        );
        if (random() < 0.28)
          result.events.push({
            minute,
            type: "yellow card",
            teamId: opponent.id,
            playerId: defender.id,
            text: `${defender.name} booked`,
          });
      }
      pressure[team.id] += progressive && completed ? 2 : 0.4;
    }
    if (minute % 5 === 0) {
      result.momentum.push({
        minute,
        home: round(
          clamp(
            pressure[teams[0].id] + (lastGoal >= minute - 5 ? 3 : 0),
            0,
            100,
          ),
        ),
        away: round(clamp(pressure[teams[1].id], 0, 100)),
      });
      pressure[teams[0].id] *= 0.45;
      pressure[teams[1].id] *= 0.45;
    }
  }
  const totalPossessions =
    possessionCounts[teams[0].id] + possessionCounts[teams[1].id];
  for (const team of teams) {
    result.stats[team.id].possession = Math.round(
      (possessionCounts[team.id] / Math.max(1, totalPossessions)) * 100,
    );
    result.stats[team.id].xG = round(result.stats[team.id].xG, 2);
    result.stats[team.id].xA = round(result.stats[team.id].xA, 2);
    result.stats[team.id].xGPrevented = round(
      result.stats[team.id].xGPrevented,
      2,
    );
    for (const player of team.lineup) {
      const stats = result.players[player.id];
      stats.rating = round(
        clamp(
          6.1 +
            stats.goals * 0.75 +
            stats.assists * 0.42 +
            stats.tackles * 0.05 +
            stats.saves * 0.08 +
            stats.completedPasses * 0.004 -
            (stats.passes - stats.completedPasses) * 0.018 +
            (team.id === teams[0].id
              ? result.stats[teams[0].id].goals -
                result.stats[teams[1].id].goals
              : result.stats[teams[1].id].goals -
                result.stats[teams[0].id].goals) *
              0.14,
          3,
          10,
        ),
      );
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
    (left, right) => left.minute - right.minute || left.second - right.second,
  );
  result.events.sort((left, right) => left.minute - right.minute);
  return result;
}
