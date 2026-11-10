// Computes the compiler-derived answer keys and writes answer-keys.json.
// Uses the TypeScript 5 JS API (the repo's TypeScript 7 has none), installed outside the repo on first run:
// a LanguageService over server/, shared/, src/ and scripts/ provides call hierarchy, references and imports.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TS5_DIR = join(homedir(), ".cache/touchline-bench");
if (!existsSync(join(TS5_DIR, "node_modules/typescript"))) {
  mkdirSync(TS5_DIR, { recursive: true });
  execFileSync(
    "npm",
    [
      "install",
      "--prefix",
      TS5_DIR,
      "--no-audit",
      "--no-fund",
      "--no-save",
      "typescript@5.9.3",
    ],
    { stdio: "inherit" },
  );
}
// Untyped on purpose: the repo's TypeScript 7 package ships no declarations for the version 5 JS API.
const ts: any = createRequire(join(TS5_DIR, "package.json"))("typescript");

const BENCH = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(BENCH, "../..");
const isTest = (file: string) => /\.test\.tsx?$/.test(file);

function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory())
        return entry.name === "node_modules" ||
          path === "scripts/bench-graphify"
          ? []
          : walk(path);
      return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")
        ? [path]
        : [];
    },
  );
}
const files = ["server", "shared", "src", "scripts"].flatMap(walk);
const options = {
  allowImportingTsExtensions: true,
  noEmit: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ESNext,
  strict: true,
  jsx: ts.JsxEmit.ReactJSX,
  skipLibCheck: true,
  types: [],
};
const ls = ts.createLanguageService({
  getScriptFileNames: () => files.map((file) => join(ROOT, file)),
  getScriptVersion: () => "1",
  getScriptSnapshot: (file: string) =>
    existsSync(file)
      ? ts.ScriptSnapshot.fromString(readFileSync(file, "utf8"))
      : undefined,
  getCurrentDirectory: () => ROOT,
  getCompilationSettings: () => options,
  getDefaultLibFileName: (o: unknown) => ts.getDefaultLibFilePath(o),
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
});
const program = ls.getProgram();

function declaration(file: string, name: string) {
  const source = program.getSourceFile(join(ROOT, file));
  const decl = source?.statements.find(
    (s: any) => ts.isFunctionDeclaration(s) && s.name?.text === name,
  );
  if (!decl) throw new Error(`${name} not found in ${file}`);
  return decl;
}

/** Transitive incoming calls (TS call hierarchy) up to `maxDepth` hops: "file#function" -> hop count. */
function callers(
  file: string,
  name: string,
  maxDepth: number,
  includeTests: boolean,
) {
  const found = new Map<string, number>();
  const testFiles = new Map<string, number>();
  let frontier = [
    { file: join(ROOT, file), start: declaration(file, name).name.getStart() },
  ];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next: typeof frontier = [];
    for (const { file: at, start } of frontier)
      for (const call of ls.provideCallHierarchyIncomingCalls(at, start) ??
        []) {
        const from = relative(ROOT, call.from.file);
        if (isTest(from)) {
          if (includeTests && !testFiles.has(from)) testFiles.set(from, depth);
          continue;
        }
        if (call.from.kind === "module") continue;
        const key = `${from}#${call.from.name}`;
        if (found.has(key)) continue;
        found.set(key, depth);
        next.push({
          file: call.from.file,
          start: call.from.selectionSpan.start,
        });
      }
    frontier = next;
  }
  return {
    functions: [...found.keys()].sort(),
    testFiles: [...testFiles.keys()].sort(),
  };
}

/** Direct project-function callees (identifier calls; methods such as store.run and `new` expressions excluded). */
function callees(file: string, name: string) {
  const checker = program.getTypeChecker();
  const result = new Set<string>();
  const visit = (node: any) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      let symbol = checker.getSymbolAtLocation(node.expression);
      if (symbol && symbol.flags & ts.SymbolFlags.Alias)
        symbol = checker.getAliasedSymbol(symbol);
      const target = symbol?.declarations?.[0]?.getSourceFile().fileName;
      if (target && !target.includes("node_modules"))
        result.add(`${relative(ROOT, target)}#${node.expression.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration(file, name).body);
  return [...result].sort();
}

/** Files under server/ (non-test) that sit on an import cycle: strongly connected components larger than one file. */
function importCycles() {
  const server = files.filter(
    (file) => file.startsWith("server/") && !isTest(file),
  );
  const edges = new Map<string, Set<string>>();
  for (const file of server) {
    const targets = new Set<string>();
    const visit = (node: any) => {
      let spec: string | undefined;
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        spec = node.moduleSpecifier.text;
      else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        spec = node.arguments[0].text;
      if (spec?.startsWith(".")) {
        const target = relative(ROOT, resolve(ROOT, dirname(file), spec));
        if (target !== file && server.includes(target)) targets.add(target);
      }
      ts.forEachChild(node, visit);
    };
    visit(program.getSourceFile(join(ROOT, file)));
    edges.set(file, targets);
  }
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  const connect = (v: string) => {
    index.set(v, counter);
    low.set(v, counter++);
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v)!) {
      if (!index.has(w)) {
        connect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w))
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      if (component.length > 1) components.push(component.sort());
    }
  };
  for (const file of server) if (!index.has(file)) connect(file);
  return components.sort((a, b) => b.length - a.length);
}

/** Exported function declarations in server/ (non-test) that no other file references, tests included. */
function unreferencedExports() {
  const result: string[] = [];
  let total = 0;
  for (const file of files.filter(
    (file) => file.startsWith("server/") && !isTest(file),
  ))
    for (const statement of program.getSourceFile(join(ROOT, file))
      .statements) {
      if (
        !ts.isFunctionDeclaration(statement) ||
        !statement.name ||
        !statement.modifiers?.some(
          (m: any) => m.kind === ts.SyntaxKind.ExportKeyword,
        )
      )
        continue;
      total++;
      const elsewhere = (
        ls.findReferences(join(ROOT, file), statement.name.getStart()) ?? []
      )
        .flatMap((symbol: any) => symbol.references)
        .some((ref: any) => relative(ROOT, ref.fileName) !== file);
      if (!elsewhere) result.push(`${file}#${statement.name.text}`);
    }
  return { exported: total, unreferenced: result.sort() };
}

const h1 = callers(
  "server/transfer-battles.ts",
  "executeMarketTransfer",
  20,
  false,
).functions;
const h2 = callers("server/systems.ts", "contractEndDate", 3, false).functions;
const h3 = importCycles();
// A test "reaches it within 3 call hops" when it calls a function at caller depth <= 3, i.e. test depth <= 4.
const h4 = callers("server/systems.ts", "transferProceeds", 4, true).testFiles;
const h5 = unreferencedExports();
const h7Callers = callers(
  "server/deal-clauses.ts",
  "payReleaseClause",
  20,
  true,
);
const h7 = {
  callees: callees("server/deal-clauses.ts", "payReleaseClause"),
  callers: h7Callers.functions,
  tests: callers("server/deal-clauses.ts", "payReleaseClause", 1, true)
    .testFiles,
};
const t5 = {
  function: "server/transfer-battles.ts#executeMarketTransfer",
  callees: callees("server/transfer-battles.ts", "executeMarketTransfer"),
};

const keys = {
  generatedFrom:
    "TypeScript 5 LanguageService over server/, shared/, src/, scripts/ (call hierarchy, references, imports)",
  h1,
  h2,
  h3,
  h4,
  h5,
  h7,
  t5,
};
writeFileSync(
  join(BENCH, "answer-keys.json"),
  `${JSON.stringify(keys, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    {
      h1,
      h2: h2.length,
      h3,
      h4,
      h5: { exported: h5.exported, unreferenced: h5.unreferenced.length },
      h7,
      t5,
    },
    null,
    2,
  ),
);
