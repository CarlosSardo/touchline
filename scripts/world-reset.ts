import { parseArgs } from "node:util";
import { assertAccountRegistry, validateAccountSchema, validateAccountWorldSchema } from "../server/accounts.ts";
import { Store } from "../server/db.ts";
import { STORE_TABLES, quoteIdentifier, sqlLiteral, tableName } from "../server/sql-schema.ts";
import { maskSchema } from "./career-delete.ts";
import { isMain } from "./data-export.ts";

export interface WorldResetOptions {
  schemas: string[];
  all: boolean;
  accountSchema: string;
  apply: boolean;
  allowSessions: boolean;
}

/** Everything a world schema stores except its migration history; grants, procedures and tables stay. */
export const RESET_TABLES: readonly string[] = [...STORE_TABLES].filter((table) => table !== "schema_migrations");
/** The migration marker a freshly provisioned world schema carries. */
export const KEPT_META_KEYS = ["appearanceIndexVersion"] as const;
const LOCAL_SERVERS = ["localhost", "127.0.0.1", "::1", "sql"];
const REFERENTIAL_ACTIONS = new Set(["NO_ACTION", "CASCADE", "SET_NULL", "SET_DEFAULT"]);

const USAGE = `Usage: tsx scripts/world-reset.ts (--schema NAME [--schema NAME ...] | --all) [--account-schema accounts] [--apply --yes]
Empties Touchline worlds fast: per schema it drops the foreign keys, TRUNCATEs every world, snapshot and chunk table
(minimal logging, identities restart at 1), then re-adds the same foreign keys WITH CHECK, all in one transaction under
the world writer lock. Tables, schema_migrations, the reseed procedure and every grant stay, so the runtime identity keeps
working and signed-in accounts simply start a new career. The account registry (accounts.users) is never modified.
--all resets the legacy dbo world plus every world registered in the account registry.
Dry-run is the default and prints what would be emptied; --apply --yes performs it. Back up first:
  npm run data:export -- --everything --out-dir <dir>
Stop or scale the app to zero before applying: --apply refuses while other user sessions use the database (listed in the
dry run; --allow-sessions overrides after you have checked none is a Touchline replica). Run it through scripts/azure-sql.sh for Azure.`;

function isLocalServer(environment: NodeJS.ProcessEnv = process.env) {
  return LOCAL_SERVERS.includes(environment.SQL_SERVER ?? "127.0.0.1");
}

/** dbo, a registered account world, or (on a local server only) a leftover test/e2e schema. */
export function resetSchemaName(schema: string, accountSchema: string, local = isLocalServer()): string {
  if (schema.toLowerCase() === "dbo") return "dbo";
  const disposable = local && /^touchline_(?:test|e2e)_/i.test(schema);
  return validateAccountWorldSchema(schema, accountSchema, disposable);
}

export function worldResetOptions(args: string[], local = isLocalServer()): WorldResetOptions | undefined {
  const { values } = parseArgs({
    args,
    options: {
      help: { type: "boolean" },
      schema: { type: "string", multiple: true },
      all: { type: "boolean" },
      "account-schema": { type: "string" },
      "dry-run": { type: "boolean" },
      apply: { type: "boolean" },
      yes: { type: "boolean" },
      "allow-sessions": { type: "boolean" },
    },
  });
  if (values.help) return undefined;
  const accountSchema = validateAccountSchema(values["account-schema"] ?? "accounts");
  const requested = values.schema ?? [];
  if (Boolean(values.all) === Boolean(requested.length))
    throw new Error("Choose --all or one or more --schema NAME.");
  if (values.apply && !values.yes) throw new Error("Resetting worlds requires --apply --yes.");
  if (values.apply && values["dry-run"]) throw new Error("Choose --apply or --dry-run, not both.");
  const schemas = requested.map((schema) => resetSchemaName(schema.trim(), accountSchema, local));
  if (new Set(schemas.map((schema) => schema.toLowerCase())).size !== schemas.length)
    throw new Error("Each --schema may be named once.");
  return { schemas, all: Boolean(values.all), accountSchema, apply: Boolean(values.apply), allowSessions: Boolean(values["allow-sessions"]) };
}

export interface ForeignKeyRow {
  name: string;
  parent_schema: string;
  parent_table: string;
  referenced_schema: string;
  referenced_table: string;
  columns: string;
  referenced_columns: string;
  on_delete: string;
  on_update: string;
  is_disabled: boolean | number;
}

export interface SchemaResetPlan {
  schema: string;
  touchline: boolean;
  tables: { name: string; rows: number }[];
  kept: string[];
  foreignKeys: ForeignKeyRow[];
  snapshots: number;
  career: { season: number; date: string; started: boolean } | null;
  refused?: string;
}

function referentialAction(value: string) {
  if (!REFERENTIAL_ACTIONS.has(value)) throw new Error(`Unsupported foreign key action ${value}.`);
  return value.replaceAll("_", " ");
}

/** Re-creates a foreign key exactly as sys.foreign_keys described it; column lists arrive QUOTENAME'd. */
export function addForeignKeySql(foreignKey: ForeignKeyRow): string {
  const columns = /^\[[^\]]+\](?:, \[[^\]]+\])*$/;
  if (!columns.test(foreignKey.columns) || !columns.test(foreignKey.referenced_columns))
    throw new Error(`Unexpected column list for foreign key ${foreignKey.name}.`);
  return `ALTER TABLE ${tableName(foreignKey.parent_schema, foreignKey.parent_table)} WITH CHECK ADD CONSTRAINT ${quoteIdentifier(foreignKey.name)}
    FOREIGN KEY (${foreignKey.columns}) REFERENCES ${tableName(foreignKey.referenced_schema, foreignKey.referenced_table)} (${foreignKey.referenced_columns})
    ON DELETE ${referentialAction(foreignKey.on_delete)} ON UPDATE ${referentialAction(foreignKey.on_update)};`;
}

export async function foreignKeys(world: Store): Promise<ForeignKeyRow[]> {
  return world.all<ForeignKeyRow>(
    `SELECT foreign_key.[name], parent_schema.[name] AS [parent_schema], parent_table.[name] AS [parent_table],
      referenced_schema.[name] AS [referenced_schema], referenced_table.[name] AS [referenced_table],
      STRING_AGG(CONVERT(nvarchar(max), QUOTENAME(parent_column.[name])), N', ')
        WITHIN GROUP (ORDER BY foreign_key_column.[constraint_column_id]) AS [columns],
      STRING_AGG(CONVERT(nvarchar(max), QUOTENAME(referenced_column.[name])), N', ')
        WITHIN GROUP (ORDER BY foreign_key_column.[constraint_column_id]) AS [referenced_columns],
      foreign_key.[delete_referential_action_desc] AS [on_delete], foreign_key.[update_referential_action_desc] AS [on_update],
      foreign_key.[is_disabled]
    FROM sys.foreign_keys AS foreign_key
    INNER JOIN sys.tables AS parent_table ON parent_table.[object_id] = foreign_key.[parent_object_id]
    INNER JOIN sys.schemas AS parent_schema ON parent_schema.[schema_id] = parent_table.[schema_id]
    INNER JOIN sys.tables AS referenced_table ON referenced_table.[object_id] = foreign_key.[referenced_object_id]
    INNER JOIN sys.schemas AS referenced_schema ON referenced_schema.[schema_id] = referenced_table.[schema_id]
    INNER JOIN sys.foreign_key_columns AS foreign_key_column ON foreign_key_column.[constraint_object_id] = foreign_key.[object_id]
    INNER JOIN sys.columns AS parent_column ON parent_column.[object_id] = foreign_key_column.[parent_object_id]
      AND parent_column.[column_id] = foreign_key_column.[parent_column_id]
    INNER JOIN sys.columns AS referenced_column ON referenced_column.[object_id] = foreign_key_column.[referenced_object_id]
      AND referenced_column.[column_id] = foreign_key_column.[referenced_column_id]
    WHERE parent_table.[schema_id] = SCHEMA_ID(?) OR referenced_table.[schema_id] = SCHEMA_ID(?)
    GROUP BY foreign_key.[object_id], foreign_key.[name], parent_schema.[name], parent_table.[name], referenced_schema.[name],
      referenced_table.[name], foreign_key.[delete_referential_action_desc], foreign_key.[update_referential_action_desc],
      foreign_key.[is_disabled]
    ORDER BY foreign_key.[name]`,
    world.schemaName,
    world.schemaName,
  );
}

export async function planSchemaReset(world: Store): Promise<SchemaResetPlan> {
  const schema = world.schemaName;
  const rows = await world.all<{ name: string; rows: number | string }>(
    `SELECT table_row.[name], COALESCE(SUM(partition_row.[rows]), 0) AS [rows]
    FROM sys.tables AS table_row
    LEFT JOIN sys.partitions AS partition_row ON partition_row.[object_id] = table_row.[object_id]
      AND partition_row.[index_id] IN (0, 1)
    WHERE table_row.[schema_id] = SCHEMA_ID(?) GROUP BY table_row.[name] ORDER BY table_row.[name]`,
    schema,
  );
  const names = new Set(rows.map((row) => row.name));
  const plan: SchemaResetPlan = {
    schema,
    touchline: names.has("schema_migrations") && names.has("meta"),
    tables: rows.filter((row) => RESET_TABLES.includes(row.name)).map((row) => ({ name: row.name, rows: Number(row.rows) })),
    kept: rows.map((row) => row.name).filter((name) => !RESET_TABLES.includes(name)),
    foreignKeys: [],
    snapshots: 0,
    career: null,
  };
  if (!rows.length) return { ...plan, refused: "Schema is missing or has no tables; nothing is created or touched." };
  if (!plan.touchline) return { ...plan, refused: "Not a Touchline world (no schema_migrations/meta); nothing is touched." };
  plan.foreignKeys = await foreignKeys(world);
  const same = (name: string) => name.toLowerCase() === schema.toLowerCase();
  const foreign = plan.foreignKeys.find((key) =>
    !same(key.parent_schema) || !same(key.referenced_schema) ||
    !RESET_TABLES.includes(key.parent_table) || !RESET_TABLES.includes(key.referenced_table));
  if (foreign)
    plan.refused = `Foreign key ${foreign.name} links a table outside this schema's world tables; refusing to reset it.`;
  if (names.has("save_slots"))
    plan.snapshots = Number((await world.get<{ total: number | string }>(
      `SELECT COUNT_BIG(*) AS [total] FROM ${tableName(schema, "save_slots")}`,
    ))?.total ?? 0);
  const state = await world.get<{ value: string }>(
    `SELECT [value] FROM ${tableName(schema, "meta")} WHERE [key] = N'state'`,
  );
  if (state) {
    const parsed = JSON.parse(state.value) as { season?: number; date?: string; started?: boolean };
    plan.career = { season: Number(parsed.season), date: String(parsed.date), started: parsed.started !== false };
  }
  return plan;
}

const signature = (keys: ForeignKeyRow[]) =>
  keys.map((key) => [key.name, key.parent_table, key.columns, key.referenced_table, key.referenced_columns,
    key.on_delete, key.on_update, Boolean(key.is_disabled)].join("|")).sort().join("\n");

/** One transaction under the world writer lock: drop keys, TRUNCATE, re-add identical trusted keys, verify. */
export async function resetSchema(world: Store) {
  const schema = world.schemaName;
  const started = performance.now();
  return world.transaction(async () => {
    const plan = await planSchemaReset(world);
    if (plan.refused) throw new Error(`${maskSchema(schema)}: ${plan.refused}`);
    for (const key of plan.foreignKeys)
      await world.exec(`ALTER TABLE ${tableName(key.parent_schema, key.parent_table)} DROP CONSTRAINT ${quoteIdentifier(key.name)};`);
    const truncated: string[] = [];
    for (const table of plan.tables) {
      if (table.name === "meta") continue;
      await world.exec(`TRUNCATE TABLE ${tableName(schema, table.name)};`);
      truncated.push(table.name);
    }
    await world.exec(
      `DELETE FROM ${tableName(schema, "meta")} WHERE [key] NOT IN (${KEPT_META_KEYS.map(sqlLiteral).join(", ")});`,
    );
    for (const key of plan.foreignKeys) {
      await world.exec(addForeignKeySql(key));
      if (key.is_disabled)
        await world.exec(`ALTER TABLE ${tableName(key.parent_schema, key.parent_table)} NOCHECK CONSTRAINT ${quoteIdentifier(key.name)};`);
    }
    for (const table of plan.tables) {
      const total = Number((await world.get<{ total: number | string }>(
        `SELECT COUNT_BIG(*) AS [total] FROM ${tableName(schema, table.name)}`,
      ))?.total ?? 0);
      if (total > (table.name === "meta" ? KEPT_META_KEYS.length : 0))
        throw new Error(`${maskSchema(schema)}.${table.name} still has rows; the reset was rolled back.`);
    }
    const restored = await foreignKeys(world);
    const untrusted = await world.all<{ name: string }>(
      "SELECT [name] FROM sys.foreign_keys WHERE [schema_id] = SCHEMA_ID(?) AND [is_disabled] = 0 AND [is_not_trusted] = 1",
      schema,
    );
    if (signature(restored) !== signature(plan.foreignKeys) || untrusted.length)
      throw new Error(`${maskSchema(schema)}: foreign keys differ after the reset; it was rolled back.`);
    return {
      schema: maskSchema(schema),
      truncated: truncated.length,
      rowsRemoved: plan.tables.reduce((total, table) => total + table.rows, 0),
      snapshotsRemoved: plan.snapshots,
      foreignKeys: restored.length,
      seconds: Math.round((performance.now() - started) / 100) / 10,
    };
  });
}

/** User sessions on this database other than this process's pool (visible with VIEW DATABASE STATE). */
export async function otherSessions(root: Store) {
  return root.all<{ program: string; sessions: number }>(
    `SELECT ISNULL(other.[program_name], N'') AS [program], COUNT(*) AS [sessions]
    FROM sys.dm_exec_sessions AS other
    CROSS JOIN (SELECT [host_name], [host_process_id] FROM sys.dm_exec_sessions WHERE [session_id] = @@SPID) AS mine
    WHERE other.[is_user_process] = 1 AND other.[session_id] <> @@SPID AND other.[database_id] = DB_ID()
      AND NOT (ISNULL(other.[host_name], N'') = ISNULL(mine.[host_name], N'')
        AND ISNULL(other.[host_process_id], -1) = ISNULL(mine.[host_process_id], -1))
    GROUP BY ISNULL(other.[program_name], N'')`,
  );
}

async function accountRegistry(root: Store, accountSchema: string) {
  const users = tableName(accountSchema, "users");
  const exists = await root.get<{ id: number | null }>("SELECT OBJECT_ID(?, N'U') AS [id]", users);
  if (!exists?.id) return { present: false, accounts: 0, schemas: [] as string[] };
  const registry = root.forSchema(accountSchema);
  await assertAccountRegistry(registry);
  const rows = await registry.all<{ game_schema: string }>(`SELECT [game_schema] FROM ${users} ORDER BY [game_schema]`);
  return {
    present: true,
    accounts: rows.length,
    schemas: rows.map((row) => validateAccountWorldSchema(row.game_schema, accountSchema, root.testMode)),
  };
}

function describePlan(plan: SchemaResetPlan, registered: boolean) {
  return {
    schema: maskSchema(plan.schema),
    registered,
    ...(plan.refused ? { refused: plan.refused } : {}),
    career: plan.career,
    snapshots: plan.snapshots,
    rows: plan.tables.reduce((total, table) => total + table.rows, 0),
    truncate: plan.tables.filter((table) => table.rows > 0 && table.name !== "meta")
      .map((table) => `${table.name}: ${table.rows}`),
    foreignKeysDroppedAndReadded: plan.foreignKeys.length,
    keptTables: plan.kept,
  };
}

export async function main(args = process.argv.slice(2), log = (line: string) => console.log(line)) {
  const options = worldResetOptions(args);
  if (!options) {
    log(USAGE);
    return;
  }
  const root = await Store.open();
  try {
    const registry = await accountRegistry(root, options.accountSchema);
    const registered = new Set(registry.schemas.map((schema) => schema.toLowerCase()));
    const schemas = options.all
      ? [...new Map(["dbo", ...registry.schemas].map((schema) => [schema.toLowerCase(), schema])).values()]
      : options.schemas;
    const worlds = await root.all<{ name: string }>(
      `SELECT schema_row.[name] FROM sys.tables AS table_row
      INNER JOIN sys.schemas AS schema_row ON schema_row.[schema_id] = table_row.[schema_id]
      WHERE table_row.[name] = N'schema_migrations' ORDER BY schema_row.[name]`,
    );
    const chosen = new Set(schemas.map((schema) => schema.toLowerCase()));
    const plans: SchemaResetPlan[] = [];
    for (const schema of schemas) plans.push(await planSchemaReset(root.forSchema(schema)));
    const sessions = await otherSessions(root);
    const summary = {
      database: root.database,
      accountRegistry: { schema: options.accountSchema, present: registry.present, accounts: registry.accounts, modified: false },
      otherSessions: sessions,
      schemas: plans.map((plan) => describePlan(plan, plan.schema.toLowerCase() === "dbo" || registered.has(plan.schema.toLowerCase()))),
      untouchedWorlds: worlds.map((world) => world.name).filter((name) => !chosen.has(name.toLowerCase())).map(maskSchema),
    };
    const blocked = plans.filter((plan) => plan.refused && plan.touchline);
    if (!options.apply) {
      log(JSON.stringify({
        dryRun: true,
        ...summary,
        next: blocked.length
          ? "Some worlds are refused (see refused); --apply would stop before changing anything."
          : "Back up first (npm run data:export -- --everything --out-dir DIR), stop the app, then re-run with --apply --yes. This cannot be undone.",
      }, null, 2));
      return;
    }
    if (blocked.length) throw new Error(`Refusing to reset: ${blocked.map((plan) => `${maskSchema(plan.schema)} (${plan.refused})`).join("; ")}`);
    if (sessions.length && !options.allowSessions)
      throw new Error(`Refusing to reset while ${sessions.reduce((total, row) => total + row.sessions, 0)} other session(s) use the database (${sessions.map((row) => row.program || "unnamed").join(", ")}). Stop the app, or pass --allow-sessions once you have checked them.`);
    log(JSON.stringify({ applying: true, ...summary }, null, 2));
    const results = [];
    for (const plan of plans.filter((candidate) => candidate.touchline)) {
      const result = await resetSchema(root.forSchema(plan.schema));
      log(`Reset ${result.schema}: ${result.rowsRemoved} rows, ${result.snapshotsRemoved} snapshots, ${result.seconds}s.`);
      results.push(result);
    }
    log(JSON.stringify({ applied: true, results, accountRegistry: summary.accountRegistry }, null, 2));
  } finally {
    await root.close();
  }
}

if (isMain(import.meta.url))
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "World reset failed.");
    process.exitCode = 1;
  });
