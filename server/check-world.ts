import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import { reservePolicy, SQUAD_MINIMUMS } from "../shared/world-rules.ts";

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
      assert(totals.seniorPlayers >= totals.clubs * SQUAD_MINIMUMS.Senior);
      assert(
        totals.youthPlayers >=
          totals.clubs * (SQUAD_MINIMUMS.U19 + SQUAD_MINIMUMS.U17),
      );
      for (const [ageGroup, minimum] of Object.entries(SQUAD_MINIMUMS)) {
        const incomplete = await store.all(
          "SELECT clubs.id FROM clubs LEFT JOIN players ON players.club_id = clubs.id AND players.age_group = ? WHERE clubs.type != 'national' GROUP BY clubs.id HAVING count(players.id) < ? OR sum(CASE WHEN players.position = 'GK' THEN 1 ELSE 0 END) < 2",
          ageGroup,
          minimum,
        );
        assert.equal(
          incomplete.length,
          0,
          `${ageGroup} squads must be complete and include two goalkeepers`,
        );
      }
      assert.equal(
        (
          await store.all(
            "SELECT clubs.id FROM clubs WHERE clubs.type != 'national' AND (SELECT count(*) FROM standings JOIN leagues ON leagues.id = standings.league_id WHERE standings.club_id = clubs.id AND leagues.kind = 'league' AND leagues.age_group IN ('U19','U17')) != 2",
          )
        ).length,
        0,
      );
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
    const reserveAudit = (
      await store.all<{ code: string }>("SELECT code FROM countries")
    ).reduce<Record<string, number>>((counts, country) => {
      const evidence = reservePolicy(country.code).evidence;
      counts[evidence] = (counts[evidence] ?? 0) + 1;
      return counts;
    }, {});
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
