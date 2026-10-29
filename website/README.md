# Touchline docs site

The player handbook, engineering docs and marketing home page, built as a static site with [Astro](https://astro.build), [Tailwind CSS](https://tailwindcss.com) and [Pagefind](https://pagefind.app) search. It is an isolated npm package: it does not share dependencies with the game, and app CI ignores this folder.

## Commands

Run these from `website/` with the Node version in [../.nvmrc](../.nvmrc).

| Command | What it does |
| --- | --- |
| `npm ci` | Install the site's dependencies. |
| `npm run dev` | Start the dev server at <http://localhost:4321/touchline/>. Search is unavailable here because the index is built afterwards. |
| `npm run build` | Build to `dist/` and generate the Pagefind search index. |
| `npm run preview` | Serve the built site (with search) at <http://localhost:4321/touchline/>. |
| `npm run check` | Type-check content, components and pages. |

`DOCS_SITE` (origin) and `DOCS_BASE` (path, with trailing slash) override the default GitHub Pages target `https://carlossardo.github.io/touchline/`.

## Content

| Path | Owner |
| --- | --- |
| [src/content/docs/play/](src/content/docs/play/) | Player handbook (sidebar section "Player guide") |
| [src/content/docs/technical/](src/content/docs/technical/) | Engineering docs (sidebar section "Engineering") |
| [public/images/game/](public/images/game/) | Real in-game screenshots, with captions and alt text in `manifest.json` |

Pages are plain Markdown with `title` and `description` frontmatter, so they also read well on GitHub.

- Link between pages with relative `.md` links. The build rewrites them to site routes. Links to other repository files become GitHub links.
- Sidebar order follows the links in each folder's `index.md`. An optional `order:` frontmatter value overrides it.
- `mermaid` code blocks are rendered as diagrams in the browser.

## Publishing

[.github/workflows/docs.yml](../.github/workflows/docs.yml) builds the site for every pull request and every push to `main` that changes it. It publishes to GitHub Pages only after Pages is enabled with "GitHub Actions" as the source and the repository variable `DOCS_PAGES_ENABLED` is set to `true`.
