// Usage: npm run bench:graphify -- <keys|scripted|agent|all|report> [options]
//   keys                         recompute compiler-derived answer keys (answer-keys.json)
//   scripted [--reps 5]          fixed retrieval recipes per arm: tokens, context recall, median time
//   agent [--repeats 3] [--concurrency N] [--model claude-sonnet-5.5] [--tasks H1,H2] [--arms A,G,M,H] [--timeout-min 15]
//         [--out agent.json]     results file name under results/ (e.g. pilot.json, agent-haiku.json)
//   all                          scripted, then agent, then report
//   report                       regenerate REPORT.md from results/*.json
// Arms: A grep/read, G Graphify CLI, M Graphify MCP, H CLI + graph-first hook (see arms.ts). Scripted mode compares A and G.
// Common: --ref <git ref> (default HEAD), --keep (keep worktrees and logs under /tmp/touchline-bench)
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { runAgents } from "./agent.ts";
import { prepareArms, removeArms } from "./arms.ts";
import { writeReport } from "./report.ts";
import { runScripted } from "./scripted.ts";
import { ARMS, BENCH_DIR, TASKS, type Arm } from "./tasks.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    reps: { type: "string", default: "5" },
    repeats: { type: "string", default: "3" },
    concurrency: { type: "string" },
    model: { type: "string", default: "claude-sonnet-5.5" },
    tasks: { type: "string" },
    arms: { type: "string" },
    "timeout-min": { type: "string", default: "15" },
    ref: { type: "string", default: "HEAD" },
    keep: { type: "boolean", default: false },
    out: { type: "string", default: "agent.json" },
  },
});
const command = positionals[0] ?? "all";
const RESULTS = join(BENCH_DIR, "results");
const tasks = values.tasks
  ? TASKS.filter((task) => values.tasks!.split(",").includes(task.id))
  : TASKS;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join("/tmp/touchline-bench", stamp);
const save = (name: string, data: unknown) => {
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, name), `${JSON.stringify(data, null, 2)}\n`);
};
const graphStats = (dir: string) =>
  JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        "import json,sys;g=json.load(open(sys.argv[1]));print(json.dumps({'nodes':len(g['nodes']),'edges':len(g['links'])}))",
        join(dir, "graphify-out/graph.json"),
      ],
      { encoding: "utf8" },
    ),
  );
const agentArms = values.arms
  ? ARMS.filter((arm) => values.arms!.split(",").includes(arm))
  : ARMS;
const version = (cmd: string) =>
  `${cmd} ${/\d+\.\d+\.\d+\S*/.exec(execFileSync(cmd, ["--version"], { encoding: "utf8" }))?.[0] ?? "unknown"}`;

if (command === "keys") {
  await import("./ground-truth.ts");
} else if (command === "report") {
  writeReport();
} else if (["scripted", "agent", "all"].includes(command)) {
  console.log(`Preparing arms from ${values.ref} in ${runDir} ...`);
  const needed = new Set<Arm>(
    command === "agent"
      ? agentArms
      : command === "scripted"
        ? ["A", "G"]
        : ["A", "G", ...agentArms],
  );
  const { arms, graphBuildMs, commit, graphDir } = prepareArms(
    runDir,
    values.ref,
    ARMS.filter((arm) => needed.has(arm)),
  );
  const meta = {
    commit,
    date: new Date().toISOString(),
    graphify: version("graphify"),
    graphBuildMs: Math.round(graphBuildMs),
    graph: graphStats(graphDir),
  };
  try {
    if (command !== "agent") {
      console.log(
        `Scripted: ${tasks.length * 2} recipes in parallel, then ${values.reps} serial timing reps ...`,
      );
      const results = await runScripted(arms, Number(values.reps), tasks);
      save("scripted.json", {
        meta: { ...meta, timingReps: Number(values.reps) },
        results,
      });
    }
    if (command !== "scripted") {
      const started = performance.now();
      const { results, concurrency } = await runAgents(arms, {
        runDir,
        model: values.model!,
        repeats: Number(values.repeats),
        concurrency: values.concurrency
          ? Number(values.concurrency)
          : undefined,
        timeoutMs: Number(values["timeout-min"]) * 60_000,
        tasks,
        arms: agentArms,
        onResult: (r, done, total) =>
          console.log(
            `[${done}/${total}] ${r.task} ${r.arm} r${r.repeat}: ${r.ok ? "ok" : `FAILED (${r.error})`} acc=${r.score.accuracy.toFixed(2)} in=${r.inputTokens} out=${r.outputTokens} turns=${r.modelCalls} tools=${r.toolCalls} graph=${r.graphifyCalls}${r.hookDenials ? ` denied=${r.hookDenials}` : ""} ${(r.wallMs / 1000).toFixed(0)}s`,
          ),
      });
      const order = (r: { task: string; arm: string; repeat: number }) =>
        `${r.task}${r.arm}${r.repeat}`;
      results.sort((a, b) => order(a).localeCompare(order(b)));
      save(values.out!, {
        meta: {
          ...meta,
          model: values.model,
          arms: agentArms,
          tasks: tasks.map((task) => task.id),
          copilot: version("copilot"),
          repeats: Number(values.repeats),
          concurrency,
          totalWallMs: Math.round(performance.now() - started),
          logs: runDir,
        },
        results,
      });
    }
    writeReport();
  } finally {
    // Per-run COPILOT_HOMEs hold session state and credentials; logs stay for inspection.
    rmSync(join(runDir, "homes"), { recursive: true, force: true });
    if (!values.keep) removeArms(runDir);
    else console.log(`Kept worktrees and logs in ${runDir}`);
  }
} else {
  console.error(`Unknown command ${command}`);
  process.exit(2);
}
