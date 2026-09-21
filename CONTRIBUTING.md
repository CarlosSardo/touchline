# Contributing to Touchline

## Development

Use the Node version in [.nvmrc](.nvmrc) and run `npm ci`. Configure a SQL connection and explicitly migrate/import or seed before starting `npm run dev`; startup does not initialize a world. See [README.md](README.md) for setup, migration and save handling.

The approved hobby architecture is one React + Express Azure Container App on Consumption (minimum zero, maximum one replica), one Azure SQL Free database, and private GHCR images built and deployed from the owner's workstation. Use managed identity for hosted SQL access, Azure CLI identity for local cloud access, and tenant-bound Microsoft Entra sign-in restricted to the owner plus explicit guest object IDs. Invited collaborators share the same world and game controls; never broaden access to the whole tenant or authorize by email alone. Keep unrelated external gameplay APIs, telemetry and player faces out of scope.

## Conflicting Instructions

The latest approved Azure plan supersedes older local-only, SQLite-runtime and mandatory GitHub Actions instructions. Do not add Terraform, HCP Terraform, a GitHub Actions pipeline, ACR, paid default logging, private-network infrastructure or SQL keepalive probes. Ask before changing the hosting, cost or authentication constraints. A free allowance is not a guarantee of a zero bill.

Work with existing uncommitted changes, including other contributors' changes. Respect assigned file ownership; report a dependency outside your scope instead of editing it. Never revert someone else's work or regenerate a legacy career to resolve a conflict. Preserve SQLite originals and their companions offline; SQLite is only a one-time import source, not an alternative runtime.

Before changing a system, read its current implementation and [REQUIREMENTS.md](REQUIREMENTS.md). That document distinguishes implemented gameplay from known realism gaps; update it when those boundaries change.

## Pull Requests

- Keep changes focused and add regression coverage for changed behavior.
- Run the registered `npm run verify` entrypoint locally: lint, production build, SQL-enabled unit/integration/save tests and browser tests. Install Playwright Chromium first with `npx playwright install chromium`. For the provisioned Azure target, use `npm run azure:sql -- --tests -- npm run verify`; it sets the target and test opt-in, clears password credentials and removes its temporary workstation-IP firewall rule on exit. The approved workflow uses local verification, not GitHub Actions.
- Use the real SQL schema for integration and browser tests, not SQLite or a reduced persistence substitute. Tests use isolated `touchline_test_` / `touchline_e2e_` schemas. Remote tests require both `SQL_ALLOW_REMOTE_TESTS=true` and `SQL_TEST_DATABASE` matching `SQL_DATABASE`; do not create an extra Azure test environment.
- For interface or gameplay workflows, install Playwright Chromium with `npx playwright install chromium` and run `npm run test:e2e`. The browser suite uses separate ports and verifies the target database and isolated schema before mutation. `TEST_URL` must identify a test instance, never the hosted owner's game.
- Never run destructive tests against a player's active world. Do not bypass test guards, silently skip unavailable SQL checks, or treat historical SQLite results as proof of SQL compatibility. Report checks actually run, their failures and any untested Azure behavior.
- Keep secrets only in the ignored `.env`, never in documentation, tracked configuration, images, logs or test output. Never commit databases, exports, dependencies, generated builds or test artifacts.
- Migration and seed changes need explicit review. Inventory legacy sources first; conversion requires `--apply --yes`, and replacement requires a new backup path. Seed only a new empty database, never an existing career. Do not delete original databases, snapshots or sidecars after conversion.
- Preserve replay compatibility when changing match rules. Version match snapshots instead of changing the interpretation of historical fixtures.
- Include a brief description of the behavior changed, the checks run and any remaining limitations.

## Bug Reports

Open a [GitHub issue](https://github.com/CarlosSardo/touchline/issues) with reproduction steps, expected and actual behavior, Node/browser versions and the in-game date. Include relevant error messages, but do not upload personal saves or credentials by default.

## License

Contributions are provided under the repository's [MIT License](LICENSE). Third-party dependencies and any contributed assets must retain their applicable license notices.
