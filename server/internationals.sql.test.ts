import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { createCalendar, progressCompetitions } from "./calendar.ts";
import { matchTeam, playFixture, playFixtureBatch } from "./simulation.ts";
import {
  DUTY_META,
  ensureNationalTeams,
  internationalsDesk,
  nationalTeamView,
  playerCaps,
  playersOnDuty,
  processInternationalDuty,
} from "./internationals.ts";
import { stateOf } from "./systems.ts";
import { generateWorld } from "./world.ts";
import { addDays } from "../shared/rules.ts";
import type { NationalDutyMeta } from "../shared/features/youth-internationals.ts";
import type { Club, Fixture, League, Player } from "../shared/types.ts";

const UEFA = ["EN", "ES", "FR", "DE", "IT", "NL", "PT", "BE"];

// Runs with SQL only (npm run test:local, CI backend job); the pure rules live in shared/features/youth-internationals.test.ts.
describe.skipIf(process.env.SQL_INTEGRATION_TESTS !== "true")("youth national teams and tournaments", () => {
  let store: Store;
  const setDate = async (date: string) => store.setMeta("state", { ...(await stateOf(store)), date });
  const league = async (name: string) => (await store.get<League>("SELECT * FROM leagues WHERE name = ? AND country_id IS NULL", name))!;
  const duty = async () => store.meta<NationalDutyMeta>(DUTY_META);

  beforeAll(async () => {
    store = await Store.createTest("internationals");
    await store.schema();
    await generateWorld(store, { nations: UEFA, squads: "minimum" });
    await createCalendar(store);
  }, 900_000);
  afterAll(async () => await store?.close());

  it("generates five national teams per association and back-fills U21 teams in older worlds", async () => {
    const counts = await store.all<{ age_group: string; total: number }>(
      "SELECT age_group, count(*) AS total FROM clubs WHERE type = 'national' GROUP BY age_group ORDER BY age_group",
    );
    expect(counts).toEqual(["Senior", "U17", "U19", "U20", "U21"].map((age_group) => ({ age_group, total: UEFA.length })));
    // The generated U21 team already has fixtures and standings, so hide it rather than delete it.
    const parked = (await store.get<Club>(
      "SELECT clubs.* FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE countries.code = 'BE' AND clubs.type = 'national' AND clubs.age_group = 'U21'",
    ))!;
    await store.run("UPDATE clubs SET type = 'club' WHERE id = ?", parked.id);
    await ensureNationalTeams(store);
    await ensureNationalTeams(store);
    const belgium = await store.all<Club>(
      "SELECT clubs.* FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE countries.code = 'BE' AND clubs.type = 'national' AND clubs.age_group = 'U21'",
    );
    expect(belgium.map((club) => club.name)).toEqual(["Belgium U21"]);
    await store.run("DELETE FROM clubs WHERE id = ?", belgium[0].id);
    await store.run("UPDATE clubs SET type = 'national' WHERE id = ?", parked.id);
  });

  it("schedules the catalog youth tournaments for 2026/27 (U21 EURO finals, U19 EURO in July, no U-20 World Cup)", async () => {
    const u21 = JSON.parse((await league("UEFA European Under-21 Championship")).data);
    expect(u21.season).toBe(2026);
    expect(u21.phase).toBe("groups");
    const u20 = JSON.parse((await league("FIFA U-20 World Cup")).data);
    expect(u20.phase).toBe("rest year");
    const u19 = await store.all<Fixture>(
      "SELECT fixtures.* FROM fixtures JOIN leagues ON leagues.id = fixtures.league_id WHERE leagues.name = 'UEFA European Under-19 Championship' ORDER BY date",
    );
    expect(u19.length).toBeGreaterThan(0);
    expect(u19[0].date >= "2026-07-02").toBe(true);
    // Next season's U21 finals are qualified for from the 2027/28 windows, so nothing is carried yet.
    expect(u21.carried).toBeUndefined();
  });

  it("names squads before a tournament, keeps them from their clubs and plays youth finals with the fast model", async () => {
    const u21 = await league("UEFA European Under-21 Championship");
    const first = (await store.get<{ date: string }>("SELECT min(date) AS date FROM fixtures WHERE league_id = ?", u21.id))!.date;
    await setDate(addDays(first, -3));
    await store.transaction(() => processInternationalDuty(store));
    const records = (await duty()).squads.filter((record) => record.leagueId === u21.id);
    expect(records.length).toBe(UEFA.length);
    for (const record of records) {
      expect(record.players.length).toBeGreaterThan(0);
      expect(record.players.length).toBeLessThanOrEqual(23);
      expect(record.mandatory).toBe(true);
      expect(record.cutoff).toBe("2004-01-01");
      const players = await store.all<Player>(
        `SELECT * FROM players WHERE id IN (${record.players.join(",")})`,
      );
      expect(players.every((player) => player.birth_date >= "2004-01-01" && player.country_id === record.countryId)).toBe(true);
    }
    const onDuty = await playersOnDuty(store, addDays(first, -3));
    const away = (await store.get<Player>(
      `SELECT TOP (1) players.* FROM players JOIN clubs ON clubs.id = players.club_id WHERE clubs.type = 'club' AND players.id IN (${[...onDuty].join(",")}) ORDER BY players.ability DESC`,
    ))!;
    const club = (await store.get<Club>("SELECT * FROM clubs WHERE id = ?", away.club_id))!;
    const side = await matchTeam(store, club, away.age_group, addDays(first, -3));
    expect([...side.lineup, ...(side.bench ?? [])].some((player) => player.id === away.id)).toBe(false);

    await setDate(first);
    await store.transaction(() => processInternationalDuty(store));
    const today = await store.all<Fixture>("SELECT * FROM fixtures WHERE league_id = ? AND date = ? AND status = 'scheduled'", u21.id, first);
    expect(today.length).toBeGreaterThan(0);
    const leftover = await store.transaction(() => playFixtureBatch(store, today));
    expect(leftover).toEqual([]);
    const appearances = await store.all<{ player_id: number; club_id: number }>(
      `SELECT player_id, club_id FROM player_match_appearances WHERE fixture_id IN (${today.map((fixture) => fixture.id).join(",")})`,
    );
    const named = new Set(records.flatMap((record) => record.players));
    expect(appearances.length).toBeGreaterThan(today.length * 22);
    expect(appearances.every((row) => named.has(row.player_id))).toBe(true);
  });

  it("runs the finals to a champion, records caps, rewards visibility and ends duty", async () => {
    const u21 = await league("UEFA European Under-21 Championship");
    const before = new Map(
      (await store.all<Club>("SELECT * FROM clubs WHERE type = 'national' AND age_group = 'U21'")).map((team) => [team.id, team.reputation]),
    );
    let date = (await stateOf(store)).date;
    for (let day = 0; day < 30; day++) {
      await store.transaction(async () => {
        await setDate(date);
        await processInternationalDuty(store);
        const fixtures = await store.all<Fixture>(
          "SELECT * FROM fixtures WHERE league_id = ? AND date <= ? AND status = 'scheduled' ORDER BY date,id",
          u21.id,
          date,
        );
        for (const fixture of await playFixtureBatch(store, fixtures)) await playFixture(store, fixture);
        await progressCompetitions(store, date);
      });
      if (JSON.parse((await league(u21.name)).data).phase === "complete") break;
      date = addDays(date, 1);
    }
    const final = JSON.parse((await league(u21.name)).data);
    expect(final.phase).toBe("complete");
    expect(final.champion).toBeTruthy();
    await setDate(addDays(date, 1));
    await store.transaction(() => processInternationalDuty(store));
    const meta = await duty();
    expect(meta.squads.filter((record) => record.leagueId === u21.id)).toEqual([]);
    expect(meta.rewarded).toContain(u21.id);
    const scorer = (await store.get<{ player_id: number }>(
      "SELECT TOP (1) player_id FROM player_season_stats WHERE league_id = ? ORDER BY appearances DESC, player_id",
      u21.id,
    ))!;
    const caps = await playerCaps(store, scorer.player_id);
    expect(caps.teams[0]).toMatchObject({ ageGroup: "U21" });
    expect(caps.total.appearances).toBeGreaterThanOrEqual(3);
    expect(caps.exposure?.value).toBeGreaterThan(0);
    const champion = (await store.get<Club>("SELECT * FROM clubs WHERE id = ?", final.champion))!;
    expect(champion.reputation).toBeGreaterThan(before.get(champion.id)!);
  });

  it("serves the desk, team views and a provisional squad between tournaments", async () => {
    const desk = await internationalsDesk(store);
    expect(desk.tournaments.find((row) => row.id === "uefa-u21-euro")).toMatchObject({ held: true, edition: 2027, phase: "complete" });
    const team = (await store.get<Club>(
      "SELECT TOP (1) clubs.* FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE countries.code = 'EN' AND clubs.type = 'national' AND clubs.age_group = 'U17'",
    ))!;
    const view = await nationalTeamView(store, team.id);
    expect(view.duty).toBeNull();
    expect(view.players.length).toBeGreaterThan(0);
    expect(view.players.every((player) => player.status === "provisional" && player.birthDate >= view.cutoff)).toBe(true);
  });
});
