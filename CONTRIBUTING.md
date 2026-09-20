# Contributing to Touchline

## Development

Use the Node version in [.nvmrc](.nvmrc), run `npm ci`, and start the local app with `npm run dev`. See [README.md](README.md) for ports, local saves and project structure.

The game must remain local-first. Do not introduce cloud dependencies, external runtime APIs, telemetry, player faces or a remote database. Keep SQLite as the persistence layer.

Before changing a system, read its current implementation and [REQUIREMENTS.md](REQUIREMENTS.md). That document distinguishes implemented gameplay from known realism gaps; update it when those boundaries change.

## Pull Requests

- Keep changes focused and add regression coverage for changed behavior.
- Run `npm run lint`, `npm test` and `npm run build`. GitHub Actions runs these checks for pull requests and pushes to `main`.
- For interface or gameplay workflows, install Playwright Chromium with `npx playwright install chromium` and run `npm run test:e2e`. The browser suite creates its own test career on separate ports.
- Never run destructive tests against a player's active career. Never commit databases, saves, dependencies, generated builds, credentials or test artifacts.
- Preserve replay compatibility when changing match rules. Version match snapshots instead of changing the interpretation of historical fixtures.
- Include a brief description of the behavior changed, the checks run and any remaining limitations.

## Bug Reports

Open a [GitHub issue](https://github.com/CarlosSardo/sports-director-simulator/issues) with reproduction steps, expected and actual behavior, Node/browser versions and the in-game date. Include relevant error messages, but do not upload personal saves or credentials by default.

## License

Contributions are provided under the repository's [MIT License](LICENSE). Third-party dependencies and any contributed assets must retain their applicable license notices.
