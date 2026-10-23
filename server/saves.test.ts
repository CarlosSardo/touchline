import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
  restorableColumn,
  validateCheckpoint,
  validateManifest,
  worldDigest,
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

  it.each(["users", "accounts", "account_users"])("never accepts account records from a portable world: %s", (name) => {
    const imported = manifest();
    imported.tables.push({
      name,
      columns: [
        { name: "id", type: "nvarchar", nullable: false, maxLength: 100 },
        { name: "game_schema", type: "nvarchar", nullable: false, maxLength: 128 },
      ],
      rowCount: 1,
    });
    expect(() => validateManifest(imported, schema)).toThrow();
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
    // The file's column holds longer values than the current schema allows.
    const bounded: CheckpointSchema = structuredClone(schema);
    bounded.tables[1].columns[1].maxLength = 100;
    expect(() => validateManifest(manifest(), bounded)).toThrow("incompatible");
    const retyped = manifest();
    retyped.tables[1].columns[0] = { name: "id", type: "float", nullable: false };
    expect(() => validateManifest(retyped, schema)).toThrow("incompatible");
    const nullable = manifest();
    nullable.tables[1].columns[0].nullable = true;
    expect(() => validateManifest(nullable, schema)).toThrow("incompatible");
    const missing = manifest();
    missing.tables[1].columns.pop();
    expect(() => validateManifest(missing, schema)).toThrow("incompatible");
  });

  it("accepts SQL Server column descriptions that restore losslessly, and drops declared legacy columns", async () => {
    // Earlier versions described bounded nvarchar(n) columns (now unbounded text) and smaller integer types.
    const legacy = manifest();
    legacy.tables[0].columns[0].maxLength = 50;
    legacy.tables[1].columns = [
      { name: "name", type: "nvarchar", nullable: false, maxLength: 200 },
      { name: "computed_id", type: "int", nullable: false },
      { name: "id", type: "smallint", nullable: false },
    ];
    expect(() => validateManifest(legacy, schema)).toThrow("incompatible");
    const target: CheckpointSchema = structuredClone(schema);
    target.tables[1].legacyColumns = ["computed_id"];
    expect(validateManifest(legacy, target).tables[1].columns).toHaveLength(3);
    for (const [source, column] of [
      [{ type: "tinyint" }, { type: "bigint" }],
      [{ type: "int" }, { type: "float" }],
      [{ type: "real" }, { type: "float" }],
      [{ type: "varchar", maxLength: 10 }, { type: "nvarchar", maxLength: -1 }],
      [{ type: "datetime" }, { type: "datetime2" }],
      [{ type: "decimal", precision: 10, scale: 2 }, { type: "decimal", precision: 12, scale: 4 }],
    ] as const)
      expect(restorableColumn({ name: "x", nullable: false, ...source }, { name: "x", nullable: true, ...column })).toBe(true);
    for (const [source, column] of [
      [{ type: "bigint" }, { type: "int" }],
      [{ type: "int" }, { type: "real" }],
      [{ type: "float" }, { type: "real" }],
      [{ type: "nvarchar", maxLength: -1 }, { type: "nvarchar", maxLength: 4000 }],
      [{ type: "nvarchar", maxLength: 10 }, { type: "varchar", maxLength: 10 }],
      [{ type: "nvarchar", maxLength: 10 }, { type: "nchar", maxLength: 20 }],
      [{ type: "decimal", precision: 10, scale: 2 }, { type: "decimal", precision: 10, scale: 1 }],
      [{ type: "bit" }, { type: "int" }],
    ] as const)
      expect(restorableColumn({ name: "x", nullable: false, ...source }, { name: "x", nullable: false, ...column })).toBe(false);

    legacy.tables[0].rowCount = 1;
    legacy.tables[1].rowCount = 1;
    const chunks: Buffer[] = [];
    await writeCheckpoint(
      new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.from(chunk));
          callback();
        },
      }),
      legacy,
      (table) => (table.name === "meta" ? [["state", "{}"]] : [["Northbridge", 0, 42]]),
    );
    const seen: { table: string; columns: string[]; values: RestoredValue[] }[] = [];
    const read = await readCheckpoint(Readable.from(chunks), {
      expected: target,
      onRow(table, values) {
        seen.push({ table: table.name, columns: table.columns.map((column) => column.name), values });
      },
    });
    expect(seen).toEqual([
      { table: "meta", columns: ["key", "value"], values: ["state", "{}"] },
      { table: "countries", columns: ["id", "name"], values: [42, "Northbridge"] },
    ]);
    // The summary still describes the file as written, so its digests stay verifiable.
    expect(read.manifest.tables[1].columns.map((column) => column.name)).toEqual(["name", "computed_id", "id"]);
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
      await saveTestStep("generate one-nation minimum-squad test world", () =>
        generateWorld(store, {
          nations: ["SCO"],
          squads: "minimum",
          seed: "save-lifecycle-tests",
        }),
      );
      await store.setMeta("state", {
        ...await store.meta<GameState>("state"),
        started: true,
      });
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

    it("rejects partial worlds and rolls back interrupted first-world preparation before a safe retry", async () => {
      const { Store } = await import("./db.ts");
      const { Saves } = await import("./saves.ts");
      const world = await import("./world.ts");
      const generateWorldFixture = world.generateWorld;
      const empty = await Store.createTest("prepare-world");
      const personal = new Saves(empty);
      const generate = vi.spyOn(world, "generateWorld");
      try {
        expect(await personal.currentState()).toBeNull();
        expect(await personal.list()).toEqual([]);
        await expect(personal.create("Not prepared")).rejects.toMatchObject({ status: 409 });
        await expect(personal.export()).rejects.toMatchObject({ status: 409 });
        await empty.setMeta("world", { incomplete: true });
        await expect(personal.prepareCareer("Verified Director")).rejects.toMatchObject({ status: 409 });
        expect(generate).not.toHaveBeenCalled();
        await empty.run("DELETE FROM meta WHERE key = 'world'");
        const generateSmallWorld = async (target: Store, options?: Parameters<typeof world.generateWorld>[1]) =>
          generateWorldFixture(target, { ...options, nations: ["SCO"], squads: "minimum" });
        generate.mockImplementationOnce(async (target, options) => {
          await generateSmallWorld(target, options);
          throw new Error("injected preparation failure");
        });
        await expect(personal.prepareCareer("Verified Director")).rejects.toThrow("injected preparation failure");
        expect(await personal.currentState()).toBeNull();
        expect((await empty.get<{ total: number }>("SELECT COUNT(*) AS total FROM countries"))!.total).toBe(0);
        expect(await personal.list()).toEqual([]);
        generate.mockImplementation(generateSmallWorld);
        expect(await personal.prepareCareer("Verified Director")).toEqual({ created: true });
        const prepared = await personal.currentState();
        expect(prepared).toMatchObject({ started: false, director: { name: "Verified Director" } });
        expect(await personal.prepareCareer("Changed profile name")).toEqual({ created: false });
        expect(await personal.currentState()).toEqual(prepared);
        expect(generate).toHaveBeenCalledTimes(2);
        expect(await personal.list()).toEqual([]);
      } finally {
        generate.mockRestore();
        await empty.close();
      }
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
        "SELECT value FROM meta WHERE key = 'state'",
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
          "SELECT value FROM meta WHERE key = 'state'",
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
          "SELECT max(octet_length(data)) AS maximum FROM save_chunks",
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
            "SELECT count(*) AS total FROM save_slots WHERE imported",
          ))!.total,
        ).toBeGreaterThan(0);
      } finally {
        await rm(exported.file, { force: true });
      }
    }, 300_000);

    it("imports a checkpoint described in SQL Server types, ignoring computed columns it lists", async () => {
      const { checkpointSchema } = await import("./saves.ts");
      const described = await checkpointSchema(store);
      const columnsOf = (name: string) => described.tables.find((table) => table.name === name)!;
      expect(columnsOf("meta").columns).toEqual([
        { name: "key", type: "nvarchar", nullable: false, maxLength: -1 },
        { name: "value", type: "nvarchar", nullable: false, maxLength: -1 },
      ]);
      expect(columnsOf("clubs").columns.find((column) => column.name === "balance"))
        .toEqual({ name: "balance", type: "float", nullable: false });
      expect(columnsOf("players").columns.map((column) => column.name)).not.toContain("playing_club_id");
      // Profile copies (migration 11) stay out of checkpoints and are rebuilt on restore.
      for (const copy of ["height", "weight"])
        expect(columnsOf("players").columns.map((column) => column.name)).not.toContain(copy);
      expect(columnsOf("players").columns.at(-1)).toEqual({ name: "squad_club_id", type: "int", nullable: true });
      expect(columnsOf("news").legacyColumns).toEqual(["notification_key", "notification_unkeyed_id"]);

      const state = await store.meta<GameState>("state");
      await store.run(
        "INSERT INTO news (date, category, title, body, data) VALUES (?, ?, ?, ?, ?)",
        state.date, "Test", "Keyed", "Legacy notification", JSON.stringify({ notificationKey: "legacy-key" }),
      );
      const exported = await saves.export();
      try {
        const rows = new Map<string, RestoredValue[][]>();
        const contents = await readCheckpoint(createReadStream(exported.file), {
          onRow(table, values) {
            rows.set(table.name, [...(rows.get(table.name) ?? []), values]);
          },
        });
        // Bounded lengths the SQL Server schema declared; PostgreSQL stores these columns as unbounded text.
        const bounded: Record<string, number> = {
          "meta.key": 200, "countries.code": 16, "players.name": 200, "players.position": 16,
          "players.age_group": 32, "players.contract_end": 10, "players.injury_until": 10, "players.role": 100,
          "fixtures.date": 10, "fixtures.status": 32, "staff.role": 100, "unexpected_events.date": 10,
        };
        const legacy = structuredClone(contents.manifest);
        legacy.createdAt = "2026-09-01T00:00:00.000Z";
        for (const table of legacy.tables)
          for (const column of table.columns) {
            const length = bounded[`${table.name}.${column.name}`];
            if (length) column.maxLength = length;
          }
        const table = (name: string) => legacy.tables.find((item) => item.name === name)!;
        const index = (name: string, column: string) => table(name).columns.findIndex((item) => item.name === column);
        const [squad, club, data, id] = [
          index("players", "squad_club_id"), index("players", "club_id"), index("news", "data"), index("news", "id"),
        ];
        table("players").columns.push({ name: "playing_club_id", type: "int", nullable: true });
        table("news").columns.push(
          { name: "notification_key", type: "nvarchar", nullable: true, maxLength: 450 },
          { name: "notification_unkeyed_id", type: "int", nullable: false },
        );
        const players = rows.get("players")!.map((row) => [...row, row[squad] ?? row[club]]);
        const news = rows.get("news")!.map((row) => {
          const key = (JSON.parse(row[data] as string) as { notificationKey?: string }).notificationKey ?? null;
          return [...row, key, key === null ? row[id] : 0];
        });
        expect(news.some((row) => row.at(-2) === "legacy-key")).toBe(true);
        const balance = index("clubs", "balance");
        const clubs = rows.get("clubs")!.map((row) =>
          row[index("clubs", "id")] === state.clubId
            ? row.map((value, column) => (column === balance ? 2468.5 : value))
            : row);
        const replaced = new Map([["players", players], ["news", news], ["clubs", clubs]]);
        const chunks: Buffer[] = [];
        await writeCheckpoint(
          new Writable({
            write(chunk, _encoding, callback) {
              chunks.push(Buffer.from(chunk));
              callback();
            },
          }),
          legacy,
          (item) => replaced.get(item.name) ?? rows.get(item.name) ?? [],
        );
        await store.run("UPDATE clubs SET balance = 1 WHERE id = ?", state.clubId);
        const before = (await saves.list()).length;
        await saveTestStep("import SQL Server-typed checkpoint", () => saves.import(Buffer.concat(chunks)));
        expect((await store.get<{ balance: number }>("SELECT balance FROM clubs WHERE id = ?", state.clubId))!.balance)
          .toBe(2468.5);
        expect((await store.get<{ total: number }>("SELECT count(*) AS total FROM players"))!.total).toBe(players.length);
        expect((await store.get<{ total: number }>(
          "SELECT count(*) AS total FROM players WHERE playing_club_id IS DISTINCT FROM COALESCE(squad_club_id, club_id)",
        ))!.total).toBe(0);
        expect((await store.get<{ total: number }>(
          "SELECT count(*) AS total FROM players WHERE height IS NULL OR height IS DISTINCT FROM round((profile::jsonb #>> '{identity,height}')::double precision) OR weight IS DISTINCT FROM round((profile::jsonb #>> '{identity,weight}')::double precision)",
        ))!.total).toBe(0);
        expect((await store.get<{ total: number }>(
          "SELECT count(*) AS total FROM news WHERE notification_key = 'legacy-key'",
        ))!.total).toBe(1);
        // Identity sequences continue after the imported ids.
        const next = await store.run(
          "INSERT INTO news (date, category, title, body) VALUES (?, ?, ?, ?)", state.date, "Test", "Next", "After import",
        );
        expect(next.lastInsertRowid).toBe(Math.max(...news.map((row) => row[id] as number)) + 1);
        const slots = await saves.list();
        expect(slots).toHaveLength(before + 1);
        expect(slots.filter((slot) => slot.imported)).not.toHaveLength(0);
      } finally {
        await rm(exported.file, { force: true });
      }
    }, 300_000);

    it("imports a checkpoint written before the player records and backfills honours and running injuries once", async () => {
      const { PLAYER_RECORD_TABLES } = await import("./sql-schema.ts");
      const state = await store.meta<GameState>("state");
      const [winner, injured] = await store.all<{ id: number; club_id: number }>(
        "SELECT id, club_id FROM players WHERE club_id IS NOT NULL AND role <> 'Retired' ORDER BY id LIMIT 2",
      );
      const league = (await store.get<{ id: number }>("SELECT id FROM leagues WHERE kind = 'league' ORDER BY id LIMIT 1"))!;
      await store.run(
        "INSERT INTO player_season_stats (player_id, season, club_id, league_id, minutes, appearances, goals, assists) VALUES (?, ?, ?, ?, 270, 3, 1, 0)",
        winner.id, state.season, winner.club_id, league.id,
      );
      await store.run(
        "INSERT INTO history (season, entity_type, entity_id, date, data) VALUES (?, 'champion', ?, ?, ?)",
        state.season, league.id, state.date, JSON.stringify({ clubId: winner.club_id, name: "Winners", competition: "League" }),
      );
      await store.run("UPDATE players SET injury_until = ? WHERE id = ?", "2099-01-01", injured.id);
      await store.run("DELETE FROM meta WHERE key = 'playerRecords'");
      const exported = await saves.export();
      try {
        const rows = new Map<string, RestoredValue[][]>();
        const contents = await readCheckpoint(createReadStream(exported.file), {
          onRow(table, values) {
            rows.set(table.name, [...(rows.get(table.name) ?? []), values]);
          },
        });
        const legacy = structuredClone(contents.manifest);
        legacy.tables = legacy.tables.filter((table) => !(PLAYER_RECORD_TABLES as readonly string[]).includes(table.name));
        const chunks: Buffer[] = [];
        await writeCheckpoint(
          new Writable({
            write(chunk, _encoding, callback) {
              chunks.push(Buffer.from(chunk));
              callback();
            },
          }),
          legacy,
          (item) => rows.get(item.name) ?? [],
        );
        await store.run("INSERT INTO player_honours (player_id, season, kind, title) VALUES (?, ?, 'cup', 'Stale')", injured.id, state.season);
        await saveTestStep("import checkpoint without player records", () => saves.import(Buffer.concat(chunks)));
        expect(await store.all("SELECT player_id, club_id, league_id, kind, title FROM player_honours")).toEqual([
          { player_id: winner.id, club_id: winner.club_id, league_id: league.id, kind: "league", title: expect.any(String) },
        ]);
        expect(await store.all("SELECT player_id, end_date, data FROM player_injuries")).toEqual([
          { player_id: injured.id, end_date: "2099-01-01", data: '{"backfilled":true}' },
        ]);
        expect((await store.get<{ total: number }>("SELECT count(*) AS total FROM player_milestones"))!.total).toBe(0);
        expect(await store.meta<{ version: number }>("playerRecords")).toMatchObject({ version: 1, milestonesThrough: state.date });
      } finally {
        await rm(exported.file, { force: true });
      }
    }, 300_000);

    it("imports a checkpoint written before market sanctions: no sanctions, Spanish release clauses backfilled on the next market day", async () => {
      const { ensureReleaseClauses } = await import("./world-market.ts");
      const state = await store.meta<GameState>("state");
      const club = (await store.get<{ id: number }>("SELECT id FROM clubs WHERE type = 'club' ORDER BY id LIMIT 1"))!;
      await store.run("INSERT INTO sanctions (club_id, season, kind, start_date, reason) VALUES (?, ?, 'fine', ?, 'Stale')", club.id, state.season, state.date);
      await store.run(
        "INSERT INTO countries (code, name, continent, confederation, reputation, language, region) SELECT 'ES', 'Spain', continent, confederation, reputation, 'Spanish', region FROM countries WHERE NOT EXISTS (SELECT 1 FROM countries WHERE code = 'ES') ORDER BY id LIMIT 1",
      );
      await store.run("UPDATE clubs SET country_id = (SELECT id FROM countries WHERE code = 'ES') WHERE id = ?", club.id);
      await store.run("UPDATE players SET profile = (profile::jsonb #- '{contract,releaseClause}')::text");
      await store.run("DELETE FROM meta WHERE key = 'releaseClauseScan'");
      const exported = await saves.export();
      try {
        const rows = new Map<string, RestoredValue[][]>();
        const contents = await readCheckpoint(createReadStream(exported.file), {
          onRow(table, values) {
            rows.set(table.name, [...(rows.get(table.name) ?? []), values]);
          },
        });
        const legacy = structuredClone(contents.manifest);
        legacy.tables = legacy.tables.filter((table) => table.name !== "sanctions");
        const chunks: Buffer[] = [];
        await writeCheckpoint(
          new Writable({
            write(chunk, _encoding, callback) {
              chunks.push(Buffer.from(chunk));
              callback();
            },
          }),
          legacy,
          (item) => rows.get(item.name) ?? [],
        );
        await saveTestStep("import checkpoint without sanctions", () => saves.import(Buffer.concat(chunks)));
        expect((await store.get<{ total: number }>("SELECT count(*) AS total FROM sanctions"))!.total).toBe(0);
        const spanish = (await store.get<{ total: number }>(
          "SELECT count(*) AS total FROM players WHERE club_id = ? AND role <> 'Retired' AND parent_club_id IS NULL AND coalesce(profile::jsonb #>> '{contract,status}', 'professional') = 'professional'",
          club.id,
        ))!.total;
        expect(spanish).toBeGreaterThan(0);
        expect(await ensureReleaseClauses(store, state.date)).toBeGreaterThanOrEqual(spanish);
        expect(
          (await store.get<{ total: number }>(
            "SELECT count(*) AS total FROM players WHERE club_id = ? AND (profile::jsonb #>> '{contract,releaseClause}')::double precision > 0",
            club.id,
          ))!.total,
        ).toBeGreaterThanOrEqual(spanish);
        // A second scan within four weeks does nothing.
        expect(await ensureReleaseClauses(store, state.date)).toBe(0);
      } finally {
        await rm(exported.file, { force: true });
      }
    }, 300_000);

    it("retains imported autosaves and manual archives while pruning only this career's generated autosaves", async () => {
      const imported = await saves.create("Historical autosave", true);
      await store.run(
        "UPDATE save_slots SET imported = true, created_at = '2000-01-01' WHERE id = ?",
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

    it("deletes the confirmed active career atomically and keeps other careers' snapshots for a new career", async () => {
      const { WORLD_TABLES, tableName } = await import("./sql-schema.ts");
      const world = await import("./world.ts");
      const generateWorldFixture = world.generateWorld;
      const baselineId = baseline.file.replace(".touchline.gz", "");
      const chunks = (id: string) =>
        store.all<{ ordinal: number; data: Buffer }>("SELECT ordinal, data FROM save_chunks WHERE save_id = ? ORDER BY ordinal", id);
      const baselineChunks = await chunks(baselineId);
      const count = async (table: string) =>
        Number((await store.get<{ total: number }>(`SELECT COUNT(*) AS total FROM ${tableName(store.schemaName, table)}`))!.total);
      const original = await store.meta<GameState>("state");
      await store.setMeta("state", { ...original, careerId: "active-delete-lifecycle", careerName: "Delete me" });
      const doomed = [await saves.create("Delete me manual"), await saves.create("Delete me autosave", true)];
      const doomedIds = doomed.map((slot) => slot.file.replace(".touchline.gz", ""));
      const active = await store.meta<GameState>("state");
      const before = await saves.list();
      const kept = before.filter((slot) => !doomed.some((item) => item.file === slot.file));
      expect(kept.map((slot) => slot.file)).toContain(baseline.file);
      const players = await count("players");
      expect(players).toBeGreaterThan(0);
      const marker = await store.get<{ value: string }>("SELECT value FROM meta WHERE key = 'appearanceIndexVersion'");
      expect(marker).toBeDefined();

      await expect(saves.deleteActiveCareer({ careerId: "some-other-career", seed: active.seed }))
        .rejects.toMatchObject({ status: 409, code: "career_mismatch" });
      await expect(saves.deleteActiveCareer({ careerId: active.careerId!, seed: "some-other-seed" }))
        .rejects.toMatchObject({ status: 409, code: "career_mismatch" });
      await expect(store.discardWorld()).rejects.toThrow("writer lock");
      const discard = store.discardWorld.bind(store);
      vi.spyOn(store, "discardWorld").mockImplementationOnce(async () => {
        await discard();
        throw new Error("injected discard failure");
      });
      await expect(saves.deleteActiveCareer({ careerId: active.careerId!, seed: active.seed }))
        .rejects.toThrow("injected discard failure");
      expect(await store.meta("state")).toEqual(active);
      expect(await saves.list()).toEqual(before);
      expect(await count("players")).toBe(players);
      for (const id of doomedIds) expect((await chunks(id)).length).toBeGreaterThan(0);

      expect(await saves.deleteActiveCareer({ careerId: active.careerId!, seed: active.seed })).toEqual({
        deleted: true,
        careerId: "active-delete-lifecycle",
        snapshots: 2,
        message: "Career deleted. Start a new career or load another saved career.",
      });
      expect(await saves.currentState()).toBeNull();
      expect(await saves.list()).toEqual(kept);
      expect(await chunks(baselineId)).toEqual(baselineChunks);
      for (const id of doomedIds) {
        expect(await chunks(id)).toEqual([]);
        expect(await store.get("SELECT id FROM save_slots WHERE id = ?", id)).toBeUndefined();
      }
      expect(await store.all("SELECT key, value FROM meta")).toEqual([{ key: "appearanceIndexVersion", value: marker!.value }]);
      for (const table of WORLD_TABLES.filter((name) => name !== "meta"))
        expect(await count(table), table).toBe(0);
      await expect(saves.deleteActiveCareer({ careerId: active.careerId!, seed: active.seed }))
        .rejects.toMatchObject({ status: 404 });
      expect((await store.run(
        "INSERT INTO news (date, category, title, body) VALUES (?,?,?,?)",
        "2026-07-01", "Test", "Identity", "Reset after deletion",
      )).lastInsertRowid).toBe(1);
      await store.run("DELETE FROM news");

      vi.spyOn(world, "generateWorld").mockImplementation((target, options) =>
        generateWorldFixture(target, { ...options, nations: ["SCO"], squads: "minimum" }));
      expect(await saves.prepareCareer("Next Director")).toEqual({ created: true });
      expect(await saves.list()).toEqual(kept);
      const prepared = (await saves.currentState())!;
      expect(prepared).toMatchObject({ started: false, director: { name: "Next Director" } });
      expect(prepared.careerId).toBeUndefined();
      expect(await saves.deleteActiveCareer({ careerId: null, seed: prepared.seed })).toMatchObject({
        deleted: true,
        careerId: null,
        snapshots: 0,
      });
      expect(await saves.currentState()).toBeNull();
      expect(await saves.list()).toEqual(kept);
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
        const withAccounts = structuredClone(contents.manifest);
        withAccounts.tables.push({
          name: "users",
          columns: [
            { name: "id", type: "nvarchar", nullable: false, maxLength: 100 },
            { name: "game_schema", type: "nvarchar", nullable: false, maxLength: 128 },
          ],
          rowCount: 1,
        });
        const accountChunks: Buffer[] = [];
        await writeCheckpoint(
          new Writable({
            write(chunk, _encoding, callback) {
              accountChunks.push(Buffer.from(chunk));
              callback();
            },
          }),
          withAccounts,
          (table) => table.name === "users" ? [["foreign-account", "dbo"]] : rows.get(table.name) ?? [],
        );
        const clearAccounts = vi.spyOn(store, "clearWorld");
        await expect(saves.import(Buffer.concat(accountChunks))).rejects.toThrow();
        expect(clearAccounts).not.toHaveBeenCalled();
        clearAccounts.mockRestore();
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

    it("refuses snapshots of worlds before version 4 with a clear message and without clearing the career", async () => {
      const { MIN_WORLD_VERSION } = await import("./saves.ts");
      expect(MIN_WORLD_VERSION).toBe(4);
      const original = await store.meta<Record<string, unknown>>("world");
      expect(original.version).toBeGreaterThanOrEqual(MIN_WORLD_VERSION);
      await store.setMeta("world", { ...original, version: 3, expanded: true });
      const legacySlot = await saves.create("Version 3 snapshot");
      const legacyExport = await saves.export();
      await store.setMeta("world", original);
      const state = await store.meta("state");
      const slots = await saves.list();
      const clear = vi.spyOn(store, "clearWorld");
      try {
        await expect(saves.import(createReadStream(legacyExport.file))).rejects.toThrow(
          "This save comes from an older Touchline world (version 3).",
        );
        await expect(saves.restore(legacySlot.file)).rejects.toThrow("Start a new career instead.");
        expect(clear).not.toHaveBeenCalled();
        expect(await store.meta("state")).toEqual(state);
        expect(await store.meta("world")).toEqual(original);
        expect(await saves.list()).toEqual(slots);
      } finally {
        clear.mockRestore();
        await rm(legacyExport.file, { force: true });
      }
    }, 300_000);

    it("keeps the newest ten manual saves per career and never rotates imported ones", async () => {
      const { SAVE_SLOT_LIMITS } = await import("./saves.ts");
      const state = await store.meta<GameState>("state");
      await store.setMeta("state", { ...state, careerId: "manual-cap-career" });
      try {
        const imported = await saves.create("Imported archive");
        await store.run(
          "UPDATE save_slots SET imported = true, created_at = '2000-01-01' WHERE id = ?",
          imported.file.replace(".touchline.gz", ""),
        );
        const autosave = await saves.create("Autosave", true);
        const manual = [];
        for (let index = 0; index <= SAVE_SLOT_LIMITS.manual; index++)
          manual.push(await saves.create(`Manual ${index}`));
        const career = (await saves.list()).filter((slot) => slot.career?.id === "manual-cap-career");
        expect(career.map((slot) => slot.file).sort()).toEqual(
          [imported.file, autosave.file, ...manual.slice(1).map((slot) => slot.file)].sort(),
        );
      } finally {
        await store.setMeta("state", state);
      }
    }, 300_000);

    it("keeps the save being loaded when the pre-load save rotates that career's manual saves", async () => {
      const { SAVE_SLOT_LIMITS } = await import("./saves.ts");
      const state = await store.meta<GameState>("state");
      await store.setMeta("state", { ...state, careerId: "load-rotation-career" });
      try {
        const manual = [];
        for (let index = 0; index < SAVE_SLOT_LIMITS.manual; index++)
          manual.push(await saves.create(`Manual ${index}`));
        const [oldest, nextOldest] = manual;
        const archived = await store.transaction(async () => {
          const snapshot = await saves.create("Before load", false, oldest.file);
          await saves.restore(oldest.file);
          return snapshot;
        });
        const career = (await saves.list())
          .filter((slot) => slot.career?.id === "load-rotation-career" && !slot.automatic)
          .map((slot) => slot.file);
        expect(career.sort()).toEqual([oldest.file, ...manual.slice(2).map((slot) => slot.file), archived.file].sort());
        expect(career).not.toContain(nextOldest.file);
        expect((await store.meta<GameState>("state")).careerId).toBe("load-rotation-career");
        await saves.create("After load");
        expect((await saves.list()).map((slot) => slot.file)).not.toContain(oldest.file);
      } finally {
        await store.setMeta("state", state);
      }
    }, 300_000);

    it("skips the pre-load archive only while the world equals the career's newest manual save", async () => {
      const state = await store.meta<GameState>("state");
      const files = async () => (await saves.list()).map((slot) => slot.file).sort();
      const balance = async () =>
        (await store.get<{ balance: number }>("SELECT balance FROM clubs WHERE id = ?", state.clubId))!.balance;

      await store.setMeta("state", { ...state, careerId: "unchanged-load-career", careerName: "Unchanged load" });
      const manual = await saves.create("Saved just before loading");
      expect((await saves.list()).find((slot) => slot.file === manual.file)!.career).not.toHaveProperty("worldDigest");
      const metadata = (await store.get<{ career_metadata: string }>(
        "SELECT career_metadata FROM save_slots WHERE id = ?",
        manual.file.replace(".touchline.gz", ""),
      ))!.career_metadata;
      expect(JSON.parse(metadata).worldDigest).toMatch(/^[a-f0-9]{64}$/);
      const unchanged = await files();
      expect(await saves.loadCareer(baseline.file)).toEqual({ archived: manual.file });
      expect(await files()).toEqual(unchanged);

      // Any change after the save, even one that keeps the date and every row count, gets a real archive.
      await store.setMeta("state", { ...state, careerId: "changed-load-career", careerName: "Changed load" });
      const saved = await saves.create("Saved before a transfer");
      await store.run("UPDATE clubs SET balance = ? WHERE id = ?", 4321.5, state.clubId);
      const changed = await saves.loadCareer(baseline.file);
      expect(changed.archived).not.toBeNull();
      expect(changed.archived).not.toBe(saved.file);
      expect(await files()).toContain(changed.archived);
      await saves.restore(changed.archived!);
      expect(await balance()).toBe(4321.5);
      expect((await store.meta<GameState>("state")).careerId).toBe("changed-load-career");

      // Autosaves rotate after three, so an unchanged world with only an autosave is still archived.
      await store.setMeta("state", { ...state, careerId: "autosave-load-career", careerName: "Autosave load" });
      const autosave = await saves.create("Autosave", true);
      const autosaved = await saves.loadCareer(baseline.file);
      expect(autosaved.archived).not.toBeNull();
      expect(autosaved.archived).not.toBe(autosave.file);

      // An older manual save with the same world does not stand in for the newest one.
      await store.setMeta("state", { ...state, careerId: "older-match-career", careerName: "Older match" });
      const original = await balance();
      const older = await saves.create("Older manual");
      await store.run("UPDATE clubs SET balance = ? WHERE id = ?", original + 1, state.clubId);
      const newer = await saves.create("Newer manual");
      await store.run("UPDATE clubs SET balance = ? WHERE id = ?", original, state.clubId);
      const reverted = await saves.loadCareer(baseline.file);
      expect([older.file, newer.file, null]).not.toContain(reverted.archived);

      // An unstarted world is never archived, and an unknown save is refused before anything happens.
      await store.setMeta("state", { ...state, started: false });
      expect(await saves.loadCareer(baseline.file)).toEqual({ archived: null });
      await expect(saves.loadCareer("00000000-0000-4000-8000-000000000000.touchline.gz"))
        .rejects.toMatchObject({ status: 404 });
    }, 300_000);

    it("does not reuse a legacy unstarted world with an initialized inbox or archive it as a started career", async () => {
      const world = await import("./world.ts");
      const original = await store.meta<GameState>("state");
      const unstarted = { ...original, started: false };
      await store.setMeta("state", unstarted);
      await store.setMeta("inboxInitialized", true);
      const beforeSlots = await saves.list();
      const generate = vi.spyOn(world, "generateWorld")
        .mockRejectedValueOnce(new Error("fresh generation required"));
      try {
        await expect(saves.startCareer({
          name: "First Director", careerName: "First career", background: "Former scout", clubId: original.clubId,
        })).rejects.toThrow("fresh generation required");
        expect(generate).toHaveBeenCalledOnce();
        // Batched builds commit as they go: the failed build is discarded, leaving no career rather than a partial world.
        expect(await saves.currentState()).toBeNull();
        expect(await store.get("SELECT key FROM meta WHERE key <> 'appearanceIndexVersion'")).toBeUndefined();
        expect(await saves.list()).toEqual(beforeSlots);
      } finally {
        generate.mockRestore();
      }
    }, 300_000);

    it("discards a failed regeneration while retaining the previous career's safety checkpoint", async () => {
      const world = await import("./world.ts");
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
      expect(await saves.currentState()).toBeNull();
      expect(await store.get("SELECT key FROM meta WHERE key = 'worldBuild'")).toBeUndefined();
      expect((await store.get<{ total: number }>("SELECT COUNT(*) AS total FROM players"))!.total).toBe(0);
      const slots = await saves.list();
      expect(slots.length).toBe(beforeCount + 1);
      expect(slots[0].career?.id).toBe(before.careerId);
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

  it("round-trips rows larger than compression batches with bounded backpressure and unchanged digests", async () => {
    const input = manifest();
    input.tables[0].rowCount = 2;
    const values = [["large", "0123456789".repeat(220000)], ["tail", "preserved"]];
    const chunks: Buffer[] = [];
    const written = await writeCheckpoint(new Writable({
      highWaterMark: 1024,
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        setImmediate(callback);
      },
    }), input, (table) => table.name === "meta" ? values : []);
    const restored: RestoredValue[][] = [];
    const read = await readCheckpoint(Readable.from(chunks), {
      expected: schema,
      onRow(_table, row) { restored.push(row); },
    });
    expect(restored).toEqual(values);
    expect(read).toEqual(written);
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
    const rating = { name: "reputation", type: "float", nullable: false } as const;
    expect(encodeCell(78.125, rating)).toBe(78.125);
    expect(encodeCell(78n, rating)).toBe(78);
    expect(() => encodeCell(9007199254740993n, rating)).toThrow("exactly");
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

describe("career load speed-ups (no database)", () => {
  async function write(input: CheckpointManifest, rows: (name: string) => unknown[][]) {
    const chunks: Buffer[] = [];
    const summary = await writeCheckpoint(
      new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.from(chunk));
          callback();
        },
      }),
      input,
      (table) => rows(table.name),
    );
    return { data: Buffer.concat(chunks), summary };
  }
  const counted = () => {
    const input = manifest();
    input.tables[0].rowCount = 1;
    input.tables[1].rowCount = 1;
    return input;
  };
  const world = (name: string) => (name === "meta" ? [["state", "{}"]] : [[42, "Northbridge"]]);

  it("gives the same world the same digest whenever it was saved, and any change a new one", async () => {
    const first = await write(counted(), world);
    const later = await write({ ...counted(), createdAt: "2027-01-01T00:00:00.000Z" }, world);
    expect(later.summary.sha256).not.toBe(first.summary.sha256);
    expect(worldDigest(later.summary)).toBe(worldDigest(first.summary));
    const changed = await write(counted(), (name) => (name === "meta" ? [["state", "{}"]] : [[42, "Southbridge"]]));
    expect(worldDigest(changed.summary)).not.toBe(worldDigest(first.summary));
    const widened = counted();
    widened.tables[1].columns[1].maxLength = 300;
    expect(worldDigest((await write(widened, world)).summary)).not.toBe(worldDigest(first.summary));
    const read = await readCheckpoint(Readable.from([first.data]), { expected: schema });
    expect(worldDigest(read)).toBe(worldDigest(first.summary));
    expect(() => worldDigest({ ...first.summary, tables: first.summary.tables.slice(1) })).toThrow("does not match");
  });

  function chunkStore(chunks: { ordinal: number; data: Buffer }[], failFrom?: number) {
    const reads: number[] = [];
    const store = {
      schemaName: "touchline_test_chunks",
      async all(sql: string, _id: string, from: number) {
        expect(sql).toMatch(/\bLIMIT 4\b/);
        reads.push(from);
        if (failFrom !== undefined && from >= failFrom) throw new Error("injected read failure");
        return chunks
          .filter((chunk) => chunk.ordinal >= from)
          .slice(0, 4)
          .map((chunk) => ({ ...chunk, byte_length: chunk.data.length }));
      },
    } as unknown as Store;
    return { store, reads };
  }
  const pieces = (count: number) =>
    Array.from({ length: count }, (_, ordinal) => ({ ordinal, data: Buffer.from(`chunk-${ordinal};`) }));
  const length = (chunks: { data: Buffer }[]) => chunks.reduce((total, chunk) => total + chunk.data.length, 0);
  const collect = async (iterable: AsyncIterable<Buffer>) => {
    const parts: Buffer[] = [];
    for await (const part of iterable) parts.push(part);
    return Buffer.concat(parts);
  };

  it("reads save chunks four at a time in order and still refuses gaps, overruns and short saves", async () => {
    const { storedChunks } = await import("./saves.ts");
    for (const [count, reads] of [[8, [0, 4, 8]], [6, [0, 4]], [1, [0]]] as const) {
      const chunks = pieces(count);
      const fake = chunkStore(chunks);
      expect(await collect(storedChunks(fake.store, { id: "slot", byte_length: length(chunks) }))).toEqual(
        Buffer.concat(chunks.map((chunk) => chunk.data)),
      );
      expect(fake.reads).toEqual(reads);
    }
    const gap = pieces(6).filter((chunk) => chunk.ordinal !== 2);
    await expect(collect(storedChunks(chunkStore(gap).store, { id: "slot", byte_length: length(gap) })))
      .rejects.toThrow("missing");
    const short = pieces(5);
    await expect(collect(storedChunks(chunkStore(short).store, { id: "slot", byte_length: length(short) + 1 })))
      .rejects.toThrow("incomplete");
    await expect(collect(storedChunks(chunkStore([]).store, { id: "slot", byte_length: 0 })))
      .rejects.toThrow("incomplete");
    await expect(collect(storedChunks(chunkStore(pieces(8)).store, { id: "slot", byte_length: length(pieces(7)) })))
      .rejects.toThrow("exceed");
  });

  it("settles an abandoned or failed prefetch without an unhandled rejection", async () => {
    const { storedChunks } = await import("./saves.ts");
    const chunks = pieces(8);
    const abandoned = chunkStore(chunks, 4);
    for await (const part of storedChunks(abandoned.store, { id: "slot", byte_length: length(chunks) })) {
      expect(part).toEqual(chunks[0].data);
      break;
    }
    expect(abandoned.reads).toEqual([0, 4]);
    await expect(collect(storedChunks(chunkStore(chunks, 4).store, { id: "slot", byte_length: length(chunks) })))
      .rejects.toThrow("injected read failure");
  });

  it("validates a checkpoint while writing exactly the validated bytes to a new private file", async () => {
    const { writeThrough } = await import("./saves.ts");
    const { data, summary } = await write(counted(), world);
    const directory = await mkdtemp(join(tmpdir(), "touchline-write-through-"));
    try {
      const file = join(directory, "slot.touchline.gz");
      const parts = [data.subarray(0, 7), data.subarray(7, 20), data.subarray(20)];
      async function* source() {
        yield* parts;
      }
      const streamed = await readCheckpoint(Readable.from(writeThrough(file, source()), { objectMode: false }), {
        expected: schema,
      });
      expect(streamed).toEqual(summary);
      expect(await readFile(file)).toEqual(data);
      expect(await readCheckpoint(createReadStream(file), { expected: schema })).toEqual(summary);
      await expect(readCheckpoint(Readable.from(writeThrough(file, source()), { objectMode: false })))
        .rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(file)).toEqual(data);
      async function* broken() {
        yield data.subarray(0, 20);
        throw new Error("injected download failure");
      }
      await expect(
        readCheckpoint(Readable.from(writeThrough(join(directory, "broken.touchline.gz"), broken()), { objectMode: false })),
      ).rejects.toThrow("injected download failure");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
