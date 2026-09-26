import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import {
  COMPETITIONS,
  createCalendar,
  progressCompetitions,
  scheduleKnockout,
} from "./calendar.ts";
import { internationalBreak } from "../shared/rules.ts";
import type { Fixture, League } from "../shared/types.ts";
import { drawLeaguePhase } from "./draw.ts";
import { clubCompetitionEligible } from "../shared/competition-rules.ts";
import { CONTINENTAL } from "../shared/world-catalog/index.ts";

describe("club competition entry rules", () => {
  it("keeps B-team academies in domestic leagues but excludes reserves and inactive additions from cups and continental events", () => {
    const reserve = { type: "bteam" as const, parent_id: 1, data: "{}" };
    expect(clubCompetitionEligible(reserve, "league", 2026)).toBe(true);
    expect(clubCompetitionEligible(reserve, "cup", 2026)).toBe(false);
    expect(clubCompetitionEligible(reserve, "continental", 2026)).toBe(false);
    expect(clubCompetitionEligible(reserve, "youth", 2026)).toBe(false);
    expect(clubCompetitionEligible({ ...reserve, type: "club" }, "cup", 2026)).toBe(false);
    const future = { type: "club" as const, parent_id: null, data: JSON.stringify({ activeFromSeason: 2027 }) };
    expect(clubCompetitionEligible(future, "league", 2026)).toBe(false);
    expect(clubCompetitionEligible(future, "cup", 2026)).toBe(false);
    expect(clubCompetitionEligible(future, "continental", 2026)).toBe(false);
    expect(clubCompetitionEligible(future, "league", 2027)).toBe(true);
    expect(clubCompetitionEligible(future, "cup", 2027)).toBe(true);
    expect(clubCompetitionEligible({
      ...future, data: JSON.stringify({ activeFromSeason: 2027, pendingSeniorLeague: 10 }),
    }, "continental", 2027)).toBe(false);
  });
});

// Every UEFA association (Russia included, to prove its exclusion), all of CONMEBOL and the clubs of the other access lists.
const CALENDAR_NATIONS = [
  ..."EN ES DE IT FR PT NL BE TR CZ AT CH LI LU SCO DK GR NO PL HR RS UA SE HU IL RO CY SK SI BG IE IS FI KZ AZ GE AM MD BA AL MK ME XK MT GI AD SM FO EE LV LT WAL NIR BY RU".split(" "),
  ..."BR AR UY CO VE EC PE BO PY CL".split(" "),
  ..."SA QA AE IR UZ IQ IN JP KR CN AU TH VN ID PH".split(" "),
  ..."MA EG NG SN DZ TN CI CM CD ZA GH AO".split(" "),
  ..."US CA MX PA CR HN SV GT JM HT DO PR NZ".split(" "),
];

describe("football calendar", () => {
  let store: Store;
  beforeAll(async () => {
    store = await Store.createTest("calendar");
    await generateWorld(store, { nations: CALENDAR_NATIONS, structureOnly: true });
    await store.run(
      "INSERT INTO standings(league_id,club_id) SELECT leagues.id,clubs.id FROM clubs JOIN leagues ON leagues.country_id = clubs.country_id WHERE clubs.type = 'bteam' AND leagues.kind = 'league' AND leagues.age_group IN ('U19','U17') AND NOT EXISTS (SELECT 1 FROM standings WHERE standings.league_id = leagues.id AND standings.club_id = clubs.id)",
    );
    await createCalendar(store);
  }, 600000);
  afterAll(async () => {
    await store?.close();
  });

  it("contains all required continental, national youth and invitational competitions", () => {
    for (const name of [
      ...CONTINENTAL.competitions.map((competition) => competition.name),
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
    expect(COMPETITIONS.some((spec) => spec.confederation === "OFC" && spec.kind === "continental")).toBe(false);
  });

  it("creates a double round-robin with no self-matches or domestic matches in international breaks", async () => {
    const premier = (await store.get<League>(
      "SELECT * FROM leagues WHERE JSON_VALUE(data,'$.catalogKey') = 'L:EN:1'",
    ))!;
    const fixtures = await store.all<Fixture>(
      "SELECT * FROM fixtures WHERE league_id = ? AND stage = 'League'",
      premier.id,
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
    await createCalendar(store);
    expect(
      await store.all(
        "SELECT id FROM fixtures WHERE league_id = ? AND stage = 'League'",
        premier.id,
      ),
    ).toHaveLength(count);
  });

  it("schedules both B-team academies without granting any reserve cup or continental entry", async () => {
    const reserves = await store.all<{ id: number }>(
      "SELECT id FROM clubs WHERE type = 'bteam'",
    );
    expect(reserves.length).toBeGreaterThan(0);
    for (const age of ["U19", "U17"])
      expect(await store.all(
        "SELECT clubs.id FROM clubs WHERE clubs.type = 'bteam' AND NOT EXISTS (SELECT 1 FROM fixtures JOIN leagues ON leagues.id = fixtures.league_id WHERE leagues.kind = 'league' AND leagues.age_group = ? AND clubs.id IN (fixtures.home_id,fixtures.away_id))",
        age,
      )).toEqual([]);
    expect(await store.all(
      "SELECT fixtures.id FROM fixtures JOIN leagues ON leagues.id = fixtures.league_id JOIN clubs ON clubs.id IN (fixtures.home_id,fixtures.away_id) WHERE (clubs.type = 'bteam' OR clubs.parent_id IS NOT NULL) AND leagues.kind != 'league'",
    )).toEqual([]);
  });

  it("retains every eligible UEFA entrant beyond the former qualifying cap without duplicate competition entries", async () => {
    const entered = new Set<number>();
    const luxembourg = (await store.get<{ id: number }>(
      "SELECT id FROM countries WHERE code = 'LU'",
    ))!;
    expect(luxembourg).toBeTruthy();
    const luxembourgClubs = new Set(
      (
        await store.all<{ id: number }>(
          "SELECT id FROM clubs WHERE country_id = ?",
          luxembourg.id,
        )
      ).map((club) => club.id),
    );
    let largestField = 0;
    for (const name of [
      "UEFA Champions League",
      "UEFA Europa League",
      "UEFA Conference League",
    ]) {
      const main = (await store.get<League>(
        "SELECT * FROM leagues WHERE name = ?",
        name,
      ))!;
      const qualification = JSON.parse(main.data).qualification as {
        clubId: number;
      }[];
      const clubs = (
        await store.all<{ club_id: number }>(
          "SELECT standings.club_id FROM standings JOIN leagues ON leagues.id = standings.league_id WHERE leagues.id = ? OR JSON_VALUE(leagues.data,'$.qualificationFor') = ?",
          main.id,
          main.id,
        )
      ).map((entry) => entry.club_id);
      expect(new Set(clubs)).toEqual(
        new Set(qualification.map((entry) => entry.clubId)),
      );
      // Luxembourg enters the Champions and Conference League qualifiers; the Europa League only receives drop-downs.
      expect(clubs.some((clubId) => luxembourgClubs.has(clubId))).toBe(name !== "UEFA Europa League");
      for (const clubId of clubs) {
        expect(entered.has(clubId)).toBe(false);
        entered.add(clubId);
      }
      largestField = Math.max(largestField, clubs.length);
    }
    expect(largestField).toBeGreaterThan(48);
  });

  it("advances all qualifying rounds into the main draw without backdating fixtures after a late finish", async () => {
    const qualifying = (await store.get<League>(
      "SELECT * FROM leagues WHERE name = 'UEFA Champions League Qualifying'",
    ))!;
    expect(qualifying).toBeTruthy();
    let lastDate = "2026-10-01";
    for (let round = 0; round < 10; round++) {
      const current = (await store.get<League>(
        "SELECT * FROM leagues WHERE id = ?",
        qualifying.id,
      ))!;
      if (JSON.parse(current.data).phase === "complete") break;
      const latest = (await store.get<{ date: string }>(
        "SELECT max(date) AS date FROM fixtures WHERE league_id = ?",
        qualifying.id,
      ))!.date;
      if (latest > lastDate) lastDate = latest;
      await store.run(
        "UPDATE fixtures SET status = 'played', home_goals = CASE JSON_VALUE(data,'$.tie.leg') WHEN 2 THEN 0 ELSE 1 END, away_goals = 0 WHERE league_id = ?",
        qualifying.id,
      );
      await progressCompetitions(store, lastDate);
    }
    const main = (await store.get<League>(
      "SELECT * FROM leagues WHERE name = 'UEFA Champions League'",
    ))!;
    expect(JSON.parse(main.data).phase).toBe("groups");
    expect(
      await store.all("SELECT * FROM standings WHERE league_id = ?", main.id),
    ).toHaveLength(36);
    expect(
      await store.all("SELECT * FROM fixtures WHERE league_id = ?", main.id),
    ).toHaveLength(144);
    expect(
      (await store.get<{ date: string }>(
        "SELECT min(date) AS date FROM fixtures WHERE league_id = ?",
        main.id,
      ))!.date > lastDate,
    ).toBe(true);
  });

  it("avoids same-age club fixture collisions and respects recovery days", async () => {
    const collisions = await store.all(
      `WITH appearances AS (
         SELECT fixtures.id,fixtures.date,coalesce(leagues.age_group,'Senior') AS age_group,teams.club_id
         FROM fixtures LEFT JOIN leagues ON leagues.id = fixtures.league_id
         CROSS APPLY (VALUES (fixtures.home_id),(fixtures.away_id)) AS teams(club_id)
       ), ordered AS (
         SELECT id,date,LAG(date) OVER (PARTITION BY club_id,age_group ORDER BY date,id) AS previous_date
         FROM appearances
       )
       SELECT TOP (1) id FROM ordered WHERE DATEDIFF(day,previous_date,date) < 3`,
    );
    expect(collisions).toHaveLength(0);
  });

  it("enters access-list clubs in every continental competition: no Russian club, no club twice, no OFC club event", async () => {
    const byCode = async (code: string) =>
      new Set(
        (
          await store.all<{ id: number }>(
            "SELECT clubs.id FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE countries.code = ?",
            code,
          )
        ).map((club) => club.id),
      );
    const russian = await byCode("RU");
    const liechtenstein = await byCode("LI");
    expect(russian.size).toBeGreaterThan(0);
    const entered = new Map<number, string>();
    for (const competition of CONTINENTAL.competitions) {
      const main = await store.get<League>(
        "SELECT * FROM leagues WHERE name = ? AND country_id IS NULL",
        competition.name,
      );
      const entries = (JSON.parse(main?.data ?? "{}").qualification ?? []) as { clubId: number; stage: string }[];
      if (competition.kind === "club" && competition.age === "Senior") expect(entries.length).toBeGreaterThan(1);
      expect(new Set(entries.map((entry) => entry.clubId)).size).toBe(entries.length);
      expect(entries.filter((entry) => russian.has(entry.clubId))).toEqual([]);
      expect(entries.filter((entry) => entry.stage === "main").length).toBeLessThanOrEqual(competition.teams);
      const qualifying = await store.get<League>(
        "SELECT * FROM leagues WHERE name = ? AND country_id IS NULL",
        `${competition.name} Qualifying`,
      );
      if (entries.some((entry) => entry.stage !== "main")) expect(qualifying).toBeTruthy();
      if (competition.feeder || competition.kind === "super" || competition.age !== "Senior") continue;
      for (const entry of entries) {
        expect(entered.get(entry.clubId)).toBeUndefined();
        entered.set(entry.clubId, competition.name);
      }
    }
    const conference = JSON.parse(
      (await store.get<League>("SELECT * FROM leagues WHERE name = 'UEFA Conference League'"))!.data,
    ).qualification as { clubId: number; stage: string }[];
    expect(conference.filter((entry) => liechtenstein.has(entry.clubId)).map((entry) => entry.stage)).toEqual(["q1"]);
    expect(
      await store.all("SELECT id FROM leagues WHERE kind = 'continental' AND confederation = 'OFC'"),
    ).toEqual([]);
  });

  it("keeps every fixture of the season, continental rounds included, inside July–June", async () => {
    const season = (await store.meta<{ season: number }>("state")).season;
    expect(
      await store.all(
        "SELECT TOP (5) id,date,league_id FROM fixtures WHERE season = ? AND (date < ? OR date > ?)",
        season,
        `${season}-07-01`,
        `${season + 1}-06-30`,
      ),
    ).toEqual([]);
  });
});

describe("competition-specific knockout regulations", () => {
  let store: Store;
  let leagueId: number;
  beforeAll(async () => {
    store = await Store.createTest("knockout-regulations");
    await generateWorld(store, { nations: ["EN"], structureOnly: true });
    const spec = COMPETITIONS.find(
      (competition) => competition.name === "UEFA Champions League",
    )!;
    leagueId = Number(
      (
        await store.run(
          "INSERT INTO leagues(name,confederation,tier,age_group,kind,reputation,format,data) VALUES (?,'UEFA',0,'Senior','continental',95,'Swiss',?)",
          spec.name,
          JSON.stringify({ spec }),
        )
      ).lastInsertRowid,
    );
  });
  afterAll(async () => {
    await store?.close();
  });

  it("schedules two legs and advances the aggregate winner, not each leg winner", async () => {
    await scheduleKnockout(store, leagueId, [1, 2, 3, 4], 2026, "2027-04-07");
    const ties = await store.all<Fixture>(
      "SELECT * FROM fixtures WHERE league_id = ? ORDER BY id",
      leagueId,
    );
    expect(ties).toHaveLength(4);
    const firstLegs = ties.filter(
      (fixture) => JSON.parse(fixture.data).tie.leg === 1,
    );
    expect(firstLegs).toHaveLength(2);
    const expectedWinners: number[] = [];
    for (const first of firstLegs) {
      const second = ties.find(
        (fixture) =>
          fixture.home_id === first.away_id &&
          fixture.away_id === first.home_id,
      )!;
      expect(JSON.parse(second.data).tie.leg).toBe(2);
      expect(second.date > first.date).toBe(true);
      await store.run(
        "UPDATE fixtures SET status = 'played', home_goals = 2, away_goals = 0 WHERE id = ?",
        first.id,
      );
      await store.run(
        "UPDATE fixtures SET status = 'played', home_goals = 3, away_goals = 0 WHERE id = ?",
        second.id,
      );
      expectedWinners.push(second.home_id);
    }
    await progressCompetitions(store, "2027-04-22");
    const finals = await store.all<Fixture>(
      "SELECT * FROM fixtures WHERE league_id = ? AND stage = 'Final'",
      leagueId,
    );
    expect(finals).toHaveLength(1);
    expect([finals[0].home_id, finals[0].away_id].sort()).toEqual(
      expectedWinners.sort(),
    );
  });
});

describe("UEFA league phase draw rules", () => {
  const entrants = Array.from({ length: 36 }, (_, index) => ({
    id: index + 1,
    countryId: (index % 12) + 1,
    coefficient: 100 - index,
  }));
  for (const competition of [
    "UEFA Champions League",
    "UEFA Conference League",
  ]) {
    it(`enforces pot, association, opponent and venue constraints for ${competition}`, () => {
      const draw = drawLeaguePhase(
        entrants,
        competition,
        `rules:${competition}`,
      );
      const rounds = competition === "UEFA Conference League" ? 6 : 8;
      expect(draw.fixtures).toHaveLength((36 * rounds) / 2);
      for (const club of entrants) {
        const fixtures = draw.fixtures.filter(
          (fixture) => fixture.homeId === club.id || fixture.awayId === club.id,
        );
        expect(fixtures).toHaveLength(rounds);
        expect(new Set(fixtures.map((fixture) => fixture.round)).size).toBe(
          rounds,
        );
        expect(
          fixtures.filter((fixture) => fixture.homeId === club.id),
        ).toHaveLength(rounds / 2);
        const opponents = fixtures.map((fixture) =>
          entrants.find(
            (candidate) =>
              candidate.id ===
              (fixture.homeId === club.id ? fixture.awayId : fixture.homeId),
          )!,
        );
        expect(new Set(opponents.map((opponent) => opponent.id)).size).toBe(
          rounds,
        );
        expect(
          opponents.every((opponent) => opponent.countryId !== club.countryId),
        ).toBe(true);
        for (const country of new Set(
          opponents.map((opponent) => opponent.countryId),
        ))
          expect(
            opponents.filter((opponent) => opponent.countryId === country)
              .length,
          ).toBeLessThanOrEqual(2);
        for (const pot of draw.pots)
          expect(
            opponents.filter((opponent) => pot.includes(opponent.id)),
          ).toHaveLength(rounds === 8 ? 2 : 1);
      }
    });
  }
  it("does not silently break association protection for an impossible field", () => {
    expect(() =>
      drawLeaguePhase(
        entrants.map((entrant) => ({ ...entrant, countryId: 1 })),
        "UEFA Champions League",
        "invalid",
      ),
    ).toThrow("association restrictions");
  });
});

describe("world v4 domestic formats and cups (structureOnly)", () => {
  let store: Store;
  let season: number;
  const leagueOf = async (catalogKey: string) =>
    (await store.get<League>(
      "SELECT * FROM leagues WHERE JSON_VALUE(data,'$.catalogKey') = ?",
      catalogKey,
    ))!;
  const perClub = (fixtures: Fixture[]) => {
    const counts = new Map<number, number>();
    for (const fixture of fixtures)
      for (const clubId of [fixture.home_id, fixture.away_id])
        counts.set(clubId, (counts.get(clubId) ?? 0) + 1);
    return counts;
  };
  const playAll = async (leagueId: number) => {
    await store.run(
      "UPDATE fixtures SET status = 'played', home_goals = 1, away_goals = 0 WHERE league_id = ? AND status = 'scheduled'",
      leagueId,
    );
    await store.run("UPDATE standings SET points = 1000 - club_id % 1000 WHERE league_id = ?", leagueId);
  };
  beforeAll(async () => {
    store = await Store.createTest("calendar-v4");
    await generateWorld(store, { nations: ["US", "CA", "EG", "CD", "CH", "LI"], structureOnly: true });
    season = (await store.meta<{ season: number }>("state")).season;
    await createCalendar(store);
  }, 600000);
  afterAll(async () => {
    await store?.close();
  });

  it("plays MLS conferences plus six inter-conference games (34 per club)", async () => {
    const mls = await leagueOf("L:US:1");
    const counts = perClub(
      await store.all<Fixture>("SELECT * FROM fixtures WHERE league_id = ? AND stage = 'League'", mls.id),
    );
    expect(counts.size).toBe(30);
    expect([...counts.values()].every((count) => count === 34)).toBe(true);
  });

  it("keeps every fixture inside July–June with no 48-hour collisions per club and age group", async () => {
    const rows = await store.all<Fixture & { age_group: string }>(
      "SELECT fixtures.*, coalesce(leagues.age_group,'Senior') AS age_group FROM fixtures LEFT JOIN leagues ON leagues.id = fixtures.league_id WHERE fixtures.season = ?",
      season,
    );
    const seen = new Map<string, number[]>();
    for (const fixture of rows) {
      expect(fixture.date >= `${season}-07-01` && fixture.date <= `${season + 1}-06-30`).toBe(true);
      const day = Date.parse(`${fixture.date}T12:00:00Z`) / 86400000;
      for (const clubId of [fixture.home_id, fixture.away_id]) {
        const key = `${fixture.age_group}:${clubId}`;
        const days = seen.get(key) ?? [];
        expect(days.some((other) => Math.abs(other - day) < 3)).toBe(false);
        seen.set(key, [...days, day]);
      }
    }
  });

  it("splits the Egyptian Premier League after one round-robin into groups of 7 and 14", async () => {
    const egypt = await leagueOf("L:EG:1");
    const base = perClub(await store.all<Fixture>("SELECT * FROM fixtures WHERE league_id = ?", egypt.id));
    expect([...base.values()].every((count) => count === 20)).toBe(true);
    await playAll(egypt.id);
    await progressCompetitions(store, `${season + 1}-03-01`);
    const split = await store.all<Fixture>(
      "SELECT * FROM fixtures WHERE league_id = ? AND status = 'scheduled'",
      egypt.id,
    );
    expect(split.filter((fixture) => fixture.group_name === "Championship Group")).toHaveLength(42);
    expect(split.filter((fixture) => fixture.group_name === "Relegation Group")).toHaveLength(91);
    expect(split.every((fixture) => fixture.date <= `${season + 1}-06-30`)).toBe(true);
  });

  it("starts the Linafoot title mini-league on reserved dates and records the Liechtensteiner Cup walkover", async () => {
    const linafoot = await leagueOf("L:CD:1");
    await playAll(linafoot.id);
    await progressCompetitions(store, `${season + 1}-03-01`);
    const playoff = (await store.get<League>("SELECT * FROM leagues WHERE name = ?", `${linafoot.name} Play-offs`))!;
    expect(JSON.parse(playoff.data)).toMatchObject({ key: "title", phase: "playoff", season });
    const counts = perClub(await store.all<Fixture>("SELECT * FROM fixtures WHERE league_id = ?", playoff.id));
    expect(counts.size).toBe(8);
    expect([...counts.values()].every((count) => count === 14)).toBe(true);
    const cup = await store.get<{ data: string }>(
      "SELECT history.data FROM history JOIN leagues ON leagues.id = history.entity_id WHERE history.entity_type = 'champion' AND leagues.name = 'Liechtensteiner Cup' AND history.season = ?",
      season,
    );
    expect(JSON.parse(cup!.data)).toMatchObject({ walkover: true });
  });

  it("opens the Swiss cross-tier play-off once both tiers (split included) have finished", async () => {
    const tiers = [await leagueOf("L:CH:1"), await leagueOf("L:CH:2")];
    for (let pass = 0; pass < 3; pass++) {
      for (const tier of tiers) await playAll(tier.id);
      await progressCompetitions(store, `${season + 1}-05-20`);
    }
    const playoff = await store.get<League>(
      "SELECT * FROM leagues WHERE kind = 'cup' AND country_id = ? AND JSON_VALUE(data,'$.key') = '1:0'",
      tiers[0].country_id,
    );
    expect(JSON.parse(playoff!.data)).toMatchObject({ season, leagueId: tiers[0].id });
    const legs = await store.all<Fixture>("SELECT * FROM fixtures WHERE league_id = ? ORDER BY date", playoff!.id);
    expect(legs).toHaveLength(2);
    expect(legs.every((fixture) => fixture.date > `${season + 1}-05-20` && fixture.date <= `${season + 1}-06-30`)).toBe(true);
  });
});
