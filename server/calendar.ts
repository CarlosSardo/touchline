import roundrobin from "roundrobin";
import { Store } from "./db.ts";
import { addDays, daysBetween, internationalBreak } from "../shared/rules.ts";
import {
  knockoutRules,
  knockoutWinner,
  type KnockoutTie,
} from "../shared/competition-rules.ts";
import { drawLeaguePhase } from "./draw.ts";
import { continentalEntries } from "./qualification.ts";
import type {
  AgeGroup,
  Club,
  Country,
  Fixture,
  GameState,
  League,
  Settings,
  Standing,
} from "../shared/types.ts";

export interface CompetitionSpec {
  name: string;
  confederation: string;
  age: AgeGroup;
  kind: League["kind"];
  teams: number;
  format: "Swiss" | "Groups" | "Knockout";
  rounds: number;
  qualifies: number;
  start: string;
  national?: boolean;
  country?: string;
  qualifier?: boolean;
}

export const COMPETITIONS: CompetitionSpec[] = [
  {
    name: "UEFA Champions League",
    confederation: "UEFA",
    age: "Senior",
    kind: "continental",
    teams: 36,
    format: "Swiss",
    rounds: 8,
    qualifies: 16,
    start: "09-16",
    qualifier: true,
  },
  {
    name: "UEFA Europa League",
    confederation: "UEFA",
    age: "Senior",
    kind: "continental",
    teams: 36,
    format: "Swiss",
    rounds: 8,
    qualifies: 16,
    start: "09-17",
    qualifier: true,
  },
  {
    name: "UEFA Conference League",
    confederation: "UEFA",
    age: "Senior",
    kind: "continental",
    teams: 36,
    format: "Swiss",
    rounds: 6,
    qualifies: 16,
    start: "10-01",
    qualifier: true,
  },
  {
    name: "UEFA Youth League",
    confederation: "UEFA",
    age: "U19",
    kind: "youth",
    teams: 36,
    format: "Swiss",
    rounds: 6,
    qualifies: 16,
    start: "09-16",
    qualifier: true,
  },
  {
    name: "Copa Libertadores",
    confederation: "CONMEBOL",
    age: "Senior",
    kind: "continental",
    teams: 32,
    format: "Groups",
    rounds: 6,
    qualifies: 16,
    start: "02-17",
    qualifier: true,
  },
  {
    name: "Copa Sudamericana",
    confederation: "CONMEBOL",
    age: "Senior",
    kind: "continental",
    teams: 32,
    format: "Groups",
    rounds: 6,
    qualifies: 16,
    start: "02-18",
    qualifier: true,
  },
  {
    name: "AFC Champions League",
    confederation: "AFC",
    age: "Senior",
    kind: "continental",
    teams: 24,
    format: "Swiss",
    rounds: 8,
    qualifies: 16,
    start: "09-16",
    qualifier: true,
  },
  {
    name: "CAF Champions League",
    confederation: "CAF",
    age: "Senior",
    kind: "continental",
    teams: 16,
    format: "Groups",
    rounds: 6,
    qualifies: 8,
    start: "11-20",
    qualifier: true,
  },
  {
    name: "CONCACAF Champions League",
    confederation: "CONCACAF",
    age: "Senior",
    kind: "continental",
    teams: 32,
    format: "Knockout",
    rounds: 5,
    qualifies: 1,
    start: "02-16",
    qualifier: true,
  },
  {
    name: "OFC Champions League",
    confederation: "OFC",
    age: "Senior",
    kind: "continental",
    teams: 8,
    format: "Groups",
    rounds: 3,
    qualifies: 4,
    start: "03-10",
    qualifier: true,
  },
  {
    name: "FIFA U17 World Cup",
    confederation: "FIFA",
    age: "U17",
    kind: "international",
    teams: 48,
    format: "Groups",
    rounds: 3,
    qualifies: 32,
    start: "11-01",
    national: true,
    qualifier: true,
  },
  {
    name: "FIFA U20 World Cup",
    confederation: "FIFA",
    age: "U20",
    kind: "international",
    teams: 24,
    format: "Groups",
    rounds: 3,
    qualifies: 16,
    start: "06-01",
    national: true,
    qualifier: true,
  },
  ...["UEFA", "CONMEBOL", "AFC", "CAF", "CONCACAF", "OFC"].flatMap(
    (confederation) =>
      (["U17", "U19"] as AgeGroup[]).map((age) => ({
        name: `${confederation} ${age} Championship`,
        confederation,
        age,
        kind: "international" as const,
        teams: 16,
        format: "Groups" as const,
        rounds: 3,
        qualifies: 8,
        start: age === "U17" ? "09-02" : "03-22",
        national: true,
        qualifier: true,
      })),
  ),
  {
    name: "MIC",
    confederation: "FIFA",
    age: "U17",
    kind: "youth",
    teams: 32,
    format: "Groups",
    rounds: 3,
    qualifies: 16,
    start: "04-01",
    qualifier: true,
  },
  {
    name: "Viareggio",
    confederation: "FIFA",
    age: "U19",
    kind: "youth",
    teams: 24,
    format: "Groups",
    rounds: 3,
    qualifies: 16,
    start: "03-08",
    qualifier: true,
  },
  {
    name: "Copinha",
    confederation: "CONMEBOL",
    age: "U20",
    kind: "youth",
    teams: 128,
    format: "Groups",
    rounds: 3,
    qualifies: 64,
    start: "01-02",
    country: "BR",
    qualifier: true,
  },
  {
    name: "Future Cup",
    confederation: "FIFA",
    age: "U17",
    kind: "youth",
    teams: 8,
    format: "Groups",
    rounds: 3,
    qualifies: 4,
    start: "04-10",
    qualifier: true,
  },
  {
    name: "Alkass Cup",
    confederation: "FIFA",
    age: "U17",
    kind: "youth",
    teams: 12,
    format: "Groups",
    rounds: 3,
    qualifies: 8,
    start: "02-05",
    qualifier: true,
  },
  {
    name: "Generation Adidas Cup",
    confederation: "FIFA",
    age: "U17",
    kind: "youth",
    teams: 40,
    format: "Groups",
    rounds: 3,
    qualifies: 16,
    start: "04-02",
    qualifier: true,
  },
  ...["UEFA", "CONMEBOL", "AFC", "CAF", "CONCACAF", "OFC"].map(
    (confederation) => ({
      name: `${confederation} Nations Series`,
      confederation,
      age: "Senior" as const,
      kind: "international" as const,
      teams: 24,
      format: "Groups" as const,
      rounds: 6,
      qualifies: 8,
      start: "09-03",
      national: true,
    }),
  ),
];

export interface CompetitionData {
  spec?: CompetitionSpec;
  phase?: string;
  season?: number;
  direct?: number[];
  qualifiers?: number[];
  qualificationFor?: number;
  slots?: number;
  pendingByes?: number[];
  nextRound?: number;
  champion?: number;
  championName?: string;
  qualified?: number[];
  history?: unknown[];
  playoffByes?: number[];
  [key: string]: unknown;
}

const seasonDate = (season: number, monthDay: string) =>
  `${Number(monthDay.slice(0, 2)) >= 7 ? season : season + 1}-${monthDay}`;

function matchDates(season: number, count: number) {
  const available: string[] = [];
  let date = `${season}-08-08`;
  while (new Date(`${date}T12:00:00Z`).getUTCDay() !== 6)
    date = addDays(date, 1);
  while (date <= `${season + 1}-05-31`) {
    if (!internationalBreak(date) && date.slice(5) !== "12-26")
      available.push(date);
    date = addDays(date, 7);
  }
  for (const extra of ["12-29", "01-20", "02-03", "04-21", "05-12"]) {
    if (available.length >= count) break;
    available.push(seasonDate(season, extra));
  }
  available.sort();
  return Array.from(
    { length: count },
    (_, index) => available[Math.floor((index * available.length) / count)],
  );
}

interface FixtureBatch {
  nextId: number;
  ages: Map<number, string>;
  national: Set<number>;
  occupied: Map<string, Set<number>>;
  scheduledLeagues: Set<number>;
  rows: Record<string, string | number | null>[];
}

const fixtureBatches = new WeakMap<Store, FixtureBatch>();
const fixtureDay = (date: string) => Date.parse(`${date}T12:00:00Z`) / 86400000;

async function flushFixtures(store: Store, batch: FixtureBatch) {
  if (!batch.rows.length) return;
  await store.bulkInsert("fixtures", batch.rows);
  batch.rows = [];
}

async function withFixtureBatch<Result>(
  store: Store,
  season: number,
  callback: () => Promise<Result>,
): Promise<Result> {
  if (fixtureBatches.has(store)) return callback();
  return store.transaction(async () => {
    const lastId = (await store.get<{ id: number }>(
      "SELECT coalesce(max(id),0) AS id FROM fixtures WITH (UPDLOCK,HOLDLOCK)",
    ))!.id;
    const ages = await store.all<{ id: number; age_group: string }>(
      "SELECT id,age_group FROM leagues",
    );
    const national = await store.all<{ id: number }>(
      "SELECT id FROM clubs WHERE type = 'national'",
    );
    const existing = await store.all<{
      home_id: number;
      away_id: number;
      date: string;
      league_id: number | null;
      age_group: string;
      season: number;
    }>(
      "SELECT fixtures.home_id,fixtures.away_id,fixtures.date,fixtures.league_id,fixtures.season,coalesce(leagues.age_group,'Senior') AS age_group FROM fixtures LEFT JOIN leagues ON leagues.id = fixtures.league_id WHERE fixtures.date >= ?",
      `${season}-01-01`,
    );
    const batch: FixtureBatch = {
      nextId: lastId,
      ages: new Map(ages.map((league) => [league.id, league.age_group])),
      national: new Set(national.map((club) => club.id)),
      occupied: new Map(),
      scheduledLeagues: new Set(),
      rows: [],
    };
    for (const fixture of existing) {
      if (fixture.league_id && fixture.season === season)
        batch.scheduledLeagues.add(fixture.league_id);
      for (const clubId of [fixture.home_id, fixture.away_id]) {
        const key = `${fixture.age_group}:${clubId}`;
        const dates = batch.occupied.get(key) ?? new Set<number>();
        dates.add(fixtureDay(fixture.date));
        batch.occupied.set(key, dates);
      }
    }
    fixtureBatches.set(store, batch);
    try {
      const result = await callback();
      await flushFixtures(store, batch);
      return result;
    } finally {
      fixtureBatches.delete(store);
    }
  });
}

async function addFixture(
  store: Store,
  leagueId: number | null,
  season: number,
  date: string,
  home: number,
  away: number,
  stage: string,
  round: number,
  group = "",
  details: Record<string, unknown> = {},
): Promise<string | undefined> {
  if (!home || !away || home === away) return;
  const batch = fixtureBatches.get(store)!;
  const ageGroup = leagueId ? batch.ages.get(leagueId)! : "Senior";
  const busy = (date: string) => {
    const day = fixtureDay(date);
    for (const clubId of [home, away]) {
      const dates = batch.occupied.get(`${ageGroup}:${clubId}`);
      for (let offset = -2; offset <= 2; offset++)
        if (dates?.has(day + offset)) return true;
    }
    return false;
  };
  let scheduled = date;
  let attempts = 0;
  while (busy(scheduled)) {
    scheduled = addDays(scheduled, 1);
    if (ageGroup === "Senior" && !batch.national.has(home))
      while (internationalBreak(scheduled)) scheduled = addDays(scheduled, 1);
    if (++attempts > 150)
      throw new Error("The competition calendar has no safe fixture slot.");
  }
  batch.rows.push({
    id: ++batch.nextId,
    league_id: leagueId,
    season,
    date: scheduled,
    home_id: home,
    away_id: away,
    stage,
    round,
    group_name: group,
    seed: `${season}:${leagueId}:${home}:${away}:${round}:${stage}`,
    data: JSON.stringify(details),
  });
  if (leagueId) batch.scheduledLeagues.add(leagueId);
  for (const clubId of [home, away]) {
    const key = `${ageGroup}:${clubId}`;
    const dates = batch.occupied.get(key) ?? new Set<number>();
    dates.add(fixtureDay(scheduled));
    batch.occupied.set(key, dates);
  }
  if (batch.rows.length === 1000) await flushFixtures(store, batch);
  return scheduled;
}

async function createLeague(
  store: Store,
  spec: CompetitionSpec,
  countryId: number | null = null,
) {
  const existing = await store.get<{ id: number }>(
    "SELECT id FROM leagues WHERE name = ?",
    spec.name,
  );
  if (existing) {
    await store.run("DELETE FROM standings WHERE league_id = ?", existing.id);
    await store.run(
      "UPDATE leagues SET data = ? WHERE id = ?",
      JSON.stringify({ spec }),
      existing.id,
    );
    return existing.id;
  }
  const id = Number(
    (
      await store.run(
        "INSERT INTO leagues(name, country_id, confederation, tier, age_group, kind, reputation, format, data) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)",
        spec.name,
        countryId,
        spec.confederation,
        spec.age,
        spec.kind,
        spec.kind === "continental"
          ? 95
          : spec.kind === "international"
            ? 85
            : 65,
        spec.format,
        JSON.stringify({ spec }),
      )
    ).lastInsertRowid,
  );
  fixtureBatches.get(store)?.ages.set(id, spec.age);
  return id;
}

async function setData(store: Store, leagueId: number, data: CompetitionData) {
  await store.run(
    "UPDATE leagues SET data = ? WHERE id = ?",
    JSON.stringify(data),
    leagueId,
  );
}

export async function scheduleKnockout(
  store: Store,
  leagueId: number,
  clubs: number[],
  season: number,
  date: string,
  round = 1,
  extra: CompetitionData = {},
) {
  return withFixtureBatch(store, season, async () => {
    const data: CompetitionData = {
      ...JSON.parse(
        (await store.get<League>(
          "SELECT * FROM leagues WHERE id = ?",
          leagueId,
        ))!.data,
      ),
      ...extra,
    };
    const size = 2 ** Math.ceil(Math.log2(clubs.length));
    const byes = Math.max(0, size - clubs.length);
    const playing = clubs.slice(byes);
    const stage = data.qualificationFor
      ? "Qualifying"
      : size === 2
        ? "Final"
        : size === 4
          ? "Semi-final"
          : size === 8
            ? "Quarter-final"
            : `Round of ${size}`;
    const league = (await store.get<League>(
      "SELECT * FROM leagues WHERE id = ?",
      leagueId,
    ))!;
    const rules = knockoutRules(data.spec?.name ?? league.name, stage);
    for (let index = 0; index < playing.length / 2; index++) {
      const seeded = playing[index];
      const opponent = playing[playing.length - 1 - index];
      const tie: KnockoutTie = {
        ...rules,
        id: `${season}:${leagueId}:${round}:${index}`,
        leg: 1,
      };
      const firstDate = await addFixture(
        store,
        leagueId,
        season,
        date,
        rules.legs === 2 ? opponent : seeded,
        rules.legs === 2 ? seeded : opponent,
        stage,
        round,
        "",
        { tie },
      );
      if (rules.legs === 2) {
        await addFixture(
          store,
          leagueId,
          season,
          addDays(firstDate!, 7),
          seeded,
          opponent,
          stage,
          round,
          "",
          { tie: { ...tie, leg: 2 } },
        );
      }
    }
    await setData(store, leagueId, {
      ...data,
      phase: "knockout",
      season,
      nextRound: round,
      pendingByes: clubs.slice(0, byes),
    });
  });
}

export async function setupMainCompetition(
  store: Store,
  leagueId: number,
  clubs: number[],
  spec: CompetitionSpec,
  season: number,
  earliestDate?: string,
) {
  return withFixtureBatch(store, season, async () => {
    const oldData: CompetitionData = JSON.parse(
      (await store.get<League>("SELECT * FROM leagues WHERE id = ?", leagueId))!
        .data,
    );
    await store.run("DELETE FROM standings WHERE league_id = ?", leagueId);
    const uniqueClubs = [...new Set(clubs)];
    if (uniqueClubs.length < 2) return;
    const plannedStart = seasonDate(season, spec.start);
    const start =
      earliestDate && earliestDate > plannedStart ? earliestDate : plannedStart;
    const gap =
      spec.kind === "continental" || spec.name === "UEFA Youth League" ? 14 : 3;
    await setData(store, leagueId, {
      ...oldData,
      spec,
      season,
      phase: spec.format === "Knockout" ? "knockout" : "groups",
      qualified: uniqueClubs,
      champion: undefined,
      championName: undefined,
    });
    if (spec.format === "Knockout") {
      await store.bulkInsert(
        "standings",
        uniqueClubs.map((clubId) => ({
          league_id: leagueId,
          club_id: clubId,
          group_name: "",
        })),
      );
      await scheduleKnockout(store, leagueId, uniqueClubs, season, start);
      return;
    }
    if (
      [
        "UEFA Champions League",
        "UEFA Europa League",
        "UEFA Conference League",
      ].includes(spec.name) &&
      uniqueClubs.length === 36
    ) {
      const entrants = await store.all<Club>(
        `SELECT * FROM clubs WHERE id IN (${uniqueClubs.map(() => "?").join(",")})`,
        ...uniqueClubs,
      );
      const byId = new Map(entrants.map((club) => [club.id, club]));
      const draw = drawLeaguePhase(
        uniqueClubs.map((id) => {
          const club = byId.get(id)!;
          return {
            id,
            countryId: club.country_id,
            coefficient: club.reputation,
          };
        }),
        spec.name,
        `${season}:${spec.name}`,
      );
      await store.bulkInsert(
        "standings",
        uniqueClubs.map((clubId) => ({
          league_id: leagueId,
          club_id: clubId,
          group_name: "League phase",
        })),
      );
      const dates =
        spec.name === "UEFA Conference League"
          ? ["10-01", "10-22", "11-05", "11-26", "12-10", "12-17"]
          : [
              "09-16",
              "09-30",
              "10-21",
              "11-04",
              "11-25",
              "12-09",
              "01-20",
              "01-27",
            ];
      const weekdayOffset = spec.name === "UEFA Europa League" ? 1 : 0;
      const firstRoundDate = addDays(
        seasonDate(season, dates[0]),
        weekdayOffset,
      );
      const scheduleDelay = earliestDate
        ? Math.max(0, daysBetween(firstRoundDate, earliestDate))
        : 0;
      for (const fixture of draw.fixtures) {
        const date = addDays(
          seasonDate(season, dates[fixture.round - 1]),
          weekdayOffset + scheduleDelay,
        );
        await addFixture(
          store,
          leagueId,
          season,
          date,
          fixture.homeId,
          fixture.awayId,
          "League phase",
          fixture.round,
          "League phase",
        );
      }
      await setData(store, leagueId, {
        ...oldData,
        spec,
        season,
        phase: "groups",
        qualified: uniqueClubs,
        draw,
        regulationsVersion: 1,
      });
      return;
    }
    const groups =
      spec.format === "Swiss"
        ? [uniqueClubs]
        : Array.from(
            { length: Math.ceil(uniqueClubs.length / 4) },
            () => [] as number[],
          );
    if (spec.format !== "Swiss")
      uniqueClubs.forEach((club, index) =>
        groups[index % groups.length].push(club),
      );
    for (const [groupIndex, group] of groups.entries()) {
      const groupName =
        spec.format === "Swiss" ? "League phase" : `Group ${groupIndex + 1}`;
      await store.bulkInsert(
        "standings",
        group.map((clubId) => ({
          league_id: leagueId,
          club_id: clubId,
          group_name: groupName,
        })),
      );
      const firstLeg = roundrobin(group.length, group);
      const schedule = [
        ...firstLeg,
        ...firstLeg.map((pairs) =>
          pairs.map(([home, away]) => [away, home] as [number, number]),
        ),
      ].slice(0, spec.rounds);
      for (const [round, pairs] of schedule.entries()) {
        let date = addDays(start, round * gap);
        if (spec.confederation === "UEFA" && spec.format === "Swiss") {
          const roundDates = [
            "09-16",
            "09-30",
            "10-21",
            "11-04",
            "11-25",
            "12-09",
            "01-20",
            "01-27",
          ];
          date = seasonDate(season, roundDates[round] ?? "01-27");
          if (
            spec.name === "UEFA Europa League" ||
            spec.name === "UEFA Conference League"
          )
            date = addDays(date, 1);
          const firstRoundDate = addDays(
            seasonDate(season, roundDates[0]),
            spec.name === "UEFA Champions League" ? 0 : 1,
          );
          if (earliestDate)
            date = addDays(
              date,
              Math.max(0, daysBetween(firstRoundDate, earliestDate)),
            );
        }
        if (spec.kind === "continental" || spec.name === "UEFA Youth League")
          while (internationalBreak(date)) date = addDays(date, 7);
        if (spec.national && spec.age === "Senior")
          date =
            [
              `${season}-09-03`,
              `${season}-09-08`,
              `${season}-10-07`,
              `${season}-10-12`,
              `${season}-11-11`,
              `${season}-11-16`,
            ][round] ?? date;
        for (const [home, away] of pairs)
          await addFixture(
            store,
            leagueId,
            season,
            date,
            home,
            away,
            spec.format === "Swiss" ? "League phase" : "Group stage",
            round + 1,
            groupName,
          );
      }
    }
  });
}

export async function scheduleDomesticLeagues(
  store: Store,
  leagues: League[],
  season: number,
  fromDate?: string,
) {
  return withFixtureBatch(store, season, async () => {
    for (const league of leagues)
      await scheduleDomesticLeague(store, league, season, fromDate);
  });
}

export async function scheduleDomesticLeague(
  store: Store,
  league: League,
  season: number,
  fromDate?: string,
) {
  return withFixtureBatch(store, season, async () => {
    if (Number(JSON.parse(league.data).activeFromSeason ?? season) > season)
      return;
    if (fixtureBatches.get(store)!.scheduledLeagues.has(league.id)) return;
    const entries = (
      await store.all<{ club_id: number }>(
        "SELECT club_id FROM standings WHERE league_id = ? ORDER BY club_id",
        league.id,
      )
    ).map((entry) => entry.club_id);
    if (entries.length < 2) return;
    const firstLeg = roundrobin(entries.length, entries);
    const schedule = [
      ...firstLeg,
      ...firstLeg.map((pairs) =>
        pairs.map(([home, away]) => [away, home] as [number, number]),
      ),
    ];
    const dates = matchDates(season, schedule.length);
    if (fromDate && dates[0] < fromDate) return;
    for (const [round, pairs] of schedule.entries()) {
      for (const [home, away] of pairs)
        await addFixture(
          store,
          league.id,
          season,
          dates[round],
          home,
          away,
          "League",
          round + 1,
        );
    }
    if (league.age_group === "Senior") {
      for (const [round, pairs] of firstLeg.slice(0, 2).entries()) {
        const date = `${season}-07-${round === 0 ? "11" : "25"}`;
        if (fromDate && date < fromDate) continue;
        for (const [home, away] of pairs)
          await addFixture(
            store,
            null,
            season,
            date,
            home,
            away,
            "Pre-season friendly",
            round + 1,
          );
      }
    }
  });
}

export async function createCalendar(store: Store) {
  const state = await store.meta<GameState>("state");
  if (
    (
      await store.get<{ value: string }>(
        "SELECT value FROM meta WHERE [key] = ?",
        "calendarSeason",
      )
    )?.value === JSON.stringify(state.season)
  )
    return;
  const season = state.season;
  const settings = await store.meta<Settings>("settings");
  await store.transaction(() =>
    withFixtureBatch(store, season, async () => {
      for (const league of await store.all<League>(
        "SELECT * FROM leagues WHERE kind = 'league' ORDER BY id",
      )) {
        await scheduleDomesticLeague(store, league, season);
      }
      const countries = await store.all<Country>(
        "SELECT * FROM countries ORDER BY id",
      );
      for (const country of countries) {
        for (const age of ["U17", "U19"] as AgeGroup[]) {
          const entries = (
            await store.all<{ club_id: number }>(
              "SELECT standings.club_id FROM standings JOIN leagues ON leagues.id = standings.league_id WHERE leagues.country_id = ? AND leagues.age_group = ? AND leagues.kind = 'league' ORDER BY leagues.id,standings.club_id",
              country.id,
              age,
            )
          ).map((entry) => entry.club_id);
          const spec: CompetitionSpec = {
            name: `${country.name} ${age} Cup`,
            confederation: country.confederation,
            age,
            kind: "cup",
            teams: entries.length,
            format: "Knockout",
            rounds: 3,
            qualifies: 1,
            start: "12-02",
          };
          const leagueId = await createLeague(store, spec, country.id);
          await setupMainCompetition(store, leagueId, entries, spec, season);
          const superSpec: CompetitionSpec = {
            ...spec,
            name: `${country.name} ${age} Super Cup`,
            teams: 2,
            rounds: 1,
            start: "07-18",
          };
          const superId = await createLeague(store, superSpec, country.id);
          await setupMainCompetition(
            store,
            superId,
            entries.slice(0, 2),
            superSpec,
            season,
          );
        }
        const seniorEntries = (
          await store.all<{ id: number }>(
            "SELECT TOP (32) id FROM clubs WHERE country_id = ? AND type = 'club' ORDER BY reputation DESC,id",
            country.id,
          )
        ).map((club) => club.id);
        const cupSpec: CompetitionSpec = {
          name: `${country.name} National Cup`,
          confederation: country.confederation,
          age: "Senior",
          kind: "cup",
          teams: seniorEntries.length,
          format: "Knockout",
          rounds: 5,
          qualifies: 1,
          start: "10-21",
        };
        await setupMainCompetition(
          store,
          await createLeague(store, cupSpec, country.id),
          seniorEntries,
          cupSpec,
          season,
        );
      }
      const previousTables = new Map<number, Standing[]>();
      for (const archived of await store.all<{
        entity_id: number;
        data: string;
      }>(
        "SELECT entity_id,data FROM history WHERE entity_type = 'league' AND season = ? ORDER BY id",
        season - 1,
      ))
        previousTables.set(
          archived.entity_id,
          JSON.parse(archived.data).table ?? [],
        );
      const usedSenior = new Set<number>();
      for (const spec of COMPETITIONS) {
        if (
          settings.youthTournamentFrequency === "low" &&
          spec.kind === "youth" &&
          spec.name !== "UEFA Youth League" &&
          season % 2 === 1
        ) {
          const restingId = await createLeague(store, spec);
          await setData(store, restingId, {
            spec,
            season,
            phase: "rest year",
            nextEdition: season + 1,
          });
          continue;
        }
        const ageLimit =
          spec.age === "Senior"
            ? "Senior"
            : spec.age === "U20"
              ? "U19"
              : spec.age;
        let clubs = await store.all<Club>(
          `SELECT DISTINCT clubs.* FROM clubs JOIN countries ON countries.id = clubs.country_id ${!spec.national && spec.age !== "Senior" ? "JOIN standings ON standings.club_id = clubs.id JOIN leagues ON leagues.id = standings.league_id AND leagues.kind = 'league' AND leagues.age_group = ?" : ""} WHERE clubs.type = ? ${spec.national ? "AND clubs.age_group = ?" : ""} ${spec.confederation !== "FIFA" ? "AND countries.confederation = ?" : ""} ORDER BY clubs.reputation DESC, clubs.id`,
          ...(!spec.national && spec.age !== "Senior" ? [ageLimit] : []),
          spec.national ? "national" : "club",
          ...(spec.national ? [spec.age] : []),
          ...(spec.confederation !== "FIFA" ? [spec.confederation] : []),
        );
        if (spec.kind === "continental" && spec.age === "Senior")
          clubs = clubs.filter((club) => !usedSenior.has(club.id));
        const ranked = clubs
          .map((club) => {
            const previous = previousTables.get(club.league_id ?? 0) ?? [];
            const place = previous.findIndex(
              (entry) => entry.club_id === club.id,
            );
            return {
              club,
              score: club.reputation - (place < 0 ? 0 : place * 4),
            };
          })
          .sort((left, right) => right.score - left.score);
        const perCountry = new Map<number, number>();
        let candidates = ranked
          .filter(({ club }) => {
            const count = perCountry.get(club.country_id) ?? 0;
            perCountry.set(club.country_id, count + 1);
            return (
              spec.national ||
              spec.name === "Copinha" ||
              count < (spec.kind === "continental" ? 6 : 5)
            );
          })
          .map(({ club }) => club);
        let qualification: Awaited<ReturnType<typeof continentalEntries>> = [];
        if (
          spec.confederation === "UEFA" &&
          spec.age === "Senior" &&
          spec.kind === "continental"
        ) {
          qualification = await continentalEntries(
            store,
            spec.name,
            season,
            usedSenior,
          );
          candidates = qualification.map((entry) => entry.club);
        }
        if (candidates.length < 2) continue;
        const teamCount = Math.min(
          spec.teams,
          candidates.length - (candidates.length % 2),
        );
        const mainId = await createLeague(store, spec);
        if (qualification.length)
          await setData(store, mainId, {
            spec,
            qualification: qualification.map(({ club, ...entry }) => ({
              clubId: club.id,
              ...entry,
            })),
            regulationsVersion: 1,
          });
        const allIds = candidates.map((club) => club.id);
        if (spec.kind === "continental")
          (qualification.length
            ? allIds
            : allIds.slice(0, teamCount + 12)
          ).forEach((id) => usedSenior.add(id));
        const canQualify = spec.qualifier && allIds.length >= teamCount + 4;
        if (canQualify) {
          const slots = Math.min(4, Math.floor(teamCount / 4));
          const direct = allIds.slice(0, teamCount - slots);
          const qualifying = allIds.slice(
            teamCount - slots,
            qualification.length ? undefined : teamCount - slots + slots * 4,
          );
          const qualifyingSpec: CompetitionSpec = {
            ...spec,
            name: `${spec.name} Qualifying`,
            format: "Knockout",
            teams: qualifying.length,
            qualifies: slots,
          };
          const qualifyingId = await createLeague(store, qualifyingSpec);
          await store.bulkInsert(
            "standings",
            qualifying.map((clubId) => ({
              league_id: qualifyingId,
              club_id: clubId,
            })),
          );
          await store.bulkInsert(
            "standings",
            direct.map((clubId) => ({
              league_id: mainId,
              club_id: clubId,
              group_name: "Qualified",
            })),
          );
          await setData(store, mainId, {
            ...JSON.parse(
              (await store.get<League>(
                "SELECT * FROM leagues WHERE id = ?",
                mainId,
              ))!.data,
            ),
            spec,
            phase: "awaiting qualifiers",
            season,
            direct,
            qualifiers: [qualifyingId],
          });
          const mainStart = seasonDate(season, spec.start);
          const qualifyingRounds = Math.ceil(
            Math.log2(qualifying.length / slots),
          );
          const completeQualifyingStart = addDays(
            mainStart,
            -(qualifyingRounds * 14 + 14),
          );
          const qualifierDate = qualification.length
            ? completeQualifyingStart < `${season}-07-02`
              ? `${season}-07-02`
              : completeQualifyingStart
            : spec.kind === "continental" && Number(spec.start.slice(0, 2)) >= 7
              ? `${season}-07-21`
              : addDays(mainStart, -28);
          await scheduleKnockout(
            store,
            qualifyingId,
            qualifying,
            season,
            qualifierDate,
            1,
            { qualificationFor: mainId, slots },
          );
        } else
          await setupMainCompetition(
            store,
            mainId,
            allIds.slice(0, teamCount),
            spec,
            season,
          );
        if (
          settings.youthTournamentFrequency === "high" &&
          ["MIC", "Future Cup", "Alkass Cup"].includes(spec.name)
        ) {
          const extraSpec = {
            ...spec,
            name: `${spec.name} Autumn Invitational`,
            start: "10-20",
            qualifier: false,
          };
          await setupMainCompetition(
            store,
            await createLeague(store, extraSpec),
            allIds.slice(teamCount, teamCount + Math.min(teamCount, 16)),
            extraSpec,
            season,
          );
        }
      }
      await store.setMeta("calendarSeason", season);
    }),
  );
}

export async function progressCompetitions(store: Store, date: string) {
  const state = await store.meta<GameState>("state");
  for (const league of await store.all<League>(
    "SELECT * FROM leagues WHERE kind != 'league' AND JSON_VALUE(data, '$.phase') IN ('groups', 'knockout') ORDER BY id",
  )) {
    const data: CompetitionData = JSON.parse(league.data);
    const unplayed = (await store.get<{ count: number }>(
      "SELECT count(*) AS count FROM fixtures WHERE league_id = ? AND season = ? AND status = ?",
      league.id,
      state.season,
      "scheduled",
    ))!.count;
    if (unplayed) continue;
    const matches = await store.all<Fixture>(
      "SELECT * FROM fixtures WHERE league_id = ? AND season = ? ORDER BY round DESC, id",
      league.id,
      state.season,
    );
    if (!matches.length) continue;
    const spec = data.spec!;
    let nextDate = addDays(
      date,
      data.qualificationFor &&
        league.confederation === "UEFA" &&
        league.age_group === "Senior"
        ? 7
        : league.kind === "continental" ||
            league.kind === "cup" ||
            league.name === "UEFA Youth League"
          ? 14
          : 3,
    );
    if (league.kind === "continental")
      while (internationalBreak(nextDate)) nextDate = addDays(nextDate, 7);
    if (spec.national && spec.age === "Senior")
      while (!internationalBreak(nextDate)) nextDate = addDays(nextDate, 1);
    if (data.phase === "groups") {
      const table = await store.all<Standing>(
        "SELECT * FROM standings WHERE league_id = ? ORDER BY points DESC, (gf-ga) DESC, gf DESC, club_id",
        league.id,
      );
      let qualified: number[] = [];
      if (spec.format === "Swiss") {
        const target = Math.min(
          spec.qualifies,
          2 ** Math.floor(Math.log2(table.length)),
        );
        if (
          table.length >= 24 &&
          spec.confederation === "UEFA" &&
          spec.age === "Senior"
        ) {
          const byes = table.slice(0, 8).map((entry) => entry.club_id);
          const playoff = table.slice(8, 24).map((entry) => entry.club_id);
          await scheduleKnockout(
            store,
            league.id,
            playoff,
            state.season,
            nextDate,
            spec.rounds + 1,
            { playoffByes: byes },
          );
          continue;
        }
        qualified = table.slice(0, target).map((entry) => entry.club_id);
      } else {
        const groups = [...new Set(table.map((entry) => entry.group_name))];
        const perGroup = Math.floor(spec.qualifies / groups.length);
        for (const group of groups)
          qualified.push(
            ...table
              .filter((entry) => entry.group_name === group)
              .slice(0, perGroup)
              .map((entry) => entry.club_id),
          );
        const extras = table
          .filter((entry) => !qualified.includes(entry.club_id))
          .slice(0, Math.max(0, spec.qualifies - qualified.length));
        qualified.push(...extras.map((entry) => entry.club_id));
      }
      if (qualified.length >= 2)
        await scheduleKnockout(
          store,
          league.id,
          qualified,
          state.season,
          nextDate,
          spec.rounds + 1,
        );
      continue;
    }
    const currentRound = matches[0].round;
    const roundMatches = matches.filter(
      (fixture) => fixture.round === currentRound,
    );
    const winners: number[] = [];
    const resolved = new Set<string>();
    for (const fixture of roundMatches) {
      const details = JSON.parse(fixture.data);
      const tie = details.tie as KnockoutTie | undefined;
      if (tie) {
        if (resolved.has(tie.id)) continue;
        const legs = roundMatches.filter(
          (candidate) => JSON.parse(candidate.data).tie?.id === tie.id,
        );
        if (legs.length !== tie.legs)
          throw new Error(`Incomplete knockout tie ${tie.id}.`);
        const winner = knockoutWinner(legs);
        if (!winner)
          throw new Error(
            `Knockout tie ${tie.id} has no aggregate or shootout winner.`,
          );
        winners.push(winner);
        resolved.add(tie.id);
      } else {
        winners.push(
          details.winnerId ??
            ((fixture.home_goals ?? 0) >= (fixture.away_goals ?? 0)
              ? fixture.home_id
              : fixture.away_id),
        );
      }
    }
    winners.push(...(data.pendingByes ?? []));
    if (data.playoffByes?.length) {
      winners.unshift(...data.playoffByes);
      data.playoffByes = [];
    }
    if (data.qualificationFor && winners.length <= (data.slots ?? 1)) {
      const main = (await store.get<League>(
        "SELECT * FROM leagues WHERE id = ?",
        data.qualificationFor,
      ))!;
      const mainData: CompetitionData = JSON.parse(main.data);
      await setupMainCompetition(
        store,
        main.id,
        [...(mainData.direct ?? []), ...winners],
        mainData.spec!,
        state.season,
        addDays(date, 3),
      );
      await setData(store, league.id, {
        ...data,
        phase: "complete",
        qualified: winners,
      });
    } else if (winners.length === 1) {
      const champion = (await store.get<Club>(
        "SELECT * FROM clubs WHERE id = ?",
        winners[0],
      ))!;
      await setData(store, league.id, {
        ...data,
        phase: "complete",
        champion: champion.id,
        championName: champion.name,
      });
      await store.run(
        "INSERT INTO history(season, entity_type, entity_id, date, data) VALUES (?, ?, ?, ?, ?)",
        state.season,
        "champion",
        league.id,
        date,
        JSON.stringify({
          clubId: champion.id,
          name: champion.name,
          competition: league.name,
        }),
      );
      if (champion.id === state.clubId)
        await store.run(
          "INSERT INTO news(date, category, title, body, severity) VALUES (?, ?, ?, ?, ?)",
          date,
          "Club",
          `${league.name} champions`,
          `${champion.name} have lifted the trophy. The board, supporters and academy staff celebrate a landmark result.`,
          "success",
        );
    } else if (winners.length > 1)
      await scheduleKnockout(
        store,
        league.id,
        winners,
        state.season,
        nextDate,
        currentRound + 1,
        data,
      );
  }
}
