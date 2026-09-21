import { parseArgs } from "node:util";
import { backupBeforeReplace, isMain } from "./data-export.ts";
import type { WorldOptions } from "../server/world.ts";

function positiveInteger(value: string | undefined, maximum: number) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum)
    throw new Error(
      `World counts must be whole numbers between 1 and ${maximum}.`,
    );
  return parsed;
}

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
      countries: { type: "string" },
      seniors: { type: "string" },
      youth: { type: "string" },
      expanded: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: tsx scripts/db-seed.ts --seed TEXT [--dry-run] [--database NAME]\n       tsx scripts/db-seed.ts --seed TEXT --apply --yes [--countries N --seniors N --youth N --expanded]\n       Add --replace --backup <new-file.touchline.gz> to replace a nonempty world. Saved checkpoints remain intact.\nRun db-migrate explicitly first. Uses SQL_* connection settings; never starts the app.",
    );
    return;
  }
  if (values.apply && values["dry-run"])
    throw new Error("Choose --apply or --dry-run, not both.");
  if (!values.seed || values.seed.length > 100)
    throw new Error("Supply --seed with 1 to 100 characters.");
  const options: WorldOptions = {
    seed: values.seed,
    countryLimit: positiveInteger(values.countries, 243),
    seniors: positiveInteger(values.seniors, 2_000_000),
    youth: positiveInteger(values.youth, 2_000_000),
    expanded: values.expanded,
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
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
