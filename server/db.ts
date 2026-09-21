import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type * as Sql from "mssql";
import { readSqlSettings, type SqlSettings } from "./sql-config.ts";
import {
  appearanceBackfill,
  IDENTITY_TABLES,
  migrationTableSql,
  quoteIdentifier,
  schemaMigrations,
  sqlLiteral,
  STORE_TABLES,
  tableName,
  WORLD_TABLES,
} from "./sql-schema.ts";

export { WORLD_TABLES } from "./sql-schema.ts";

export type SqlParameter =
  string | number | bigint | boolean | Date | Buffer | null | undefined;
export interface RunResult {
  changes: number;
  lastInsertRowid: number | null;
}

const WRITING_KEYWORDS = new Set([
  "insert",
  "update",
  "delete",
  "merge",
  "into",
  "create",
  "alter",
  "drop",
  "truncate",
  "exec",
  "execute",
  "dbcc",
  "grant",
  "deny",
  "revoke",
  "set",
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
    } else if (character === "'" || character === '"' || character === "[") {
      kind = character === "'" ? "literal" : "identifier";
      const closing = character === "[" ? "]" : character;
      offset++;
      let closed = false;
      while (offset < source.length) {
        if (source[offset++] !== closing) continue;
        if (source[offset] === closing) {
          offset++;
          continue;
        }
        closed = true;
        break;
      }
      if (!closed)
        throw new Error("Unterminated SQL quoted value or identifier.");
    } else if (/[\p{L}\p{N}_@#$]/u.test(character)) {
      kind = "word";
      while (offset < source.length && /[\p{L}\p{N}_@#$]/u.test(source[offset]))
        offset++;
    } else offset++;
    const text = source.slice(start, offset);
    const name =
      kind === "identifier"
        ? text
            .slice(1, -1)
            .replaceAll(
              character === "[" ? "]]" : '""',
              character === "[" ? "]" : '"',
            )
        : text;
    tokens.push({ text, name: name.toLowerCase(), start, end: offset, kind });
  }
  return tokens;
}

function significant(tokens: Token[]): Token[] {
  return tokens.filter(
    (token) => token.kind !== "space" && token.kind !== "comment",
  );
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

function cteNames(tokens: Token[]): Map<string, number> {
  const names = new Map<string, number>();
  if (!keyword(tokens[0], "with")) return names;
  let cursor = 1;
  while (
    tokens[cursor]?.kind === "word" ||
    tokens[cursor]?.kind === "identifier"
  ) {
    const token = tokens[cursor++];
    if (tokens[cursor]?.text === "(")
      cursor = afterParentheses(tokens, cursor);
    if (!keyword(tokens[cursor], "as") || tokens[cursor + 1]?.text !== "(")
      break;
    names.set(token.name, token.start);
    cursor = afterParentheses(tokens, cursor + 1);
    if (tokens[cursor]?.text !== ",") break;
    cursor++;
  }
  return names;
}

function assertStatementScope(tokens: Token[]): void {
  let depth = 0;
  let command = "";
  let insertSelect = false;
  let values = false;
  let setOperation = false;
  for (const [offset, token] of tokens.entries()) {
    if (token.text === "(") depth++;
    if (token.text === ")") depth--;
    if (depth < 0) throw new Error("Unbalanced SQL parentheses.");
    if (depth !== 0 || token.kind !== "word") continue;
    if (["union", "except", "intersect"].includes(token.name))
      setOperation = true;
    if (keyword(token, "values")) values = true;
    if (keyword(token, "update") && tokens[offset + 1]?.text === "(") continue;
    if (!["select", "insert", "update", "delete", "merge"].includes(token.name))
      continue;
    if (
      command === "merge" &&
      keyword(tokens[offset - 1], "then") &&
      ["insert", "update", "delete"].includes(token.name)
    )
      continue;
    if (
      command &&
      !(token.name === "select" && (
        (command === "insert" && !insertSelect && !values) ||
        (setOperation && (command === "select" || insertSelect))
      ))
    )
      throw new Error(
        "Unsupported or ambiguous SQL batch for schema isolation; separate statements with semicolons.",
      );
    if (command === "insert" && token.name === "select") insertSelect = true;
    command ||= token.name;
    setOperation = false;
  }
  if (depth !== 0) throw new Error("Unbalanced SQL parentheses.");
}

function tableReplacements(
  tokens: Token[],
  schema: string,
): Map<number, string> {
  const replacements = new Map<number, string>();
  const clauses = new Set([
    "where",
    "group",
    "order",
    "having",
    "union",
    "except",
    "intersect",
    "set",
    "values",
    "output",
    "option",
    "when",
  ]);
  let statementStart = 0;
  while (statementStart < tokens.length) {
    let statementEnd = statementStart;
    while (statementEnd < tokens.length && tokens[statementEnd].text !== ";")
      statementEnd++;
    const statement = tokens.slice(statementStart, statementEnd);
    const ctes = cteNames(statement);
    const isolated = schema.toLowerCase() !== "dbo";
    const writes = statement.some(
      (token) => token.kind === "word" && WRITING_KEYWORDS.has(token.name),
    );
    const aliases = new Map<number, Set<string>>();
    const targets: { token: Token; update: boolean; depth: number }[] = [];
    const fromDepths = new Set<number>();
    const scopes = [0];
    let nextScope = 0;
    let depth = 0;
    let expectTable = false;
    let update = false;
    let ddlTarget = false;
    for (let offset = 0; offset < statement.length; offset++) {
      const token = statement[offset];
      if (expectTable) {
        if (
          keyword(token, "if") ||
          keyword(token, "exists") ||
          keyword(token, "into") ||
          (update && keyword(token, "from"))
        )
          continue;
        if (keyword(token, "top") && statement[offset + 1]?.text === "(") {
          offset = afterParentheses(statement, offset + 1) - 1;
          continue;
        }
        if (keyword(token, "percent")) continue;
        expectTable = false;
        if (token.kind === "word" || token.kind === "identifier" || token.text === "(") {
          let end = token.text === "(" ? afterParentheses(statement, offset) - 1 : offset;
          while (statement[end + 1]?.text === ".") end += 2;
          if (
            isolated && writes && end > offset &&
            STORE_TABLES.has(statement[end]?.name) &&
            !(end === offset + 2 && token.name === schema.toLowerCase())
          )
            throw new Error("Unsupported cross-schema game write for schema isolation.");
          if (
            end === offset &&
            STORE_TABLES.has(token.name) &&
            (ctes.get(token.name) ?? Infinity) > token.start
          )
            targets.push({ token, update, depth });
          let alias = end + 1;
          if (
            keyword(statement[alias], "with") &&
            statement[alias + 1]?.text === "("
          )
            alias = afterParentheses(statement, alias + 1);
          if (keyword(statement[alias], "as")) alias++;
          const candidate = statement[alias];
          if (
            !update &&
            candidate &&
            (candidate.kind === "identifier" ||
              (candidate.kind === "word" &&
                !clauses.has(candidate.name) &&
                ![
                  "join",
                  "left",
                  "right",
                  "inner",
                  "outer",
                  "cross",
                  "full",
                  "on",
                  "with",
                  "using",
                  "from",
                  "select",
                  "insert",
                  "update",
                  "delete",
                ].includes(candidate.name)))
          ) {
            if (!aliases.has(depth)) aliases.set(depth, new Set());
            aliases.get(depth)!.add(candidate.name);
          }
        }
      }
      if (token.text === "(") {
        scopes.push(++nextScope);
        depth = nextScope;
        continue;
      }
      if (token.text === ")") {
        fromDepths.delete(depth);
        scopes.pop();
        depth = scopes.at(-1) ?? 0;
        continue;
      }
      if (token.kind !== "word" && token.text !== ",") continue;
      if (clauses.has(token.name)) fromDepths.delete(depth);
      if (keyword(token, "index") || keyword(token, "trigger"))
        ddlTarget = true;
      if (keyword(token, "from")) fromDepths.add(depth);
      if (
        [
          "from",
          "join",
          "apply",
          "references",
          "using",
          "into",
          "update",
          "insert",
          "merge",
          "table",
        ].some((word) => keyword(token, word)) ||
        (keyword(token, "delete") && !keyword(statement[offset + 1], "from")) ||
        (keyword(token, "on") && ddlTarget) ||
        (token.text === "," && fromDepths.has(depth))
      ) {
        expectTable = true;
        update = keyword(token, "update") || keyword(token, "delete") ||
          (keyword(token, "from") && keyword(statement[offset - 1], "delete"));
        if (keyword(token, "on")) ddlTarget = false;
      }
    }
    if (isolated && (targets.length || ctes.size || !statement.some(
      (token) => ["create", "alter", "drop"].some((word) => keyword(token, word)),
    )))
      assertStatementScope(statement);
    for (const target of targets)
      if (!target.update || !aliases.get(target.depth)?.has(target.token.name))
        replacements.set(
          target.token.start,
          `${quoteIdentifier(schema)}.${target.token.text}`,
        );
    statementStart = statementEnd + 1;
  }
  return replacements;
}

export function bindSql(
  source: string,
  params: readonly SqlParameter[] = [],
  schema = "dbo",
) {
  const tokens = tokenize(source);
  const meaningful = significant(tokens);
  const replacements = tableReplacements(meaningful, schema);
  const used = new Set(
    meaningful
      .filter((token) => token.kind === "word")
      .map((token) => token.name),
  );
  const parameters: { name: string; value: SqlParameter }[] = [];
  const sql = tokens
    .map((token) => {
      if (token.kind !== "symbol" || token.text !== "?")
        return replacements.get(token.start) ?? token.text;
      let name = `__touchline_arg_${parameters.length}`;
      while (used.has(`@${name}`)) name += "_";
      used.add(`@${name}`);
      parameters.push({ name, value: params[parameters.length] });
      return `@${name}`;
    })
    .join("");
  if (parameters.length !== params.length)
    throw new Error(
      `SQL parameter count mismatch: expected ${parameters.length}, received ${params.length}.`,
    );
  if (parameters.length > 2100)
    throw new Error(
      "SQL Server supports at most 2100 parameters; use bulkInsert for large inputs.",
    );
  const writes = meaningful.some(
    (token) => token.kind === "word" && WRITING_KEYWORDS.has(token.name),
  );
  return { sql, parameters, writes };
}

function identityInsertBatch(target: string, statement: string): string {
  return `SET IDENTITY_INSERT ${target} ON;
    BEGIN TRY
      ${statement}
      SET IDENTITY_INSERT ${target} OFF;
    END TRY
    BEGIN CATCH
      SET IDENTITY_INSERT ${target} OFF;
      THROW;
    END CATCH;`;
}

export function runSql(source: string): string {
  const tokens = significant(tokenize(source));
  let offset = 0;
  while (tokens[offset]?.text === ";") offset++;
  if (keyword(tokens[offset], "with")) {
    let depth = 0;
    for (; offset < tokens.length; offset++) {
      if (tokens[offset].text === "(") depth++;
      if (tokens[offset].text === ")") depth--;
      if (
        depth === 0 &&
        ["insert", "update", "delete", "select", "merge"].some((word) =>
          keyword(tokens[offset], word),
        )
      )
        break;
    }
  }
  const ordinary = () =>
    `${source}\n;SELECT @@ROWCOUNT AS [__touchline_changes], CAST(NULL AS INT) AS [__touchline_identity];`;
  if (!keyword(tokens[offset++], "insert")) return ordinary();
  if (keyword(tokens[offset], "top")) {
    offset = afterParentheses(tokens, offset + 1);
    if (keyword(tokens[offset], "percent")) offset++;
  }
  if (keyword(tokens[offset], "into")) offset++;
  const targetStart = offset;
  while (tokens[offset + 1]?.text === ".") offset += 2;
  if (!tokens[offset] || !IDENTITY_TABLES.has(tokens[offset].name))
    return ordinary();
  const target = source.slice(tokens[targetStart].start, tokens[offset].end);
  offset++;
  if (keyword(tokens[offset], "with") && tokens[offset + 1]?.text === "(")
    offset = afterParentheses(tokens, offset + 1);
  let explicitId = false;
  if (tokens[offset]?.text === "(") {
    const end = afterParentheses(tokens, offset);
    explicitId = tokens
      .slice(offset + 1, end - 1)
      .some((token) => token.name === "id");
    offset = end;
  }
  let outputStart: Token | undefined;
  let outputInto = false;
  let depth = 0;
  for (; offset < tokens.length; offset++) {
    const token = tokens[offset];
    if (token.text === "(") depth++;
    if (token.text === ")") depth--;
    if (depth !== 0) continue;
    if (
      ["values", "select", "default", "exec", "execute"].some((word) =>
        keyword(token, word),
      )
    )
      break;
    if (keyword(token, "output")) outputStart = token;
    if (outputStart && keyword(token, "into")) outputInto = true;
  }
  const payload = tokens[offset];
  if (!payload) return ordinary();
  const capture =
    !outputInto && !keyword(payload, "exec") && !keyword(payload, "execute");
  let suffix = "";
  const used = new Set(tokens.map((token) => token.name));
  while (
    used.has(`@__touchline_inserted${suffix}`) ||
    used.has(`@__touchline_changed${suffix}`)
  )
    suffix += "_";
  const inserted = `@__touchline_inserted${suffix}`;
  const changed = `@__touchline_changed${suffix}`;
  const statement = capture
    ? `${source.slice(0, outputStart?.start ?? payload.start)} OUTPUT INSERTED.[id] INTO ${inserted} ([id]) ${source.slice(payload.start)}`
    : source;
  const mutation = `${statement}\n;SET ${changed} = @@ROWCOUNT;`;
  return `DECLARE ${changed} INT;
    ${capture ? `DECLARE ${inserted} TABLE ([ordinal] INT IDENTITY(1,1), [id] INT NOT NULL);` : ""}
    ${explicitId ? identityInsertBatch(target, mutation) : mutation}
    SELECT ${changed} AS [__touchline_changes],
      ${capture ? `(SELECT TOP (1) [id] FROM ${inserted} ORDER BY [ordinal] DESC)` : `CASE WHEN ${changed} > 0 THEN CONVERT(INT, SCOPE_IDENTITY()) END`} AS [__touchline_identity];`;
}

export function sqlPoolConfig(settings: SqlSettings): Sql.config {
  return {
    server: settings.server,
    port: settings.port,
    database: settings.database,
    ...(settings.user
      ? { user: settings.user, password: settings.password }
      : {
          authentication: {
            type: "azure-active-directory-default" as const,
            options: { clientId: settings.managedIdentityClientId },
          },
        }),
    pool: { min: 0, max: 4, idleTimeoutMillis: 10000 },
    connectionTimeout: 60000,
    requestTimeout: settings.requestTimeout,
    options: {
      encrypt: settings.encrypt,
      trustServerCertificate: settings.trustServerCertificate,
      abortTransactionOnError: true,
      enableArithAbort: true,
      useUTC: true,
      appName: "Touchline",
      enableQuotedIdentifier: true,
    },
  };
}

interface TransactionContext {
  transaction: Sql.Transaction;
  tail: Promise<void>;
  active: boolean;
  locked: boolean;
  rolledBack: boolean;
  failed: boolean;
  failure?: unknown;
}

interface ColumnInfo {
  name: string;
  type: string;
  max_length: number;
  scale: number;
  is_nullable: boolean;
  is_identity: boolean;
  is_computed: boolean;
}

export class Store {
  readonly database: string;
  readonly schemaName: string;
  readonly testMode: boolean;
  private readonly context = new AsyncLocalStorage<TransactionContext>();
  private readonly activeTransactions = new Set<Promise<unknown>>();
  private readonly columnCache = new Map<string, ColumnInfo[]>();
  private ownsTestSchema = false;
  private closed = false;
  private closing?: Promise<void>;

  private constructor(
    settings: SqlSettings,
    private readonly pool: Sql.ConnectionPool,
    private readonly driver: Omit<typeof Sql, "default">,
  ) {
    this.database = settings.database;
    this.schemaName = settings.schema;
    this.testMode = settings.testMode;
  }

  private static async connect(settings: SqlSettings): Promise<Store> {
    const { default: driver } = await import("mssql");
    const pool = new driver.ConnectionPool(sqlPoolConfig(settings));
    pool.on("error", (error: Error) =>
      console.error("SQL connection pool error:", error.message),
    );
    try {
      await pool.connect();
      return new Store(settings, pool, driver);
    } catch (error) {
      await pool.close();
      throw error;
    }
  }

  static async open(database?: string): Promise<Store> {
    return Store.connect(
      readSqlSettings(
        database === undefined
          ? process.env
          : { ...process.env, SQL_DATABASE: database },
      ),
    );
  }

  static async createTest(label?: string, database?: string): Promise<Store> {
    if (database && database !== process.env.SQL_DATABASE &&
      !["localhost", "127.0.0.1", "::1", "sql"].includes(process.env.SQL_SERVER ?? "127.0.0.1"))
      throw new Error("Alternate test databases are allowed only on local SQL Server.");
    const suffix = label?.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 32);
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
        throw new AggregateError(
          [error, cleanupError],
          `Test setup failed; schema ${schema} cleanup also failed.`,
        );
      }
      throw error;
    }
  }

  private assertOpen(): void {
    const context = this.context.getStore();
    if (this.closed || (this.closing && !context?.active))
      throw new Error("SQL store is closed or closing.");
    if (context && !context.active)
      throw new Error("The SQL transaction has already completed.");
  }

  private async request<Result>(
    callback: (request: Sql.Request) => Promise<Result>,
  ): Promise<Result> {
    this.assertOpen();
    const context = this.context.getStore();
    if (!context) return callback(new this.driver.Request(this.pool));
    const operation = context.tail.then(() => {
      if (!context.active || context.rolledBack)
        throw new Error("The SQL transaction is no longer active.");
      if (context.failed) throw context.failure;
      return callback(new this.driver.Request(context.transaction));
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

  private bind(
    request: Sql.Request,
    parameters: ReturnType<typeof bindSql>["parameters"],
  ): void {
    for (const { name, value } of parameters) {
      if (typeof value === "number" && !Number.isFinite(value))
        throw new Error("SQL numbers must be finite.");
      if (typeof value === "string" || value === null || value === undefined)
        request.input(
          name,
          this.driver.NVarChar(this.driver.MAX),
          value ?? null,
        );
      else if (Buffer.isBuffer(value))
        request.input(name, this.driver.VarBinary(this.driver.MAX), value);
      else if (value instanceof Date)
        request.input(name, this.driver.DateTime2(7), value);
      else if (typeof value === "number")
        request.input(
          name,
          Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
            ? this.driver.Int
            : this.driver.Float,
          value,
        );
      else request.input(name, value);
    }
  }

  async all<Result>(sql: string, ...params: SqlParameter[]): Promise<Result[]> {
    const prepared = bindSql(sql, params, this.schemaName);
    const execute = () =>
      this.request(async (request) => {
        this.bind(request, prepared.parameters);
        return (await request.query<Result>(prepared.sql)).recordset ?? [];
      });
    return prepared.writes ? this.transaction(execute) : execute();
  }

  async get<Result>(
    sql: string,
    ...params: SqlParameter[]
  ): Promise<Result | undefined> {
    return (await this.all<Result>(sql, ...params))[0];
  }

  async run(sql: string, ...params: SqlParameter[]): Promise<RunResult> {
    const prepared = bindSql(sql, params, this.schemaName);
    return this.transaction(async () =>
      this.request(async (request) => {
        this.bind(request, prepared.parameters);
        const result = await request.query<{
          __touchline_changes: number;
          __touchline_identity: number | null;
        }>(runSql(prepared.sql));
        const row = Object.values(result.recordsets).at(-1)?.[0];
        if (!row)
          throw new Error("SQL mutation did not return its result metadata.");
        return {
          changes: row.__touchline_changes,
          lastInsertRowid: row.__touchline_identity,
        };
      }),
    );
  }

  async exec(sql: string, ...params: SqlParameter[]): Promise<void> {
    const prepared = bindSql(sql, params, this.schemaName);
    await this.transaction(async () =>
      this.request(async (request) => {
        this.bind(request, prepared.parameters);
        if (prepared.parameters.length) await request.query(prepared.sql);
        else await request.batch(prepared.sql);
      }),
    );
  }

  async meta<Result>(key: string): Promise<Result> {
    const row = await this.get<{ value: string }>(
      "SELECT [value] FROM meta WHERE [key] = ?",
      key,
    );
    if (!row) throw new Error(`Missing game metadata: ${key}`);
    return JSON.parse(row.value) as Result;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const serialized = JSON.stringify(value);
    if (serialized === undefined)
      throw new Error("Game metadata must be JSON serializable.");
    await this.exec(
      `UPDATE meta SET [value] = ? WHERE [key] = ?;
      IF @@ROWCOUNT = 0 INSERT INTO meta ([key], [value]) VALUES (?, ?);`,
      serialized,
      key,
      key,
      serialized,
    );
  }

  async transaction<Result>(callback: () => Promise<Result>): Promise<Result> {
    this.assertOpen();
    const existing = this.context.getStore();
    if (existing) {
      if (existing.failed || existing.rolledBack)
        throw (
          existing.failure ?? new Error("The SQL transaction was rolled back.")
        );
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
    const operation = this.startTransaction(callback);
    this.activeTransactions.add(operation);
    try {
      return await operation;
    } finally {
      this.activeTransactions.delete(operation);
    }
  }

  private async startTransaction<Result>(
    callback: () => Promise<Result>,
  ): Promise<Result> {
    const transaction = new this.driver.Transaction(this.pool);
    const context: TransactionContext = {
      transaction,
      tail: Promise.resolve(),
      active: true,
      locked: false,
      rolledBack: false,
      failed: false,
    };
    transaction.on("rollback", () => {
      context.rolledBack = true;
    });
    await transaction.begin(this.driver.ISOLATION_LEVEL.READ_COMMITTED);
    return this.context.run(context, async () => {
      try {
        await this.request(async (request) => {
          request.input(
            "worldLock",
            this.driver.NVarChar(255),
            `touchline:world:${this.schemaName.toLowerCase()}`,
          );
          await request.query(`SET XACT_ABORT ON;
            DECLARE @lockResult INT;
            EXEC @lockResult = sys.sp_getapplock @Resource = @worldLock, @LockMode = N'Exclusive',
              @LockOwner = N'Transaction', @LockTimeout = 30000;
            IF @lockResult < 0 THROW 51000, N'Touchline world writer lock could not be acquired.', 1;`);
        });
        context.locked = true;
        const result = await callback();
        await context.tail;
        if (context.failed) throw context.failure;
        if (context.rolledBack)
          throw new Error("The SQL transaction was rolled back.");
        await transaction.commit();
        return result;
      } catch (error) {
        await context.tail;
        if (!context.rolledBack) {
          try {
            await transaction.rollback();
          } catch (rollbackError) {
            throw new AggregateError(
              [error, rollbackError],
              "SQL operation and rollback both failed.",
            );
          }
        }
        throw error;
      } finally {
        context.active = false;
        context.locked = false;
      }
    });
  }

  async schema(): Promise<void> {
    await this.transaction(async () => {
      await this.lockSchemaMaintenance();
      await this.exec(`IF SCHEMA_ID(${sqlLiteral(this.schemaName)}) IS NULL
        EXEC(${sqlLiteral(`CREATE SCHEMA ${quoteIdentifier(this.schemaName)};`)});`);
      await this.exec(migrationTableSql(this.schemaName));
      const applied = new Set(
        (
          await this.all<{ version: number }>(
            "SELECT [version] FROM schema_migrations",
          )
        ).map((row) => row.version),
      );
      const migrations = schemaMigrations(this.schemaName);
      if ([...applied].some((version) => version > migrations.at(-1)!.version))
        throw new Error(
          "This database was migrated by a newer version of Touchline.",
        );
      for (const migration of migrations) {
        if (applied.has(migration.version)) continue;
        for (const statement of migration.statements)
          await this.exec(statement);
        await this.run(
          "INSERT INTO schema_migrations ([version], [name]) VALUES (?, ?)",
          migration.version,
          migration.name,
        );
      }
      if (
        !(await this.get(
          "SELECT [key] FROM meta WHERE [key] = ?",
          "appearanceIndexVersion",
        ))
      ) {
        for (const statement of appearanceBackfill(this.schemaName))
          await this.exec(statement);
        await this.setMeta("appearanceIndexVersion", 1);
      }
      this.columnCache.clear();
    });
  }

  async worldTables(): Promise<string[]> {
    const rows = await this.all<{ name: string }>(
      `SELECT table_row.[name] FROM sys.tables AS table_row
      INNER JOIN sys.schemas AS schema_row ON schema_row.[schema_id] = table_row.[schema_id]
      WHERE schema_row.[name] = ?`,
      this.schemaName,
    );
    const existing = new Set(rows.map((row) => row.name));
    return WORLD_TABLES.filter((table) => existing.has(table));
  }

  private knownTable(table: string): string {
    const name = table.toLowerCase();
    if (!STORE_TABLES.has(name))
      throw new Error(`Unknown Touchline table: ${table}`);
    return name;
  }

  private async columnInfo(table: string): Promise<ColumnInfo[]> {
    table = this.knownTable(table);
    const cached = this.columnCache.get(table);
    if (cached) return cached;
    const columns = await this.all<ColumnInfo>(
      `SELECT column_row.[name], type_row.[name] AS [type],
      column_row.[max_length], column_row.[scale], column_row.[is_nullable], column_row.[is_identity], column_row.[is_computed]
      FROM sys.columns AS column_row
      INNER JOIN sys.types AS type_row ON type_row.[user_type_id] = column_row.[user_type_id]
      INNER JOIN sys.tables AS table_row ON table_row.[object_id] = column_row.[object_id]
      INNER JOIN sys.schemas AS schema_row ON schema_row.[schema_id] = table_row.[schema_id]
      WHERE schema_row.[name] = ? AND table_row.[name] = ? ORDER BY column_row.[column_id]`,
      this.schemaName,
      table,
    );
    if (!columns.length)
      throw new Error(
        `SQL table ${this.schemaName}.${table} does not exist; call schema() first.`,
      );
    this.columnCache.set(table, columns);
    return columns;
  }

  async columns(table: string): Promise<string[]> {
    return (await this.columnInfo(table))
      .filter((column) => !column.is_computed)
      .map((column) => column.name);
  }

  private bulkType(column: ColumnInfo): Sql.ISqlType | (() => Sql.ISqlType) {
    const length =
      column.max_length === -1 ? this.driver.MAX : column.max_length;
    switch (column.type) {
      case "int":
        return this.driver.Int;
      case "bigint":
        return this.driver.BigInt;
      case "float":
        return this.driver.Float;
      case "bit":
        return this.driver.Bit;
      case "nvarchar":
        return this.driver.NVarChar(
          length === this.driver.MAX ? length : length / 2,
        );
      case "varchar":
        return this.driver.VarChar(length);
      case "char":
        return this.driver.Char(length);
      case "varbinary":
        return this.driver.VarBinary(length);
      case "datetime2":
        return this.driver.DateTime2(column.scale);
      case "uniqueidentifier":
        return this.driver.UniqueIdentifier;
      default:
        throw new Error(
          `Unsupported bulk SQL type ${column.type} for ${column.name}.`,
        );
    }
  }

  async bulkInsert(table: string, rows: readonly object[]): Promise<void> {
    table = this.knownTable(table);
    if (!rows.length) return;
    await this.transaction(async () => {
      const metadata = await this.columnInfo(table);
      const known = new Set(metadata.map((column) => column.name));
      const keys = Object.keys(rows[0]);
      for (const key of keys)
        if (!known.has(key))
          throw new Error(`Unknown SQL column ${table}.${key}.`);
      const columns = metadata.filter(
        (column) => !column.is_computed && keys.includes(column.name),
      );
      if (!columns.length)
        throw new Error("Bulk insert requires at least one writable column.");
      const selected = new Set(columns.map((column) => column.name));
      for (const row of rows) {
        const rowKeys = Object.keys(row);
        if (
          rowKeys.some((key) => !known.has(key)) ||
          columns.some((column) => !Object.hasOwn(row, column.name)) ||
          rowKeys.some(
            (key) =>
              !selected.has(key) &&
              !metadata.find((column) => column.name === key)?.is_computed,
          )
        )
          throw new Error("All bulk rows must have the same writable columns.");
      }
      const target = tableName(this.schemaName, table);
      const identity = columns.some((column) => column.is_identity);
      await this.request(async (request) => {
        const bulk = new this.driver.Table(target);
        bulk.create = false;
        for (const column of columns)
          bulk.columns.add(column.name, this.bulkType(column), {
            nullable: column.is_nullable,
          });
        if (identity) await request.batch("SET XACT_ABORT OFF;");
        let bulkFailure: unknown;
        try {
          for (let offset = 0; offset < rows.length; offset += 1000) {
            bulk.rows.clear();
            for (const row of rows.slice(offset, offset + 1000))
              bulk.rows.add(
                ...columns.map((column) => {
                  const value =
                    (row as Record<string, SqlParameter>)[column.name] ?? null;
                  return typeof value === "bigint" ? value.toString() : value;
                }),
              );
            const options = {
              keepNulls: true,
              checkConstraints: true,
              fireTriggers: true,
              lockTable: true,
            };
            await request.bulk(bulk, options);
          }
        } catch (error) {
          bulkFailure = error;
          throw error;
        } finally {
          if (identity) {
            try {
              await request.batch(`SET IDENTITY_INSERT ${target} OFF; SET XACT_ABORT ON;`);
            } catch (cleanupError) {
              if (bulkFailure)
                throw new AggregateError([bulkFailure, cleanupError], `SQL bulk insert and session cleanup failed for ${table}.`);
              throw cleanupError;
            }
          }
        }
        if (identity)
          await request.batch(
            `EXEC ${tableName(this.schemaName, "reseed_world_identity")} @table = ${sqlLiteral(table)};`,
          );
      });
    });
  }

  async clearWorld(): Promise<void> {
    this.assertOpen();
    const context = this.context.getStore();
    if (!context?.active || !context.locked)
      throw new Error(
        "clearWorld() requires an active Store.transaction() writer lock.",
      );
    for (const table of (await this.worldTables()).reverse()) {
      const target = tableName(this.schemaName, table);
      await this.exec(`DELETE FROM ${target};`);
      if (IDENTITY_TABLES.has(table))
        await this.exec(
          `EXEC ${tableName(this.schemaName, "reseed_world_identity")} @table = ?;`,
          table,
        );
    }
  }

  private async dropTestSchema(): Promise<void> {
    if (
      !this.ownsTestSchema ||
      !this.testMode ||
      !/^touchline_test_[a-f0-9]{32}(?:_|$)/.test(this.schemaName)
    )
      throw new Error(
        "Refusing to drop a schema not owned by this test store.",
      );
    await this.lockSchemaMaintenance();
    const foreignKeys = await this.all<{ table_name: string; name: string }>(
      `SELECT table_row.[name] AS [table_name], foreign_key.[name]
      FROM sys.foreign_keys AS foreign_key
      INNER JOIN sys.tables AS table_row ON table_row.[object_id] = foreign_key.[parent_object_id]
      INNER JOIN sys.schemas AS schema_row ON schema_row.[schema_id] = table_row.[schema_id]
      WHERE schema_row.[name] = ?`,
      this.schemaName,
    );
    for (const foreignKey of foreignKeys)
      await this.exec(
        `ALTER TABLE ${tableName(this.schemaName, foreignKey.table_name)} DROP CONSTRAINT ${quoteIdentifier(foreignKey.name)};`,
      );
    const tables = await this.all<{ name: string }>(
      `SELECT table_row.[name] FROM sys.tables AS table_row
      INNER JOIN sys.schemas AS schema_row ON schema_row.[schema_id] = table_row.[schema_id]
      WHERE schema_row.[name] = ?`,
      this.schemaName,
    );
    for (const table of tables)
      await this.exec(`DROP TABLE ${tableName(this.schemaName, table.name)};`);
    await this.exec(
      `DROP PROCEDURE IF EXISTS ${tableName(this.schemaName, "reseed_world_identity")};`,
    );
    await this.exec(`DROP SCHEMA ${quoteIdentifier(this.schemaName)};`);
    this.ownsTestSchema = false;
  }

  private async lockSchemaMaintenance(): Promise<void> {
    await this.request(async (request) => {
      await request.query(`DECLARE @maintenanceLock int;
        EXEC @maintenanceLock = sys.sp_getapplock @Resource = N'touchline:schema-maintenance',
          @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 120000;
        IF @maintenanceLock < 0 THROW 51000, N'SQL schema maintenance lock could not be acquired.', 1;`);
    });
  }

  async close(): Promise<void> {
    if (this.context.getStore()?.active)
      throw new Error("Cannot close a SQL store inside its transaction.");
    if (this.closing) return this.closing;
    if (this.closed) return;
    this.closing = (async () => {
      await Promise.allSettled([...this.activeTransactions]);
      try {
        if (this.ownsTestSchema)
          await this.startTransaction(async () => this.dropTestSchema());
      } finally {
        try {
          await this.pool.close();
        } finally {
          this.closed = true;
        }
      }
    })();
    return this.closing;
  }
}
