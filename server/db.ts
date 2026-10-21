import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { readSqlSettings, validateSqlSchema, type SqlSettings } from "./sql-config.ts";
import {
  appearanceBackfill,
  IDENTITY_TABLES,
  migrationTableSql,
  quoteIdentifier,
  schemaMigrations,
  STORE_TABLES,
  tableName,
  WORLD_TABLES,
} from "./sql-schema.ts";

export { WORLD_TABLES } from "./sql-schema.ts";

/** Rows per bulk INSERT ... SELECT FROM unnest(...) statement; bounds memory on a small host. */
const BULK_BATCH_ROWS = 5_000;
const WORLD_LOCK_TIMEOUT = "30s";
const MAINTENANCE_LOCK_TIMEOUT = "120s";
const MAX_PARAMETERS = 65_535;

type SqlScalar = string | number | bigint | boolean | Date | Buffer | null | undefined;
export type SqlParameter = SqlScalar | readonly SqlScalar[];
export interface RunResult {
  changes: number;
  lastInsertRowid: number | null;
}

/** PostgreSQL SQLSTATE of a driver error, if any. */
export function sqlErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

export const isUniqueViolation = (error: unknown) => sqlErrorCode(error) === "23505";
export const isForeignKeyViolation = (error: unknown) => sqlErrorCode(error) === "23503";
export const isLockTimeout = (error: unknown) => sqlErrorCode(error) === "55P03";

/** A stable signed 64-bit advisory lock key for a lock name. */
export function advisoryLockKey(name: string): bigint {
  return createHash("sha256").update(name).digest().readBigInt64BE(0);
}

const WRITING_KEYWORDS = new Set([
  "insert",
  "update",
  "delete",
  "merge",
  "create",
  "alter",
  "drop",
  "truncate",
  "grant",
  "revoke",
  "call",
  "do",
  "copy",
  "set",
  "reset",
  "lock",
  "vacuum",
  "analyze",
  "refresh",
  "reindex",
  "cluster",
  "comment",
  "security",
  "nextval",
  "setval",
]);

interface Token {
  text: string;
  name: string;
  start: number;
  end: number;
  kind: "word" | "identifier" | "literal" | "comment" | "space" | "symbol";
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < source.length) {
    const start = offset;
    const character = source[offset];
    let kind: Token["kind"] = "symbol";
    if (/\s/.test(character)) {
      kind = "space";
      while (offset < source.length && /\s/.test(source[offset])) offset++;
    } else if (source.startsWith("--", offset)) {
      kind = "comment";
      while (offset < source.length && !/[\r\n]/.test(source[offset])) offset++;
    } else if (source.startsWith("/*", offset)) {
      kind = "comment";
      offset += 2;
      let depth = 1;
      while (offset < source.length && depth > 0) {
        if (source.startsWith("/*", offset)) {
          depth++;
          offset += 2;
        } else if (source.startsWith("*/", offset)) {
          depth--;
          offset += 2;
        } else offset++;
      }
      if (depth) throw new Error("Unterminated SQL comment.");
    } else if (character === "'" || character === '"') {
      kind = character === "'" ? "literal" : "identifier";
      // E'...' strings allow backslash escapes; the E is the previous word token.
      const previous = tokens.at(-1);
      const escapes = kind === "literal" && previous?.end === start && /^[eE]$/.test(previous.text);
      offset++;
      let closed = false;
      while (offset < source.length) {
        const current = source[offset++];
        if (escapes && current === "\\") {
          offset++;
          continue;
        }
        if (current !== character) continue;
        if (source[offset] === character) {
          offset++;
          continue;
        }
        closed = true;
        break;
      }
      if (!closed) throw new Error("Unterminated SQL quoted value or identifier.");
    } else if (character === "$" && /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.test(source.slice(offset, offset + 64))) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(offset, offset + 64))![0];
      kind = "literal";
      const close = source.indexOf(tag, offset + tag.length);
      if (close < 0) throw new Error("Unterminated SQL dollar-quoted string.");
      offset = close + tag.length;
    } else if (/[\p{L}\p{N}_]/u.test(character)) {
      kind = "word";
      while (offset < source.length && /[\p{L}\p{N}_$]/u.test(source[offset])) offset++;
    } else offset++;
    const text = source.slice(start, offset);
    const name = kind === "identifier" ? text.slice(1, -1).replaceAll('""', '"') : text;
    tokens.push({ text, name: name.toLowerCase(), start, end: offset, kind });
  }
  return tokens;
}

function significant(tokens: Token[]): Token[] {
  return tokens.filter((token) => token.kind !== "space" && token.kind !== "comment");
}

function keyword(token: Token | undefined, word: string): boolean {
  return token?.kind === "word" && token.name === word;
}

function afterParentheses(tokens: Token[], start: number): number {
  let depth = 0;
  for (let offset = start; offset < tokens.length; offset++) {
    if (tokens[offset].text === "(") depth++;
    if (tokens[offset].text === ")" && --depth === 0) return offset + 1;
  }
  throw new Error("Unbalanced SQL parentheses.");
}

export interface BoundSql {
  sql: string;
  values: unknown[];
  writes: boolean;
  statements: number;
  /** Set for a single INSERT into a world identity table. */
  insert?: { table: string; explicitId: boolean; returning: boolean };
}

/** Rewrites `?` placeholders as `$1..$n` and classifies the statement. */
export function bindSql(source: string, params: readonly SqlParameter[] = []): BoundSql {
  const tokens = tokenize(source);
  const meaningful = significant(tokens);
  let index = 0;
  const sql = tokens
    .map((token, offset) => {
      if (token.kind !== "symbol" || token.text !== "?") return token.text;
      const next = tokens[offset + 1];
      if (next?.kind === "symbol" && (next.text === "|" || next.text === "&"))
        throw new Error("Use jsonb_exists_any/jsonb_exists_all instead of the ?| and ?& operators.");
      return `$${++index}`;
    })
    .join("");
  if (index !== params.length)
    throw new Error(`SQL parameter count mismatch: expected ${index}, received ${params.length}.`);
  if (index > MAX_PARAMETERS)
    throw new Error("PostgreSQL supports at most 65535 parameters; pass an array or use bulkInsert.");
  if (meaningful.some((token) => token.kind === "symbol" && token.text === "$"))
    throw new Error("Use ? placeholders, not $n, in Touchline SQL.");
  const values = params.map((value) => {
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error("SQL numbers must be finite.");
    if (Array.isArray(value))
      for (const item of value)
        if (typeof item === "number" && !Number.isFinite(item))
          throw new Error("SQL numbers must be finite.");
    return typeof value === "bigint" ? value.toString() : (value ?? null);
  });
  const statementEnds = meaningful.filter((token) => token.text === ";");
  const trailing = meaningful.at(-1)?.text === ";" ? 1 : 0;
  const statements = meaningful.length ? statementEnds.length + 1 - trailing : 0;
  const writes = meaningful.some((token) => token.kind === "word" && WRITING_KEYWORDS.has(token.name));
  return { sql, values, writes, statements, insert: statements === 1 ? identityInsert(meaningful) : undefined };
}

function identityInsert(tokens: Token[]): BoundSql["insert"] {
  let offset = 0;
  if (keyword(tokens[offset], "with")) {
    let depth = 0;
    for (; offset < tokens.length; offset++) {
      if (tokens[offset].text === "(") depth++;
      if (tokens[offset].text === ")") depth--;
      if (depth === 0 && ["insert", "update", "delete", "select", "merge"].some((word) => keyword(tokens[offset], word)))
        break;
    }
  }
  if (!keyword(tokens[offset++], "insert") || !keyword(tokens[offset++], "into")) return undefined;
  while (tokens[offset + 1]?.text === ".") offset += 2;
  const table = tokens[offset];
  if (!table || !IDENTITY_TABLES.has(table.name)) return undefined;
  offset++;
  if (keyword(tokens[offset], "as")) offset += 2;
  let explicitId = false;
  if (tokens[offset]?.text === "(") {
    const end = afterParentheses(tokens, offset);
    explicitId = tokens.slice(offset + 1, end - 1).some((token) => token.name === "id");
  }
  let depth = 0;
  let returning = false;
  for (; offset < tokens.length; offset++) {
    if (tokens[offset].text === "(") depth++;
    if (tokens[offset].text === ")") depth--;
    if (depth === 0 && keyword(tokens[offset], "returning")) returning = true;
  }
  return { table: table.name, explicitId, returning };
}

const BIGINT_OID = 20;
const NUMERIC_OID = 1700;
const TIMESTAMP_OID = 1114;
const DATE_OID = 1082;

const parseNumber = (value: string) => Number(value);
/** COUNT and SUM return bigint/numeric; Touchline values stay well inside double precision. */
const types = {
  getTypeParser(oid: number, format?: "text" | "binary") {
    if (oid === BIGINT_OID || oid === NUMERIC_OID) return parseNumber;
    if (oid === DATE_OID) return (value: string) => value;
    if (oid === TIMESTAMP_OID) return (value: string) => new Date(`${value.replace(" ", "T")}Z`);
    return pg.types.getTypeParser(oid, format);
  },
} as pg.CustomTypesConfig;

export function sqlPoolConfig(settings: SqlSettings): pg.PoolConfig {
  return {
    host: settings.host,
    port: settings.port,
    database: settings.database,
    user: settings.user,
    password: settings.password,
    ssl: settings.ssl === "disable" ? false : { rejectUnauthorized: settings.ssl === "verify-full" },
    // A Raspberry Pi serves a handful of players: a small warm pool avoids reconnect cost without starving PostgreSQL.
    max: settings.poolSize,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 60_000,
    keepAlive: true,
    statement_timeout: settings.requestTimeout,
    idle_in_transaction_session_timeout: Math.max(settings.requestTimeout * 2, 60_000),
    application_name: settings.applicationName,
    options: "-c TimeZone=UTC",
    types,
  };
}

interface TransactionContext {
  client: pg.PoolClient;
  tail: Promise<void>;
  active: boolean;
  locked: boolean;
  readOnly: boolean;
  failed: boolean;
  failure?: unknown;
}

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  identity: boolean;
  generated: boolean;
}

/** Schema each pooled connection's search_path currently names; shared by every Store on one pool. */
type SearchPaths = WeakMap<pg.PoolClient, string>;

export class Store {
  readonly database: string;
  readonly schemaName: string;
  readonly testMode: boolean;
  private readonly context = new AsyncLocalStorage<TransactionContext>();
  private readonly batchContext = new AsyncLocalStorage<boolean>();
  private readonly activeTransactions = new Set<Promise<unknown>>();
  private readonly columnCache = new Map<string, ColumnInfo[]>();
  private readonly scopedStores = new Set<Store>();
  private ownsTestSchema = false;
  private closed = false;
  private closing?: Promise<void>;

  private constructor(
    settings: Pick<SqlSettings, "database" | "schema" | "testMode">,
    private readonly pool: pg.Pool,
    private readonly searchPaths: SearchPaths,
    private readonly poolOwner?: Store,
  ) {
    this.database = settings.database;
    this.schemaName = validateSqlSchema(settings.schema, settings.testMode);
    this.testMode = settings.testMode;
    Object.defineProperty(this, "schemaName", { writable: false, configurable: false });
  }

  forSchema(schema: string): Store {
    this.assertOpen();
    const owner = this.poolOwner ?? this;
    const store = new Store(
      { database: this.database, schema, testMode: this.testMode },
      this.pool,
      this.searchPaths,
      owner,
    );
    owner.scopedStores.add(store);
    return store;
  }

  private static async connect(settings: SqlSettings): Promise<Store> {
    const pool = new pg.Pool(sqlPoolConfig(settings));
    pool.on("error", (error: Error) => console.error("SQL connection pool error:", error.message));
    try {
      const client = await pool.connect();
      client.release();
      return new Store(settings, pool, new WeakMap());
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  static async open(database?: string): Promise<Store> {
    return Store.connect(
      readSqlSettings(database === undefined ? process.env : { ...process.env, SQL_DATABASE: database }),
    );
  }

  static async createTest(label?: string, database?: string): Promise<Store> {
    if (database && database !== process.env.SQL_DATABASE &&
      !["localhost", "127.0.0.1", "::1"].includes(process.env.SQL_HOST ?? "127.0.0.1"))
      throw new Error("Alternate test databases are allowed only on local PostgreSQL.");
    // touchline_test_ + 32 hex + _ + 15 label characters = 63, PostgreSQL's identifier limit.
    const suffix = label?.replace(/[^A-Za-z0-9_]/g, "_").toLowerCase().slice(0, 15);
    const schema = `touchline_test_${randomUUID().replaceAll("-", "")}${suffix ? `_${suffix}` : ""}`;
    const settings = readSqlSettings({
      ...process.env,
      SQL_DATABASE: database ?? process.env.SQL_DATABASE,
      SQL_TEST_MODE: "true",
      SQL_SCHEMA: schema,
    });
    const store = await Store.connect(settings);
    try {
      await store.exec(`CREATE SCHEMA ${quoteIdentifier(schema)};`);
      store.ownsTestSchema = true;
      await store.schema();
      return store;
    } catch (error) {
      try {
        await store.close();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `Test setup failed; schema ${schema} cleanup also failed.`);
      }
      throw error;
    }
  }

  private assertOpen(): void {
    const context = this.context.getStore();
    if (
      this.closed || this.poolOwner?.closed ||
      ((this.closing || this.poolOwner?.closing) && !context?.active)
    )
      throw new Error("SQL store is closed or closing.");
    if (context && !context.active) throw new Error("The SQL transaction has already completed.");
  }

  /** Points a connection at this store's schema; only called outside a transaction, so it is never rolled back. */
  private async useSchema(client: pg.PoolClient): Promise<void> {
    if (this.searchPaths.get(client) === this.schemaName) return;
    this.searchPaths.delete(client);
    await client.query(`SET search_path TO ${quoteIdentifier(this.schemaName)}`);
    this.searchPaths.set(client, this.schemaName);
  }

  private async withClient<Result>(callback: (client: pg.PoolClient) => Promise<Result>): Promise<Result> {
    const client = await this.pool.connect();
    let broken: Error | undefined;
    try {
      await this.useSchema(client);
      return await callback(client);
    } catch (error) {
      // A connection-level failure must not return the client to the pool.
      if (!sqlErrorCode(error)) broken = error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      if (broken) this.searchPaths.delete(client);
      client.release(broken);
    }
  }

  private async request<Result>(callback: (client: pg.PoolClient) => Promise<Result>): Promise<Result> {
    this.assertOpen();
    const context = this.context.getStore();
    if (!context) return this.withClient(callback);
    const operation = context.tail.then(() => {
      if (!context.active) throw new Error("The SQL transaction is no longer active.");
      if (context.failed) throw context.failure;
      return callback(context.client);
    });
    context.tail = operation.then(
      () => {},
      (error: unknown) => {
        if (!context.failed) {
          context.failed = true;
          context.failure = error;
        }
      },
    );
    return operation;
  }

  private async query(client: pg.PoolClient, prepared: BoundSql): Promise<pg.QueryResult[]> {
    if (!prepared.values.length) {
      // The simple protocol runs several statements in one round trip.
      const result = (await client.query(prepared.sql)) as pg.QueryResult | pg.QueryResult[];
      return Array.isArray(result) ? result : [result];
    }
    if (prepared.statements > 1)
      throw new Error("A parameterized SQL call must contain exactly one statement.");
    return [await client.query({ text: prepared.sql, values: prepared.values })];
  }

  async all<Result>(sql: string, ...params: SqlParameter[]): Promise<Result[]> {
    const prepared = bindSql(sql, params);
    const execute = () =>
      this.request(async (client) => {
        const results = await this.query(client, prepared);
        if (prepared.insert?.explicitId) await this.reseed(client, prepared.insert.table);
        return (results.at(-1)?.rows ?? []) as Result[];
      });
    if (!prepared.writes) return execute();
    this.assertWritable();
    return this.atomic(execute);
  }

  async get<Result>(sql: string, ...params: SqlParameter[]): Promise<Result | undefined> {
    return (await this.all<Result>(sql, ...params))[0];
  }

  async run(sql: string, ...params: SqlParameter[]): Promise<RunResult> {
    this.assertWritable();
    const prepared = bindSql(sql, params);
    const insert = prepared.insert;
    if (insert && !insert.returning)
      prepared.sql = `${prepared.sql.replace(/[\s;]+$/, "")} RETURNING id`;
    return this.atomic(async () =>
      this.request(async (client) => {
        const result = (await this.query(client, prepared)).at(-1);
        if (insert?.explicitId) await this.reseed(client, insert.table);
        const rows = result?.rows as { id?: unknown }[] | undefined;
        const last = insert && rows?.length ? rows.at(-1)!.id : null;
        return {
          changes: result?.rowCount ?? 0,
          lastInsertRowid: typeof last === "number" ? last : last == null ? null : Number(last),
        };
      }),
    );
  }

  async exec(sql: string, ...params: SqlParameter[]): Promise<void> {
    this.assertWritable();
    const prepared = bindSql(sql, params);
    await this.atomic(async () =>
      this.request(async (client) => {
        await this.query(client, prepared);
        if (prepared.insert?.explicitId) await this.reseed(client, prepared.insert.table);
      }),
    );
  }

  /** After explicit ids were inserted, moves the identity sequence past the highest id. */
  private async reseed(client: pg.PoolClient, table: string): Promise<void> {
    if (!IDENTITY_TABLES.has(table)) throw new Error("Unknown world identity table.");
    const target = tableName(this.schemaName, table);
    await client.query({
      text: `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${target}`,
      values: [target],
    });
  }

  async meta<Result>(key: string): Promise<Result> {
    const row = await this.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", key);
    if (!row) throw new Error(`Missing game metadata: ${key}`);
    return JSON.parse(row.value) as Result;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("Game metadata must be JSON serializable.");
    await this.exec(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      key,
      serialized,
    );
  }

  async transaction<Result>(callback: () => Promise<Result>): Promise<Result> {
    // Inside batched(), a transaction() block is a unit of work; each of its statements commits on its own.
    if (this.batchContext.getStore() && !this.context.getStore()) {
      this.assertOpen();
      return callback();
    }
    return this.atomic(callback);
  }

  /**
   * A read-only transaction under the world lock in SHARED mode: readers run side by side, yet every writer
   * (which takes the lock exclusively) still waits for them and they for it. Any write inside it throws.
   * Inside another transaction or batched() it just runs the callback there.
   */
  async readTransaction<Result>(callback: () => Promise<Result>): Promise<Result> {
    this.assertOpen();
    if (this.context.getStore() || this.batchContext.getStore()) return callback();
    return this.track(this.startTransaction(callback, true, true));
  }

  private assertWritable(): void {
    if (this.context.getStore()?.readOnly) throw new Error("A read-only SQL transaction cannot write.");
  }

  private worldLock(): string {
    return `touchline:world:${this.schemaName.toLowerCase()}`;
  }

  private async track<Result>(operation: Promise<Result>): Promise<Result> {
    this.activeTransactions.add(operation);
    try {
      return await operation;
    } finally {
      this.activeTransactions.delete(operation);
    }
  }

  /**
   * Takes a transaction-scoped advisory lock inside the current transaction, waiting at most `timeout`.
   * Use for cross-world coordination such as the account registry.
   */
  async advisoryLock(name: string, { shared = false, timeout = WORLD_LOCK_TIMEOUT } = {}): Promise<void> {
    const context = this.context.getStore();
    if (!context?.active) throw new Error("advisoryLock() requires an active Store.transaction().");
    if (!/^\d+(?:ms|s|min)$/.test(timeout)) throw new Error("Invalid lock timeout.");
    await this.request((client) => this.lock(client, name, shared, timeout));
  }

  private async lock(client: pg.PoolClient, name: string, shared: boolean, timeout: string): Promise<void> {
    try {
      await client.query(`SET LOCAL lock_timeout = '${timeout}';
        SELECT pg_advisory_xact_lock${shared ? "_shared" : ""}(${advisoryLockKey(name)});
        SET LOCAL lock_timeout = DEFAULT;`);
    } catch (error) {
      if (isLockTimeout(error)) throw new Error(`Touchline lock ${name} could not be acquired.`, { cause: error });
      throw error;
    }
  }

  /**
   * Runs a large write, such as building a new career world, as many short transactions instead of one, so a
   * full world never needs one huge transaction. One idle transaction holds the world writer lock
   * for the whole callback, so no other writer interleaves; the callback must mark its result complete last and
   * clean up if it fails, because statements already committed stay committed.
   */
  async batched<Result>(callback: () => Promise<Result>): Promise<Result> {
    this.assertOpen();
    // Already inside a transaction (one atomic unit, as before) or another batched() call: just run it.
    if (this.context.getStore() || this.batchContext.getStore()) return callback();
    return this.track((async () => {
      const holder = await this.pool.connect();
      let broken: Error | undefined;
      try {
        await holder.query("BEGIN");
        try {
          await this.lock(holder, this.worldLock(), false, WORLD_LOCK_TIMEOUT);
          return await this.batchContext.run(true, callback);
        } finally {
          // The holder wrote nothing; ending it only releases the lock (a dropped connection releases it too).
          await holder.query("ROLLBACK").catch((error: Error) => {
            broken = error;
          });
        }
      } finally {
        holder.release(broken);
      }
    })());
  }

  /** One SQL transaction: joins the current one, or starts one under the world writer lock. */
  private async atomic<Result>(callback: () => Promise<Result>): Promise<Result> {
    this.assertOpen();
    const existing = this.context.getStore();
    if (existing) {
      if (existing.failed) throw existing.failure ?? new Error("The SQL transaction was rolled back.");
      try {
        return await callback();
      } catch (error) {
        if (!existing.failed) {
          existing.failed = true;
          existing.failure = error;
        }
        throw error;
      }
    }
    return this.track(this.startTransaction(callback, !this.batchContext.getStore()));
  }

  private async startTransaction<Result>(
    callback: () => Promise<Result>,
    acquireLock = true,
    shared = false,
  ): Promise<Result> {
    const client = await this.pool.connect();
    // The connection returns to the pool only after a confirmed COMMIT or ROLLBACK; otherwise it is destroyed.
    let clean = false;
    const context: TransactionContext = {
      client,
      tail: Promise.resolve(),
      active: true,
      locked: false,
      readOnly: shared,
      failed: false,
    };
    try {
      await this.useSchema(client);
      await client.query(shared ? "BEGIN READ ONLY" : "BEGIN");
      return await this.context.run(context, async () => {
        try {
          if (acquireLock) await this.lock(client, this.worldLock(), shared, WORLD_LOCK_TIMEOUT);
          // Only the exclusive lock is a writer lock (clearWorld requires one).
          context.locked = acquireLock && !shared;
          const result = await callback();
          await context.tail;
          if (context.failed) throw context.failure;
          await client.query("COMMIT");
          clean = true;
          return result;
        } catch (error) {
          await context.tail;
          if (clean) throw error;
          try {
            await client.query("ROLLBACK");
            clean = true;
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], "SQL operation and rollback both failed.");
          }
          throw error;
        } finally {
          context.active = false;
          context.locked = false;
        }
      });
    } finally {
      if (!clean) this.searchPaths.delete(client);
      client.release(clean ? undefined : true);
    }
  }

  async schema(): Promise<void> {
    await this.atomic(async () => {
      await this.lockSchemaMaintenance();
      if (
        this.schemaName.toLowerCase() === "accounts" ||
        (await this.get(
          "SELECT 1 AS present FROM pg_catalog.pg_tables WHERE schemaname = ? AND tablename = 'users'",
          this.schemaName,
        ))
      )
        throw new Error("World migrations cannot run in an account registry schema.");
      await this.exec(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(this.schemaName)};`);
      await this.exec(migrationTableSql(this.schemaName));
      const applied = new Set(
        (await this.all<{ version: number }>("SELECT version FROM schema_migrations")).map((row) => row.version),
      );
      const migrations = schemaMigrations(this.schemaName);
      if ([...applied].some((version) => version > migrations.at(-1)!.version))
        throw new Error("This database was migrated by a newer version of Touchline.");
      for (const migration of migrations) {
        if (applied.has(migration.version)) continue;
        for (const statement of migration.statements) await this.exec(statement);
        await this.run(
          "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
          migration.version,
          migration.name,
        );
      }
      if (!(await this.get("SELECT key FROM meta WHERE key = ?", "appearanceIndexVersion"))) {
        for (const statement of appearanceBackfill(this.schemaName)) await this.exec(statement);
        await this.setMeta("appearanceIndexVersion", 1);
      }
      this.columnCache.clear();
    });
  }

  async worldTables(): Promise<string[]> {
    const rows = await this.all<{ name: string }>(
      "SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = ?",
      this.schemaName,
    );
    const existing = new Set(rows.map((row) => row.name));
    return WORLD_TABLES.filter((table) => existing.has(table));
  }

  private knownTable(table: string): string {
    const name = table.toLowerCase();
    if (!STORE_TABLES.has(name)) throw new Error(`Unknown Touchline table: ${table}`);
    return name;
  }

  private async columnInfo(table: string): Promise<ColumnInfo[]> {
    table = this.knownTable(table);
    const cached = this.columnCache.get(table);
    if (cached) return cached;
    const columns = await this.all<ColumnInfo>(
      `SELECT attribute.attname AS name, format_type(attribute.atttypid, attribute.atttypmod) AS type,
        NOT attribute.attnotnull AS nullable, attribute.attidentity <> '' AS identity,
        attribute.attgenerated <> '' AS generated
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = to_regclass(?) AND attribute.attnum > 0 AND NOT attribute.attisdropped
      ORDER BY attribute.attnum`,
      tableName(this.schemaName, table),
    );
    if (!columns.length)
      throw new Error(`SQL table ${this.schemaName}.${table} does not exist; call schema() first.`);
    this.columnCache.set(table, columns);
    return columns;
  }

  async columns(table: string): Promise<string[]> {
    return (await this.columnInfo(table)).filter((column) => !column.generated).map((column) => column.name);
  }

  /** Inserts many rows with one `INSERT ... SELECT FROM unnest(...)` per batch: one array parameter per column. */
  async bulkInsert(table: string, rows: readonly object[]): Promise<void> {
    this.assertWritable();
    table = this.knownTable(table);
    if (!rows.length) return;
    await this.atomic(async () => {
      const metadata = await this.columnInfo(table);
      const known = new Map(metadata.map((column) => [column.name, column]));
      const keys = Object.keys(rows[0]);
      for (const key of keys) if (!known.has(key)) throw new Error(`Unknown SQL column ${table}.${key}.`);
      const columns = metadata.filter((column) => !column.generated && keys.includes(column.name));
      if (!columns.length) throw new Error("Bulk insert requires at least one writable column.");
      const selected = new Set(columns.map((column) => column.name));
      for (const row of rows) {
        const rowKeys = Object.keys(row);
        if (
          rowKeys.some((key) => !known.has(key)) ||
          columns.some((column) => !Object.hasOwn(row, column.name)) ||
          rowKeys.some((key) => !selected.has(key) && !known.get(key)?.generated)
        )
          throw new Error("All bulk rows must have the same writable columns.");
      }
      const target = tableName(this.schemaName, table);
      const statement = `INSERT INTO ${target} (${columns.map((column) => quoteIdentifier(column.name)).join(", ")})
        SELECT * FROM unnest(${columns.map((column, index) => `$${index + 1}::${column.type}[]`).join(", ")})`;
      await this.request(async (client) => {
        for (let offset = 0; offset < rows.length; offset += BULK_BATCH_ROWS) {
          const batch = rows.slice(offset, offset + BULK_BATCH_ROWS) as readonly Record<string, SqlParameter>[];
          const values = columns.map((column) =>
            batch.map((row) => {
              const value = row[column.name] ?? null;
              if (typeof value === "number" && !Number.isFinite(value)) throw new Error("SQL numbers must be finite.");
              return typeof value === "bigint" ? value.toString() : value;
            }),
          );
          await client.query({ text: statement, values });
        }
        if (IDENTITY_TABLES.has(table) && selected.has("id")) await this.reseed(client, table);
      });
    });
  }

  async clearWorld(): Promise<void> {
    this.assertOpen();
    const context = this.context.getStore();
    if (!context?.active || !context.locked)
      throw new Error("clearWorld() requires an active Store.transaction() writer lock.");
    await this.discardWorld();
  }

  /** Empties every world table with one TRUNCATE, which also restarts identity sequences. */
  async discardWorld(): Promise<{ truncated: string[]; deleted: string[] }> {
    this.assertOpen();
    const context = this.context.getStore();
    if (!this.batchContext.getStore() && (!context?.active || !context.locked))
      throw new Error("discardWorld() requires an active Store.transaction() writer lock.");
    const tables = await this.worldTables();
    if (tables.length)
      await this.exec(
        `TRUNCATE TABLE ${tables.map((table) => tableName(this.schemaName, table)).join(", ")} RESTART IDENTITY;`,
      );
    return { truncated: tables, deleted: [] };
  }

  private async dropTestSchema(): Promise<void> {
    if (
      !this.ownsTestSchema ||
      !this.testMode ||
      !/^touchline_test_[a-f0-9]{32}(?:_|$)/.test(this.schemaName)
    )
      throw new Error("Refusing to drop a schema not owned by this test store.");
    await this.lockSchemaMaintenance();
    await this.exec(`DROP SCHEMA IF EXISTS ${quoteIdentifier(this.schemaName)} CASCADE;`);
    this.ownsTestSchema = false;
  }

  private async lockSchemaMaintenance(): Promise<void> {
    await this.request((client) => this.lock(client, "touchline:schema-maintenance", false, MAINTENANCE_LOCK_TIMEOUT));
  }

  async close(): Promise<void> {
    if (
      this.context.getStore()?.active ||
      [...this.scopedStores].some((store) => store.context.getStore()?.active)
    )
      throw new Error("Cannot close a SQL store inside its transaction.");
    if (this.closing) return this.closing;
    if (this.closed) return;
    this.closing = (async () => {
      try {
        await Promise.all([...this.scopedStores].map((store) => store.close()));
        await Promise.allSettled([...this.activeTransactions]);
        if (this.ownsTestSchema) await this.startTransaction(async () => this.dropTestSchema(), false);
      } finally {
        try {
          if (!this.poolOwner) await this.pool.end();
        } finally {
          this.closed = true;
          this.poolOwner?.scopedStores.delete(this);
        }
      }
    })();
    return this.closing;
  }
}

/** The game database could not be opened; the request did no work and can be retried. */
export class DatabaseUnavailableError extends Error {
  readonly status = 503;
  readonly code = "database_unavailable";

  constructor(cause?: unknown) {
    super("The game database is starting or unavailable. Try again in a moment.", { cause });
    this.name = "DatabaseUnavailableError";
  }
}

/**
 * Opens the database on the first call instead of at boot, so requests that never need SQL never wait on it.
 * Concurrent callers share one attempt. Retryable failures are retried for `retryFor` ms (PostgreSQL may still
 * be starting next to the app after a reboot), then the call rejects with DatabaseUnavailableError and the next
 * call starts a new attempt.
 */
export function openOnFirstUse<Resource>(
  open: () => Promise<Resource>,
  { retryFor = 90_000, retryDelay = 3_000, retryable = () => true }: {
    retryFor?: number;
    retryDelay?: number;
    retryable?: (error: unknown) => boolean;
  } = {},
) {
  let pending: Promise<Resource> | undefined;
  let closed = false;
  const attempt = async () => {
    const deadline = Date.now() + retryFor;
    for (;;) {
      if (closed) throw new DatabaseUnavailableError();
      try {
        return await open();
      } catch (error) {
        if (closed || !retryable(error) || Date.now() + retryDelay >= deadline)
          throw new DatabaseUnavailableError(error);
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, retryDelay));
    }
  };
  return {
    get(): Promise<Resource> {
      if (closed) return Promise.reject(new DatabaseUnavailableError());
      pending ??= attempt().catch((error: unknown) => {
        pending = undefined;
        throw error;
      });
      return pending;
    },
    /** Stops new attempts; an opened, or still opening, resource is passed to `dispose`. */
    async close(dispose: (resource: Resource) => Promise<void>): Promise<void> {
      closed = true;
      const current = pending;
      pending = undefined;
      const resource = await current?.catch(() => undefined);
      if (resource !== undefined) await dispose(resource);
    },
  };
}
