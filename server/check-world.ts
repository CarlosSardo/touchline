import assert from "node:assert/strict";
import { resolve } from "node:path";
import { statSync } from "node:fs";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";

const file = resolve(process.env.GAME_DB ?? "data/career.sqlite");
const store = new Store(file);
const started = performance.now();
generateWorld(store);
const count = (table: string, where = "") =>
  store.get<{ total: number }>(
    `SELECT count(*) AS total FROM ${table} ${where}`,
  )!.total;
const totals = {
  countries: count("countries"),
  domesticLeagues: count("leagues", "WHERE kind = 'league'"),
  clubs: count("clubs", "WHERE type != 'national'"),
  seniorPlayers: count("players", "WHERE age_group = 'Senior'"),
  youthPlayers: count("players", "WHERE age_group != 'Senior'"),
  staff: count("staff"),
  leagueEntries: count("standings"),
};
assert(totals.countries >= 200);
assert(totals.domesticLeagues >= 1200);
assert(totals.clubs >= 3500);
assert.equal(totals.seniorPlayers, 120000);
assert.equal(totals.youthPlayers, 40000);
assert.equal(
  count(
    "clubs JOIN countries ON countries.id = clubs.country_id",
    "WHERE clubs.type = 'bteam' AND countries.code IN ('EN','IT','BE')",
  ),
  0,
);
assert.equal(
  count(
    "players LEFT JOIN clubs ON clubs.id = players.club_id",
    "WHERE players.club_id IS NOT NULL AND clubs.id IS NULL",
  ),
  0,
);
assert.equal(
  store.get<{ integrity_check: string }>("PRAGMA integrity_check")!
    .integrity_check,
  "ok",
);
const queryStart = performance.now();
const prospects = store.all(
  "SELECT id, name, position, age, ability, potential, value FROM players WHERE position = ? AND age <= ? AND potential >= ? ORDER BY potential DESC LIMIT 25",
  "ST",
  21,
  80,
);
const queryMs = Math.round(performance.now() - queryStart);
store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
console.log(
  JSON.stringify(
    {
      ...totals,
      databaseMB: Math.round(statSync(file).size / 1_000_000),
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
store.close();
