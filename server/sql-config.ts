export type SqlSslMode = "disable" | "require" | "verify-full";

export interface SqlSettings {
  host: string;
  port: number;
  database: string;
  user?: string;
  password?: string;
  ssl: SqlSslMode;
  testMode: boolean;
  schema: string;
  requestTimeout: number;
  poolSize: number;
  applicationName: string;
}

/** PostgreSQL truncates identifiers beyond 63 bytes; schema names never get that far. */
export const MAX_IDENTIFIER_LENGTH = 63;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Loopback, or a single-label name on a private container network (for example the compose service "postgres"). */
export function isLocalSqlHost(host: string): boolean {
  return LOCAL_HOSTS.has(host) || /^[a-z][a-z0-9-]{0,62}$/i.test(host);
}

export function validateSqlSchema(schema: string, testMode = false): string {
  if (typeof schema !== "string" || !IDENTIFIER.test(schema))
    throw new Error("SQL_SCHEMA must be a SQL schema name of at most 63 characters.");
  if (/^pg_/i.test(schema) || /^information_schema$/i.test(schema))
    throw new Error("SQL_SCHEMA must not be a PostgreSQL system schema.");
  if (testMode && !/^touchline_(?:test|e2e)_/.test(schema))
    throw new Error("Tests require an isolated touchline_test_ or touchline_e2e_ schema.");
  return schema;
}

export function readSqlSettings(
  environment: NodeJS.ProcessEnv = process.env,
): SqlSettings {
  for (const legacy of ["SQL_SERVER", "SQL_ENCRYPT", "SQL_TRUST_SERVER_CERTIFICATE", "AZURE_SQL_SERVER"])
    if (environment[legacy])
      throw new Error(`${legacy} belongs to the retired Azure SQL setup. Configure SQL_HOST, SQL_PORT and SQL_SSL for PostgreSQL.`);
  if (environment.GAME_DB || environment.SAVE_DIR)
    throw new Error("SQLite configuration is no longer supported. Configure SQL_HOST and SQL_DATABASE.");
  const host = environment.SQL_HOST ?? "127.0.0.1";
  const database = environment.SQL_DATABASE ?? "touchline";
  const port = Number(environment.SQL_PORT ?? 5432);
  const local = isLocalSqlHost(host);
  const ssl = (environment.SQL_SSL ?? (local ? "disable" : "verify-full")) as SqlSslMode;
  const testMode = environment.SQL_TEST_MODE === "true";
  const schema = environment.SQL_SCHEMA ?? "public";
  const requestTimeout = Number(environment.SQL_REQUEST_TIMEOUT_MS ?? 120000);
  const poolSize = Number(environment.SQL_POOL_SIZE ?? 10);
  if (!Number.isInteger(requestTimeout) || requestTimeout < 1000 || requestTimeout > 900000)
    throw new Error("SQL_REQUEST_TIMEOUT_MS must be between 1000 and 900000.");
  if (!Number.isInteger(poolSize) || poolSize < 2 || poolSize > 100)
    throw new Error("SQL_POOL_SIZE must be between 2 and 100.");
  if (!IDENTIFIER.test(database))
    throw new Error("SQL_DATABASE must be a SQL database name, not a file path.");
  if (!host || host.trim() !== host || host.length > 253)
    throw new Error("SQL_HOST must be a hostname or IP address.");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("SQL_PORT must be between 1 and 65535.");
  if (!["disable", "require", "verify-full"].includes(ssl))
    throw new Error("SQL_SSL must be disable, require or verify-full.");
  if (!local && ssl !== "verify-full")
    throw new Error("Remote SQL connections require verified TLS (SQL_SSL=verify-full).");
  if (Boolean(environment.SQL_USER) !== Boolean(environment.SQL_PASSWORD))
    throw new Error("Set both SQL_USER and SQL_PASSWORD.");
  validateSqlSchema(schema, testMode);
  if (
    testMode &&
    !LOCAL_HOSTS.has(host) &&
    (environment.SQL_ALLOW_REMOTE_TESTS !== "true" ||
      environment.SQL_TEST_DATABASE !== database)
  )
    throw new Error("Remote tests require explicit SQL_ALLOW_REMOTE_TESTS and SQL_TEST_DATABASE confirmation.");
  return {
    host,
    port,
    database,
    user: environment.SQL_USER || undefined,
    password: environment.SQL_PASSWORD || undefined,
    ssl,
    testMode,
    schema,
    requestTimeout,
    poolSize,
    applicationName: "Touchline",
  };
}

export function describeSqlError(
  error: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const secrets = Object.entries(environment)
    .filter(([name, value]) => /PASSWORD|TOKEN|SECRET/i.test(name) && value)
    .map(([, value]) => value!)
    .sort((first, second) => second.length - first.length);
  const messages: string[] = [];
  const visited = new Set<unknown>();
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== "object" || depth > 4 || visited.has(value)) return;
    visited.add(value);
    const detail = value as Record<string, unknown>;
    const message = [detail.name, detail.code, detail.message, detail.detail]
      .filter((part) => typeof part === "string" || typeof part === "number")
      .join(": ");
    if (message)
      messages.push(secrets.reduce((text, secret) => text.replaceAll(secret, "[redacted]"), message)
        .replace(/postgres(?:ql)?:\/\/[^\s@]*@/gi, "postgresql://[redacted]@").slice(0, 2048));
    visit(detail.cause, depth + 1);
    if (Array.isArray(detail.errors))
      for (const cause of detail.errors.slice(0, 8)) visit(cause, depth + 1);
  };
  visit(error, 0);
  return messages.length ? messages : ["Unknown SQL startup error."];
}
