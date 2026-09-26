import { describe, expect, it } from "vitest";
import { bindSql } from "./db.ts";
import { addNationals, playerFilter, playerRanking, playerSearch } from "./queries.ts";
import { GameError } from "./systems.ts";

const search = (query: Record<string, unknown>, context?: Parameters<typeof playerSearch>[1]) =>
  playerSearch(playerFilter.parse(query), context);

describe("player search SQL (no database)", () => {
  it("serves the default page from nonclustered indexes only, without no-op range predicates", () => {
    const result = search({});
    expect(result).toMatchObject({
      id: "players.id",
      from: "FROM players AS players JOIN players AS squad ON squad.id = players.id JOIN players AS named ON named.id = players.id",
      joins: "",
      where: "squad.role <> N'Retired'",
      order: "players.ability DESC,named.name COLLATE Latin1_General_100_CI_AI ASC,players.id ASC",
      params: [],
      indexOnly: true,
      filtered: false,
    });
  });

  it("keeps indexed filters index-only and types parameters like their columns", () => {
    const result = search({ position: "ST", ageMin: 17.5, ageMax: 23.9, potentialMin: 60, club: 4, ageGroup: "U19", wageMax: 5000 });
    expect(result.indexOnly).toBe(true);
    expect(result.filtered).toBe(true);
    expect(result.where).toContain("players.position = CAST(? AS nvarchar(16))");
    expect(result.where).toContain("squad.age_group = CAST(? AS nvarchar(32))");
    expect(result.where).toContain("squad.club_id = ?");
    expect(result.where).not.toContain("profile");
    // Integer bounds for the integer age column.
    expect(result.params).toEqual([18, 23, 60, 5000, "ST", 4, "U19"]);
  });

  it("drops only default bounds: an explicit limit is still applied", () => {
    expect(search({ valueMax: 1_000_000_000, abilityMin: 1, potentialMax: 99 }).filtered).toBe(false);
    const limited = search({ valueMax: 2_000_000, abilityMin: 50 });
    expect(limited.where).toContain("players.value <= ?");
    expect(limited.where).toContain("players.ability >= ?");
    expect(limited.params).toEqual([50, 2_000_000]);
  });

  it("falls back to one plain alias when a filter needs the profile JSON", () => {
    const result = search({ attribute: "passing", attributeMin: 70, personality: "professionalism", personalityMin: 50 });
    expect(result.indexOnly).toBe(false);
    expect(result.from).toBe("FROM players AS players");
    expect(result.where).toContain("JSON_VALUE(players.profile, ?)");
    expect(result.params).toEqual(["$.attributes.technical.passing", 70, "$.personality.professionalism", 50]);
  });

  it("rejects unknown attribute keys before building SQL", () => {
    expect(() => search({ attribute: "passing;DROP TABLE players" })).toThrow(GameError);
    expect(() => search({ personality: "x) OR 1=1 --" })).toThrow(GameError);
  });

  it("matches secondary nationalities from a known id list instead of parsing every profile", () => {
    const withList = search({ country: 7 }, { secondaryNationals: [4, 9] });
    expect(withList.indexOnly).toBe(true);
    expect(withList.where).toContain(
      "(nation.country_id = ? OR players.id IN (SELECT CAST([value] AS int) FROM OPENJSON(?)))",
    );
    expect(withList.params).toEqual([7, "[4,9]"]);
    expect(search({ country: 7 }).where).toContain("nation.country_id = ?");
    expect(search({ country: 7 }).params).toEqual([7]);
  });

  it("searches names, nationalities and clubs through indexes and escapes LIKE wildcards", () => {
    const result = search({ q: "50%_[x" });
    expect(result.indexOnly).toBe(true);
    expect(result.where).toContain("named.name LIKE ? ESCAPE '!'");
    expect(result.where).toContain("nation.country_id IN (SELECT countries.id FROM countries WHERE countries.name LIKE ? ESCAPE '!')");
    expect(result.where).toContain("squad.club_id IN (SELECT clubs.id FROM clubs WHERE clubs.name LIKE ? ESCAPE '!')");
    expect(result.params).toEqual(["%50!%!_![x%", "%50!%!_![x%", "%50!%!_![x%"]);
  });

  it("adds sort joins only for the chosen sort and keeps name/id tie-breaks", () => {
    const club = search({ sort: "club", direction: "asc" });
    expect(club.joins).toBe("LEFT JOIN clubs ON clubs.id = squad.club_id");
    expect(club.order).toBe(
      "CASE WHEN clubs.name IS NULL THEN 1 ELSE 0 END,clubs.name COLLATE Latin1_General_100_CI_AI ASC,named.name COLLATE Latin1_General_100_CI_AI ASC,squad.id ASC",
    );
    expect(search({ sort: "nationality" }).joins).toBe(
      "JOIN countries AS nationality ON nationality.id = nation.country_id",
    );
    // Birth dates and form live only in the clustered rows.
    expect(search({ sort: "age" }).indexOnly).toBe(false);
    expect(search({ sort: "form" }).indexOnly).toBe(false);
    expect(search({ sort: "value" }).indexOnly).toBe(true);
  });

  it("reads shortlisted ids from the filtered shortlist index", () => {
    const result = search({ shortlisted: "1" });
    expect(result.indexOnly).toBe(true);
    expect(result.where).toContain(
      "players.id IN (SELECT shortlist.id FROM players AS shortlist WHERE shortlist.shortlisted = 1)",
    );
  });

  it("ranks a known match set through one alias", () => {
    const ranked = playerRanking({ sort: "height", direction: "desc" });
    expect(ranked.from).toBe("FROM players AS players");
    expect(ranked.where).toBe("players.id IN (SELECT CAST([value] AS int) FROM OPENJSON(?))");
    expect(ranked.order).toContain("JSON_VALUE(players.profile,'$.identity.height')");
    expect(ranked.params).toEqual([]);
  });

  it("produces read-only SQL that the schema isolation binder qualifies", () => {
    for (const query of [
      { q: "Smith", country: 3, sort: "club" },
      { attribute: "passing", attributeMin: 70, sort: "nationality" },
      { shortlisted: "1", sort: "position", direction: "asc" },
    ]) {
      const result = search(query, { secondaryNationals: [1, 2] });
      for (const sql of [
        `SELECT count(*) AS count FROM (SELECT TOP (10001) ${result.id} AS id ${result.from} WHERE ${result.where}) AS matches`,
        `SELECT ${result.id} AS id ${result.from} ${result.joins} WHERE ${result.where} ORDER BY ${result.order} OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`,
      ]) {
        const extra = sql.endsWith("ONLY") ? [0, 30] : [];
        const bound = bindSql(sql, [...result.params, ...extra], "touchline_test_search");
        expect(bound.writes).toBe(false);
        expect(bound.sql).toContain("[touchline_test_search].players AS");
        expect(bound.sql).not.toMatch(/(FROM|JOIN) (players|clubs|countries)\b/);
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
