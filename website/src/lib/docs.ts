import { getCollection, type CollectionEntry } from "astro:content";
import { docHref, ROOT_DOCS, slugFromRelPath } from "./routes.mjs";

export type Doc = CollectionEntry<"docs"> | CollectionEntry<"rootDocs">;

export interface DocPage {
  entry: Doc;
  slug: string;
  href: string;
  title: string;
  label: string;
  description?: string;
  section: SectionKey;
  /** Repository-relative path of the canonical Markdown file. */
  sourcePath: string;
  /** Explicit sidebar position, when set. */
  order?: number;
}

export interface NavGroup {
  label: string;
  href?: string;
  pages: DocPage[];
}

export interface NavSection {
  key: SectionKey;
  label: string;
  blurb: string;
  href: string;
  groups: NavGroup[];
}

export type SectionKey = "play" | "technical" | "other";

// Top-level folders under src/content/docs, in sidebar order.
export const SECTIONS: Record<SectionKey, { label: string; blurb: string }> = {
  play: { label: "Player guide", blurb: "Learn the game and get the most out of every season." },
  technical: { label: "Engineering", blurb: "Architecture, tech stack and how Touchline is built." },
  other: { label: "More", blurb: "Everything else." },
};

const base = import.meta.env.BASE_URL;

type RootDocKey = keyof typeof ROOT_DOCS;
const rootDocKey = (entry: Doc): RootDocKey | undefined =>
  entry.collection === "rootDocs" ? (entry.filePath ?? "").replace(/\\/g, "/").replace(/^(\.\.\/)+/, "") as RootDocKey : undefined;

/** Path relative to src/content/docs; root documents report the path of the route they are mounted at. */
function relPath(entry: Doc): string {
  const root = rootDocKey(entry);
  if (root) return `${ROOT_DOCS[root].slug}.md`;
  const file = entry.filePath ?? `${entry.id}.md`;
  return file.replace(/\\/g, "/").replace(/^.*?src\/content\/docs\//, "");
}

const sourcePathOf = (entry: Doc): string => rootDocKey(entry) ?? `website/src/content/docs/${relPath(entry)}`;

/** Root documents carry no frontmatter: use the first "# " heading as their title. */
const firstHeading = (body = "") => /^#[ \t]+(.+?)[ \t#]*$/m.exec(body.replace(/^```[\s\S]*?^```/gm, ""))?.[1];

const sectionOf = (slug: string): SectionKey => {
  const top = slug.split("/")[0];
  return top === "play" || top === "technical" ? top : "other";
};

// Pages without an explicit order follow the order in which their folder's index.md links to them.
const indexLinkOrder = new Map<string, number>();

function learnIndexOrder(pages: DocPage[]) {
  for (const page of pages) {
    const rel = relPath(page.entry);
    if (!/(^|\/)index\.md$/i.test(rel)) continue;
    const dir = rel.replace(/index\.md$/i, "");
    let position = 0;
    for (const match of (page.entry.body ?? "").matchAll(/\]\((?:\.\/)?([^)#\s]+\.md)(?:#[^)]*)?\)/g)) {
      const slug = slugFromRelPath(`${dir}${match[1]}`.replace(/[^/]+\/\.\.\//g, ""));
      if (!indexLinkOrder.has(slug)) indexLinkOrder.set(slug, ++position);
    }
  }
}

const orderOf = (page: DocPage): number => {
  if (typeof page.order === "number") return page.order;
  if (/(^|\/)index\.md$/i.test(relPath(page.entry))) return -1000;
  const linked = indexLinkOrder.get(page.slug);
  if (linked !== undefined) return linked;
  const prefix = /(?:^|\/)(\d+)[-_][^/]*$/.exec(relPath(page.entry).replace(/\.md$/i, ""));
  return prefix ? Number(prefix[1]) : 1000;
};

const byOrder = (a: DocPage, b: DocPage) => orderOf(a) - orderOf(b) || a.label.localeCompare(b.label);

const titleCase = (s: string) => s.replace(/^\d+[-_]/, "").replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());

let cache: Promise<DocPage[]> | undefined;

export function getDocPages(): Promise<DocPage[]> {
  cache ??= Promise.all([getCollection("docs", (entry) => !entry.data.draft), getCollection("rootDocs")]).then(([docs, roots]) => [
    ...docs.map((entry): DocPage => {
      const slug = slugFromRelPath(relPath(entry));
      return {
        entry,
        slug,
        href: docHref(base, slug),
        title: entry.data.title,
        label: entry.data.sidebar?.label ?? entry.data.title,
        description: entry.data.description,
        section: sectionOf(slug),
        sourcePath: sourcePathOf(entry),
        order: entry.data.order ?? entry.data.sidebar?.order,
      };
    }),
    ...roots.map((entry): DocPage => {
      const meta = ROOT_DOCS[rootDocKey(entry)!];
      const title = firstHeading(entry.body) ?? meta.label;
      return {
        entry,
        slug: meta.slug,
        href: docHref(base, meta.slug),
        title,
        label: meta.label,
        description: meta.description,
        section: sectionOf(meta.slug),
        sourcePath: sourcePathOf(entry),
        order: meta.order,
      };
    }),
  ]).then((pages) => {
    learnIndexOrder(pages);
    return pages;
  });
  return cache;
}

/** Sidebar: one section per top-level folder, one group per sub-folder (its index page is the group link). */
export async function getNavigation(): Promise<NavSection[]> {
  const pages = await getDocPages();
  const sections: NavSection[] = [];
  for (const key of Object.keys(SECTIONS) as SectionKey[]) {
    const inSection = pages.filter((p) => p.section === key);
    if (!inSection.length) continue;
    const root = key === "other" ? "" : key;
    const groups = new Map<string, NavGroup>();
    const top: DocPage[] = [];
    for (const page of inSection) {
      const rest = root ? page.slug.slice(root.length).replace(/^\//, "") : page.slug;
      const parts = rest.split("/").filter(Boolean);
      if (parts.length <= 1) {
        top.push(page);
        continue;
      }
      const name = parts[0];
      const group = groups.get(name) ?? { label: titleCase(name), pages: [] };
      group.pages.push(page);
      groups.set(name, group);
    }
    // A top-level page whose slug matches a sub-folder becomes that group's heading link.
    for (const [name, group] of groups) {
      const indexPage = top.find((p) => p.slug === (root ? `${root}/${name}` : name));
      if (indexPage) {
        group.label = indexPage.label;
        group.href = indexPage.href;
        group.pages.unshift(indexPage);
        top.splice(top.indexOf(indexPage), 1);
      }
      group.pages.sort(byOrder);
    }
    top.sort(byOrder);
    const sectionIndex = top.find((p) => p.slug === root);
    const ordered: NavGroup[] = [];
    if (top.length) ordered.push({ label: SECTIONS[key].label, pages: top });
    const groupList = [...groups.values()].sort((a, b) => {
      const firstA = a.pages[0];
      const firstB = b.pages[0];
      return byOrder(firstA, firstB);
    });
    ordered.push(...groupList);
    sections.push({
      key,
      label: SECTIONS[key].label,
      blurb: SECTIONS[key].blurb,
      href: sectionIndex?.href ?? top[0]?.href ?? groupList[0]?.pages[0]?.href ?? docHref(base, ""),
      groups: ordered,
    });
  }
  return sections;
}

/** Reading order for previous/next links: the sidebar flattened. */
export async function getReadingOrder(): Promise<DocPage[]> {
  return (await getNavigation()).flatMap((s) => s.groups.flatMap((g) => g.pages));
}
