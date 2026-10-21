import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import {
  accountUuid,
  accountWorldSchema,
  ensureAccountRegistry,
  validateAccountSchema,
  validateAccountWorldSchema,
  type AccountRecord,
} from "../server/accounts.ts";
import { Store } from "../server/db.ts";
import { ACCOUNT_REGISTRY_LOCK, CONSUMER_TENANT_ID } from "../server/invite-store.ts";
import { LEGACY_EMAIL, LEGACY_OBJECT_ID, OWNER_EMAIL_DEFAULT } from "../server/legacy-account.ts";
import { readSqlSettings } from "../server/sql-config.ts";
import { quoteIdentifier, schemaMigrations, STORE_TABLES, tableName } from "../server/sql-schema.ts";
import { isMain } from "./data-export.ts";

export { LEGACY_EMAIL, LEGACY_OBJECT_ID } from "../server/legacy-account.ts";

export interface AccountProvisioningPlan {
  database: string;
  accountSchema: string;
  /** Home organization tenant of OWNER_OBJECT_ID and ALLOWED_USER_OBJECT_IDS; null when only personal accounts sign in. */
  tenantId: string | null;
  /** The approved legacy guest bound to the imported dbo world, or null when there is no legacy world. */
  legacyObjectId: string | null;
  legacyEmail: string | null;
  ownerObjectId: string | null;
  ownerEmail: string;
  objectIds: string[];
}

function assertOperatorRoot(schema: string, accountSchema: string): void {
  if (/^touchline_(?:user|test|e2e)_/i.test(schema) || schema.toLowerCase() === accountSchema.toLowerCase())
    throw new Error("Account provisioning requires an operator context, never a test context, a registry or a per-user world schema.");
}

export function accountProvisioningPlan(
  options: { tenantId?: string; legacyObjectId?: string; legacyEmail?: string; accountSchema?: string; database?: string },
  environment: NodeJS.ProcessEnv = process.env,
): AccountProvisioningPlan {
  const settings = readSqlSettings({ ...environment, SQL_DATABASE: options.database ?? environment.SQL_DATABASE });
  const accountSchema = validateAccountSchema(options.accountSchema ?? "accounts");
  if (
    settings.testMode || environment.SQL_ALLOW_REMOTE_TESTS === "true" ||
    environment.SQL_TEST_DATABASE || environment.TOUCHLINE_E2E_SCHEMA
  )
    throw new Error("Account provisioning requires an operator context, never a test context, a registry or a per-user world schema.");
  assertOperatorRoot(settings.schema, accountSchema);
  const configuredTenant = environment.AUTH_HOME_TENANT_ID?.trim() || undefined;
  const tenantInput = options.tenantId ?? configuredTenant;
  const tenantId = tenantInput === undefined ? null : accountUuid(tenantInput, "--tenant-id");
  if (configuredTenant && accountUuid(configuredTenant, "AUTH_HOME_TENANT_ID") !== tenantId)
    throw new Error("The verified tenant must match AUTH_HOME_TENANT_ID.");
  if (tenantId === CONSUMER_TENANT_ID)
    throw new Error("--tenant-id must be the home organization tenant, not the personal Microsoft account tenant.");
  const ownerEmail = (environment.OWNER_EMAIL ?? OWNER_EMAIL_DEFAULT).trim().toLowerCase();
  if (!ownerEmail || ownerEmail.length > 320)
    throw new Error("OWNER_EMAIL is invalid.");
  const invited = (environment.ALLOWED_USER_OBJECT_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (tenantId === null) {
    if (options.legacyObjectId !== undefined || options.legacyEmail !== undefined || invited.length)
      throw new Error("The legacy guest and ALLOWED_USER_OBJECT_IDS belong to the home tenant: pass --tenant-id.");
    // Personal accounts only: they claim invites on first sign-in, so only the registry itself is created.
    return {
      database: settings.database, accountSchema, tenantId, legacyObjectId: null, legacyEmail: null,
      ownerObjectId: null, ownerEmail, objectIds: [],
    };
  }
  let legacyObjectId: string | null = null;
  let legacyEmail: string | null = null;
  if (options.legacyObjectId !== undefined || options.legacyEmail !== undefined) {
    legacyObjectId = accountUuid(options.legacyObjectId ?? "", "--legacy-object-id");
    legacyEmail = (options.legacyEmail ?? "").trim().toLowerCase();
    if (legacyObjectId !== LEGACY_OBJECT_ID || legacyEmail !== LEGACY_EMAIL)
      throw new Error("The approved dbo legacy binding requires the verified sardo.kiko@gmail.com guest object ID and email.");
  }
  const owner = accountUuid(environment.OWNER_OBJECT_ID ?? "", "OWNER_OBJECT_ID");
  if (owner === legacyObjectId || owner === LEGACY_OBJECT_ID)
    throw new Error("The configured platform owner must not inherit the legacy dbo game.");
  if (invited.length > 100) throw new Error("ALLOWED_USER_OBJECT_IDS may contain at most 100 object IDs.");
  const objectIds = [...new Set([owner, ...invited.map((value) => accountUuid(value, "ALLOWED_USER_OBJECT_IDS"))])];
  if (legacyObjectId && !objectIds.includes(legacyObjectId))
    throw new Error("The verified legacy guest must be explicitly allowlisted before provisioning.");
  if (!legacyObjectId && objectIds.includes(LEGACY_OBJECT_ID))
    throw new Error("The legacy guest needs the reviewed --legacy-object-id and --legacy-email binding.");
  return {
    database: settings.database,
    accountSchema,
    tenantId,
    legacyObjectId,
    legacyEmail,
    ownerObjectId: owner,
    ownerEmail,
    objectIds: legacyObjectId
      ? [legacyObjectId, ...objectIds.filter((objectId) => objectId !== legacyObjectId)]
      : objectIds,
  };
}

function normalizedAccount(account: AccountRecord) {
  return {
    tenantId: accountUuid(account.tenant_id, "Registered tenant ID"),
    objectId: accountUuid(account.object_id, "Registered object ID"),
    email: account.email?.trim().toLowerCase() ?? null,
    schema: account.game_schema.toLowerCase(),
  };
}

function isLegacyMapping(account: AccountRecord, plan: AccountProvisioningPlan): boolean {
  const normalized = normalizedAccount(account);
  return normalized.schema === "dbo" &&
    normalized.email === LEGACY_EMAIL &&
    (
      (normalized.tenantId === plan.tenantId && normalized.objectId === LEGACY_OBJECT_ID) ||
      normalized.tenantId === CONSUMER_TENANT_ID
    );
}

function isOwnerMapping(account: AccountRecord, plan: AccountProvisioningPlan): boolean {
  const normalized = normalizedAccount(account);
  return normalized.email === plan.ownerEmail &&
    (
      (normalized.tenantId === plan.tenantId && normalized.objectId === plan.ownerObjectId) ||
      normalized.tenantId === CONSUMER_TENANT_ID
    );
}

function matchesPlannedIdentity(account: AccountRecord, objectId: string, plan: AccountProvisioningPlan): boolean {
  const normalized = normalizedAccount(account);
  if (normalized.tenantId === plan.tenantId && normalized.objectId === objectId) return true;
  if (objectId === plan.legacyObjectId) return isLegacyMapping(account, plan);
  if (objectId === plan.ownerObjectId) return isOwnerMapping(account, plan);
  return false;
}

export function existingAccountForObject(accounts: AccountRecord[], objectId: string, plan: AccountProvisioningPlan) {
  return accounts.find((account) => matchesPlannedIdentity(account, objectId, plan));
}

export function mappedSchema(account: AccountRecord, plan: AccountProvisioningPlan): string {
  const schema = validateAccountWorldSchema(account.game_schema, plan.accountSchema);
  const expected = isLegacyMapping(account, plan) ? "dbo" : accountWorldSchema(account.id);
  if (schema !== expected)
    throw new Error("Existing account mapping would reassign a world; no reassignment is permitted.");
  return schema;
}

async function assertWorldTables(store: Store): Promise<void> {
  const tables = await store.all<{ name: string }>(
    "SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = ?",
    store.schemaName,
  );
  const names = new Set(tables.map((table) => table.name));
  if (names.size !== STORE_TABLES.size || [...STORE_TABLES].some((table) => !names.has(table)))
    throw new Error(`World ${store.schemaName} is missing or has unexpected tables; inspect it before account provisioning.`);
}

/**
 * Creates the account registry when missing, then registers OWNER_OBJECT_ID and every allowlisted identity, each
 * with a new, empty, migrated touchline_user_<account UUID> world (the approved legacy guest instead keeps the
 * existing dbo world). Idempotent; never reassigns, copies, seeds or adopts an unregistered schema.
 */
export async function provisionAccounts(root: Store, plan: AccountProvisioningPlan) {
  if (root.testMode || root.database !== plan.database)
    throw new Error("The provisioning connection does not match the reviewed target.");
  assertOperatorRoot(root.schemaName, plan.accountSchema);
  if (plan.legacyObjectId !== null && (
    plan.legacyObjectId !== LEGACY_OBJECT_ID || plan.legacyEmail !== LEGACY_EMAIL || !plan.objectIds.includes(LEGACY_OBJECT_ID)
  ))
    throw new Error("The provisioning plan must preserve the approved legacy guest binding.");
  if (plan.legacyObjectId === null && plan.objectIds.includes(LEGACY_OBJECT_ID))
    throw new Error("The legacy guest needs the reviewed --legacy-object-id and --legacy-email binding.");
  await ensureAccountRegistry(root, validateAccountSchema(plan.accountSchema));
  const registry = root.forSchema(plan.accountSchema);
  const users = tableName(plan.accountSchema, "users");
  const provisioned: { objectId: string; id: string; schema: string; created: boolean }[] = [];
  try {
    if (!plan.objectIds.length) return provisioned;
    const existingAccounts = await registry.all<AccountRecord>(`SELECT * FROM ${users}`);
    for (const account of existingAccounts) mappedSchema(account, plan);
    for (const objectId of plan.objectIds) {
      const existing = existingAccountForObject(existingAccounts, objectId, plan);
      const id = existing ? accountUuid(existing.id, "Registered account ID") : randomUUID();
      const schema = existing ? mappedSchema(existing, plan) :
        objectId === plan.legacyObjectId ? "dbo" : accountWorldSchema(id);
      const world = root.forSchema(schema);
      try {
        // schema() joins this world transaction, so a new world and its registration commit together.
        await world.transaction(async () => {
          await world.advisoryLock(ACCOUNT_REGISTRY_LOCK);
          const collisions = await world.all<AccountRecord>(
            `SELECT * FROM ${users} WHERE (tenant_id = ?::uuid AND object_id = ?::uuid)
              OR game_schema = ? OR id = ?::uuid`,
            plan.tenantId, objectId, schema, id,
          );
          if (collisions.length) {
            const account = collisions[0];
            if (
              collisions.length !== 1 || account.id.toLowerCase() !== id ||
              !matchesPlannedIdentity(account, objectId, plan) ||
              mappedSchema(account, plan) !== schema
            )
              throw new Error("Account identity/schema collision or concurrent reassignment; rerun the reviewed plan.");
            await assertWorldTables(world);
            provisioned.push({ objectId, id, schema, created: false });
            return;
          }
          if (existing) throw new Error("A registered account disappeared during provisioning; refusing reassignment.");
          if (schema === "dbo") {
            await assertWorldTables(world);
          } else {
            const collision = await world.get<{ present: boolean }>(
              "SELECT to_regnamespace(?) IS NOT NULL AS present",
              quoteIdentifier(schema),
            );
            if (collision?.present)
              throw new Error(`Unregistered schema ${schema} already exists; refusing to adopt it.`);
            await world.schema();
          }
          await world.run(
            `INSERT INTO ${users} (id, tenant_id, object_id, display_name, email, game_schema)
             VALUES (?, ?, ?, ?, ?, ?)`,
            id, plan.tenantId, objectId,
            objectId === plan.legacyObjectId ? plan.legacyEmail : objectId,
            objectId === plan.legacyObjectId ? plan.legacyEmail : null,
            schema,
          );
          provisioned.push({ objectId, id, schema, created: true });
        });
      } finally {
        await world.close();
      }
    }
    return provisioned;
  } finally {
    await registry.close();
  }
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    help: { type: "boolean" }, database: { type: "string" }, "account-schema": { type: "string" },
    "tenant-id": { type: "string" }, "legacy-object-id": { type: "string" }, "legacy-email": { type: "string" },
    "dry-run": { type: "boolean" }, apply: { type: "boolean" }, yes: { type: "boolean" },
  } });
  if (values.help) {
    console.log("Usage: tsx scripts/accounts-migrate.ts [--tenant-id UUID [--legacy-object-id UUID --legacy-email EMAIL]] [--database NAME] [--account-schema accounts] [--apply --yes]\n" +
      "Default is an offline dry run. Uses SQL_* connection settings; run it as the database owner.\n" +
      "Creates the account registry (schema, users, invite_requests, invite_attempts) when missing. With a home tenant\n" +
      "(--tenant-id, default AUTH_HOME_TENANT_ID) it then provisions OWNER_OBJECT_ID and every ALLOWED_USER_OBJECT_IDS\n" +
      "identity of that tenant, each with a new empty world schema.\n" +
      "Personal Microsoft accounts need no provisioning: they request an invite and claim their world on first sign-in.\n" +
      "Only when a legacy world was imported into the dbo schema, pass the verified legacy guest to bind it to dbo.\n" +
      "New worlds receive schema migrations only, never generation, seeding, copying or snapshots. Existing worlds are not changed.\n" +
      "Rerun after allowlisting users. Reassignment and existing unregistered schema adoption are refused.\n" +
      "Use db-migrate.ts --registered for future world migrations.");
    return;
  }
  if (values.apply && values["dry-run"]) throw new Error("Choose --apply or --dry-run, not both.");
  if (values.apply && !values.yes) throw new Error("Account provisioning requires --apply --yes.");
  const plan = accountProvisioningPlan({
    tenantId: values["tenant-id"], legacyObjectId: values["legacy-object-id"],
    legacyEmail: values["legacy-email"], accountSchema: values["account-schema"], database: values.database,
  });
  if (!values.apply) {
    console.log(JSON.stringify({ dryRun: true, ...plan,
      legacySchema: plan.legacyObjectId ? "dbo" : null,
      otherWorlds: "Reuse immutable registered schemas or allocate new empty touchline_user_<account UUID> schemas.",
      migrations: schemaMigrations("planned_world").map(({ version, name }) => ({ version, name })),
      note: "SQL was not opened. Existing mappings and collisions are checked during apply. No world generation or existing world migration is performed.",
    }, null, 2));
    return;
  }
  const root = await Store.open(plan.database);
  try {
    const accounts = await provisionAccounts(root, plan);
    console.log(JSON.stringify({ provisioned: true, database: root.database, accountSchema: plan.accountSchema,
      accounts, seeded: false, copied: false, legacyWorldChanged: false,
    }, null, 2));
  } finally {
    await root.close();
  }
}

if (isMain(import.meta.url))
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Account provisioning failed.");
    process.exitCode = 1;
  });
