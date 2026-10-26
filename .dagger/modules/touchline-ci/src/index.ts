/**
 * Touchline CI: the lint, build, test, world-simulation and image pipelines. scripts/ci.sh runs these
 * functions the same way on a laptop and in GitHub Actions; `dagger check` runs the suites as checks.
 */
import { randomBytes } from "node:crypto"

import {
  check,
  Container,
  dag,
  Directory,
  func,
  object,
  Platform,
  ReturnType,
  Secret,
  Service,
  Workspace,
} from "@dagger.io/dagger"

const SUITES = ["static", "backend", "world", "e2e"] as const
type Suite = (typeof SUITES)[number]

const APP = "/app"
const LOGS = "/ci-logs"
const STATUS = `${LOGS}/status`
const TOOLS = "/opt/touchline-ci"
const SQL_PORT = "54329"
const SQL_DATABASE = "touchline_checks"

// Same flags as deploy/compose.test.yaml (shared_buffers raised to 1GB): test data only,
// durability is traded for speed.
const POSTGRES_FLAGS = [
  "max_connections=100",
  "shared_buffers=1GB",
  "work_mem=16MB",
  "maintenance_work_mem=256MB",
  "jit=off",
  "fsync=off",
  "synchronous_commit=off",
  "full_page_writes=off",
  "max_wal_size=4GB",
  "timezone=UTC",
].flatMap((flag) => ["-c", flag])

// The SQL guards only accept a loopback SQL_HOST, so each test container forwards 127.0.0.1:54329 to the
// PostgreSQL service instead of pointing tests at a remote host name. Nagle's algorithm is off on both sides:
// with it, a large statement split across writes waits for PostgreSQL's delayed ACK on every query.
const SQL_FORWARDER = `import net from "node:net";
const [host, port] = process.env.SQL_FORWARD_TARGET.split(":");
net.createServer({ noDelay: true }, (client) => {
  const upstream = net.connect({ port: Number(port), host, noDelay: true });
  const close = () => { client.destroy(); upstream.destroy(); };
  for (const socket of [client, upstream]) { socket.on("error", close); socket.on("close", close); }
  client.pipe(upstream).pipe(client);
}).listen(Number(process.env.SQL_PORT), "127.0.0.1");
`

// ci-step NAME COMMAND...: runs COMMAND, tees its output to /ci-logs/NAME.log and records its exit code in
// /ci-logs/status/NAME, so later steps still run and the logs are exported even when a step fails.
const CI_STEP = `#!/usr/bin/env bash
set -uo pipefail
name=$1; shift
mkdir -p ${STATUS}
if [[ -n "\${SQL_FORWARD_TARGET:-}" ]]; then
  node ${TOOLS}/sql-forwarder.mjs &
  for _ in $(seq 100); do (exec 3<>/dev/tcp/127.0.0.1/${SQL_PORT}) 2>/dev/null && break; sleep 0.1; done
fi
echo "[ci] \${name}: $*"
"$@" 2>&1 | tee "${LOGS}/\${name}.log"
code=\${PIPESTATUS[0]}
echo "\${code}" > "${STATUS}/\${name}"
echo "[ci] \${name}: $([[ \${code} == 0 ]] && echo PASS || echo "FAIL (exit \${code})")"
exit 0
`

const PURE_TESTS = `set -euo pipefail
# Files that never open a SQL store; the backend suite runs the complete suite, these included.
mapfile -t files < <(find server shared src -type f \\( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' -o -name '*.spec.tsx' \\) | sort |
  xargs --no-run-if-empty grep -L -E '\\bStore\\b|createApp\\(' || true)
if (( \${#files[@]} == 0 )); then echo "No SQL-free test files found."; exit 0; fi
printf 'Pure test files:\\n'; printf '  %s\\n' "\${files[@]}"
npx vitest run "\${files[@]}"
`

@object()
export class TouchlineCi {
  /** The checked-out project: tracked and untracked files, minus .gitignore'd files and CI/agent metadata. */
  @func()
  source: Directory

  constructor(ws: Workspace) {
    this.source = ws.directory("/", {
      gitignore: true,
      exclude: [
        "**/.git",
        "**/node_modules",
        "**/.env",
        "**/.env.*",
        ".dagger",
        "dagger.toml",
        "dagger.lock",
        ".github",
        ".squad",
        ".copilot",
        "ci-logs",
      ],
    })
  }

  /** Node.js image pinned by .nvmrc, the Debian release of the Dockerfile's runtime image. */
  @func()
  async nodeImage(): Promise<string> {
    const version = (await this.source.file(".nvmrc").contents()).trim()
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`.nvmrc must hold an exact Node.js version, not "${version}"`)
    return `node:${version}-trixie-slim`
  }

  /** Node.js with `npm ci` done; only package.json and package-lock.json key this layer. */
  @func()
  async deps(): Promise<Container> {
    return dag
      .container()
      .from(await this.nodeImage())
      .withEnvVariable("CI", "true")
      // Matches the dev workstation's default V8 heap limit; an 8 GB runner would default to about 2 GiB.
      .withEnvVariable("NODE_OPTIONS", "--max-old-space-size=4096")
      .withEnvVariable("PLAYWRIGHT_HTML_OPEN", "never")
      .withEnvVariable("TZ", "UTC")
      .withMountedCache("/root/.npm", dag.cacheVolume("touchline-npm"))
      .withWorkdir(APP)
      .withFile(`${APP}/package.json`, this.source.file("package.json"))
      .withFile(`${APP}/package-lock.json`, this.source.file("package-lock.json"))
      .withExec(["npm", "ci", "--no-audit", "--no-fund"])
  }

  /** The project on top of its installed dependencies, with the CI step runner. */
  @func()
  async workspace(withBrowsers = false): Promise<Container> {
    let container = await this.deps()
    if (withBrowsers) container = container.withExec(["npx", "playwright", "install", "--with-deps", "chromium"])
    return container
      .withDirectory(APP, this.source)
      .withNewFile(`${TOOLS}/sql-forwarder.mjs`, SQL_FORWARDER)
      .withNewFile("/usr/local/bin/ci-step", CI_STEP, { permissions: 0o755 })
      .withExec(["mkdir", "-p", STATUS])
  }

  /** A throwaway PostgreSQL 18 with the test database touchline_checks. */
  @func()
  postgres(password: Secret): Service {
    return dag
      .container()
      .from("postgres:18")
      .withEnvVariable("POSTGRES_DB", SQL_DATABASE)
      .withEnvVariable("POSTGRES_INITDB_ARGS", "--locale-provider=builtin --builtin-locale=C.UTF-8 --encoding=UTF8")
      .withSecretVariable("POSTGRES_PASSWORD", password)
      .withMountedTemp("/dev/shm", { size: 1024 ** 3 })
      .withExposedPort(5432)
      .asService({ useEntrypoint: true, args: ["postgres", ...POSTGRES_FLAGS] })
  }

  /** The SQL_* environment scripts/test-local.ts gives its command, against a fresh PostgreSQL service. */
  private withSql(container: Container, schema: string): Container {
    const password = dag.setSecret(`touchline-ci-sql-password-${randomBytes(8).toString("hex")}`, randomBytes(30).toString("base64url"))
    const environment: Record<string, string> = {
      SQL_FORWARD_TARGET: "postgres:5432",
      SQL_HOST: "127.0.0.1",
      SQL_PORT,
      SQL_DATABASE,
      SQL_USER: "postgres",
      SQL_SSL: "disable",
      SQL_ALLOW_REMOTE_TESTS: "false",
      SQL_TEST_DATABASE: "",
      SQL_INTEGRATION_TESTS: "true",
      SQL_SAVE_TESTS: "true",
      SQL_TEST_MODE: "true",
      SQL_SCHEMA: schema,
      TOUCHLINE_TEST_LOCAL: "true",
      TOUCHLINE_DISPOSABLE_SQL: "true",
    }
    return Object.entries(environment)
      .reduce((current, [name, value]) => current.withEnvVariable(name, value), container)
      .withServiceBinding("postgres", this.postgres(password))
      .withSecretVariable("SQL_PASSWORD", password)
  }

  private step(container: Container, name: string, command: string[]): Container {
    return container.withExec(["ci-step", name, ...command], { expect: ReturnType.Any })
  }

  /** Redacts the throwaway SQL password from the logs before they leave the container. */
  private redacted(container: Container): Directory {
    return container
      .withExec([
        "bash",
        "-c",
        `if [[ -n "\${SQL_PASSWORD:-}" ]]; then find ${LOGS} -type f -exec sed -i "s/\${SQL_PASSWORD}/[redacted]/g" {} +; fi`,
      ])
      .directory(LOGS)
  }

  /** Lint, production build and the SQL-free unit tests. */
  @func()
  async staticReport(): Promise<Directory> {
    let container = await this.workspace()
    container = this.step(container, "lint", ["npm", "run", "lint"])
    container = this.step(container, "build", ["npm", "run", "build"])
    container = this.step(container, "pure-tests", ["bash", "-c", PURE_TESTS])
    return this.redacted(container)
  }

  /** The complete Vitest suite (npm test) with SQL integration and save tests. */
  @func()
  async backendReport(): Promise<Directory> {
    let container = this.withSql(await this.workspace(), "touchline_test_ci_dagger")
    container = this.step(container, "backend-tests", ["npm", "test"])
    return this.redacted(container)
  }

  /**
   * World catalog, world check, multi-season simulation, database footprint and the backup / world reset smoke.
   * @param seasons Seasons for npm run simulation:check (1-20)
   * @param fullWorld Also run the season soak on the full world after the default subset (much slower)
   */
  @func()
  async worldReport(seasons = 3, fullWorld = false): Promise<Directory> {
    if (!Number.isInteger(seasons) || seasons < 1 || seasons > 20) throw new Error("seasons must be a whole number from 1 to 20.")
    let container = this.withSql(await this.workspace(), "touchline_test_ci_dagger")
    container = this.step(container, "catalog-test", ["npx", "vitest", "run", "shared/world-catalog"])
    container = this.step(container, "world-check", ["timeout", "150m", "npm", "run", "world:check"])
    container = this.step(container, "simulation-check", [
      "npm", "run", "simulation:check", "--", `--seasons=${seasons}`, "--nations=PT,IE,NIR,SCO,FO",
    ])
    if (fullWorld) {
      container = this.step(container, "simulation-full-world", [
        "npm", "run", "simulation:check", "--", `--seasons=${seasons}`, "--full-world",
      ])
    }
    container = this.step(container, "footprint", ["npm", "run", "--silent", "db:footprint", "--", "--all"])
    container = this.step(container, "backup-reset-smoke", ["bash", "scripts/ci/backup-reset-smoke.sh", LOGS])
    return this.redacted(container)
  }

  /** The Playwright browser suite against a fresh E2E schema; the HTML report and traces are kept. */
  @func()
  async browserReport(): Promise<Directory> {
    const schema = `touchline_e2e_${randomBytes(16).toString("hex")}`
    let container = this.withSql(await this.workspace(true), schema).withEnvVariable("TOUCHLINE_E2E_SCHEMA", schema)
    container = this.step(container, "e2e", ["npm", "run", "test:e2e", "--", "--reporter=list,html"])
    container = container.withExec([
      "bash", "-c", `for d in playwright-report test-results; do if [[ -d $d ]]; then cp -r $d ${LOGS}/; fi; done`,
    ])
    return this.redacted(container)
  }

  /**
   * Logs, reports and per-step exit codes (status/<step>) of one suite. Never fails because a step failed.
   * @param suite static, backend, world or e2e
   * @param seasons Seasons for the world suite's simulation check (1-20)
   * @param fullWorld Also run the world suite's season soak on the full world
   */
  @func()
  async report(suite: string, seasons = 3, fullWorld = false): Promise<Directory> {
    switch (suite as Suite) {
      case "static":
        return this.staticReport()
      case "backend":
        return this.backendReport()
      case "world":
        return this.worldReport(seasons, fullWorld)
      case "e2e":
        return this.browserReport()
      default:
        throw new Error(`Unknown suite "${suite}". Use one of: ${SUITES.join(", ")}.`)
    }
  }

  private async assertPassed(suite: Suite, report: Directory): Promise<void> {
    const steps = await report.directory("status").entries()
    const failed: string[] = []
    for (const step of steps) {
      const code = (await report.file(`status/${step}`).contents()).trim()
      if (code !== "0") failed.push(`${step} (exit ${code})`)
    }
    if (steps.length === 0) throw new Error(`${suite}: no steps ran`)
    if (failed.length > 0) throw new Error(`${suite} failed: ${failed.join(", ")}`)
  }

  /** Lint, build and SQL-free unit tests. */
  @func()
  @check()
  async staticChecks(): Promise<void> {
    await this.assertPassed("static", await this.staticReport())
  }

  /** SQL-backed backend tests (npm test). */
  @func()
  @check()
  async backendTests(): Promise<void> {
    await this.assertPassed("backend", await this.backendReport())
  }

  /** World and 3-season simulation checks, footprint and backup / reset smoke. */
  @func()
  @check()
  async worldChecks(): Promise<void> {
    await this.assertPassed("world", await this.worldReport())
  }

  /** Playwright e2e against a throwaway database. */
  @func()
  @check()
  async browserTests(): Promise<void> {
    await this.assertPassed("e2e", await this.browserReport())
  }

  /**
   * The release image for one platform, built from the Dockerfile.
   * @param platform Target platform, e.g. linux/amd64 or linux/arm64
   * @param revision Commit recorded as org.opencontainers.image.revision
   */
  @func()
  image(platform = "linux/amd64", revision = "unknown"): Container {
    return this.source.dockerBuild({
      platform: platform as Platform,
      buildArgs: [{ name: "SOURCE_REVISION", value: revision }],
    })
  }

  /**
   * Builds the multi-arch release image and pushes it under each tag; returns the pushed references with digest.
   * @param repository Image repository, e.g. ghcr.io/carlossardo/touchline
   * @param tags Tags to push, e.g. sha-<commit> and latest
   * @param revision Commit recorded in the image
   * @param username Registry user
   * @param password Registry token (pass as env:NAME)
   * @param platforms Platforms of the multi-arch image
   */
  @func()
  async publish(
    repository: string,
    tags: string[],
    revision: string,
    username: string,
    password: Secret,
    platforms: string[] = ["linux/amd64", "linux/arm64"],
  ): Promise<string[]> {
    if (tags.length === 0) throw new Error("publish needs at least one tag")
    const variants = platforms.map((platform) => this.image(platform, revision))
    const registry = repository.split("/")[0]
    const published: string[] = []
    for (const tag of tags) {
      published.push(
        await dag
          .container()
          .withRegistryAuth(registry, username, password)
          .publish(`${repository}:${tag}`, { platformVariants: variants }),
      )
    }
    // Pull every platform back by digest: the pushed index must hold each platform with this revision.
    const digest = published[0].slice(published[0].indexOf("@"))
    for (const platform of platforms) {
      const pulled = dag
        .container({ platform: platform as Platform })
        .withRegistryAuth(registry, username, password)
        .from(`${repository}${digest}`)
      const [actual, label] = await Promise.all([pulled.platform(), pulled.label("org.opencontainers.image.revision")])
      if (actual !== platform || label !== revision)
        throw new Error(`pushed image ${repository}${digest} for ${platform} is ${actual} at revision ${label}, expected ${revision}`)
    }
    return published
  }
}
