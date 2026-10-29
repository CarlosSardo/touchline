import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

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

export const collections = { docs };
