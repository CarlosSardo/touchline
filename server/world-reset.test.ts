import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { Saves } from "./saves.ts";
import { generateWorld } from "./world.ts";
import {
  addForeignKeySql,
  allResetSchemas,
  foreignKeys,
  planSchemaReset,
  resetSchema,
  resetSchemaName,
  worldResetOptions,
  type ForeignKeyRow,
} from "../scripts/world-reset.ts";

const chunkKey: ForeignKeyRow = {
  name: "FK_chunks",
  parent_schema: "touchline_user_a",
  parent_table: "save_chunks",
  referenced_schema: "touchline_user_a",
  referenced_table: "save_slots",
  columns: "[save_id]",
  referenced_columns: "[id]",
  on_delete: "CASCADE",
  on_update: "NO_ACTION",
  is_disabled: false,
};

describe("world reset options (no database)", () => {
  it("is a dry run unless --apply --yes is given", () => {
    expect(worldResetOptions(["--all"], false)).toEqual({ schemas: [], all: true, accountSchema: "accounts", apply: false, allowSessions: false });
    expect(worldResetOptions(["--all", "--apply", "--yes", "--allow-sessions"], false)).toMatchObject({ apply: true, allowSessions: true });
    expect(worldResetOptions(["--schema", "dbo", "--apply", "--yes"], false)).toMatchObject({ schemas: ["dbo"], apply: true });
    expect(() => worldResetOptions(["--all", "--apply"], false)).toThrow(/--apply --yes/);
    expect(() => worldResetOptions([], false)).toThrow(/--all or/);
    expect(() => worldResetOptions(["--all", "--schema", "dbo"], false)).toThrow(/--all or/);
    expect(() => worldResetOptions(["--schema", "dbo", "--schema", "DBO"], false)).toThrow(/once/);
    expect(worldResetOptions(["--help"], false)).toBeUndefined();
  });

  it("never resets the account registry, and test schemas only on a local server", () => {
    expect(() => worldResetOptions(["--schema", "accounts"], false)).toThrow();
    expect(() => resetSchemaName("touchline_e2e_run", "accounts", false)).toThrow();
    expect(resetSchemaName("touchline_e2e_run", "accounts", true)).toBe("touchline_e2e_run");
    expect(resetSchemaName("touchline_user_0a1b", "accounts", false)).toBe("touchline_user_0a1b");
  });

  it("--all also covers unregistered worlds and reports the ones it may not touch", () => {
    const worlds = ["accounts", "dbo", "touchline_e2e_run", "touchline_user_0a1b", "touchline_user_ffff"];
    expect(allResetSchemas(["touchline_user_0a1b"], worlds, "accounts", false)).toEqual({
      schemas: ["dbo", "touchline_user_0a1b", "touchline_user_ffff"],
      skipped: [
        { schema: "accounts", reason: expect.stringMatching(/left untouched/) },
        { schema: "touchline_e2e_run", reason: expect.stringMatching(/left untouched/) },
      ],
    });
    expect(allResetSchemas([], worlds, "accounts", true).schemas).toContain("touchline_e2e_run");
  });

  it("re-creates a foreign key with its referential actions and refuses odd column lists", () => {
    const sql = addForeignKeySql(chunkKey);
    expect(sql).toContain("[touchline_user_a].[save_chunks] WITH CHECK ADD CONSTRAINT [FK_chunks]");
    expect(sql).toContain("REFERENCES [touchline_user_a].[save_slots] ([id])");
    expect(sql).toContain("ON DELETE CASCADE ON UPDATE NO ACTION");
    expect(() => addForeignKeySql({ ...chunkKey, columns: "[save_id]); DROP TABLE x; --" })).toThrow(/column list/);
    expect(() => addForeignKeySql({ ...chunkKey, on_delete: "DROP" })).toThrow(/action/);
  });
});

describe("world reset (SQL)", () => {
  let store: Store;

  beforeAll(async () => {
    store = await Store.createTest("world-reset");
    await generateWorld(store, { nations: ["SCO"], squads: "minimum", seed: "reset-world" });
    await new Saves(store).create("Before the reset");
  });

  afterAll(async () => {
    await store?.close();
  });

  it("empties worlds and snapshots in one transaction and leaves a freshly provisioned schema", async () => {
    const before = await planSchemaReset(store);
    expect(before.refused).toBeUndefined();
    expect(before.snapshots).toBe(1);
    expect(before.tables.find((table) => table.name === "players")?.rows).toBeGreaterThan(0);
    const keys = await foreignKeys(store);
    expect(keys.length).toBeGreaterThan(20);

    const result = await resetSchema(store);
    expect(result).toMatchObject({ snapshotsRemoved: 1, foreignKeys: keys.length });

    for (const table of ["players", "clubs", "countries", "fixtures", "save_slots", "save_chunks", "news"]) {
      const row = await store.get<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table}`);
      expect(row?.total, table).toBe(0);
    }
    expect(await store.all("SELECT [key] FROM meta")).toEqual([{ key: "appearanceIndexVersion" }]);
    expect((await store.all<{ version: number }>("SELECT [version] FROM schema_migrations")).length).toBeGreaterThan(0);
    expect(await foreignKeys(store)).toEqual(keys);
    expect(await store.all(
      "SELECT [name] FROM sys.foreign_keys WHERE [schema_id] = SCHEMA_ID(?) AND [is_not_trusted] = 1",
      store.schemaName,
    )).toEqual([]);
    expect(await new Saves(store).currentState()).toBeNull();
    expect(await new Saves(store).list()).toEqual([]);

    // Identities restart and a new career world can be generated in the same schema.
    await generateWorld(store, { nations: ["SCO"], squads: "minimum", seed: "after-reset" });
    expect((await store.get<{ low: number }>("SELECT MIN(id) AS low FROM countries"))?.low).toBe(1);
    expect(await new Saves(store).currentState()).not.toBeNull();
  });

  it("refuses a schema whose keys reach outside its world tables", async () => {
    await store.exec(`CREATE TABLE [${store.schemaName}].[reset_probe] ([id] INT NOT NULL PRIMARY KEY,
      [country_id] INT NULL REFERENCES [${store.schemaName}].[countries]([id]));`);
    try {
      expect((await planSchemaReset(store)).refused).toMatch(/outside/);
      await expect(resetSchema(store)).rejects.toThrow(/outside/);
      expect((await store.get<{ total: number }>("SELECT COUNT(*) AS total FROM countries"))?.total).toBeGreaterThan(0);
    } finally {
      await store.exec(`DROP TABLE [${store.schemaName}].[reset_probe];`);
    }
  });
});
