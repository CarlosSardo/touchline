import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Store } from "./db.ts";
import {
  buildWorldStructure,
  countryDefinitions,
  ensureClubRosters,
  generateWorld,
} from "./world.ts";
import { ensureClubSupport } from "./club-support.ts";
import { initialClubFinances } from "./finance.ts";
import {
  ATTRIBUTE_GROUPS,
  DEFAULT_SETTINGS,
  START_DATE,
  loanScore,
  valuation,
} from "../shared/rules.ts";
import type { Club, League, Player, PlayerProfile } from "../shared/types.ts";
import {
  associationRuleAudit,
  domesticPyramid,
  minimumReserveTier,
  planPyramidMoves,
  reservePolicy,
  SQUAD_MINIMUMS,
  WORLD_VERSION,
  youthGroups,
} from "../shared/world-rules.ts";
import {
  clubIdentity,
  culturalPersonName,
  namingPools,
  playerBackground,
} from "./world-names.ts";
import seedrandom from "seedrandom";
import { expandWorld } from "./world-expansion.ts";
import { activateWorldStructure, createCalendar } from "./calendar.ts";

async function expectSchemaIntegrity(store: Store) {
  const tables = await store.all<{ id: number; name: string }>(
    "SELECT object_id AS id,name FROM sys.tables WHERE schema_id = SCHEMA_ID(?) ORDER BY name",
    store.schemaName,
  );
  expect(tables.length).toBeGreaterThan(0);
  expect(
    await store.all(
      "SELECT name FROM sys.foreign_keys WHERE schema_id = SCHEMA_ID(?) AND (is_disabled = 1 OR is_not_trusted = 1)",
      store.schemaName,
    ),
  ).toEqual([]);
  for (const table of tables) {
    expect(Number.isSafeInteger(table.id)).toBe(true);
    expect(
      await store.all(
        `DBCC CHECKCONSTRAINTS (${table.id}) WITH ALL_CONSTRAINTS, ALL_ERRORMSGS`,
      ),
      table.name,
    ).toEqual([]);
  }
}

describe("persistent football world", () => {
  let store: Store;
  beforeAll(async () => {
    store = await Store.createTest("world");
    await generateWorld(store, { countryLimit: 12, seniors: 1200, youth: 600 });
  });
  afterAll(async () => {
    await store?.close();
  });

  it("provides over 200 associations and at least 1200 domestic leagues at full scale", () => {
    expect(countryDefinitions().length).toBeGreaterThanOrEqual(240);
    expect(countryDefinitions().length * 5).toBeGreaterThanOrEqual(1200);
    expect(
      new Set(countryDefinitions().map((country) => country.code)).size,
    ).toBe(countryDefinitions().length);
  });

  it("starts in summer 2026 and persists all player records without faces", async () => {
    expect((await store.meta<{ date: string }>("state")).date).toBe(START_DATE);
    expect(
      (await store.get<{ count: number }>(
        "SELECT count(*) AS count FROM players",
      ))!.count,
    ).toBe(1800);
    const player = (await store.get<Player>("SELECT TOP (1) * FROM players"))!;
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
      await store.all<Player>(
        "SELECT * FROM players WHERE ability < 1 OR ability > 99 OR potential > 99",
      ),
    ).toHaveLength(0);
  });

  it("gives every association three senior and two youth divisions with table entries", async () => {
    expect(
      await store.all(
        "SELECT country_id FROM leagues GROUP BY country_id HAVING count(*) != 5",
      ),
    ).toHaveLength(0);
    expect(
      await store.all(
        "SELECT leagues.id FROM leagues LEFT JOIN standings ON standings.league_id = leagues.id GROUP BY leagues.id HAVING count(standings.club_id) = 0",
      ),
    ).toHaveLength(0);
    expect(
      await store.all(
        "SELECT clubs.id FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE clubs.type = 'bteam' AND countries.code IN ('EN','IT','BE')",
      ),
    ).toHaveLength(0);
  });

  it("does not regenerate or duplicate an existing save", async () => {
    await generateWorld(store);
    expect(
      (await store.get<{ count: number }>(
        "SELECT count(*) AS count FROM players",
      ))!.count,
    ).toBe(1800);
    expect(await store.meta("settings")).toEqual(DEFAULT_SETTINGS);
  });

  it("starts every club with one director assistant and at least one affiliate without duplicating data", async () => {
    const state = await store.meta("state");
    expect(
      await store.all(
        "SELECT clubs.id FROM clubs LEFT JOIN staff ON staff.club_id = clubs.id AND staff.role = 'Sporting director assistant' WHERE clubs.type != 'national' GROUP BY clubs.id HAVING count(staff.id) != 1",
      ),
    ).toHaveLength(0);
    expect(
      await store.all(
        "SELECT id FROM clubs WHERE type != 'national' AND NOT EXISTS (SELECT 1 FROM partnerships WHERE club_id = clubs.id OR partner_id = clubs.id)",
      ),
    ).toHaveLength(0);
    expect(
      await store.all(
        "SELECT id FROM partnerships WHERE JSON_VALUE(data,'$.since') IS NULL OR JSON_VALUE(data,'$.annualFee') IS NULL",
      ),
    ).toHaveLength(0);
    const staff = (await store.get<{ total: number }>(
      "SELECT count(*) AS total FROM staff",
    ))!.total;
    const partners = (await store.get<{ total: number }>(
      "SELECT count(*) AS total FROM partnerships",
    ))!.total;
    await ensureClubSupport(store);
    expect(
      (await store.get<{ total: number }>(
        "SELECT count(*) AS total FROM staff",
      ))!.total,
    ).toBe(staff);
    expect(
      (await store.get<{ total: number }>(
        "SELECT count(*) AS total FROM partnerships",
      ))!.total,
    ).toBe(partners);
    expect(await store.meta("state")).toEqual(state);
    await expectSchemaIntegrity(store);
  });
});

describe("expanded football world", () => {
  it("builds a SQL-free structure with legal reserve placement and both academies for every association", () => {
    const structure = buildWorldStructure({ expanded: true });
    const clubs = structure.rows.clubs as unknown as Club[];
    const leagues = structure.rows.leagues as unknown as League[];
    const clubById = new Map(clubs.map((club) => [club.id, club]));
    const leagueById = new Map(leagues.map((league) => [league.id, league]));
    const countries = new Map(structure.countryRows.map((country) => [country.id, country]));
    const youthEntries = new Map<string, number>();
    for (const standing of structure.rows.standings) {
      const age = leagueById.get(Number(standing.league_id))!.age_group;
      const key = `${standing.club_id}:${age}`;
      youthEntries.set(key, (youthEntries.get(key) ?? 0) + 1);
    }
    expect(structure.countryRows).toHaveLength(countryDefinitions().length);
    expect(clubs.filter((club) => club.type !== "national" &&
      (youthEntries.get(`${club.id}:U19`) !== 1 || youthEntries.get(`${club.id}:U17`) !== 1),
    )).toEqual([]);
    const leagueSizes = new Map<number, number>();
    for (const standing of structure.rows.standings) {
      const leagueId = Number(standing.league_id);
      leagueSizes.set(leagueId, (leagueSizes.get(leagueId) ?? 0) + 1);
    }
    for (const club of clubs.filter((entry) => entry.type !== "national")) {
      const league = leagueById.get(club.league_id!)!;
      const finances = initialClubFinances({
        reputation: club.reputation,
        leagueReputation: league.reputation,
        tier: league.tier,
        capacity: club.capacity,
        fanMood: club.fan_mood,
        homeMatches: leagueSizes.get(league.id)! + 1,
      });
      expect(club).toMatchObject(finances);
      expect(structure.clubRows.find((entry) => entry.id === club.id)).toMatchObject(finances);
    }
    for (const country of structure.countryRows) {
      const domestic = leagues.filter((league) =>
        league.country_id === country.id && league.age_group === "Senior" &&
        !JSON.parse(league.data).reserveOnly,
      );
      expect(domestic.map((league) => league.tier), country.code).toEqual(
        domesticPyramid(country).map((division) => division.tier),
      );
    }
    for (const club of clubs.filter((club) => club.type === "bteam")) {
      const country = countries.get(club.country_id)!;
      const policy = reservePolicy(country.code);
      const parent = clubById.get(club.parent_id!)!;
      const division = leagueById.get(club.league_id!)!;
      expect(parent.type).toBe("club");
      expect(parent.country_id).toBe(club.country_id);
      expect(policy.mode).not.toBe("unverified");
      if (policy.mode === "pyramid")
        expect(division.tier).toBeGreaterThanOrEqual(
          minimumReserveTier(country.code, leagueById.get(parent.league_id!)!.tier),
        );
      else {
        expect(JSON.parse(division.data)).toMatchObject({
          reserveOnly: true, promotion: 0, relegation: 0,
          reserveCompetition: policy.competition,
        });
      }
    }
  });

  it("adds modeled local tiers in large and smaller countries without presenting them as certified formats", () => {
    const countries = countryDefinitions();
    for (const [code, tiers] of [["EN", 10], ["DE", 10], ["FR", 10], ["PT", 8], ["LU", 5], ["FO", 4], ["IS", 6]] as const) {
      const pyramid = domesticPyramid(countries.find((country) => country.code === code)!);
      expect(pyramid, code).toHaveLength(tiers);
      expect(pyramid.every((division) => division.evidence === "modeled")).toBe(true);
      expect(new Set(pyramid.map((division) => division.name)).size).toBe(tiers);
    }
    expect(domesticPyramid(countries.find((country) => country.code === "FR")!)
      .slice(2, 5).map((division) => division.name)).toEqual([
        "France Ligue 3", "France National 1", "France National 2",
      ]);
  });

  it("creates plausible dual and triple family backgrounds without equating club location to ancestry", () => {
    const countries = countryDefinitions().map((country, index) => ({
      ...country,
      id: index + 1,
    }));
    const france = countries.find((country) => country.code === "FR")!;
    const china = countries.find((country) => country.code === "CN")!;
    const counts = new Set<number>();
    for (let index = 0; index < 400; index++) {
      const identity = playerBackground(
        seedrandom(`family:${index}`),
        france,
        countries,
      );
      counts.add(identity.nationalities!.length);
      expect(
        identity.heritage!.reduce(
          (total, entry) => total + entry.percentage,
          0,
        ),
      ).toBe(100);
      expect(
        new Set(identity.heritage!.map((entry) => entry.country)).size,
      ).toBe(identity.heritage!.length);
      expect(identity.nationalities![0].countryId).toBe(france.id);
      expect(identity.biography!.length).toBe(3);
      expect(
        identity.heritage!.every(
          (entry) => !["Japan", "Australia", "China"].includes(entry.country),
        ),
      ).toBe(true);
      expect(
        playerBackground(seedrandom(`family:${index}`), china, countries)
          .nationalities,
      ).toHaveLength(1);
    }
    expect(counts).toEqual(new Set([1, 2, 3]));
  });

  it.each([1, 2])("upgrades a v%i career without resetting state, identities, contracts, money or existing fixtures", async (version) => {
    const store = await Store.createTest("world");
    let testStoreGuard: ReturnType<typeof vi.spyOn> | undefined;
    try {
      await generateWorld(store, { countryLimit: 1, seniors: 480, youth: 240 });
      await createCalendar(store);
      const initialState = await store.meta<{ date: string; season: number }>("state");
      await store.setMeta("state", { ...initialState, date: "2026-10-01" });
      await store.setMeta("world", { ...await store.meta<object>("world"), version });
      const state = await store.meta("state");
      const fixtures = await store.all("SELECT * FROM fixtures ORDER BY id");
      const players = await store.all(
        "SELECT * FROM players ORDER BY id",
      );
      const staff = await store.all("SELECT * FROM staff ORDER BY id");
      const clubIdentities = await store.all(
        "SELECT id,name,short_name,city,manager,balance,transfer_budget,wage_budget FROM clubs ORDER BY id",
      );
      const club = await store.get(
        "SELECT id,name,balance,transfer_budget,wage_budget FROM clubs WHERE id = 1",
      );
      testStoreGuard = vi.spyOn(Store, "createTest").mockRejectedValue(
        new Error("Remote test schemas are not permitted in production"),
      );
      const expansion = await expandWorld(store);
      expect(testStoreGuard).not.toHaveBeenCalled();
      expect(expansion.clubsAdded).toBeGreaterThan(90);
      expect(expansion.playersAdded).toBeGreaterThan(5000);
      expect(expansion).toHaveProperty("activeFromSeason", 2027);
      expect(await store.meta("state")).toEqual(state);
      expect(
        await store.get(
          "SELECT id,name,balance,transfer_budget,wage_budget FROM clubs WHERE id = 1",
        ),
      ).toEqual(club);
      expect(
        await store.all(
          "SELECT * FROM players WHERE id <= ? ORDER BY id",
          players.length,
        ),
      ).toEqual(players);
      expect(await store.all(
        "SELECT * FROM staff WHERE id <= ? ORDER BY id", staff.length,
      )).toEqual(staff);
      expect(await store.all(
        "SELECT id,name,short_name,city,manager,balance,transfer_budget,wage_budget FROM clubs WHERE id <= ? ORDER BY id",
        clubIdentities.length,
      )).toEqual(clubIdentities);
      expect(await store.all("SELECT * FROM fixtures ORDER BY id")).toEqual(fixtures);
      expect(await store.all(
        "SELECT id FROM clubs WHERE JSON_VALUE(data,'$.pendingSeniorLeague') IS NOT NULL AND league_id IS NOT NULL",
      )).toEqual([]);
      const pending = await store.all(
        "SELECT id FROM clubs WHERE JSON_VALUE(data,'$.pendingSeniorLeague') IS NOT NULL",
      );
      expect(pending.length).toBeGreaterThan(0);
      expect(await activateWorldStructure(store, 2026)).toEqual({
        leaguesActivated: 0, clubsAdmitted: 0,
      });
      expect(
        await store.all(
          "SELECT * FROM fixtures WHERE id <= ? ORDER BY id",
          fixtures.length,
        ),
      ).toEqual(fixtures);
      expect((await expandWorld(store)).changed).toBe(false);
      expect((await store.meta<{ version: number }>("world")).version).toBe(WORLD_VERSION);
      if (version === 2) {
        await store.setMeta("state", { ...await store.meta<object>("state"), season: 2027, date: "2027-07-01" });
        const activation = await activateWorldStructure(store, 2027);
        expect(activation.clubsAdmitted).toBeGreaterThanOrEqual(pending.length);
        expect(await store.all(
          "SELECT id FROM clubs WHERE JSON_VALUE(data,'$.pendingSeniorLeague') IS NOT NULL",
        )).toEqual([]);
        const seniorDivisions = await store.all<League>(
          "SELECT * FROM leagues WHERE kind = 'league' AND age_group = 'Senior' AND tier > 0 ORDER BY tier",
        );
        for (const division of seniorDivisions) {
          const expected = domesticPyramid(countryDefinitions()[0])[division.tier - 1];
          expect((await store.get<{ count: number }>(
            "SELECT count(*) AS count FROM clubs WHERE type = 'club' AND league_id = ?",
            division.id,
          ))!.count).toBeGreaterThanOrEqual(expected.clubs);
        }
        expect(await activateWorldStructure(store, 2027)).toEqual({
          leaguesActivated: 0, clubsAdmitted: 0,
        });
        expect(await store.all("SELECT * FROM fixtures ORDER BY id")).toEqual(fixtures);
      }
      await expectSchemaIntegrity(store);
    } finally {
      testStoreGuard?.mockRestore();
      await store.close();
    }
  });

  it("localizes incompatible legacy club suffixes while retaining player identities, cities and finances", async () => {
    const store = await Store.createTest("world");
    try {
      await generateWorld(store, { countryLimit: 1, seniors: 48, youth: 24 });
      await store.run("UPDATE countries SET code = 'PT', name = 'Portugal', language = 'pt' WHERE id = 1");
      await store.run("UPDATE clubs SET name = 'Porto United', city = 'Porto' WHERE id = 1");
      await store.run("UPDATE clubs SET name = 'Porto United B', city = 'Porto', type = 'bteam', parent_id = 1 WHERE id = 2");
      await store.run("UPDATE clubs SET name = 'Personal Club' WHERE id = 3");
      await store.setMeta("state", { ...await store.meta<object>("state"), date: "2026-10-01" });
      const clubs = await store.all("SELECT id,city,balance,transfer_budget,wage_budget FROM clubs ORDER BY id");
      const players = await store.all("SELECT * FROM players ORDER BY id");
      expect((await expandWorld(store)).changed).toBe(true);
      expect(await store.get("SELECT name,city FROM clubs WHERE id = 1")).toEqual({ name: "FC Porto", city: "Porto" });
      expect((await store.get<{ name: string }>("SELECT name FROM clubs WHERE id = 2"))!.name).toBe("FC Porto B");
      expect((await store.get<{ name: string }>("SELECT name FROM clubs WHERE id = 3"))!.name).toBe("Personal Club");
      expect(await store.all("SELECT id,city,balance,transfer_budget,wage_budget FROM clubs WHERE id <= ? ORDER BY id", clubs.length)).toEqual(clubs);
      expect(await store.all("SELECT * FROM players WHERE id <= ? ORDER BY id", players.length)).toEqual(players);
      expect((await expandWorld(store)).changed).toBe(false);
    } finally {
      await store.close();
    }
  });

  it("fills missing and expired age squads without rewriting existing players or finances and is idempotent", async () => {
    const store = await Store.createTest("world");
    try {
      await generateWorld(store, { countryLimit: 1, seniors: 48, youth: 12 });
      const players = await store.all("SELECT * FROM players ORDER BY id");
      const clubs = await store.all(
        "SELECT id,balance,transfer_budget,wage_budget FROM clubs ORDER BY id",
      );
      const added = await ensureClubRosters(store);
      expect(added).toBeGreaterThan(1000);
      expect(
        await store.all(
          "SELECT * FROM players WHERE id <= ? ORDER BY id",
          players.length,
        ),
      ).toEqual(players);
      expect(
        await store.all(
          "SELECT id,balance,transfer_budget,wage_budget FROM clubs ORDER BY id",
        ),
      ).toEqual(clubs);
      expect(await ensureClubRosters(store)).toBe(0);
      for (const [age, minimum] of Object.entries(SQUAD_MINIMUMS))
        expect(
          await store.all(
            "SELECT clubs.id FROM clubs LEFT JOIN players ON players.club_id = clubs.id AND players.age_group = ? WHERE clubs.type != 'national' GROUP BY clubs.id HAVING count(players.id) < ? OR SUM(CASE WHEN players.position = 'GK' THEN 1 ELSE 0 END) < 2",
            age,
            minimum,
          ),
        ).toHaveLength(0);
      await store.run(
        "UPDATE players SET contract_end = '2026-06-30' WHERE club_id = 1 AND age_group = 'U17' AND position = 'GK'",
      );
      const expired = await store.all(
        "SELECT * FROM players WHERE contract_end < ? ORDER BY id",
        START_DATE,
      );
      expect(expired).toHaveLength(2);
      expect(await ensureClubRosters(store, { youthOnly: true })).toBe(2);
      expect(await ensureClubRosters(store, { youthOnly: true })).toBe(0);
      expect(
        await store.all("SELECT * FROM players WHERE contract_end < ? ORDER BY id", START_DATE),
      ).toEqual(expired);
      expect(
        await store.all(
          "SELECT clubs.id FROM clubs LEFT JOIN players ON players.club_id = clubs.id AND players.age_group = 'U17' AND players.contract_end >= ? WHERE clubs.type != 'national' GROUP BY clubs.id HAVING count(players.id) < ? OR SUM(CASE WHEN players.position = 'GK' THEN 1 ELSE 0 END) < 2",
          START_DATE,
          SQUAD_MINIMUMS.U17,
        ),
      ).toHaveLength(0);
    } finally {
      await store.close();
    }
  });

  it("honors reserve promotion ceilings and demotes reserves after a parent relegation without changing division sizes", () => {
    const divisions = [1, 2, 3, 4, 5].map((tier) => ({
      id: tier,
      tier,
      promotion: 1,
      relegation: tier === 5 ? 0 : 1,
      entries: Array.from({ length: 8 }, (_, index) => ({
        clubId: tier * 100 + index,
        parentId: null as number | null,
      })),
    }));
    divisions[2].entries[0].parentId = 100;
    const germanMoves = planPyramidMoves("DE", divisions);
    expect(germanMoves.find((move) => move.club === 300)).toBeUndefined();
    expect(germanMoves.find((move) => move.club === 301)?.to).toBe(2);
    divisions[1].entries[0].parentId = 107;
    const spanishMoves = planPyramidMoves("ES", divisions);
    const newDivision = (clubId: number) =>
      spanishMoves.find((move) => move.club === clubId)?.to ??
      Math.floor(clubId / 100);
    expect(newDivision(107)).toBe(2);
    expect(newDivision(200)).toBeGreaterThan(2);
    for (const division of divisions) {
      const remaining =
        division.entries.length -
        spanishMoves.filter((move) => move.from === division.id).length +
        spanishMoves.filter((move) => move.to === division.id).length;
      expect(remaining).toBe(division.entries.length);
    }
    const closed = divisions.map((division) => ({
      ...division,
      promotion: 0,
      relegation: 0,
      entries: division.entries.map((entry) => ({ ...entry, parentId: null })),
    }));
    expect(planPyramidMoves("US", closed)).toEqual([]);
    for (const country of ["US", "CA", "AU"])
      expect(planPyramidMoves(country, closed.map((division) => ({
        ...division, promotion: 2, relegation: 2,
      })))).toEqual([]);
  });

  it("audits every association and enforces documented reserve ceilings without inventing unknown permissions", () => {
    for (const country of countryDefinitions()) {
      const policy = reservePolicy(country.code);
      const audit = associationRuleAudit(country);
      expect(audit.scope).toBe("partial");
      expect(audit.code).toBe(country.code);
      expect(audit.pyramid.evidence).toBe("modeled");
      expect(policy.verification).toBeTruthy();
      expect(policy.competition).toBeTruthy();
      expect(policy.summary.length).toBeGreaterThan(20);
      if (policy.mode === "pyramid") {
        expect(policy.source).toMatch(/^https:\/\//);
        expect(minimumReserveTier(country.code, 1)).toBeGreaterThan(1);
      } else {
        expect(minimumReserveTier(country.code, 1)).toBe(Infinity);
      }
    }
    expect(minimumReserveTier("DE", 1)).toBe(3);
    expect(minimumReserveTier("DE", 3)).toBe(5);
    expect(minimumReserveTier("NO", 2)).toBe(4);
    expect(minimumReserveTier("IT", 1)).toBe(2);
    expect(reservePolicy("US")).toMatchObject({
      mode: "separate",
      professional: true,
      competition: "closed-development",
    });
    expect(reservePolicy("CA")).toMatchObject({
      mode: "separate", professional: true, competition: "closed-development",
    });
    expect(reservePolicy("EN").competition).toBe("reserve-league");
    expect(reservePolicy("LU").evidence).toBe("unverified");
    const groups = youthGroups(
      Array.from({ length: 257 }, (_, index) => index),
    );
    expect(
      Math.min(...groups.map((group) => group.length)),
    ).toBeGreaterThanOrEqual(15);
    expect(
      Math.max(...groups.map((group) => group.length)),
    ).toBeLessThanOrEqual(16);
  });

  it("uses reproducible country-aware names without affecting the following random draws", () => {
    for (const country of countryDefinitions()) {
      const first = seedrandom(`names:${country.code}`);
      const second = seedrandom(`names:${country.code}`);
      expect(culturalPersonName(first, country)).toBe(
        culturalPersonName(second, country),
      );
      expect(first()).toBe(second());
      expect(
        namingPools(country).pools.every(
          (entry) => entry.given.length > 0 && entry.family.length > 0,
        ),
      ).toBe(true);
      const clubs = Array.from(
        { length: 200 },
        (_, index) => clubIdentity(country, index).name,
      );
      expect(new Set(clubs).size, country.code).toBe(clubs.length);
    }
    const portugal = countryDefinitions().find(
      (country) => country.code === "PT",
    )!;
    expect(clubIdentity(portugal, 1).name).toBe("SC Porto");
    expect(namingPools(portugal).source).toBe("pt_PT");
    expect(
      namingPools(
        countryDefinitions().find((country) => country.code === "NG")!,
      ).source,
    ).toBe("country:NG");
  });

  it("scales country pyramids and gives every club three complete squads and bounded youth leagues", async () => {
    const store = await Store.createTest("world");
    try {
      await generateWorld(store, {
        countryLimit: 2,
        seniors: 0,
        youth: 0,
        expanded: true,
      });
      expect(domesticPyramid(countryDefinitions()[0])).toHaveLength(10);
      for (const [ageGroup, minimum] of Object.entries(SQUAD_MINIMUMS)) {
        expect(
          await store.all(
            "SELECT clubs.id FROM clubs LEFT JOIN players ON players.club_id = clubs.id AND players.age_group = ? WHERE clubs.type != 'national' GROUP BY clubs.id HAVING count(players.id) < ? OR SUM(CASE WHEN players.position = 'GK' THEN 1 ELSE 0 END) < 2",
            ageGroup,
            minimum,
          ),
        ).toHaveLength(0);
      }
      expect(
        await store.all(
          "SELECT clubs.id FROM clubs WHERE type != 'national' AND (SELECT count(*) FROM standings JOIN leagues ON leagues.id = standings.league_id WHERE standings.club_id = clubs.id AND leagues.age_group IN ('U19','U17') AND leagues.kind = 'league') != 2",
        ),
      ).toHaveLength(0);
      expect(
        await store.all(
          "SELECT leagues.id FROM leagues JOIN standings ON standings.league_id = leagues.id WHERE leagues.age_group IN ('U19','U17') GROUP BY leagues.id HAVING count(*) > 16 OR count(*) < 4",
        ),
      ).toHaveLength(0);
      await expectSchemaIntegrity(store);
    } finally {
      await store.close();
    }
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
