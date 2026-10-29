// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import { rehypeHeadingIds } from "@astrojs/markdown-remark";
import remarkDocLinks from "./src/plugins/remark-doc-links.mjs";
import rehypeHeadingAnchors from "./src/plugins/rehype-heading-anchors.mjs";

// GitHub Pages project site: https://<owner>.github.io/touchline/. Override both for another host.
const site = process.env.DOCS_SITE || "https://carlossardo.github.io";
const base = process.env.DOCS_BASE || "/touchline/";

export default defineConfig({
  site,
  base,
  trailingSlash: "always",
  build: { format: "directory" },
  markdown: {
    syntaxHighlight: { type: "shiki", excludeLangs: ["mermaid", "math"] },
    shikiConfig: { themes: { light: "github-light", dark: "github-dark" } },
    remarkPlugins: [[remarkDocLinks, { base }]],
    rehypePlugins: [rehypeHeadingIds, rehypeHeadingAnchors],
  },
  vite: { plugins: [tailwindcss()] },
});
