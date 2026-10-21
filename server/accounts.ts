import type { AccountUser } from "../shared/api.ts";
import { sqlErrorCode, type Store } from "./db.ts";
import {
  ACCOUNT_REGISTRY_LOCK,
  CONSUMER_TENANT_ID,
  registryCapacity,
  type CapacityLimits,
  type InviteLimits,
  type InviteStatus,
} from "./invite-store.ts";
import { LEGACY_EMAIL, LEGACY_OBJECT_ID, OWNER_EMAIL_DEFAULT } from "./legacy-account.ts";
import { validateSqlSchema } from "./sql-config.ts";
import { accountsTableSql, inviteRequestsTableSql, quoteIdentifier, tableName } from "./sql-schema.ts";

export interface AuthenticatedIdentity {
  tenantId: string;
  objectId: string;
  displayName: string;
  email: string | null;
}

export interface AccountRecord {
  id: string;
  tenant_id: string;
  object_id: string;
  display_name: string;
  email: string | null;
  game_schema: string;
}

export type ClaimOutcome = { outcome: "claimed" | "not_found" | "capacity"; reason: string | null };

type ClaimStep = ClaimOutcome | { outcome: "provision"; accountId: string; schema: string };

interface Claimant {
  tenantId: string;
  objectId: string;
  email: string;
  displayName: string;
}

export const REGISTRY_TABLES = ["invite_attempts", "invite_requests", "users"] as const;
const PERMISSION_DENIED = "42501";

export function accountUuid(value: string, label: string): string {
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value))
    throw new Error(`${label} must be a UUID.`);
  return value.toLowerCase();
}

function maybeAccountUuid(value: string | undefined): string | null {
  return value && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value) ? value.toLowerCase() : null;
}

/** Every account except the legacy guest gets its own world schema named after the account UUID. */
export function accountWorldSchema(accountId: string): string {
  return `touchline_user_${accountUuid(accountId, "Account ID").replaceAll("-", "")}`;
}

export function validateAccountSchema(schema: string, testMode = false): string {
  validateSqlSchema(schema, testMode);
  if (
    /^(dbo|public|guest|sys|information_schema)$/i.test(schema) || /^touchline_user_/i.test(schema) ||
    (!testMode && /^touchline_(?:test|e2e)_/i.test(schema))
  )
    throw new Error("The account registry requires a separate, non-world schema.");
  return schema;
}

export function validateAccountWorldSchema(schema: string, accountSchema: string, testMode = false): string {
  validateSqlSchema(schema, testMode);
  if (
    schema.toLowerCase() === accountSchema.toLowerCase() ||
    /^(accounts|public|guest|sys|information_schema)$/i.test(schema) ||
    (!testMode && /^touchline_(?:test|e2e)_/i.test(schema))
  )
    throw new Error("Invalid account world schema.");
  return schema;
}

export class AccountNotProvisionedError extends Error {
  readonly status = 403;
  readonly code = "account_not_provisioned";

  constructor() {
    super("This account has not been provisioned by an operator.");
    this.name = "AccountNotProvisionedError";
  }
}

export class InviteRequiredError extends Error {
  readonly status = 403;
  readonly code = "invite_required";

  constructor() {
    super("This personal Microsoft account has not been invited yet.");
    this.name = "InviteRequiredError";
  }
}

export class CapacityUnavailableError extends Error {
  readonly status = 503;
  readonly code = "capacity_unavailable";

  constructor(readonly reason: string | null = null) {
    super("Touchline is at capacity.");
    this.name = "CapacityUnavailableError";
  }
}

export async function assertAccountRegistry(registry: Store, options: { allowLegacy?: boolean } = {}): Promise<void> {
  validateAccountSchema(registry.schemaName, registry.testMode);
  const users = tableName(registry.schemaName, "users");
  const invites = tableName(registry.schemaName, "invite_requests");
  const attempts = tableName(registry.schemaName, "invite_attempts");
  await registry.all(`SELECT id, tenant_id, object_id, display_name, email, game_schema, created_at, updated_at
    FROM ${users} LIMIT 0`);
  const tables = await registry.all<{ name: string }>(
    "SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = ?",
    registry.schemaName,
  );
  const names = tables.map((table) => table.name).sort();
  const legacyRegistry = options.allowLegacy === true && names.length === 1 && names[0] === "users";
  if (!legacyRegistry && (
    names.length !== REGISTRY_TABLES.length || REGISTRY_TABLES.some((table, index) => names[index] !== table)
  ))
    throw new Error("The account registry must contain only users, invite_requests and invite_attempts, never world or save tables.");
  if (!legacyRegistry) {
    await registry.all(`SELECT id, email, note, status, ip_hash, requested_at, decided_at, decided_by, account_id,
      approval_email_sent, accepted_email_sent, updated_at FROM ${invites} LIMIT 0`);
    await registry.all(`SELECT id, ip_hash, attempted_at FROM ${attempts} LIMIT 0`);
  }
  // Valid, non-partial, non-expression unique indexes on users with their key columns in order.
  const indexes = await registry.all<{ is_primary_key: boolean; columns: string }>(
    `SELECT idx.indisprimary AS is_primary_key,
       string_agg(attribute.attname, ',' ORDER BY key.ordinal) AS columns
     FROM pg_catalog.pg_index AS idx
     CROSS JOIN LATERAL unnest(idx.indkey::int2[]) WITH ORDINALITY AS key(attnum, ordinal)
     INNER JOIN pg_catalog.pg_attribute AS attribute
       ON attribute.attrelid = idx.indrelid AND attribute.attnum = key.attnum
     WHERE idx.indrelid = to_regclass(?) AND idx.indisunique AND idx.indisvalid
       AND idx.indpred IS NULL AND idx.indexprs IS NULL AND key.ordinal <= idx.indnkeyatts
     GROUP BY idx.indexrelid, idx.indisprimary`,
    users,
  );
  if (
    !indexes.some((index) => index.is_primary_key && index.columns === "id") ||
    !indexes.some((index) => index.columns === "tenant_id,object_id") ||
    !indexes.some((index) => index.columns === "game_schema")
  )
    throw new Error("The account registry is missing its identity or schema uniqueness constraints.");
}

/**
 * Creates the account registry schema and its tables when missing (idempotent), refusing a schema that already holds
 * anything else. It never creates worlds or accounts.
 */
export async function ensureAccountRegistry(root: Store, accountSchema = "accounts"): Promise<void> {
  validateAccountSchema(accountSchema, root.testMode);
  if (root.schemaName.toLowerCase() === accountSchema.toLowerCase())
    throw new Error("The account registry cannot share a world schema.");
  const registry = root.forSchema(accountSchema);
  try {
    await registry.transaction(async () => {
      await registry.advisoryLock(`touchline:schema-maintenance:${accountSchema.toLowerCase()}`, { timeout: "120s" });
      const existing = await registry.all<{ name: string }>(
        "SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = ?",
        accountSchema,
      );
      if (existing.some((table) => !(REGISTRY_TABLES as readonly string[]).includes(table.name)))
        throw new Error("The account schema collides with existing non-account tables.");
      await registry.exec(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(accountSchema)};
        ${accountsTableSql(accountSchema)}
        ${inviteRequestsTableSql(accountSchema)}`);
      await assertAccountRegistry(registry);
    });
  } finally {
    await registry.close();
  }
}

export async function registeredAccountSchemas(
  root: Store,
  accountSchema = "accounts",
  options: { allowLegacyRegistry?: boolean } = { allowLegacyRegistry: true },
): Promise<string[]> {
  validateAccountSchema(accountSchema, root.testMode);
  if (root.schemaName.toLowerCase() === accountSchema.toLowerCase())
    throw new Error("The account registry cannot share a world schema.");
  const registry = root.forSchema(accountSchema);
  try {
    await assertAccountRegistry(registry, { allowLegacy: options.allowLegacyRegistry ?? true });
    const accounts = await registry.all<{ game_schema: string }>(
      `SELECT game_schema FROM ${tableName(accountSchema, "users")} ORDER BY game_schema`,
    );
    if (!accounts.length) throw new Error("The account registry has no provisioned worlds.");
    const schemas = accounts.map((account) => validateAccountWorldSchema(account.game_schema, accountSchema, root.testMode));
    if (new Set(schemas.map((schema) => schema.toLowerCase())).size !== schemas.length)
      throw new Error("Account world schema collision.");
    for (const schema of schemas) {
      const existing = await root.get<{ present: boolean }>(
        "SELECT to_regclass(?) IS NOT NULL AS present",
        tableName(schema, "schema_migrations"),
      );
      if (!existing?.present)
        throw new Error(`Registered world ${schema} is missing; refusing to recreate it.`);
    }
    return schemas;
  } finally {
    await registry.close();
  }
}

export class Accounts {
  private readonly registry: Store;
  private readonly accountSchema: string;
  private readonly usersTable: string;
  private readonly invitesTable: string;
  private readonly limits: Required<Pick<InviteLimits, "maxPlayers" | "sizeLimitGb">>;
  private readonly homeTenantId: string | null;
  private readonly ownerObjectId: string | null;
  private readonly ownerEmail: string;
  private readonly stores = new Map<string, Store>();

  constructor(private readonly root: Store, accountSchema = "accounts", options: { limits?: InviteLimits } = {}) {
    validateAccountSchema(accountSchema, root.testMode);
    if (accountSchema.toLowerCase() === root.schemaName.toLowerCase())
      throw new Error("The account registry cannot share a world schema.");
    this.registry = root.forSchema(accountSchema);
    this.accountSchema = accountSchema;
    this.usersTable = tableName(accountSchema, "users");
    this.invitesTable = tableName(accountSchema, "invite_requests");
    this.limits = {
      maxPlayers: options.limits?.maxPlayers ?? Number(process.env.MAX_PLAYERS ?? 10),
      sizeLimitGb: options.limits?.sizeLimitGb ?? Number(process.env.INVITE_DB_SIZE_LIMIT_GB ?? 24),
    };
    this.homeTenantId = maybeAccountUuid(process.env.AUTH_HOME_TENANT_ID);
    this.ownerObjectId = maybeAccountUuid(options.limits?.ownerObjectId ?? process.env.OWNER_OBJECT_ID ?? "");
    this.ownerEmail = (options.limits?.ownerEmail ?? process.env.OWNER_EMAIL ?? OWNER_EMAIL_DEFAULT).trim().toLowerCase();
    if (!Number.isFinite(this.limits.maxPlayers) || this.limits.maxPlayers < 1 ||
        !Number.isFinite(this.limits.sizeLimitGb) || this.limits.sizeLimitGb <= 0)
      throw new Error("Invalid invite capacity limits.");
  }

  async assertReady(): Promise<void> {
    await assertAccountRegistry(this.registry);
  }

  async resolve(identity: AuthenticatedIdentity): Promise<{ user: AccountUser; store: Store }> {
    const tenantId = accountUuid(identity.tenantId, "Tenant ID");
    const objectId = accountUuid(identity.objectId, "Object ID");
    const email = identity.email === null ? null : identity.email.trim().toLowerCase();
    if (
      !identity.displayName.trim() || identity.displayName.length > 200 ||
      (email !== null && (!email || email.length > 320))
    )
      throw new Error("Invalid trusted account profile.");
    let account = await this.lookup(tenantId, objectId);
    if (!account && tenantId === CONSUMER_TENANT_ID && email) {
      const fromObjectId = email === LEGACY_EMAIL ? LEGACY_OBJECT_ID :
        email === this.ownerEmail ? this.ownerObjectId : null;
      if (this.homeTenantId && fromObjectId) {
        await this.rebindAccount({ tenantId: this.homeTenantId, objectId: fromObjectId }, { tenantId, objectId }, email);
        account = await this.lookup(tenantId, objectId);
      }
    }
    if (!account && tenantId === CONSUMER_TENANT_ID && email) {
      const invite = await this.registry.get<{ id: string }>(
        `SELECT id FROM ${this.invitesTable}
         WHERE email = ? AND status = 'accepted' ORDER BY decided_at NULLS FIRST, requested_at LIMIT 1`,
        email,
      );
      if (invite) {
        const result = await this.claimInvite(invite.id, { tenantId, objectId, email, displayName: identity.displayName });
        if (result.outcome === "capacity") throw new CapacityUnavailableError(result.reason);
        account = await this.lookup(tenantId, objectId);
      }
    }
    if (!account) throw tenantId === CONSUMER_TENANT_ID ? new InviteRequiredError() : new AccountNotProvisionedError();
    return this.finishResolution(account, tenantId, objectId, identity.displayName, email);
  }

  /**
   * One-shot move of the legacy guest (onto the dbo world) or the platform owner from their home-tenant identity to
   * their personal Microsoft account, matched by the approved email. Anything else is left unchanged.
   */
  async rebindAccount(
    from: { tenantId: string; objectId: string },
    to: { tenantId: string; objectId: string },
    email: string,
  ): Promise<"rebound" | "unchanged"> {
    const normalized = email.trim().toLowerCase();
    const fromTenantId = accountUuid(from.tenantId, "Tenant ID");
    const fromObjectId = accountUuid(from.objectId, "Object ID");
    const toTenantId = accountUuid(to.tenantId, "Tenant ID");
    const toObjectId = accountUuid(to.objectId, "Object ID");
    const legacy = normalized === LEGACY_EMAIL;
    const owner = normalized === this.ownerEmail;
    if (
      toTenantId !== CONSUMER_TENANT_ID || (!legacy && !owner) ||
      (legacy && fromObjectId !== LEGACY_OBJECT_ID) || (owner && fromObjectId !== this.ownerObjectId)
    )
      return "unchanged";
    try {
      return await this.registry.transaction(async () => {
        await this.registry.advisoryLock(ACCOUNT_REGISTRY_LOCK);
        if (await this.registry.get(
          `SELECT 1 AS present FROM ${this.usersTable} WHERE tenant_id = ?::uuid AND object_id = ?::uuid`,
          toTenantId,
          toObjectId,
        ))
          return "unchanged";
        const result = await this.registry.run(
          `UPDATE ${this.usersTable}
           SET tenant_id = ?::uuid, object_id = ?::uuid, email = ?, updated_at = now()
           WHERE tenant_id = ?::uuid AND object_id = ?::uuid${owner ? "" : " AND game_schema = 'dbo'"}`,
          toTenantId,
          toObjectId,
          normalized,
          fromTenantId,
          fromObjectId,
        );
        return result.changes === 1 ? "rebound" : "unchanged";
      });
    } catch (error) {
      // An operator may revoke UPDATE on the identity columns once both rebinds are done: nothing left to rebind.
      if (sqlErrorCode(error) === PERMISSION_DENIED) return "unchanged";
      throw error;
    }
  }

  /**
   * Claims an accepted invite for a personal Microsoft account: creates the account's empty, migrated world schema
   * and registers it, all in one transaction. Idempotent: a claimed invite or an already registered identity reports
   * "claimed". Capacity (MAX_PLAYERS, database size) is checked under the registry lock.
   */
  async claimInvite(requestId: string, claimant: Claimant): Promise<ClaimOutcome> {
    const request = maybeAccountUuid(requestId);
    const normalized: Claimant = {
      tenantId: accountUuid(claimant.tenantId, "Tenant ID"),
      objectId: accountUuid(claimant.objectId, "Object ID"),
      email: claimant.email.trim().toLowerCase(),
      displayName: claimant.displayName,
    };
    if (
      !request || normalized.tenantId !== CONSUMER_TENANT_ID || !normalized.email || normalized.email.length > 320 ||
      !normalized.displayName.trim() || normalized.displayName.length > 200
    )
      return { outcome: "not_found", reason: null };
    const prepared = await this.registry.transaction(async () => {
      await this.registry.advisoryLock(ACCOUNT_REGISTRY_LOCK);
      return this.claimStep(this.registry, request, normalized, null);
    });
    if (prepared.outcome !== "provision") return prepared;
    // The world store's transaction lets schema() join it, so the world and its registration commit together.
    const world = this.root.forSchema(prepared.schema);
    try {
      return await world.transaction(async (): Promise<ClaimOutcome> => {
        await world.advisoryLock(ACCOUNT_REGISTRY_LOCK);
        const step = await this.claimStep(world, request, normalized, prepared.accountId);
        if (step.outcome !== "provision") return step;
        await world.schema();
        await world.run(
          `INSERT INTO ${this.usersTable} (id, tenant_id, object_id, display_name, email, game_schema)
           VALUES (?, ?, ?, ?, ?, ?)`,
          step.accountId,
          normalized.tenantId,
          normalized.objectId,
          normalized.displayName,
          normalized.email,
          step.schema,
        );
        await world.run(
          `UPDATE ${this.invitesTable} SET status = 'claimed', account_id = ?::uuid, updated_at = now()
           WHERE id = ?::uuid AND status = 'accepted'`,
          step.accountId,
          request,
        );
        return { outcome: "claimed", reason: null };
      });
    } finally {
      await world.close();
    }
  }

  /** Validates a claim inside a transaction holding the registry lock; `store` may be the registry or the new world. */
  private async claimStep(store: Store, requestId: string, claimant: Claimant, expectedAccountId: string | null): Promise<ClaimStep> {
    const invite = await store.get<{ email: string; status: InviteStatus; account_id: string | null }>(
      `SELECT email, status, account_id FROM ${this.invitesTable} WHERE id = ?::uuid FOR UPDATE`,
      requestId,
    );
    if (!invite) return { outcome: "not_found", reason: null };
    if (invite.status === "claimed") return { outcome: "claimed", reason: null };
    if (invite.status !== "accepted" || invite.email !== claimant.email) return { outcome: "not_found", reason: null };
    const registered = await store.get<{ id: string }>(
      `SELECT id FROM ${this.usersTable} WHERE tenant_id = ?::uuid AND object_id = ?::uuid FOR UPDATE`,
      claimant.tenantId,
      claimant.objectId,
    );
    if (registered) {
      if (invite.account_id && invite.account_id !== registered.id)
        throw new Error("Invite account identity mismatch.");
      await store.run(
        `UPDATE ${this.invitesTable} SET status = 'claimed', account_id = ?::uuid, updated_at = now() WHERE id = ?::uuid`,
        registered.id,
        requestId,
      );
      return { outcome: "claimed", reason: null };
    }
    const capacity = await registryCapacity(store, this.accountSchema, this.capacityLimits(), requestId);
    if (capacity.reason) return { outcome: "capacity", reason: capacity.reason };
    let accountId = invite.account_id;
    if (expectedAccountId) {
      if (accountId !== expectedAccountId) throw new Error("The invite changed while it was being claimed.");
    } else if (!accountId) {
      accountId = (await store.get<{ account_id: string }>(
        `UPDATE ${this.invitesTable} SET account_id = gen_random_uuid(), updated_at = now()
         WHERE id = ?::uuid RETURNING account_id`,
        requestId,
      ))!.account_id;
    }
    const schema = accountWorldSchema(accountId!);
    if (await store.get(
      `SELECT 1 AS present FROM ${this.usersTable} WHERE id = ?::uuid OR game_schema = ?`,
      accountId,
      schema,
    ))
      throw new Error("Invite account collision.");
    // A migrated but unregistered world is a previous claim's leftover and is adopted; anything else is refused.
    const existing = await store.get<{ schema_exists: boolean; migrated: boolean }>(
      "SELECT to_regnamespace(?) IS NOT NULL AS schema_exists, to_regclass(?) IS NOT NULL AS migrated",
      quoteIdentifier(schema),
      tableName(schema, "schema_migrations"),
    );
    if (existing?.schema_exists && !existing.migrated) throw new Error("Unregistered invite schema collision.");
    return { outcome: "provision", accountId: accountId!, schema };
  }

  private capacityLimits(): CapacityLimits {
    return { ...this.limits, ownerObjectId: this.ownerObjectId, ownerEmail: this.ownerEmail };
  }

  private async lookup(tenantId: string, objectId: string): Promise<AccountRecord | undefined> {
    return this.registry.get<AccountRecord>(
      `SELECT id, tenant_id, object_id, display_name, email, game_schema
       FROM ${this.usersTable} WHERE tenant_id = ?::uuid AND object_id = ?::uuid`,
      tenantId,
      objectId,
    );
  }

  private async finishResolution(
    account: AccountRecord,
    tenantId: string,
    objectId: string,
    displayName: string,
    email: string | null,
  ): Promise<{ user: AccountUser; store: Store }> {
    const id = accountUuid(account.id, "Account ID");
    if (
      accountUuid(account.tenant_id, "Registered tenant ID") !== tenantId ||
      accountUuid(account.object_id, "Registered object ID") !== objectId
    )
      throw new Error("Account identity mapping is inconsistent.");
    const schema = validateAccountWorldSchema(account.game_schema, this.accountSchema, this.root.testMode);
    let store = this.stores.get(id);
    if (store && store.schemaName !== schema)
      throw new Error("Account schema reassignment is not permitted.");
    if (account.display_name !== displayName || account.email !== email) {
      const result = await this.registry.run(
        `UPDATE ${this.usersTable} SET display_name = ?, email = ?, updated_at = now()
         WHERE id = ?::uuid AND tenant_id = ?::uuid AND object_id = ?::uuid AND game_schema = ?`,
        displayName,
        email,
        id,
        tenantId,
        objectId,
        schema,
      );
      if (result.changes !== 1) throw new AccountNotProvisionedError();
    }
    store = this.stores.get(id);
    if (store && store.schemaName !== schema)
      throw new Error("Account schema reassignment is not permitted.");
    if (!store) {
      store = this.root.forSchema(schema);
      this.stores.set(id, store);
    }
    return { user: { id, displayName, email }, store };
  }
}
