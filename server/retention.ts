import type { Store } from "./db.ts";
import { quoteIdentifier, sqlLiteral, tableName } from "./sql-schema.ts";
import type { GameState, MatchResult, MatchSnapshot } from "../shared/types.ts";

/** Per-world storage budgets (decision 11). CI flags anything above them. */
export const FOOTPRINT_BUDGET = Object.freeze({
  initialMB: 1600,
  seasonMB: 300,
  checkpointMB: 300,
});

export interface RetentionResult {
  players: number;
  fixtures: number;
  rows: number;
}

export interface TableFootprint {
  table: string;
  rows: number;
  reservedMB: number;
  usedMB: number;
}

export interface SchemaFootprint {
  schema: string;
  rows: number;
  reservedMB: number;
  usedMB: number;
  /** World tables only: what a new career or a season adds. */
  worldMB: number;
  /** Saved snapshots (save_slots and save_chunks). */
  savesMB: number;
  tables: TableFootprint[];
}

const PRUNE_BATCH = 5000;
const PRUNE_LIMIT = 60_000;
const COMPACT_BATCH = 100;
/** Fixtures smaller than this hold no replay detail worth compacting. */
const COMPACT_MIN_BYTES = 8000;
const HOME_BASED_PROTECTED_AGE = 36;
const TERMINAL_STAGES = "'Completed', 'Rejected', 'Withdrawn', 'Expired', 'Hijacked'";
const DETAIL_KEYS = new Set(["snapshot", "players", "momentum", "events", "substitutions", "injuries", "stats", "actions"]);
const PLAYER_TABLES = [
  "reports",
  "assignments",
  "discipline",
  "player_assets",
  "registration_records",
  "player_registrations",
  "competition_registrations",
  "minor_applications",
  "player_season_stats",
  "player_match_appearances",
  "promises",
  "player_honours",
  "player_injuries",
  "player_milestones",
];
const KEPT_APPEARANCES = "pg_temp.touchline_kept_appearances";

/** A JSON text value as an integer, NULL when it is not a whole number. */
const jsonInteger = (expression: string) =>
  `(CASE WHEN ${expression} ~ '^-?[0-9]+$' THEN (${expression})::integer END)`;

/** Result metadata and a scorers summary; drops the snapshot, events, ratings and momentum that replays need. */
export function compactMatchData(payload: Record<string, unknown>): Record<string, unknown> {
  if (payload.compact === true) return payload;
  const snapshot = payload.snapshot as Partial<MatchSnapshot> | undefined;
  const names = new Map<number, string>();
  for (const team of [snapshot?.home, snapshot?.away])
    for (const player of [...(team?.lineup ?? []), ...(team?.bench ?? [])])
      names.set(player.id, player.name);
  const events = Array.isArray(payload.events) ? (payload.events as MatchResult["events"]) : [];
  return {
    ...Object.fromEntries(Object.entries(payload).filter(([key]) => !DETAIL_KEYS.has(key))),
    scorers: events
      .filter((event) => event.type === "goal")
      .map((event) => ({
        minute: event.minute,
        ...(event.addedTime ? { addedTime: event.addedTime } : {}),
        teamId: event.teamId,
        playerId: event.playerId,
        ...(names.has(event.playerId) ? { name: names.get(event.playerId) } : {}),
      })),
    compact: true,
  };
}

/** Full match data is kept only for fixtures the user follows (decision 11). */
export function storedMatchData(payload: Record<string, unknown>, detailed: boolean): string {
  return JSON.stringify(detailed ? payload : compactMatchData(payload));
}

export function storedAppearanceStats(stats: Record<string, number>, detailed: boolean): string {
  return detailed ? JSON.stringify(stats) : "{}";
}


const DOOMED = "= ANY(?::int[])";
const PRUNED_ROWS = [
  "deleted_payments",
  "deleted_buy_backs",
  "deleted_clauses",
  "deleted_negotiations",
  "deleted_loans",
  ...PLAYER_TABLES.map((table) => `deleted_${table}`),
  "deleted_appearance_history",
  "deleted_relationships",
];

/**
 * One batch of leavers in one statement. Every data-modifying CTE sees the snapshot taken before the statement, so the
 * career summary still reads the season stats a sibling CTE deletes, and foreign keys are checked once, at its end.
 * Each `= ANY(?::int[])` gets the id array, so the planner sees its length and uses the player_id indexes.
 */
const pruneBatch = `
  WITH input AS (SELECT ?::integer AS season, ?::text AS date),
  negotiation_ids AS (SELECT id FROM negotiations WHERE player_id ${DOOMED}),
  loan_ids AS (SELECT id FROM loans WHERE player_id ${DOOMED}),
  clause_ids AS (
    SELECT id FROM sell_on_clauses WHERE player_id ${DOOMED} OR source_loan_id IN (SELECT id FROM loan_ids)
  ),
  summaries AS (
    INSERT INTO history (season, entity_type, entity_id, date, data)
    SELECT input.season, 'careerSummary', player.id, input.date, jsonb_strip_nulls(jsonb_build_object(
      'name', player.name, 'position', player.position, 'nationality', player.nationality,
      'countryId', player.country_id, 'birthDate', player.birth_date,
      'reason', player.profile::jsonb #>> '{retirement,reason}',
      'lastSeason', ${jsonInteger("player.profile::jsonb #>> '{retirement,season}'")},
      'appearances', career.appearances, 'minutes', career.minutes,
      'goals', career.goals, 'assists', career.assists, 'clubs', spells.clubs
    ))::text
    FROM players AS player
    CROSS JOIN input
    CROSS JOIN LATERAL (
      SELECT sum(stat.appearances) AS appearances, sum(stat.minutes) AS minutes,
        sum(stat.goals) AS goals, sum(stat.assists) AS assists
      FROM player_season_stats AS stat WHERE stat.player_id = player.id
    ) AS career
    CROSS JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('clubId', spell.club_id, 'club', spell.club, 'from', spell.first,
          'to', spell.last, 'appearances', spell.appearances, 'goals', spell.goals)
        ORDER BY spell.first, spell.club_id) AS clubs
      FROM (
        SELECT stat.club_id, club.name AS club, min(stat.season) AS first, max(stat.season) AS last,
          sum(stat.appearances) AS appearances, sum(stat.goals) AS goals
        FROM player_season_stats AS stat LEFT JOIN clubs AS club ON club.id = stat.club_id
        WHERE stat.player_id = player.id
        GROUP BY stat.club_id, club.name ORDER BY min(stat.season), stat.club_id LIMIT 12
      ) AS spell
    ) AS spells
    WHERE player.id ${DOOMED}
    ORDER BY player.id
    RETURNING 1
  ),
  deleted_payments AS (
    DELETE FROM transfer_payments WHERE player_id ${DOOMED}
      OR negotiation_id IN (SELECT id FROM negotiation_ids) OR sell_on_clause_id IN (SELECT id FROM clause_ids)
    RETURNING 1
  ),
  deleted_buy_backs AS (
    DELETE FROM buy_back_clauses WHERE player_id ${DOOMED} OR negotiation_id IN (SELECT id FROM negotiation_ids)
    RETURNING 1
  ),
  deleted_clauses AS (DELETE FROM sell_on_clauses WHERE id IN (SELECT id FROM clause_ids) RETURNING 1),
  deleted_negotiations AS (DELETE FROM negotiations WHERE id IN (SELECT id FROM negotiation_ids) RETURNING 1),
  deleted_loans AS (DELETE FROM loans WHERE id IN (SELECT id FROM loan_ids) RETURNING 1),
  ${PLAYER_TABLES.map((table) => `deleted_${table} AS (DELETE FROM ${table} WHERE player_id ${DOOMED} RETURNING 1)`).join(",\n  ")},
  deleted_appearance_history AS (
    DELETE FROM history WHERE entity_type = 'appearance' AND entity_id ${DOOMED} RETURNING 1
  ),
  deleted_relationships AS (
    DELETE FROM relationships WHERE (source_type = 'player' AND source_id ${DOOMED})
      OR (target_type = 'player' AND target_id ${DOOMED})
    RETURNING 1
  ),
  deleted_players AS (DELETE FROM players WHERE id ${DOOMED} RETURNING 1)
  SELECT (SELECT count(*) FROM deleted_players) AS players,
    ${PRUNED_ROWS.map((name) => `(SELECT count(*) FROM ${name})`).join(" + ")} AS rows`;
const PRUNE_ID_PARAMETERS = pruneBatch.split(DOOMED).length - 1;

export type AppearancePruning = "auto" | "delete" | "rebuild";

/**
 * Finished seasons keep appearance rows for the user's teams only; season totals live in player_season_stats.
 * Usually almost every row goes (a finished season of every club against the user's few). Then the kept rows are copied
 * to a temporary table and the table is truncated and refilled: WAL is written only for the kept rows, the space is freed
 * at once and autovacuum has no dead tuples to clean. When most rows stay, a plain DELETE writes less.
 * TRUNCATE locks the table until commit, which the season rollover's world writer lock already implies.
 */
export async function pruneAppearances(
  store: Store,
  finishedSeason: number,
  userClubs: readonly number[],
  strategy: AppearancePruning = "auto",
): Promise<number> {
  if (!Number.isSafeInteger(finishedSeason) || !userClubs.every(Number.isSafeInteger))
    throw new Error("Appearance pruning needs an integer season and club ids.");
  const counts = (await store.get<{ total: number; kept: number }>(
    `SELECT count(*) AS total, count(*) FILTER (WHERE season > ? OR club_id = ANY(?::int[])) AS kept
     FROM player_match_appearances`,
    finishedSeason,
    userClubs,
  ))!;
  const removed = counts.total - counts.kept;
  if (!removed) return 0;
  const appearances = tableName(store.schemaName, "player_match_appearances");
  const rebuild = strategy === "rebuild" || (strategy === "auto" && counts.kept * 2 < counts.total &&
    (await store.get<{ allowed: boolean }>("SELECT has_table_privilege(?::text, 'TRUNCATE') AS allowed", appearances))
      ?.allowed === true);
  if (rebuild) {
    const columns = (await store.columns("player_match_appearances")).map(quoteIdentifier).join(", ");
    // One multi-statement call (integers checked above) keeps the temporary table on one connection.
    await store.exec(`DROP TABLE IF EXISTS ${KEPT_APPEARANCES};
      CREATE TEMP TABLE touchline_kept_appearances ON COMMIT DROP AS
        SELECT ${columns} FROM ${appearances}
        WHERE season > ${finishedSeason} OR club_id = ANY(${sqlLiteral(`{${userClubs.join(",")}}`)}::int[]);
      TRUNCATE TABLE ${appearances};
      INSERT INTO ${appearances} (${columns}) SELECT ${columns} FROM ${KEPT_APPEARANCES};
      DROP TABLE ${KEPT_APPEARANCES};`);
  } else
    await store.run(
      "DELETE FROM player_match_appearances WHERE season <= ? AND club_id <> ALL(?::int[])",
      finishedSeason,
      userClubs,
    );
  // The row count changed by most of the table: refresh planner statistics now rather than after autovacuum's naptime.
  await store.exec(`ANALYZE ${appearances};`);
  return removed;
}

/**
 * Season-end retention, called once at the end of seasonRollover. Leavers are pruned one season after they
 * were marked (profile.retirement.season < finishedSeason) and leave a history 'careerSummary'; finished
 * seasons keep compact non-user fixtures and aggregated (player_season_stats) non-user appearances.
 */
export async function pruneSeason(
  store: Store,
  finishedSeason: number,
  date: string,
): Promise<RetentionResult> {
  return store.transaction(async () => {
    const state = await store.meta<GameState>("state");
    const userClubs = (await store.all<{ id: number }>(
      "SELECT id FROM clubs WHERE id = ? OR parent_id = ?",
      state.clubId,
      state.clubId,
    )).map((club) => club.id);
    // Leavers retired by older code carry no marker; stamp them so they are pruned next season.
    await store.run(
      `UPDATE players SET profile = jsonb_set(profile::jsonb, '{retirement}', ?::jsonb)::text
       WHERE role = 'Retired' AND club_id IS NULL
         AND COALESCE(jsonb_typeof(profile::jsonb -> 'retirement'), 'null') NOT IN ('object', 'array')`,
      JSON.stringify({ season: finishedSeason, date, reason: "retired" }),
    );
    // The highest id is never pruned: insertPlayers allocates MAX(id) + 1, so ids are never reused.
    const leavers = (await store.all<{ id: number }>(
      `SELECT player.id FROM players AS player
       WHERE player.role = 'Retired' AND player.club_id IS NULL AND player.parent_club_id IS NULL
         AND player.id < (SELECT MAX(id) FROM players)
         AND ${jsonInteger("player.profile::jsonb #>> '{retirement,season}'")} < ?
         AND NOT (player.profile::jsonb #>> '{homeBased,countryId}' IS NOT NULL AND player.age < ${HOME_BASED_PROTECTED_AGE})
         AND NOT EXISTS (SELECT 1 FROM transfer_payments AS payment WHERE payment.player_id = player.id AND payment.paid_date IS NULL)
         AND NOT EXISTS (SELECT 1 FROM sell_on_clauses AS clause WHERE clause.player_id = player.id AND clause.status IN ('active', 'triggered'))
         AND NOT EXISTS (SELECT 1 FROM buy_back_clauses AS clause WHERE clause.player_id = player.id AND clause.status = 'active')
         AND NOT EXISTS (SELECT 1 FROM loans AS loan WHERE loan.player_id = player.id AND loan.status = 'active')
         AND NOT EXISTS (SELECT 1 FROM negotiations AS negotiation WHERE negotiation.player_id = player.id AND negotiation.stage NOT IN (${TERMINAL_STAGES}))
         AND NOT EXISTS (SELECT 1 FROM player_assets AS asset WHERE asset.player_id = player.id AND asset.status = 'active')
         AND NOT EXISTS (SELECT 1 FROM promises AS promise WHERE promise.player_id = player.id AND promise.status = 'active')
         AND NOT EXISTS (SELECT 1 FROM minor_applications AS application WHERE application.player_id = player.id AND application.status = 'pending')
       ORDER BY player.id
       LIMIT ${PRUNE_LIMIT}`,
      finishedSeason,
    )).map((row) => row.id);
    let players = 0;
    let rows = 0;
    for (let offset = 0; offset < leavers.length; offset += PRUNE_BATCH) {
      const ids = leavers.slice(offset, offset + PRUNE_BATCH);
      const result = await store.get<{ players: number; rows: number }>(
        pruneBatch,
        finishedSeason,
        date,
        ...Array.from({ length: PRUNE_ID_PARAMETERS }, () => ids),
      );
      players += Number(result?.players ?? 0);
      rows += Number(result?.rows ?? 0);
    }
    let fixtures = 0;
    for (let after = 0; ; ) {
      const batch = await store.all<{ id: number; data: string }>(
        `SELECT id, data FROM fixtures
         WHERE id > ? AND season <= ? AND status = 'played' AND octet_length(data) > ${COMPACT_MIN_BYTES}
           AND home_id <> ALL(?::int[]) AND away_id <> ALL(?::int[])
         ORDER BY id
         LIMIT ${COMPACT_BATCH}`,
        after,
        finishedSeason,
        userClubs,
        userClubs,
      );
      if (!batch.length) break;
      after = batch.at(-1)!.id;
      const compacted = batch.flatMap((row) => {
        const data = JSON.parse(row.data) as Record<string, unknown>;
        return data.snapshot || data.events
          ? [{ id: row.id, data: JSON.stringify(compactMatchData(data)) }]
          : [];
      });
      if (compacted.length)
        fixtures += (await store.run(
          `UPDATE fixtures AS target SET data = changes.data
           FROM unnest(?::int[], ?::text[]) AS changes(id, data) WHERE changes.id = target.id`,
          compacted.map((row) => row.id),
          compacted.map((row) => row.data),
        )).changes;
    }
    rows += await pruneAppearances(store, finishedSeason, userClubs);
    rows += (await store.run(
      `DELETE FROM history WHERE entity_type = 'appearance' AND season < ? AND id < (SELECT MAX(id) FROM history)
         AND NOT EXISTS (SELECT 1 FROM loans WHERE loans.player_id = history.entity_id
           AND loans.status = 'active' AND loans.start_date <= history.date)`,
      finishedSeason,
    )).changes;
    rows += (await store.run(
      "DELETE FROM news WHERE date < ? AND id < (SELECT MAX(id) FROM news)",
      `${finishedSeason}-07-01`,
    )).changes;
    const result = { players, fixtures, rows };
    await store.setMeta("lastRetention", { season: finishedSeason, date, ...result });
    return result;
  });
}

const megabytes = (bytes: number | null) => Math.round((Number(bytes ?? 0) / 1048576) * 10) / 10;

/**
 * On-disk size per table (heap, TOAST, indexes and maps) from the catalog; needs no extra privilege.
 * Rows are the statistics collector's live-tuple count (the planner estimate before the first statistics);
 * used space scales the size by the live share of tuples, so dead tuples awaiting vacuum show as reserved only.
 */
export async function databaseFootprint(
  store: Store,
  schemas: string[] = [store.schemaName],
): Promise<SchemaFootprint[]> {
  const footprints: SchemaFootprint[] = [];
  for (const schema of schemas) {
    const tables = (await store.all<{ table: string; rows: number; reserved: number; used: number }>(
      `SELECT relation.relname AS "table", tuples.live AS rows, sizes.total AS reserved,
         CASE WHEN tuples.live + tuples.dead > 0 THEN sizes.total * tuples.live / (tuples.live + tuples.dead)
           ELSE sizes.total END AS used
       FROM pg_catalog.pg_class AS relation
       JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       LEFT JOIN pg_catalog.pg_stat_all_tables AS stats ON stats.relid = relation.oid
       CROSS JOIN LATERAL (SELECT pg_total_relation_size(relation.oid) AS total) AS sizes
       CROSS JOIN LATERAL (SELECT COALESCE(stats.n_live_tup, GREATEST(relation.reltuples, 0)::bigint) AS live,
         COALESCE(stats.n_dead_tup, 0) AS dead) AS tuples
       WHERE namespace.nspname = ? AND relation.relkind IN ('r', 'p')
       ORDER BY sizes.total DESC, relation.relname`,
      schema,
    )).map((row): TableFootprint => ({
      table: row.table,
      rows: Number(row.rows),
      reservedMB: megabytes(row.reserved),
      usedMB: megabytes(row.used),
    }));
    const sum = (items: TableFootprint[], key: "rows" | "reservedMB" | "usedMB") =>
      Math.round(items.reduce((total, item) => total + item[key], 0) * 10) / 10;
    const saves = tables.filter((table) => ["save_slots", "save_chunks"].includes(table.table));
    const world = tables.filter((table) => !saves.includes(table) && table.table !== "schema_migrations");
    footprints.push({
      schema,
      rows: sum(tables, "rows"),
      reservedMB: sum(tables, "reservedMB"),
      usedMB: sum(tables, "usedMB"),
      worldMB: sum(world, "reservedMB"),
      savesMB: sum(saves, "reservedMB"),
      tables,
    });
  }
  return footprints;
}

/** Size of the whole database and, for pg_monitor members, of the write-ahead log directory. */
export async function databaseSpace(store: Store) {
  const { dataBytes, monitor } = (await store.get<{ dataBytes: number; monitor: boolean }>(
    `SELECT pg_database_size(current_database()) AS "dataBytes",
       pg_has_role(current_user, 'pg_monitor', 'USAGE') AS monitor`,
  ))!;
  const wal = monitor
    ? (await store.get<{ bytes: number | null }>("SELECT sum(size) AS bytes FROM pg_ls_waldir()"))?.bytes ?? 0
    : null;
  return { dataMB: megabytes(dataBytes), walMB: wal === null ? null : megabytes(wal) };
}
