---
name: dagger
description: >-
  Write CI/CD pipelines as code with Dagger — portable, cacheable, container-based
  pipelines that run locally and in any CI system. Use when someone asks to
  "write CI pipeline in TypeScript", "portable CI/CD", "run GitHub Actions
  locally", "Dagger pipeline", "CI as code", "containerized build pipeline",
  "change Touchline CI", or "test my CI locally before pushing". Covers the
  Dagger 1.0 workspace model, the TypeScript SDK, checks, services, secrets,
  caching and multi-platform image builds.
license: Apache-2.0
compatibility: "Docker and the Dagger CLI v1.0.0-beta.21 (pinned in scripts/ci.sh). Modules in TypeScript."
metadata:
  author: terminal-skills (adapted for Touchline and Dagger 1.0)
  version: "2.0.0"
  repository: https://github.com/dagger/dagger
  upstream: https://github.com/TerminalSkills/skills/blob/main/skills/dagger/SKILL.md
  category: devops
  tags: "ci-cd, containers, pipelines, dagger, docker"
---

# Dagger

## Overview

Dagger runs CI/CD pipelines written in TypeScript, Python or Go in containers on a Dagger engine. Every step is cached and runs the same way on a laptop and in GitHub Actions, so CI can be tested before pushing.

This skill targets **Dagger 1.0** (`v1.0.0-beta.21`). 1.0 renamed most 0.x commands; never emit the 0.x forms in the right-hand column of the table below.

| Dagger 1.0 | 0.x (do not use) |
|---|---|
| `dagger init` (creates `dagger.toml`, the workspace) | `dagger init --sdk=...` |
| `dagger module install dagger.io/sdk/typescript` then `dagger module init typescript --name=X` | `dagger init --sdk=typescript` |
| `dagger api call FUNCTION ...`, `dagger api functions` | `dagger call`, `dagger functions` |
| `dagger generate -y` (regenerate SDK code; commit it) | `dagger develop` |
| `dagger check`, `dagger check -l` | — |
| `dagger -c 'script'` | `dagger` / `dagger shell` as a shell |
| `dagger lock update` | `dagger update` |
| Secrets as `env:NAME`, `file:PATH`, `cmd:"..."` | `env://NAME` |

Files: `dagger.toml` (workspace config), `dagger.lock` (pinned images and git refs), and per module `dagger-module.toml`, `src/`, generated `clients/`, `__dagger.dispatch.ts`, `entrypoint/`. Commit all of them; 1.0 modules do not generate code at runtime.

## Touchline conventions (read first when changing CI here)

- The CI module is `.dagger/modules/touchline-ci/src/index.ts` (the workspace main). `scripts/ci.sh` is the **only** entrypoint: GitHub Actions (`.github/workflows/verify.yml`, `image.yml`) and developers (`npm run ci`) run the same commands. Put CI logic in the module or `scripts/ci.sh`, never in workflow YAML.
- **CI → CD:** `verify.yml` (CI) runs on PRs and pushes to `main` (a push reuses its PR's run when the git tree is identical, `scripts/ci/verified.sh`); `cd.yml` runs after CI succeeds on `main`: `scripts/ci.sh publish`, then `scripts/ci/cd.sh deploy` on the Pi's self-hosted runner (label `touchline-deploy`, `scripts/ci/install-runner.sh`; newest commit only, never downgrades, verifies the running revision). Build/test never run on the self-hosted runner. Keep CD logic in `scripts/ci/cd.sh`, not YAML.
- **No Dagger Cloud**: no `DAGGER_CLOUD_TOKEN`, no `--engine=cloud`, no `dagger cloud checks on`; `scripts/ci.sh` sets `DO_NOT_TRACK=1` and runs a local engine in Docker with an empty `DOCKER_CONFIG`.
- Run the pinned CLI through the script: `npm run ci -- dagger <args>` (for example `npm run ci -- dagger generate -y` after changing the module, `npm run ci -- dagger check -l`).
- Suites `static`, `backend`, `world`, `e2e` are `report(suite)` functions that never fail on a failed step: each step runs through `ci-step NAME CMD...`, which tees `/ci-logs/NAME.log` and writes the exit code to `/ci-logs/status/NAME`. `scripts/ci.sh` exports them to `ci-logs/<suite>/` and fails if any status is non-zero. The `*-checks` / `*-tests` functions are the same suites as `@check()`s for `dagger check`.
- SQL guards in `server/sql-config.ts` and the tests only accept a loopback `SQL_HOST`. Do not loosen them for CI: each test container runs a TCP forwarder from `127.0.0.1:54329` to the `postgres` service and gets the same `SQL_*` environment as `scripts/test-local.ts`.
- Backend (3) and e2e (2) shards each get their own PostgreSQL service; `binPack` balances them from `scripts/ci/test-timings.json` (`npm run ci -- timings` refreshes it after a run). Shard counts in `verify.yml` matrices must equal `BACKEND_SHARDS`/`E2E_SHARDS`. Never pass an empty file list to vitest/Playwright (they would run everything); `testPlan` guards that shards cover each file exactly once.
- The forwarder must keep `noDelay` on both sockets: with Nagle's algorithm, large statements stall on PostgreSQL's delayed ACK and SQL-heavy suites run 2–3× slower.
- To change the Dagger version, update `DAGGER_VERSION` in `scripts/ci.sh` and this skill, run `npm run ci -- dagger lock update` and `dagger generate -y`, and commit.

## Instructions

### Setup

```bash
# Pinned and checksum-verified; scripts/ci.sh does this automatically
VER=1.0.0-beta.21
curl -fsSLO https://dl.dagger.io/dagger/releases/$VER/dagger_v${VER}_linux_amd64.tar.gz
curl -fsSL https://dl.dagger.io/dagger/releases/$VER/checksums.txt | grep " dagger_v${VER}_linux_amd64.tar.gz$" | sha256sum -c -
tar -xzf dagger_v${VER}_linux_amd64.tar.gz dagger && mv dagger ~/.local/bin/
dagger version

# New workspace and TypeScript module (code goes to .dagger/modules/<name>)
dagger init
dagger module install dagger.io/sdk/typescript
dagger module init typescript --name=ci --main -y
dagger api functions
```

The CLI starts the engine container (`registry.dagger.io/engine:v<version>`) on first use, so Docker must be running.

### Module (TypeScript SDK)

```typescript
import { check, Container, dag, Directory, func, object, ReturnType, Secret, Workspace } from "@dagger.io/dagger"

@object()
export class Ci {
  @func()
  source: Directory

  // The Workspace is filled in by Dagger; read the project lazily and keep the cache key tight.
  constructor(ws: Workspace) {
    this.source = ws.directory("/", { gitignore: true, exclude: ["**/.git", "**/node_modules", ".dagger"] })
  }

  /** Dependencies keyed only by the manifests, then the source on top. */
  @func()
  base(): Container {
    return dag
      .container()
      .from("node:24-trixie-slim")
      .withMountedCache("/root/.npm", dag.cacheVolume("npm"))
      .withWorkdir("/app")
      .withFile("/app/package.json", this.source.file("package.json"))
      .withFile("/app/package-lock.json", this.source.file("package-lock.json"))
      .withExec(["npm", "ci"])
      .withDirectory("/app", this.source)
  }

  /** `dagger check` runs every @check() function that has no required arguments. */
  @func()
  @check()
  async lint(): Promise<void> {
    await this.base().withExec(["npm", "run", "lint"]).sync()
  }

  /** Keep going after a failure and inspect the exit code instead of throwing. */
  @func()
  async testExitCode(): Promise<number> {
    return this.base().withExec(["npm", "test"], { expect: ReturnType.Any }).exitCode()
  }
}
```

### Run

```bash
dagger check                 # every check, in parallel
dagger check -l              # list checks
dagger api call lint         # one function
dagger api call base directory --path=/app/dist export --path=./dist
```

### Services (databases)

```typescript
const db = dag
  .container()
  .from("postgres:18")
  .withSecretVariable("POSTGRES_PASSWORD", password)
  .withMountedTemp("/dev/shm", { size: 1024 ** 3 })
  .withExposedPort(5432)
  .asService({ useEntrypoint: true, args: ["postgres", "-c", "fsync=off"] })

container.withServiceBinding("postgres", db) // reachable as host "postgres" once the port is open
```

### Secrets

Pass secrets as `Secret` arguments (`--token=env:TOKEN`) or create them with `dag.setSecret(uniqueName, value)`; use `withSecretVariable`, never `withEnvVariable`. Dagger redacts secret values from its own output, but not from files a command writes, so redact log files before exporting them.

### Multi-platform images

```typescript
const variants = ["linux/amd64", "linux/arm64"].map((platform) =>
  this.source.dockerBuild({ platform: platform as Platform, buildArgs: [{ name: "SOURCE_REVISION", value: rev }] }),
)
await dag.container().withRegistryAuth("ghcr.io", user, token).publish("ghcr.io/owner/app:tag", { platformVariants: variants })
```

The engine emulates foreign platforms itself; no QEMU or buildx setup is needed on the host.

### GitHub Actions

Keep workflows thin: check out, then run the same script developers run. Docker is preinstalled on `ubuntu-latest`.

```yaml
steps:
  - uses: actions/checkout@<sha> # v7
    with: { persist-credentials: false }
  - run: scripts/ci.sh backend
  - if: failure()
    uses: actions/upload-artifact@<sha> # v7
    with: { name: backend-logs, path: ci-logs/ }
```

Use `--progress=logs` in non-interactive runs: it streams command output, while `plain` prints a span's output only when it finishes.

## Guidelines

- **Run locally first**: `npm run ci` (or `npm run ci -- <suite>`) before pushing.
- **Cache the package-manager cache, not node_modules**: `withMountedCache("/root/.npm", ...)`.
- **Narrow the source**: `gitignore: true` plus `exclude` keeps `.git`, `node_modules` and secrets (`.env*`) out of the engine and the cache key.
- **Order layers**: copy manifests and install before copying the whole source.
- **Commit generated code**: run `dagger generate -y` after every module change.
- **Pin versions**: the CLI and engine version in one place; the `dagger.lock` for images and git refs.
