import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import {
  COMPETITIONS,
  createCalendar,
  progressCompetitions,
} from "./calendar.ts";
import { internationalBreak } from "../shared/rules.ts";
import type { Fixture, League } from "../shared/types.ts";

describe("football calendar", () => {
  const store = new Store(":memory:");
  beforeAll(() => {
    generateWorld(store, { countryLimit: 12, seniors: 400, youth: 200 });
    createCalendar(store);
  });
  afterAll(() => store.close());

  it("contains all required continental, national youth and invitational competitions", () => {
    for (const name of [
      "UEFA Champions League",
      "UEFA Europa League",
      "UEFA Conference League",
      "UEFA Youth League",
      "Copa Libertadores",
      "Copa Sudamericana",
      "AFC Champions League",
      "CAF Champions League",
      "CONCACAF Champions League",
      "OFC Champions League",
      "FIFA U17 World Cup",
      "FIFA U20 World Cup",
      "MIC",
      "Viareggio",
      "Copinha",
      "Future Cup",
      "Alkass Cup",
      "Generation Adidas Cup",
    ])
      expect(COMPETITIONS.some((spec) => spec.name === name)).toBe(true);
    expect(
      COMPETITIONS.filter((spec) => spec.name.endsWith("Championship")),
    ).toHaveLength(12);
  });

  it("creates a double round-robin with no self-matches or domestic matches in international breaks", () => {
    const fixtures = store.all<Fixture>(
      "SELECT * FROM fixtures WHERE league_id = 1 AND stage = 'League'",
    );
    expect(fixtures).toHaveLength(20 * 19);
    expect(
      new Set(
        fixtures.map((fixture) => `${fixture.home_id}:${fixture.away_id}`),
      ).size,
    ).toBe(fixtures.length);
    expect(fixtures.every((fixture) => !internationalBreak(fixture.date))).toBe(
      true,
    );
    expect(
      fixtures.every((fixture) => fixture.home_id !== fixture.away_id),
    ).toBe(true);
    const count = fixtures.length;
    createCalendar(store);
    expect(
      store.all(
        "SELECT id FROM fixtures WHERE league_id = 1 AND stage = 'League'",
      ),
    ).toHaveLength(count);
  });

  it("advances qualifying winners into the main draw", () => {
    const qualifying = store.get<League>(
      "SELECT * FROM leagues WHERE name = 'UEFA Champions League Qualifying'",
    )!;
    expect(qualifying).toBeTruthy();
    store.run(
      "UPDATE fixtures SET status = 'played', home_goals = 1, away_goals = 0 WHERE league_id = ?",
      qualifying.id,
    );
    progressCompetitions(store, "2026-07-21");
    store.run(
      "UPDATE fixtures SET status = 'played', home_goals = 2, away_goals = 0 WHERE league_id = ?",
      qualifying.id,
    );
    progressCompetitions(store, "2026-08-04");
    const main = store.get<League>(
      "SELECT * FROM leagues WHERE name = 'UEFA Champions League'",
    )!;
    expect(JSON.parse(main.data).phase).toBe("groups");
    expect(
      store.all("SELECT * FROM standings WHERE league_id = ?", main.id),
    ).toHaveLength(36);
    expect(
      store.all("SELECT * FROM fixtures WHERE league_id = ?", main.id),
    ).toHaveLength(144);
  });

  it("avoids same-age club fixture collisions and respects recovery days", () => {
    const collisions = store.all(
      `SELECT first.id FROM fixtures AS first JOIN fixtures AS second ON first.id < second.id AND (first.home_id IN (second.home_id,second.away_id) OR first.away_id IN (second.home_id,second.away_id)) LEFT JOIN leagues AS first_league ON first_league.id = first.league_id LEFT JOIN leagues AS second_league ON second_league.id = second.league_id WHERE abs(julianday(first.date) - julianday(second.date)) < 3 AND coalesce(first_league.age_group,'Senior') = coalesce(second_league.age_group,'Senior') LIMIT 1`,
    );
    expect(collisions).toHaveLength(0);
  });
});
