import { parseArgs } from "node:util";
import { backupBeforeReplace, isMain } from "./data-export.ts";
import type { WorldOptions } from "../server/world.ts";

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      help: { type: "boolean" },
      database: { type: "string" },
      apply: { type: "boolean" },
      yes: { type: "boolean" },
      "dry-run": { type: "boolean" },
      replace: { type: "boolean" },
      backup: { type: "string" },
      seed: { type: "string" },
      nations: { type: "string" },
      squads: { type: "string" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: tsx scripts/db-seed.ts --seed TEXT [--dry-run] [--database NAME]\n       tsx scripts/db-seed.ts --seed TEXT --apply --yes [--nations PT,IE,NIR --squads full|minimum]\n       Add --replace --backup <new-file.touchline.gz> to replace a nonempty world. Saved checkpoints remain intact.\n--nations limits the world to those catalog nation codes (tests and tools); the default is the full world.\nRun db-migrate explicitly first. Uses SQL_* connection settings; never starts the app.",
    );
    return;
  }
  if (values.apply && values["dry-run"])
    throw new Error("Choose --apply or --dry-run, not both.");
  if (!values.seed || values.seed.length > 100)
    throw new Error("Supply --seed with 1 to 100 characters.");
  const nations = values.nations?.split(",").map((code) => code.trim().toUpperCase()).filter(Boolean);
  if (nations && (!nations.length || nations.some((code) => !/^[A-Z]{2,4}$/.test(code))))
    throw new Error("--nations takes comma-separated catalog nation codes, e.g. PT,IE,NIR.");
  if (values.squads !== undefined && values.squads !== "full" && values.squads !== "minimum")
    throw new Error("--squads must be full or minimum.");
  const options: WorldOptions = {
    seed: values.seed,
    ...(nations ? { nations } : {}),
    ...(values.squads ? { squads: values.squads as "full" | "minimum" } : {}),
  };
  if (!values.apply) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          database: values.database ?? process.env.SQL_DATABASE ?? "touchline",
          schema: process.env.SQL_SCHEMA ?? "dbo",
          options,
          note: "Offline plan only; no SQL connection or writes. Existing data is guarded at apply time.",
        },
        null,
        2,
      ),
    );
    return;
  }
  if (!values.yes) throw new Error("World seeding requires --apply --yes.");
  const { Store } = await import("../server/db.ts");
  const { generateWorld } = await import("../server/world.ts");
  const { createCalendar } = await import("../server/calendar.ts");
  const { initialInbox } = await import("../server/systems.ts");
  const store = await Store.open(values.database);
  try {
    const result = await store.transaction(async () => {
      const previous = await backupBeforeReplace(store, values);
      await store.clearWorld();
      await generateWorld(store, options);
      await createCalendar(store);
      await initialInbox(store);
      return {
        seeded: true,
        database: store.database,
        schema: store.schemaName,
        backup: previous.backup,
        world: await store.meta("world"),
      };
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await store.close();
  }
}

if (isMain(import.meta.url))
  void main().catch((error: unknown) => {
    // Usage errors print their message; unexpected failures (TypeError, RequestError, ...) keep their stack.
    console.error(error instanceof Error ? (error.constructor === Error ? error.message : error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
