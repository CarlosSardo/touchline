import { parseArgs } from "node:util";
import { assertAccountRegistry, ensureAccountRegistry, REGISTRY_TABLES, validateAccountSchema } from "../server/accounts.ts";
import { Store } from "../server/db.ts";
import { readSqlSettings } from "../server/sql-config.ts";
import { tableName } from "../server/sql-schema.ts";
import { isMain } from "./data-export.ts";

export interface RegistryPlan {
  database: string;
  accountSchema: string;
}

const USAGE = `Usage: tsx scripts/accounts-migrate.ts [--database NAME] [--account-schema accounts] [--apply --yes]
Default is an offline dry run. Uses SQL_* connection settings; run it as the database owner.
Creates the account registry (schema "accounts" with the users and access_requests tables) when missing and validates
it. Idempotent; it never creates accounts or worlds and never touches world schemas: administrators are provisioned on
their first sign-in and everyone else is approved at /admin, which creates their empty world.
Use db-migrate.ts --registered for world migrations.`;

export function registryPlan(
  options: { accountSchema?: string; database?: string },
  environment: NodeJS.ProcessEnv = process.env,
): RegistryPlan {
  const settings = readSqlSettings({ ...environment, SQL_DATABASE: options.database ?? environment.SQL_DATABASE });
  const accountSchema = validateAccountSchema(options.accountSchema ?? "accounts");
  if (
    settings.testMode || environment.SQL_ALLOW_REMOTE_TESTS === "true" ||
    environment.SQL_TEST_DATABASE || environment.TOUCHLINE_E2E_SCHEMA
  )
    throw new Error("Account registry creation requires an operator context, never a test context.");
  if (/^touchline_(?:user|test|e2e)_/i.test(settings.schema) || settings.schema.toLowerCase() === accountSchema.toLowerCase())
    throw new Error("Account registry creation requires an operator context, never a registry or a per-user world schema.");
  return { database: settings.database, accountSchema };
}

/** Creates the registry when missing, then validates it and reports its row counts. */
export async function applyRegistry(root: Store, plan: RegistryPlan) {
  if (root.database !== plan.database) throw new Error("The connection does not match the reviewed target.");
  const accountSchema = validateAccountSchema(plan.accountSchema, root.testMode);
  await ensureAccountRegistry(root, accountSchema);
  const registry = root.forSchema(accountSchema);
  try {
    await assertAccountRegistry(registry);
    const counts = await registry.get<{ users: number; access_requests: number }>(
      `SELECT (SELECT count(*) FROM ${tableName(accountSchema, "users")}) AS users,
        (SELECT count(*) FROM ${tableName(accountSchema, "access_requests")}) AS access_requests`,
    );
    return { users: Number(counts?.users ?? 0), accessRequests: Number(counts?.access_requests ?? 0) };
  } finally {
    await registry.close();
  }
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    help: { type: "boolean" }, database: { type: "string" }, "account-schema": { type: "string" },
    "dry-run": { type: "boolean" }, apply: { type: "boolean" }, yes: { type: "boolean" },
  } });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (values.apply && values["dry-run"]) throw new Error("Choose --apply or --dry-run, not both.");
  if (values.apply && !values.yes) throw new Error("Account registry creation requires --apply --yes.");
  const plan = registryPlan({ accountSchema: values["account-schema"], database: values.database });
  if (!values.apply) {
    console.log(JSON.stringify({ dryRun: true, ...plan, tables: [...REGISTRY_TABLES],
      note: "SQL was not opened. --apply --yes creates the registry when missing and validates it; no accounts or worlds are created.",
    }, null, 2));
    return;
  }
  const root = await Store.open(plan.database);
  try {
    const counts = await applyRegistry(root, plan);
    console.log(JSON.stringify({ registry: true, database: root.database, accountSchema: plan.accountSchema, ...counts }, null, 2));
  } finally {
    await root.close();
  }
}

if (isMain(import.meta.url))
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Account registry creation failed.");
    process.exitCode = 1;
  });
