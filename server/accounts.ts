import { randomUUID } from "node:crypto";
import type { AccountUser } from "../shared/api.ts";
import type { AuthenticatedIdentity } from "./auth.ts";
import type { Store } from "./db.ts";
import { validateSqlSchema } from "./sql-config.ts";
import { accessRequestsTableSql, quoteIdentifier, tableName, usersTableSql } from "./sql-schema.ts";

/** Transaction-scoped advisory lock that serializes account provisioning and access decisions. */
export const ACCOUNT_REGISTRY_LOCK = "touchline:account-registry";
export const REGISTRY_TABLES = ["access_requests", "users"] as const;

export type AccessStatus = "pending" | "approved" | "denied";
export type CapacityReason = "player_limit" | "database_size";

export interface AccountRecord {
  id: string;
  issuer: string;
  subject: string;
  username: string;
  display_name: string;
  email: string | null;
  game_schema: string;
}

export interface AccessRequest {
  id: string;
  issuer: string;
  subject: string;
  username: string;
  displayName: string;
  email: string | null;
  status: AccessStatus;
  requestedAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  accountId: string | null;
}

export interface AccessPlayer {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  createdAt: Date;
  /** Provisioned through the admin group: not counted against MAX_PLAYERS. */
  admin: boolean;
}

export interface AccessCapacity {
  /** Accounts provisioned by an approval (admin-group accounts are not counted). */
  players: number;
  maxPlayers: number;
  databaseGb: number;
  databaseLimitGb: number;
  available: boolean;
  reason: CapacityReason | null;
}

export interface AccessOverview {
  requests: AccessRequest[];
  players: AccessPlayer[];
  capacity: AccessCapacity;
}

export type ApproveResult = { status: "approved"; reason?: undefined } | { status: "capacity"; reason: CapacityReason };

export interface AccessLimits {
  maxPlayers: number;
  sizeLimitGb: number;
}

interface Profile {
  issuer: string;
  subject: string;
  username: string;
  displayName: string;
  email: string | null;
}

interface RequestRow {
  id: string;
  issuer: string;
  subject: string;
  username: string;
  display_name: string;
  email: string | null;
  status: AccessStatus;
  requested_at: Date;
  decided_at: Date | null;
  decided_by: string | null;
  account_id: string | null;
}

const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const BYTES_PER_GB = 1024 ** 3;
const REQUEST_COLUMNS = `id, issuer, subject, username, display_name, email, status, requested_at, decided_at,
  decided_by, account_id`;

export function accountUuid(value: string, label: string): string {
  if (!UUID.test(value)) throw new Error(`${label} must be a UUID.`);
  return value.toLowerCase();
}

/** Every account gets its own world schema named after the account UUID. */
export function accountWorldSchema(accountId: string): string {
  return `touchline_user_${accountUuid(accountId, "Account ID").replaceAll("-", "")}`;
}

export function validateAccountSchema(schema: string, testMode = false): string {
  validateSqlSchema(schema, testMode);
  if (
    /^(public|information_schema)$/i.test(schema) || /^touchline_user_/i.test(schema) ||
    (!testMode && /^touchline_(?:test|e2e)_/i.test(schema))
  )
    throw new Error("The account registry requires a separate, non-world schema.");
  return schema;
}

export function validateAccountWorldSchema(schema: string, accountSchema: string, testMode = false): string {
  validateSqlSchema(schema, testMode);
  if (
    schema.toLowerCase() === accountSchema.toLowerCase() ||
    /^(accounts|public|information_schema)$/i.test(schema) ||
    (!testMode && /^touchline_(?:test|e2e)_/i.test(schema))
  )
    throw new Error("Invalid account world schema.");
  return schema;
}

export class AccessPendingError extends Error {
  readonly status = 403;
  readonly code = "access_pending";

  constructor() {
    super("Your access request is waiting for an administrator's approval.");
    this.name = "AccessPendingError";
  }
}

export class AccessDeniedError extends Error {
  readonly status = 403;
  readonly code = "access_denied";

  constructor() {
    super("Access to Touchline has not been granted to this account.");
    this.name = "AccessDeniedError";
  }
}

export class AccessRequestNotFoundError extends Error {
  readonly status = 404;
  readonly code = "access_request_not_found";

  constructor() {
    super("That access request no longer exists.");
    this.name = "AccessRequestNotFoundError";
  }
}

export class AccessRequestConflictError extends Error {
  readonly status = 409;
  readonly code = "access_request_conflict";

  constructor(message: string) {
    super(message);
    this.name = "AccessRequestConflictError";
  }
}

function boundedText(value: unknown, max: number, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > max) throw new Error(`Invalid trusted account profile (${label}).`);
  return text;
}

/** Normalizes the identity exactly as the registry CHECK constraints expect it. */
function profileOf(identity: AuthenticatedIdentity): Profile {
  if (typeof identity.issuer !== "string" || !identity.issuer || identity.issuer.length > 2048)
    throw new Error("Invalid trusted account profile (issuer).");
  if (typeof identity.subject !== "string" || !identity.subject || identity.subject.length > 255)
    throw new Error("Invalid trusted account profile (subject).");
  const email = identity.email === null || identity.email === undefined ? null : identity.email.trim().toLowerCase();
  if (email !== null && (!email || email.length > 320)) throw new Error("Invalid trusted account profile (email).");
  return {
    issuer: identity.issuer,
    subject: identity.subject,
    username: boundedText(identity.username, 255, "username"),
    displayName: boundedText(identity.displayName, 200, "display name"),
    email,
  };
}

function mapRequest(row: RequestRow): AccessRequest {
  return {
    id: row.id,
    issuer: row.issuer,
    subject: row.subject,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    status: row.status,
    requestedAt: row.requested_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    accountId: row.account_id,
  };
}

export async function assertAccountRegistry(registry: Store): Promise<void> {
  validateAccountSchema(registry.schemaName, registry.testMode);
  const users = tableName(registry.schemaName, "users");
  const requests = tableName(registry.schemaName, "access_requests");
  const tables = await registry.all<{ name: string }>(
    "SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = ?",
    registry.schemaName,
  );
  const names = tables.map((table) => table.name).sort();
  if (names.length !== REGISTRY_TABLES.length || REGISTRY_TABLES.some((table, index) => names[index] !== table))
    throw new Error("The account registry must contain only users and access_requests, never world or save tables.");
  await registry.all(`SELECT id, issuer, subject, username, display_name, email, game_schema, created_at, updated_at
    FROM ${users} LIMIT 0`);
  await registry.all(`SELECT ${REQUEST_COLUMNS} FROM ${requests} LIMIT 0`);
  // Valid, non-partial, non-expression unique indexes with their key columns in order.
  const indexes = await registry.all<{ table_name: string; is_primary_key: boolean; columns: string }>(
    `SELECT relation.relname AS table_name, idx.indisprimary AS is_primary_key,
       string_agg(attribute.attname, ',' ORDER BY key.ordinal) AS columns
     FROM pg_catalog.pg_index AS idx
     INNER JOIN pg_catalog.pg_class AS relation ON relation.oid = idx.indrelid
     CROSS JOIN LATERAL unnest(idx.indkey::int2[]) WITH ORDINALITY AS key(attnum, ordinal)
     INNER JOIN pg_catalog.pg_attribute AS attribute
       ON attribute.attrelid = idx.indrelid AND attribute.attnum = key.attnum
     WHERE idx.indrelid IN (to_regclass(?), to_regclass(?)) AND idx.indisunique AND idx.indisvalid
       AND idx.indpred IS NULL AND idx.indexprs IS NULL AND key.ordinal <= idx.indnkeyatts
     GROUP BY idx.indexrelid, relation.relname, idx.indisprimary`,
    users,
    requests,
  );
  const has = (table: string, columns: string, primary = false) => indexes.some((index) =>
    index.table_name === table && index.columns === columns && (!primary || index.is_primary_key));
  if (
    !has("users", "id", true) || !has("users", "issuer,subject") || !has("users", "game_schema") ||
    !has("access_requests", "id", true) || !has("access_requests", "issuer,subject")
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
        ${usersTableSql(accountSchema)}
        ${accessRequestsTableSql(accountSchema)}`);
      await assertAccountRegistry(registry);
    });
  } finally {
    await registry.close();
  }
}

/** Every registered world schema (possibly none), validated and required to exist; never creates one. */
export async function registeredAccountSchemas(root: Store, accountSchema = "accounts"): Promise<string[]> {
  validateAccountSchema(accountSchema, root.testMode);
  if (root.schemaName.toLowerCase() === accountSchema.toLowerCase())
    throw new Error("The account registry cannot share a world schema.");
  const registry = root.forSchema(accountSchema);
  try {
    await assertAccountRegistry(registry);
    const accounts = await registry.all<{ game_schema: string }>(
      `SELECT game_schema FROM ${tableName(accountSchema, "users")} ORDER BY game_schema`,
    );
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
  private readonly requestsTable: string;
  private readonly limits: AccessLimits;
  private readonly stores = new Map<string, Store>();

  constructor(private readonly root: Store, accountSchema = "accounts", options: { limits?: Partial<AccessLimits> } = {}) {
    validateAccountSchema(accountSchema, root.testMode);
    if (accountSchema.toLowerCase() === root.schemaName.toLowerCase())
      throw new Error("The account registry cannot share a world schema.");
    this.registry = root.forSchema(accountSchema);
    this.accountSchema = accountSchema;
    this.usersTable = tableName(accountSchema, "users");
    this.requestsTable = tableName(accountSchema, "access_requests");
    this.limits = {
      maxPlayers: options.limits?.maxPlayers ?? Number(process.env.MAX_PLAYERS ?? 10),
      sizeLimitGb: options.limits?.sizeLimitGb ?? Number(process.env.DB_SIZE_LIMIT_GB ?? 24),
    };
    if (!Number.isInteger(this.limits.maxPlayers) || this.limits.maxPlayers < 0 ||
        !Number.isFinite(this.limits.sizeLimitGb) || this.limits.sizeLimitGb <= 0)
      throw new Error("Invalid account capacity limits (MAX_PLAYERS, DB_SIZE_LIMIT_GB).");
  }

  async assertReady(): Promise<void> {
    await assertAccountRegistry(this.registry);
  }

  /**
   * The signed-in identity's account and world. Admins are provisioned on first sign-in; anyone else gets (or keeps)
   * an access request and is refused until an administrator approves it.
   */
  async resolve(identity: AuthenticatedIdentity): Promise<{ user: AccountUser; store: Store }> {
    const profile = profileOf(identity);
    let account = await this.lookup(this.registry, profile);
    if (!account) {
      if (identity.admin === true) {
        await this.provision(profile, null);
      } else {
        const status = await this.requestAccess(profile);
        if (status === "denied") throw new AccessDeniedError();
        if (status === "pending") throw new AccessPendingError();
        // "approved": an approval committed between the lookup and the request upsert.
      }
      account = await this.lookup(this.registry, profile);
      if (!account) throw new AccessPendingError();
    }
    return this.finishResolution(account, profile, identity.admin === true);
  }

  async listAccess(): Promise<AccessOverview> {
    const [requests, players, capacity] = await Promise.all([
      this.registry.all<RequestRow>(
        `SELECT ${REQUEST_COLUMNS} FROM ${this.requestsTable}
         ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'denied' THEN 1 ELSE 2 END, requested_at DESC LIMIT 500`,
      ),
      this.registry.all<{ id: string; username: string; display_name: string; email: string | null; created_at: Date; admin: boolean }>(
        `SELECT users.id, users.username, users.display_name, users.email, users.created_at,
           NOT EXISTS (SELECT 1 FROM ${this.requestsTable} AS request
             WHERE request.account_id = users.id AND request.status = 'approved') AS admin
         FROM ${this.usersTable} AS users ORDER BY users.created_at, users.id`,
      ),
      this.capacity(this.registry),
    ]);
    return {
      requests: requests.map(mapRequest),
      players: players.map((row) => ({
        id: row.id, username: row.username, displayName: row.display_name, email: row.email,
        createdAt: row.created_at, admin: row.admin,
      })),
      capacity,
    };
  }

  /**
   * Approves a pending or denied request: creates the account and its empty, migrated world in one transaction under
   * the registry lock, subject to MAX_PLAYERS and DB_SIZE_LIMIT_GB. Idempotent for already approved requests.
   */
  async approve(requestId: string, decidedBy: string): Promise<ApproveResult> {
    const id = this.requestUuid(requestId);
    const actor = boundedText(decidedBy, 320, "decided by");
    const row = await this.registry.get<RequestRow>(`SELECT ${REQUEST_COLUMNS} FROM ${this.requestsTable} WHERE id = ?::uuid`, id);
    if (!row) throw new AccessRequestNotFoundError();
    if (row.status === "approved") return { status: "approved" };
    return this.provision(
      { issuer: row.issuer, subject: row.subject, username: row.username, displayName: row.display_name, email: row.email },
      { requestId: id, decidedBy: actor },
    );
  }

  /** Denies a pending (or re-denies a denied) request. Approved access cannot be revoked here. */
  async deny(requestId: string, decidedBy: string): Promise<{ status: "denied" }> {
    const id = this.requestUuid(requestId);
    const actor = boundedText(decidedBy, 320, "decided by");
    // The row lock taken by a concurrent approval makes this re-check the approved status after it commits.
    const denied = await this.registry.get<{ id: string }>(
      `UPDATE ${this.requestsTable}
       SET status = 'denied',
         decided_at = CASE WHEN status = 'denied' THEN decided_at ELSE now() END,
         decided_by = CASE WHEN status = 'denied' THEN decided_by ELSE ? END
       WHERE id = ?::uuid AND status <> 'approved' RETURNING id`,
      actor,
      id,
    );
    if (denied) return { status: "denied" };
    if (await this.registry.get(`SELECT 1 AS present FROM ${this.requestsTable} WHERE id = ?::uuid`, id))
      throw new AccessRequestConflictError("This request was already approved; access cannot be revoked here.");
    throw new AccessRequestNotFoundError();
  }

  private requestUuid(value: string): string {
    if (typeof value !== "string" || !UUID.test(value)) throw new AccessRequestNotFoundError();
    return value.toLowerCase();
  }

  /** Inserts a pending request or refreshes its profile (never its status), returning the current status. */
  private async requestAccess(profile: Profile): Promise<AccessStatus> {
    const row = await this.registry.get<{ status: AccessStatus }>(
      `WITH upsert AS (
         INSERT INTO ${this.requestsTable} AS request (id, issuer, subject, username, display_name, email, status)
         VALUES (?::uuid, ?, ?, ?, ?, ?, 'pending')
         ON CONFLICT (issuer, subject) DO UPDATE
           SET username = EXCLUDED.username, display_name = EXCLUDED.display_name, email = EXCLUDED.email
           WHERE (request.username, request.display_name, request.email)
             IS DISTINCT FROM (EXCLUDED.username, EXCLUDED.display_name, EXCLUDED.email)
         RETURNING status
       )
       SELECT status FROM upsert
       UNION ALL
       SELECT status FROM ${this.requestsTable} WHERE issuer = ? AND subject = ?
       LIMIT 1`,
      randomUUID(),
      profile.issuer,
      profile.subject,
      profile.username,
      profile.displayName,
      profile.email,
      profile.issuer,
      profile.subject,
    );
    if (!row) throw new Error("The access request could not be recorded.");
    return row.status;
  }

  /**
   * Registers an identity with a new, empty, migrated world: the schema, its migrations, the users row and the
   * request decision commit together under the registry lock. `decision` is null for admin-group provisioning,
   * which is never capacity-limited and drops any earlier request of that identity.
   */
  private async provision(profile: Profile, decision: { requestId: string; decidedBy: string } | null): Promise<ApproveResult> {
    const accountId = randomUUID();
    const schema = accountWorldSchema(accountId);
    // The world store's transaction lets schema() join it, so the world and its registration commit together.
    const world = this.root.forSchema(schema);
    try {
      return await world.transaction(async (): Promise<ApproveResult> => {
        await world.advisoryLock(ACCOUNT_REGISTRY_LOCK, { timeout: "30s" });
        if (decision) {
          const current = await world.get<{ status: AccessStatus; issuer: string; subject: string }>(
            `SELECT status, issuer, subject FROM ${this.requestsTable} WHERE id = ?::uuid FOR UPDATE`,
            decision.requestId,
          );
          if (!current) throw new AccessRequestNotFoundError();
          if (current.status === "approved") return { status: "approved" };
          if (current.issuer !== profile.issuer || current.subject !== profile.subject)
            throw new Error("The access request changed while it was being approved.");
        }
        const existing = await this.lookup(world, profile, true);
        if (existing) {
          await this.recordDecision(world, profile, decision, existing.id);
          return { status: "approved" };
        }
        if (decision) {
          const capacity = await this.capacity(world);
          if (capacity.reason) return { status: "capacity", reason: capacity.reason };
        }
        const collision = await world.get<{ present: boolean }>(
          `SELECT to_regnamespace(?) IS NOT NULL
             OR EXISTS (SELECT 1 FROM ${this.usersTable} WHERE id = ?::uuid OR game_schema = ?) AS present`,
          quoteIdentifier(schema),
          accountId,
          schema,
        );
        if (collision?.present) throw new Error(`Schema ${schema} already exists; refusing to adopt it.`);
        await world.schema();
        await world.run(
          `INSERT INTO ${this.usersTable} (id, issuer, subject, username, display_name, email, game_schema)
           VALUES (?::uuid, ?, ?, ?, ?, ?, ?)`,
          accountId,
          profile.issuer,
          profile.subject,
          profile.username,
          profile.displayName,
          profile.email,
          schema,
        );
        await this.recordDecision(world, profile, decision, accountId);
        return { status: "approved" };
      });
    } finally {
      await world.close();
    }
  }

  private async recordDecision(
    store: Store,
    profile: Profile,
    decision: { requestId: string; decidedBy: string } | null,
    accountId: string,
  ): Promise<void> {
    if (decision)
      await store.run(
        `UPDATE ${this.requestsTable}
         SET status = 'approved', decided_at = now(), decided_by = ?, account_id = ?::uuid
         WHERE id = ?::uuid`,
        decision.decidedBy,
        accountId,
        decision.requestId,
      );
    else
      await store.run(
        `DELETE FROM ${this.requestsTable} WHERE issuer = ? AND subject = ? AND status <> 'approved'`,
        profile.issuer,
        profile.subject,
      );
  }

  /** `store` may be any Store on the database: the registry tables are named explicitly. */
  private async capacity(store: Store): Promise<AccessCapacity> {
    const row = await store.get<{ players: number; database_gb: number }>(
      `SELECT (SELECT count(*) FROM ${this.requestsTable} WHERE status = 'approved') AS players,
        pg_database_size(current_database()) / ${BYTES_PER_GB}.0 AS database_gb`,
    );
    const players = Number(row?.players ?? 0);
    const databaseGb = Number(row?.database_gb ?? 0);
    const reason: CapacityReason | null = players >= this.limits.maxPlayers ? "player_limit" :
      databaseGb >= this.limits.sizeLimitGb ? "database_size" : null;
    return {
      players,
      maxPlayers: this.limits.maxPlayers,
      databaseGb,
      databaseLimitGb: this.limits.sizeLimitGb,
      available: reason === null,
      reason,
    };
  }

  private async lookup(store: Store, profile: Profile, forUpdate = false): Promise<AccountRecord | undefined> {
    return store.get<AccountRecord>(
      `SELECT id, issuer, subject, username, display_name, email, game_schema
       FROM ${this.usersTable} WHERE issuer = ? AND subject = ?${forUpdate ? " FOR UPDATE" : ""}`,
      profile.issuer,
      profile.subject,
    );
  }

  private async finishResolution(
    account: AccountRecord,
    profile: Profile,
    admin: boolean,
  ): Promise<{ user: AccountUser; store: Store }> {
    const id = accountUuid(account.id, "Account ID");
    if (account.issuer !== profile.issuer || account.subject !== profile.subject)
      throw new Error("Account identity mapping is inconsistent.");
    const schema = validateAccountWorldSchema(account.game_schema, this.accountSchema, this.root.testMode);
    if (
      account.username !== profile.username || account.display_name !== profile.displayName ||
      account.email !== profile.email
    ) {
      const result = await this.registry.run(
        `UPDATE ${this.usersTable} SET username = ?, display_name = ?, email = ?, updated_at = now()
         WHERE id = ?::uuid AND issuer = ? AND subject = ? AND game_schema = ?`,
        profile.username,
        profile.displayName,
        profile.email,
        id,
        profile.issuer,
        profile.subject,
        schema,
      );
      if (result.changes !== 1) throw new Error("Account identity mapping changed during sign-in.");
    }
    let store = this.stores.get(id);
    if (store && store.schemaName !== schema)
      throw new Error("Account schema reassignment is not permitted.");
    if (!store) {
      store = this.root.forSchema(schema);
      this.stores.set(id, store);
    }
    return {
      user: { id, username: profile.username, displayName: profile.displayName, email: profile.email, admin },
      store,
    };
  }
}
