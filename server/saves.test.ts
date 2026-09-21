import { createReadStream } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Store } from "./db.ts";
import type { Saves } from "./saves.ts";
import type { GameState } from "../shared/types.ts";
import {
  SAVE_FORMAT_VERSION,
  SAVE_SCHEMA_VERSION,
  decodeCell,
  encodeCell,
  readCheckpoint,
  validateCheckpoint,
  validateManifest,
  writeCheckpoint,
  type CheckpointManifest,
  type CheckpointSchema,
  type RestoredValue,
} from "./save-format.ts";

const schema: CheckpointSchema = {
  version: SAVE_SCHEMA_VERSION,
  tables: [
    {
      name: "meta",
      columns: [
        { name: "key", type: "nvarchar", nullable: false, maxLength: 100 },
        { name: "value", type: "nvarchar", nullable: false, maxLength: -1 },
      ],
    },
    {
      name: "countries",
      columns: [
        { name: "id", type: "int", nullable: false },
        { name: "name", type: "nvarchar", nullable: false, maxLength: 200 },
      ],
    },
  ],
};

function manifest(): CheckpointManifest {
  return {
    kind: "manifest",
    format: "touchline",
    formatVersion: SAVE_FORMAT_VERSION,
    schemaVersion: SAVE_SCHEMA_VERSION,
    createdAt: "2026-09-21T00:00:00.000Z",
    tables: schema.tables.map((table) => ({
      ...structuredClone(table),
      rowCount: 0,
    })),
  };
}

describe("logical checkpoint manifest (no database)", () => {
  it("requires every table, including empty tables", () => {
    expect(validateManifest(manifest(), schema).tables).toHaveLength(2);
    const incomplete = manifest();
    incomplete.tables.pop();
    expect(() => validateManifest(incomplete, schema)).toThrow("incomplete");
  });

  it("rejects unknown tables and columns instead of discarding them", () => {
    const unknown = manifest();
    unknown.tables[1].name = "unrecognized";
    expect(() => validateManifest(unknown, schema)).toThrow("incompatible");
    const extra = manifest();
    extra.tables[0].columns.push({
      name: "future",
      type: "int",
      nullable: true,
    });
    expect(() => validateManifest(extra, schema)).toThrow("incompatible");
  });

  it("rejects unsafe identifiers and duplicate tables", () => {
    const unsafe = manifest();
    unsafe.tables[1].name = "countries]; DROP TABLE meta";
    expect(() => validateManifest(unsafe)).toThrow("identifier");
    const duplicate = manifest();
    duplicate.tables.push(duplicate.tables[0]);
    expect(() => validateManifest(duplicate)).toThrow("Duplicate");
  });

  it("rejects unsupported versions, unsafe counts, and type drift", () => {
    expect(() =>
      validateManifest({ ...manifest(), formatVersion: 9 }, schema),
    ).toThrow("version");
    expect(() =>
      validateManifest({ ...manifest(), schemaVersion: 9 }, schema),
    ).toThrow("version");
    const enormous = manifest();
    enormous.tables[0].rowCount = Number.MAX_SAFE_INTEGER;
    expect(() => validateManifest(enormous, schema)).toThrow("limits");
    const narrowed = manifest();
    narrowed.tables[0].columns[1].maxLength = 200;
    expect(() => validateManifest(narrowed, schema)).toThrow("incompatible");
  });
});

describe("legacy conversion safeguards (temporary fixtures, no SQL)", () => {
  it("inventories raw/gzip files, WAL and sidecars without changing any source", async () => {
    const { inventoryLegacy, hashFile, main } =
      await import("../scripts/data-migrate.ts");
    const directory = await mkdtemp(
      join(tmpdir(), "touchline-inventory-test-"),
    );
    try {
      const source = join(directory, "active.sqlite");
      await writeFile(source, "synthetic source bytes");
      await writeFile(`${source}-wal`, "uncommitted to main-file bytes");
      await writeFile(
        join(directory, "snapshot.sqlite.gz"),
        gzipSync("synthetic snapshot"),
      );
      await writeFile(
        join(directory, "snapshot.sqlite.gz.json"),
        '{ "name": "Original label" }\n',
      );
      const before = await inventoryLegacy(source, [directory]);
      expect(before.sources).toHaveLength(2);
      expect(
        before.sources
          .find((item) => item.active)
          ?.files.map((item) => item.name),
      ).toContain(`${source}-wal`);
      expect(
        before.sources
          .flatMap((item) => item.files)
          .every((item) => /^[a-f0-9]{64}$/.test(item.sha256)),
      ).toBe(true);
      const names = await readdir(directory);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        await main(["--source", source, "--saves", directory, "--dry-run"]);
        expect(JSON.parse(String(log.mock.calls[0][0])).dryRun).toBe(true);
      } finally {
        log.mockRestore();
      }
      expect(await inventoryLegacy(source, [directory])).toEqual(before);
      expect(await readdir(directory)).toEqual(names);
      await writeFile(join(directory, "missing.sqlite.gz.json"), "{}");
      expect((await inventoryLegacy(source, [directory])).orphans).toHaveLength(
        1,
      );
      expect((await hashFile(source)).sha256).toBe(
        before.sources.find((item) => item.active)!.files[0].sha256,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reconciles only documented additive columns and rejects unknown or incompatible data", async () => {
    const { reconcileLegacyTable } = await import("../scripts/data-migrate.ts");
    const source = [{ name: "id", type: "INTEGER", notnull: 0, pk: 1 }];
    const target = [
      { name: "id", type: "int", nullable: false },
      { name: "squad_club_id", type: "int", nullable: true },
    ] as const;
    expect(reconcileLegacyTable("players", source, [...target])).toEqual([
      { table: "players", column: "squad_club_id", value: null },
    ]);
    expect(() =>
      reconcileLegacyTable(
        "players",
        [...source, { name: "future", type: "TEXT", notnull: 0, pk: 0 }],
        [...target],
      ),
    ).toThrow("Unknown legacy column");
    expect(() =>
      reconcileLegacyTable(
        "players",
        [{ ...source[0], type: "TEXT" }],
        [...target],
      ),
    ).toThrow("Incompatible");
    expect(() =>
      reconcileLegacyTable("clubs", source, [
        { name: "id", type: "int", nullable: false },
        { name: "future", type: "int", nullable: true },
      ]),
    ).toThrow("Missing required");
  });

  it("preserves fractional ratings when widening legacy INTEGER columns", async () => {
    const { reconcileLegacyTable } = await import("../scripts/data-migrate.ts");
    const column = { name: "reputation", type: "float", nullable: false } as const;
    expect(
      reconcileLegacyTable(
        "clubs",
        [{ name: "reputation", type: "INTEGER", pk: 0, notnull: 1 }],
        [column],
      ),
    ).toEqual([]);
    expect(encodeCell(78.125, column)).toBe(78.125);
    expect(encodeCell(78n, column)).toBe(78);
    expect(() => encodeCell(9007199254740993n, column)).toThrow("exactly");
  });

  it("rejects local validation reports after source, checkpoint or schema changes", async () => {
    const { createHash } = await import("node:crypto");
    const { validateMigrationReport } = await import("../scripts/data-migrate.ts");
    const { schemaMigrations } = await import("./sql-schema.ts");
    const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const inventory = { version: 1 as const, active: "source", roots: [], sources: [], orphans: [] };
    const sources = [{ source: "source", sha256: "original-checkpoint", tables: [] }];
    const report = {
      version: 1 as const,
      inventoryHash: hash(inventory),
      schemaHash: hash(schema),
      migrationVersion: schemaMigrations("dbo").at(-1)!.version,
      sources,
    };
    expect(() => validateMigrationReport(report, inventory, schema, sources)).not.toThrow();
    expect(() => validateMigrationReport(report, { ...inventory, active: "different" }, schema, sources)).toThrow("does not match");
    expect(() => validateMigrationReport(report, inventory, { ...schema, version: 2 }, sources)).toThrow("does not match");
    expect(() => validateMigrationReport(report, inventory, schema, [])).toThrow("does not match");
    expect(() => validateMigrationReport({ ...report, migrationVersion: 0 }, inventory, schema, sources)).toThrow("does not match");
  });

  it("converts an uncheckpointed WAL through a read-only temporary backup and preserves raw JSON", async () => {
    const { DatabaseSync, backup } = await import("node:sqlite");
    const { convertLegacy, inventoryLegacy, hashFile } =
      await import("../scripts/data-migrate.ts");
    const sourceDirectory = await mkdtemp(
      join(tmpdir(), "touchline-sqlite-fixture-"),
    );
    const outputDirectory = await mkdtemp(
      join(tmpdir(), "touchline-convert-test-"),
    );
    const source = join(sourceDirectory, "autosave_original.sqlite");
    const database = new DatabaseSync(source);
    const target: CheckpointSchema = {
      version: SAVE_SCHEMA_VERSION,
      tables: [
        { name: "meta", columns: schema.tables[0].columns },
        {
          name: "clubs",
          columns: [
            { name: "id", type: "int", nullable: false },
            { name: "name", type: "nvarchar", nullable: false, maxLength: -1 },
          ],
        },
        {
          name: "players",
          columns: [
            { name: "id", type: "int", nullable: false },
            { name: "club_id", type: "int", nullable: false },
            {
              name: "profile",
              type: "nvarchar",
              nullable: false,
              maxLength: -1,
            },
            { name: "squad_club_id", type: "int", nullable: true },
          ],
        },
        {
          name: "club_support",
          columns: [{ name: "club_id", type: "int", nullable: false }],
        },
      ],
    };
    const rawState =
      '{ "clubId": 7, "date": "2026-07-19", "season": 2026, "seed": "000-original-seed", "director": {"name":"Synthetic Director"}, "careerId": "original-id", "careerName": "Original career" }';
    const rawProfile =
      '{ "nested": { "seed": "00-seed", "value": 0.0000001 }, "retained": true }';
    const sidecar =
      '{ "name": "Untouched sidecar label", "custom": {"preserve":"everything"} }\n';
    try {
      database.exec(
        "PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; CREATE TABLE meta (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE clubs (id INTEGER PRIMARY KEY,name TEXT NOT NULL); CREATE TABLE players (id INTEGER PRIMARY KEY,club_id INTEGER NOT NULL REFERENCES clubs(id),profile TEXT NOT NULL);",
      );
      const put = database.prepare("INSERT INTO meta VALUES (?,?)");
      for (const [key, value] of [
        ["schemaVersion", "1"],
        ["state", rawState],
        ["settings", '{ "cloudSync": false }'],
        ["world", '{"countries":1,"version":1}'],
      ])
        put.run(key, value);
      database
        .prepare("INSERT INTO clubs VALUES (?,?)")
        .run(7, "Original club");
      database
        .prepare("INSERT INTO players VALUES (?,?,?)")
        .run(91, 7, rawProfile);
      await writeFile(`${source}.json`, sidecar);
      const before = await inventoryLegacy(source, [sourceDirectory]);
      expect(
        before.sources[0].files.some(
          (file) => file.name.endsWith("-wal") && file.bytes > 0,
        ),
      ).toBe(true);
      const converted = await convertLegacy(
        before.sources[0],
        target,
        outputDirectory,
      );
      const records = new Map<string, RestoredValue[][]>();
      const checked = await readCheckpoint(createReadStream(converted.file), {
        expected: target,
        onRow(table, values) {
          const rows = records.get(table.name) ?? [];
          rows.push(values);
          records.set(table.name, rows);
        },
      });
      expect(records.get("players")).toEqual([[91, 7, rawProfile, null]]);
      expect(records.get("meta")).toContainEqual(["state", rawState]);
      expect(checked.manifest.provenance?.sidecar).toBe(sidecar);
      expect(converted.options).toMatchObject({
        name: "Untouched sidecar label",
        imported: true,
        automatic: true,
        career: { id: "original-id" },
      });
      expect(converted.reconciliation).toEqual({
        missingTables: ["club_support"],
        addedColumns: [
          { table: "players", column: "squad_club_id", value: null },
        ],
      });
      expect(await inventoryLegacy(source, [sourceDirectory])).toEqual(before);
      const compressed = join(sourceDirectory, "z_snapshot.sqlite.gz");
      const copied = join(outputDirectory, "gzip-fixture.sqlite");
      await backup(database, copied);
      await writeFile(compressed, gzipSync(await readFile(copied)));
      await writeFile(`${compressed}.json`, sidecar);
      const gzipInventory = await inventoryLegacy(source, [sourceDirectory]);
      const zipped = await convertLegacy(
        gzipInventory.sources.find((item) => item.file === compressed)!,
        target,
        outputDirectory,
      );
      expect(zipped.summary.tables).toEqual(converted.summary.tables);
      expect(zipped.summary.manifest.provenance?.sidecar).toBe(sidecar);
      expect(await inventoryLegacy(source, [sourceDirectory])).toEqual(
        gzipInventory,
      );
      expect(
        (await readdir(outputDirectory)).some((name) =>
          name.startsWith("source-"),
        ),
      ).toBe(false);
      database.exec("ALTER TABLE players ADD COLUMN unknown_payload TEXT");
      const unsupported = await inventoryLegacy(source, [sourceDirectory]);
      await expect(
        convertLegacy(unsupported.sources[0], target, outputDirectory),
      ).rejects.toThrow("Unknown legacy column");
      expect((await hashFile(source)).sha256).toBe(
        unsupported.sources[0].files[0].sha256,
      );
      expect(await inventoryLegacy(source, [sourceDirectory])).toEqual(
        unsupported,
      );
      database.exec(
        "CREATE TABLE sqlitex_user_table (id INTEGER PRIMARY KEY, payload TEXT)",
      );
      const unknownTable = await inventoryLegacy(source, [sourceDirectory]);
      await expect(
        convertLegacy(unknownTable.sources[0], target, outputDirectory),
      ).rejects.toThrow("Unknown legacy table");
      expect(await inventoryLegacy(source, [sourceDirectory])).toEqual(
        unknownTable,
      );
    } finally {
      database.close();
      await rm(sourceDirectory, { recursive: true, force: true });
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });
});

async function saveTestStep<Result>(
  stage: string,
  action: () => Promise<Result>,
): Promise<Result> {
  const started = performance.now();
  const elapsed = () => `${((performance.now() - started) / 1000).toFixed(1)}s`;
  console.info(`[SQL saves ${new Date().toISOString()}] START ${stage}`);
  const heartbeat = setInterval(() => {
    console.info(`[SQL saves] RUNNING ${stage}; elapsed ${elapsed()}`);
  }, 15_000);
  heartbeat.unref();
  try {
    const result = await action();
    console.info(`[SQL saves] DONE ${stage}; elapsed ${elapsed()}`);
    return result;
  } catch (error) {
    console.error(`[SQL saves] FAILED ${stage}; elapsed ${elapsed()}`);
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

if (process.env.SQL_SAVE_TESTS === "true") {
  describe("SQL save lifecycle (explicit isolated schema)", () => {
    let store: Store;
    let saves: Saves;
    let baseline: { file: string; name: string };
    let testHeartbeat: ReturnType<typeof setInterval> | undefined;
    beforeAll(async () => {
      if (process.env.SQL_TEST_MODE !== "true")
        throw new Error(
          "SQL_SAVE_TESTS requires explicit SQL_TEST_MODE=true; there is no fallback to a live schema.",
        );
      const { Store } = await import("./db.ts");
      const { Saves } = await import("./saves.ts");
      const { generateWorld } = await import("./world.ts");
      store = await saveTestStep("connect and migrate isolated schema", () =>
        Store.createTest("saves"),
      );
      console.info(`[SQL saves] Target: ${store.database}.${store.schemaName}`);
      expect(store.testMode).toBe(true);
      expect(store.schemaName).toMatch(/^touchline_test_/);
      await saveTestStep("verify migration idempotency", () => store.schema());
      await saveTestStep("generate 2-country / 1600-player test world", () =>
        generateWorld(store, {
          countryLimit: 2,
          seniors: 1200,
          youth: 400,
          expanded: false,
          seed: "save-lifecycle-tests",
        }),
      );
      saves = new Saves(store);
      baseline = await saveTestStep("write baseline checkpoint", () =>
        saves.create("Baseline"),
      );
    }, 300_000);
    beforeEach((context) => {
      console.info(`[SQL saves] TEST ${context.task.name}`);
      const started = performance.now();
      testHeartbeat = setInterval(() => {
        console.info(
          `[SQL saves] RUNNING TEST ${context.task.name}; elapsed ${((performance.now() - started) / 1000).toFixed(1)}s`,
        );
      }, 15_000);
      testHeartbeat.unref();
    });
    afterEach(async () => {
      clearInterval(testHeartbeat);
      vi.restoreAllMocks();
      if (baseline)
        await saveTestStep("restore baseline after test", () =>
          saves.restore(baseline.file),
        );
    }, 300_000);
    afterAll(async () => {
      clearInterval(testHeartbeat);
      if (store)
        await saveTestStep("drop isolated schema and close connections", () =>
          store.close(),
        );
    }, 300_000);

    it("round-trips dirty world rows without replacing the catalog and bounds SQL chunks", async () => {
      await store.run(
        "UPDATE clubs SET balance = 1234567.25 WHERE id = ?",
        (await store.meta<GameState>("state")).clubId,
      );
      const saved = await saveTestStep("write modified-world checkpoint", () =>
        saves.create("Dirty checkpoint"),
      );
      const rawState = (await store.get<{ value: string }>(
        "SELECT value FROM meta WHERE [key] = 'state'",
      ))!.value;
      await store.run(
        "UPDATE clubs SET balance = 7 WHERE id = ?",
        (await store.meta<GameState>("state")).clubId,
      );
      const catalog = (await saves.list()).map((slot) => slot.file);
      await saveTestStep("restore modified-world checkpoint", () =>
        saves.restore(saved.file),
      );
      expect(
        (await store.get<{ value: string }>(
          "SELECT value FROM meta WHERE [key] = 'state'",
        ))!.value,
      ).toBe(rawState);
      expect(
        (await store.get<{ balance: number }>(
          "SELECT balance FROM clubs WHERE id = ?",
          (await store.meta<GameState>("state")).clubId,
        ))!.balance,
      ).toBe(1234567.25);
      expect((await saves.list()).map((slot) => slot.file)).toEqual(catalog);
      expect(saved.file).toMatch(/^[a-f0-9-]{36}\.touchline\.gz$/);
      expect(
        (await store.get<{ maximum: number }>(
          "SELECT MAX(CONVERT(INT,DATALENGTH(data))) AS maximum FROM save_chunks",
        ))!.maximum,
      ).toBeLessThanOrEqual(1024 * 1024);
      const exported = await saveTestStep("export portable checkpoint", () =>
        saves.export(),
      );
      try {
        await store.run(
          "UPDATE clubs SET balance = 99 WHERE id = ?",
          (await store.meta<GameState>("state")).clubId,
        );
        await saveTestStep("import portable checkpoint", () =>
          saves.import(createReadStream(exported.file)),
        );
        expect(
          (await store.get<{ balance: number }>(
            "SELECT balance FROM clubs WHERE id = ?",
            (await store.meta<GameState>("state")).clubId,
          ))!.balance,
        ).toBe(1234567.25);
        expect((await saves.list()).map((slot) => slot.file)).toEqual(
          expect.arrayContaining(catalog),
        );
        expect(
          (await store.get<{ total: number }>(
            "SELECT COUNT(*) AS total FROM save_slots WHERE imported = 1",
          ))!.total,
        ).toBeGreaterThan(0);
      } finally {
        await rm(exported.file, { force: true });
      }
    }, 300_000);

    it("resumes committed import batches without exposing a partial career or duplicating archives", async () => {
      const { Store } = await import("./db.ts");
      const { resumableImport } = await import("../scripts/data-migrate.ts");
      const { validateWorldCheckpoint } = await import("./saves.ts");
      const exported = await saves.export();
      const owner = await Store.createTest("resumable_import");
      const previousSchema = process.env.SQL_SCHEMA;
      process.env.SQL_SCHEMA = owner.schemaName;
      const target = await Store.open();
      try {
        const validated = await validateWorldCheckpoint(target, exported.file);
        const source = {
          file: exported.file, source: "synthetic-source", active: true,
          options: { name: "Resumable fixture", imported: true },
          validated, summary: validated.summary,
        };
        const originalBulk = target.bulkInsert.bind(target);
        const interrupted = vi.spyOn(target, "bulkInsert").mockImplementation(async (table, rows) => {
          if (table === "players") throw new Error("injected interrupted transfer");
          await originalBulk(table, rows);
        });
        await expect(resumableImport(target, [source], "source-fingerprint", async () => {}, () => Store.open())).rejects.toThrow("injected interrupted transfer");
        interrupted.mockRestore();
        expect(await owner.get("SELECT value FROM meta WHERE [key] = 'state'")).toBeUndefined();
        expect(await owner.get("SELECT value FROM meta WHERE [key] = '__touchline_legacy_import'")).toBeDefined();
        expect((await owner.get<{ total: number }>("SELECT COUNT(*) AS total FROM countries"))!.total).toBe(2);
        expect((await owner.get<{ total: number }>("SELECT COUNT(*) AS total FROM save_slots"))!.total).toBe(1);
        await expect(resumableImport(target, [source], "wrong-fingerprint", async () => {}, () => Store.open())).rejects.toThrow("different source");
        const result = await resumableImport(target, [source], "source-fingerprint", async () => {}, () => Store.open());
        expect(result.migrated).toBe(true);
        expect(await owner.meta("state")).toEqual(validated.state);
        expect(await owner.get("SELECT value FROM meta WHERE [key] = '__touchline_legacy_import'")).toBeUndefined();
        expect((await owner.get<{ total: number }>("SELECT COUNT(*) AS total FROM save_slots"))!.total).toBe(1);
        expect((await owner.get<{ total: number }>("SELECT COUNT(*) AS total FROM players"))!.total).toBe(1600);
      } finally {
        if (previousSchema === undefined) delete process.env.SQL_SCHEMA;
        else process.env.SQL_SCHEMA = previousSchema;
        await target.close();
        await owner.close();
        await rm(exported.file, { force: true });
      }
    }, 300_000);

    it("retains imported autosaves and manual archives while pruning only this career's generated autosaves", async () => {
      const imported = await saves.create("Historical autosave", true);
      await store.run(
        "UPDATE save_slots SET imported = 1,created_at = '2000-01-01' WHERE id = ?",
        imported.file.replace(".touchline.gz", ""),
      );
      const manual = await saves.create("Manual safety archive");
      const state = await store.meta<GameState>("state");
      await store.setMeta("state", {
        ...state,
        careerId: "separate-retained-career",
      });
      const separate = await saves.create("Other career autosave", true);
      await store.setMeta("state", state);
      for (let index = 0; index < 4; index++)
        await saves.create(`Autosave ${index}`, true);
      const slots = await saves.list();
      expect(slots.map((slot) => slot.file)).toEqual(
        expect.arrayContaining([imported.file, manual.file, separate.file]),
      );
      expect(
        slots.filter(
          (slot) => slot.automatic && slot.career?.id === state.careerId,
        ),
      ).toHaveLength(4);
    }, 300_000);

    it("protects the active career and deletes only an explicitly selected inactive career", async () => {
      await expect(saves.deleteCareer(baseline.file)).rejects.toThrow(
        "active career",
      );
      const state = await store.meta<GameState>("state");
      await store.setMeta("state", {
        ...state,
        careerId: "inactive-save-test",
      });
      const first = await saves.create("Inactive first");
      const second = await saves.create("Inactive second");
      await saves.restore(baseline.file);
      expect((await saves.deleteCareer(first.file)).deleted).toBe(2);
      expect((await saves.list()).map((slot) => slot.file)).not.toContain(
        second.file,
      );
      expect((await saves.list()).map((slot) => slot.file)).toContain(
        baseline.file,
      );
      await expect(saves.restore("../../career.sqlite")).rejects.toThrow(
        "not found",
      );
    }, 300_000);

    it("validates before clearing and rolls back a structurally valid but relationally invalid restore", async () => {
      const exported = await saves.export();
      try {
        const bytes = await readFile(exported.file);
        const corrupted = gzipSync(
          gunzipSync(bytes)
            .toString()
            .replace('"kind":"row"', '"kind":"row","unknown":true'),
        );
        const clear = vi.spyOn(store, "clearWorld");
        await expect(saves.import(corrupted)).rejects.toThrow("Unknown");
        expect(clear).not.toHaveBeenCalled();
        clear.mockRestore();
        const rows = new Map<string, RestoredValue[][]>();
        const contents = await readCheckpoint(Readable.from([bytes]), {
          onRow(table, values) {
            const batch = rows.get(table.name) ?? [];
            batch.push(values);
            rows.set(table.name, batch);
          },
        });
        const players = contents.manifest.tables.find(
          (table) => table.name === "players",
        )!;
        rows.get("players")![0][
          players.columns.findIndex((column) => column.name === "club_id")
        ] = 2147483000;
        const chunks: Buffer[] = [];
        await writeCheckpoint(
          new Writable({
            write(chunk, _encoding, callback) {
              chunks.push(Buffer.from(chunk));
              callback();
            },
          }),
          contents.manifest,
          (table) => rows.get(table.name) ?? [],
        );
        const before = await store.meta("state");
        const beforeSlots = await saves.list();
        await expect(saves.import(Buffer.concat(chunks))).rejects.toThrow();
        expect(await store.meta("state")).toEqual(before);
        expect(await saves.list()).toEqual(beforeSlots);
        expect(
          (await store.get<{ club_id: number }>(
            "SELECT club_id FROM players WHERE id = ?",
            rows.get("players")![0][0],
          ))!.club_id,
        ).not.toBe(2147483000);
      } finally {
        await rm(exported.file, { force: true });
      }
    }, 300_000);

    it("rolls back failed generation and expansion while retaining their safety checkpoints", async () => {
      const world = await import("./world.ts");
      const expansion = await import("./world-expansion.ts");
      const before = await store.meta<GameState>("state");
      const beforeCount = (await saves.list()).length;
      const generate = vi
        .spyOn(world, "generateWorld")
        .mockRejectedValueOnce(new Error("injected generation failure"));
      await expect(
        saves.startCareer({
          name: "Next Director",
          careerName: "Next career",
          background: "Former scout",
          clubId: before.clubId,
          seed: "other-seed",
        }),
      ).rejects.toThrow("injected generation failure");
      generate.mockRestore();
      expect(await store.meta("state")).toEqual(before);
      expect((await saves.list()).length).toBe(beforeCount + 1);
      const expand = vi
        .spyOn(expansion, "expandWorld")
        .mockImplementationOnce(async () => {
          await store.run(
            "UPDATE clubs SET balance = 0 WHERE id = ?",
            before.clubId,
          );
          throw new Error("injected expansion failure");
        });
      const balance = await store.get(
        "SELECT balance FROM clubs WHERE id = ?",
        before.clubId,
      );
      await expect(saves.expandWorld()).rejects.toThrow(
        "injected expansion failure",
      );
      expand.mockRestore();
      expect(
        await store.get(
          "SELECT balance FROM clubs WHERE id = ?",
          before.clubId,
        ),
      ).toEqual(balance);
      expect(
        (await saves.list()).some(
          (slot) => slot.name === "Before world expansion",
        ),
      ).toBe(true);
    }, 300_000);
  });
} else {
  console.info(
    "SQL save lifecycle checks are NOT RUN. Set SQL_SAVE_TESTS=true and SQL_TEST_MODE=true with an explicitly configured SQL target to run them in disposable schemas.",
  );
}

async function checkpoint() {
  const input = manifest();
  input.tables[0].rowCount = 1;
  input.tables[1].rowCount = 1;
  const rawJson = '{"seed":"001","id":42,"spacing": "preserved"}';
  const chunks: Buffer[] = [];
  const summary = await writeCheckpoint(
    new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }),
    input,
    (table) =>
      table.name === "meta" ? [["state", rawJson]] : [[42, "Northbridge"]],
  );
  return { data: Buffer.concat(chunks), summary, rawJson };
}

describe("streamed logical checkpoints (no database)", () => {
  it("round-trips exact JSON strings and verifies counts and both digests", async () => {
    const { data, summary, rawJson } = await checkpoint();
    const restored: unknown[][] = [];
    const result = await readCheckpoint(
      Readable.from([...data].map((byte) => Buffer.from([byte]))),
      {
        expected: schema,
        onRow: (_table, values) => {
          restored.push(values);
        },
      },
    );
    expect(restored).toEqual([
      ["state", rawJson],
      [42, "Northbridge"],
    ]);
    expect(result).toEqual(summary);
    expect(result.tables.map((table) => table.rowCount)).toEqual([1, 1]);
  });

  it("rejects payload corruption even when gzip itself is valid", async () => {
    const { data } = await checkpoint();
    const changed = gunzipSync(data)
      .toString()
      .replace("Northbridge", "Southbridge");
    await expect(
      validateCheckpoint(Readable.from([gzipSync(changed)]), schema),
    ).rejects.toThrow("digest");
  });

  it("rejects truncated gzip, missing footer, duplicate tables, and trailing data", async () => {
    const { data } = await checkpoint();
    await expect(
      validateCheckpoint(Readable.from([data.subarray(0, -6)]), schema),
    ).rejects.toThrow();
    const text = gunzipSync(data).toString();
    const records = text.trimEnd().split("\n");
    await expect(
      validateCheckpoint(
        Readable.from([gzipSync(`${records.slice(0, -1).join("\n")}\n`)]),
        schema,
      ),
    ).rejects.toThrow("footer");
    await expect(
      validateCheckpoint(
        Readable.from([gzipSync(`${text}${records[1]}\n`)]),
        schema,
      ),
    ).rejects.toThrow("follows");
    records.splice(2, 0, records[1]);
    await expect(
      validateCheckpoint(
        Readable.from([gzipSync(`${records.join("\n")}\n`)]),
        schema,
      ),
    ).rejects.toThrow("duplicate");
  });

  it("enforces compressed, expanded, and per-line bounds", async () => {
    const { data } = await checkpoint();
    for (const limits of [
      { compressedBytes: 40 },
      { expandedBytes: 200 },
      { lineBytes: 80 },
    ])
      await expect(
        validateCheckpoint(Readable.from([data]), schema, limits),
      ).rejects.toThrow("byte limit");
  });

  it("rejects unknown record fields and wrong row widths", async () => {
    const { data } = await checkpoint();
    const text = gunzipSync(data).toString();
    const extra = text.replace('"kind":"row"', '"kind":"row","discardMe":true');
    await expect(
      validateCheckpoint(Readable.from([gzipSync(extra)]), schema),
    ).rejects.toThrow("Unknown");
    const short = text.replace('[42,"Northbridge"]', "[42]");
    await expect(
      validateCheckpoint(Readable.from([gzipSync(short)]), schema),
    ).rejects.toThrow("row width");
  });

  it("preserves bigint and binary values and refuses narrowing or invalid scalars", () => {
    const large = { name: "id", type: "bigint", nullable: false } as const;
    expect(decodeCell(encodeCell(9223372036854775807n, large), large)).toBe(
      9223372036854775807n,
    );
    const binary = {
      name: "data",
      type: "varbinary",
      nullable: false,
      maxLength: -1,
    } as const;
    expect(
      decodeCell(encodeCell(Buffer.from([0, 255, 1]), binary), binary),
    ).toEqual(Buffer.from([0, 255, 1]));
    expect(() => encodeCell(2147483648, schema.tables[1].columns[0])).toThrow(
      "Invalid",
    );
    expect(() =>
      encodeCell("a".repeat(201), schema.tables[1].columns[1]),
    ).toThrow("oversized");
    expect(() => encodeCell(undefined, schema.tables[1].columns[1])).toThrow(
      "Invalid",
    );
    expect(() =>
      encodeCell(NaN, { name: "balance", type: "float", nullable: false }),
    ).toThrow("Invalid");
  });

  it("rejects a writer whose table changes during its snapshot", async () => {
    await expect(
      writeCheckpoint(
        new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          },
        }),
        manifest(),
        () => [[1, "unexpected"]],
      ),
    ).rejects.toThrow();
  });

  it("closes the destination when validation or writing fails", async () => {
    const invalid = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    await expect(
      writeCheckpoint(invalid, { ...manifest(), formatVersion: 99 }, () => []),
    ).rejects.toThrow("version");
    expect(invalid.destroyed).toBe(true);
    const broken = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error("injected storage failure"));
      },
    });
    await expect(writeCheckpoint(broken, manifest(), () => [])).rejects.toThrow(
      "injected storage failure",
    );
    expect(broken.destroyed).toBe(true);
  });
});
