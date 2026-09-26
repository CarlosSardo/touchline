import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { hasMinorRoute, verifyWorld } from "./check-world.ts";
import {
  assertPlanStandings,
  avoidedClubKeys,
  generateWorld,
  isAvoidedClubKey,
  planWorld,
  worldPlayers,
  worldStaff,
  type WorldPlan,
} from "./world.ts";
import { clubNameKey, worldCatalog } from "../shared/world-catalog/index.ts";
import { MIN_GOALKEEPERS, SQUAD_MINIMUMS, WORLD_VERSION } from "../shared/world-rules.ts";
import type { GameState, PlayerProfile } from "../shared/types.ts";
import type { PlayerRow } from "./people.ts";

// Finished catalog nations: British pyramids with cross-border clubs, big cities, B-teams, home pools, AFC leagues.
const NATIONS = ["EN", "WAL", "SCO", "NIR", "IE", "NO", "TR", "RU", "IL", "JP", "AU", "SA"];
const lookup = worldCatalog();
const data = (value: unknown) => JSON.parse(String(value)) as Record<string, unknown>;

describe("world plan (pure)", () => {
  const plan: WorldPlan = planWorld({ nations: NATIONS });
  const leagues = plan.rows.leagues;
  const leagueById = new Map(leagues.map((league) => [Number(league.id), league]));
  const standings = plan.rows.standings;
  const byCode = new Map(plan.countries.map((country) => [country.code, country]));
  let players: PlayerRow[] = [];
  beforeAll(() => {
    players = [...worldPlayers(planWorld({ nations: NATIONS, squads: "minimum" }))];
  });

  it("plans every catalog tier at its real size, each club in exactly one senior league", () => {
    for (const code of NATIONS) {
      const country = byCode.get(code)!;
      const tiers = lookup.requireNation(code).football?.leagues ?? [];
      const own = leagues.filter((league) => league.country_id === country.id && league.age_group === "Senior" && Number(league.tier) > 0);
      expect(own.map((league) => Number(league.tier)), code).toEqual(tiers.map((tier) => tier.tier));
      for (const league of own) {
        const size = standings.filter((row) => row.league_id === league.id).length;
        expect(size, String(league.name)).toBe(tiers[Number(league.tier) - 1].size);
        expect(data(league.data)).toMatchObject({ worldVersion: WORLD_VERSION, catalogKey: `L:${code}:${league.tier}` });
      }
    }
    for (const club of plan.clubs) {
      const senior = standings.filter((row) => row.club_id === club.id && leagueById.get(Number(row.league_id))?.age_group === "Senior");
      expect(senior.map((row) => row.league_id), String(club.row.name)).toEqual([club.row.league_id]);
    }
    expect(plan.counts.nationalTeams).toBe(NATIONS.length * 4);
    expect(plan.rows.countries.map((country) => country.code)[0]).toBe("EN");
  });

  it("rejects duplicate standings and plans hosted-club and home-pool-only subsets", () => {
    const small = planWorld({ nations: ["SCO"], structureOnly: true });
    const duplicate = { ...small.rows, standings: [...small.rows.standings, { ...small.rows.standings[0] }] };
    expect(() => assertPlanStandings(duplicate)).toThrow(/stands in Senior leagues/);
    for (const nations of [["US", "CA", "CH", "LI"], ["EN", "WAL", "ES"], ["SCO", "IE"]])
      expect(() => planWorld({ nations, structureOnly: true }), nations.join()).not.toThrow();
    // Faroe Islands has no own league: national teams, free staff and home-based players only (db:seed --nations FO).
    const pool = planWorld({ nations: ["FO"], squads: "minimum" });
    expect(pool.rows.leagues).toEqual([]);
    expect(pool.clubs).toEqual([]);
    expect(pool.counts.nationalTeams).toBe(4);
    expect(worldStaff(pool).staff.every((row) => row.club_id === null)).toBe(true);
    const homeBased = [...worldPlayers(pool)];
    expect(homeBased.length).toBeGreaterThan(0);
    expect(homeBased.every((row) => row.club_id === null)).toBe(true);
  });

  it("puts every first team in one U19 and one U17 league of 2-16 clubs and gives B-teams none", () => {
    for (const club of plan.clubs) {
      const youth = standings
        .filter((row) => row.club_id === club.id)
        .map((row) => String(leagueById.get(Number(row.league_id))!.age_group))
        .filter((age) => age !== "Senior")
        .sort();
      expect(youth, String(club.row.name)).toEqual(club.type === "club" ? ["U17", "U19"] : []);
    }
    for (const league of leagues.filter((entry) => entry.age_group !== "Senior")) {
      const size = standings.filter((row) => row.league_id === league.id).length;
      expect(size, String(league.name)).toBeGreaterThanOrEqual(2);
      expect(size, String(league.name)).toBeLessThanOrEqual(16);
    }
  });

  it("hosts Welsh and Northern Irish clubs abroad and counts them against their home cities", () => {
    for (const [home, host] of [["WAL", "EN"], ["NIR", "IE"]]) {
      const spec = lookup.requireNation(home).hostedAbroad!.find((entry) => entry.host === host)!;
      const hosted = plan.clubs.filter((club) => club.code === home && club.hosted);
      expect(hosted.map((club) => club.row.city).sort()).toEqual([...spec.cities].sort());
      expect(hosted.map((club) => club.tier).sort()).toEqual([...spec.tiers].sort());
      for (const club of hosted) {
        expect(leagueById.get(Number(club.row.league_id))!.country_id).toBe(byCode.get(host)!.id);
        expect(data(club.row.data).hosted).toMatchObject({ host });
      }
      for (const city of lookup.requireNation(home).cities.major) {
        const clubs = plan.clubs.filter((club) => club.code === home && club.type === "club" && club.row.city === city.name);
        expect(clubs.length, city.name).toBeLessThanOrEqual(city.maxClubs ?? { mega: 6, large: 3, medium: 2, small: 1, town: 1 }[city.size]);
      }
    }
  });

  it("spreads a metropolis across the pyramid instead of filling the top flight", () => {
    const london = lookup.requireNation("EN").cities.major.find((city) => city.name === "London")!;
    const clubs = plan.clubs.filter((club) => club.code === "EN" && club.type === "club" && club.row.city === "London");
    expect(clubs.length).toBeLessThanOrEqual(london.maxClubs ?? 6);
    expect(new Set(clubs.map((club) => club.tier)).size).toBeGreaterThanOrEqual(3);
    expect(clubs.filter((club) => club.tier === 1).length).toBeLessThan(clubs.length / 2 + 1);
  });

  it("never reproduces a real club name, or a near-copy of one, and keeps names unique per nation", () => {
    // Italian and Lusophone templates can render near-copies (La Spezia Calcio, Académica de Praia); German and
    // Croatian ones add years (FC Augsburg 36, NK Zagreb 1943).
    const nearCopies = planWorld({ nations: ["IT", "CV", "AO", "MZ", "TN", "EC", "DE", "HR"].filter((code) => lookup.nationByCode(code)), structureOnly: true });
    for (const [world, codes] of [[plan, NATIONS], [nearCopies, nearCopies.nations.map((nation) => nation.code)]] as const)
      for (const code of codes) {
        const keys = world.clubs.filter((club) => club.code === code && club.type === "club").map((club) => clubNameKey(String(club.row.name)));
        expect(new Set(keys).size, code).toBe(keys.length);
        const avoided = avoidedClubKeys(lookup.avoidedClubNames(code));
        expect(keys.filter((key) => isAvoidedClubKey(key, avoided)), code).toEqual([]);
      }
    expect(lookup.avoidedClubNames("EN").size).toBeGreaterThan(0);
  });

  it("orders north/south conferences and youth groups by latitude", () => {
    const meanLatitude = (leagueId: unknown, group?: string) => {
      const latitudes = standings
        .filter((row) => row.league_id === leagueId && (group === undefined || row.group_name === group))
        .map((row) => plan.clubs.find((club) => club.id === row.club_id)?.lat)
        .filter((lat): lat is number => lat !== undefined);
      return latitudes.reduce((total, lat) => total + lat, 0) / Math.max(1, latitudes.length);
    };
    let compared = 0;
    for (const league of leagues) {
      const conferences = (data(league.data).conferences as string[] | undefined) ?? [];
      const north = conferences.find((name) => /north/i.test(name));
      const south = conferences.find((name) => /south/i.test(name));
      if (!north || !south) continue;
      expect(meanLatitude(league.id, north), String(league.name)).toBeGreaterThan(meanLatitude(league.id, south));
      compared++;
    }
    const youth = new Map<string, { north: number[]; south: number[] }>();
    for (const league of leagues.filter((entry) => entry.age_group !== "Senior")) {
      const [division, group] = String(league.name).split(" - ");
      if (!group || !/north|south/i.test(group)) continue;
      const key = `${league.country_id}:${league.age_group}:${division}`;
      const entry = youth.get(key) ?? { north: [], south: [] };
      entry[/north/i.test(group) ? "north" : "south"].push(meanLatitude(league.id));
      youth.set(key, entry);
    }
    for (const [key, entry] of youth)
      if (entry.north.length && entry.south.length) {
        expect(Math.min(...entry.north), key).toBeGreaterThan(Math.max(...entry.south));
        compared++;
      }
    expect(compared).toBeGreaterThan(0);
  });

  it("interpolates budgets by reputation, so tier giants stand apart", () => {
    for (const code of ["EN", "SCO", "JP"]) {
      const top = plan.clubs
        .filter((club) => club.code === code && club.type === "club" && club.tier === 1 && !club.hosted)
        .sort((left, right) => Number(right.row.reputation) - Number(left.row.reputation));
      const budgets = top.map((club) => Number(club.row.wage_budget));
      expect(budgets[0], code).toBeGreaterThan(budgets[Math.floor(budgets.length / 2)]);
      expect(budgets[Math.floor(budgets.length / 2)], code).toBeGreaterThan(budgets.at(-1)!);
      for (const club of top) expect(Number(club.row.balance)).toBeGreaterThanOrEqual(1.25 * Number(club.row.transfer_budget) - 1);
    }
    const scotland = plan.clubs
      .filter((club) => club.code === "SCO" && club.tier === 1)
      .map((club) => Number(club.row.wage_budget))
      .sort((left, right) => right - left);
    expect(scotland[1]).toBeGreaterThan(2 * scotland[2]);
  });

  it("builds minimum squads with two goalkeepers, sane values and payrolls within budget", () => {
    const squads = new Map<string, { total: number; keepers: number; wages: number }>();
    for (const row of players) {
      if (row.club_id === null) continue;
      const key = `${row.club_id}:${row.age_group}`;
      const entry = squads.get(key) ?? { total: 0, keepers: 0, wages: 0 };
      entry.total++;
      if (row.position === "GK") entry.keepers++;
      entry.wages += Number(row.wage);
      squads.set(key, entry);
      expect(Number(row.value)).toBeGreaterThanOrEqual(100);
      expect(Number(row.value)).toBeLessThanOrEqual(250_000_000);
      expect(Number(row.wage)).toBeLessThanOrEqual(1_200_000);
    }
    let withinBudget = 0;
    const planMinimum = planWorld({ nations: NATIONS, squads: "minimum" });
    for (const club of planMinimum.clubs) {
      const groups = club.type === "club" ? (["Senior", "U19", "U17"] as const) : (["Senior"] as const);
      let payroll = 0;
      for (const ageGroup of groups) {
        const entry = squads.get(`${club.id}:${ageGroup}`);
        const minimum = club.type === "bteam" ? SQUAD_MINIMUMS.BTeam : SQUAD_MINIMUMS[ageGroup];
        expect(entry?.total, `${club.row.name} ${ageGroup}`).toBe(minimum);
        expect(entry!.keepers, `${club.row.name} ${ageGroup}`).toBeGreaterThanOrEqual(MIN_GOALKEEPERS);
        payroll += entry!.wages;
      }
      if (payroll <= 1.1 * Number(club.row.wage_budget)) withinBudget++;
    }
    expect(withinBudget).toBeGreaterThanOrEqual(0.95 * planMinimum.clubs.length);
  });

  it("registers foreign minors only through an allowed route and keeps home pools club-less", () => {
    const planMinimum = planWorld({ nations: NATIONS, squads: "minimum" });
    const clubCountry = new Map(planMinimum.clubs.map((club) => [club.id, club]));
    const codes = new Map(planMinimum.countries.map((country) => [country.id, country.code]));
    for (const row of players) {
      if (row.club_id === null || Number(row.age) >= 18) continue;
      const club = clubCountry.get(Number(row.club_id))!;
      // Cross-border clubs are local to their home nation and to the association they register with (Derry City: FAI).
      const local = [Number(club.row.country_id)];
      if (club.hosted?.registration === "host")
        local.push(planMinimum.countries.find((country) => country.code === club.hosted!.host)!.id);
      if (local.includes(Number(row.country_id))) continue;
      const profile = JSON.parse(String(row.profile)) as PlayerProfile;
      const allowed = local.some((countryId) => hasMinorRoute(profile, Number(row.age), { countryId, code: codes.get(countryId)! }));
      expect(allowed, String(row.name)).toBe(true);
    }
    const pool = lookup.requireNation("IL").homePool!;
    const israel = planMinimum.countries.find((country) => country.code === "IL")!.id;
    const homeBased = players.filter((row) => row.club_id === null && (JSON.parse(String(row.profile)) as PlayerProfile).homeBased?.countryId === israel);
    expect(homeBased.length).toBe(pool.seniors + pool.youth);
    expect(homeBased.every((row) => Number(row.country_id) === israel && row.wage === 0)).toBe(true);
  });

  it("gives staff to first teams only and is deterministic for a seed", () => {
    const { staff } = worldStaff(plan);
    const firstTeams = new Set(plan.clubs.filter((club) => club.type === "club").map((club) => club.id));
    expect(staff.filter((row) => row.club_id !== null).every((row) => firstTeams.has(Number(row.club_id)))).toBe(true);
    expect(planWorld({ nations: NATIONS }).rows).toEqual(plan.rows);
    const first = (seed: string) => worldPlayers(planWorld({ nations: ["SCO"], seed, squads: "minimum" })).next().value;
    expect(first("a")).toEqual(first("a"));
    expect(first("a")).not.toEqual(first("b"));
  });
});

describe("club-name tokens (pure)", () => {
  it("refuse a real club with a year or number added, dropped or swapped", () => {
    const avoided = avoidedClubKeys(["FC Augsburg", "NK Zagreb", "1. FSV Mainz 05", "FC Schalke 04", "1. FC Köln", "AC Milan"].map(clubNameKey));
    const refused = ["FC Augsburg 36", "Augsburg 1907", "NK Zagreb 1943", "FSV Mainz 12", "1. FSV Mainz 05", "Schalke 1904", "FC Köln", "AC Milano 1899"];
    for (const name of refused) expect(isAvoidedClubKey(clubNameKey(name), avoided), name).toBe(true);
    for (const name of ["FC Augsburg-Hochzoll 36", "NK Zagorje 1943", "SV Mainz-Kastel 05", "TSV Köln-Mülheim 1920"])
      expect(isAvoidedClubKey(clubNameKey(name), avoided), name).toBe(false);
  });
  it.skipIf(!lookup.nationByCode("PT") || !lookup.nationByCode("HU"))(
    "applies city prepositions ({of}) and adjectival city forms ({cityAdj})",
    () => {
      const plan = planWorld({ nations: ["PT", "HU"], structureOnly: true });
      const names = (code: string) =>
        plan.clubs.filter((club) => club.type === "club" && club.code === code).map((club) => String(club.row.name));
      const portuguese = names("PT");
      expect(portuguese.filter((name) => / de (Porto|Amadora|Covilhã|Maia)$/.test(name))).toEqual([]);
      expect(portuguese.every((name) => !/[{}]|\s{2}/.test(name))).toBe(true);
      const adjectives = lookup.requireNation("HU").cities.major.flatMap((city) => city.adjective ?? []);
      const hungarian = names("HU");
      expect(hungarian.some((name) => adjectives.includes(name.split(" ")[0]))).toBe(true);
      expect(hungarian.every((name) => !/[{}]|^\s|\s{2}/.test(name))).toBe(true);
    },
  );
});

describe("generated world (SQL)", () => {
  let store: Store;
  beforeAll(async () => {
    store = await Store.createTest("world");
    await store.schema();
    await generateWorld(store, { nations: NATIONS, squads: "minimum" });
  }, 600_000);
  afterAll(async () => {
    await store?.close();
  });

  it("satisfies the section 8 structure, squad, orphan, registration and value invariants", async () => {
    const report = await verifyWorld(store, { nations: NATIONS });
    expect(report.problems).toEqual([]);
    expect(report.totals.nationalTeams).toBe(NATIONS.length * 4);
    expect(report.totals.homeBased).toBeGreaterThan(0);
  });

  it("records world v4 meta and starts at the top English club", async () => {
    const world = await store.meta<Record<string, number>>("world");
    expect(world).toMatchObject({ version: WORLD_VERSION, nations: NATIONS.length });
    expect(world).not.toHaveProperty("expanded");
    expect((world as Record<string, unknown>).options).toEqual({ nations: NATIONS, squads: "minimum" });
    const state = await store.meta<GameState>("state");
    const top = await store.get<{ id: number }>(
      "SELECT TOP (1) clubs.id FROM clubs JOIN leagues ON leagues.id = clubs.league_id JOIN countries ON countries.id = clubs.country_id WHERE countries.code = 'EN' AND leagues.tier = 1 AND clubs.type = 'club' ORDER BY clubs.reputation DESC, clubs.id",
    );
    expect(state.clubId).toBe(top!.id);
  });

  it("builds structure-only worlds without people", async () => {
    const structure = await Store.createTest("world-structure");
    try {
      await structure.schema();
      await generateWorld(structure, { nations: ["SCO", "IS"], structureOnly: true });
      const count = async (table: string) => (await structure.get<{ total: number }>(`SELECT count(*) AS total FROM ${table}`))!.total;
      expect(await count("players")).toBe(0);
      expect(await count("staff")).toBe(0);
      expect(await count("leagues")).toBeGreaterThan(4);
      // v4 models SCO and IS with one senior division each: 24 clubs plus 8 national teams.
      const planned = planWorld({ nations: ["SCO", "IS"] }).rows;
      expect(await count("clubs")).toBe(planned.clubs.length);
      expect(await count("standings")).toBe(planned.standings.length);
      expect((await structure.meta<Record<string, unknown>>("world")).options).toEqual({
        nations: ["SCO", "IS"],
        squads: "full",
        structureOnly: true,
      });
    } finally {
      await structure.close();
    }
  }, 300_000);
});
