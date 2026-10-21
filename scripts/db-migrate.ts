import { parseArgs } from "node:util";
import { registeredAccountSchemas, validateAccountSchema } from "../server/accounts.ts";
import { isMain } from "./data-export.ts";
import { inviteRequestsTableSql } from "../server/sql-schema.ts";

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      help: { type: "boolean" },
      database: { type: "string" },
      registered: { type: "boolean" },
      "account-schema": { type: "string" },
      apply: { type: "boolean" },
      yes: { type: "boolean" },
      "dry-run": { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: tsx scripts/db-migrate.ts [--dry-run] [--database NAME] [--registered --account-schema accounts]\n       tsx scripts/db-migrate.ts --apply --yes [--database NAME] [--registered --account-schema accounts]\nApplies versioned SQL schema migrations only. Never seeds a world. Startup does neither. Uses SQL_* connection settings.\nDefault: only SQL_SCHEMA (public when unset). --registered: every existing world in the separate account registry; missing registries/worlds fail closed.\nAccount registry initialization and new users require accounts-migrate.ts, never world migrations.",
    );
    return;
  }
  if (values.apply && values["dry-run"])
    throw new Error("Choose --apply or --dry-run, not both.");
  if (values["account-schema"] && !values.registered)
    throw new Error("--account-schema requires --registered.");
  const accountSchema = values.registered
    ? validateAccountSchema(values["account-schema"] ?? "accounts", process.env.SQL_TEST_MODE === "true")
    : undefined;
  if (!values.apply) {
    const { schemaMigrations } = await import("../server/sql-schema.ts");
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          database: values.database ?? process.env.SQL_DATABASE ?? "touchline",
          schema: process.env.SQL_SCHEMA ?? "public",
          registered: Boolean(values.registered),
          accountSchema,
          migrations: schemaMigrations(process.env.SQL_SCHEMA ?? "public").map(
            ({ version, name }) => ({ version, name }),
          ),
          note: values.registered
            ? "Offline plan only; SQL was not opened. Apply resolves and validates all registered world schemas before migrating. The registry is not a world migration target."
            : "Offline plan only; SQL was not opened. Use --apply --yes to apply pending versions.",
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
    if (accountSchema) {
      const registry = store.forSchema(accountSchema);
      try {
        await registry.exec(inviteRequestsTableSql(accountSchema));
      } finally {
        await registry.close();
      }
    }
    const schemas = values.registered
      ? await registeredAccountSchemas(store, accountSchema, { allowLegacyRegistry: false })
      : [store.schemaName];
    for (const schema of schemas) {
      const scoped = schema === store.schemaName ? store : store.forSchema(schema);
      try {
        await scoped.schema();
      } finally {
        if (scoped !== store) await scoped.close();
      }
    }
    console.log(
      JSON.stringify(
        {
          migrated: true,
          database: store.database,
          schema: store.schemaName,
          schemas,
          accountSchema,
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
