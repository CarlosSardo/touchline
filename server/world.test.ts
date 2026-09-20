import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { countryDefinitions, generateWorld } from "./world.ts";
import {
  ATTRIBUTE_GROUPS,
  DEFAULT_SETTINGS,
  START_DATE,
  loanScore,
  valuation,
} from "../shared/rules.ts";
import type { Player, PlayerProfile } from "../shared/types.ts";

describe("persistent football world", () => {
  const store = new Store(":memory:");
  beforeAll(() =>
    generateWorld(store, { countryLimit: 12, seniors: 1200, youth: 600 }),
  );
  afterAll(() => store.close());

  it("provides over 200 associations and at least 1200 domestic leagues at full scale", () => {
    expect(countryDefinitions().length).toBeGreaterThanOrEqual(240);
    expect(countryDefinitions().length * 5).toBeGreaterThanOrEqual(1200);
    expect(
      new Set(countryDefinitions().map((country) => country.code)).size,
    ).toBe(countryDefinitions().length);
  });

  it("starts in summer 2026 and persists all player records without faces", () => {
    expect(store.meta<{ date: string }>("state").date).toBe(START_DATE);
    expect(
      store.get<{ count: number }>("SELECT count(*) AS count FROM players")!
        .count,
    ).toBe(1800);
    const player = store.get<Player>("SELECT * FROM players LIMIT 1")!;
    const profile = JSON.parse(player.profile) as PlayerProfile;
    expect(
      profile.identity.heritage.reduce(
        (total, item) => total + item.percentage,
        0,
      ),
    ).toBe(100);
    expect(profile).not.toHaveProperty("face");
    for (const [group, keys] of Object.entries(ATTRIBUTE_GROUPS)) {
      for (const key of keys)
        expect(
          profile.attributes[group as keyof typeof ATTRIBUTE_GROUPS][key],
        ).toBeGreaterThanOrEqual(1);
    }
    expect(
      store.all<Player>(
        "SELECT * FROM players WHERE ability < 1 OR ability > 99 OR potential > 99",
      ),
    ).toHaveLength(0);
  });

  it("gives every association three senior and two youth divisions with table entries", () => {
    expect(
      store.all(
        "SELECT country_id FROM leagues GROUP BY country_id HAVING count(*) != 5",
      ),
    ).toHaveLength(0);
    expect(
      store.all(
        "SELECT leagues.id FROM leagues LEFT JOIN standings ON standings.league_id = leagues.id GROUP BY leagues.id HAVING count(standings.club_id) = 0",
      ),
    ).toHaveLength(0);
    expect(
      store.all(
        "SELECT clubs.id FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE clubs.type = 'bteam' AND countries.code IN ('EN','IT','BE')",
      ),
    ).toHaveLength(0);
  });

  it("does not regenerate or duplicate an existing save", () => {
    generateWorld(store);
    expect(
      store.get<{ count: number }>("SELECT count(*) AS count FROM players")!
        .count,
    ).toBe(1800);
    expect(store.meta("settings")).toEqual(DEFAULT_SETTINGS);
  });
});

describe("football formulas", () => {
  it("uses every valuation layer and reduces the value of expiring contracts", () => {
    const player = {
      ability: 78,
      potential: 87,
      age: 22,
      position: "ST" as const,
      contract_end: "2030-06-30",
      form: 7,
      injury_until: null,
    };
    const context = {
      date: START_DATE,
      leagueReputation: 90,
      balance: 50_000_000,
      philosophy: "Develop and sell",
      inflation: 4,
      crisis: 0,
      hype: 0,
    };
    expect(Object.keys(valuation(player, context).layers)).toHaveLength(10);
    expect(valuation(player, context).value).toBeGreaterThan(
      valuation({ ...player, contract_end: "2027-06-30" }, context).value,
    );
    expect(
      valuation({ ...player, contract_end: START_DATE }, context).value,
    ).toBe(0);
  });

  it("bounds Loan Success Score and weights all eleven factors", () => {
    const factors = Object.fromEntries(
      [
        "minutes",
        "position",
        "tacticalFit",
        "development",
        "performance",
        "personality",
        "lifestyle",
        "injury",
        "environment",
        "trust",
        "fans",
      ].map((key) => [key, 100]),
    );
    expect(loanScore(factors)).toBe(100);
    expect(loanScore({ ...factors, minutes: 0 })).toBe(80);
  });
});
