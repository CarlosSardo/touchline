import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHA = /^[0-9a-f]{40}$/;
const MAX_FILES = 80;
const MAX_DIFF_BYTES = 512 * 1024;
const SAFE_HTML_TAGS = new Set([
  "a", "abbr", "b", "blockquote", "br", "caption", "code", "dd", "del",
  "details", "div", "dl", "dt", "em", "figcaption", "figure", "h1", "h2",
  "h3", "h4", "hr", "i", "img", "li", "ol", "p", "pre", "s", "small",
  "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "th",
  "thead", "tr", "u", "ul",
]);
const GUIDE_SOURCE_MARKER = /^docs: refresh documentation from ([0-9a-f]{40})(?: \(#[0-9]+\))?$/;

export function assertSha(value, label) {
  if (typeof value !== "string" || !SHA.test(value)) {
    throw new Error(`${label} must be a lowercase 40-character commit SHA`);
  }
  return value;
}

export function isAllowedDocumentationPath(value) {
  if (typeof value !== "string" || !value || value.includes("\\") ||
      value.includes("\0") || value.startsWith("/") ||
      value.split("/").some((part) => !part || part === "." || part === "..")) {
    return false;
  }
  if (/^(README|DEVELOPMENT|CONTRIBUTING|REQUIREMENTS)\.md$/.test(value)) {
    return true;
  }
  return /^website\/src\/content\/docs\/.+\.md$/.test(value);
}

export function isDocumentationScopePath(value) {
  return isAllowedDocumentationPath(value) ||
    /^website\/src\/content\/docs\/.+\.mdx$/.test(value) ||
    /^website\/public\/images\/game\/.+$/.test(value);
}

export function isUnsupportedScreenshotPath(value) {
  return /^website\/public\/images\/game\/.+$/.test(value);
}

export function isAutomationOwnedPath(value) {
  return value === ".github/workflows/docs-maintenance.yml" ||
    /^\.github\/agents\/docs-(writer|fact-checker)\.agent\.md$/.test(value) ||
    value.startsWith(".github/scripts/docs/");
}

export function requiresFullBaseline(paths) {
  return paths.some((value) =>
    value === ".github/workflows/docs-maintenance.yml" ||
    /^\.github\/agents\/docs-(writer|fact-checker)\.agent\.md$/.test(value) ||
    /^\.github\/scripts\/docs\/(?:maintenance|runtime|fact-check)(?:[-.].*)?\.mjs$/.test(value));
}

export function isRelevantSourceChange(paths) {
  return paths.some((value) =>
    !isAllowedDocumentationPath(value) && !isAutomationOwnedPath(value));
}

function runGit(root, args, options = {}) {
  const output = execFileSync("git", ["--no-pager", "-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_OPTIONAL_LOCKS: "0" },
    ...options,
  });
  return typeof output === "string" ? output.trimEnd() : "";
}

function trackedMode(root, revision, filePath) {
  const entries = runGit(root, ["ls-tree", "-r", "-z", revision, "--", `:(literal)${filePath}`])
    .split("\0").filter(Boolean);
  const entry = entries.find((item) => item.slice(item.indexOf("\t") + 1) === filePath);
  return entry ? entry.slice(0, entry.indexOf(" ")).split(" ")[0] : null;
}

function assertRegularNonExecutable(root, revision, filePath) {
  const mode = trackedMode(root, revision, filePath);
  if (mode !== null && mode !== "100644") {
    throw new Error(`Documentation output must be a regular non-executable file: ${filePath}`);
  }
  const absolute = path.join(root, filePath);
  try {
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o111) !== 0) {
      throw new Error(`Documentation output must not be a symlink or executable: ${filePath}`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function withoutMarkdownCode(source) {
  let fence = null;
  const visible = source.split("\n").map((line) => {
    if (fence) {
      const close = new RegExp(`^ {0,3}${fence.character}{${fence.length},}\\s*$`);
      if (close.test(line)) fence = null;
      return "";
    }
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (opening && (opening[1][0] === "~" || !opening[2].includes("`"))) {
      fence = { character: opening[1][0], length: opening[1].length };
      return "";
    }
    return line;
  }).join("\n");
  const masked = visible.split("");
  const escaped = (index) => {
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && visible[cursor] === "\\"; cursor -= 1) slashes += 1;
    return slashes % 2 === 1;
  };
  for (let index = 0; index < visible.length;) {
    if (visible[index] !== "`" || escaped(index)) {
      index += 1;
      continue;
    }
    let delimiterLength = 1;
    while (visible[index + delimiterLength] === "`") delimiterLength += 1;
    let closing = -1;
    for (let cursor = index + delimiterLength; cursor < visible.length;) {
      if (visible[cursor] !== "`" || escaped(cursor)) {
        cursor += 1;
        continue;
      }
      let closingLength = 1;
      while (visible[cursor + closingLength] === "`") closingLength += 1;
      if (closingLength === delimiterLength) {
        closing = cursor;
        break;
      }
      cursor += closingLength;
    }
    if (closing < 0) {
      index += delimiterLength;
      continue;
    }
    for (let cursor = index; cursor < closing + delimiterLength; cursor += 1) {
      if (masked[cursor] !== "\n") masked[cursor] = " ";
    }
    index = closing + delimiterLength;
  }
  return masked.join("");
}

export function validateDocumentationContent(filePath, source) {
  const visible = withoutMarkdownCode(source);
  if (/<!--|<!|<\?/i.test(visible)) {
    throw new Error(`HTML comments and declarations are not allowed in documentation output: ${filePath}`);
  }
  if (/!\[[^\]\n]*\]\s*\[[^\]\n]*\]/.test(visible)) {
    throw new Error(`Reference-style images are unsupported in documentation output: ${filePath}`);
  }
  for (const tag of visible.matchAll(/<\/?\s*([A-Za-z][A-Za-z0-9-]*)\b((?:[^'"<>]|"[^"]*"|'[^']*')*)>/g)) {
    if (/^<(?:https?:\/\/[^<>]+|mailto:[^<>]+|[^<>@\s]+@[^<>@\s]+)>$/i.test(tag[0])) continue;
    if (!SAFE_HTML_TAGS.has(tag[1].toLowerCase())) {
      throw new Error(`Unsafe or unsupported HTML element in documentation output: ${filePath}`);
    }
    if (/(?:^|\s)(?:on[a-z0-9_:-]+|srcdoc|style)\s*(?:=|(?=\s|\/|$))/i.test(tag[2])) {
      throw new Error(`Executable HTML attributes are not allowed in documentation output: ${filePath}`);
    }
  }
  const normalized = visible
    .replace(/&#x([0-9a-f]+);?/gi, (_match, hex) => {
      const codePoint = Number.parseInt(hex, 16);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : " ";
    })
    .replace(/&#([0-9]+);?/g, (_match, decimal) => {
      const codePoint = Number.parseInt(decimal, 10);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : " ";
    })
    .replace(/&colon;/gi, ":")
    .replace(/&Tab;/gi, "\t")
    .replace(/&NewLine;/gi, "\n")
    .replace(/[\u0000-\u0020\u007f]+/g, "");
  if (/\b(?:javascript|vbscript|file):|\bdata:(?:text\/html|image\/svg\+xml|application\/(?:javascript|ecmascript|xml|xhtml\+xml))/i.test(normalized)) {
    throw new Error(`Executable or local-resource URL is not allowed in documentation output: ${filePath}`);
  }
}

function imageMarkup(source) {
  const visible = withoutMarkdownCode(source);
  const markdownLines = visible.split("\n").filter((line) => /!\s*\[/.test(line));
  const htmlImages = [...visible.matchAll(/<img\b(?:[^'"<>]|"[^"]*"|'[^']*')*>/gi)]
    .map((match) => match[0]);
  return [...markdownLines, ...htmlImages].sort();
}

function assertImageMarkupUnchanged(filePath, baseSource, headSource) {
  if (JSON.stringify(imageMarkup(baseSource)) !== JSON.stringify(imageMarkup(headSource))) {
    throw new Error(`Image references cannot change without authenticated provenance: ${filePath}`);
  }
}

export function listChangedPaths(root, base, head) {
  assertSha(base, "base");
  assertSha(head, "head");
  const resolvedRoot = realpathSync(root);
  if (realpathSync(runGit(resolvedRoot, ["rev-parse", "--show-toplevel"])) !== resolvedRoot) {
    throw new Error("root must be a Git checkout root");
  }
  for (const sha of [base, head]) {
    if (runGit(resolvedRoot, ["cat-file", "-t", sha]) !== "commit") {
      throw new Error(`${sha} is not a Git commit`);
    }
  }
  runGit(resolvedRoot, ["merge-base", "--is-ancestor", base, head], { stdio: "ignore" });
  return runGit(resolvedRoot, [
    "diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", base, head,
  ]).split("\0").filter(Boolean);
}

export function validateDocumentationDiff(root, base, head, {
  maxFiles = MAX_FILES, allowSourceChanges = false,
} = {}) {
  const resolvedRoot = realpathSync(root);
  const files = listChangedPaths(resolvedRoot, base, head);
  if (files.length > maxFiles) {
    throw new Error(`Documentation proposal changes ${files.length} files; limit is ${maxFiles}`);
  }
  for (const filePath of files) {
    if (!isAllowedDocumentationPath(filePath)) {
      if (!allowSourceChanges || isAutomationOwnedPath(filePath)) {
        throw new Error(`Change is outside the documentation allowlist: ${filePath}`);
      }
      continue;
    }
    for (const revision of [base, head]) {
      assertRegularNonExecutable(resolvedRoot, revision, filePath);
    }
    if (trackedMode(resolvedRoot, head, filePath) !== null) {
      const headContent = runGit(resolvedRoot, ["show", `${head}:${filePath}`]);
      validateDocumentationContent(filePath, headContent);
      const baseContent = trackedMode(resolvedRoot, base, filePath) === null ? "" :
        runGit(resolvedRoot, ["show", `${base}:${filePath}`]);
      assertImageMarkupUnchanged(filePath, baseContent, headContent);
    }
  }
  return files;
}

export function validateWorkingTree(root, { maxFiles = MAX_FILES } = {}) {
  const resolvedRoot = realpathSync(root);
  const tracked = runGit(resolvedRoot, [
    "diff", "--no-ext-diff", "--no-renames", "--name-only", "-z",
  ]).split("\0").filter(Boolean);
  const staged = runGit(resolvedRoot, [
    "diff", "--cached", "--no-ext-diff", "--no-renames", "--name-only", "-z",
  ]).split("\0").filter(Boolean);
  const untracked = runGit(resolvedRoot, ["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0").filter(Boolean);
  const files = [...new Set([...tracked, ...staged, ...untracked])];
  if (files.length > maxFiles) {
    throw new Error(`Documentation proposal changes ${files.length} files; limit is ${maxFiles}`);
  }
  for (const filePath of files) {
    if (!isAllowedDocumentationPath(filePath)) {
      throw new Error(`Change is outside the documentation allowlist: ${filePath}`);
    }
    const absolute = path.join(resolvedRoot, filePath);
    try {
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o111) !== 0) {
        throw new Error(`Documentation output must not be a symlink or executable: ${filePath}`);
      }
      validateDocumentationContent(filePath, readFileSync(absolute, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT" || !tracked.includes(filePath)) throw error;
    }
  }
  const patch = execFileSync("git", [
    "--no-pager", "-C", resolvedRoot, "diff", "--binary", "--no-ext-diff", "HEAD",
  ], { maxBuffer: MAX_DIFF_BYTES + 1 });
  if (patch.byteLength > MAX_DIFF_BYTES) {
    throw new Error(`Documentation proposal exceeds ${MAX_DIFF_BYTES} bytes`);
  }
  execFileSync("git", ["--no-pager", "-C", resolvedRoot, "diff", "--check", "HEAD"], {
    stdio: "ignore",
  });
  return { files, patch };
}

export function findLastPublishedSource(root, head) {
  const resolvedRoot = realpathSync(root);
  assertSha(head, "head");
  const history = runGit(resolvedRoot, ["log", "--format=%H", head]).split("\n").filter(Boolean);
  const historyOrder = new Map(history.map((sha, index) => [sha, index]));
  const candidates = new Set();
  const commits = runGit(resolvedRoot, ["log", "--format=%H%x09%s", head])
    .split("\n").filter(Boolean);
  for (const line of commits) {
    const separator = line.indexOf("\t");
    if (separator < 0) continue;
    const commit = line.slice(0, separator);
    const match = GUIDE_SOURCE_MARKER.exec(line.slice(separator + 1));
    if (!match) continue;
    const source = match[1];
    try {
      runGit(resolvedRoot, ["merge-base", "--is-ancestor", source, `${commit}^`], {
        stdio: "ignore",
      });
      const changed = runGit(resolvedRoot, [
        "diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", `${commit}^`, commit,
      ]).split("\0").filter(Boolean);
      if (!changed.length || changed.every(isAllowedDocumentationPath)) candidates.add(source);
    } catch {
      // Ignore malformed, unrelated, or non-ancestor markers and keep searching.
    }
  }
  for (const tag of runGit(resolvedRoot, ["tag", "--list", "docs-maintenance-verified-*"])
    .split("\n").filter(Boolean)) {
    const match = /^docs-maintenance-verified-([0-9a-f]{40})$/.exec(tag);
    if (!match) continue;
    const source = match[1];
    try {
      if (runGit(resolvedRoot, ["rev-parse", `${tag}^{}`]) !== source) continue;
      runGit(resolvedRoot, ["merge-base", "--is-ancestor", source, head], { stdio: "ignore" });
      candidates.add(source);
    } catch {
      // Ignore tags that do not point to an ancestor source commit.
    }
  }
  return [...candidates]
    .filter((source) => historyOrder.has(source))
    .sort((left, right) => historyOrder.get(left) - historyOrder.get(right))[0] ?? null;
}

export function shouldRunMaintenance(paths, forceBaseline = false) {
  return forceBaseline || requiresFullBaseline(paths) || isRelevantSourceChange(paths);
}

export function main(args) {
  if (args[0] !== "check-paths") {
    throw new Error("Usage: maintenance.mjs check-paths <base> <head> [--root <checkout>]");
  }
  let root = process.cwd();
  const positional = [];
  for (let index = 1; index < args.length; index += 1) {
    if (args[index] === "--root") {
      root = args[index + 1];
      index += 1;
    } else positional.push(args[index]);
  }
  if (positional.length !== 2) throw new Error("check-paths requires base and head SHAs");
  const files = validateDocumentationDiff(root, positional[0], positional[1]);
  console.log(JSON.stringify({ result: "pass", files }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`DOCS MAINTENANCE BLOCKED: ${error.message}`);
    process.exitCode = 1;
  }
}
