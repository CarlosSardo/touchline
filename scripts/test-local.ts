import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import pg from "pg";

const PORT = "54329";
const DATABASE = "touchline_checks";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
const USAGE = `Usage: tsx scripts/test-local.ts [--no-docker] [--] [COMMAND [ARGS...]]
Runs COMMAND (default: npm test) against isolated touchline_test_/touchline_e2e_ schemas in the ${DATABASE} database.
Default: starts a disposable PostgreSQL 18 container (docker compose project touchline-checks, deploy/compose.test.yaml)
on 127.0.0.1:${PORT}; its generated password stays in the ignored .env.test.local.
--no-docker: uses an already-running loopback PostgreSQL from SQL_HOST, SQL_PORT, SQL_USER and SQL_PASSWORD
(SQL_SSL optional) and creates ${DATABASE} there if it is missing.`;

interface Target {
  host: string;
  port: string;
  user: string;
  password: string;
  ssl: string;
  disposable: boolean;
}

async function dockerTarget(): Promise<Target> {
  let local: Record<string, string | undefined>;
  try {
    local = parseEnv(await readFile(".env.test.local", "utf8"));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    local = { SQL_PASSWORD: randomBytes(30).toString("base64url"), SQL_PORT: PORT };
    await writeFile(".env.test.local", Object.entries(local).map(([key, value]) => `${key}=${value}\n`).join(""), { mode: 0o600, flag: "wx" });
  }
  await chmod(".env.test.local", 0o600);
  if (!local.SQL_PASSWORD || local.SQL_PORT !== PORT)
    throw new Error(`Local test credentials require SQL_PASSWORD and SQL_PORT=${PORT} in .env.test.local (delete the file to regenerate it).`);
  console.log(`[Local SQL] Starting disposable PostgreSQL 18 on 127.0.0.1:${PORT}.`);
  // An empty Docker config keeps credential helpers and registry logins out of the test run.
  const dockerConfig = await mkdtemp(join(tmpdir(), "touchline-docker-"));
  try {
    await writeFile(join(dockerConfig, "config.json"), "{}", { mode: 0o600 });
    const compose = spawnSync(
      "docker",
      ["compose", "--env-file", ".env.test.local", "--file", "deploy/compose.test.yaml", "up", "--wait", "--wait-timeout", "180", "--detach", "postgres"],
      { env: { ...process.env, DOCKER_CONFIG: dockerConfig }, stdio: "inherit" },
    );
    if (compose.error || compose.status !== 0)
      throw new Error("Local PostgreSQL container did not become healthy. Check Docker access, or use --no-docker with SQL_HOST/SQL_PORT/SQL_USER/SQL_PASSWORD.");
  } finally {
    await rm(dockerConfig, { recursive: true, force: true });
  }
  return { host: "127.0.0.1", port: PORT, user: "postgres", password: local.SQL_PASSWORD, ssl: "disable", disposable: true };
}

function existingTarget(): Target {
  const { SQL_HOST: host, SQL_PORT: port = "5432", SQL_USER: user, SQL_PASSWORD: password, SQL_SSL: ssl = "disable" } = process.env;
  if (!host || !user || !password)
    throw new Error("--no-docker requires SQL_HOST, SQL_USER and SQL_PASSWORD (and SQL_PORT unless 5432) in the environment.");
  if (!LOOPBACK.has(host))
    throw new Error("--no-docker only accepts a loopback PostgreSQL (127.0.0.1, localhost or ::1); tests never target remote databases.");
  console.log(`[Local SQL] Using the running PostgreSQL on ${host}:${port}; no container is started.`);
  return { host, port, user, password, ssl, disposable: false };
}

async function ensureDatabase(target: Target) {
  const client = new pg.Client({
    host: target.host,
    port: Number(target.port),
    user: target.user,
    password: target.password,
    database: "postgres",
    ssl: target.ssl === "disable" ? false : { rejectUnauthorized: target.ssl === "verify-full" },
    application_name: "Touchline test-local",
  });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [DATABASE]);
    if (!rowCount)
      await client.query(`CREATE DATABASE ${DATABASE} LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8' ENCODING 'UTF8' TEMPLATE template0`);
  } finally {
    await client.end();
  }
}

async function run() {
  const args = process.argv.slice(2);
  let docker = true;
  while (args[0]?.startsWith("--")) {
    const option = args.shift()!;
    if (option === "--") break;
    if (option === "--help") {
      console.log(USAGE);
      return;
    }
    if (option === "--no-docker") docker = false;
    else {
      args.unshift(option);
      break;
    }
  }
  const target = docker ? await dockerTarget() : existingTarget();
  await ensureDatabase(target);
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    SQL_HOST: target.host,
    SQL_PORT: target.port,
    SQL_DATABASE: DATABASE,
    SQL_USER: target.user,
    SQL_PASSWORD: target.password,
    SQL_SSL: target.ssl,
    SQL_ALLOW_REMOTE_TESTS: "false",
    SQL_TEST_DATABASE: "",
    SQL_INTEGRATION_TESTS: "true",
    SQL_SAVE_TESTS: "true",
    SQL_TEST_MODE: "true",
    SQL_SCHEMA: `touchline_test_local_${process.pid}`,
    TOUCHLINE_TEST_LOCAL: "true",
    // Only a throwaway server may host tests that create cluster-wide objects such as roles or databases.
    TOUCHLINE_DISPOSABLE_SQL: target.disposable ? "true" : "false",
  };
  // Tests run without hosted sign-in: a developer's sourced .env must not configure OIDC, access or removed settings.
  for (const key of [
    "SQL_SERVER", "SQL_ENCRYPT", "SQL_TRUST_SERVER_CERTIFICATE", "AZURE_SQL_SERVER", "AZURE_CLIENT_ID", "AZURE_TENANT_ID",
    "GAME_DB", "SAVE_DIR", "REQUIRE_AUTH", "APP_ORIGIN", "TRUST_PROXY",
    "OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_LOGOUT_URL", "SESSION_SECRET", "SESSION_TTL_HOURS",
    "ADMIN_GROUP", "MAX_PLAYERS", "DB_SIZE_LIMIT_GB",
    // Removed settings that make startup fail when an old .env still sets them.
    "OWNER_OBJECT_ID", "ALLOWED_USER_OBJECT_IDS", "AUTH_HOME_TENANT_ID",
  ])
    delete environment[key];
  const command = args.length ? args : ["npm", "test"];
  console.log(`[Local SQL] Running ${command.join(" ")} using isolated schemas in ${DATABASE}.`);
  const child = spawn(command[0], command.slice(1), { env: environment, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => child.kill(signal));
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      process.exitCode = code ?? 1;
      resolve();
    });
  });
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Local SQL verification failed.");
  process.exitCode = 1;
});
