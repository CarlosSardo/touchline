import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import { createCalendar } from "./calendar.ts";
import seedrandom from "seedrandom";
import {
  advance,
  developPlayers,
  playFixture,
  seasonRollover,
} from "./simulation.ts";
import { stateOf } from "./systems.ts";
import type {
  Fixture,
  Player,
  PlayerProfile,
  Standing,
} from "../shared/types.ts";

describe("connected simulation", () => {
  const store = new Store(":memory:");
  beforeAll(() => {
    generateWorld(store, { countryLimit: 2, seniors: 1800, youth: 800 });
    createCalendar(store);
  });
  afterAll(() => store.close());

  it("advances the calendar, develops players, updates market values and persists weekly accounts", () => {
    const before = store.get<Player>("SELECT * FROM players WHERE id = 1")!;
    const result = advance(store, 7);
    expect(result.date).toBe("2026-07-08");
    expect(stateOf(store).week).toBe(1);
    expect(
      store.get<Player>("SELECT * FROM players WHERE id = 1")!.potential,
    ).not.toBe(before.potential);
    expect(
      store.all(
        "SELECT * FROM ledger WHERE club_id = 1 AND category = 'Player & staff wages'",
      ),
    ).toHaveLength(1);
    expect(
      store.all(
        "SELECT * FROM players WHERE ability < 1 OR ability > 99 OR potential < ability OR potential > 99",
      ),
    ).toHaveLength(0);
  });

  it("updates a complete league table from the same result used by match analytics", () => {
    const fixture = store.get<Fixture>(
      "SELECT * FROM fixtures WHERE league_id = 1 AND stage = 'League' ORDER BY date LIMIT 1",
    )!;
    playFixture(store, fixture);
    const result = store.get<Fixture>(
      "SELECT * FROM fixtures WHERE id = ?",
      fixture.id,
    )!;
    const home = store.get<Standing>(
      "SELECT * FROM standings WHERE league_id = 1 AND club_id = ?",
      fixture.home_id,
    )!;
    const away = store.get<Standing>(
      "SELECT * FROM standings WHERE league_id = 1 AND club_id = ?",
      fixture.away_id,
    )!;
    expect(home.played).toBe(1);
    expect(away.played).toBe(1);
    expect(home.gf).toBe(result.home_goals);
    expect(home.ga).toBe(away.gf);
    expect(home.wins + home.draws + home.losses).toBe(home.played);
    expect(home.points + away.points).toBe(
      result.home_goals === result.away_goals ? 2 : 3,
    );
    expect(home.form).toHaveLength(1);
    expect(
      home.home_record
        .split("-")
        .map(Number)
        .reduce((sum, value) => sum + value, 0),
    ).toBe(1);
    expect(home.xg).toBe(result.home_xg);
    expect(home.xpts).toBeGreaterThanOrEqual(0);
    expect(home.xpts).toBeLessThanOrEqual(3);
    playFixture(store, result);
    expect(
      store.get<Standing>(
        "SELECT * FROM standings WHERE league_id = 1 AND club_id = ?",
        fixture.home_id,
      )!.played,
    ).toBe(1);
  });

  it("generates exactly 15000 regens per annual intake and records previous standings", () => {
    const before = store.get<{ count: number }>(
      "SELECT count(*) AS count FROM players",
    )!.count;
    store.setMeta("state", { ...stateOf(store), date: "2027-07-01" });
    store.transaction(() => seasonRollover(store));
    expect(
      store.get<{ count: number }>("SELECT count(*) AS count FROM players")!
        .count - before,
    ).toBe(15000);
    expect(stateOf(store).season).toBe(2027);
    expect(
      store.get<{ count: number }>(
        "SELECT count(*) AS count FROM history WHERE entity_type = 'league'",
      )!.count,
    ).toBe(10);
    expect(store.all("SELECT * FROM standings WHERE played != 0")).toHaveLength(
      0,
    );
  });

  it("completes position training and accelerates a supported rehabilitation plan", () => {
    const player = store.get<Player>(
      "SELECT * FROM players WHERE club_id = 1 LIMIT 1",
    )!;
    const profile = JSON.parse(player.profile) as PlayerProfile;
    profile.development.positionTarget = "DM";
    profile.development.positionWeeks = 20;
    store.run(
      "UPDATE players SET training = ?, profile = ? WHERE id = ?",
      "Position",
      JSON.stringify(profile),
      player.id,
    );
    const injured = store.get<Player>(
      "SELECT * FROM players WHERE club_id = 1 AND id != ? LIMIT 1",
      player.id,
    )!;
    store.run(
      "UPDATE players SET training = 'Injury rehab', injury_until = '2027-08-01' WHERE id = ?",
      injured.id,
    );
    developPlayers(store, seedrandom("development-plans"));
    expect(
      store.get<Player>("SELECT * FROM players WHERE id = ?", player.id)!
        .secondary_position,
    ).toBe("DM");
    expect(
      store.get<Player>("SELECT * FROM players WHERE id = ?", injured.id)!
        .injury_until! < "2027-08-01",
    ).toBe(true);
  });
});
