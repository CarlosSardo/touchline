// Deterministic post-build check of website/dist, run by `npm run verify`:
// every internal link, image and asset resolves to a built file, every same-site #fragment exists on its target
// page, every docs page is marked for the Pagefind index, and each canonical root document (ROOT_DOCS) was rendered.
// Exits non-zero with a list of problems so CI and automation fail closed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT_DOCS } from "../src/lib/routes.mjs";

const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(websiteRoot, "dist");
const base = (process.env.DOCS_BASE || "/touchline/").replace(/\/?$/, "/");
const problems = [];

if (!fs.existsSync(dist)) {
  console.error(`check-dist: ${dist} does not exist; run the build first.`);
  process.exit(1);
}

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const htmlFiles = walk(dist).filter((f) => f.endsWith(".html"));

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const idsCache = new Map();
const idsOf = (file) => {
  if (!idsCache.has(file)) {
    const html = fs.readFileSync(file, "utf8");
    idsCache.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => decode(m[1]))));
  }
  return idsCache.get(file);
};

/** Maps a site URL path to the built file that serves it, or undefined. */
const fileFor = (urlPath) => {
  if (!urlPath.startsWith(base)) return undefined;
  const rel = decodeURIComponent(urlPath.slice(base.length));
  const candidates = rel === "" || rel.endsWith("/") ? [path.join(dist, rel, "index.html")] : [path.join(dist, rel), path.join(dist, rel, "index.html")];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
};

let links = 0;
for (const file of htmlFiles) {
  const relFile = path.relative(dist, file).split(path.sep).join("/");
  const pageUrl = base + relFile.replace(/index\.html$/, "");
  const html = fs.readFileSync(file, "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const raw = decode(m[1]);
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) continue;
    links++;
    const url = new URL(raw, `https://site.invalid${pageUrl}`);
    const target = raw.startsWith("#") ? file : fileFor(url.pathname);
    if (!target) {
      problems.push(`/${relFile}: broken link ${raw}`);
      continue;
    }
    const fragment = decodeURIComponent(url.hash.slice(1));
    if (fragment && target.endsWith(".html") && !idsOf(target).has(fragment)) problems.push(`/${relFile}: missing anchor ${raw}`);
  }
}

const docsPages = htmlFiles.filter((f) => /^docs\/.+\/index\.html$/.test(path.relative(dist, f).split(path.sep).join("/")));
if (!fs.existsSync(path.join(dist, "pagefind", "pagefind.js"))) problems.push("Pagefind index is missing (dist/pagefind/pagefind.js)");
for (const f of docsPages) {
  if (!fs.readFileSync(f, "utf8").includes("data-pagefind-body")) problems.push(`/${path.relative(dist, f)}: not marked for search indexing`);
}

for (const [source, { slug }] of Object.entries(ROOT_DOCS)) {
  const built = fileFor(`${base}docs/${slug}/`);
  if (!built) problems.push(`${source}: not rendered at ${base}docs/${slug}/`);
  else if (!fs.readFileSync(built, "utf8").includes(`/edit/main/${source}"`)) problems.push(`${source}: rendered page does not point back to its canonical source`);
}

// Root edits must rebuild on push; unfiltered PRs also cover stacked branches and required checks.
const workflow = path.join(websiteRoot, "..", ".github", "workflows", "docs.yml");
if (fs.existsSync(workflow)) {
  const yaml = fs.readFileSync(workflow, "utf8");
  const push = yaml.match(/^  push:\n([\s\S]*?)(?=^  [a-z_]+:)/m)?.[1] || "";
  if (!/^  pull_request:\s*\n(?=  [a-z_]+:|\n)/m.test(yaml)) problems.push("docs.yml: pull_request must be unfiltered so every PR emits required verification");
  for (const source of Object.keys(ROOT_DOCS)) {
    if (!push.split("\n").some((line) => line.trim() === `- "${source}"`)) problems.push(`${source}: rendered by the site but not a push path in .github/workflows/docs.yml`);
  }
}

if (problems.length) {
  console.error(`check-dist: ${problems.length} problem(s) in ${htmlFiles.length} pages:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`check-dist: ${htmlFiles.length} pages, ${links} internal links/assets, ${docsPages.length} searchable docs pages, ${Object.keys(ROOT_DOCS).length} root document(s): OK`);
