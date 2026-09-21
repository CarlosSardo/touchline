import { parseArgs } from "node:util";
import { isMain } from "./data-export.ts";

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      help: { type: "boolean" },
      database: { type: "string" },
      apply: { type: "boolean" },
      yes: { type: "boolean" },
      "dry-run": { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: tsx scripts/db-migrate.ts [--dry-run] [--database NAME]\n       tsx scripts/db-migrate.ts --apply --yes [--database NAME]\nApplies versioned SQL schema migrations only. Never seeds a world. Startup does neither. Uses SQL_* connection settings.",
    );
    return;
  }
  if (values.apply && values["dry-run"])
    throw new Error("Choose --apply or --dry-run, not both.");
  if (!values.apply) {
    const { schemaMigrations } = await import("../server/sql-schema.ts");
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          database: values.database ?? process.env.SQL_DATABASE ?? "touchline",
          schema: process.env.SQL_SCHEMA ?? "dbo",
          migrations: schemaMigrations(process.env.SQL_SCHEMA ?? "dbo").map(
            ({ version, name }) => ({ version, name }),
          ),
          note: "Offline plan only; SQL was not opened. Use --apply --yes to apply pending versions.",
        },
        null,
        2,
      ),
    );
    return;
  }
  if (!values.yes) throw new Error("Schema changes require --apply --yes.");
  const { Store } = await import("../server/db.ts");
  const store = await Store.open(values.database);
  try {
    await store.schema();
    console.log(
      JSON.stringify(
        {
          migrated: true,
          database: store.database,
          schema: store.schemaName,
          seeded: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await store.close();
  }
}

if (isMain(import.meta.url))
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
