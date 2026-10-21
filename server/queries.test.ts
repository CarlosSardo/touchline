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
];

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
    expect(ranked.order).toContain("(players.profile::jsonb #>> '{identity,height}')::double precision ASC NULLS LAST");
    expect(ranked.params).toEqual([]);
  });

  it("produces read-only single statements with ? placeholders only", () => {
    for (const query of searchQueries) {
      const result = search(query, { secondaryNationals: [1, 2] });
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
      const result = search(query, { secondaryNationals: [1, 2] });
      const { count, page } = sqlOf(result);
      expect(await store.get(count, ...result.params)).toEqual({ count: 0 });
      expect(await store.all(page, ...result.params, 30, 0)).toEqual([]);
      const ranked = playerRanking(playerFilter.parse(query));
      expect(await store.all(sqlOf(ranked).page, [3, 1, 2], 30, 0)).toEqual([]);
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
