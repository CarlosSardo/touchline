// Renders results/*.json into REPORT.md: pre-registered verdicts, per-group ratios vs arm A with bootstrap CIs,
// per-task tables, retrieval ceilings and the cheap-model phase. Plain markdown, no external tooling.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentResult } from "./agent.ts";
import type { ScriptedResult } from "./scripted.ts";
import {
  ARM_LABEL,
  ARMS,
  BENCH_DIR,
  GROUPS,
  TASKS,
  type Arm,
  type Group,
} from "./tasks.ts";

const RESULTS = join(BENCH_DIR, "results");
interface AgentData {
  meta: any;
  results: AgentResult[];
}
const load = <T>(name: string): T | null =>
  existsSync(join(RESULTS, name))
    ? JSON.parse(readFileSync(join(RESULTS, name), "utf8"))
    : null;

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
const geomean = (values: number[]) => Math.exp(mean(values.map(Math.log)));
const fin = (n: number) => Number.isFinite(n);
const k = (n: number) =>
  fin(n)
    ? n >= 10_000
      ? `${(n / 1000).toFixed(0)}k`
      : n >= 1000
        ? `${(n / 1000).toFixed(1)}k`
        : `${Math.round(n)}`
    : "–";
const pct = (n: number) => (fin(n) ? `${Math.round(n * 100)}%` : "–");
const num = (n: number, digits = 1) => (fin(n) ? n.toFixed(digits) : "–");
const secs = (ms: number) => (fin(ms) ? `${(ms / 1000).toFixed(0)} s` : "–");
const ratio = ([point, low, high]: number[]) =>
  fin(point)
    ? `**${point.toFixed(2)}×** (${low.toFixed(2)}–${high.toFixed(2)})`
    : "–";
const table = (header: string[], rows: string[][]) =>
  [
    `| ${header.join(" | ")} |`,
    `|${header.map((_, i) => (i ? " ---: " : " --- ")).join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");

/** Per-run metrics compared between arms. Failed runs score 0 accuracy and are excluded from cost metrics. */
const METRICS = {
  turns: (r: AgentResult) => r.modelCalls,
  input: (r: AgentResult) => r.inputTokens,
  taskInput: (r: AgentResult) => r.taskInputTokens,
  retrieved: (r: AgentResult) => r.retrievedTokens,
  cost: (r: AgentResult) => r.nanoAiu,
  wall: (r: AgentResult) => r.wallMs,
} satisfies Record<string, (r: AgentResult) => number>;
type Metric = keyof typeof METRICS;
const accuracy = (r: AgentResult) => (r.ok ? r.score.accuracy : 0);

/** Deterministic PRNG so the report is reproducible from the same results. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const resample = <T>(values: T[], random: () => number) =>
  values.map(() => values[Math.floor(random() * values.length)]);

class Cells {
  constructor(readonly results: AgentResult[]) {}
  runs(task: string, arm: Arm) {
    return this.results.filter((r) => r.task === task && r.arm === arm);
  }
  value(task: string, arm: Arm, metric: Metric) {
    return mean(
      this.runs(task, arm)
        .filter((r) => r.ok)
        .map(METRICS[metric]),
    );
  }
  accuracy(task: string, arm: Arm) {
    return mean(this.runs(task, arm).map(accuracy));
  }
  /**
   * Geometric mean over tasks of mean(arm)/mean(A), with a 95% percentile bootstrap CI that resamples runs within each cell.
   * One task gives the plain ratio of means.
   */
  ratio(
    tasks: string[],
    arm: Arm,
    metric: Metric,
    iterations = 2000,
  ): number[] {
    const f = METRICS[metric];
    const cells = tasks
      .map((task) =>
        [this.runs(task, arm), this.runs(task, "A")].map((runs) =>
          runs.filter((r) => r.ok).map(f),
        ),
      )
      .filter(([a, b]) => a.length && b.length && mean(b) > 0);
    if (!cells.length) return [NaN, NaN, NaN];
    const point = geomean(cells.map(([a, b]) => mean(a) / mean(b)));
    const random = rng(42);
    const samples: number[] = [];
    for (let i = 0; i < iterations; i++)
      samples.push(
        geomean(
          cells.map(
            ([a, b]) =>
              mean(resample(a, random)) /
              Math.max(1e-9, mean(resample(b, random))),
          ),
        ),
      );
    samples.sort((a, b) => a - b);
    return [
      point,
      samples[Math.floor(iterations * 0.025)],
      samples[Math.floor(iterations * 0.975)],
    ];
  }
  /** Mean accuracy difference arm − A over tasks, with a bootstrap CI. */
  accuracyDelta(tasks: string[], arm: Arm, iterations = 2000): number[] {
    const cells = tasks
      .map((task) =>
        [this.runs(task, arm), this.runs(task, "A")].map((runs) =>
          runs.map(accuracy),
        ),
      )
      .filter(([a, b]) => a.length && b.length);
    if (!cells.length) return [NaN, NaN, NaN];
    const point = mean(cells.map(([a, b]) => mean(a) - mean(b)));
    const random = rng(7);
    const samples: number[] = [];
    for (let i = 0; i < iterations; i++)
      samples.push(
        mean(
          cells.map(
            ([a, b]) => mean(resample(a, random)) - mean(resample(b, random)),
          ),
        ),
      );
    samples.sort((a, b) => a - b);
    return [
      point,
      samples[Math.floor(iterations * 0.025)],
      samples[Math.floor(iterations * 0.975)],
    ];
  }
}
const signed = ([point, low, high]: number[]) =>
  fin(point)
    ? `**${point >= 0 ? "+" : "−"}${Math.abs(point * 100).toFixed(0)} pts** (${(low * 100).toFixed(0)}…${(high * 100).toFixed(0)})`
    : "–";

const tasksIn = (results: AgentResult[], groups: Group[]) =>
  TASKS.filter(
    (t) => groups.includes(t.group) && results.some((r) => r.task === t.id),
  ).map((t) => t.id);
const armsIn = (results: AgentResult[]) =>
  ARMS.filter((arm) => results.some((r) => r.arm === arm));

/** Pre-registered hypotheses (hypotheses.md). Thresholds are fixed before the full run. */
function verdicts(
  data: AgentData,
  haiku: AgentData | null,
  sonnetAcc: number | null,
) {
  const cells = new Cells(data.results);
  const graphArms = armsIn(data.results).filter((arm) => arm !== "A");
  const structural = tasksIn(data.results, ["structural"]);
  const changePlan = tasksIn(data.results, ["change-plan"]);
  const rows: string[][] = [];
  for (const arm of graphArms) {
    const turns = cells.ratio(structural, arm, "turns");
    const input = cells.ratio(structural, arm, "input");
    const acc = cells.accuracyDelta(structural, arm);
    rows.push([
      `P1 structural (${structural.join(", ")}): ≥40% fewer turns, ≥30% fewer input tokens, accuracy ≥ A − 5 pts`,
      ARM_LABEL[arm],
      `turns ${ratio(turns)}, input ${ratio(input)}, accuracy ${signed(acc)}`,
      turns[0] <= 0.6 && input[0] <= 0.7 && acc[0] >= -0.05
        ? "✅ confirmed"
        : "❌ not confirmed",
    ]);
  }
  for (const arm of graphArms) {
    const acc = cells.accuracyDelta(changePlan, arm);
    const input = cells.ratio(changePlan, arm, "input");
    rows.push([
      `P2 change plans (${changePlan.join(", ")}): accuracy ≥ A − 5 pts`,
      ARM_LABEL[arm],
      `accuracy ${signed(acc)}, input ${ratio(input)}`,
      acc[0] >= -0.05 ? "✅ confirmed" : "❌ not confirmed",
    ]);
  }
  for (const arm of graphArms) {
    const input = cells.ratio(["T7"], arm, "input");
    rows.push([
      "P3 control (T7): input tokens within ±15% of A",
      ARM_LABEL[arm],
      `input ${ratio(input)}`,
      fin(input[0])
        ? Math.abs(input[0] - 1) <= 0.15
          ? "✅ confirmed"
          : "❌ not confirmed"
        : "–",
    ]);
  }
  for (const arm of graphArms) {
    const acc = cells.accuracyDelta(["H4"], arm);
    rows.push([
      "P4 coverage (H4): graph arms score lower than A (predicted loss)",
      ARM_LABEL[arm],
      `accuracy ${signed(acc)}`,
      fin(acc[0]) ? (acc[0] < 0 ? "✅ loss as predicted" : "❌ no loss") : "–",
    ]);
  }
  if (haiku && sonnetAcc !== null) {
    const hCells = new Cells(haiku.results);
    const hStructural = tasksIn(haiku.results, ["structural", "change-plan"]);
    for (const arm of armsIn(haiku.results).filter((a) => a !== "A")) {
      const acc = mean(hStructural.map((t) => hCells.accuracy(t, arm)));
      rows.push([
        `P5 cheap model (${haiku.meta.model}, ${hStructural.join(", ")}): graph arm accuracy ≥ ${data.meta.model} arm A accuracy`,
        ARM_LABEL[arm],
        `${pct(acc)} vs ${pct(sonnetAcc)} (haiku A ${pct(mean(hStructural.map((t) => hCells.accuracy(t, "A"))))})`,
        acc >= sonnetAcc ? "✅ confirmed" : "❌ not confirmed",
      ]);
    }
  }
  return table(
    ["Hypothesis", "Arm", "Measured (95% bootstrap CI)", "Verdict"],
    rows,
  );
}

function groupSection(data: AgentData) {
  const cells = new Cells(data.results);
  const graphArms = armsIn(data.results).filter((arm) => arm !== "A");
  const rows: string[][] = [];
  for (const group of GROUPS) {
    const tasks = tasksIn(data.results, [group]);
    if (!tasks.length) continue;
    for (const arm of graphArms)
      rows.push([
        `${group} (${tasks.join(", ")})`,
        ARM_LABEL[arm],
        signed(cells.accuracyDelta(tasks, arm)),
        ratio(cells.ratio(tasks, arm, "turns")),
        ratio(cells.ratio(tasks, arm, "input")),
        ratio(cells.ratio(tasks, arm, "taskInput")),
        ratio(cells.ratio(tasks, arm, "cost")),
        ratio(cells.ratio(tasks, arm, "wall")),
      ]);
  }
  return table(
    [
      "Task group",
      "Arm vs A",
      "Accuracy Δ",
      "Turns",
      "Input tokens",
      "Task tokens",
      "Cost (AIU)",
      "Wall time",
    ],
    rows,
  );
}

function taskSection(data: AgentData) {
  const cells = new Cells(data.results);
  const lines: string[] = [];
  for (const task of TASKS) {
    if (!data.results.some((r) => r.task === task.id)) continue;
    lines.push(
      `#### ${task.id}: ${task.title} (${task.group}, ${task.scoring === "set" ? "F1" : "recall"}, ${task.key.length} key items)`,
      "",
    );
    const rows = armsIn(data.results).map((arm) => {
      const runs = cells.runs(task.id, arm);
      const okRuns = runs.filter((r) => r.ok);
      const accs = runs.map(accuracy);
      return [
        ARM_LABEL[arm],
        `${pct(mean(accs))} (${accs.map((a) => Math.round(a * 100)).join("/")})`,
        num(cells.value(task.id, arm, "turns")),
        k(cells.value(task.id, arm, "input")),
        k(cells.value(task.id, arm, "taskInput")),
        k(cells.value(task.id, arm, "retrieved")),
        num(cells.value(task.id, arm, "cost") / 1e9),
        secs(cells.value(task.id, arm, "wall")),
        arm === "A"
          ? "–"
          : `${num(mean(okRuns.map((r) => r.graphifyCalls)))} (first ${okRuns.filter((r) => r.graphFirst).length}/${okRuns.length})`,
        String(runs.length - okRuns.length),
      ];
    });
    lines.push(
      table(
        [
          "Arm",
          "Accuracy (runs)",
          "Turns",
          "Input",
          "Task input",
          "Retrieved",
          "AIU",
          "Wall",
          "Graph calls (graph first)",
          "Failed",
        ],
        rows,
      ),
      "",
    );
    if (task.parts) {
      lines.push(
        table(
          ["Arm", ...Object.keys(task.parts)],
          armsIn(data.results).map((arm) => [
            ARM_LABEL[arm],
            ...Object.keys(task.parts!).map((part) =>
              pct(
                mean(
                  cells
                    .runs(task.id, arm)
                    .map((r) => (r.ok ? (r.score.parts?.[part] ?? 0) : 0)),
                ),
              ),
            ),
          ]),
        ),
        "",
      );
    }
    const missed = new Map<string, number>();
    for (const r of data.results.filter((r) => r.task === task.id && r.ok))
      for (const item of r.score.missed)
        missed.set(
          `${r.arm}: ${item}`,
          (missed.get(`${r.arm}: ${item}`) ?? 0) + 1,
        );
    const top = [...missed].sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (top.length)
      lines.push(
        `Most missed: ${top.map(([item, n]) => `${item} (${n}×)`).join("; ")}.`,
        "",
      );
  }
  return lines;
}

function scriptedSection(data: { meta: any; results: ScriptedResult[] }) {
  const rows = TASKS.filter((t) =>
    data.results.some((r) => r.task === t.id),
  ).map((t) => {
    const a = data.results.find((r) => r.task === t.id && r.arm === "A")!;
    const g = data.results.find((r) => r.task === t.id && r.arm === "G")!;
    return [
      `${t.id} ${t.title}`,
      `${a.commands.length} / ${g.commands.length}`,
      `${k(a.tokens)} / ${k(g.tokens)}`,
      `${pct(a.contextRecall)} / ${pct(g.contextRecall)}`,
      `${num(a.medianMs / 1000, 2)} / ${num(g.medianMs / 1000, 2)} s`,
    ];
  });
  return [
    "## Retrieval ceilings (scripted)",
    "",
    "Hand-written best recipes per task, run without an agent ([tasks.ts](tasks.ts)): **A** = the best grep/read recipe, **G** = the best Graphify CLI recipe. " +
      "Context recall is the share of answer-key items present in the output: the most an agent could extract from that retrieval. " +
      "The commands column is the minimum number of agent turns the retrieval needs (A recipes for transitive tasks need one search per hop, and each hop depends on the previous output).",
    "",
    table(
      [
        "Task",
        "Commands A / G",
        "Tokens A / G",
        "Context recall A / G",
        "Median time A / G",
      ],
      rows,
    ),
    "",
  ];
}

function setupLines(data: AgentData) {
  const { meta, results } = data;
  return [
    `Model \`${meta.model}\` (reasoning effort medium), ${meta.copilot} CLI, ${meta.repeats} repeats × ${new Set(results.map((r) => r.task)).size} tasks × ${armsIn(results).length} arms = ${results.length} runs ` +
      `(${results.filter((r) => !r.ok).length} failed), ${meta.concurrency} concurrent sessions, ${Math.round(meta.totalWallMs / 60000)} min wall time.`,
  ];
}

export function writeReport() {
  const agent = load<AgentData>("agent.json");
  const haiku = load<AgentData>("agent-haiku.json");
  const scripted = load<{ meta: any; results: ScriptedResult[] }>(
    "scripted.json",
  );
  const meta = agent?.meta ?? scripted?.meta;
  const notes = existsSync(join(RESULTS, "notes.md"))
    ? readFileSync(join(RESULTS, "notes.md"), "utf8").trim()
    : "";
  let sonnetAcc: number | null = null;
  if (agent && haiku) {
    const cells = new Cells(agent.results);
    const tasks = tasksIn(haiku.results, ["structural", "change-plan"]);
    sonnetAcc = mean(tasks.map((t) => cells.accuracy(t, "A")));
  }
  const lines = [
    "# Graphify benchmark v2: agentic changes to Touchline",
    "",
    "Does the [Graphify](https://github.com/Graphify-Labs/graphify) code graph make a coding agent cheaper and more accurate on Touchline when it is used as designed? " +
      "Four arms answer the same questions: **A** searches normally (grep, reads) with fair efficient-search instructions; **G** has the graph and a graph-first CLI protocol; " +
      "**M** gets the graph through the Graphify MCP server; **H** is G plus a `preToolUse` hook that redirects the first search to the graph. " +
      "Generated by `npm run bench:graphify` ([index.ts](index.ts)); raw data in [results/](results/); predictions in [hypotheses.md](hypotheses.md); v1 in [v1/REPORT.md](v1/REPORT.md).",
    "",
    meta
      ? `Commit \`${meta.commit}\`, ${meta.date.slice(0, 10)}, ${meta.graphify}, graph of ${meta.graph.nodes} nodes / ${meta.graph.edges} edges built in ${secs(meta.graphBuildMs)}.`
      : "",
    "",
  ];
  if (notes) lines.push(notes, "");
  if (agent) {
    lines.push(
      "## Pre-registered verdicts",
      "",
      verdicts(agent, haiku, sonnetAcc),
      "",
    );
    lines.push(
      "## By task group (graph arm ÷ arm A)",
      "",
      ...setupLines(agent),
      "",
      "Ratios are geometric means over the group's tasks of mean(arm) ÷ mean(A) with 95% bootstrap CIs (2,000 resamples of runs within each cell); below 1 is better. " +
        "Accuracy Δ is in percentage points. **Input tokens** are all prompt tokens processed (mostly cached prefix, so they track turns); " +
        "**task tokens** subtract the fixed per-call prefix (system prompt and tool schemas) and measure what the task itself pulled into context; **cost** is the CLI's AI-unit accounting.",
      "",
      groupSection(agent),
      "",
      "### Per task",
      "",
      ...taskSection(agent),
    );
  }
  if (haiku) {
    lines.push(
      `## Cheap model: ${haiku.meta.model}`,
      "",
      ...setupLines(haiku),
      "",
      groupSection(haiku),
      "",
      ...taskSection(haiku),
    );
  }
  if (scripted) lines.push(...scriptedSection(scripted));
  lines.push(
    "## Tasks",
    "",
    table(
      ["Task", "Group", "Scoring", "Answer key"],
      TASKS.map((t) => [
        `**${t.id}** ${t.title}`,
        t.group,
        t.scoring === "set" ? "F1 (closed set)" : "recall",
        `${t.key.length} items`,
      ]),
    ),
    "",
    "## Method",
    "",
    "- **Isolation.** Each arm is a git worktree of the same commit outside the repository with `scripts/bench-graphify` removed (no answer-key leaks). " +
      'One graph is built (`graphify update .`, fixed hash seed) and copied to G, M and H. A has no `graphify-out/`, no Graphify skill and a `PATH` shim that makes `graphify` "command not found". ' +
      "Each arm's `.github/copilot-instructions.md` is replaced by its protocol in [arm-files/](arm-files/) (A gets equally detailed efficient-search tips, so the comparison is protocol against protocol). " +
      "M has the CLI shimmed and the MCP server attached with `--additional-mcp-config`; H adds [arm-files/hooks](arm-files/hooks/). Every run gets an empty `COPILOT_HOME` and `--disable-builtin-mcps`.",
    "- **Prompts.** Identical for every arm and never mention Graphify: arms differ only in what the repository provides.",
    "- **Answer keys.** Computed with the TypeScript language service (call hierarchy, references) and the import graph in [ground-truth.ts](ground-truth.ts), frozen in [answer-keys.json](answer-keys.json); H6, T2, T8 and the H7 docs were traced by hand ([tasks.ts](tasks.ts)). Keys never come from Graphify.",
    "- **Scoring.** The final JSON block is matched by file and symbol: closed sets score F1, open-ended tasks recall; failed runs score 0. No LLM judge.",
    "- **Tokens.** From the CLI's `session.usage_checkpoint`. Retrieved tokens are o200k counts of every tool result the model received.",
    "",
    "## Threats to validity",
    "",
    "- 3 repeats per cell: CIs are wide on single tasks; group-level ratios are the headline.",
    "- One codebase and Graphify's TypeScript call extraction: tests link to code mostly through imports (H4 is expected to favour grep), and string-built HTTP paths are invisible to the graph (T8).",
    "- Structural tasks were chosen because they are graph-shaped; the claim is about that class of question, which v1 did not test. Controls (T7, v1 tasks) show the cost elsewhere.",
    "- The A protocol is written to be fair, but any protocol can be improved; the arms compare realistic setups, not optimal ones.",
    "",
  );
  writeFileSync(join(BENCH_DIR, "REPORT.md"), lines.join("\n"));
  console.log(`Wrote ${join(BENCH_DIR, "REPORT.md")}`);
}
