import { parseArgs } from "node:util";
import { isMain } from "./data-export.ts";
import { accountUuid, registeredAccountSchemas, validateAccountSchema, validateAccountWorldSchema } from "../server/accounts.ts";
import { CONSUMER_TENANT_ID } from "../server/invite-store.ts";
import { LEGACY_EMAIL, LEGACY_OBJECT_ID, OWNER_EMAIL_DEFAULT } from "../server/legacy-account.ts";
import {
  WORLD_TABLES,
  appearanceBackfill,
  migrationTableSql,
  quoteIdentifier,
  schemaMigrations,
  sqlLiteral,
  tableName,
} from "../server/sql-schema.ts";

const CLAIM_SCHEMA_TOKEN = "__touchline_claim_schema__";

export function claimWorldMigrationStatements(schema = CLAIM_SCHEMA_TOKEN): string[] {
  return schemaMigrations(schema).flatMap((migration) => migration.statements);
}

function dynamicSchemaStatement(statement: string): string {
  return `SET @statement = ${sqlLiteral(statement)};
            SET @statement = REPLACE(@statement, ${sqlLiteral(quoteIdentifier(CLAIM_SCHEMA_TOKEN))}, QUOTENAME(@schema));
            EXEC sys.sp_executesql @statement;`;
}

function claimMigrationSql(): string {
  const batches: string[] = [dynamicSchemaStatement(migrationTableSql(CLAIM_SCHEMA_TOKEN))];
  for (const migration of schemaMigrations(CLAIM_SCHEMA_TOKEN)) {
    batches.push(`SET @statement = N'SELECT @already = COUNT_BIG(*) FROM ' + QUOTENAME(@schema)
              + N'.[schema_migrations] WHERE [version] = @version;';
            EXEC sys.sp_executesql @statement, N'@version int, @already bigint OUTPUT',
              @version = ${migration.version}, @already = @already OUTPUT;
            IF @already = 0
            BEGIN
              ${migration.statements.map(dynamicSchemaStatement).join("\n              ")}
              SET @statement = N'INSERT INTO ' + QUOTENAME(@schema)
                + N'.[schema_migrations] ([version], [name]) VALUES (@version, @name);';
              EXEC sys.sp_executesql @statement, N'@version int, @name nvarchar(200)',
                @version = ${migration.version}, @name = ${sqlLiteral(migration.name)};
            END;`);
  }
  batches.push(`SET @statement = N'SELECT @already = COUNT_BIG(*) FROM ' + QUOTENAME(@schema)
              + N'.[meta] WHERE [key] = N''appearanceIndexVersion'';';
            EXEC sys.sp_executesql @statement, N'@already bigint OUTPUT', @already = @already OUTPUT;
            IF @already = 0
            BEGIN
              ${appearanceBackfill(CLAIM_SCHEMA_TOKEN).map(dynamicSchemaStatement).join("\n              ")}
              SET @statement = N'INSERT INTO ' + QUOTENAME(@schema)
                + N'.[meta] ([key], [value]) VALUES (N''appearanceIndexVersion'', N''1'');';
              EXEC sys.sp_executesql @statement;
            END;`);
  return batches.join("\n            ");
}

function grantRuntimeToClaimedSchemaSql(runtimePrincipal: string): string {
  const principal = quoteIdentifier(runtimePrincipal);
  return [
    `SET @statement = N'GRANT SELECT, INSERT, UPDATE, DELETE, VIEW DEFINITION ON SCHEMA::'
              + QUOTENAME(@schema) + N' TO ${principal};';
            EXEC sys.sp_executesql @statement;`,
    `SET @statement = N'GRANT EXECUTE ON OBJECT::' + QUOTENAME(@schema)
              + N'.[reseed_world_identity] TO ${principal};';
            EXEC sys.sp_executesql @statement;`,
    ...WORLD_TABLES.map((table) => `SET @statement = N'GRANT ALTER ON OBJECT::' + QUOTENAME(@schema)
              + N'.${quoteIdentifier(table)} TO ${principal};';
            EXEC sys.sp_executesql @statement;`),
  ].join("\n            ");
}

export function accountProceduresSql(
  accountSchema: string,
  runtimePrincipal: string,
  ownerObjectId: string,
  ownerEmail = OWNER_EMAIL_DEFAULT,
  maxPlayers = 10,
  sizeLimitGb = 24,
): string {
  validateAccountSchema(accountSchema);
  accountUuid(ownerObjectId, "OWNER_OBJECT_ID");
  if (!Number.isInteger(maxPlayers) || maxPlayers < 1)
    throw new Error("MAX_PLAYERS must be a positive integer.");
  if (!Number.isInteger(sizeLimitGb) || sizeLimitGb < 1)
    throw new Error("INVITE_DB_SIZE_LIMIT_GB must be a positive integer.");
  const ownerEmailNormalized = ownerEmail.trim().toLowerCase();
  if (!ownerEmailNormalized || ownerEmailNormalized.length > 320)
    throw new Error("OWNER_EMAIL is invalid.");
  if (!/^[A-Za-z][A-Za-z\d_-]{0,127}$/.test(runtimePrincipal) ||
      /^(dbo|guest|sys|public|information_schema)$/i.test(runtimePrincipal))
    throw new Error("--name must be a non-reserved SQL principal name.");
  const users = tableName(accountSchema, "users");
  const invites = tableName(accountSchema, "invite_requests");
  const capacity = tableName(accountSchema, "invite_capacity");
  const createInvite = tableName(accountSchema, "create_invite");
  const decideInvite = tableName(accountSchema, "decide_invite");
  const purgeInvites = tableName(accountSchema, "purge_expired_invites");
  const claim = tableName(accountSchema, "claim_invited_account");
  const rebind = tableName(accountSchema, "rebind_account");
  const capacityProc = `CREATE OR ALTER PROCEDURE ${capacity}
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @players bigint = (
    SELECT COUNT_BIG(*) FROM ${users}
    WHERE [object_id] <> CONVERT(uniqueidentifier, ${sqlLiteral(ownerObjectId)})
      AND NOT ([tenant_id] = CONVERT(uniqueidentifier, ${sqlLiteral(CONSUMER_TENANT_ID)})
        AND LOWER(COALESCE([email], N'')) = ${sqlLiteral(ownerEmailNormalized)})
  );
  DECLARE @reserved bigint = (
    SELECT COUNT_BIG(*) FROM ${invites} WHERE [status] = N'accepted'
  );
  DECLARE @database_size_gb float = (
    SELECT COALESCE(SUM(CAST([size] AS float)) * 8 / 1024 / 1024, 0) FROM sys.database_files
  );
  SELECT @players AS [players], @reserved AS [reserved], @database_size_gb AS [database_size_gb],
    ${maxPlayers} AS [max_players], ${sizeLimitGb} AS [size_limit_gb],
    CASE WHEN @players + @reserved >= ${maxPlayers} THEN N'player_limit'
      WHEN @database_size_gb >= ${sizeLimitGb} THEN N'database_size'
      ELSE NULL END AS [reason];
END;
`;
  const createInviteProc = `CREATE OR ALTER PROCEDURE ${createInvite}
  @id uniqueidentifier,
  @email nvarchar(320),
  @note nvarchar(500) = NULL,
  @ip_hash char(64) = NULL
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @email_normalized nvarchar(320) = LOWER(LTRIM(RTRIM(@email)));
  IF @email_normalized IS NULL OR LEN(@email_normalized) = 0 OR LEN(@email_normalized) > 320
    THROW 51000, 'Invite email is invalid.', 1;
  INSERT INTO ${invites} ([id], [email], [note], [status], [ip_hash], [requested_at], [updated_at])
    VALUES (@id, @email_normalized, NULLIF(LTRIM(RTRIM(@note)), N''), N'pending', @ip_hash, SYSUTCDATETIME(), SYSUTCDATETIME());
  SELECT N'created' AS [outcome];
END;
`;
  const decideInviteProc = `CREATE OR ALTER PROCEDURE ${decideInvite}
  @id uniqueidentifier,
  @action nvarchar(16),
  @decided_by nvarchar(320)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET XACT_ABORT ON;
  SET NOCOUNT ON;
  DECLARE @actor nvarchar(320) = LOWER(LTRIM(RTRIM(@decided_by)));
  IF @action NOT IN (N'accept', N'deny') OR @actor IS NULL OR LEN(@actor) = 0 OR LEN(@actor) > 320
  BEGIN
    SELECT N'not_found' AS [outcome], CAST(NULL AS nvarchar(32)) AS [reason];
    RETURN;
  END;
  BEGIN TRANSACTION;
  DECLARE @lockResult int;
  EXEC @lockResult = sys.sp_getapplock @Resource = N'touchline:account-registry',
    @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 30000;
  IF @lockResult < 0 THROW 51000, 'Account registry lock could not be acquired.', 1;
  DECLARE @status nvarchar(16);
  SELECT @status = [status] FROM ${invites} WITH (UPDLOCK, HOLDLOCK) WHERE [id] = @id;
  IF @status IS NULL
  BEGIN
    COMMIT TRANSACTION;
    SELECT N'not_found' AS [outcome], CAST(NULL AS nvarchar(32)) AS [reason];
    RETURN;
  END;
  IF @status <> N'pending'
  BEGIN
    COMMIT TRANSACTION;
    SELECT N'unchanged' AS [outcome], CAST(NULL AS nvarchar(32)) AS [reason];
    RETURN;
  END;
  IF @action = N'accept'
  BEGIN
    DECLARE @capacity TABLE ([players] bigint, [reserved] bigint, [database_size_gb] float,
      [max_players] int, [size_limit_gb] int, [reason] nvarchar(32) NULL);
    INSERT INTO @capacity EXEC ${capacity};
    DECLARE @reason nvarchar(32) = (SELECT TOP (1) [reason] FROM @capacity);
    IF @reason IS NOT NULL
    BEGIN
      COMMIT TRANSACTION;
      SELECT N'capacity' AS [outcome], @reason AS [reason];
      RETURN;
    END;
  END;
  UPDATE ${invites}
    SET [status] = CASE WHEN @action = N'accept' THEN N'accepted' ELSE N'denied' END,
      [decided_at] = SYSUTCDATETIME(), [decided_by] = @actor,
      [account_id] = CASE WHEN @action = N'accept' THEN COALESCE([account_id], NEWID()) ELSE [account_id] END,
      [updated_at] = SYSUTCDATETIME()
    WHERE [id] = @id AND [status] = N'pending';
  DECLARE @changed int = @@ROWCOUNT;
  COMMIT TRANSACTION;
  SELECT CASE WHEN @changed = 1 AND @action = N'accept' THEN N'accepted'
    WHEN @changed = 1 THEN N'denied' ELSE N'unchanged' END AS [outcome],
    CAST(NULL AS nvarchar(32)) AS [reason];
END;
`;
  const purgeInviteProc = `CREATE OR ALTER PROCEDURE ${purgeInvites}
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  DELETE FROM ${invites}
   WHERE ([status] = N'denied' AND [updated_at] < DATEADD(day, -30, SYSUTCDATETIME()))
      OR ([status] = N'pending' AND [requested_at] < DATEADD(day, -60, SYSUTCDATETIME()));
  SELECT @@ROWCOUNT AS [purged];
END;
`;
  const rebindProc = `CREATE OR ALTER PROCEDURE ${rebind}
  @from_tenant_id uniqueidentifier,
  @from_object_id uniqueidentifier,
  @to_tenant_id uniqueidentifier,
  @to_object_id uniqueidentifier,
  @email nvarchar(320)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET XACT_ABORT ON;
  SET NOCOUNT ON;
  DECLARE @email_normalized nvarchar(320) = LOWER(LTRIM(RTRIM(@email)));
  IF @to_tenant_id <> CONVERT(uniqueidentifier, ${sqlLiteral(CONSUMER_TENANT_ID)})
    OR @email_normalized NOT IN (${sqlLiteral(LEGACY_EMAIL)}, ${sqlLiteral(ownerEmailNormalized)})
    OR (@email_normalized = ${sqlLiteral(LEGACY_EMAIL)}
      AND @from_object_id <> CONVERT(uniqueidentifier, ${sqlLiteral(LEGACY_OBJECT_ID)}))
    OR (@email_normalized = ${sqlLiteral(ownerEmailNormalized)}
      AND @from_object_id <> CONVERT(uniqueidentifier, ${sqlLiteral(ownerObjectId)}))
  BEGIN
    SELECT N'unchanged' AS [outcome];
    RETURN;
  END;
  BEGIN TRANSACTION;
  DECLARE @lockResult int;
  EXEC @lockResult = sys.sp_getapplock @Resource = N'touchline:account-registry',
    @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 30000;
  IF @lockResult < 0 THROW 51000, 'Account registry lock could not be acquired.', 1;
  IF EXISTS (SELECT 1 FROM ${users} WHERE [tenant_id] = @to_tenant_id AND [object_id] = @to_object_id)
  BEGIN
    COMMIT TRANSACTION;
    SELECT N'unchanged' AS [outcome];
    RETURN;
  END;
  UPDATE ${users}
    SET [tenant_id] = @to_tenant_id, [object_id] = @to_object_id, [email] = @email_normalized,
      [updated_at] = SYSUTCDATETIME()
    WHERE [tenant_id] = @from_tenant_id
      AND [object_id] = @from_object_id
      AND (
        (@email_normalized = ${sqlLiteral(LEGACY_EMAIL)} AND [game_schema] = N'dbo')
        OR @email_normalized = ${sqlLiteral(ownerEmailNormalized)}
      );
  DECLARE @changed int = @@ROWCOUNT;
  COMMIT TRANSACTION;
  SELECT CASE WHEN @changed = 1 THEN N'rebound' ELSE N'unchanged' END AS [outcome];
END;
`;
  const claimProc = `CREATE OR ALTER PROCEDURE ${claim}
  @request_id uniqueidentifier,
  @tenant_id uniqueidentifier,
  @object_id uniqueidentifier,
  @email nvarchar(320),
  @display_name nvarchar(200)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET XACT_ABORT ON;
  SET NOCOUNT ON;
  DECLARE @email_normalized nvarchar(320) = LOWER(LTRIM(RTRIM(@email)));
  IF @tenant_id <> CONVERT(uniqueidentifier, ${sqlLiteral(CONSUMER_TENANT_ID)}) OR @email_normalized IS NULL
    OR LEN(@email_normalized) = 0 OR LEN(@email_normalized) > 320
    OR @display_name IS NULL OR LEN(LTRIM(RTRIM(@display_name))) = 0 OR LEN(@display_name) > 200
  BEGIN
    SELECT N'not_found' AS [outcome], CAST(NULL AS nvarchar(32)) AS [reason];
    RETURN;
  END;
  BEGIN TRANSACTION;
  DECLARE @lockResult int;
  EXEC @lockResult = sys.sp_getapplock @Resource = N'touchline:schema-maintenance',
    @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 120000;
  IF @lockResult < 0 THROW 51000, 'Account schema maintenance lock could not be acquired.', 1;
  EXEC @lockResult = sys.sp_getapplock @Resource = N'touchline:account-registry',
    @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 30000;
  IF @lockResult < 0 THROW 51000, 'Account registry lock could not be acquired.', 1;

  DECLARE @request_email nvarchar(320), @status nvarchar(16), @account_id uniqueidentifier;
  SELECT @request_email = [email], @status = [status], @account_id = [account_id]
    FROM ${invites} WITH (UPDLOCK, HOLDLOCK)
    WHERE [id] = @request_id;
  IF @status IS NULL
  BEGIN
    COMMIT TRANSACTION;
    SELECT N'not_found' AS [outcome], CAST(NULL AS nvarchar(32)) AS [reason];
    RETURN;
  END;
  IF @status = N'claimed'
  BEGIN
    COMMIT TRANSACTION;
    SELECT N'claimed' AS [outcome], CAST(NULL AS nvarchar(32)) AS [reason];
    RETURN;
  END;
  IF @status <> N'accepted' OR @request_email <> @email_normalized
  BEGIN
    COMMIT TRANSACTION;
    SELECT N'not_found' AS [outcome], CAST(NULL AS nvarchar(32)) AS [reason];
    RETURN;
  END;

  DECLARE @existing_id uniqueidentifier, @existing_schema nvarchar(128);
  SELECT @existing_id = [id], @existing_schema = [game_schema]
    FROM ${users} WITH (UPDLOCK, HOLDLOCK)
    WHERE [tenant_id] = @tenant_id AND [object_id] = @object_id;
  IF @existing_id IS NOT NULL
  BEGIN
    IF @account_id IS NOT NULL AND @account_id <> @existing_id
      THROW 51000, 'Invite account identity mismatch.', 1;
    UPDATE ${invites} SET [status] = N'claimed', [account_id] = @existing_id, [updated_at] = SYSUTCDATETIME()
      WHERE [id] = @request_id;
    COMMIT TRANSACTION;
    SELECT N'claimed' AS [outcome], CAST(NULL AS nvarchar(32)) AS [reason];
    RETURN;
  END;

  DECLARE @players bigint = (
    SELECT COUNT_BIG(*) FROM ${users}
    WHERE [object_id] <> CONVERT(uniqueidentifier, ${sqlLiteral(ownerObjectId)})
      AND NOT ([tenant_id] = CONVERT(uniqueidentifier, ${sqlLiteral(CONSUMER_TENANT_ID)})
        AND LOWER(COALESCE([email], N'')) = ${sqlLiteral(ownerEmailNormalized)})
  );
  DECLARE @reserved bigint = (
    SELECT COUNT_BIG(*) FROM ${invites} WHERE [status] = N'accepted' AND [id] <> @request_id
  );
  DECLARE @database_size_gb float = (
    SELECT COALESCE(SUM(CAST([size] AS float)) * 8 / 1024 / 1024, 0) FROM sys.database_files
  );
  DECLARE @reason nvarchar(32) = CASE
    WHEN @players + @reserved >= ${maxPlayers} THEN N'player_limit'
    WHEN @database_size_gb >= ${sizeLimitGb} THEN N'database_size'
    ELSE NULL END;
  IF @reason IS NOT NULL
  BEGIN
    COMMIT TRANSACTION;
    SELECT N'capacity' AS [outcome], @reason AS [reason];
    RETURN;
  END;

  SET @account_id = COALESCE(@account_id, NEWID());
  DECLARE @schema nvarchar(128) = N'touchline_user_' + REPLACE(CONVERT(nvarchar(36), @account_id), N'-', N'');
  IF EXISTS (SELECT 1 FROM ${users} WHERE [id] = @account_id OR [game_schema] = @schema)
    THROW 51000, 'Invite account collision.', 1;
  DECLARE @statement nvarchar(max), @already bigint;
  IF SCHEMA_ID(@schema) IS NULL
  BEGIN
    SET @statement = N'CREATE SCHEMA ' + QUOTENAME(@schema) + N' AUTHORIZATION [dbo];';
    EXEC sys.sp_executesql @statement;
  END
  ELSE IF OBJECT_ID(QUOTENAME(@schema) + N'.[schema_migrations]', N'U') IS NULL
    THROW 51000, 'Unregistered invite schema collision.', 1;

  ${claimMigrationSql()}
  ${grantRuntimeToClaimedSchemaSql(runtimePrincipal)}

  INSERT INTO ${users} ([id], [tenant_id], [object_id], [display_name], [email], [game_schema])
    VALUES (@account_id, @tenant_id, @object_id, @display_name, @email_normalized, @schema);
  UPDATE ${invites}
    SET [status] = N'claimed', [account_id] = @account_id, [updated_at] = SYSUTCDATETIME()
    WHERE [id] = @request_id AND [status] = N'accepted';
  COMMIT TRANSACTION;
  SELECT N'claimed' AS [outcome], CAST(NULL AS nvarchar(32)) AS [reason];
END;`;
  return [
    `DROP PROCEDURE IF EXISTS ${tableName(accountSchema, "rebind_legacy_account")};`,
    ...[capacityProc, createInviteProc, decideInviteProc, purgeInviteProc, rebindProc, claimProc]
      .map((procedure) => `EXEC(${sqlLiteral(procedure)});`),
  ].join("\n");
}

export function runtimeGrants(name: string, schemas: string[], accountSchema?: string): string[] {
  if (!/^[A-Za-z][A-Za-z\d_-]{0,127}$/.test(name) || /^(dbo|guest|sys|public|information_schema)$/i.test(name))
    throw new Error("--name must be a non-reserved SQL principal name.");
  if (accountSchema) validateAccountSchema(accountSchema);
  const user = quoteIdentifier(name);
  const grants = [`GRANT CONNECT TO ${user};`];
  if (new Set(schemas.map((schema) => schema.toLowerCase())).size !== schemas.length)
    throw new Error("Runtime world schema collision.");
  for (const schema of schemas) {
    validateAccountWorldSchema(schema, accountSchema ?? "accounts");
    grants.push(
      `GRANT SELECT, INSERT, UPDATE, DELETE, VIEW DEFINITION ON SCHEMA::${quoteIdentifier(schema)} TO ${user};`,
      `GRANT EXECUTE ON OBJECT::${tableName(schema, "reseed_world_identity")} TO ${user};`,
      ...WORLD_TABLES.map((table) => `GRANT ALTER ON OBJECT::${tableName(schema, table)} TO ${user};`),
    );
  }
  if (accountSchema) grants.push(
    `GRANT SELECT, VIEW DEFINITION ON OBJECT::${tableName(accountSchema, "users")} TO ${user};`,
    `GRANT UPDATE ON OBJECT::${tableName(accountSchema, "users")} ([display_name], [email], [updated_at]) TO ${user};`,
    `GRANT SELECT ON OBJECT::${tableName(accountSchema, "invite_requests")} TO ${user};`,
    `GRANT UPDATE ON OBJECT::${tableName(accountSchema, "invite_requests")} ([approval_email_sent], [accepted_email_sent], [updated_at]) TO ${user};`,
    `GRANT SELECT, INSERT, DELETE ON OBJECT::${tableName(accountSchema, "invite_attempts")} TO ${user};`,
    `GRANT EXECUTE ON OBJECT::${tableName(accountSchema, "create_invite")} TO ${user};`,
    `GRANT EXECUTE ON OBJECT::${tableName(accountSchema, "decide_invite")} TO ${user};`,
    `GRANT EXECUTE ON OBJECT::${tableName(accountSchema, "purge_expired_invites")} TO ${user};`,
    `GRANT EXECUTE ON OBJECT::${tableName(accountSchema, "invite_capacity")} TO ${user};`,
    `GRANT EXECUTE ON OBJECT::${tableName(accountSchema, "claim_invited_account")} TO ${user};`,
    `GRANT EXECUTE ON OBJECT::${tableName(accountSchema, "rebind_account")} TO ${user};`,
  );
  return grants;
}

function positiveEnvInt(name: string, fallback: number): number {
  const value = process.env[name] ?? String(fallback);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      help: { type: "boolean" },
      "client-id": { type: "string" },
      name: { type: "string" },
      registered: { type: "boolean" },
      "account-schema": { type: "string" },
      "owner-object-id": { type: "string" },
      "owner-email": { type: "string" },
      "dry-run": { type: "boolean" },
      apply: { type: "boolean" },
      yes: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: tsx scripts/db-authorize.ts --client-id UUID --name NAME [--registered --account-schema accounts] [--apply --yes]\n" +
      "Default: offline permission plan. Apply through scripts/azure-sql.sh.\n" +
      "Creates an Entra contained user from the managed identity application/client ID, without Graph.\n" +
      "Grants dbo CRUD by default; --registered grants each registered world schema, VIEW DEFINITION and world-table ALTER for restores.\n" +
      "Registry access is SELECT and profile-column UPDATE only, never INSERT/DELETE or identity/schema reassignment.\n" +
      "With --registered, recreates invite owner procedures and grants runtime invite table/procedure access.\n" +
      "Never grants db_owner/db_ddladmin or schema ownership. Test contexts are refused.\n" +
      "Identity reseeding uses a schema-scoped, table-allowlisted owner-executed procedure.\n" +
      "The runtime receives EXECUTE on that helper, never database-owner membership.",
    );
    return;
  }
  const clientId = values["client-id"];
  const name = values.name;
  if (!clientId || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(clientId))
    throw new Error("--client-id must be the managed identity application/client UUID, not its object/principal ID.");
  if (!name || !/^[A-Za-z][A-Za-z\d_-]{0,127}$/.test(name) || /^(dbo|guest|sys|public|information_schema)$/i.test(name))
    throw new Error("--name must be a non-reserved SQL principal name.");
  if ((process.env.SQL_SCHEMA ?? "dbo") !== "dbo" ||
      process.env.SQL_TEST_MODE === "true" || process.env.SQL_ALLOW_REMOTE_TESTS === "true" ||
      process.env.SQL_TEST_DATABASE || process.env.TOUCHLINE_E2E_SCHEMA)
    throw new Error("Runtime authorization refuses every test context and non-dbo schema.");
  if (values.apply && !values.yes)
    throw new Error("Permission changes require --apply --yes.");
  if (values.apply && values["dry-run"])
    throw new Error("Choose --apply or --dry-run, not both.");
  if (values["account-schema"] && !values.registered)
    throw new Error("--account-schema requires --registered.");
  const accountSchema = values.registered ? validateAccountSchema(values["account-schema"] ?? "accounts") : undefined;
  const ownerObjectId = accountSchema
    ? accountUuid(values["owner-object-id"] ?? process.env.OWNER_OBJECT_ID ?? "", "OWNER_OBJECT_ID")
    : undefined;
  const ownerEmail = accountSchema ? (values["owner-email"] ?? process.env.OWNER_EMAIL ?? OWNER_EMAIL_DEFAULT).trim().toLowerCase() : undefined;
  if (ownerEmail !== undefined && (!ownerEmail || ownerEmail.length > 320))
    throw new Error("OWNER_EMAIL is invalid.");
  const maxPlayers = accountSchema ? positiveEnvInt("MAX_PLAYERS", 10) : undefined;
  const sizeLimitGb = accountSchema ? positiveEnvInt("INVITE_DB_SIZE_LIMIT_GB", 24) : undefined;
  if (!values.apply) {
    console.log(JSON.stringify({
      dryRun: true, clientId, name, database: process.env.SQL_DATABASE,
      schemas: values.registered ? "Resolved from the account registry during apply; SQL was not opened." : ["dbo"],
      accountSchema,
      grants: runtimeGrants(name, values.registered ? [] : ["dbo"], accountSchema),
      procedures: accountSchema ? [
        "invite_capacity", "create_invite", "decide_invite", "purge_expired_invites",
        "claim_invited_account", "rebind_account",
      ] : undefined,
      inviteCapacity: accountSchema ? { maxPlayers, sizeLimitGb } : undefined,
      registeredWorldGrantExample: values.registered ? runtimeGrants(name, ["touchline_user_registered"]) : undefined,
      identityReseeding: "Fixed-schema, table-allowlisted stored procedure; no broad roles.",
    }, null, 2));
    return;
  }
  if (!process.env.SQL_SERVER?.endsWith(".database.windows.net") || !process.env.SQL_DATABASE ||
      (process.env.AZURE_SQL_SERVER && process.env.SQL_SERVER !== `${process.env.AZURE_SQL_SERVER}.database.windows.net`) ||
      (process.env.AZURE_SQL_DATABASE && process.env.SQL_DATABASE !== process.env.AZURE_SQL_DATABASE))
    throw new Error("Use the SQL wrapper with the explicitly selected Azure SQL server and database.");
  if (process.env.SQL_USER || process.env.SQL_PASSWORD || process.env.AZURE_CLIENT_ID)
    throw new Error("Authorization requires the operator Azure identity, not SQL passwords or a runtime client ID.");
  const { Store } = await import("../server/db.ts");
  const store = await Store.open();
  try {
    const schemas = values.registered
      ? await registeredAccountSchemas(store, accountSchema, { allowLegacyRegistry: false })
      : ["dbo"];
    const grants = runtimeGrants(name, schemas, accountSchema);
    await store.transaction(async () => {
      await store.exec(`DECLARE @name sysname = ?, @guid uniqueidentifier = CONVERT(uniqueidentifier, ?);
        DECLARE @sid binary(16) = CONVERT(binary(16), @guid);
        IF EXISTS (SELECT 1 FROM sys.database_principals
          WHERE ([name] = @name AND ([sid] <> @sid OR [type] <> 'E'))
             OR ([sid] = @sid AND [name] <> @name))
          THROW 51000, 'Principal name or SID collision; no permissions changed.', 1;
        IF EXISTS (SELECT 1 FROM sys.database_role_members AS membership
          INNER JOIN sys.database_principals AS principal ON principal.principal_id = membership.member_principal_id
          WHERE principal.[name] = @name)
          THROW 51000, 'Existing role membership requires an operator review.', 1;
        IF EXISTS (SELECT 1 FROM sys.schemas WHERE [principal_id] = USER_ID(@name))
          THROW 51000, 'Runtime schema ownership requires an operator review.', 1;
        IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE [name] = @name)
        BEGIN
          DECLARE @statement nvarchar(max) = N'CREATE USER ' + QUOTENAME(@name)
            + N' WITH SID = ' + CONVERT(varchar(34), @sid, 1) + N', TYPE = E;';
          EXEC sys.sp_executesql @statement;
        END;`, name, clientId);
      if (accountSchema && ownerObjectId && ownerEmail && maxPlayers && sizeLimitGb)
        await store.exec(accountProceduresSql(accountSchema, name, ownerObjectId, ownerEmail, maxPlayers, sizeLimitGb));
      for (const grant of grants) await store.exec(grant);
      for (const schema of schemas) await store.exec(`EXECUTE AS USER = ${sqlLiteral(name)};
        DECLARE @allowed int = HAS_PERMS_BY_NAME(${sqlLiteral(`${schema}.reseed_world_identity`)}, N'OBJECT', N'EXECUTE');
        DECLARE @createSchema int = HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'CREATE SCHEMA');
        REVERT;
        IF COALESCE(@allowed, 0) <> 1 THROW 51000, 'Runtime identity helper permission is missing.', 1;
        IF COALESCE(@createSchema, 0) <> 0 THROW 51000, 'Runtime CREATE SCHEMA permission requires an operator review.', 1;`);
      if (accountSchema) await store.exec(`EXECUTE AS USER = ${sqlLiteral(name)};
        DECLARE @registry nvarchar(260) = ${sqlLiteral(`${accountSchema}.users`)};
        DECLARE @canRead int = HAS_PERMS_BY_NAME(@registry, N'OBJECT', N'SELECT');
        DECLARE @canRefresh int = HAS_PERMS_BY_NAME(@registry, N'OBJECT', N'UPDATE', N'display_name', N'COLUMN');
        DECLARE @canInsert int = HAS_PERMS_BY_NAME(@registry, N'OBJECT', N'INSERT');
        DECLARE @canDelete int = HAS_PERMS_BY_NAME(@registry, N'OBJECT', N'DELETE');
        DECLARE @canAlter int = HAS_PERMS_BY_NAME(@registry, N'OBJECT', N'ALTER');
        DECLARE @canReassign int = HAS_PERMS_BY_NAME(@registry, N'OBJECT', N'UPDATE', N'game_schema', N'COLUMN');
        DECLARE @canChangeIdentity int = HAS_PERMS_BY_NAME(@registry, N'OBJECT', N'UPDATE', N'object_id', N'COLUMN');
        DECLARE @canChangeTenant int = HAS_PERMS_BY_NAME(@registry, N'OBJECT', N'UPDATE', N'tenant_id', N'COLUMN');
        DECLARE @canChangeId int = HAS_PERMS_BY_NAME(@registry, N'OBJECT', N'UPDATE', N'id', N'COLUMN');
        REVERT;
        IF COALESCE(@canRead, 0) <> 1 OR COALESCE(@canRefresh, 0) <> 1
          THROW 51000, 'Runtime registry profile access is missing.', 1;
        IF COALESCE(@canInsert, 0) <> 0 OR COALESCE(@canDelete, 0) <> 0 OR COALESCE(@canAlter, 0) <> 0
          OR COALESCE(@canReassign, 0) <> 0 OR COALESCE(@canChangeIdentity, 0) <> 0
          OR COALESCE(@canChangeTenant, 0) <> 0 OR COALESCE(@canChangeId, 0) <> 0
          THROW 51000, 'Runtime registry mutation permissions are too broad; operator review required.', 1;`);
      if (accountSchema) await store.exec(`EXECUTE AS USER = ${sqlLiteral(name)};
        DECLARE @invite nvarchar(260) = ${sqlLiteral(`${accountSchema}.invite_requests`)};
        DECLARE @attempts nvarchar(260) = ${sqlLiteral(`${accountSchema}.invite_attempts`)};
        DECLARE @create nvarchar(260) = ${sqlLiteral(`${accountSchema}.create_invite`)};
        DECLARE @decide nvarchar(260) = ${sqlLiteral(`${accountSchema}.decide_invite`)};
        DECLARE @purge nvarchar(260) = ${sqlLiteral(`${accountSchema}.purge_expired_invites`)};
        DECLARE @capacity nvarchar(260) = ${sqlLiteral(`${accountSchema}.invite_capacity`)};
        DECLARE @claim nvarchar(260) = ${sqlLiteral(`${accountSchema}.claim_invited_account`)};
        DECLARE @rebind nvarchar(260) = ${sqlLiteral(`${accountSchema}.rebind_account`)};
        DECLARE @inviteRead int = HAS_PERMS_BY_NAME(@invite, N'OBJECT', N'SELECT');
        DECLARE @inviteInsert int = HAS_PERMS_BY_NAME(@invite, N'OBJECT', N'INSERT');
        DECLARE @inviteUpdate int = HAS_PERMS_BY_NAME(@invite, N'OBJECT', N'UPDATE');
        DECLARE @inviteDelete int = HAS_PERMS_BY_NAME(@invite, N'OBJECT', N'DELETE');
        DECLARE @inviteAlter int = HAS_PERMS_BY_NAME(@invite, N'OBJECT', N'ALTER');
        DECLARE @inviteUpdateApproval int = HAS_PERMS_BY_NAME(@invite, N'OBJECT', N'UPDATE', N'approval_email_sent', N'COLUMN');
        DECLARE @inviteUpdateAccepted int = HAS_PERMS_BY_NAME(@invite, N'OBJECT', N'UPDATE', N'accepted_email_sent', N'COLUMN');
        DECLARE @inviteUpdateTimestamp int = HAS_PERMS_BY_NAME(@invite, N'OBJECT', N'UPDATE', N'updated_at', N'COLUMN');
        DECLARE @inviteUpdateStatus int = HAS_PERMS_BY_NAME(@invite, N'OBJECT', N'UPDATE', N'status', N'COLUMN');
        DECLARE @inviteUpdateAccount int = HAS_PERMS_BY_NAME(@invite, N'OBJECT', N'UPDATE', N'account_id', N'COLUMN');
        DECLARE @attemptsRead int = HAS_PERMS_BY_NAME(@attempts, N'OBJECT', N'SELECT');
        DECLARE @attemptsInsert int = HAS_PERMS_BY_NAME(@attempts, N'OBJECT', N'INSERT');
        DECLARE @attemptsDelete int = HAS_PERMS_BY_NAME(@attempts, N'OBJECT', N'DELETE');
        DECLARE @createExec int = HAS_PERMS_BY_NAME(@create, N'OBJECT', N'EXECUTE');
        DECLARE @decideExec int = HAS_PERMS_BY_NAME(@decide, N'OBJECT', N'EXECUTE');
        DECLARE @purgeExec int = HAS_PERMS_BY_NAME(@purge, N'OBJECT', N'EXECUTE');
        DECLARE @capacityExec int = HAS_PERMS_BY_NAME(@capacity, N'OBJECT', N'EXECUTE');
        DECLARE @claimExec int = HAS_PERMS_BY_NAME(@claim, N'OBJECT', N'EXECUTE');
        DECLARE @rebindExec int = HAS_PERMS_BY_NAME(@rebind, N'OBJECT', N'EXECUTE');
        REVERT;
        IF COALESCE(@inviteRead, 0) <> 1
          OR COALESCE(@inviteUpdateApproval, 0) <> 1 OR COALESCE(@inviteUpdateAccepted, 0) <> 1
          OR COALESCE(@inviteUpdateTimestamp, 0) <> 1
          OR COALESCE(@attemptsRead, 0) <> 1 OR COALESCE(@attemptsInsert, 0) <> 1 OR COALESCE(@attemptsDelete, 0) <> 1
          OR COALESCE(@createExec, 0) <> 1 OR COALESCE(@decideExec, 0) <> 1 OR COALESCE(@purgeExec, 0) <> 1
          OR COALESCE(@capacityExec, 0) <> 1 OR COALESCE(@claimExec, 0) <> 1 OR COALESCE(@rebindExec, 0) <> 1
          THROW 51000, 'Runtime invite permissions are missing.', 1;
        IF COALESCE(@inviteInsert, 0) <> 0 OR COALESCE(@inviteDelete, 0) <> 0 OR COALESCE(@inviteAlter, 0) <> 0
          OR COALESCE(@inviteUpdateStatus, 0) <> 0 OR COALESCE(@inviteUpdateAccount, 0) <> 0
          THROW 51000, 'Runtime invite permissions are too broad; operator review required.', 1;`);
    });
    console.log(JSON.stringify({ authorized: true, clientId, name, database: store.database, schemas, accountSchema }));
  } finally {
    await store.close();
  }
}

if (isMain(import.meta.url))
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Runtime authorization failed.");
    process.exitCode = 1;
  });