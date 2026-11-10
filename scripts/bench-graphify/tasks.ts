// Benchmark tasks: an agentic question about Touchline, its frozen answer key, and the scripted retrieval recipe per arm.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const BENCH_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(BENCH_DIR, "../..");

export type Arm = "A" | "B" | "C";
/** Scripted mode only compares A and B: C differs from B in the agent prompt alone. */
export type ScriptedArm = "A" | "B";
export const ARMS: Arm[] = ["A", "B", "C"];
export const ARM_LABEL: Record<Arm, string> = {
  A: "A: grep/read",
  B: "B: Graphify available",
  C: "C: Graphify, nudged",
};

/** The only difference between arms B and C. */
export const NUDGE =
  "This repository has a Graphify code knowledge graph (graphify-out/graph.json). Start with the graphify CLI (graphify query, explain, path, affected) to locate the code, then verify with targeted reads.";

export interface KeyItem {
  file: string;
  symbol?: string;
}

export interface Task {
  id: string;
  title: string;
  /** strength: graph-shaped questions Graphify should win; control: trivial lookups; limitation: links the graph cannot see. */
  kind: "strength" | "control" | "limitation";
  question: string;
  key: KeyItem[];
  /** "set": the key is a closed set, so precision counts; "recall": open-ended, only recall counts. */
  scoring: "set" | "recall";
  /** Items tied with the last key item: accepted as correct without being required. */
  alsoAccept?: KeyItem[];
  /** Regexes the final answer text must match (facts that are not file/symbol items). */
  facts?: RegExp[];
  /** Shell commands an informed developer would run per arm (scripted mode); run from the arm's worktree. */
  recipes: Record<ScriptedArm, string[]>;
}

interface Ranked {
  top: { key: string; count: number }[];
  acceptable: { key: string; count: number }[];
}
interface Keys {
  t1: Ranked;
  t3: string[];
  t5: { function: string; callees: string[] };
  t6: Ranked;
}
const keys: Keys = JSON.parse(
  readFileSync(join(BENCH_DIR, "answer-keys.json"), "utf8"),
);
const item = (ref: string): KeyItem => {
  const [file, symbol] = ref.split("#");
  return symbol ? { file, symbol } : { file };
};

export const ANSWER_FORMAT = `End your reply with exactly one fenced \`\`\`json block shaped like
{"items": [{"file": "path/relative/to/repo/root.ts", "symbol": "functionOrSymbolName"}]}
Use "symbol": null when an item is a whole file. List only items you verified in the code.`;

export const TASKS: Task[] = [
  {
    id: "T1",
    title: "Orientation: most-imported server modules",
    kind: "strength",
    question:
      "I'm new to this codebase. Which 5 modules under server/ are imported by the most other non-test source files (in server/, shared/, src/ and scripts/; *.test.ts files excluded)? Rank them.",
    key: keys.t1.top.map(({ key }) => item(key)),
    alsoAccept: keys.t1.acceptable.map(({ key }) => item(key)),
    scoring: "set",
    recipes: {
      A: [
        `grep -rhoE 'from "(\\.\\./|\\./)+(server/)?[a-z0-9-]+\\.ts"' server shared src scripts --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx' | sort | uniq -c | sort -rn | head -30`,
      ],
      B: [
        `graphify god-nodes --top 15`,
        `graphify query "which server modules are imported by the most files" --budget 1500`,
      ],
    },
  },
  {
    id: "T2",
    title: "Multi-hop: HTTP advance route to the match engine",
    kind: "strength",
    question:
      "When the player advances the game by a day, trace the server call chain from the Express route handler down to the detailed match engine function that simulates a followed (user-watched) fixture. List each function in call order with its file.",
    key: [
      { file: "server/app.ts" },
      { file: "server/simulation.ts", symbol: "advance" },
      { file: "server/simulation.ts", symbol: "playFixture" },
      { file: "server/fast-match.ts", symbol: "simulateFixture" },
      { file: "server/match.ts", symbol: "simulateMatch" },
    ],
    scoring: "recall",
    recipes: {
      A: [
        `grep -n 'app\\.post(' -A1 server/app.ts | grep -iE 'advance|continue|day'`,
        `grep -n -A30 '"/api/advance"' server/app.ts`,
        `grep -n -A85 '^export async function advance' server/simulation.ts`,
        `grep -n 'simulateFixture\\|simulateMatch\\|simulateFastMatch' server/simulation.ts server/fast-match.ts`,
      ],
      B: [
        `graphify query "advance day route handler" --budget 1000`,
        `graphify path "advance" "simulateMatch"`,
      ],
    },
  },
  {
    id: "T3",
    title: "Blast radius: new required parameter on simulateMatch",
    kind: "strength",
    question:
      "I'm going to add a new required parameter to simulateMatch in server/match.ts. Which other files will fail to type-check (tests included) until they are updated? List every file.",
    key: keys.t3.map(item),
    scoring: "set",
    recipes: {
      A: [
        `grep -rnw "simulateMatch" server shared src scripts --include='*.ts' --include='*.tsx'`,
      ],
      B: [`graphify affected "simulateMatch" --depth 1`],
    },
  },
  {
    id: "T4",
    title: "Change plan: schema migration 12 adding a world table",
    kind: "strength",
    question:
      "I need to add schema migration 12 that creates a new per-world table club_rivalries with an identity id column. Which files and symbols must I change, which repository docs list the migrations, and which test files should cover it?",
    key: [
      { file: "server/sql-schema.ts", symbol: "schemaMigrations" },
      { file: "server/sql-schema.ts", symbol: "WORLD_TABLES" },
      { file: "server/sql-schema.ts", symbol: "IDENTITY_TABLES" },
      { file: "server/sql-schema.ts", symbol: "ADDED_WORLD_TABLES" },
      { file: "CONTRIBUTING.md" },
      { file: "server/db.test.ts" },
      { file: "server/saves.test.ts" },
    ],
    scoring: "recall",
    recipes: {
      A: [
        `grep -rn "version: 11" server --include='*.ts'`,
        `grep -n "^export" server/sql-schema.ts`,
        `grep -rln "schemaMigrations\\|WORLD_TABLES" server scripts --include='*.ts'`,
        `grep -n -i "migration" CONTRIBUTING.md`,
      ],
      B: [
        `graphify explain "schemaMigrations"`,
        `graphify query "add a world table schema migration" --budget 1500`,
      ],
    },
  },
  {
    id: "T5",
    title: "Side effects: completing an AI club's transfer",
    kind: "strength",
    question:
      "Find the function that completes an AI club's permanent transfer signing, then list every project function it calls directly (helpers it calls by name; ignore methods such as store.run). Give each callee with the file that defines it.",
    key: [item(keys.t5.function), ...keys.t5.callees.map(item)],
    scoring: "set",
    recipes: {
      A: [
        `grep -rnE "export async function \\w*[Tt]ransfer\\w*\\(" server --include='*.ts' --exclude='*.test.ts'`,
        `grep -n -A60 '^export async function executeMarketTransfer' server/transfer-battles.ts`,
        `grep -n '^import' -A3 server/transfer-battles.ts`,
      ],
      B: [
        `graphify query "complete AI club permanent transfer signing" --budget 1000`,
        `graphify explain "executeMarketTransfer"`,
      ],
    },
  },
  {
    id: "T6",
    title: "Risky hubs: most widely imported exported symbols",
    kind: "strength",
    question:
      "Before a refactor I want the riskiest shared symbols. Which 10 exported symbols (functions, classes, types or constants) are imported by the most distinct non-test files across server/, shared/, src/ and scripts/? Rank them.",
    key: keys.t6.top.map(({ key }) => item(key)),
    alsoAccept: keys.t6.acceptable.map(({ key }) => item(key)),
    scoring: "set",
    recipes: {
      A: [
        `grep -rhoE "import (type )?\\{[^}]+\\} from" server shared src scripts --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx' | sed -E 's/import (type )?\\{//; s/\\} from//' | tr ',' '\\n' | sed -E 's/^ *(type )?//; s/ as .*//; s/ *$//' | grep -v '^$' | sort | uniq -c | sort -rn | head -25`,
      ],
      B: [`graphify god-nodes --top 15`],
    },
  },
  {
    id: "T7",
    title: "Control: where is clamp defined",
    kind: "control",
    question:
      "Where is the shared clamp helper defined, and what are its parameters and their default values?",
    key: [{ file: "shared/rules.ts", symbol: "clamp" }],
    scoring: "set",
    facts: [/\b1\b[\s\S]*\b99\b/],
    recipes: {
      A: [
        `grep -rnE "(const|function) clamp\\b" -A2 server shared src scripts --include='*.ts' --include='*.tsx'`,
      ],
      B: [`graphify explain "clamp"`],
    },
  },
  {
    id: "T8",
    title: "Limitation: UI caller to Express handler across an HTTP string",
    kind: "limitation",
    question:
      "Which React code requests the GET /api/clubs/:id/transfers endpoint, and which server code serves it? Give the client function that builds the request path, the component that fetches it, the file registering the Express route, and the server function that produces the response.",
    key: [
      { file: "src/club-transfers.ts", symbol: "clubTransfersPath" },
      { file: "src/ClubTransfers.tsx", symbol: "ClubTransfers" },
      { file: "server/app.ts" },
      { file: "server/club-transfers.ts", symbol: "clubTransfers" },
    ],
    scoring: "recall",
    recipes: {
      A: [
        `grep -n -A3 '"/api/clubs/:id/transfers"' server/app.ts`,
        `grep -rn "/transfers" src --include='*.ts' --include='*.tsx' --exclude='*.test.ts'`,
        `grep -rn "clubTransfersPath" src --include='*.tsx'`,
      ],
      B: [
        `graphify query "club transfers endpoint UI fetch" --budget 1500`,
        `graphify explain "clubTransfers"`,
      ],
    },
  },
];

export const promptFor = (task: Task, arm: Arm) =>
  `You are working in the Touchline repository (the current directory). Investigate the code to answer the question below. Do not modify, create or delete any files.${arm === "C" ? `\n\n${NUDGE}` : ""}

Question: ${task.question}

${ANSWER_FORMAT}`;
