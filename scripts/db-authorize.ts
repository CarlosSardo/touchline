import { parseArgs } from "node:util";
import { isMain } from "./data-export.ts";
import { registeredAccountSchemas, validateAccountSchema, validateAccountWorldSchema } from "../server/accounts.ts";
import { WORLD_TABLES, quoteIdentifier, sqlLiteral, tableName } from "../server/sql-schema.ts";

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
  );
  return grants;
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
  if (!values.apply) {
    console.log(JSON.stringify({
      dryRun: true, clientId, name, database: process.env.SQL_DATABASE,
      schemas: values.registered ? "Resolved from the account registry during apply; SQL was not opened." : ["dbo"],
      accountSchema,
      grants: runtimeGrants(name, values.registered ? [] : ["dbo"], accountSchema),
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
    const schemas = values.registered ? await registeredAccountSchemas(store, accountSchema) : ["dbo"];
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