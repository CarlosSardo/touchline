// Builds the four isolated arms as git worktrees outside the repo. Every arm drops scripts/bench-graphify so the answer keys never leak.
// A: no graph, no Graphify skill, CLI shimmed to "command not found", instructions = arm-files/A.md (fair efficient-search tips).
// G: graph rebuilt, skill kept, instructions = arm-files/G.md (graph-first CLI protocol).
// M: same graph, CLI shimmed, skill removed, Graphify MCP server attached, instructions = arm-files/M.md.
// H: as G plus a repository preToolUse hook that redirects the first search to the graph (arm-files/hooks).
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ARMS, BENCH_DIR, ROOT, type Arm } from "./tasks.ts";

export interface ArmEnv {
  arm: Arm;
  dir: string;
  env: NodeJS.ProcessEnv;
  /** Extra Copilot CLI arguments (the MCP server for arm M). */
  extraArgs: string[];
}

const git = (...args: string[]) =>
  execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8" }).trim();
const FILES = join(BENCH_DIR, "arm-files");

function shimDir(runDir: string, names: string[]) {
  const dir = join(runDir, `shim-${names.join("-")}`);
  mkdirSync(dir, { recursive: true });
  for (const name of names) {
    writeFileSync(
      join(dir, name),
      `#!/bin/sh\necho "${name}: command not found" >&2\nexit 127\n`,
    );
    chmodSync(join(dir, name), 0o755);
  }
  return dir;
}

export function prepareArms(
  runDir: string,
  ref = "HEAD",
  only: Arm[] = ARMS,
): {
  arms: Partial<Record<Arm, ArmEnv>>;
  graphBuildMs: number;
  commit: string;
  graphDir: string;
} {
  mkdirSync(runDir, { recursive: true });
  const commit = git("rev-parse", "--short", ref);
  const base: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: "1",
    COPILOT_AUTO_UPDATE: "false",
    COPILOT_DISABLE_LOGIN_SHELL_ENV: "1",
  };
  const noGraphify = `${shimDir(runDir, ["graphify", "graphify-mcp"])}:${process.env.PATH}`;
  const noCli = `${shimDir(runDir, ["graphify"])}:${process.env.PATH}`;
  const mcp = execFileSync("bash", ["-c", "command -v graphify-mcp"], {
    encoding: "utf8",
  }).trim();

  const worktree = (name: string) => {
    const dir = join(runDir, name);
    if (existsSync(dir)) git("worktree", "remove", "--force", dir);
    git("worktree", "add", "--detach", dir, ref);
    rmSync(join(dir, "scripts/bench-graphify"), {
      recursive: true,
      force: true,
    });
    symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));
    return dir;
  };
  const instruct = (dir: string, file: string) =>
    copyFileSync(
      join(FILES, file),
      join(dir, ".github/copilot-instructions.md"),
    );
  const remove = (dir: string, ...paths: string[]) =>
    paths.forEach((path) =>
      rmSync(join(dir, path), { recursive: true, force: true }),
    );

  // The graph is built once (in a dedicated worktree) and copied to every graph arm so all of them query the same graph.
  const graphDir = worktree("graph");
  const started = performance.now();
  execFileSync("graphify", ["update", "."], {
    cwd: graphDir,
    env: { ...base, PYTHONHASHSEED: "0", GRAPHIFY_FORCE: "1" },
    stdio: "ignore",
  });
  // `update` leaves GRAPH_REPORT.md unwritten when the rebuilt topology matches the committed graph.json; cluster-only writes it.
  execFileSync("graphify", ["cluster-only", "."], {
    cwd: graphDir,
    env: { ...base, PYTHONHASHSEED: "0" },
    stdio: "ignore",
  });
  const graphBuildMs = performance.now() - started;
  const withGraph = (dir: string) => {
    remove(dir, "graphify-out");
    cpSync(join(graphDir, "graphify-out"), join(dir, "graphify-out"), {
      recursive: true,
    });
  };

  const arms: Partial<Record<Arm, ArmEnv>> = {};
  for (const arm of only) {
    const dir = worktree(`arm-${arm}`);
    if (arm === "A") {
      remove(dir, "graphify-out", ".github/skills/graphify");
      instruct(dir, "A.md");
      arms.A = { arm, dir, env: { ...base, PATH: noGraphify }, extraArgs: [] };
    } else if (arm === "G") {
      withGraph(dir);
      instruct(dir, "G.md");
      arms.G = { arm, dir, env: base, extraArgs: [] };
    } else if (arm === "M") {
      withGraph(dir);
      remove(dir, ".github/skills/graphify");
      instruct(dir, "M.md");
      const config = {
        mcpServers: {
          graphify: {
            type: "local",
            command: mcp,
            args: [join(dir, "graphify-out/graph.json")],
            tools: ["*"],
          },
        },
      };
      arms.M = {
        arm,
        dir,
        env: { ...base, PATH: noCli },
        extraArgs: ["--additional-mcp-config", JSON.stringify(config)],
      };
    } else {
      withGraph(dir);
      instruct(dir, "G.md");
      mkdirSync(join(dir, ".github/hooks"), { recursive: true });
      for (const file of ["graphify.json", "graph-first.mjs"])
        copyFileSync(
          join(FILES, "hooks", file),
          join(dir, ".github/hooks", file),
        );
      arms.H = { arm, dir, env: base, extraArgs: [] };
    }
  }
  return { arms, graphBuildMs, commit, graphDir };
}

export function removeArms(runDir: string) {
  for (const line of git("worktree", "list", "--porcelain").split("\n"))
    if (line.startsWith("worktree ") && line.slice(9).startsWith(runDir + "/"))
      try {
        git("worktree", "remove", "--force", line.slice(9));
      } catch {
        rmSync(line.slice(9), { recursive: true, force: true });
      }
  git("worktree", "prune");
}
