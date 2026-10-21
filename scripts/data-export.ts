import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createGunzip } from "node:zlib";
import type { Store } from "../server/db.ts";
import {
  validateCheckpoint,
  type CheckpointSummary,
} from "../server/save-format.ts";
import { sqlLiteral, tableName } from "../server/sql-schema.ts";

const SCHEMA_NAME = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;
const masked = (text: string) => text.replace(/(touchline_user_)([a-z0-9]{4})[a-z0-9_]*([a-z0-9]{4})/gi, "$1$2***$3");

export function isMain(moduleUrl: string) {
  return Boolean(
    process.argv[1] &&
    pathToFileURL(resolve(process.argv[1])).href === moduleUrl,
  );
}

export interface ReplacementOptions {
  replace?: boolean;
  yes?: boolean;
  backup?: string;
}

/** Row counts of the world and snapshot tables; inside a Store transaction the world writer lock keeps them current. */
export async function targetInventory(store: Store) {
  const { checkpointSchema } = await import("../server/saves.ts");
  const schema = await checkpointSchema(store);
  const names = [...schema.tables.map((table) => table.name), "save_slots", "save_chunks"];
  const counts = new Map((await store.all<{ name: string; total: number }>(
    names.map((name) => `SELECT ${sqlLiteral(name)} AS name, count(*) AS total FROM ${tableName(store.schemaName, name)}`)
      .join(" UNION ALL "),
  )).map((row) => [row.name, Number(row.total)]));
  const tables = names.map((name) => {
    const rows = counts.get(name);
    if (rows === undefined || !Number.isSafeInteger(rows) || rows < 0)
      throw new Error("Invalid target row count.");
    return { name, rows };
  });
  let nonempty = tables.some((table) => table.rows > 0);
  if (
    nonempty &&
    tables.every((table) => table.rows === (table.name === "meta" ? 1 : 0))
  ) {
    const marker = await store.get<{ key: string; value: string }>(
      `SELECT key, value FROM ${tableName(store.schemaName, "meta")}`,
    );
    nonempty = marker?.key !== "appearanceIndexVersion" || marker.value !== "1";
  }
  return {
    database: store.database,
    schema: store.schemaName,
    nonempty,
    tables,
  };
}

export async function exportData(
  store: Store,
  output: string,
): Promise<CheckpointSummary & { file: string }> {
  const file = resolve(output);
  if (!file.endsWith(".touchline.gz"))
    throw new Error("Export and backup paths must end with .touchline.gz.");
  const { writeWorldCheckpoint, checkpointSchema } =
    await import("../server/saves.ts");
  const handle = await open(file, "wx", 0o600);
  try {
    const summary = await writeWorldCheckpoint(
      store,
      handle.createWriteStream(),
    );
    const check = await validateCheckpoint(
      createReadStream(file),
      await checkpointSchema(store),
    );
    if (
      check.sha256 !== summary.sha256 ||
      check.byteLength !== summary.byteLength
    )
      throw new Error("Export verification failed.");
    const persisted = await open(file, "r");
    try {
      await persisted.sync();
    } finally {
      await persisted.close();
    }
    return { ...summary, file };
  } catch (error) {
    await handle.close();
    await rm(file, { force: true });
    throw error;
  } finally {
    await handle.close();
  }
}

/** Call inside store.transaction(): its world writer lock keeps the inventory and the backup consistent. */
export async function backupBeforeReplace(
  store: Store,
  options: ReplacementOptions,
) {
  const inventory = await targetInventory(store);
  if (!inventory.nonempty) return { inventory, backup: null };
  if (!options.replace || !options.yes || !options.backup)
    throw new Error(
      "The SQL target is nonempty. Refusing replacement without --replace --yes --backup <new-file.touchline.gz>. Existing saved checkpoints are never cleared.",
    );
  const backup = await exportData(store, options.backup);
  return {
    inventory,
    backup: {
      file: backup.file,
      sha256: backup.sha256,
      bytes: backup.byteLength,
    },
  };
}

export interface EverythingOptions {
  outDir: string;
  accountSchema?: string;
  snapshots?: boolean;
  log?: (line: string) => void;
}

interface BackupItem {
  kind: "registry" | "world" | "snapshot";
  schema: string;
  file: string;
  bytes: number;
  sha256: string;
  /** Rows per table (world checkpoints) or accounts (registry). */
  rows?: Record<string, number>;
}

interface BackupManifest {
  format: "touchline-backup";
  version: 1;
  database: string;
  startedAt: string;
  updatedAt: string;
  complete: boolean;
  items: Record<string, BackupItem>;
  failures: Record<string, string>;
}

const RESTORE_NOTE = `Touchline full backup (npm run data:export -- --everything).
manifest.json lists every file with its byte length and SHA-256; "complete": true means nothing failed.
<schema>/world.touchline.gz is that schema's live world; <schema>/snapshots/<id>.touchline.gz are its saved
checkpoints, described in <schema>/snapshots.json. accounts-users.json is the account registry (accounts and access
requests): personal data, keep it private and never commit it. The world reset keeps the registry in PostgreSQL, so it is
evidence, not a restore input.
To restore a world or snapshot:
  1. Use a Touchline build with the same save schema version as the checkpoints (npm ci).
  2. Point SQL_* at the PostgreSQL database and SQL_SCHEMA at the schema, then npm run db:migrate.
  3. Start that build and use Saves -> Import for world.touchline.gz or any snapshot, then load it.
Re-running the same command with the same --out-dir resumes: finished files are kept, partial files are redone.
Check a copy offline (no SQL): npm run data:export -- --verify <this directory>
`;

async function writeJson(file: string, value: unknown) {
  const partial = `${file}.partial`;
  await writeFile(partial, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(partial, file);
}

async function hashFile(file: string) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file) as AsyncIterable<Buffer>) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest("hex") };
}

/** Every world schema, snapshot and the account registry to local files; re-runs resume from manifest.json. */
export async function exportEverything(root: Store, options: EverythingOptions) {
  const started = performance.now();
  const log = options.log ?? ((line: string) => console.error(line));
  const directory = resolve(options.outDir);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const manifestFile = join(directory, "manifest.json");
  const previous = await readFile(manifestFile, "utf8").then((text) => JSON.parse(text) as BackupManifest, () => undefined);
  if (previous && (previous.format !== "touchline-backup" || previous.database !== root.database))
    throw new Error("The output directory holds a different backup; choose a new --out-dir.");
  const manifest: BackupManifest = previous ?? {
    format: "touchline-backup",
    version: 1,
    database: root.database,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    complete: false,
    items: {},
    failures: {},
  };
  manifest.failures = {};
  await writeFile(join(directory, "RESTORE.txt"), RESTORE_NOTE, { mode: 0o600 });
  const save = async () => {
    manifest.updatedAt = new Date().toISOString();
    await writeJson(manifestFile, manifest);
  };
  const done = async (key: string) => {
    const item = manifest.items[key];
    if (!item) return false;
    const actual = await stat(join(directory, item.file)).then((info) => info.size, () => -1);
    if (actual === item.bytes) return true;
    delete manifest.items[key];
    return false;
  };
  const record = async (key: string, item: BackupItem) => {
    manifest.items[key] = item;
    await save();
    log(`Backed up ${masked(key)} (${Math.round(item.bytes / 1024)} KB).`);
  };
  const attempt = async (key: string, work: () => Promise<void>) => {
    try {
      if (!(await done(key))) await work();
    } catch (error) {
      manifest.failures[key] = error instanceof Error ? error.message : String(error);
      log(`FAILED ${masked(key)}: ${masked(manifest.failures[key])}`);
      await save();
    }
  };
  const accountSchema = options.accountSchema ?? "accounts";
  if (!SCHEMA_NAME.test(accountSchema)) throw new Error("Invalid --account-schema.");
  const registryTable = tableName(accountSchema, "users");
  const requestsTable = tableName(accountSchema, "access_requests");
  if ((await root.get<{ present: boolean }>("SELECT to_regclass(?) IS NOT NULL AS present", registryTable))?.present)
    await attempt("registry", async () => {
      const registry = root.forSchema(accountSchema);
      const { accounts, accessRequests } = await registry.readTransaction(async () => ({
        accounts: await registry.all(`SELECT * FROM ${registryTable} ORDER BY created_at, id`),
        accessRequests: await registry.all(`SELECT * FROM ${requestsTable} ORDER BY requested_at, id`),
      }));
      const file = "accounts-users.json";
      await writeJson(join(directory, file), { schema: accountSchema, accounts, accessRequests });
      await record("registry", {
        kind: "registry", schema: accountSchema, file,
        rows: { users: accounts.length, access_requests: accessRequests.length },
        ...(await hashFile(join(directory, file))),
      });
    });
  const schemas = (await root.all<{ name: string }>(
    "SELECT schemaname AS name FROM pg_catalog.pg_tables WHERE tablename = 'schema_migrations' ORDER BY schemaname",
  )).map((row) => row.name).filter((name) => SCHEMA_NAME.test(name) && !/^touchline_test_/i.test(name));
  for (const schema of schemas) {
    const world = root.forSchema(schema);
    await mkdir(join(directory, schema, "snapshots"), { recursive: true, mode: 0o700 });
    await attempt(`${schema}/world`, async () => {
      const file = join(schema, "world.touchline.gz");
      const partial = join(directory, schema, "world.partial.touchline.gz");
      await rm(partial, { force: true });
      const summary = await exportData(world, partial);
      await rename(partial, join(directory, file));
      await record(`${schema}/world`, { kind: "world", schema, file, bytes: summary.byteLength, sha256: summary.sha256,
        rows: Object.fromEntries(summary.tables.map((table) => [table.name, table.rowCount])) });
    });
    if (options.snapshots === false) continue;
    await attempt(`${schema}/snapshots`, async () => {
      const { storedChunks } = await import("../server/saves.ts");
      const slots = await world.all<{ id: string; name: string; career_id: string | null; career_metadata: string | null;
        created_at: Date | string; automatic: boolean; imported: boolean; format_version: number;
        byte_length: number | string; sha256: string | null; complete: boolean }>(
        `SELECT id, name, career_id, career_metadata, created_at, automatic, imported, format_version,
          byte_length, sha256, complete FROM ${tableName(schema, "save_slots")} ORDER BY created_at, id`,
      );
      await writeJson(join(directory, schema, "snapshots.json"), slots);
      for (const slot of slots) {
        const id = String(slot.id).toLowerCase();
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) {
          const key = `${schema}/snapshots/${encodeURIComponent(id).slice(0, 80)}`;
          manifest.failures[key] = "Snapshot id is not a UUID, so it has no safe file name; it was not exported.";
          log(`FAILED ${masked(key)}: ${manifest.failures[key]}`);
          await save();
          continue;
        }
        if (!slot.complete) continue;
        await attempt(`${schema}/snapshots/${id}`, async () => {
          const file = join(schema, "snapshots", `${id}.touchline.gz`);
          const partial = join(directory, `${file}.partial`);
          const hash = createHash("sha256");
          let bytes = 0;
          const handle = await open(partial, "w", 0o600);
          try {
            for await (const chunk of storedChunks(world, slot)) {
              hash.update(chunk);
              bytes += chunk.length;
              await handle.write(chunk);
            }
            await handle.sync();
          } finally {
            await handle.close();
          }
          const sha256 = hash.digest("hex");
          if (slot.sha256 && sha256 !== slot.sha256.toLowerCase())
            throw new Error("Snapshot bytes differ from their catalog SHA-256.");
          await rename(partial, join(directory, file));
          await record(`${schema}/snapshots/${id}`, { kind: "snapshot", schema, file, bytes, sha256 });
        });
      }
    });
  }
  manifest.complete = !Object.keys(manifest.failures).length;
  await save();
  const items = Object.values(manifest.items);
  return {
    directory,
    complete: manifest.complete,
    schemas: schemas.length,
    worlds: items.filter((item) => item.kind === "world").length,
    snapshots: items.filter((item) => item.kind === "snapshot").length,
    bytes: items.reduce((total, item) => total + item.bytes, 0),
    seconds: Math.round((performance.now() - started) / 100) / 10,
    failures: manifest.failures,
  };
}

/** What a matching SHA-256 cannot show: each world's per-table row counts, every gzip end to end, the registry size. */
async function contentProblem(path: string, item: BackupItem) {
  if (item.kind === "registry") {
    const { accounts, accessRequests } = JSON.parse(await readFile(path, "utf8")) as { accounts?: unknown; accessRequests?: unknown };
    if (!Array.isArray(accounts) || accounts.length !== item.rows?.users) return "account count differs from the manifest";
    if (item.rows.access_requests !== undefined &&
      (!Array.isArray(accessRequests) || accessRequests.length !== item.rows.access_requests))
      return "access request count differs from the manifest";
    return undefined;
  }
  if (item.kind === "snapshot") {
    await pipeline(createReadStream(path), createGunzip(), new Writable({ write: (_chunk, _encoding, done) => done() }));
    return undefined;
  }
  const counted = new Map((await validateCheckpoint(createReadStream(path))).tables.map((table) => [table.name, table.rowCount]));
  const expected = new Map(Object.entries(item.rows ?? {}));
  const differs = [...new Set([...counted.keys(), ...expected.keys()])].filter((name) => counted.get(name) !== expected.get(name));
  return differs.length ? `row counts differ from the manifest (${differs.join(", ")})` : undefined;
}

/** Offline check of a --everything backup (no SQL, no SQL_* settings): complete manifest, every file's size, SHA-256 and content. */
export async function verifyBackup(outDir: string) {
  const directory = resolve(outDir);
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as BackupManifest | null;
  if (manifest?.format !== "touchline-backup" || !manifest.items || typeof manifest.items !== "object")
    throw new Error("manifest.json is not a Touchline backup.");
  const problems: string[] = [];
  const failures = Object.keys(manifest.failures ?? {});
  if (!manifest.complete || failures.length)
    problems.push(`backup incomplete: ${failures.map(masked).join(", ") || "not finished"}`);
  const items = Object.entries(manifest.items);
  if (!items.some(([, item]) => item.kind === "world")) problems.push("no world file in the backup");
  for (const [key, item] of items) {
    const path = resolve(directory, item.file);
    if (!path.startsWith(`${directory}${sep}`)) {
      problems.push(`${masked(key)}: path outside the backup`);
      continue;
    }
    const actual = await hashFile(path).catch(() => undefined);
    if (!actual) problems.push(`${masked(key)}: missing`);
    else if (actual.bytes !== item.bytes || actual.sha256 !== item.sha256) problems.push(`${masked(key)}: size or SHA-256 differs`);
    else {
      const problem = await contentProblem(path, item).catch((error: unknown) =>
        `content check failed (${error instanceof Error ? error.message : String(error)})`);
      if (problem) problems.push(`${masked(key)}: ${masked(problem)}`);
    }
  }
  const schemas = new Set(items.filter(([, item]) => item.kind === "snapshot").map(([, item]) => item.schema));
  for (const schema of schemas)
    if (!manifest.items[`${schema}/world`]) problems.push(`${masked(schema)}: snapshots without its world file`);
  return {
    directory,
    ok: problems.length === 0,
    database: manifest.database,
    updatedAt: manifest.updatedAt,
    files: items.length,
    worlds: items.filter(([, item]) => item.kind === "world").length,
    snapshots: items.filter(([, item]) => item.kind === "snapshot").length,
    bytes: items.reduce((total, [, item]) => total + item.bytes, 0),
    problems,
  };
}

/** The CLI flags, checked without SQL; undefined means --help. */
export function exportOptions(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      help: { type: "boolean" },
      database: { type: "string" },
      out: { type: "string" },
      "dry-run": { type: "boolean" },
      everything: { type: "boolean" },
      "out-dir": { type: "string" },
      "account-schema": { type: "string" },
      "skip-snapshots": { type: "boolean" },
      verify: { type: "string" },
    },
  });
  if (values.help) return undefined;
  if (values.everything && values.out)
    throw new Error("--everything writes a directory: use --out-dir <directory> (--out is the single-file export).");
  if (Boolean(values.everything) !== Boolean(values["out-dir"]))
    throw new Error("--everything requires --out-dir <directory>, and --out-dir is only for --everything.");
  if (!values.everything && (values["account-schema"] || values["skip-snapshots"]))
    throw new Error("--account-schema and --skip-snapshots are only for --everything.");
  if ([values.out, values["dry-run"], values.everything, values.verify].filter(Boolean).length !== 1)
    throw new Error("Choose exactly one of --out, --dry-run, --everything, or --verify.");
  if (values.verify && values.database) throw new Error("--verify reads local files only; it takes no --database.");
  return values;
}

export async function main(args = process.argv.slice(2)) {
  const values = exportOptions(args);
  if (!values) {
    console.log(
      "Usage: tsx scripts/data-export.ts --out <new-file.touchline.gz> [--database NAME]\n       tsx scripts/data-export.ts --dry-run [--database NAME]\n       tsx scripts/data-export.ts --everything --out-dir <directory> [--account-schema accounts] [--skip-snapshots]\n       tsx scripts/data-export.ts --verify <backup-directory>\nExports or read-only verifies the active SQL world, without migrating or seeding. Existing output files are refused. Catalog snapshots stay in SQL. Uses SQL_* connection settings.\n--everything backs up every world schema (the default public world and each account world), every complete snapshot and the account registry\nto a local directory with manifest.json and RESTORE.txt; re-running it with the same --out-dir resumes. Stop the app first.\n--verify <directory> checks a --everything backup offline, without SQL or SQL_* settings: complete manifest, every file's size and\nSHA-256, every gzip end to end, each world's per-table row counts and the registry's account count. Exit 1 on any problem.",
    );
    return;
  }
  if (values.verify) {
    const result = await verifyBackup(values.verify);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const { Store } = await import("../server/db.ts");
  const store = await Store.open(values.database);
  try {
    if (values.everything) {
      const result = await exportEverything(store, {
        outDir: values["out-dir"]!,
        accountSchema: values["account-schema"],
        snapshots: !values["skip-snapshots"],
      });
      console.log(JSON.stringify({ ...result, failures: Object.fromEntries(
        Object.entries(result.failures).map(([key, message]) => [masked(key), masked(message)])) }, null, 2));
      if (!result.complete) process.exitCode = 1;
    } else if (values["dry-run"])
      console.log(JSON.stringify(await targetInventory(store), null, 2));
    else {
      const result = await exportData(store, values.out!);
      console.log(
        JSON.stringify(
          {
            file: result.file,
            bytes: result.byteLength,
            sha256: result.sha256,
            tables: result.tables,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await store.close();
  }
}

if (isMain(import.meta.url))
  void main().catch((error: unknown) => {
    // Usage errors print their message; unexpected failures (TypeError, DatabaseError, ...) keep their stack.
    console.error(error instanceof Error ? (error.constructor === Error ? error.message : error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
