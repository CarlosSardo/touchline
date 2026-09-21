import { createReadStream } from "node:fs";
import { open, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { Store } from "../server/db.ts";
import {
  validateCheckpoint,
  type CheckpointSummary,
} from "../server/save-format.ts";

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

export async function targetInventory(store: Store, lock = false) {
  const { checkpointSchema, sqlName } = await import("../server/saves.ts");
  const schema = await checkpointSchema(store);
  const tables: { name: string; rows: number }[] = [];
  for (const name of [
    ...schema.tables.map((table) => table.name),
    "save_slots",
    "save_chunks",
  ]) {
    const result = await store.get<{ total: number | string }>(
      `SELECT COUNT_BIG(*) AS total FROM ${sqlName(store.schemaName)}.${sqlName(name)}${lock ? " WITH (TABLOCKX,HOLDLOCK)" : ""}`,
    );
    const rows = Number(result!.total);
    if (!Number.isSafeInteger(rows) || rows < 0)
      throw new Error("Invalid target row count.");
    tables.push({ name, rows });
  }
  let nonempty = tables.some((table) => table.rows > 0);
  if (
    nonempty &&
    tables.every((table) => table.rows === (table.name === "meta" ? 1 : 0))
  ) {
    const marker = await store.get<{ key: string; value: string }>(
      `SELECT [key],[value] FROM ${sqlName(store.schemaName)}.[meta]`,
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

export async function verifyImportedData(store: Store, stagingDirectory: string) {
  const directory = resolve(stagingDirectory);
  const files = (await readdir(directory)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
  const checkpoints = await Promise.all(files.map(async (name) =>
    JSON.parse(await readFile(join(directory, name), "utf8")) as {
      active: boolean;
      source: string;
      options: { career?: { id: string; director: string; club: string; date: string; season: number } };
      summary: CheckpointSummary;
    },
  ));
  const active = checkpoints.filter((checkpoint) => checkpoint.active);
  if (active.length !== 1 || !checkpoints.length)
    throw new Error("Verification requires exactly one active checkpoint in the staging inventory.");
  const inventory = await targetInventory(store);
  for (const expected of active[0].summary.tables)
    if (inventory.tables.find((table) => table.name === expected.name)?.rows !== expected.rowCount)
      throw new Error(`Post-commit row count differs for ${expected.name}.`);
  const slots = await store.all<{ id: string; sha256: string; byte_length: string | number }>(
    "SELECT id,sha256,byte_length FROM save_slots WHERE imported = 1 AND complete = 1",
  );
  const remaining = [...slots];
  for (const checkpoint of checkpoints) {
    const index = remaining.findIndex((slot) => slot.sha256 === checkpoint.summary.sha256 &&
      Number(slot.byte_length) === checkpoint.summary.byteLength);
    if (index < 0) throw new Error(`Imported checkpoint missing or incomplete: ${checkpoint.source}`);
    remaining.splice(index, 1);
  }
  const untrusted = await store.all<{ name: string }>(
    `SELECT name FROM sys.foreign_keys WHERE schema_id = SCHEMA_ID(?) AND (is_disabled = 1 OR is_not_trusted = 1)
     UNION ALL SELECT name FROM sys.check_constraints WHERE schema_id = SCHEMA_ID(?) AND (is_disabled = 1 OR is_not_trusted = 1)`,
    store.schemaName,
    store.schemaName,
  );
  if (untrusted.length) throw new Error("Post-commit SQL constraints are disabled or untrusted.");
  const { bootstrap } = await import("../server/queries.ts");
  const { state, club, world } = await bootstrap(store);
  const expected = active[0].options.career;
  if (expected && (state.careerId !== expected.id || state.date !== expected.date ||
    state.season !== expected.season || state.director.name !== expected.director || club.name !== expected.club))
    throw new Error("Imported active career identity differs from its original checkpoint.");
  return {
    verified: true,
    database: store.database,
    schema: store.schemaName,
    activeTables: active[0].summary.tables.length,
    importedCheckpoints: checkpoints.length,
    constraintsTrusted: true,
    date: state.date,
    director: state.director.name,
    club: club.name,
    players: world.players,
    balance: club.balance,
    transferBudget: club.transfer_budget,
    wageBudget: club.wage_budget,
    checks: "Post-commit counts, catalog digests, career identity and constraint status; active row hashes are checked by the import transaction.",
  };
}

export async function backupBeforeReplace(
  store: Store,
  options: ReplacementOptions,
) {
  const inventory = await targetInventory(store, true);
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

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      help: { type: "boolean" },
      database: { type: "string" },
      out: { type: "string" },
      "dry-run": { type: "boolean" },
      "verify-staging": { type: "string" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: tsx scripts/data-export.ts --out <new-file.touchline.gz> [--database NAME]\n       tsx scripts/data-export.ts --dry-run [--database NAME]\n       tsx scripts/data-export.ts --verify-staging <converted-checkpoint-directory>\nExports or read-only verifies the active SQL world, without migrating or seeding. Existing output files are refused. Catalog snapshots stay in SQL. Uses SQL_* connection settings.",
    );
    return;
  }
  if ([values.out, values["dry-run"], values["verify-staging"]].filter(Boolean).length !== 1)
    throw new Error("Choose exactly one of --out, --dry-run, or --verify-staging.");
  const { Store } = await import("../server/db.ts");
  const store = await Store.open(values.database);
  try {
    if (values["verify-staging"])
      console.log(JSON.stringify(await verifyImportedData(store, values["verify-staging"]), null, 2));
    else if (values["dry-run"])
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
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
