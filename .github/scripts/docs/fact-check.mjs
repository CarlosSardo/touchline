import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REVIEWED_SOCIAL_ARTWORK, reviewedArtworkPaths, unchangedSiteMoves } from "./maintenance.mjs";

const SHA = /^[0-9a-f]{40}$/;
const MAX_BYTES = 8 * 1024 * 1024;
const fail = (message) => { throw new Error(message); };
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const guide = (name) => /^(README|REQUIREMENTS|CONTRIBUTING|DEVELOPMENT)\.md$/.test(name) ||
  /^(docs|website\/src\/content\/docs)\/.*\.(md|mdx)$/.test(name);
export const isImplementationEvidencePath = (name) => name !== REVIEWED_SOCIAL_ARTWORK.sourcePath && ((/\.(ts|tsx|js|jsx|mjs|cjs|sql|sh|json|yaml|yml|css|html|astro|dang)$/.test(name) &&
  !name.includes("/fixtures/") &&
  /^(src|server|shared|scripts|e2e|deploy|website|docs|\.dagger|\.github\/(workflows|scripts))\//.test(name)) ||
  /^(package\.json|Dockerfile|compose[^/]*\.ya?ml|\.env\.example|[^/]*config\.(ts|js|json))$/.test(name));

function repoPath(value) {
  if (!text(value) || value.includes("\\") || value.includes("\0") ||
      path.posix.isAbsolute(value) || value.split("/").some((part) => !part || part === "." || part === "..") ||
      /[\r\n]/.test(value) || value === ".git" || value.startsWith(".git/")) {
    fail(`Invalid repository path: ${JSON.stringify(value)}`);
  }
  return value;
}

function stringList(value, label, nonempty = false) {
  if (!Array.isArray(value) || (nonempty && !value.length) ||
      value.some((entry) => !text(entry)) || new Set(value).size !== value.length) {
    fail(`Invalid ${label}`);
  }
  return value.map(repoPath);
}

/**
 * Validate references and mechanically required coverage, not semantic truth.
 * The caller must enforce independent generation and protect this validator.
 */
export function validateReport({ reportPath, head, base, root, mode = "baseline" }) {
  if (!SHA.test(head) || !SHA.test(base)) fail("head/base must be lowercase 40-hex commit SHAs");
  if (!["baseline", "affected"].includes(mode)) fail("mode must be baseline or affected");
  root = realpathSync(root);
  const git = (...args) => execFileSync("git", ["--no-pager", "-C", root, ...args], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_OPTIONAL_LOCKS: "0" },
  }).trimEnd();
  if (realpathSync(git("rev-parse", "--show-toplevel")) !== root) fail("root must be the checkout root");
  if (git("rev-parse", "HEAD") !== head) fail("Checkout HEAD does not match report head");
  for (const sha of [base, head]) {
    if (git("cat-file", "-t", sha) !== "commit") fail("Revision must identify a commit");
  }
  git("merge-base", "--is-ancestor", base, head);
  if (git("status", "--porcelain", "--untracked-files=no")) fail("Checkout has tracked modifications");
  const artwork = reviewedArtworkPaths(root, head);

  const reportReal = realpathSync(reportPath);
  const relative = path.relative(root, reportReal);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
    fail("Report must be runtime-owned outside the checkout");
  }
  if (lstatSync(reportPath).isSymbolicLink() || !lstatSync(reportReal).isFile() ||
      lstatSync(reportReal).size > MAX_BYTES) fail("Report must be a regular, bounded JSON file");
  const report = JSON.parse(readFileSync(reportReal, "utf8"));
  if (!object(report) || report.schemaVersion !== 1 || report.headSha !== head || report.baseSha !== base) {
    fail("Malformed or stale report revision");
  }
  const trees = new Map();
  for (const [revision, sha] of [["head", head], ["base", base]]) {
    const entries = new Map();
    const raw = git("ls-tree", "-r", "-z", sha);
    for (const entry of raw.split("\0").filter(Boolean)) {
      const tab = entry.indexOf("\t");
      const [fileMode, type, oid] = entry.slice(0, tab).split(" ");
      entries.set(entry.slice(tab + 1), { fileMode, type, oid });
    }
    trees.set(revision, entries);
  }
  const files = new Set([...trees.get("head").keys(), ...trees.get("base").keys()]);
  const checked = new Map();
  function content(name, revision = "head") {
    repoPath(name);
    const key = `${revision}:${name}`;
    if (checked.has(key)) return checked.get(key);
    const entry = trees.get(revision)?.get(name);
    if (!entry || entry.type !== "blob" || !["100644", "100755"].includes(entry.fileMode)) {
      fail(`Evidence is not a tracked regular file: ${key}`);
    }
    const blob = execFileSync("git", ["--no-pager", "-C", root, "cat-file", "blob", entry.oid], {
      maxBuffer: MAX_BYTES,
    });
    if (blob.includes(0)) fail(`Binary evidence is unsupported: ${key}`);
    if (revision === "head") {
      let current = root;
      for (const part of name.split("/")) {
        current = path.join(current, part);
        if (lstatSync(current).isSymbolicLink()) fail(`Symlink evidence is unsupported: ${name}`);
      }
      if (!lstatSync(current).isFile() || !readFileSync(current).equals(blob)) {
        fail(`Checkout evidence differs from exact revision: ${name}`);
      }
    }
    const value = blob.toString("utf8");
    checked.set(key, value);
    return value;
  }
  function evidence(items, label) {
    if (!Array.isArray(items) || !items.length) fail(`Missing evidence: ${label}`);
    return items.map((item) => {
      if (!object(item) || !text(item.explanation) ||
          !Number.isSafeInteger(item.startLine) || !Number.isSafeInteger(item.endLine) ||
          item.startLine < 1 || item.endLine < item.startLine ||
          (item.revision !== undefined && !["head", "base"].includes(item.revision))) {
        fail(`Malformed evidence: ${label}`);
      }
      const value = content(item.path, item.revision);
      const lineCount = value === "" ? 0 : value.split("\n").length - (value.endsWith("\n") ? 1 : 0);
      if (item.endLine > lineCount) fail(`Evidence line out of bounds: ${item.path}`);
      return item;
    });
  }
  if (!Array.isArray(report.claims) || !report.claims.length || !Array.isArray(report.omissions) ||
      !object(report.coverage)) fail("Missing claims, omissions or coverage");
  const reviewed = stringList(report.coverage.reviewedFiles, "reviewedFiles", true);
  const unreviewed = stringList(report.coverage.unreviewedFiles, "unreviewedFiles");
  if (unreviewed.length) fail("Unreviewed files block merge");
  for (const name of reviewed) {
    if (!files.has(name)) fail(`Unknown reviewed file: ${name}`);
    content(name, trees.get("head").has(name) ? "head" : "base");
  }
  const ids = new Set();
  const subjects = new Set();
  const documented = new Set();
  function disposition(item, label) {
    const refs = evidence(item.evidence, label);
    if (!refs.some((ref) => ref.revision !== "base" && isImplementationEvidencePath(ref.path))) {
      fail(`Current implementation evidence required: ${label}`);
    }
    const names = stringList(item.subjectFiles, `${label} subjectFiles`, true);
    for (const name of names) {
      if (!reviewed.includes(name)) fail(`Subject not reviewed: ${name}`);
      // Coverage must actually cite that file, not just label it as reviewed.
      if (!refs.some((ref) => ref.path === name)) fail(`Subject lacks direct evidence: ${name}`);
      subjects.add(name);
    }
    for (const ref of refs) {
      if (ref.revision !== "base" && guide(ref.path)) documented.add(ref.path);
    }
  }
  for (const claim of report.claims) {
    if (!object(claim) || !text(claim.id) || ids.has(claim.id) || !text(claim.claim) ||
        claim.status !== "supported") fail("Invalid, contradicted or unverified claim");
    ids.add(claim.id);
    disposition(claim, claim.id);
  }
  for (const omission of report.omissions) {
    if (!object(omission) || !text(omission.description) || omission.status !== "resolved") {
      fail("Invalid or unresolved omission");
    }
    disposition(omission, omission.description);
  }
  const changed = git("diff", "--no-ext-diff", "--name-only", "--no-renames", "-z", base, head)
    .split("\0").filter(Boolean);
  const moves = unchangedSiteMoves(root, base, head);
  const movedPaths = new Set([...moves.keys(), ...moves.values()]);
  const required = new Set(changed.filter((name) => !movedPaths.has(name))
    .map((name) => artwork.get(name) ?? name));
  if (mode === "baseline") {
    for (const name of trees.get("head").keys()) if (guide(name)) required.add(name);
  }
  if (!required.size) fail("No review scope; use baseline for the initial full guide check");
  for (const name of required) {
    if (!reviewed.includes(name) || !subjects.has(name)) fail(`Missing material coverage: ${name}`);
    if (guide(name) && trees.get("head").has(name) && !documented.has(name)) {
      fail(`Missing current guide evidence: ${name}`);
    }
  }
  return { schemaVersion: 1, headSha: head, baseSha: base, mode, claims: report.claims.length,
    reviewedFiles: reviewed.length, requiredFiles: required.size,
    authenticatedArtworkFiles: [...artwork.keys()] };
}

export function main(args) {
  const options = {};
  const names = { "--report": "reportPath", "--head": "head", "--base": "base", "--root": "root", "--mode": "mode" };
  for (let i = 0; i < args.length; i += 2) {
    const name = names[args[i]];
    if (!name || !args[i + 1] || options[name] !== undefined) fail("Invalid or duplicate CLI option");
    options[name] = args[i + 1];
  }
  for (const name of ["reportPath", "head", "base", "root"]) if (!options[name]) fail(`Missing ${name}`);
  return validateReport(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify({ result: "pass", ...main(process.argv.slice(2)) }));
  } catch (error) {
    console.error(`FACT-CHECK BLOCKED: ${error.message}`);
    process.exitCode = 1;
  }
}
