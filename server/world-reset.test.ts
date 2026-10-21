import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { Saves } from "./saves.ts";
import { generateWorld } from "./world.ts";
import {
  allResetSchemas,
  foreignKeys,
  planSchemaReset,
  resetSchema,
  resetSchemaName,
  truncateSql,
  worldResetOptions,
} from "../scripts/world-reset.ts";

describe("world reset options (no database)", () => {
  it("is a dry run unless --apply --yes is given", () => {
    expect(worldResetOptions(["--all"], false)).toEqual({ schemas: [], all: true, accountSchema: "accounts", apply: false, allowSessions: false });
    expect(worldResetOptions(["--all", "--apply", "--yes", "--allow-sessions"], false)).toMatchObject({ apply: true, allowSessions: true });
    expect(worldResetOptions(["--schema", "public", "--apply", "--yes"], false)).toMatchObject({ schemas: ["public"], apply: true });
    expect(() => worldResetOptions(["--all", "--apply"], false)).toThrow(/--apply --yes/);
    expect(() => worldResetOptions([], false)).toThrow(/--all or/);
    expect(() => worldResetOptions(["--all", "--schema", "public"], false)).toThrow(/--all or/);
    expect(() => worldResetOptions(["--schema", "public", "--schema", "PUBLIC"], false)).toThrow(/once/);
    expect(worldResetOptions(["--help"], false)).toBeUndefined();
  });

  it("never resets the account registry, and test schemas only on a local server", () => {
    expect(() => worldResetOptions(["--schema", "accounts"], false)).toThrow();
    expect(() => resetSchemaName("touchline_e2e_run", "accounts", false)).toThrow();
    expect(resetSchemaName("touchline_e2e_run", "accounts", true)).toBe("touchline_e2e_run");
    expect(resetSchemaName("touchline_user_0a1b", "accounts", false)).toBe("touchline_user_0a1b");
  });

  it("--all also covers unregistered worlds and reports the ones it may not touch", () => {
    const worlds = ["accounts", "public", "touchline_e2e_run", "touchline_user_0a1b", "touchline_user_ffff"];
    expect(allResetSchemas(["touchline_user_0a1b"], worlds, "accounts", false)).toEqual({
      schemas: ["public", "touchline_user_0a1b", "touchline_user_ffff"],
      skipped: [
        { schema: "accounts", reason: expect.stringMatching(/left untouched/) },
        { schema: "touchline_e2e_run", reason: expect.stringMatching(/left untouched/) },
      ],
    });
    expect(allResetSchemas([], worlds, "accounts", true).schemas).toContain("touchline_e2e_run");
  });

  it("truncates every world table in one statement and only known world tables", () => {
    expect(truncateSql("touchline_user_a", ["save_slots", "save_chunks", "players"])).toBe(
      'TRUNCATE TABLE "touchline_user_a"."save_slots", "touchline_user_a"."save_chunks", "touchline_user_a"."players" RESTART IDENTITY;',
    );
    expect(() => truncateSql("touchline_user_a", ["schema_migrations"])).toThrow(/not a resettable/);
    expect(() => truncateSql("touchline_user_a", ["meta"])).toThrow(/not a resettable/);
    expect(() => truncateSql("touchline_user_a", ['players"; DROP TABLE x; --'])).toThrow(/not a resettable/);
    expect(() => truncateSql("touchline_user_a", [])).toThrow(/Nothing/);
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
    expect(await store.all("SELECT key FROM meta")).toEqual([{ key: "appearanceIndexVersion" }]);
    expect((await store.all<{ version: number }>("SELECT version FROM schema_migrations")).length).toBeGreaterThan(0);
    expect(await foreignKeys(store)).toEqual(keys);
    expect(keys.every((key) => key.validated)).toBe(true);
    expect(await new Saves(store).currentState()).toBeNull();
    expect(await new Saves(store).list()).toEqual([]);

    // Identities restart and a new career world can be generated in the same schema.
    await generateWorld(store, { nations: ["SCO"], squads: "minimum", seed: "after-reset" });
    expect((await store.get<{ low: number }>("SELECT MIN(id) AS low FROM countries"))?.low).toBe(1);
    expect(await new Saves(store).currentState()).not.toBeNull();
  });

  it("refuses a schema whose keys reach outside its world tables", async () => {
    await store.exec(`CREATE TABLE "${store.schemaName}".reset_probe (id INTEGER NOT NULL PRIMARY KEY,
      country_id INTEGER NULL REFERENCES "${store.schemaName}".countries (id));`);
    try {
      expect((await planSchemaReset(store)).refused).toMatch(/outside/);
      await expect(resetSchema(store)).rejects.toThrow(/outside/);
      expect((await store.get<{ total: number }>("SELECT COUNT(*) AS total FROM countries"))?.total).toBeGreaterThan(0);
    } finally {
      await store.exec(`DROP TABLE "${store.schemaName}".reset_probe;`);
    }
  });
});
