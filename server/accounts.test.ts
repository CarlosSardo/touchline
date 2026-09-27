import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AccountNotProvisionedError, Accounts, CapacityUnavailableError, InviteRequiredError, registeredAccountSchemas,
  type AccountRecord, type AuthenticatedIdentity,
} from "./accounts.ts";
import { CONSUMER_TENANT_ID } from "./invite-store.ts";
import { bindSql, sqlPoolConfig, Store } from "./db.ts";
import { Saves } from "./saves.ts";
import { readSqlSettings } from "./sql-config.ts";
import { accountsTableSql, inviteRequestsTableSql, quoteIdentifier, schemaMigrations, sqlLiteral, STORE_TABLES, tableName, WORLD_TABLES } from "./sql-schema.ts";
import {
  accountProvisioningPlan, existingAccountForObject, LEGACY_EMAIL, LEGACY_OBJECT_ID, main as migrateAccounts,
  mappedSchema, provisionAccounts,
} from "../scripts/accounts-migrate.ts";
import { accountProceduresSql, claimWorldMigrationStatements, runtimeGrants } from "../scripts/db-authorize.ts";
import { OWNER_EMAIL_DEFAULT } from "./legacy-account.ts";
import { careerDeleteOptions, main as deleteCareerMain, maskEmail, maskIdentifier, maskSchema, selectAccount } from "../scripts/career-delete.ts";

const tenantId = "11111111-1111-4111-8111-111111111111";
const ownerObjectId = "22222222-2222-4222-8222-222222222222";
const otherObjectId = "33333333-3333-4333-8333-333333333333";
const legacyAccountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ownerAccountId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ownerSchema = `touchline_user_${ownerAccountId.replaceAll("-", "")}`;
const registryIndexes = [
  { is_primary_key: true, columns: "id" },
  { is_primary_key: false, columns: "tenant_id,object_id" },
  { is_primary_key: false, columns: "game_schema" },
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function identity(objectId = LEGACY_OBJECT_ID): AuthenticatedIdentity {
  return { tenantId, objectId, displayName: "Trusted display name", email: LEGACY_EMAIL };
}

function accountHarness() {
  const records: AccountRecord[] = [
    { id: legacyAccountId, tenant_id: tenantId, object_id: LEGACY_OBJECT_ID,
      display_name: "Old name", email: null, game_schema: "dbo" },
    { id: ownerAccountId, tenant_id: tenantId, object_id: ownerObjectId,
      display_name: "Other name", email: null, game_schema: ownerSchema },
  ];
  const registry = {
    schemaName: "accounts",
    testMode: false,
    all: vi.fn(async (sql: string): Promise<unknown[]> => {
      if (sql.includes("FROM sys.tables")) return [{ name: "users" }, { name: "invite_requests" }, { name: "invite_attempts" }];
      if (sql.includes("FROM sys.indexes")) return registryIndexes;
      if (sql.includes("SELECT [game_schema]")) return records.map((record) => ({ game_schema: record.game_schema }));
      return [];
    }),
    get: vi.fn(async (_sql: string, registeredTenant: string, objectId: string) => {
      const record = records.find((account) => account.tenant_id === registeredTenant && account.object_id === objectId);
      return record ? { ...record } : undefined;
    }),
    run: vi.fn(async (_sql: string, ...parameters: unknown[]) => {
      const record = records.find((account) => account.id === parameters[2]);
      if (record) {
        record.display_name = parameters[0] as string;
        record.email = parameters[1] as string | null;
      }
      return { changes: record ? 1 : 0, lastInsertRowid: null };
    }),
    close: vi.fn(async () => {}),
  };
  const root = {
    schemaName: "dbo", testMode: false,
    get: vi.fn(async () => ({ object_id: 1 as number | null })),
    forSchema: vi.fn((schema: string) => schema === "accounts" ? registry : { schemaName: schema }),
  };
  return { root: root as unknown as Store, registry, records };
}

describe("Account resolution (no database)", () => {
  it("checks the separate registry without migrations or profile writes", async () => {
    const harness = accountHarness();
    const accounts = new Accounts(harness.root);
    await accounts.assertReady();
    expect(harness.root.forSchema).toHaveBeenCalledExactlyOnceWith("accounts");
    expect(harness.registry.run).not.toHaveBeenCalled();
    for (const [sql] of harness.registry.all.mock.calls) expect(sql.trim()).toMatch(/^SELECT /);
    expect(harness.registry.all.mock.calls[0][0]).toContain("FROM [accounts].[users]");
  });

  it("fails readiness for absent tables, world contamination or missing uniqueness constraints", async () => {
    const harness = accountHarness();
    const accounts = new Accounts(harness.root);
    harness.registry.all.mockRejectedValueOnce(new Error("Invalid object name 'accounts.users'"));
    await expect(accounts.assertReady()).rejects.toThrow(/Invalid object/);
    harness.registry.all.mockImplementation(async (sql) => sql.includes("FROM sys.tables")
      ? [{ name: "users" }, { name: "invite_requests" }, { name: "save_slots" }] : []);
    await expect(accounts.assertReady()).rejects.toThrow(/never world or save tables/);
    harness.registry.all.mockImplementation(async (sql) => sql.includes("FROM sys.tables")
      ? [{ name: "users" }, { name: "invite_requests" }, { name: "invite_attempts" }] : []);
    await expect(accounts.assertReady()).rejects.toThrow(/uniqueness constraints/);
  });

  it("allows users-only legacy registries for read-only schema checks but not runtime readiness", async () => {
    const harness = accountHarness();
    harness.registry.all.mockImplementation(async (sql: string): Promise<unknown[]> => {
      if (sql.includes("FROM sys.tables")) return [{ name: "users" }];
      if (sql.includes("FROM sys.indexes")) return registryIndexes;
      if (sql.includes("SELECT [game_schema]")) return harness.records.map((record) => ({ game_schema: record.game_schema }));
      return [];
    });

    await expect(new Accounts(harness.root).assertReady()).rejects.toThrow(/invite_requests and invite_attempts/);
    await expect(registeredAccountSchemas(harness.root)).resolves.toEqual(["dbo", ownerSchema]);
    expect(harness.registry.all.mock.calls.some(([sql]) => String(sql).includes("FROM [accounts].[invite_requests]"))).toBe(false);
    expect(harness.registry.all.mock.calls.some(([sql]) => String(sql).includes("FROM [accounts].[invite_attempts]"))).toBe(false);
  });

  it("returns the fixed legacy mapping and a different empty-world scope for the platform owner", async () => {
    const harness = accountHarness();
    const accounts = new Accounts(harness.root);
    const [legacy, owner] = await Promise.all([accounts.resolve(identity()), accounts.resolve(identity(ownerObjectId))]);
    expect(legacy.user).toEqual({ id: legacyAccountId, displayName: "Trusted display name", email: LEGACY_EMAIL });
    expect(legacy.store.schemaName).toBe("dbo");
    expect(owner.user.id).toBe(ownerAccountId);
    expect(owner.store.schemaName).toBe(ownerSchema);
    expect(owner.store).not.toBe(legacy.store);
    expect(harness.root.schemaName).toBe("dbo");
    expect(harness.registry.run.mock.calls.every(([sql]) => sql.includes("UPDATE [accounts].[users] SET [display_name]"))).toBe(true);
    expect(harness.registry.run.mock.calls.every(([sql]) => !/SET\s+\[(id|tenant_id|object_id|game_schema)\]/i.test(sql))).toBe(true);
  });

  it("looks up only tenant/object ID, never email, and never falls back for missing users", async () => {
    const harness = accountHarness();
    const accounts = new Accounts(harness.root);
    await expect(accounts.resolve(identity(otherObjectId))).rejects.toBeInstanceOf(AccountNotProvisionedError);
    await expect(accounts.resolve({ ...identity(), tenantId: otherObjectId })).rejects.toMatchObject({ status: 403 });
    expect(harness.root.forSchema).not.toHaveBeenCalledWith("dbo");
    expect(harness.registry.run).not.toHaveBeenCalled();
    for (const [sql] of harness.registry.get.mock.calls) {
      expect(sql).toContain("WHERE [tenant_id] = CONVERT(uniqueidentifier, ?)");
      expect(sql).toContain("AND [object_id] = CONVERT(uniqueidentifier, ?)");
      expect(sql).not.toMatch(/WHERE.*email/);
    }
  });

  it("requires an invite for unregistered consumers-tenant identities", async () => {
    const harness = accountHarness();
    await expect(new Accounts(harness.root).resolve({
      ...identity(otherObjectId),
      tenantId: CONSUMER_TENANT_ID,
      email: "new@example.test",
    })).rejects.toBeInstanceOf(InviteRequiredError);
  });

  it("rebinds the approved legacy email only in the consumers tenant", async () => {
    vi.stubEnv("AZURE_TENANT_ID", tenantId);
    const harness = accountHarness();
    const accounts = new Accounts(harness.root);
    harness.registry.get.mockImplementation(async (sql: string, registeredTenant: string, objectIdOrEmail?: string) => {
      if (sql.includes("FROM [accounts].[invite_requests]")) return undefined;
      const record = harness.records.find((account) =>
        account.tenant_id === registeredTenant && account.object_id === objectIdOrEmail);
      return record ? { ...record } : undefined;
    });
    harness.registry.all.mockImplementation(async (sql: string, ...parameters: unknown[]): Promise<unknown[]> => {
      if (sql.includes("rebind_account")) {
        harness.records[0].tenant_id = parameters[2] as string;
        harness.records[0].object_id = parameters[3] as string;
        harness.records[0].email = parameters[4] as string;
        return [{ outcome: "rebound" }];
      }
      if (sql.includes("FROM sys.tables")) return [{ name: "users" }, { name: "invite_requests" }, { name: "invite_attempts" }];
      if (sql.includes("FROM sys.indexes")) return registryIndexes;
      return [];
    });
    const resolved = await accounts.resolve({ ...identity(otherObjectId), tenantId: CONSUMER_TENANT_ID, email: LEGACY_EMAIL.toUpperCase() });
    expect(resolved.user.id).toBe(legacyAccountId);
    expect(resolved.store.schemaName).toBe("dbo");
    expect(harness.registry.all.mock.calls.find(([sql]) => sql.includes("rebind_account"))?.slice(1))
      .toEqual([tenantId, LEGACY_OBJECT_ID, CONSUMER_TENANT_ID, otherObjectId, LEGACY_EMAIL]);
    expect(harness.records[0]).toMatchObject({ tenant_id: CONSUMER_TENANT_ID, object_id: otherObjectId, email: LEGACY_EMAIL });
  });

  it("rebinds the owner MSA email from the home-tenant owner row", async () => {
    vi.stubEnv("AZURE_TENANT_ID", tenantId);
    const harness = accountHarness();
    const accounts = new Accounts(harness.root, "accounts", {
      limits: { maxPlayers: 10, sizeLimitGb: 24, ownerObjectId, ownerEmail: OWNER_EMAIL_DEFAULT },
    });
    harness.registry.get.mockImplementation(async (sql: string, registeredTenant: string, objectIdOrEmail?: string) => {
      if (sql.includes("FROM [accounts].[invite_requests]")) return undefined;
      const record = harness.records.find((account) =>
        account.tenant_id === registeredTenant && account.object_id === objectIdOrEmail);
      return record ? { ...record } : undefined;
    });
    harness.registry.all.mockImplementation(async (sql: string, ...parameters: unknown[]): Promise<unknown[]> => {
      if (sql.includes("rebind_account")) {
        harness.records[1].tenant_id = parameters[2] as string;
        harness.records[1].object_id = parameters[3] as string;
        harness.records[1].email = parameters[4] as string;
        return [{ outcome: "rebound" }];
      }
      return [];
    });
    const msaObjectId = "44444444-4444-4444-8444-444444444444";
    const resolved = await accounts.resolve({
      tenantId: CONSUMER_TENANT_ID,
      objectId: msaObjectId,
      displayName: "Owner MSA",
      email: OWNER_EMAIL_DEFAULT.toUpperCase(),
    });
    expect(resolved.user.id).toBe(ownerAccountId);
    expect(resolved.store.schemaName).toBe(ownerSchema);
    expect(harness.registry.all.mock.calls.find(([sql]) => sql.includes("rebind_account"))?.slice(1))
      .toEqual([tenantId, ownerObjectId, CONSUMER_TENANT_ID, msaObjectId, OWNER_EMAIL_DEFAULT]);
  });

  it("claims an accepted consumers-tenant invite and reports capacity separately", async () => {
    const harness = accountHarness();
    const requestId = randomUUID();
    const invited = { ...harness.records[1], tenant_id: CONSUMER_TENANT_ID, object_id: otherObjectId, email: "guest@example.test" };
    harness.records.splice(0, harness.records.length);
    harness.registry.get.mockImplementation(async (sql: string, first: string, second?: string) => {
      if (sql.includes("FROM [accounts].[invite_requests]"))
        return { id: requestId } as never;
      const record = harness.records.find((account) => account.tenant_id === first && account.object_id === second);
      return record ? { ...record } : undefined;
    });
    harness.registry.all.mockImplementation(async (sql: string): Promise<unknown[]> => {
      if (sql.includes("claim_invited_account")) {
        harness.records.push(invited);
        return [{ outcome: "claimed", reason: null }];
      }
      if (sql.includes("FROM sys.tables")) return [{ name: "users" }, { name: "invite_requests" }, { name: "invite_attempts" }];
      if (sql.includes("FROM sys.indexes")) return registryIndexes;
      return [];
    });
    const accounts = new Accounts(harness.root, "accounts", { limits: { maxPlayers: 10, sizeLimitGb: 24 } });
    const resolved = await accounts.resolve({
      tenantId: CONSUMER_TENANT_ID,
      objectId: otherObjectId,
      displayName: "Guest",
      email: "Guest@Example.Test",
    });
    expect(resolved.user).toEqual({ id: invited.id, displayName: "Guest", email: "guest@example.test" });
    expect(harness.registry.all.mock.calls.find(([sql]) => sql.includes("claim_invited_account"))?.slice(1))
      .toEqual([requestId, CONSUMER_TENANT_ID, otherObjectId, "guest@example.test", "Guest"]);

    harness.records.splice(0, harness.records.length);
    harness.registry.all.mockImplementation(async (sql: string): Promise<unknown[]> =>
      sql.includes("claim_invited_account") ? [{ outcome: "capacity", reason: "player_limit" }] : []);
    await expect(accounts.resolve({
      tenantId: CONSUMER_TENANT_ID,
      objectId: ownerObjectId,
      displayName: "Blocked",
      email: "guest@example.test",
    })).rejects.toBeInstanceOf(CapacityUnavailableError);
  });

  it("normalizes UUIDs, refreshes trusted profiles, and rechecks mappings before reusing a scoped store", async () => {
    const harness = accountHarness();
    const accounts = new Accounts(harness.root);
    const first = await accounts.resolve({ ...identity(), objectId: LEGACY_OBJECT_ID.toUpperCase() });
    const second = await accounts.resolve(identity());
    expect(first.store).toBe(second.store);
    expect(harness.registry.get).toHaveBeenCalledTimes(2);
    expect(harness.registry.run).toHaveBeenCalledTimes(1);
    expect(harness.registry.run.mock.calls[0].slice(1)).toEqual([
      "Trusted display name", LEGACY_EMAIL, legacyAccountId, tenantId, LEGACY_OBJECT_ID, "dbo",
    ]);
    await accounts.resolve({ ...identity(), displayName: "Renamed", email: null });
    expect(harness.records[0]).toMatchObject({ display_name: "Renamed", email: null, game_schema: "dbo" });
    harness.records.shift();
    await expect(accounts.resolve(identity())).rejects.toBeInstanceOf(AccountNotProvisionedError);
  });

  it("refuses inconsistent identity data, reassignment and lost profile updates", async () => {
    const harness = accountHarness();
    const accounts = new Accounts(harness.root);
    harness.registry.get.mockResolvedValueOnce({ ...harness.records[0], tenant_id: otherObjectId });
    await expect(accounts.resolve(identity())).rejects.toThrow(/inconsistent/);
    harness.registry.run.mockResolvedValueOnce({ changes: 0, lastInsertRowid: null });
    await expect(accounts.resolve(identity())).rejects.toBeInstanceOf(AccountNotProvisionedError);
    await accounts.resolve(identity());
    harness.records[0].game_schema = "touchline_user_reassigned";
    await expect(accounts.resolve(identity())).rejects.toThrow(/reassignment/);
  });

  it("reuses one scoped Store for simultaneous first requests from the same account", async () => {
    const harness = accountHarness();
    const accounts = new Accounts(harness.root);
    const resolved = await Promise.all(Array.from({ length: 3 }, () => accounts.resolve(identity())));
    expect(new Set(resolved.map((account) => account.store)).size).toBe(1);
    expect(vi.mocked(harness.root.forSchema).mock.calls.filter(([schema]) => schema === "dbo")).toHaveLength(1);
  });

  it.each(["accounts", "sys", "dbo.players", "bad]name", "touchline_test_live", "a".repeat(129)])(
    "refuses unsafe world mapping %s", async (schema) => {
      const harness = accountHarness();
      harness.records[0].game_schema = schema;
      await expect(new Accounts(harness.root).resolve(identity())).rejects.toThrow(/schema/i);
      expect(harness.registry.run).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid claims and registry/world overlap before issuing SQL", async () => {
    const harness = accountHarness();
    const accounts = new Accounts(harness.root);
    await expect(accounts.resolve({ ...identity(), objectId: "not-a-uuid" })).rejects.toThrow(/UUID/);
    await expect(accounts.resolve({ ...identity(), displayName: " " })).rejects.toThrow(/profile/);
    await expect(accounts.resolve({ ...identity(), email: "a".repeat(321) })).rejects.toThrow(/profile/);
    for (const schema of ["dbo", "sys", "touchline_user_existing"])
      expect(() => new Accounts(harness.root, schema)).toThrow(/separate/);
    expect(harness.registry.get).not.toHaveBeenCalled();
  });

  it("enumerates only existing registered worlds and refuses missing or duplicate mappings", async () => {
    const harness = accountHarness();
    await expect(registeredAccountSchemas(harness.root)).resolves.toEqual(["dbo", ownerSchema]);
    expect(harness.registry.close).toHaveBeenCalledOnce();
    vi.mocked(harness.root.get).mockResolvedValueOnce({ object_id: null });
    await expect(registeredAccountSchemas(harness.root)).rejects.toThrow(/refusing to recreate/);
    harness.records[1].game_schema = "DBO";
    await expect(registeredAccountSchemas(harness.root)).rejects.toThrow(/collision/);
  });
});

describe("Account provisioning and grants (no database)", () => {
  const options = { tenantId, legacyObjectId: LEGACY_OBJECT_ID, legacyEmail: LEGACY_EMAIL };
  const environment = {
    SQL_SERVER: "127.0.0.1", SQL_DATABASE: "touchline", SQL_SCHEMA: "dbo", SQL_TEST_MODE: "false",
    AZURE_TENANT_ID: tenantId, OWNER_OBJECT_ID: ownerObjectId,
    ALLOWED_USER_OBJECT_IDS: `${LEGACY_OBJECT_ID},${otherObjectId}`,
  };

  it("requires verified legacy claims and includes every allowlisted identity, including the distinct owner", () => {
    const plan = accountProvisioningPlan(options, environment);
    expect(plan).toMatchObject({ accountSchema: "accounts", database: "touchline", ...options });
    expect(plan).toMatchObject({ ownerObjectId, ownerEmail: OWNER_EMAIL_DEFAULT });
    expect(plan.objectIds).toEqual([LEGACY_OBJECT_ID, ownerObjectId, otherObjectId]);
    expect(() => accountProvisioningPlan({ ...options, legacyObjectId: ownerObjectId }, environment)).toThrow(/approved dbo/);
    expect(() => accountProvisioningPlan({ ...options, legacyEmail: "someone@example.com" }, environment)).toThrow(/approved dbo/);
    expect(() => accountProvisioningPlan({ ...options, tenantId: otherObjectId }, environment)).toThrow(/verified tenant/);
    expect(() => accountProvisioningPlan(options, { ...environment, OWNER_OBJECT_ID: LEGACY_OBJECT_ID })).toThrow(/must not inherit/);
    expect(() => accountProvisioningPlan(options, { ...environment, ALLOWED_USER_OBJECT_IDS: "" })).toThrow(/explicitly allowlisted/);
    expect(() => accountProvisioningPlan(options, { ...environment, ALLOWED_USER_OBJECT_IDS: LEGACY_EMAIL })).toThrow(/UUID/);
  });

  it("recognises consumers-tenant rebinds as the existing legacy and owner mappings", () => {
    const plan = accountProvisioningPlan(options, environment);
    const legacyRebound: AccountRecord = {
      id: legacyAccountId,
      tenant_id: CONSUMER_TENANT_ID,
      object_id: "44444444-4444-4444-8444-444444444444",
      display_name: "Legacy rebound",
      email: LEGACY_EMAIL.toUpperCase(),
      game_schema: "dbo",
    };
    const ownerRebound: AccountRecord = {
      id: ownerAccountId,
      tenant_id: CONSUMER_TENANT_ID,
      object_id: "55555555-5555-4555-8555-555555555555",
      display_name: "Owner rebound",
      email: OWNER_EMAIL_DEFAULT.toUpperCase(),
      game_schema: ownerSchema,
    };
    const accounts = [legacyRebound, ownerRebound];

    expect(mappedSchema(legacyRebound, plan)).toBe("dbo");
    expect(mappedSchema(ownerRebound, plan)).toBe(ownerSchema);
    expect(existingAccountForObject(accounts, LEGACY_OBJECT_ID, plan)).toBe(legacyRebound);
    expect(existingAccountForObject(accounts, ownerObjectId, plan)).toBe(ownerRebound);
  });

  it.each([
    { SQL_SCHEMA: "touchline_user_existing" }, { SQL_TEST_MODE: "true", SQL_SCHEMA: "touchline_test_accounts" },
    { SQL_ALLOW_REMOTE_TESTS: "true" }, { SQL_TEST_DATABASE: "touchline" }, { TOUCHLINE_E2E_SCHEMA: "touchline_e2e_accounts" },
    { CONTAINER_APP_NAME: "touchline" }, { AZURE_CLIENT_ID: ownerObjectId },
  ])("refuses non-operator contexts: %o", (override) => {
    expect(() => accountProvisioningPlan(options, { ...environment, ...override })).toThrow(/operator context/);
  });

  it("keeps account tables completely outside world migrations and snapshot table allowlists", () => {
    const sql = accountsTableSql("accounts");
    expect(sql).toContain("CREATE TABLE [accounts].[users]");
    expect(sql).toContain("[id] UNIQUEIDENTIFIER NOT NULL PRIMARY KEY");
    expect(sql).toContain("UNIQUE ([tenant_id], [object_id])");
    expect(sql).toContain("[game_schema] NVARCHAR(128) COLLATE Latin1_General_100_CI_AS NOT NULL UNIQUE");
    expect(sql).toContain("[email] NVARCHAR(320) NULL");
    expect(STORE_TABLES.has("users")).toBe(false);
    expect(WORLD_TABLES).not.toContain("users");
    expect(schemaMigrations("dbo").flatMap((migration) => migration.statements).join("\n")).not.toContain("[users]");
    expect(() => bindSql(sql, [], "accounts")).not.toThrow();
    const invites = inviteRequestsTableSql("accounts");
    expect(invites).toContain("CREATE TABLE [accounts].[invite_requests]");
    expect(invites).toContain("CREATE TABLE [accounts].[invite_attempts]");
    expect(invites).toContain("[email] NVARCHAR(320)");
    expect(invites).toContain("CHECK ([status] IN (N'pending', N'accepted', N'denied', N'claimed'))");
    expect(invites).toContain("CREATE UNIQUE INDEX [UX_invite_requests_email_active]");
    expect(invites).toContain("IX_invite_attempts_ip_hash_attempted_at");
    expect(STORE_TABLES.has("invite_requests")).toBe(false);
    expect(STORE_TABLES.has("invite_attempts")).toBe(false);
    expect(() => bindSql(invites, [], "accounts")).not.toThrow();
  });

  it("grants each world a fixed-schema reseed helper and only profile updates in the registry", () => {
    const grants = runtimeGrants("touchline-app", ["dbo", ownerSchema], "accounts").join("\n");
    for (const schema of ["dbo", ownerSchema]) {
      expect(grants).toContain(`ON SCHEMA::[${schema}] TO [touchline-app]`);
      expect(grants).toContain(`GRANT EXECUTE ON OBJECT::[${schema}].[reseed_world_identity]`);
      expect(grants).toContain(`GRANT ALTER ON OBJECT::[${schema}].[players]`);
    }
    expect(grants).toContain("GRANT SELECT, VIEW DEFINITION ON OBJECT::[accounts].[users]");
    expect(grants).toContain("GRANT UPDATE ON OBJECT::[accounts].[users] ([display_name], [email], [updated_at])");
    expect(grants).toContain("GRANT SELECT ON OBJECT::[accounts].[invite_requests]");
    expect(grants).toContain("GRANT UPDATE ON OBJECT::[accounts].[invite_requests] ([approval_email_sent], [accepted_email_sent], [updated_at])");
    expect(grants).toContain("GRANT SELECT, INSERT, DELETE ON OBJECT::[accounts].[invite_attempts]");
    expect(grants).toContain("GRANT EXECUTE ON OBJECT::[accounts].[create_invite]");
    expect(grants).toContain("GRANT EXECUTE ON OBJECT::[accounts].[decide_invite]");
    expect(grants).toContain("GRANT EXECUTE ON OBJECT::[accounts].[purge_expired_invites]");
    expect(grants).toContain("GRANT EXECUTE ON OBJECT::[accounts].[invite_capacity]");
    expect(grants).toContain("GRANT EXECUTE ON OBJECT::[accounts].[claim_invited_account]");
    expect(grants).toContain("GRANT EXECUTE ON OBJECT::[accounts].[rebind_account]");
    expect(grants).not.toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[accounts].[invite_requests]");
    expect(grants).not.toMatch(/db_owner|db_ddladmin|CREATE SCHEMA|ON SCHEMA::\[accounts\]|GRANT ALTER ON OBJECT::\[accounts\]/);
    expect(() => bindSql(grants, [], "dbo")).not.toThrow();
    expect(() => runtimeGrants("touchline-app", ["accounts"], "accounts")).toThrow(/schema/);
    expect(() => runtimeGrants("touchline-app", ["dbo", "DBO"])).toThrow(/collision/);
    expect(() => runtimeGrants("dbo", ["dbo"])).toThrow(/principal/);
    expect(runtimeGrants("touchline-app", ["dbo"]).join("\n")).not.toContain("[accounts]");
  });

  it("generates owner-executed invite procedures from every world migration statement", () => {
    const ddl = accountProceduresSql("accounts", "touchline-app", ownerObjectId);
    expect(ddl).toContain("CREATE OR ALTER PROCEDURE [accounts].[claim_invited_account]");
    expect(ddl).toContain("WITH EXECUTE AS OWNER");
    expect(ddl).toContain("CREATE OR ALTER PROCEDURE [accounts].[rebind_account]");
    expect(ddl).toContain("CREATE OR ALTER PROCEDURE [accounts].[invite_capacity]");
    expect(ddl).toContain("CREATE OR ALTER PROCEDURE [accounts].[create_invite]");
    expect(ddl).toContain("CREATE OR ALTER PROCEDURE [accounts].[decide_invite]");
    expect(ddl).toContain("CREATE OR ALTER PROCEDURE [accounts].[purge_expired_invites]");
    expect(ddl).not.toContain("@max_players");
    expect(ddl).not.toContain("@size_limit_gb");
    expect(claimWorldMigrationStatements()).toEqual(schemaMigrations("__touchline_claim_schema__").flatMap((migration) => migration.statements));
    for (const statement of claimWorldMigrationStatements()) {
      expect(ddl).toContain(sqlLiteral(statement).replaceAll("'", "''"));
    }
    expect(ddl).toContain("GRANT SELECT, INSERT, UPDATE, DELETE, VIEW DEFINITION ON SCHEMA::");
    expect(ddl).toContain("[touchline-app]");
    expect(ddl).toContain(LEGACY_OBJECT_ID);
    expect(ddl).toContain(ownerObjectId);
    expect(ddl).toContain(OWNER_EMAIL_DEFAULT);
    expect(ddl).toContain(CONSUMER_TENANT_ID);
    expect(() => bindSql(ddl, [], "dbo")).not.toThrow();
  });

  it("defaults to an offline plan and requires both mutation acknowledgements before opening SQL", async () => {
    for (const name of ["AZURE_CLIENT_ID", "CONTAINER_APP_NAME", "SQL_USER", "SQL_PASSWORD", "SQL_ALLOW_REMOTE_TESTS", "SQL_TEST_DATABASE", "TOUCHLINE_E2E_SCHEMA", "GAME_DB", "SAVE_DIR"])
      vi.stubEnv(name, undefined);
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
    const open = vi.spyOn(Store, "open").mockRejectedValue(new Error("SQL must not be opened"));
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const args = ["--tenant-id", tenantId, "--legacy-object-id", LEGACY_OBJECT_ID, "--legacy-email", LEGACY_EMAIL];
    await migrateAccounts(args);
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({ dryRun: true, legacySchema: "dbo" });
    await expect(migrateAccounts([...args, "--apply"])).rejects.toThrow(/--apply --yes/);
    await expect(migrateAccounts([...args, "--apply", "--yes", "--dry-run"])).rejects.toThrow(/not both/);
    expect(open).not.toHaveBeenCalled();
  });
});

describe("Operator career deletion guards (no database)", () => {
  const activeState = {
    careerId: "career-to-delete", careerName: "Owner career", seed: "seed-to-delete", clubId: 7,
    date: "2026-07-20", season: 2026, started: true, director: { name: "Owner Director" },
  };
  function harness(options: { records?: AccountRecord[]; state?: object | null } = {}) {
    const records = options.records ?? [
      { id: legacyAccountId, tenant_id: tenantId, object_id: LEGACY_OBJECT_ID,
        display_name: "Legacy guest", email: "Legacy.Guest@Example.test", game_schema: "dbo" },
      { id: ownerAccountId, tenant_id: tenantId, object_id: ownerObjectId,
        display_name: "Owner", email: "Owner.Person@Example.test", game_schema: ownerSchema },
    ];
    const state = options.state === undefined ? activeState : options.state;
    const registry = {
      schemaName: "accounts", testMode: false,
      all: vi.fn(async (sql: string): Promise<unknown[]> => {
        if (sql.includes("FROM sys.tables")) return [{ name: "users" }, { name: "invite_requests" }, { name: "invite_attempts" }];
        if (sql.includes("FROM sys.indexes")) return registryIndexes;
        if (sql.includes("SELECT TOP (0)")) return [];
        if (sql.includes("[game_schema]")) return records.map((record) => ({ ...record }));
        return [];
      }),
    };
    const world = {
      transaction: vi.fn(async (callback: () => Promise<unknown>) => callback()),
      get: vi.fn(async (sql: string) => {
        if (sql.includes("'state'")) return state ? { value: JSON.stringify(state) } : undefined;
        if (sql.includes("'world'")) return { value: JSON.stringify({ expanded: true, version: 3 }) };
        if (sql.includes("FROM clubs")) return { name: "Owner FC" };
        if (sql.includes("COUNT_BIG")) return { total: "833976" };
        if (sql.includes("HAS_PERMS_BY_NAME")) return { allowed: 0 };
        return undefined;
      }),
      all: vi.fn(async () => [
        { career_id: "career-to-delete", slots: 3, complete: 3, bytes: "3145728" },
        { career_id: "kept-career", slots: 1, complete: 1, bytes: 1024 },
      ]),
    };
    const root = {
      database: "touchline",
      forSchema: vi.fn((schema: string) => schema === "accounts" ? registry : { ...world, schemaName: schema }),
      close: vi.fn(async () => {}),
    };
    const saves = {
      currentState: vi.fn(async () => null),
      list: vi.fn(async () => []),
      deleteActiveCareer: vi.fn(async (confirmation: { careerId: string | null }) => ({
        deleted: true as const, careerId: confirmation.careerId, snapshots: 3, message: "Career deleted.",
      })),
    };
    const lines: string[] = [];
    const dependencies = {
      open: vi.fn(async () => root as unknown as Store),
      saves: vi.fn(() => saves as unknown as Saves),
      log: (line: string) => { lines.push(line); },
    };
    return { root, world, saves, dependencies, lines };
  }

  it("refuses ambiguous, unconfirmed and malformed requests before opening SQL", async () => {
    const { dependencies } = harness();
    for (const [args, message] of [
      [[], /exactly one/],
      [["--oid", ownerObjectId, "--email", "owner.person@example.test"], /exactly one/],
      [["--oid", "not-a-uuid"], /UUID/],
      [["--email", "owner.person"], /--email/],
      [["--oid", ownerObjectId, "--apply"], /--apply --yes/],
      [["--oid", ownerObjectId, "--yes", "--apply", "--dry-run"], /not both/],
      [["--oid", ownerObjectId, "--account-schema", "dbo"], /separate/],
      [["--list", "--oid", ownerObjectId], /--list/],
      [["--list", "--apply", "--yes"], /--list/],
    ] as const)
      await expect(deleteCareerMain([...args], dependencies), args.join(" ")).rejects.toThrow(message);
    expect(dependencies.open).not.toHaveBeenCalled();
    expect(careerDeleteOptions(["--oid", ownerObjectId.toUpperCase()])).toEqual({
      objectId: ownerObjectId, email: undefined, accountSchema: "accounts", apply: false, list: false,
    });
  });

  it("refuses the legacy dbo world and unknown or ambiguous identifiers without opening a world", async () => {
    for (const args of [["--oid", LEGACY_OBJECT_ID, "--apply", "--yes"], ["--email", "legacy.guest@example.TEST", "--apply", "--yes"]]) {
      const { root, saves, dependencies, lines } = harness();
      await expect(deleteCareerMain(args, dependencies)).rejects.toThrow(/dbo/);
      expect(root.forSchema).toHaveBeenCalledExactlyOnceWith("accounts");
      expect(saves.deleteActiveCareer).not.toHaveBeenCalled();
      expect(root.close).toHaveBeenCalledOnce();
      const inventory = JSON.parse(lines[0]).registry;
      expect(inventory).toEqual({ accounts: 2, withStoredEmail: 2 });
      expect(lines.join("\n")).not.toMatch(/Legacy\.Guest|Owner\.Person|L\*\*\*t|O\*\*\*n/);
      for (const raw of [ownerObjectId, LEGACY_OBJECT_ID, ownerAccountId, legacyAccountId, ownerSchema])
        expect(lines.join("\n")).not.toContain(raw);
    }
    const unknown = harness();
    await expect(deleteCareerMain(["--oid", otherObjectId], unknown.dependencies)).rejects.toThrow(/No registered account/);
    expect(JSON.parse(unknown.lines[0])).toEqual({ registry: { accounts: 2, withStoredEmail: 2 }, hint: expect.stringMatching(/--list/) });
    await expect(deleteCareerMain(["--email", "owner.person@example"], unknown.dependencies)).rejects.toThrow(/No registered account/);
    const duplicate = harness({ records: [
      { id: ownerAccountId, tenant_id: tenantId, object_id: ownerObjectId, display_name: "A", email: "same@example.test", game_schema: ownerSchema },
      { id: legacyAccountId, tenant_id: tenantId, object_id: otherObjectId, display_name: "B", email: "SAME@example.test", game_schema: "touchline_user_other" },
    ] });
    await expect(deleteCareerMain(["--email", "same@example.test", "--apply", "--yes"], duplicate.dependencies)).rejects.toThrow(/matches 2 accounts/);
    for (const { root, saves } of [unknown, duplicate]) {
      expect(root.forSchema.mock.calls.every(([schema]) => schema === "accounts")).toBe(true);
      expect(saves.deleteActiveCareer).not.toHaveBeenCalled();
    }
    expect(() => selectAccount([{ id: ownerAccountId, tenant_id: tenantId, object_id: ownerObjectId, display_name: "A",
      email: "a@example.test", game_schema: "accounts" }], { objectId: ownerObjectId, accountSchema: "accounts", apply: false, list: false }))
      .toThrow(/schema/);
  });

  it("lists the registry masked only with --list and opens no world", async () => {
    const listed = harness();
    await deleteCareerMain(["--list"], listed.dependencies);
    expect(listed.root.forSchema).toHaveBeenCalledExactlyOnceWith("accounts");
    expect(listed.saves.deleteActiveCareer).not.toHaveBeenCalled();
    expect(listed.root.close).toHaveBeenCalledOnce();
    expect(JSON.parse(listed.lines[0]).registry).toEqual({
      accounts: 2, withStoredEmail: 2,
      registered: [
        { accountId: "aaaa***aaaa", objectId: maskIdentifier(LEGACY_OBJECT_ID), schema: "dbo", email: "L***t@Example.test" },
        { accountId: "bbbb***bbbb", objectId: "2222***2222", schema: "touchline_user_bbbb***bbbb", email: "O***n@Example.test" },
      ],
    });
    for (const raw of [ownerObjectId, LEGACY_OBJECT_ID, ownerAccountId, legacyAccountId, ownerSchema])
      expect(listed.lines.join("\n")).not.toContain(raw);
  });

  it("prints a dry-run summary by default and deletes only with --apply --yes through Saves", async () => {
    const dryRun = harness();
    await deleteCareerMain(["--email", "OWNER.PERSON@example.test"], dryRun.dependencies);
    const summary = JSON.parse(dryRun.lines[0]);
    expect(summary).toMatchObject({
      dryRun: true, database: "touchline", schema: maskSchema(ownerSchema),
      account: { id: "bbbb***bbbb", tenantId: "1111***1111", objectId: "2222***2222", displayName: "O***r",
        email: "O***n@Example.test", matchedBy: "email", identifiers: { objectId: true, storedEmail: true } },
      active: { careerId: "career-to-delete", club: "Owner FC", director: "Owner Director", date: "2026-07-20", seed: "seed-to-delete" },
      world: { expanded: true, version: 3, players: 833976 },
      snapshots: [
        { careerId: "career-to-delete", slots: 3, bytes: 3145728, deletedWithActiveCareer: true },
        { careerId: "kept-career", slots: 1, deletedWithActiveCareer: false },
      ],
      approximateSizeMB: expect.stringMatching(/unavailable/),
    });
    expect(dryRun.world.transaction).toHaveBeenCalledOnce();
    expect(dryRun.saves.deleteActiveCareer).not.toHaveBeenCalled();
    expect(dryRun.root.close).toHaveBeenCalledOnce();
    for (const raw of [ownerObjectId, ownerAccountId, tenantId, ownerSchema, "\"Owner\""])
      expect(dryRun.lines.join("\n")).not.toContain(raw);

    const applied = harness();
    await deleteCareerMain(["--oid", ownerObjectId.toUpperCase(), "--apply", "--yes"], applied.dependencies);
    expect(applied.dependencies.saves).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ schemaName: ownerSchema }));
    expect(applied.saves.deleteActiveCareer).toHaveBeenCalledExactlyOnceWith({ careerId: "career-to-delete", seed: "seed-to-delete" });
    expect(JSON.parse(applied.lines.at(-1)!)).toMatchObject({
      applied: true, schema: maskSchema(ownerSchema), result: { deleted: true, snapshots: 3 }, after: { hasWorld: false, remainingSnapshots: 0 },
    });
    for (const raw of [ownerObjectId, ownerAccountId, tenantId, ownerSchema])
      expect(applied.lines.join("\n")).not.toContain(raw);
    expect(applied.root.close).toHaveBeenCalledOnce();
  });

  it("refuses to apply when the account has no active career", async () => {
    const empty = harness({ state: null });
    await expect(deleteCareerMain(["--oid", ownerObjectId, "--apply", "--yes"], empty.dependencies)).rejects.toThrow(/no active career/);
    expect(empty.saves.deleteActiveCareer).not.toHaveBeenCalled();
    await deleteCareerMain(["--oid", ownerObjectId], empty.dependencies);
    expect(JSON.parse(empty.lines.at(-1)!)).toMatchObject({ dryRun: true, active: null, next: expect.stringMatching(/Nothing to delete/) });
    expect(maskEmail("ab@example.test")).toBe("a***@example.test");
    expect(maskEmail(null)).toBeNull();
  });
});

if (process.env.SQL_INTEGRATION_TESTS === "true") {
  describe("Account isolation (explicit opt-in, real configured SQL)", () => {
    it("keeps profiles outside isolated worlds and saves across concurrent resolve, clear and close", async () => {
      const root = await Store.createTest("account_world");
      let other: Store | undefined;
      let registry: Store | undefined;
      let registryCreated = false;
      try {
        other = await Store.createTest("other_account_world");
        const accountSchema = `touchline_test_${randomUUID().replaceAll("-", "")}_accounts`;
        registry = root.forSchema(accountSchema);
        await registry.exec(`CREATE SCHEMA ${quoteIdentifier(accountSchema)};`);
        registryCreated = true;
        await registry.exec(accountsTableSql(accountSchema));
        const users = tableName(accountSchema, "users");
        for (const [id, objectId, schema] of [
          [legacyAccountId, LEGACY_OBJECT_ID, root.schemaName],
          [ownerAccountId, ownerObjectId, other.schemaName],
        ]) await registry.run(
          `INSERT INTO ${users} ([id], [tenant_id], [object_id], [display_name], [game_schema]) VALUES (?, ?, ?, ?, ?)`,
          id, tenantId, objectId, "Initial name", schema,
        );
        const accounts = new Accounts(root, accountSchema);
        await accounts.assertReady();
        const [first, second] = await Promise.all([accounts.resolve(identity()), accounts.resolve(identity(ownerObjectId))]);
        expect(first.store.schemaName).toBe(root.schemaName);
        expect(second.store.schemaName).toBe(other.schemaName);
        await Promise.all([first.store.setMeta("isolation", "first"), second.store.setMeta("isolation", "second")]);
        expect(await first.store.meta("isolation")).toBe("first");
        expect(await second.store.meta("isolation")).toBe("second");
        const saveId = randomUUID();
        await first.store.run(
          "INSERT INTO save_slots (id,name,created_at,automatic,format_version) VALUES (?,?,?,?,?)",
          saveId, "Private snapshot", new Date(), false, 1,
        );
        await first.store.run("INSERT INTO save_chunks (save_id,ordinal,data) VALUES (?,?,?)", saveId, 0, Buffer.from("first"));
        expect(await second.store.get("SELECT id FROM save_slots WHERE id = ?", saveId)).toBeUndefined();
        expect(await second.store.get("SELECT data FROM save_chunks WHERE save_id = ?", saveId)).toBeUndefined();
        await first.store.transaction(async () => first.store.clearWorld());
        expect(await second.store.meta("isolation")).toBe("second");
        expect(await first.store.get("SELECT id FROM save_slots WHERE id = ?", saveId)).toBeDefined();
        expect(await registry.all(`SELECT [id] FROM ${users}`)).toHaveLength(2);
        await expect(registry.schema()).rejects.toThrow(/account registry/);
        await expect(registry.run(
          `INSERT INTO ${users} ([id], [tenant_id], [object_id], [display_name], [game_schema]) VALUES (?,?,?,?,?)`,
          randomUUID(), tenantId, otherObjectId, "Collision", root.schemaName,
        )).rejects.toThrow();
        await expect(registry.run(
          `INSERT INTO ${users} ([id], [tenant_id], [object_id], [display_name], [game_schema]) VALUES (?,?,?,?,?)`,
          randomUUID(), tenantId, LEGACY_OBJECT_ID, "Collision", "touchline_test_unassigned",
        )).rejects.toThrow();
        await expect(accounts.resolve(identity(otherObjectId))).rejects.toBeInstanceOf(AccountNotProvisionedError);
        await first.store.close();
        await expect(second.store.meta("isolation")).resolves.toBe("second");
        expect((await registry.get<{ email: string }>(`SELECT [email] FROM ${users} WHERE [id] = ?`, legacyAccountId))?.email).toBe(LEGACY_EMAIL);
      } finally {
        try {
          if (registry && registryCreated) await registry.transaction(async () => {
            await registry!.exec(`DROP TABLE IF EXISTS ${tableName(registry!.schemaName, "users")};`);
            await registry!.exec(`DROP SCHEMA ${quoteIdentifier(registry!.schemaName)};`);
          });
        } finally {
          await registry?.close();
          await other?.close();
          await root.close();
        }
      }
    });
  });
}

// Operator provisioning needs dbo: only loopback opts into a disposable database; remote tests above stay schema-isolated.
if (process.env.SQL_INTEGRATION_TESTS === "true" &&
    ["127.0.0.1", "localhost", "::1"].includes(process.env.SQL_SERVER ?? "")) {
  describe("Account provisioning and runtime grants (local-only disposable SQL database)", () => {
    it("provisions immutable accounts without copying dbo and enforces runtime grants in a disposable local database", async () => {
      const configuredDatabase = process.env.SQL_DATABASE;
      const database = `touchline_test_accounts_${randomUUID().replaceAll("-", "")}`;
      const ownedDatabasePattern = /^touchline_test_accounts_[a-f0-9]{32}$/;
      if (!ownedDatabasePattern.test(database) || database === configuredDatabase ||
          !["127.0.0.1", "localhost", "::1"].includes(process.env.SQL_SERVER ?? "") ||
          process.env.SQL_PORT !== "14330" || process.env.SQL_USER !== "sa" || !process.env.SQL_PASSWORD)
        throw new Error("Provisioning regression requires test:local sa credentials on loopback:14330 and a fresh owned database.");
      for (const name of ["SQL_ALLOW_REMOTE_TESTS", "SQL_TEST_DATABASE", "TOUCHLINE_E2E_SCHEMA", "AZURE_CLIENT_ID", "CONTAINER_APP_NAME", "GAME_DB", "SAVE_DIR"])
        vi.stubEnv(name, undefined);
      for (const [name, value] of Object.entries({
        SQL_DATABASE: database, SQL_SCHEMA: "dbo", SQL_TEST_MODE: "false",
        AZURE_TENANT_ID: tenantId, OWNER_OBJECT_ID: ownerObjectId,
        ALLOWED_USER_OBJECT_IDS: `${LEGACY_OBJECT_ID},${otherObjectId}`,
      })) vi.stubEnv(name, value);
      const settings = readSqlSettings();
      const plan = accountProvisioningPlan({ tenantId, legacyObjectId: LEGACY_OBJECT_ID, legacyEmail: LEGACY_EMAIL });
      expect(plan.database).toBe(database);
      const { default: sql } = await import("mssql");
      const master = new sql.ConnectionPool(sqlPoolConfig({ ...settings, database: "master" }));
      let databaseCreated = false;
      let root: Store | undefined;
      try {
        await master.connect();
        await master.request().batch(`CREATE DATABASE ${quoteIdentifier(database)};`);
        databaseCreated = true;
        root = await Store.open(database);
        const store = root;
        expect({ database: store.database, schema: store.schemaName, testMode: store.testMode })
          .toEqual({ database, schema: "dbo", testMode: false });
        expect(await store.get("SELECT DB_NAME() AS [database]")).toEqual({ database });
        await store.schema();
        const career = { careerId: randomUUID(), date: "2026-07-20", director: { name: "Fictional legacy director" } };
        await store.setMeta("state", career);
        const saveId = randomUUID();
        const saveChunks = [Buffer.from([0, 1, 127, 128, 255]), Buffer.from("unchanged legacy checkpoint")];
        const saveBytes = Buffer.concat(saveChunks);
        const saveHash = createHash("sha256").update(saveBytes).digest("hex");
        await store.run(
          `INSERT INTO save_slots
            ([id], [name], [career_id], [career_metadata], [created_at], [automatic], [imported],
             [format_version], [byte_length], [sha256], [complete]) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          saveId, "Legacy checkpoint sentinel", career.careerId, JSON.stringify(career),
          new Date("2026-07-20T12:00:00.000Z"), false, true, 1, saveBytes.length, saveHash, true,
        );
        for (const [ordinal, chunk] of saveChunks.entries())
          await store.run("INSERT INTO save_chunks ([save_id], [ordinal], [data]) VALUES (?,?,?)", saveId, ordinal, chunk);
        const readWorld = async (world: Store) => ({
          meta: await world.all("SELECT * FROM meta ORDER BY [key]"),
          news: await world.all("SELECT * FROM news ORDER BY [id]"),
          migrations: await world.all("SELECT * FROM schema_migrations ORDER BY [version]"),
          saves: await world.all("SELECT * FROM save_slots ORDER BY [id]"),
          chunks: await world.all<{ save_id: string; ordinal: number; data: Buffer }>(
            "SELECT * FROM save_chunks ORDER BY [save_id], [ordinal]",
          ),
        });
        const legacyBefore = await readWorld(store);
        expect(legacyBefore.saves).toHaveLength(1);
        expect(legacyBefore.saves[0]).toMatchObject({ complete: true, sha256: saveHash });
        const assertLegacyUnchanged = async () => {
          const current = await readWorld(store);
          expect(current).toEqual(legacyBefore);
          const bytes = Buffer.concat(current.chunks.map((chunk) => chunk.data));
          expect(bytes).toEqual(saveBytes);
          expect(createHash("sha256").update(bytes).digest("hex")).toBe(saveHash);
        };
        const assertEmptyWorld = async (world: Store) => {
          expect(await world.all("SELECT [key], [value] FROM meta ORDER BY [key]"))
            .toEqual([{ key: "appearanceIndexVersion", value: "1" }]);
          const emptyTables = [...WORLD_TABLES.filter((table) => table !== "meta"), "save_slots", "save_chunks"];
          const counts = await world.all(emptyTables.map((table) =>
            `SELECT ${sqlLiteral(table)} AS [table_name], COUNT(*) AS [rows] FROM ${tableName(world.schemaName, table)}`,
          ).join(" UNION ALL "));
          expect(counts).toHaveLength(emptyTables.length);
          expect(counts).toEqual(expect.arrayContaining(emptyTables.map((table) => ({ table_name: table, rows: 0 }))));
          expect(await world.all("SELECT [version], [name] FROM schema_migrations ORDER BY [version]"))
            .toEqual(schemaMigrations(world.schemaName).map(({ version, name }) => ({ version, name })));
        };
        const tableInventory = () => store.all<{ schema_name: string; name: string; object_id: number }>(
          `SELECT SCHEMA_NAME([schema_id]) AS [schema_name], [name], [object_id]
           FROM sys.tables WHERE [is_ms_shipped] = 0 ORDER BY [schema_name], [name]`,
        );
        expect(await store.get("SELECT SCHEMA_ID(N'accounts') AS [schema_id]")).toEqual({ schema_id: null });
        const provisioned = await provisionAccounts(store, plan);
        expect(provisioned.map((account) => account.objectId)).toEqual([LEGACY_OBJECT_ID, ownerObjectId, otherObjectId]);
        expect(provisioned.every((account) => account.created)).toBe(true);
        expect(new Set(provisioned.map((account) => account.id)).size).toBe(3);
        expect(new Set(provisioned.map((account) => account.schema)).size).toBe(3);
        const [legacy, owner, guest] = provisioned;
        expect(legacy.schema).toBe("dbo");
        for (const account of [owner, guest])
          expect(account.schema).toBe(`touchline_user_${account.id.replaceAll("-", "")}`);
        const worlds = [store.forSchema(owner.schema), store.forSchema(guest.schema)];
        for (const world of worlds) await assertEmptyWorld(world);
        await assertLegacyUnchanged();
        const tablesBeforeRerun = await tableInventory();
        expect(tablesBeforeRerun).toHaveLength(STORE_TABLES.size * 3 + 2);
        expect(tablesBeforeRerun.filter((table) => table.schema_name === "accounts").map((table) => table.name))
          .toEqual(["invite_attempts", "invite_requests", "users"]);
        for (const { schema } of provisioned) {
          expect(tablesBeforeRerun.filter((table) => table.schema_name === schema).map((table) => table.name).sort())
            .toEqual([...STORE_TABLES].sort());
          expect(await store.get("SELECT OBJECT_ID(?, N'P') AS [helper_id]", tableName(schema, "reseed_world_identity")))
            .toEqual({ helper_id: expect.any(Number) });
        }
        const readRegistry = () => store.all<AccountRecord>("SELECT * FROM [accounts].[users] ORDER BY [object_id]");
        const registryBeforeRerun = await readRegistry();
        expect(registryBeforeRerun).toHaveLength(3);
        expect(await provisionAccounts(store, plan)).toEqual(provisioned.map((account) => ({ ...account, created: false })));
        expect(await readRegistry()).toEqual(registryBeforeRerun);
        expect(await tableInventory()).toEqual(tablesBeforeRerun);
        for (const world of worlds) await assertEmptyWorld(world);
        await assertLegacyUnchanged();

        const accounts = new Accounts(store);
        await accounts.assertReady();
        const claims = [
          { ...identity(), displayName: "Legacy guest human" },
          { ...identity(ownerObjectId), displayName: "Platform owner human", email: "owner@example.test" },
          { ...identity(otherObjectId), displayName: "Invited guest human", email: "guest@example.test" },
        ];
        const resolved = await Promise.all(claims.map((claim) => accounts.resolve(claim)));
        for (const [index, account] of resolved.entries()) {
          expect(account.user).toEqual({ id: provisioned[index].id, displayName: claims[index].displayName, email: claims[index].email });
          expect(account.store.schemaName).toBe(provisioned[index].schema);
          expect(account.user.displayName).not.toBe(career.director.name);
        }
        const userWorlds = resolved.slice(1).map((account) => account.store);
        for (const world of userWorlds) await assertEmptyWorld(world);
        await expect(accounts.resolve({ ...identity(), objectId: randomUUID() })).rejects.toBeInstanceOf(AccountNotProvisionedError);
        await assertLegacyUnchanged();

        const principal = "touchline_accounts_runtime";
        await store.exec(`CREATE USER ${quoteIdentifier(principal)} WITHOUT LOGIN;`);
        await store.exec(accountProceduresSql("accounts", principal, ownerObjectId));
        const registeredSchemas = await registeredAccountSchemas(store);
        expect(registeredSchemas).toEqual(provisioned.map((account) => account.schema).sort());
        for (const grant of runtimeGrants(principal, registeredSchemas, "accounts")) await store.exec(grant);
        expect(await store.get(
          "SELECT [type_desc], [authentication_type_desc] FROM sys.database_principals WHERE [name] = ?", principal,
        )).toEqual({ type_desc: "SQL_USER", authentication_type_desc: "NONE" });
        expect(await store.all("SELECT [role_principal_id] FROM sys.database_role_members WHERE [member_principal_id] = USER_ID(?)", principal))
          .toEqual([]);
        expect(await store.all("SELECT [name] FROM sys.schemas WHERE [principal_id] = USER_ID(?)", principal)).toEqual([]);
        const queryAsRuntime = <Result>(statement: string) => store.all<Result>(`
          EXECUTE AS USER = ${sqlLiteral(principal)};
          BEGIN TRY
            ${statement}
            REVERT;
          END TRY
          BEGIN CATCH
            REVERT;
            THROW;
          END CATCH;`);
        expect(await queryAsRuntime(`
          DECLARE @registry nvarchar(260) = N'accounts.users';
          SELECT USER_NAME() AS [principal],
            HAS_PERMS_BY_NAME(@registry, N'OBJECT', N'SELECT') AS [registry_read],
            HAS_PERMS_BY_NAME(@registry, N'OBJECT', N'VIEW DEFINITION') AS [registry_definition],
            HAS_PERMS_BY_NAME(@registry, N'OBJECT', N'UPDATE', N'display_name', N'COLUMN') AS [profile_name],
            HAS_PERMS_BY_NAME(@registry, N'OBJECT', N'UPDATE', N'email', N'COLUMN') AS [profile_email],
            HAS_PERMS_BY_NAME(@registry, N'OBJECT', N'UPDATE', N'updated_at', N'COLUMN') AS [profile_timestamp],
            HAS_PERMS_BY_NAME(@registry, N'OBJECT', N'UPDATE', N'id', N'COLUMN') AS [change_id],
            HAS_PERMS_BY_NAME(@registry, N'OBJECT', N'UPDATE', N'tenant_id', N'COLUMN') AS [change_tenant],
            HAS_PERMS_BY_NAME(@registry, N'OBJECT', N'UPDATE', N'object_id', N'COLUMN') AS [change_object],
            HAS_PERMS_BY_NAME(@registry, N'OBJECT', N'UPDATE', N'game_schema', N'COLUMN') AS [change_schema],
            HAS_PERMS_BY_NAME(@registry, N'OBJECT', N'UPDATE', N'created_at', N'COLUMN') AS [change_created],
            HAS_PERMS_BY_NAME(@registry, N'OBJECT', N'INSERT') AS [registry_insert],
            HAS_PERMS_BY_NAME(@registry, N'OBJECT', N'DELETE') AS [registry_delete],
            HAS_PERMS_BY_NAME(@registry, N'OBJECT', N'ALTER') AS [registry_alter],
            HAS_PERMS_BY_NAME(N'accounts', N'SCHEMA', N'ALTER') AS [registry_schema_alter],
            HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'CONTROL') AS [database_control],
            HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'CREATE SCHEMA') AS [create_schema],
            HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'CREATE TABLE') AS [create_table],
            HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'CREATE PROCEDURE') AS [create_procedure],
            HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'ALTER ANY SCHEMA') AS [alter_schemas],
            HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'ALTER ANY USER') AS [alter_users],
            HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'ALTER ANY ROLE') AS [alter_roles],
            IS_ROLEMEMBER(N'db_owner') AS [db_owner], IS_ROLEMEMBER(N'db_ddladmin') AS [db_ddladmin];
        `)).toEqual([{
          principal, registry_read: 1, registry_definition: 1, profile_name: 1, profile_email: 1, profile_timestamp: 1,
          change_id: 0, change_tenant: 0, change_object: 0, change_schema: 0, change_created: 0,
          registry_insert: 0, registry_delete: 0, registry_alter: 0, registry_schema_alter: 0,
          database_control: 0, create_schema: 0, create_table: 0, create_procedure: 0,
          alter_schemas: 0, alter_users: 0, alter_roles: 0, db_owner: 0, db_ddladmin: 0,
        }]);
        for (const schema of registeredSchemas) {
          expect(await queryAsRuntime(`SELECT
            HAS_PERMS_BY_NAME(${sqlLiteral(schema)}, N'SCHEMA', N'SELECT') AS [world_read],
            HAS_PERMS_BY_NAME(${sqlLiteral(schema)}, N'SCHEMA', N'INSERT') AS [world_insert],
            HAS_PERMS_BY_NAME(${sqlLiteral(schema)}, N'SCHEMA', N'UPDATE') AS [world_update],
            HAS_PERMS_BY_NAME(${sqlLiteral(schema)}, N'SCHEMA', N'DELETE') AS [world_delete],
            HAS_PERMS_BY_NAME(${sqlLiteral(schema)}, N'SCHEMA', N'ALTER') AS [world_alter],
            HAS_PERMS_BY_NAME(${sqlLiteral(`${schema}.players`)}, N'OBJECT', N'ALTER') AS [restore_alter],
            HAS_PERMS_BY_NAME(${sqlLiteral(`${schema}.reseed_world_identity`)}, N'OBJECT', N'EXECUTE') AS [reseed],
            HAS_PERMS_BY_NAME(${sqlLiteral(`${schema}.reseed_world_identity`)}, N'OBJECT', N'ALTER') AS [helper_alter],
            HAS_PERMS_BY_NAME(${sqlLiteral(`${schema}.save_slots`)}, N'OBJECT', N'ALTER') AS [catalog_alter],
            HAS_PERMS_BY_NAME(${sqlLiteral(`${schema}.save_chunks`)}, N'OBJECT', N'ALTER') AS [chunks_alter];
          `)).toEqual([{
            world_read: 1, world_insert: 1, world_update: 1, world_delete: 1, world_alter: 0,
            restore_alter: 1, reseed: 1, helper_alter: 0, catalog_alter: 0, chunks_alter: 0,
          }]);
          await queryAsRuntime(`EXEC ${tableName(schema, "reseed_world_identity")} @table = N'news';`);
        }
        const refreshedClaim = { ...claims[1], displayName: "Runtime refreshed owner", email: "refreshed.owner@example.test" };
        expect(await queryAsRuntime(`
          UPDATE [accounts].[users] SET [display_name] = ${sqlLiteral(refreshedClaim.displayName)},
            [email] = ${sqlLiteral(refreshedClaim.email)}, [updated_at] = SYSUTCDATETIME()
          WHERE [id] = CONVERT(uniqueidentifier, ${sqlLiteral(owner.id)});
          SELECT [display_name], [email] FROM [accounts].[users]
          WHERE [id] = CONVERT(uniqueidentifier, ${sqlLiteral(owner.id)});
        `)).toEqual([{ display_name: refreshedClaim.displayName, email: refreshedClaim.email }]);
        expect((await accounts.resolve(refreshedClaim)).user)
          .toEqual({ id: owner.id, displayName: refreshedClaim.displayName, email: refreshedClaim.email });
        const registryAfterProfiles = await readRegistry();
        expect(registryAfterProfiles.map(({ id, tenant_id, object_id, game_schema }) => ({ id, tenant_id, object_id, game_schema })))
          .toEqual(registryBeforeRerun.map(({ id, tenant_id, object_id, game_schema }) => ({ id, tenant_id, object_id, game_schema })));

        const inRuntimeWorld = (world: Store, action: () => Promise<void>) => world.transaction(async () => {
          await world.exec(`EXECUTE AS USER = ${sqlLiteral(principal)};`);
          try {
            expect(await world.get("SELECT USER_NAME() AS [principal]")).toEqual({ principal });
            await action();
          } finally {
            await world.exec("REVERT;");
          }
        });
        const insertNews = (world: Store, title: string) => world.run(
          "INSERT INTO news ([date], [category], [title], [body], [severity]) VALUES (?,?,?,?,?)",
          career.date, "Account regression", title, "Isolated world sentinel", "info",
        );
        for (const world of userWorlds) await inRuntimeWorld(world, async () => {
          await world.setMeta("state", { account: world.schemaName, reset: false });
          expect((await insertNews(world, "First")).lastInsertRowid).toBe(1);
          expect((await insertNews(world, "Second")).lastInsertRowid).toBe(2);
          const bytes = Buffer.from(world.schemaName);
          await world.run(
            `INSERT INTO save_slots
              ([id], [name], [career_id], [career_metadata], [created_at], [automatic], [imported],
               [format_version], [byte_length], [sha256], [complete]) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            saveId, world.schemaName, world.schemaName, JSON.stringify({ account: world.schemaName }),
            new Date("2026-07-20T12:00:00.000Z"), false, false, 1, bytes.length,
            createHash("sha256").update(bytes).digest("hex"), true,
          );
          await world.run("INSERT INTO save_chunks ([save_id], [ordinal], [data]) VALUES (?,?,?)", saveId, 0, bytes);
        });
        for (const [index, world] of userWorlds.entries()) {
          const before = await readWorld(world);
          const peer = userWorlds[1 - index];
          const peerBefore = await readWorld(peer);
          await inRuntimeWorld(world, async () => {
            await world.clearWorld();
            expect(await world.all("SELECT * FROM meta")).toEqual([]);
            expect(await world.all("SELECT * FROM news")).toEqual([]);
            await world.setMeta("state", { account: world.schemaName, reset: true });
            expect((await insertNews(world, "After reset")).lastInsertRowid).toBe(1);
            expect(await world.get("SELECT USER_NAME() AS [principal]")).toEqual({ principal });
          });
          expect(await world.meta("state")).toEqual({ account: world.schemaName, reset: true });
          const after = await readWorld(world);
          expect(after.saves).toEqual(before.saves);
          expect(after.chunks).toEqual(before.chunks);
          expect(after.migrations).toEqual(before.migrations);
          expect(await readWorld(peer)).toEqual(peerBefore);
          expect(await readRegistry()).toEqual(registryAfterProfiles);
          await assertLegacyUnchanged();
        }
        for (const [index, world] of userWorlds.entries()) {
          const peer = userWorlds[1 - index];
          const peerBefore = await readWorld(peer);
          const keptId = randomUUID();
          const keptBytes = Buffer.from(`kept ${world.schemaName}`);
          await world.run(
            `INSERT INTO save_slots
              ([id], [name], [career_id], [career_metadata], [created_at], [automatic], [imported],
               [format_version], [byte_length], [sha256], [complete]) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            keptId, "Other career", "other-career", JSON.stringify({ account: world.schemaName }),
            new Date("2026-07-21T12:00:00.000Z"), false, false, 1, keptBytes.length,
            createHash("sha256").update(keptBytes).digest("hex"), true,
          );
          await world.run("INSERT INTO save_chunks ([save_id], [ordinal], [data]) VALUES (?,?,?)", keptId, 0, keptBytes);
          await world.setMeta("appearanceIndexVersion", 1);
          await world.setMeta("state", { careerId: world.schemaName, seed: `runtime-delete-${index}` });
          const discard = vi.spyOn(world, "discardWorld");
          await inRuntimeWorld(world, async () => {
            expect(await new Saves(world).deleteActiveCareer({ careerId: world.schemaName, seed: `runtime-delete-${index}` }))
              .toMatchObject({ deleted: true, careerId: world.schemaName, snapshots: 1 });
            expect((await insertNews(world, "After deletion")).lastInsertRowid).toBe(1);
          });
          const { truncated, deleted } = await discard.mock.results[0].value;
          expect([...deleted].sort()).toEqual(
            ["clubs", "countries", "fixtures", "leagues", "loans", "negotiations", "players", "sell_on_clauses", "staff"],
          );
          expect(truncated).toEqual(expect.arrayContaining(["meta", "news", "player_match_appearances"]));
          expect(truncated.length + deleted.length).toBe(WORLD_TABLES.length);
          expect(await world.all("SELECT [key], [value] FROM meta")).toEqual([{ key: "appearanceIndexVersion", value: "1" }]);
          expect((await world.all<{ id: string }>("SELECT [id] FROM save_slots")).map((slot) => slot.id.toLowerCase()))
            .toEqual([keptId]);
          expect(await world.all("SELECT [data] FROM save_chunks")).toEqual([{ data: keptBytes }]);
          expect(await readWorld(peer)).toEqual(peerBefore);
          await assertLegacyUnchanged();
        }
        expect(await tableInventory()).toEqual(tablesBeforeRerun);
      } finally {
        try {
          await root?.close();
        } finally {
          try {
            if (databaseCreated) {
              if (!ownedDatabasePattern.test(database) || database === configuredDatabase)
                throw new Error("Refusing to clean up a database not owned by this regression.");
              await master.request().batch(`ALTER DATABASE ${quoteIdentifier(database)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
                DROP DATABASE ${quoteIdentifier(database)};`);
            }
          } finally {
            await master.close();
          }
        }
      }
    });
  });
}