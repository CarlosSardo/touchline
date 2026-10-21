import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  advisoryLockKey,
  bindSql,
  DatabaseUnavailableError,
  isForeignKeyViolation,
  isLockTimeout,
  isUniqueViolation,
  openOnFirstUse,
  sqlErrorCode,
  sqlPoolConfig,
  Store,
} from "./db.ts";
import {
  describeSqlError,
  isLocalSqlHost,
  MAX_IDENTIFIER_LENGTH,
  readSqlSettings,
  validateSqlSchema,
} from "./sql-config.ts";
import {
  accessRequestsTableSql,
  appearanceBackfill,
  IDENTITY_TABLES,
  migrationTableSql,
  quoteIdentifier,
  schemaMigrations,
  sqlLiteral,
  STORE_TABLES,
  tableName,
  usersTableSql,
  WORLD_TABLES,
} from "./sql-schema.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function latch() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

function sqlError(code: string, message = `SQL error ${code}`) {
  return Object.assign(new Error(message), { code });
}

describe("SQL opened on first use (no database)", () => {
  it("shares one attempt between concurrent callers and keeps the opened resource", async () => {
    let finish: (value: { id: number }) => void = () => {};
    const open = vi.fn(() => new Promise<{ id: number }>((resolve) => { finish = resolve; }));
    const database = openOnFirstUse(open);
    expect(open).not.toHaveBeenCalled();
    const callers = [database.get(), database.get(), database.get()];
    expect(open).toHaveBeenCalledOnce();
    finish({ id: 1 });
    const opened = await Promise.all(callers);
    expect(new Set(opened).size).toBe(1);
    expect(await database.get()).toBe(opened[0]);
    expect(open).toHaveBeenCalledOnce();
  });

  it("retries a failed connection inside the window, then gives up and lets the next call try again", async () => {
    const resumed = { id: 2 };
    const open = vi.fn<() => Promise<typeof resumed>>()
      .mockRejectedValueOnce(sqlError("57P03", "the database system is starting up"))
      .mockResolvedValueOnce(resumed);
    expect(await openOnFirstUse(open, { retryFor: 1_000, retryDelay: 1 }).get()).toBe(resumed);
    expect(open).toHaveBeenCalledTimes(2);

    const outage = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
    const unavailable = vi.fn(async () => { throw outage; });
    const database = openOnFirstUse(unavailable, { retryFor: 30, retryDelay: 5 });
    const failure = await database.get().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DatabaseUnavailableError);
    expect(failure).toMatchObject({ status: 503, code: "database_unavailable", cause: outage });
    const attempts = unavailable.mock.calls.length;
    expect(attempts).toBeGreaterThan(1);
    await expect(database.get()).rejects.toBeInstanceOf(DatabaseUnavailableError);
    expect(unavailable.mock.calls.length).toBeGreaterThan(attempts);
  });

  it("does not retry failures that waiting cannot fix", async () => {
    const invalid = new Error("The account registry is missing its identity or schema uniqueness constraints.");
    const open = vi.fn(async () => { throw invalid; });
    const database = openOnFirstUse(open, { retryFor: 60_000, retryDelay: 60_000, retryable: (error) => error !== invalid });
    await expect(database.get()).rejects.toMatchObject({ code: "database_unavailable", cause: invalid });
    expect(open).toHaveBeenCalledOnce();
  });

  it("gives up without a final wait when the next retry would pass the deadline", async () => {
    const open = vi.fn(async () => { throw new Error("down"); });
    const started = Date.now();
    await expect(openOnFirstUse(open, { retryFor: 50, retryDelay: 10_000 }).get())
      .rejects.toBeInstanceOf(DatabaseUnavailableError);
    expect(open).toHaveBeenCalledOnce();
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("closes the opened resource, including one still opening, and refuses new calls", async () => {
    let finish: (value: { id: number }) => void = () => {};
    const database = openOnFirstUse(() => new Promise<{ id: number }>((resolve) => { finish = resolve; }));
    const caller = database.get();
    const dispose = vi.fn(async () => {});
    const closing = database.close(dispose);
    finish({ id: 3 });
    await closing;
    expect(dispose).toHaveBeenCalledWith({ id: 3 });
    expect(await caller).toEqual({ id: 3 });
    await expect(database.get()).rejects.toBeInstanceOf(DatabaseUnavailableError);

    const never = vi.fn(async () => ({ id: 4 }));
    const unused = openOnFirstUse(never);
    await unused.close(dispose);
    expect(never).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("stops retrying once closed while an attempt is failing", async () => {
    const open = vi.fn(async () => { throw new Error("down"); });
    const database = openOnFirstUse(open, { retryFor: 60_000, retryDelay: 20 });
    const caller = database.get().catch((error: unknown) => error);
    await pause(30);
    const dispose = vi.fn(async () => {});
    await database.close(dispose);
    expect(await caller).toBeInstanceOf(DatabaseUnavailableError);
    const attempts = open.mock.calls.length;
    await pause(60);
    expect(open.mock.calls.length).toBe(attempts);
    expect(dispose).not.toHaveBeenCalled();
  });
});

describe("SQL error helpers (no database)", () => {
  it("reads PostgreSQL SQLSTATE codes and classifies common failures", () => {
    expect(sqlErrorCode(sqlError("23505"))).toBe("23505");
    expect(sqlErrorCode(sqlError("40P01"))).toBe("40P01");
    expect(sqlErrorCode(Object.assign(new Error("socket"), { code: "ECONNRESET" }))).toBeUndefined();
    expect(sqlErrorCode(Object.assign(new Error("number"), { code: 2627 }))).toBeUndefined();
    expect(sqlErrorCode(null)).toBeUndefined();
    expect(sqlErrorCode("23505")).toBeUndefined();
    expect(isUniqueViolation(sqlError("23505"))).toBe(true);
    expect(isUniqueViolation(sqlError("23503"))).toBe(false);
    expect(isForeignKeyViolation(sqlError("23503"))).toBe(true);
    expect(isLockTimeout(sqlError("55P03"))).toBe(true);
    expect(isLockTimeout(new Error("55P03"))).toBe(false);
  });

  it("derives stable, distinct signed 64-bit advisory lock keys", () => {
    const key = advisoryLockKey("touchline:world:touchline_test_a");
    expect(typeof key).toBe("bigint");
    expect(advisoryLockKey("touchline:world:touchline_test_a")).toBe(key);
    expect(advisoryLockKey("touchline:world:touchline_test_b")).not.toBe(key);
    for (const name of ["", "touchline:account-registry", "touchline:schema-maintenance", "ü".repeat(500)]) {
      const value = advisoryLockKey(name);
      expect(value >= -(2n ** 63n) && value < 2n ** 63n).toBe(true);
    }
  });
});

describe("SQL binding (no database)", () => {
  it("rewrites ? placeholders to $n outside literals, identifiers, comments and dollar quotes", () => {
    const query = `SELECT 'it''s ?', "quoted?name", E'esc\\'aped ?', $$dollar ? quoted$$, $tag$ inner $$ ? $tag$, ?
      FROM players -- ? FROM clubs
      WHERE name = ? /* ? /* nested ? */ still ? */ AND profile = '{"question":"?"}' AND U&'\\0041?' <> e'\\\\?'`;
    const prepared = bindSql(query, [3.25, "O'Brien"]);
    expect(prepared.sql).toBe(query.replace("$tag$, ?\n", "$tag$, $1\n").replace("name = ?", "name = $2"));
    expect(prepared.values).toEqual([3.25, "O'Brien"]);
    expect(prepared.sql).not.toContain("O'Brien");
    expect(prepared.statements).toBe(1);
    expect(prepared.writes).toBe(false);
  });

  it("leaves SQL without parameters byte-for-byte unchanged", () => {
    for (const query of [
      "SELECT 1",
      "SELECT x::jsonb ->> 'a', y::double precision FROM players WHERE name ILIKE '%a!%' ESCAPE '!'",
      "SELECT * FROM players WHERE id = ANY('{1,2}'::int[]) ORDER BY ability DESC NULLS LAST LIMIT 5",
    ])
      expect(bindSql(query).sql).toBe(query);
  });

  it("numbers placeholders in order, including typed casts and array parameters", () => {
    const prepared = bindSql(
      "SELECT id FROM players WHERE id = ANY(?::int[]) AND name = ?::text LIMIT ? OFFSET ?",
      [[1, 2, 3], "Ana", 10, 0],
    );
    expect(prepared.sql).toBe("SELECT id FROM players WHERE id = ANY($1::int[]) AND name = $2::text LIMIT $3 OFFSET $4");
    expect(prepared.values).toEqual([[1, 2, 3], "Ana", 10, 0]);
    expect(bindSql("SELECT ? || 'suffix', ? & 3", ["a", 1]).sql).toBe("SELECT $1 || 'suffix', $2 & 3");
  });

  it("normalizes parameter values: bigint to text, undefined to NULL, others unchanged", () => {
    const date = new Date("2026-09-21T10:00:00Z");
    const binary = Buffer.from([0, 255]);
    const prepared = bindSql("SELECT ?, ?, ?, ?, ?, ?, ?", [
      9007199254740993n, undefined, null, date, binary, true, ["a", null],
    ]);
    expect(prepared.values).toEqual(["9007199254740993", null, null, date, binary, true, ["a", null]]);
    expect(prepared.values[3]).toBe(date);
    expect(prepared.values[4]).toBe(binary);
  });

  it("rejects non-finite numbers, also inside arrays", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])
      expect(() => bindSql("SELECT ?", [value])).toThrow(/finite/);
    expect(() => bindSql("SELECT ?", [[1, Number.NaN]])).toThrow(/finite/);
  });

  it("rejects mismatched and excessive parameter counts", () => {
    expect(() => bindSql("SELECT ?", [])).toThrow(/count mismatch: expected 1, received 0/);
    expect(() => bindSql("SELECT 1", [1])).toThrow(/count mismatch: expected 0, received 1/);
    expect(() => bindSql("SELECT '?'", [1])).toThrow(/count mismatch/);
    const many = Array(65_536).fill(1);
    expect(() => bindSql(`SELECT ${many.map(() => "?").join(",")}`, many)).toThrow(/65535 parameters/);
  });

  it("rejects $n placeholders and the jsonb ?| and ?& operators", () => {
    expect(() => bindSql("SELECT $1")).toThrow(/Use \? placeholders/);
    expect(() => bindSql("SELECT * FROM players WHERE id = $1 AND name = ?", ["x"])).toThrow(/Use \? placeholders/);
    expect(() => bindSql("SELECT data::jsonb ?| array['a'] FROM news")).toThrow(/jsonb_exists_any/);
    expect(() => bindSql("SELECT data::jsonb ?& array['a'] FROM news")).toThrow(/jsonb_exists_all/);
    expect(bindSql("SELECT jsonb_exists_any(data::jsonb, ?::text[]) FROM news", [["a"]]).sql)
      .toBe("SELECT jsonb_exists_any(data::jsonb, $1::text[]) FROM news");
  });

  it("rejects incomplete quoted values, identifiers, comments and dollar quotes", () => {
    for (const query of [
      "SELECT 'missing",
      'SELECT "missing',
      "SELECT /* missing",
      "SELECT /* nested /* only one */ closed",
      "SELECT $$missing",
      "SELECT $tag$ missing $other$",
      "SELECT E'ends with an escaped quote\\'",
    ])
      expect(() => bindSql(query), query).toThrow(/Unterminated/);
    expect(() => bindSql("INSERT INTO countries (id, code VALUES (1")).toThrow(/Unbalanced/);
  });

  it("counts statements, ignoring semicolons in literals and comments and one trailing semicolon", () => {
    expect(bindSql("").statements).toBe(0);
    expect(bindSql("  -- only a comment").statements).toBe(0);
    expect(bindSql("SELECT 1").statements).toBe(1);
    expect(bindSql("SELECT 1;").statements).toBe(1);
    expect(bindSql("SELECT ';'; -- ;\n SELECT $$;$$; /* ; */ SELECT 3;").statements).toBe(3);
    expect(bindSql("SELECT 1; SELECT 2").statements).toBe(2);
  });

  it.each([
    ["SELECT 'UPDATE', \"delete\" FROM news", false],
    ["SELECT 1 -- DELETE FROM news", false],
    ["SELECT $$DROP TABLE news$$", false],
    ["SELECT id, value FROM meta WHERE key = 'insert'", false],
    ["INSERT INTO news (title) VALUES ('x')", true],
    ["update players SET morale = 1", true],
    ["DELETE FROM news", true],
    ["WITH gone AS (DELETE FROM news RETURNING id) SELECT id FROM gone", true],
    ["TRUNCATE TABLE news", true],
    ["CREATE TEMP TABLE kept ON COMMIT DROP AS SELECT 1", true],
    ["SELECT * FROM players FOR UPDATE", true],
    ["SELECT nextval('x')", true],
    ["SELECT setval('x', 1)", true],
    ["DO $$ BEGIN END $$", true],
    ["MERGE INTO meta USING (SELECT 1) AS s ON true WHEN MATCHED THEN DO NOTHING", true],
    ["ALTER TABLE players ADD COLUMN x int", true],
    ["DROP INDEX x", true],
    ["SET search_path TO x", true],
  ])("classifies %s as writes=%s", (query, writes) => {
    expect(bindSql(query).writes).toBe(writes);
  });

  // `SELECT ... INTO new_table` creates a table, so it must run under the world writer lock.
  it("classifies SELECT ... INTO (table creation) as a write", () => {
    expect(bindSql("SELECT id INTO snapshot FROM countries").writes).toBe(true);
  });

  it.each([
    ["INSERT INTO players (name) VALUES (?)", { table: "players", explicitId: false, returning: false }],
    ["insert into Players (id, name) values (?, ?)", { table: "players", explicitId: true, returning: false }],
    ['INSERT INTO "touchline_test_x"."countries" AS c ("id", code) VALUES (?, ?)', { table: "countries", explicitId: true, returning: false }],
    ["INSERT INTO countries (code) VALUES (?) RETURNING id, code", { table: "countries", explicitId: false, returning: true }],
    ["INSERT INTO news (title) SELECT title FROM (SELECT id, title FROM news) AS n", { table: "news", explicitId: false, returning: false }],
    ["WITH src AS (SELECT 12 AS id) INSERT INTO countries (id, code) SELECT id, 'X' FROM src", { table: "countries", explicitId: true, returning: false }],
    ["INSERT INTO news (title) VALUES ((SELECT title FROM news WHERE id IN (SELECT id FROM news) LIMIT 1))", { table: "news", explicitId: false, returning: false }],
    ["INSERT INTO countries (code) VALUES (?) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name", { table: "countries", explicitId: false, returning: false }],
  ])("detects identity inserts: %s", (query, insert) => {
    const params = Array((query.match(/\?/g) ?? []).length).fill(1);
    expect(bindSql(query, params).insert).toEqual(insert);
  });

  it.each([
    "INSERT INTO save_slots (id, name) VALUES (?, ?)",
    "INSERT INTO meta (key, value) VALUES (?, ?)",
    "INSERT INTO standings (league_id, club_id) VALUES (?, ?)",
    "UPDATE players SET name = ? WHERE id = ?",
    "SELECT id, name FROM players WHERE id = ?",
    "WITH moved AS (INSERT INTO news (title) VALUES (?) RETURNING id) SELECT id FROM moved",
    "INSERT INTO players (name) VALUES (?); SELECT ?",
  ])("does not treat %s as a single identity insert", (query) => {
    const params = Array((query.match(/\?/g) ?? []).length).fill(1);
    expect(bindSql(query, params).insert).toBeUndefined();
  });

  it("keeps every schema-qualified migration, registry and backfill statement bindable", () => {
    const schema = "touchline_test_review";
    for (const query of [
      migrationTableSql(schema),
      usersTableSql("accounts"),
      accessRequestsTableSql("accounts"),
      ...schemaMigrations(schema).flatMap((migration) => migration.statements),
      ...appearanceBackfill(schema),
    ]) {
      const prepared = bindSql(query);
      expect(prepared.sql, query).toBe(query);
      expect(prepared.writes, query).toBe(true);
    }
  });
});

describe("SQL configuration (no database)", () => {
  it("defaults to a local, unencrypted PostgreSQL on 5432 and the public schema", () => {
    expect(readSqlSettings({})).toEqual({
      host: "127.0.0.1",
      port: 5432,
      database: "touchline",
      user: undefined,
      password: undefined,
      ssl: "disable",
      testMode: false,
      schema: "public",
      requestTimeout: 120000,
      poolSize: 10,
      applicationName: "Touchline",
    });
  });

  it("reads SQL_HOST, SQL_PORT, SQL_SSL, credentials, timeouts and pool size", () => {
    expect(readSqlSettings({
      SQL_HOST: "db.example.com",
      SQL_PORT: "6543",
      SQL_DATABASE: "touchline_prod",
      SQL_USER: "touchline",
      SQL_PASSWORD: "test-only",
      SQL_SCHEMA: "touchline_user_1",
      SQL_REQUEST_TIMEOUT_MS: "900000",
      SQL_POOL_SIZE: "4",
    })).toMatchObject({
      host: "db.example.com",
      port: 6543,
      database: "touchline_prod",
      user: "touchline",
      password: "test-only",
      ssl: "verify-full",
      schema: "touchline_user_1",
      requestTimeout: 900000,
      poolSize: 4,
    });
    expect(readSqlSettings({ SQL_SSL: "require" }).ssl).toBe("require");
    expect(readSqlSettings({ SQL_HOST: "localhost", SQL_SSL: "verify-full" }).ssl).toBe("verify-full");
  });

  it("treats loopback and single-label container hosts as local", () => {
    for (const host of ["localhost", "127.0.0.1", "::1", "postgres", "touchline-db"])
      expect(isLocalSqlHost(host), host).toBe(true);
    for (const host of ["db.example.com", "10.0.0.5", "192.168.1.20", "postgres.internal", "-bad"])
      expect(isLocalSqlHost(host), host).toBe(false);
    expect(readSqlSettings({ SQL_HOST: "postgres" }).ssl).toBe("disable");
  });

  it("requires verified TLS for remote hosts", () => {
    expect(readSqlSettings({ SQL_HOST: "db.example.com" }).ssl).toBe("verify-full");
    for (const ssl of ["disable", "require"])
      expect(() => readSqlSettings({ SQL_HOST: "db.example.com", SQL_SSL: ssl })).toThrow(/verified TLS/);
    expect(() => readSqlSettings({ SQL_SSL: "prefer" })).toThrow(/SQL_SSL must be/);
  });

  it.each(["SQL_SERVER", "SQL_ENCRYPT", "SQL_TRUST_SERVER_CERTIFICATE", "AZURE_SQL_SERVER"])(
    "rejects the retired Azure SQL setting %s",
    (name) => {
      expect(() => readSqlSettings({ [name]: "example.database.windows.net" })).toThrow(
        new RegExp(`${name} belongs to the retired Azure SQL setup`),
      );
    },
  );

  it("rejects SQLite configuration and file-like database names", () => {
    expect(() => readSqlSettings({ GAME_DB: "data/career.sqlite" })).toThrow(/SQLite configuration/);
    expect(() => readSqlSettings({ SAVE_DIR: "saves" })).toThrow(/SQLite configuration/);
    for (const database of [":memory:", "data/touchline.db", "touch line", "1touchline", "a".repeat(64)])
      expect(() => readSqlSettings({ SQL_DATABASE: database }), database).toThrow(/not a file path/);
    expect(readSqlSettings({ SQL_DATABASE: "a".repeat(63) }).database).toHaveLength(63);
  });

  it("validates host, port, request timeout, pool size and credential pairs", () => {
    for (const host of ["", " padded", "a".repeat(254)])
      expect(() => readSqlSettings({ SQL_HOST: host }), JSON.stringify(host)).toThrow(/SQL_HOST/);
    for (const port of ["0", "65536", "54.3", "port", "-1"])
      expect(() => readSqlSettings({ SQL_PORT: port }), port).toThrow(/SQL_PORT/);
    expect(readSqlSettings({ SQL_PORT: "65535" }).port).toBe(65535);
    for (const timeout of ["0", "-1", "999", "Infinity", "900001", "invalid", "1500.5"])
      expect(() => readSqlSettings({ SQL_REQUEST_TIMEOUT_MS: timeout }), timeout).toThrow(/SQL_REQUEST_TIMEOUT_MS/);
    expect(readSqlSettings({ SQL_REQUEST_TIMEOUT_MS: "1000" }).requestTimeout).toBe(1000);
    for (const size of ["1", "101", "2.5", "many"])
      expect(() => readSqlSettings({ SQL_POOL_SIZE: size }), size).toThrow(/SQL_POOL_SIZE/);
    expect(readSqlSettings({ SQL_POOL_SIZE: "2" }).poolSize).toBe(2);
    expect(() => readSqlSettings({ SQL_USER: "touchline" })).toThrow(/both SQL_USER and SQL_PASSWORD/);
    expect(() => readSqlSettings({ SQL_PASSWORD: "test-only" })).toThrow(/both SQL_USER and SQL_PASSWORD/);
  });

  it("validates schema names, including the 63-character limit and system schemas", () => {
    expect(MAX_IDENTIFIER_LENGTH).toBe(63);
    expect(validateSqlSchema("public")).toBe("public");
    expect(validateSqlSchema(`s${"a".repeat(62)}`)).toHaveLength(63);
    for (const schema of [`s${"a".repeat(63)}`, "", "1world", "_world", "a.b", 'bad"name', "bad-name", "bad name", "wörld"])
      expect(() => validateSqlSchema(schema), schema).toThrow(/at most 63 characters/);
    for (const schema of ["pg_catalog", "pg_toast", "PG_temp_1", "pg_world", "information_schema", "INFORMATION_SCHEMA"])
      expect(() => validateSqlSchema(schema), schema).toThrow(/system schema/);
    expect(() => readSqlSettings({ SQL_SCHEMA: "pg_catalog" })).toThrow(/system schema/);
  });

  it("requires an isolated touchline_test_ or touchline_e2e_ schema in test mode", () => {
    for (const schema of ["public", "accounts", "touchline_user_1", "touchline_testx", "Touchline_test_x"])
      expect(() => validateSqlSchema(schema, true), schema).toThrow(/isolated/);
    expect(validateSqlSchema("touchline_test_x", true)).toBe("touchline_test_x");
    expect(validateSqlSchema("touchline_e2e_x", true)).toBe("touchline_e2e_x");
    expect(() => readSqlSettings({ SQL_TEST_MODE: "true" })).toThrow(/isolated/);
    expect(readSqlSettings({ SQL_TEST_MODE: "TRUE", SQL_SCHEMA: "public" }).testMode).toBe(false);
  });

  it("requires both explicit confirmations before tests touch a non-loopback host", () => {
    const remote = {
      SQL_HOST: "db.example.com",
      SQL_DATABASE: "touchline",
      SQL_TEST_MODE: "true",
      SQL_SCHEMA: "touchline_test_config",
    };
    expect(() => readSqlSettings(remote)).toThrow(/Remote tests require/);
    expect(() => readSqlSettings({ ...remote, SQL_ALLOW_REMOTE_TESTS: "true" })).toThrow(/Remote tests require/);
    expect(() => readSqlSettings({ ...remote, SQL_ALLOW_REMOTE_TESTS: "true", SQL_TEST_DATABASE: "other" }))
      .toThrow(/Remote tests require/);
    expect(() => readSqlSettings({ ...remote, SQL_ALLOW_REMOTE_TESTS: "1", SQL_TEST_DATABASE: "touchline" }))
      .toThrow(/Remote tests require/);
    expect(readSqlSettings({ ...remote, SQL_ALLOW_REMOTE_TESTS: "true", SQL_TEST_DATABASE: "touchline" }).schema)
      .toBe(remote.SQL_SCHEMA);
    // A container-network name is local for TLS purposes but is still not loopback for tests.
    expect(() => readSqlSettings({ ...remote, SQL_HOST: "postgres" })).toThrow(/Remote tests require/);
    for (const host of ["localhost", "127.0.0.1", "::1"])
      expect(readSqlSettings({ ...remote, SQL_HOST: host }).testMode).toBe(true);
  });
});

describe("SQL startup error reporting (no database)", () => {
  it("reports nested causes with SQLSTATE codes and redacts passwords, tokens and secrets", () => {
    const login = Object.assign(new Error('password authentication failed for user "touchline" (pw-value)'), {
      code: "28P01",
      detail: "token-value was rejected",
    });
    const failure = Object.assign(new Error("Connection to postgresql://touchline:pw-value@db.example.com/touchline failed"), {
      cause: login,
    });
    const messages = describeSqlError(failure, {
      SQL_PASSWORD: "pw-value",
      GITHUB_TOKEN: "token-value",
      CLIENT_SECRET: "secret-value",
      SQL_USER: "touchline",
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toBe("Error: Connection to postgresql://[redacted]@db.example.com/touchline failed");
    expect(messages[1]).toContain("Error: 28P01: password authentication failed");
    expect(messages[1]).toContain("[redacted] was rejected");
    expect(messages.join(" ")).not.toMatch(/pw-value|token-value|secret-value/);
    expect(messages.join(" ")).toContain('user "touchline"');
  });

  it("redacts connection URLs even without a configured secret and prefers longer secrets first", () => {
    expect(describeSqlError(new Error("postgres://admin:hunter2@host/db"), {}))
      .toEqual(["Error: postgresql://[redacted]@host/db"]);
    expect(describeSqlError(new Error("abc-long and abc"), { SHORT_PASSWORD: "abc", LONG_PASSWORD: "abc-long" }))
      .toEqual(["Error: [redacted] and [redacted]"]);
  });

  it("walks aggregate errors, bounds depth and size, and survives cycles", () => {
    const aggregate = new AggregateError(
      [Object.assign(new Error("first"), { code: "ECONNREFUSED" }), new Error("second")],
      "all connection attempts failed",
    );
    expect(describeSqlError(aggregate, {})).toEqual([
      "AggregateError: all connection attempts failed",
      "Error: ECONNREFUSED: first",
      "Error: second",
    ]);
    const cyclic: Error & { cause?: unknown } = new Error("loop");
    cyclic.cause = cyclic;
    expect(describeSqlError(cyclic, {})).toEqual(["Error: loop"]);
    let deep: Error = new Error("level 0");
    for (let level = 1; level < 10; level++) deep = new Error(`level ${level}`, { cause: deep });
    expect(describeSqlError(deep, {})).toHaveLength(5);
    expect(describeSqlError(new Error("x".repeat(5000)), {})[0]).toHaveLength(2048);
    expect(describeSqlError("not an error", {})).toEqual(["Unknown SQL startup error."]);
    expect(describeSqlError(undefined, {})).toEqual(["Unknown SQL startup error."]);
  });
});

describe("SQL pool configuration (no database)", () => {
  it("maps settings to a small UTC pg pool with statement and idle-transaction timeouts", () => {
    const configuration = sqlPoolConfig(readSqlSettings({
      SQL_HOST: "localhost",
      SQL_PORT: "54330",
      SQL_DATABASE: "touchline_checks",
      SQL_USER: "local-user",
      SQL_PASSWORD: "test-only",
      SQL_REQUEST_TIMEOUT_MS: "5000",
      SQL_POOL_SIZE: "3",
    }));
    expect(configuration).toMatchObject({
      host: "localhost",
      port: 54330,
      database: "touchline_checks",
      user: "local-user",
      password: "test-only",
      ssl: false,
      max: 3,
      idleTimeoutMillis: 60_000,
      keepAlive: true,
      statement_timeout: 5000,
      idle_in_transaction_session_timeout: 60_000,
      application_name: "Touchline",
      options: "-c TimeZone=UTC",
    });
    expect(sqlPoolConfig(readSqlSettings({ SQL_REQUEST_TIMEOUT_MS: "900000" }))).toMatchObject({
      statement_timeout: 900000,
      idle_in_transaction_session_timeout: 1_800_000,
    });
  });

  it("uses credentials only when both were provided", () => {
    const configuration = sqlPoolConfig(readSqlSettings({}));
    expect(configuration.user).toBeUndefined();
    expect(configuration.password).toBeUndefined();
  });

  it("maps SQL_SSL to pg TLS options", () => {
    expect(sqlPoolConfig(readSqlSettings({ SQL_SSL: "disable" })).ssl).toBe(false);
    expect(sqlPoolConfig(readSqlSettings({ SQL_SSL: "require" })).ssl).toEqual({ rejectUnauthorized: false });
    expect(sqlPoolConfig(readSqlSettings({ SQL_HOST: "db.example.com" })).ssl).toEqual({ rejectUnauthorized: true });
  });

  it("parses counts and numerics as numbers, dates as text and UTC timestamps as Dates", () => {
    const types = sqlPoolConfig(readSqlSettings({})).types!;
    const parser = (oid: number) => types.getTypeParser(oid, "text") as (value: string) => unknown;
    expect(parser(20)("9007199254740991")).toBe(9007199254740991);
    expect(parser(1700)("12.50")).toBe(12.5);
    expect(parser(1082)("2026-09-21")).toBe("2026-09-21");
    expect(parser(1114)("2026-09-21 10:11:12.345")).toEqual(new Date("2026-09-21T10:11:12.345Z"));
    expect(parser(16)("t")).toBe(true);
    expect(parser(23)("42")).toBe(42);
  });
});

describe("SQL schema contract (no database)", () => {
  const schema = "touchline_test_schema_contract";
  const migrations = schemaMigrations(schema);
  const statements = migrations.flatMap((migration) => migration.statements);
  const declaration = (table: string) => statements[WORLD_TABLES.indexOf(table as (typeof WORLD_TABLES)[number])];

  it("keeps all world tables in foreign-key dependency order, without saves or migrations", () => {
    expect(WORLD_TABLES).toHaveLength(34);
    expect(new Set(WORLD_TABLES).size).toBe(WORLD_TABLES.length);
    for (const table of ["save_slots", "save_chunks", "schema_migrations"]) {
      expect(WORLD_TABLES).not.toContain(table);
      expect(STORE_TABLES.has(table)).toBe(true);
    }
    for (const table of IDENTITY_TABLES) expect(WORLD_TABLES).toContain(table);
    const seen = new Set<string>();
    for (const [offset, table] of WORLD_TABLES.entries()) {
      const statement = statements[offset];
      expect(statement.startsWith(`CREATE TABLE IF NOT EXISTS "${schema}"."${table}" (`)).toBe(true);
      for (const match of statement.matchAll(/REFERENCES "([^"]+)"\."([^"]+)"/g)) {
        expect(match[1]).toBe(schema);
        expect(match[2] === table || seen.has(match[2]), `${table} depends on ${match[2]}`).toBe(true);
      }
      expect(statement.includes("id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY"), table)
        .toBe(IDENTITY_TABLES.has(table));
      seen.add(table);
    }
  });

  it("is one PostgreSQL baseline, scoped to the selected schema, with no T-SQL left", () => {
    expect(migrations.map((migration) => migration.version)).toEqual([1]);
    expect(migrations[0].name).toBe("PostgreSQL world baseline");
    expect(migrationTableSql(schema)).toContain(`CREATE TABLE IF NOT EXISTS "${schema}"."schema_migrations"`);
    for (const statement of statements) {
      expect(statement).not.toMatch(
        /\[|N'|NVARCHAR|VARBINARY|UNIQUEIDENTIFIER|DATETIME2|\bBIT\b|FLOAT\(|IDENTITY\(|OBJECT_ID|\bsys\.|\bdbo\b|\bGO\b|PERSISTED|OPENJSON|JSON_VALUE|\bREAL\b|SYSUTCDATETIME/,
      );
      expect(statement).toContain(`"${schema}".`);
      expect(statement).not.toMatch(/\b(?:TABLE|ON|REFERENCES|INTO)\s+(?:IF NOT EXISTS\s+)?(?!IF\b|"|DELETE\b|UPDATE\b)[a-z_]+\s*[(\s]/i);
    }
    const sql = statements.join("\n");
    expect(sql).toContain(`CREATE OR REPLACE TRIGGER clear_transferred_squad BEFORE UPDATE OF club_id ON "${schema}"."players"`);
    expect(sql).toContain("IF NEW.club_id IS DISTINCT FROM OLD.club_id THEN");
    expect(sql).toContain("SET search_path = pg_catalog");
    expect(sql).toContain("playing_club_id INTEGER GENERATED ALWAYS AS (COALESCE(squad_club_id, club_id)) STORED");
    expect(sql).toContain("notification_key TEXT\n          GENERATED ALWAYS AS (data::jsonb ->> 'notificationKey') STORED");
    expect(sql).not.toContain("notification_unkeyed_id");
  });

  it("creates every index idempotently on schema-qualified tables", () => {
    const indexes = statements.filter((statement) => /^CREATE (?:UNIQUE )?INDEX/.test(statement));
    expect(indexes.length).toBeGreaterThan(30);
    const names = new Set<string>();
    for (const statement of indexes) {
      const match = statement.match(
        /^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS "([a-z_]+)" ON "([^"]+)"\."([a-z_]+)" \(([^;]+?)\)(?: WHERE ([^;]+))?;$/,
      );
      expect(match, statement).not.toBeNull();
      expect(match![2]).toBe(schema);
      expect(STORE_TABLES.has(match![3])).toBe(true);
      expect(match![4]).not.toMatch(/\b(?:data|profile|stats|body|terms)\b/);
      names.add(match![1]);
    }
    expect(names.size).toBe(indexes.length);
    expect(indexes).toContain(
      `CREATE UNIQUE INDEX IF NOT EXISTS "news_notification_key" ON "${schema}"."news" (notification_key) WHERE notification_key IS NOT NULL;`,
    );
    expect(indexes).toContain(`CREATE INDEX IF NOT EXISTS "player_name" ON "${schema}"."players" (lower(name));`);
  });

  it("uses double precision for fractional values and integers for ids, counts and rounded estimates", () => {
    for (const [table, columns] of [
      ["countries", ["reputation"]],
      ["leagues", ["reputation"]],
      ["clubs", ["reputation", "facilities", "balance"]],
      ["staff", ["ability", "tactical_knowledge"]],
      ["players", ["ability", "potential", "value", "wage"]],
    ] as const)
      for (const column of columns)
        expect(declaration(table), `${table}.${column}`).toMatch(new RegExp(`\\b${column} DOUBLE PRECISION NOT NULL`));
    for (const [table, columns] of [
      ["leagues", ["tier"]],
      ["clubs", ["country_id", "academy", "expectations", "capacity"]],
      ["staff", ["influence", "communication", "ambition"]],
      ["players", ["age", "volatility", "goals", "assists", "appearances", "minutes", "knowledge", "intensity", "shortlisted", "listed", "available_loan"]],
      ["standings", ["played", "wins", "draws", "losses", "gf", "ga", "points", "deducted"]],
      ["fixtures", ["season", "round"]],
      ["reports", ["accuracy", "ability_low", "ability_high", "potential_low", "potential_high", "fit", "risk"]],
      ["news", ["read"]],
      ["negotiations", ["public"]],
      ["financial_periods", ["closed"]],
      ["player_match_appearances", ["started"]],
      ["training_plans", ["intensity"]],
      ["set_pieces", ["risk"]],
    ] as const)
      for (const column of columns)
        expect(declaration(table), `${table}.${column}`).toMatch(new RegExp(`\\b${column} INTEGER NOT NULL`));
    for (const table of WORLD_TABLES)
      expect(declaration(table)).not.toMatch(/\b(?:VARCHAR|CHAR|FLOAT|NUMERIC|SMALLINT|JSONB?)\b/i);
  });

  it("defines the exact chunked-save storage contract", () => {
    const saves = statements.filter((statement) => /save_(?:slots|chunks)/.test(statement)).join("\n");
    for (const definition of [
      "id UUID NOT NULL PRIMARY KEY",
      "name TEXT NOT NULL",
      "career_id TEXT NULL",
      "career_metadata TEXT NULL",
      "created_at TIMESTAMPTZ NOT NULL",
      "automatic BOOLEAN NOT NULL",
      "imported BOOLEAN NOT NULL DEFAULT false",
      "format_version INTEGER NOT NULL",
      "byte_length BIGINT NOT NULL DEFAULT 0",
      "sha256 TEXT NULL",
      "complete BOOLEAN NOT NULL DEFAULT false",
      "ordinal INTEGER NOT NULL",
      "data BYTEA NOT NULL",
      "PRIMARY KEY (save_id, ordinal)",
      `REFERENCES "${schema}"."save_slots"(id) ON DELETE CASCADE`,
      `ALTER TABLE "${schema}"."save_chunks" ALTER COLUMN data SET STORAGE EXTERNAL;`,
    ])
      expect(saves).toContain(definition);
  });

  it("backfills both lineups and benches from fixture JSON with duplicate protection", () => {
    const backfill = appearanceBackfill(schema);
    expect(backfill).toHaveLength(4);
    for (const [index, [side, group]] of [
      ["home", "lineup"],
      ["home", "bench"],
      ["away", "lineup"],
      ["away", "bench"],
    ].entries()) {
      const statement = backfill[index];
      expect(statement).toContain(`'{snapshot,${side},${group}}'`);
      expect(statement).toContain(`fixture.${side}_id AS club_id`);
      expect(statement).toContain(`${group === "lineup" ? 1 : 0} AS started`);
      expect(statement).toContain("ROW_NUMBER() OVER (PARTITION BY fixture.id");
      expect(statement).toContain("'substitutions'");
      expect(statement).toContain("IN ('red card', 'injury')");
      expect(statement).toContain("ON CONFLICT (fixture_id, player_id) DO NOTHING");
      for (const reference of [
        `FROM "${schema}"."fixtures" AS fixture`,
        `INNER JOIN "${schema}"."players" AS player`,
        `INSERT INTO "${schema}"."player_match_appearances"`,
      ])
        expect(statement).toContain(reference);
      expect(statement).not.toMatch(/\b(?:FROM|JOIN|INTO)\s+(?:fixtures|players|player_match_appearances)\b/i);
      expect(statement).not.toMatch(/OPENJSON|JSON_VALUE|TRY_CONVERT|NOT EXISTS/);
    }
  });

  it("quotes identifiers and literals without allowing an escape", () => {
    expect(quoteIdentifier('test"name')).toBe('"test""name"');
    expect(quoteIdentifier("a".repeat(63))).toBe(`"${"a".repeat(63)}"`);
    for (const name of ["", "a".repeat(64), "bad\0name"])
      expect(() => quoteIdentifier(name)).toThrow("Invalid SQL identifier");
    expect(tableName("touchline_test_x", "players")).toBe('"touchline_test_x"."players"');
    expect(sqlLiteral("it's")).toBe("'it''s'");
    expect(() => sqlLiteral("bad\0value")).toThrow("Invalid SQL literal");
  });
});

type Reply = (text: string, values?: unknown[]) => unknown[] | undefined | Promise<unknown[] | undefined>;

/** A Store over a fake pg pool: records every query per connection and fails on overlapping queries. */
function fakeStore(reply: Reply = () => [], schema = "touchline_test_fake") {
  const queries: { client: number; text: string; values?: unknown[] }[] = [];
  const released: { client: number; error?: unknown }[] = [];
  const idle: FakeClient[] = [];
  let created = 0;
  class FakeClient {
    readonly id = ++created;
    private busy = false;
    async query(input: string | { text: string; values?: unknown[] }) {
      if (this.busy) throw new Error("Concurrent queries on one connection.");
      this.busy = true;
      const text = typeof input === "string" ? input : input.text;
      const values = typeof input === "string" ? undefined : input.values;
      queries.push({ client: this.id, text, values });
      try {
        await Promise.resolve();
        const rows = (await reply(text, values)) ?? [];
        return { rows, rowCount: rows.length };
      } finally {
        this.busy = false;
      }
    }
    release(error?: unknown) {
      released.push({ client: this.id, error });
      if (!error) idle.push(this);
    }
  }
  const pool = {
    connect: vi.fn(async () => idle.pop() ?? new FakeClient()),
    end: vi.fn(async () => {}),
  };
  const store = Reflect.construct(Store, [
    { database: "touchline", schema, testMode: true },
    pool,
    new WeakMap(),
  ]) as Store;
  const texts = (client?: number) =>
    queries.filter((query) => client === undefined || query.client === client).map((query) => query.text);
  return { store, pool, queries, released, texts };
}

const worldKey = (schema = "touchline_test_fake") => advisoryLockKey(`touchline:world:${schema}`);
const isLock = (text: string) => text.includes("pg_advisory_xact_lock");

describe("SQL Store transactions (fake pool, no database)", () => {
  it("runs a writer transaction on one connection: search_path, BEGIN, exclusive world lock, serialized statements, COMMIT", async () => {
    const fake = fakeStore();
    const result = await fake.store.transaction(async () => {
      await fake.store.run("UPDATE players SET morale = ?", 1);
      await Promise.all([fake.store.all("SELECT 1"), fake.store.all("SELECT 2"), fake.store.setMeta("restore", { stage: 1 })]);
      return fake.store.transaction(async () => 73);
    });
    expect(result).toBe(73);
    expect(fake.pool.connect).toHaveBeenCalledOnce();
    const [search, begin, lock, ...rest] = fake.texts();
    expect(search).toBe('SET search_path TO "touchline_test_fake"');
    expect(begin).toBe("BEGIN");
    expect(lock).toContain("SET LOCAL lock_timeout = '30s'");
    expect(lock).toContain(`SELECT pg_advisory_xact_lock(${worldKey()});`);
    expect(lock).toContain("SET LOCAL lock_timeout = DEFAULT");
    expect(rest).toEqual([
      "UPDATE players SET morale = $1",
      "SELECT 1",
      "SELECT 2",
      "INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      "COMMIT",
    ]);
    expect(fake.queries.at(-2)?.values).toEqual(["restore", '{"stage":1}']);
    expect(fake.released).toEqual([{ client: 1, error: undefined }]);
    await fake.store.close();
  });

  it("locks writes that return rows through all() or get(), but not plain reads", async () => {
    const fake = fakeStore((text) => (text.startsWith("DELETE") ? [{ id: 9 }] : []));
    expect(await fake.store.get("DELETE FROM news WHERE id = ? RETURNING id", 9)).toEqual({ id: 9 });
    expect(fake.texts().slice(1)).toEqual([
      "BEGIN",
      expect.stringContaining(`pg_advisory_xact_lock(${worldKey()})`),
      "DELETE FROM news WHERE id = $1 RETURNING id",
      "COMMIT",
    ]);
    const before = fake.queries.length;
    await fake.store.all("SELECT id FROM news WHERE id = ?", 9);
    expect(fake.texts().slice(before)).toEqual(["SELECT id FROM news WHERE id = $1"]);
    await fake.store.close();
  });

  it("keeps each pooled connection's search_path in step with the store using it", async () => {
    const fake = fakeStore();
    const scoped = fake.store.forSchema("touchline_test_fake_other");
    await fake.store.all("SELECT 1");
    await fake.store.all("SELECT 2");
    await scoped.all("SELECT 3");
    await scoped.transaction(() => scoped.all("SELECT 4"));
    await fake.store.all("SELECT 5");
    expect(fake.texts()).toEqual([
      'SET search_path TO "touchline_test_fake"',
      "SELECT 1",
      "SELECT 2",
      'SET search_path TO "touchline_test_fake_other"',
      "SELECT 3",
      "BEGIN",
      expect.stringContaining(`pg_advisory_xact_lock(${worldKey("touchline_test_fake_other")})`),
      "SELECT 4",
      "COMMIT",
      'SET search_path TO "touchline_test_fake"',
      "SELECT 5",
    ]);
    expect(fake.pool.connect).toHaveBeenCalledTimes(5);
    expect(new Set(fake.queries.map((query) => query.client)).size).toBe(1);
    await fake.store.close();
  });

  it("readTransaction() runs readers side by side under the shared lock and refuses every write before SQL", async () => {
    const fake = fakeStore((text) => (text.includes("pg_tables") ? WORLD_TABLES.map((name) => ({ name })) : []));
    const gate = latch();
    let inside = 0;
    let overlap = 0;
    const reader = () =>
      fake.store.readTransaction(async () => {
        overlap = Math.max(overlap, ++inside);
        await fake.store.all("SELECT 1");
        await gate.opened;
        inside--;
        return fake.store.transaction(async () => 7);
      });
    const readers = Promise.all([reader(), reader()]);
    await vi.waitFor(() => expect(overlap).toBe(2));
    gate.open();
    expect(await readers).toEqual([7, 7]);
    const locks = fake.queries.filter((query) => isLock(query.text));
    expect(locks).toHaveLength(2);
    expect(new Set(locks.map((query) => query.client)).size).toBe(2);
    for (const lock of locks) expect(lock.text).toContain(`pg_advisory_xact_lock_shared(${worldKey()})`);
    expect(fake.texts().filter((text) => text.startsWith("BEGIN"))).toEqual(["BEGIN READ ONLY", "BEGIN READ ONLY"]);

    const before = fake.queries.length;
    for (const write of [
      () => fake.store.run("UPDATE players SET morale = 1"),
      () => fake.store.exec("DELETE FROM news"),
      () => fake.store.all("DELETE FROM news RETURNING id"),
      () => fake.store.get("SELECT nextval('x')"),
      () => fake.store.setMeta("state", {}),
      () => fake.store.bulkInsert("news", [{ title: "x" }]),
    ])
      await expect(fake.store.readTransaction(write)).rejects.toThrow(/read-only SQL transaction cannot write/);
    await expect(fake.store.readTransaction(() => fake.store.clearWorld())).rejects.toThrow(/writer lock/);
    await expect(fake.store.readTransaction(() => fake.store.discardWorld())).rejects.toThrow(/writer lock/);
    expect(fake.texts().slice(before).filter((text) => /UPDATE|DELETE|INSERT|TRUNCATE|nextval/.test(text))).toEqual([]);

    const writer = fake.queries.length;
    await fake.store.transaction(() => fake.store.readTransaction(() => fake.store.exec("UPDATE players SET morale = 2")));
    const written = fake.texts().slice(writer);
    expect(written.filter((text) => text.startsWith("BEGIN"))).toEqual(["BEGIN"]);
    expect(written.find(isLock)).toContain(`pg_advisory_xact_lock(${worldKey()})`);
    expect(written).toContain("UPDATE players SET morale = 2");
    await fake.store.close();
  });

  it("batched() commits each statement on its own while one idle transaction holds the world lock", async () => {
    const fake = fakeStore();
    await fake.store.batched(() =>
      fake.store.transaction(async () => {
        await fake.store.exec("UPDATE players SET morale = 1");
        await fake.store.exec("UPDATE players SET morale = 2");
        await fake.store.readTransaction(() => fake.store.exec("UPDATE players SET morale = 3"));
      }),
    );
    const holder = fake.queries[0].client;
    expect(fake.texts(holder)).toEqual([
      "BEGIN",
      expect.stringContaining(`pg_advisory_xact_lock(${worldKey()})`),
      "ROLLBACK",
    ]);
    const statements = fake.queries.filter((query) => query.text.startsWith("UPDATE"));
    expect(statements).toHaveLength(3);
    expect(statements.every((query) => query.client !== holder)).toBe(true);
    expect(fake.queries.filter((query) => isLock(query.text)).map((query) => query.client)).toEqual([holder]);
    expect(fake.texts().filter((text) => text === "COMMIT")).toHaveLength(3);
    expect(fake.texts().at(-1)).toBe("ROLLBACK");
    await fake.store.close();
  });

  it("batched() inside a transaction stays one atomic transaction", async () => {
    const fake = fakeStore();
    await fake.store.transaction(() =>
      fake.store.batched(() => fake.store.exec("UPDATE players SET morale = 3")),
    );
    expect(fake.pool.connect).toHaveBeenCalledOnce();
    expect(fake.texts().filter((text) => text === "COMMIT")).toHaveLength(1);
    expect(fake.texts()).not.toContain("ROLLBACK");
    await fake.store.close();
  });

  it("does not call a transaction body when the writer lock times out", async () => {
    const fake = fakeStore((text) => {
      if (isLock(text)) throw sqlError("55P03", "canceling statement due to lock timeout");
      return [];
    });
    const callback = vi.fn(async () => {});
    const failure = (await fake.store.transaction(callback).catch((error: unknown) => error)) as Error;
    expect(failure.message).toBe("Touchline lock touchline:world:touchline_test_fake could not be acquired.");
    expect(isLockTimeout(failure.cause)).toBe(true);
    expect(callback).not.toHaveBeenCalled();
    expect(fake.texts().at(-1)).toBe("ROLLBACK");
    expect(fake.released).toEqual([{ client: 1, error: undefined }]);
    await fake.store.close();
  });

  it("rolls back, without committing, after a caught SQL failure and rejects later statements with it", async () => {
    const broken = sqlError("23505", "duplicate key value violates unique constraint");
    const fake = fakeStore((text) => {
      if (text === "BROKEN") throw broken;
      return [];
    });
    const later = vi.fn();
    const failure = await fake.store.transaction(async () => {
      await expect(fake.store.all("BROKEN")).rejects.toBe(broken);
      await expect(fake.store.all("SELECT after_failure")).rejects.toBe(broken);
      later();
    }).catch((error: unknown) => error);
    expect(failure).toBe(broken);
    expect(later).toHaveBeenCalledOnce();
    expect(fake.texts()).not.toContain("SELECT after_failure");
    expect(fake.texts()).not.toContain("COMMIT");
    expect(fake.texts().at(-1)).toBe("ROLLBACK");
    await fake.store.close();
  });

  it("rolls back even when an inner transaction exception is caught by the caller", async () => {
    const fake = fakeStore();
    await expect(
      fake.store.transaction(async () => {
        await fake.store.exec("UPDATE players SET morale = 1");
        await expect(
          fake.store.transaction(async () => {
            throw new Error("restore failed");
          }),
        ).rejects.toThrow("restore failed");
      }),
    ).rejects.toThrow("restore failed");
    expect(fake.texts()).toContain("ROLLBACK");
    expect(fake.texts()).not.toContain("COMMIT");
    await fake.store.close();
  });

  it("reports both failures and destroys the connection when ROLLBACK also fails", async () => {
    const fake = fakeStore((text) => {
      if (text === "BROKEN") throw sqlError("23503");
      if (text === "ROLLBACK") throw new Error("Connection terminated unexpectedly");
      return [];
    });
    const failure = await fake.store.transaction(() => fake.store.exec("BROKEN")).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).message).toBe("SQL operation and rollback both failed.");
    expect((failure as AggregateError).errors.map((error: Error) => error.message)).toEqual([
      "SQL error 23503",
      "Connection terminated unexpectedly",
    ]);
    expect(fake.released).toEqual([{ client: 1, error: true }]);
    await fake.store.all("SELECT 1");
    expect(fake.queries.at(-2)).toMatchObject({ client: 2, text: 'SET search_path TO "touchline_test_fake"' });
    await fake.store.close();
  });

  it("destroys a connection after a connection-level failure but returns it after a SQL error", async () => {
    const socket = new Error("Connection terminated");
    const fake = fakeStore((text) => {
      if (text === "SELECT socket") throw socket;
      if (text === "SELECT invalid") throw sqlError("42601");
      return [];
    });
    await expect(fake.store.all("SELECT invalid")).rejects.toMatchObject({ code: "42601" });
    await expect(fake.store.all("SELECT socket")).rejects.toBe(socket);
    expect(fake.released).toEqual([
      { client: 1, error: undefined },
      { client: 1, error: socket },
    ]);
    await fake.store.all("SELECT 1");
    expect(fake.texts(2)).toEqual(['SET search_path TO "touchline_test_fake"', "SELECT 1"]);
    await fake.store.close();
  });

  it("rejects database work retained in an async context after its transaction completes", async () => {
    const fake = fakeStore();
    const gate = latch();
    let delayed!: Promise<unknown>;
    await fake.store.transaction(async () => {
      delayed = gate.opened.then(async () => fake.store.get("SELECT too_late"));
    });
    const assertion = expect(delayed).rejects.toThrow(/already completed/);
    gate.open();
    await assertion;
    expect(fake.texts()).not.toContain("SELECT too_late");
    await fake.store.close();
  });

  it("allows several statements only without parameters", async () => {
    const fake = fakeStore();
    await fake.store.exec("CREATE TEMP TABLE a (x int); DROP TABLE a;");
    expect(fake.texts()).toContain("CREATE TEMP TABLE a (x int); DROP TABLE a;");
    await expect(fake.store.all("SELECT ?; SELECT 2", 1)).rejects.toThrow(/exactly one statement/);
    await expect(fake.store.run("UPDATE players SET morale = ?; DELETE FROM news", 1)).rejects.toThrow(/exactly one statement/);
    expect(fake.texts().some((text) => text.includes("$1"))).toBe(false);
    await fake.store.close();
  });
});

describe("SQL Store mutations (fake pool, no database)", () => {
  it("returns the generated id of identity inserts by appending RETURNING id", async () => {
    const fake = fakeStore((text) => (text.includes("RETURNING") ? [{ id: 5 }, { id: 7 }] : []));
    expect(await fake.store.run("INSERT INTO countries (code) VALUES (?), (?)", "A", "B"))
      .toEqual({ changes: 2, lastInsertRowid: 7 });
    expect(fake.queries.find((query) => query.text.startsWith("INSERT"))).toMatchObject({
      text: "INSERT INTO countries (code) VALUES ($1), ($2)\nRETURNING id",
      values: ["A", "B"],
    });
    await fake.store.run("INSERT INTO news (title) VALUES (?);  \n", "x");
    expect(fake.texts()).toContain("INSERT INTO news (title) VALUES ($1)\nRETURNING id");
    await fake.store.run("INSERT INTO news (title) VALUES (?) RETURNING id, title", "x");
    expect(fake.texts()).toContain("INSERT INTO news (title) VALUES ($1) RETURNING id, title");
    expect(fake.texts().filter((text) => text.includes("setval"))).toEqual([]);
    await fake.store.close();
  });

  it("re-syncs the identity sequence after explicit ids, also through all() and exec()", async () => {
    const fake = fakeStore((text) => (text.includes("RETURNING") ? [{ id: "42" }] : []));
    expect(await fake.store.run("INSERT INTO countries (id, code) VALUES (?, ?)", 42, "X"))
      .toEqual({ changes: 1, lastInsertRowid: 42 });
    await fake.store.exec("INSERT INTO players (id, name) VALUES (1, 'a')");
    await fake.store.all("INSERT INTO news (id, title) VALUES (?, ?) RETURNING title", 3, "x");
    const reseeds = fake.queries.filter((query) => query.text.includes("setval"));
    expect(reseeds.map((query) => query.values)).toEqual([
      ['"touchline_test_fake"."countries"'],
      ['"touchline_test_fake"."players"'],
      ['"touchline_test_fake"."news"'],
    ]);
    for (const reseed of reseeds) {
      expect(reseed.text).toMatch(/^SELECT setval\(pg_get_serial_sequence\(\$1, 'id'\), COALESCE\(MAX\(id\), 1\), MAX\(id\) IS NOT NULL\) FROM "touchline_test_fake"\."(?:countries|players|news)"$/);
      const statement = fake.queries.indexOf(reseed) - 1;
      expect(fake.queries[statement].text).toMatch(/^INSERT/);
      expect(fake.queries[statement].client).toBe(reseed.client);
    }
    await fake.store.close();
  });

  it("does not invent ids for non-identity inserts, updates or deletes", async () => {
    const fake = fakeStore((text) => (/^(?:UPDATE|DELETE)/.test(text) ? [{}, {}, {}] : []));
    expect(await fake.store.run("INSERT INTO save_slots (id, name) VALUES (?, ?)", randomUUID(), "slot"))
      .toEqual({ changes: 0, lastInsertRowid: null });
    expect(fake.texts()).toContain("INSERT INTO save_slots (id, name) VALUES ($1, $2)");
    expect(await fake.store.run("UPDATE players SET morale = 75")).toEqual({ changes: 3, lastInsertRowid: null });
    expect(await fake.store.run("DELETE FROM news")).toEqual({ changes: 3, lastInsertRowid: null });
    expect(fake.texts().some((text) => text.includes("RETURNING") || text.includes("setval"))).toBe(false);
    await fake.store.close();
  });

  it("reads, upserts and validates JSON metadata", async () => {
    const fake = fakeStore((text) => (text.startsWith("SELECT value FROM meta") ? [{ value: '{"season":2026}' }] : []));
    expect(await fake.store.meta("world")).toEqual({ season: 2026 });
    await expect(fake.store.setMeta("bad", undefined)).rejects.toThrow(/JSON serializable/);
    await expect(fake.store.setMeta("bad", () => {})).rejects.toThrow(/JSON serializable/);
    const empty = fakeStore();
    await expect(empty.store.meta("missing")).rejects.toThrow("Missing game metadata: missing");
    await Promise.all([fake.store.close(), empty.store.close()]);
  });

  it("requires the writer transaction for clearWorld and truncates world tables with one statement", async () => {
    const tables = ["countries", "meta", "players", "save_slots", "save_chunks", "schema_migrations", "unrelated"];
    const fake = fakeStore((text) => (text.includes("pg_tables") ? tables.map((name) => ({ name })) : []));
    await expect(fake.store.clearWorld()).rejects.toThrow(/requires an active Store.transaction\(\) writer lock/);
    await expect(fake.store.discardWorld()).rejects.toThrow(/requires an active Store.transaction\(\) writer lock/);
    expect(fake.queries).toEqual([]);
    const result = await fake.store.transaction(() => fake.store.clearWorld());
    expect(result).toBeUndefined();
    const truncate = fake.queries.filter((query) => query.text.startsWith("TRUNCATE"));
    expect(truncate.map((query) => query.text)).toEqual([
      'TRUNCATE TABLE "touchline_test_fake"."meta", "touchline_test_fake"."countries", "touchline_test_fake"."players" RESTART IDENTITY;',
    ]);
    expect(new Set(fake.queries.map((query) => query.client)).size).toBe(1);
    expect(fake.queries.find((query) => query.text.includes("pg_tables"))?.values).toEqual(["touchline_test_fake"]);
    expect(await fake.store.batched(() => fake.store.discardWorld())).toEqual({
      truncated: ["meta", "countries", "players"],
      deleted: [],
    });
    await fake.store.close();
  });
});

describe("SQL Store bulk operations (fake pool, no database)", () => {
  const metadata = [
    { name: "id", type: "integer", nullable: false, identity: true, generated: false },
    { name: "target", type: "double precision", nullable: false, identity: false, generated: false },
    { name: "derived", type: "double precision", nullable: true, identity: false, generated: true },
    { name: "due_date", type: "text", nullable: false, identity: false, generated: false },
  ];
  const catalog: Reply = (text) => (text.includes("pg_attribute") ? metadata : []);

  it("returns writable columns in order and caches catalog metadata per table", async () => {
    const fake = fakeStore(catalog);
    expect(await fake.store.columns("promises")).toEqual(["id", "target", "due_date"]);
    expect(await fake.store.columns("PROMISES")).toEqual(["id", "target", "due_date"]);
    expect(fake.queries.filter((query) => query.text.includes("pg_attribute"))).toHaveLength(1);
    expect(fake.queries.find((query) => query.text.includes("pg_attribute"))?.values)
      .toEqual(['"touchline_test_fake"."promises"']);
    for (const table of ["public.promises", "users", "pg_class", '"promises"'])
      await expect(fake.store.columns(table)).rejects.toThrow(/Unknown Touchline table/);
    const missing = fakeStore();
    await expect(missing.store.columns("promises")).rejects.toThrow(/does not exist; call schema\(\) first/);
    await Promise.all([fake.store.close(), missing.store.close()]);
  });

  it("inserts 5000-row unnest batches in one transaction, skips generated columns and reseeds explicit ids", async () => {
    const fake = fakeStore(catalog);
    const rows = Array.from({ length: 12_001 }, (_, index) => ({
      id: index + 100,
      target: index === 0 ? 10n : 1.2345678901234567,
      derived: 2,
      due_date: index === 1 ? undefined : "2026-09-21",
    }));
    await fake.store.bulkInsert("promises", rows);
    const batches = fake.queries.filter((query) => query.text.startsWith("INSERT"));
    expect(batches).toHaveLength(3);
    for (const batch of batches)
      expect(batch.text.replace(/\s+/g, " ")).toBe(
        'INSERT INTO "touchline_test_fake"."promises" ("id", "target", "due_date") SELECT * FROM unnest($1::integer[], $2::double precision[], $3::text[])',
      );
    expect(batches.map((batch) => (batch.values![0] as unknown[]).length)).toEqual([5000, 5000, 2001]);
    expect((batches[0].values![0] as unknown[])[0]).toBe(100);
    expect((batches[0].values![1] as unknown[]).slice(0, 2)).toEqual(["10", 1.2345678901234567]);
    expect((batches[0].values![2] as unknown[]).slice(0, 3)).toEqual(["2026-09-21", null, "2026-09-21"]);
    expect((batches[2].values![0] as unknown[]).at(-1)).toBe(12_100);
    expect(fake.texts().filter((text) => text.includes("setval"))).toHaveLength(1);
    expect(fake.texts().at(-2)).toContain("setval");
    expect(fake.texts().at(-1)).toBe("COMMIT");
    expect(new Set(fake.queries.map((query) => query.client)).size).toBe(1);
    await fake.store.close();
  });

  it("does nothing for no rows and does not reseed without explicit ids", async () => {
    const fake = fakeStore(catalog);
    await fake.store.bulkInsert("promises", []);
    expect(fake.queries).toEqual([]);
    await fake.store.bulkInsert("promises", [{ target: 1, due_date: "2026-01-01" }]);
    expect(fake.texts().some((text) => text.includes("setval"))).toBe(false);
    await fake.store.close();
  });

  it("rejects unknown tables, unknown columns, mismatched row shapes and non-finite numbers before inserting", async () => {
    const fake = fakeStore(catalog);
    await expect(fake.store.bulkInsert("dbo.promises", [{ id: 1 }])).rejects.toThrow(/Unknown Touchline table/);
    await expect(fake.store.bulkInsert("promises", [{ id: 1, nope: 2 }])).rejects.toThrow(/Unknown SQL column promises.nope/);
    await expect(fake.store.bulkInsert("promises", [{ derived: 1 }])).rejects.toThrow(/at least one writable column/);
    for (const rows of [
      [{ id: 1, target: 2, due_date: "x" }, { id: 2, target: 3 }],
      [{ id: 1, target: 2 }, { id: 2, target: 3, due_date: "x" }],
      [{ id: 1, target: 2 }, { id: 2, target: 3, nope: 1 }],
    ])
      await expect(fake.store.bulkInsert("promises", rows)).rejects.toThrow(/same writable columns/);
    await expect(fake.store.bulkInsert("promises", [{ id: 1, target: Number.NaN }])).rejects.toThrow(/finite/);
    expect(fake.texts().some((text) => text.startsWith("INSERT"))).toBe(false);
    expect(fake.texts()).not.toContain("COMMIT");
    await fake.store.close();
  });

  it("rolls back a failed bulk insert as a whole", async () => {
    let batches = 0;
    const fake = fakeStore((text) => {
      if (text.startsWith("INSERT") && ++batches === 2) throw sqlError("23514", "check constraint violated");
      return catalog(text);
    });
    const rows = Array.from({ length: 6000 }, (_, index) => ({ target: index, due_date: "2026-01-01" }));
    await expect(fake.store.bulkInsert("promises", rows)).rejects.toMatchObject({ code: "23514" });
    expect(batches).toBe(2);
    expect(fake.texts()).not.toContain("COMMIT");
    expect(fake.texts().at(-1)).toBe("ROLLBACK");
    await fake.store.close();
  });
});

describe("SQL Store lifecycle (fake pool, no database)", () => {
  it("borrows one pool for scoped stores without changing root scope, environment or transaction state", async () => {
    const fake = fakeStore();
    const configuredSchema = process.env.SQL_SCHEMA;
    const first = fake.store.forSchema("touchline_test_first_account");
    const second = first.forSchema("touchline_test_second_account");
    expect(fake.queries).toEqual([]);
    expect(fake.store.schemaName).toBe("touchline_test_fake");
    expect(process.env.SQL_SCHEMA).toBe(configuredSchema);
    expect(() => Reflect.set(first, "schemaName", "public")).not.toThrow();
    expect(first.schemaName).toBe("touchline_test_first_account");
    expect([first.database, first.testMode]).toEqual(["touchline", true]);
    await Promise.all([
      first.run("UPDATE meta SET value = ? WHERE key = ?", "first", "state"),
      second.run("UPDATE meta SET value = ? WHERE key = ?", "second", "state"),
    ]);
    const locks = fake.queries.filter((query) => isLock(query.text)).map((query) => query.text);
    expect(locks.some((text) => text.includes(`(${worldKey("touchline_test_first_account")})`))).toBe(true);
    expect(locks.some((text) => text.includes(`(${worldKey("touchline_test_second_account")})`))).toBe(true);
    expect(fake.texts()).toContain('SET search_path TO "touchline_test_first_account"');
    expect(fake.texts()).toContain('SET search_path TO "touchline_test_second_account"');
    await first.close();
    expect(fake.pool.end).not.toHaveBeenCalled();
    await expect(first.all("SELECT 1")).rejects.toThrow(/closed/);
    await second.all("SELECT 1");
    await fake.store.close();
    expect(fake.pool.end).toHaveBeenCalledOnce();
    expect(fake.texts().some((text) => /DROP SCHEMA/.test(text))).toBe(false);
    await expect(second.all("SELECT 1")).rejects.toThrow(/closed/);
  });

  it("rejects invalid or live schema scopes before a test store touches SQL", async () => {
    const fake = fakeStore();
    for (const schema of ["public", "accounts", "touchline_user_live", "pg_temp", "a.b", 'bad"name', `touchline_test_${"a".repeat(49)}`])
      expect(() => fake.store.forSchema(schema), schema).toThrow(/SQL_SCHEMA|schema/i);
    expect(fake.store.forSchema(`touchline_test_${"a".repeat(48)}`).schemaName).toHaveLength(63);
    expect(fake.queries).toEqual([]);
    await fake.store.close();
    expect(() => fake.store.forSchema("touchline_test_after_close")).toThrow(/closed/);
  });

  it("waits for scoped transactions before closing the pool and refuses a close inside a transaction", async () => {
    const fake = fakeStore();
    const scoped = fake.store.forSchema("touchline_test_account_close");
    await scoped.transaction(async () => {
      await expect(fake.store.close()).rejects.toThrow(/inside its transaction/);
      await expect(scoped.close()).rejects.toThrow(/inside its transaction/);
    });
    const gate = latch();
    const entered = latch();
    const pending = scoped.transaction(async () => {
      entered.open();
      await gate.opened;
      await scoped.exec("DELETE FROM news");
    });
    await entered.opened;
    const closing = fake.store.close();
    await expect(scoped.all("SELECT 1")).rejects.toThrow(/closed or closing/);
    await pause(10);
    expect(fake.pool.end).not.toHaveBeenCalled();
    gate.open();
    await pending;
    await closing;
    expect(fake.pool.end).toHaveBeenCalledOnce();
    expect(fake.texts()).toContain("DELETE FROM news");
  });

  it("keeps transaction-local context out of concurrent external reads", async () => {
    const fake = fakeStore();
    const gate = latch();
    const entered = latch();
    const work = fake.store.transaction(async () => {
      entered.open();
      await gate.opened;
    });
    await entered.opened;
    await fake.store.all("SELECT outside_transaction");
    const outside = fake.queries.find((query) => query.text === "SELECT outside_transaction")!;
    expect(outside.client).not.toBe(fake.queries[0].client);
    gate.open();
    await work;
    await fake.store.close();
  });

  it("ordinary close never drops a test-prefixed schema it did not create and is idempotent", async () => {
    const fake = fakeStore();
    await Promise.all([fake.store.close(), fake.store.close()]);
    await fake.store.close();
    expect(fake.queries).toEqual([]);
    expect(fake.pool.end).toHaveBeenCalledOnce();
    await expect(fake.store.all("SELECT 1")).rejects.toThrow(/closed/);
    await expect(fake.store.transaction(async () => {})).rejects.toThrow(/closed/);
  });

  it("advisoryLock() requires a transaction and a bounded timeout", async () => {
    const fake = fakeStore();
    await expect(fake.store.advisoryLock("touchline:account-registry")).rejects.toThrow(/requires an active/);
    await fake.store.transaction(async () => {
      await expect(fake.store.advisoryLock("x", { timeout: "1; DROP TABLE x" })).rejects.toThrow(/Invalid lock timeout/);
      await fake.store.advisoryLock("touchline:account-registry", { timeout: "250ms" });
      await fake.store.advisoryLock("touchline:shared", { shared: true, timeout: "2min" });
    });
    const locks = fake.texts().filter(isLock);
    expect(locks[1]).toContain("SET LOCAL lock_timeout = '250ms'");
    expect(locks[1]).toContain(`pg_advisory_xact_lock(${advisoryLockKey("touchline:account-registry")})`);
    expect(locks[2]).toContain(`pg_advisory_xact_lock_shared(${advisoryLockKey("touchline:shared")})`);
    await fake.store.close();
  });

  it("validates configuration before Store.open or Store.createTest connect", async () => {
    const connect = vi.spyOn(pg.Pool.prototype, "connect");
    await expect(Store.open(":memory:")).rejects.toThrow(/not a file path/);
    vi.stubEnv("SQL_HOST", "db.example.com");
    vi.stubEnv("SQL_SSL", "verify-full");
    vi.stubEnv("SQL_ALLOW_REMOTE_TESTS", "false");
    await expect(Store.createTest()).rejects.toThrow(/Remote tests require/);
    vi.stubEnv("SQL_HOST", "postgres");
    await expect(Store.createTest("x", "some_other_database")).rejects.toThrow(/only on local PostgreSQL/);
    vi.stubEnv("SQL_HOST", "127.0.0.1");
    vi.stubEnv("SQL_SERVER", "example.database.windows.net");
    await expect(Store.open()).rejects.toThrow(/retired Azure SQL setup/);
    expect(connect).not.toHaveBeenCalled();
  });
});

const integration = process.env.SQL_INTEGRATION_TESTS === "true";

const countryRow = (code: string) => ({
  code,
  name: `Country ${code}`,
  continent: "Europe",
  confederation: "UEFA",
  reputation: 50,
  language: "Test",
  region: "Test",
});

const clubRow = (name: string, countryId: number) => ({
  name,
  short_name: name.slice(0, 3),
  city: "City",
  country_id: countryId,
  color: "#123456",
  reputation: 50,
  academy: 10,
  facilities: 10,
  balance: 1e6,
  transfer_budget: 1e5,
  wage_budget: 1e4,
  philosophy: "Balanced",
  culture: "Balanced",
  formation: "4-3-3",
  tactical_style: "Balanced",
  chemistry: 50,
  manager: "Manager",
  manager_trust: 50,
  board_confidence: 50,
  board_pressure: 50,
  fan_mood: 50,
  fan_loyalty: 50,
  fan_patience: 50,
  expectations: 5,
  stadium: "Ground",
  capacity: 10000,
});

const playerRow = (name: string, countryId: number, clubId: number | null) => ({
  name,
  nationality: "Test",
  country_id: countryId,
  club_id: clubId,
  position: "MF",
  secondary_position: "MF",
  birth_date: "2000-01-01",
  age: 26,
  age_group: "Senior",
  foot: "Right",
  ability: 60,
  base_potential: 70,
  potential: 70,
  volatility: 5,
  value: 1e6,
  wage: 1e4,
  contract_end: "2028-06-30",
  morale: 50,
  fitness: 90,
  form: 6,
  role: "Rotation",
  profile: "{}",
});

async function insertRow(store: Store, table: string, row: Record<string, unknown>) {
  const columns = Object.keys(row);
  const result = await store.run(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    ...(Object.values(row) as (string | number | null)[]),
  );
  return result.lastInsertRowid!;
}

async function schemaExists(store: Store, schema: string) {
  return Boolean(await store.get("SELECT 1 AS present FROM pg_catalog.pg_namespace WHERE nspname = ?", schema));
}

describe.skipIf(!integration)("SQL Store integration (explicit opt-in, real PostgreSQL)", () => {
  it("createTest creates a unique, fully migrated schema and close drops only that schema", async () => {
    const first = await Store.createTest("Same Label!");
    const second = await Store.createTest(`same label ${"x".repeat(40)}`);
    try {
      expect(first.schemaName).toMatch(/^touchline_test_[a-f0-9]{32}_same_label_$/);
      expect(second.schemaName).toMatch(/^touchline_test_[a-f0-9]{32}_same_label_xxxx$/);
      expect(second.schemaName).toHaveLength(63);
      expect(second.schemaName).not.toBe(first.schemaName);
      expect(first.database).toBe(process.env.SQL_DATABASE ?? "touchline");
      expect(first.testMode).toBe(true);
      expect(await first.worldTables()).toEqual([...WORLD_TABLES]);
      const tables = await first.all<{ name: string }>(
        "SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = ? ORDER BY tablename",
        first.schemaName,
      );
      expect(tables.map((row) => row.name)).toEqual([...STORE_TABLES].sort());
      expect(await first.all("SELECT version, name FROM schema_migrations")).toEqual([
        { version: 1, name: "PostgreSQL world baseline" },
      ]);
      expect(await first.meta("appearanceIndexVersion")).toBe(1);
      expect(await first.get("SELECT current_schema() AS schema, current_setting('TimeZone') AS zone, current_setting('application_name') AS app"))
        .toEqual({ schema: first.schemaName, zone: "UTC", app: "Touchline" });
      await first.close();
      expect(await schemaExists(second, first.schemaName)).toBe(false);
      expect(await schemaExists(second, second.schemaName)).toBe(true);
      await expect(first.all("SELECT 1")).rejects.toThrow(/closed/);
      await first.close();
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });

  it("cleans up a created test schema when its migration fails", async () => {
    const observer = await Store.createTest("observer");
    try {
      let created: string | undefined;
      vi.spyOn(Store.prototype, "schema").mockImplementationOnce(async function (this: Store) {
        created = this.schemaName;
        throw new Error("migration failed");
      });
      await expect(Store.createTest("failure")).rejects.toThrow("migration failed");
      expect(created).toMatch(/^touchline_test_[a-f0-9]{32}_failure$/);
      expect(await schemaExists(observer, created!)).toBe(false);
    } finally {
      await observer.close();
    }
  });

  it("migrates idempotently, refuses newer versions and account-registry schemas", async () => {
    const store = await Store.createTest("migrations");
    try {
      await store.setMeta("kept", "value");
      await store.schema();
      await store.schema();
      expect(await store.all("SELECT version FROM schema_migrations")).toEqual([{ version: 1 }]);
      expect(await store.meta("kept")).toBe("value");
      await store.run("INSERT INTO schema_migrations (version, name) VALUES (?, ?)", 2, "from the future");
      await expect(store.schema()).rejects.toThrow(/migrated by a newer version of Touchline/);
      await store.run("DELETE FROM schema_migrations WHERE version = ?", 2);
      await store.exec("CREATE TABLE users (id uuid)");
      await expect(store.schema()).rejects.toThrow(/account registry schema/);
      expect(await store.all("SELECT version FROM schema_migrations")).toEqual([{ version: 1 }]);
    } finally {
      await store.close();
    }
  });

  it("Store.open connects to the configured schema without migrating or creating it", async () => {
    const schema = `touchline_test_${randomUUID().replaceAll("-", "")}_unopened`;
    vi.stubEnv("SQL_SCHEMA", schema);
    const store = await Store.open();
    try {
      expect(store.schemaName).toBe(schema);
      expect(await store.worldTables()).toEqual([]);
      expect(await schemaExists(store, schema)).toBe(false);
      await expect(store.columns("players")).rejects.toThrow(/does not exist; call schema\(\) first/);
    } finally {
      await store.close();
    }
    const observer = await Store.createTest("observer");
    try {
      expect(await schemaExists(observer, schema)).toBe(false);
    } finally {
      await observer.close();
    }
  });

  it("returns generated ids, re-syncs identities after explicit ids and reports changes", async () => {
    const store = await Store.createTest("identity");
    try {
      const country = countryRow("AAA");
      expect(await store.run(
        "INSERT INTO countries (code, name, continent, confederation, reputation, language, region) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ...Object.values(country),
      )).toEqual({ changes: 1, lastInsertRowid: 1 });
      expect(await store.run(
        "INSERT INTO countries (id, code, name, continent, confederation, reputation, language, region) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        42, "EXP", "Explicit", "Europe", "UEFA", 50, "Test", "Test",
      )).toEqual({ changes: 1, lastInsertRowid: 42 });
      expect(await insertRow(store, "countries", countryRow("AFT"))).toBe(43);
      await store.bulkInsert("countries", [
        { ...countryRow("BLK"), id: 100 },
        { ...countryRow("LOW"), id: 77 },
      ]);
      expect(await insertRow(store, "countries", countryRow("AUT"))).toBe(101);
      await store.exec(
        "WITH source AS (SELECT 200 AS id) INSERT INTO countries (id, code, name, continent, confederation, reputation, language, region) SELECT id, 'CTE', 'Cte', 'Europe', 'UEFA', 50, 'Test', 'Test' FROM source",
      );
      expect(await insertRow(store, "countries", countryRow("NXT"))).toBe(201);
      expect(await store.all<{ id: number }>(
        "INSERT INTO countries (id, code, name, continent, confederation, reputation, language, region) VALUES (?, 'ALL', 'All', 'Europe', 'UEFA', 50, 'Test', 'Test') RETURNING id",
        300,
      )).toEqual([{ id: 300 }]);
      expect(await insertRow(store, "countries", countryRow("ZZZ"))).toBe(301);
      const many = await store.run(
        "INSERT INTO countries (code, name, continent, confederation, reputation, language, region) SELECT code || '2', name, continent, confederation, reputation, language, region FROM countries WHERE id IN (1, 42) ORDER BY id",
      );
      expect(many).toEqual({ changes: 2, lastInsertRowid: 303 });
      expect(await store.run("INSERT INTO countries (code, name, continent, confederation, reputation, language, region) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (code) DO NOTHING", ...Object.values(country)))
        .toEqual({ changes: 0, lastInsertRowid: null });
      expect(await store.run("UPDATE countries SET reputation = reputation + 1 WHERE id < ?", 100)).toEqual({ changes: 4, lastInsertRowid: null });
      expect(await store.run("DELETE FROM countries WHERE code = ?", "ZZZ")).toEqual({ changes: 1, lastInsertRowid: null });
      expect(await store.run("INSERT INTO meta (key, value) VALUES (?, ?)", "k", "1")).toEqual({ changes: 1, lastInsertRowid: null });
      const returned = await store.run("INSERT INTO countries (code, name, continent, confederation, reputation, language, region) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING code", "RET", "Ret", "Europe", "UEFA", 1, "Test", "Test");
      expect(returned).toEqual({ changes: 1, lastInsertRowid: null });
      // The conflicting ON CONFLICT DO NOTHING insert consumed sequence value 304, as PostgreSQL sequences never roll back.
      expect(await store.get("SELECT max(id) AS id FROM countries")).toEqual({ id: 305 });
    } finally {
      await store.close();
    }
  });

  // The appended RETURNING clause must not end up inside a trailing line comment.
  it("returns the generated id when an insert ends with a line comment", async () => {
    const store = await Store.createTest("comment");
    try {
      expect(await store.run(
        "INSERT INTO countries (code, name, continent, confederation, reputation, language, region) VALUES (?, ?, ?, ?, ?, ?, ?) -- new country",
        ...Object.values(countryRow("CMT")),
      )).toEqual({ changes: 1, lastInsertRowid: 1 });
    } finally {
      await store.close();
    }
  });

  it("round-trips PostgreSQL types through parameters and results", async () => {
    const store = await Store.createTest("types");
    try {
      const precise = 1234567890123.4568;
      const promise = await store.run("INSERT INTO promises (type, target, due_date) VALUES (?, ?, ?)", "precision", precise, "2026-09-21");
      expect((await store.get<{ target: number }>("SELECT target FROM promises WHERE id = ?", promise.lastInsertRowid))?.target).toBe(precise);
      const moment = new Date("2026-09-21T10:11:12.345Z");
      const row = await store.get<Record<string, unknown>>(
        `SELECT count(*) AS count, sum(x) AS total, avg(x) AS average, 2.50::numeric AS numeric,
          ?::bigint AS big, ?::boolean AS flag, ?::uuid AS id, ?::timestamptz AS moment,
          '2026-09-21'::date AS day, '2026-09-21 10:11:12'::timestamp AS naive, ?::bytea AS bytes,
          ?::text AS missing, '{"a":[1,2]}'::jsonb AS document, '{"b":true}'::json AS plain,
          ?::int[] AS numbers, ?::text[] AS words, 'ÄÖ ü 🙂' AS unicode
        FROM (VALUES (1), (2), (4)) AS v(x)`,
        9007199254740993n,
        true,
        "8F14E45F-CEEA-467F-A0E6-C6B3B5A1D2F4",
        moment,
        Buffer.from([0, 1, 127, 255]),
        undefined,
        [1, 2, 3],
        ["a", "b c", null],
      );
      expect(row).toEqual({
        count: 3,
        total: 7,
        average: 7 / 3,
        numeric: 2.5,
        big: 9007199254740992,
        flag: true,
        id: "8f14e45f-ceea-467f-a0e6-c6b3b5a1d2f4",
        moment,
        day: "2026-09-21",
        naive: new Date("2026-09-21T10:11:12Z"),
        bytes: Buffer.from([0, 1, 127, 255]),
        missing: null,
        document: { a: [1, 2] },
        plain: { b: true },
        numbers: [1, 2, 3],
        words: ["a", "b c", null],
        unicode: "ÄÖ ü 🙂",
      });
      expect(await store.all("SELECT id FROM promises WHERE id = ANY(?::int[])", [promise.lastInsertRowid!, 999]))
        .toEqual([{ id: promise.lastInsertRowid }]);
      expect(await store.all("SELECT id FROM promises WHERE id = ANY(?::int[])", [])).toEqual([]);
      await expect(store.all("SELECT ?::integer AS x", 12.5)).rejects.toMatchObject({ code: "22P02" });
      await expect(store.all("SELECT ? AS x", Number.NaN)).rejects.toThrow(/finite/);
      await expect(store.all("SELECT $1 AS x")).rejects.toThrow(/Use \? placeholders/);
    } finally {
      await store.close();
    }
  });

  it("bulk inserts bytea, uuid, boolean, timestamptz, bigint and nulls in 5000-row batches", async () => {
    const store = await Store.createTest("bulk");
    try {
      const slots = [
        { id: randomUUID().toUpperCase(), name: "Automatic", career_id: null, career_metadata: null, created_at: new Date("2026-01-02T03:04:05.678Z"), automatic: true, imported: false, format_version: 1, byte_length: 5_000_000_000n, sha256: "a".repeat(64), complete: true },
        { id: randomUUID(), name: "Manual 'quoted' \"name\"", career_id: "career", career_metadata: '{"club":"x"}', created_at: new Date("2026-06-30T23:59:59.999Z"), automatic: false, imported: true, format_version: 2, byte_length: 0, sha256: null, complete: false },
      ];
      await store.bulkInsert("save_slots", slots);
      const stored = await store.all<Record<string, unknown>>(
        "SELECT id, name, career_id, career_metadata, created_at, automatic, imported, format_version, byte_length, sha256, complete FROM save_slots ORDER BY created_at",
      );
      expect(stored).toEqual(slots.map((slot) => ({
        ...slot,
        id: slot.id.toLowerCase(),
        byte_length: Number(slot.byte_length),
      })));
      const chunks = [
        { save_id: slots[0].id, ordinal: 0, data: Buffer.from([0, 1, 127, 255]) },
        { save_id: slots[0].id, ordinal: 1, data: Buffer.alloc(0) },
        { save_id: slots[0].id, ordinal: 2, data: Buffer.from("\\x5c'\"", "utf8") },
      ];
      await store.bulkInsert("save_chunks", chunks);
      expect(await store.all("SELECT ordinal, data FROM save_chunks WHERE save_id = ? ORDER BY ordinal", slots[0].id))
        .toEqual(chunks.map(({ ordinal, data }) => ({ ordinal, data })));

      const history = Array.from({ length: 12_001 }, (_, index) => ({
        season: 2026,
        entity_type: index % 2 ? "player" : "club",
        entity_id: index,
        date: "2026-07-01",
        data: index === 7 ? '{"note":"it\'s ? $1"}' : "{}",
      }));
      await store.bulkInsert("history", history);
      expect(await store.get("SELECT count(*) AS rows, min(id) AS low, max(id) AS high, count(DISTINCT entity_type) AS kinds FROM history"))
        .toEqual({ rows: 12_001, low: 1, high: 12_001, kinds: 2 });
      expect(await store.get("SELECT data FROM history WHERE entity_id = 7")).toEqual({ data: '{"note":"it\'s ? $1"}' });
      expect(await insertRow(store, "history", history[0])).toBe(12_002);

      const country = await insertRow(store, "countries", countryRow("BLK"));
      const club = await insertRow(store, "clubs", clubRow("Bulk FC", country));
      await store.bulkInsert("players", [{ ...playerRow("Generated", country, club), playing_club_id: 999 }]);
      expect(await store.get("SELECT playing_club_id FROM players")).toEqual({ playing_club_id: club });
      await store.bulkInsert("news", [{ date: "2026-07-01", category: "x", title: "t", body: "b", data: '{"notificationKey":"k"}', notification_key: "ignored" }]);
      expect(await store.get("SELECT notification_key FROM news")).toEqual({ notification_key: "k" });

      const failing = Array.from({ length: 6000 }, (_, index) => ({
        type: "bulk", target: index, due_date: index === 5500 ? null : "2026-01-01",
      }));
      await expect(store.bulkInsert("promises", failing)).rejects.toMatchObject({ code: "23502" });
      expect(await store.get("SELECT count(*) AS rows FROM promises")).toEqual({ rows: 0 });
      await expect(store.bulkInsert("save_chunks", [{ save_id: randomUUID(), ordinal: 0, data: Buffer.from([1]) }]))
        .rejects.toSatisfy(isForeignKeyViolation);
    } finally {
      await store.close();
    }
  });

  it("commits, rolls back, propagates errors and joins nested transactions on one connection", async () => {
    const store = await Store.createTest("transactions");
    try {
      await store.setMeta("state", "before");
      const outer = await store.transaction(async () => {
        await store.setMeta("state", "committed");
        const [{ pid, txid }] = await store.all<{ pid: number; txid: number }>("SELECT pg_backend_pid() AS pid, txid_current() AS txid");
        const inner = await store.transaction(() => store.get<{ pid: number; txid: number }>("SELECT pg_backend_pid() AS pid, txid_current() AS txid"));
        const read = await store.readTransaction(() => store.get<{ pid: number }>("SELECT pg_backend_pid() AS pid"));
        expect(inner).toEqual({ pid, txid });
        expect(read).toEqual({ pid });
        return "done";
      });
      expect(outer).toBe("done");
      expect(await store.meta("state")).toBe("committed");

      const thrown = new Error("rollback probe");
      await expect(store.transaction(async () => {
        await store.setMeta("state", "rolled back");
        throw thrown;
      })).rejects.toBe(thrown);
      expect(await store.meta("state")).toBe("committed");

      const duplicate = await store.transaction(async () => {
        await store.setMeta("state", "lost");
        await store.run("INSERT INTO meta (key, value) VALUES (?, ?)", "state", "duplicate");
      }).catch((error: unknown) => error);
      expect(isUniqueViolation(duplicate)).toBe(true);
      expect(await store.meta("state")).toBe("committed");

      await expect(store.transaction(async () => {
        await store.setMeta("state", "caught");
        await expect(store.exec("SELECT 1/0")).rejects.toMatchObject({ code: "22012" });
        // Once a statement failed, the whole transaction is aborted: joining it rethrows the original failure.
        await expect(store.transaction(async () => { throw new Error("inner"); })).rejects.toMatchObject({ code: "22012" });
      })).rejects.toMatchObject({ code: "22012" });
      expect(await store.meta("state")).toBe("committed");

      await expect(store.transaction(async () => {
        await store.setMeta("state", "inner caught");
        await store.transaction(async () => { throw new Error("inner only"); }).catch(() => {});
      })).rejects.toThrow("inner only");
      expect(await store.meta("state")).toBe("committed");

      const counted = await store.transaction(() =>
        Promise.all(Array.from({ length: 20 }, (_, index) => store.setMeta(`parallel_${index}`, index))),
      );
      expect(counted).toHaveLength(20);
      expect(await store.get("SELECT count(*) AS rows FROM meta WHERE key LIKE 'parallel!_%' ESCAPE '!'")).toEqual({ rows: 20 });
      await expect(store.exec("SELECT ?; SELECT 2", 1)).rejects.toThrow(/exactly one statement/);
      await store.exec("INSERT INTO meta (key, value) VALUES ('multi_a', '1'); INSERT INTO meta (key, value) VALUES ('multi_b', '2');");
      expect(await store.all("SELECT key FROM meta WHERE key LIKE 'multi%' ORDER BY key")).toEqual([{ key: "multi_a" }, { key: "multi_b" }]);
    } finally {
      await store.close();
    }
  });

  it("upserts metadata and reports missing keys", async () => {
    const store = await Store.createTest("meta");
    try {
      await store.setMeta("world", { season: 2026, nations: ["PT", "IE"] });
      await store.setMeta("world", { season: 2027, nested: { flag: true, text: "it's ? $1" } });
      expect(await store.meta("world")).toEqual({ season: 2027, nested: { flag: true, text: "it's ? $1" } });
      expect(await store.get("SELECT count(*) AS rows FROM meta WHERE key = 'world'")).toEqual({ rows: 1 });
      await store.setMeta("nothing", null);
      expect(await store.meta("nothing")).toBeNull();
      await expect(store.meta("missing")).rejects.toThrow("Missing game metadata: missing");
    } finally {
      await store.close();
    }
  });

  it("readTransaction() is read-only, shares the world lock between readers and excludes writers", async () => {
    const store = await Store.createTest("read_lock");
    try {
      await store.setMeta("probe", 1);
      await expect(store.readTransaction(() => store.run("UPDATE meta SET value = '2'"))).rejects.toThrow(/read-only/);
      await expect(store.readTransaction(() => store.all("SELECT id INTO snapshot FROM countries"))).rejects.toThrow(/read-only/);
      expect(await store.readTransaction(() => store.get("SELECT current_setting('transaction_read_only') AS ro")))
        .toEqual({ ro: "on" });

      // Two readers inside the lock at once; serialized readers would hit the 5 s bound instead.
      const both = latch();
      let inside = 0;
      const reader = () =>
        store.readTransaction(async () => {
          if (++inside === 2) both.open();
          await Promise.race([
            both.opened,
            pause(5000).then(() => {
              throw new Error("World readers were serialized.");
            }),
          ]);
          return store.meta<number>("probe");
        });
      await expect(Promise.all([reader(), reader()])).resolves.toEqual([1, 1]);

      let value = 1;
      for (const writer of [
        (callback: () => Promise<void>) => store.transaction(callback),
        (callback: () => Promise<void>) => store.batched(callback),
      ]) {
        const entered = latch();
        const finish = latch();
        value++;
        const writing = writer(async () => {
          // Inside batched() this statement has already committed; a reader must still wait for the whole writer.
          await store.setMeta("probe", value);
          entered.open();
          await finish.opened;
        });
        await entered.opened;
        let started = false;
        const reading = store.readTransaction(async () => {
          started = true;
          return store.meta<number>("probe");
        });
        await pause(300);
        expect(started).toBe(false);
        finish.open();
        await writing;
        await expect(reading).resolves.toBe(value);
      }

      // A writer waits for a reader that is still inside the shared lock.
      const release = latch();
      const held = latch();
      const holding = store.readTransaction(async () => {
        held.open();
        await release.opened;
      });
      await held.opened;
      let wrote = false;
      const writing = store.transaction(async () => {
        wrote = true;
        await store.setMeta("probe", 9);
      });
      await pause(300);
      expect(wrote).toBe(false);
      release.open();
      await holding;
      await writing;
      expect(await store.meta<number>("probe")).toBe(9);
    } finally {
      await store.close();
    }
  });

  it("batched() commits statements one by one under one held writer lock, and is atomic inside a transaction", async () => {
    const store = await Store.createTest("batched");
    vi.stubEnv("SQL_SCHEMA", store.schemaName);
    const peer = await Store.open();
    try {
      const committed = latch();
      const finish = latch();
      const batch = store.batched(async () => {
        await store.transaction(async () => {
          await store.setMeta("step", 1);
          await store.setMeta("step", 2);
        });
        committed.open();
        await finish.opened;
        await store.setMeta("step", 3);
        await store.exec("SELECT missing_column FROM meta").catch(() => {});
        return store.meta<number>("step");
      });
      await committed.opened;
      expect(await peer.meta("step")).toBe(2);
      let peerWrote = false;
      const peerWrite = peer.setMeta("peer", true).then(() => {
        peerWrote = true;
      });
      await pause(300);
      expect(peerWrote).toBe(false);
      finish.open();
      expect(await batch).toBe(3);
      await peerWrite;
      expect(await peer.meta("peer")).toBe(true);

      await expect(store.batched(async () => {
        await store.setMeta("partial", "kept");
        throw new Error("batch failed");
      })).rejects.toThrow("batch failed");
      expect(await store.meta("partial")).toBe("kept");

      await expect(store.transaction(() => store.batched(async () => {
        await store.setMeta("atomic", "lost");
        throw new Error("transaction failed");
      }))).rejects.toThrow("transaction failed");
      await expect(store.meta("atomic")).rejects.toThrow(/Missing game metadata/);

      await store.batched(async () => {
        expect((await store.discardWorld()).truncated).toEqual([...WORLD_TABLES]);
      });
      expect(await store.get("SELECT count(*) AS rows FROM meta")).toEqual({ rows: 0 });
    } finally {
      await peer.close();
      await store.close();
    }
  });

  it("serializes writers of two Stores on the same schema, while plain reads do not wait", async () => {
    const store = await Store.createTest("writer_lock");
    vi.stubEnv("SQL_SCHEMA", store.schemaName);
    const peer = await Store.open();
    try {
      await insertRow(store, "countries", countryRow("ONE"));
      const saveId = randomUUID();
      await store.run("INSERT INTO save_slots (id, name, created_at, automatic, format_version) VALUES (?, ?, ?, ?, ?)", saveId, "Kept", new Date(), false, 1);
      await store.bulkInsert("save_chunks", [{ save_id: saveId, ordinal: 0, data: Buffer.from([1, 2]) }]);
      const release = latch();
      const entered = latch();
      const holder = store.transaction(async () => {
        entered.open();
        await release.opened;
      });
      await entered.opened;
      let replaced = false;
      const replacement = peer.transaction(async () => {
        replaced = true;
        await peer.clearWorld();
      });
      let deleted = false;
      const deletion = peer.all("DELETE FROM news RETURNING id").then(() => {
        deleted = true;
      });
      expect(await peer.get("SELECT code FROM countries")).toEqual({ code: "ONE" });
      await pause(300);
      expect(replaced).toBe(false);
      expect(deleted).toBe(false);
      release.open();
      await holder;
      await Promise.all([replacement, deletion]);
      expect(await store.get("SELECT id FROM countries")).toBeUndefined();
      expect(await store.get("SELECT name FROM save_slots WHERE id = ?", saveId)).toEqual({ name: "Kept" });
      expect(await store.all("SELECT version FROM schema_migrations")).toEqual([{ version: 1 }]);
      expect(await insertRow(store, "countries", countryRow("TWO"))).toBe(1);
      await store.run("DELETE FROM save_slots WHERE id = ?", saveId);
      expect(await store.get("SELECT ordinal FROM save_chunks WHERE save_id = ?", saveId)).toBeUndefined();
    } finally {
      await peer.close();
      await store.close();
    }
  });

  it("advisoryLock() waits at most its timeout and reports a lock timeout", async () => {
    const store = await Store.createTest("advisory");
    const other = await Store.createTest("advisory_peer");
    try {
      const release = latch();
      const held = latch();
      const holder = store.transaction(async () => {
        await store.advisoryLock("touchline:test-registry");
        held.open();
        await release.opened;
      });
      await held.opened;
      const started = Date.now();
      const failure = (await other.transaction(() => other.advisoryLock("touchline:test-registry", { timeout: "200ms" }))
        .catch((error: unknown) => error)) as Error;
      expect(failure.message).toBe("Touchline lock touchline:test-registry could not be acquired.");
      expect(isLockTimeout(failure.cause)).toBe(true);
      expect(Date.now() - started).toBeLessThan(5000);
      await other.transaction(() => other.advisoryLock("touchline:other-name", { timeout: "200ms" }));
      release.open();
      await holder;
      await other.transaction(() => other.advisoryLock("touchline:test-registry", { timeout: "200ms" }));
      // Different worlds use different writer locks.
      const gate = latch();
      const writing = store.transaction(async () => {
        await gate.opened;
      });
      await other.transaction(() => other.setMeta("independent", true));
      gate.open();
      await writing;
    } finally {
      await Promise.all([store.close(), other.close()]);
    }
  });

  it("isolates schemas through search_path, including scoped stores sharing one pool", async () => {
    const store = await Store.createTest("isolation_a");
    const other = await Store.createTest("isolation_b");
    try {
      expect(store.database).toBe(other.database);
      await insertRow(store, "countries", countryRow("AAA"));
      expect(await other.get("SELECT id FROM countries")).toBeUndefined();
      const scoped = store.forSchema(other.schemaName);
      await insertRow(scoped, "countries", countryRow("BBB"));
      expect(await other.all("SELECT code FROM countries")).toEqual([{ code: "BBB" }]);
      expect(await store.all("SELECT code FROM countries")).toEqual([{ code: "AAA" }]);
      const checks = await Promise.all(Array.from({ length: 40 }, async (_, index) => {
        const target = index % 3 === 0 ? scoped : store;
        const read = index % 2
          ? target.get<{ schema: string; code: string }>("SELECT current_schema() AS schema, (SELECT code FROM countries LIMIT 1) AS code")
          : target.transaction(() => target.get<{ schema: string; code: string }>("SELECT current_schema() AS schema, (SELECT code FROM countries LIMIT 1) AS code"));
        return { expected: target.schemaName, row: await read };
      }));
      for (const { expected, row } of checks) {
        expect(row?.schema).toBe(expected);
        expect(row?.code).toBe(expected === store.schemaName ? "AAA" : "BBB");
      }
      expect(await scoped.columns("players")).not.toContain("playing_club_id");
      expect(await store.get(`SELECT count(*) AS rows FROM ${tableName(other.schemaName, "countries")}`)).toEqual({ rows: 1 });
      await scoped.close();
      expect(await store.get("SELECT code FROM countries")).toEqual({ code: "AAA" });
      expect(await schemaExists(store, other.schemaName)).toBe(true);
    } finally {
      await Promise.all([store.close(), other.close()]);
    }
  });

  it("discardWorld()/clearWorld() truncate every world table, restart identities and keep saves and migrations", async () => {
    const store = await Store.createTest("clear_world");
    try {
      const country = await insertRow(store, "countries", countryRow("CLR"));
      const club = await insertRow(store, "clubs", clubRow("Clear FC", country));
      await insertRow(store, "players", playerRow("Cleared", country, club));
      await store.setMeta("world", { seed: "x" });
      const saveId = randomUUID();
      await store.run("INSERT INTO save_slots (id, name, created_at, automatic, format_version) VALUES (?, ?, ?, ?, ?)", saveId, "Kept", new Date(), true, 1);
      await expect(store.clearWorld()).rejects.toThrow(/requires an active Store.transaction\(\) writer lock/);
      await expect(store.discardWorld()).rejects.toThrow(/requires an active Store.transaction\(\) writer lock/);
      expect(await store.transaction(() => store.discardWorld())).toEqual({ truncated: [...WORLD_TABLES], deleted: [] });
      for (const table of WORLD_TABLES)
        expect(await store.get(`SELECT count(*) AS rows FROM ${table}`), table).toEqual({ rows: 0 });
      expect(await store.get("SELECT count(*) AS rows FROM save_slots")).toEqual({ rows: 1 });
      expect(await store.all("SELECT version FROM schema_migrations")).toEqual([{ version: 1 }]);
      expect(await insertRow(store, "countries", countryRow("NEW"))).toBe(1);
      await expect(store.transaction(async () => {
        await store.clearWorld();
        throw new Error("abort replacement");
      })).rejects.toThrow("abort replacement");
      expect(await store.get("SELECT code FROM countries")).toEqual({ code: "NEW" });
      await store.transaction(() => store.clearWorld());
      expect(await store.get("SELECT code FROM countries")).toBeUndefined();
    } finally {
      await store.close();
    }
  });

  it("clears the squad assignment on transfer and derives playing_club_id", async () => {
    const store = await Store.createTest("squad_trigger");
    try {
      const country = await insertRow(store, "countries", countryRow("SQD"));
      const [first, second, third] = [
        await insertRow(store, "clubs", clubRow("First", country)),
        await insertRow(store, "clubs", clubRow("Second", country)),
        await insertRow(store, "clubs", clubRow("Third", country)),
      ];
      const player = await insertRow(store, "players", playerRow("Mover", country, first));
      const squad = () => store.get("SELECT club_id, squad_club_id, playing_club_id FROM players WHERE id = ?", player);
      expect(await squad()).toEqual({ club_id: first, squad_club_id: null, playing_club_id: first });
      await store.run("UPDATE players SET squad_club_id = ? WHERE id = ?", second, player);
      expect(await squad()).toEqual({ club_id: first, squad_club_id: second, playing_club_id: second });
      await store.run("UPDATE players SET morale = 70 WHERE id = ?", player);
      await store.run("UPDATE players SET club_id = club_id WHERE id = ?", player);
      expect(await squad()).toEqual({ club_id: first, squad_club_id: second, playing_club_id: second });
      await store.run("UPDATE players SET club_id = ? WHERE id = ?", third, player);
      expect(await squad()).toEqual({ club_id: third, squad_club_id: null, playing_club_id: third });
      await store.run("UPDATE players SET club_id = NULL, squad_club_id = ? WHERE id = ?", second, player);
      expect(await squad()).toEqual({ club_id: null, squad_club_id: null, playing_club_id: null });
      await store.run("UPDATE players SET squad_club_id = ? WHERE id = ?", first, player);
      expect(await squad()).toEqual({ club_id: null, squad_club_id: first, playing_club_id: first });
      await expect(store.run("UPDATE players SET playing_club_id = 1 WHERE id = ?", player)).rejects.toMatchObject({ code: "428C9" });
      expect(await store.columns("players")).toEqual(expect.arrayContaining(["squad_club_id", "club_id"]));
      expect(await store.columns("players")).not.toContain("playing_club_id");
    } finally {
      await store.close();
    }
  });

  it("deduplicates keyed notifications with the partial unique index", async () => {
    const store = await Store.createTest("notifications");
    try {
      const insert = (data: string) =>
        store.run(
          `INSERT INTO news (date, category, title, body, data) VALUES ('2026-07-01', 'board', 'Title', 'Body', ?)
          ON CONFLICT (notification_key) WHERE notification_key IS NOT NULL DO NOTHING`,
          data,
        );
      expect(await insert('{"notificationKey":"deadline:1"}')).toEqual({ changes: 1, lastInsertRowid: 1 });
      expect(await insert('{"notificationKey":"deadline:1","extra":true}')).toEqual({ changes: 0, lastInsertRowid: null });
      expect(await insert('{"notificationKey":"Deadline:1"}')).toEqual({ changes: 1, lastInsertRowid: 3 });
      expect(await insert("{}")).toMatchObject({ changes: 1 });
      expect(await insert('{"other":1}')).toMatchObject({ changes: 1 });
      const duplicate = await store.run(
        "INSERT INTO news (date, category, title, body, data) VALUES ('2026-07-01', 'board', 'Title', 'Body', ?)",
        '{"notificationKey":"deadline:1"}',
      ).catch((error: unknown) => error);
      expect(isUniqueViolation(duplicate)).toBe(true);
      expect(await store.all("SELECT notification_key FROM news ORDER BY id")).toEqual([
        { notification_key: "deadline:1" },
        { notification_key: "Deadline:1" },
        { notification_key: null },
        { notification_key: null },
      ]);
      expect(await store.columns("news")).not.toContain("notification_key");
    } finally {
      await store.close();
    }
  });

  it("backfills match appearances from fixture JSON when the index version is missing", async () => {
    const store = await Store.createTest("backfill");
    try {
      const country = await insertRow(store, "countries", countryRow("APP"));
      const home = await insertRow(store, "clubs", clubRow("Home", country));
      const away = await insertRow(store, "clubs", clubRow("Away", country));
      const [keeper, mid, sub, unused, visitor, existing] = await Promise.all(
        ["Keeper", "Mid", "Sub", "Unused", "Visitor", "Existing"].map((name, index) =>
          insertRow(store, "players", playerRow(name, country, index === 4 ? away : home))),
      );
      const performance = (minutes: number, rating: unknown, goals = 0, assists = 0) => ({ minutes, rating, goals, assists });
      const data = {
        snapshot: {
          home: {
            lineup: [
              { id: keeper, position: "GK" },
              { id: mid, position: "MF" },
              { id: mid, position: "FW" },
              { id: 999_999, position: "MF" },
              { id: "not-a-number", position: "MF" },
              { id: existing, position: "DF" },
            ],
            bench: [{ id: sub, position: "FW" }, { id: unused, position: "DF" }],
          },
          away: { lineup: [{ id: visitor, position: "ST" }], bench: "invalid" },
        },
        players: {
          [keeper]: performance(90, 7.5, 0, 1),
          [mid]: performance(60, "6.25", 2, 0),
          [sub]: performance(30, "n/a"),
          [unused]: performance(0, 6),
          [visitor]: performance(70, 5.5),
          [existing]: performance(90, 8),
          "999999": performance(90, 6),
        },
        substitutions: [{ minute: 60, onId: sub, offId: mid }],
        events: [
          { type: "goal", playerId: mid, minute: 10 },
          { type: "red card", playerId: visitor, minute: 70 },
        ],
      };
      const fixture = (status: string) => ({
        date: "2026-08-15", season: 2026, home_id: home, away_id: away, stage: "League",
        round: 1, status, seed: "seed", data: JSON.stringify(data),
      });
      const played = await insertRow(store, "fixtures", fixture("played"));
      await insertRow(store, "fixtures", fixture("scheduled"));
      await store.run(
        `INSERT INTO player_match_appearances (fixture_id, player_id, club_id, season, date, position, started, minutes,
          minute_on, minute_off, rating, goals, assists, stats) VALUES (?, ?, ?, 2026, '2026-08-15', 'DF', 1, 90, 0, NULL, 9.9, 0, 0, '{}')`,
        played, existing, home,
      );
      await store.run("DELETE FROM meta WHERE key = ?", "appearanceIndexVersion");
      await store.schema();
      expect(await store.meta("appearanceIndexVersion")).toBe(1);
      const rows = await store.all<Record<string, unknown>>(
        `SELECT player_id, club_id, season, date, position, started, minutes, minute_on, minute_off, rating, goals, assists, stats
        FROM player_match_appearances ORDER BY player_id`,
      );
      const stats = (id: number) => JSON.stringify(data.players[id]);
      expect(rows.map((row) => ({ ...row, stats: JSON.stringify(JSON.parse(row.stats as string)) }))).toEqual([
        { player_id: keeper, club_id: home, season: 2026, date: "2026-08-15", position: "GK", started: 1, minutes: 90, minute_on: 0, minute_off: null, rating: 7.5, goals: 0, assists: 1, stats: expect.any(String) },
        { player_id: mid, club_id: home, season: 2026, date: "2026-08-15", position: "MF", started: 1, minutes: 60, minute_on: 0, minute_off: 60, rating: 6.25, goals: 2, assists: 0, stats: expect.any(String) },
        { player_id: sub, club_id: home, season: 2026, date: "2026-08-15", position: "FW", started: 0, minutes: 30, minute_on: 60, minute_off: null, rating: 0, goals: 0, assists: 0, stats: expect.any(String) },
        { player_id: visitor, club_id: away, season: 2026, date: "2026-08-15", position: "ST", started: 1, minutes: 70, minute_on: 0, minute_off: 70, rating: 5.5, goals: 0, assists: 0, stats: expect.any(String) },
        { player_id: existing, club_id: home, season: 2026, date: "2026-08-15", position: "DF", started: 1, minutes: 90, minute_on: 0, minute_off: null, rating: 9.9, goals: 0, assists: 0, stats: "{}" },
      ].sort((first, second) => first.player_id - second.player_id));
      for (const row of rows.filter((item) => item.player_id !== existing))
        expect(JSON.parse(row.stats as string)).toEqual(JSON.parse(stats(row.player_id as number)));
      await store.run("DELETE FROM meta WHERE key = ?", "appearanceIndexVersion");
      await store.schema();
      expect(await store.get("SELECT count(*) AS rows FROM player_match_appearances")).toEqual({ rows: 5 });
    } finally {
      await store.close();
    }
  });
});
