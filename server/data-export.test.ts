import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportOptions, main, verifyBackup } from "../scripts/data-export.ts";
import { SAVE_FORMAT_VERSION, SAVE_SCHEMA_VERSION, writeCheckpoint, type CheckpointManifest } from "./save-format.ts";

vi.mock("./db.ts", () => ({ Store: { open: () => Promise.reject(new Error("The offline backup check must not open SQL.")) } }));

interface FakeItem { kind: string; schema: string; file: string; bytes: number; sha256: string; rows?: Record<string, number> }
interface FakeManifest {
  format: string; version: number; database: string; startedAt: string; updatedAt: string; complete: boolean;
  items: Record<string, FakeItem>; failures: Record<string, string>;
}

const SNAPSHOT_KEY = "dbo/snapshots/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const SNAPSHOT = `${SNAPSHOT_KEY}.touchline.gz`;
const WORLD = "dbo/world.touchline.gz";
const OWNER_WORLD = "touchline_user_0a1b2c3d4e5f4a6b8c7d9e0f1a2b3c4d";
const checkpoint: CheckpointManifest = {
  kind: "manifest",
  format: "touchline",
  formatVersion: SAVE_FORMAT_VERSION,
  schemaVersion: SAVE_SCHEMA_VERSION,
  createdAt: "2026-09-26T02:15:00.000Z",
  tables: [
    { name: "meta", rowCount: 1, columns: [
      { name: "key", type: "nvarchar", nullable: false, maxLength: 64 },
      { name: "value", type: "nvarchar", nullable: false, maxLength: -1 },
    ] },
    { name: "clubs", rowCount: 2, columns: [{ name: "id", type: "int", nullable: false }] },
  ],
};
const rows: Record<string, unknown[][]> = { meta: [["state", "{}"]], clubs: [[1], [2]] };

let directory = "";
let manifest: FakeManifest;

const save = () => writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
async function fileItem(kind: string, schema: string, file: string, counts?: Record<string, number>): Promise<FakeItem> {
  const data = await readFile(join(directory, file));
  return { kind, schema, file, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex"), ...(counts ? { rows: counts } : {}) };
}

// A tiny --everything backup as the exporter lays it out: registry, one world checkpoint, one snapshot.
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "touchline-backup-"));
  await mkdir(join(directory, "dbo", "snapshots"), { recursive: true });
  for (const file of [WORLD, SNAPSHOT])
    await writeCheckpoint(createWriteStream(join(directory, file)), checkpoint, (table) => rows[table.name]);
  await writeFile(join(directory, "accounts-users.json"), JSON.stringify({ schema: "accounts", accounts: [{ id: "a" }, { id: "b" }] }));
  manifest = {
    format: "touchline-backup", version: 1, database: "touchline", startedAt: "2026-09-26T02:15:00.000Z",
    updatedAt: "2026-09-26T02:16:00.000Z", complete: true, failures: {},
    items: {
      registry: await fileItem("registry", "accounts", "accounts-users.json", { users: 2 }),
      "dbo/world": await fileItem("world", "dbo", WORLD, { meta: 1, clubs: 2 }),
      [SNAPSHOT_KEY]: await fileItem("snapshot", "dbo", SNAPSHOT),
    },
  };
  await save();
});

afterEach(() => rm(directory, { recursive: true, force: true }));

describe("full backup verification (no database)", () => {
  it("passes an intact backup: sizes, SHA-256, gzip, per-table row counts and the registry", async () => {
    expect(await verifyBackup(directory)).toMatchObject({ ok: true, files: 3, worlds: 1, snapshots: 1, problems: [] });
  });

  it("fails a tampered file", async () => {
    const data = await readFile(join(directory, WORLD));
    data[data.length >> 1] ^= 0xff;
    await writeFile(join(directory, WORLD), data);
    expect((await verifyBackup(directory)).problems).toEqual(["dbo/world: size or SHA-256 differs"]);
  });

  it("fails an incomplete backup: recorded failures, a truncated file and a missing file, with account worlds masked", async () => {
    manifest.complete = false;
    manifest.failures = { [`${OWNER_WORLD}/world`]: "Connection reset." };
    await save();
    await truncate(join(directory, SNAPSHOT), 10);
    await rm(join(directory, "accounts-users.json"));
    const result = await verifyBackup(directory);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      "backup incomplete: touchline_user_0a1b***3c4d/world",
      "registry: missing",
      `${SNAPSHOT_KEY}: size or SHA-256 differs`,
    ]);
    expect(JSON.stringify(result)).not.toContain(OWNER_WORLD);
    delete manifest.items["dbo/world"];
    await save();
    expect((await verifyBackup(directory)).problems).toEqual(expect.arrayContaining([
      "no world file in the backup", "dbo: snapshots without its world file",
    ]));
  });

  it("fails a bad gzip even when the manifest recorded its SHA-256", async () => {
    await writeFile(join(directory, SNAPSHOT), "not gzip");
    await truncate(join(directory, WORLD), (await readFile(join(directory, WORLD))).length - 12);
    manifest.items[SNAPSHOT_KEY] = await fileItem("snapshot", "dbo", SNAPSHOT);
    manifest.items["dbo/world"] = await fileItem("world", "dbo", WORLD, { meta: 1, clubs: 2 });
    await save();
    expect((await verifyBackup(directory)).problems).toEqual([
      expect.stringMatching(/^dbo\/world: content check failed \(.+\)$/),
      expect.stringMatching(/^dbo\/snapshots\/[0-9a-f-]+: content check failed \(.+\)$/),
    ]);
  });

  it("fails when per-table row counts or the account count differ from the manifest", async () => {
    manifest.items["dbo/world"].rows = { meta: 1, clubs: 3 };
    manifest.items.registry.rows = { users: 3 };
    await save();
    expect((await verifyBackup(directory)).problems).toEqual([
      "registry: account count differs from the manifest",
      "dbo/world: row counts differ from the manifest (clubs)",
    ]);
  });

  it("runs as npm run data:export -- --verify without SQL and exits 1 on problems", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const previous = process.exitCode;
    try {
      await main(["--verify", directory]);
      expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ ok: true, problems: [] });
      expect(process.exitCode).toBe(previous);
      await rm(join(directory, SNAPSHOT));
      await main(["--verify", directory]);
      expect(JSON.parse(String(log.mock.calls[1][0]))).toMatchObject({ ok: false, problems: [`${SNAPSHOT_KEY}: missing`] });
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previous;
      log.mockRestore();
    }
  });
});

describe("data-export flags (no database)", () => {
  it("accepts each documented mode", () => {
    expect(exportOptions(["--verify", "backup"])).toMatchObject({ verify: "backup" });
    expect(exportOptions(["--out", "world.touchline.gz", "--database", "touchline"])).toMatchObject({ out: "world.touchline.gz", database: "touchline" });
    expect(exportOptions(["--everything", "--out-dir", "backup", "--skip-snapshots"])).toMatchObject({ everything: true, "out-dir": "backup" });
    expect(exportOptions(["--dry-run"])).toMatchObject({ "dry-run": true });
    expect(exportOptions(["--verify-staging", "staging"])).toMatchObject({ "verify-staging": "staging" });
    expect(exportOptions(["--help"])).toBeUndefined();
  });

  it("rejects mixed or misplaced flags and names the right one", () => {
    expect(() => exportOptions(["--everything"])).toThrow(/requires --out-dir/);
    expect(() => exportOptions(["--everything", "--out", "backup"])).toThrow(/use --out-dir/);
    expect(() => exportOptions(["--out-dir", "backup"])).toThrow(/only for --everything/);
    expect(() => exportOptions(["--verify", "backup", "--out-dir", "backup"])).toThrow(/only for --everything/);
    expect(() => exportOptions(["--verify", "backup", "--skip-snapshots"])).toThrow(/only for --everything/);
    expect(() => exportOptions(["--out", "world.touchline.gz", "--verify", "backup"])).toThrow(/exactly one/);
    expect(() => exportOptions(["--verify", "backup", "--database", "touchline"])).toThrow(/no --database/);
    expect(() => exportOptions([])).toThrow(/exactly one/);
  });
});
