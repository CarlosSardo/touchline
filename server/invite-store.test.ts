import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { InviteStore, type InviteStatus } from "./invite-store.ts";
import type { Store } from "./db.ts";

interface Row {
  id: string;
  email: string;
  note: string | null;
  status: InviteStatus;
  ip_hash: string | null;
  requested_at: Date;
  decided_at: Date | null;
  decided_by: string | null;
  account_id: string | null;
  approval_email_sent: boolean;
  accepted_email_sent: boolean;
  updated_at: Date;
}

function harness() {
  const rows: Row[] = [];
  const attempts: { ip_hash: string | null; attempted_at: Date }[] = [];
  const capacity = { players: 2, databaseSizeGb: 1, reason: null as string | null };
  const registry = {
    schemaName: "accounts",
    testMode: false,
    get: vi.fn(async (sql: string, ...parameters: unknown[]) => {
      if (sql.includes("invite_capacity"))
        return {
          players: capacity.players,
          reserved: rows.filter((row) => row.status === "accepted").length,
          database_size_gb: capacity.databaseSizeGb,
          max_players: 10,
          size_limit_gb: 24,
          reason: capacity.reason,
        };
      if (sql.includes("invite_attempts"))
        return {
          ip_count: attempts.filter((row) => row.ip_hash === parameters[0]).length,
          global_count: attempts.length,
          pending_count: rows.filter((row) => row.status === "pending").length,
        };
      if (sql.includes("purge_expired_invites")) {
        const before = rows.length;
        const now = Date.now();
        for (let index = rows.length - 1; index >= 0; index--) {
          const row = rows[index];
          if (
            (row.status === "denied" && row.updated_at.getTime() < now - 30 * 86_400_000) ||
            (row.status === "pending" && row.requested_at.getTime() < now - 60 * 86_400_000)
          )
            rows.splice(index, 1);
        }
        return { purged: before - rows.length };
      }
      if (sql.includes("WHERE [id] = CONVERT"))
        return rows.find((row) => row.id === parameters[0]);
      if (sql.includes("WHERE [email] = ?"))
        return rows.find((row) => row.email === parameters[0] && ["pending", "accepted", "claimed"].includes(row.status));
      return undefined;
    }),
    all: vi.fn(async (sql: string, ...parameters: unknown[]) => {
      if (sql.includes("decide_invite")) {
        const row = rows.find((candidate) => candidate.id === parameters[0] && candidate.status === "pending");
        if (!row) return [{ outcome: "unchanged", reason: null }];
        if (parameters[1] === "accept" && capacity.reason)
          return [{ outcome: "capacity", reason: capacity.reason }];
        row.status = parameters[1] === "accept" ? "accepted" : "denied";
        row.decided_at = new Date();
        row.decided_by = parameters[2] as string;
        if (row.status === "accepted") row.account_id = randomUUID();
        row.updated_at = new Date();
        return [{ outcome: row.status, reason: null }];
      }
      if (sql.includes("ORDER BY [requested_at] DESC"))
        return [...rows].sort((left, right) => right.requested_at.getTime() - left.requested_at.getTime()).slice(0, 200);
      return [];
    }),
    run: vi.fn(async (sql: string, ...parameters: unknown[]) => {
      if (sql.startsWith("DELETE") && sql.includes("invite_attempts")) {
        attempts.splice(0, attempts.length, ...attempts.filter((row) => row.attempted_at.getTime() >= Date.now() - 86_400_000));
        return { changes: 0, lastInsertRowid: null };
      }
      if (sql.startsWith("INSERT") && sql.includes("invite_attempts")) {
        attempts.push({ ip_hash: parameters[0] as string | null, attempted_at: new Date() });
        return { changes: 1, lastInsertRowid: null };
      }
      if (sql.includes("create_invite")) {
        rows.push({
          id: parameters[0] as string,
          email: parameters[1] as string,
          note: parameters[2] as string | null,
          status: "pending",
          ip_hash: parameters[3] as string | null,
          requested_at: new Date(),
          decided_at: null,
          decided_by: null,
          account_id: null,
          approval_email_sent: false,
          accepted_email_sent: false,
          updated_at: new Date(),
        });
        return { changes: 1, lastInsertRowid: null };
      }
      if (sql.startsWith("UPDATE") && sql.includes("email_sent")) {
        const row = rows.find((candidate) => candidate.id === parameters[0]);
        if (row) {
          if (sql.includes("[approval_email_sent]")) row.approval_email_sent = true;
          else row.accepted_email_sent = true;
        }
        return { changes: row ? 1 : 0, lastInsertRowid: null };
      }
      return { changes: 0, lastInsertRowid: null };
    }),
    transaction: vi.fn(async (callback: () => Promise<unknown>) => callback()),
  };
  const root = { testMode: false, forSchema: vi.fn(() => registry) };
  return { attempts, capacity, rows, registry, store: new InviteStore(root as unknown as Store, { maxPlayers: 10, sizeLimitGb: 24 }) };
}

describe("InviteStore (no database)", () => {
  it("normalizes, dedupes and rate-limits requests", async () => {
    const { attempts, rows, store } = harness();
    const ipHash = "a".repeat(64);
    const created = await store.create({ email: " Guest@Example.Test ", note: " hello ", ipHash });
    expect(created.status).toBe("created");
    expect(created.request).toMatchObject({ email: "guest@example.test", note: "hello", status: "pending" });
    expect(await store.create({ email: "guest@example.test", note: null, ipHash: null }))
      .toMatchObject({ status: "duplicate", request: { id: created.request?.id } });
    for (const email of ["a@example.test", "b@example.test"])
      expect(await store.create({ email, note: null, ipHash })).toMatchObject({ status: "created" });
    expect(await store.create({ email: "c@example.test", note: null, ipHash })).toEqual({ status: "rate_limited" });
    expect(rows).toHaveLength(3);
    expect(attempts).toHaveLength(5);
    await expect(store.create({ email: "bad", note: null, ipHash: null })).rejects.toThrow(/email/);
  });

  it("counts duplicate submissions against invite attempt budgets", async () => {
    const { attempts, store } = harness();
    const ipHash = "b".repeat(64);
    const created = await store.create({ email: "repeat@example.test", note: null, ipHash });
    expect(created.status).toBe("created");
    expect(await store.create({ email: "repeat@example.test", note: null, ipHash }))
      .toMatchObject({ status: "duplicate", request: { id: created.request?.id } });
    expect(await store.create({ email: "repeat@example.test", note: null, ipHash }))
      .toMatchObject({ status: "duplicate" });
    expect(await store.create({ email: "repeat@example.test", note: null, ipHash }))
      .toEqual({ status: "rate_limited" });
    expect(attempts).toHaveLength(4);
  });

  it("guards acceptance by capacity, marks sent mail and purges expired rows", async () => {
    const { capacity, rows, store } = harness();
    const created = await store.create({ email: "guest@example.test", note: null, ipHash: null });
    capacity.players = 10;
    capacity.reason = "player_limit";
    expect(await store.decide(created.request!.id, "accept", "approver@example.test"))
      .toMatchObject({ outcome: "capacity", capacity: { available: false, reason: "player_limit" } });
    capacity.players = 2;
    capacity.reason = null;
    expect(await store.decide(created.request!.id, "deny", "Approver@Example.Test"))
      .toMatchObject({ outcome: "denied", request: { decidedBy: "approver@example.test" } });
    expect(await store.decide(created.request!.id, "deny", "approver@example.test"))
      .toMatchObject({ outcome: "unchanged" });
    await store.markEmailSent(created.request!.id, "approval");
    expect(rows[0].approval_email_sent).toBe(true);
    rows[0].updated_at = new Date(Date.now() - 31 * 86_400_000);
    rows.push({
      ...rows[0],
      id: randomUUID(),
      email: "old@example.test",
      status: "pending",
      requested_at: new Date(Date.now() - 61 * 86_400_000),
    });
    expect(await store.purgeExpired()).toBe(2);
    expect(await store.list()).toEqual([]);
  });
});
