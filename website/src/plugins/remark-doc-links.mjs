// Lets docs be written as plain Markdown that also reads well on GitHub:
// - relative links to other docs (`../play/transfers.md#fees`) become site routes;
// - relative or root links to files in website/public (`/images/game/x.png`) get the site base;
// - a leading h1 is dropped (the layout shows the title);
// - relative links to anything else in the repository (`../../../../server/db.ts`) open on GitHub.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { visit } from "unist-util-visit";
import { docHref, REPO_BRANCH, REPO_URL, ROOT_DOCS, slugFromRelPath, withBase } from "../lib/routes.mjs";

const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = path.resolve(websiteRoot, "..");
const contentRoot = path.join(websiteRoot, "src/content/docs");
const publicRoot = path.join(websiteRoot, "public");

const inside = (root, target) => {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

const repoBlob = `${REPO_URL}/blob/${REPO_BRANCH}/`;

export function rewriteUrl(url, filePath, base) {
  // GitHub links to a root document the site renders (e.g. DEVELOPMENT.md) stay on the site.
  if (url?.startsWith(repoBlob)) {
    const rest = url.slice(repoBlob.length);
    const cut = rest.search(/[?#]/);
    const rel = decodeURI(cut === -1 ? rest : rest.slice(0, cut));
    if (ROOT_DOCS[rel]) return docHref(base, ROOT_DOCS[rel].slug) + (cut === -1 ? "" : rest.slice(cut));
    return url;
  }
  if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("#") || url.startsWith("//")) return url;
  const cut = url.search(/[?#]/);
  const target = cut === -1 ? url : url.slice(0, cut);
  const suffix = cut === -1 ? "" : url.slice(cut);
  if (!target) return url;

  if (target.startsWith("/")) {
    const normalizedBase = base.endsWith("/") ? base : `${base}/`;
    return target.startsWith(normalizedBase) ? url : withBase(base, target) + suffix;
  }
  if (!filePath) return url;

  const absolute = path.resolve(path.dirname(filePath), decodeURI(target));
  if (inside(contentRoot, absolute)) {
    const rel = path.relative(contentRoot, absolute);
    if (/\.mdx?$/i.test(rel) || !path.extname(rel)) return docHref(base, slugFromRelPath(rel)) + suffix;
  }
  if (inside(publicRoot, absolute)) {
    return withBase(base, path.relative(publicRoot, absolute).split(path.sep).join("/")) + suffix;
  }
  if (inside(repoRoot, absolute)) {
    const rel = path.relative(repoRoot, absolute).split(path.sep).join("/");
    if (ROOT_DOCS[rel]) return docHref(base, ROOT_DOCS[rel].slug) + suffix;
    return `${REPO_URL}/blob/${REPO_BRANCH}/${rel}${suffix}`;
  }
  return url;
}

export default function remarkDocLinks({ base = "/" } = {}) {
  return (tree, file) => {
    const filePath = file.path ?? file.history?.[0];
    // The page layout renders the frontmatter title as the h1, so drop a leading "# Title" kept for GitHub readers.
    const first = tree.children.findIndex((node) => node.type !== "yaml" && node.type !== "html");
    if (first !== -1 && tree.children[first].type === "heading" && tree.children[first].depth === 1) tree.children.splice(first, 1);
    visit(tree, ["link", "image", "definition"], (node) => {
      node.url = rewriteUrl(node.url, filePath, base);
    });
  };
}
