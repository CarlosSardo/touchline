import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { ROOT_DOCS } from "./lib/routes.mjs";

// Plain, framework-neutral Markdown: only `title` is required. Optional `order` (or `sidebar.order`)
// sorts pages within a sidebar group; any other frontmatter is kept but ignored.
const docs = defineCollection({
  loader: glob({ base: "./src/content/docs", pattern: "**/*.md" }),
  schema: z
    .object({
      title: z.string(),
      description: z.string().optional(),
      order: z.number().optional(),
      sidebar: z.object({ order: z.number().optional(), label: z.string().optional() }).loose().optional(),
      draft: z.boolean().optional(),
    })
    .loose(),
});

// Canonical repository-root Markdown (see ROOT_DOCS), loaded in place so the repository and the site share
// one source. These files have no frontmatter; the title comes from their first "# " heading.
const rootDocs = defineCollection({
  loader: glob({ base: "..", pattern: Object.keys(ROOT_DOCS) }),
  schema: z.object({}).loose(),
});

export const collections = { docs, rootDocs };
