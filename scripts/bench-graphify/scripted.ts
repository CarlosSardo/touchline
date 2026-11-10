// Scripted mode: runs each task's fixed retrieval recipe per arm and measures what an agent would have to ingest.
// Content (bytes, o200k tokens, context recall) is collected with every recipe in parallel;
// wall time comes from a separate serial pass (alternating arms, median of N) so runs do not contend for CPU.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArmEnv } from "./arms.ts";
import { contextRecall } from "./score.ts";
import { TASKS, type Arm, type ScriptedArm, type Task } from "./tasks.ts";

export interface ScriptedResult {
  task: string;
  arm: ScriptedArm;
  commands: string[];
  bytes: number;
  lines: number;
  tokens: number;
  contextRecall: number;
  medianMs: number;
  samplesMs: number[];
}

function runRecipe(
  task: Task,
  arm: ScriptedArm,
  { dir, env }: ArmEnv,
): Promise<{ output: string; ms: number }> {
  const script = task.recipes[arm]
    .map((command) => `echo '$ ${command.replace(/'/g, `'\\''`)}'; ${command}`)
    .join("\n");
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn("bash", ["-c", script], { cwd: dir, env });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", () =>
      resolve({ output, ms: performance.now() - started }),
    );
  });
}

/** o200k_base token counts via tiktoken in an ephemeral uv environment (no repository dependency). */
export function countTokens(texts: string[]): number[] {
  const dir = mkdtempSync(join(tmpdir(), "bench-tokens-"));
  try {
    writeFileSync(join(dir, "texts.json"), JSON.stringify(texts));
    const program = `import json,sys,tiktoken\nenc=tiktoken.get_encoding("o200k_base")\nprint(json.dumps([len(enc.encode(t, disallowed_special=())) for t in json.load(open(sys.argv[1]))]))`;
    const out = execFileSync(
      "uv",
      [
        "run",
        "--quiet",
        "--no-project",
        "--with",
        "tiktoken",
        "python",
        "-c",
        program,
        join(dir, "texts.json"),
      ],
      {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    return JSON.parse(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export async function runScripted(
  arms: Record<Arm, ArmEnv>,
  timingReps = 5,
  tasks = TASKS,
): Promise<ScriptedResult[]> {
  const jobs = tasks.flatMap((task) =>
    (["A", "B"] as const).map((arm) => ({ task, arm })),
  );
  const outputs = await Promise.all(
    jobs.map(({ task, arm }) => runRecipe(task, arm, arms[arm])),
  );
  const tokens = countTokens(outputs.map(({ output }) => output));
  const samples = jobs.map(() => [] as number[]);
  for (let rep = 0; rep < timingReps; rep++)
    for (let pair = 0; pair < jobs.length; pair += 2)
      for (const index of rep % 2 ? [pair + 1, pair] : [pair, pair + 1])
        samples[index].push(
          (
            await runRecipe(
              jobs[index].task,
              jobs[index].arm,
              arms[jobs[index].arm],
            )
          ).ms,
        );
  return jobs.map(({ task, arm }, index) => ({
    task: task.id,
    arm,
    commands: task.recipes[arm],
    bytes: Buffer.byteLength(outputs[index].output),
    lines: outputs[index].output.split("\n").length,
    tokens: tokens[index],
    contextRecall: contextRecall(task, outputs[index].output),
    medianMs: median(samples[index]),
    samplesMs: samples[index],
  }));
}
