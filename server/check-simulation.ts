import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { simulateMatch } from "./match.ts";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import { checkSqlConstraints } from "./check-world.ts";
import { advance } from "./simulation.ts";
import { stateOf } from "./systems.ts";
import { daysBetween } from "../shared/rules.ts";
import type { MatchTeam, Position } from "../shared/types.ts";

export const CALIBRATION_REFERENCE = {
  source: "openfootball/football.json",
  license: "CC0-1.0",
  revision: "40b3e1b7391932d133287115106304444bf297e1",
  samples: [
    {
      season: "2023-24",
      matches: 380,
      goals: 1246,
      homeWins: 175,
      draws: 82,
      awayWins: 123,
      sha256:
        "03e13eafbf78dfe00d7e89dd3bf6643986eb6e8fd86c7664aeb8c5bc0bed88d0",
    },
    {
      season: "2024-25",
      matches: 380,
      goals: 1115,
      homeWins: 155,
      draws: 93,
      awayWins: 132,
      sha256:
        "c3d18f552d83382cd4b6b21127adbbfe38e7f8618ddc979fb5404f2df07d0a75",
    },
  ],
};

function referenceTeam(id: number, ability: number): MatchTeam {
  const positions: Position[] = [
    "GK",
    "RB",
    "CB",
    "CB",
    "LB",
    "DM",
    "CM",
    "AM",
    "RW",
    "ST",
    "LW",
  ];
  return {
    id,
    name: `Calibration ${id}`,
    color: "#087f6d",
    ability,
    style: "Balanced",
    formation: "4-3-3",
    chemistry: 70,
    momentum: 0,
    pressure: 30,
    lineup: positions.map((position, index) => ({
      id: id * 100 + index,
      name: `Player ${id}-${index}`,
      position,
      ability,
      fitness: 95,
      confidence: 70,
    })),
    bench: positions.slice(0, 9).map((position, index) => ({
      id: id * 100 + 20 + index,
      name: `Substitute ${id}-${index}`,
      position,
      ability: ability - 1,
      fitness: 99,
      confidence: 70,
    })),
    setPieces: { routine: "Near post", target: "Centre-back", risk: 50 },
  };
}

export function calibrationSample(matches = 600) {
  const totals = {
    goals: 0,
    expectedGoals: 0,
    shots: 0,
    passes: 0,
    completed: 0,
    homeWins: 0,
    awayWins: 0,
    draws: 0,
    redCards: 0,
    yellowCards: 0,
  };
  for (let index = 0; index < matches; index++) {
    const homeAbility = 65 + (index % 21);
    const awayAbility = 65 + ((index * 7 + 3) % 21);
    const result = simulateMatch(
      {
        rulesVersion: 3,
        home: referenceTeam(1, homeAbility),
        away: referenceTeam(2, awayAbility),
        weather: "Clear",
        importance: 60,
        detail: "full",
      },
      `calibration-${index}`,
      false,
    );
    totals.goals += result.homeGoals + result.awayGoals;
    totals.expectedGoals += result.homeXg + result.awayXg;
    for (const side of [1, 2]) {
      totals.shots += result.stats[side].shots;
      totals.passes += result.stats[side].passes;
      totals.completed += result.stats[side].completedPasses;
      totals.redCards += result.stats[side].redCards;
      totals.yellowCards += result.stats[side].yellowCards;
    }
    totals[
      result.homeGoals > result.awayGoals
        ? "homeWins"
        : result.homeGoals < result.awayGoals
          ? "awayWins"
          : "draws"
    ]++;
  }
  const reference = {
    matches: 760,
    goalsPerMatch: 2361 / 760,
    homeWinRate: 330 / 760,
    drawRate: 175 / 760,
  };
  const report = {
    matches,
    goalsPerMatch: totals.goals / matches,
    expectedGoalsPerMatch: totals.expectedGoals / matches,
    shotsPerMatch: totals.shots / matches,
    passesPerMatch: totals.passes / matches,
    passCompletion: totals.completed / totals.passes,
    homeWinRate: totals.homeWins / matches,
    awayWinRate: totals.awayWins / matches,
    drawRate: totals.draws / matches,
    redCardsPerMatch: totals.redCards / matches,
    yellowCardsPerMatch: totals.yellowCards / matches,
    reference,
  };
  assert(
    Math.abs(report.goalsPerMatch - reference.goalsPerMatch) < 0.45,
    "Goals per match outside the recorded reference envelope",
  );
  assert(
    Math.abs(report.homeWinRate - reference.homeWinRate) < 0.07,
    "Home advantage outside the recorded reference envelope",
  );
  assert(
    Math.abs(report.drawRate - reference.drawRate) < 0.07,
    "Draw rate outside the recorded reference envelope",
  );
  assert(report.homeWinRate > report.awayWinRate, "Home advantage is missing");
  assert(
    report.passCompletion >= 0.7 && report.passCompletion <= 0.9,
    "Pass completion outside sanity limits",
  );
  assert(
    report.redCardsPerMatch >= 0.03 && report.redCardsPerMatch <= 0.3,
    "Dismissal frequency outside sanity limits",
  );
  assert(
    Math.abs(report.goalsPerMatch - report.expectedGoalsPerMatch) < 0.35,
    "Goals and expected goals are not calibrated",
  );
  return report;
}

export async function seasonSoak(seasons: number, fullWorld = false) {
  assert(
    Number.isInteger(seasons) && seasons > 0,
    "Choose a positive number of seasons",
  );
  const store = await Store.createTest("simulation-check");
  try {
    assert(
      store.testMode && store.schemaName !== "dbo",
      "Simulation checks cannot use gameplay schemas",
    );
    await store.schema();
    await generateWorld(
      store,
      fullWorld ? {} : { countryLimit: 2, seniors: 2200, youth: 800 },
    );
    await store.setMeta("settings", {
      ...(await store.meta<Record<string, unknown>>("settings")),
      autosave: "off",
    });
    const end = `${2026 + seasons}-07-02`;
    let expectedPlayers = (await store.get<{ total: number }>(
      "SELECT count(*) AS total FROM players",
    ))!.total;
    let simulated = 0;
    let weeks = 0;
    while ((await stateOf(store)).date < end) {
      const current = await stateOf(store);
      if (current.gameOver)
        await store.setMeta("state", { ...current, gameOver: false });
      const result = await advance(
        store,
        Math.min(7, daysBetween(current.date, end)),
      );
      if ((await stateOf(store)).season !== current.season)
        expectedPlayers += (await store.meta<{ count: number }>("lastIntake"))
          .count;
      simulated += result.matches;
      weeks++;
      const invalid = (await store.get<{ total: number }>(
        "SELECT count(*) AS total FROM players WHERE ability < 1 OR ability > 99 OR potential < ability OR potential > 99 OR morale < 0 OR morale > 100",
      ))!.total;
      assert.equal(invalid, 0, `Player invariants failed on ${result.date}`);
      const badTable = (await store.get<{ total: number }>(
        "SELECT count(*) AS total FROM standings WHERE played != wins + draws + losses OR points != wins * 3 + draws - deducted",
      ))!.total;
      assert.equal(badTable, 0, `Table conservation failed on ${result.date}`);
      if (weeks % 13 === 0)
        console.log(
          `Soak ${result.date}: ${simulated} matches; ${(await store.get<{ total: number }>("SELECT count(*) AS total FROM players"))!.total} player records`,
        );
    }
    assert.equal(
      (await store.get<{ total: number }>(
        "SELECT count(*) AS total FROM players",
      ))!.total,
      expectedPlayers,
    );
    await checkSqlConstraints(store);
    const result = {
      seasons,
      fullWorld,
      date: (await stateOf(store)).date,
      matches: simulated,
      players: (await store.get<{ total: number }>(
        "SELECT count(*) AS total FROM players",
      ))!.total,
      archivedLeagueSeasons: (await store.get<{ total: number }>(
        "SELECT count(*) AS total FROM history WHERE entity_type = 'league'",
      ))!.total,
      closedFinancialPeriods: (await store.get<{ total: number }>(
        "SELECT count(*) AS total FROM financial_periods WHERE closed = 1",
      ))!.total,
      integrity: "ok",
    };
    return result;
  } finally {
    await store.close();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const seasons = Number(
    process.argv
      .find((value) => value.startsWith("--seasons="))
      ?.split("=")[1] ?? 0,
  );
  const fullWorld = process.argv.includes("--full-world");
  const start = performance.now();
  console.log(
    JSON.stringify(
      {
        calibration: calibrationSample(),
        ...(seasons > 0 ? { soak: await seasonSoak(seasons, fullWorld) } : {}),
        seconds: Math.round((performance.now() - start) / 1000),
      },
      null,
      2,
    ),
  );
}
