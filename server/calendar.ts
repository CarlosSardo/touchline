import roundrobin from "roundrobin";
import { Store } from "./db.ts";
import { addDays, internationalBreak } from "../shared/rules.ts";
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

function addFixture(
  store: Store,
  leagueId: number | null,
  season: number,
  date: string,
  home: number,
  away: number,
  stage: string,
  round: number,
  group = "",
) {
  if (!home || !away || home === away) return;
  const ageGroup = leagueId
    ? store.get<{ age_group: string }>(
        "SELECT age_group FROM leagues WHERE id = ?",
        leagueId,
      )!.age_group
    : "Senior";
  let scheduled = date;
  let attempts = 0;
  while (
    store.get(
      `SELECT fixtures.id FROM fixtures LEFT JOIN leagues ON leagues.id = fixtures.league_id WHERE (home_id IN (?,?) OR away_id IN (?,?)) AND date BETWEEN ? AND ? AND coalesce(leagues.age_group,'Senior') = ? LIMIT 1`,
      home,
      away,
      home,
      away,
      addDays(scheduled, -2),
      addDays(scheduled, 2),
      ageGroup,
    )
  ) {
    scheduled = addDays(scheduled, 1);
    if (
      ageGroup === "Senior" &&
      store.get<Club>("SELECT * FROM clubs WHERE id = ?", home)?.type !==
        "national"
    )
      while (internationalBreak(scheduled)) scheduled = addDays(scheduled, 1);
    if (++attempts > 150)
      throw new Error("The competition calendar has no safe fixture slot.");
  }
  store.run(
    "INSERT INTO fixtures(league_id, season, date, home_id, away_id, stage, round, group_name, seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    leagueId,
    season,
    scheduled,
    home,
    away,
    stage,
    round,
    group,
    `${season}:${leagueId}:${home}:${away}:${round}:${stage}`,
  );
}

function createLeague(
  store: Store,
  spec: CompetitionSpec,
  countryId: number | null = null,
) {
  const existing = store.get<{ id: number }>(
    "SELECT id FROM leagues WHERE name = ?",
    spec.name,
  );
  if (existing) {
    store.run("DELETE FROM standings WHERE league_id = ?", existing.id);
    store.run(
      "UPDATE leagues SET data = ? WHERE id = ?",
      JSON.stringify({ spec }),
      existing.id,
    );
    return existing.id;
  }
  return Number(
    store.run(
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
    ).lastInsertRowid,
  );
}

function setData(store: Store, leagueId: number, data: CompetitionData) {
  store.run(
    "UPDATE leagues SET data = ? WHERE id = ?",
    JSON.stringify(data),
    leagueId,
  );
}

export function scheduleKnockout(
  store: Store,
  leagueId: number,
  clubs: number[],
  season: number,
  date: string,
  round = 1,
  extra: CompetitionData = {},
) {
  const data: CompetitionData = {
    ...JSON.parse(
      store.get<League>("SELECT * FROM leagues WHERE id = ?", leagueId)!.data,
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
  for (let index = 0; index < playing.length / 2; index++)
    addFixture(
      store,
      leagueId,
      season,
      date,
      playing[index],
      playing[playing.length - 1 - index],
      stage,
      round,
    );
  setData(store, leagueId, {
    ...data,
    phase: "knockout",
    season,
    nextRound: round,
    pendingByes: clubs.slice(0, byes),
  });
}

export function setupMainCompetition(
  store: Store,
  leagueId: number,
  clubs: number[],
  spec: CompetitionSpec,
  season: number,
) {
  const oldData: CompetitionData = JSON.parse(
    store.get<League>("SELECT * FROM leagues WHERE id = ?", leagueId)!.data,
  );
  store.run("DELETE FROM standings WHERE league_id = ?", leagueId);
  const uniqueClubs = [...new Set(clubs)];
  if (uniqueClubs.length < 2) return;
  const addEntry = store.db.prepare(
    "INSERT INTO standings(league_id, club_id, group_name) VALUES (?, ?, ?)",
  );
  const start = seasonDate(season, spec.start);
  const gap =
    spec.kind === "continental" || spec.name === "UEFA Youth League" ? 14 : 3;
  setData(store, leagueId, {
    ...oldData,
    spec,
    season,
    phase: spec.format === "Knockout" ? "knockout" : "groups",
    qualified: uniqueClubs,
    champion: undefined,
    championName: undefined,
  });
  if (spec.format === "Knockout") {
    for (const club of uniqueClubs) addEntry.run(leagueId, club, "");
    scheduleKnockout(store, leagueId, uniqueClubs, season, start);
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
    for (const club of group) addEntry.run(leagueId, club, groupName);
    const firstLeg = roundrobin(group.length, group);
    const schedule = [
      ...firstLeg,
      ...firstLeg.map((pairs) =>
        pairs.map(([home, away]) => [away, home] as [number, number]),
      ),
    ].slice(0, spec.rounds);
    schedule.forEach((pairs, round) => {
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
        addFixture(
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
    });
  }
}

export function createCalendar(store: Store) {
  const state = store.meta<GameState>("state");
  if (
    store.get<{ value: string }>(
      "SELECT value FROM meta WHERE key = ?",
      "calendarSeason",
    )?.value === JSON.stringify(state.season)
  )
    return;
  const season = state.season;
  const settings = store.meta<Settings>("settings");
  store.transaction(() => {
    for (const league of store.all<League>(
      "SELECT * FROM leagues WHERE kind = 'league'",
    )) {
      const entries = store
        .all<{ club_id: number }>(
          "SELECT club_id FROM standings WHERE league_id = ? ORDER BY club_id",
          league.id,
        )
        .map((entry) => entry.club_id);
      const firstLeg = roundrobin(entries.length, entries);
      const schedule = [
        ...firstLeg,
        ...firstLeg.map((pairs) =>
          pairs.map(([home, away]) => [away, home] as [number, number]),
        ),
      ];
      const dates = matchDates(season, schedule.length);
      schedule.forEach((pairs, round) => {
        for (const [home, away] of pairs)
          addFixture(
            store,
            league.id,
            season,
            dates[round],
            home,
            away,
            "League",
            round + 1,
          );
      });
      if (league.age_group === "Senior") {
        for (const [round, pairs] of firstLeg.slice(0, 2).entries())
          for (const [home, away] of pairs)
            addFixture(
              store,
              null,
              season,
              `${season}-07-${round === 0 ? "11" : "25"}`,
              home,
              away,
              "Pre-season friendly",
              round + 1,
            );
      }
    }
    const countries = store.all<Country>("SELECT * FROM countries");
    for (const country of countries) {
      for (const age of ["U17", "U19"] as AgeGroup[]) {
        const entries = store
          .all<{ club_id: number }>(
            "SELECT standings.club_id FROM standings JOIN leagues ON leagues.id = standings.league_id WHERE leagues.country_id = ? AND leagues.age_group = ? AND leagues.kind = 'league'",
            country.id,
            age,
          )
          .map((entry) => entry.club_id);
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
        const leagueId = createLeague(store, spec, country.id);
        setupMainCompetition(store, leagueId, entries, spec, season);
        const superSpec: CompetitionSpec = {
          ...spec,
          name: `${country.name} ${age} Super Cup`,
          teams: 2,
          rounds: 1,
          start: "07-18",
        };
        const superId = createLeague(store, superSpec, country.id);
        setupMainCompetition(
          store,
          superId,
          entries.slice(0, 2),
          superSpec,
          season,
        );
      }
      const seniorEntries = store
        .all<{ id: number }>(
          "SELECT id FROM clubs WHERE country_id = ? AND type = 'club' ORDER BY reputation DESC LIMIT 32",
          country.id,
        )
        .map((club) => club.id);
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
      setupMainCompetition(
        store,
        createLeague(store, cupSpec, country.id),
        seniorEntries,
        cupSpec,
        season,
      );
    }
    const usedSenior = new Set<number>();
    for (const spec of COMPETITIONS) {
      if (
        settings.youthTournamentFrequency === "low" &&
        spec.kind === "youth" &&
        spec.name !== "UEFA Youth League" &&
        season % 2 === 1
      ) {
        const restingId = createLeague(store, spec);
        setData(store, restingId, {
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
      let clubs = store.all<Club>(
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
          const last = store.get<{ data: string }>(
            "SELECT data FROM history WHERE entity_type = 'league' AND entity_id = ? AND season = ? ORDER BY id DESC LIMIT 1",
            club.league_id,
            season - 1,
          );
          const previous: (Standing & { position?: number })[] = last
            ? (JSON.parse(last.data).table ?? [])
            : [];
          const place = previous.findIndex(
            (entry) => entry.club_id === club.id,
          );
          return { club, score: club.reputation - (place < 0 ? 0 : place * 4) };
        })
        .sort((left, right) => right.score - left.score);
      const perCountry = new Map<number, number>();
      const candidates = ranked
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
      if (candidates.length < 2) continue;
      const teamCount = Math.min(
        spec.teams,
        candidates.length - (candidates.length % 2),
      );
      const mainId = createLeague(store, spec);
      const allIds = candidates.map((club) => club.id);
      if (spec.kind === "continental")
        allIds.slice(0, teamCount + 12).forEach((id) => usedSenior.add(id));
      const canQualify = spec.qualifier && allIds.length >= teamCount + 4;
      if (canQualify) {
        const slots = Math.min(4, Math.floor(teamCount / 4));
        const direct = allIds.slice(0, teamCount - slots);
        const qualifying = allIds.slice(
          teamCount - slots,
          teamCount - slots + slots * 4,
        );
        const qualifyingSpec: CompetitionSpec = {
          ...spec,
          name: `${spec.name} Qualifying`,
          format: "Knockout",
          teams: qualifying.length,
          qualifies: slots,
        };
        const qualifyingId = createLeague(store, qualifyingSpec);
        for (const club of qualifying)
          store.run(
            "INSERT INTO standings(league_id, club_id) VALUES (?, ?)",
            qualifyingId,
            club,
          );
        for (const club of direct)
          store.run(
            "INSERT INTO standings(league_id, club_id, group_name) VALUES (?, ?, ?)",
            mainId,
            club,
            "Qualified",
          );
        setData(store, mainId, {
          spec,
          phase: "awaiting qualifiers",
          season,
          direct,
          qualifiers: [qualifyingId],
        });
        const mainStart = seasonDate(season, spec.start);
        const qualifierDate =
          spec.kind === "continental" && Number(spec.start.slice(0, 2)) >= 7
            ? `${season}-07-21`
            : addDays(mainStart, -28);
        scheduleKnockout(
          store,
          qualifyingId,
          qualifying,
          season,
          qualifierDate,
          1,
          { qualificationFor: mainId, slots },
        );
      } else
        setupMainCompetition(
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
        setupMainCompetition(
          store,
          createLeague(store, extraSpec),
          allIds.slice(teamCount, teamCount + Math.min(teamCount, 16)),
          extraSpec,
          season,
        );
      }
    }
    store.setMeta("calendarSeason", season);
  });
}

export function progressCompetitions(store: Store, date: string) {
  const state = store.meta<GameState>("state");
  for (const league of store.all<League>(
    "SELECT * FROM leagues WHERE kind != 'league' AND json_extract(data, '$.phase') IN ('groups', 'knockout')",
  )) {
    const data: CompetitionData = JSON.parse(league.data);
    const unplayed = store.get<{ count: number }>(
      "SELECT count(*) AS count FROM fixtures WHERE league_id = ? AND season = ? AND status = ?",
      league.id,
      state.season,
      "scheduled",
    )!.count;
    if (unplayed) continue;
    const matches = store.all<Fixture>(
      "SELECT * FROM fixtures WHERE league_id = ? AND season = ? ORDER BY round DESC, id",
      league.id,
      state.season,
    );
    if (!matches.length) continue;
    const spec = data.spec!;
    let nextDate = addDays(
      date,
      league.kind === "continental" ||
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
      const table = store.all<Standing>(
        "SELECT * FROM standings WHERE league_id = ? ORDER BY points DESC, (gf-ga) DESC, gf DESC, club_id",
        league.id,
      );
      let qualified: number[] = [];
      if (spec.format === "Swiss") {
        const target = Math.min(
          spec.qualifies,
          2 ** Math.floor(Math.log2(table.length)),
        );
        if (table.length >= 24 && spec.confederation === "UEFA") {
          const byes = table.slice(0, 8).map((entry) => entry.club_id);
          const playoff = table.slice(8, 24).map((entry) => entry.club_id);
          scheduleKnockout(
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
        scheduleKnockout(
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
    const winners = matches
      .filter((fixture) => fixture.round === currentRound)
      .map((fixture) => {
        const details = JSON.parse(fixture.data);
        return (
          details.winnerId ??
          ((fixture.home_goals ?? 0) >= (fixture.away_goals ?? 0)
            ? fixture.home_id
            : fixture.away_id)
        );
      }) as number[];
    winners.push(...(data.pendingByes ?? []));
    if (data.playoffByes?.length) {
      winners.push(...data.playoffByes);
      data.playoffByes = [];
    }
    if (data.qualificationFor && winners.length <= (data.slots ?? 1)) {
      const main = store.get<League>(
        "SELECT * FROM leagues WHERE id = ?",
        data.qualificationFor,
      )!;
      const mainData: CompetitionData = JSON.parse(main.data);
      setupMainCompetition(
        store,
        main.id,
        [...(mainData.direct ?? []), ...winners],
        mainData.spec!,
        state.season,
      );
      setData(store, league.id, {
        ...data,
        phase: "complete",
        qualified: winners,
      });
    } else if (winners.length === 1) {
      const champion = store.get<Club>(
        "SELECT * FROM clubs WHERE id = ?",
        winners[0],
      )!;
      setData(store, league.id, {
        ...data,
        phase: "complete",
        champion: champion.id,
        championName: champion.name,
      });
      store.run(
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
        store.run(
          "INSERT INTO news(date, category, title, body, severity) VALUES (?, ?, ?, ?, ?)",
          date,
          "Club",
          `${league.name} champions`,
          `${champion.name} have lifted the trophy. The board, supporters and academy staff celebrate a landmark result.`,
          "success",
        );
    } else if (winners.length > 1)
      scheduleKnockout(
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
