// Shared by the remark link plugin and the Astro pages so Markdown links and routes always agree.
export const REPO_URL = "https://github.com/CarlosSardo/touchline";
export const REPO_BRANCH = "main";

/** "play/transfers/index.md" -> "play/transfers"; "technical/Architecture.md" -> "technical/architecture". */
export function slugFromRelPath(rel) {
  return rel
    .replace(/\\/g, "/")
    .replace(/\.(md|mdx)$/i, "")
    .replace(/(^|\/)index$/i, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLowerCase().replace(/\s+/g, "-"))
    .join("/");
}

export function withBase(base, path) {
  const b = base.endsWith("/") ? base : `${base}/`;
  return `${b}${path.replace(/^\/+/, "")}`;
}

export function docHref(base, slug) {
  return withBase(base, slug ? `docs/${slug}/` : "docs/");
}
