// Mechanical scoring: parse the answer's final JSON block and compare it with the task's answer key (no LLM judge).
import { existsSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import type { KeyItem, Task } from "./tasks.ts";

export interface Score {
  parsed: boolean;
  answered: number;
  correct: number;
  recall: number;
  /** Only meaningful for closed-set tasks; null for open-ended ("recall") tasks. */
  precision: number | null;
  /** Items naming a file that does not exist, or a symbol absent from the named file. */
  hallucinated: string[];
  missed: string[];
  factsOk: boolean;
  /** Recall per named part of the key (planning tasks). */
  parts?: Record<string, number>;
  /** Headline per-run accuracy: F1 for closed sets, recall for open-ended tasks, 0 when a required fact is missing. */
  accuracy: number;
}

const cleanFile = (file: string) =>
  normalize(
    file
      .trim()
      .replace(/^\.\//, "")
      .replace(/[:#].*$/, ""),
  );
const cleanSymbol = (symbol: string | null | undefined) =>
  symbol
    ? symbol
        .trim()
        .replace(/^(export |async |function |const |default )+/g, "")
        .replace(/\(.*$/, "")
        .replace(/<.*$/, "")
        .trim()
    : undefined;

function lastJsonBlock(
  text: string,
): { items?: { file?: string; symbol?: string | null }[] } | null {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  for (const block of blocks.reverse()) {
    try {
      return JSON.parse(block[1]);
    } catch {}
  }
  return null;
}

const matches = (answer: KeyItem, key: KeyItem) => {
  if (answer.file !== key.file) return false;
  if (!key.symbol) return true;
  return (
    answer.symbol === key.symbol ||
    answer.symbol?.endsWith(`.${key.symbol}`) === true
  );
};
const label = (item: KeyItem) =>
  item.symbol ? `${item.file}#${item.symbol}` : item.file;

export function score(task: Task, text: string, root: string): Score {
  const json = lastJsonBlock(text);
  const raw = Array.isArray(json?.items) ? json.items : [];
  const answers: KeyItem[] = [];
  for (const entry of raw) {
    if (typeof entry?.file !== "string" || !entry.file.trim()) continue;
    const answer = {
      file: cleanFile(entry.file),
      symbol: cleanSymbol(entry.symbol),
    };
    if (
      !answers.some(
        (seen) => seen.file === answer.file && seen.symbol === answer.symbol,
      )
    )
      answers.push(answer);
  }

  const accepted = [...task.key, ...(task.alsoAccept ?? [])];
  const hit = new Set<string>();
  let correct = 0;
  const hallucinated: string[] = [];
  for (const answer of answers) {
    const match = accepted.find((key) => matches(answer, key));
    if (match) {
      correct++;
      hit.add(label(match));
      continue;
    }
    const path = join(root, answer.file);
    if (!existsSync(path)) hallucinated.push(label(answer));
    else if (
      answer.symbol &&
      /^[\w$]+$/.test(answer.symbol) &&
      !new RegExp(`\\b${answer.symbol.replace(/\$/g, "\\$")}\\b`).test(
        readFileSync(path, "utf8"),
      )
    )
      hallucinated.push(label(answer));
  }
  const required = task.key.length;
  const found = Math.min(required, hit.size);
  const recall = found / required;
  const precision =
    task.scoring === "set"
      ? answers.length
        ? correct / answers.length
        : 0
      : null;
  const factsOk = (task.facts ?? []).every((fact) => fact.test(text));
  const base =
    precision === null
      ? recall
      : precision + recall
        ? (2 * precision * recall) / (precision + recall)
        : 0;
  return {
    parsed: json !== null,
    answered: answers.length,
    correct,
    recall,
    precision,
    hallucinated,
    missed: task.key.filter((key) => !hit.has(label(key))).map(label),
    factsOk,
    parts: task.parts
      ? Object.fromEntries(
          Object.entries(task.parts).map(([name, items]) => [
            name,
            items.filter((key) => hit.has(label(key))).length / items.length,
          ]),
        )
      : undefined,
    accuracy: factsOk ? base : 0,
  };
}

/** Scripted mode: share of answer-key items whose file and symbol both appear in the retrieved text. */
export function contextRecall(task: Task, output: string) {
  const present = task.key.filter((key) => {
    const fileHit =
      output.includes(key.file) || output.includes(key.file.split("/").pop()!);
    return (
      fileHit && (!key.symbol || new RegExp(`\\b${key.symbol}\\b`).test(output))
    );
  });
  return present.length / task.key.length;
}
