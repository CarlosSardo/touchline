export interface SqlSettings {
  server: string;
  port: number;
  database: string;
  user?: string;
  password?: string;
  managedIdentityClientId?: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
  testMode: boolean;
  schema: string;
  requestTimeout: number;
}

export function readSqlSettings(
  environment: NodeJS.ProcessEnv = process.env,
): SqlSettings {
  const server = environment.SQL_SERVER ?? "127.0.0.1";
  const database = environment.SQL_DATABASE ?? "touchline";
  const port = Number(environment.SQL_PORT ?? 1433);
  const local = ["localhost", "127.0.0.1", "::1", "sql"].includes(server);
  const encrypt = environment.SQL_ENCRYPT !== "false";
  const trustServerCertificate =
    environment.SQL_TRUST_SERVER_CERTIFICATE === "true";
  const testMode = environment.SQL_TEST_MODE === "true";
  const schema = environment.SQL_SCHEMA ?? "dbo";
  const requestTimeout = Number(environment.SQL_REQUEST_TIMEOUT_MS ?? 120000);
  if (!Number.isInteger(requestTimeout) || requestTimeout < 1000 || requestTimeout > 900000)
    throw new Error("SQL_REQUEST_TIMEOUT_MS must be between 1000 and 900000.");
  if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(database))
    throw new Error("SQL_DATABASE must be a SQL database name, not a file path.");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("SQL_PORT must be between 1 and 65535.");
  if (!local && (!encrypt || trustServerCertificate))
    throw new Error("Remote SQL connections require verified TLS.");
  if (Boolean(environment.SQL_USER) !== Boolean(environment.SQL_PASSWORD))
    throw new Error("Set both SQL_USER and SQL_PASSWORD, or use Azure identity.");
  if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(schema))
    throw new Error("SQL_SCHEMA must be a SQL schema name.");
  if (testMode && !/^touchline_(?:test|e2e)_/.test(schema))
    throw new Error("Tests require an isolated touchline_test_ or touchline_e2e_ schema.");
  if (
    testMode &&
    !local &&
    (environment.SQL_ALLOW_REMOTE_TESTS !== "true" ||
      environment.SQL_TEST_DATABASE !== database)
  )
    throw new Error("Remote tests require explicit SQL_ALLOW_REMOTE_TESTS and SQL_TEST_DATABASE confirmation.");
  if (environment.GAME_DB || environment.SAVE_DIR)
    throw new Error("SQLite configuration is no longer supported. Configure SQL_SERVER and SQL_DATABASE.");
  return {
    server,
    port,
    database,
    user: environment.SQL_USER,
    password: environment.SQL_PASSWORD,
    managedIdentityClientId: environment.AZURE_CLIENT_ID,
    encrypt,
    trustServerCertificate,
    testMode,
    schema,
    requestTimeout,
  };
}

export function describeSqlError(
  error: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const secrets = Object.entries(environment)
    .filter(([name, value]) => /PASSWORD|TOKEN|SECRET|IDENTITY_HEADER/i.test(name) && value)
    .map(([, value]) => value!)
    .sort((first, second) => second.length - first.length);
  const messages: string[] = [];
  const visited = new Set<unknown>();
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== "object" || depth > 4 || visited.has(value)) return;
    visited.add(value);
    const detail = value as Record<string, unknown>;
    const message = [detail.name, detail.code, detail.number, detail.message]
      .filter((part) => typeof part === "string" || typeof part === "number")
      .join(": ");
    if (message)
      messages.push(secrets.reduce((text, secret) => text.replaceAll(secret, "[redacted]"), message)
        .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, "[redacted]").slice(0, 2048));
    visit(detail.cause, depth + 1);
    visit(detail.originalError, depth + 1);
    for (const nested of [detail.errors, detail.precedingErrors])
      if (Array.isArray(nested))
        for (const cause of nested.slice(0, 8)) visit(cause, depth + 1);
  };
  visit(error, 0);
  return messages.length ? messages : ["Unknown SQL startup error."];
}