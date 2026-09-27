import type { AccountUser } from "../shared/api.ts";
import { Store } from "./db.ts";
import { CONSUMER_TENANT_ID, type InviteLimits } from "./invite-store.ts";
import { LEGACY_EMAIL, LEGACY_OBJECT_ID, OWNER_EMAIL_DEFAULT } from "./legacy-account.ts";
import { validateSqlSchema } from "./sql-config.ts";
import { tableName } from "./sql-schema.ts";

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

export function accountUuid(value: string, label: string): string {
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value))
    throw new Error(`${label} must be a UUID.`);
  return value.toLowerCase();
}

function maybeAccountUuid(value: string | undefined): string | null {
  return value && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value) ? value.toLowerCase() : null;
}

export function validateAccountSchema(schema: string, testMode = false): string {
  validateSqlSchema(schema, testMode);
  if (
    /^(dbo|guest|sys|information_schema)$/i.test(schema) || /^touchline_user_/i.test(schema) ||
    (!testMode && /^touchline_(?:test|e2e)_/i.test(schema))
  )
    throw new Error("The account registry requires a separate, non-world schema.");
  return schema;
}

export function validateAccountWorldSchema(schema: string, accountSchema: string, testMode = false): string {
  validateSqlSchema(schema, testMode);
  if (
    schema.toLowerCase() === accountSchema.toLowerCase() ||
    /^(accounts|guest|sys|information_schema)$/i.test(schema) ||
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
  await registry.all(`SELECT TOP (0) [id], [tenant_id], [object_id], [display_name],
    [email], [game_schema], [created_at], [updated_at] FROM ${users};`);
  const tables = await registry.all<{ name: string }>(
    "SELECT [name] FROM sys.tables WHERE [schema_id] = SCHEMA_ID(?)",
    registry.schemaName,
  );
  const names = tables.map((table) => table.name).sort();
  const legacyRegistry = options.allowLegacy === true && names.length === 1 && names[0] === "users";
  if (!legacyRegistry && (
    names.length !== 3 ||
    names[0] !== "invite_attempts" ||
    names[1] !== "invite_requests" ||
    names[2] !== "users"
  ))
    throw new Error("The account registry must contain only users, invite_requests and invite_attempts, never world or save tables.");
  if (!legacyRegistry) {
    await registry.all(`SELECT TOP (0) [id], [email], [note], [status], [ip_hash], [requested_at],
      [decided_at], [decided_by], [account_id], [approval_email_sent], [accepted_email_sent],
      [updated_at] FROM ${invites};`);
    await registry.all(`SELECT TOP (0) [id], [ip_hash], [attempted_at] FROM ${attempts};`);
  }
  const indexes = await registry.all<{ is_primary_key: boolean; columns: string }>(
    `SELECT index_row.[is_primary_key],
       STRING_AGG(CONVERT(nvarchar(max), column_row.[name]), N',')
         WITHIN GROUP (ORDER BY index_column.[key_ordinal]) AS [columns]
     FROM sys.indexes AS index_row
     INNER JOIN sys.index_columns AS index_column ON index_column.[object_id] = index_row.[object_id]
       AND index_column.[index_id] = index_row.[index_id]
     INNER JOIN sys.columns AS column_row ON column_row.[object_id] = index_column.[object_id]
       AND column_row.[column_id] = index_column.[column_id]
     WHERE index_row.[object_id] = OBJECT_ID(?) AND index_row.[is_unique] = 1
       AND index_row.[is_disabled] = 0 AND index_row.[has_filter] = 0 AND index_column.[key_ordinal] > 0
     GROUP BY index_row.[index_id], index_row.[is_primary_key]`,
    users,
  );
  if (
    !indexes.some((index) => index.is_primary_key && index.columns === "id") ||
    !indexes.some((index) => index.columns === "tenant_id,object_id") ||
    !indexes.some((index) => index.columns === "game_schema")
  )
    throw new Error("The account registry is missing its identity or schema uniqueness constraints.");
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
      `SELECT [game_schema] FROM ${tableName(accountSchema, "users")} ORDER BY [game_schema]`,
    );
    if (!accounts.length) throw new Error("The account registry has no provisioned worlds.");
    const schemas = accounts.map((account) => validateAccountWorldSchema(account.game_schema, accountSchema, root.testMode));
    if (new Set(schemas.map((schema) => schema.toLowerCase())).size !== schemas.length)
      throw new Error("Account world schema collision.");
    for (const schema of schemas) {
      const existing = await root.get<{ object_id: number | null }>(
        "SELECT OBJECT_ID(?, N'U') AS [object_id]",
        tableName(schema, "schema_migrations"),
      );
      if (!existing?.object_id)
        throw new Error(`Registered world ${schema} is missing; refusing to recreate it.`);
    }
    return schemas;
  } finally {
    await registry.close();
  }
}

export class Accounts {
  private readonly registry: Store;
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
    this.usersTable = tableName(accountSchema, "users");
    this.invitesTable = tableName(accountSchema, "invite_requests");
    this.limits = {
      maxPlayers: options.limits?.maxPlayers ?? Number(process.env.MAX_PLAYERS ?? 10),
      sizeLimitGb: options.limits?.sizeLimitGb ?? Number(process.env.INVITE_DB_SIZE_LIMIT_GB ?? 24),
    };
    this.homeTenantId = maybeAccountUuid(process.env.AZURE_TENANT_ID);
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
        // After both one-shot rebinds, db-authorize revokes EXECUTE; a denied call simply means nothing to rebind.
        await this.registry.all(
          `EXEC ${tableName(this.registry.schemaName, "rebind_account")}
            @from_tenant_id = CONVERT(uniqueidentifier, ?), @from_object_id = CONVERT(uniqueidentifier, ?),
            @to_tenant_id = CONVERT(uniqueidentifier, ?), @to_object_id = CONVERT(uniqueidentifier, ?), @email = ?`,
          this.homeTenantId,
          fromObjectId,
          tenantId,
          objectId,
          email,
        ).catch((error: unknown) => {
          if ((error as { number?: number; originalError?: { number?: number } })?.number !== 229 &&
            (error as { originalError?: { info?: { number?: number } } })?.originalError?.info?.number !== 229)
            throw error;
        });
        account = await this.lookup(tenantId, objectId);
      }
    }
    if (!account && tenantId === CONSUMER_TENANT_ID && email) {
      const invite = await this.registry.get<{ id: string }>(
        `SELECT TOP (1) [id] FROM ${this.invitesTable}
         WHERE [email] = ? AND [status] = N'accepted' ORDER BY [decided_at], [requested_at]`,
        email,
      );
      if (invite) {
        const [result] = await this.registry.all<{ outcome: string; reason: string | null }>(
          `EXEC ${tableName(this.registry.schemaName, "claim_invited_account")}
            @request_id = CONVERT(uniqueidentifier, ?), @tenant_id = CONVERT(uniqueidentifier, ?),
            @object_id = CONVERT(uniqueidentifier, ?), @email = ?, @display_name = ?`,
          invite.id,
          tenantId,
          objectId,
          email,
          identity.displayName,
        );
        if (result?.outcome === "capacity") throw new CapacityUnavailableError(result.reason);
        account = await this.lookup(tenantId, objectId);
      }
    }
    if (!account) throw tenantId === CONSUMER_TENANT_ID ? new InviteRequiredError() : new AccountNotProvisionedError();
    return this.finishResolution(account, tenantId, objectId, identity.displayName, email);
  }

  private async lookup(tenantId: string, objectId: string): Promise<AccountRecord | undefined> {
    return this.registry.get<AccountRecord>(
      `SELECT [id], [tenant_id], [object_id], [display_name], [email], [game_schema]
       FROM ${this.usersTable} WHERE [tenant_id] = CONVERT(uniqueidentifier, ?)
         AND [object_id] = CONVERT(uniqueidentifier, ?)`,
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
    const schema = validateAccountWorldSchema(account.game_schema, this.registry.schemaName, this.root.testMode);
    let store = this.stores.get(id);
    if (store && store.schemaName !== schema)
      throw new Error("Account schema reassignment is not permitted.");
    if (account.display_name !== displayName || account.email !== email) {
      const result = await this.registry.run(
        `UPDATE ${this.usersTable} SET [display_name] = ?, [email] = ?, [updated_at] = SYSUTCDATETIME()
         WHERE [id] = CONVERT(uniqueidentifier, ?) AND [tenant_id] = CONVERT(uniqueidentifier, ?)
           AND [object_id] = CONVERT(uniqueidentifier, ?) AND [game_schema] = ?`,
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