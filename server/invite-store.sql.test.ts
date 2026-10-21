import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Accounts, CapacityUnavailableError, accountWorldSchema, ensureAccountRegistry } from "./accounts.ts";
import { Store, sqlPoolConfig } from "./db.ts";
import { CONSUMER_TENANT_ID, InviteStore } from "./invite-store.ts";
import { readSqlSettings } from "./sql-config.ts";
import { quoteIdentifier, schemaMigrations, tableName } from "./sql-schema.ts";
import { LEGACY_EMAIL, LEGACY_OBJECT_ID, OWNER_EMAIL_DEFAULT } from "./legacy-account.ts";

const localSql = process.env.SQL_INTEGRATION_TESTS === "true" &&
  ["127.0.0.1", "localhost", "::1"].includes(process.env.SQL_HOST ?? "127.0.0.1");
const homeTenantId = "11111111-1111-4111-8111-111111111111";
const ownerObjectId = "22222222-2222-4222-8222-222222222222";
const invites = tableName("accounts", "invite_requests");
const users = tableName("accounts", "users");

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A fresh, owned PostgreSQL database: claims create touchline_user_* schemas, which test-mode stores refuse. */
async function withDatabase(test: (root: Store) => Promise<void>): Promise<void> {
  const database = `touchline_test_invites_${randomUUID().replaceAll("-", "")}`;
  if (!/^touchline_test_invites_[a-f0-9]{32}$/.test(database) || database === process.env.SQL_DATABASE)
    throw new Error("Invite SQL regression requires a fresh owned database.");
  for (const name of ["SQL_ALLOW_REMOTE_TESTS", "SQL_TEST_DATABASE", "TOUCHLINE_E2E_SCHEMA"]) vi.stubEnv(name, undefined);
  vi.stubEnv("SQL_TEST_MODE", "false");
  vi.stubEnv("SQL_SCHEMA", "public");
  const admin = new pg.Pool({ ...sqlPoolConfig(readSqlSettings()), max: 1 });
  let root: Store | undefined;
  try {
    await admin.query(`CREATE DATABASE ${quoteIdentifier(database)}`);
    try {
      root = await Store.open(database);
      expect({ database: root.database, schema: root.schemaName, testMode: root.testMode })
        .toEqual({ database, schema: "public", testMode: false });
      await ensureAccountRegistry(root);
      await test(root);
    } finally {
      try {
        await root?.close();
      } finally {
        await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)} WITH (FORCE)`);
      }
    }
  } finally {
    await admin.end();
  }
}

async function acceptedInvite(root: Store, email: string, accountId: string | null = null): Promise<string> {
  const id = randomUUID();
  await root.run(
    `INSERT INTO ${invites} (id, email, status, account_id, decided_at) VALUES (?, ?, 'accepted', ?, now())`,
    id,
    email,
    accountId,
  );
  return id;
}

async function userWorlds(root: Store): Promise<string[]> {
  return (await root.all<{ name: string }>(
    "SELECT nspname AS name FROM pg_catalog.pg_namespace WHERE nspname LIKE 'touchline\\_user\\_%' ORDER BY nspname",
  )).map((row) => row.name);
}

function consumer(objectId: string, email: string, displayName = "Guest") {
  return { tenantId: CONSUMER_TENANT_ID, objectId, displayName, email };
}

describe.skipIf(!localSql)("invite account SQL (local disposable PostgreSQL database)", () => {
  it("claims invited worlds idempotently, blocks capacity and adopts only migrated leftovers", async () => {
    await withDatabase(async (root) => {
      const limits = { maxPlayers: 1, sizeLimitGb: 24, ownerObjectId, ownerEmail: OWNER_EMAIL_DEFAULT };
      const accounts = new Accounts(root, "accounts", { limits });
      await accounts.assertReady();

      const accountId = randomUUID();
      const requestId = await acceptedInvite(root, "guest@example.test", accountId);
      const guest = consumer("33333333-3333-4333-8333-333333333333", "Guest@Example.Test");
      const resolved = await accounts.resolve(guest);
      const schema = accountWorldSchema(accountId);
      expect(resolved.user).toEqual({ id: accountId, displayName: "Guest", email: "guest@example.test" });
      expect(resolved.store.schemaName).toBe(schema);
      expect(await root.all(`SELECT version, name FROM ${tableName(schema, "schema_migrations")} ORDER BY version`))
        .toEqual(schemaMigrations(schema).map(({ version, name }) => ({ version, name })));
      expect(await resolved.store.all("SELECT key, value FROM meta")).toEqual([{ key: "appearanceIndexVersion", value: "1" }]);
      expect(await root.get(`SELECT status, account_id FROM ${invites} WHERE id = ?`, requestId))
        .toEqual({ status: "claimed", account_id: accountId });
      expect(await root.get(`SELECT tenant_id, object_id, email, game_schema FROM ${users} WHERE id = ?`, accountId))
        .toEqual({ tenant_id: CONSUMER_TENANT_ID, object_id: guest.objectId, email: "guest@example.test", game_schema: schema });
      expect(await accounts.claimInvite(requestId, { ...guest, email: "guest@example.test" }))
        .toEqual({ outcome: "claimed", reason: null });
      expect((await accounts.resolve(guest)).store).toBe(resolved.store);

      const blockedId = await acceptedInvite(root, "blocked@example.test");
      const blocked = consumer("44444444-4444-4444-8444-444444444444", "blocked@example.test", "Blocked");
      await expect(accounts.resolve(blocked)).rejects.toSatisfy((error) =>
        error instanceof CapacityUnavailableError && error.reason === "player_limit");
      expect(await root.get(`SELECT status, account_id FROM ${invites} WHERE id = ?`, blockedId))
        .toEqual({ status: "accepted", account_id: null });
      expect(await userWorlds(root)).toEqual([schema]);
      expect(await accounts.claimInvite(blockedId, { ...blocked, email: "other@example.test" }))
        .toEqual({ outcome: "not_found", reason: null });
      const tiny = new Accounts(root, "accounts", { limits: { ...limits, maxPlayers: 10, sizeLimitGb: 0.001 } });
      expect(await tiny.claimInvite(blockedId, blocked)).toEqual({ outcome: "capacity", reason: "database_size" });

      const roomy = new Accounts(root, "accounts", { limits: { ...limits, maxPlayers: 10 } });
      const [first, second] = await Promise.all([roomy.claimInvite(blockedId, blocked), roomy.claimInvite(blockedId, blocked)]);
      expect([first, second]).toEqual([{ outcome: "claimed", reason: null }, { outcome: "claimed", reason: null }]);
      const generated = await root.get<{ account_id: string; status: string }>(`SELECT status, account_id FROM ${invites} WHERE id = ?`, blockedId);
      expect(generated).toMatchObject({ status: "claimed", account_id: expect.stringMatching(/^[a-f\d-]{36}$/) });
      expect((await roomy.resolve(blocked)).store.schemaName).toBe(accountWorldSchema(generated!.account_id));
      expect(await userWorlds(root)).toHaveLength(2);

      // A world migrated by an interrupted earlier claim is adopted; any other unregistered schema is refused.
      const leftoverId = randomUUID();
      const leftover = root.forSchema(accountWorldSchema(leftoverId));
      await leftover.schema();
      await leftover.close();
      const leftoverRequest = await acceptedInvite(root, "leftover@example.test", leftoverId);
      expect(await roomy.claimInvite(leftoverRequest, consumer("55555555-5555-4555-8555-555555555555", "leftover@example.test")))
        .toEqual({ outcome: "claimed", reason: null });
      const squatterId = randomUUID();
      await root.exec(`CREATE SCHEMA ${quoteIdentifier(accountWorldSchema(squatterId))};`);
      const squatted = await acceptedInvite(root, "squatted@example.test", squatterId);
      await expect(roomy.claimInvite(squatted, consumer("66666666-6666-4666-8666-666666666666", "squatted@example.test")))
        .rejects.toThrow(/schema collision/);
      expect(await root.get(`SELECT count(*) AS total FROM ${users}`)).toEqual({ total: 3 });
      expect(await root.get(`SELECT status FROM ${invites} WHERE id = ?`, squatted)).toEqual({ status: "accepted" });
    });
  });

  it("rebinds the legacy dbo guest and the owner exactly once, and excludes the owner from capacity", async () => {
    vi.stubEnv("AUTH_HOME_TENANT_ID", homeTenantId);
    await withDatabase(async (root) => {
      const legacyId = randomUUID();
      const ownerId = randomUUID();
      for (const [id, objectId, email, schema] of [
        [legacyId, LEGACY_OBJECT_ID, LEGACY_EMAIL, "dbo"],
        [ownerId, ownerObjectId, null, accountWorldSchema(ownerId)],
      ] as const)
        await root.run(
          `INSERT INTO ${users} (id, tenant_id, object_id, display_name, email, game_schema) VALUES (?, ?, ?, ?, ?, ?)`,
          id, homeTenantId, objectId, "Home tenant", email, schema,
        );
      const accounts = new Accounts(root, "accounts", {
        limits: { maxPlayers: 10, sizeLimitGb: 24, ownerObjectId, ownerEmail: OWNER_EMAIL_DEFAULT },
      });
      expect(await accounts.rebindAccount(
        { tenantId: homeTenantId, objectId: ownerObjectId }, { tenantId: CONSUMER_TENANT_ID, objectId: randomUUID() }, LEGACY_EMAIL,
      )).toBe("unchanged");
      expect(await accounts.rebindAccount(
        { tenantId: homeTenantId, objectId: LEGACY_OBJECT_ID }, { tenantId: homeTenantId, objectId: randomUUID() }, LEGACY_EMAIL,
      )).toBe("unchanged");

      const legacyMsa = consumer("77777777-7777-4777-8777-777777777777", LEGACY_EMAIL.toUpperCase(), "Legacy MSA");
      const legacy = await accounts.resolve(legacyMsa);
      expect(legacy.user).toEqual({ id: legacyId, displayName: "Legacy MSA", email: LEGACY_EMAIL });
      expect(legacy.store.schemaName).toBe("dbo");
      expect(await root.get(`SELECT tenant_id, object_id FROM ${users} WHERE id = ?`, legacyId))
        .toEqual({ tenant_id: CONSUMER_TENANT_ID, object_id: legacyMsa.objectId });
      expect(await accounts.rebindAccount(
        { tenantId: homeTenantId, objectId: LEGACY_OBJECT_ID },
        { tenantId: CONSUMER_TENANT_ID, objectId: "88888888-8888-4888-8888-888888888888" }, LEGACY_EMAIL,
      )).toBe("unchanged");

      const ownerMsa = consumer("99999999-9999-4999-8999-999999999999", OWNER_EMAIL_DEFAULT, "Owner MSA");
      const owner = await accounts.resolve(ownerMsa);
      expect(owner.user.id).toBe(ownerId);
      expect(owner.store.schemaName).toBe(accountWorldSchema(ownerId));

      const store = new InviteStore(root, { maxPlayers: 10, sizeLimitGb: 24, ownerObjectId, ownerEmail: OWNER_EMAIL_DEFAULT });
      expect(await store.capacity()).toMatchObject({ players: 1, reserved: 0, maxPlayers: 10, available: true });
      await acceptedInvite(root, "reserved@example.test");
      expect(await store.capacity()).toMatchObject({ players: 1, reserved: 1 });
    });
  });

  it("requests, rate-limits, decides and purges invites", async () => {
    await withDatabase(async (root) => {
      const store = new InviteStore(root, { maxPlayers: 2, sizeLimitGb: 24, perIpPerDay: 2, ownerObjectId, ownerEmail: OWNER_EMAIL_DEFAULT });
      const ipHash = "a".repeat(64);
      const [left, right] = await Promise.all([
        store.create({ email: " Guest@Example.Test ", note: " hello ", ipHash: null }),
        store.create({ email: "guest@example.test", note: null, ipHash: null }),
      ]);
      expect([left.status, right.status].sort()).toEqual(["created", "duplicate"]);
      expect(left.request?.id).toBe(right.request?.id);
      const guest = (left.status === "created" ? left : right).request!;
      expect(guest).toMatchObject({ email: "guest@example.test", status: "pending", approvalEmailSent: false });
      expect(await store.create({ email: "a@example.test", note: null, ipHash })).toMatchObject({ status: "created" });
      expect(await store.create({ email: "b@example.test", note: null, ipHash })).toMatchObject({ status: "created" });
      expect(await store.create({ email: "c@example.test", note: null, ipHash })).toEqual({ status: "rate_limited" });
      expect(await root.get(`SELECT count(*) AS total FROM ${tableName("accounts", "invite_attempts")}`)).toEqual({ total: 5 });
      expect((await store.list()).map((request) => request.email).sort())
        .toEqual(["a@example.test", "b@example.test", "guest@example.test"]);

      expect(await store.decide(guest.id, "accept", "Approver@Example.Test"))
        .toMatchObject({ outcome: "accepted", request: { status: "accepted", decidedBy: "approver@example.test" } });
      expect(await store.decide(guest.id, "deny", "approver@example.test")).toMatchObject({ outcome: "unchanged" });
      const pending = (await store.list()).filter((request) => request.status === "pending");
      expect(await store.decide(pending[0].id, "accept", "approver@example.test")).toMatchObject({ outcome: "accepted" });
      expect(await store.decide(pending[1].id, "accept", "approver@example.test"))
        .toMatchObject({ outcome: "capacity", request: { status: "pending" }, capacity: { reserved: 2, reason: "player_limit" } });
      expect(await root.get(`SELECT count(*) AS total FROM ${invites} WHERE status = 'accepted' AND account_id IS NOT NULL`))
        .toEqual({ total: 2 });
      expect(await store.decide(pending[1].id, "deny", "approver@example.test")).toMatchObject({ outcome: "denied" });
      expect(await store.decide(randomUUID(), "accept", "approver@example.test")).toEqual({ outcome: "not_found" });

      await store.markEmailSent(guest.id, "approval");
      await store.markEmailSent(guest.id, "accepted");
      expect(await store.get(guest.id)).toMatchObject({ approvalEmailSent: true, acceptedEmailSent: true });

      await root.run(`UPDATE ${invites} SET updated_at = now() - interval '31 days' WHERE id = ?`, pending[1].id);
      const stale = await store.create({ email: "stale@example.test", note: null, ipHash: null });
      await root.run(`UPDATE ${invites} SET requested_at = now() - interval '61 days' WHERE id = ?`, stale.request!.id);
      expect(await store.purgeExpired()).toBe(2);
      expect(await store.get(pending[1].id)).toBeUndefined();
      expect(await store.purgeExpired()).toBe(0);
      await expect(root.run(`INSERT INTO ${invites} (id, email, status) VALUES (?, 'Upper@Example.Test', 'pending')`, randomUUID()))
        .rejects.toMatchObject({ code: "23514" });
    });
  });
});
