import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import {
  accountUuid,
  assertAccountRegistry,
  validateAccountSchema,
  validateAccountWorldSchema,
  type AccountRecord,
} from "../server/accounts.ts";
import { Store } from "../server/db.ts";
import { CONSUMER_TENANT_ID } from "../server/invite-store.ts";
import { LEGACY_EMAIL, LEGACY_OBJECT_ID, OWNER_EMAIL_DEFAULT } from "../server/legacy-account.ts";
import { readSqlSettings } from "../server/sql-config.ts";
import { accountsTableSql, inviteRequestsTableSql, quoteIdentifier, schemaMigrations, sqlLiteral, STORE_TABLES, tableName } from "../server/sql-schema.ts";
import { isMain } from "./data-export.ts";

export { LEGACY_EMAIL, LEGACY_OBJECT_ID } from "../server/legacy-account.ts";

export interface AccountProvisioningPlan {
  database: string;
  accountSchema: string;
  tenantId: string;
  legacyObjectId: string;
  legacyEmail: string;
  ownerObjectId: string;
  ownerEmail: string;
  objectIds: string[];
}

export function accountProvisioningPlan(
  options: { tenantId: string; legacyObjectId: string; legacyEmail: string; accountSchema?: string; database?: string },
  environment: NodeJS.ProcessEnv = process.env,
): AccountProvisioningPlan {
  const settings = readSqlSettings({ ...environment, SQL_DATABASE: options.database ?? environment.SQL_DATABASE });
  if (
    settings.testMode || settings.schema !== "dbo" || environment.SQL_ALLOW_REMOTE_TESTS === "true" ||
    environment.SQL_TEST_DATABASE || environment.TOUCHLINE_E2E_SCHEMA ||
    environment.CONTAINER_APP_NAME || environment.AZURE_CLIENT_ID
  )
    throw new Error("Account provisioning requires an operator context rooted in dbo, never a test or hosted runtime context.");
  const tenantId = accountUuid(options.tenantId, "--tenant-id");
  if (environment.AZURE_TENANT_ID && accountUuid(environment.AZURE_TENANT_ID, "AZURE_TENANT_ID") !== tenantId)
    throw new Error("The verified tenant must match AZURE_TENANT_ID.");
  const legacyObjectId = accountUuid(options.legacyObjectId, "--legacy-object-id");
  const legacyEmail = options.legacyEmail.trim().toLowerCase();
  if (legacyObjectId !== LEGACY_OBJECT_ID || legacyEmail !== LEGACY_EMAIL)
    throw new Error("The approved dbo legacy binding requires the verified sardo.kiko@gmail.com guest object ID and email.");
  const owner = accountUuid(environment.OWNER_OBJECT_ID ?? "", "OWNER_OBJECT_ID");
  if (owner === legacyObjectId)
    throw new Error("The configured platform owner must not inherit the legacy dbo game.");
  const ownerEmail = (environment.OWNER_EMAIL ?? OWNER_EMAIL_DEFAULT).trim().toLowerCase();
  if (!ownerEmail || ownerEmail.length > 320)
    throw new Error("OWNER_EMAIL is invalid.");
  const invited = (environment.ALLOWED_USER_OBJECT_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (invited.length > 100) throw new Error("ALLOWED_USER_OBJECT_IDS may contain at most 100 object IDs.");
  const objectIds = [...new Set([owner, ...invited.map((value) => accountUuid(value, "ALLOWED_USER_OBJECT_IDS"))])];
  if (!objectIds.includes(legacyObjectId))
    throw new Error("The verified legacy guest must be explicitly allowlisted before provisioning.");
  return {
    database: settings.database,
    accountSchema: validateAccountSchema(options.accountSchema ?? "accounts"),
    tenantId,
    legacyObjectId,
    legacyEmail,
    ownerObjectId: owner,
    ownerEmail,
    objectIds: [legacyObjectId, ...objectIds.filter((objectId) => objectId !== legacyObjectId)],
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
    normalized.email === plan.legacyEmail &&
    (
      (normalized.tenantId === plan.tenantId && normalized.objectId === plan.legacyObjectId) ||
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
  const id = accountUuid(account.id, "Registered account ID");
  const schema = validateAccountWorldSchema(account.game_schema, plan.accountSchema);
  const legacy = isLegacyMapping(account, plan);
  const expected = legacy ? "dbo" : `touchline_user_${id.replaceAll("-", "")}`;
  if (schema !== expected)
    throw new Error("Existing account mapping would reassign a world; no reassignment is permitted.");
  return schema;
}

async function assertWorldTables(store: Store): Promise<void> {
  const tables = await store.all<{ name: string }>(
    "SELECT [name] FROM sys.tables WHERE [schema_id] = SCHEMA_ID(?)",
    store.schemaName,
  );
  const names = new Set(tables.map((table) => table.name));
  if (names.size !== STORE_TABLES.size || [...STORE_TABLES].some((table) => !names.has(table)))
    throw new Error(`World ${store.schemaName} is missing or has unexpected tables; inspect it before account provisioning.`);
}

async function lockSchemaMaintenance(store: Store): Promise<void> {
  await store.exec(`DECLARE @maintenanceLock int;
    EXEC @maintenanceLock = sys.sp_getapplock @Resource = N'touchline:schema-maintenance',
      @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 120000;
    IF @maintenanceLock < 0 THROW 51000, 'Account schema maintenance lock could not be acquired.', 1;`);
}

export async function provisionAccounts(root: Store, plan: AccountProvisioningPlan) {
  if (root.testMode || root.schemaName !== "dbo" || root.database !== plan.database)
    throw new Error("The provisioning connection does not match the reviewed dbo target.");
  if (plan.legacyObjectId !== LEGACY_OBJECT_ID || plan.legacyEmail !== LEGACY_EMAIL || !plan.objectIds.includes(LEGACY_OBJECT_ID))
    throw new Error("The provisioning plan must preserve the approved legacy guest binding.");
  const registry = root.forSchema(validateAccountSchema(plan.accountSchema));
  const users = tableName(plan.accountSchema, "users");
  const provisioned: { objectId: string; id: string; schema: string; created: boolean }[] = [];
  try {
    await registry.transaction(async () => {
      await lockSchemaMaintenance(registry);
      const existing = await registry.all<{ name: string }>(
        "SELECT [name] FROM sys.tables WHERE [schema_id] = SCHEMA_ID(?)", plan.accountSchema,
      );
      if (existing.some((table) => table.name !== "users" && table.name !== "invite_requests" && table.name !== "invite_attempts"))
        throw new Error("The account schema collides with existing non-account tables.");
      await registry.exec(`IF SCHEMA_ID(${sqlLiteral(plan.accountSchema)}) IS NULL
        EXEC(${sqlLiteral(`CREATE SCHEMA ${quoteIdentifier(plan.accountSchema)} AUTHORIZATION [dbo];`)});`);
      await registry.exec(accountsTableSql(plan.accountSchema));
      await registry.exec(inviteRequestsTableSql(plan.accountSchema));
      await assertAccountRegistry(registry);
    });
    const existingAccounts = await registry.all<AccountRecord>(`SELECT * FROM ${users}`);
    for (const account of existingAccounts) mappedSchema(account, plan);
    for (const objectId of plan.objectIds) {
      const existing = existingAccountForObject(existingAccounts, objectId, plan);
      const id = existing ? accountUuid(existing.id, "Registered account ID") : randomUUID();
      const schema = existing ? mappedSchema(existing, plan) :
        objectId === plan.legacyObjectId ? "dbo" : `touchline_user_${id.replaceAll("-", "")}`;
      const world = root.forSchema(schema);
      try {
        await world.transaction(async () => {
          await world.exec(`DECLARE @registryLock int;
            EXEC @registryLock = sys.sp_getapplock @Resource = ?, @LockMode = N'Exclusive',
              @LockOwner = N'Transaction', @LockTimeout = 30000;
            IF @registryLock < 0 THROW 51000, 'Account registry writer lock could not be acquired.', 1;`,
          `touchline:world:${plan.accountSchema.toLowerCase()}`);
          const collisions = await world.all<AccountRecord>(
            `SELECT * FROM ${users} WHERE ([tenant_id] = CONVERT(uniqueidentifier, ?) AND [object_id] = CONVERT(uniqueidentifier, ?))
              OR [game_schema] = ? OR [id] = CONVERT(uniqueidentifier, ?)`,
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
            await lockSchemaMaintenance(world);
            const collision = await world.get<{ schema_id: number | null }>("SELECT SCHEMA_ID(?) AS [schema_id]", schema);
            if (collision?.schema_id)
              throw new Error(`Unregistered schema ${schema} already exists; refusing to adopt it.`);
            await world.exec(`CREATE SCHEMA ${quoteIdentifier(schema)} AUTHORIZATION [dbo];`);
            await world.schema();
          }
          await world.run(
            `INSERT INTO ${users} ([id], [tenant_id], [object_id], [display_name], [email], [game_schema])
             VALUES (CONVERT(uniqueidentifier, ?), CONVERT(uniqueidentifier, ?), CONVERT(uniqueidentifier, ?), ?, ?, ?)`,
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
    console.log("Usage: tsx scripts/accounts-migrate.ts --tenant-id UUID --legacy-object-id UUID --legacy-email EMAIL [--database NAME] [--account-schema accounts] [--apply --yes]\n" +
      "Default is an offline dry run. Verify the tenant, guest object ID and email before applying with an operator SQL identity.\n" +
      "Provisions OWNER_OBJECT_ID and every ALLOWED_USER_OBJECT_IDS identity; only the approved legacy guest receives dbo.\n" +
      "New worlds receive schema migrations only, never generation, seeding, copying or snapshots. Existing worlds are not migrated or changed.\n" +
      "Rerun after inviting/allowlisting users. Reassignment and existing unregistered schema adoption are refused.\n" +
      "Then apply db-authorize.ts --registered for runtime grants; use db-migrate.ts --registered for future world migrations.");
    return;
  }
  if (values.apply && values["dry-run"]) throw new Error("Choose --apply or --dry-run, not both.");
  if (values.apply && !values.yes) throw new Error("Account provisioning requires --apply --yes.");
  const plan = accountProvisioningPlan({
    tenantId: values["tenant-id"] ?? "", legacyObjectId: values["legacy-object-id"] ?? "",
    legacyEmail: values["legacy-email"] ?? "", accountSchema: values["account-schema"], database: values.database,
  });
  if (!values.apply) {
    console.log(JSON.stringify({ dryRun: true, ...plan,
      legacySchema: "dbo", otherWorlds: "Reuse immutable registered schemas or allocate new empty touchline_user_<account UUID> schemas.",
      migrations: schemaMigrations("planned_world").map(({ version, name }) => ({ version, name })),
      note: "SQL was not opened. Existing mappings and collisions are checked during apply. No world generation or existing dbo migration is performed.",
    }, null, 2));
    return;
  }
  const root = await Store.open(plan.database);
  try {
    const accounts = await provisionAccounts(root, plan);
    console.log(JSON.stringify({ provisioned: true, database: root.database, accountSchema: plan.accountSchema,
      accounts, seeded: false, copied: false, legacyWorldChanged: false,
      next: "Apply db-authorize.ts --registered using the runtime managed-identity client ID before enabling per-user access.",
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