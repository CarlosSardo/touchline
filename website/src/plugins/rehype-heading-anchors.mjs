// Appends a "#" permalink to every h2-h4 that has an id (Astro adds the ids).
import { visit } from "unist-util-visit";

export default function rehypeHeadingAnchors() {
  return (tree) => {
    visit(tree, "element", (node) => {
      if (!/^h[2-4]$/.test(node.tagName) || !node.properties?.id) return;
      node.children.push({
        type: "element",
        tagName: "a",
        properties: { className: ["heading-anchor"], href: `#${node.properties.id}`, ariaHidden: "true", tabIndex: -1, dataPagefindIgnore: "" },
        children: [],
      });
    });
  };
}
