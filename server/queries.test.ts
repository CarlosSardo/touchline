import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bindSql, Store } from "./db.ts";
import { addNationals, likePattern, playerFilter, playerRanking, playerSearch } from "./queries.ts";
import { GameError } from "./systems.ts";

const sqlIntegration = process.env.SQL_INTEGRATION_TESTS === "true";
const search = (query: Record<string, unknown>, context?: Parameters<typeof playerSearch>[1]) =>
  playerSearch(playerFilter.parse(query), context);
const sqlOf = (result: ReturnType<typeof playerSearch>) => ({
  count: `SELECT count(*) AS count FROM (SELECT players.id FROM players WHERE ${result.where} LIMIT 10001) AS matches`,
  page: `SELECT players.id FROM players ${result.joins} WHERE ${result.where} ORDER BY ${result.order} LIMIT ? OFFSET ?`,
});
const searchQueries: Record<string, unknown>[] = [
  {},
  { q: "Smith", country: 3, sort: "club" },
  { attribute: "passing", attributeMin: 70, sort: "nationality" },
  { shortlisted: "1", sort: "position", direction: "asc" },
  { position: "ST", ageMin: 17.5, ageMax: 23.9, minutesMin: 90.5, club: 4, ageGroup: "U19", sort: "height" },
  { contractStatus: "amateur", lifestyle: "Quiet", trait: "Leader", personality: "professionalism", heightMin: 170, heightMax: 190 },
  { listed: "1", availableLoan: "0", freeAgent: "1", injured: "0", shortlisted: "0", sort: "contract", direction: "asc" },
  {
    clubCountry: 3, league: 5, tierMin: 1, tierMax: 2, weightMin: 60, weightMax: 80, contractMonthsMin: 6,
    contractMonthsMax: 18, goalsMax: 5, assistsMin: 1, appearancesMin: 2, formMax: 8, wageMin: 1000, sort: "weight",
  },
  { attribute: "finishing", attributeMin: 60, attributeMax: 80, personality: "ambition", personalityMax: 40, clubCountry: 2 },
];
const TODAY = "2026-08-31";

describe("player search SQL (no database)", () => {
  it("serves the default page from one players alias, without no-op range predicates", () => {
    const result = search({});
    expect(result).toMatchObject({
      joins: "",
      where: "players.role <> 'Retired'",
      order: "players.ability DESC,lower(players.name) ASC,players.id ASC",
      params: [],
      readsProfile: false,
      filtered: false,
    });
  });

  it("keeps indexed filters off the profile JSON and rounds integer bounds inward", () => {
    const result = search({ position: "ST", ageMin: 17.5, ageMax: 23.9, potentialMin: 60, club: 4, ageGroup: "U19", wageMax: 5000, minutesMin: 90.5 });
    expect(result.readsProfile).toBe(false);
    expect(result.filtered).toBe(true);
    expect(result.where).toContain("players.position = ?");
    expect(result.where).toContain("players.age_group = ?");
    expect(result.where).toContain("players.club_id = ?");
    expect(result.where).not.toContain("profile");
    // age and minutes are integer columns: PostgreSQL rejects fractional integer parameters.
    expect(result.params).toEqual([18, 23, 60, 5000, 91, "ST", 4, "U19"]);
  });

  it("drops only default bounds: an explicit limit is still applied", () => {
    expect(search({ valueMax: 1_000_000_000, abilityMin: 1, potentialMax: 99 }).filtered).toBe(false);
    const limited = search({ valueMax: 2_000_000, abilityMin: 50 });
    expect(limited.where).toContain("players.value <= ?");
    expect(limited.where).toContain("players.ability >= ?");
    expect(limited.params).toEqual([50, 2_000_000]);
  });

  it("applies both ends of every numeric range and puts a reversed pair in order", () => {
    const reversed = search({ ageMin: 25, ageMax: 18, valueMin: 5_000_000, valueMax: 1_000_000 });
    expect(reversed.where).toBe(
      "players.role <> 'Retired' AND players.age >= ? AND players.age <= ? AND players.value >= ? AND players.value <= ?",
    );
    expect(reversed.params).toEqual([18, 25, 1_000_000, 5_000_000]);
    for (const [key, column] of [
      ["ability", "players.ability"],
      ["potential", "players.potential"],
      ["wage", "players.wage"],
      ["form", "players.form"],
      ["appearances", "players.appearances"],
      ["goals", "players.goals"],
      ["assists", "players.assists"],
      ["minutes", "players.minutes"],
      // Copied from the profile (migration 11) and indexed, so no profile is parsed.
      ["height", "players.height"],
      ["weight", "players.weight"],
    ] as const) {
      const result = search({ [`${key}Min`]: 5, [`${key}Max`]: 8 });
      expect(result.where).toBe(`players.role <> 'Retired' AND ${column} >= ? AND ${column} <= ?`);
      expect(result.params).toEqual([5, 8]);
      expect(result.readsProfile).toBe(false);
      expect(result.columnWhere).toBe(result.where);
      expect(search({ [`${key}Max`]: 8 }).params).toEqual([8]);
    }
  });

  it("rejects bounds outside each range's domain at the filter boundary", () => {
    for (const query of [{ ageMax: 101 }, { abilityMax: 100 }, { tierMin: 21 }, { contractMonthsMax: 121 }, { heightMin: -1 }, { goalsMin: "x" }])
      expect(playerFilter.safeParse(query).success).toBe(false);
    expect(playerFilter.parse({ abilityMin: "0", minutesMax: "900" })).toMatchObject({ abilityMin: 0, minutesMax: 900 });
  });

  it("scopes the club by country, league and division through one semi-join on clubs", () => {
    const scoped = search({ clubCountry: 3, league: 9, tierMax: 2 });
    expect(scoped.readsProfile).toBe(false);
    expect(scoped.where).toBe(
      "players.role <> 'Retired' AND players.club_id IN (SELECT clubs.id FROM clubs JOIN leagues ON leagues.id = clubs.league_id WHERE clubs.country_id = ? AND clubs.league_id = ? AND leagues.tier >= ? AND leagues.tier <= ?)",
    );
    // An open lower division bound starts at the top flight, so reserve leagues (tier 0) never match.
    expect(scoped.params).toEqual([3, 9, 1, 2]);
    const league = search({ league: 9, club: 4 });
    expect(league.where).toContain("players.club_id = ?");
    expect(league.where).toContain("players.club_id IN (SELECT clubs.id FROM clubs WHERE clubs.league_id = ?)");
    expect(league.params).toEqual([4, 9]);
    expect(search({ tierMin: 2 }).params).toEqual([2, 20]);
    expect(search({ tierMin: 1, tierMax: 20 }).filtered).toBe(false);
  });

  it("dates contract ranges in whole months from today", () => {
    const result = search({ contractMonthsMin: 6, contractMonthsMax: 18.5 }, { today: TODAY });
    expect(result.where).toBe(
      "players.role <> 'Retired' AND players.contract_end >= ? AND players.contract_end <= ?",
    );
    expect(result.params).toEqual(["2027-02-28", "2028-02-29"]);
    expect(search({ contractMonthsMax: 6 }, { today: TODAY }).params).toEqual(["2027-02-28"]);
    expect(() => search({ contractMonthsMax: 6 })).toThrow("today");
  });

  it("ignores a skill range until its attribute or personality is chosen", () => {
    expect(search({ attributeMin: 70, personalityMax: 40 }).filtered).toBe(false);
    const ranged = search({ attribute: "passing", attributeMin: 60, attributeMax: 80 });
    expect(ranged.params).toEqual([["attributes", "technical", "passing"], 60, ["attributes", "technical", "passing"], 80]);
    expect(search({ personality: "ambition", personalityMax: 40 }).params).toEqual([["personality", "ambition"], 40]);
  });

  it("separates column conditions, served by indexes, from profile-JSON conditions checked on bounded candidates", () => {
    const result = search({ position: "ST", attribute: "passing", attributeMin: 70, trait: "Leader", heightMin: 185 });
    expect(result.readsProfile).toBe(true);
    expect(result.columnWhere).toBe("players.role <> 'Retired' AND players.height >= ? AND players.position = ?");
    expect(result.columnParams).toEqual([185, "ST"]);
    // Checked over the profile parsed once per candidate (PROFILE_JSON exposes it as profile_json.doc).
    expect(result.profileWhere).toBe(
      "(profile_json.doc::jsonb -> 'traits') @> jsonb_build_array(?::text) AND ((profile_json.doc::jsonb #>> ?::text[])::double precision + (players.ability - coalesce((profile_json.doc::jsonb #>> '{baseAbility}')::double precision,players.ability))) >= ?",
    );
    expect(result.where).toContain("(players.profile::jsonb -> 'traits') @> jsonb_build_array(?::text)");
    expect(result.profileParams).toEqual(["Leader", ["attributes", "technical", "passing"], 70]);
    expect(result.params).toEqual([185, "ST", "Leader", ["attributes", "technical", "passing"], 70]);
    expect(search({ position: "ST" })).toMatchObject({ profileWhere: null, profileParams: [], columnParams: ["ST"] });
  });

  it("reads profile JSON paths through jsonb with key-path parameters", () => {
    const result = search({ attribute: "passing", attributeMin: 70, personality: "professionalism", personalityMin: 50 });
    expect(result.readsProfile).toBe(true);
    expect(result.where).toContain("(players.profile::jsonb #>> ?::text[])::double precision");
    expect(result.where).toContain("coalesce((players.profile::jsonb #>> '{baseAbility}')::double precision,players.ability)");
    expect(result.params).toEqual([["attributes", "technical", "passing"], 70, ["personality", "professionalism"], 50]);
    expect(search({ trait: "Leader" }).where).toContain("(players.profile::jsonb -> 'traits') @> jsonb_build_array(?::text)");
  });

  it("rejects unknown attribute keys before building SQL", () => {
    expect(() => search({ attribute: "passing;DROP TABLE players" })).toThrow(GameError);
    expect(() => search({ personality: "x) OR 1=1 --" })).toThrow(GameError);
  });

  it("matches secondary nationalities from a known int[] id list instead of parsing every profile", () => {
    const withList = search({ country: 7 }, { secondaryNationals: [4, 9] });
    expect(withList.readsProfile).toBe(false);
    expect(withList.where).toContain("(players.country_id = ? OR players.id = ANY(?::int[]))");
    expect(withList.params).toEqual([7, [4, 9]]);
    expect(search({ country: 7 }).where).toContain("players.country_id = ?");
    expect(search({ country: 7 }).params).toEqual([7]);
  });

  it("searches names, nationalities and clubs case-insensitively and escapes LIKE wildcards", () => {
    const result = search({ q: "50%_[x!" });
    expect(result.readsProfile).toBe(false);
    expect(result.where).toContain("players.name ILIKE ? ESCAPE '!'");
    expect(result.where).toContain(
      "players.country_id = ANY(ARRAY(SELECT countries.id FROM countries WHERE countries.name ILIKE ? ESCAPE '!'))",
    );
    expect(result.where).toContain("players.club_id = ANY(ARRAY(SELECT clubs.id FROM clubs WHERE clubs.name ILIKE ? ESCAPE '!'))");
    // [ has no meaning in PostgreSQL LIKE patterns.
    expect(result.params).toEqual(["%50!%!_[x!!%", "%50!%!_[x!!%", "%50!%!_[x!!%"]);
  });

  it("adds sort joins only for the chosen sort and keeps name/id tie-breaks", () => {
    const club = search({ sort: "club", direction: "asc" });
    expect(club.joins).toBe("LEFT JOIN clubs ON clubs.id = players.club_id");
    expect(club.order).toBe("lower(clubs.name) ASC NULLS LAST,lower(players.name) ASC,players.id ASC");
    expect(search({ sort: "club" }).order).toMatch(/^lower\(clubs\.name\) DESC NULLS LAST,/);
    expect(search({ sort: "nationality" }).joins).toBe(
      "JOIN countries AS nationality ON nationality.id = players.country_id",
    );
    expect(search({ sort: "name", direction: "desc" }).order).toBe(
      "lower(players.name) DESC,lower(players.name) ASC,players.id ASC",
    );
    expect(search({ sort: "age" }).order).toBe("players.age DESC,players.birth_date ASC,lower(players.name) ASC,players.id ASC");
    expect(search({ sort: "value" }).joins).toBe("");
  });

  it("filters shortlisted players with the partial shortlist index predicate", () => {
    const result = search({ shortlisted: "1" });
    expect(result.readsProfile).toBe(false);
    expect(result.where).toBe("players.role <> 'Retired' AND players.shortlisted = 1");
  });

  it("ranks a known match set by primary key with missing values last", () => {
    const ranked = playerRanking({ sort: "height", direction: "asc" });
    expect(ranked.where).toBe("players.id = ANY(?::int[])");
    expect(ranked.order).toBe("players.height ASC NULLS LAST,lower(players.name) ASC,players.id ASC");
    expect(search({ sort: "weight" }).readsProfile).toBe(false);
    expect(ranked.params).toEqual([]);
  });

  it("produces read-only single statements with ? placeholders only", () => {
    for (const query of searchQueries) {
      const result = search(query, { today: TODAY, secondaryNationals: [1, 2] });
      const { count, page } = sqlOf(result);
      for (const [sql, extra] of [[count, []], [page, [30, 0]]] as const) {
        const bound = bindSql(sql, [...result.params, ...extra]);
        expect(bound.writes).toBe(false);
        expect(bound.statements).toBe(1);
      }
    }
  });

  it("rejects sort injection at the filter boundary", () => {
    expect(playerFilter.safeParse({ sort: "ability;DROP TABLE players" }).success).toBe(false);
    expect(playerFilter.safeParse({ direction: "desc, id" }).success).toBe(false);
  });

  it("groups second nationalities in linear time without mutating the cached map", () => {
    const cached = new Map([[7, [1, 2]]]);
    const next = addNationals(cached, [
      { id: 5, country: 7 },
      { id: 6, country: 8 },
      { id: 9, country: 7 },
    ]);
    expect([...next]).toEqual([
      [7, [1, 2, 5, 9]],
      [8, [6]],
    ]);
    expect([...cached]).toEqual([[7, [1, 2]]]);
    const rows = Array.from({ length: 200_000 }, (_, index) => ({ id: index + 1, country: 3 }));
    const started = performance.now();
    expect(addNationals(new Map(), rows).get(3)).toHaveLength(200_000);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe.skipIf(!sqlIntegration)("player search SQL on PostgreSQL", () => {
  let store: Store;
  beforeAll(async () => {
    store = await Store.createTest("queries");
  });
  afterAll(async () => {
    await store?.close();
  });

  it("runs every generated search and ranking statement with correctly typed parameters", async () => {
    for (const query of searchQueries) {
      const result = search(query, { today: TODAY, secondaryNationals: [1, 2] });
      const { count, page } = sqlOf(result);
      expect(await store.get(count, ...result.params)).toEqual({ count: 0 });
      expect(await store.all(page, ...result.params, 30, 0)).toEqual([]);
      const ranked = playerRanking(playerFilter.parse(query));
      expect(await store.all(sqlOf(ranked).page, [3, 1, 2], 30, 0)).toEqual([]);
      if (result.profileWhere) {
        expect(await store.all(
          `SELECT players.id FROM players ${result.joins} WHERE ${result.columnWhere} ORDER BY ${result.order} LIMIT ?`,
          ...result.columnParams, 10_001,
        )).toEqual([]);
        expect(await store.all(
          `SELECT players.id FROM players CROSS JOIN LATERAL (SELECT players.profile::jsonb AS doc OFFSET 0) AS profile_json WHERE players.id = ANY(?::int[]) AND ${result.profileWhere}`,
          [1, 2], ...result.profileParams,
        )).toEqual([]);
      }
    }
  });

  it("matches LIKE patterns case-insensitively with escaped wildcards", async () => {
    const matches = async (text: string, q: string) =>
      (await store.get<{ hit: boolean }>("SELECT ?::text ILIKE ? ESCAPE '!' AS hit", text, likePattern(q)))!.hit;
    expect(await matches("Erling Haaland", "haal")).toBe(true);
    expect(await matches("ÉMILE", "émile")).toBe(true);
    expect(await matches("100% fit", "0% f")).toBe(true);
    expect(await matches("1000 fit", "0% f")).toBe(false);
    expect(await matches("a_b", "a_b")).toBe(true);
    expect(await matches("axb", "a_b")).toBe(false);
    expect(await matches("[x]!", "[x]!")).toBe(true);
  });
});
