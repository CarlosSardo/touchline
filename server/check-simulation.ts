import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { simulateMatch } from "./match.ts";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import { checkSqlConstraints } from "./check-world.ts";
import { advance } from "./simulation.ts";
import { stateOf } from "./systems.ts";
import { firstTeamCap, INTAKE, SQUAD_CAPS } from "./youth.ts";
import {
  clubRegistration,
  familyResidence,
  heldNationalities,
  minorPresenceLegal,
} from "./registration.ts";
import { databaseFootprint, FOOTPRINT_BUDGET } from "./retention.ts";
import { ageOn, daysBetween, VALUE_RANGE } from "../shared/rules.ts";
import { MIN_GOALKEEPERS, SQUAD_MINIMUMS } from "../shared/world-rules.ts";
import type { MatchTeam, PlayerProfile, Position } from "../shared/types.ts";

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

/** Default soak subset: B-teams and EU rules (PT), a cross-border club (NIR → IE), UK rules (SCO), a home pool (FO). */
export const SOAK_NATIONS = ["PT", "IE", "NIR", "SCO", "FO"] as const;

const activePlayers = async (store: Store) =>
  (await store.get<{ total: number }>(
    "SELECT count(*) AS total FROM players WHERE role != 'Retired'",
  ))!.total;

/** Same report as `npm run db:footprint`; a season growing the world by more than the budget is flagged. */
export async function reportFootprint(store: Store, label: string, previousMB?: number) {
  const [footprint] = await databaseFootprint(store);
  const seasonMB = previousMB === undefined ? undefined : Math.round((footprint.worldMB - previousMB) * 10) / 10;
  const over = seasonMB !== undefined && seasonMB > FOOTPRINT_BUDGET.seasonMB;
  const largest = footprint.tables.slice(0, 4).map((table) => `${table.table} ${table.reservedMB}`).join(", ");
  console.log(
    `Footprint ${label}: world ${footprint.worldMB} MB, ${footprint.rows} rows` +
      (seasonMB === undefined ? "" : `, ${seasonMB >= 0 ? "+" : ""}${seasonMB} MB this season`) +
      (over ? ` OVER the ${FOOTPRINT_BUDGET.seasonMB} MB season budget` : "") +
      ` (largest: ${largest})`,
  );
  if (over && process.env.GITHUB_ACTIONS === "true")
    console.log(`::warning title=DB footprint::${label} added ${seasonMB} MB (budget ${FOOTPRINT_BUDGET.seasonMB} MB).`);
  return { worldMB: footprint.worldMB, seasonMB };
}

/** Section 8 squad invariant: minimums with two goalkeepers everywhere, youth and AI first-team caps. */
export async function checkSquads(store: Store, label: string) {
  const state = await stateOf(store);
  const rows = await store.all<{
    id: number;
    type: string;
    parent_id: number | null;
    league_code: string | null;
    tier: number | null;
    squad: "Senior" | "U19" | "U17";
    players: number;
    keepers: number;
    contracted: number;
  }>(
    "SELECT clubs.id,clubs.type,clubs.parent_id,league_country.code AS league_code,leagues.tier,squads.squad,count(players.id) AS players,coalesce(sum(CASE WHEN players.position = 'GK' THEN 1 ELSE 0 END),0) AS keepers,coalesce(sum(CASE WHEN players.parent_club_id IS NULL THEN 1 ELSE 0 END),0) AS contracted FROM clubs CROSS APPLY (VALUES ('Senior'),('U19'),('U17')) AS squads(squad) LEFT JOIN leagues ON leagues.id = clubs.league_id LEFT JOIN countries AS league_country ON league_country.id = leagues.country_id LEFT JOIN players ON coalesce(players.squad_club_id,players.club_id) = clubs.id AND players.age_group = squads.squad AND players.role != 'Retired' WHERE clubs.type = 'club' OR (clubs.type = 'bteam' AND squads.squad = 'Senior') GROUP BY clubs.id,clubs.type,clubs.parent_id,league_country.code,leagues.tier,squads.squad",
  );
  const failures: string[] = [];
  for (const row of rows) {
    const minimum = row.type === "bteam" ? SQUAD_MINIMUMS.BTeam : SQUAD_MINIMUMS[row.squad];
    if (row.players < minimum || row.keepers < MIN_GOALKEEPERS)
      failures.push(`${row.type} ${row.id} ${row.squad}: ${row.players} players, ${row.keepers} GK`);
    const ai = row.id !== state.clubId && row.parent_id !== state.clubId;
    if (ai && row.squad !== "Senior" && row.contracted > SQUAD_CAPS.youth)
      failures.push(`club ${row.id} ${row.squad}: ${row.contracted} over the youth cap`);
    if (ai && row.type === "club" && row.squad === "Senior" && row.contracted > firstTeamCap(row.league_code, row.tier))
      failures.push(`club ${row.id}: ${row.contracted} seniors over the AI cap`);
  }
  assert.equal(failures.length, 0, `Squad invariants failed (${label}): ${failures.slice(0, 8).join("; ")}`);
  return rows.length;
}

/** Every minor's registration could have been made under Article 19 (nationality, residence, family move, 16+ EU/UK). */
export async function checkMinors(store: Store, date: string) {
  const cutoff = `${Number(date.slice(0, 4)) - 18}${date.slice(4)}`;
  const codes = new Map((await store.all<{ id: number; code: string }>("SELECT id,code FROM countries")).map((row) => [row.id, row.code]));
  const minors = await store.all<{
    id: number;
    birth_date: string;
    code: string;
    club_code: string;
    club_data: string;
    identity: string;
    family: string | null;
  }>(
    "SELECT players.id,players.birth_date,countries.code,club_country.code AS club_code,clubs.data AS club_data,JSON_QUERY(players.profile,'$.identity') AS [identity],JSON_QUERY(players.profile,'$.familyMove') AS family FROM players JOIN countries ON countries.id = players.country_id JOIN clubs ON clubs.id = players.club_id JOIN countries AS club_country ON club_country.id = clubs.country_id WHERE players.birth_date > ? AND players.role != 'Retired' AND clubs.type != 'national'",
    cutoff,
  );
  const illegal = minors.filter((minor) => {
    const profile = {
      identity: JSON.parse(minor.identity) as PlayerProfile["identity"],
      ...(minor.family ? { familyMove: JSON.parse(minor.family) as PlayerProfile["familyMove"] } : {}),
    };
    return !minorPresenceLegal({
      age: ageOn(minor.birth_date, date),
      nationalities: heldNationalities(minor.code, profile),
      destination: clubRegistration(minor.club_code, minor.club_data),
      residence: familyResidence(profile, minor.birth_date, date, (id) => codes.get(id)),
    });
  });
  assert.equal(illegal.length, 0, `Illegal U18 registrations on ${date}: players ${illegal.slice(0, 10).map((minor) => minor.id).join(",")}`);
  return minors.length;
}

/** Heights of players under 21: within bounds, and never lower than at the previous check. */
export async function checkYouthHeights(store: Store, date: string, previous: ReadonlyMap<number, number>) {
  const cutoff = `${Number(date.slice(0, 4)) - 21}${date.slice(4)}`;
  const rows = await store.all<{ id: number; height: number | null }>(
    "SELECT id,TRY_CONVERT(float,JSON_VALUE(profile,'$.identity.height')) AS height FROM players WHERE birth_date > ? AND role != 'Retired'",
    cutoff,
  );
  const failures = rows.filter(
    (row) => row.height === null || row.height < 125 || row.height > 210 || row.height < (previous.get(row.id) ?? 0),
  );
  assert.equal(failures.length, 0, `Youth height invariants failed on ${date}: players ${failures.slice(0, 10).map((row) => `${row.id}=${row.height}`).join(",")}`);
  return new Map(rows.map((row) => [row.id, row.height!]));
}

/** Rollover checks: intake 5-12 per club aged 14-15, squads, population ±10%, values and wages in bounds. */
export async function checkRollover(store: Store, initialPlayers: number, heights: ReadonlyMap<number, number>) {
  const state = await stateOf(store);
  const intake = await store.meta<{ season: number; clubs: Record<string, number> }>("youthIntake");
  assert.equal(intake.season, state.season, "Youth intake did not run for the new season");
  const clubs = await store.all<{ id: number }>("SELECT id FROM clubs WHERE type = 'club'");
  const outside = clubs.filter((club) => {
    const count = intake.clubs[club.id] ?? 0;
    return count < INTAKE.min || count > INTAKE.max;
  });
  assert.equal(outside.length, 0, `Intake outside ${INTAKE.min}-${INTAKE.max} at clubs ${outside.slice(0, 10).map((club) => club.id).join(",")}`);
  const cutoff = (years: number) => `${Number(state.date.slice(0, 4)) - years}${state.date.slice(4)}`;
  const wrongAge = (await store.get<{ total: number }>(
    "SELECT count(*) AS total FROM players WHERE JSON_VALUE(profile,'$.intake.source') = 'academy' AND JSON_VALUE(profile,'$.intake.season') = ? AND (birth_date > ? OR birth_date <= ?)",
    String(state.season),
    cutoff(14),
    cutoff(16),
  ))!.total;
  assert.equal(wrongAge, 0, "Academy intake players must be aged 14-15");
  await checkSquads(store, `after the ${state.season} rollover`);
  const players = await activePlayers(store);
  assert(
    Math.abs(players - initialPlayers) <= initialPlayers * 0.1,
    `Population ${players} is more than 10% from the initial ${initialPlayers}`,
  );
  const badMoney = (await store.get<{ total: number }>(
    `SELECT count(*) AS total FROM players WHERE role != 'Retired' AND (value IS NULL OR value < ${VALUE_RANGE.min} OR value > ${VALUE_RANGE.max} OR wage IS NULL OR wage < 0 OR wage > 1200000)`,
  ))!.total;
  assert.equal(badMoney, 0, "Player values or wages outside the section 8 bounds");
  const minors = await checkMinors(store, state.date);
  return {
    season: state.season,
    players,
    academy: Object.values(intake.clubs).reduce((total, count) => total + count, 0),
    minors,
    heights: await checkYouthHeights(store, state.date, heights),
  };
}

export async function seasonSoak(seasons: number, fullWorld = false, nations: readonly string[] = SOAK_NATIONS) {
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
    await generateWorld(store, fullWorld ? {} : { nations: [...nations] });
    await store.setMeta("settings", {
      ...(await store.meta<Record<string, unknown>>("settings")),
      autosave: "off",
    });
    const end = `${2026 + seasons}-07-02`;
    const initialPlayers = await activePlayers(store);
    const generated = await reportFootprint(store, "after generation");
    let worldMB = generated.worldMB;
    await checkSquads(store, "world start");
    await checkMinors(store, (await stateOf(store)).date);
    let heights = await checkYouthHeights(store, (await stateOf(store)).date, new Map());
    const rollovers: (Omit<Awaited<ReturnType<typeof checkRollover>>, "heights"> & { worldMB: number; seasonMB: number | undefined })[] = [];
    let simulated = 0;
    let weeks = 0;
    while ((await stateOf(store)).date < end) {
      const current = await stateOf(store);
      if (current.gameOver)
        await store.setMeta("state", { ...current, gameOver: false });
      // Steps end on 1 July so every rollover is checked on the day it runs.
      const result = await advance(
        store,
        Math.min(
          7,
          daysBetween(current.date, end),
          Math.max(1, daysBetween(current.date, `${current.season + 1}-07-01`)),
        ),
      );
      if ((await stateOf(store)).season !== current.season) {
        const { heights: next, ...summary } = await checkRollover(store, initialPlayers, heights);
        heights = next;
        console.log(`Rollover ${summary.season}: ${summary.players} players, ${summary.academy} academy intake, ${summary.minors} minors checked`);
        const footprint = await reportFootprint(store, `after the ${summary.season} rollover`, worldMB);
        worldMB = footprint.worldMB;
        rollovers.push({ ...summary, ...footprint });
      }
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
          `Soak ${result.date}: ${simulated} matches; ${await activePlayers(store)} active players`,
        );
    }
    assert.equal(rollovers.length, seasons, "Every season must roll over");
    await checkSqlConstraints(store);
    const result = {
      seasons,
      fullWorld,
      nations: fullWorld ? "all" : nations.join(","),
      date: (await stateOf(store)).date,
      matches: simulated,
      initialPlayers,
      players: await activePlayers(store),
      generatedWorldMB: generated.worldMB,
      rollovers,
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
  const nations = process.argv
    .find((value) => value.startsWith("--nations="))
    ?.split("=")[1]
    ?.split(",")
    .filter(Boolean);
  const start = performance.now();
  console.log(
    JSON.stringify(
      {
        calibration: calibrationSample(),
        ...(seasons > 0 ? { soak: await seasonSoak(seasons, fullWorld, nations?.length ? nations : SOAK_NATIONS) } : {}),
        seconds: Math.round((performance.now() - start) / 1000),
      },
      null,
      2,
    ),
  );
}
