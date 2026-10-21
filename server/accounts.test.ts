import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_REGISTRY_LOCK, AccessDeniedError, AccessPendingError, AccessRequestConflictError, AccessRequestNotFoundError,
  Accounts, accountWorldSchema, ensureAccountRegistry, registeredAccountSchemas, validateAccountSchema,
  validateAccountWorldSchema, type AccountRecord,
} from "./accounts.ts";
import type { AuthenticatedIdentity } from "./auth.ts";
import { bindSql, sqlPoolConfig, Store } from "./db.ts";
import { Saves } from "./saves.ts";
import { readSqlSettings } from "./sql-config.ts";
import {
  accessRequestsTableSql, quoteIdentifier, schemaMigrations, STORE_TABLES, tableName, usersTableSql, WORLD_TABLES,
} from "./sql-schema.ts";
import { applyRegistry, main as migrateAccounts, registryPlan } from "../scripts/accounts-migrate.ts";
import { careerDeleteOptions, main as deleteCareerMain, maskEmail, maskIdentifier, maskSchema, selectAccount } from "../scripts/career-delete.ts";

// Lets a test pin the next account UUIDs (and so the world schema names) that provisioning allocates.
const forced = vi.hoisted(() => ({ uuids: [] as string[] }));
vi.mock("node:crypto", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:crypto")>();
  return { ...original, randomUUID: () => (forced.uuids.shift() ?? original.randomUUID()) as ReturnType<typeof original.randomUUID> };
});

const issuer = "https://auth.example.test";
const ownerAccountId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherAccountId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ownerSchema = `touchline_user_${ownerAccountId.replaceAll("-", "")}`;
const otherSchema = `touchline_user_${otherAccountId.replaceAll("-", "")}`;
const registryIndexes = [
  { table_name: "users", is_primary_key: true, columns: "id" },
  { table_name: "users", is_primary_key: false, columns: "issuer,subject" },
  { table_name: "users", is_primary_key: false, columns: "game_schema" },
  { table_name: "access_requests", is_primary_key: true, columns: "id" },
  { table_name: "access_requests", is_primary_key: false, columns: "issuer,subject" },
];
const TSQL = /\[[a-z_]+\]|N'|\bTOP\s*\(|CONVERT\(|ISNULL\(|SYSUTCDATETIME|COUNT_BIG|\bsys\.|\bEXEC\b|OBJECT_ID\(|SCHEMA_ID\(/;

afterEach(() => {
  forced.uuids.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function identity(subject: string, overrides: Partial<AuthenticatedIdentity> = {}): AuthenticatedIdentity {
  return {
    issuer, subject, username: `user-${subject}`, displayName: `Person ${subject}`,
    email: `${subject}@example.test`, groups: [], admin: false, ...overrides,
  };
}

function record(id: string, subject: string, schema: string): AccountRecord {
  return { id, issuer, subject, username: `user-${subject}`, display_name: `Person ${subject}`, email: `${subject}@example.test`, game_schema: schema };
}

function accountHarness() {
  const records = [record(ownerAccountId, "owner", ownerSchema), record(otherAccountId, "other", otherSchema)];
  const registry = {
    schemaName: "accounts",
    testMode: false,
    all: vi.fn(async (sql: string): Promise<unknown[]> => {
      if (sql.includes("FROM pg_catalog.pg_tables")) return [{ name: "users" }, { name: "access_requests" }];
      if (sql.includes("FROM pg_catalog.pg_index")) return registryIndexes;
      if (sql.includes("SELECT game_schema FROM")) return records.map((account) => ({ game_schema: account.game_schema }));
      return [];
    }),
    get: vi.fn(async (sql: string, ...parameters: unknown[]): Promise<unknown> => {
      if (sql.includes('FROM "accounts"."users" WHERE issuer = ? AND subject = ?')) {
        const found = records.find((account) => account.issuer === parameters[0] && account.subject === parameters[1]);
        return found ? { ...found } : undefined;
      }
      if (sql.includes("WITH upsert AS")) return { status: "pending" };
      return undefined;
    }),
    run: vi.fn(async (_sql: string, ...parameters: unknown[]) => {
      const found = records.find((account) => account.id === parameters[3]);
      if (found) Object.assign(found, { username: parameters[0], display_name: parameters[1], email: parameters[2] });
      return { changes: found ? 1 : 0, lastInsertRowid: null };
    }),
    transaction: vi.fn(async (callback: () => Promise<unknown>) => callback()),
    advisoryLock: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const root = {
    schemaName: "public", testMode: false,
    get: vi.fn(async () => ({ present: true })),
    forSchema: vi.fn((schema: string) => schema === "accounts" ? registry : { schemaName: schema }),
  };
  return { root: root as unknown as Store, registry, records };
}

function issuedSql(registry: ReturnType<typeof accountHarness>["registry"]): string {
  return [registry.all, registry.get, registry.run].flatMap((mock) => mock.mock.calls.map(([sql]) => sql)).join("\n");
}

describe("Account registry and resolution (no database)", () => {
  it("checks the separate registry read-only, by table set, columns and uniqueness constraints", async () => {
    const harness = accountHarness();
    await new Accounts(harness.root).assertReady();
    expect(harness.root.forSchema).toHaveBeenCalledExactlyOnceWith("accounts");
    expect(harness.registry.run).not.toHaveBeenCalled();
    for (const [sql] of harness.registry.all.mock.calls) expect(sql.trim()).toMatch(/^SELECT /);
    const sql = issuedSql(harness.registry);
    expect(sql).toContain('FROM "accounts"."users" LIMIT 0');
    expect(sql).toContain('FROM "accounts"."access_requests" LIMIT 0');
    expect(harness.registry.all.mock.calls.find(([query]) => query.includes("pg_catalog.pg_index"))?.slice(1))
      .toEqual(['"accounts"."users"', '"accounts"."access_requests"']);
    expect(sql).not.toMatch(TSQL);
    expect(sql).not.toMatch(/invite|tenant_id|object_id/);
  });

  it("fails readiness for absent tables, world contamination or missing uniqueness constraints", async () => {
    const harness = accountHarness();
    const accounts = new Accounts(harness.root);
    const tables = (names: string[], indexes = registryIndexes) => harness.registry.all.mockImplementation(async (sql: string) =>
      sql.includes("FROM pg_catalog.pg_tables") ? names.map((name) => ({ name })) :
        sql.includes("FROM pg_catalog.pg_index") ? indexes : []);
    tables(["users"]);
    await expect(accounts.assertReady()).rejects.toThrow(/only users and access_requests/);
    tables(["users", "access_requests", "save_slots"]);
    await expect(accounts.assertReady()).rejects.toThrow(/never world or save tables/);
    tables(["users", "invite_requests", "invite_attempts"]);
    await expect(accounts.assertReady()).rejects.toThrow(/only users and access_requests/);
    for (const missing of registryIndexes) {
      tables(["users", "access_requests"], registryIndexes.filter((index) => index !== missing));
      await expect(accounts.assertReady(), JSON.stringify(missing)).rejects.toThrow(/uniqueness constraints/);
    }
    tables(["users", "access_requests"]);
    harness.registry.all.mockRejectedValueOnce(new Error('relation "accounts.users" does not exist'));
    await expect(accounts.assertReady()).rejects.toThrow(/does not exist/);
  });

  it("resolves a registered identity, refreshing a changed profile without touching its keys or world", async () => {
    const harness = accountHarness();
    const accounts = new Accounts(harness.root);
    const unchanged = await accounts.resolve(identity("owner"));
    expect(unchanged.user).toEqual({ id: ownerAccountId, username: "user-owner", displayName: "Person owner", email: "owner@example.test", admin: false });
    expect(unchanged.store.schemaName).toBe(ownerSchema);
    expect(harness.registry.run).not.toHaveBeenCalled();
    const renamed = await accounts.resolve(identity("owner", {
      username: "owner2", displayName: "  Renamed  ", email: "Owner.New@Example.TEST", admin: true,
    }));
    expect(renamed.user).toEqual({ id: ownerAccountId, username: "owner2", displayName: "Renamed", email: "owner.new@example.test", admin: true });
    expect(renamed.store).toBe(unchanged.store);
    expect(harness.registry.run).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("SET username = ?, display_name = ?, email = ?, updated_at = now()"),
      "owner2", "Renamed", "owner.new@example.test", ownerAccountId, issuer, "owner", ownerSchema,
    );
    expect(harness.registry.run.mock.calls.every(([sql]) => !/SET\s+(id|issuer|subject|game_schema)\s*=/i.test(sql))).toBe(true);
    expect(harness.registry.get.mock.calls.every(([sql]) => !String(sql).includes("access_requests"))).toBe(true);
  });

  it("keys accounts by issuer and subject: the same subject from another issuer is someone else", async () => {
    const harness = accountHarness();
    await expect(new Accounts(harness.root).resolve(identity("owner", { issuer: "https://other.example.test" })))
      .rejects.toBeInstanceOf(AccessPendingError);
  });

  it("reuses one scoped Store for simultaneous requests from the same account", async () => {
    const harness = accountHarness();
    const accounts = new Accounts(harness.root);
    const resolved = await Promise.all(Array.from({ length: 3 }, () => accounts.resolve(identity("owner"))));
    expect(new Set(resolved.map((account) => account.store)).size).toBe(1);
    expect(vi.mocked(harness.root.forSchema).mock.calls.filter(([schema]) => schema === ownerSchema)).toHaveLength(1);
    harness.records[0].game_schema = "touchline_user_reassigned";
    await expect(accounts.resolve(identity("owner"))).rejects.toThrow(/reassignment/);
  });

  it.each(["accounts", "public", "bad]name", "touchline_test_live", "pg_toast", "a".repeat(64)])(
    "refuses unsafe world mapping %s", async (schema) => {
      const harness = accountHarness();
      harness.records[0].game_schema = schema;
      await expect(new Accounts(harness.root).resolve(identity("owner"))).rejects.toThrow(/schema/i);
      expect(harness.registry.run).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid profiles and registry/world overlap before issuing SQL", async () => {
    const harness = accountHarness();
    const accounts = new Accounts(harness.root);
    for (const invalid of [
      { issuer: "" }, { subject: "" }, { subject: "s".repeat(256) }, { username: " " }, { displayName: " " },
      { displayName: "d".repeat(201) }, { email: "a".repeat(321) }, { email: " " },
    ])
      await expect(accounts.resolve(identity("owner", invalid)), JSON.stringify(invalid)).rejects.toThrow(/profile/);
    for (const schema of ["public", "information_schema", "touchline_user_existing", "pg_catalog"])
      expect(() => new Accounts(harness.root, schema)).toThrow();
    expect(() => new Accounts(harness.root, "public")).toThrow(/separate/);
    expect(harness.registry.get).not.toHaveBeenCalled();
    for (const limits of [{ maxPlayers: -1 }, { maxPlayers: 1.5 }, { maxPlayers: Number.NaN }, { sizeLimitGb: 0 }])
      expect(() => new Accounts(harness.root, "accounts", { limits }), JSON.stringify(limits)).toThrow(/capacity limits/);
  });

  it("reads MAX_PLAYERS and DB_SIZE_LIMIT_GB, never the removed invite limit", async () => {
    vi.stubEnv("MAX_PLAYERS", "x");
    expect(() => new Accounts(accountHarness().root)).toThrow(/MAX_PLAYERS/);
    vi.stubEnv("MAX_PLAYERS", "3");
    vi.stubEnv("INVITE_DB_SIZE_LIMIT_GB", "nonsense");
    vi.stubEnv("DB_SIZE_LIMIT_GB", "-1");
    expect(() => new Accounts(accountHarness().root)).toThrow(/DB_SIZE_LIMIT_GB/);
    vi.stubEnv("DB_SIZE_LIMIT_GB", "2");
    expect(() => new Accounts(accountHarness().root)).not.toThrow();
  });

  it("exposes access errors with their HTTP status and API code", () => {
    expect(new AccessPendingError()).toMatchObject({ status: 403, code: "access_pending" });
    expect(new AccessDeniedError()).toMatchObject({ status: 403, code: "access_denied" });
    expect(new AccessRequestNotFoundError()).toMatchObject({ status: 404 });
    expect(new AccessRequestConflictError("no")).toMatchObject({ status: 409, message: "no" });
    expect(ACCOUNT_REGISTRY_LOCK).toBe("touchline:account-registry");
  });

  it("enumerates only existing registered worlds, allows none, and refuses missing or duplicate mappings", async () => {
    const harness = accountHarness();
    await expect(registeredAccountSchemas(harness.root)).resolves.toEqual([ownerSchema, otherSchema]);
    expect(harness.registry.close).toHaveBeenCalledOnce();
    expect(vi.mocked(harness.root.get).mock.calls).toEqual([
      ["SELECT to_regclass(?) IS NOT NULL AS present", `"${ownerSchema}"."schema_migrations"`],
      ["SELECT to_regclass(?) IS NOT NULL AS present", `"${otherSchema}"."schema_migrations"`],
    ]);
    vi.mocked(harness.root.get).mockResolvedValueOnce({ present: false });
    await expect(registeredAccountSchemas(harness.root)).rejects.toThrow(/refusing to recreate/);
    harness.records[1].game_schema = ownerSchema.toUpperCase();
    await expect(registeredAccountSchemas(harness.root)).rejects.toThrow(/collision/);
    harness.records.length = 0;
    await expect(registeredAccountSchemas(harness.root)).resolves.toEqual([]);
  });

  it("derives per-account world schemas from the account UUID and validates schema roles", () => {
    expect(accountWorldSchema(ownerAccountId.toUpperCase())).toBe(ownerSchema);
    expect(() => accountWorldSchema("not-a-uuid")).toThrow(/UUID/);
    expect(validateAccountSchema("accounts")).toBe("accounts");
    expect(() => validateAccountSchema("touchline_test_x")).toThrow(/separate/);
    expect(validateAccountSchema("touchline_test_x_accounts", true)).toBe("touchline_test_x_accounts");
    expect(validateAccountWorldSchema(ownerSchema, "accounts")).toBe(ownerSchema);
    expect(validateAccountWorldSchema("dbo", "accounts")).toBe("dbo");
    for (const schema of ["accounts", "registry", "public"])
      expect(() => validateAccountWorldSchema(schema, "registry")).toThrow(/Invalid account world/);
  });

  it("keeps registry tables completely outside world migrations and snapshot table allowlists", () => {
    const users = usersTableSql("accounts");
    expect(users).toContain('CREATE TABLE IF NOT EXISTS "accounts"."users"');
    expect(users).toContain("id UUID NOT NULL PRIMARY KEY");
    expect(users).toContain("CONSTRAINT users_identity_key UNIQUE (issuer, subject)");
    expect(users).toContain("CONSTRAINT users_game_schema_key UNIQUE (game_schema)");
    expect(users).toContain("email = lower(email)");
    expect(users).toContain("game_schema <> 'accounts'");
    const requests = accessRequestsTableSql("accounts");
    expect(requests).toContain('CREATE TABLE IF NOT EXISTS "accounts"."access_requests"');
    expect(requests).toContain("CHECK (status IN ('pending', 'approved', 'denied'))");
    expect(requests).toContain("CONSTRAINT access_requests_identity_key UNIQUE (issuer, subject)");
    expect(requests).toContain('REFERENCES "accounts"."users" (id)');
    for (const sql of [users, requests]) {
      expect(sql).not.toMatch(/tenant|object_id|invite|ip_hash|note|email_sent/);
      expect(() => bindSql(sql, [])).not.toThrow();
    }
    for (const table of ["users", "access_requests"]) {
      expect(STORE_TABLES.has(table)).toBe(false);
      expect(WORLD_TABLES as readonly string[]).not.toContain(table);
    }
    expect(schemaMigrations("touchline_user_x").flatMap((migration) => migration.statements).join("\n")).not.toMatch(/"users"|access_requests/);
  });
});

describe("Account registry creation script (no database)", () => {
  const environment = { SQL_HOST: "127.0.0.1", SQL_DATABASE: "touchline", SQL_SCHEMA: "public", SQL_TEST_MODE: "false" };

  it("plans only the registry, and refuses test or world contexts", () => {
    expect(registryPlan({}, environment)).toEqual({ database: "touchline", accountSchema: "accounts" });
    expect(registryPlan({ database: "other", accountSchema: "registry" }, environment)).toEqual({ database: "other", accountSchema: "registry" });
    for (const override of [
      { SQL_TEST_MODE: "true", SQL_SCHEMA: "touchline_test_x" }, { SQL_ALLOW_REMOTE_TESTS: "true" },
      { SQL_TEST_DATABASE: "touchline" }, { TOUCHLINE_E2E_SCHEMA: "touchline_e2e_x" },
      { SQL_SCHEMA: "touchline_user_x" }, { SQL_SCHEMA: "accounts" },
    ])
      expect(() => registryPlan({}, { ...environment, ...override }), JSON.stringify(override)).toThrow(/operator context/);
    expect(() => registryPlan({ accountSchema: "public" }, environment)).toThrow(/separate/);
  });

  it("defaults to an offline plan and requires both mutation acknowledgements before opening SQL", async () => {
    for (const name of ["SQL_USER", "SQL_PASSWORD", "SQL_ALLOW_REMOTE_TESTS", "SQL_TEST_DATABASE", "TOUCHLINE_E2E_SCHEMA", "GAME_DB", "SAVE_DIR"])
      vi.stubEnv(name, undefined);
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
    const open = vi.spyOn(Store, "open").mockRejectedValue(new Error("SQL must not be opened"));
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    await migrateAccounts([]);
    expect(JSON.parse(String(output.mock.calls[0][0])))
      .toEqual({ dryRun: true, database: "touchline", accountSchema: "accounts", tables: ["access_requests", "users"], note: expect.any(String) });
    await migrateAccounts(["--help"]);
    expect(String(output.mock.calls[1][0])).not.toMatch(/tenant|legacy|Microsoft|invite/i);
    await expect(migrateAccounts(["--apply"])).rejects.toThrow(/--apply --yes/);
    await expect(migrateAccounts(["--apply", "--yes", "--dry-run"])).rejects.toThrow(/not both/);
    await expect(migrateAccounts(["--tenant-id", "x"])).rejects.toThrow(/tenant-id/);
    expect(open).not.toHaveBeenCalled();
  });
});

describe("Operator career deletion guards (no database)", () => {
  const activeState = {
    careerId: "career-to-delete", careerName: "Owner career", seed: "seed-to-delete", clubId: 7,
    date: "2026-07-20", season: 2026, started: true, director: { name: "Owner Director" },
  };
  const owner = { ...record(ownerAccountId, "owner-subject", ownerSchema), username: "owner", display_name: "Owner", email: "owner.person@example.test" };
  const guest = { ...record(otherAccountId, "guest-subject", otherSchema), username: "guest", display_name: "Guest", email: "guest.person@example.test" };
  function harness(options: { records?: AccountRecord[]; state?: object | null } = {}) {
    const records = options.records ?? [guest, owner];
    const state = options.state === undefined ? activeState : options.state;
    const registry = {
      schemaName: "accounts", testMode: false,
      all: vi.fn(async (sql: string): Promise<unknown[]> => {
        if (sql.includes("FROM pg_catalog.pg_tables")) return [{ name: "users" }, { name: "access_requests" }];
        if (sql.includes("FROM pg_catalog.pg_index")) return registryIndexes;
        if (sql.includes("LIMIT 0")) return [];
        if (sql.includes("game_schema")) return records.map((account) => ({ ...account }));
        return [];
      }),
    };
    const world = {
      readTransaction: vi.fn(async (callback: () => Promise<unknown>) => callback()),
      get: vi.fn(async (sql: string) => {
        if (sql.includes("'state'")) return state ? { value: JSON.stringify(state) } : undefined;
        if (sql.includes("'world'")) return { value: JSON.stringify({ expanded: true, version: 3 }) };
        if (sql.includes("FROM clubs")) return { name: "Owner FC" };
        if (sql.includes("count(*) AS total FROM players")) return { total: 833976 };
        if (sql.includes("pg_total_relation_size")) return { total_mb: 12.6, table_mb: 9.2 };
        return undefined;
      }),
      all: vi.fn(async () => [
        { career_id: "career-to-delete", slots: 3, complete: 3, bytes: 3145728 },
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
      [["--username", "owner", "--email", "owner.person@example.test"], /exactly one/],
      [["--account", ownerAccountId, "--username", "owner"], /exactly one/],
      [["--account", "not-a-uuid"], /UUID/],
      [["--email", "owner.person"], /--email/],
      [["--username", " "], /--username/],
      [["--oid", ownerAccountId], /Unknown option/],
      [["--username", "owner", "--apply"], /--apply --yes/],
      [["--username", "owner", "--yes", "--apply", "--dry-run"], /not both/],
      [["--username", "owner", "--account-schema", "public"], /separate/],
      [["--list", "--username", "owner"], /--list/],
      [["--list", "--apply", "--yes"], /--list/],
    ] as const)
      await expect(deleteCareerMain([...args], dependencies), args.join(" ")).rejects.toThrow(message);
    expect(dependencies.open).not.toHaveBeenCalled();
    expect(careerDeleteOptions(["--account", ownerAccountId.toUpperCase()])).toEqual({
      accountId: ownerAccountId, username: undefined, email: undefined, accountSchema: "accounts", apply: false, list: false,
    });
  });

  it("refuses unknown or ambiguous identifiers and registry schemas without opening a world", async () => {
    const unknown = harness();
    await expect(deleteCareerMain(["--username", "nobody"], unknown.dependencies)).rejects.toThrow(/No registered account has that username/);
    expect(JSON.parse(unknown.lines[0])).toEqual({ registry: { accounts: 2, withStoredEmail: 2 }, hint: expect.stringMatching(/--list/) });
    await expect(deleteCareerMain(["--email", "owner.person@example"], unknown.dependencies)).rejects.toThrow(/No registered account/);
    await expect(deleteCareerMain(["--account", randomUUID()], unknown.dependencies)).rejects.toThrow(/account ID/);
    const duplicate = harness({ records: [
      { ...owner, email: "same@example.test" }, { ...guest, email: "same@example.test" },
    ] });
    await expect(deleteCareerMain(["--email", "SAME@example.test", "--apply", "--yes"], duplicate.dependencies)).rejects.toThrow(/matches 2 accounts/);
    for (const { root, saves, lines } of [unknown, duplicate]) {
      expect(root.forSchema.mock.calls.every(([schema]) => schema === "accounts")).toBe(true);
      expect(saves.deleteActiveCareer).not.toHaveBeenCalled();
      for (const raw of [ownerAccountId, otherAccountId, ownerSchema, "owner.person", "owner-subject"])
        expect(lines.join("\n")).not.toContain(raw);
    }
    expect(() => selectAccount([{ ...owner, game_schema: "accounts" }], { username: "owner", accountSchema: "accounts", apply: false, list: false }))
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
        { accountId: "cccc***cccc", username: "g***t", schema: "touchline_user_cccc***cccc", email: "g***n@example.test" },
        { accountId: "bbbb***bbbb", username: "o***r", schema: "touchline_user_bbbb***bbbb", email: "o***n@example.test" },
      ],
    });
    for (const raw of [ownerAccountId, otherAccountId, ownerSchema, otherSchema, "owner-subject"])
      expect(listed.lines.join("\n")).not.toContain(raw);
  });

  it("prints a dry-run summary by default and deletes only with --apply --yes through Saves", async () => {
    const dryRun = harness();
    await deleteCareerMain(["--email", "OWNER.PERSON@example.test"], dryRun.dependencies);
    const summary = JSON.parse(dryRun.lines[0]);
    expect(summary).toMatchObject({
      dryRun: true, database: "touchline", schema: maskSchema(ownerSchema),
      account: { id: "bbbb***bbbb", username: "o***r", subject: maskIdentifier("owner-subject"), displayName: "O***r",
        email: "o***n@example.test", matchedBy: "email", identifiers: { username: true, storedEmail: true } },
      active: { careerId: "career-to-delete", club: "Owner FC", director: "Owner Director", date: "2026-07-20", seed: "seed-to-delete" },
      world: { expanded: true, version: 3, players: 833976 },
      snapshots: [
        { careerId: "career-to-delete", slots: 3, bytes: 3145728, deletedWithActiveCareer: true },
        { careerId: "kept-career", slots: 1, deletedWithActiveCareer: false },
      ],
      approximateSizeMB: { total: 13, tables: 9 },
    });
    expect(dryRun.world.readTransaction).toHaveBeenCalledOnce();
    expect(dryRun.world.get.mock.calls.map(([sql]) => sql).join("\n")).not.toMatch(/\[[a-z_]+\]|COUNT_BIG|HAS_PERMS_BY_NAME|sys\./);
    expect(dryRun.saves.deleteActiveCareer).not.toHaveBeenCalled();
    expect(dryRun.root.close).toHaveBeenCalledOnce();
    for (const raw of [ownerAccountId, ownerSchema, "owner-subject", "\"Owner\""])
      expect(dryRun.lines.join("\n")).not.toContain(raw);

    for (const args of [["--username", "owner"], ["--account", ownerAccountId.toUpperCase()]]) {
      const applied = harness();
      await deleteCareerMain([...args, "--apply", "--yes"], applied.dependencies);
      expect(applied.dependencies.saves).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ schemaName: ownerSchema }));
      expect(applied.saves.deleteActiveCareer).toHaveBeenCalledExactlyOnceWith({ careerId: "career-to-delete", seed: "seed-to-delete" });
      expect(JSON.parse(applied.lines.at(-1)!)).toMatchObject({
        applied: true, schema: maskSchema(ownerSchema), result: { deleted: true, snapshots: 3 }, after: { hasWorld: false, remainingSnapshots: 0 },
      });
      for (const raw of [ownerAccountId, ownerSchema, "owner-subject"])
        expect(applied.lines.join("\n")).not.toContain(raw);
      expect(applied.root.close).toHaveBeenCalledOnce();
    }
  });

  it("refuses to apply when the account has no active career", async () => {
    const empty = harness({ state: null });
    await expect(deleteCareerMain(["--username", "owner", "--apply", "--yes"], empty.dependencies)).rejects.toThrow(/no active career/);
    expect(empty.saves.deleteActiveCareer).not.toHaveBeenCalled();
    await deleteCareerMain(["--username", "owner"], empty.dependencies);
    expect(JSON.parse(empty.lines.at(-1)!)).toMatchObject({ dryRun: true, active: null, next: expect.stringMatching(/Nothing to delete/) });
    expect(maskEmail("ab@example.test")).toBe("a***@example.test");
    expect(maskEmail(null)).toBeNull();
  });
});

if (process.env.SQL_INTEGRATION_TESTS === "true") {
  describe("Account registry in test mode (explicit opt-in, real configured SQL)", () => {
    it("creates the registry idempotently, records requests and refuses colliding schemas", async () => {
      const root = await Store.createTest("account_registry");
      const accountSchema = `touchline_test_${randomUUID().replaceAll("-", "")}_accounts`;
      let other: Store | undefined;
      const registry = root.forSchema(accountSchema);
      try {
        other = await Store.createTest("other_world");
        await ensureAccountRegistry(root, accountSchema);
        await ensureAccountRegistry(root, accountSchema);
        await expect(ensureAccountRegistry(root, other.schemaName)).rejects.toThrow(/collides/);
        const accounts = new Accounts(root, accountSchema);
        await accounts.assertReady();
        await expect(registeredAccountSchemas(root, accountSchema)).resolves.toEqual([]);
        await expect(accounts.resolve(identity("guest"))).rejects.toBeInstanceOf(AccessPendingError);
        expect((await accounts.listAccess()).requests).toMatchObject([{ username: "user-guest", status: "pending" }]);
        await expect(registry.schema()).rejects.toThrow(/account registry/);
        const users = tableName(accountSchema, "users");
        await registry.run(
          `INSERT INTO ${users} (id, issuer, subject, username, display_name, game_schema) VALUES (?, ?, ?, ?, ?, ?)`,
          ownerAccountId, issuer, "owner", "owner", "Owner", other.schemaName,
        );
        const resolved = await accounts.resolve(identity("owner"));
        expect(resolved.store.schemaName).toBe(other.schemaName);
        await expect(registeredAccountSchemas(root, accountSchema)).resolves.toEqual([other.schemaName]);
        for (const [values, code] of [
          [[randomUUID(), issuer, "owner", "x", "X", root.schemaName], "23505"],
          [[randomUUID(), issuer, "new", "x", "X", other.schemaName], "23505"],
          [[randomUUID(), issuer, "new", "x", "X", accountSchema], "23514"],
          [[randomUUID(), issuer, "new", "x", "X", "Upper_case"], "23514"],
        ] as const)
          await expect(registry.run(
            `INSERT INTO ${users} (id, issuer, subject, username, display_name, game_schema) VALUES (?, ?, ?, ?, ?, ?)`,
            ...values,
          ), values.join(" ")).rejects.toMatchObject({ code });
        await expect(registry.run(
          `UPDATE ${users} SET email = 'Upper@Example.test' WHERE id = ?`, ownerAccountId,
        )).rejects.toMatchObject({ code: "23514" });
        await registry.exec(`ALTER TABLE ${users} DROP CONSTRAINT users_game_schema_key;`);
        await expect(accounts.assertReady()).rejects.toThrow(/uniqueness constraints/);
        await registry.exec(`ALTER TABLE ${users} ADD CONSTRAINT users_game_schema_key UNIQUE (game_schema);`);
        await accounts.assertReady();
      } finally {
        try {
          await registry.exec(`DROP SCHEMA IF EXISTS ${quoteIdentifier(accountSchema)} CASCADE;`);
        } finally {
          await registry.close();
          await other?.close();
          await root.close();
        }
      }
    });
  });
}

// Account worlds are touchline_user_* schemas that test-mode stores refuse: only loopback opts into a disposable database.
const localSql = process.env.SQL_INTEGRATION_TESTS === "true" &&
  ["127.0.0.1", "localhost", "::1"].includes(process.env.SQL_HOST ?? "127.0.0.1");

/** A fresh, owned PostgreSQL database with an account registry, dropped afterwards. */
async function withDatabase(test: (root: Store) => Promise<void>): Promise<void> {
  const database = `touchline_test_accounts_${randomUUID().replaceAll("-", "")}`;
  if (!/^touchline_test_accounts_[a-f0-9]{32}$/.test(database) || database === process.env.SQL_DATABASE)
    throw new Error("Account SQL regression requires a fresh owned database.");
  for (const name of ["SQL_ALLOW_REMOTE_TESTS", "SQL_TEST_DATABASE", "TOUCHLINE_E2E_SCHEMA", "GAME_DB", "SAVE_DIR"]) vi.stubEnv(name, undefined);
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
      expect(await applyRegistry(root, registryPlan({ database }))).toEqual({ users: 0, accessRequests: 0 });
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

async function userWorlds(root: Store): Promise<string[]> {
  return (await root.all<{ name: string }>(
    "SELECT nspname AS name FROM pg_catalog.pg_namespace WHERE nspname LIKE 'touchline\\_user\\_%' ORDER BY nspname",
  )).map((row) => row.name);
}

async function assertEmptyWorld(world: Store): Promise<void> {
  expect(await world.all("SELECT key, value FROM meta ORDER BY key")).toEqual([{ key: "appearanceIndexVersion", value: "1" }]);
  const tables = await world.all<{ name: string }>(
    "SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = ? ORDER BY tablename", world.schemaName,
  );
  expect(tables.map((table) => table.name)).toEqual([...STORE_TABLES].sort());
  expect(await world.get("SELECT count(*) AS rows FROM players")).toEqual({ rows: 0 });
  expect(await world.all("SELECT version, name FROM schema_migrations ORDER BY version"))
    .toEqual(schemaMigrations(world.schemaName).map(({ version, name }) => ({ version, name })));
}

const requests = tableName("accounts", "access_requests");
const users = tableName("accounts", "users");

describe.skipIf(!localSql)("Account access (local disposable PostgreSQL database)", () => {
  it("records pending requests, refreshes them, and resolves only after approval", async () => {
    await withDatabase(async (root) => {
      const accounts = new Accounts(root, "accounts", { limits: { maxPlayers: 5, sizeLimitGb: 24 } });
      await accounts.assertReady();
      await expect(accounts.resolve(identity("guest"))).rejects.toBeInstanceOf(AccessPendingError);
      await expect(accounts.resolve(identity("guest"))).rejects.toMatchObject({ status: 403, code: "access_pending" });
      const [pending] = (await accounts.listAccess()).requests;
      expect(pending).toMatchObject({
        issuer, subject: "guest", username: "user-guest", displayName: "Person guest", email: "guest@example.test",
        status: "pending", decidedAt: null, decidedBy: null, accountId: null,
      });
      await expect(accounts.resolve(identity("guest", { username: "renamed", displayName: "Renamed", email: "New@Example.test" })))
        .rejects.toBeInstanceOf(AccessPendingError);
      const refreshed = await accounts.listAccess();
      expect(refreshed.requests).toEqual([{ ...pending, username: "renamed", displayName: "Renamed", email: "new@example.test" }]);
      expect(refreshed.players).toEqual([]);
      expect(await userWorlds(root)).toEqual([]);

      expect(await accounts.approve(pending.id.toUpperCase(), "owner")).toEqual({ status: "approved" });
      const approved = await root.get<{ status: string; decided_by: string; account_id: string; decided_at: Date }>(
        `SELECT status, decided_by, account_id, decided_at FROM ${requests} WHERE id = ?`, pending.id,
      );
      expect(approved).toMatchObject({ status: "approved", decided_by: "owner", decided_at: expect.any(Date) });
      const resolved = await accounts.resolve(identity("guest", { username: "renamed", displayName: "Renamed", email: "new@example.test" }));
      expect(resolved.user).toEqual({ id: approved!.account_id, username: "renamed", displayName: "Renamed", email: "new@example.test", admin: false });
      expect(resolved.store.schemaName).toBe(accountWorldSchema(approved!.account_id));
      expect(await userWorlds(root)).toEqual([resolved.store.schemaName]);
      await assertEmptyWorld(resolved.store);
      expect(await new Saves(resolved.store).currentState()).toBeFalsy();

      // Approval is idempotent and never creates a second world.
      expect(await accounts.approve(pending.id, "someone else")).toEqual({ status: "approved" });
      expect(await root.get(`SELECT decided_by FROM ${requests} WHERE id = ?`, pending.id)).toEqual({ decided_by: "owner" });
      expect(await userWorlds(root)).toEqual([resolved.store.schemaName]);

      // Profile changes after approval refresh the account, not the request.
      const again = await accounts.resolve(identity("guest", { username: "guest3", displayName: "Third", email: null }));
      expect(again.user).toMatchObject({ username: "guest3", displayName: "Third", email: null });
      expect(again.store).toBe(resolved.store);
      expect(await root.get(`SELECT username, display_name, email FROM ${users} WHERE id = ?`, again.user.id))
        .toEqual({ username: "guest3", display_name: "Third", email: null });

      const overview = await accounts.listAccess();
      expect(overview.players).toEqual([{
        id: again.user.id, username: "guest3", displayName: "Third", email: null, createdAt: expect.any(Date), admin: false,
      }]);
      expect(overview.capacity).toMatchObject({ players: 1, maxPlayers: 5, databaseLimitGb: 24, available: true, reason: null });
      expect(overview.capacity.databaseGb).toBeGreaterThan(0);
      await expect(registeredAccountSchemas(root)).resolves.toEqual([resolved.store.schemaName]);
    });
  });

  it("denies, keeps denied users out, refuses revocation and allows re-approval", async () => {
    await withDatabase(async (root) => {
      const accounts = new Accounts(root, "accounts", { limits: { maxPlayers: 5, sizeLimitGb: 24 } });
      await expect(accounts.resolve(identity("guest"))).rejects.toBeInstanceOf(AccessPendingError);
      const [request] = (await accounts.listAccess()).requests;
      expect(await accounts.deny(request.id, "owner")).toEqual({ status: "denied" });
      const denied = (await accounts.listAccess()).requests[0];
      expect(denied).toMatchObject({ status: "denied", decidedBy: "owner", decidedAt: expect.any(Date), accountId: null });
      await expect(accounts.resolve(identity("guest", { displayName: "Still trying" })))
        .rejects.toMatchObject({ status: 403, code: "access_denied" });
      expect((await accounts.listAccess()).requests[0]).toMatchObject({ status: "denied", displayName: "Still trying" });
      // Denying again keeps the original decision.
      expect(await accounts.deny(request.id, "other admin")).toEqual({ status: "denied" });
      expect((await accounts.listAccess()).requests[0]).toMatchObject({ decidedBy: "owner", decidedAt: denied.decidedAt });

      for (const id of [randomUUID(), "not-a-uuid", ""]) {
        await expect(accounts.approve(id, "owner")).rejects.toBeInstanceOf(AccessRequestNotFoundError);
        await expect(accounts.deny(id, "owner")).rejects.toMatchObject({ status: 404 });
      }
      await expect(accounts.approve(request.id, " ")).rejects.toThrow(/decided by/);

      expect(await accounts.approve(request.id, "owner")).toEqual({ status: "approved" });
      const resolved = await accounts.resolve(identity("guest"));
      expect(resolved.store.schemaName).toMatch(/^touchline_user_[a-f0-9]{32}$/);
      await expect(accounts.deny(request.id, "owner")).rejects.toBeInstanceOf(AccessRequestConflictError);
      await expect(accounts.deny(request.id, "owner")).rejects.toMatchObject({ status: 409 });
      expect((await accounts.listAccess()).requests[0]).toMatchObject({ status: "approved", accountId: resolved.user.id });
      await expect(accounts.resolve(identity("guest"))).resolves.toMatchObject({ user: { id: resolved.user.id } });
    });
  });

  it("provisions admins on first sign-in without capacity limits or requests, exactly once", async () => {
    await withDatabase(async (root) => {
      const accounts = new Accounts(root, "accounts", { limits: { maxPlayers: 0, sizeLimitGb: 0.000001 } });
      // An earlier non-admin sign-in left a pending request; joining the admin group supersedes it.
      await expect(accounts.resolve(identity("boss"))).rejects.toBeInstanceOf(AccessPendingError);
      const admin = identity("boss", { groups: ["admins"], admin: true });
      const resolved = await Promise.all([accounts.resolve(admin), accounts.resolve(admin), accounts.resolve(admin)]);
      expect(new Set(resolved.map((account) => account.user.id)).size).toBe(1);
      expect(resolved[0].user).toMatchObject({ username: "user-boss", admin: true });
      expect(await userWorlds(root)).toEqual([resolved[0].store.schemaName]);
      await assertEmptyWorld(resolved[0].store);
      const overview = await accounts.listAccess();
      expect(overview.requests).toEqual([]);
      expect(overview.players).toMatchObject([{ id: resolved[0].user.id, admin: true }]);
      expect(overview.capacity).toMatchObject({ players: 0, maxPlayers: 0, available: false, reason: "player_limit" });
      // The same person signing in without the admin group keeps the account, just without admin rights.
      expect((await accounts.resolve(identity("boss"))).user).toMatchObject({ id: resolved[0].user.id, admin: false });
    });
  });

  it("serializes concurrent approvals of one request into exactly one world", async () => {
    await withDatabase(async (root) => {
      const accounts = new Accounts(root, "accounts", { limits: { maxPlayers: 5, sizeLimitGb: 24 } });
      const other = new Accounts(root, "accounts", { limits: { maxPlayers: 5, sizeLimitGb: 24 } });
      await expect(accounts.resolve(identity("guest"))).rejects.toBeInstanceOf(AccessPendingError);
      const [request] = (await accounts.listAccess()).requests;
      const outcomes = await Promise.all([
        accounts.approve(request.id, "owner"), other.approve(request.id, "owner"),
        accounts.approve(request.id, "owner"), other.approve(request.id, "owner"),
      ]);
      expect(outcomes).toEqual(Array.from({ length: 4 }, () => ({ status: "approved" })));
      expect(await root.get(`SELECT count(*) AS total FROM ${users}`)).toEqual({ total: 1 });
      const worlds = await userWorlds(root);
      expect(worlds).toHaveLength(1);
      expect((await accounts.resolve(identity("guest"))).store.schemaName).toBe(worlds[0]);
      expect((await accounts.listAccess()).capacity.players).toBe(1);
    });
  });

  it("enforces MAX_PLAYERS and DB_SIZE_LIMIT_GB when approving, leaving the request pending", async () => {
    await withDatabase(async (root) => {
      const accounts = new Accounts(root, "accounts", { limits: { maxPlayers: 1, sizeLimitGb: 24 } });
      for (const subject of ["first", "second", "third"])
        await expect(accounts.resolve(identity(subject))).rejects.toBeInstanceOf(AccessPendingError);
      const bySubject = new Map((await accounts.listAccess()).requests.map((request) => [request.subject, request.id]));
      await accounts.resolve(identity("boss", { admin: true }));
      // Admin accounts do not count against MAX_PLAYERS.
      const results = await Promise.all([accounts.approve(bySubject.get("first")!, "boss"), accounts.approve(bySubject.get("second")!, "boss")]);
      expect(results).toEqual(expect.arrayContaining([{ status: "approved" }, { status: "capacity", reason: "player_limit" }]));
      expect(await userWorlds(root)).toHaveLength(2);
      const statuses = await root.all(`SELECT subject, status, account_id IS NOT NULL AS linked FROM ${requests} ORDER BY subject`);
      expect(statuses.filter((row) => (row as { status: string }).status === "pending")).toHaveLength(2);
      expect(await accounts.approve(bySubject.get("third")!, "boss")).toEqual({ status: "capacity", reason: "player_limit" });
      expect((await accounts.listAccess()).capacity).toMatchObject({ players: 1, maxPlayers: 1, available: false, reason: "player_limit" });

      const tiny = new Accounts(root, "accounts", { limits: { maxPlayers: 10, sizeLimitGb: 0.000001 } });
      expect(await tiny.approve(bySubject.get("third")!, "boss")).toEqual({ status: "capacity", reason: "database_size" });
      await expect(tiny.resolve(identity("third"))).rejects.toBeInstanceOf(AccessPendingError);
      expect(await userWorlds(root)).toHaveLength(2);
      expect(await new Accounts(root, "accounts", { limits: { maxPlayers: 2, sizeLimitGb: 24 } })
        .approve(bySubject.get("third")!, "boss")).toEqual({ status: "approved" });
      expect(await userWorlds(root)).toHaveLength(3);
    });
  });

  it("never adopts an existing schema and rolls the whole provisioning back on failure", async () => {
    await withDatabase(async (root) => {
      const accounts = new Accounts(root, "accounts", { limits: { maxPlayers: 5, sizeLimitGb: 24 } });
      await expect(accounts.resolve(identity("guest"))).rejects.toBeInstanceOf(AccessPendingError);
      const [request] = (await accounts.listAccess()).requests;
      await root.exec(`CREATE SCHEMA ${quoteIdentifier(ownerSchema)}; CREATE TABLE ${tableName(ownerSchema, "foreign_data")} (id integer);`);
      forced.uuids.push(ownerAccountId);
      await expect(accounts.approve(request.id, "owner")).rejects.toThrow(/refusing to adopt/);
      expect(await root.all("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = ?", ownerSchema)).toEqual([{ tablename: "foreign_data" }]);
      expect(await root.get(`SELECT count(*) AS total FROM ${users}`)).toEqual({ total: 0 });
      expect((await accounts.listAccess()).requests[0]).toMatchObject({ status: "pending", accountId: null });

      // A failure after the world was migrated leaves neither the world nor the registration behind.
      await root.exec(`ALTER TABLE ${users} ADD CONSTRAINT reject_all CHECK (false) NOT VALID;`);
      forced.uuids.push(otherAccountId);
      await expect(accounts.approve(request.id, "owner")).rejects.toMatchObject({ code: "23514" });
      expect(await userWorlds(root)).toEqual([ownerSchema]);
      expect((await accounts.listAccess()).requests[0]).toMatchObject({ status: "pending" });
      await root.exec(`ALTER TABLE ${users} DROP CONSTRAINT reject_all;`);
      expect(await accounts.approve(request.id, "owner")).toEqual({ status: "approved" });
      expect((await userWorlds(root)).filter((schema) => schema !== ownerSchema)).toHaveLength(1);
    });
  });

  it("keeps approved worlds isolated from each other and from the registry", async () => {
    await withDatabase(async (root) => {
      const accounts = new Accounts(root, "accounts", { limits: { maxPlayers: 5, sizeLimitGb: 24 } });
      for (const subject of ["first", "second"])
        await expect(accounts.resolve(identity(subject))).rejects.toBeInstanceOf(AccessPendingError);
      for (const request of (await accounts.listAccess()).requests) await accounts.approve(request.id, "owner");
      const [first, second] = await Promise.all([accounts.resolve(identity("first")), accounts.resolve(identity("second"))]);
      expect(first.store.schemaName).not.toBe(second.store.schemaName);
      await Promise.all([first.store.setMeta("isolation", "first"), second.store.setMeta("isolation", "second")]);
      expect(await first.store.meta("isolation")).toBe("first");
      expect(await second.store.meta("isolation")).toBe("second");
      const insertNews = (world: Store, title: string) => world.run(
        "INSERT INTO news (date, category, title, body, severity) VALUES (?, ?, ?, ?, ?)",
        "2026-07-20", "Account regression", title, "Isolated world sentinel", "info",
      );
      expect((await insertNews(first.store, "First")).lastInsertRowid).toBe(1);
      expect((await insertNews(second.store, "Second")).lastInsertRowid).toBe(1);
      const saveId = randomUUID();
      await first.store.run(
        "INSERT INTO save_slots (id, name, created_at, automatic, format_version) VALUES (?, ?, ?, ?, ?)",
        saveId, "Private snapshot", new Date(), false, 1,
      );
      expect(await second.store.get("SELECT id FROM save_slots WHERE id = ?", saveId)).toBeUndefined();
      await first.store.transaction(async () => first.store.clearWorld());
      expect(await second.store.meta("isolation")).toBe("second");
      expect(await second.store.all("SELECT title FROM news")).toEqual([{ title: "Second" }]);
      expect(await first.store.get("SELECT id FROM save_slots WHERE id = ?", saveId)).toBeDefined();
      expect(await root.get(`SELECT count(*) AS total FROM ${users}`)).toEqual({ total: 2 });
      await first.store.setMeta("state", { careerId: "career", seed: "seed" });
      expect(await new Saves(first.store).deleteActiveCareer({ careerId: "career", seed: "seed" }))
        .toMatchObject({ deleted: true });
      expect(await second.store.meta("isolation")).toBe("second");
      await expect(registeredAccountSchemas(root)).resolves.toEqual([first.store.schemaName, second.store.schemaName].sort());

      // The registry validates its shape, and a missing registered world fails closed.
      await root.exec(`DROP SCHEMA ${quoteIdentifier(second.store.schemaName)} CASCADE;`);
      await expect(registeredAccountSchemas(root)).rejects.toThrow(/refusing to recreate/);
      await root.exec(`CREATE TABLE ${tableName("accounts", "players")} (id integer);`);
      await expect(accounts.assertReady()).rejects.toThrow(/never world or save tables/);
      await expect(ensureAccountRegistry(root)).rejects.toThrow(/collides/);
      await expect(applyRegistry(root, registryPlan({ database: root.database }))).rejects.toThrow(/collides/);
    });
  });
});
