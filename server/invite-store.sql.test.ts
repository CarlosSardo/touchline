import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Store, sqlPoolConfig } from "./db.ts";
import { CONSUMER_TENANT_ID, InviteStore } from "./invite-store.ts";
import { readSqlSettings } from "./sql-config.ts";
import { accountsTableSql, inviteRequestsTableSql, quoteIdentifier, schemaMigrations, sqlLiteral, tableName } from "./sql-schema.ts";
import { LEGACY_EMAIL, LEGACY_OBJECT_ID, OWNER_EMAIL_DEFAULT } from "./legacy-account.ts";
import { accountProceduresSql, runtimeGrants } from "../scripts/db-authorize.ts";

const localSql = process.env.SQL_INTEGRATION_TESTS === "true" &&
  ["127.0.0.1", "localhost", "::1"].includes(process.env.SQL_SERVER ?? "") &&
  process.env.SQL_PORT === "14330" && process.env.SQL_USER === "sa" && Boolean(process.env.SQL_PASSWORD);

describe.skipIf(!localSql)("invite account SQL procedures (local disposable database)", () => {
  it("claims invited worlds, blocks capacity and rebinds the legacy dbo account", async () => {
    const configuredDatabase = process.env.SQL_DATABASE;
    const database = `touchline_test_invites_${randomUUID().replaceAll("-", "")}`;
    if (!/^touchline_test_invites_[a-f0-9]{32}$/.test(database) || database === configuredDatabase)
      throw new Error("Invite SQL regression requires a fresh owned database.");
    for (const name of ["SQL_ALLOW_REMOTE_TESTS", "SQL_TEST_DATABASE", "TOUCHLINE_E2E_SCHEMA", "AZURE_CLIENT_ID", "CONTAINER_APP_NAME"])
      vi.stubEnv(name, undefined);
    vi.stubEnv("SQL_DATABASE", database);
    vi.stubEnv("SQL_SCHEMA", "dbo");
    vi.stubEnv("SQL_TEST_MODE", "false");
    const settings = readSqlSettings();
    const { default: sql } = await import("mssql");
    const master = new sql.ConnectionPool(sqlPoolConfig({ ...settings, database: "master" }));
    let root: Store | undefined;
    let databaseCreated = false;
    try {
      await master.connect();
      await master.request().batch(`CREATE DATABASE ${quoteIdentifier(database)};`);
      databaseCreated = true;
      root = await Store.open(database);
      await root.schema();
      await root.exec(`CREATE SCHEMA [accounts] AUTHORIZATION [dbo];`);
      await root.exec(accountsTableSql("accounts"));
      await root.exec(inviteRequestsTableSql("accounts"));
      const runtime = "touchline_invite_runtime";
      const ownerObjectId = "22222222-2222-4222-8222-222222222222";
      await root.exec(`CREATE USER ${quoteIdentifier(runtime)} WITHOUT LOGIN;`);
      await root.exec(accountProceduresSql("accounts", runtime, ownerObjectId, OWNER_EMAIL_DEFAULT, 1, 24));
      for (const grant of runtimeGrants(runtime, [], "accounts")) await root.exec(grant);

      const accountId = randomUUID();
      const requestId = randomUUID();
      await root.run(
        `INSERT INTO [accounts].[invite_requests]
          ([id], [email], [status], [account_id], [requested_at], [updated_at])
         VALUES (CONVERT(uniqueidentifier, ?), ?, N'accepted', CONVERT(uniqueidentifier, ?), SYSUTCDATETIME(), SYSUTCDATETIME())`,
        requestId,
        "guest@example.test",
        accountId,
      );
      const queryAsRuntime = <Result>(statement: string) => root!.all<Result>(`
        EXECUTE AS USER = ${sqlLiteral(runtime)};
        BEGIN TRY
          ${statement}
          REVERT;
        END TRY
        BEGIN CATCH
          REVERT;
          THROW;
        END CATCH;`);
      expect(await queryAsRuntime(
        `EXEC [accounts].[claim_invited_account]
          @request_id = CONVERT(uniqueidentifier, ${sqlLiteral(requestId)}),
          @tenant_id = CONVERT(uniqueidentifier, ${sqlLiteral(CONSUMER_TENANT_ID)}),
          @object_id = CONVERT(uniqueidentifier, ${sqlLiteral("33333333-3333-4333-8333-333333333333")}),
          @email = N'guest@example.test', @display_name = N'Guest';`,
      )).toEqual([{ outcome: "claimed", reason: null }]);
      const schema = `touchline_user_${accountId.replaceAll("-", "")}`;
      expect(await root.all(`SELECT [version], [name] FROM ${tableName(schema, "schema_migrations")} ORDER BY [version]`))
        .toEqual(schemaMigrations(schema).map(({ version, name }) => ({ version, name })));
      expect(await root.get(`SELECT [status] FROM [accounts].[invite_requests] WHERE [id] = CONVERT(uniqueidentifier, ?)`, requestId))
        .toEqual({ status: "claimed" });
      expect(await queryAsRuntime(`SELECT HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'CREATE SCHEMA') AS [allowed];`))
        .toEqual([{ allowed: 0 }]);

      await root.exec(accountProceduresSql("accounts", runtime, ownerObjectId, OWNER_EMAIL_DEFAULT, 2, 24));
      const secondId = randomUUID();
      await root.run(
        `INSERT INTO [accounts].[invite_requests] ([id], [email], [status], [requested_at], [updated_at])
         VALUES (CONVERT(uniqueidentifier, ?), N'second@example.test', N'accepted', SYSUTCDATETIME(), SYSUTCDATETIME())`,
        secondId,
      );
      expect(await queryAsRuntime(
        `EXEC [accounts].[claim_invited_account]
          @request_id = CONVERT(uniqueidentifier, ${sqlLiteral(secondId)}),
          @tenant_id = CONVERT(uniqueidentifier, ${sqlLiteral(CONSUMER_TENANT_ID)}),
          @object_id = CONVERT(uniqueidentifier, ${sqlLiteral("66666666-6666-4666-8666-666666666666")}),
          @email = N'second@example.test', @display_name = N'Second';`,
      )).toEqual([{ outcome: "claimed", reason: null }]);

      const blockedId = randomUUID();
      await root.run(
        `INSERT INTO [accounts].[invite_requests] ([id], [email], [status], [requested_at], [updated_at])
         VALUES (CONVERT(uniqueidentifier, ?), N'blocked@example.test', N'accepted', SYSUTCDATETIME(), SYSUTCDATETIME())`,
        blockedId,
      );
      expect(await queryAsRuntime(
        `EXEC [accounts].[claim_invited_account]
          @request_id = CONVERT(uniqueidentifier, ${sqlLiteral(blockedId)}),
          @tenant_id = CONVERT(uniqueidentifier, ${sqlLiteral(CONSUMER_TENANT_ID)}),
          @object_id = CONVERT(uniqueidentifier, ${sqlLiteral("44444444-4444-4444-8444-444444444444")}),
          @email = N'blocked@example.test', @display_name = N'Blocked';`,
      )).toEqual([{ outcome: "capacity", reason: "player_limit" }]);

      const legacyId = randomUUID();
      await root.run(
        `INSERT INTO [accounts].[users] ([id], [tenant_id], [object_id], [display_name], [email], [game_schema])
         VALUES (CONVERT(uniqueidentifier, ?), CONVERT(uniqueidentifier, ?), CONVERT(uniqueidentifier, ?), N'Legacy', ?, N'dbo')`,
        legacyId,
        "11111111-1111-4111-8111-111111111111",
        LEGACY_OBJECT_ID,
        LEGACY_EMAIL,
      );
      expect(await queryAsRuntime(
        `EXEC [accounts].[rebind_account]
          @from_tenant_id = CONVERT(uniqueidentifier, ${sqlLiteral("11111111-1111-4111-8111-111111111111")}),
          @from_object_id = CONVERT(uniqueidentifier, ${sqlLiteral(LEGACY_OBJECT_ID)}),
          @to_tenant_id = CONVERT(uniqueidentifier, ${sqlLiteral(CONSUMER_TENANT_ID)}),
          @to_object_id = CONVERT(uniqueidentifier, ${sqlLiteral("55555555-5555-4555-8555-555555555555")}),
          @email = ${sqlLiteral(LEGACY_EMAIL)};`,
      )).toEqual([{ outcome: "rebound" }]);
      expect(await root.get(`SELECT [tenant_id], [object_id] FROM [accounts].[users] WHERE [id] = CONVERT(uniqueidentifier, ?)`, legacyId))
        .toMatchObject({ tenant_id: CONSUMER_TENANT_ID, object_id: "55555555-5555-4555-8555-555555555555" });

      await root.run(
        `INSERT INTO [accounts].[users] ([id], [tenant_id], [object_id], [display_name], [email], [game_schema])
         VALUES (CONVERT(uniqueidentifier, ?), CONVERT(uniqueidentifier, ?), CONVERT(uniqueidentifier, ?), N'Owner', ?, ?)`,
        randomUUID(),
        CONSUMER_TENANT_ID,
        ownerObjectId,
        OWNER_EMAIL_DEFAULT,
        `touchline_user_${randomUUID().replaceAll("-", "")}`,
      );
      await root.exec(accountProceduresSql("accounts", runtime, ownerObjectId, OWNER_EMAIL_DEFAULT, 10, 24));
      const store = new InviteStore(root, {
        maxPlayers: 10,
        sizeLimitGb: 24,
        ownerObjectId,
        ownerEmail: OWNER_EMAIL_DEFAULT,
      });
      expect(await store.capacity()).toMatchObject({ players: 3, maxPlayers: 10, available: true });
    } finally {
      await root?.close();
      if (databaseCreated) {
        try {
          await master.request().batch(`ALTER DATABASE ${quoteIdentifier(database)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
            DROP DATABASE ${quoteIdentifier(database)};`);
        } finally {
          await master.close();
        }
      } else await master.close();
    }
  });
});
