import { DatabaseSync, backup } from "node:sqlite";
import {
  mkdirSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { Store } from "./db.ts";
import { GameError, settingsOf, stateOf } from "./systems.ts";
import type { SaveSlot } from "../shared/api.ts";
import type { Settings } from "../shared/types.ts";

export class Saves {
  readonly folder: string;
  readonly store: Store;

  constructor(store: Store, folder = resolve("data/saves")) {
    this.store = store;
    this.folder = folder;
    mkdirSync(folder, { recursive: true });
  }

  list(): SaveSlot[] {
    return readdirSync(this.folder)
      .filter((file) => /^[-a-zA-Z0-9_]+\.sqlite(?:\.gz)?$/.test(file))
      .map((file) => {
        const stat = statSync(join(this.folder, file));
        return {
          name: file.replace(/\.sqlite(?:\.gz)?$/, "").replace(/_/g, " "),
          file,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          compressed: file.endsWith(".gz"),
          automatic: file.startsWith("autosave_"),
        };
      })
      .sort((left, right) => right.modified.localeCompare(left.modified));
  }

  async create(name: string, automatic = false) {
    const safeName = name
      .replace(/[^a-zA-Z0-9 -]/g, "")
      .trim()
      .replace(/ +/g, "_")
      .slice(0, 60);
    if (!safeName)
      throw new GameError("Give the save a name using letters or numbers.");
    const state = stateOf(this.store);
    const stem = `${automatic ? "autosave_" : ""}${safeName}_${state.date}_${Date.now()}`;
    const raw = join(this.folder, `${stem}.sqlite`);
    await backup(this.store.db, raw);
    let file = `${stem}.sqlite`;
    if (settingsOf(this.store).saveCompression) {
      writeFileSync(`${raw}.gz`, gzipSync(readFileSync(raw), { level: 1 }));
      unlinkSync(raw);
      file += ".gz";
    }
    if (automatic) {
      for (const old of this.list()
        .filter((save) => save.automatic)
        .slice(3))
        unlinkSync(join(this.folder, old.file));
      const latest = stateOf(this.store);
      latest.lastAutosave = latest.date;
      this.store.setMeta("state", latest);
    }
    return { file, name: safeName.replace(/_/g, " ") };
  }

  async export(): Promise<{ bytes: Buffer; name: string }> {
    const temporary = join(this.folder, `export-${Date.now()}.tmp`);
    try {
      await backup(this.store.db, temporary);
      const raw = readFileSync(temporary);
      const compressed = Boolean(settingsOf(this.store).saveCompression);
      return {
        bytes: compressed ? gzipSync(raw, { level: 1 }) : raw,
        name: `Touchline-${stateOf(this.store).date}.sqlite${compressed ? ".gz" : ""}`,
      };
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }

  restore(file: string) {
    if (
      basename(file) !== file ||
      !this.list().some((save) => save.file === file)
    )
      throw new GameError("Save slot not found.");
    this.import(readFileSync(join(this.folder, file)));
  }

  import(bytes: Buffer) {
    if (this.store.path === ":memory:")
      throw new GameError("Save restoration requires a file-backed game.");
    const raw =
      bytes[0] === 0x1f && bytes[1] === 0x8b
        ? gunzipSync(bytes, { maxOutputLength: 1_500_000_000 })
        : bytes;
    if (raw.subarray(0, 16).toString() !== "SQLite format 3\0")
      throw new GameError("This is not a SQLite game save.");
    const temporary = join(this.folder, `import-${Date.now()}.tmp`);
    writeFileSync(temporary, raw);
    let probe: DatabaseSync | undefined;
    try {
      probe = new DatabaseSync(temporary, { readOnly: true });
      const version = probe
        .prepare("SELECT value FROM meta WHERE key = 'schemaVersion'")
        .get() as { value: string } | undefined;
      const state = probe
        .prepare("SELECT value FROM meta WHERE key = 'state'")
        .get() as { value: string } | undefined;
      const integrity = probe.prepare("PRAGMA quick_check").get() as {
        quick_check: string;
      };
      if (version?.value !== "1" || !state || integrity.quick_check !== "ok")
        throw new GameError("The save is incompatible or damaged.");
      const parsed = JSON.parse(state.value);
      if (typeof parsed.date !== "string" || !Number.isInteger(parsed.clubId))
        throw new GameError("The save has invalid career data.");
      probe.close();
      probe = undefined;
      this.store.close();
      copyFileSync(temporary, this.store.path);
      this.store.db = new DatabaseSync(this.store.path);
      this.store.db.exec(
        "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;",
      );
      this.store.schema();
      const settings = this.store.meta<Settings>("settings");
      this.store.setMeta("settings", { ...settings, cloudSync: false });
    } catch (error) {
      probe?.close();
      if (error instanceof GameError) throw error;
      throw new GameError(
        "The save could not be loaded. Choose a valid Touchline SQLite save.",
      );
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
}
