// Benchmark tasks: an agentic question about Touchline, its frozen answer key, and the scripted retrieval recipe per arm.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const BENCH_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(BENCH_DIR, "../..");

export type Arm = "A" | "G" | "M" | "H";
/** Scripted mode compares the best grep recipe (A) with the best graph CLI recipe (G): the retrieval ceilings. */
export type ScriptedArm = "A" | "G";
export const ARMS: Arm[] = ["A", "G", "M", "H"];
export const ARM_LABEL: Record<Arm, string> = {
  A: "A: grep/read",
  G: "G: Graphify CLI",
  M: "M: Graphify MCP",
  H: "H: CLI + hook",
};

/**
 * structural: transitive or whole-repo questions where one graph command should replace a chain of searches (pre-registered win).
 * change-plan: multi-part plans mixing code, tests and docs. v1: one-hop questions kept from v1.
 * coverage: test discovery, where the graph links tests only through imports (expected loss).
 * control: a trivial lookup. limitation: a link the graph cannot see (URL string to Express route).
 */
export type Group =
  "structural" | "change-plan" | "v1" | "coverage" | "control" | "limitation";
export const GROUPS: Group[] = [
  "structural",
  "change-plan",
  "v1",
  "coverage",
  "control",
  "limitation",
];

export interface KeyItem {
  file: string;
  symbol?: string;
}

export interface Task {
  id: string;
  title: string;
  group: Group;
  question: string;
  key: KeyItem[];
  /** "set": the key is a closed set, so precision counts; "recall": open-ended, only recall counts. */
  scoring: "set" | "recall";
  /** Items accepted as correct without being required. */
  alsoAccept?: KeyItem[];
  /** Regexes the final answer text must match (facts that are not file/symbol items). */
  facts?: RegExp[];
  /** Named subsets of the key, reported separately (planning tasks). */
  parts?: Record<string, KeyItem[]>;
  /** Shell commands an informed developer would run per arm (scripted mode); run from the arm's worktree. */
  recipes: Record<ScriptedArm, string[]>;
}

interface Keys {
  h1: string[];
  h2: string[];
  h3: string[][];
  h4: string[];
  h5: { exported: number; unreferenced: string[] };
  h7: { callees: string[]; callers: string[]; tests: string[] };
  t5: { function: string; callees: string[] };
}
const keys: Keys = JSON.parse(
  readFileSync(join(BENCH_DIR, "answer-keys.json"), "utf8"),
);
const item = (ref: string): KeyItem => {
  const [file, symbol] = ref.split("#");
  return symbol ? { file, symbol } : { file };
};
const NO_TESTS = `-g '!*.test.ts' -g '!*.test.tsx'`;

export const ANSWER_FORMAT = `End your reply with exactly one fenced \`\`\`json block shaped like
{"items": [{"file": "path/relative/to/repo/root.ts", "symbol": "functionOrSymbolName"}]}
Use "symbol": null when an item is a whole file. List only items you verified.`;

const H6_KEY: KeyItem[] = [
  { file: "server/sql-schema.ts", symbol: "schemaMigrations" },
  { file: "server/sql-schema.ts", symbol: "WORLD_TABLES" },
  { file: "server/sql-schema.ts", symbol: "IDENTITY_TABLES" },
  { file: "server/sql-schema.ts", symbol: "ADDED_WORLD_TABLES" },
  { file: "CONTRIBUTING.md" },
  { file: "docs/src/content/docs/technical/persistence.md" },
  { file: "server/db.test.ts" },
  { file: "server/saves.test.ts" },
];
const H7_DOCS: KeyItem[] = [
  { file: "docs/src/content/docs/play/transfers.md" },
  { file: "REQUIREMENTS.md" },
];
const H7_PARTS = {
  "(a) callees": [
    item("server/deal-clauses.ts#payReleaseClause"),
    ...keys.h7.callees.map(item),
  ],
  "(b) callers": keys.h7.callers.map(item),
  "(c) tests": keys.h7.tests.map(item),
  "(d) docs": H7_DOCS,
};

export const TASKS: Task[] = [
  {
    id: "H1",
    title: "Reachability: everything that can trigger an AI transfer",
    group: "structural",
    question:
      "Which non-test functions can transitively reach executeMarketTransfer in server/transfer-battles.ts through direct calls? Follow callers of callers all the way up to the top-level entry points (HTTP route registration, server startup, scripts) and list every function on those call chains.",
    key: keys.h1.map(item),
    scoring: "set",
    recipes: {
      A: [
        `rg -nw "executeMarketTransfer" server scripts ${NO_TESTS}`,
        `rg -nw "decide|settleMarketBids" server scripts ${NO_TESTS}`,
        `rg -nw "processTransferBattles" server scripts ${NO_TESTS}`,
        `rg -nw "advance" server scripts ${NO_TESTS}`,
        `rg -nw "createWorldRouter|seasonSoak" server scripts ${NO_TESTS}`,
        `rg -nw "createApp" server scripts ${NO_TESTS}`,
      ],
      G: [
        `graphify affected "executeMarketTransfer" --depth 6 --relation calls`,
      ],
    },
  },
  {
    id: "H2",
    title: "Transitive blast radius: contractEndDate within 3 call hops",
    group: "structural",
    question:
      "I'm about to change the behaviour of contractEndDate in server/systems.ts. List every non-test function that calls it directly, or calls such a caller, up to 3 call hops away (callers, their callers, and their callers).",
    key: keys.h2.map(item),
    scoring: "set",
    recipes: {
      A: [
        `rg -nw "contractEndDate" server scripts ${NO_TESTS}`,
        `rg -nw "counterIncomingOffer|negotiate|completeNegotiation|exerciseOption|affiliateOptionsForNegotiation|placeFutureTransferAtAffiliate|executeMarketTransfer|completeExchange|priceDeal" server scripts ${NO_TESTS}`,
        `rg -nw "dispatchAction|progressDealMilestones|processAssistant|expireLoans|setOnwardLoanPlan|startOnwardLoan|transfers|decide|settleMarketBids|makeRoom|partExchange|worldMarket" server scripts ${NO_TESTS}`,
      ],
      G: [`graphify affected "contractEndDate" --depth 3 --relation calls`],
    },
  },
  {
    id: "H3",
    title: "Structure: import cycles in server/",
    group: "structural",
    question:
      "Which non-test files under server/ are part of an import cycle (a file that, following its relative imports, can reach itself again)? List every such file.",
    key: keys.h3.flat().map(item),
    scoring: "set",
    recipes: {
      A: [
        `rg -o --no-heading 'from "\\./[a-z0-9.-]+\\.ts"' server ${NO_TESTS} | sort -u`,
      ],
      G: [`grep -n -A40 "## Import Cycles" graphify-out/GRAPH_REPORT.md`],
    },
  },
  {
    id: "H5",
    title: "Aggregate: exported server functions nobody else uses",
    group: "structural",
    question:
      "Which exported function declarations (export function / export async function) in non-test files under server/ are never referenced from any other file in the repository (tests included)? These are candidates for un-exporting. List every one.",
    key: keys.h5.unreferenced.map(item),
    scoring: "set",
    recipes: {
      A: [
        `rg -n --no-heading -or '$2' '^export (async )?function (\\w+)' server ${NO_TESTS} | while IFS=: read -r f _ n; do rg -lw "$n" server shared src scripts e2e | grep -qvx "$f" || echo "$f#$n"; done`,
      ],
      G: [
        `python3 -c 'import json,re
g=json.load(open("graphify-out/graph.json")); nodes={n["id"]:n for n in g["nodes"]}; used=set()
for l in g["links"]:
  s,t=nodes.get(l["source"]),nodes.get(l["target"])
  if s and t and l["relation"]!="contains" and s.get("source_file")!=t.get("source_file"): used.add(t["id"])
for n in g["nodes"]:
  f=n.get("source_file",""); m=re.match(r"L(\\d+)",n.get("source_location",""))
  if f.startswith("server/") and ".test." not in f and n["label"].endswith("()") and n["id"] not in used and m:
    line=open(f).read().split("\\n")[int(m.group(1))-1]
    if line.startswith("export"): print(f+"#"+n["label"][:-2])'`,
      ],
    },
  },
  {
    id: "H6",
    title: "Change plan: schema migration 12, code, tests and docs",
    group: "change-plan",
    question:
      "I need to add schema migration 12 that creates a new per-world table club_rivalries with an identity id column. Which files and symbols must I change, which repository docs describe the migrations or the world-table inventory and must be updated, and which test files should cover it?",
    key: H6_KEY,
    scoring: "recall",
    recipes: {
      A: [
        `rg -n "version: 11" server -g '*.ts'`,
        `rg -n "^export" server/sql-schema.ts`,
        `rg -l "schemaMigrations|WORLD_TABLES|ADDED_WORLD_TABLES|IDENTITY_TABLES" server scripts`,
        `rg -n -i "migrations|WORLD_TABLES" --type md -g '!scripts/bench-graphify/**' .`,
      ],
      G: [
        `graphify affected "schemaMigrations" --depth 1`,
        `graphify affected "WORLD_TABLES" --depth 1`,
        `graphify query "add a world table schema migration docs" --budget 1500`,
      ],
    },
  },
  {
    id: "H7",
    title: "Planning session: a levy on release-clause payments",
    group: "change-plan",
    question:
      "I'm planning to add a 10% solidarity levy whenever a release clause is paid (payReleaseClause in server/deal-clauses.ts). For the change plan list: (a) payReleaseClause and every project function it calls directly (ignore methods such as store.run and constructors); (b) every non-test function that can transitively reach it, up to the top-level entry points; (c) the test files that call it directly; (d) the repository Markdown docs that describe release clauses.",
    key: Object.values(H7_PARTS).flat(),
    alsoAccept: [{ file: "README.md" }],
    parts: H7_PARTS,
    scoring: "recall",
    recipes: {
      A: [
        `rg -n -A30 "^export async function payReleaseClause" server/deal-clauses.ts`,
        `rg -nw "payReleaseClause" server scripts src`,
        `rg -nw "dispatchAction" server scripts ${NO_TESTS}`,
        `rg -nw "createWorldRouter|createApp" server scripts ${NO_TESTS}`,
        `rg -n -i "release clause" --type md -g '!scripts/bench-graphify/**' .`,
      ],
      G: [
        `graphify explain "payReleaseClause"`,
        `graphify affected "payReleaseClause" --depth 6 --relation calls`,
        `graphify query "release clauses documentation" --budget 1500`,
      ],
    },
  },
  {
    id: "T2",
    title: "Multi-hop: HTTP advance route to the match engine",
    group: "v1",
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
      G: [
        `graphify query "advance day route handler" --budget 1000`,
        `graphify path "advance" "simulateMatch"`,
      ],
    },
  },
  {
    id: "T5",
    title: "Callees: completing an AI club's transfer",
    group: "v1",
    question:
      "Find the function that completes an AI club's permanent transfer signing, then list every project function it calls directly (helpers it calls by name; ignore methods such as store.run). Give each callee with the file that defines it, and include the function itself as the first item.",
    key: [item(keys.t5.function), ...keys.t5.callees.map(item)],
    scoring: "set",
    recipes: {
      A: [
        `grep -rnE "export async function \\w*[Tt]ransfer\\w*\\(" server --include='*.ts' --exclude='*.test.ts'`,
        `grep -n -A60 '^export async function executeMarketTransfer' server/transfer-battles.ts`,
        `grep -n '^import' -A3 server/transfer-battles.ts`,
      ],
      G: [
        `graphify query "complete AI club permanent transfer signing" --budget 1000`,
        `graphify explain "executeMarketTransfer"`,
      ],
    },
  },
  {
    id: "H4",
    title: "Coverage: tests exercising transferProceeds within 3 hops",
    group: "coverage",
    question:
      "Which test files exercise transferProceeds in server/systems.ts, either by calling it directly or by calling a function that reaches it within 3 call hops? List every such test file.",
    key: keys.h4.map(item),
    scoring: "set",
    recipes: {
      A: [
        `rg -nw "transferProceeds" server scripts ${NO_TESTS}`,
        `rg -lw "transferProceeds|completeNegotiation|exerciseOption|placeFutureTransferAtAffiliate|executeMarketTransfer|progressDealMilestones|expireLoans|dispatchAction|decide|settleMarketBids|advance|processNegotiations|processTransferBattles|createWorldRouter" server -g '*.test.ts'`,
      ],
      G: [`graphify affected "transferProceeds" --depth 3`],
    },
  },
  {
    id: "T7",
    title: "Control: where is clamp defined",
    group: "control",
    question:
      "Where is the shared clamp helper defined, and what are its parameters and their default values?",
    key: [{ file: "shared/rules.ts", symbol: "clamp" }],
    scoring: "set",
    facts: [/\b1\b[\s\S]*\b99\b/],
    recipes: {
      A: [
        `grep -rnE "(const|function) clamp\\b" -A2 server shared src scripts --include='*.ts' --include='*.tsx'`,
      ],
      G: [`graphify explain "clamp"`],
    },
  },
  {
    id: "T8",
    title: "Limitation: UI caller to Express handler across an HTTP string",
    group: "limitation",
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
      G: [
        `graphify query "club transfers endpoint UI fetch" --budget 1500`,
        `graphify explain "clubTransfers"`,
      ],
    },
  },
];

/** Identical for every arm: arms differ only in repository instructions, tools and hooks. */
export const promptFor = (task: Task) =>
  `You are working in the Touchline repository (the current directory). Investigate the code to answer the question below. Do not modify, create or delete any files.

Question: ${task.question}

${ANSWER_FORMAT}`;
