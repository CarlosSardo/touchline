// Renders results/*.json into REPORT.md (plain markdown tables, no external tooling).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentResult } from "./agent.ts";
import type { ScriptedResult } from "./scripted.ts";
import {
  ARM_LABEL,
  ARMS,
  BENCH_DIR,
  NUDGE,
  TASKS,
  type Arm,
  type Task,
} from "./tasks.ts";

const RESULTS = join(BENCH_DIR, "results");
const load = <T>(name: string): T | null =>
  existsSync(join(RESULTS, name))
    ? JSON.parse(readFileSync(join(RESULTS, name), "utf8"))
    : null;

const median = (values: number[]) => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const int = (n: number) =>
  Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "–";
const k = (n: number) =>
  Number.isFinite(n)
    ? n >= 10_000
      ? `${(n / 1000).toFixed(0)}k`
      : n >= 1000
        ? `${(n / 1000).toFixed(1)}k`
        : `${Math.round(n)}`
    : "–";
const pct = (n: number) =>
  Number.isFinite(n) ? `${Math.round(n * 100)}%` : "–";
const secs = (ms: number) =>
  Number.isFinite(ms) ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s` : "–";
const delta = (a: number, b: number) =>
  Number.isFinite(a) && Number.isFinite(b) && a
    ? `${b <= a ? "−" : "+"}${Math.abs(Math.round((1 - b / a) * 100))}%`
    : "–";
const table = (header: string[], rows: string[][]) =>
  [
    `| ${header.join(" | ")} |`,
    `|${header.map((h, i) => (i ? " ---: " : " --- ")).join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
const kindLabel: Record<Task["kind"], string> = {
  strength: "graph-shaped",
  control: "control",
  limitation: "known limitation",
};

function agentSection(data: { meta: any; results: AgentResult[] }) {
  const { meta, results } = data;
  const arms = ARMS.filter((arm) => results.some((r) => r.arm === arm));
  const by = (task: string, arm: Arm) =>
    results.filter((r) => r.task === task && r.arm === arm);
  const ok = (runs: AgentResult[]) => runs.filter((r) => r.ok);
  const acc = (runs: AgentResult[]) =>
    mean(runs.map((r) => (r.ok ? r.score.accuracy : 0)));
  const per = (runs: AgentResult[], f: (r: AgentResult) => number) =>
    mean(ok(runs).map(f));
  const lines: string[] = [];

  const strength = new Set(
    TASKS.filter((t) => t.kind === "strength").map((t) => t.id),
  );
  lines.push(`## Agent mode (headline)`, "");
  lines.push(
    `Real Copilot CLI sessions: model \`${meta.model}\`, ${meta.repeats} repeats × ${new Set(results.map((r) => r.task)).size} tasks × ${arms.length} arms = ${results.length} runs, ` +
      `up to ${meta.concurrency} sessions in parallel (total wall time ${secs(meta.totalWallMs)}). Each run had a fresh empty \`COPILOT_HOME\` ` +
      `(no user skills, MCP servers or memory) and its arm's worktree. Means per run; accuracy is scored mechanically against the answer keys.`,
    "",
  );
  for (const [title, filter] of [
    ["Graph-shaped tasks (T1–T6)", (r: AgentResult) => strength.has(r.task)],
    ["All tasks (T1–T8)", () => true],
  ] as const) {
    const runs = Object.fromEntries(
      arms.map((arm) => [
        arm,
        results.filter((r) => r.arm === arm && filter(r)),
      ]),
    ) as Record<Arm, AgentResult[]>;
    const row = (
      label: string,
      f: (runs: AgentResult[]) => number,
      show: (n: number) => string,
      compare = true,
    ) => [
      label,
      ...arms.map((arm) => show(f(runs[arm]))),
      ...arms
        .slice(1)
        .map((arm) => (compare ? delta(f(runs.A), f(runs[arm])) : "")),
    ];
    lines.push(`### ${title}`, "");
    lines.push(
      table(
        [
          "Metric (mean per run)",
          ...arms.map((arm) => ARM_LABEL[arm]),
          ...arms.slice(1).map((arm) => `${arm} vs A`),
        ],
        [
          [
            "Accuracy",
            ...arms.map((arm) => pct(acc(runs[arm]))),
            ...arms
              .slice(1)
              .map(
                (arm) =>
                  `${acc(runs[arm]) >= acc(runs.A) ? "+" : "−"}${Math.abs(Math.round((acc(runs[arm]) - acc(runs.A)) * 100))} pts`,
              ),
          ],
          row(
            "Input tokens (all model calls)",
            (r) => per(r, (x) => x.inputTokens),
            int,
          ),
          row(
            "…uncached + cache-written",
            (r) => per(r, (x) => x.uncachedInputTokens + x.cacheWriteTokens),
            int,
          ),
          row("Output tokens", (r) => per(r, (x) => x.outputTokens), int),
          row(
            "Model calls",
            (r) => per(r, (x) => x.modelCalls),
            (n) => n.toFixed(1),
          ),
          row(
            "Tool calls",
            (r) => per(r, (x) => x.toolCalls),
            (n) => n.toFixed(1),
          ),
          row("Wall time", (r) => per(r, (x) => x.wallMs), secs),
          row(
            "AI units (billing)",
            (r) => per(r, (x) => x.nanoAiu / 1e9),
            (n) => n.toFixed(2),
          ),
          row(
            "System prompt tokens",
            (r) => median(ok(r).map((x) => x.promptTokens)),
            int,
            false,
          ),
          row(
            "Runs that used graphify",
            (r) =>
              r.filter((x) => x.graphifyCalls > 0).length /
              Math.max(1, r.length),
            pct,
            false,
          ),
          row(
            "Hallucinated items (total)",
            (r) => sum(ok(r).map((x) => x.score.hallucinated.length)),
            String,
            false,
          ),
          row("Failed runs", (r) => r.length - ok(r).length, String, false),
        ],
      ),
      "",
    );
  }

  lines.push(
    `### Per task`,
    "",
    `Values are ${arms.join(" / ")}. Accuracy is the mean over repeats, the rest are medians.`,
    "",
  );
  const rows = TASKS.map((task) => {
    const cell = (f: (runs: AgentResult[]) => string) =>
      arms.map((arm) => f(by(task.id, arm))).join(" / ");
    const med = (f: (r: AgentResult) => number) => (runs: AgentResult[]) =>
      median(ok(runs).map(f));
    return [
      `**${task.id}** ${task.title} _(${kindLabel[task.kind]})_`,
      cell((r) => pct(acc(r))),
      cell((r) => k(med((x) => x.inputTokens)(r))),
      cell((r) => secs(med((x) => x.wallMs)(r))),
      cell((r) => String(med((x) => x.toolCalls)(r))),
      cell((r) => String(sum(ok(r).map((x) => x.score.hallucinated.length)))),
      arms
        .slice(1)
        .map(
          (arm) =>
            `${by(task.id, arm).filter((r) => r.graphifyCalls > 0).length}/${by(task.id, arm).length}`,
        )
        .join(" / "),
    ];
  });
  lines.push(
    table(
      [
        "Task",
        "Accuracy",
        "Input tokens",
        "Wall time",
        "Tool calls",
        "Hallucinated",
        `Used graphify (${arms.slice(1).join(" / ")})`,
      ],
      rows,
    ),
    "",
  );

  const misses = TASKS.flatMap((task) =>
    arms.map((arm) => {
      const counts = new Map<string, number>();
      for (const r of by(task.id, arm))
        for (const miss of r.ok ? r.score.missed : ["(run failed)"])
          counts.set(miss, (counts.get(miss) ?? 0) + 1);
      return counts.size
        ? `- **${task.id} ${arm}** missed: ${[...counts].map(([item, n]) => `\`${item}\` ×${n}`).join(", ")}`
        : "";
    }),
  ).filter(Boolean);
  if (misses.length) lines.push(`### What each arm missed`, "", ...misses, "");
  const commands = [
    ...new Set(
      results.flatMap((r) =>
        r.graphifyCommands.map((c) =>
          c
            .replace(/^cd [^&;]+(&&|;)\s*/, "")
            .split("\n")[0]
            .replace(/\s+/g, " ")
            .slice(0, 100),
        ),
      ),
    ),
  ];
  if (commands.length)
    lines.push(
      `<details><summary>Graphify commands the agents chose (${commands.length} distinct)</summary>`,
      "",
      ...commands.slice(0, 50).map((c) => `- \`${c.replace(/`/g, "'")}\``),
      "",
      "</details>",
      "",
    );
  return lines;
}

function scriptedSection(data: { meta: any; results: ScriptedResult[] }) {
  const { meta, results } = data;
  const get = (task: string, arm: string) =>
    results.find((r) => r.task === task && r.arm === arm);
  const lines = [`## Scripted mode (retrieval cost only)`, ""];
  lines.push(
    `Each task's fixed retrieval recipe (what an informed developer or agent would run first) per arm: output size in o200k tokens, ` +
      `context recall (answer-key items present in the output) and median wall time over ${meta.timingReps} alternating serial runs. ` +
      `Recipes are hand-written, so this isolates retrieval cost but not search strategy; see the commands in [tasks.ts](tasks.ts).`,
    "",
  );
  const rows = TASKS.filter((t) => get(t.id, "A")).map((task) => {
    const [a, b] = [get(task.id, "A")!, get(task.id, "B")!];
    return [
      `**${task.id}** _(${kindLabel[task.kind]})_`,
      `${int(a.tokens)} → ${int(b.tokens)} (${delta(a.tokens, b.tokens)})`,
      `${pct(a.contextRecall)} → ${pct(b.contextRecall)}`,
      `${int(a.medianMs)} → ${int(b.medianMs)} ms`,
    ];
  });
  const totalA = sum(results.filter((r) => r.arm === "A").map((r) => r.tokens));
  const totalB = sum(results.filter((r) => r.arm === "B").map((r) => r.tokens));
  rows.push([
    `**Total**`,
    `${int(totalA)} → ${int(totalB)} (${delta(totalA, totalB)})`,
    `${pct(mean(results.filter((r) => r.arm === "A").map((r) => r.contextRecall)))} → ${pct(mean(results.filter((r) => r.arm === "B").map((r) => r.contextRecall)))}`,
    "",
  ]);
  lines.push(
    table(
      ["Task", "Tokens A → B", "Context recall A → B", "Median time A → B"],
      rows,
    ),
    "",
  );
  lines.push(
    `One-off cost for B: rebuilding the graph took ${secs(meta.graphBuildMs)} (${int(meta.graph.nodes)} nodes, ${int(meta.graph.edges)} edges, no LLM).`,
    "",
  );
  return lines;
}

export function writeReport() {
  const agent = load<{ meta: any; results: AgentResult[] }>("agent.json");
  const scripted = load<{ meta: any; results: ScriptedResult[] }>(
    "scripted.json",
  );
  const meta = agent?.meta ?? scripted?.meta;
  const notes = existsSync(join(RESULTS, "notes.md"))
    ? readFileSync(join(RESULTS, "notes.md"), "utf8").trim()
    : "";
  const lines = [
    "# Graphify benchmark: agentic changes to Touchline",
    "",
    `Does the [Graphify](https://github.com/Graphify-Labs/graphify) code graph make a coding agent cheaper and more accurate on Touchline? ` +
      `Arm **A** answers with normal search (grep, file reads); arm **B** has the committed graph, the Graphify skill and Copilot instructions; ` +
      `arm **C** is B plus one prompt line asking the agent to start with the graphify CLI. Same question, model and tools otherwise. Generated by \`npm run bench:graphify\` ([index.ts](index.ts)); raw data in [results/](results/).`,
    "",
    meta
      ? `Commit \`${meta.commit}\`, ${meta.date.slice(0, 10)}, ${meta.graphify}${agent ? `, ${agent.meta.copilot} CLI` : ""}.`
      : "",
    "",
  ];
  if (notes) lines.push(notes, "");
  if (agent) lines.push(...agentSection(agent));
  if (scripted) lines.push(...scriptedSection(scripted));
  lines.push(
    "## Tasks",
    "",
    table(
      ["Task", "Kind", "Scoring", "Answer key"],
      TASKS.map((t) => [
        `**${t.id}** ${t.title}`,
        kindLabel[t.kind],
        t.scoring === "set" ? "F1 (closed set)" : "recall",
        `${t.key.length} items${t.alsoAccept && t.alsoAccept.length > t.key.length ? ` (+${t.alsoAccept.length - t.key.length} tied)` : ""}`,
      ]),
    ),
    "",
    "## Method",
    "",
    "- **Isolation.** Each arm is a git worktree of the same commit outside the repository with `scripts/bench-graphify` removed (no answer-key leaks). " +
      'A also loses `graphify-out/`, `.github/skills/graphify` and `.github/copilot-instructions.md`, and a `PATH` shim makes `graphify` "command not found". ' +
      "B rebuilds its graph from the stripped tree. Every agent run gets an empty `COPILOT_HOME`, `--disable-builtin-mcps`, the same model and reasoning effort.",
    `- **Prompts.** A and B get the same prompt, which never mentions Graphify: B agents only learn about it from the repository's skill and instructions, so B measures organic adoption. C adds exactly one line: "${NUDGE}"`,
    "- **Answer keys.** T1, T5 and T6 come from the TypeScript compiler API, T3 from the project's own `tsc` after really adding a required parameter, and T2, T4, T7 and T8 were traced by hand ([ground-truth.ts](ground-truth.ts), [tasks.ts](tasks.ts)).",
    "- **Scoring.** The agent's final JSON block is matched by file and symbol; closed-set tasks score F1, open-ended ones recall. Items naming a missing file, or a symbol absent from the named file, count as hallucinated. No LLM judge.",
    "- **Tokens.** Agent mode reports the CLI's own accounting (`session.usage_checkpoint`): input tokens include cached prompt tokens, which dominate every run (system prompt and tool schemas, about 24k per call). Scripted mode counts retrieved output with tiktoken o200k.",
    "",
    "## Threats to validity",
    "",
    "- Small sample (3 repeats per cell); model sampling noise is visible in the per-task spread, so read single-task differences cautiously.",
    "- One codebase, one model. Graph usefulness depends on how well Graphify's TypeScript extraction resolves calls (it marks inferred edges; `.run()` style method calls are approximate).",
    "- The control (T7) and limitation (T8) tasks are included on purpose: Graphify should not help with a one-grep lookup, and it cannot link a client URL string to an Express route.",
    "- B agents may ignore the graph; the 'used graphify' figures show how often each arm actually called it. C shows the value when the graph is used, B what the repository integration achieves on its own.",
    "- Scripted recipes are written with hindsight (the author knew the answers); they bound retrieval cost but say nothing about search strategy.",
    "",
  );
  writeFileSync(join(BENCH_DIR, "REPORT.md"), lines.join("\n"));
  console.log(`Wrote ${join(BENCH_DIR, "REPORT.md")}`);
}
