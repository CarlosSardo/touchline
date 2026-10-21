import { parseArgs } from "node:util";
import { assertAccountRegistry, validateAccountSchema, validateAccountWorldSchema } from "../server/accounts.ts";
import { Store } from "../server/db.ts";
import { isLocalSqlHost } from "../server/sql-config.ts";
import { STORE_TABLES, sqlLiteral, tableName } from "../server/sql-schema.ts";
import { maskSchema } from "./career-delete.ts";
import { isMain } from "./data-export.ts";

export interface WorldResetOptions {
  schemas: string[];
  all: boolean;
  accountSchema: string;
  apply: boolean;
  allowSessions: boolean;
}

/** The world schema Touchline uses when SQL_SCHEMA is not set. */
export const DEFAULT_WORLD_SCHEMA = "public";
/** Everything a world schema stores except its migration history; functions, triggers, tables and grants stay. */
export const RESET_TABLES: readonly string[] = [...STORE_TABLES].filter((table) => table !== "schema_migrations");
/** The migration marker a freshly provisioned world schema carries. */
export const KEPT_META_KEYS = ["appearanceIndexVersion"] as const;
const RESET_LOCK_TIMEOUT = "30s";

const USAGE = `Usage: tsx scripts/world-reset.ts (--schema NAME [--schema NAME ...] | --all) [--account-schema accounts] [--apply --yes]
Empties Touchline worlds fast: per schema, one TRUNCATE ... RESTART IDENTITY over every world, snapshot and chunk table
(foreign keys between them stay in place; identities restart at 1), in one transaction under the world writer lock.
Tables, schema_migrations, triggers, functions and every grant stay, so the runtime role keeps working and signed-in
accounts simply start a new career. The account registry (accounts.users) is never modified.
--all resets the default ${DEFAULT_WORLD_SCHEMA} world, every world registered in the account registry and every other
Touchline world (schema with schema_migrations) whose name is a valid world schema; the dry run marks those "registered": false.
Dry-run is the default and prints what would be emptied; --apply --yes performs it. Back up first:
  npm run data:export -- --everything --out-dir <dir>
Stop the app first: --apply refuses while other client sessions use the database (listed in the dry run; --allow-sessions
overrides after you have checked none is a Touchline server). Sessions of other roles are only visible to superusers and
members of pg_read_all_stats; without that, --apply refuses unless --allow-sessions is given.`;

function isLocalServer(environment: NodeJS.ProcessEnv = process.env) {
  return isLocalSqlHost(environment.SQL_HOST ?? "127.0.0.1");
}

/** The default world, a registered account world, or (on a local server only) a leftover test/e2e schema. */
export function resetSchemaName(schema: string, accountSchema: string, local = isLocalServer()): string {
  if (schema.toLowerCase() === DEFAULT_WORLD_SCHEMA) return DEFAULT_WORLD_SCHEMA;
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
  definition: string;
  validated: boolean;
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

/** One TRUNCATE over all the tables: PostgreSQL then accepts the foreign keys among them without dropping any. */
export function truncateSql(schema: string, tables: readonly string[]): string {
  if (!tables.length) throw new Error("Nothing to truncate.");
  for (const table of tables)
    if (!RESET_TABLES.includes(table) || table === "meta") throw new Error(`${table} is not a resettable world table.`);
  return `TRUNCATE TABLE ${tables.map((table) => tableName(schema, table)).join(", ")} RESTART IDENTITY;`;
}

/** Foreign keys from or to the world's schema, as pg_constraint describes them. */
export async function foreignKeys(world: Store): Promise<ForeignKeyRow[]> {
  return world.all<ForeignKeyRow>(
    `SELECT constraint_row.conname AS name, parent_namespace.nspname AS parent_schema, parent.relname AS parent_table,
      referenced_namespace.nspname AS referenced_schema, referenced.relname AS referenced_table,
      pg_get_constraintdef(constraint_row.oid) AS definition, constraint_row.convalidated AS validated
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_class AS parent ON parent.oid = constraint_row.conrelid
    JOIN pg_catalog.pg_namespace AS parent_namespace ON parent_namespace.oid = parent.relnamespace
    JOIN pg_catalog.pg_class AS referenced ON referenced.oid = constraint_row.confrelid
    JOIN pg_catalog.pg_namespace AS referenced_namespace ON referenced_namespace.oid = referenced.relnamespace
    WHERE constraint_row.contype = 'f' AND (parent_namespace.nspname = ? OR referenced_namespace.nspname = ?)
    ORDER BY parent_namespace.nspname, parent.relname, constraint_row.conname`,
    world.schemaName,
    world.schemaName,
  );
}

/** Exact row counts of the given tables in one round trip. */
async function tableRows(world: Store, tables: readonly string[]): Promise<Map<string, number>> {
  if (!tables.length) return new Map();
  const rows = await world.all<{ name: string; total: number }>(
    tables.map((table) => `SELECT ${sqlLiteral(table)} AS name, count(*) AS total FROM ${tableName(world.schemaName, table)}`)
      .join(" UNION ALL "),
  );
  return new Map(rows.map((row) => [row.name, Number(row.total)]));
}

export async function planSchemaReset(world: Store): Promise<SchemaResetPlan> {
  const schema = world.schemaName;
  const names = (await world.all<{ name: string }>(
    "SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = ? ORDER BY tablename",
    schema,
  )).map((row) => row.name);
  const present = new Set(names);
  const resettable = names.filter((name) => RESET_TABLES.includes(name));
  const plan: SchemaResetPlan = {
    schema,
    touchline: present.has("schema_migrations") && present.has("meta"),
    tables: [],
    kept: names.filter((name) => !RESET_TABLES.includes(name)),
    foreignKeys: [],
    snapshots: 0,
    career: null,
  };
  if (!names.length) return { ...plan, refused: "Schema is missing or has no tables; nothing is created or touched." };
  if (!plan.touchline) return { ...plan, refused: "Not a Touchline world (no schema_migrations/meta); nothing is touched." };
  const counts = await tableRows(world, resettable);
  plan.tables = resettable.map((name) => ({ name, rows: counts.get(name) ?? 0 }));
  plan.foreignKeys = await foreignKeys(world);
  const foreign = plan.foreignKeys.find((key) =>
    key.parent_schema !== schema || key.referenced_schema !== schema ||
    !RESET_TABLES.includes(key.parent_table) || !RESET_TABLES.includes(key.referenced_table));
  if (foreign)
    plan.refused = `Foreign key ${foreign.name} links a table outside this schema's world tables; refusing to reset it.`;
  plan.snapshots = counts.get("save_slots") ?? 0;
  const state = await world.get<{ value: string }>(`SELECT value FROM ${tableName(schema, "meta")} WHERE key = 'state'`);
  if (state) {
    const parsed = JSON.parse(state.value) as { season?: number; date?: string; started?: boolean };
    plan.career = { season: Number(parsed.season), date: String(parsed.date), started: parsed.started !== false };
  }
  return plan;
}

const signature = (keys: ForeignKeyRow[]) =>
  keys.map((key) => [key.name, key.parent_table, key.referenced_table, key.definition, key.validated].join("|")).sort().join("\n");

/** One transaction under the world writer lock: TRUNCATE every world table at once, keep the meta marker, verify. */
export async function resetSchema(world: Store) {
  const schema = world.schemaName;
  const started = performance.now();
  return world.transaction(async () => {
    const plan = await planSchemaReset(world);
    if (plan.refused) throw new Error(`${maskSchema(schema)}: ${plan.refused}`);
    const truncated = plan.tables.map((table) => table.name).filter((name) => name !== "meta");
    // TRUNCATE waits for ACCESS EXCLUSIVE locks; a stray reader must fail the reset, not hang it.
    await world.exec(`SET LOCAL lock_timeout = '${RESET_LOCK_TIMEOUT}';`);
    if (truncated.length) await world.exec(truncateSql(schema, truncated));
    await world.run(`DELETE FROM ${tableName(schema, "meta")} WHERE key <> ALL(?::text[])`, KEPT_META_KEYS);
    const counts = await tableRows(world, plan.tables.map((table) => table.name));
    for (const table of plan.tables)
      if ((counts.get(table.name) ?? 0) > (table.name === "meta" ? KEPT_META_KEYS.length : 0))
        throw new Error(`${maskSchema(schema)}.${table.name} still has rows; the reset was rolled back.`);
    const keys = await foreignKeys(world);
    if (signature(keys) !== signature(plan.foreignKeys))
      throw new Error(`${maskSchema(schema)}: foreign keys differ after the reset; it was rolled back.`);
    return {
      schema: maskSchema(schema),
      truncated: truncated.length,
      rowsRemoved: plan.tables.reduce((total, table) => total + table.rows, 0),
      snapshotsRemoved: plan.snapshots,
      foreignKeys: keys.length,
      seconds: Math.round((performance.now() - started) / 100) / 10,
    };
  });
}

/** Superusers and pg_read_all_stats members see every session's details; others only their own role's. */
export async function sessionsVisible(root: Store) {
  const row = await root.get<{ visible: boolean }>(
    "SELECT pg_has_role(current_user, 'pg_read_all_stats', 'USAGE') AS visible",
  );
  return row?.visible === true;
}

/** Client sessions on this database other than this connection (the CLI uses its pool one statement at a time). */
export async function otherSessions(root: Store) {
  if (!(await sessionsVisible(root))) return { visible: false, sessions: [] };
  const sessions = await root.all<{ program: string; sessions: number }>(
    `SELECT COALESCE(application_name, '') AS program, count(*) AS sessions
    FROM pg_catalog.pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'
    GROUP BY COALESCE(application_name, '')
    ORDER BY program`,
  );
  return { visible: true, sessions };
}

/** --all: the default world, registered worlds, then every other world schema that passes the same name checks as --schema. */
export function allResetSchemas(registered: string[], worlds: string[], accountSchema: string, local = isLocalServer()) {
  const chosen = new Map([DEFAULT_WORLD_SCHEMA, ...registered].map((schema) => [schema.toLowerCase(), schema]));
  const skipped: { schema: string; reason: string }[] = [];
  for (const world of worlds) {
    if (chosen.has(world.toLowerCase())) continue;
    try {
      chosen.set(world.toLowerCase(), resetSchemaName(world, accountSchema, local));
    } catch {
      skipped.push({ schema: maskSchema(world), reason: "Not a resettable world schema name here; left untouched." });
    }
  }
  return { schemas: [...chosen.values()], skipped };
}

async function accountRegistry(root: Store, accountSchema: string) {
  const users = tableName(accountSchema, "users");
  const exists = await root.get<{ present: boolean }>("SELECT to_regclass(?) IS NOT NULL AS present", users);
  if (!exists?.present) return { present: false, accounts: 0, schemas: [] as string[] };
  const registry = root.forSchema(accountSchema);
  await assertAccountRegistry(registry);
  const rows = await registry.all<{ game_schema: string }>(`SELECT game_schema FROM ${users} ORDER BY game_schema`);
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
    foreignKeys: plan.foreignKeys.length,
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
    const worlds = (await root.all<{ name: string }>(
      "SELECT schemaname AS name FROM pg_catalog.pg_tables WHERE tablename = 'schema_migrations' ORDER BY schemaname",
    )).map((world) => world.name);
    const all = options.all ? allResetSchemas(registry.schemas, worlds, options.accountSchema) : undefined;
    const schemas = all?.schemas ?? options.schemas;
    const chosen = new Set(schemas.map((schema) => schema.toLowerCase()));
    const plans: SchemaResetPlan[] = [];
    for (const schema of schemas) plans.push(await planSchemaReset(root.forSchema(schema)));
    const sessions = await otherSessions(root);
    const summary = {
      database: root.database,
      accountRegistry: { schema: options.accountSchema, present: registry.present, accounts: registry.accounts, modified: false },
      otherSessions: sessions.visible ? sessions.sessions : "not visible: this role is neither a superuser nor a member of pg_read_all_stats",
      schemas: plans.map((plan) => describePlan(plan, plan.schema === DEFAULT_WORLD_SCHEMA || registered.has(plan.schema.toLowerCase()))),
      untouchedWorlds: all?.skipped ?? worlds.filter((name) => !chosen.has(name.toLowerCase())).map(maskSchema),
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
    if (!sessions.visible && !options.allowSessions)
      throw new Error("Refusing to reset: this role cannot see other roles' sessions (needs superuser or pg_read_all_stats). Stop the app, then pass --allow-sessions once you have checked.");
    if (sessions.sessions.length && !options.allowSessions)
      throw new Error(`Refusing to reset while ${sessions.sessions.reduce((total, row) => total + row.sessions, 0)} other session(s) use the database (${sessions.sessions.map((row) => row.program || "unnamed").join(", ")}). Stop the app, or pass --allow-sessions once you have checked them.`);
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
    // Refusals print their message; unexpected failures (TypeError, DatabaseError, ...) keep their stack.
    console.error(error instanceof Error ? (error.constructor === Error ? error.message : error.stack ?? error.message) : "World reset failed.");
    process.exitCode = 1;
  });
