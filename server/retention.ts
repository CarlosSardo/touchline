import type { Store } from "./db.ts";
import { tableName } from "./sql-schema.ts";
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

const PRUNE_BATCH = 1000;
const PRUNE_LIMIT = 60_000;
const COMPACT_BATCH = 100;
const DELETE_BATCH = 20_000;
const HOME_BASED_PROTECTED_AGE = 36;
const TERMINAL_STAGES = "N'Completed', N'Rejected', N'Withdrawn', N'Expired', N'Hijacked'";
const DETAIL_KEYS = new Set(["snapshot", "players", "momentum", "events", "substitutions", "injuries", "stats", "actions"]);
const IDS = "SELECT [id] FROM OPENJSON(?) WITH ([id] INT '$')";
const PLAYER_TABLES = [
  "reports",
  "assignments",
  "discipline",
  "player_assets",
  "registration_records",
  "minor_applications",
  "player_season_stats",
  "player_match_appearances",
  "promises",
];

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

const pruneBatch = `
  DECLARE @ids TABLE ([id] INT NOT NULL PRIMARY KEY);
  INSERT INTO @ids ([id]) SELECT [id] FROM OPENJSON(?) WITH ([id] INT '$');
  DECLARE @negotiations TABLE ([id] INT NOT NULL PRIMARY KEY);
  INSERT INTO @negotiations ([id]) SELECT [id] FROM negotiations WHERE [player_id] IN (SELECT [id] FROM @ids);
  DECLARE @loans TABLE ([id] INT NOT NULL PRIMARY KEY);
  INSERT INTO @loans ([id]) SELECT [id] FROM loans WHERE [player_id] IN (SELECT [id] FROM @ids);
  DECLARE @clauses TABLE ([id] INT NOT NULL PRIMARY KEY);
  INSERT INTO @clauses ([id]) SELECT [id] FROM sell_on_clauses
    WHERE [player_id] IN (SELECT [id] FROM @ids) OR [source_loan_id] IN (SELECT [id] FROM @loans);
  DECLARE @rows INT = 0;
  INSERT INTO history ([season], [entity_type], [entity_id], [date], [data])
    SELECT ?, N'careerSummary', player.[id], ?, (
      SELECT player.[name] AS [name], player.[position] AS [position], player.[nationality] AS [nationality],
        player.[country_id] AS [countryId], player.[birth_date] AS [birthDate],
        JSON_VALUE(player.[profile], '$.retirement.reason') AS [reason],
        TRY_CONVERT(INT, JSON_VALUE(player.[profile], '$.retirement.season')) AS [lastSeason],
        career.[appearances] AS [appearances], career.[minutes] AS [minutes],
        career.[goals] AS [goals], career.[assists] AS [assists],
        JSON_QUERY((SELECT TOP (12) stat.[club_id] AS [clubId], club.[name] AS [club],
            MIN(stat.[season]) AS [from], MAX(stat.[season]) AS [to],
            SUM(stat.[appearances]) AS [appearances], SUM(stat.[goals]) AS [goals]
          FROM player_season_stats AS stat LEFT JOIN clubs AS club ON club.[id] = stat.[club_id]
          WHERE stat.[player_id] = player.[id]
          GROUP BY stat.[club_id], club.[name] ORDER BY MIN(stat.[season]), stat.[club_id]
          FOR JSON PATH)) AS [clubs]
      FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM players AS player
    OUTER APPLY (SELECT SUM(stat.[appearances]) AS [appearances], SUM(stat.[minutes]) AS [minutes],
        SUM(stat.[goals]) AS [goals], SUM(stat.[assists]) AS [assists]
      FROM player_season_stats AS stat WHERE stat.[player_id] = player.[id]) AS career
    WHERE player.[id] IN (SELECT [id] FROM @ids);
  DELETE FROM transfer_payments WHERE [player_id] IN (SELECT [id] FROM @ids)
    OR [negotiation_id] IN (SELECT [id] FROM @negotiations) OR [sell_on_clause_id] IN (SELECT [id] FROM @clauses);
  SET @rows += @@ROWCOUNT;
  DELETE FROM buy_back_clauses WHERE [player_id] IN (SELECT [id] FROM @ids) OR [negotiation_id] IN (SELECT [id] FROM @negotiations);
  SET @rows += @@ROWCOUNT;
  DELETE FROM sell_on_clauses WHERE [id] IN (SELECT [id] FROM @clauses);
  SET @rows += @@ROWCOUNT;
  DELETE FROM negotiations WHERE [id] IN (SELECT [id] FROM @negotiations);
  SET @rows += @@ROWCOUNT;
  DELETE FROM loans WHERE [id] IN (SELECT [id] FROM @loans);
  SET @rows += @@ROWCOUNT;
  ${PLAYER_TABLES.map((table) => `DELETE FROM ${table} WHERE [player_id] IN (SELECT [id] FROM @ids);
  SET @rows += @@ROWCOUNT;`).join("\n  ")}
  DELETE FROM history WHERE [entity_type] = N'appearance' AND [entity_id] IN (SELECT [id] FROM @ids);
  SET @rows += @@ROWCOUNT;
  DELETE FROM relationships WHERE ([source_type] = N'player' AND [source_id] IN (SELECT [id] FROM @ids))
    OR ([target_type] = N'player' AND [target_id] IN (SELECT [id] FROM @ids));
  SET @rows += @@ROWCOUNT;
  DELETE FROM players WHERE [id] IN (SELECT [id] FROM @ids);
  SELECT @@ROWCOUNT AS [players], @rows AS [rows];`;

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
    const userClubs = JSON.stringify(
      (await store.all<{ id: number }>(
        "SELECT [id] FROM clubs WHERE [id] = ? OR [parent_id] = ?",
        state.clubId,
        state.clubId,
      )).map((club) => club.id),
    );
    // Leavers retired by older code carry no marker; stamp them so they are pruned next season.
    await store.run(
      `UPDATE players SET [profile] = JSON_MODIFY([profile], '$.retirement', JSON_QUERY(?))
       WHERE [role] = N'Retired' AND [club_id] IS NULL AND JSON_QUERY([profile], '$.retirement') IS NULL`,
      JSON.stringify({ season: finishedSeason, date, reason: "retired" }),
    );
    // The highest id is never pruned: insertPlayers allocates MAX(id) + 1, so ids are never reused.
    const leavers = (await store.all<{ id: number }>(
      `SELECT TOP (${PRUNE_LIMIT}) player.[id] FROM players AS player
       WHERE player.[role] = N'Retired' AND player.[club_id] IS NULL AND player.[parent_club_id] IS NULL
         AND player.[id] < (SELECT MAX([id]) FROM players)
         AND TRY_CONVERT(INT, JSON_VALUE(player.[profile], '$.retirement.season')) < ?
         AND NOT (JSON_VALUE(player.[profile], '$.homeBased.countryId') IS NOT NULL AND player.[age] < ${HOME_BASED_PROTECTED_AGE})
         AND NOT EXISTS (SELECT 1 FROM transfer_payments AS payment WHERE payment.[player_id] = player.[id] AND payment.[paid_date] IS NULL)
         AND NOT EXISTS (SELECT 1 FROM sell_on_clauses AS clause WHERE clause.[player_id] = player.[id] AND clause.[status] IN (N'active', N'triggered'))
         AND NOT EXISTS (SELECT 1 FROM buy_back_clauses AS clause WHERE clause.[player_id] = player.[id] AND clause.[status] = N'active')
         AND NOT EXISTS (SELECT 1 FROM loans AS loan WHERE loan.[player_id] = player.[id] AND loan.[status] = N'active')
         AND NOT EXISTS (SELECT 1 FROM negotiations AS negotiation WHERE negotiation.[player_id] = player.[id] AND negotiation.[stage] NOT IN (${TERMINAL_STAGES}))
         AND NOT EXISTS (SELECT 1 FROM player_assets AS asset WHERE asset.[player_id] = player.[id] AND asset.[status] = N'active')
         AND NOT EXISTS (SELECT 1 FROM promises AS promise WHERE promise.[player_id] = player.[id] AND promise.[status] = N'active')
         AND NOT EXISTS (SELECT 1 FROM minor_applications AS application WHERE application.[player_id] = player.[id] AND application.[status] = N'pending')
       ORDER BY player.[id]`,
      finishedSeason,
    )).map((row) => row.id);
    let players = 0;
    let rows = 0;
    for (let offset = 0; offset < leavers.length; offset += PRUNE_BATCH) {
      const result = await store.get<{ players: number; rows: number }>(
        pruneBatch,
        JSON.stringify(leavers.slice(offset, offset + PRUNE_BATCH)),
        finishedSeason,
        date,
      );
      players += Number(result?.players ?? 0);
      rows += Number(result?.rows ?? 0);
    }
    let fixtures = 0;
    for (let after = 0; ; ) {
      const batch = await store.all<{ id: number; data: string }>(
        `SELECT TOP (${COMPACT_BATCH}) [id], [data] FROM fixtures
         WHERE [id] > ? AND [season] <= ? AND [status] = N'played' AND DATALENGTH([data]) > 16000
           AND [home_id] NOT IN (${IDS}) AND [away_id] NOT IN (${IDS})
         ORDER BY [id]`,
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
          `UPDATE target SET [data] = changes.[data] FROM fixtures AS target
           JOIN OPENJSON(?) WITH ([id] INT, [data] NVARCHAR(max)) AS changes ON changes.[id] = target.[id]`,
          JSON.stringify(compacted),
        )).changes;
    }
    // Finished seasons keep appearance rows for the user's teams only; season totals live in player_season_stats.
    const appearances = tableName(store.schemaName, "player_match_appearances");
    const truncate = (await store.get<{ allowed: number | null }>(
      "SELECT HAS_PERMS_BY_NAME(?, N'OBJECT', N'ALTER') AS [allowed]",
      appearances,
    ))?.allowed === 1;
    if (truncate) {
      const columns = (await store.columns("player_match_appearances")).map((column) => `[${column}]`).join(", ");
      rows += Number((await store.get<{ removed: number | string }>(
        `SELECT * INTO #touchline_kept_appearances FROM player_match_appearances
           WHERE [season] > ? OR [club_id] IN (${IDS});
         DECLARE @removed BIGINT = (SELECT COUNT_BIG(*) FROM player_match_appearances)
           - (SELECT COUNT_BIG(*) FROM #touchline_kept_appearances);
         TRUNCATE TABLE player_match_appearances;
         INSERT INTO player_match_appearances (${columns}) SELECT ${columns} FROM #touchline_kept_appearances;
         DROP TABLE #touchline_kept_appearances;
         SELECT @removed AS [removed];`,
        finishedSeason,
        userClubs,
      ))?.removed ?? 0);
    } else
      for (;;) {
        const { changes } = await store.run(
          `DELETE TOP (${DELETE_BATCH}) FROM player_match_appearances WHERE [season] <= ? AND [club_id] NOT IN (${IDS})`,
          finishedSeason,
          userClubs,
        );
        rows += changes;
        if (changes < DELETE_BATCH) break;
      }
    rows += (await store.run(
      `DELETE FROM history WHERE [entity_type] = N'appearance' AND [season] < ? AND [id] < (SELECT MAX([id]) FROM history)
         AND NOT EXISTS (SELECT 1 FROM loans WHERE loans.[player_id] = history.[entity_id]
           AND loans.[status] = N'active' AND loans.[start_date] <= history.[date])`,
      finishedSeason,
    )).changes;
    rows += (await store.run(
      "DELETE FROM news WHERE [date] < ? AND [id] < (SELECT MAX([id]) FROM news)",
      `${finishedSeason}-07-01`,
    )).changes;
    const result = { players, fixtures, rows };
    await store.setMeta("lastRetention", { season: finishedSeason, date, ...result });
    return result;
  });
}

const megabytes = (kilobytes: number | string | null) =>
  Math.round((Number(kilobytes ?? 0) / 1024) * 10) / 10;

/** Reserved and used size per table from catalog views; needs no VIEW DATABASE STATE permission. */
export async function databaseFootprint(
  store: Store,
  schemas: string[] = [store.schemaName],
): Promise<SchemaFootprint[]> {
  const footprints: SchemaFootprint[] = [];
  for (const schema of schemas) {
    const tables = (await store.all<{
      table: string;
      rows: number | string;
      reserved_kb: number | string;
      used_kb: number | string;
    }>(
      `SELECT table_row.[name] AS [table],
         SUM(CASE WHEN allocation.[type] = 1 AND partition_row.[index_id] IN (0, 1) THEN partition_row.[rows] ELSE 0 END) AS [rows],
         SUM(allocation.[total_pages]) * 8 AS [reserved_kb], SUM(allocation.[used_pages]) * 8 AS [used_kb]
       FROM sys.tables AS table_row
       JOIN sys.partitions AS partition_row ON partition_row.[object_id] = table_row.[object_id]
       JOIN sys.allocation_units AS allocation ON allocation.[container_id] =
         CASE WHEN allocation.[type] = 2 THEN partition_row.[partition_id] ELSE partition_row.[hobt_id] END
       WHERE table_row.[schema_id] = SCHEMA_ID(?)
       GROUP BY table_row.[name]
       ORDER BY SUM(allocation.[total_pages]) DESC, table_row.[name]`,
      schema,
    )).map((row): TableFootprint => ({
      table: row.table,
      rows: Number(row.rows),
      reservedMB: megabytes(row.reserved_kb),
      usedMB: megabytes(row.used_kb),
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

/** Allocated and used data/log file space of the whole database. */
export async function databaseSpace(store: Store) {
  const files = await store.all<{ type: number; allocated_kb: number | string; used_kb: number | string | null }>(
    `SELECT [type], SUM(CONVERT(BIGINT, [size])) * 8 AS [allocated_kb],
       SUM(CONVERT(BIGINT, FILEPROPERTY([name], 'SpaceUsed'))) * 8 AS [used_kb]
     FROM sys.database_files GROUP BY [type]`,
  );
  const file = (type: number) => files.find((row) => row.type === type);
  return {
    dataMB: megabytes(file(0)?.allocated_kb ?? 0),
    dataUsedMB: megabytes(file(0)?.used_kb ?? 0),
    logMB: megabytes(file(1)?.allocated_kb ?? 0),
    logUsedMB: megabytes(file(1)?.used_kb ?? 0),
  };
}
