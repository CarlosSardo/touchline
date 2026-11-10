// Agent mode: real Copilot CLI sessions per task × arm × repeat, run with memory-bounded maximum concurrency.
// Each run gets a fresh, empty COPILOT_HOME (no user skills, MCP servers or memories) and the arm's worktree.
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import type { ArmEnv } from "./arms.ts";
import { score, type Score } from "./score.ts";
import { ARMS, promptFor, TASKS, type Arm, type Task } from "./tasks.ts";

export interface AgentResult {
  task: string;
  arm: Arm;
  repeat: number;
  model: string;
  ok: boolean;
  error?: string;
  attempts: number;
  wallMs: number;
  apiMs: number;
  /** All prompt tokens processed across model calls (includes cache reads and writes). */
  inputTokens: number;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  modelCalls: number;
  premiumRequests: number;
  nanoAiu: number;
  toolCalls: number;
  toolNames: Record<string, number>;
  filesViewed: number;
  graphifyCalls: number;
  graphifyCommands: string[];
  /** Prompt size of the final model call (system prompt plus the whole conversation so far). */
  promptTokens: number;
  score: Score;
  answer: string;
  log: string;
}

const MB = 1024 * 1024;
const PER_RUN_MB = 700;

/** "Max" concurrency: bounded by available memory (about PER_RUN_MB per Copilot process) and by the job count. */
export function maxConcurrency(jobs: number, requested?: number) {
  const available =
    Number(
      /MemAvailable:\s+(\d+)/.exec(
        readFileSync("/proc/meminfo", "utf8"),
      )?.[1] ?? 0,
    ) * 1024;
  const byMemory = Math.max(
    1,
    Math.floor((available - 2048 * MB) / (PER_RUN_MB * MB)),
  );
  return Math.max(
    1,
    Math.min(jobs, requested ?? Infinity, byMemory, cpus().length * 3),
  );
}

interface Parsed {
  answer: string;
  usage: Record<string, number>;
  apiMs: number;
  premium: number;
  nanoAiu: number;
  calls: { name: string; args: Record<string, unknown> }[];
  promptTokens: number;
  exitCode: number | null;
}

/** True when a shell command invokes the graphify CLI (not merely mentions `graphify-out`). */
export const runsGraphify = (command: string) =>
  /(?:^|[\s;&|(])graphify(?:\s|$)/.test(command);

function parseEvents(jsonl: string): Parsed {
  const parsed: Parsed = {
    answer: "",
    usage: {},
    apiMs: 0,
    premium: 0,
    nanoAiu: 0,
    calls: [],
    promptTokens: 0,
    exitCode: null,
  };
  for (const line of jsonl.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    let event: { type: string; data?: any; exitCode?: number; usage?: any };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "assistant.message") {
      if (typeof event.data?.content === "string" && event.data.content.trim())
        parsed.answer = event.data.content;
      for (const request of event.data?.toolRequests ?? []) {
        let args = request.arguments ?? {};
        if (typeof args === "string")
          try {
            args = JSON.parse(args);
          } catch {
            args = { raw: args };
          }
        parsed.calls.push({ name: request.name ?? "unknown", args });
      }
    } else if (event.type === "session.usage_checkpoint") {
      const snapshot = event.data?.accountingSnapshot ?? {};
      const usage: Record<string, number> = {};
      for (const metrics of Object.values<any>(snapshot.modelMetrics ?? {})) {
        for (const [field, value] of Object.entries<number>(
          metrics.usage ?? {},
        ))
          usage[field] = (usage[field] ?? 0) + value;
        usage.modelCalls =
          (usage.modelCalls ?? 0) + (metrics.requests?.count ?? 0);
      }
      usage.uncachedInput = snapshot.tokenDetails?.input?.tokenCount ?? 0;
      parsed.usage = usage;
      parsed.apiMs = snapshot.totalApiDurationMs ?? 0;
      parsed.premium = snapshot.totalPremiumRequestCost ?? 0;
      parsed.nanoAiu = snapshot.totalNanoAiu ?? 0;
      for (const state of event.data?.promptCacheBreakState ?? [])
        for (const model of Object.values<any>(state.models ?? {}))
          parsed.promptTokens ||= model.prompt_tokens ?? 0;
    } else if (event.type === "result") {
      parsed.exitCode = event.exitCode ?? null;
      parsed.premium ||= event.usage?.premiumRequests ?? 0;
    }
  }
  return parsed;
}

function runOnce(
  task: Task,
  armEnv: ArmEnv,
  home: string,
  log: string,
  model: string,
  timeoutMs: number,
) {
  mkdirSync(home, { recursive: true });
  const args = [
    "-p",
    promptFor(task, armEnv.arm),
    "--output-format",
    "json",
    "--allow-all",
    "--no-ask-user",
    "--disable-builtin-mcps",
    "--model",
    model,
    "--reasoning-effort",
    "medium",
  ];
  return new Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
    wallMs: number;
    timedOut: boolean;
  }>((resolve) => {
    const started = performance.now();
    const child = spawn("copilot", args, {
      cwd: armEnv.dir,
      env: { ...armEnv.env, COPILOT_HOME: home, COPILOT_ALLOW_ALL: "true" },
    });
    const file = createWriteStream(log);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      file.write(chunk);
    });
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => {
      clearTimeout(timer);
      file.end();
      resolve({
        stdout,
        stderr,
        code,
        wallMs: performance.now() - started,
        timedOut,
      });
    });
  });
}

const RETRYABLE =
  /rate.?limit|429|too many requests|overloaded|503|ECONNRESET|timed? ?out/i;

export async function runAgent(
  task: Task,
  armEnv: ArmEnv,
  repeat: number,
  runDir: string,
  model: string,
  timeoutMs: number,
): Promise<AgentResult> {
  const name = `${task.id}-${armEnv.arm}-r${repeat}`;
  let attempt = 0;
  for (;;) {
    attempt++;
    const log = join(runDir, "logs", `${name}-a${attempt}.jsonl`);
    const run = await runOnce(
      task,
      armEnv,
      join(runDir, "homes", `${name}-a${attempt}`),
      log,
      model,
      timeoutMs,
    );
    const parsed = parseEvents(run.stdout);
    const failed = run.timedOut || run.code !== 0 || !parsed.answer;
    if (
      failed &&
      attempt < 4 &&
      !run.timedOut &&
      RETRYABLE.test(run.stderr + run.stdout.slice(-4000))
    ) {
      await new Promise((resolve) =>
        setTimeout(resolve, 15_000 * 2 ** (attempt - 1) * (1 + Math.random())),
      );
      continue;
    }
    const commands = parsed.calls.flatMap(({ args }) =>
      typeof args.command === "string" ? [args.command] : [],
    );
    const graphifyCommands = commands.filter(runsGraphify);
    const viewed = new Set(
      parsed.calls.flatMap(({ name: tool, args }) =>
        tool === "view" && typeof args.path === "string" ? [args.path] : [],
      ),
    );
    const toolNames: Record<string, number> = {};
    for (const { name: tool } of parsed.calls)
      toolNames[tool] = (toolNames[tool] ?? 0) + 1;
    return {
      task: task.id,
      arm: armEnv.arm,
      repeat,
      model,
      ok: !failed,
      error: failed
        ? run.timedOut
          ? "timeout"
          : (run.stderr.trim().split("\n").pop() ?? `exit ${run.code}`)
        : undefined,
      attempts: attempt,
      wallMs: run.wallMs,
      apiMs: parsed.apiMs,
      inputTokens: parsed.usage.inputTokens ?? 0,
      uncachedInputTokens: parsed.usage.uncachedInput ?? 0,
      cacheReadTokens: parsed.usage.cacheReadTokens ?? 0,
      cacheWriteTokens: parsed.usage.cacheWriteTokens ?? 0,
      outputTokens: parsed.usage.outputTokens ?? 0,
      reasoningTokens: parsed.usage.reasoningTokens ?? 0,
      modelCalls: parsed.usage.modelCalls ?? 0,
      premiumRequests: parsed.premium,
      nanoAiu: parsed.nanoAiu,
      toolCalls: parsed.calls.length,
      toolNames,
      filesViewed: viewed.size,
      graphifyCalls: graphifyCommands.length,
      graphifyCommands,
      promptTokens: parsed.promptTokens,
      score: score(task, parsed.answer, armEnv.dir),
      answer: parsed.answer,
      log,
    };
  }
}

/** Runs every task × arm × repeat with at most `concurrency` sessions in flight; the arms of one task and repeat start together. */
export async function runAgents(
  arms: Record<Arm, ArmEnv>,
  options: {
    runDir: string;
    model: string;
    repeats: number;
    concurrency?: number;
    timeoutMs: number;
    tasks?: Task[];
    arms?: Arm[];
    onResult?: (result: AgentResult, done: number, total: number) => void;
  },
) {
  mkdirSync(join(options.runDir, "logs"), { recursive: true });
  const jobs: { task: Task; arm: Arm; repeat: number }[] = [];
  for (let repeat = 1; repeat <= options.repeats; repeat++)
    for (const task of options.tasks ?? TASKS)
      for (const arm of options.arms ?? ARMS) jobs.push({ task, arm, repeat });
  const limit = maxConcurrency(jobs.length, options.concurrency);
  const results: AgentResult[] = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { task, arm, repeat } = jobs[next++];
      const result = await runAgent(
        task,
        arms[arm],
        repeat,
        options.runDir,
        options.model,
        options.timeoutMs,
      );
      results.push(result);
      options.onResult?.(result, results.length, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return { results, concurrency: limit };
}
