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
  File,
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

// Database-isolated shards. living-world.test.ts alone takes about a third of the backend suite, so a fourth
// backend shard would not finish sooner; game.spec.ts runs its tests in order, so e2e shards by spec file.
const BACKEND_SHARDS = 3
const E2E_SHARDS = 2
const TIMINGS = "scripts/ci/test-timings.json"
const UNIT_TEST_GLOBS = ["server", "shared", "src"].flatMap((dir) =>
  ["test.ts", "test.tsx", "spec.ts", "spec.tsx"].map((suffix) => `${dir}/**/*.${suffix}`),
)
const BROWSER_TEST_GLOBS = ["e2e/**/*.spec.ts", "e2e/**/*.test.ts"]
// A test file that may open a SQL store (the same rule the pure-test selection has always used).
const SQL_TEST = /\bStore\b|createApp\(/

interface Timings {
  backend: Record<string, number>
  e2e: Record<string, number>
}

interface TestPlan {
  pure: string[]
  sql: string[]
  backend: string[][]
  e2e: string[][]
}

interface PlaywrightSuite {
  file?: string
  suites?: PlaywrightSuite[]
  specs?: { tests?: { results?: { duration?: number }[] }[] }[]
}

/**
 * Longest-processing-time-first bin packing: files sorted by their last measured duration (unknown files get
 * the median) go to the shard with the least work so far. Deterministic for the same files and timings.
 */
function binPack(files: string[], seconds: Record<string, number>, count: number): string[][] {
  const known = files.map((file) => seconds[file]).filter((value): value is number => value !== undefined).sort((a, b) => a - b)
  const fallback = known.length > 0 ? known[Math.floor(known.length / 2)] : 1
  const weight = (file: string) => seconds[file] ?? fallback
  const shards = Array.from({ length: count }, () => ({ load: 0, files: [] as string[] }))
  for (const file of [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))) {
    const lightest = shards.reduce((best, shard) => (shard.load < best.load ? shard : best))
    lightest.load += weight(file)
    lightest.files.push(file)
  }
  return shards.map((shard) => shard.files.sort())
}

const round = (value: number) => Math.round(value * 10) / 10

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

@object()
export class TouchlineCi {
  /** The checked-out project: tracked and untracked files, minus .gitignore'd files, CI/agent metadata and the separately built docs site. */
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
        ".copilot",
        "ci-logs",
        "website",
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
    return this.installed(dag.container().from(await this.nodeImage()))
  }

  /**
   * The Playwright image matching the lockfile's @playwright/test (browsers and their system libraries
   * preinstalled) with Node.js from .nvmrc, so the browser suite needs no `playwright install --with-deps`.
   */
  @func()
  async browserImage(): Promise<Container> {
    const lock = JSON.parse(await this.source.file("package-lock.json").contents()) as {
      packages: Record<string, { version?: string }>
    }
    const version = lock.packages["node_modules/@playwright/test"]?.version
    if (!version) throw new Error("package-lock.json has no node_modules/@playwright/test")
    const node = dag.container().from(await this.nodeImage())
    return dag
      .container()
      .from(`mcr.microsoft.com/playwright:v${version}-noble`)
      .withDirectory("/usr/local", node.directory("/usr/local"))
  }

  private installed(base: Container): Container {
    return base
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
    const container = withBrowsers ? this.installed(await this.browserImage()) : await this.deps()
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

  /**
   * Every unit/integration test file, split into SQL-free files (the static suite runs them, in parallel) and
   * SQL files (the backend suite runs them in database-isolated shards). Together they are exactly the files
   * `npm test` runs.
   */
  @func()
  async testPlan(): Promise<string> {
    const plan = await this.plan()
    return JSON.stringify(plan, null, 2)
  }

  private async plan(): Promise<TestPlan> {
    const [unit, browser, timings] = await Promise.all([
      this.globAll(UNIT_TEST_GLOBS),
      this.globAll(BROWSER_TEST_GLOBS),
      this.timings(),
    ])
    const contents = await Promise.all(unit.map((file) => this.source.file(file).contents()))
    const pure = unit.filter((_, index) => !SQL_TEST.test(contents[index]))
    const sql = unit.filter((_, index) => SQL_TEST.test(contents[index]))
    const backend = binPack(sql, timings.backend, BACKEND_SHARDS)
    const e2e = binPack(browser, timings.e2e, E2E_SHARDS)
    // The shards must cover every SQL and browser test file exactly once.
    for (const [name, files, shards] of [["backend", sql, backend], ["e2e", browser, e2e]] as const) {
      const covered = shards.flat().sort()
      if (covered.length !== files.length || covered.some((file, index) => file !== [...files].sort()[index]))
        throw new Error(`${name} shards do not cover every test file exactly once`)
    }
    if (pure.length + sql.length !== unit.length) throw new Error("test files are not split exactly into pure and SQL")
    return { pure, sql, backend, e2e }
  }

  private async globAll(patterns: string[]): Promise<string[]> {
    const found = await Promise.all(patterns.map((pattern) => this.source.glob(pattern)))
    return [...new Set(found.flat())].sort()
  }

  private async timings(): Promise<Timings> {
    const parsed = JSON.parse(await this.source.file(TIMINGS).contents()) as Partial<Timings>
    return { backend: parsed.backend ?? {}, e2e: parsed.e2e ?? {} }
  }

  /** Lint, production build and the SQL-free unit tests (file-parallel: they open no database). */
  @func()
  async staticReport(): Promise<Directory> {
    const plan = await this.plan()
    let container = (await this.workspace()).withNewFile(`${LOGS}/test-plan.json`, JSON.stringify(plan, null, 2))
    container = this.step(container, "lint", ["npm", "run", "lint"])
    container = this.step(container, "build", ["npm", "run", "build"])
    container = this.step(container, "pure-tests", ["npx", "vitest", "run", "--fileParallelism", ...plan.pure])
    return this.redacted(container)
  }

  /**
   * The SQL integration and save test files, each shard in its own container against its own PostgreSQL.
   * @param shard One shard as N/M (as GitHub Actions runs them); empty runs every shard concurrently
   */
  @func()
  async backendReport(shard = ""): Promise<Directory> {
    const plan = await this.plan()
    return this.sharded(plan.backend, shard, async (files, index, count) => {
      const name = `backend-${index}of${count}`
      let container = this.withSql(await this.workspace(), `touchline_test_ci_${index}`)
      container = this.step(container, name, [
        "npx", "vitest", "run", ...files,
      ])
      return this.redacted(container)
    })
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

  /**
   * The Playwright browser suite, sharded by spec file; each shard has its own PostgreSQL, servers and fresh
   * E2E schema. The HTML report and traces are kept under e2e-<shard>/.
   * @param shard One shard as N/M (as GitHub Actions runs them); empty runs every shard concurrently
   */
  @func()
  async browserReport(shard = ""): Promise<Directory> {
    const plan = await this.plan()
    return this.sharded(plan.e2e, shard, async (files, index, count) => {
      const name = `e2e-${index}of${count}`
      const schema = `touchline_e2e_${randomBytes(16).toString("hex")}`
      let container = this.withSql(await this.workspace(true), schema)
        .withEnvVariable("TOUCHLINE_E2E_SCHEMA", schema)
        .withEnvVariable("PLAYWRIGHT_JSON_OUTPUT_NAME", `${LOGS}/timings/${name}.json`)
      container = this.step(container, name, ["npm", "run", "test:e2e", "--", "--reporter=list,html,json", ...files])
      container = container.withExec([
        "bash", "-c", `mkdir -p ${LOGS}/${name}; for d in playwright-report test-results; do if [[ -d $d ]]; then cp -r $d ${LOGS}/${name}/; fi; done`,
      ])
      return this.redacted(container)
    })
  }

  /** Runs one shard (N/M) or, when shard is empty, every shard concurrently and merges their reports. */
  private async sharded(
    shards: string[][],
    shard: string,
    run: (files: string[], index: number, count: number) => Promise<Directory>,
  ): Promise<Directory> {
    const count = shards.length
    if (shard) {
      const match = /^(\d+)\/(\d+)$/.exec(shard)
      if (!match || Number(match[2]) !== count || Number(match[1]) < 1 || Number(match[1]) > count)
        throw new Error(`shard must be N/${count} with N from 1 to ${count}, not "${shard}"`)
      const index = Number(match[1])
      return this.shardOrEmpty(shards[index - 1], index, count, run)
    }
    const reports = await Promise.all(shards.map((files, position) => this.shardOrEmpty(files, position + 1, count, run)))
    // Evaluate every shard before merging, so they run concurrently rather than one after another.
    await Promise.all(reports.map((report) => report.sync()))
    return reports.reduce((merged, report) => merged.withDirectory("/", report), dag.directory())
  }

  // Vitest and Playwright run every test when given no files, so an empty shard runs nothing instead.
  private async shardOrEmpty(
    files: string[],
    index: number,
    count: number,
    run: (files: string[], index: number, count: number) => Promise<Directory>,
  ): Promise<Directory> {
    if (files.length > 0) return run(files, index, count)
    return dag
      .directory()
      .withNewFile(`shard-${index}of${count}-empty.log`, "No test files in this shard.\n")
      .withNewFile(`status/shard-${index}of${count}-empty`, "0\n")
  }

  /**
   * Logs, reports and per-step exit codes (status/<step>) of one suite. Never fails because a step failed.
   * @param suite static, backend, world or e2e
   * @param seasons Seasons for the world suite's simulation check (1-20)
   * @param fullWorld Also run the world suite's season soak on the full world
   * @param shard backend or e2e only: one shard as N/M; empty runs every shard concurrently
   */
  @func()
  async report(suite: string, seasons = 3, fullWorld = false, shard = ""): Promise<Directory> {
    if (shard && suite !== "backend" && suite !== "e2e") throw new Error(`the ${suite} suite has no shards`)
    switch (suite as Suite) {
      case "static":
        return this.staticReport()
      case "backend":
        return this.backendReport(shard)
      case "world":
        return this.worldReport(seasons, fullWorld)
      case "e2e":
        return this.browserReport(shard)
      default:
        throw new Error(`Unknown suite "${suite}". Use one of: ${SUITES.join(", ")}.`)
    }
  }

  /**
   * Per-file test durations (seconds) from the timing reports of earlier runs (ci-logs/), merged into the
   * current scripts/ci/test-timings.json. scripts/ci.sh timings writes the result back.
   * @param reports A directory holding backend-NofM.log (Vitest output) and timings/e2e-*.json (Playwright) reports
   */
  @func()
  async updatedTimings(reports: Directory): Promise<File> {
    const timings = await this.timings()
    // Vitest's per-file summary line ("✓ server/x.test.ts (12 tests) 9466ms") includes beforeAll/afterAll hooks,
    // unlike its JSON report, and those hooks are most of the heaviest files' time.
    for (const file of await reports.glob("**/backend-*of*.log")) {
      const log = (await reports.file(file).contents()).replace(/\x1b\[[0-9;]*m/g, "")
      for (const match of log.matchAll(/^\s*[✓❯×↓] ((?:server|shared|src)\/\S+) \(\d+ tests?[^)]*\) (\d+)ms$/gm))
        timings.backend[match[1]] = round(Number(match[2]) / 1000)
    }
    for (const file of await reports.glob("**/timings/e2e-*.json")) {
      const report = JSON.parse(await reports.file(file).contents()) as { suites: PlaywrightSuite[] }
      const seconds: Record<string, number> = {}
      const visit = (suite: PlaywrightSuite, path: string) => {
        for (const spec of suite.specs ?? [])
          for (const test of spec.tests ?? [])
            for (const result of test.results ?? []) seconds[path] = (seconds[path] ?? 0) + (result.duration ?? 0) / 1000
        for (const child of suite.suites ?? []) visit(child, path)
      }
      for (const suite of report.suites ?? []) visit(suite, `e2e/${suite.file}`)
      for (const [path, value] of Object.entries(seconds)) timings.e2e[path] = round(value)
    }
    const sorted = (record: Record<string, number>) =>
      Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
    const json = `${JSON.stringify({ backend: sorted(timings.backend), e2e: sorted(timings.e2e) }, null, 2)}\n`
    return dag.directory().withNewFile("test-timings.json", json).file("test-timings.json")
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

  /** SQL-backed backend tests, every shard. */
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

  /** Playwright e2e, every shard, against throwaway databases. */
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
