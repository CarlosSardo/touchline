import { randomUUID } from "node:crypto";
import type { Store } from "./db.ts";
import { OWNER_EMAIL_DEFAULT } from "./legacy-account.ts";
import { validateSqlSchema } from "./sql-config.ts";
import { tableName } from "./sql-schema.ts";

export const CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";

/** Transaction-scoped advisory lock that serializes invite decisions, claims and rebinds. */
export const ACCOUNT_REGISTRY_LOCK = "touchline:account-registry";

export type InviteStatus = "pending" | "accepted" | "denied" | "claimed";

export interface InviteRequest {
  id: string;
  email: string;
  note: string | null;
  status: InviteStatus;
  requestedAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  approvalEmailSent: boolean;
  acceptedEmailSent: boolean;
}

export interface Capacity {
  players: number;
  reserved: number;
  maxPlayers: number;
  databaseSizeGb: number;
  sizeLimitGb: number;
  available: boolean;
  reason: string | null;
}

export interface InviteLimits {
  maxPlayers: number;
  sizeLimitGb: number;
  perIpPerDay?: number;
  globalPerDay?: number;
  maxPending?: number;
  ownerObjectId?: string;
  ownerEmail?: string;
}

export interface CapacityLimits {
  maxPlayers: number;
  sizeLimitGb: number;
  ownerObjectId?: string | null;
  ownerEmail: string;
}

interface InviteRow {
  id: string;
  email: string;
  note: string | null;
  status: InviteStatus;
  requested_at: Date;
  decided_at: Date | null;
  decided_by: string | null;
  approval_email_sent: boolean;
  accepted_email_sent: boolean;
}

interface CapacityRow {
  players: number;
  reserved: number;
  database_size_gb: number;
}

type Decision = "accepted" | "denied" | "unchanged" | "capacity" | "not_found";

const DEFAULT_PER_IP_PER_DAY = 3;
const DEFAULT_GLOBAL_PER_DAY = 20;
const DEFAULT_MAX_PENDING = 50;
const BYTES_PER_GB = 1024 ** 3;
const INVITE_COLUMNS = `id, email, note, status, requested_at, decided_at, decided_by,
  approval_email_sent, accepted_email_sent`;

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
    throw new Error("Invite email is invalid.");
  return normalized;
}

function normalizeUuid(value: string | null | undefined): string | null {
  return value && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value) ? value.toLowerCase() : null;
}

function normalizeNote(note: string | null): string | null {
  const normalized = note?.trim() ?? "";
  if (normalized.length > 500) throw new Error("Invite note is too long.");
  return normalized || null;
}

function mapRequest(row: InviteRow): InviteRequest {
  return {
    id: row.id.toLowerCase(),
    email: row.email,
    note: row.note,
    status: row.status,
    requestedAt: row.requested_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    approvalEmailSent: Boolean(row.approval_email_sent),
    acceptedEmailSent: Boolean(row.accepted_email_sent),
  };
}

function capacityFromRow(row: CapacityRow | undefined, limits: Pick<CapacityLimits, "maxPlayers" | "sizeLimitGb">): Capacity {
  const players = Number(row?.players ?? 0);
  const reserved = Number(row?.reserved ?? 0);
  const databaseSizeGb = Number(row?.database_size_gb ?? 0);
  const reason = players + reserved >= limits.maxPlayers ? "player_limit" :
    databaseSizeGb >= limits.sizeLimitGb ? "database_size" : null;
  return {
    players,
    reserved,
    maxPlayers: limits.maxPlayers,
    databaseSizeGb,
    sizeLimitGb: limits.sizeLimitGb,
    available: reason === null,
    reason,
  };
}

/**
 * Registered players (excluding the platform owner) plus accepted, unclaimed invites against MAX_PLAYERS, and the
 * whole database size against INVITE_DB_SIZE_LIMIT_GB. `excludeRequestId` leaves the invite being claimed out of
 * the reservations, since it is about to become a player. `store` may be any Store on the database: the registry
 * tables are named explicitly so the check can join a world-creating transaction.
 */
export async function registryCapacity(
  store: Store,
  accountSchema: string,
  limits: CapacityLimits,
  excludeRequestId: string | null = null,
): Promise<Capacity> {
  const row = await store.get<CapacityRow>(
    `SELECT
      (SELECT count(*) FROM ${tableName(accountSchema, "users")}
        WHERE object_id IS DISTINCT FROM ?::uuid
          AND NOT (tenant_id = ?::uuid AND COALESCE(email, '') = ?)) AS players,
      (SELECT count(*) FROM ${tableName(accountSchema, "invite_requests")}
        WHERE status = 'accepted' AND id IS DISTINCT FROM ?::uuid) AS reserved,
      pg_database_size(current_database()) / ${BYTES_PER_GB}.0 AS database_size_gb`,
    normalizeUuid(limits.ownerObjectId),
    CONSUMER_TENANT_ID,
    limits.ownerEmail,
    normalizeUuid(excludeRequestId),
  );
  return capacityFromRow(row, limits);
}

export class InviteStore {
  private readonly registry: Store;
  private readonly table: string;
  private readonly attemptsTable: string;
  private readonly limits: Required<InviteLimits>;

  constructor(root: Store, limits: InviteLimits, accountSchema = "accounts") {
    validateSqlSchema(accountSchema, root.testMode);
    this.registry = root.forSchema(accountSchema);
    this.table = tableName(accountSchema, "invite_requests");
    this.attemptsTable = tableName(accountSchema, "invite_attempts");
    this.limits = {
      maxPlayers: limits.maxPlayers,
      sizeLimitGb: limits.sizeLimitGb,
      perIpPerDay: limits.perIpPerDay ?? DEFAULT_PER_IP_PER_DAY,
      globalPerDay: limits.globalPerDay ?? DEFAULT_GLOBAL_PER_DAY,
      maxPending: limits.maxPending ?? DEFAULT_MAX_PENDING,
      ownerObjectId: limits.ownerObjectId ?? process.env.OWNER_OBJECT_ID ?? "",
      ownerEmail: (limits.ownerEmail ?? process.env.OWNER_EMAIL ?? OWNER_EMAIL_DEFAULT).trim().toLowerCase(),
    };
  }

  async create(input: { email: string; note: string | null; ipHash: string | null }):
    Promise<{ status: "created" | "duplicate" | "rate_limited"; request?: InviteRequest }> {
    const email = normalizeEmail(input.email);
    const note = normalizeNote(input.note);
    if (input.ipHash !== null && !/^[a-f\d]{64}$/i.test(input.ipHash))
      throw new Error("Invite IP hash is invalid.");
    const id = randomUUID();
    try {
      const outcome = await this.registry.transaction(async () => {
        await this.registry.run(`DELETE FROM ${this.attemptsTable} WHERE attempted_at < now() - interval '1 day'`);
        await this.registry.run(`INSERT INTO ${this.attemptsTable} (ip_hash) VALUES (?)`, input.ipHash);
        const limit = await this.registry.get<{ ip_count: number; global_count: number; pending_count: number }>(
          `SELECT
            (SELECT count(*) FROM ${this.attemptsTable}
              WHERE ip_hash = ? AND attempted_at >= now() - interval '1 day') AS ip_count,
            (SELECT count(*) FROM ${this.attemptsTable}
              WHERE attempted_at >= now() - interval '1 day') AS global_count,
            (SELECT count(*) FROM ${this.table} WHERE status = 'pending') AS pending_count`,
          input.ipHash,
        );
        if (
          (input.ipHash !== null && Number(limit?.ip_count ?? 0) > this.limits.perIpPerDay) ||
          Number(limit?.global_count ?? 0) > this.limits.globalPerDay ||
          Number(limit?.pending_count ?? 0) >= this.limits.maxPending
        )
          return { status: "rate_limited" as const };
        const existing = await this.activeByEmail(email);
        if (existing) return { status: "duplicate" as const, request: existing };
        await this.registry.run(
          `INSERT INTO ${this.table} (id, email, note, status, ip_hash) VALUES (?, ?, ?, 'pending', ?)`,
          id,
          email,
          note,
          input.ipHash,
        );
        return { status: "created" as const };
      });
      if (outcome.status !== "created") return outcome;
    } catch (error) {
      // A concurrent request for the same email loses on the active-email unique index.
      const duplicate = await this.activeByEmail(email);
      if (duplicate) return { status: "duplicate", request: duplicate };
      throw error;
    }
    return { status: "created", request: await this.get(id) };
  }

  async get(id: string): Promise<InviteRequest | undefined> {
    const uuid = normalizeUuid(id);
    if (!uuid) return undefined;
    const row = await this.registry.get<InviteRow>(
      `SELECT ${INVITE_COLUMNS} FROM ${this.table} WHERE id = ?::uuid`,
      uuid,
    );
    return row ? mapRequest(row) : undefined;
  }

  async list(): Promise<InviteRequest[]> {
    const rows = await this.registry.all<InviteRow>(
      `SELECT ${INVITE_COLUMNS} FROM ${this.table} ORDER BY requested_at DESC LIMIT 200`,
    );
    return rows.map(mapRequest);
  }

  async capacity(): Promise<Capacity> {
    return registryCapacity(this.registry, this.registry.schemaName, this.limits);
  }

  async decide(id: string, action: "accept" | "deny", decidedBy: string):
    Promise<{ outcome: Decision; request?: InviteRequest; capacity?: Capacity }> {
    const actor = normalizeEmail(decidedBy);
    const request = await this.get(id);
    if (!request || (action !== "accept" && action !== "deny")) return { outcome: "not_found" };
    if (request.status !== "pending") return { outcome: "unchanged", request };
    const decision = await this.registry.transaction(async (): Promise<Decision> => {
      await this.registry.advisoryLock(ACCOUNT_REGISTRY_LOCK);
      const current = await this.registry.get<{ status: InviteStatus }>(
        `SELECT status FROM ${this.table} WHERE id = ?::uuid FOR UPDATE`,
        request.id,
      );
      if (!current) return "not_found";
      if (current.status !== "pending") return "unchanged";
      if (action === "accept" && (await registryCapacity(this.registry, this.registry.schemaName, this.limits)).reason) return "capacity";
      const result = await this.registry.run(
        `UPDATE ${this.table}
         SET ${action === "accept"
           ? "status = 'accepted', account_id = COALESCE(account_id, gen_random_uuid())"
           : "status = 'denied'"},
           decided_at = now(), decided_by = ?, updated_at = now()
         WHERE id = ?::uuid AND status = 'pending'`,
        actor,
        request.id,
      );
      if (result.changes !== 1) return "unchanged";
      return action === "accept" ? "accepted" : "denied";
    });
    if (decision === "not_found") return { outcome: "not_found" };
    const updated = await this.get(request.id) ?? request;
    if (decision === "capacity") return { outcome: "capacity", request: updated, capacity: await this.capacity() };
    return { outcome: decision, request: updated };
  }

  async markEmailSent(id: string, kind: "approval" | "accepted"): Promise<void> {
    const uuid = normalizeUuid(id);
    if (!uuid) return;
    await this.registry.run(
      `UPDATE ${this.table}
       SET ${kind === "approval" ? "approval_email_sent" : "accepted_email_sent"} = true, updated_at = now()
       WHERE id = ?::uuid`,
      uuid,
    );
  }

  /** Forgets denied requests after 30 days and undecided ones after 60 days. */
  async purgeExpired(): Promise<number> {
    const result = await this.registry.run(
      `DELETE FROM ${this.table}
       WHERE (status = 'denied' AND updated_at < now() - interval '30 days')
          OR (status = 'pending' AND requested_at < now() - interval '60 days')`,
    );
    return result.changes;
  }

  private async activeByEmail(email: string): Promise<InviteRequest | undefined> {
    const row = await this.registry.get<InviteRow>(
      `SELECT ${INVITE_COLUMNS} FROM ${this.table}
       WHERE email = ? AND status IN ('pending', 'accepted', 'claimed')
       ORDER BY requested_at DESC LIMIT 1`,
      email,
    );
    return row ? mapRequest(row) : undefined;
  }
}
