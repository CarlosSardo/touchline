// Copilot CLI preToolUse hook ("strict mode"): the first code search or source read of a session that has not
// queried the Graphify graph yet is denied once with a reminder; every later call passes.
// Fails open: any error produces no output, which keeps the default permission behavior.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SEARCH_TOOLS = new Set(["grep", "rg", "glob"]);
const SOURCE = /(^|\/)(server|shared|src|scripts|e2e|docs)\//;
const SHELL_SEARCH =
  /(^|[\s;&|(])(rg|grep|egrep|ag|find|cat|sed|awk|head|tail|less|nl)(\s|$)/;
const RUNS_GRAPHIFY = /(^|[\s;&|(])graphify(\s|$)/;

const REASON =
  "Graph first: this repository has a Graphify code graph and this session has not queried it yet. " +
  'Structural questions are answered by one command: `graphify affected "X" --depth 3 --relation calls` (transitive callers), ' +
  '`graphify affected "X" --depth 1` (everything touching X, tests and docs included), `graphify explain "X"`, ' +
  '`graphify path "A" "B"` or `graphify query "<words>" --budget 2000`. This is a one-time reminder: ' +
  "retry the search if the graph cannot answer it.";

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  let args = input.toolArgs ?? {};
  if (typeof args === "string")
    try {
      args = JSON.parse(args);
    } catch {
      args = { command: args };
    }
  const tool = String(input.toolName ?? "");
  const command = typeof args.command === "string" ? args.command : "";
  const dir = join(tmpdir(), "graphify-first");
  const state = join(
    dir,
    String(input.sessionId ?? "unknown").replace(/[^\w-]/g, "_"),
  );
  let seen = "";
  try {
    seen = readFileSync(state, "utf8");
  } catch {}
  const usesGraph =
    tool.startsWith("graphify-") ||
    RUNS_GRAPHIFY.test(command) ||
    command.includes("graphify-out/") ||
    String(args.path ?? "").includes("graphify-out/");
  const searches =
    SEARCH_TOOLS.has(tool) ||
    (tool === "view" && SOURCE.test(String(args.path ?? ""))) ||
    (tool === "bash" && !usesGraph && SHELL_SEARCH.test(command));
  if (usesGraph && seen !== "graph") {
    mkdirSync(dir, { recursive: true });
    writeFileSync(state, "graph");
  } else if (searches && !seen) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(state, "nudged");
    process.stdout.write(
      JSON.stringify({
        permissionDecision: "deny",
        permissionDecisionReason: REASON,
      }),
    );
  }
} catch {}
