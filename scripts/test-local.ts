import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import sql from "mssql";

async function run() {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  if (args[0] === "--help") {
    console.log("Usage: tsx scripts/test-local.ts [COMMAND [ARGS...]]\nStarts a local SQL Server Developer container on 127.0.0.1:14330, creates only touchline_checks, then runs the command (default: npm test). Generated credentials stay in ignored .env.test.local; Azure is never contacted.");
    return;
  }
  let local: Record<string, string>;
  try {
    local = parseEnv(await readFile(".env.test.local", "utf8"));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    local = { SQL_PASSWORD: `Tl!${randomBytes(30).toString("base64url")}9a`, SQL_PORT: "14330" };
    await writeFile(".env.test.local", Object.entries(local).map(([key, value]) => `${key}=${value}\n`).join(""), { mode: 0o600, flag: "wx" });
  }
  await chmod(".env.test.local", 0o600);
  if (!local.SQL_PASSWORD || local.SQL_PORT !== "14330")
    throw new Error("Local test credentials require SQL_PASSWORD and SQL_PORT=14330 in .env.test.local.");
  const environment = {
    ...process.env,
    SQL_SERVER: "127.0.0.1",
    SQL_PORT: "14330",
    SQL_DATABASE: "touchline_checks",
    SQL_USER: "sa",
    SQL_PASSWORD: local.SQL_PASSWORD,
    SQL_ENCRYPT: "true",
    SQL_TRUST_SERVER_CERTIFICATE: "true",
    SQL_ALLOW_REMOTE_TESTS: "false",
    SQL_TEST_DATABASE: "",
    SQL_INTEGRATION_TESTS: "true",
    SQL_SAVE_TESTS: "true",
    SQL_TEST_MODE: "true",
    SQL_SCHEMA: `touchline_test_local_${process.pid}`,
  };
  for (const key of ["AZURE_CLIENT_ID", "GAME_DB", "SAVE_DIR", "CONTAINER_APP_NAME", "REQUIRE_AUTH", "APP_ORIGIN"])
    delete (environment as NodeJS.ProcessEnv)[key];
  console.log("[Local SQL] Starting SQL Server Developer on 127.0.0.1:14330; Azure is not used.");
  const dockerConfig = await mkdtemp(join(tmpdir(), "touchline-docker-"));
  try {
    await writeFile(join(dockerConfig, "config.json"), "{}", { mode: 0o600 });
    const compose = spawnSync("docker", ["compose", "--env-file", ".env.test.local", "--project-name", "touchline-checks", "up", "--wait", "--wait-timeout", "180", "--detach", "sql"], { env: { ...environment, DOCKER_CONFIG: dockerConfig }, stdio: "inherit" });
    if (compose.error || compose.status !== 0) throw new Error("Local SQL container did not become healthy. Check Docker access.");
  } finally {
    await rm(dockerConfig, { recursive: true, force: true });
  }
  const pool = await new sql.ConnectionPool({
    server: environment.SQL_SERVER,
    port: Number(environment.SQL_PORT),
    database: "master",
    user: environment.SQL_USER,
    password: environment.SQL_PASSWORD,
    options: { encrypt: true, trustServerCertificate: true },
  }).connect();
  try {
    await pool.request().query("IF DB_ID(N'touchline_checks') IS NULL CREATE DATABASE [touchline_checks];");
    if (args.includes("--validate-local"))
      await pool.request().query("IF DB_ID(N'touchline_checks_migration_peer') IS NULL CREATE DATABASE [touchline_checks_migration_peer];");
  } finally {
    await pool.close();
  }
  const command = args.length ? args : ["npm", "test"];
  console.log(`[Local SQL] Running ${command.join(" ")} using isolated schemas in touchline_checks.`);
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