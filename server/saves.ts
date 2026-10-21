import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import type { SqlParameter, Store } from "./db.ts";
import { ADDED_WORLD_TABLES, WORLD_TABLES, quoteIdentifier, schemaMigrations, tableName as qualifiedTable } from "./sql-schema.ts";
import { ensureClubSupport } from "./club-support.ts";
import { ensureGbeBaseline } from "./gbe.ts";
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
  worldDigest,
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
// Paging and batch sizes only bound memory and round trips; checkpoint bytes do not depend on them.
const CHECKPOINT_PAGE_ROWS = 4000;
const CHECKPOINT_PAGE_BYTES = 4 * SQL_CHUNK_BYTES;
const RESTORE_BATCH_ROWS = 5000;
const RESTORE_BATCH_BYTES = 4 * SQL_CHUNK_BYTES;
const CHUNKS_PER_READ = 4;

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
  automatic: boolean;
  imported: boolean;
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
  if (!/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(name))
    throw new SaveFormatError("Invalid SQL identifier.");
  return quoteIdentifier(name);
}

function tableName(store: Store, table: string) {
  sqlName(table);
  return qualifiedTable(store.schemaName, table);
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

/** Imported uploads never rotate away, so the client needs the flag to warn before a manual save replaces one. */
export type ListedSaveSlot = SaveSlot & { imported: boolean };

/** The world digest kept in the catalog's career metadata; undefined for older saves or unreadable metadata. */
function storedWorldDigest(metadata: string | null) {
  if (!metadata) return undefined;
  try {
    const digest: unknown = (JSON.parse(metadata) as { worldDigest?: unknown }).worldDigest;
    return typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest) ? digest : undefined;
  } catch {
    return undefined;
  }
}

function careerFromMetadata(metadata: string | null) {
  if (!metadata) return undefined;
  const career = JSON.parse(metadata) as SaveSlot["career"] & { worldDigest?: string };
  delete career.worldDigest;
  return career;
}

function slotFromRow(row: CatalogRow): ListedSaveSlot {
  if (!UUID.test(row.id))
    throw new SaveFormatError("Invalid save catalog identifier.");
  return {
    name: row.name,
    file: `${row.id.toLowerCase()}.touchline.gz`,
    size: Number(row.byte_length),
    modified: new Date(row.created_at).toISOString(),
    compressed: true,
    automatic: Boolean(row.automatic),
    imported: Boolean(row.imported),
    career: careerFromMetadata(row.career_metadata),
  };
}

/** Generated columns: never stored in a checkpoint, recomputed on restore. */
const DERIVED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  players: ["playing_club_id"],
  news: ["notification_key"],
};
/** Columns that SQL Server checkpoints may name and this schema derives or dropped; accepted and ignored on import. */
const LEGACY_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  players: ["playing_club_id"],
  news: ["notification_key", "notification_unkeyed_id"],
};
const VARIABLE_TYPES = new Set<ColumnType>(["nvarchar", "nchar", "varchar", "char", "varbinary", "binary"]);

interface SqlColumn {
  table_name: string;
  name: string;
  data_type: string;
  max_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
  nullable: boolean;
  generated: boolean;
}

/**
 * Describes a PostgreSQL column in the portable checkpoint vocabulary. The type names are the SQL Server ones earlier
 * Touchline versions wrote, so their checkpoints stay comparable: text is nvarchar(max), double precision is float.
 */
export function portableColumn(column: SqlColumn): CheckpointColumn {
  const base = { name: column.name, nullable: column.nullable };
  switch (column.data_type) {
    case "integer":
      return { ...base, type: "int" };
    case "smallint":
      return { ...base, type: "smallint" };
    case "bigint":
      return { ...base, type: "bigint" };
    case "double precision":
      return { ...base, type: "float" };
    case "real":
      return { ...base, type: "real" };
    case "boolean":
      return { ...base, type: "bit" };
    case "text":
      return { ...base, type: "nvarchar", maxLength: -1 };
    case "character varying":
      return { ...base, type: "nvarchar", maxLength: column.max_length ?? -1 };
    case "character":
      return { ...base, type: "nchar", maxLength: column.max_length ?? 1 };
    case "bytea":
      return { ...base, type: "varbinary", maxLength: -1 };
    case "uuid":
      return { ...base, type: "uniqueidentifier" };
    case "date":
      return { ...base, type: "date" };
    case "timestamp with time zone":
    case "timestamp without time zone":
      return { ...base, type: "datetime2" };
    case "numeric":
      if (column.numeric_precision !== null && column.numeric_scale !== null)
        return { ...base, type: "decimal", precision: column.numeric_precision, scale: column.numeric_scale };
  }
  throw new SaveFormatError(`Unsupported SQL column type for ${column.table_name}.${column.name}: ${column.data_type}.`);
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
    "SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = ?",
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
  const described = await store.all<SqlColumn>(
    `SELECT table_name::text AS table_name, column_name::text AS name, data_type::text AS data_type,
       character_maximum_length::integer AS max_length, numeric_precision::integer AS numeric_precision,
       numeric_scale::integer AS numeric_scale, is_nullable = 'YES' AS nullable, is_generated = 'ALWAYS' AS generated
     FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ANY(?::text[])
     ORDER BY table_name, ordinal_position`,
    store.schemaName,
    WORLD_TABLES,
  );
  const tables: CheckpointSchema["tables"] = [];
  for (const name of WORLD_TABLES) {
    identifier(name);
    const rows = described.filter((row) => row.table_name === name);
    const derived = DERIVED_COLUMNS[name] ?? [];
    if (rows.some((row) => row.generated && !derived.includes(row.name)))
      throw new SaveFormatError(`Unknown computed column in ${name}.`);
    const writable = await store.columns(name);
    const stored = rows.filter((row) => !row.generated);
    if (
      writable.length !== stored.length ||
      stored.some((row, index) => row.name !== writable[index])
    )
      throw new SaveFormatError(
        `Inconsistent writable column inventory for ${name}.`,
      );
    const legacy = LEGACY_COLUMNS[name];
    tables.push({
      name,
      columns: stored.map(portableColumn),
      ...(legacy ? { legacyColumns: [...legacy] } : {}),
      ...(ADDED_WORLD_TABLES.has(name) ? { optional: true } : {}),
    });
  }
  const schema = { version: SAVE_SCHEMA_VERSION, tables };
  validateManifest({
    kind: "manifest",
    format: "touchline",
    formatVersion: SAVE_FORMAT_VERSION,
    schemaVersion: schema.version,
    createdAt: new Date().toISOString(),
    tables: tables.map((table) => ({ name: table.name, columns: table.columns, rowCount: 0 })),
  });
  return schema;
}

async function primaryKey(store: Store, table: string) {
  const keys = await store.all<{ name: string }>(
    `SELECT a.attname AS name
     FROM pg_catalog.pg_index AS i
     CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinal)
     JOIN pg_catalog.pg_attribute AS a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
     WHERE i.indrelid = to_regclass(?) AND i.indisprimary
     ORDER BY k.ordinal`,
    tableName(store, table),
  );
  if (!keys.length)
    throw new SaveFormatError(`Cannot stream ${table} without a primary key.`);
  return keys.map((key) => identifier(key.name));
}

/** Streams a table in primary-key order, one bounded keyset page (rows and bytes) per query. */
async function* worldRows(store: Store, table: CheckpointTable, progress?: CheckpointProgress) {
  const keys = await primaryKey(store, table.name);
  const columns = table.columns.map((column) => sqlName(column.name));
  const order = keys.map(sqlName).join(", ");
  const rowBytes = [
    ...table.columns
      .filter((column) => VARIABLE_TYPES.has(column.type))
      .map((column) => `COALESCE(octet_length(${sqlName(column.name)})::bigint, 0)`),
    String(columns.length * 8),
  ].join(" + ");
  let last: Record<string, RestoredValue> | undefined;
  let processed = 0;
  for (;;) {
    const parameters = last ? keys.map((key) => last![key]) : [];
    const batch = await store.all<Record<string, RestoredValue>>(
      `WITH checkpoint_page AS (
         SELECT ${columns.join(", ")}, ${rowBytes} AS checkpoint_bytes
         FROM ${tableName(store, table.name)}
         ${last ? `WHERE (${order}) > (${keys.map(() => "?").join(", ")})` : ""}
         ORDER BY ${order} LIMIT ${CHECKPOINT_PAGE_ROWS}
       ), checkpoint_sized AS (
         SELECT *, sum(checkpoint_bytes) OVER (ORDER BY ${order} ROWS UNBOUNDED PRECEDING) AS checkpoint_total,
           row_number() OVER (ORDER BY ${order}) AS checkpoint_ordinal
         FROM checkpoint_page
       )
       SELECT ${columns.map((column) => `CASE WHEN checkpoint_bytes <= ${SAVE_LIMITS.lineBytes} THEN ${column} END AS ${column}`).join(", ")},
         checkpoint_bytes
       FROM checkpoint_sized WHERE checkpoint_total <= ${CHECKPOINT_PAGE_BYTES} OR checkpoint_ordinal = 1
       ORDER BY ${order}`,
      ...(parameters as SqlParameter[]),
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
  // The transaction holds the world writer lock, so every page read below sees the same world.
  return withCheckpointDestination(destination, () =>
    store.transaction(async () => {
      const schema = await checkpointSchema(store);
      const counts = (await store.get<Record<string, number>>(
        `SELECT ${schema.tables
          .map((table) => `(SELECT count(*) FROM ${tableName(store, table.name)}) AS ${sqlName(table.name)}`)
          .join(", ")}`,
      ))!;
      const tables: CheckpointTable[] = schema.tables.map((table) => ({
        name: table.name,
        columns: table.columns,
        rowCount: Number(counts[table.name]),
      }));
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
     VALUES (?,?,?,?,?,?,?,?,0,NULL,false)`,
    id,
    name,
    options.career?.id ?? null,
    options.career ? JSON.stringify(options.career) : null,
    createdAt,
    Boolean(options.automatic),
    Boolean(options.imported),
    SAVE_FORMAT_VERSION,
  );
  return { id, name, file: `${id}.touchline.gz`, career: options.career };
}

/** Also records the world digest, so a later pre-load archive can tell whether this exact world is already saved. */
async function completeSlot(
  store: Store,
  slot: Awaited<ReturnType<typeof createSlot>>,
  summary: CheckpointSummary,
) {
  await store.run(
    `UPDATE ${tableName(store, "save_slots")} SET byte_length = ?, sha256 = ?, career_metadata = ?, complete = true WHERE id = ?`,
    summary.byteLength,
    summary.sha256,
    slot.career ? JSON.stringify({ ...slot.career, worldDigest: worldDigest(summary) }) : null,
    slot.id,
  );
}

export async function validateWorldCheckpoint(
  store: Store,
  file: string,
): Promise<ValidatedWorldCheckpoint> {
  return validateWorldSource(store, createReadStream(file, { highWaterMark: SQL_CHUNK_BYTES }));
}

async function validateWorldSource(
  store: Store,
  source: Readable,
): Promise<ValidatedWorldCheckpoint> {
  const metadata = new Map<string, string>();
  const summary = await readCheckpoint(
    source,
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
    await completeSlot(store, slot, summary);
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
    // NOT VALID constraints, disabled (foreign key) triggers, or replica mode would let invalid rows in unchecked.
    const untrusted = await store.all<{ name: string }>(
      `SELECT c.conname AS name FROM pg_catalog.pg_constraint AS c
         JOIN pg_catalog.pg_namespace AS n ON n.oid = c.connamespace
       WHERE n.nspname = ? AND c.contype IN ('f', 'c') AND NOT c.convalidated
       UNION ALL
       SELECT t.tgname FROM pg_catalog.pg_trigger AS t
         JOIN pg_catalog.pg_class AS r ON r.oid = t.tgrelid
         JOIN pg_catalog.pg_namespace AS n ON n.oid = r.relnamespace
       WHERE n.nspname = ? AND t.tgenabled = 'D'
       UNION ALL
       SELECT 'session_replication_role' WHERE current_setting('session_replication_role') <> 'origin'`,
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
            (bytes + size > RESTORE_BATCH_BYTES || batch.length >= RESTORE_BATCH_ROWS)
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
      // Checkpoints older than the GBE ledger: pre-game estimate and the months already played, rebuilt once.
      await ensureGbeBaseline(store);
      const settings = await store.meta<Settings>("settings");
      if (settings.cloudSync !== false)
        await store.setMeta("settings", { ...settings, cloudSync: false });
    }
    return validated;
  });
}

export async function* storedChunks(store: Store, slot: Pick<CatalogRow, "id" | "byte_length">) {
  type StoredChunk = { ordinal: number; data: Buffer | null; byte_length: number };
  const read = (from: number): Promise<StoredChunk[]> => {
    const next = store.all<StoredChunk>(
      `SELECT ordinal, CASE WHEN octet_length(data) <= ${SQL_CHUNK_BYTES} THEN data END AS data,
        octet_length(data) AS byte_length FROM ${tableName(store, "save_chunks")}
       WHERE save_id = ? AND ordinal >= ? ORDER BY ordinal LIMIT ${CHUNKS_PER_READ}`,
      slot.id,
      from,
    );
    // Awaited below, or abandoned when the consumer stops early; never an unhandled rejection.
    next.catch(() => {});
    return next;
  };
  let ordinal = 0;
  let bytes = 0;
  let pending: Promise<StoredChunk[]> | undefined = read(0);
  try {
    while (pending) {
      const chunks: StoredChunk[] = await pending;
      // Prefetch the next chunks so the SQL round trip overlaps with consuming these.
      pending = chunks.length === CHUNKS_PER_READ ? read(ordinal + chunks.length) : undefined;
      for (const chunk of chunks) {
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
    }
  } finally {
    await pending?.catch(() => {});
  }
  if (!ordinal || bytes !== Number(slot.byte_length))
    throw new SaveFormatError("The saved checkpoint is incomplete.");
}

/** Passes chunks through while writing them to a new private file; the file is closed before the stream ends. */
export async function* writeThrough(file: string, chunks: AsyncIterable<Buffer>) {
  const output = createWriteStream(file, { flags: "wx", mode: 0o600, highWaterMark: SQL_CHUNK_BYTES });
  const done = finished(output);
  done.catch(() => {});
  try {
    for await (const chunk of chunks) {
      if (!output.write(chunk)) await Promise.race([once(output, "drain"), done]);
      yield chunk;
    }
    output.end();
    await done;
  } finally {
    if (!output.writableFinished) output.destroy();
  }
}

export class Saves {
  constructor(readonly store: Store) {}

  async currentState(): Promise<GameState | null> {
    // An unfinished (or interrupted) world build is not a career yet; prepareCareer discards and rebuilds it.
    const row = await this.store.get<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'state' AND NOT EXISTS (SELECT 1 FROM meta WHERE key = 'worldBuild')",
    );
    return row ? JSON.parse(row.value) as GameState : null;
  }

  private async requireState() {
    const state = await this.currentState();
    if (!state)
      throw Object.assign(new GameError("Prepare a new career or load a saved career first."), { status: 409 });
    return state;
  }

  private async buildMarker() {
    return this.store.get<{ value: string }>("SELECT value FROM meta WHERE key = 'worldBuild'");
  }

  /** Empties the world tables (committing in batches inside Store.batched) and keeps the migration marker. */
  private async discardBuild() {
    const marker = await this.store.get<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'appearanceIndexVersion'",
    );
    await this.store.discardWorld();
    if (marker)
      await this.store.run(
        "INSERT INTO meta (key, value) VALUES (?, ?)",
        "appearanceIndexVersion",
        marker.value,
      );
  }

  /**
   * Builds a world in committed batches (short transactions on a small host). meta 'worldBuild' marks it unfinished until the
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
          `SELECT 1 AS present FROM ${tableName(this.store, table)}${table === "meta" ? " WHERE key <> 'appearanceIndexVersion' OR value <> '1'" : ""} LIMIT 1`,
        );
        if (existing)
          throw Object.assign(new GameError("This world contains existing data and cannot be prepared as a new career."), { status: 409 });
      }
      await this.buildWorld({ seed: `touchline-${randomUUID()}` });
      const state = await stateOf(this.store);
      state.director.name = displayName.trim().slice(0, 50) || "Sporting director";
      await this.store.setMeta("state", state);
      await this.store.run("DELETE FROM meta WHERE key = 'worldBuild'");
      // Written last: startCareer reuses a prepared world only when this matches its seed.
      await this.store.setMeta("careerPreparationSeed", state.seed);
      return { created: true };
    });
  }

  async list(): Promise<ListedSaveSlot[]> {
    return (
      await this.store.all<CatalogRow>(
        `SELECT * FROM ${tableName(this.store, "save_slots")} WHERE complete ORDER BY created_at DESC, id DESC`,
      )
    ).map(slotFromRow);
  }

  async deleteCareer(file: string) {
    const id = slotId(file);
    return this.store.transaction(async () => {
      const selected = await this.store.get<CatalogRow>(
        `SELECT * FROM ${tableName(this.store, "save_slots")} WHERE id = ? AND complete FOR UPDATE`,
        id,
      );
      if (!selected) throw Object.assign(new GameError("Save slot not found."), { status: 404 });
      const state = await this.currentState();
      if (selected.career_id && selected.career_id === state?.careerId)
        throw new GameError(
          "The active career cannot be deleted. Load another career first.",
        );
      // Chunks go with their slots (ON DELETE CASCADE).
      const deleted = await this.store.run(
        `DELETE FROM ${tableName(this.store, "save_slots")} WHERE ${selected.career_id ? "career_id = ?" : "id = ?"}`,
        selected.career_id ?? id,
      );
      return {
        deleted: deleted.changes,
        message: selected.career_id
          ? "Career and its saved snapshots deleted."
          : "Save deleted.",
      };
    });
  }

  async deleteActiveCareer(confirmation: DeleteActiveCareerRequest): Promise<DeleteActiveCareerResult> {
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
      // Chunks go with their slots (ON DELETE CASCADE).
      const slots = careerId
        ? (await this.store.run(`DELETE FROM ${tableName(this.store, "save_slots")} WHERE career_id = ?`, careerId)).changes
        : 0;
      const marker = await this.store.get<{ value: string }>(
        "SELECT value FROM meta WHERE key = 'appearanceIndexVersion'",
      );
      await this.store.discardWorld();
      if (marker)
        await this.store.run(
          "INSERT INTO meta (key, value) VALUES (?, ?)",
          "appearanceIndexVersion",
          marker.value,
        );
      return {
        deleted: true,
        careerId,
        snapshots: slots,
        message: "Career deleted. Start a new career or load another saved career.",
      };
    });
  }

  /** `keep` names a save that must survive this save's rotation (the one being loaded); the next oldest goes instead. */
  async create(name: string, automatic = false, keep?: string) {
    saveName(name);
    const kept = keep === undefined ? undefined : slotId(keep);
    return this.store.transaction(async () => {
      const { careerId, career } = await this.slotCareer(automatic);
      const slot = await createSlot(this.store, { name, automatic, career });
      const summary = await writeWorldCheckpoint(
        this.store,
        chunkWriter(this.store, slot.id),
      );
      await completeSlot(this.store, slot, summary);
      await this.rotate(careerId, automatic, slot.id, kept);
      return { file: slot.file, name: slot.name };
    });
  }

  /** Gives the active career an id (and autosave date) before a save; returns its catalog metadata. */
  private async slotCareer(automatic: boolean) {
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
    return {
      careerId: state.careerId,
      career: {
        id: state.careerId,
        name: state.careerName ?? `${state.director.name} at ${club.name}`,
        director: state.director.name,
        club: club.name,
        date: state.date,
        season: state.season,
      },
    };
  }

  private async rotate(careerId: string, automatic: boolean, id: string, kept?: string) {
    const slots = tableName(this.store, "save_slots");
    await this.store.run(
      `DELETE FROM ${slots} WHERE id IN (
         SELECT id FROM ${slots} WHERE automatic = ? AND NOT imported AND complete AND career_id = ?
         ORDER BY CASE WHEN id IN (?, ?) THEN 0 ELSE 1 END, created_at DESC, id DESC
         OFFSET ${automatic ? SAVE_SLOT_LIMITS.automatic : SAVE_SLOT_LIMITS.manual})`,
      automatic,
      careerId,
      id,
      kept ?? id,
    );
  }

  /**
   * The save that already holds exactly this world, so a pre-load archive would only duplicate it. Only a save that
   * outlives a fresh archive qualifies: the career's newest manual save (same position in manual rotation) or an
   * imported one (never rotated). Autosaves rotate after three, so they never stand in for the archive.
   */
  private async unchangedSlot(careerId: string, digest: string) {
    const slots = await this.store.all<Pick<CatalogRow, "id" | "name" | "automatic" | "imported" | "format_version" | "byte_length" | "sha256" | "career_metadata">>(
      `SELECT id,name,automatic,imported,format_version,byte_length,sha256,career_metadata FROM ${tableName(this.store, "save_slots")}
       WHERE complete AND career_id = ?
       ORDER BY created_at DESC, id DESC FOR UPDATE`,
      careerId,
    );
    const newestManual = slots.find((slot) => !slot.automatic && !slot.imported);
    for (const slot of slots) {
      if (
        (slot !== newestManual && !slot.imported) ||
        !UUID.test(slot.id) ||
        slot.format_version !== SAVE_FORMAT_VERSION ||
        !slot.sha256 ||
        storedWorldDigest(slot.career_metadata) !== digest
      )
        continue;
      // Cheap structural check that the chunks are all there; storedChunks re-verifies them on restore.
      const stored = await this.store.get<{ chunks: number; first: number | null; last: number | null; bytes: number | string | null; largest: number | null }>(
        `SELECT count(*) AS chunks, min(ordinal) AS first, max(ordinal) AS last, sum(octet_length(data)) AS bytes,
          max(octet_length(data)) AS largest FROM ${tableName(this.store, "save_chunks")} WHERE save_id = ?`,
        slot.id,
      );
      if (
        stored &&
        stored.chunks > 0 &&
        stored.first === 0 &&
        stored.last === stored.chunks - 1 &&
        Number(stored.bytes) === Number(slot.byte_length) &&
        Number(stored.largest) <= SQL_CHUNK_BYTES
      )
        return { file: `${slot.id.toLowerCase()}.touchline.gz`, name: slot.name };
    }
    return undefined;
  }

  /**
   * The safety save made before loading another career. The world is checkpointed to a local file first; when its
   * digest equals a qualifying save of this career (nothing changed since), that save is returned and no bytes are
   * stored. Otherwise the file is stored as a new manual save, exactly like `create`.
   */
  private async archiveBeforeLoad(name: string, keep: string) {
    saveName(name);
    const kept = slotId(keep);
    const file = temporaryFile();
    try {
      return await this.store.transaction(async () => {
        const { careerId, career } = await this.slotCareer(false);
        const summary = await writeWorldCheckpoint(
          this.store,
          createWriteStream(file, { flags: "wx", mode: 0o600, highWaterMark: SQL_CHUNK_BYTES }),
        );
        const existing = await this.unchangedSlot(careerId, worldDigest(summary));
        if (existing) return existing;
        const slot = await createSlot(this.store, { name, career });
        const measured = measuredStream(SAVE_LIMITS.compressedBytes, "Checkpoint");
        await pipeline(
          createReadStream(file, { highWaterMark: SQL_CHUNK_BYTES }),
          measured.stream,
          chunkWriter(this.store, slot.id),
        );
        const stored = measured.result();
        if (stored.sha256 !== summary.sha256 || stored.byteLength !== summary.byteLength)
          throw new SaveFormatError("The staged checkpoint changed while storing it.");
        await completeSlot(this.store, slot, summary);
        await this.rotate(careerId, false, slot.id, kept);
        return { file: slot.file, name: slot.name };
      });
    } finally {
      await rm(file, { force: true });
    }
  }

  /** Loads a saved career in one transaction, first keeping the active started career in a save. */
  async loadCareer(file: string): Promise<{ archived: string | null }> {
    return this.store.transaction(async () => {
      if (!(await this.list()).some((slot) => slot.file === file))
        throw Object.assign(new GameError("Save slot not found."), { status: 404 });
      const state = await this.currentState();
      const archived = state && state.started !== false
        ? await this.archiveBeforeLoad(`${state.careerName ?? state.director.name} before load`, file)
        : undefined;
      await this.restore(file);
      return { archived: archived?.file ?? null };
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
      ? await this.store.get<{ value: string }>("SELECT value FROM meta WHERE key = 'careerPreparationSeed'")
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
      await this.store.run("DELETE FROM meta WHERE key = 'worldBuild'");
      const state = await stateOf(this.store);
      state.clubId = reusePrepared
        ? input.clubId
        : ((
            await this.store.get<{ id: number }>(
              "SELECT id FROM clubs WHERE type = 'club' AND data::jsonb ->> 'worldKey' = ?",
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
      await this.store.run("DELETE FROM meta WHERE key = 'careerPreparationSeed'");
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
            `SELECT * FROM ${tableName(this.store, "save_slots")} WHERE id = ? AND complete`,
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
      const validated = await this.store.transaction(async () => {
        const slot = await this.store.get<CatalogRow>(
          `SELECT * FROM ${tableName(this.store, "save_slots")} WHERE id = ? AND complete`,
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
        // Validated while it downloads: the staged file is written from exactly the bytes being checked.
        let downloadError: unknown;
        const store = this.store;
        const chunks = async function* () {
          try {
            yield* storedChunks(store, slot);
          } catch (error) {
            downloadError = error;
            throw error;
          }
        };
        let validated: ValidatedWorldCheckpoint;
        try {
          validated = await validateWorldSource(
            this.store,
            Readable.from(writeThrough(temporary, chunks()), { objectMode: false }),
          );
        } catch (error) {
          // A damaged or incomplete chunk set reports as such, as when the download finished before validation.
          throw downloadError ?? error;
        }
        const { summary } = validated;
        if (
          summary.sha256 !== slot.sha256 ||
          summary.byteLength !== Number(slot.byte_length)
        )
          throw new SaveFormatError(
            "Saved checkpoint digest does not match the catalog.",
          );
        return validated;
      });
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
          "Choose a logical .touchline.gz checkpoint. Legacy SQLite saves are no longer supported.",
        );
      throw error;
    } finally {
      await rm(file, { force: true });
    }
  }
}
