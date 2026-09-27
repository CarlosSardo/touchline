# Contributing to Touchline

## Development

Use the Node version in [.nvmrc](.nvmrc) and run `npm ci`. Use a separate local SQL development target and explicitly migrate/import or seed it before `npm run dev`; startup does not initialize a world. Hosted startup instead requires an explicitly provisioned account registry and permits empty per-user worlds. See [README.md](README.md) for setup, provisioning and save handling.

The approved hobby architecture is one React + Express Azure Container App on Consumption (minimum zero, maximum one replica), one Azure SQL Free database, and private GHCR images built and deployed from the owner's workstation. Use managed identity for hosted SQL access and Azure CLI identity for local cloud access. Hosted sign-in uses EasyAuth `common/v2.0` with a personal-Microsoft-account app registration: the home tenant is accepted only for the owner and legacy allowlist, while invitees must sign in through the personal Microsoft account tenant with an accepted invite email. Do not trust arbitrary work/school email claims or broaden access to a tenant. Each human has a separate world/save schema selected through `accounts.users`, keyed by `(tenant_id, object_id)` with unique `game_schema`. Keep unrelated external gameplay APIs, telemetry and player faces out of scope.

Preserve legacy worlds through the approved automatic rebinds only: `sardo.kiko@gmail.com` for the legacy `dbo` world and `carlos.sardo@outlook.com` for the owner. New invitees claim an accepted invite on first personal-account sign-in; an owner-executed procedure creates their private world, and the runtime must still lack `CREATE SCHEMA` or broad DDL rights. Keep human account display name/email separate from the fictional sporting director. Do not infer ownership from a director name, profile email, selected SQL schema or a supplied save ID.

## Conflicting Instructions

The latest approved Azure plan supersedes older local-only, SQLite-runtime and mandatory GitHub Actions instructions. Do not add Terraform, HCP Terraform, a GitHub Actions pipeline, ACR, paid default logging, private-network infrastructure or SQL keepalive probes. Ask before changing the hosting, cost or authentication constraints. A free allowance is not a guarantee of a zero bill.

Work with existing uncommitted changes, including other contributors' changes. Respect assigned file ownership; report a dependency outside your scope instead of editing it. Never revert someone else's work or regenerate a legacy career to resolve a conflict. Preserve SQLite originals and their companions offline; SQLite is only a one-time import source, not an alternative runtime.

Before changing a system, read its current implementation and [REQUIREMENTS.md](REQUIREMENTS.md). That document distinguishes implemented gameplay from known realism gaps; update it when those boundaries change.

## Pull Requests

- Keep changes focused and add regression coverage for changed behavior.
- Run the registered `npm run verify` entrypoint locally: lint, production build, SQL-enabled unit/integration/save tests and browser tests. Install Playwright Chromium first with `npx playwright install chromium`. For the provisioned Azure target, use `npm run azure:sql -- --tests -- npm run verify`; it sets the target and test opt-in, clears password credentials and removes its temporary workstation-IP firewall rule on exit. The approved workflow uses local verification, not GitHub Actions.
- Account tests run with API, Store and saves in the persistence group of `npm run test:local -- npm run verify -- --parallel`. Local no-auth supplied-Store mode and synthetic principal tests do not prove hosted Entra isolation. Confirm missing registry, stale non-dbo schema, valid empty accounts, no-mutation skipped preparation and old-image rejection separately; do not claim deployment or test success without recorded results.
- Use the real SQL schema for integration and browser tests, not SQLite or a reduced persistence substitute. Tests use isolated `touchline_test_` / `touchline_e2e_` schemas. Remote tests require both `SQL_ALLOW_REMOTE_TESTS=true` and `SQL_TEST_DATABASE` matching `SQL_DATABASE`; do not create an extra Azure test environment.
- For interface or gameplay workflows, install Playwright Chromium with `npx playwright install chromium` and run `npm run test:e2e`. The browser suite uses separate ports and verifies the target database and isolated schema before mutation. `TEST_URL` must identify a test instance, never any hosted player's world.
- Never run destructive tests against a player's active world. Do not bypass test guards, silently skip unavailable SQL checks, or treat historical SQLite results as proof of SQL compatibility. Report checks actually run, their failures and any untested Azure behavior.
- Keep secrets only in the ignored `.env`, never in documentation, tracked configuration, images, logs or test output. Never commit databases, exports, dependencies, generated builds or test artifacts.
- Migration and seed changes need explicit review. Inventory legacy sources first; conversion requires `--apply --yes`, and replacement requires a new backup path. Seed only a new empty database, never an existing career. Do not delete original databases, snapshots or sidecars after conversion.
- Invite access is the reviewed provisioning path: configure personal-account auth with `npm run azure:auth -- --yes --allow-personal-accounts`, keep SMTP secrets only in `.env`, deploy, then approve requests through `/admin/invites`. Do not hand-add guests for normal access or authorize players by unverified email. Accepted invites are claimed on first sign-in; deployment/rollback must not bypass the registry, stored procedures or grants. Use registered migrations/grants thereafter. `--skip-db-prepare` retains read-only checks of the registry and every schema, without requiring state in empty accounts. Review backups beyond the automatic dbo active-world export.
- Runtime rollback fails closed after registry creation because retained metadata cannot prove image-bound isolation. Gameplay `--image` releases are also blocked; use a reviewed forward source build or separately approved internal maintenance. Never treat inherited environment markers as image proof, weaken public EasyAuth, delete the registry or automatically restore/reseed to recover an old revision.
- Preserve replay compatibility when changing match rules. Version match snapshots instead of changing the interpretation of historical fixtures.
- Include a brief description of the behavior changed, the checks run and any remaining limitations.

## Bug Reports

Open a [GitHub issue](https://github.com/CarlosSardo/touchline/issues) with reproduction steps, expected and actual behavior, Node/browser versions and the in-game date. Include relevant error messages, but do not upload personal saves or credentials by default.

## License

Contributions are provided under the repository's [MIT License](LICENSE). Third-party dependencies and any contributed assets must retain their applicable license notices.
