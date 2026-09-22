import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindSql, runSql, sqlPoolConfig, Store } from "./db.ts";
import { readSqlSettings, type SqlSettings } from "./sql-config.ts";
import { provisionAccounts, LEGACY_EMAIL, LEGACY_OBJECT_ID, type AccountProvisioningPlan } from "../scripts/accounts-migrate.ts";
import type { AccountRecord } from "./accounts.ts";
import {
  appearanceBackfill,
  IDENTITY_TABLES,
  migrationTableSql,
  quoteIdentifier,
  schemaMigrations,
  STORE_TABLES,
  WORLD_TABLES,
} from "./sql-schema.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("SQL binding (no database)", () => {
  it("binds only positional parameters outside strings, identifiers, and nested comments", () => {
    const query = `SELECT N'it''s ? FROM players', "quoted?name", [escaped]]?name], ?
      FROM players -- ? FROM clubs
      WHERE name = ? /* ? /* nested ? */ FROM news */ AND profile = N'{"question":"?"}'`;
    const prepared = bindSql(query, [3.25, "O'Brien"], "touchline_test_binder");
    expect(prepared.parameters.map((parameter) => parameter.value)).toEqual([
      3.25,
      "O'Brien",
    ]);
    expect(prepared.sql).toContain(
      "FROM [touchline_test_binder].players -- ? FROM clubs",
    );
    expect(prepared.sql).toContain("N'it''s ? FROM players'");
    expect(prepared.sql).toContain("[escaped]]?name]");
    expect(prepared.sql).toContain("/* ? /* nested ? */ FROM news */");
    expect(prepared.sql).not.toContain("O'Brien");
  });

  it("rejects mismatched and excessive parameter counts and incomplete SQL tokens", () => {
    expect(() => bindSql("SELECT ?", [])).toThrow(/count mismatch/);
    expect(() => bindSql("SELECT 1", [1])).toThrow(/count mismatch/);
    expect(() =>
      bindSql(`SELECT ${Array(2101).fill("?").join(",")}`, Array(2101).fill(1)),
    ).toThrow(/2100 parameters/);
    for (const query of [
      "SELECT 'missing",
      'SELECT "missing',
      "SELECT [missing",
      "SELECT /* missing",
    ])
      expect(() => bindSql(query)).toThrow(/Unterminated/);
  });

  it("does not collide with existing T-SQL variables", () => {
    const prepared = bindSql(
      "DECLARE @__touchline_arg_0 INT = 9; SELECT ?, @__touchline_arg_0",
      [12],
    );
    expect(prepared.parameters[0].name).toBe("__touchline_arg_0_");
    expect(prepared.sql).toContain(
      "SELECT @__touchline_arg_0_, @__touchline_arg_0",
    );
  });

  it("qualifies game/save tables in DML, nested queries and comma joins", () => {
    const query = `UPDATE players SET morale = ? WHERE id IN (SELECT player_id FROM loans);
      INSERT INTO news (title) SELECT name FROM players;
      DELETE FROM save_chunks WHERE save_id = ?;
      SELECT players.id FROM players, clubs WHERE players.club_id = clubs.id;`;
    const prepared = bindSql(query, [90, "slot"], "touchline_test_scope").sql;
    for (const name of ["players", "loans", "news", "save_chunks", "clubs"])
      expect(prepared).toContain(`[touchline_test_scope].${name}`);
    expect(prepared).toContain("players.club_id = clubs.id");
  });

  it("leaves explicit schemas, sys objects, aliases and statement-local CTE names intact", () => {
    const query = `WITH news AS (SELECT id FROM players) SELECT * FROM news;
      SELECT * FROM news JOIN [dbo].[players] AS player ON player.id = news.id
      JOIN sys.tables AS catalog ON catalog.object_id = player.id;
      UPDATE players SET name = ? FROM clubs AS players;
      SELECT * FROM [players] JOIN external.players AS visitor ON visitor.id = [players].id;`;
    const prepared = bindSql(query, ["club"], "isolated").sql;
    expect(prepared).toContain("SELECT * FROM news;");
    expect(prepared).toContain(
      "SELECT * FROM [isolated].news JOIN [dbo].[players]",
    );
    expect(prepared).toContain("JOIN sys.tables");
    expect(prepared).toContain("UPDATE players SET name =");
    expect(prepared).toContain("FROM [isolated].clubs AS players");
    expect(prepared).toContain(
      "FROM [isolated].[players] JOIN external.players",
    );
  });

  it("passes native T-SQL expressions through unchanged", () => {
    const prepared = bindSql(
      "SELECT TOP (5) JSON_VALUE(data, '$.name') FROM players ORDER BY id OFFSET 0 ROWS",
    ).sql;
    expect(prepared).toBe(
      "SELECT TOP (5) JSON_VALUE(data, '$.name') FROM [dbo].players ORDER BY id OFFSET 0 ROWS",
    );
  });

  it("does not mistake a nested query alias for the outer update target", () => {
    const query =
      "UPDATE players SET morale = 50 WHERE country_id IN (SELECT players.id FROM countries AS players)";
    expect(bindSql(query, [], "isolated").sql).toBe(
      "UPDATE [isolated].players SET morale = 50 WHERE country_id IN (SELECT players.id FROM [isolated].countries AS players)",
    );
  });

  it("isolates MERGE upserts without accepting a second unterminated statement", () => {
    const query = "MERGE competition_favorites WITH (HOLDLOCK) AS target USING (VALUES (?,?)) AS source(league_id,events) ON target.league_id=source.league_id WHEN MATCHED THEN UPDATE SET events=source.events WHEN NOT MATCHED THEN INSERT (league_id,events) VALUES (source.league_id,source.events)";
    expect(bindSql(`${query};`, [1, "{}"], "touchline_test_merge").sql).toContain(
      "MERGE [touchline_test_merge].competition_favorites",
    );
    expect(() => bindSql(`${query} DELETE FROM players`, [1, "{}"], "touchline_test_merge")).toThrow(/ambiguous/);
    expect(() => bindSql(query.replace("MERGE competition_favorites", "MERGE dbo.competition_favorites"), [1, "{}"], "touchline_test_merge")).toThrow(/cross-schema/);
  });

  it.each([
    "UPDATE players SET morale=0\nSELECT players.id FROM clubs AS players",
    "DELETE players\nSELECT players.id FROM clubs AS players",
    "DELETE FROM players\nSELECT players.id FROM clubs AS players",
    "UPDATE players SET morale=0 SELECT 1 FROM clubs AS players",
    "SELECT 1 FROM clubs AS players UPDATE players SET morale=0",
  ])("rejects ambiguous non-dbo batches: %s", (query) => {
    expect(() => bindSql(query, [], "touchline_test_review")).toThrow(
      /unsupported|ambiguous/i,
    );
  });

  it("scopes aliases and CTEs to their own statement and query block", () => {
    const query = `WITH players AS (SELECT id FROM clubs) SELECT * FROM players;
      UPDATE players SET morale = (SELECT COUNT(*) FROM clubs AS players)
      WHERE id IN (SELECT id FROM players);
      SELECT * FROM (SELECT id FROM clubs AS players) AS previous
      JOIN (SELECT id FROM players) AS current_rows ON previous.id = current_rows.id;`;
    const prepared = bindSql(query, [], "isolated").sql;
    expect(prepared).toContain("SELECT * FROM players;");
    expect(prepared).toContain("UPDATE [isolated].players SET morale");
    expect(prepared).toContain("WHERE id IN (SELECT id FROM [isolated].players)");
    expect(prepared).toContain("JOIN (SELECT id FROM [isolated].players)");
  });

  it("qualifies a CTE's base table before its name enters scope", () => {
    const query =
      "WITH players AS (SELECT id FROM clubs), clubs AS (SELECT id FROM players) UPDATE players SET id = 1";
    expect(bindSql(query, [], "isolated").sql).toBe(
      "WITH players AS (SELECT id FROM [isolated].clubs), clubs AS (SELECT id FROM players) UPDATE players SET id = 1",
    );
  });

  it.each(["UPDATE players SET id = 1", "DELETE players", "DELETE FROM players", "DELETE TOP (1) FROM players"])(
    "resolves same-block DML aliases: %s",
    (target) => {
      const query = `${target} FROM clubs AS players WHERE players.id = 2`;
      expect(bindSql(query, [], "isolated").sql).toBe(
        `${target} FROM [isolated].clubs AS players WHERE players.id = 2`,
      );
    },
  );

  it("keeps nested TOP expressions and CTE column lists balanced", () => {
    const query =
      "WITH picked (id) AS (SELECT TOP ((1 + 2)) id FROM players) UPDATE TOP ((1 + 1)) players SET morale = 0 WHERE id IN (SELECT id FROM picked)";
    const prepared = bindSql(query, [], "isolated").sql;
    expect(prepared).toContain("TOP ((1 + 2)) id FROM [isolated].players");
    expect(prepared).toContain("UPDATE TOP ((1 + 1)) [isolated].players");
    expect(prepared).toContain("SELECT id FROM picked");
  });

  it("resolves derived-table aliases without leaking nested aliases", () => {
    const query = "UPDATE players SET id = 1 FROM (SELECT id FROM clubs AS players) AS players";
    expect(bindSql(query, [], "isolated").sql).toBe(
      "UPDATE players SET id = 1 FROM (SELECT id FROM [isolated].clubs AS players) AS players",
    );
  });

  it.each([
    "UPDATE dbo.players SET morale = 0",
    "DELETE FROM [dbo].[players]",
    "UPDATE players SET id = 1 FROM dbo.clubs AS players",
    "WITH players AS (SELECT id FROM dbo.clubs) UPDATE players SET id = 1",
    "INSERT INTO dbo.news (title) SELECT name FROM players",
  ])("rejects explicit cross-schema game writes: %s", (query) => {
    expect(() => bindSql(query, [], "isolated")).toThrow(/cross-schema/);
  });

  it("supports insert-select, set operations and explicitly separated conditional writes", () => {
    for (const query of [
      "INSERT INTO news (title) SELECT name FROM players UNION ALL SELECT name FROM clubs",
      "SELECT id FROM players UNION ALL SELECT id FROM clubs",
      "UPDATE meta SET [value] = '1'; IF @@ROWCOUNT = 0 INSERT INTO meta ([key], [value]) VALUES ('key', '1');",
    ])
      expect(bindSql(query, [], "isolated").sql).toContain("[isolated].");
  });

  it("keeps schema-qualified migration and backfill batches executable", () => {
    const schema = "touchline_test_review";
    for (const query of [
      migrationTableSql(schema),
      ...schemaMigrations(schema).flatMap((migration) => migration.statements),
      ...appearanceBackfill(schema),
    ])
      expect(() => bindSql(query, [], schema), query).not.toThrow();
  });
});

describe("SQL mutation generation (no database)", () => {
  it("captures generated IDs using OUTPUT INTO so enabled triggers are supported", () => {
    const sql = runSql(
      bindSql("INSERT INTO players ([name]) VALUES (?)", ["Name"], "isolated")
        .sql,
    );
    expect(sql).toContain(
      "OUTPUT INSERTED.[id] INTO @__touchline_inserted ([id])",
    );
    expect(sql).toContain("ORDER BY [ordinal] DESC");
    expect(sql).not.toContain("SET IDENTITY_INSERT");
    expect(sql).not.toContain("@@IDENTITY");
  });

  it("preserves explicit IDs and turns IDENTITY_INSERT off on success and error", () => {
    const sql = runSql(
      bindSql(
        "INSERT INTO countries (id, code) VALUES (?, ?)",
        [52, "GB"],
        "isolated",
      ).sql,
    );
    expect(sql).toContain("SET IDENTITY_INSERT [isolated].countries ON");
    expect(
      sql.match(/SET IDENTITY_INSERT \[isolated\]\.countries OFF/g),
    ).toHaveLength(2);
    expect(sql).toContain("BEGIN CATCH");
    expect(sql).toContain("THROW;");
  });

  it("supports existing direct OUTPUT and insert-select with a CTE", () => {
    const direct = runSql(
      "INSERT INTO [dbo].[players] (name) OUTPUT INSERTED.id VALUES (@name)",
    );
    expect(direct).toContain("OUTPUT INSERTED.[id] INTO");
    expect(direct.match(/OUTPUT INSERTED/g)).toHaveLength(1);
    const select = runSql(
      ";WITH source AS (SELECT 12 AS id) INSERT INTO [dbo].[countries] (id) SELECT id FROM source;",
    );
    expect(select).toContain("OUTPUT INSERTED.[id] INTO");
    expect(select).toContain("SELECT id FROM source");
    expect(select).toContain("SET IDENTITY_INSERT [dbo].[countries] ON");
  });

  it("does not invent numeric IDs for save slots or update/delete results", () => {
    for (const query of [
      "INSERT INTO save_slots (id) VALUES (@id)",
      "UPDATE players SET morale = 75",
      "DELETE FROM news",
    ])
      expect(runSql(query)).toContain(
        "CAST(NULL AS INT) AS [__touchline_identity]",
      );
  });
});

describe("SQL pool configuration (no database)", () => {
  it("allows bounded maintenance request timeouts without disabling the timeout", () => {
    expect(sqlPoolConfig(readSqlSettings({})).requestTimeout).toBe(120000);
    expect(sqlPoolConfig(readSqlSettings({ SQL_REQUEST_TIMEOUT_MS: "900000" })).requestTimeout).toBe(900000);
    for (const timeout of ["0", "-1", "Infinity", "900001", "invalid"])
      expect(() => readSqlSettings({ SQL_REQUEST_TIMEOUT_MS: timeout })).toThrow("SQL_REQUEST_TIMEOUT_MS");
  });
  it("uses renewable driver-managed Azure credentials and a short min-zero pool", () => {
    const configuration = sqlPoolConfig(
      readSqlSettings({ AZURE_CLIENT_ID: "managed-client" }),
    );
    expect(configuration.authentication).toEqual({
      type: "azure-active-directory-default",
      options: { clientId: "managed-client" },
    });
    expect(configuration.pool).toMatchObject({
      min: 0,
      max: 4,
      idleTimeoutMillis: 10000,
    });
    expect(configuration.options).toMatchObject({
      encrypt: true,
      trustServerCertificate: false,
      abortTransactionOnError: true,
    });
    expect(JSON.stringify(configuration)).not.toContain('"token"');
  });

  it("uses configured SQL credentials only when both were provided", () => {
    const configuration = sqlPoolConfig(
      readSqlSettings({ SQL_USER: "local-user", SQL_PASSWORD: "test-only" }),
    );
    expect(configuration.user).toBe("local-user");
    expect(configuration.authentication).toBeUndefined();
    expect(() => readSqlSettings({ SQL_USER: "local-user" })).toThrow(
      /both SQL_USER and SQL_PASSWORD/,
    );
  });
});

describe("SQL schema (no database)", () => {
  const schema = "touchline_test_schema_contract";
  const migrations = schemaMigrations(schema);
  const statements = migrations.flatMap((migration) => migration.statements);

  it("keeps all world tables in foreign-key dependency order, without saves or migrations", () => {
    expect(WORLD_TABLES).toHaveLength(34);
    expect(new Set(WORLD_TABLES).size).toBe(WORLD_TABLES.length);
    expect(WORLD_TABLES).not.toContain("save_slots");
    expect(WORLD_TABLES).not.toContain("save_chunks");
    expect(WORLD_TABLES).not.toContain("schema_migrations");
    const seen = new Set<string>();
    for (const [offset, statement] of migrations[0].statements.entries()) {
      const table = WORLD_TABLES[offset];
      expect(statement).toContain(`CREATE TABLE [${schema}].[${table}]`);
      for (const match of statement.matchAll(
        /REFERENCES \[[^\]]+\]\.\[([^\]]+)\]/g,
      ))
        expect(
          match[1] === table || seen.has(match[1]),
          `${table} depends on ${match[1]}`,
        ).toBe(true);
      expect(statement.includes("[id] INT IDENTITY(1,1)")).toBe(
        IDENTITY_TABLES.has(table),
      );
      seen.add(table);
    }
  });

  it("scopes migrations, indexes, foreign keys and triggers to the selected schema", () => {
    expect(migrations.map((migration) => migration.version)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(migrationTableSql(schema)).toContain(
      `[${schema}].[schema_migrations]`,
    );
    for (const statement of statements) {
      expect(statement).not.toMatch(
        /\bdbo\b|CREATE DATABASE|\bPRAGMA\b|IF NOT EXISTS\s+\w+\s+ON|json_extract|COLLATE NOCASE/i,
      );
      expect(statement).toContain(`[${schema}].`);
    }
    const indexes = statements.filter((statement) =>
      /CREATE (?:UNIQUE )?INDEX/.test(statement),
    );
    expect(indexes).toHaveLength(26);
    for (const statement of indexes) {
      expect(statement).toContain(`[object_id] = OBJECT_ID(N'[${schema}].`);
      expect(statement).toContain(` ON [${schema}].`);
    }
    expect(statements.join("\n")).toContain(
      `TRIGGER [${schema}].[clear_transferred_squad] ON [${schema}].[players]`,
    );
    const reseed = migrations.find((migration) => migration.version === 6)!.statements[0];
    expect(reseed).toContain(`PROCEDURE [${schema}].[reseed_world_identity]`);
    expect(reseed).toContain("WITH EXECUTE AS OWNER");
    expect(reseed).toContain("IF @table NOT IN (");
    expect(reseed).toContain("[last_value] IS NOT NULL");
  });

  it("uses double precision and Unicode text, retaining additive columns and defaults", () => {
    const sql = statements.join("\n");
    expect(sql).not.toMatch(/\bREAL\b|\bTEXT\b|\bFLOAT(?!\(53\))/i);
    expect(sql).toContain("[balance] FLOAT(53) NOT NULL");
    expect(sql).toContain("[data] NVARCHAR(max) NOT NULL DEFAULT N'{}'");
    expect(sql).toContain("ADD [squad_club_id] INT NULL REFERENCES");
    expect(sql).toContain("COALESCE([squad_club_id], [club_id]) PERSISTED");
    expect(sql).toContain("[notification_key], [notification_unkeyed_id]");
    expect(sql).not.toContain("WHERE [notification_key] IS NOT NULL");
    expect(sql).toContain("previous_row.[club_id] IS NULL");
    expect(sql).toContain("current_row.[club_id] IS NULL");
  });

  it("preserves fractional generated ratings and match/season reputation adjustments", () => {
    const widening = migrations.find((migration) => migration.version === 5)!;
    expect(widening.statements).toHaveLength(6);
    for (const [table, columns] of [
      ["countries", ["reputation"]],
      ["leagues", ["reputation"]],
      ["clubs", ["reputation", "facilities"]],
      ["staff", ["ability", "tactical_knowledge"]],
    ] as const) {
      const declaration = migrations[0].statements[WORLD_TABLES.indexOf(table)];
      for (const column of columns) {
        expect(declaration, `${table}.${column}`).toContain(
          `[${column}] FLOAT(53) NOT NULL`,
        );
        expect(widening.statements).toContain(
          `ALTER TABLE [${schema}].[${table}] ALTER COLUMN [${column}] FLOAT(53) NOT NULL;`,
        );
      }
    }
  });

  it("retains integer IDs, counts, rankings and rounded scouting estimates", () => {
    for (const [table, columns] of [
      ["leagues", ["tier"]],
      ["clubs", ["country_id", "academy", "expectations", "capacity"]],
      ["staff", ["influence", "communication", "ambition"]],
      [
        "players",
        ["age", "volatility", "goals", "assists", "appearances", "minutes", "knowledge", "intensity"],
      ],
      [
        "standings",
        ["played", "wins", "draws", "losses", "gf", "ga", "points", "deducted"],
      ],
      ["fixtures", ["season", "round"]],
      [
        "reports",
        ["accuracy", "ability_low", "ability_high", "potential_low", "potential_high", "fit", "risk"],
      ],
      ["training_plans", ["intensity"]],
      ["set_pieces", ["risk"]],
    ] as const) {
      const declaration = migrations[0].statements[WORLD_TABLES.indexOf(table)];
      for (const column of columns)
        expect(declaration, `${table}.${column}`).toContain(
          `[${column}] INT NOT NULL`,
        );
    }
  });

  it("indexes only bounded keys and never filters on a computed column", () => {
    for (const statement of statements.filter((sql) =>
      /CREATE (?:UNIQUE )?INDEX/.test(sql),
    )) {
      const [, table, keys, filter = ""] = statement.match(
        /CREATE (?:UNIQUE )?INDEX \[[^\]]+\] ON \[[^\]]+\]\.\[([^\]]+)\] \(([^)]+)\)(?: WHERE ([^;]+))?;/,
      )!;
      const declaration = migrations[0].statements.find((sql) =>
        sql.includes(`CREATE TABLE [${schema}].[${table}]`),
      )!;
      const computed = statements.filter((sql) =>
        sql.includes(`ALTER TABLE [${schema}].[${table}] ADD`) &&
        /ADD \[[^\]]+\] AS\b/.test(sql),
      );
      for (const [, column] of keys.matchAll(/\[([^\]]+)\]/g)) {
        expect(declaration, `${table}.${column}`).not.toMatch(
          new RegExp(`\\[${column}\\]\\s+(?:N?VARCHAR|VARBINARY)\\(max\\)`, "i"),
        );
        for (const addition of computed.filter((sql) =>
          sql.includes(`ADD [${column}] AS`),
        ))
          expect(addition).not.toMatch(/(?:N?VARCHAR|VARBINARY)\(max\)/i);
      }
      for (const addition of computed) {
        const [, column] = addition.match(/ADD \[([^\]]+)\] AS\b/)!;
        expect(filter, `${table}.${column}`).not.toContain(`[${column}]`);
      }
    }
  });

  it("defines the exact chunked-save storage contract", () => {
    const saves = migrations[3].statements.join("\n");
    for (const declaration of [
      "[id] UNIQUEIDENTIFIER NOT NULL PRIMARY KEY",
      "[name] NVARCHAR(200) NOT NULL",
      "[career_id] NVARCHAR(100) NULL",
      "[career_metadata] NVARCHAR(max) NULL",
      "[created_at] DATETIME2 NOT NULL",
      "[automatic] BIT NOT NULL",
      "[imported] BIT NOT NULL DEFAULT 0",
      "[format_version] INT NOT NULL",
      "[byte_length] BIGINT NOT NULL DEFAULT 0",
      "[sha256] CHAR(64) NULL",
      "[complete] BIT NOT NULL DEFAULT 0",
      "[ordinal] INT NOT NULL",
      "[data] VARBINARY(max) NOT NULL",
      "PRIMARY KEY([save_id], [ordinal])",
      "ON DELETE CASCADE",
    ])
      expect(saves).toContain(declaration);
    expect(STORE_TABLES.has("save_slots")).toBe(true);
    expect(STORE_TABLES.has("save_chunks")).toBe(true);
  });

  it("backfills both lineups and benches with T-SQL JSON and duplicate protection", () => {
    const backfill = appearanceBackfill(schema);
    expect(backfill).toHaveLength(4);
    for (const [index, path] of [
      "home.lineup",
      "home.bench",
      "away.lineup",
      "away.bench",
    ].entries()) {
      expect(backfill[index]).toContain(`'$.snapshot.${path}'`);
      expect(backfill[index]).toContain("OPENJSON");
      expect(backfill[index]).toContain("ROW_NUMBER()");
      expect(backfill[index]).toContain("NOT EXISTS");
      expect(backfill[index]).toContain("'$.substitutions'");
      expect(backfill[index]).toContain("N'red card', N'injury'");
      for (const reference of [
        `FROM [${schema}].[fixtures] AS fixture`,
        `INNER JOIN [${schema}].[players] AS player`,
        `INSERT INTO [${schema}].[player_match_appearances]`,
        `FROM [${schema}].[player_match_appearances] AS existing`,
      ])
        expect(backfill[index]).toContain(reference);
      expect(backfill[index]).not.toMatch(
        /\b(?:FROM|JOIN|INTO)\s+\[?(?:fixtures|players|player_match_appearances)\]?(?=\s|;|\()/i,
      );
      expect(backfill[index]).not.toMatch(
        /json_each|json_extract|INSERT OR IGNORE|LIMIT 1/,
      );
    }
  });

  it("quotes identifiers without allowing an escape from brackets", () => {
    expect(quoteIdentifier("test]name")).toBe("[test]]name]");
    expect(() => quoteIdentifier("a".repeat(129))).toThrow(
      "Invalid SQL identifier",
    );
    expect(() => quoteIdentifier("bad\0name")).toThrow(
      "Invalid SQL identifier",
    );
  });
});

describe("SQL configuration safety (no database)", () => {
  const remote = {
    SQL_SERVER: "example.database.windows.net",
    SQL_DATABASE: "touchline",
    SQL_TEST_MODE: "true",
    SQL_SCHEMA: "touchline_test_config",
  };

  it("reports nested startup errors without passwords or identity tokens", async () => {
    const { describeSqlError } = await import("./sql-config.ts");
    const original = Object.assign(new Error("Login failed for token-user"), { code: "ELOGIN", number: 18456 });
    const failure = Object.assign(new Error("SQL rejected password-value and identity-header-value"), {
      originalError: original,
      cause: new Error("Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature"),
    });
    const messages = describeSqlError(failure, {
      SQL_PASSWORD: "password-value",
      IDENTITY_HEADER: "identity-header-value",
    }).join(" | ");
    expect(messages).toContain("ELOGIN: 18456: Login failed");
    expect(messages).toContain("[redacted]");
    expect(messages).not.toMatch(/password-value|identity-header-value|eyJhbGci/);
  });

  it("requires both explicit remote-test confirmations", () => {
    expect(() => readSqlSettings(remote)).toThrow(/Remote tests require/);
    expect(() =>
      readSqlSettings({
        ...remote,
        SQL_ALLOW_REMOTE_TESTS: "true",
        SQL_TEST_DATABASE: "other",
      }),
    ).toThrow(/Remote tests require/);
    expect(
      readSqlSettings({
        ...remote,
        SQL_ALLOW_REMOTE_TESTS: "true",
        SQL_TEST_DATABASE: "touchline",
      }).schema,
    ).toBe(remote.SQL_SCHEMA);
  });

  it("never allows dbo tests, unverified remote TLS, or SQLite paths", () => {
    expect(() =>
      readSqlSettings({ SQL_TEST_MODE: "true", SQL_SCHEMA: "dbo" }),
    ).toThrow(/isolated/);
    expect(() =>
      readSqlSettings({ SQL_SERVER: remote.SQL_SERVER, SQL_ENCRYPT: "false" }),
    ).toThrow(/verified TLS/);
    expect(() =>
      readSqlSettings({
        SQL_SERVER: remote.SQL_SERVER,
        SQL_TRUST_SERVER_CERTIFICATE: "true",
      }),
    ).toThrow(/verified TLS/);
    expect(() => readSqlSettings({ SQL_DATABASE: ":memory:" })).toThrow(
      /not a file path/,
    );
    expect(() => readSqlSettings({ GAME_DB: "data/career.sqlite" })).toThrow(
      /SQLite configuration/,
    );
    expect(readSqlSettings({}).schema).toBe("dbo");
  });
});

interface DriverCall {
  kind: "query" | "batch" | "bulk";
  sql: string;
  owner: unknown;
  parameters: Record<string, unknown>;
  types: Record<string, unknown>;
  rows?: unknown[][];
}

function fakeStore(
  reply: (call: DriverCall) => unknown[] | Promise<unknown[]> = (call) =>
    call.sql.includes("AS [__touchline_changes]")
      ? [{ __touchline_changes: 1, __touchline_identity: 42 }]
      : [],
  settings = readSqlSettings({
    SQL_SCHEMA: "touchline_test_mock",
    SQL_TEST_MODE: "true",
  }),
) {
  const calls: DriverCall[] = [];
  const events: string[] = [];
  const transactions: FakeTransaction[] = [];
  const busy = new Set<unknown>();
  const pool = {
    close: vi.fn(async () => {
      events.push("close");
    }),
  };

  class FakeTransaction extends EventEmitter {
    constructor(readonly pool: unknown) {
      super();
      transactions.push(this);
    }
    async begin() {
      events.push("begin");
    }
    async commit() {
      events.push("commit");
    }
    async rollback() {
      events.push("rollback");
      this.emit("rollback", false);
    }
  }

  class FakeTable {
    create = false;
    values: unknown[][] = [];
    definitions: unknown[][] = [];
    columns = {
      add: (...values: unknown[]) => {
        this.definitions.push(values);
      },
    };
    rows = {
      add: (...values: unknown[]) => {
        this.values.push(values);
      },
      clear: () => {
        this.values = [];
      },
    };
    constructor(readonly name: string) {}
  }

  class FakeRequest {
    parameters: Record<string, unknown> = {};
    types: Record<string, unknown> = {};
    constructor(readonly owner: unknown) {}
    input(name: string, ...values: unknown[]) {
      this.parameters[name] = values.at(-1);
      this.types[name] = values.length === 2 ? values[0] : "inferred";
      return this;
    }
    async execute(kind: DriverCall["kind"], sql: string, rows?: unknown[][]) {
      if (busy.has(this.owner))
        throw new Error("Concurrent requests on one transaction connection.");
      busy.add(this.owner);
      const call = {
        kind,
        sql,
        owner: this.owner,
        parameters: { ...this.parameters },
        types: { ...this.types },
        rows,
      };
      calls.push(call);
      events.push(kind);
      try {
        await Promise.resolve();
        const result = await reply(call);
        return {
          recordset: result,
          recordsets: [result],
          rowsAffected: [1],
          output: {},
        };
      } finally {
        busy.delete(this.owner);
      }
    }
    async query(sql: string) {
      return this.execute("query", sql);
    }
    async batch(sql: string) {
      return this.execute("batch", sql);
    }
    async bulk(table: FakeTable) {
      return this.execute(
        "bulk",
        table.name,
        table.values.map((row) => [...row]),
      );
    }
  }

  const sized = (type: string) => (length: number) => ({ type, length });
  const driver = {
    Request: FakeRequest,
    Transaction: FakeTransaction,
    Table: FakeTable,
    MAX: 65535,
    ISOLATION_LEVEL: { READ_COMMITTED: 2 },
    Int: "Int",
    BigInt: "BigInt",
    Float: "Float",
    Bit: "Bit",
    UniqueIdentifier: "UniqueIdentifier",
    NVarChar: sized("NVarChar"),
    VarChar: sized("VarChar"),
    Char: sized("Char"),
    VarBinary: sized("VarBinary"),
    DateTime2: sized("DateTime2"),
  };
  const store = Reflect.construct(Store, [settings, pool, driver]) as Store;
  return { store, calls, events, transactions, pool };
}

function mockConnections(factory: (settings: SqlSettings) => Store) {
  return vi
    .spyOn(
      Store as unknown as { connect(settings: SqlSettings): Promise<Store> },
      "connect",
    )
    .mockImplementation(async (settings) => factory(settings));
}

function localEnvironment() {
  vi.stubEnv("SQL_SERVER", "127.0.0.1");
  vi.stubEnv("SQL_DATABASE", "touchline");
  vi.stubEnv("SQL_SCHEMA", "dbo");
  vi.stubEnv("SQL_TEST_MODE", "false");
  vi.stubEnv("SQL_USER", undefined);
  vi.stubEnv("SQL_PASSWORD", undefined);
  vi.stubEnv("GAME_DB", undefined);
  vi.stubEnv("SAVE_DIR", undefined);
}

describe("SQL Store lifecycle (fake driver, no database)", () => {
  it("borrows one pool without changing root scope, environment or transaction state", async () => {
    const harness = fakeStore();
    const configuredSchema = process.env.SQL_SCHEMA;
    const first = harness.store.forSchema("touchline_test_first_account");
    const second = first.forSchema("touchline_test_second_account");
    expect(harness.calls).toEqual([]);
    expect(harness.store.schemaName).toBe("touchline_test_mock");
    expect(process.env.SQL_SCHEMA).toBe(configuredSchema);
    expect(() => Reflect.set(first, "schemaName", "dbo")).not.toThrow();
    expect(first.schemaName).toBe("touchline_test_first_account");
    await Promise.all([
      first.run("UPDATE meta SET [value] = ? WHERE [key] = ?", "first", "state"),
      second.run("UPDATE meta SET [value] = ? WHERE [key] = ?", "second", "state"),
    ]);
    expect(harness.transactions).toHaveLength(2);
    expect(harness.transactions.every((transaction) => transaction.pool === harness.pool)).toBe(true);
    expect(harness.calls.filter((call) => call.parameters.worldLock).map((call) => call.parameters.worldLock)).toEqual([
      "touchline:world:touchline_test_first_account",
      "touchline:world:touchline_test_second_account",
    ]);
    expect(harness.calls.some((call) => call.sql.includes("UPDATE [touchline_test_first_account].meta"))).toBe(true);
    expect(harness.calls.some((call) => call.sql.includes("UPDATE [touchline_test_second_account].meta"))).toBe(true);
    await first.close();
    expect(harness.pool.close).not.toHaveBeenCalled();
    await expect(first.all("SELECT 1")).rejects.toThrow(/closed/);
    await second.all("SELECT 1");
    await harness.store.close();
    expect(harness.pool.close).toHaveBeenCalledOnce();
    expect(harness.calls.some((call) => /DROP SCHEMA/.test(call.sql))).toBe(false);
    await expect(second.all("SELECT 1")).rejects.toThrow(/closed/);
  });

  it("rejects invalid or live schema scopes before a test store touches SQL", async () => {
    const harness = fakeStore();
    for (const schema of ["dbo", "accounts", "touchline_user_live", "a.b", "bad]name", "a".repeat(129)])
      expect(() => harness.store.forSchema(schema)).toThrow(/schema/i);
    expect(harness.calls).toEqual([]);
    await harness.store.close();
    expect(() => harness.store.forSchema("touchline_test_after_close")).toThrow(/closed/);
  });

  it("waits for borrowed transactions before root disposal and refuses an in-transaction root close", async () => {
    const harness = fakeStore();
    const scoped = harness.store.forSchema("touchline_test_account_close");
    await scoped.transaction(async () => {
      await expect(harness.store.close()).rejects.toThrow(/inside its transaction/);
    });
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const pending = scoped.transaction(async () => {
      entered();
      await gate;
      await scoped.exec("DELETE FROM news");
    });
    await started;
    const closing = harness.store.close();
    expect(harness.pool.close).not.toHaveBeenCalled();
    release();
    await pending;
    await closing;
    expect(harness.pool.close).toHaveBeenCalledOnce();
    expect(harness.events.at(-1)).toBe("close");
  });

  it("open connects without migrations, seeding or an implicit test schema", async () => {
    localEnvironment();
    const harness = fakeStore();
    const connect = mockConnections(() => harness.store);
    await Store.open();
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        database: "touchline",
        schema: "dbo",
        testMode: false,
      }),
    );
    expect(harness.calls).toEqual([]);
    expect(harness.events).toEqual([]);
    await expect(Store.open(":memory:")).rejects.toThrow(/not a file path/);
  });

  it("createTest creates unique schemas in the configured database and only closes its own schema", async () => {
    localEnvironment();
    const stores: ReturnType<typeof fakeStore>[] = [];
    mockConnections((settings) => {
      const harness = fakeStore(undefined, settings);
      stores.push(harness);
      return harness.store;
    });
    const first = await Store.createTest("same label");
    const second = await Store.createTest("same label");
    expect(first.schemaName).toMatch(
      /^touchline_test_[a-f0-9]{32}_same_label$/,
    );
    expect(second.schemaName).not.toBe(first.schemaName);
    expect(first.database).toBe("touchline");
    expect(second.database).toBe("touchline");
    expect(first.testMode).toBe(true);
    await first.close();
    expect(
      stores[0].calls.some(
        (call) => call.sql === `DROP SCHEMA [${first.schemaName}];`,
      ),
    ).toBe(true);
    expect(
      stores[1].calls.some((call) => call.sql.includes("DROP SCHEMA")),
    ).toBe(false);
    expect(
      stores
        .flatMap((harness) => harness.calls)
        .map((call) => call.sql)
        .join("\n"),
    ).not.toMatch(/(?:CREATE|DROP) DATABASE|\[dbo\]\./);
    await second.close();
  });

  it("enforces remote-test opt-ins before attempting a connection", async () => {
    localEnvironment();
    vi.stubEnv("SQL_SERVER", "example.database.windows.net");
    vi.stubEnv("SQL_ALLOW_REMOTE_TESTS", "false");
    vi.stubEnv("SQL_ENCRYPT", "true");
    vi.stubEnv("SQL_TRUST_SERVER_CERTIFICATE", "false");
    const connect = mockConnections(() => fakeStore().store);
    await expect(Store.createTest()).rejects.toThrow(/Remote tests require/);
    expect(connect).not.toHaveBeenCalled();
  });

  it("cleans up a created test schema when a migration fails", async () => {
    localEnvironment();
    let harness: ReturnType<typeof fakeStore>;
    mockConnections((settings) => {
      harness = fakeStore((call) => {
        if (
          call.sql.includes("CREATE TABLE") &&
          call.sql.includes("[countries]")
        )
          throw new Error("migration failed");
        return [];
      }, settings);
      return harness.store;
    });
    await expect(Store.createTest("failure")).rejects.toThrow(
      "migration failed",
    );
    expect(
      harness!.calls.some((call) =>
        call.sql.startsWith("DROP SCHEMA [touchline_test_"),
      ),
    ).toBe(true);
    expect(harness!.pool.close).toHaveBeenCalledOnce();
  });

  it("ordinary close never drops even a test-prefixed schema it did not create", async () => {
    const harness = fakeStore();
    await harness.store.close();
    await harness.store.close();
    expect(harness.calls).toEqual([]);
    expect(harness.pool.close).toHaveBeenCalledOnce();
    await expect(harness.store.all("SELECT 1")).rejects.toThrow(/closed/);
  });
});

describe("Account provisioning transaction scopes (fake driver, no database)", () => {
  const plan: AccountProvisioningPlan = {
    database: "touchline", accountSchema: "accounts",
    tenantId: "11111111-1111-4111-8111-111111111111",
    legacyObjectId: LEGACY_OBJECT_ID, legacyEmail: LEGACY_EMAIL,
    objectIds: [LEGACY_OBJECT_ID, "22222222-2222-4222-8222-222222222222"],
  };

  function provisioningHarness(records: AccountRecord[] = []) {
    const schemas = new Set(["dbo"]);
    let registryCreated = false;
    return fakeStore((call) => {
      const parameters = Object.values(call.parameters);
      if (call.sql.includes("CREATE TABLE [accounts].[users]")) registryCreated = true;
      const created = call.sql.match(/^CREATE SCHEMA \[(touchline_user_[a-f0-9]{32})\]/)?.[1];
      if (created) schemas.add(created);
      if (call.sql.includes("INSERT INTO [accounts].[users]")) {
        const [id, tenant_id, object_id, display_name, email, game_schema] = parameters as [string, string, string, string, string | null, string];
        records.push({ id, tenant_id, object_id, display_name, email, game_schema });
      }
      if (call.sql.includes("AS [__touchline_changes]"))
        return [{ __touchline_changes: 1, __touchline_identity: null }];
      if (call.sql.includes("FROM sys.tables")) {
        if (parameters[0] === "accounts") return registryCreated ? [{ name: "users" }] : [];
        if (call.sql.includes("[name] = N'users'")) return [];
        return schemas.has(String(parameters[0])) ? [...STORE_TABLES].map((name) => ({ name })) : [];
      }
      if (call.sql.includes("FROM sys.indexes")) return [
        { is_primary_key: true, columns: "id" },
        { is_primary_key: false, columns: "tenant_id,object_id" },
        { is_primary_key: false, columns: "game_schema" },
      ];
      if (call.sql.startsWith("SELECT * FROM [accounts].[users]")) return call.sql.includes(" WHERE ")
        ? records.filter((account) =>
          (account.tenant_id === parameters[0] && account.object_id === parameters[1]) ||
          account.game_schema === parameters[2] || account.id === parameters[3])
        : records.map((account) => ({ ...account }));
      if (call.sql.includes("SELECT SCHEMA_ID(?)")) return [{ schema_id: schemas.has(String(parameters[0])) ? 1 : null }];
      return [];
    }, readSqlSettings({}));
  }

  it("atomically registers empty schemas, binds only the legacy guest to dbo, and is idempotent", async () => {
    const harness = provisioningHarness();
    try {
      const accounts = await provisionAccounts(harness.store, plan);
      expect(accounts).toHaveLength(2);
      expect(accounts[0]).toMatchObject({ objectId: LEGACY_OBJECT_ID, schema: "dbo", created: true });
      const schema = accounts[1].schema;
      expect(schema).toMatch(/^touchline_user_[a-f0-9]{32}$/);
      const creation = harness.calls.find((call) => call.sql === `CREATE SCHEMA [${schema}] AUTHORIZATION [dbo];`)!;
      const insertion = harness.calls.find((call) => call.sql.includes("INSERT INTO [accounts].[users]") && Object.values(call.parameters).includes(schema))!;
      expect(creation).toBeDefined();
      expect(insertion.owner).toBe(creation.owner);
      const maintenance = harness.calls.findIndex((call) => call.owner === creation.owner && call.sql.includes("touchline:schema-maintenance"));
      expect(maintenance).toBeGreaterThan(-1);
      expect(maintenance).toBeLessThan(harness.calls.indexOf(creation));
      expect(harness.calls.map((call) => call.sql).join("\n")).not.toMatch(/(?:CREATE|ALTER|DROP) TABLE \[dbo\]|DELETE FROM \[dbo\]|INSERT INTO \[dbo\]/);
      const checkpoint = harness.calls.length;
      const repeated = await provisionAccounts(harness.store, plan);
      expect(repeated.map((account) => ({ ...account, created: true }))).toEqual(accounts);
      expect(repeated.every((account) => !account.created)).toBe(true);
      expect(harness.calls.slice(checkpoint).some((call) => call.sql.startsWith("CREATE SCHEMA [touchline_user_") || call.sql.includes("INSERT INTO [accounts].[users]"))).toBe(false);
    } finally {
      await harness.store.close();
    }
  });

  it("refuses a wrong legacy owner without creating or adopting another world", async () => {
    const harness = provisioningHarness([{
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", tenant_id: plan.tenantId,
      object_id: plan.objectIds[1], display_name: "Wrong owner", email: null, game_schema: "dbo",
    }]);
    try {
      await expect(provisionAccounts(harness.store, plan)).rejects.toThrow(/reassign/);
      expect(harness.calls.some((call) => call.sql.startsWith("CREATE SCHEMA [touchline_user_") || call.sql.includes("INSERT INTO [accounts].[users]"))).toBe(false);
    } finally {
      await harness.store.close();
    }
  });
});

describe("SQL Store transactions (fake driver, no database)", () => {
  it("locks native writes that return rows through all or get", async () => {
    const harness = fakeStore((call) =>
      call.sql.includes("OUTPUT DELETED.id") ? [{ id: 9 }] : [],
    );
    expect(
      await harness.store.get(
        "DELETE FROM news OUTPUT DELETED.id WHERE id = ?",
        9,
      ),
    ).toEqual({ id: 9 });
    expect(harness.calls[0].sql).toContain("sp_getapplock");
    expect(harness.calls[1].sql).toContain(
      "DELETE FROM [touchline_test_mock].news",
    );
    expect(
      harness.calls.every((call) => call.owner === harness.transactions[0]),
    ).toBe(true);
    expect(harness.events.at(-1)).toBe("commit");
    expect(bindSql("SELECT 'UPDATE', [delete] FROM news").writes).toBe(false);
    expect(bindSql("SELECT id INTO #snapshot FROM countries").writes).toBe(
      true,
    );
    await harness.store.close();
  });

  it("binds nested operations to one locked connection and serializes concurrent requests", async () => {
    const harness = fakeStore();
    const result = await harness.store.transaction(async () => {
      await harness.store.setMeta("restore", { stage: 1 });
      await Promise.all([
        harness.store.all("SELECT 1"),
        harness.store.all("SELECT 2"),
      ]);
      return harness.store.transaction(async () => 73);
    });
    expect(result).toBe(73);
    expect(harness.transactions).toHaveLength(1);
    expect(harness.events.filter((event) => event === "commit")).toHaveLength(
      1,
    );
    expect(
      harness.calls.every((call) => call.owner === harness.transactions[0]),
    ).toBe(true);
    expect(harness.calls[0].sql).toContain("sys.sp_getapplock");
    expect(harness.calls[0].sql).toContain("@LockOwner = N'Transaction'");
    expect(harness.calls[0].sql).toContain("SET XACT_ABORT ON");
    expect(harness.calls[0].parameters.worldLock).toBe(
      "touchline:world:touchline_test_mock",
    );
    await harness.store.close();
  });

  it("rolls back even when an inner transaction exception is caught by the caller", async () => {
    const harness = fakeStore();
    await expect(
      harness.store.transaction(async () => {
        await harness.store.exec("UPDATE players SET morale = 1");
        await expect(
          harness.store.transaction(async () => {
            throw new Error("restore failed");
          }),
        ).rejects.toThrow("restore failed");
      }),
    ).rejects.toThrow("restore failed");
    expect(harness.events).toContain("rollback");
    expect(harness.events).not.toContain("commit");
    await harness.store.close();
  });

  it("does not commit after a caught SQL failure or roll back an automatically aborted transaction twice", async () => {
    const harness = fakeStore((call) => {
      if (call.sql === "BROKEN") {
        (call.owner as EventEmitter).emit("rollback", true);
        throw new Error("SQL aborted");
      }
      return [];
    });
    await expect(
      harness.store.transaction(async () => {
        await expect(harness.store.all("BROKEN")).rejects.toThrow(
          "SQL aborted",
        );
      }),
    ).rejects.toThrow("SQL aborted");
    expect(harness.events).not.toContain("commit");
    expect(harness.events).not.toContain("rollback");
    await harness.store.close();
  });

  it("does not call a transaction body when the writer lock fails", async () => {
    const harness = fakeStore((call) => {
      if (call.sql.includes("sp_getapplock")) throw new Error("lock timed out");
      return [];
    });
    const callback = vi.fn(async () => {});
    await expect(harness.store.transaction(callback)).rejects.toThrow(
      "lock timed out",
    );
    expect(callback).not.toHaveBeenCalled();
    expect(harness.events).toContain("rollback");
    await harness.store.close();
  });

  it("keeps transaction-local context out of concurrent external reads", async () => {
    const harness = fakeStore();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const work = harness.store.transaction(async () => {
      entered();
      await gate;
    });
    await inside;
    await harness.store.all("SELECT outside_transaction");
    expect(harness.calls.at(-1)?.owner).toBe(harness.pool);
    const closing = harness.store.close();
    expect(harness.pool.close).not.toHaveBeenCalled();
    release();
    await work;
    await closing;
    expect(harness.pool.close).toHaveBeenCalledOnce();
  });

  it("rejects database work retained in an async context after its transaction completes", async () => {
    const harness = fakeStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let delayed!: Promise<unknown>;
    await harness.store.transaction(async () => {
      delayed = gate.then(async () => harness.store.get("SELECT too_late"));
    });
    const assertion = expect(delayed).rejects.toThrow(/already completed/);
    release();
    await assertion;
    await harness.store.close();
  });

  it("requires the writer transaction for clearWorld and excludes saves/migrations from deletion", async () => {
    const harness = fakeStore((call) =>
      call.sql.includes("FROM sys.tables")
        ? [
            "countries",
            "meta",
            "players",
            "save_slots",
            "save_chunks",
            "schema_migrations",
            "unrelated",
          ].map((name) => ({ name }))
        : [],
    );
    await expect(harness.store.clearWorld()).rejects.toThrow(
      /requires an active/,
    );
    expect(harness.calls).toEqual([]);
    await harness.store.transaction(async () => harness.store.clearWorld());
    const deletes = harness.calls.filter((call) =>
      call.sql.startsWith("DELETE FROM"),
    );
    expect(deletes.map((call) => call.sql)).toEqual([
      "DELETE FROM [touchline_test_mock].[players];",
      "DELETE FROM [touchline_test_mock].[countries];",
      "DELETE FROM [touchline_test_mock].[meta];",
    ]);
    expect(
      deletes.every((call) => call.owner === harness.transactions[0]),
    ).toBe(true);
    expect(harness.calls[0].sql).toContain("sp_getapplock");
    expect(
      harness.calls.some((call) =>
        call.sql.includes("EXEC [touchline_test_mock].[reseed_world_identity]"),
      ),
    ).toBe(true);
    await harness.store.close();
  });

  it("returns mutation metadata and binds Unicode, binary, dates and double precision", async () => {
    const harness = fakeStore();
    const binary = Buffer.from([0, 255]);
    const date = new Date("2026-09-21T00:00:00Z");
    expect(
      await harness.store.run("INSERT INTO promises (target) VALUES (?)", 1e30),
    ).toEqual({ changes: 1, lastInsertRowid: 42 });
    expect(harness.calls.at(-1)?.types.__touchline_arg_0).toBe("Float");
    await harness.store.all(
      "SELECT ?, ?, ?, ?, ?, ?",
      "Unicode text",
      binary,
      date,
      null,
      42,
      1.2345678901234567,
    );
    const call = harness.calls.at(-1)!;
    expect(call.types.__touchline_arg_0).toMatchObject({
      type: "NVarChar",
      length: 65535,
    });
    expect(call.types.__touchline_arg_1).toMatchObject({ type: "VarBinary" });
    expect(call.types.__touchline_arg_2).toMatchObject({ type: "DateTime2" });
    expect(call.types.__touchline_arg_4).toBe("Int");
    expect(call.types.__touchline_arg_5).toBe("Float");
    expect(call.parameters.__touchline_arg_1).toBe(binary);
    await expect(harness.store.all("SELECT ?", Number.NaN)).rejects.toThrow(
      /finite/,
    );
    await harness.store.close();
  });
});

describe("SQL Store bulk operations (fake driver, no database)", () => {
  const metadata = [
    {
      name: "id",
      type: "int",
      max_length: 4,
      scale: 0,
      is_nullable: false,
      is_identity: true,
      is_computed: false,
    },
    {
      name: "target",
      type: "float",
      max_length: 8,
      scale: 0,
      is_nullable: false,
      is_identity: false,
      is_computed: false,
    },
    {
      name: "derived",
      type: "float",
      max_length: 8,
      scale: 0,
      is_nullable: true,
      is_identity: false,
      is_computed: true,
    },
  ];

  it("returns writable columns in order and caches only schema-scoped catalog metadata", async () => {
    const harness = fakeStore((call) =>
      call.sql.includes("FROM sys.columns") ? metadata : [],
    );
    expect(await harness.store.columns("promises")).toEqual(["id", "target"]);
    expect(await harness.store.columns("promises")).toEqual(["id", "target"]);
    expect(harness.calls).toHaveLength(1);
    expect(Object.values(harness.calls[0].parameters)).toEqual([
      "touchline_test_mock",
      "promises",
    ]);
    await expect(harness.store.columns("dbo.promises")).rejects.toThrow(
      /Unknown Touchline table/,
    );
    await harness.store.close();
  });

  it("uses 1000-row SQL bulk chunks, preserves explicit IDs and reseeds to the actual maximum", async () => {
    const harness = fakeStore((call) =>
      call.sql.includes("FROM sys.columns") ? metadata : [],
    );
    const rows = Array.from({ length: 2003 }, (_, index) => ({
      id: index + 100,
      target: 1.2345678901234567,
      derived: 2,
    }));
    await harness.store.bulkInsert("promises", rows);
    const batches = harness.calls.filter((call) => call.kind === "bulk");
    expect(batches.map((call) => call.rows?.length)).toEqual([1000, 1000, 3]);
    expect(batches[0].rows?.[0]).toEqual([100, 1.2345678901234567]);
    expect(batches[2].rows?.at(-1)).toEqual([2102, 1.2345678901234567]);
    expect(
      harness.calls.every((call) => call.owner === harness.transactions[0]),
    ).toBe(true);
    expect(batches.every((call) => call.sql.includes("[touchline_test_mock].[promises]"))).toBe(true);
    expect(harness.calls.some((call) => call.sql.includes("#touchline_bulk_"))).toBe(false);
    expect(
      harness.calls.some((call) => call.sql.includes("TRUNCATE TABLE")),
    ).toBe(false);
    expect(harness.calls.at(-1)?.sql).toContain(
      "EXEC [touchline_test_mock].[reseed_world_identity] @table = N'promises'",
    );
    expect(harness.events.at(-1)).toBe("commit");
    await harness.store.close();
  });

  it("retains the original bulk failure when session cleanup also fails", async () => {
    const harness = fakeStore((call) => {
      if (call.sql.includes("FROM sys.columns")) return metadata;
      if (call.kind === "bulk") throw new Error("original transport timeout");
      if (call.sql.includes("IDENTITY_INSERT") && call.sql.includes("OFF"))
        throw new Error("connection already closed");
      return [];
    });
    const error = await harness.store.bulkInsert("promises", [{ id: 1, target: 2 }]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map((item: Error) => item.message)).toEqual([
      "original transport timeout", "connection already closed",
    ]);
    expect(harness.events).not.toContain("commit");
    await harness.store.close();
  });

  it("rejects mismatched row shapes and rolls back failed bulk copies", async () => {
    const harness = fakeStore((call) => {
      if (call.sql.includes("FROM sys.columns")) return metadata;
      if (call.kind === "bulk") throw new Error("bulk failed");
      return [];
    });
    await expect(
      harness.store.bulkInsert("promises", [{ id: 1, target: 2 }, { id: 2 }]),
    ).rejects.toThrow(/same writable columns/);
    expect(harness.calls.some((call) => call.kind === "bulk")).toBe(false);
    await expect(
      harness.store.bulkInsert("promises", [{ id: 1, target: 2 }]),
    ).rejects.toThrow("bulk failed");
    expect(harness.calls.some((call) => call.sql === "SET XACT_ABORT OFF;")).toBe(true);
    expect(harness.calls.some((call) =>
      call.sql === "SET IDENTITY_INSERT [touchline_test_mock].[promises] OFF; SET XACT_ABORT ON;",
    )).toBe(true);
    expect(harness.events.filter((event) => event === "rollback")).toHaveLength(
      2,
    );
    expect(harness.events).not.toContain("commit");
    await harness.store.close();
  });
});

if (process.env.SQL_INTEGRATION_TESTS === "true") {
  describe("SQL integration (explicit opt-in, real configured database)", () => {
    it("isolates schemas, round-trips IDs/numbers/binary saves, rolls back and protects world replacement", async () => {
      const store = await Store.createTest("store_contract");
      let other: Store | undefined;
      let peer: Store | undefined;
      try {
        other = await Store.createTest("store_isolation");
        expect(store.database).toBe(other.database);
        expect(await store.worldTables()).toEqual([...WORLD_TABLES]);
        await store.schema();
        expect(
          await store.all("SELECT [version] FROM schema_migrations"),
        ).toHaveLength(schemaMigrations(store.schemaName).length);
        await store.exec(`CREATE TRIGGER [${store.schemaName}].[country_insert_probe] ON [${store.schemaName}].[countries]
          AFTER INSERT AS BEGIN SET NOCOUNT ON;
            INSERT INTO [${store.schemaName}].[history] ([season], [entity_type], [entity_id], [date], [data])
            SELECT 2026, N'country', [id], N'2026-07-01', N'{}' FROM inserted; END;`);
        const country = {
          id: 42,
          code: "TEST",
          name: "Test country",
          continent: "Europe",
          confederation: "UEFA",
          reputation: 50,
          language: "Test",
          region: "Test",
        };
        const inserted = await store.run(
          `INSERT INTO countries (id,code,name,continent,confederation,reputation,language,region)
          OUTPUT INSERTED.id VALUES (?,?,?,?,?,?,?,?)`,
          ...Object.values(country),
        );
        expect(inserted).toEqual({ changes: 1, lastInsertRowid: 42 });
        await store.bulkInsert("countries", [
          { ...country, id: 100, code: "BULK" },
          { ...country, id: 77, code: "LOW" },
        ]);
        const automatic = await store.run(
          `INSERT INTO countries (code,name,continent,confederation,reputation,language,region)
          VALUES (?,?,?,?,?,?,?)`,
          "AUTO",
          "Auto",
          "Europe",
          "UEFA",
          50,
          "Test",
          "Test",
        );
        expect(automatic.lastInsertRowid).toBe(101);
        expect(await other.get("SELECT id FROM countries")).toBeUndefined();
        const precise = 1234567890123.4568;
        const promise = await store.run(
          "INSERT INTO promises ([type],target,due_date) VALUES (?,?,?)",
          "precision",
          precise,
          "2026-09-21",
        );
        expect(
          (
            await store.get<{ target: number }>(
              "SELECT target FROM promises WHERE id = ?",
              promise.lastInsertRowid,
            )
          )?.target,
        ).toBe(precise);
        await store.setMeta("rollback", "before");
        await expect(
          store.transaction(async () => {
            await store.setMeta("rollback", "after");
            throw new Error("rollback probe");
          }),
        ).rejects.toThrow("rollback probe");
        expect(await store.meta("rollback")).toBe("before");
        const saveId = randomUUID();
        await store.run(
          "INSERT INTO save_slots (id,name,created_at,automatic,format_version) VALUES (?,?,?,?,?)",
          saveId,
          "Preserved slot",
          new Date(),
          false,
          1,
        );
        const payload = Buffer.from([0, 1, 127, 255]);
        await store.bulkInsert("save_chunks", [
          { save_id: saveId, ordinal: 0, data: payload },
        ]);
        expect(
          (
            await store.get<{ data: Buffer }>(
              "SELECT data FROM save_chunks WHERE save_id = ?",
              saveId,
            )
          )?.data,
        ).toEqual(payload);
        vi.stubEnv("SQL_SCHEMA", store.schemaName);
        vi.stubEnv("SQL_TEST_MODE", "true");
        peer = await Store.open();
        let release!: () => void;
        let entered!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const acquired = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const holder = store.transaction(async () => {
          entered();
          await gate;
        });
        await acquired;
        let replacementStarted = false;
        const replacement = peer.transaction(async () => {
          replacementStarted = true;
          await peer!.clearWorld();
        });
        try {
          await new Promise((resolve) => setTimeout(resolve, 100));
          expect(replacementStarted).toBe(false);
        } finally {
          release();
          await holder;
        }
        await replacement;
        expect(await store.get("SELECT id FROM countries")).toBeUndefined();
        expect(
          await store.get("SELECT id FROM save_slots WHERE id = ?", saveId),
        ).toBeDefined();
        expect(
          await store.all("SELECT [version] FROM schema_migrations"),
        ).toHaveLength(schemaMigrations(store.schemaName).length);
        const reset = await store.run(
          `INSERT INTO countries (code,name,continent,confederation,reputation,language,region)
          VALUES (?,?,?,?,?,?,?)`,
          "RESET",
          "Reset",
          "Europe",
          "UEFA",
          50,
          "Test",
          "Test",
        );
        expect(reset.lastInsertRowid).toBe(1);
        await store.run("DELETE FROM save_slots WHERE id = ?", saveId);
        expect(
          await store.get(
            "SELECT ordinal FROM save_chunks WHERE save_id = ?",
            saveId,
          ),
        ).toBeUndefined();
      } finally {
        await Promise.all([peer?.close(), other?.close(), store.close()]);
      }
    }, 180000);
  });
}
