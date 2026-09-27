import { randomUUID } from "node:crypto";
import type { Store } from "./db.ts";
import { OWNER_EMAIL_DEFAULT } from "./legacy-account.ts";
import { validateSqlSchema } from "./sql-config.ts";
import { tableName } from "./sql-schema.ts";

export const CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";

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
  players: number | string;
  reserved: number | string;
  database_size_gb: number | string;
  max_players?: number | string;
  size_limit_gb?: number | string;
  reason: string | null;
}

const DEFAULT_PER_IP_PER_DAY = 3;
const DEFAULT_GLOBAL_PER_DAY = 20;
const DEFAULT_MAX_PENDING = 50;

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
    throw new Error("Invite email is invalid.");
  return normalized;
}

function normalizeUuid(value: string): string | null {
  return /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value) ? value.toLowerCase() : null;
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

function capacityFromRow(row: CapacityRow | undefined, limits: Required<Pick<InviteLimits, "maxPlayers" | "sizeLimitGb">>): Capacity {
  const players = Number(row?.players ?? 0);
  const reserved = Number(row?.reserved ?? 0);
  const databaseSizeGb = Number(row?.database_size_gb ?? 0);
  const maxPlayers = Number(row?.max_players ?? limits.maxPlayers);
  const sizeLimitGb = Number(row?.size_limit_gb ?? limits.sizeLimitGb);
  const reason = row?.reason ?? (
    players + reserved >= maxPlayers ? "player_limit" :
      databaseSizeGb >= sizeLimitGb ? "database_size" : null
  );
  return {
    players,
    reserved,
    maxPlayers,
    databaseSizeGb,
    sizeLimitGb,
    available: reason === null,
    reason,
  };
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
        await this.registry.run(
          `DELETE FROM ${this.attemptsTable} WHERE [attempted_at] < DATEADD(day, -1, SYSUTCDATETIME())`,
        );
        await this.registry.run(
          `INSERT INTO ${this.attemptsTable} ([ip_hash], [attempted_at]) VALUES (?, SYSUTCDATETIME())`,
          input.ipHash,
        );
        const limit = await this.registry.get<{ ip_count: number; global_count: number; pending_count: number }>(
          `SELECT
            (SELECT COUNT_BIG(*) FROM ${this.attemptsTable}
              WHERE [ip_hash] = ? AND [attempted_at] >= DATEADD(day, -1, SYSUTCDATETIME())) AS [ip_count],
            (SELECT COUNT_BIG(*) FROM ${this.attemptsTable}
              WHERE [attempted_at] >= DATEADD(day, -1, SYSUTCDATETIME())) AS [global_count],
            (SELECT COUNT_BIG(*) FROM ${this.table} WHERE [status] = N'pending') AS [pending_count]`,
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
          `EXEC ${tableName(this.registry.schemaName, "create_invite")}
            @id = ?, @email = ?, @note = ?, @ip_hash = ?`,
          id,
          email,
          note,
          input.ipHash,
        );
        return { status: "created" as const };
      });
      if (outcome.status !== "created") return outcome;
    } catch (error) {
      const duplicate = await this.activeByEmail(email);
      if (duplicate) return { status: "duplicate", request: duplicate };
      throw error;
    }
    return { status: "created", request: await this.get(id) };
  }

  async get(id: string): Promise<InviteRequest | undefined> {
    const row = await this.registry.get<InviteRow>(
      `SELECT [id], [email], [note], [status], [requested_at], [decided_at], [decided_by],
        [approval_email_sent], [accepted_email_sent]
       FROM ${this.table} WHERE [id] = CONVERT(uniqueidentifier, ?)`,
      id,
    );
    return row ? mapRequest(row) : undefined;
  }

  async list(): Promise<InviteRequest[]> {
    const rows = await this.registry.all<InviteRow>(
      `SELECT TOP (200) [id], [email], [note], [status], [requested_at], [decided_at], [decided_by],
        [approval_email_sent], [accepted_email_sent]
       FROM ${this.table} ORDER BY [requested_at] DESC`,
    );
    return rows.map(mapRequest);
  }

  async capacity(): Promise<Capacity> {
    const row = await this.registry.get<CapacityRow>(
      `EXEC ${tableName(this.registry.schemaName, "invite_capacity")}`,
    ).catch(async () => {
      const ownerObjectId = normalizeUuid(this.limits.ownerObjectId);
      return this.registry.get<CapacityRow>(
        `SELECT
          (SELECT COUNT_BIG(*) FROM ${tableName(this.registry.schemaName, "users")}
            WHERE ${ownerObjectId ? "[object_id] <> CONVERT(uniqueidentifier, ?) AND" : ""}
              NOT ([tenant_id] = CONVERT(uniqueidentifier, ?) AND LOWER(COALESCE([email], N'')) = ?)) AS [players],
          (SELECT COUNT_BIG(*) FROM ${this.table} WHERE [status] = N'accepted') AS [reserved],
          (SELECT COALESCE(SUM(CAST([size] AS FLOAT(53))) * 8 / 1024 / 1024, 0) FROM sys.database_files) AS [database_size_gb],
          CAST(? AS int) AS [max_players],
          CAST(? AS float) AS [size_limit_gb],
          CAST(NULL AS nvarchar(32)) AS [reason]`,
        ...(ownerObjectId ? [ownerObjectId] : []),
        CONSUMER_TENANT_ID,
        this.limits.ownerEmail,
        this.limits.maxPlayers,
        this.limits.sizeLimitGb,
      );
    });
    return capacityFromRow(row, this.limits);
  }

  async decide(id: string, action: "accept" | "deny", decidedBy: string):
    Promise<{ outcome: "accepted" | "denied" | "unchanged" | "capacity" | "not_found"; request?: InviteRequest; capacity?: Capacity }> {
    const actor = normalizeEmail(decidedBy);
    const request = await this.get(id);
    if (!request) return { outcome: "not_found" };
    if (request.status !== "pending") return { outcome: "unchanged", request };
    const [decision] = await this.registry.all<{ outcome: "accepted" | "denied" | "unchanged" | "capacity" | "not_found"; reason: string | null }>(
      `EXEC ${tableName(this.registry.schemaName, "decide_invite")}
        @id = ?, @action = ?, @decided_by = ?`,
      id,
      action,
      actor,
    );
    const updated = await this.get(id);
    if (decision?.outcome === "capacity")
      return { outcome: "capacity", request: updated ?? request, capacity: await this.capacity() };
    if (decision?.outcome === "not_found") return { outcome: "not_found" };
    if (decision?.outcome === "accepted" || decision?.outcome === "denied")
      return { outcome: decision.outcome, request: updated ?? request };
    return { outcome: "unchanged", request: updated ?? request };
  }

  async markEmailSent(id: string, kind: "approval" | "accepted"): Promise<void> {
    await this.registry.run(
      `UPDATE ${this.table}
       SET ${kind === "approval" ? "[approval_email_sent]" : "[accepted_email_sent]"} = 1,
         [updated_at] = SYSUTCDATETIME()
       WHERE [id] = CONVERT(uniqueidentifier, ?)`,
      id,
    );
  }

  async purgeExpired(): Promise<number> {
    const row = await this.registry.get<{ purged: number | string }>(
      `EXEC ${tableName(this.registry.schemaName, "purge_expired_invites")}`,
    );
    return Number(row?.purged ?? 0);
  }

  private async activeByEmail(email: string): Promise<InviteRequest | undefined> {
    const row = await this.registry.get<InviteRow>(
      `SELECT TOP (1) [id], [email], [note], [status], [requested_at], [decided_at], [decided_by],
        [approval_email_sent], [accepted_email_sent]
       FROM ${this.table}
       WHERE [email] = ? AND [status] IN (N'pending', N'accepted', N'claimed')
       ORDER BY [requested_at] DESC`,
      email,
    );
    return row ? mapRequest(row) : undefined;
  }
}
