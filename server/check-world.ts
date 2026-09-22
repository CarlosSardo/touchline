import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import {
  associationRuleAudit,
  domesticPyramid,
  minimumReserveTier,
  reservePolicy,
  SQUAD_MINIMUMS,
  WORLD_VERSION,
} from "../shared/world-rules.ts";
import type { Club, Country, League } from "../shared/types.ts";

export async function checkSqlConstraints(store: Store) {
  assert(
    store.testMode && store.schemaName !== "dbo",
    "Checks require an isolated test schema",
  );
  const tables = await store.all<{ object_id: number; name: string }>(
    "SELECT object_id,name FROM sys.tables WHERE schema_id = SCHEMA_ID(?) ORDER BY name",
    store.schemaName,
  );
  assert(tables.length > 0, "The isolated schema must contain game tables");
  for (const table of tables) {
    assert(Number.isSafeInteger(table.object_id));
    const violations = await store.all(
      `DBCC CHECKCONSTRAINTS (${table.object_id}) WITH ALL_CONSTRAINTS, ALL_ERRORMSGS`,
    );
    assert.equal(
      violations.length,
      0,
      `${table.name}: SQL constraint violations`,
    );
  }
}

export async function checkWorld() {
  const store = await Store.createTest("world-check");
  const started = performance.now();
  try {
    assert(
      store.testMode && store.schemaName !== "dbo",
      "World checks cannot use gameplay schemas",
    );
    await store.schema();
    await generateWorld(store);
    const world = await store.meta<{ expanded?: boolean; version?: number }>(
      "world",
    );
    const count = async (table: string, where = "") =>
      (await store.get<{ total: number }>(
        `SELECT count(*) AS total FROM ${table} ${where}`,
      ))!.total;
    const totals = {
      countries: await count("countries"),
      domesticLeagues: await count("leagues", "WHERE kind = 'league'"),
      clubs: await count("clubs", "WHERE type != 'national'"),
      seniorPlayers: await count("players", "WHERE age_group = 'Senior'"),
      youthPlayers: await count("players", "WHERE age_group != 'Senior'"),
      staff: await count("staff"),
      leagueEntries: await count("standings"),
    };
    assert(totals.countries >= 200);
    assert(totals.domesticLeagues >= 1200);
    assert(totals.clubs >= 3500);
    if (world.expanded) {
      assert.equal(world.version, WORLD_VERSION);
      assert(totals.seniorPlayers >= totals.clubs * SQUAD_MINIMUMS.Senior);
      assert(
        totals.youthPlayers >=
          totals.clubs * (SQUAD_MINIMUMS.U19 + SQUAD_MINIMUMS.U17),
      );
      for (const [ageGroup, minimum] of Object.entries(SQUAD_MINIMUMS)) {
        const incomplete = await store.all(
          "SELECT clubs.id FROM clubs LEFT JOIN players ON players.club_id = clubs.id AND players.age_group = ? AND players.role != 'Retired' WHERE clubs.type != 'national' GROUP BY clubs.id HAVING count(players.id) < ? OR sum(CASE WHEN players.position = 'GK' THEN 1 ELSE 0 END) < 2",
          ageGroup,
          minimum,
        );
        assert.equal(
          incomplete.length,
          0,
          `${ageGroup} squads must be complete and include two goalkeepers`,
        );
      }
      for (const age of ["U19", "U17"])
        assert.equal((await store.all(
          "SELECT clubs.id FROM clubs WHERE clubs.type != 'national' AND (SELECT count(*) FROM standings JOIN leagues ON leagues.id = standings.league_id WHERE standings.club_id = clubs.id AND leagues.kind = 'league' AND leagues.age_group = ?) != 1",
          age,
        )).length, 0, `${age}: every first team and B team needs one domestic league`);
      assert.equal((await store.all(
        "SELECT leagues.id FROM leagues JOIN standings ON standings.league_id = leagues.id WHERE leagues.kind = 'league' AND leagues.age_group IN ('U19','U17') GROUP BY leagues.id HAVING count(*) > 16 OR count(*) < 2",
      )).length, 0, "Academy groups need opponents and bounded schedules");
    } else {
      assert(totals.seniorPlayers >= 120000);
      assert(totals.youthPlayers >= 40000);
    }
    assert.equal(
      await count(
        "players LEFT JOIN clubs ON clubs.id = players.club_id",
        "WHERE players.club_id IS NOT NULL AND clubs.id IS NULL",
      ),
      0,
    );
    await checkSqlConstraints(store);
    const countries = await store.all<Country>("SELECT * FROM countries ORDER BY code");
    const countryRules = countries.map(associationRuleAudit);
    const reserveAudit = countryRules.reduce<Record<string, number>>((counts, country) => {
      const evidence = country.reserve.evidence;
      counts[evidence] = (counts[evidence] ?? 0) + 1;
      return counts;
    }, {});
    assert.equal(countryRules.length, totals.countries);
    assert(countryRules.every((country) => country.scope === "partial" && country.reserve.verification));
    if (world.expanded) {
      const clubs = await store.all<Club>("SELECT * FROM clubs WHERE type != 'national'");
      const clubById = new Map(clubs.map((club) => [club.id, club]));
      const leagues = await store.all<League>("SELECT * FROM leagues WHERE kind = 'league'");
      const leagueById = new Map(leagues.map((league) => [league.id, league]));
      const countryById = new Map(countries.map((country) => [country.id, country]));
      for (const country of countries) {
        const divisions = leagues.filter((league) =>
          league.country_id === country.id && league.age_group === "Senior" &&
          !JSON.parse(league.data).reserveOnly,
        ).sort((left, right) => left.tier - right.tier);
        const expected = domesticPyramid(country);
        assert.deepEqual(divisions.map((division) => division.tier), expected.map((division) => division.tier), country.code);
        for (const [index, division] of divisions.entries()) {
          const data = JSON.parse(division.data);
          assert.equal(data.promotion, expected[index].promotion, `${country.code}: promotion`);
          assert.equal(data.relegation, expected[index].relegation, `${country.code}: relegation`);
        }
      }
      for (const reserve of clubs.filter((club) => club.type === 'bteam')) {
        const country = countryById.get(reserve.country_id)!;
        const policy = reservePolicy(country.code);
        const parent = clubById.get(reserve.parent_id!);
        const division = leagueById.get(reserve.league_id!)!;
        assert(parent && parent.type === "club" && parent.country_id === country.id, `${country.code}: reserve parent`);
        assert.notEqual(policy.mode, "unverified", `${country.code}: no invented reserve admission`);
        if (policy.mode === "pyramid")
          assert(division.tier >= minimumReserveTier(country.code, leagueById.get(parent.league_id!)!.tier), `${country.code}: reserve ceiling and parent gap`);
        else
          assert(JSON.parse(division.data).reserveOnly, `${country.code}: separate development competition`);
      }
    }
    const queryStart = performance.now();
    const prospects = await store.all(
      "SELECT TOP (25) id, name, position, age, ability, potential, value FROM players WHERE position = ? AND age <= ? AND potential >= ? ORDER BY potential DESC",
      "ST",
      21,
      80,
    );
    const queryMs = Math.round(performance.now() - queryStart);
    console.log(
      JSON.stringify(
        {
          ...totals,
          worldVersion: world.version ?? 1,
          reserveAudit,
          countryRuleAudit: countryRules,
          rulebookStatus: "Partial evidence only; division sizes, regional paths and calendars are game models.",
          database: store.database,
          schemaName: store.schemaName,
          generationAndCheckSeconds:
            Math.round((performance.now() - started) / 100) / 10,
          filteredQueryMs: queryMs,
          returnedProspects: prospects.length,
          integrity: "ok",
        },
        null,
        2,
      ),
    );
  } finally {
    await store.close();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  await checkWorld();
