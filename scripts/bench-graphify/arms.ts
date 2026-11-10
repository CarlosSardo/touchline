// Builds the two isolated arms as git worktrees outside the repo.
// A: no graph, no Graphify skill/instructions, graphify shimmed to "command not found". B: as committed, graph rebuilt.
// C shares B's worktree; only its prompt differs.
// Both arms drop scripts/bench-graphify so the answer keys never leak.
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ROOT, type Arm } from "./tasks.ts";

export interface ArmEnv {
  arm: Arm;
  dir: string;
  env: NodeJS.ProcessEnv;
}

const git = (...args: string[]) =>
  execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8" }).trim();

export function prepareArms(
  runDir: string,
  ref = "HEAD",
): { arms: Record<Arm, ArmEnv>; graphBuildMs: number; commit: string } {
  mkdirSync(runDir, { recursive: true });
  const commit = git("rev-parse", "--short", ref);
  const shim = join(runDir, "shim");
  mkdirSync(shim, { recursive: true });
  for (const name of ["graphify", "graphify-mcp"]) {
    writeFileSync(
      join(shim, name),
      `#!/bin/sh\necho "${name}: command not found" >&2\nexit 127\n`,
    );
    chmodSync(join(shim, name), 0o755);
  }
  const base: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: "1",
    COPILOT_AUTO_UPDATE: "false",
    COPILOT_DISABLE_LOGIN_SHELL_ENV: "1",
  };
  const arms = {} as Record<Arm, ArmEnv>;
  let graphBuildMs = 0;
  for (const arm of ["A", "B"] as const) {
    const dir = join(runDir, `arm-${arm}`);
    if (existsSync(dir)) git("worktree", "remove", "--force", dir);
    git("worktree", "add", "--detach", dir, ref);
    rmSync(join(dir, "scripts/bench-graphify"), {
      recursive: true,
      force: true,
    });
    symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));
    if (arm === "A") {
      for (const path of [
        "graphify-out",
        ".github/skills/graphify",
        ".github/copilot-instructions.md",
      ])
        rmSync(join(dir, path), { recursive: true, force: true });
      arms.A = {
        arm,
        dir,
        env: { ...base, PATH: `${shim}:${process.env.PATH}` },
      };
    } else {
      const started = performance.now();
      execFileSync("graphify", ["update", "."], {
        cwd: dir,
        env: { ...base, PYTHONHASHSEED: "0", GRAPHIFY_FORCE: "1" },
        stdio: "ignore",
      });
      graphBuildMs = performance.now() - started;
      arms.B = { arm, dir, env: base };
      arms.C = { arm: "C", dir, env: base };
    }
  }
  return { arms, graphBuildMs, commit };
}

export function removeArms(arms: Record<Arm, ArmEnv>) {
  for (const dir of new Set(Object.values(arms).map((arm) => arm.dir))) {
    try {
      git("worktree", "remove", "--force", dir);
    } catch {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  git("worktree", "prune");
}
