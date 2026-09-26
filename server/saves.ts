import { createReadStream, createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Store } from "./db.ts";
import { WORLD_TABLES, schemaMigrations } from "./sql-schema.ts";
import { ensureClubSupport } from "./club-support.ts";
import {
  clubOf,
  GameError,
  initialInbox,
  settingsOf,
  stateOf,
} from "./systems.ts";
import { generateWorld } from "./world.ts";
import { createCalendar } from "./calendar.ts";
import { SETTING_DEFINITIONS } from "../shared/rules.ts";
import type { DeleteActiveCareerRequest, DeleteActiveCareerResult, SaveSlot } from "../shared/api.ts";
import type { GameState, Settings } from "../shared/types.ts";
import {
  SAVE_FORMAT_VERSION,
  SAVE_SCHEMA_VERSION,
  SAVE_LIMITS,
  SQL_CHUNK_BYTES,
  SaveFormatError,
  boundedStream,
  identifier,
  measuredStream,
  readCheckpoint,
  validateManifest,
  withCheckpointDestination,
  writeCheckpoint,
  type CheckpointColumn,
  type CheckpointManifest,
  type CheckpointSchema,
  type CheckpointSummary,
  type CheckpointTable,
  type ColumnType,
  type RestoredValue,
} from "./save-format.ts";

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const PAGE_ROWS = 1000;
const CHUNK_DELETE_BATCH = 64;

/** Per-career checkpoint counts; older ones rotate away oldest first, imported checkpoints never do. */
export const SAVE_SLOT_LIMITS = Object.freeze({ automatic: 3, manual: 10 });
/** Worlds before the rebuilt catalog world cannot be loaded (decision 1). */
export const MIN_WORLD_VERSION = 4;

interface WorldMeta {
  version?: number;
  nations?: unknown;
  options?: { nations?: unknown; squads?: unknown };
}

/** A regenerated world keeps the nation subset and squad mode of the world it replaces. */
function regenerationOptions(world: WorldMeta) {
  const nations = world.options?.nations ?? world.nations;
  const squads = world.options?.squads;
  return {
    ...(Array.isArray(nations) && nations.length && nations.every((code) => typeof code === "string")
      ? { nations: nations as string[] }
      : {}),
    ...(squads === "full" || squads === "minimum" ? { squads: squads as "full" | "minimum" } : {}),
  };
}

function worldVersionError(world: unknown) {
  const version = (world as WorldMeta | null)?.version ?? 1;
  if (Number.isSafeInteger(version) && version >= MIN_WORLD_VERSION) return undefined;
  return new SaveFormatError(
    `This save comes from an older Touchline world (version ${Number.isSafeInteger(version) ? version : "unknown"}). ` +
      "The football world has been rebuilt, so saves made before it can't be loaded any more. Start a new career instead.",
  );
}

type CheckpointProgress = (table: string, rows: number, total: number) => void;

interface CatalogRow {
  id: string;
  name: string;
  career_id: string | null;
  career_metadata: string | null;
  created_at: Date | string;
  automatic: boolean | number;
  imported: boolean | number;
  format_version: number;
  byte_length: number | string;
  sha256: string | null;
}

export interface CheckpointSlotOptions {
  name: string;
  automatic?: boolean;
  imported?: boolean;
  career?: SaveSlot["career"];
  createdAt?: string;
}

export interface ValidatedWorldCheckpoint {
  summary: CheckpointSummary;
  state: GameState;
}

export function sqlName(name: string) {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(name))
    throw new SaveFormatError("Invalid SQL identifier.");
  return `[${name}]`;
}

function tableName(store: Store, table: string) {
  return `${sqlName(store.schemaName)}.${sqlName(table)}`;
}

function slotId(file: string) {
  const match = /^([a-f0-9-]+)\.touchline\.gz$/i.exec(file);
  if (!match || !UUID.test(match[1]))
    throw new GameError("Save slot not found.");
  return match[1].toLowerCase();
}

function saveName(name: string) {
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 200 ||
    [...name].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new GameError("Give the save a name of 1 to 200 characters.");
  return name.trim();
}

function temporaryFile() {
  return join(tmpdir(), `touchline-${randomUUID()}.touchline.gz`);
}

function slotFromRow(row: CatalogRow): SaveSlot {
  if (!UUID.test(row.id))
    throw new SaveFormatError("Invalid save catalog identifier.");
  return {
    name: row.name,
    file: `${row.id.toLowerCase()}.touchline.gz`,
    size: Number(row.byte_length),
    modified: new Date(row.created_at).toISOString(),
    compressed: true,
    automatic: Boolean(row.automatic),
    career: row.career_metadata
      ? (JSON.parse(row.career_metadata) as SaveSlot["career"])
      : undefined,
  };
}

export async function checkpointSchema(
  store: Store,
): Promise<CheckpointSchema> {
  const names = await store.worldTables();
  if (
    names.length !== WORLD_TABLES.length ||
    WORLD_TABLES.some((name) => !names.includes(name))
  )
    throw new SaveFormatError(
      "The SQL world table inventory is incomplete or unknown. Run the explicit schema migration first.",
    );
  const actual = await store.all<{ name: string }>(
    "SELECT name FROM sys.tables WHERE schema_id = SCHEMA_ID(?)",
    store.schemaName,
  );
  const known = new Set<string>([
    ...WORLD_TABLES,
    "save_slots",
    "save_chunks",
    "schema_migrations",
  ]);
  if (actual.some((table) => !known.has(table.name)))
    throw new SaveFormatError(
      "Unknown SQL table in the game schema; refusing to omit it from a checkpoint.",
    );
  const versions = await store.all<{ version: number }>(
    `SELECT version FROM ${tableName(store, "schema_migrations")} ORDER BY version`,
  );
  const supported = schemaMigrations(store.schemaName);
  if (
    versions.length !== supported.length ||
    versions.some((row, index) => row.version !== supported[index].version)
  )
    throw new SaveFormatError(
      "Unsupported or incomplete SQL schema version. Run the explicit schema migration first.",
    );
  const tables: CheckpointSchema["tables"] = [];
  for (const name of WORLD_TABLES) {
    identifier(name);
    const rows = await store.all<{
      name: string;
      type: ColumnType;
      nullable: boolean;
      max_length: number;
      precision: number;
      scale: number;
      computed: boolean;
    }>(
      `SELECT c.name,t.name AS type,c.is_nullable AS nullable,c.max_length,c.precision,c.scale,c.is_computed AS computed
       FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
       JOIN sys.tables b ON b.object_id = c.object_id
       WHERE b.schema_id = SCHEMA_ID(?) AND b.name = ? ORDER BY c.column_id`,
      store.schemaName,
      name,
    );
    const derived = new Set([
      "players.playing_club_id",
      "news.notification_key",
      "news.notification_unkeyed_id",
    ]);
    if (rows.some((row) => row.computed && !derived.has(`${name}.${row.name}`)))
      throw new SaveFormatError(`Unknown computed column in ${name}.`);
    const writable = await store.columns(name);
    const stored = rows.filter((row) => !row.computed);
    if (
      writable.length !== stored.length ||
      stored.some((row, index) => row.name !== writable[index])
    )
      throw new SaveFormatError(
        `Inconsistent writable column inventory for ${name}.`,
      );
    const columns = stored.map((row): CheckpointColumn => {
      const result: CheckpointColumn = {
        name: row.name,
        type: row.type,
        nullable: Boolean(row.nullable),
      };
      if (
        [
          "nvarchar",
          "nchar",
          "varchar",
          "char",
          "varbinary",
          "binary",
        ].includes(row.type)
      )
        result.maxLength =
          row.max_length === -1
            ? -1
            : row.max_length /
              (["nvarchar", "nchar"].includes(row.type) ? 2 : 1);
      if (row.type === "decimal" || row.type === "numeric") {
        result.precision = row.precision;
        result.scale = row.scale;
      }
      return result;
    });
    tables.push({ name, columns });
  }
  const schema = { version: SAVE_SCHEMA_VERSION, tables };
  validateManifest({
    kind: "manifest",
    format: "touchline",
    formatVersion: SAVE_FORMAT_VERSION,
    schemaVersion: schema.version,
    createdAt: new Date().toISOString(),
    tables: tables.map((table) => ({ ...table, rowCount: 0 })),
  });
  return schema;
}

async function primaryKey(store: Store, table: string) {
  const keys = await store.all<{ name: string }>(
    `SELECT c.name FROM sys.indexes i
     JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
     JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
     JOIN sys.tables t ON t.object_id = i.object_id
     WHERE i.is_primary_key = 1 AND t.schema_id = SCHEMA_ID(?) AND t.name = ? ORDER BY ic.key_ordinal`,
    store.schemaName,
    table,
  );
  if (!keys.length)
    throw new SaveFormatError(`Cannot stream ${table} without a primary key.`);
  return keys.map((key) => identifier(key.name));
}

async function* worldRows(store: Store, table: CheckpointTable, progress?: CheckpointProgress) {
  const keys = await primaryKey(store, table.name);
  const keySql = (key: string) =>
    `${sqlName(key)}${["nvarchar", "nchar", "varchar", "char"].includes(table.columns.find((column) => column.name === key)!.type) ? " COLLATE Latin1_General_100_BIN2" : ""}`;
  const columns = table.columns.map((column) => sqlName(column.name));
  const order = keys.map(keySql).join(",");
  const rowBytes = `${columns.map((column) => `COALESCE(CONVERT(BIGINT,DATALENGTH(${column})),0)`).join(" + ")} + ${columns.length * 8}`;
  let last: Record<string, RestoredValue> | undefined;
  let processed = 0;
  for (;;) {
    const parameters: RestoredValue[] = [];
    const after = last
      ? keys
          .map((key, index) => {
            const clauses = keys.slice(0, index).map((previous) => {
              parameters.push(last![previous]);
              return `${keySql(previous)} = ?`;
            });
            parameters.push(last![key]);
            clauses.push(`${keySql(key)} > ?`);
            return `(${clauses.join(" AND ")})`;
          })
          .join(" OR ")
      : "";
    const batch = await store.all<Record<string, RestoredValue>>(
      `WITH checkpoint_page AS (
         SELECT TOP (${PAGE_ROWS}) ${columns.join(",")},${rowBytes} AS checkpoint_bytes
         FROM ${tableName(store, table.name)} ${after ? `WHERE ${after}` : ""} ORDER BY ${order}
       ), checkpoint_sized AS (
         SELECT *,SUM(checkpoint_bytes) OVER (ORDER BY ${order} ROWS UNBOUNDED PRECEDING) AS checkpoint_total,
           ROW_NUMBER() OVER (ORDER BY ${order}) AS checkpoint_ordinal FROM checkpoint_page
       )
       SELECT ${columns.map((column) => `CASE WHEN checkpoint_bytes <= ${SAVE_LIMITS.lineBytes} THEN ${column} ELSE NULL END AS ${column}`).join(",")},checkpoint_bytes
       FROM checkpoint_sized WHERE checkpoint_total <= ${SQL_CHUNK_BYTES} OR checkpoint_ordinal = 1 ORDER BY ${order}`,
      ...parameters,
    );
    if (!batch.length) {
      progress?.(table.name, processed, table.rowCount);
      return;
    }
    for (const row of batch) {
      if (Number(row.checkpoint_bytes) > SAVE_LIMITS.lineBytes)
        throw new SaveFormatError(
          `A row in ${table.name} exceeds the checkpoint byte limit.`,
        );
      yield table.columns.map((column) => row[column.name]);
      processed++;
    }
    last = batch[batch.length - 1];
  }
}

export async function writeWorldCheckpoint(
  store: Store,
  destination: Writable,
  provenance?: CheckpointManifest["provenance"],
  progress?: CheckpointProgress,
): Promise<CheckpointSummary> {
  return withCheckpointDestination(destination, () =>
    store.transaction(async () => {
      const schema = await checkpointSchema(store);
      const tables: CheckpointTable[] = [];
      for (const table of schema.tables) {
        const row = await store.get<{ total: number | string }>(
          `SELECT COUNT_BIG(*) AS total FROM ${tableName(store, table.name)} WITH (TABLOCKX,HOLDLOCK)`,
        );
        tables.push({ ...table, rowCount: Number(row!.total) });
      }
      return writeCheckpoint(
        destination,
        {
          kind: "manifest",
          format: "touchline",
          formatVersion: SAVE_FORMAT_VERSION,
          schemaVersion: schema.version,
          createdAt: new Date().toISOString(),
          tables,
          provenance,
        },
        (table) => worldRows(store, table, progress),
      );
    }),
  );
}

function chunkWriter(store: Store, id: string) {
  let ordinal = 0;
  let remainder = Buffer.alloc(0);
  const insert = async (data: Buffer) => {
    await store.run(
      `INSERT INTO ${tableName(store, "save_chunks")}(save_id,ordinal,data) VALUES (?,?,?)`,
      id,
      ordinal++,
      data,
    );
  };
  return new Writable({
    highWaterMark: SQL_CHUNK_BYTES,
    write(chunk: Buffer, _encoding, callback) {
      void (async () => {
        const data = remainder.length
          ? Buffer.concat([remainder, chunk])
          : chunk;
        let offset = 0;
        while (offset + SQL_CHUNK_BYTES <= data.length) {
          await insert(
            Buffer.from(data.subarray(offset, offset + SQL_CHUNK_BYTES)),
          );
          offset += SQL_CHUNK_BYTES;
        }
        remainder = Buffer.from(data.subarray(offset));
      })().then(() => callback(), callback);
    },
    final(callback) {
      void (async () => {
        if (remainder.length) await insert(remainder);
      })().then(() => callback(), callback);
    },
  });
}

async function createSlot(store: Store, options: CheckpointSlotOptions) {
  const name = saveName(options.name);
  const id = randomUUID();
  if (options.career && (!options.career.id || options.career.id.length > 100))
    throw new SaveFormatError("Invalid or oversized career identifier.");
  const createdAt = options.createdAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt)))
    throw new SaveFormatError("Invalid save creation date.");
  await store.run(
    `INSERT INTO ${tableName(store, "save_slots")}
     (id,name,career_id,career_metadata,created_at,automatic,imported,format_version,byte_length,sha256,complete)
     VALUES (?,?,?,?,?,?,?,?,0,NULL,0)`,
    id,
    name,
    options.career?.id ?? null,
    options.career ? JSON.stringify(options.career) : null,
    createdAt,
    options.automatic ? 1 : 0,
    options.imported ? 1 : 0,
    SAVE_FORMAT_VERSION,
  );
  return { id, name, file: `${id}.touchline.gz` };
}

async function completeSlot(
  store: Store,
  id: string,
  summary: CheckpointSummary,
) {
  await store.run(
    `UPDATE ${tableName(store, "save_slots")} SET byte_length = ?, sha256 = ?, complete = 1 WHERE id = ?`,
    summary.byteLength,
    summary.sha256,
    id,
  );
}

export async function validateWorldCheckpoint(
  store: Store,
  file: string,
): Promise<ValidatedWorldCheckpoint> {
  const metadata = new Map<string, string>();
  const summary = await readCheckpoint(
    createReadStream(file, { highWaterMark: SQL_CHUNK_BYTES }),
    {
      expected: await checkpointSchema(store),
      onRow(table, values) {
        if (table.name !== "meta") return;
        const key =
          values[table.columns.findIndex((column) => column.name === "key")];
        const value =
          values[table.columns.findIndex((column) => column.name === "value")];
        if (
          typeof key === "string" &&
          ["state", "settings", "schemaVersion", "world"].includes(key)
        ) {
          if (typeof value !== "string" || metadata.has(key))
            throw new SaveFormatError("Invalid game metadata.");
          metadata.set(key, value);
          // meta is the first table, so an old world is refused before the rest of the file is read.
          if (key === "world") {
            let world: unknown;
            try {
              world = JSON.parse(value);
            } catch {
              throw new SaveFormatError("Invalid game metadata.");
            }
            const outdated = worldVersionError(world);
            if (outdated) throw outdated;
          }
        }
      },
    },
  );
  let state: GameState;
  try {
    if (
      JSON.parse(metadata.get("schemaVersion") ?? "null") !==
      SAVE_SCHEMA_VERSION
    )
      throw new Error("schemaVersion");
    state = JSON.parse(metadata.get("state") ?? "null") as GameState;
    if (
      !state ||
      typeof state.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(state.date) ||
      !Number.isFinite(Date.parse(state.date)) ||
      new Date(state.date).toISOString().slice(0, 10) !== state.date ||
      !Number.isSafeInteger(state.clubId) ||
      state.clubId < 1 ||
      !Number.isSafeInteger(state.season) ||
      typeof state.seed !== "string" ||
      typeof state.director?.name !== "string"
    )
      throw new Error("state");
    for (const key of ["settings", "world"]) {
      const value: unknown = JSON.parse(metadata.get(key) ?? "null");
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(key);
    }
  } catch {
    throw new SaveFormatError(
      "The checkpoint has missing, invalid, or unsupported game metadata.",
    );
  }
  return { summary, state };
}

export async function persistCheckpointFile(
  store: Store,
  file: string,
  options: CheckpointSlotOptions,
  validated?: ValidatedWorldCheckpoint,
) {
  const { summary } = validated ?? (await validateWorldCheckpoint(store, file));
  return store.transaction(async () => {
    const slot = await createSlot(store, options);
    const measured = measuredStream(SAVE_LIMITS.compressedBytes, "Checkpoint");
    await pipeline(
      createReadStream(file, { highWaterMark: SQL_CHUNK_BYTES }),
      measured.stream,
      chunkWriter(store, slot.id),
    );
    const stored = measured.result();
    if (
      stored.sha256 !== summary.sha256 ||
      stored.byteLength !== summary.byteLength
    )
      throw new SaveFormatError(
        "The staged checkpoint changed while storing it.",
      );
    await completeSlot(store, slot.id, summary);
    return { file: slot.file, name: slot.name };
  });
}

export async function restoreCheckpointFile(
  store: Store,
  file: string,
  upgrade = true,
  checkpoint?: ValidatedWorldCheckpoint,
  progress?: CheckpointProgress,
) {
  const validated = checkpoint ?? (await validateWorldCheckpoint(store, file));
  return store.transaction(async () => {
    const untrusted = await store.all<{ name: string }>(
      `SELECT name FROM sys.foreign_keys WHERE schema_id = SCHEMA_ID(?) AND (is_disabled = 1 OR is_not_trusted = 1)
       UNION ALL
       SELECT name FROM sys.check_constraints WHERE schema_id = SCHEMA_ID(?) AND (is_disabled = 1 OR is_not_trusted = 1)`,
      store.schemaName,
      store.schemaName,
    );
    if (untrusted.length)
      throw new SaveFormatError("Restore requires enabled and trusted SQL constraints.");
    progress?.("constraints enforced on every bulk batch", 1, 1);
    await store.clearWorld();
    let batch: RestoredValue[][] = [];
    let bytes = 0;
    const processed = new Map<string, number>();
    const flush = async (table: CheckpointTable) => {
      if (batch.length)
        await store.bulkInsert(
          table.name,
          batch.map((values) =>
            Object.fromEntries(
              table.columns.map((column, index) => [
                column.name,
                values[index],
              ]),
            ),
          ),
        );
      const total = (processed.get(table.name) ?? 0) + batch.length;
      processed.set(table.name, total);
      progress?.(table.name, total, table.rowCount);
      batch = [];
      bytes = 0;
    };
    const loaded = await readCheckpoint(
      createReadStream(file, { highWaterMark: SQL_CHUNK_BYTES }),
      {
        expected: await checkpointSchema(store),
        async onRow(table, values) {
          const size = values.reduce<number>(
            (total, value) =>
              total +
              (Buffer.isBuffer(value)
                ? value.length
                : typeof value === "string"
                  ? value.length * 2
                  : 16),
            0,
          );
          if (
            batch.length &&
            (bytes + size > SQL_CHUNK_BYTES || batch.length >= PAGE_ROWS)
          )
            await flush(table);
          batch.push(values);
          bytes += size;
        },
        onTableEnd: flush,
      },
    );
    if (loaded.sha256 !== validated.summary.sha256)
      throw new SaveFormatError(
        "The staged checkpoint changed during restoration.",
      );
    if (
      !(await store.get(
        `SELECT id FROM ${tableName(store, "clubs")} WHERE id = ?`,
        validated.state.clubId,
      ))
    )
      throw new SaveFormatError("The checkpoint's active club does not exist.");
    if (upgrade) {
      await ensureClubSupport(store);
      const settings = await store.meta<Settings>("settings");
      if (settings.cloudSync !== false)
        await store.setMeta("settings", { ...settings, cloudSync: false });
    }
    return validated;
  });
}

export async function* storedChunks(store: Store, slot: Pick<CatalogRow, "id" | "byte_length">) {
  let ordinal = 0;
  let bytes = 0;
  for (;;) {
    const chunk = await store.get<{
      ordinal: number;
      data: Buffer | null;
      byte_length: number;
    }>(
      `SELECT TOP (1) ordinal,CASE WHEN DATALENGTH(data) <= ${SQL_CHUNK_BYTES} THEN data ELSE NULL END AS data,
        CONVERT(INT,DATALENGTH(data)) AS byte_length FROM ${tableName(store, "save_chunks")}
       WHERE save_id = ? AND ordinal >= ? ORDER BY ordinal`,
      slot.id,
      ordinal,
    );
    if (!chunk) break;
    if (
      chunk.ordinal !== ordinal ||
      !Buffer.isBuffer(chunk.data) ||
      chunk.byte_length < 1 ||
      chunk.data.length !== chunk.byte_length
    )
      throw new SaveFormatError(
        "A save chunk is missing, oversized, or damaged.",
      );
    bytes += chunk.byte_length;
    if (bytes > SAVE_LIMITS.compressedBytes || bytes > Number(slot.byte_length))
      throw new SaveFormatError("Save chunks exceed the catalog length.");
    ordinal++;
    yield chunk.data;
  }
  if (!ordinal || bytes !== Number(slot.byte_length))
    throw new SaveFormatError("The saved checkpoint is incomplete.");
}

export class Saves {
  constructor(readonly store: Store) {}

  async currentState(): Promise<GameState | null> {
    const rows = await this.store.all<{ key: string; value: string }>(
      "SELECT [key], [value] FROM meta WHERE [key] IN ('state', 'worldBuild')",
    );
    // An unfinished (or interrupted) world build is not a career yet; prepareCareer discards and rebuilds it.
    if (rows.some((row) => row.key === "worldBuild")) return null;
    const row = rows.find((candidate) => candidate.key === "state");
    return row ? JSON.parse(row.value) as GameState : null;
  }

  private async requireState() {
    const state = await this.currentState();
    if (!state)
      throw Object.assign(new GameError("Prepare a new career or load a saved career first."), { status: 409 });
    return state;
  }

  private async buildMarker() {
    return this.store.get<{ value: string }>("SELECT [value] FROM meta WHERE [key] = 'worldBuild'");
  }

  /** Empties the world tables (committing in batches inside Store.batched) and keeps the migration marker. */
  private async discardBuild() {
    const marker = await this.store.get<{ value: string }>(
      "SELECT [value] FROM meta WHERE [key] = 'appearanceIndexVersion'",
    );
    await this.store.discardWorld();
    if (marker)
      await this.store.run(
        "INSERT INTO meta ([key], [value]) VALUES (?, ?)",
        "appearanceIndexVersion",
        marker.value,
      );
  }

  /**
   * Builds a world in committed batches (Azure SQL log limits). meta 'worldBuild' marks it unfinished until the
   * end; an interrupted or failed build is discarded before the next one starts.
   */
  private async buildWorld(options: Parameters<typeof generateWorld>[1]) {
    await this.store.setMeta("worldBuild", { seed: options?.seed, started: new Date().toISOString() });
    const started = performance.now();
    try {
      await generateWorld(this.store, options);
    } catch (error) {
      await this.discardBuild().catch((cleanup: unknown) =>
        console.error("Discarding the failed world build also failed:", cleanup instanceof Error ? cleanup.message : cleanup));
      throw error;
    }
    console.info(`Career world built in ${Math.round((performance.now() - started) / 100) / 10}s.`);
  }

  async prepareCareer(displayName: string) {
    if (!(await this.buildMarker()) && (await this.currentState())) return { created: false };
    return this.store.batched(async () => {
      if (await this.buildMarker()) await this.discardBuild();
      else if (await this.currentState()) return { created: false };
      // Snapshots of other careers may remain after the active career is deleted; only world tables must be empty.
      for (const table of WORLD_TABLES) {
        const existing = await this.store.get(
          `SELECT TOP (1) 1 AS present FROM ${tableName(this.store, table)}${table === "meta" ? " WHERE [key] <> 'appearanceIndexVersion' OR [value] <> '1'" : ""}`,
        );
        if (existing)
          throw Object.assign(new GameError("This world contains existing data and cannot be prepared as a new career."), { status: 409 });
      }
      await this.buildWorld({ seed: `touchline-${randomUUID()}` });
      const state = await stateOf(this.store);
      state.director.name = displayName.trim().slice(0, 50) || "Sporting director";
      await this.store.setMeta("state", state);
      await this.store.run("DELETE FROM meta WHERE [key] = 'worldBuild'");
      // Written last: startCareer reuses a prepared world only when this matches its seed.
      await this.store.setMeta("careerPreparationSeed", state.seed);
      return { created: true };
    });
  }

  async list(): Promise<SaveSlot[]> {
    return (
      await this.store.all<CatalogRow>(
        `SELECT * FROM ${tableName(this.store, "save_slots")} WHERE complete = 1 ORDER BY created_at DESC,id DESC`,
      )
    ).map(slotFromRow);
  }

  async deleteCareer(file: string) {
    const id = slotId(file);
    return this.store.transaction(async () => {
      const selected = await this.store.get<CatalogRow>(
        `SELECT * FROM ${tableName(this.store, "save_slots")} WITH (UPDLOCK,HOLDLOCK) WHERE id = ? AND complete = 1`,
        id,
      );
      if (!selected) throw Object.assign(new GameError("Save slot not found."), { status: 404 });
      const state = await this.currentState();
      if (selected.career_id && selected.career_id === state?.careerId)
        throw new GameError(
          "The active career cannot be deleted. Load another career first.",
        );
      const targets = await this.store.all<{ id: string }>(
        `SELECT id FROM ${tableName(this.store, "save_slots")} WITH (UPDLOCK,HOLDLOCK) WHERE ${selected.career_id ? "career_id COLLATE Latin1_General_100_BIN2 = ? AND DATALENGTH(career_id) = DATALENGTH(?)" : "id = ?"}`,
        ...(selected.career_id
          ? [selected.career_id, selected.career_id]
          : [id]),
      );
      for (const target of targets)
        await this.store.run(
          `DELETE FROM ${tableName(this.store, "save_slots")} WHERE id = ?`,
          target.id,
        );
      return {
        deleted: targets.length,
        message: selected.career_id
          ? "Career and its saved snapshots deleted."
          : "Save deleted.",
      };
    });
  }

  async deleteActiveCareer(confirmation: DeleteActiveCareerRequest): Promise<DeleteActiveCareerResult> {
    // The legacy dbo world is the migrated live career; refuse before any read or lock.
    if (this.store.schemaName.toLowerCase() === "dbo")
      throw Object.assign(
        new GameError("This career is protected and can't be deleted here."),
        { status: 409, code: "career_protected" },
      );
    return this.store.transaction(async () => {
      const state = await this.currentState();
      if (!state)
        throw Object.assign(new GameError("There is no active career to delete."), { status: 404 });
      const careerId = state.careerId ?? null;
      if (confirmation.careerId !== careerId || confirmation.seed !== state.seed)
        throw Object.assign(
          new GameError("The active career changed. Reload it before deleting."),
          { status: 409, code: "career_mismatch" },
        );
      const slots = careerId
        ? await this.store.all<{ id: string }>(
            `SELECT id FROM ${tableName(this.store, "save_slots")} WITH (UPDLOCK,HOLDLOCK)
             WHERE career_id COLLATE Latin1_General_100_BIN2 = ? AND DATALENGTH(career_id) = DATALENGTH(?)`,
            careerId,
            careerId,
          )
        : [];
      for (const slot of slots) {
        const lastOrdinal = (await this.store.get<{ ordinal: number | null }>(
          `SELECT MAX(ordinal) AS ordinal FROM ${tableName(this.store, "save_chunks")} WHERE save_id = ?`,
          slot.id,
        ))?.ordinal ?? -1;
        for (let low = 0; low <= lastOrdinal; low += CHUNK_DELETE_BATCH)
          await this.store.run(
            `DELETE FROM ${tableName(this.store, "save_chunks")} WHERE save_id = ? AND ordinal >= ? AND ordinal < ?`,
            slot.id,
            low,
            low + CHUNK_DELETE_BATCH,
          );
        await this.store.run(
          `DELETE FROM ${tableName(this.store, "save_slots")} WHERE id = ?`,
          slot.id,
        );
      }
      const marker = await this.store.get<{ value: string }>(
        "SELECT [value] FROM meta WHERE [key] = 'appearanceIndexVersion'",
      );
      await this.store.discardWorld();
      if (marker)
        await this.store.run(
          "INSERT INTO meta ([key], [value]) VALUES (?, ?)",
          "appearanceIndexVersion",
          marker.value,
        );
      return {
        deleted: true,
        careerId,
        snapshots: slots.length,
        message: "Career deleted. Start a new career or load another saved career.",
      };
    });
  }

  async create(name: string, automatic = false) {
    saveName(name);
    return this.store.transaction(async () => {
      const state = await this.requireState();
      const club = await clubOf(this.store);
      let changed = false;
      if (!state.careerId) {
        state.careerId = randomUUID();
        state.careerName ??= `${state.director.name} at ${club.name}`;
        changed = true;
      }
      if (automatic) {
        state.lastAutosave = state.date;
        changed = true;
      }
      if (changed) await this.store.setMeta("state", state);
      const slot = await createSlot(this.store, {
        name,
        automatic,
        career: {
          id: state.careerId,
          name: state.careerName ?? `${state.director.name} at ${club.name}`,
          director: state.director.name,
          club: club.name,
          date: state.date,
          season: state.season,
        },
      });
      const summary = await writeWorldCheckpoint(
        this.store,
        chunkWriter(this.store, slot.id),
      );
      await completeSlot(this.store, slot.id, summary);
      const obsolete = await this.store.all<{ id: string }>(
        `SELECT id FROM ${tableName(this.store, "save_slots")} WHERE automatic = ? AND imported = 0 AND complete = 1 AND career_id COLLATE Latin1_General_100_BIN2 = ? AND DATALENGTH(career_id) = DATALENGTH(?)
         ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END,created_at DESC,id DESC OFFSET ${automatic ? SAVE_SLOT_LIMITS.automatic : SAVE_SLOT_LIMITS.manual} ROWS`,
        automatic ? 1 : 0,
        state.careerId,
        state.careerId,
        slot.id,
      );
      for (const old of obsolete)
        await this.store.run(
          `DELETE FROM ${tableName(this.store, "save_slots")} WHERE id = ? AND imported = 0`,
          old.id,
        );
      return { file: slot.file, name: slot.name };
    });
  }

  async startCareer(input: {
    name: string;
    careerName: string;
    background: string;
    clubId: number;
    seed?: string;
  }) {
    saveName(input.careerName);
    const backgrounds = SETTING_DEFINITIONS.find(
      (setting) => setting.id === "directorBackground",
    )!.options!;
    if (!backgrounds.includes(input.background))
      throw new GameError("Choose a valid director background.");
    const oldState = await this.requireState();
    const preparation = oldState.started === false
      ? await this.store.get<{ value: string }>("SELECT value FROM meta WHERE [key] = 'careerPreparationSeed'")
      : undefined;
    const prepared = Boolean(preparation && JSON.parse(preparation.value) === oldState.seed);
    const seed = input.seed ?? (prepared
      ? oldState.seed
      : `touchline-${Date.now()}`);
    if (
      !input.name.trim() ||
      input.name.trim().length > 50 ||
      !seed ||
      seed.length > 100
    )
      throw new GameError("Choose a valid director name and world seed.");
    const selected = await clubOf(this.store, input.clubId);
    if (selected.type !== "club")
      throw new GameError("Choose a senior club for your appointment.");
    const reusePrepared = prepared && seed === oldState.seed;
    const oldSettings = await settingsOf(this.store);
    const world = await this.store.meta<WorldMeta>("world");
    // Club ids differ between seeds; the catalog key of the chosen club is stable.
    const selectedKey: unknown = JSON.parse(selected.data).worldKey;
    if (!reusePrepared && typeof selectedKey !== "string")
      throw new GameError(
        "The selected club is unavailable in this world configuration.",
      );
    const archived = oldState.started === false ? undefined : await this.create(
      oldState.careerName ??
        `${oldState.director.name} - ${(await clubOf(this.store)).name}`,
    );
    // The old career is archived above; the replacement world is built in committed batches.
    if (!reusePrepared)
      await this.store.batched(async () => {
        await this.store.setMeta("worldBuild", { seed, started: new Date().toISOString() });
        await this.discardBuild();
        await this.buildWorld({ seed, ...regenerationOptions(world) });
      });
    return this.store.transaction(async () => {
      await this.store.run("DELETE FROM meta WHERE [key] = 'worldBuild'");
      const state = await stateOf(this.store);
      state.clubId = reusePrepared
        ? input.clubId
        : ((
            await this.store.get<{ id: number }>(
              "SELECT id FROM clubs WHERE type = 'club' AND JSON_VALUE(data,'$.worldKey') = ?",
              selectedKey as string,
            )
          )?.id ?? 0);
      if (!state.clubId)
        throw new GameError(
          "The selected club is unavailable in this world configuration.",
        );
      state.careerId = randomUUID();
      state.careerName = input.careerName.trim();
      state.started = true;
      state.director.name = input.name.trim();
      state.director.background = input.background;
      const skill = {
        "Former scout": "scouting",
        "Former player": "leadership",
        Negotiator: "negotiations",
        "Finance executive": "finance",
        "Academy director": "development",
      }[input.background]!;
      state.director.skills = {
        scouting: 0,
        negotiations: 0,
        development: 0,
        finance: 0,
        leadership: 0,
        [skill]: 2,
      };
      await this.store.setMeta("state", state);
      await this.store.run("DELETE FROM meta WHERE [key] = 'careerPreparationSeed'");
      const settings = await settingsOf(this.store);
      for (const definition of SETTING_DEFINITIONS.filter((setting) =>
        ["Interface", "Appearance", "Accessibility", "Saves"].includes(
          setting.group,
        ),
      ))
        settings[definition.id] =
          oldSettings[definition.id] ?? definition.default;
      await this.store.setMeta("settings", {
        ...settings,
        cloudSync: false,
        directorBackground: input.background,
      });
      await createCalendar(this.store);
      await initialInbox(this.store);
      const saved = await this.create(input.careerName);
      return {
        message: `Career started at ${(await clubOf(this.store)).name}.`,
        archived: archived?.file ?? null,
        saved: saved.file,
        careerId: state.careerId,
      };
    });
  }

  async export(savedFile?: string): Promise<{ file: string; name: string }> {
    const file = temporaryFile();
    try {
      let date = "career";
      await this.store.transaction(async () => {
        if (savedFile) {
          const slot = await this.store.get<CatalogRow>(
            `SELECT * FROM ${tableName(this.store, "save_slots")} WITH (HOLDLOCK) WHERE id = ? AND complete = 1`,
            slotId(savedFile),
          );
          if (!slot) throw Object.assign(new GameError("Save slot not found."), { status: 404 });
          date = slot.id;
          await pipeline(
            Readable.from(storedChunks(this.store, slot), { objectMode: false }),
            createWriteStream(file, {
              flags: "wx",
              mode: 0o600,
              highWaterMark: SQL_CHUNK_BYTES,
            }),
          );
        } else {
          date = (await this.requireState()).date;
          await writeWorldCheckpoint(
            this.store,
            createWriteStream(file, {
              flags: "wx",
              mode: 0o600,
              highWaterMark: SQL_CHUNK_BYTES,
            }),
          );
        }
      });
      return { file, name: `Touchline-${date}.touchline.gz` };
    } catch (error) {
      await rm(file, { force: true });
      throw error;
    }
  }

  async restore(file: string) {
    const id = slotId(file);
    const temporary = temporaryFile();
    try {
      const slot = await this.store.transaction(async () => {
        const slot = await this.store.get<CatalogRow>(
          `SELECT * FROM ${tableName(this.store, "save_slots")} WITH (HOLDLOCK) WHERE id = ? AND complete = 1`,
          id,
        );
        if (!slot) throw Object.assign(new GameError("Save slot not found."), { status: 404 });
        if (
          slot.format_version !== SAVE_FORMAT_VERSION ||
          !slot.sha256 ||
          !Number.isSafeInteger(Number(slot.byte_length))
        )
          throw new SaveFormatError(
            "Unsupported or incomplete save catalog entry.",
          );
        await pipeline(
          Readable.from(storedChunks(this.store, slot), { objectMode: false }),
          createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
        );
        return slot;
      });
      const validated = await validateWorldCheckpoint(this.store, temporary);
      const { summary } = validated;
      if (
        summary.sha256 !== slot.sha256 ||
        summary.byteLength !== Number(slot.byte_length)
      )
        throw new SaveFormatError(
          "Saved checkpoint digest does not match the catalog.",
        );
      await restoreCheckpointFile(this.store, temporary, true, validated);
    } catch (error) {
      if (error instanceof SaveFormatError) throw new GameError(error.message);
      throw error;
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async import(source: Buffer | Readable) {
    const file = temporaryFile();
    try {
      await pipeline(
        Buffer.isBuffer(source) ? Readable.from([source]) : source,
        boundedStream(SAVE_LIMITS.compressedBytes, "Uploaded checkpoint"),
        createWriteStream(file, {
          flags: "wx",
          mode: 0o600,
          highWaterMark: SQL_CHUNK_BYTES,
        }),
      );
      const validated = await validateWorldCheckpoint(this.store, file);
      const { state } = validated;
      await this.store.transaction(async () => {
        await restoreCheckpointFile(this.store, file, true, validated);
        const club = await clubOf(this.store);
        await persistCheckpointFile(
          this.store,
          file,
          {
            name: state.careerName ?? `Imported career ${state.date}`,
            imported: true,
            career: state.careerId
              ? {
                  id: state.careerId,
                  name: state.careerName ?? state.director.name,
                  director: state.director.name,
                  club: club.name,
                  date: state.date,
                  season: state.season,
                }
              : undefined,
          },
          validated,
        );
      });
    } catch (error) {
      if (error instanceof SaveFormatError) throw new GameError(error.message);
      if (
        error instanceof Error &&
        "code" in error &&
        String(error.code).startsWith("Z_")
      )
        throw new GameError(
          "Choose a logical .touchline.gz checkpoint. Legacy SQLite saves require the explicit data-migrate CLI.",
        );
      throw error;
    } finally {
      await rm(file, { force: true });
    }
  }
}
