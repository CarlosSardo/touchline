// Computes the compiler-derived answer keys (T1, T3, T5, T6) and writes answer-keys.json.
// T1/T5/T6 use the TypeScript 5 JS API (the repo's TypeScript 7 has none), installed outside the repo on first run;
// T3 runs the project's own tsc in a scratch worktree.
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_DIRS = ["server", "shared", "src", "scripts"];
const isTest = (file: string) => /\.test\.tsx?$/.test(file);

function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory())
        return entry.name === "node_modules" ? [] : walk(path);
      return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")
        ? [path]
        : [];
    },
  );
}

const files = SOURCE_DIRS.flatMap(walk).filter((file) => !isTest(file));
const resolveImport = (from: string, spec: string) =>
  spec.startsWith(".")
    ? relative(ROOT, resolve(ROOT, dirname(from), spec))
    : null;

/** imported module -> importing files, and (module#name) -> importing files; static imports, dynamic imports and re-exports. */
const moduleImporters = new Map<string, Set<string>>();
const symbolImporters = new Map<string, Set<string>>();
const add = (map: Map<string, Set<string>>, key: string, file: string) =>
  map.set(key, (map.get(key) ?? new Set()).add(file));

for (const file of files) {
  const source = ts.createSourceFile(
    file,
    readFileSync(join(ROOT, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const visit = (node: any) => {
    let spec: string | undefined;
    let names: string[] = [];
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      spec = node.moduleSpecifier.text;
      if (ts.isImportDeclaration(node)) {
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings))
          names = bindings.elements.map(
            (el: any) => (el.propertyName ?? el.name).text,
          );
      } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        names = node.exportClause.elements.map(
          (el: any) => (el.propertyName ?? el.name).text,
        );
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      spec = node.arguments[0].text;
      const binding = node.parent?.parent;
      if (
        ts.isAwaitExpression(node.parent) &&
        binding &&
        ts.isVariableDeclaration(binding) &&
        ts.isObjectBindingPattern(binding.name)
      )
        names = binding.name.elements.map(
          (el: any) => ((el.propertyName ?? el.name) as any).text,
        );
    }
    const target = spec ? resolveImport(file, spec) : null;
    if (target && target !== file) {
      add(moduleImporters, target, file);
      for (const name of names) add(symbolImporters, `${target}#${name}`, file);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

/** Top N by count, extended with every item tied with the Nth (all tied items are accepted answers). */
function ranked(
  map: Map<string, Set<string>>,
  n: number,
  filter: (key: string) => boolean = () => true,
) {
  const rows = [...map]
    .filter(([key]) => filter(key))
    .map(([key, set]) => ({ key, count: set.size }));
  rows.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const cutoff = rows[n - 1]?.count ?? 0;
  return {
    top: rows.slice(0, n),
    acceptable: rows.filter((row) => row.count >= cutoff),
  };
}

const t1 = ranked(moduleImporters, 5, (key) => key.startsWith("server/"));
const t6 = ranked(symbolImporters, 10);

const compilerOptions: Record<string, unknown> = {
  allowImportingTsExtensions: true,
  noEmit: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ESNext,
  strict: true,
};

// T5: direct project-function callees of executeMarketTransfer (methods such as store.run are excluded).
function directCallees(file: string, fn: string) {
  const program = ts.createProgram([join(ROOT, file)], compilerOptions);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(join(ROOT, file))!;
  const decl = source.statements.find(
    (s: any) => ts.isFunctionDeclaration(s) && s.name?.text === fn,
  );
  if (!decl?.body) throw new Error(`${fn} not found in ${file}`);
  const callees = new Set<string>();
  const visit = (node: any) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      let symbol = checker.getSymbolAtLocation(node.expression);
      if (symbol && symbol.flags & ts.SymbolFlags.Alias)
        symbol = checker.getAliasedSymbol(symbol);
      const target = symbol?.declarations?.[0]?.getSourceFile().fileName;
      if (target && !target.includes("node_modules"))
        callees.add(`${relative(ROOT, target)}#${node.expression.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(decl.body);
  return [...callees].sort();
}
const t5 = {
  function: "server/transfer-battles.ts#executeMarketTransfer",
  callees: directCallees("server/transfer-battles.ts", "executeMarketTransfer"),
};

// T3: files with new type errors once simulateMatch gains a required parameter, per the project's tsc (server and app).
function blastRadius() {
  const dir = join(tmpdir(), `touchline-bench-t3-${process.pid}`);
  execFileSync(
    "git",
    ["-C", ROOT, "worktree", "add", "--detach", dir, "HEAD"],
    { stdio: "ignore" },
  );
  try {
    symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));
    const errorFiles = () =>
      new Set(
        ["tsconfig.server.json", "tsconfig.app.json"].flatMap((project) => {
          const out = spawnSync(
            join(ROOT, "node_modules/.bin/tsc"),
            ["-p", project, "--noEmit", "--pretty", "false"],
            { cwd: dir, encoding: "utf8" },
          ).stdout;
          return [...out.matchAll(/^([^\s(]+\.tsx?)\(\d+,\d+\): error/gm)].map(
            (m) => m[1],
          );
        }),
      );
    const baseline = errorFiles();
    const target = join(dir, "server/match.ts");
    const original = readFileSync(target, "utf8");
    const edited = original.replace(
      /export function simulateMatch\(([^)]*?)\)/s,
      (_, params: string) =>
        `export function simulateMatch(${params.replace(/,\s*$/, "")}, benchRequired: number)`,
    );
    if (edited === original)
      throw new Error("simulateMatch signature not found");
    writeFileSync(target, edited);
    return [...errorFiles()]
      .filter((file) => !baseline.has(file) && file !== "server/match.ts")
      .sort();
  } finally {
    rmSync(dir, { recursive: true, force: true });
    execFileSync("git", ["-C", ROOT, "worktree", "prune"]);
  }
}
const t3 = blastRadius();

const keys = {
  generatedFrom:
    "TypeScript compiler API over server/, shared/, src/, scripts/ (non-test files for T1/T6)",
  t1,
  t3,
  t5,
  t6,
};
writeFileSync(
  join(ROOT, "scripts/bench-graphify/answer-keys.json"),
  `${JSON.stringify(keys, null, 2)}\n`,
);
console.log(
  JSON.stringify({ t1: t1.acceptable, t3, t5, t6: t6.acceptable }, null, 2),
);
