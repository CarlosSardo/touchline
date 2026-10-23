import type { Store } from "./db.ts";
import { playerOf } from "./systems.ts";
import { addDays, ageOn, daysBetween, START_DATE } from "../shared/rules.ts";
import type { GameState } from "../shared/types.ts";
import type {
  HonourKind,
  InjurySeverity,
  MilestoneKind,
  PlayerHistoryClub,
  PlayerHonour,
  PlayerInjury,
  PlayerMedical,
  PlayerMilestone,
} from "../shared/api.ts";

/**
 * Player records: honours (from the competitions' champion history), injury history (recorded where injuries are
 * created) and career milestones (from appearances and season statistics). Older worlds are backfilled once.
 */
const META = "playerRecords";
const VERSION = 1;
interface RecordsMeta {
  version: number;
  /** Champion/league history rows up to this id have been turned into honours. */
  historyId: number;
  /** Fixtures played up to this date have been checked for milestones. */
  milestonesThrough: string;
}

// ------------------------------------------------------------------ injuries

export type InjuryContext = "match" | "training";
export interface NewInjury {
  playerId: number;
  start: string;
  days: number;
  context: InjuryContext;
  fixtureId?: number;
  /** The team he was playing for (a national team on duty), when it is not his club. */
  teamId?: number;
}

export const injurySeverity = (days: number): InjurySeverity =>
  days <= 7 ? "minor" : days <= 28 ? "moderate" : days <= 90 ? "serious" : "long-term";

const INJURY_KINDS: Record<InjurySeverity, Record<InjuryContext, readonly string[]>> = {
  minor: {
    match: ["Knock", "Dead leg", "Bruised ankle", "Minor muscle strain", "Bruised ribs"],
    training: ["Muscle tightness", "Ankle knock", "Back spasm", "Minor muscle strain"],
  },
  moderate: {
    match: ["Hamstring strain", "Ankle sprain", "Calf strain", "Groin strain", "Knee sprain", "Thigh strain"],
    training: ["Hamstring strain", "Calf strain", "Groin strain", "Adductor strain", "Back strain"],
  },
  serious: {
    match: ["Torn hamstring", "Ankle ligament damage", "Medial ligament injury", "Broken metatarsal", "Dislocated shoulder"],
    training: ["Torn calf muscle", "Stress fracture", "Torn hamstring", "Ankle ligament damage"],
  },
  "long-term": {
    match: ["Cruciate ligament rupture", "Broken leg", "Achilles tendon rupture", "Cartilage damage"],
    training: ["Achilles tendon rupture", "Cruciate ligament rupture", "Cartilage damage", "Chronic back injury"],
  },
};

/** Deterministic (no simulation randomness consumed): the same injury always gets the same diagnosis. */
export function injuryKind(injury: Pick<NewInjury, "playerId" | "start" | "days" | "context">) {
  const options = INJURY_KINDS[injurySeverity(injury.days)][injury.context];
  let hash = 2166136261;
  for (const char of `${injury.playerId}:${injury.start}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return options[(hash >>> 0) % options.length];
}

/** One statement: each injury with its diagnosis, severity and expected return, for the player's club of the day. */
export async function recordInjuries(store: Store, injuries: readonly NewInjury[]) {
  for (let offset = 0; offset < injuries.length; offset += 5000) {
    const batch = injuries.slice(offset, offset + 5000);
    await store.run(
      `INSERT INTO player_injuries (player_id, club_id, start_date, end_date, kind, severity, data)
       SELECT injury.player_id, players.club_id, injury.start_date, injury.end_date, injury.kind, injury.severity, injury.data
       FROM unnest(?::integer[], ?::text[], ?::text[], ?::text[], ?::text[], ?::text[])
         AS injury(player_id, start_date, end_date, kind, severity, data)
       JOIN players ON players.id = injury.player_id`,
      batch.map((injury) => injury.playerId),
      batch.map((injury) => injury.start),
      batch.map((injury) => addDays(injury.start, injury.days)),
      batch.map((injury) => injuryKind(injury)),
      batch.map((injury) => injurySeverity(injury.days)),
      batch.map((injury) =>
        JSON.stringify({
          context: injury.context,
          days: injury.days,
          ...(injury.fixtureId ? { fixtureId: injury.fixtureId } : {}),
          ...(injury.teamId ? { teamId: injury.teamId } : {}),
        }),
      ),
    );
  }
}

/** Rehabilitation brought these players' return forward: their open injury ends on the new date. */
export async function shortenInjuries(store: Store, date: string, returns: readonly { id: number; until: string }[]) {
  if (!returns.length) return;
  await store.run(
    `UPDATE player_injuries AS injury SET end_date = changes.until
     FROM unnest(?::integer[], ?::text[]) AS changes(id, until)
     WHERE injury.player_id = changes.id AND injury.end_date > ?`,
    returns.map((entry) => entry.id),
    returns.map((entry) => entry.until),
    date,
  );
}

// ------------------------------------------------------------------ honours

const jsonInt = (expression: string) => `(CASE WHEN (${expression}) ~ '^[0-9]+$' THEN (${expression})::integer END)`;

/**
 * Winners of the history rows in (from, to]: cups, continental and international tournaments ('champion' rows) and
 * league titles ('league' archives of league competitions; a title play-off winner is stored as its champion).
 */
const WON = `won AS (
  SELECT DISTINCT ON (history.season, leagues.id) history.season, leagues.id AS league_id, leagues.name, leagues.kind,
    leagues.age_group, leagues.tier, history.date,
    CASE WHEN history.entity_type = 'champion' THEN ${jsonInt("history.data::jsonb ->> 'clubId'")}
      ELSE coalesce(${jsonInt("history.data::jsonb ->> 'champion'")}, ${jsonInt("history.data::jsonb #>> '{table,0,club_id}'")}) END AS club_id
  FROM history JOIN leagues ON leagues.id = history.entity_id
  WHERE history.entity_type IN ('champion', 'league') AND history.id > ? AND history.id <= ?
    AND (history.entity_type = 'champion' OR leagues.kind = 'league')
  ORDER BY history.season, leagues.id, history.id DESC
)`;

/**
 * Honours for every player who appeared for the winners in the competition that season. In-season (and at the
 * rollover, before pruning) every appearance row still exists; the one-off backfill reads the season statistics.
 */
async function recordHonours(store: Store, from: number, to: number, source: "appearances" | "season stats") {
  if (to <= from) return;
  const squad =
    source === "appearances"
      ? `SELECT won.season, won.league_id, won.club_id, appearance.player_id, count(*) AS appearances,
           sum(appearance.minutes) AS minutes
         FROM won JOIN player_match_appearances AS appearance ON appearance.club_id = won.club_id AND appearance.season = won.season
         JOIN fixtures ON fixtures.id = appearance.fixture_id AND fixtures.league_id = won.league_id
         WHERE appearance.minutes > 0 GROUP BY won.season, won.league_id, won.club_id, appearance.player_id`
      : `SELECT won.season, won.league_id, won.club_id, stats.player_id, stats.appearances, stats.minutes
         FROM won JOIN player_season_stats AS stats
           ON stats.season = won.season AND stats.club_id = won.club_id AND stats.league_id = won.league_id
         WHERE stats.appearances > 0`;
  await store.run(
    `WITH ${WON},
     matches AS (
       SELECT won.season, won.league_id, won.club_id, count(fixtures.id) AS matches
       FROM won JOIN fixtures ON fixtures.league_id = won.league_id AND fixtures.season = won.season
         AND fixtures.status = 'played' AND won.club_id IN (fixtures.home_id, fixtures.away_id)
       GROUP BY won.season, won.league_id, won.club_id
     ),
     squad AS (${squad})
     INSERT INTO player_honours (player_id, season, club_id, league_id, kind, title, data)
     SELECT squad.player_id, won.season, won.club_id, won.league_id,
       CASE WHEN clubs.type = 'national' THEN CASE WHEN clubs.age_group = 'Senior' THEN 'international' ELSE 'youthInternational' END
         WHEN won.kind = 'league' THEN 'league' WHEN won.kind = 'continental' THEN 'continental' ELSE 'cup' END,
       won.name,
       jsonb_build_object('ageGroup', won.age_group, 'tier', won.tier, 'date', won.date,
         'appearances', squad.appearances, 'minutes', squad.minutes, 'matches', matches.matches,
         'role', CASE WHEN matches.matches IS NULL OR squad.appearances * 2 >= matches.matches THEN 'regular'
           WHEN squad.appearances * 5 >= matches.matches THEN 'squad' ELSE 'fringe' END)::text
     FROM won JOIN squad ON squad.season = won.season AND squad.league_id = won.league_id AND squad.club_id = won.club_id
     JOIN clubs ON clubs.id = won.club_id
     LEFT JOIN matches ON matches.season = won.season AND matches.league_id = won.league_id AND matches.club_id = won.club_id
     ON CONFLICT (player_id, season, kind, COALESCE(league_id, 0), COALESCE(club_id, 0)) DO NOTHING`,
    from,
    to,
  );
}

// ------------------------------------------------------------------ milestones

export const MILESTONE_THRESHOLDS = {
  appearances: [50, 100, 150, 200, 250, 300, 400, 500, 600, 700, 800, 900, 1000],
  clubAppearances: [100, 200, 300, 400, 500, 600, 700],
  goals: [50, 100, 150, 200, 250, 300, 400, 500],
  caps: [25, 50, 75, 100, 125, 150, 175, 200],
} as const;

type Line = "club" | "cap" | "youthCap";
/** Senior club competitions, senior national team, youth national teams (debuts only). */
const lineOf = (club: string, league: string) =>
  `CASE WHEN ${club}.type = 'national' THEN CASE WHEN ${club}.age_group = 'Senior' THEN 'cap' ELSE 'youthCap' END
    WHEN ${league}.age_group = 'Senior' THEN 'club' END`;

/** One appearance (window pass) or one season-statistics row (backfill of finished seasons) of a candidate. */
export interface MilestoneUnit {
  player_id: number;
  club_id: number;
  line: Line;
  fixture_id: number | null;
  date: string;
  estimated: boolean;
  season: number;
  league_id: number;
  competition: string;
  apps: number;
  goals: number;
  /** Before the first unit of this player and line (club: of this club), from all recorded statistics. */
  line_before: number;
  goals_before: number;
  club_before: number;
  /** No senior club / international career before the world began (young enough, no pre-game minutes). */
  fresh: boolean;
  fresh_intl: boolean;
  /** He joined this club during the game (a transfer, loan or squad move into it). */
  joined: boolean;
}
export interface MilestoneRow {
  player_id: number;
  date: string;
  kind: MilestoneKind;
  club_id: number | null;
  value: number | null;
  data: string;
}

const crossed = (thresholds: readonly number[], before: number, after: number) =>
  thresholds.filter((value) => value > before && value <= after);

/** Pure: milestones reached by the units (ordered by player, line, date), given the counts before them. */
export function detectMilestones(units: readonly MilestoneUnit[]): MilestoneRow[] {
  const rows: MilestoneRow[] = [];
  let key = "";
  let lineApps = 0;
  let lineGoals = 0;
  const clubApps = new Map<number, number>();
  for (const unit of units) {
    const groupKey = `${unit.player_id}:${unit.line}`;
    if (groupKey !== key) {
      key = groupKey;
      lineApps = unit.line_before;
      lineGoals = unit.goals_before;
      clubApps.clear();
    }
    if (!clubApps.has(unit.club_id)) clubApps.set(unit.club_id, unit.club_before);
    const emit = (kind: MilestoneKind, value: number | null = null) =>
      rows.push({
        player_id: unit.player_id,
        date: unit.date,
        kind,
        club_id: unit.club_id,
        value,
        data: JSON.stringify({
          leagueId: unit.league_id,
          competition: unit.competition,
          season: unit.season,
          ...(unit.fixture_id ? { fixtureId: unit.fixture_id } : {}),
          ...(unit.estimated ? { dateEstimated: true } : {}),
        }),
      });
    const appsBefore = lineApps;
    const goalsBefore = lineGoals;
    const clubBefore = clubApps.get(unit.club_id)!;
    lineApps += unit.apps;
    lineGoals += unit.goals;
    clubApps.set(unit.club_id, clubBefore + unit.apps);
    if (unit.apps <= 0) continue;
    if (unit.line === "club") {
      const clubKnown = unit.fresh || unit.joined;
      if (unit.fresh && appsBefore === 0) emit("seniorDebut");
      else if (clubKnown && clubBefore === 0) emit("clubDebut");
      if (unit.fresh) {
        for (const value of crossed(MILESTONE_THRESHOLDS.appearances, appsBefore, lineApps)) emit("appearances", value);
        if (goalsBefore === 0 && lineGoals > 0) emit("firstGoal");
        for (const value of crossed(MILESTONE_THRESHOLDS.goals, goalsBefore, lineGoals)) emit("goals", value);
      }
      if (clubKnown)
        for (const value of crossed(MILESTONE_THRESHOLDS.clubAppearances, clubBefore, clubBefore + unit.apps))
          emit("clubAppearances", value);
    } else if (unit.fresh_intl) {
      if (unit.line === "youthCap") {
        if (clubBefore === 0) emit("internationalDebut");
        continue;
      }
      if (appsBefore === 0) emit("internationalDebut");
      for (const value of crossed(MILESTONE_THRESHOLDS.caps, appsBefore, lineApps)) emit("caps", value);
      if (goalsBefore === 0 && lineGoals > 0) emit("firstInternationalGoal");
    }
  }
  return rows;
}

/** Pre-game ledger rows (gbe.ts): months 13-24 of the comma-separated data are minutes played, zeros left empty. */
const PLAYED = "array_to_string((string_to_array(ledger.data, ','))[13:24], '') <> ''";

const thresholdCheck = (before: string, after: string, parameter: string) =>
  `EXISTS (SELECT 1 FROM unnest(${parameter}) AS threshold(value) WHERE threshold.value > ${before} AND threshold.value <= ${after})`;

type MilestoneScope = { kind: "window"; from: string; to: string } | { kind: "seasons"; before: number };

/** The scope's units: one row per appearance (window) or per season-statistics row (finished seasons). */
const scopeUnits = (scope: MilestoneScope, players: string) =>
  scope.kind === "window"
    ? `SELECT appearance.player_id, appearance.club_id, appearance.fixture_id, appearance.date, false AS estimated,
         appearance.season, 1 AS apps, appearance.goals, fixtures.league_id, leagues.name AS competition,
         ${lineOf("clubs", "leagues")} AS line
       FROM player_match_appearances AS appearance JOIN fixtures ON fixtures.id = appearance.fixture_id
       JOIN leagues ON leagues.id = fixtures.league_id JOIN clubs ON clubs.id = appearance.club_id
       WHERE ${players} fixtures.status = 'played' AND fixtures.date > ?::text AND fixtures.date <= ?::text AND appearance.minutes > 0`
    : `SELECT stats.player_id, stats.club_id, NULL::integer AS fixture_id, (stats.season + 1) || '-06-30' AS date,
         true AS estimated, stats.season, stats.appearances AS apps, stats.goals, stats.league_id,
         leagues.name AS competition, ${lineOf("clubs", "leagues")} AS line
       FROM player_season_stats AS stats JOIN leagues ON leagues.id = stats.league_id JOIN clubs ON clubs.id = stats.club_id
       WHERE ${players} stats.season < ?::integer AND stats.appearances > 0`;
const scopeParams = (scope: MilestoneScope) => (scope.kind === "window" ? [scope.from, scope.to] : [scope.before]);

interface MilestoneCounts {
  player_id: number;
  club_id: number;
  line: Line;
  line_before: number;
  goals_before: number;
  club_before: number;
  fresh: boolean;
  fresh_intl: boolean;
  joined: boolean;
}

/**
 * The scope's units of players and lines where a debut or a threshold can fall, with their counts before. One
 * aggregate (window functions, no joins between estimated sets) finds the few candidates; their units come after.
 */
async function milestoneUnits(store: Store, scope: MilestoneScope, youngFrom: string): Promise<MilestoneUnit[]> {
  // Window: all-time totals from the season statistics (which already hold the window); seasons: the units are all.
  const totals =
    scope.kind === "window"
      ? `SELECT stats.player_id, stats.club_id, ${lineOf("clubs", "leagues")} AS line, stats.appearances AS apps,
           stats.goals, 0 AS window_apps, 0 AS window_goals
         FROM player_season_stats AS stats JOIN leagues ON leagues.id = stats.league_id JOIN clubs ON clubs.id = stats.club_id
         WHERE stats.player_id = ANY(ARRAY(SELECT DISTINCT player_id FROM lined))
         UNION ALL SELECT player_id, club_id, line, 0, 0, apps, goals FROM lined`
      : "SELECT player_id, club_id, line, apps, goals, apps AS window_apps, goals AS window_goals FROM lined";
  const counts = await store.all<MilestoneCounts>(
    `WITH lined AS MATERIALIZED (SELECT * FROM (${scopeUnits(scope, "")}) AS units WHERE line IS NOT NULL),
     per_club AS (
       SELECT player_id, club_id, line, sum(apps) AS club_after, sum(goals) AS club_goals,
         sum(window_apps) AS club_window, sum(window_goals) AS club_window_goals
       FROM (${totals}) AS combined WHERE line IS NOT NULL GROUP BY player_id, club_id, line
     ),
     counts AS (
       SELECT player_id, club_id, line, club_window, club_after - club_window AS club_before, club_after,
         sum(club_after) OVER line_group - sum(club_window) OVER line_group AS line_before,
         sum(club_after) OVER line_group AS line_after,
         sum(club_goals) OVER line_group - sum(club_window_goals) OVER line_group AS goals_before,
         sum(club_goals) OVER line_group AS goals_after
       FROM per_club WINDOW line_group AS (PARTITION BY player_id, line)
     ),
     events AS (
       SELECT counts.*,
         counts.club_before = 0
           OR (counts.line = 'club' AND ${thresholdCheck("counts.club_before", "counts.club_after", "?::integer[]")}) AS club_event,
         counts.line <> 'youthCap' AND (counts.line_before = 0
           OR ${thresholdCheck("counts.line_before", "counts.line_after", "CASE WHEN counts.line = 'club' THEN ?::integer[] ELSE ?::integer[] END")}
           OR (counts.goals_before = 0 AND counts.goals_after > 0)
           OR (counts.line = 'club' AND ${thresholdCheck("counts.goals_before", "counts.goals_after", "?::integer[]")})) AS career_event
       FROM counts WHERE counts.club_window > 0
     ),
     candidates AS (
       SELECT events.*, bool_or(events.club_event OR events.career_event) OVER (PARTITION BY events.player_id, events.line) AS wanted
       FROM events
     )
     SELECT candidates.player_id, candidates.club_id, candidates.line, candidates.line_before, candidates.goals_before,
       candidates.club_before,
       (SELECT birth_date FROM players WHERE players.id = candidates.player_id) > ?::text AND NOT EXISTS (
         SELECT 1 FROM player_minutes_monthly AS ledger WHERE ledger.player_id = candidates.player_id AND ledger.estimated
           AND ledger.kind IN ('league', 'cup', 'continental', 'qualifying') AND ${PLAYED}) AS fresh,
       (SELECT birth_date FROM players WHERE players.id = candidates.player_id) > ?::text AND NOT EXISTS (
         SELECT 1 FROM player_minutes_monthly AS ledger WHERE ledger.player_id = candidates.player_id AND ledger.estimated
           AND ledger.kind = 'international' AND ${PLAYED}) AS fresh_intl,
       CASE WHEN candidates.line = 'club' AND candidates.club_event THEN EXISTS (
         SELECT 1 FROM history WHERE history.entity_type IN ('transfer', 'loan', 'squad') AND history.entity_id = candidates.player_id
           AND candidates.club_id::text IN (history.data::jsonb ->> 'to', history.data::jsonb ->> 'toClubId'))
         -- Loans started outside the market (affiliate and sister-club pathways, the director's own) have no history row.
         OR EXISTS (SELECT 1 FROM loans WHERE loans.player_id = candidates.player_id AND loans.destination_id = candidates.club_id)
         ELSE false END AS joined
     FROM candidates WHERE candidates.wanted`,
    ...scopeParams(scope),
    MILESTONE_THRESHOLDS.clubAppearances,
    MILESTONE_THRESHOLDS.appearances,
    MILESTONE_THRESHOLDS.caps,
    MILESTONE_THRESHOLDS.goals,
    youngFrom,
    youngFrom,
  );
  const lines = new Map(counts.map((row) => [`${row.player_id}:${row.line}`, row]));
  const clubs = new Map(counts.map((row) => [`${row.player_id}:${row.club_id}:${row.line}`, row]));
  const players = [
    ...new Set(counts.filter((row) => row.fresh || row.fresh_intl || row.joined).map((row) => row.player_id)),
  ];
  if (!players.length) return [];
  const units = await store.all<Omit<MilestoneUnit, keyof MilestoneCounts | "fixture_id"> & Pick<MilestoneCounts, "player_id" | "club_id" | "line"> & { fixture_id: number | null }>(
    `SELECT * FROM (${scopeUnits(scope, "%PLAYERS%")}) AS units WHERE line IS NOT NULL
     ORDER BY player_id, line, date, season, fixture_id, club_id, league_id`.replace(
      "%PLAYERS%",
      `${scope.kind === "window" ? "appearance" : "stats"}.player_id = ANY(?::integer[]) AND`,
    ),
    players,
    ...scopeParams(scope),
  );
  return units.flatMap((unit) => {
    const line = lines.get(`${unit.player_id}:${unit.line}`);
    const club = clubs.get(`${unit.player_id}:${unit.club_id}:${unit.line}`);
    if (!line || !club) return [];
    return [
      {
        ...unit,
        line_before: Number(line.line_before),
        goals_before: Number(line.goals_before),
        club_before: Number(club.club_before),
        fresh: line.fresh,
        fresh_intl: line.fresh_intl,
        joined: club.joined,
      },
    ];
  });
}

async function insertMilestones(store: Store, rows: readonly MilestoneRow[]) {
  for (let offset = 0; offset < rows.length; offset += 5000) {
    const batch = rows.slice(offset, offset + 5000);
    await store.run(
      `INSERT INTO player_milestones (player_id, date, kind, club_id, value, data)
       SELECT * FROM unnest(?::integer[], ?::text[], ?::text[], ?::integer[], ?::integer[], ?::text[])
       ON CONFLICT (player_id, kind, COALESCE(club_id, 0), COALESCE(value, 0)) DO NOTHING`,
      batch.map((row) => row.player_id),
      batch.map((row) => row.date),
      batch.map((row) => row.kind),
      batch.map((row) => row.club_id),
      batch.map((row) => row.value),
      batch.map((row) => row.data),
    );
  }
}

/** Players born after this date were under 20 when the world began: their senior careers start in the game. */
async function youngFrom(store: Store) {
  const world = await store.get<{ value: string }>("SELECT value FROM meta WHERE key = 'world'");
  const generated = (world ? (JSON.parse(world.value) as { generated?: string }).generated : undefined) ?? START_DATE;
  return `${Number(generated.slice(0, 4)) - 20}${generated.slice(4, 10)}`;
}

async function recordMilestones(store: Store, from: string, to: string) {
  if (to <= from) return;
  await insertMilestones(store, detectMilestones(await milestoneUnits(store, { kind: "window", from, to }, await youngFrom(store))));
}

// ------------------------------------------------------------------ passes

const maxHistoryId = async (store: Store) =>
  (await store.get<{ id: number | null }>("SELECT max(id) AS id FROM history"))!.id ?? 0;

/**
 * Once per world (older worlds and saves): honours from every recorded champion, milestones of finished seasons
 * from the season statistics and of this season from its appearances, and the injuries running now.
 */
export async function ensurePlayerRecords(store: Store) {
  const state = await store.meta<GameState | undefined>("state").catch(() => undefined);
  if (!state) return;
  const present = await store.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", META);
  if (present && (JSON.parse(present.value) as RecordsMeta).version === VERSION) return;
  await store.transaction(() => backfill(store, state));
}

async function backfill(store: Store, state: GameState): Promise<RecordsMeta> {
  const historyId = await maxHistoryId(store);
  await recordHonours(store, 0, historyId, "season stats");
  const young = await youngFrom(store);
  await insertMilestones(store, detectMilestones(await milestoneUnits(store, { kind: "seasons", before: state.season }, young)));
  const seasonStart = await store.get<{ date: string | null }>(
    "SELECT min(date) AS date FROM fixtures WHERE season = ?",
    state.season,
  );
  if (seasonStart?.date)
    await insertMilestones(
      store,
      detectMilestones(
        await milestoneUnits(store, { kind: "window", from: addDays(seasonStart.date, -1), to: state.date }, young),
      ),
    );
  await store.run(
    `INSERT INTO player_injuries (player_id, club_id, start_date, end_date, kind, severity, data)
     SELECT id, club_id, ?, injury_until, 'Injury', CASE WHEN injury_until <= ? THEN 'minor' WHEN injury_until <= ? THEN 'moderate'
       WHEN injury_until <= ? THEN 'serious' ELSE 'long-term' END, '{"backfilled":true}'
     FROM players WHERE injury_until > ? AND role <> 'Retired'
       AND NOT EXISTS (SELECT 1 FROM player_injuries WHERE player_injuries.player_id = players.id AND player_injuries.end_date > ?)`,
    state.date,
    addDays(state.date, 7),
    addDays(state.date, 28),
    addDays(state.date, 90),
    state.date,
    state.date,
  );
  const meta: RecordsMeta = { version: VERSION, historyId, milestonesThrough: state.date };
  await store.setMeta(META, meta);
  return meta;
}

async function recordsMeta(store: Store) {
  const row = await store.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", META);
  const meta = row ? (JSON.parse(row.value) as RecordsMeta) : undefined;
  return meta?.version === VERSION ? meta : backfill(store, await store.meta<GameState>("state"));
}

/** After the day's matches and competition progress: new champions' honours and the day's milestones. */
export async function recordPlayerRecords(store: Store, date: string) {
  const meta = await recordsMeta(store);
  const historyId = await maxHistoryId(store);
  await recordHonours(store, meta.historyId, historyId, "appearances");
  await recordMilestones(store, meta.milestonesThrough, date);
  await store.setMeta(META, { ...meta, historyId, milestonesThrough: date > meta.milestonesThrough ? date : meta.milestonesThrough });
}

/** At the rollover, after the league tables are archived and before finished-season appearances are pruned. */
export async function recordSeasonHonours(store: Store) {
  const meta = await recordsMeta(store);
  const historyId = await maxHistoryId(store);
  await recordHonours(store, meta.historyId, historyId, "appearances");
  await store.setMeta(META, { ...meta, historyId });
}

// ------------------------------------------------------------------ reads

const HONOUR_ORDER: Record<HonourKind, number> = {
  international: 0,
  continental: 1,
  league: 2,
  cup: 3,
  youthInternational: 4,
};

/** A player's honours (newest first) and milestones (oldest first) for the history API. */
export async function playerRecords(store: Store, playerId: number, birthDate: string) {
  const honours = await store.all<{
    season: number;
    club_id: number | null;
    league_id: number | null;
    kind: HonourKind;
    title: string;
    data: string;
    club_name: string | null;
    club_color: string | null;
  }>(
    `SELECT player_honours.season, player_honours.club_id, player_honours.league_id, player_honours.kind, player_honours.title,
       player_honours.data, clubs.name AS club_name, clubs.color AS club_color
     FROM player_honours LEFT JOIN clubs ON clubs.id = player_honours.club_id WHERE player_honours.player_id = ?`,
    playerId,
  );
  const milestones = await store.all<{
    date: string;
    kind: MilestoneKind;
    club_id: number | null;
    value: number | null;
    data: string;
    club_name: string | null;
    club_color: string | null;
  }>(
    `SELECT player_milestones.date, player_milestones.kind, player_milestones.club_id, player_milestones.value,
       player_milestones.data, clubs.name AS club_name, clubs.color AS club_color
     FROM player_milestones LEFT JOIN clubs ON clubs.id = player_milestones.club_id WHERE player_milestones.player_id = ?`,
    playerId,
  );
  const club = (id: number | null, name: string | null, color: string | null): PlayerHistoryClub | null =>
    id === null ? null : { id, name: name ?? "Unknown club", color };
  return {
    honours: honours
      .map((row): PlayerHonour => {
        const data = JSON.parse(row.data) as Record<string, unknown>;
        const number = (value: unknown) => (typeof value === "number" ? value : null);
        return {
          season: row.season,
          kind: row.kind,
          title: row.title,
          club: club(row.club_id, row.club_name, row.club_color),
          competitionId: row.league_id,
          ageGroup: typeof data.ageGroup === "string" && data.ageGroup !== "Senior" ? data.ageGroup : null,
          appearances: number(data.appearances) ?? 0,
          matches: number(data.matches),
          role: data.role === "squad" || data.role === "fringe" ? data.role : "regular",
        };
      })
      .sort(
        (left, right) =>
          right.season - left.season ||
          HONOUR_ORDER[left.kind] - HONOUR_ORDER[right.kind] ||
          left.title.localeCompare(right.title),
      ),
    milestones: milestones
      .map((row): PlayerMilestone => {
        const data = JSON.parse(row.data) as Record<string, unknown>;
        return {
          kind: row.kind,
          value: row.value,
          date: row.date,
          dateEstimated: data.dateEstimated === true,
          season: typeof data.season === "number" ? data.season : Number(row.date.slice(0, 4)) - (row.date.slice(5) < "07" ? 1 : 0),
          club: club(row.club_id, row.club_name, row.club_color),
          competition: typeof data.competition === "string" ? data.competition : null,
          fixtureId: typeof data.fixtureId === "number" ? data.fixtureId : null,
          age: ageOn(birthDate, row.date),
        };
      })
      .sort((left, right) => left.date.localeCompare(right.date) || (left.value ?? 0) - (right.value ?? 0)),
  };
}

/** GET /api/players/:id/medical: the current injury and the recorded injury history, newest first. */
export async function playerMedical(store: Store, playerId: number): Promise<PlayerMedical> {
  const player = await playerOf(store, playerId);
  const state = await store.meta<GameState>("state");
  const rows = await store.all<{
    id: number;
    club_id: number | null;
    start_date: string;
    end_date: string | null;
    kind: string;
    severity: InjurySeverity;
    data: string;
    club_name: string | null;
    club_color: string | null;
  }>(
    `SELECT player_injuries.id, player_injuries.club_id, player_injuries.start_date, player_injuries.end_date, player_injuries.kind,
       player_injuries.severity, player_injuries.data, clubs.name AS club_name, clubs.color AS club_color
     FROM player_injuries LEFT JOIN clubs ON clubs.id = player_injuries.club_id
     WHERE player_injuries.player_id = ? ORDER BY player_injuries.start_date DESC, player_injuries.id DESC`,
    playerId,
  );
  const injuries = rows.map((row): PlayerInjury => {
    const data = JSON.parse(row.data) as Record<string, unknown>;
    const end = row.end_date;
    return {
      id: row.id,
      kind: row.kind,
      severity: row.severity,
      start: row.start_date,
      end,
      days: end ? Math.max(0, daysBetween(row.start_date, end)) : null,
      context: data.context === "match" || data.context === "training" ? data.context : null,
      club: row.club_id === null ? null : { id: row.club_id, name: row.club_name ?? "Unknown club", color: row.club_color },
      fixtureId: typeof data.fixtureId === "number" ? data.fixtureId : null,
      backfilled: data.backfilled === true,
      ongoing: !!end && end > state.date,
    };
  });
  const injuredUntil = player.injury_until && player.injury_until > state.date ? player.injury_until : null;
  const current = injuredUntil ? (injuries.find((entry) => entry.ongoing) ?? null) : null;
  const season = state.season;
  const inSeason = (date: string) => Number(date.slice(0, 4)) - (date.slice(5) < "07" ? 1 : 0) === season;
  const missed = (list: readonly PlayerInjury[]) =>
    list.reduce((sum, entry) => sum + (entry.end ? Math.max(0, daysBetween(entry.start, entry.end < state.date ? entry.end : state.date)) : 0), 0);
  const thisSeason = injuries.filter((entry) => inSeason(entry.start));
  return {
    playerId,
    today: state.date,
    injuredUntil,
    daysLeft: injuredUntil ? daysBetween(state.date, injuredUntil) : null,
    current,
    injuries,
    summary: {
      injuries: injuries.length,
      daysMissed: missed(injuries),
      seasonInjuries: thisSeason.length,
      seasonDaysMissed: missed(thisSeason),
    },
  };
}
