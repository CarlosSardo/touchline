import roundrobin from "roundrobin";
import seedrandom from "seedrandom";
import { Store } from "./db.ts";
import { addDays, daysBetween, internationalBreak } from "../shared/rules.ts";
import {
  clubCompetitionEligible,
  cupEntryPlan,
  cupRoundDates,
  KNOCKOUT_PLAYOFF_STAGE,
  knockoutRules,
  knockoutWinner,
  openDraw,
  seededPairs,
  type CupEntryPlan,
  type KnockoutTie,
} from "../shared/competition-rules.ts";
import { minimumReserveTier } from "../shared/world-rules.ts";
import {
  advancePlayoff,
  assignConferences,
  baseSchedule,
  boundaryKey,
  createPlayoff,
  halvedPoints,
  knockoutStage,
  lastStageTies,
  leagueDateOptions,
  miniLeagueRounds,
  needsHeadToHead,
  pairQualifyingRound,
  planBoundaries,
  planSplit,
  postseasonDates,
  QUALIFYING_STAGES,
  qualifyingPlan,
  rankTable,
  readLeagueData,
  regularSeasonDates,
  resolvePlayoffBySeed,
  splitMatchdays,
  type PlayoffInput,
  type PlayoffState,
  type PyramidClub,
  type PyramidTier,
  type QualifyingStage,
  type RankableRow,
} from "../shared/league-rules.ts";
import { drawGroups, drawLeaguePhase, drawZoneLeaguePhase } from "./draw.ts";
import { CONTINENTAL, isSuspended, nationByCode } from "../shared/world-catalog/index.ts";
import type { ContinentalCompetitionSpec, ContinentalStage, CupSpec } from "../shared/world-catalog/types.ts";
import { continentalEntries } from "./qualification.ts";
import {
  allocateEntrants,
  cohortCutoff,
  editionHosts,
  editionYear,
  heldInSeason,
  LEGACY_YOUTH_NAMES,
  qualifyingAdvancers,
  YOUTH_TOURNAMENTS,
  type EntrantTeam,
  type YouthTournamentSpec,
} from "../shared/features/youth-internationals.ts";
import { ensureNationalTeams } from "./internationals.ts";
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
  /** Catalog domestic cup legs (final separately) and neutral final. */
  cupFormat?: Pick<CupSpec, "legs" | "finalLegs" | "neutralFinal">;
  /** Domestic cup entry rounds, round dates and open draw (national and league cups). */
  cupPlan?: CupPlan;
  /** Continental club competition from the catalog (formats, access, drops, feeds). */
  catalog?: ContinentalCompetitionSpec;
  /** Youth national-team tournament id (shared/features/youth-internationals.ts). */
  youth?: string;
  /** Group options: teams per group (default 4), round-robin legs (default 2) and fixed matchdays (MM-DD). */
  groupSize?: number;
  legs?: 1 | 2;
  matchdays?: string[];
}

type BracketSize = "playoff" | "16" | "8" | "4" | "2";

/**
 * Real phase dates inside the July–June season. CONMEBOL's calendar-year editions (February–November) keep their
 * cadence six months later: Recopa and qualifying from late July, groups September–November, knockouts January–May.
 */
export const CADENCE: Record<
  string,
  {
    start?: string;
    qualifying?: Partial<Record<QualifyingStage, string>>;
    matchdays?: string[];
    knockout?: Partial<Record<BracketSize, string>>;
    /** Days between rounds of a single-venue tournament. */
    gap?: number;
  }
> = {
  // 2026/27 league phases and finals; knockout rounds before the finals follow UEFA's usual weeks (inferred).
  "uefa-champions-league": {
    start: "09-08",
    matchdays: ["09-08", "10-13", "10-20", "11-03", "11-24", "12-08", "01-19", "01-27"],
    knockout: { playoff: "02-16", "16": "03-09", "8": "04-06", "4": "04-27", "2": "06-05" },
  },
  "uefa-europa-league": {
    start: "09-17",
    matchdays: ["09-17", "10-15", "10-22", "11-05", "11-26", "12-10", "01-21", "01-28"],
    knockout: { playoff: "02-18", "16": "03-11", "8": "04-08", "4": "04-29", "2": "05-26" },
  },
  "uefa-conference-league": {
    start: "10-15",
    matchdays: ["10-15", "10-22", "11-05", "11-26", "12-10", "12-17"],
    knockout: { playoff: "02-18", "16": "03-11", "8": "04-08", "4": "04-29", "2": "06-02" },
  },
  // UCL Path on UCL matchdays 1–6; Domestic Champions Path rounds 1–3 (the third repeats round 2); final 19 April.
  "uefa-youth-league": {
    start: "09-08",
    matchdays: ["09-08", "10-13", "10-20", "11-03", "11-24", "12-08"],
    qualifying: { q1: "09-16", q2: "10-28", q3: "11-25" },
    knockout: { playoff: "02-09", "16": "02-23", "8": "03-09", "4": "04-16", "2": "04-19" },
  },
  "uefa-super-cup": { start: "08-12" },
  // Groups avoid the September–October FIFA window (MD2 after it).
  "copa-libertadores": {
    start: "09-16",
    qualifying: { q1: "07-22", q2: "08-05", q3: "08-19" },
    matchdays: ["09-16", "10-07", "10-14", "10-28", "11-04", "11-25"],
    knockout: { "16": "02-10", "8": "03-10", "4": "04-14", "2": "05-29" },
  },
  "copa-sudamericana": {
    start: "09-17",
    qualifying: { q1: "08-20" },
    matchdays: ["09-17", "10-08", "10-15", "10-29", "11-05", "11-26"],
    knockout: { playoff: "01-20", "16": "02-11", "8": "03-11", "4": "04-15", "2": "05-22" },
  },
  "recopa-sudamericana": { start: "08-19" },
  "libertadores-sub-20": { start: "08-12", gap: 3 },
  // Single-match preliminaries in August (ACL Two East really plays 31 August); finals 1 May (centralised) and 15 May.
  "afc-champions-league-elite": {
    qualifying: { playoff: "08-11" },
    knockout: { "16": "03-03", "8": "04-23", "4": "04-27", "2": "05-01" },
  },
  "afc-champions-league-two": {
    start: "09-15",
    qualifying: { playoff: "08-12" },
    knockout: { "16": "02-11", "8": "03-04", "4": "04-08", "2": "05-15" },
  },
  // Qualifying 4 Sep – 25 Oct (both competitions, no play-off round); CL groups from 27 Nov, final 24/31 May.
  "caf-champions-league": {
    start: "11-27",
    qualifying: { q1: "09-05", q2: "10-17" },
    knockout: { "8": "03-13", "4": "04-10", "2": "05-24" },
  },
  "caf-confederation-cup": {
    qualifying: { q1: "09-05", q2: "10-17" },
    knockout: { "8": "03-14", "4": "04-11", "2": "05-16" },
  },
  // 2026 feeders: Leagues Cup 4 Aug – 6 Sep, Central American Cup to 2/6 Dec, Caribbean Cup 4 Aug – 1/5 Dec.
  "leagues-cup": { start: "08-04", knockout: { "8": "08-25", "4": "09-02", "2": "09-06" } },
  "concacaf-central-american-cup": { knockout: { "8": "09-08", "4": "10-20", "2": "12-02" } },
  "concacaf-caribbean-cup": { start: "08-04", knockout: { "4": "10-13", "2": "12-01" } },
  "concacaf-champions-cup": { start: "03-10", knockout: { "8": "04-07", "4": "04-28", "2": "05-30" } },
  // Played on 23 September until 2025; the week before is the closest date outside the merged FIFA window.
  "campeones-cup": { start: "09-16" },
};

/** Senior national-team matchdays inside the 2026/27 FIFA windows (Nations League league-phase weeks). */
export const NATIONS_SERIES_DATES = ["09-24", "09-27", "10-01", "10-04", "11-12", "11-15"];

const continentalSpec = (catalog: ContinentalCompetitionSpec): CompetitionSpec => ({
  name: catalog.name,
  confederation: catalog.confederation,
  age: catalog.age,
  kind: catalog.age === "Senior" ? "continental" : "youth",
  teams: catalog.teams,
  format: catalog.format === "league-phase" ? "Swiss" : catalog.format === "groups" ? "Groups" : "Knockout",
  rounds: catalog.matchdays ?? (catalog.groupSize ?? 2) * 2 - ((catalog.groupSize ?? 2) % 2 ? 0 : 2),
  qualifies: catalog.advance,
  start: CADENCE[catalog.id]?.start ?? catalog.start,
  qualifier: true,
  catalog,
});

/** Rounds of a round robin in groups of `size` (odd groups give every team one bye per leg). */
const robinRounds = (size: number, legs: 1 | 2) => (size % 2 ? size : size - 1) * legs;

const youthSpec = (youth: YouthTournamentSpec): CompetitionSpec => ({
  name: youth.name,
  confederation: youth.confederation,
  age: youth.team,
  kind: "international",
  teams: youth.teams,
  format: "Groups",
  groupSize: youth.groupSize,
  legs: 1,
  rounds: robinRounds(youth.groupSize, 1),
  qualifies: youth.advance,
  start: youth.start,
  national: true,
  youth: youth.id,
});

export const COMPETITIONS: CompetitionSpec[] = [
  ...CONTINENTAL.competitions.map(continentalSpec),
  ...YOUTH_TOURNAMENTS.map(youthSpec),
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
      start: NATIONS_SERIES_DATES[0],
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

/** Planned matchdays moved by `delay`, clear of the FIFA windows and at least three days apart. */
function plannedMatchdays(monthDays: readonly string[], season: number, delay: number) {
  const dates: string[] = [];
  for (const monthDay of monthDays) {
    const previous = dates.at(-1);
    let date = addDays(seasonDate(season, monthDay), delay);
    if (previous && daysBetween(previous, date) < 3) date = addDays(previous, 7);
    while (internationalBreak(date)) date = addDays(date, 7);
    dates.push(date);
  }
  return dates;
}

/** Clubs per conference in catalog order; clubs without a valid conference fill the smallest ones (persisted). */
async function conferenceGroups(
  store: Store,
  leagueId: number,
  rows: readonly { id: number; group_name: string }[],
  conferences: readonly string[] | undefined,
) {
  if (!conferences?.length) return [rows.map((row) => row.id)];
  const current = new Map(
    rows.filter((row) => conferences.includes(row.group_name)).map((row) => [row.id, row.group_name]),
  );
  const missing = rows.filter((row) => !current.has(row.id)).map((row) => row.id);
  const assigned = assignConferences(conferences, current, [], missing);
  for (const clubId of missing)
    await store.run(
      "UPDATE standings SET group_name = ? WHERE league_id = ? AND club_id = ?",
      assigned.get(clubId)!,
      leagueId,
      clubId,
    );
  return conferences.map((name) =>
    rows.filter((row) => assigned.get(row.id) === name).map((row) => row.id),
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
      throw new Error(
        `The competition calendar has no safe fixture slot (league ${leagueId}, ${stage} ${round}, clubs ${home} v ${away}, from ${date}).`,
      );
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
    // Real cup names repeat across nations (Coupe du Congo, Trophée des Champions).
    countryId === null
      ? "SELECT id FROM leagues WHERE name = ?"
      : "SELECT id FROM leagues WHERE name = ? AND country_id = ?",
    spec.name,
    ...(countryId === null ? [] : [countryId]),
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
  entrants: number[],
  season: number,
  date: string,
  round = 1,
  extra: CompetitionData = {},
) {
  // A club paired with itself gets no fixture, so it must appear once per round.
  const clubs = [...new Set(entrants)];
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
    const plan = data.spec?.cupPlan;
    if (plan) return scheduleCupRound(store, leagueId, data, plan, clubs, season, date, round);
    const size = 2 ** Math.ceil(Math.log2(clubs.length));
    const { byes } = seededPairs(clubs);
    const stage = data.qualificationFor
      ? "Qualifying"
      : size === 2
        ? "Final"
        : size === 4
          ? "Semi-final"
          : size === 8
            ? "Quarter-final"
            : extra.playoffByes?.length
              ? KNOCKOUT_PLAYOFF_STAGE
              : `Round of ${size}`;
    const league = (await store.get<League>(
      "SELECT * FROM leagues WHERE id = ?",
      leagueId,
    ))!;
    const base = knockoutRules(data.spec?.name ?? league.name, stage);
    const cup = data.spec?.cupFormat;
    const rules = cup
      ? {
          ...base,
          legs: stage === "Final" ? (cup.finalLegs ?? 1) : (cup.legs ?? 1),
          neutral: stage === "Final" && Boolean(cup.neutralFinal),
        }
      : base;
    // Senior club rounds keep out of the FIFA windows; national-team rounds are played inside them.
    const clear = (day: string, step: number) => {
      if (data.spec?.age === "Senior" && !data.spec.national)
        while (internationalBreak(day)) day = addDays(day, step);
      return day;
    };
    for (const [index, [seeded, opponent]] of seededPairs(clubs).pairs.entries()) {
      const tie: KnockoutTie = {
        ...rules,
        id: `${season}:${leagueId}:${round}:${index}`,
        leg: 1,
      };
      const firstDate = await addFixture(
        store,
        leagueId,
        season,
        clear(date, 1),
        rules.legs === 2 ? opponent : seeded,
        rules.legs === 2 ? seeded : opponent,
        stage,
        round,
        "",
        { tie },
      );
      if (rules.legs === 2 && firstDate) {
        await addFixture(
          store,
          leagueId,
          season,
          clear(addDays(firstDate, 7), 7),
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
      pendingByes: byes,
    });
  });
}

/** Domestic cup plan: entry round per club, round dates to the final, tiers for the lower-tier home rule. */
export interface CupPlan extends CupEntryPlan {
  dates: string[];
  tiers: Record<string, number>;
  lowerTierHome?: number;
}

/** One round of a domestic cup: survivors plus this round's entrants, open draw, stage by rounds left. */
async function scheduleCupRound(
  store: Store,
  leagueId: number,
  data: CompetitionData,
  plan: CupPlan,
  clubs: number[],
  season: number,
  date: string,
  round: number,
) {
  const entering = Object.entries(plan.entry)
    .filter(([, entry]) => entry === round)
    .map(([id]) => Number(id));
  const field = round === 1 ? clubs.filter((id) => (plan.entry[id] ?? 1) === 1) : [...new Set([...clubs, ...entering])];
  const left = plan.rounds - round + 1;
  const stage =
    left <= 1 || field.length === 2
      ? "Final"
      : left === 2
        ? "Semi-final"
        : left === 3
          ? "Quarter-final"
          : `Round of ${field.length}`;
  const cup = data.spec!.cupFormat;
  const rules = {
    ...knockoutRules(data.spec!.name, stage),
    legs: stage === "Final" ? (cup?.finalLegs ?? 1) : (cup?.legs ?? 1),
    neutral: stage === "Final" && Boolean(cup?.neutralFinal),
  };
  let day = date;
  while (internationalBreak(day)) day = addDays(day, 1);
  const pairs = openDraw(field, seedrandom(`${season}:${leagueId}:${round}:draw`), plan.tiers, plan.lowerTierHome);
  for (const [index, [home, away]] of pairs.entries()) {
    const tie: KnockoutTie = { ...rules, id: `${season}:${leagueId}:${round}:${index}`, leg: 1 };
    const firstDate = await addFixture(store, leagueId, season, day, home, away, stage, round, "", { tie });
    if (rules.legs === 2 && firstDate) {
      let returnDate = addDays(firstDate, 7);
      while (internationalBreak(returnDate)) returnDate = addDays(returnDate, 7);
      await addFixture(store, leagueId, season, returnDate, away, home, stage, round, "", { tie: { ...tie, leg: 2 } });
    }
  }
  // An odd field only arises when an entrant dropped out; the undrawn club goes through.
  const drawn = new Set(pairs.flat());
  await setData(store, leagueId, {
    ...data,
    phase: "knockout",
    season,
    nextRound: round,
    pendingByes: field.filter((id) => !drawn.has(id)),
  });
}

/** Catalog group stages (pots by coefficient), ACL Elite zone league stages and the Leagues Cup cross-league phase. */
async function catalogMainPhase(
  store: Store,
  leagueId: number,
  clubs: number[],
  spec: CompetitionSpec,
  season: number,
  start: string,
): Promise<boolean> {
  const catalog = spec.catalog!;
  const cross = catalog.id === "leagues-cup";
  if (catalog.format === "knockout" || (catalog.format === "league-phase" && !catalog.zones && !cross)) return false;
  const entrants = await store.all<Club & { code: string }>(
    `SELECT clubs.*,countries.code FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE clubs.id IN (${clubs.map(() => "?").join(",")}) ORDER BY clubs.reputation DESC, clubs.id`,
    ...clubs,
  );
  const drawn = (list: typeof entrants) =>
    list.map((club) => ({ id: club.id, countryId: club.country_id, coefficient: club.reputation }));
  const zones = catalog.zones?.length
    ? catalog.zones.map((zone) => ({ name: zone.name, clubs: entrants.filter((club) => zone.nations.includes(club.code)) }))
    : [{ name: "", clubs: entrants }];
  const rows: { club_id: number; group_name: string }[] = [];
  const matches: { home: number; away: number; round: number; group: string }[] = [];
  let letter = 0;
  for (const zone of zones) {
    if (zone.clubs.length < 2) continue;
    if (cross) {
      // MLS v Liga MX: every club meets three different clubs of the other league.
      const sides = [...new Set(zone.clubs.map((club) => club.country_id))].map((countryId) =>
        zone.clubs.filter((club) => club.country_id === countryId),
      );
      if (sides.length !== 2 || sides[0].length !== sides[1].length) return false;
      const [left, right] = sides;
      const matchdays = catalog.matchdays ?? 3;
      const step = Math.max(1, Math.floor(left.length / matchdays));
      for (let round = 0; round < matchdays; round++)
        left.forEach((club, index) => {
          const opponent = right[(index + round * step) % right.length];
          const [home, away] = round % 2 ? [opponent.id, club.id] : [club.id, opponent.id];
          matches.push({ home, away, round: round + 1, group: "League phase" });
        });
      rows.push(...zone.clubs.map((club) => ({ club_id: club.id, group_name: "League phase" })));
      continue;
    }
    if (catalog.format === "league-phase") {
      if (zone.clubs.length !== catalog.teams / zones.length) return false;
      let draw: ReturnType<typeof drawZoneLeaguePhase>;
      try {
        draw = drawZoneLeaguePhase(drawn(zone.clubs), `${season}:${spec.name}:${zone.name}`);
      } catch {
        return false;
      }
      rows.push(...zone.clubs.map((club) => ({ club_id: club.id, group_name: zone.name })));
      matches.push(
        ...draw.fixtures.map((fixture) => ({
          home: fixture.homeId,
          away: fixture.awayId,
          round: fixture.round,
          group: zone.name,
        })),
      );
      continue;
    }
    const count = Math.max(1, Math.round(zone.clubs.length / (catalog.groupSize ?? 4)));
    let groups: number[][] = [];
    try {
      if (zone.clubs.length % count === 0)
        groups = drawGroups(drawn(zone.clubs), count, `${season}:${spec.name}:${zone.name}`).groups;
    } catch {
      groups = [];
    }
    if (!groups.length) {
      groups = Array.from({ length: count }, () => [] as number[]);
      zone.clubs.forEach((club, index) => groups[index % count].push(club.id));
    }
    for (const group of groups) {
      const name = `Group ${String.fromCharCode(65 + letter++)}`;
      rows.push(...group.map((clubId) => ({ club_id: clubId, group_name: name })));
      const firstLeg = roundrobin(group.length, group);
      // Single-venue groups (Libertadores Sub-20) are one round robin.
      [...firstLeg, ...(catalog.legs === 1 ? [] : firstLeg.map((pairs) => pairs.map(([home, away]) => [away, home] as [number, number])))].forEach(
        (pairs, round) => pairs.forEach(([home, away]) => matches.push({ home, away, round: round + 1, group: name })),
      );
    }
  }
  if (!rows.length) return false;
  await store.bulkInsert("standings", rows.map((row) => ({ league_id: leagueId, ...row })));
  const cadence = CADENCE[catalog.id];
  const gap = cadence?.gap ?? (["CONMEBOL", "CONCACAF"].includes(catalog.confederation) ? 7 : 14);
  const planned = cadence?.matchdays?.map((monthDay) => seasonDate(season, monthDay));
  const delay = planned ? Math.max(0, daysBetween(planned[0], start)) : 0;
  const dates: string[] = [];
  for (let round = 0; round < Math.max(0, ...matches.map((match) => match.round)); round++) {
    let date = planned?.[round]
      ? addDays(planned[round], delay)
      : round
        ? addDays(dates[round - 1], gap)
        : start;
    if (round && daysBetween(dates[round - 1], date) < 3) date = addDays(dates[round - 1], 7);
    while (internationalBreak(date)) date = addDays(date, 7);
    dates.push(date);
  }
  const stage = catalog.format === "groups" ? "Group stage" : "League phase";
  for (const match of matches)
    await addFixture(store, leagueId, season, dates[match.round - 1], match.home, match.away, stage, match.round, match.group);
  return true;
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
    if (uniqueClubs.length < 2) {
      // A lone entrant keeps no "Qualified" row: nobody is listed in a competition that is not held.
      await setData(store, leagueId, { ...oldData, spec, season, phase: "not held", qualified: [] });
      return;
    }
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
    const planned = spec.catalog && CADENCE[spec.catalog.id]?.matchdays;
    // Planned matchdays move together when the main phase starts late (qualifying finished after the first one).
    const plannedDates = planned
      ? plannedMatchdays(planned, season, Math.max(0, daysBetween(seasonDate(season, planned[0]), start)))
      : [];
    if (
      plannedDates.length &&
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
      for (const fixture of draw.fixtures) {
        await addFixture(
          store,
          leagueId,
          season,
          plannedDates[fixture.round - 1],
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
    if (spec.catalog && (await catalogMainPhase(store, leagueId, uniqueClubs, spec, season, start))) return;
    const groups =
      spec.format === "Swiss"
        ? [uniqueClubs]
        : Array.from(
            { length: Math.ceil(uniqueClubs.length / (spec.groupSize ?? 4)) },
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
        ...(spec.legs === 1
          ? []
          : firstLeg.map((pairs) =>
              pairs.map(([home, away]) => [away, home] as [number, number]),
            )),
      ].slice(0, spec.legs ? robinRounds(group.length, spec.legs) : spec.rounds);
      for (const [round, pairs] of schedule.entries()) {
        let date = plannedDates[round] ?? addDays(start, round * gap);
        if (spec.kind === "continental" || spec.name === "UEFA Youth League")
          while (internationalBreak(date)) date = addDays(date, 7);
        if (spec.national && spec.age === "Senior" && NATIONS_SERIES_DATES[round])
          date = seasonDate(season, NATIONS_SERIES_DATES[round]);
        if (spec.matchdays?.[round]) date = seasonDate(season, spec.matchdays[round]);
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

export async function activateWorldStructure(store: Store, season: number) {
  return store.transaction(async () => {
    const pendingLeagues = await store.all<League>(
      "SELECT * FROM leagues WHERE kind = 'league' AND JSON_QUERY(data,'$.pendingStructure') IS NOT NULL ORDER BY id",
    );
    const pendingClubs = await store.all<Club>(
      "SELECT * FROM clubs WHERE type != 'national' AND (JSON_VALUE(data,'$.pendingSeniorLeague') IS NOT NULL OR JSON_VALUE(data,'$.pendingSeniorTier') IS NOT NULL OR JSON_QUERY(data,'$.pendingYouthLeagues') IS NOT NULL) ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END,id",
    );
    if (!pendingLeagues.length && !pendingClubs.length)
      return { leaguesActivated: 0, clubsAdmitted: 0 };
    const scheduled = new Set(
      (await store.all<{ league_id: number }>(
        "SELECT DISTINCT league_id FROM fixtures WHERE season = ? AND league_id IS NOT NULL",
        season,
      )).map((fixture) => fixture.league_id),
    );
    let leaguesActivated = 0;
    let clubsAdmitted = 0;
    for (const league of pendingLeagues) {
      const data = JSON.parse(league.data);
      const pending = data.pendingStructure;
      if (Number(pending.fromSeason) > season || scheduled.has(league.id))
        continue;
      delete data.pendingStructure;
      await store.run(
        "UPDATE leagues SET name = ?,data = ? WHERE id = ?",
        pending.name ?? league.name,
        JSON.stringify({
          ...data,
          promotion: pending.promotion,
          relegation: pending.relegation,
          targetFirstTeams: pending.targetFirstTeams,
          worldVersion: pending.worldVersion,
        }),
        league.id,
      );
      leaguesActivated++;
    }
    const leagues = await store.all<League>(
      "SELECT * FROM leagues WHERE kind = 'league' ORDER BY tier,id",
    );
    const countries = new Map(
      (await store.all<Country>("SELECT * FROM countries")).map(
        (country) => [country.id, country],
      ),
    );
    for (const club of pendingClubs) {
      const data = JSON.parse(club.data);
      if (Number(data.admitFromSeason ?? data.activeFromSeason ?? season) > season)
        continue;
      let changed = false;
      let target = leagues.find(
        (league) => league.id === Number(data.pendingSeniorLeague),
      );
      if (club.parent_id !== null && data.pendingSeniorTier) {
        const parent = await store.get<{ tier: number }>(
          "SELECT leagues.tier FROM clubs JOIN leagues ON leagues.id = clubs.league_id WHERE clubs.id = ? AND leagues.kind = 'league' AND leagues.age_group = 'Senior' AND coalesce(JSON_VALUE(leagues.data,'$.reserveOnly'),'false') NOT IN ('true','1')",
          club.parent_id,
        );
        const minimum = minimumReserveTier(
          countries.get(club.country_id)!.code,
          parent?.tier ?? 0,
        );
        target = leagues.find((league) =>
          league.country_id === club.country_id &&
          league.age_group === "Senior" &&
          !JSON.parse(league.data).reserveOnly &&
          league.tier >= Math.max(minimum, Number(data.pendingSeniorTier)),
        );
      }
      if (
        target &&
        target.country_id === club.country_id &&
        target.age_group === "Senior" &&
        !JSON.parse(target.data).reserveOnly &&
        Number(JSON.parse(target.data).activeFromSeason ?? season) <= season &&
        !scheduled.has(target.id) &&
        (club.league_id === null || !scheduled.has(club.league_id))
      ) {
        await store.run(
          "DELETE FROM standings WHERE club_id = ? AND league_id IN (SELECT id FROM leagues WHERE kind = 'league' AND age_group = 'Senior')",
          club.id,
        );
        await store.run(
          "INSERT INTO standings(league_id,club_id) VALUES (?,?)",
          target.id,
          club.id,
        );
        await store.run(
          "UPDATE clubs SET league_id = ? WHERE id = ?",
          target.id,
          club.id,
        );
        delete data.pendingSeniorLeague;
        delete data.pendingSeniorTier;
        changed = true;
      }
      for (const age of ["U19", "U17"] as const) {
        const youthId = Number(data.pendingYouthLeagues?.[age]);
        const youthLeague = leagues.find((league) =>
          league.id === youthId && league.country_id === club.country_id &&
          league.age_group === age,
        );
        if (!youthLeague || scheduled.has(youthId) ||
          Number(JSON.parse(youthLeague.data).activeFromSeason ?? season) > season)
          continue;
        const existing = await store.all<{ league_id: number }>(
          "SELECT standings.league_id FROM standings JOIN leagues ON leagues.id = standings.league_id WHERE standings.club_id = ? AND leagues.kind = 'league' AND leagues.age_group = ?",
          club.id,
          age,
        );
        if (existing.some((entry) => scheduled.has(entry.league_id))) continue;
        for (const entry of existing)
          await store.run(
            "DELETE FROM standings WHERE club_id = ? AND league_id = ?",
            club.id,
            entry.league_id,
          );
        await store.run(
          "INSERT INTO standings(league_id,club_id) VALUES (?,?)",
          youthId,
          club.id,
        );
        delete data.pendingYouthLeagues[age];
        changed = true;
      }
      if (data.pendingYouthLeagues && !Object.keys(data.pendingYouthLeagues).length)
        delete data.pendingYouthLeagues;
      if (changed) {
        await store.run(
          "UPDATE clubs SET data = ? WHERE id = ?",
          JSON.stringify(data),
          club.id,
        );
        clubsAdmitted++;
      }
    }
    return { leaguesActivated, clubsAdmitted };
  });
}

export async function scheduleDomesticLeagues(
  store: Store,
  leagues: League[],
  season: number,
  fromDate?: string,
) {
  await activateWorldStructure(store, season);
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
    const rows = (
      await store.all<Club & { group_name: string }>(
        "SELECT clubs.*, standings.group_name FROM standings JOIN clubs ON clubs.id = standings.club_id WHERE standings.league_id = ? ORDER BY clubs.id",
        league.id,
      )
    ).filter((club) => clubCompetitionEligible(club, "league", season));
    if (rows.length < 2) return;
    // A new fixture list every season: the circle method runs on a seeded shuffle of the clubs.
    const shuffle = seedrandom(`${season}:${league.id}:fixture-list`);
    for (let index = rows.length - 1; index > 0; index--) {
      const other = Math.floor(shuffle() * (index + 1));
      [rows[index], rows[other]] = [rows[other], rows[index]];
    }
    const format = readLeagueData(league.data, league.tier);
    const groups = await conferenceGroups(store, league.id, rows, format.conferences);
    const schedule = baseSchedule(groups, format.roundRobins, format.interConference ?? 0);
    const title = miniLeagueRounds(format.championship, groups.length);
    const reserved = regularSeasonDates(
      season,
      schedule.length,
      splitMatchdays(format.split) + title,
      league.age_group === "Senior" ? leagueDateOptions(format.catalogKey, season) : {},
    );
    const dates = reserved.base;
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
    if (reserved.split.length) {
      const raw = JSON.parse(league.data);
      const plan: SeasonPlan = {
        season,
        baseRounds: schedule.length,
        splitDates: reserved.split.slice(0, reserved.split.length - title),
        titleDates: reserved.split.slice(reserved.split.length - title),
        ...(format.split ? {} : { splitDone: true }),
      };
      await store.run(
        "UPDATE leagues SET data = ? WHERE id = ?",
        JSON.stringify({ ...raw, seasonPlan: plan }),
        league.id,
      );
    }
    if (league.age_group === "Senior") {
      // Friendlies against league rivals met in mid-autumn, never the opening opponents.
      const single = Math.max(1, Math.floor(schedule.length / Math.max(1, format.roundRobins)));
      const friendlyRounds = [Math.floor(single / 3), Math.floor(single / 2)].filter(
        (round, index, all) => round >= 2 && all.indexOf(round) === index,
      );
      for (const [index, round] of friendlyRounds.entries()) {
        const date = `${season}-07-${index === 0 ? "11" : "25"}`;
        if (fromDate && date < fromDate) continue;
        for (const [home, away] of schedule[round] ?? [])
          await addFixture(
            store,
            null,
            season,
            date,
            away,
            home,
            "Pre-season friendly",
            index + 1,
          );
      }
    }
  });
}

type CupClub = Club & { tier: number | null };

/** Section 4 entrants: own first teams (hosted abroad only with cups "home") plus clubs hosted here with cups "host". */
function cupEntrants(clubs: readonly CupClub[], country: Country, cup: CupSpec) {
  const inTiers = (club: CupClub) => !cup.tiers || cup.tiers.includes(club.tier ?? 0);
  return clubs
    .filter((club) => {
      const hosted = JSON.parse(club.data).hosted as { host: string; cups: string } | undefined;
      if (club.country_id === country.id) return hosted ? hosted.cups === "home" : inTiers(club);
      return hosted?.host === country.code && hosted.cups === "host" && inTiers(club);
    })
    .sort(
      (left, right) =>
        (left.tier ?? 99) - (right.tier ?? 99) || right.reputation - left.reputation || left.id - right.id,
    )
    .slice(0, cup.maxEntrants ?? 64);
}

/** A lone entrant wins by walkover (Liechtenstein Cup with one club) and is recorded as champion. */
async function recordWalkover(store: Store, leagueId: number, spec: CompetitionSpec, club: Club, season: number) {
  await setData(store, leagueId, { spec, season, phase: "complete", champion: club.id, championName: club.name });
  await store.run(
    "INSERT INTO history(season, entity_type, entity_id, date, data) VALUES (?, ?, ?, ?, ?)",
    season,
    "champion",
    leagueId,
    `${season}-07-01`,
    JSON.stringify({ clubId: club.id, name: club.name, competition: spec.name, walkover: true }),
  );
}

/** Super cup participants from last season; a duplicate or unknown participant is replaced by the next league club. */
async function superCupEntrants(store: Store, country: Country, cup: CupSpec, cups: readonly CupSpec[], season: number) {
  const top = await store.get<League>(
    "SELECT * FROM leagues WHERE country_id = ? AND kind = 'league' AND age_group = 'Senior' AND tier = 1 AND coalesce(JSON_VALUE(data,'$.reserveOnly'),'false') NOT IN ('true','1')",
    country.id,
  );
  const archived = top
    ? await store.get<{ data: string }>(
        "SELECT TOP 1 data FROM history WHERE entity_type = 'league' AND entity_id = ? AND season = ? ORDER BY id DESC",
        top.id,
        season - 1,
      )
    : undefined;
  const last = archived ? JSON.parse(archived.data) : {};
  // First season: no history yet, so the strongest top-tier clubs stand in.
  const ranked = last.table
    ? rankTable(last.table as Standing[], top ? readLeagueData(top.data, 1).split : undefined).map((row) => row.club_id)
    : (
        await store.all<{ id: number }>(
          "SELECT clubs.id FROM standings JOIN clubs ON clubs.id = standings.club_id WHERE standings.league_id = ? ORDER BY clubs.reputation DESC, clubs.id",
          top?.id ?? 0,
        )
      ).map((row) => row.id);
  const champion: number | undefined = last.champion ?? ranked[0];
  const winnerOf = async (kind: CupSpec["kind"]) => {
    const name = cups.find((entry) => entry.kind === kind)?.name;
    const row = name
      ? await store.get<{ data: string }>(
          "SELECT TOP 1 history.data FROM history JOIN leagues ON leagues.id = history.entity_id WHERE history.entity_type = 'champion' AND history.season = ? AND leagues.name = ? AND leagues.country_id = ? ORDER BY history.id DESC",
          season - 1,
          name,
          country.id,
        )
      : undefined;
    return row ? Number(JSON.parse(row.data).clubId) : undefined;
  };
  const picks: number[] = [];
  for (const participant of cup.participants ?? ["champion", "cup-winner"]) {
    let clubId =
      participant === "champion"
        ? champion
        : participant === "runner-up"
          ? ranked.find((id) => id !== champion)
          : participant === "cup-winner"
            ? await winnerOf("national")
            : participant === "league-cup-winner"
              ? await winnerOf("league")
              : undefined;
    if (clubId === undefined || picks.includes(clubId)) clubId = ranked.find((id) => !picks.includes(id));
    if (clubId !== undefined) picks.push(clubId);
  }
  return picks;
}

/** Catalog cups of one nation: national, league and super cups (zero allowed) and the U19/U17 cups. */
async function scheduleNationalCups(store: Store, country: Country, season: number) {
  const football = nationByCode(country.code)?.football;
  if (!football) return;
  const seniors = (
    await store.all<CupClub>(
      "SELECT clubs.*, (SELECT min(leagues.tier) FROM standings JOIN leagues ON leagues.id = standings.league_id WHERE standings.club_id = clubs.id AND leagues.kind = 'league' AND leagues.age_group = 'Senior' AND leagues.tier > 0) AS tier FROM clubs WHERE clubs.type = 'club' AND clubs.parent_id IS NULL AND (clubs.country_id = ? OR JSON_VALUE(clubs.data,'$.hosted.host') = ?) ORDER BY clubs.id",
      country.id,
      country.code,
    )
  ).filter((club) => clubCompetitionEligible(club, "cup", season));
  const byId = new Map(seniors.map((club) => [club.id, club]));
  for (const cup of football.cups) {
    const entrants = cup.kind === "super" ? [] : cupEntrants(seniors, country, cup);
    const entries =
      cup.kind === "super"
        ? await superCupEntrants(store, country, cup, football.cups, season)
        : entrants.map((club) => club.id);
    const start = cup.start ?? (cup.kind === "super" ? "08-01" : cup.kind === "league" ? "08-26" : "10-21");
    let cupPlan: CupPlan | undefined;
    if (cup.kind !== "super" && entrants.length > 1) {
      const entryPlan = cupEntryPlan(
        entrants.map((club) => ({ id: club.id, tier: club.tier ?? 99 })),
        Boolean(cup.seededEntry),
      );
      cupPlan = {
        ...entryPlan,
        dates: cupRoundDates(
          season,
          start,
          // Summer league cups with their own start (Durand Cup, MTN 8) stay compact.
          cup.final ?? (cup.kind === "national" ? "05-22" : cup.start ? undefined : "02-28"),
          entryPlan.rounds,
        ),
        tiers: Object.fromEntries(entrants.map((club) => [club.id, club.tier ?? 99])),
        ...(cup.lowerTierHome ? { lowerTierHome: cup.lowerTierHome } : {}),
      };
    }
    const spec: CompetitionSpec = {
      name: cup.name,
      confederation: country.confederation,
      age: "Senior",
      kind: "cup",
      teams: entries.length,
      format: "Knockout",
      rounds: cupPlan?.rounds ?? cup.rounds ?? Math.max(1, Math.ceil(Math.log2(Math.max(2, entries.length)))),
      qualifies: 1,
      start,
      cupFormat: { legs: cup.legs, finalLegs: cup.finalLegs, neutralFinal: cup.neutralFinal },
      ...(cupPlan ? { cupPlan } : {}),
    };
    const leagueId = await createLeague(store, spec, country.id);
    if (entries.length === 1 && byId.has(entries[0]))
      await recordWalkover(store, leagueId, spec, byId.get(entries[0])!, season);
    else await setupMainCompetition(store, leagueId, entries, spec, season);
  }
  for (const age of ["U19", "U17"] as const) {
    const name = football.youth[age].cup?.name;
    if (!name) continue;
    const entries = (
      await store.all<Club>(
        "SELECT DISTINCT clubs.* FROM standings JOIN clubs ON clubs.id = standings.club_id JOIN leagues ON leagues.id = standings.league_id WHERE leagues.country_id = ? AND leagues.age_group = ? AND leagues.kind = 'league' AND (JSON_VALUE(leagues.data,'$.activeFromSeason') IS NULL OR TRY_CONVERT(int,JSON_VALUE(leagues.data,'$.activeFromSeason')) <= ?) ORDER BY clubs.id",
        country.id,
        age,
        season,
      )
    ).filter((club) => clubCompetitionEligible(club, "cup", season)).map((club) => club.id);
    if (entries.length < 2) continue;
    const spec: CompetitionSpec = {
      name,
      confederation: country.confederation,
      age: age as AgeGroup,
      kind: "cup",
      teams: entries.length,
      format: "Knockout",
      rounds: Math.ceil(Math.log2(entries.length)),
      qualifies: 1,
      start: "12-02",
    };
    await setupMainCompetition(store, await createLeague(store, spec, country.id), entries, spec, season);
  }
}

// ----------------------------------------------------------- continental

/** UEFA qualifying first legs (2025/26 calendar); other confederations count back from the main start. */
const UEFA_STAGE_DATES: Partial<Record<QualifyingStage, string>> = {
  q1: "07-08",
  q2: "07-22",
  q3: "08-05",
  q4: "08-12",
  playoff: "08-19",
};

/** Next continental knockout round: two weeks apart, compressed (at least 3 days) so the final is played by June. */
function continentalRoundDate(date: string, season: number, clubs: number) {
  const rounds = Math.max(1, Math.ceil(Math.log2(Math.max(2, clubs))));
  // Leaves room for the June FIFA window (9 days) and a margin: no club matches in it.
  const days = daysBetween(date, `${season + 1}-06-27`) - 15;
  let next = addDays(date, Math.max(3, Math.min(14, Math.floor(days / rounds) - 7)));
  while (internationalBreak(next)) next = addDays(next, 7);
  return next;
}

/** A knockout round on its real date (at least three days after the last round), or the next single-venue round. */
function cadenceRoundDate(catalogId: string, date: string, season: number, alive: number, playoff = false) {
  const cadence = CADENCE[catalogId];
  if (cadence?.gap) return addDays(date, cadence.gap);
  const bracket = playoff || alive > 16 ? "playoff" : (String(2 ** Math.ceil(Math.log2(Math.max(2, alive)))) as BracketSize);
  const planned = cadence?.knockout?.[bracket];
  if (!planned) return undefined;
  let next = seasonDate(season, planned);
  if (next < addDays(date, 3)) next = addDays(date, 3);
  while (internationalBreak(next)) next = addDays(next, 1);
  return next;
}

interface QualifyingData extends CompetitionData {
  catalogQualifying: true;
  qualificationFor: number;
  /** Winners wanted when the main phase has no other entrants (main teams, or UYL knockout places). */
  target: number;
  stageEntrants: Partial<Record<QualifyingStage, number[]>>;
  paths: Record<string, string>;
  seeds: Record<string, number>;
  lastStage: QualifyingStage;
  stage?: QualifyingStage;
  carried: number[];
  completedStages: QualifyingStage[];
  resolvedRound?: number;
  /** Winners wanted per zone at the last stage (ACL Elite: 16 per zone minus its direct entrants). */
  pathTargets?: Record<string, number>;
}

const catalogById = (id: string) => CONTINENTAL.competitions.find((item) => item.id === id);
const leagueNamed = (store: Store, name: string) =>
  store.get<League>("SELECT TOP (1) * FROM leagues WHERE name = ? AND country_id IS NULL ORDER BY id", name);
const dropsInto = (id: string) =>
  CONTINENTAL.competitions.flatMap((source) =>
    (source.drops ?? []).filter((drop) => drop.to === id).map((drop) => ({ source, drop })),
  );

async function qualifyingOf(store: Store, name: string, season: number) {
  const league = await leagueNamed(store, `${name} Qualifying`);
  const data = league ? (JSON.parse(league.data) as Partial<QualifyingData>) : undefined;
  return league && data?.catalogQualifying && data.season === season ? { league, data } : undefined;
}

/** A source stage is done once resolved, skipped (the bracket moved past it) or the bracket is absent/complete. */
async function stageDone(store: Store, name: string, stage: ContinentalStage, season: number, started = false) {
  const source = await qualifyingOf(store, name, season);
  if (!source || source.data.phase === "complete" || stage === "main") return true;
  if (source.data.completedStages?.includes(stage as QualifyingStage)) return true;
  const current = source.data.stage ? QUALIFYING_STAGES.indexOf(source.data.stage) : -1;
  const wanted = QUALIFYING_STAGES.indexOf(stage as QualifyingStage);
  return current > wanted || (started && current === wanted);
}

/** Clubs still to drop into this main phase from source rounds in progress; null = a source round is not drawn yet. */
async function pendingMainDrops(store: Store, catalog: ContinentalCompetitionSpec, season: number) {
  let pending = 0;
  for (const { source, drop } of dropsInto(catalog.id).filter(({ drop }) => drop.stage === "main")) {
    if (await stageDone(store, source.name, drop.from, season)) continue;
    if (!(await stageDone(store, source.name, drop.from, season, true))) return null;
    const { league, data } = (await qualifyingOf(store, source.name, season))!;
    const fixtures = await store.all<Fixture>(
      "SELECT * FROM fixtures WHERE league_id = ? AND season = ? AND round = ?",
      league.id,
      season,
      data.nextRound ?? 0,
    );
    const ties = new Map(fixtures.map((fixture) => [JSON.parse(fixture.data).tie?.id ?? fixture.id, fixture]));
    pending += [...ties.values()].filter((fixture) => !drop.path || data.paths?.[fixture.home_id] === drop.path).length;
  }
  return pending;
}

async function deliverDrop(
  store: Store,
  drop: NonNullable<ContinentalCompetitionSpec["drops"]>[number],
  clubId: number,
  from: QualifyingData,
  season: number,
) {
  const target = catalogById(drop.to);
  if (!target) return;
  const qualifying = drop.stage === "main" ? undefined : await qualifyingOf(store, target.name, season);
  if (qualifying) {
    const data = qualifying.data as QualifyingData;
    const stage = drop.stage as QualifyingStage;
    data.stageEntrants[stage] = [...(data.stageEntrants[stage] ?? []), clubId];
    // The League Path exists only in the Champions League: its losers join the target's main path.
    const path = drop.path ?? from.paths[clubId] ?? "";
    data.paths[clubId] = path === "league" ? "" : path;
    data.seeds[clubId] = from.seeds[clubId] ?? 0;
    await setData(store, qualifying.league.id, data);
    await store.bulkInsert("standings", [{ league_id: qualifying.league.id, club_id: clubId, group_name: stage }]);
    return;
  }
  const main = await leagueNamed(store, target.name);
  if (!main) return;
  const data: CompetitionData = JSON.parse(main.data);
  if (data.season !== season || data.phase !== "awaiting qualifiers") return;
  await setData(store, main.id, { ...data, direct: [...(data.direct ?? []), clubId] });
  await store.bulkInsert("standings", [{ league_id: main.id, club_id: clubId, group_name: "Qualified" }]);
}

/** Starts a continental main phase once its own qualifying, main-phase drop-ins and mirrored field are known. */
async function tryStartMain(store: Store, mainId: number, season: number, date: string) {
  const main = (await store.get<League>("SELECT * FROM leagues WHERE id = ?", mainId))!;
  const data: CompetitionData = JSON.parse(main.data);
  const spec = data.spec!;
  const catalog = spec.catalog!;
  if (data.phase !== "awaiting qualifiers" || data.season !== season) return;
  if (!catalog.mirrors)
    for (const id of data.qualifiers ?? []) {
      const qualifying = await store.get<League>("SELECT * FROM leagues WHERE id = ?", id);
      if (qualifying && JSON.parse(qualifying.data).phase !== "complete") return;
    }
  for (const { source, drop } of dropsInto(catalog.id).filter(({ drop }) => drop.stage === "main"))
    if (!(await stageDone(store, source.name, drop.from, season))) return;
  let clubs = [...new Set(data.direct ?? [])];
  if (catalog.mirrors) {
    const mirrored = await leagueNamed(store, catalogById(catalog.mirrors)?.name ?? "");
    const mirroredData: CompetitionData | undefined = mirrored && JSON.parse(mirrored.data);
    if (mirroredData?.season !== season || !["groups", "knockout", "complete"].includes(mirroredData.phase ?? ""))
      return;
    const sides = new Set(
      (
        await store.all<{ club_id: number }>(
          "SELECT DISTINCT standings.club_id FROM standings JOIN leagues ON leagues.id = standings.league_id WHERE leagues.kind = 'league' AND leagues.age_group = ?",
          spec.age,
        )
      ).map((row) => row.club_id),
    );
    clubs = (mirroredData.qualified ?? []).filter((id) => sides.has(id));
  }
  // Fewer than two clubs: "not held" (AFC Challenge League when no ACL Two preliminary loser drops).
  await setupMainCompetition(store, mainId, clubs.slice(0, spec.teams), spec, season, addDays(date, 3));
}

/** Schedules the next qualifying round; waits while drop-ins for that stage are still being decided elsewhere. */
async function advanceQualifying(store: Store, leagueId: number, season: number, date: string) {
  const league = (await store.get<League>("SELECT * FROM leagues WHERE id = ?", leagueId))!;
  const data = JSON.parse(league.data) as QualifyingData;
  const main = (await store.get<League>("SELECT * FROM leagues WHERE id = ?", data.qualificationFor))!;
  const mainData: CompetitionData = JSON.parse(main.data);
  const catalog = mainData.spec!.catalog!;
  const lastIndex = QUALIFYING_STAGES.indexOf(data.lastStage);
  let index = data.stage ? QUALIFYING_STAGES.indexOf(data.stage) : -1;
  let carried = [...data.carried];
  for (;;) {
    const nextIndex = Math.min(index + 1, QUALIFYING_STAGES.length - 1);
    const stage = QUALIFYING_STAGES[nextIndex];
    for (const { source, drop } of dropsInto(catalog.id).filter(({ drop }) => drop.stage === stage))
      if (!(await stageDone(store, source.name, drop.from, season))) return;
    const playing = [...new Set([...carried, ...(nextIndex > index ? (data.stageEntrants[stage] ?? []) : [])])];
    const last = nextIndex >= lastIndex;
    const entering =
      (data.stageEntrants[stage]?.length ?? 0) > 0 || dropsInto(catalog.id).some(({ drop }) => drop.stage === stage);
    if (!last && !entering) {
      carried = playing;
      index = nextIndex;
      continue;
    }
    let slots = data.target;
    if (last && !catalog.mirrors) {
      const pending = await pendingMainDrops(store, catalog, season);
      if (pending === null) return;
      slots -= new Set(mainData.direct ?? []).size + pending;
    }
    const pathOf = (clubId: number) => data.paths[clubId] ?? "";
    // Zoned competitions fill each zone on its own (ACL Elite preliminary round: two ties per zone).
    const zoneTies =
      last && data.pathTargets
        ? Object.fromEntries(
            Object.entries(data.pathTargets).map(([zone, target]) => [
              zone,
              lastStageTies(playing.filter((clubId) => pathOf(clubId) === zone).length, target),
            ]),
          )
        : undefined;
    const laterEntrants = QUALIFYING_STAGES.slice(nextIndex + 1).some(
      (later) => (data.stageEntrants[later]?.length ?? 0) > 0,
    );
    const ties = !last
      ? laterEntrants || playing.length < 2
        ? Math.floor(playing.length / 2)
        : // Only drop-ins follow (CAF Confederation Cup): byes bring the next round to a power of two (60 → 32).
          playing.length - 2 ** (Math.ceil(Math.log2(playing.length)) - 1)
      : zoneTies
        ? Object.values(zoneTies).reduce((sum, count) => sum + count, 0)
        : lastStageTies(playing.length, slots);
    if (!ties) {
      if (!last) {
        carried = playing;
        index = nextIndex;
        continue;
      }
      const winners = zoneTies
        ? playing.filter((clubId) => (data.pathTargets![pathOf(clubId)] ?? 0) > 0)
        : slots <= 0
          ? []
          : playing;
      const current: CompetitionData = JSON.parse(
        (await store.get<League>("SELECT * FROM leagues WHERE id = ?", main.id))!.data,
      );
      await setData(
        store,
        main.id,
        catalog.mirrors
          ? { ...current, knockoutEntrants: [...((current.knockoutEntrants as number[]) ?? []), ...winners] }
          : { ...current, direct: [...(current.direct ?? []), ...winners] },
      );
      await setData(store, leagueId, { ...data, stage, carried: [], phase: "complete", qualified: winners });
      await tryStartMain(store, main.id, season, date);
      return;
    }
    const sorted = playing.sort((left, right) => (data.seeds[right] ?? 0) - (data.seeds[left] ?? 0) || left - right);
    const pairs = (
      zoneTies
        ? Object.entries(zoneTies).map(([zone, count]) =>
            pairQualifyingRound(sorted.filter((clubId) => pathOf(clubId) === zone), count),
          )
        : [pairQualifyingRound(sorted, ties, pathOf)]
    ).flatMap((part) => part.pairs);
    const paired = new Set(pairs.flat());
    const byes = sorted.filter((clubId) => !paired.has(clubId));
    const round = (data.nextRound ?? 0) + 1;
    const stageDates = CADENCE[catalog.id]?.qualifying ?? (catalog.confederation === "UEFA" ? UEFA_STAGE_DATES : undefined);
    const planned = stageDates?.[stage];
    let first = date;
    if (planned && nextIndex > index) {
      const fixed = addDays(seasonDate(season, planned), catalog.confederation === "UEFA" && catalog.level !== 1 ? 1 : 0);
      if (fixed > first) first = fixed;
    }
    while (internationalBreak(first)) first = addDays(first, 7);
    const rules = knockoutRules(league.name, "Qualifying");
    await withFixtureBatch(store, season, async () => {
      for (const [tieIndex, [seeded, opponent]] of pairs.entries()) {
        const tie: KnockoutTie = { ...rules, id: `${season}:${leagueId}:${round}:${tieIndex}`, leg: 1 };
        const details = { tie, qualifyingStage: stage };
        const firstDate = await addFixture(
          store,
          leagueId,
          season,
          first,
          rules.legs === 2 ? opponent : seeded,
          rules.legs === 2 ? seeded : opponent,
          "Qualifying",
          round,
          "",
          details,
        );
        if (rules.legs === 2) {
          // A tie may straddle a FIFA window (UYL Domestic Champions Path round 1: 16 September, then October).
          let second = addDays(firstDate!, 7);
          while (internationalBreak(second)) second = addDays(second, 7);
          await addFixture(store, leagueId, season, second, seeded, opponent, "Qualifying", round, "", {
            ...details,
            tie: { ...tie, leg: 2 },
          });
        }
      }
    });
    await setData(store, leagueId, { ...data, stage, carried: byes, nextRound: round, phase: "knockout" });
    return;
  }
}

/** Resolves a finished qualifying round once (winners carried, losers dropped), then tries the next round. */
async function progressQualifying(store: Store, league: League, season: number, date: string) {
  const data = JSON.parse(league.data) as QualifyingData;
  if (data.season !== season || data.phase === "complete") return;
  const round = data.nextRound ?? 0;
  if (round && data.resolvedRound !== round) {
    const fixtures = await store.all<Fixture>(
      "SELECT * FROM fixtures WHERE league_id = ? AND season = ? AND round = ?",
      league.id,
      season,
      round,
    );
    if (fixtures.some((fixture) => fixture.status === "scheduled")) return;
    const ties = new Map<string, Fixture[]>();
    for (const fixture of fixtures) {
      const id = JSON.parse(fixture.data).tie?.id ?? String(fixture.id);
      ties.set(id, [...(ties.get(id) ?? []), fixture]);
    }
    const winners: number[] = [];
    const main = (await store.get<League>("SELECT * FROM leagues WHERE id = ?", data.qualificationFor))!;
    const catalog = (JSON.parse(main.data) as CompetitionData).spec!.catalog!;
    for (const legs of ties.values()) {
      const winner = knockoutWinner(legs);
      if (!winner) throw new Error(`Qualifying tie in ${league.name} has no winner.`);
      winners.push(winner);
      const loser = legs[0].home_id === winner ? legs[0].away_id : legs[0].home_id;
      const drop = (catalog.drops ?? []).find(
        (item) => item.from === data.stage && (!item.path || item.path === data.paths[loser]),
      );
      if (drop) await deliverDrop(store, drop, loser, data, season);
    }
    const fresh = JSON.parse((await store.get<League>("SELECT * FROM leagues WHERE id = ?", league.id))!.data);
    Object.assign(data, fresh, {
      carried: [...data.carried, ...winners],
      completedStages: [...new Set([...(data.completedStages ?? []), data.stage!])],
      resolvedRound: round,
    });
    await setData(store, league.id, data);
  }
  await advanceQualifying(store, league.id, season, addDays(date, 7));
}

async function setupContinental(store: Store, spec: CompetitionSpec, season: number, usedSenior: Set<number>) {
  const catalog = spec.catalog!;
  // Feeders, super cups and youth events are separate pools: their clubs may also hold a senior place.
  const separate = Boolean(catalog.feeder) || catalog.kind === "super" || spec.age !== "Senior";
  const entries = (await continentalEntries(store, catalog.id, season, separate ? new Set() : usedSenior)).filter(
    (entry) => clubCompetitionEligible(entry.club, spec.kind, season),
  );
  if (!separate) for (const entry of entries) usedSenior.add(entry.club.id);
  const mainId = await createLeague(store, spec);
  const direct = new Set(entries.filter((entry) => entry.stage === "main").map((entry) => entry.club.id));
  // A club listed twice keeps one place: the main phase, else its first qualifying stage.
  const listed = new Set(direct);
  const qualifying = entries.filter(
    (entry) => entry.stage !== "main" && !listed.has(entry.club.id) && Boolean(listed.add(entry.club.id)),
  );
  const codes = new Map(
    (await store.all<Country>("SELECT * FROM countries")).map((country) => [country.id, country.code]),
  );
  // AFC play-offs stay inside their zone; UEFA qualifying keeps the Champions and League paths apart.
  const pathOf = (entry: (typeof entries)[number]) =>
    entry.path ??
    catalog.zones?.find((zone) => zone.nations.includes(codes.get(entry.club.country_id) ?? ""))?.name ??
    "";
  const sources = dropsInto(catalog.id).filter(({ drop }) => drop.stage !== "main");
  const data: CompetitionData = {
    spec,
    season,
    phase: "awaiting qualifiers",
    direct: [...direct],
    qualifiers: [],
    qualification: entries.map(({ club, ...entry }) => ({ clubId: club.id, ...entry })),
    regulationsVersion: 2,
  };
  // Before qualifying: a qualifying round with no ties can start the main phase at once (its own standings).
  if (direct.size)
    await store.bulkInsert(
      "standings",
      [...direct].map((clubId) => ({ league_id: mainId, club_id: clubId, group_name: "Qualified" })),
    );
  if (qualifying.length || sources.length) {
    const qualifyingSpec: CompetitionSpec = {
      ...spec,
      name: `${spec.name} Qualifying`,
      format: "Knockout",
      teams: qualifying.length,
      qualifies: 0,
    };
    const qualifyingId = await createLeague(store, qualifyingSpec);
    const stageEntrants: QualifyingData["stageEntrants"] = {};
    for (const entry of qualifying) {
      const stage = entry.stage as QualifyingStage;
      stageEntrants[stage] = [...(stageEntrants[stage] ?? []), entry.club.id];
    }
    const stages = [...qualifying.map((entry) => entry.stage), ...sources.map(({ drop }) => drop.stage)];
    const lastIndex = Math.max(...stages.map((stage) => QUALIFYING_STAGES.indexOf(stage as QualifyingStage)));
    const knockoutSize = 2 ** Math.ceil(Math.log2(Math.max(2, catalog.advance)));
    const zoneSize = catalog.zones?.length ? catalog.teams / catalog.zones.length : 0;
    const directIn = (zone: string) =>
      new Set(entries.filter((entry) => entry.stage === "main" && pathOf(entry) === zone).map((entry) => entry.club.id))
        .size;
    await setData(store, qualifyingId, {
      spec: qualifyingSpec,
      season,
      phase: "knockout",
      catalogQualifying: true,
      qualificationFor: mainId,
      target: catalog.mirrors ? knockoutSize - catalog.advance : spec.teams,
      stageEntrants,
      paths: Object.fromEntries(qualifying.map((entry) => [entry.club.id, pathOf(entry)])),
      seeds: Object.fromEntries(qualifying.map((entry) => [entry.club.id, entry.coefficient])),
      lastStage: QUALIFYING_STAGES[lastIndex],
      carried: [],
      completedStages: [],
      nextRound: 0,
      ...(zoneSize
        ? { pathTargets: Object.fromEntries(catalog.zones!.map((zone) => [zone.name, zoneSize - directIn(zone.name)])) }
        : {}),
    } satisfies QualifyingData);
    await store.bulkInsert(
      "standings",
      qualifying.map((entry) => ({ league_id: qualifyingId, club_id: entry.club.id, group_name: entry.stage })),
    );
    data.qualifiers = [qualifyingId];
    await setData(store, mainId, data);
    // Non-UEFA qualifying counts back from the main start: two weeks per round, the first legs a week earlier.
    const counts: Partial<Record<QualifyingStage, number>> = {};
    for (const [stage, clubs] of Object.entries(stageEntrants)) counts[stage as QualifyingStage] = clubs.length;
    const rounds = Math.max(1, qualifyingPlan(counts, spec.teams - (data.direct?.length ?? 0)).length);
    const counted = CADENCE[catalog.id]?.qualifying
      ? `${season}-07-02`
      : addDays(seasonDate(season, spec.start), -(rounds * 14 + 7));
    await advanceQualifying(store, qualifyingId, season, counted < `${season}-07-02` ? `${season}-07-02` : counted);
  } else await setData(store, mainId, data);
  await tryStartMain(store, mainId, season, addDays(seasonDate(season, spec.start), -3));
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
  await store.transaction(async () => {
    await activateWorldStructure(store, season);
    return withFixtureBatch(store, season, async () => {
      for (const league of await store.all<League>(
        "SELECT * FROM leagues WHERE kind = 'league' ORDER BY id",
      )) {
        await scheduleDomesticLeague(store, league, season);
      }
      const countries = await store.all<Country>(
        "SELECT * FROM countries ORDER BY id",
      );
      for (const country of countries)
        await scheduleNationalCups(store, country, season);
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
      await ensureNationalTeams(store);
      await renameLegacyYouthLeagues(store);
      for (const spec of COMPETITIONS) {
        if (spec.catalog) {
          await setupContinental(store, spec, season, usedSenior);
          continue;
        }
        if (spec.youth) {
          await setupYouthTournament(store, spec, season);
          continue;
        }
        if (
          settings.youthTournamentFrequency === "low" &&
          spec.kind === "youth" &&
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
        if (!spec.national)
          clubs = clubs.filter((club) =>
            clubCompetitionEligible(club, spec.kind, season),
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
        const mainId = await createLeague(store, spec);
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
          await scheduleKnockout(
            store,
            qualifyingId,
            qualifying,
            season,
            addDays(mainStart, -28),
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
    });
  });
}

export interface CountryPyramid {
  leagues: League[];
  tiers: PyramidTier[];
  clubs: Map<number, PyramidClub>;
}

/** Pre-rebuild youth league rows take the real tournament names (and the playing team's age group). */
async function renameLegacyYouthLeagues(store: Store) {
  for (const [old, name] of Object.entries(LEGACY_YOUTH_NAMES)) {
    const age = YOUTH_TOURNAMENTS.find((item) => item.name === name)!.team;
    for (const suffix of ["", " Qualifying"])
      await store.run(
        "UPDATE leagues SET name = ?, age_group = ? WHERE name = ? AND country_id IS NULL AND NOT EXISTS (SELECT 1 FROM leagues AS other WHERE other.name = ? AND other.country_id IS NULL)",
        name + suffix,
        age,
        old + suffix,
        name + suffix,
      );
  }
}

async function nationalTeams(store: Store, youth: YouthTournamentSpec) {
  const teams = await store.all<EntrantTeam>(
    `SELECT clubs.id, countries.code, countries.confederation, clubs.reputation FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE clubs.type = 'national' AND clubs.age_group = ? ${youth.confederation === "FIFA" ? "" : "AND countries.confederation = ?"} ORDER BY clubs.reputation DESC, clubs.id`,
    youth.team,
    ...(youth.confederation === "FIFA" ? [] : [youth.confederation]),
  );
  return teams.filter((team) => !isSuspended(team.code, "national"));
}

/**
 * A youth tournament's season: finals when held (hosts, FIFA places per confederation, or qualifiers), a qualifying
 * stage (for this season's finals or, carried over, next season's) and "rest year" otherwise.
 */
async function setupYouthTournament(store: Store, spec: CompetitionSpec, season: number) {
  const youth = YOUTH_TOURNAMENTS.find((item) => item.id === spec.youth)!;
  const previous = await store.get<League>("SELECT * FROM leagues WHERE name = ? AND country_id IS NULL", spec.name);
  const carried = previous && (JSON.parse(previous.data).carried as { season: number; teams: number[] } | undefined);
  const teams = await nationalTeams(store, youth);
  const mainId = await createLeague(store, spec);
  const hostsOf = (target: number) => editionHosts(youth, editionYear(youth, target), teams);
  if (youth.qualifying?.season === "previous" && heldInSeason(youth, season + 1)) {
    const hosts = hostsOf(season + 1);
    await setupYouthQualifying(store, youth, spec, mainId, season, season + 1, teams.filter((team) => !hosts.includes(team.code)), youth.teams - hosts.length);
  }
  if (!heldInSeason(youth, season)) {
    await setData(store, mainId, { spec, season, phase: "rest year", nextEdition: heldInSeason(youth, season + 1) ? season + 1 : season + 2 });
    return;
  }
  const hosts = hostsOf(season);
  const direct = teams.filter((team) => hosts.includes(team.code)).map((team) => team.id);
  const cutoff = cohortCutoff(youth, season);
  if (youth.qualifying?.season === "same" && teams.length > youth.teams) {
    const qualifyingId = await setupYouthQualifying(store, youth, spec, mainId, season, season, teams.filter((team) => !direct.includes(team.id)), youth.teams - direct.length);
    await store.bulkInsert("standings", direct.map((clubId) => ({ league_id: mainId, club_id: clubId, group_name: "Qualified" })));
    await setData(store, mainId, { spec, season, phase: "awaiting qualifiers", direct, qualifiers: [qualifyingId], cutoff });
    return;
  }
  const entrants =
    carried?.season === season
      ? [...new Set([...direct, ...carried.teams])].slice(0, youth.teams)
      : allocateEntrants(youth, teams, hosts).map((team) => team.id);
  await setData(store, mainId, { spec, season, cutoff, hosts });
  await setupMainCompetition(store, mainId, entrants, spec, season);
}

/** Groups (single-venue mini-tournaments or home-and-away in the windows) whose best teams fill the finals places. */
async function setupYouthQualifying(
  store: Store,
  youth: YouthTournamentSpec,
  main: CompetitionSpec,
  mainId: number,
  season: number,
  forSeason: number,
  entrants: readonly EntrantTeam[],
  slots: number,
) {
  const qualifying = youth.qualifying!;
  const spec: CompetitionSpec = {
    ...main,
    name: `${main.name} Qualifying`,
    teams: entrants.length,
    qualifies: slots,
    groupSize: qualifying.groupSize,
    legs: qualifying.legs,
    rounds: robinRounds(qualifying.groupSize, qualifying.legs),
    start: qualifying.start ?? qualifying.matchdays![0],
    matchdays: qualifying.matchdays,
  };
  const id = await createLeague(store, spec);
  await setData(store, id, { spec, season, qualificationFor: mainId, forSeason, slots, cutoff: cohortCutoff(youth, forSeason) });
  await setupMainCompetition(store, id, entrants.map((team) => team.id), spec, season);
  return id;
}

/** Played league matches of a league, only when its criteria use head-to-head results. */
async function headToHeadResults(store: Store, leagueId: number, tiebreakers: readonly string[], season?: number) {
  if (!needsHeadToHead(tiebreakers)) return [];
  const which = season ?? (await store.get<{ season: number | null }>("SELECT max(season) AS season FROM fixtures WHERE league_id = ?", leagueId))?.season;
  if (which === null || which === undefined) return [];
  return store.all<{ home_id: number; away_id: number; home_goals: number | null; away_goals: number | null }>(
    "SELECT home_id,away_id,home_goals,away_goals FROM fixtures WHERE league_id = ? AND season = ? AND stage = 'League' AND status = 'played'",
    leagueId,
    which,
  );
}

/** Final table of one senior league with its real ranking criteria (head-to-head, wins) and split groups. */
export async function rankLeagueTable<Row extends RankableRow>(store: Store, league: League, rows: readonly Row[], season?: number) {
  const format = readLeagueData(league.data, league.tier);
  return rankTable(rows, format.split, {
    tiebreakers: format.tiebreakers,
    results: await headToHeadResults(store, league.id, format.tiebreakers, season),
  });
}

/** Senior own tiers of one country: split-aware final tables, conference tables and B-team ceilings. */
export async function countryPyramid(store: Store, countryId: number, season?: number): Promise<CountryPyramid> {
  const leagues = await store.all<League>(
    "SELECT * FROM leagues WHERE country_id = ? AND kind = 'league' AND age_group = 'Senior' AND tier > 0 AND coalesce(JSON_VALUE(data,'$.reserveOnly'),'false') NOT IN ('true','1') ORDER BY tier",
    countryId,
  );
  const ids = new Set(leagues.map((league) => league.id));
  const rows = (
    await store.all<Standing & { parent_id: number | null; club_data: string }>(
      "SELECT standings.*, clubs.parent_id, clubs.data AS club_data FROM standings JOIN clubs ON clubs.id = standings.club_id JOIN leagues ON leagues.id = standings.league_id WHERE leagues.country_id = ? AND leagues.kind = 'league'",
      countryId,
    )
  ).filter((row) => ids.has(row.league_id));
  const clubs = new Map<number, PyramidClub>();
  const reserveOf = (parentId: number | null, data: string) => {
    const pyramid = parentId ? JSON.parse(data).reservePolicy?.pyramid : undefined;
    return pyramid
      ? {
          reserve: {
            parentId: parentId!,
            highestTier: Number(pyramid.highestTier),
            minGapBelowParent: Number(pyramid.minGapBelowParent),
            ...(pyramid.maxPerTier ? { maxPerTier: Number(pyramid.maxPerTier) } : {}),
          },
        }
      : {};
  };
  for (const row of rows) clubs.set(row.club_id, { clubId: row.club_id, ...reserveOf(row.parent_id, row.club_data) });
  // Parked B-teams (no league place) come back to the league they left once their parent's division allows it.
  for (const row of await store.all<{ id: number; parent_id: number | null; data: string }>(
    "SELECT id,parent_id,data FROM clubs WHERE type = 'bteam' AND league_id IS NULL AND TRY_CONVERT(int, JSON_VALUE(data,'$.parkedLeagueId')) IN (SELECT id FROM leagues WHERE country_id = ?)",
    countryId,
  )) {
    const parkedLeagueId = Number(JSON.parse(row.data).parkedLeagueId);
    if (ids.has(parkedLeagueId)) clubs.set(row.id, { clubId: row.id, ...reserveOf(row.parent_id, row.data), parkedLeagueId });
  }
  const raw = new Map(leagues.map((league) => [league.tier, JSON.parse(league.data)]));
  const tiers: PyramidTier[] = [];
  for (const league of leagues) {
    const format = readLeagueData(raw.get(league.tier), league.tier, {
      above: raw.get(league.tier - 1),
      below: raw.get(league.tier + 1),
    });
    const table = rows.filter((row) => row.league_id === league.id);
    const options = { tiebreakers: format.tiebreakers, results: await headToHeadResults(store, league.id, format.tiebreakers, season) };
    tiers.push({
      leagueId: league.id,
      tier: league.tier,
      closed: format.closed,
      movementDown: format.movementDown,
      table: rankTable(table, format.split, options).map((row) => row.club_id),
      ...(format.conferences && !format.split
        ? {
            conferenceTables: format.conferences.map((name) =>
              rankTable(table.filter((row) => row.group_name === name), undefined, options).map((row) => row.club_id),
            ),
          }
        : {}),
    });
  }
  if (season !== undefined)
    for (const row of await store.all<{ data: string }>(
      "SELECT data FROM leagues WHERE kind = 'cup' AND country_id = ? AND JSON_VALUE(data,'$.key') = 'title' AND TRY_CONVERT(int, JSON_VALUE(data,'$.season')) = ?",
      countryId,
      season,
    )) {
      const playoff = JSON.parse(row.data) as PlayoffData;
      const champion =
        playoff.champion ?? (playoff.state ? resolvePlayoffBySeed(playoff.state).winners[0] : undefined);
      const tier = tiers.find((entry) => entry.leagueId === playoff.leagueId);
      if (tier && champion !== undefined) tier.champion = champion;
    }
  return { leagues, tiers, clubs };
}

interface SeasonPlan {
  season: number;
  baseRounds: number;
  splitDates: string[];
  /** Reserved dates of a round-robin title play-off. */
  titleDates: string[];
  splitDone?: boolean;
}

/** Title and movement play-offs (kind "cup", phase "playoff"); `key` is `title` or a league-rules boundary key. */
export interface PlayoffData {
  /** Always true: tells play-offs apart from domestic cups (both are kind "cup"). */
  playoff: true;
  phase: "playoff" | "complete";
  season: number;
  key: string;
  leagueId: number;
  state?: PlayoffState;
  miniLeague?: number[];
  champion?: number;
  spec: CompetitionSpec;
}

const nextPostseasonDate = (season: number, date: string) =>
  postseasonDates(season, date)[0] ?? addDays(date, 3);

async function openPlayoff(
  store: Store,
  name: string,
  country: Country,
  season: number,
  playoff: Pick<PlayoffData, "key" | "leagueId" | "state" | "miniLeague">,
  teams: number,
) {
  const existing = await store.get<League>(
    "SELECT * FROM leagues WHERE name = ? AND country_id = ? AND kind = 'cup'",
    name,
    country.id,
  );
  if (existing && Number(JSON.parse(existing.data).season) === season) return null;
  const data: PlayoffData = {
    ...playoff,
    playoff: true,
    phase: "playoff",
    season,
    spec: {
      name,
      confederation: country.confederation,
      age: "Senior",
      kind: "cup",
      teams,
      format: playoff.miniLeague ? "Groups" : "Knockout",
      rounds: playoff.miniLeague ? 1 : Math.ceil(Math.log2(Math.max(2, teams))),
      qualifies: 1,
      start: "05-20",
    },
  };
  let id = existing?.id;
  if (id) {
    await store.run("DELETE FROM standings WHERE league_id = ?", id);
    await store.run("UPDATE leagues SET data = ? WHERE id = ?", JSON.stringify(data), id);
  } else {
    id = Number(
      (
        await store.run(
          "INSERT INTO leagues(name, country_id, confederation, tier, age_group, kind, reputation, format, data) VALUES (?, ?, ?, 0, 'Senior', 'cup', ?, ?, ?)",
          name,
          country.id,
          country.confederation,
          country.reputation,
          playoff.miniLeague ? "Round-robin play-off" : "Play-off",
          JSON.stringify(data),
        )
      ).lastInsertRowid,
    );
  }
  fixtureBatches.get(store)?.ages.set(id, "Senior");
  return id;
}

async function schedulePlayoffRound(
  store: Store,
  competitionId: number,
  season: number,
  date: string,
  state: PlayoffState,
) {
  const round = state.pending!;
  const stage = knockoutStage(round.pairs.length * 2, round.final);
  for (const [index, [better, worse]] of round.pairs.entries()) {
    const tie: KnockoutTie = {
      version: 1,
      legs: round.legs,
      extraTime: true,
      awayGoals: false,
      neutral: round.neutral,
      id: `${season}:${competitionId}:${state.round}:${index}`,
      leg: 1,
    };
    const first = await addFixture(
      store,
      competitionId,
      season,
      date,
      round.legs === 2 ? worse : better,
      round.legs === 2 ? better : worse,
      stage,
      state.round + 1,
      "",
      { tie },
    );
    if (round.legs === 2)
      await addFixture(store, competitionId, season, addDays(first!, 3), better, worse, stage, state.round + 1, "", {
        tie: { ...tie, leg: 2 },
      });
  }
}

/** Advances domestic play-offs round by round; mini-leagues finish when every match is played. */
async function progressPlayoffs(store: Store, season: number, date: string) {
  for (const competition of await store.all<League>(
    "SELECT * FROM leagues WHERE kind = 'cup' AND JSON_VALUE(data,'$.phase') = 'playoff' AND TRY_CONVERT(int, JSON_VALUE(data,'$.season')) = ? ORDER BY id",
    season,
  )) {
    const data = JSON.parse(competition.data) as PlayoffData;
    const fixtures = await store.all<Fixture>(
      "SELECT * FROM fixtures WHERE league_id = ? AND season = ? ORDER BY round, id",
      competition.id,
      season,
    );
    if (fixtures.some((fixture) => fixture.status === "scheduled")) continue;
    let next: PlayoffData;
    if (data.miniLeague) {
      const table = await store.all<Standing>("SELECT * FROM standings WHERE league_id = ?", competition.id);
      next = { ...data, phase: "complete", champion: rankTable(table)[0]?.club_id };
    } else {
      const state = data.state!;
      const ties = new Map<string, Fixture[]>();
      for (const fixture of fixtures.filter((row) => row.round === state.round + 1)) {
        const id = String(JSON.parse(fixture.data).tie?.id);
        ties.set(id, [...(ties.get(id) ?? []), fixture]);
      }
      const winners = [...ties.values()].flatMap((legs) => knockoutWinner(legs) ?? []);
      const advanced = advancePlayoff(state, winners);
      if (advanced.pending)
        await withFixtureBatch(store, season, () =>
          schedulePlayoffRound(store, competition.id, season, nextPostseasonDate(season, date), advanced),
        );
      next = advanced.pending
        ? { ...data, state: advanced }
        : {
            ...data,
            state: advanced,
            phase: "complete",
            ...(advanced.kind === "championship" ? { champion: advanced.result?.winners[0] } : {}),
          };
    }
    await store.run("UPDATE leagues SET data = ? WHERE id = ?", JSON.stringify(next), competition.id);
  }
}

/** Split groups start once every base round is played: fixed group order, points kept or halved (rounded up). */
async function progressSplits(store: Store, season: number) {
  for (const league of await store.all<League>(
    "SELECT * FROM leagues WHERE kind = 'league' AND TRY_CONVERT(int, JSON_VALUE(data,'$.seasonPlan.season')) = ? AND JSON_VALUE(data,'$.seasonPlan.splitDone') IS NULL ORDER BY id",
    season,
  )) {
    const raw = JSON.parse(league.data);
    const plan = raw.seasonPlan as SeasonPlan;
    const format = readLeagueData(raw, league.tier);
    const unplayed = (await store.get<{ count: number }>(
      "SELECT count(*) AS count FROM fixtures WHERE league_id = ? AND season = ? AND status = 'scheduled' AND round <= ?",
      league.id,
      season,
      plan.baseRounds,
    ))!.count;
    if (unplayed || !format.split) continue;
    const table = await store.all<Standing>(
      "SELECT * FROM standings WHERE league_id = ?",
      league.id,
    );
    const points = new Map(table.map((row) => [row.club_id, row.points]));
    const ranked = await rankLeagueTable(store, league, table, season);
    await withFixtureBatch(store, season, async () => {
      for (const group of planSplit(ranked, format.split!)) {
        for (const clubId of group.clubs)
          await store.run(
            "UPDATE standings SET group_name = ?, points = ? WHERE league_id = ? AND club_id = ?",
            group.name,
            group.points === "halved" ? halvedPoints(points.get(clubId)!) : points.get(clubId)!,
            league.id,
            clubId,
          );
        for (const [round, pairs] of baseSchedule([group.clubs], group.roundRobins).entries())
          for (const [home, away] of pairs)
            await addFixture(
              store,
              league.id,
              season,
              plan.splitDates[round],
              home,
              away,
              "League",
              plan.baseRounds + round + 1,
              group.name,
            );
      }
    });
    await store.run(
      "UPDATE leagues SET data = ? WHERE id = ?",
      JSON.stringify({ ...raw, seasonPlan: { ...plan, splitDone: true } }),
      league.id,
    );
  }
}

const SENIOR_TIERS =
  "kind = 'league' AND age_group = 'Senior' AND tier > 0 AND coalesce(JSON_VALUE(data,'$.reserveOnly'),'false') NOT IN ('true','1')";
const UNPLAYED =
  "(SELECT count(*) FROM fixtures WHERE fixtures.league_id = leagues.id AND fixtures.season = ? AND fixtures.status = 'scheduled')";
const regularSeasonOver = (league: League & { unplayed: number }, season: number) => {
  const plan = JSON.parse(league.data).seasonPlan as SeasonPlan | undefined;
  return !league.unplayed && (!JSON.parse(league.data).split || (plan?.season === season && plan.splitDone));
};

/** Title play-off of one league: seeded by the final table (per conference when set); mini-leagues use reserved dates. */
async function openTitlePlayoff(store: Store, league: League, season: number, date: string) {
  const raw = JSON.parse(league.data);
  const championship = readLeagueData(raw, league.tier).championship!;
  const country = (await store.get<Country>("SELECT * FROM countries WHERE id = ?", league.country_id))!;
  const tier = (await countryPyramid(store, country.id)).tiers.find((entry) => entry.leagueId === league.id);
  if (!tier) return;
  const [from, to] = championship.positions;
  const groups = championship.perConference && tier.conferenceTables
    ? tier.conferenceTables.map((table) => table.slice(from - 1, to))
    : [tier.table.slice(from - 1, to)];
  const seeds = tier.table.filter((clubId) => groups.some((group) => group.includes(clubId)));
  const name = `${league.name} Play-offs`;
  if (championship.format === "round-robin") {
    const id = await openPlayoff(store, name, country, season, { key: "title", leagueId: league.id, miniLeague: seeds }, seeds.length);
    if (!id) return;
    for (const clubId of seeds)
      await store.run("INSERT INTO standings(league_id, club_id, group_name) VALUES (?, ?, 'Play-offs')", id, clubId);
    const reserved = (raw.seasonPlan as SeasonPlan | undefined)?.titleDates ?? [];
    const fallback = postseasonDates(season, date);
    for (const [round, pairs] of baseSchedule([seeds], championship.roundRobins ?? 2).entries())
      for (const [home, away] of pairs)
        await addFixture(store, id, season, reserved[round] ?? fallback[round] ?? addDays(date, 3 * (round + 1)), home, away, "League", round + 1, "Play-offs");
    return;
  }
  const state = createPlayoff({
    kind: "championship",
    legs: championship.legs,
    finalLegs: championship.finalLegs,
    neutralFinal: championship.neutralFinal,
    seeds,
    ...(groups.length > 1 ? { groups } : {}),
  });
  const id = await openPlayoff(store, name, country, season, { key: "title", leagueId: league.id, state }, seeds.length);
  if (id && state.pending) await schedulePlayoffRound(store, id, season, nextPostseasonDate(season, date), state);
}

/** Movement play-off names: promotion play-offs belong to the lower league, play-outs and cross-tier ties to the upper. */
const movementPlayoffName = (spec: PlayoffInput["kind"], upper: League, lower: League, suffix: string) =>
  spec === "promotion"
    ? `${lower.name} Promotion Play-offs${suffix}`
    : spec === "relegation"
      ? `${upper.name} Relegation Play-out${suffix}`
      : `${upper.name} Relegation Play-offs${suffix}`;

/** Title play-offs as soon as a league's regular season ends; movement play-offs once every senior tier of the country has. */
async function startPostseason(store: Store, season: number, date: string) {
  for (const league of await store.all<League & { unplayed: number }>(
    `SELECT leagues.*, ${UNPLAYED} AS unplayed FROM leagues WHERE ${SENIOR_TIERS} AND JSON_VALUE(data,'$.championship.legs') IS NOT NULL AND coalesce(TRY_CONVERT(int, JSON_VALUE(data,'$.titleSeason')), 0) < ? AND EXISTS (SELECT 1 FROM fixtures WHERE fixtures.league_id = leagues.id AND fixtures.season = ?) ORDER BY id`,
    season,
    season,
    season,
  )) {
    if (!regularSeasonOver(league, season)) continue;
    await withFixtureBatch(store, season, () => openTitlePlayoff(store, league, season, date));
    await store.run(
      "UPDATE leagues SET data = ? WHERE id = ?",
      JSON.stringify({ ...JSON.parse(league.data), titleSeason: season }),
      league.id,
    );
  }
  if (date < `${season + 1}-04-01`) return;
  const pending = await store.all<League & { unplayed: number }>(
    `SELECT leagues.*, ${UNPLAYED} AS unplayed FROM leagues WHERE ${SENIOR_TIERS} AND coalesce(TRY_CONVERT(int, JSON_VALUE(data,'$.postseason')), 0) < ? ORDER BY country_id, tier`,
    season,
    season,
  );
  const countries = new Map<number, (League & { unplayed: number })[]>();
  for (const league of pending)
    countries.set(league.country_id!, [...(countries.get(league.country_id!) ?? []), league]);
  for (const [countryId, leagues] of countries) {
    const byTier = new Map(leagues.map((league) => [league.tier, league]));
    const over = (tier: number) => {
      const league = byTier.get(tier);
      return !league || regularSeasonOver(league, season);
    };
    // A boundary's play-offs start once the tables they read are final (promotion: lower, play-out: upper).
    const ready = new Set<number>();
    for (const league of leagues) {
      const playoffs = readLeagueData(league.data, league.tier).movementDown?.playoffs ?? [];
      if (!playoffs.length || Number(JSON.parse(league.data).postseasonDown) === season) continue;
      const needsUpper = playoffs.some((playoff) => playoff.type !== "promotion");
      const needsLower = playoffs.some((playoff) => playoff.type !== "relegation");
      if ((!needsUpper || over(league.tier)) && (!needsLower || over(league.tier + 1))) ready.add(league.tier);
    }
    const allOver = leagues.every((league) => regularSeasonOver(league, season));
    if (!ready.size && !allOver) continue;
    const awaitingFinal = await store.get<{ id: number }>(
      "SELECT TOP 1 leagues.id FROM leagues WHERE country_id = ? AND kind = 'league' AND JSON_VALUE(data,'$.movementUp.championPromoted') = 'true' AND NOT EXISTS (SELECT 1 FROM leagues AS playoff WHERE playoff.kind = 'cup' AND playoff.country_id = leagues.country_id AND JSON_VALUE(playoff.data,'$.key') = 'title' AND TRY_CONVERT(int, JSON_VALUE(playoff.data,'$.leagueId')) = leagues.id AND TRY_CONVERT(int, JSON_VALUE(playoff.data,'$.season')) = ? AND JSON_VALUE(playoff.data,'$.phase') = 'complete')",
      countryId,
      season,
    );
    if (awaitingFinal) continue;
    const country = (await store.get<Country>("SELECT * FROM countries WHERE id = ?", countryId))!;
    const pyramid = ready.size ? await countryPyramid(store, countryId, season) : undefined;
    const byId = new Map(pyramid?.leagues.map((league) => [league.id, league]) ?? []);
    if (pyramid)
    await withFixtureBatch(store, season, async () => {
      for (const boundary of planBoundaries(pyramid))
        for (const plan of ready.has(boundary.upper) ? boundary.playoffs : []) {
          const upper = byId.get(plan.upperLeagueId)!;
          const lower = byId.get(plan.lowerLeagueId)!;
          const side = readLeagueData(lower.data, lower.tier).conferences ?? readLeagueData(upper.data, upper.tier).conferences;
          const suffix = plan.conference !== undefined && side?.[plan.conference]
            ? ` (${side[plan.conference]})`
            : plan.index > 0 ? ` ${plan.index + 1}` : "";
          const state = createPlayoff(plan.input);
          const id = await openPlayoff(
            store,
            movementPlayoffName(plan.input.kind, upper, lower, suffix),
            country,
            season,
            { key: boundaryKey(plan.upper, plan.index, plan.conference), leagueId: upper.id, state },
            state.seeds.length,
          );
          if (id && state.pending) await schedulePlayoffRound(store, id, season, nextPostseasonDate(season, date), state);
        }
    });
    for (const league of leagues)
      if (allOver || ready.has(league.tier))
        await store.run(
          "UPDATE leagues SET data = ? WHERE id = ?",
          JSON.stringify({
            ...JSON.parse(league.data),
            ...(ready.has(league.tier) ? { postseasonDown: season } : {}),
            ...(allOver ? { postseason: season } : {}),
          }),
          league.id,
        );
  }
}

/**
 * Youth groups that do not end in a knockout: qualifying groups fill the finals (now, or next season's via
 * `carried`), and CONMEBOL's top teams play a round-robin final round whose leader is champion. False otherwise.
 */
async function progressYouthGroups(
  store: Store,
  league: League,
  data: CompetitionData,
  table: Standing[],
  season: number,
  date: string,
) {
  const spec = data.spec!;
  const youth = YOUTH_TOURNAMENTS.find((item) => item.id === spec.youth);
  if (!youth) return false;
  const groupNames = [...new Set(table.map((row) => row.group_name))];
  const byGroup = (group: string) => table.filter((row) => row.group_name === group).map((row) => row.club_id);
  if (data.qualificationFor) {
    const rows = new Map(table.map((row) => [row.club_id, row]));
    const advancers = qualifyingAdvancers(
      groupNames.map(byGroup),
      (clubId) => {
        const row = rows.get(clubId)!;
        return { points: row.points, difference: row.gf - row.ga, scored: row.gf };
      },
      data.slots ?? 1,
    );
    await setData(store, league.id, { ...data, phase: "complete", qualified: advancers });
    const main = (await store.get<League>("SELECT * FROM leagues WHERE id = ?", data.qualificationFor))!;
    const mainData: CompetitionData = JSON.parse(main.data);
    const forSeason = Number(data.forSeason ?? season);
    if (forSeason > season) await setData(store, main.id, { ...mainData, carried: { season: forSeason, teams: advancers } });
    else await setupMainCompetition(store, main.id, [...(mainData.direct ?? []), ...advancers], mainData.spec!, season, addDays(date, 3));
    return true;
  }
  if (!youth.finalRound) return false;
  if (!data.finalRound) {
    const perGroup = Math.ceil(youth.finalRound / Math.max(1, groupNames.length));
    const finalists = groupNames.flatMap((group) => byGroup(group).slice(0, perGroup)).slice(0, youth.finalRound);
    await store.run(
      "UPDATE standings SET group_name = N'Final round', played = 0, wins = 0, draws = 0, losses = 0, gf = 0, ga = 0, points = 0, xg = 0, xga = 0, xpts = 0, form = N'', home_record = N'0-0-0', away_record = N'0-0-0' WHERE league_id = ? AND club_id IN (SELECT [id] FROM OPENJSON(?) WITH ([id] INT '$'))",
      league.id,
      JSON.stringify(finalists),
    );
    await withFixtureBatch(store, season, async () => {
      for (const [index, pairs] of roundrobin(finalists.length, finalists).entries())
        for (const [home, away] of pairs)
          await addFixture(store, league.id, season, addDays(date, 3 * (index + 1)), home, away, "Final round", spec.rounds + index + 1, "Final round");
    });
    await setData(store, league.id, { ...data, finalRound: true });
    return true;
  }
  const leader = table.find((row) => row.group_name === "Final round");
  if (!leader) return false;
  const champion = (await store.get<Club>("SELECT * FROM clubs WHERE id = ?", leader.club_id))!;
  await setData(store, league.id, { ...data, phase: "complete", champion: champion.id, championName: champion.name });
  await store.run(
    "INSERT INTO history(season, entity_type, entity_id, date, data) VALUES (?, ?, ?, ?, ?)",
    season,
    "champion",
    league.id,
    date,
    JSON.stringify({ clubId: champion.id, name: champion.name, competition: league.name }),
  );
  return true;
}

export async function progressCompetitions(store: Store, date: string) {
  const state = await store.meta<GameState>("state");
  await progressSplits(store, state.season);
  await progressPlayoffs(store, state.season, date);
  await startPostseason(store, state.season, date);
  for (const league of await store.all<League>(
    "SELECT * FROM leagues WHERE country_id IS NULL AND JSON_VALUE(data, '$.catalogQualifying') = 'true' AND JSON_VALUE(data, '$.phase') = 'knockout' ORDER BY id",
  ))
    await progressQualifying(store, league, state.season, date);
  for (const league of await store.all<League>(
    "SELECT * FROM leagues WHERE country_id IS NULL AND JSON_VALUE(data, '$.phase') = 'awaiting qualifiers' AND JSON_VALUE(data, '$.spec.catalog.id') IS NOT NULL ORDER BY id",
  ))
    await tryStartMain(store, league.id, state.season, date);
  for (const league of await store.all<League>(
    "SELECT * FROM leagues WHERE kind != 'league' AND JSON_VALUE(data, '$.phase') IN ('groups', 'knockout') AND JSON_VALUE(data, '$.catalogQualifying') IS NULL ORDER BY id",
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
    if (spec.catalog) {
      const round = matches.filter((fixture) => fixture.round === matches[0].round);
      const alive =
        data.phase === "groups"
          ? spec.qualifies + ((data.knockoutEntrants as number[] | undefined)?.length ?? 0)
          : new Set(round.flatMap((fixture) => [fixture.home_id, fixture.away_id])).size / 2 +
            (data.pendingByes?.length ?? 0) +
            (data.playoffByes?.length ?? 0);
      nextDate =
        cadenceRoundDate(spec.catalog.id, date, state.season, alive, data.phase === "groups" && Boolean(spec.catalog.byes)) ??
        continentalRoundDate(date, state.season, alive);
    } else if (spec.cupPlan) {
      const planned = spec.cupPlan.dates[matches[0].round];
      nextDate = planned && planned > addDays(date, 3) ? planned : addDays(date, 3);
    } else if (league.kind === "cup" && spec.cupFormat && spec.teams <= 4)
      // Super cups (Supercopa, Supercoppa): the final follows the semi-finals within days.
      nextDate = addDays(date, 3);
    else if (league.kind === "continental")
      while (internationalBreak(nextDate)) nextDate = addDays(nextDate, 7);
    if (spec.national && spec.age === "Senior")
      while (!internationalBreak(nextDate)) nextDate = addDays(nextDate, 1);
    if (data.phase === "groups") {
      const table = await store.all<Standing>(
        "SELECT * FROM standings WHERE league_id = ? ORDER BY points DESC, (gf-ga) DESC, gf DESC, club_id",
        league.id,
      );
      if (spec.youth && (await progressYouthGroups(store, league, data, table, state.season, date))) continue;
      const catalog = spec.catalog;
      if (catalog) {
        // Wait for clubs still to arrive: Libertadores 3rd places (Sudamericana) and UYL Domestic Champions Path winners.
        const feeders = CONTINENTAL.competitions.filter(
          (item) => !item.feeder && item.feeds?.some((feed) => feed.to === catalog.id),
        );
        let waiting = false;
        for (const item of feeders) {
          const source = await leagueNamed(store, item.name);
          const sourceData = source && (JSON.parse(source.data) as CompetitionData);
          if (
            sourceData?.season === state.season &&
            ["awaiting qualifiers", "groups"].includes(sourceData.phase ?? "") &&
            !sourceData.fed
          )
            waiting = true;
        }
        for (const id of catalog.mirrors ? (data.qualifiers ?? []) : []) {
          const qualifying = await store.get<League>("SELECT * FROM leagues WHERE id = ?", id);
          if (qualifying && JSON.parse(qualifying.data).phase !== "complete") waiting = true;
        }
        if (waiting) continue;
      }
      const groups = [...new Set(table.map((entry) => entry.group_name))];
      const byGroup = (group: string) => table.filter((entry) => entry.group_name === group).map((entry) => entry.club_id);
      if (catalog && !catalog.feeder)
        for (const feed of catalog.feeds ?? []) {
          const target = catalogById(feed.to);
          const main = target && (await leagueNamed(store, target.name));
          if (!main) continue;
          const mainData: CompetitionData = JSON.parse(main.data);
          const fed = groups.flatMap((group) => byGroup(group).slice(feed.positions[0] - 1, feed.positions[1]));
          await setData(store, main.id, { ...mainData, feedIns: [...((mainData.feedIns as number[]) ?? []), ...fed] });
        }
      if (catalog) await setData(store, league.id, { ...data, fed: true });
      let qualified: number[] = [];
      const byes = catalog
        ? (catalog.byes ?? 0)
        : table.length >= 24 && spec.confederation === "UEFA" && spec.age === "Senior"
          ? 8
          : 0;
      // Small worlds: a play-off round needs two clubs; otherwise every qualifier goes straight into the knockout.
      if (spec.format === "Swiss" && !catalog?.zones && byes && table.slice(byes, catalog?.advance ?? 24).length >= 2) {
        // League phase: 1st–8th skip the knockout play-offs, 9th–24th play them.
        await scheduleKnockout(
          store,
          league.id,
          table.slice(byes, catalog?.advance ?? 24).map((entry) => entry.club_id),
          state.season,
          nextDate,
          spec.rounds + 1,
          { playoffByes: table.slice(0, byes).map((entry) => entry.club_id) },
        );
        continue;
      }
      if (spec.format === "Groups" && byes) {
        // Group winners skip the knockout play-offs; runners-up meet the clubs fed in from another competition.
        const winners = groups.map((group) => byGroup(group)[0]).filter((id) => id !== undefined);
        const playoff = [...groups.map((group) => byGroup(group)[1]), ...((data.feedIns as number[]) ?? [])].filter(
          (id) => id !== undefined,
        );
        if (playoff.length >= 2)
          await scheduleKnockout(store, league.id, playoff, state.season, nextDate, spec.rounds + 1, {
            playoffByes: winners,
          });
        else if (winners.length + playoff.length >= 2)
          await scheduleKnockout(store, league.id, [...winners, ...playoff], state.season, nextDate, spec.rounds + 1);
        continue;
      }
      if (spec.format === "Swiss" && !catalog?.zones) {
        const target = Math.min(
          spec.qualifies,
          2 ** Math.floor(Math.log2(table.length)),
        );
        qualified = table.slice(0, catalog?.advance ?? target).map((entry) => entry.club_id);
      } else {
        const perGroup = Math.floor(spec.qualifies / groups.length);
        for (const group of groups) qualified.push(...byGroup(group).slice(0, perGroup));
        const extras = table
          .filter((entry) => !qualified.includes(entry.club_id))
          .slice(0, Math.max(0, spec.qualifies - qualified.length));
        qualified.push(...extras.map((entry) => entry.club_id));
        if (
          catalog?.zones &&
          groups.length === 2 &&
          perGroup % 2 === 0 &&
          groups.every((group) => byGroup(group).length >= perGroup)
        ) {
          // Seed order so that the first knockout round pairs 1st v 8th, 2nd v 7th… inside each zone.
          const [first, second] = groups.map((group) => byGroup(group).slice(0, perGroup));
          qualified = [
            ...first.slice(0, perGroup / 2).flatMap((clubId, index) => [clubId, second[index]]),
            ...first.slice(perGroup / 2).flatMap((clubId, index) => [second[perGroup / 2 + index], clubId]),
          ];
        }
      }
      qualified.push(...((data.knockoutEntrants as number[]) ?? []));
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
    winners.unshift(...(data.pendingByes ?? []));
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
      if (spec.catalog?.feeder) {
        // Final order (champion, finalist, then by round reached and phase table) feeds next season's Champions Cup.
        const reached = new Map<number, number>();
        for (const fixture of matches)
          for (const clubId of [fixture.home_id, fixture.away_id])
            reached.set(clubId, Math.max(reached.get(clubId) ?? 0, fixture.round));
        const phaseRank = new Map(
          (
            await store.all<Standing>(
              "SELECT * FROM standings WHERE league_id = ? ORDER BY points DESC, (gf-ga) DESC, gf DESC, club_id",
              league.id,
            )
          ).map((row, index) => [row.club_id, index]),
        );
        const order = [...reached.keys()].sort(
          (left, right) =>
            Number(right === champion.id) - Number(left === champion.id) ||
            reached.get(right)! - reached.get(left)! ||
            (phaseRank.get(left) ?? 999) - (phaseRank.get(right) ?? 999),
        );
        await store.run(
          "INSERT INTO history(season, entity_type, entity_id, date, data) VALUES (?, ?, ?, ?, ?)",
          state.season,
          "league",
          league.id,
          date,
          JSON.stringify({
            table: order.map((club_id, index) => ({ club_id, position: index + 1 })),
            champion: champion.id,
            competition: league.name,
          }),
        );
      }
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
