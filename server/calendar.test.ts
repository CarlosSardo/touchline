import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { generateWorld, planWorld } from "./world.ts";
import {
  CADENCE,
  COMPETITIONS,
  createCalendar,
  NATIONS_SERIES_DATES,
  progressCompetitions,
  scheduleKnockout,
} from "./calendar.ts";
import { addDays, daysBetween, internationalBreak } from "../shared/rules.ts";
import type { Fixture, League } from "../shared/types.ts";
import { drawLeaguePhase } from "./draw.ts";
import { clubCompetitionEligible } from "../shared/competition-rules.ts";
import { CONTINENTAL } from "../shared/world-catalog/index.ts";
import {
  baseMatchdays,
  leagueDates,
  miniLeagueRounds,
  readLeagueData,
  splitMatchdays,
} from "../shared/league-rules.ts";

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
describe("CONMEBOL cadence (pure)", () => {
  const dated = (monthDay: string) => `${Number(monthDay.slice(0, 2)) >= 7 ? 2026 : 2027}-${monthDay}`;
  it("spreads Libertadores and Sudamericana over the season: qualifying, groups, a mid-season break, knockouts, a May final", () => {
    for (const id of ["copa-libertadores", "copa-sudamericana"]) {
      const cadence = CADENCE[id];
      const qualifying = Object.values(cadence.qualifying ?? {}).map(dated);
      const groups = (cadence.matchdays ?? []).map(dated);
      const knockout = (["playoff", "16", "8", "4", "2"] as const).flatMap((size) =>
        cadence.knockout?.[size] ? [dated(cadence.knockout[size]!)] : [],
      );
      const all = [...qualifying, ...groups, ...knockout];
      expect(all.every((date, index) => !index || date > all[index - 1]), id).toBe(true);
      expect(all.every((date) => !internationalBreak(date) && date >= "2026-07-01" && date <= "2027-06-30"), id).toBe(true);
      expect(COMPETITIONS.find((spec) => spec.catalog?.id === id)?.start).toBe(cadence.matchdays![0]);
      expect(groups).toHaveLength(6);
      expect(groups[0] > qualifying.at(-1)!).toBe(true);
      expect(knockout[0] >= "2027-01-01", id).toBe(true);
      expect(knockout.at(-1)!.slice(5, 7), id).toBe("05");
    }
    expect(dated(CADENCE["recopa-sudamericana"].start!) < dated(CADENCE["copa-libertadores"].start!)).toBe(true);
  });
});
describe("2026/27 FIFA windows and continental dates (pure)", () => {
  const dated = (monthDay: string) => `${Number(monthDay.slice(0, 2)) >= 7 ? 2026 : 2027}-${monthDay}`;
  const spaced = (dates: string[]) => dates.every((date, index) => !index || daysBetween(dates[index - 1], date) >= 3);
  it("uses the merged September–October window and a June window after the Champions League final", () => {
    for (const date of ["2026-09-21", "2026-10-06", "2026-11-09", "2027-03-30", "2027-06-07", "2027-06-15"])
      expect(internationalBreak(date), date).toBe(true);
    for (const date of ["2026-09-08", "2026-09-20", "2026-10-07", "2026-10-13", "2027-06-05", "2027-06-16"])
      expect(internationalBreak(date), date).toBe(false);
    const national = NATIONS_SERIES_DATES.map(dated);
    expect(national.every((date) => internationalBreak(date)) && spaced(national)).toBe(true);
  });

  it("keeps every planned round inside the season, outside the FIFA windows and at least three days apart", () => {
    for (const [id, cadence] of Object.entries(CADENCE)) {
      const qualifying = (["q1", "q2", "q3", "q4", "playoff"] as const).flatMap((stage) =>
        cadence.qualifying?.[stage] ? [dated(cadence.qualifying[stage]!)] : [],
      );
      const matchdays = (cadence.matchdays ?? []).map(dated);
      const knockout = (["playoff", "16", "8", "4", "2"] as const).flatMap((size) =>
        cadence.knockout?.[size] ? [dated(cadence.knockout[size]!)] : [],
      );
      for (const dates of [qualifying, matchdays, knockout, cadence.start ? [dated(cadence.start)] : []]) {
        expect(spaced(dates), id).toBe(true);
        expect(dates.every((date) => !internationalBreak(date) && date >= "2026-07-01" && date <= "2027-06-30"), id).toBe(true);
      }
      if (matchdays.length) {
        expect(COMPETITIONS.find((spec) => spec.catalog?.id === id)?.start, id).toBe(cadence.matchdays![0]);
        if (knockout.length) expect(knockout[0] > matchdays.at(-1)!, id).toBe(true);
      }
    }
  });

  it("plays the real 2026/27 UEFA league phases, Youth League champions path and finals", () => {
    const uefa = (id: string) => CADENCE[`uefa-${id}`];
    expect([uefa("champions-league"), uefa("europa-league"), uefa("conference-league")].map((cadence) => [
      cadence.matchdays![0],
      cadence.matchdays!.at(-1),
      cadence.knockout!["2"],
    ])).toEqual([["09-08", "01-27", "06-05"], ["09-17", "01-28", "05-26"], ["10-15", "12-17", "06-02"]]);
    expect(uefa("youth-league").qualifying).toEqual({ q1: "09-16", q2: "10-28", q3: "11-25" });
    expect(uefa("youth-league").matchdays).toEqual(uefa("champions-league").matchdays!.slice(0, 6));
    expect(uefa("youth-league").knockout!["2"]).toBe("04-19");
    expect(COMPETITIONS.find((spec) => spec.catalog?.id === "uefa-super-cup")?.start).toBe("08-12");
  });

  it("ends the AFC finals on 1 and 15 May, CAF qualifying without a play-off round and CONCACAF feeders from 4 August", () => {
    expect(CADENCE["afc-champions-league-elite"].knockout!["2"]).toBe("05-01");
    expect(CADENCE["afc-champions-league-two"]).toMatchObject({ qualifying: { playoff: "08-12" }, knockout: { "2": "05-15" } });
    expect(CADENCE["caf-confederation-cup"].qualifying).toEqual(CADENCE["caf-champions-league"].qualifying);
    expect(CADENCE["caf-champions-league"].start).toBe("11-27");
    expect(addDays(dated(CADENCE["caf-champions-league"].knockout!["2"]!), 7)).toBe("2027-05-31");
    for (const id of ["leagues-cup", "concacaf-caribbean-cup"])
      expect(COMPETITIONS.find((spec) => spec.catalog?.id === id)?.start, id).toBe("08-04");
    expect(CADENCE["leagues-cup"].knockout!["2"]).toBe("09-06");
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

/** One U19 and one U17 league per B-team academy: the parent's group, else the country's first youth league. */
async function academyStandings(store: Store) {
  const youth = await store.all<{ id: number; country_id: number; age_group: string }>(
    "SELECT id,country_id,age_group FROM leagues WHERE kind = 'league' AND age_group IN ('U19','U17') ORDER BY id",
  );
  const members = await store.all<{ league_id: number; club_id: number }>(
    "SELECT standings.league_id,standings.club_id FROM standings JOIN leagues ON leagues.id = standings.league_id WHERE leagues.kind = 'league' AND leagues.age_group IN ('U19','U17')",
  );
  const member = new Set(members.map((row) => `${row.league_id}:${row.club_id}`));
  const rows: { league_id: number; club_id: number }[] = [];
  for (const club of await store.all<{ id: number; parent_id: number; country_id: number }>(
    "SELECT id,parent_id,country_id FROM clubs WHERE type = 'bteam' ORDER BY id",
  ))
    for (const age of ["U19", "U17"]) {
      const leagues = youth.filter((league) => league.age_group === age);
      if (leagues.some((league) => member.has(`${league.id}:${club.id}`))) continue;
      const league =
        leagues.find((row) => member.has(`${row.id}:${club.parent_id}`)) ??
        leagues.find((row) => row.country_id === club.country_id);
      if (league) rows.push({ league_id: league.id, club_id: club.id });
    }
  return rows;
}

describe("domestic league capacity (pure)", () => {
  it("puts every club in one league per age group and gives every league enough matchdays", () => {
    const plan = planWorld({ nations: CALENDAR_NATIONS, structureOnly: true });
    const leagues = (plan.rows.leagues as unknown as League[]).filter((league) => league.kind === "league");
    const byId = new Map(leagues.map((league) => [league.id, league]));
    const seats = new Map<string, number>();
    const sizes = new Map<number, number>();
    for (const row of plan.rows.standings as { league_id: number; club_id: number }[]) {
      const league = byId.get(row.league_id);
      if (!league) continue;
      const seat = `${league.age_group}:${row.club_id}`;
      expect(seats.get(seat), `${seat} in ${league.name}`).toBeUndefined();
      seats.set(seat, league.id);
      sizes.set(league.id, (sizes.get(league.id) ?? 0) + 1);
    }
    for (const league of leagues) {
      const format = readLeagueData(league.data, league.tier);
      const conferences = format.conferences?.length ?? 0;
      const matchdays =
        baseMatchdays(sizes.get(league.id) ?? 0, format.roundRobins, conferences, format.interConference ?? 0) +
        splitMatchdays(format.split) +
        miniLeagueRounds(format.championship, Math.max(1, conferences));
      expect(leagueDates(2026, matchdays), league.name).toHaveLength(matchdays);
    }
  });
});

describe("football calendar", () => {
  let store: Store;
  beforeAll(async () => {
    store = await Store.createTest("calendar");
    await generateWorld(store, { nations: CALENDAR_NATIONS, structureOnly: true });
    await store.bulkInsert("standings", await academyStandings(store));
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

  it("plays the Youth League Domestic Champions Path over two legs from 16 September, top 30 champions entering in round 2", async () => {
    const qualifying = (await store.get<League>(
      "SELECT * FROM leagues WHERE name = 'UEFA Youth League Qualifying' AND country_id IS NULL",
    ))!;
    const data = JSON.parse(qualifying.data) as { stageEntrants: Record<string, number[]> };
    expect(Object.keys(data.stageEntrants).sort()).toEqual(["q1", "q2"]);
    const fixtures = await store.all<Fixture>("SELECT * FROM fixtures WHERE league_id = ? ORDER BY date", qualifying.id);
    expect(fixtures.length).toBeGreaterThan(0);
    expect(fixtures.every((fixture) => JSON.parse(fixture.data).tie?.legs === 2)).toBe(true);
    expect(fixtures[0].date >= "2026-09-16").toBe(true);
    expect(fixtures.every((fixture) => !internationalBreak(fixture.date))).toBe(true);
    const roundTwo = new Set(data.stageEntrants.q2);
    expect(fixtures.filter((fixture) => roundTwo.has(fixture.home_id) || roundTwo.has(fixture.away_id))).toEqual([]);
  });

  it("drops Europa League Q1 losers into the Conference League Q2 main path", async () => {
    const europa = (await store.get<League>(
      "SELECT * FROM leagues WHERE name = 'UEFA Europa League Qualifying' AND country_id IS NULL",
    ))!;
    const first = await store.all<Fixture>("SELECT * FROM fixtures WHERE league_id = ? AND round = 1", europa.id);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((fixture) => JSON.parse(fixture.data).qualifyingStage === "q1")).toBe(true);
    await store.run(
      "UPDATE fixtures SET status = 'played', home_goals = CASE JSON_VALUE(data,'$.tie.leg') WHEN 2 THEN 0 ELSE 1 END, away_goals = 0 WHERE league_id = ? AND round = 1",
      europa.id,
    );
    await progressCompetitions(store, "2026-10-02");
    // The first-leg hosts win 1-0 on aggregate, so the first-leg visitors (the seeded clubs) drop.
    const losers = first.filter((fixture) => JSON.parse(fixture.data).tie?.leg === 1).map((fixture) => fixture.away_id);
    const conference = JSON.parse(
      (await store.get<League>(
        "SELECT * FROM leagues WHERE name = 'UEFA Conference League Qualifying' AND country_id IS NULL",
      ))!.data,
    ) as { stageEntrants: Record<string, number[]>; paths: Record<string, string> };
    expect(losers.filter((clubId) => !conference.stageEntrants.q2?.includes(clubId))).toEqual([]);
    expect(losers.map((clubId) => conference.paths[clubId])).toEqual(losers.map(() => ""));
  });

  it("plays the ACL Elite preliminary round as single matches inside each zone and fills 16 clubs per zone", async () => {
    const elite = CONTINENTAL.competitions.find((competition) => competition.id === "afc-champions-league-elite")!;
    const qualifying = (await store.get<League>(
      "SELECT * FROM leagues WHERE name = ? AND country_id IS NULL",
      `${elite.name} Qualifying`,
    ))!;
    const data = JSON.parse(qualifying.data) as { paths: Record<string, string>; pathTargets: Record<string, number> };
    expect(Object.keys(data.pathTargets).sort()).toEqual(["East", "West"]);
    const fixtures = await store.all<Fixture>("SELECT * FROM fixtures WHERE league_id = ?", qualifying.id);
    expect(fixtures.every((fixture) => data.paths[fixture.home_id] === data.paths[fixture.away_id])).toBe(true);
    expect(fixtures.every((fixture) => JSON.parse(fixture.data).tie?.legs === 1)).toBe(true);
    for (const zone of ["West", "East"])
      expect(fixtures.filter((fixture) => data.paths[fixture.home_id] === zone).length).toBeLessThanOrEqual(2);
    await store.run(
      "UPDATE fixtures SET status = 'played', home_goals = 1, away_goals = 0 WHERE league_id = ?",
      qualifying.id,
    );
    await progressCompetitions(store, "2026-10-03");
    const main = (await store.get<League>("SELECT * FROM leagues WHERE name = ? AND country_id IS NULL", elite.name))!;
    expect(JSON.parse(main.data).phase).toBe("groups");
    for (const zone of ["West", "East"])
      expect(
        await store.all("SELECT club_id FROM standings WHERE league_id = ? AND group_name = ?", main.id, zone),
      ).toHaveLength(elite.teams / elite.zones!.length);
    expect(await store.all("SELECT id FROM fixtures WHERE league_id = ?", main.id)).toHaveLength(
      (elite.teams * elite.matchdays!) / 2,
    );
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

  it("starts the knockout at once when a small league phase leaves one club for the play-offs", async () => {
    const spec = COMPETITIONS.find((competition) => competition.name === "UEFA Conference League")!;
    const id = Number(
      (
        await store.run(
          "INSERT INTO leagues(name,confederation,tier,age_group,kind,reputation,format,data) VALUES (?,'UEFA',0,'Senior','continental',80,'Swiss',?)",
          "Small league phase",
          JSON.stringify({ spec, phase: "groups", season: 2026 }),
        )
      ).lastInsertRowid,
    );
    const clubs = [11, 12, 13, 14, 15, 16, 17, 18, 19];
    await store.bulkInsert(
      "standings",
      clubs.map((club_id, index) => ({ league_id: id, club_id, group_name: "", points: 30 - index })),
    );
    await store.run(
      "INSERT INTO fixtures(league_id,home_id,away_id,date,season,round,stage,seed,status,home_goals,away_goals,data) VALUES (?,11,12,'2026-12-18',2026,?,'League phase','small-league-phase','played',1,0,'{}')",
      id,
      spec.rounds,
    );
    await progressCompetitions(store, "2027-01-30");
    const knockout = await store.all<Fixture>(
      "SELECT * FROM fixtures WHERE league_id = ? AND status = 'scheduled' ORDER BY id",
      id,
    );
    expect(knockout.map((fixture) => [fixture.home_id, fixture.away_id])).toEqual([
      [19, 18],
      [18, 19],
    ]);
    const data = JSON.parse((await store.get<League>("SELECT * FROM leagues WHERE id = ?", id))!.data);
    expect(data.pendingByes).toEqual(clubs.slice(0, 7));
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
