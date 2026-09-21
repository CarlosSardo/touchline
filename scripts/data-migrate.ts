import { DatabaseSync, backup } from "node:sqlite";
import { createReadStream, createWriteStream, constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import type { Store } from "../server/db.ts";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { parseArgs } from "node:util";
import type { SaveSlot } from "../shared/api.ts";
import type { GameState } from "../shared/types.ts";
import {
  SAVE_FORMAT_VERSION,
  SAVE_SCHEMA_VERSION,
  SAVE_LIMITS,
  SQL_CHUNK_BYTES,
  SaveFormatError,
  boundedStream,
  identifier,
  readCheckpoint,
  validateCheckpoint,
  writeCheckpoint,
  type CheckpointColumn,
  type CheckpointSchema,
  type CheckpointTable,
  type SourceFile,
  type RestoredValue,
} from "../server/save-format.ts";
import { backupBeforeReplace, isMain, targetInventory } from "./data-export.ts";
import { schemaMigrations } from "../server/sql-schema.ts";

export interface LegacySource {
  file: string;
  active: boolean;
  compressed: boolean;
  modified: string;
  files: SourceFile[];
}

export interface LegacyInventory {
  version: 1;
  active: string;
  roots: string[];
  sources: LegacySource[];
  orphans: SourceFile[];
}

interface MigrationValidation {
  version: 1;
  inventoryHash: string;
  schemaHash: string;
  migrationVersion: number;
  sources: { source: string; sha256: string; tables: unknown }[];
}

const fingerprintOf = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const IMPORT_PROGRESS_KEY = "__touchline_legacy_import";

interface ResumableSource {
  file: string;
  source: string;
  active: boolean;
  options: import("../server/saves.ts").CheckpointSlotOptions;
  validated: import("../server/saves.ts").ValidatedWorldCheckpoint;
  summary: import("../server/save-format.ts").CheckpointSummary;
}

interface ImportProgress {
  version: 1;
  fingerprint: string;
  rows: Record<string, number>;
  slots: Record<string, { file: string; name: string; sha256: string }>;
}

export async function resumableImport(
  initialStore: Store,
  sources: ResumableSource[],
  fingerprint: string,
  verifySources: () => Promise<void>,
  reconnect: () => Promise<Store>,
) {
  const { checkpointSchema, persistCheckpointFile, writeWorldCheckpoint } = await import("../server/saves.ts");
  const active = sources.find((source) => source.active);
  if (!active || sources.filter((source) => source.active).length !== 1)
    throw new Error("Resumable import requires exactly one active world.");
  let store = initialStore;
  let commits = 0;
  const readProgress = async () => {
    const row = await store.get<{ value: string }>("SELECT value FROM meta WHERE [key] = ?", IMPORT_PROGRESS_KEY);
    if (!row) throw new Error("Resumable migration marker is missing.");
    const progress = JSON.parse(row.value) as ImportProgress;
    if (progress.version !== 1 || progress.fingerprint !== fingerprint || !progress.rows || !progress.slots)
      throw new Error("Resumable migration belongs to different source files or schema. Nothing was overwritten.");
    return progress;
  };
  const reconnectStore = async () => {
    await store.close().catch(() => undefined);
    store = await reconnect();
    commits = 0;
  };
  const transient = (error: unknown): boolean => {
    if (error instanceof AggregateError) return error.errors.some(transient);
    if (!(error instanceof Error)) return false;
    const code = "code" in error ? String(error.code) : "";
    return /ETIMEOUT|ESOCKET|ECONNCLOSED|ECONNRESET|ECONNREFUSED|ENOTOPEN/.test(code) ||
      /ETIMEDOUT|ECONNRESET|connection (?:is closed|closed|lost|ended)|LoggedIn state|socket hang up/i.test(error.message) ||
      Boolean(error.cause && transient(error.cause));
  };
  const operation = async <Result>(name: string, action: () => Promise<Result>): Promise<Result> => {
    for (let attempt = 0; ; attempt++) {
      try {
        if (commits >= 40) await reconnectStore();
        const result = await action();
        commits++;
        return result;
      } catch (error) {
        if (attempt >= 2 || !transient(error)) throw error;
        console.error(`[Migration] Reconnecting after ${name}; already committed batches are retained (retry ${attempt + 1}/2).`);
        await reconnectStore();
      }
    }
  };
  try {
    await store.transaction(async () => {
      const marker = await store.get("SELECT value FROM meta WHERE [key] = ?", IMPORT_PROGRESS_KEY);
      if (marker) {
        await readProgress();
        if (await store.get("SELECT value FROM meta WHERE [key] = 'state'"))
          throw new Error("A resumable target must not expose an active career before verification.");
      } else {
        const inventory = await targetInventory(store, true);
        if (inventory.nonempty)
          throw new Error("Resumable import is only allowed into an empty first-time SQL target.");
        await store.run("DELETE FROM meta");
        await store.setMeta(IMPORT_PROGRESS_KEY, {
          version: 1, fingerprint, rows: {}, slots: {},
        } satisfies ImportProgress);
      }
    });
    const schema = await checkpointSchema(store);
    const untrusted = await store.all(
      `SELECT name FROM sys.foreign_keys WHERE schema_id = SCHEMA_ID(?) AND (is_disabled=1 OR is_not_trusted=1)
       UNION ALL SELECT name FROM sys.check_constraints WHERE schema_id = SCHEMA_ID(?) AND (is_disabled=1 OR is_not_trusted=1)`,
      store.schemaName, store.schemaName,
    );
    if (untrusted.length) throw new Error("Resumable import requires all SQL constraints enabled and trusted.");
    console.error("[Migration] Resumable first-time import: committed batches are retained; playable state is withheld until hashes match.");
    for (const source of sources) {
      await migrationStep(`store resumable checkpoint: ${basename(source.source)}`, () =>
        operation("checkpoint upload", () => store.transaction(async () => {
          const progress = await readProgress();
          const existing = progress.slots[source.source];
          if (existing) {
            const saved = await store.get<{ sha256: string; byte_length: string | number }>(
              "SELECT sha256,byte_length FROM save_slots WHERE id=? AND imported=1 AND complete=1",
              existing.file.replace(/\.touchline\.gz$/, ""),
            );
            if (saved?.sha256 !== source.summary.sha256 || Number(saved.byte_length) !== source.summary.byteLength)
              throw new Error("A previously imported snapshot no longer matches its source.");
            return;
          }
          const slot = await persistCheckpointFile(store, source.file, source.options, source.validated);
          progress.slots[source.source] = { ...slot, sha256: source.summary.sha256 };
          await store.setMeta(IMPORT_PROGRESS_KEY, progress);
        })),
      );
    }
    const progress = await readProgress();
    const metadata: Record<string, RestoredValue>[] = [];
    let pending: Record<string, RestoredValue>[] = [];
    let bytes = 0;
    let seen = 0;
    let committed = 0;
    const logRows = tableProgress("committed");
    const flush = async (table: CheckpointTable) => {
      if (!pending.length) return;
      const batch = pending;
      const start = committed;
      const end = start + batch.length;
      await operation(`${table.name} batch ${start}-${end}`, () => store.transaction(async () => {
        const current = await readProgress();
        const cursor = current.rows[table.name] ?? 0;
        if (cursor === end) return;
        if (cursor !== start) throw new Error(`Unexpected committed cursor for ${table.name}; refusing duplicate rows.`);
        await store.bulkInsert(table.name, batch);
        current.rows[table.name] = end;
        await store.setMeta(IMPORT_PROGRESS_KEY, current);
      }));
      committed = end;
      pending = [];
      bytes = 0;
      logRows(table.name, committed, table.rowCount);
    };
    const loaded = await migrationStep("load active world in resumable checked batches", () => readCheckpoint(
      createReadStream(active.file, { highWaterMark: SQL_CHUNK_BYTES }), {
        expected: schema,
        async onTable(table) {
          seen = 0;
          committed = progress.rows[table.name] ?? 0;
          if (!Number.isSafeInteger(committed) || committed < 0 || committed > table.rowCount)
            throw new Error(`Invalid migration cursor for ${table.name}.`);
          if (table.name !== "meta") {
            const count = await operation("resume count check", () => store.get<{ total: string | number }>(
              `SELECT COUNT_BIG(*) AS total FROM [${store.schemaName}].[${table.name}]`,
            ));
            if (Number(count?.total) !== committed)
              throw new Error(`Existing ${table.name} rows do not match the committed migration cursor.`);
          }
          if (committed) console.error(`[Migration] Resume ${table.name}: ${committed}/${table.rowCount} rows already committed.`);
        },
        async onRow(table, values) {
          seen++;
          const row = Object.fromEntries(table.columns.map((column, index) => [column.name, values[index]]));
          if (table.name === "meta") {
            if (row.key === IMPORT_PROGRESS_KEY) throw new Error("Source contains a reserved migration marker.");
            metadata.push(row);
            return;
          }
          if (seen <= committed) return;
          const size = values.reduce<number>((total, value) => total + (typeof value === "string" ? value.length * 2 : Buffer.isBuffer(value) ? value.length : 16), 0);
          if (pending.length && (pending.length >= 1000 || bytes + size > SQL_CHUNK_BYTES)) await flush(table);
          pending.push(row);
          bytes += size;
        },
        async onTableEnd(table) {
          if (table.name !== "meta") {
            await flush(table);
            logRows(table.name, committed, table.rowCount);
          }
        },
      },
    ));
    if (loaded.sha256 !== active.summary.sha256)
      throw new Error("Active checkpoint changed during resumable import; target remains unavailable.");
    await verifySources();
    const finalProgress = await readProgress();
    await migrationStep("verify active world and atomically enable career", () => operation("final verification", async () => {
      if (await store.get("SELECT value FROM meta WHERE [key] = ?", IMPORT_PROGRESS_KEY)) {
        await store.transaction(async () => {
          await readProgress();
          await store.run("DELETE FROM meta");
          await store.bulkInsert("meta", metadata);
          const roundTrip = await writeWorldCheckpoint(store, new Writable({
            write(_chunk, _encoding, callback) { callback(); },
          }), undefined, tableProgress("verify"));
          if (JSON.stringify(roundTrip.tables) !== JSON.stringify(active.summary.tables))
            throw new Error("Active SQL world differs from its checkpoint; playable state was not committed.");
          await verifySources();
        });
      } else {
        const roundTrip = await writeWorldCheckpoint(store, new Writable({
          write(_chunk, _encoding, callback) { callback(); },
        }));
        if (JSON.stringify(roundTrip.tables) !== JSON.stringify(active.summary.tables))
          throw new Error("Ambiguous final commit does not match the expected active world.");
      }
    }));
    return {
      migrated: true, resumable: true, database: store.database, schema: store.schemaName,
      liveSource: active.source, archiveValidation: "format-and-digest",
      activeValidation: "destination-sql-constraints-and-table-hashes",
      slots: Object.entries(finalProgress.slots).map(([source, slot]) => ({ source, ...slot })),
    };
  } finally {
    if (store !== initialStore) await store.close();
  }
}

export function validateMigrationReport(
  report: MigrationValidation,
  inventory: LegacyInventory,
  schema: CheckpointSchema,
  sources: MigrationValidation["sources"],
) {
  if (report.version !== 1 || report.inventoryHash !== fingerprintOf(inventory) ||
    report.schemaHash !== fingerprintOf(schema) ||
    report.migrationVersion !== schemaMigrations("dbo").at(-1)!.version ||
    JSON.stringify(report.sources) !== JSON.stringify(sources))
    throw new Error("Local SQL validation report does not match every current source, checkpoint, and schema.");
}

export interface LegacyColumn {
  name: string;
  type: string;
  notnull: number;
  pk: number;
  hidden?: number;
}

const optionalLegacyTables = new Set([
  "club_support",
  "board_affiliate_requests",
  "unexpected_events",
  "transfer_payments",
  "buy_back_clauses",
  "competition_favorites",
  "discipline",
  "financial_periods",
  "player_assets",
  "registration_records",
  "minor_applications",
  "player_season_stats",
  "player_match_appearances",
]);
const legacyFile = /\.sqlite(?:\.gz)?$/i;
const companionFile = /\.sqlite(?:\.gz)?(?:\.json|-wal|-shm|-journal)$/i;

async function migrationStep<Result>(name: string, action: () => Promise<Result>) {
  const started = performance.now();
  const elapsed = () => `${((performance.now() - started) / 1000).toFixed(1)}s`;
  console.error(`[Migration] START ${name}`);
  const heartbeat = setInterval(() => {
    console.error(`[Migration] RUNNING ${name}; elapsed ${elapsed()}`);
  }, 15_000);
  heartbeat.unref();
  try {
    const result = await action();
    console.error(`[Migration] DONE ${name}; elapsed ${elapsed()}`);
    return result;
  } catch (error) {
    console.error(`[Migration] FAILED ${name}; elapsed ${elapsed()}`);
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

function tableProgress(operation: string) {
  const last = new Map<string, number>();
  return (table: string, rows: number, total: number) => {
    const previous = last.get(table) ?? -15_000;
    if (rows === total || performance.now() - previous >= 15_000) {
      console.error(`[Migration] ${operation} ${table}: ${rows}/${total} rows`);
      last.set(table, performance.now());
    }
  };
}

function reportMigrationError(error: unknown, depth = 0) {
  if (depth > 4) return;
  const message = error instanceof Error ? error.message : String(error);
  const secrets = [process.env.SQL_PASSWORD, process.env.GHCR_TOKEN, process.env.GHCR_PULL_TOKEN, process.env.AUTH_CLIENT_SECRET].filter((value): value is string => Boolean(value));
  console.error(`${"  ".repeat(depth)}${secrets.reduce((text, secret) => text.replaceAll(secret, "[redacted]"), message)}`);
  if (error instanceof AggregateError)
    for (const nested of error.errors) reportMigrationError(nested, depth + 1);
  else if (error instanceof Error && error.cause) reportMigrationError(error.cause, depth + 1);
}

async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

export async function hashFile(
  file: string,
): Promise<SourceFile & { modified: string }> {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink())
    throw new Error(`Expected a regular, non-symlink file: ${file}`);
  if (before.size > SAVE_LIMITS.expandedBytes)
    throw new Error(`Source exceeds the 64 GiB limit: ${file}`);
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file, {
    highWaterMark: SQL_CHUNK_BYTES,
  })) {
    bytes += chunk.length;
    if (bytes > SAVE_LIMITS.expandedBytes)
      throw new Error(`Source grew beyond its limit: ${file}`);
    hash.update(chunk);
  }
  const after = await lstat(file);
  if (
    before.ino !== after.ino ||
    before.dev !== after.dev ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs ||
    bytes !== before.size
  )
    throw new Error(
      `Source changed while being read: ${file}. Stop legacy writers and retry.`,
    );
  return {
    name: file,
    bytes,
    sha256: hash.digest("hex"),
    modified: before.mtime.toISOString(),
  };
}

async function walk(directory: string, files: Set<string>) {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(
      `Use a real legacy save directory, not a symlink: ${directory}`,
    );
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Inventory refuses symbolic links: ${file}`);
    if (entry.isDirectory()) await walk(file, files);
    else if (legacyFile.test(entry.name) || companionFile.test(entry.name))
      files.add(file);
  }
}

export async function inventoryLegacy(
  active: string,
  roots: string[],
): Promise<LegacyInventory> {
  active = resolve(active);
  if (!legacyFile.test(active))
    throw new Error(
      "--source must be a .sqlite or .sqlite.gz legacy database.",
    );
  if (!roots.length)
    throw new Error(
      "Supply at least one --saves directory so legacy snapshots are inventoried.",
    );
  const candidates = new Set<string>([active]);
  const directories = [...new Set(roots.map((root) => resolve(root)))].sort();
  for (const root of directories) await walk(root, candidates);
  const databases = [...candidates]
    .filter((file) => legacyFile.test(file))
    .sort();
  const used = new Set<string>();
  const sources: LegacySource[] = [];
  for (const file of databases) {
    const primary = await hashFile(file);
    const compressed = /\.gz$/i.test(file);
    if (compressed && primary.bytes > SAVE_LIMITS.compressedBytes)
      throw new Error(`Compressed source exceeds 16 GiB: ${file}`);
    const files: SourceFile[] = [
      { name: primary.name, bytes: primary.bytes, sha256: primary.sha256 },
    ];
    used.add(file);
    for (const suffix of [".json", "-wal", "-shm", "-journal"]) {
      const companion = `${file}${suffix}`;
      if (!(await exists(companion))) continue;
      const entry = await hashFile(companion);
      files.push({
        name: entry.name,
        bytes: entry.bytes,
        sha256: entry.sha256,
      });
      used.add(companion);
    }
    sources.push({
      file,
      active: file === active,
      compressed,
      modified: primary.modified,
      files,
    });
  }
  const orphans: SourceFile[] = [];
  for (const file of [...candidates].sort()) {
    if (used.has(file)) continue;
    const entry = await hashFile(file);
    orphans.push({
      name: entry.name,
      bytes: entry.bytes,
      sha256: entry.sha256,
    });
  }
  return { version: 1, active, roots: directories, sources, orphans };
}

export function reconcileLegacyTable(
  name: string,
  source: LegacyColumn[],
  target: CheckpointColumn[],
) {
  identifier(name);
  if (!source.length || source.some((column) => column.hidden))
    throw new SaveFormatError(`Unsupported legacy table layout: ${name}.`);
  const targetNames = new Set(target.map((column) => column.name));
  for (const column of source) {
    identifier(column.name);
    if (!targetNames.has(column.name))
      throw new SaveFormatError(
        `Unknown legacy column: ${name}.${column.name}.`,
      );
  }
  const additions: { table: string; column: string; value: null }[] = [];
  for (const column of target) {
    const legacy = source.find((item) => item.name === column.name);
    if (!legacy) {
      if (
        name === "players" &&
        column.name === "squad_club_id" &&
        column.type === "int" &&
        column.nullable
      )
        additions.push({ table: name, column: column.name, value: null });
      else
        throw new SaveFormatError(
          `Missing required legacy column: ${name}.${column.name}.`,
        );
      continue;
    }
    const type = legacy.type.trim().toUpperCase();
    const compatible =
      (type === "INTEGER" &&
        ["int", "bigint", "smallint", "tinyint", "bit", "float"].includes(
          column.type,
        )) ||
      (type === "REAL" && column.type === "float") ||
      (type === "TEXT" &&
        ["nvarchar", "nchar", "varchar", "char"].includes(column.type)) ||
      (type === "BLOB" && ["varbinary", "binary"].includes(column.type));
    if (!compatible)
      throw new SaveFormatError(
        `Incompatible legacy type: ${name}.${column.name} (${type} -> ${column.type}).`,
      );
  }
  return additions;
}

function sqliteName(name: string) {
  return `"${identifier(name)}"`;
}

async function consistentCopy(source: LegacySource, directory: string) {
  const staged = join(directory, `${randomUUID()}.source.sqlite`);
  const snapshot = join(directory, `${randomUUID()}.consistent.sqlite`);
  const journal = source.files.find(
    (file) => file.name.endsWith("-journal") && file.bytes > 0,
  );
  if (journal)
    throw new Error(
      `A rollback journal is present: ${journal.name}. Close and recover the legacy application before conversion.`,
    );
  if (source.compressed) {
    if (source.files.some((file) => /-(wal|shm|journal)$/.test(file.name)))
      throw new Error(
        `A compressed source has unsupported SQLite companions: ${source.file}`,
      );
    await pipeline(
      createReadStream(source.file, { highWaterMark: SQL_CHUNK_BYTES }),
      boundedStream(SAVE_LIMITS.compressedBytes, "Legacy compressed file"),
      createGunzip({ chunkSize: SQL_CHUNK_BYTES }),
      boundedStream(SAVE_LIMITS.expandedBytes, "Legacy database"),
      createWriteStream(staged, { flags: "wx", mode: 0o600 }),
    );
  } else {
    for (const file of source.files) {
      if (file.name.endsWith(".json")) continue;
      const suffix = file.name.slice(source.file.length);
      await copyFile(file.name, `${staged}${suffix}`, constants.COPYFILE_EXCL);
      const copied = await hashFile(`${staged}${suffix}`);
      if (copied.sha256 !== file.sha256 || copied.bytes !== file.bytes)
        throw new Error(
          `Source changed while staging: ${file.name}. No SQL changes were made.`,
        );
    }
  }
  const header = await open(staged, "r");
  try {
    const signature = Buffer.alloc(16);
    await header.read(signature, 0, 16, 0);
    if (signature.toString() !== "SQLite format 3\0")
      throw new Error(`Not a legacy SQLite database: ${source.file}`);
  } finally {
    await header.close();
  }
  const readOnly = new DatabaseSync(staged, { readOnly: true });
  try {
    await backup(readOnly, snapshot, { rate: 4096 });
  } finally {
    readOnly.close();
  }
  return snapshot;
}

function readLegacyState(database: DatabaseSync) {
  const version = database
    .prepare("SELECT value FROM meta WHERE key = 'schemaVersion'")
    .get() as { value: string } | undefined;
  if (!version || JSON.parse(version.value) !== SAVE_SCHEMA_VERSION)
    throw new Error("Unsupported legacy schema version.");
  const row = database
    .prepare("SELECT value FROM meta WHERE key = 'state'")
    .get() as { value: string } | undefined;
  if (!row) throw new Error("Legacy database has no active career state.");
  const state = JSON.parse(row.value) as GameState;
  if (
    !state ||
    !Number.isSafeInteger(state.clubId) ||
    state.clubId < 1 ||
    typeof state.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(state.date) ||
    !Number.isFinite(Date.parse(state.date)) ||
    new Date(state.date).toISOString().slice(0, 10) !== state.date ||
    !Number.isSafeInteger(state.season) ||
    typeof state.seed !== "string" ||
    typeof state.director?.name !== "string"
  )
    throw new Error("Invalid legacy career state.");
  for (const key of ["settings", "world"]) {
    const row = database
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get(key) as { value: string } | undefined;
    const value: unknown = row ? JSON.parse(row.value) : null;
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`Invalid legacy ${key} metadata.`);
  }
  return state;
}

function legacySlot(
  database: DatabaseSync,
  source: LegacySource,
  state: GameState,
  rawSidecar?: string,
) {
  const sidecar: unknown =
    rawSidecar === undefined ? {} : JSON.parse(rawSidecar);
  if (!sidecar || typeof sidecar !== "object" || Array.isArray(sidecar))
    throw new Error("Legacy sidecar must be an object.");
  const metadata = sidecar as { name?: unknown; career?: unknown };
  if (metadata.name !== undefined && typeof metadata.name !== "string")
    throw new Error("Invalid legacy save name.");
  const fallback = basename(source.file)
    .replace(/_\d{4}-\d{2}-\d{2}_\d+\.sqlite(?:\.gz)?$/i, "")
    .replace(/\.sqlite(?:\.gz)?$/i, "")
    .replaceAll("_", " ");
  const name =
    (metadata.name as string | undefined) ??
    (source.active ? (state.careerName ?? "Imported live career") : fallback);
  if (!name.trim() || name.length > 200)
    throw new Error(
      "Legacy save name exceeds the SQL catalog limit; it will not be truncated.",
    );
  let career: SaveSlot["career"];
  if (metadata.career !== undefined) {
    if (
      !metadata.career ||
      typeof metadata.career !== "object" ||
      Array.isArray(metadata.career)
    )
      throw new Error("Invalid legacy career sidecar.");
    const fields = metadata.career as Record<string, unknown>;
    for (const key of ["id", "name", "director", "club", "date"])
      if (typeof fields[key] !== "string")
        throw new Error(`Invalid legacy career field: ${key}.`);
    if (
      !fields.id ||
      String(fields.id).length > 100 ||
      !Number.isSafeInteger(fields.season)
    )
      throw new Error("Invalid legacy career identifier or season.");
    if (state.careerId && fields.id !== state.careerId)
      throw new Error(
        "Legacy sidecar and database disagree about career identity.",
      );
    career = metadata.career as SaveSlot["career"];
  } else if (state.careerId) {
    if (typeof state.careerId !== "string" || state.careerId.length > 100)
      throw new Error("Invalid legacy career identifier.");
    const club = database
      .prepare("SELECT name FROM clubs WHERE id = ?")
      .get(state.clubId) as { name: string } | undefined;
    if (!club) throw new Error("Legacy active club is missing.");
    career = {
      id: state.careerId,
      name: state.careerName ?? state.director.name,
      director: state.director.name,
      club: club.name,
      date: state.date,
      season: state.season,
    };
  }
  return {
    name,
    career,
    automatic: basename(source.file).startsWith("autosave_"),
    imported: true,
    createdAt: source.modified,
  };
}

export async function convertLegacy(
  source: LegacySource,
  schema: CheckpointSchema,
  directory: string,
) {
  const sourceDirectory = await mkdtemp(join(directory, "source-"));
  let database: DatabaseSync | undefined;
  const file = join(directory, `${randomUUID()}.touchline.gz`);
  try {
    const snapshot = await consistentCopy(source, sourceDirectory);
    database = new DatabaseSync(snapshot, { readOnly: true });
    const checks = database.prepare("PRAGMA quick_check").all() as {
      quick_check: string;
    }[];
    if (checks.length !== 1 || checks[0].quick_check !== "ok")
      throw new Error("Legacy SQLite integrity check failed.");
    if (database.prepare("PRAGMA foreign_key_check").get())
      throw new Error("Legacy SQLite foreign keys are invalid.");
    const objects = database
      .prepare(
        "SELECT name,type FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'",
      )
      .all() as { name: string; type: string }[];
    const known = new Set(schema.tables.map((table) => table.name));
    for (const object of objects) {
      if (object.type === "table" && !known.has(object.name))
        throw new Error(
          `Unknown legacy table: ${object.name}. Nothing will be discarded.`,
        );
      if (
        object.type === "view" ||
        (object.type === "trigger" && object.name !== "clear_transferred_squad")
      )
        throw new Error(
          `Unsupported legacy schema object: ${object.type} ${object.name}.`,
        );
    }
    const present = new Set(
      objects
        .filter((object) => object.type === "table")
        .map((object) => object.name),
    );
    const missingTables: string[] = [];
    const addedColumns: { table: string; column: string; value: null }[] = [];
    const layouts = new Map<string, LegacyColumn[]>();
    const tables: CheckpointTable[] = [];
    for (const table of schema.tables) {
      if (!present.has(table.name)) {
        if (!optionalLegacyTables.has(table.name))
          throw new Error(`Missing required legacy table: ${table.name}.`);
        missingTables.push(table.name);
        tables.push({ ...table, rowCount: 0 });
        continue;
      }
      const columns = database
        .prepare(`PRAGMA table_xinfo(${sqliteName(table.name)})`)
        .all() as unknown as LegacyColumn[];
      addedColumns.push(
        ...reconcileLegacyTable(table.name, columns, table.columns),
      );
      if (!columns.some((column) => column.pk))
        throw new Error(`Legacy table has no primary key: ${table.name}.`);
      layouts.set(table.name, columns);
      const statement = database.prepare(
        `SELECT COUNT(*) AS total FROM ${sqliteName(table.name)}`,
      );
      statement.setReadBigInts(true);
      const rowCount = Number((statement.get() as { total: bigint }).total);
      if (!Number.isSafeInteger(rowCount) || rowCount > SAVE_LIMITS.rows)
        throw new Error(`Legacy table exceeds row limits: ${table.name}.`);
      tables.push({ ...table, rowCount });
    }
    const state = readLegacyState(database);
    const sidecar = source.files.find(
      (item) => item.name === `${source.file}.json`,
    );
    if (sidecar && sidecar.bytes > SQL_CHUNK_BYTES)
      throw new Error("Legacy sidecar exceeds its 1 MiB limit.");
    const rawSidecar = sidecar
      ? new TextDecoder("utf-8", { fatal: true }).decode(
          await readFile(sidecar.name),
        )
      : undefined;
    const options = legacySlot(database, source, state, rawSidecar);
    const consistent = await hashFile(snapshot);
    const summary = await writeCheckpoint(
      createWriteStream(file, {
        flags: "wx",
        mode: 0o600,
        highWaterMark: SQL_CHUNK_BYTES,
      }),
      {
        kind: "manifest",
        format: "touchline",
        formatVersion: SAVE_FORMAT_VERSION,
        schemaVersion: schema.version,
        createdAt: source.modified,
        tables,
        provenance: {
          source: source.file,
          sourceSha256: source.files[0].sha256,
          sidecar: rawSidecar,
          files: [
            ...source.files,
            {
              name: `${source.file}#consistent-backup`,
              bytes: consistent.bytes,
              sha256: consistent.sha256,
            },
          ],
        },
      },
      function* rows(table) {
        const columns = layouts.get(table.name);
        if (!columns) return;
        const order = columns
          .filter((column) => column.pk)
          .sort((left, right) => left.pk - right.pk)
          .map(
            (column) =>
              `${sqliteName(column.name)}${column.type.trim().toUpperCase() === "TEXT" ? " COLLATE BINARY" : ""}`,
          )
          .join(",");
        const statement = database!.prepare(
          `SELECT ${columns.map((column) => sqliteName(column.name)).join(",")} FROM ${sqliteName(table.name)} ORDER BY ${order}`,
        );
        statement.setReadBigInts(true);
        const available = new Set(columns.map((column) => column.name));
        for (const row of statement.iterate())
          yield table.columns.map((column) =>
            available.has(column.name) ? row[column.name] : null,
          );
      },
    );
    const validated = await validateCheckpoint(
      createReadStream(file, { highWaterMark: SQL_CHUNK_BYTES }),
      schema,
    );
    if (validated.sha256 !== summary.sha256)
      throw new Error("Converted checkpoint verification failed.");
    return {
      file,
      source: source.file,
      active: source.active,
      options,
      summary,
      reconciliation: { missingTables, addedColumns },
      sourceSnapshotSha256: consistent.sha256,
    };
  } catch (error) {
    await rm(file, { force: true });
    throw new Error(
      `${source.file}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    try {
      database?.close();
    } finally {
      await rm(sourceDirectory, { recursive: true, force: true });
    }
  }
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      help: { type: "boolean" },
      source: { type: "string" },
      saves: { type: "string", multiple: true },
      database: { type: "string" },
      "dry-run": { type: "boolean" },
      apply: { type: "boolean" },
      yes: { type: "boolean" },
      replace: { type: "boolean" },
      backup: { type: "string" },
      "staging-dir": { type: "string" },
      "validate-local": { type: "boolean" },
      "validation-report": { type: "string" },
      "archive-format-only": { type: "boolean" },
      resumable: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: tsx scripts/data-migrate.ts --source <active.sqlite> --saves <directory> [--saves <another>] [--dry-run]\n       Add --apply --yes [--database NAME] to convert and import after explicit db-migrate.\n       --staging-dir DIR retains checksum-bound conversions for retries.\n       --validate-local --staging-dir DIR --validation-report NEW.json validates all worlds in disposable loopback SQL schemas.\n       --apply --yes --validation-report FILE.json uses a matching local report for archives; the active world is still restored and reconciled on the destination.\n       A nonempty SQL target additionally requires --replace --backup <new-file.touchline.gz>.\nDry-run (the default) only reads/hashes every legacy file and sidecar; reports JSON to stdout, does not connect to SQL or write temporary files.\nStop legacy writers first. Apply validates read-only temporary SQLite backups, including WAL, before SQL changes; unknown schema/data fails closed.\nOriginals are never opened by SQLite or modified. Every source becomes an imported SQL checkpoint and --source becomes the live world. Existing SQL catalog entries remain. Uses SQL_* connection settings.",
    );
    return;
  }
  if (values.apply && values["dry-run"])
    throw new Error("Choose --apply or --dry-run, not both.");
  if (values.resumable && (!values.apply || !values.yes || !values["archive-format-only"] || !values["staging-dir"] || values.replace))
    throw new Error("--resumable requires --apply --yes --archive-format-only --staging-dir and forbids replacement of an existing career.");
  if (values["archive-format-only"] &&
    (!values.apply || !values.yes || values["validate-local"] || values["validation-report"]))
    throw new Error("--archive-format-only requires --apply --yes and cannot be combined with local preflight/report options.");
  if (values["validate-local"] && (values.apply || values["dry-run"]))
    throw new Error("Local validation is separate from apply and inventory-only modes.");
  if (values["validate-local"] && (!values["staging-dir"] || !values["validation-report"]))
    throw new Error("Local validation requires --staging-dir and a new --validation-report path.");
  if (!values.source)
    throw new Error("Supply --source <active.sqlite> and --saves <directory>.");
  if (values.apply && !values.yes)
    throw new Error("Legacy migration requires --apply --yes.");
  const inventory = await migrationStep("inventory and checksum original files", () =>
    inventoryLegacy(values.source!, values.saves ?? []),
  );
  if (!values.apply && !values["validate-local"]) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          inventory,
          compatible: null,
          note: "Read-only file inventory only. Typed reconciliation and SQLite integrity checks run on temporary copies during apply, before SQL writes.",
        },
        null,
        2,
      ),
    );
    return;
  }
  if (inventory.orphans.length)
    throw new Error(
      "Orphan legacy sidecars or journals were found. Resolve them before migration; none will be silently discarded.",
    );
  const { Store } = await import("../server/db.ts");
  const {
    checkpointSchema,
    persistCheckpointFile,
    restoreCheckpointFile,
    validateWorldCheckpoint,
    writeWorldCheckpoint,
  } = await import("../server/saves.ts");
  if (values["validate-local"] && !["127.0.0.1", "localhost", "::1"].includes(process.env.SQL_SERVER ?? ""))
    throw new Error("--validate-local requires a loopback SQL Server through npm run test:local.");
  const store = values["validate-local"]
    ? await Store.createTest("migration_preflight")
    : await Store.open(values.database);
  let temporary: string | undefined;
  try {
    const existing = await targetInventory(store);
    const resumableMarker = values.resumable && await store.get("SELECT value FROM meta WHERE [key] = ?", IMPORT_PROGRESS_KEY);
    if (existing.nonempty && !resumableMarker && (!values.replace || !values.backup))
      throw new Error(
        "The SQL target is nonempty. Supply --replace --yes --backup <new-file.touchline.gz>; otherwise nothing is overwritten.",
      );
    const schema = await checkpointSchema(store);
    if (values["staging-dir"]) {
      temporary = resolve(values["staging-dir"]);
      await mkdir(temporary, { recursive: true, mode: 0o700 });
    } else temporary = await mkdtemp(join(tmpdir(), "touchline-migration-"));
    const converted: (Awaited<ReturnType<typeof convertLegacy>> & {
      validated: Awaited<ReturnType<typeof validateWorldCheckpoint>>;
    })[] = [];
    for (const source of inventory.sources) {
      console.error(
        `Validating legacy source ${converted.length + 1}/${inventory.sources.length}: ${basename(source.file)}`,
      );
      const fingerprint = createHash("sha256").update(JSON.stringify({ source, schema })).digest("hex");
      const metadataPath = join(temporary, `${fingerprint}.json`);
      let checkpoint: Awaited<ReturnType<typeof convertLegacy>>;
      if (values["staging-dir"] && await exists(metadataPath)) {
        checkpoint = JSON.parse(await readFile(metadataPath, "utf8"));
        if (checkpoint.source !== source.file ||
          !resolve(checkpoint.file).startsWith(`${temporary}/`) ||
          !/^[a-f0-9-]{36}\.touchline\.gz$/.test(basename(checkpoint.file)))
          throw new Error("Invalid staged checkpoint metadata; refusing to use it.");
        console.error(`[Migration] Reusing converted checkpoint for ${basename(source.file)}; source/schema fingerprint matches.`);
      } else {
        checkpoint = await migrationStep(`convert ${basename(source.file)}`, () =>
          convertLegacy(source, schema, temporary!),
        );
        if (values["staging-dir"])
          await writeFile(metadataPath, JSON.stringify(checkpoint), { mode: 0o600, flag: "wx" });
      }
      const validated = await migrationStep(`validate ${basename(source.file)}`, () =>
        validateWorldCheckpoint(store, checkpoint.file),
      );
      if (validated.summary.sha256 !== checkpoint.summary.sha256)
        throw new Error("Converted checkpoint changed; refusing to import it.");
      converted.push({ ...checkpoint, validated });
    }
    const active = converted.find((checkpoint) => checkpoint.active);
    if (!active)
      throw new Error("The active database is missing from the inventory.");
    if (values.resumable) {
      const result = await resumableImport(store, converted,
        fingerprintOf({ inventory, schema, sources: converted.map((source) => source.summary.sha256) }),
        async () => {
          const after = await inventoryLegacy(inventory.active, inventory.roots);
          if (JSON.stringify(after) !== JSON.stringify(inventory))
            throw new Error("Original sources changed; the resumable target remains unavailable.");
        },
        () => Store.open(values.database),
      );
      console.log(JSON.stringify({ ...result, inventory }, null, 2));
      return;
    }
    const summaries = converted.map((checkpoint) => ({
      source: checkpoint.source,
      sha256: checkpoint.summary.sha256,
      tables: checkpoint.summary.tables,
    }));
    const verifyWorld = async (checkpoint: (typeof converted)[number], target = store) => {
      const label = basename(checkpoint.source);
      await migrationStep(`restore and check SQL constraints: ${label}`, () =>
        restoreCheckpointFile(target, checkpoint.file, false, checkpoint.validated, tableProgress(`restore ${label}`)),
      );
      const roundTrip = await migrationStep(`compare SQL table counts and hashes: ${label}`, () =>
        writeWorldCheckpoint(target, new Writable({
          write(_chunk, _encoding, callback) { callback(); },
        }), undefined, tableProgress(`verify ${label}`)),
      );
      if (JSON.stringify(roundTrip.tables) !== JSON.stringify(checkpoint.summary.tables))
        throw new Error(`SQL round-trip counts or digests differ for ${label}.`);
    };
    if (values["validate-local"]) {
      if (store.database !== "touchline_checks")
        throw new Error("Local migration preflight must run through npm run test:local.");
      const peer = await Store.createTest("migration_preflight_peer", "touchline_checks_migration_peer");
      let cursor = 0;
      const worker = async (target: typeof store) => {
        for (;;) {
          const checkpoint = converted[cursor++];
          if (!checkpoint) return;
          try {
            await target.transaction(() => verifyWorld(checkpoint, target));
          } catch (error) {
            reportMigrationError(error);
            throw error;
          }
        }
      };
      try {
        const checks = await Promise.allSettled([worker(store), worker(peer)]);
        const errors = checks.filter((result): result is PromiseRejectedResult => result.status === "rejected");
        if (errors.length) throw new AggregateError(errors.map((result) => result.reason), "Local checkpoint preflight failed.");
      } finally {
        await peer.close();
      }
      const after = await inventoryLegacy(inventory.active, inventory.roots);
      if (JSON.stringify(after) !== JSON.stringify(inventory))
        throw new Error("Original sources changed during local SQL validation.");
      const report: MigrationValidation = {
        version: 1,
        inventoryHash: fingerprintOf(inventory),
        schemaHash: fingerprintOf(schema),
        migrationVersion: schemaMigrations("dbo").at(-1)!.version,
        sources: summaries,
      };
      await writeFile(values["validation-report"]!, JSON.stringify(report, null, 2), { mode: 0o600, flag: "wx" });
      console.log(JSON.stringify({ validated: true, sources: summaries.length, report: values["validation-report"], azureChanged: false }));
      return;
    }
    let archivePreflight = Boolean(values["archive-format-only"]);
    if (values["archive-format-only"])
      console.error("[Migration] Explicit archive format/digest validation selected; archived worlds will not be restored. The active world still requires destination SQL constraints and exact table hash reconciliation.");
    if (values["validation-report"]) {
      const report = JSON.parse(await readFile(values["validation-report"], "utf8"));
      validateMigrationReport(report, inventory, schema, summaries);
      archivePreflight = true;
      console.error("[Migration] All archive constraints and row hashes verified by matching local SQL report; active world will also be restored and compared on Azure.");
    }
    const result = await store.transaction(async () => {
      const previous = await backupBeforeReplace(store, values);
      const slots: {
        source: string;
        file: string;
        name: string;
        sha256: string;
      }[] = [];
      const ordered = [...converted.filter((checkpoint) => !checkpoint.active), active];
      for (const checkpoint of ordered) {
        const label = basename(checkpoint.source);
        if (!archivePreflight || checkpoint.active) await verifyWorld(checkpoint);
        const slot = await migrationStep(`store imported checkpoint: ${label}`, () =>
          persistCheckpointFile(
            store,
            checkpoint.file,
            checkpoint.options,
            checkpoint.validated,
          ),
        );
        slots.push({
          source: checkpoint.source,
          ...slot,
          sha256: checkpoint.summary.sha256,
        });
      }
      const after = await migrationStep("confirm originals are unchanged before committing", () =>
        inventoryLegacy(inventory.active, inventory.roots),
      );
      if (JSON.stringify(after) !== JSON.stringify(inventory))
        throw new Error(
          "Legacy source inventory changed during migration. All SQL changes will be rolled back; stop legacy writers and retry.",
        );
      return {
        migrated: true,
        database: store.database,
        schema: store.schemaName,
        backup: previous.backup,
        liveSource: active.source,
        archiveValidation: values["validation-report"] ? "local-sql-report" : values["archive-format-only"] ? "format-and-digest" : "destination-sql",
        activeValidation: "destination-sql-constraints-and-table-hashes",
        slots,
        inventory,
        reconciliation: converted.map((checkpoint) => ({
          source: checkpoint.source,
          ...checkpoint.reconciliation,
          consistentSourceSha256: checkpoint.sourceSnapshotSha256,
          tables: checkpoint.summary.tables,
        })),
      };
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    try {
      await store.close();
    } finally {
      if (temporary && !values["staging-dir"])
        await rm(temporary, { recursive: true, force: true });
      else if (temporary)
        console.error(`[Migration] Verified staging files retained at ${temporary} for retry/recovery; originals remain untouched.`);
    }
  }
}

if (isMain(import.meta.url))
  void main().catch((error: unknown) => {
    reportMigrationError(error);
    process.exitCode = 1;
  });
