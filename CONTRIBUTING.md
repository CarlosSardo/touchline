# Contributing to Touchline

## Development

Use the Node version in [.nvmrc](.nvmrc) and run `npm ci`. Use a separate local PostgreSQL development target and explicitly migrate/import or seed it before `npm run dev`; startup does not initialize a world. Hosted startup instead requires an explicitly provisioned account registry and permits empty per-user worlds. See [README.md](README.md) for setup, provisioning and save handling.

The approved hobby architecture is self-hosted: one Docker Compose stack on a Raspberry Pi 4 (8 GB, SSD, arm64) with one React + Express app container, one PostgreSQL 18 database and an optional Caddy HTTPS proxy, using multi-arch GHCR images built by the image workflow. The app connects with a non-superuser role that owns the Touchline database; the `postgres` superuser is for administration and backups only, and PostgreSQL is never published beyond loopback. Hosted sign-in is in-app OpenID Connect with a personal-Microsoft-account app registration (redirect URI `https://<host>/auth/callback`): the optional home tenant is accepted only for the owner and legacy allowlist, while invitees must sign in through the personal Microsoft account tenant with an accepted invite email. Do not trust arbitrary work/school email claims or broaden access to a tenant. Each human has a separate world/save schema selected through `accounts.users`, keyed by `(tenant_id, object_id)` with unique `game_schema`. Keep unrelated external gameplay APIs, telemetry and player faces out of scope.

Preserve legacy worlds through the approved automatic rebinds only: `sardo.kiko@gmail.com` for the legacy `dbo` world and `carlos.sardo@outlook.com` for the owner. New invitees claim an accepted invite on first personal-account sign-in, which creates their private world schema; the runtime role must never be a PostgreSQL superuser. Keep human account display name/email separate from the fictional sporting director. Do not infer ownership from a director name, profile email, selected SQL schema or a supplied save ID.

## Conflicting Instructions

The Raspberry Pi + PostgreSQL plan supersedes the retired Azure (Container Apps, Azure SQL, EasyAuth) plan and older local-only and SQLite-runtime instructions. GitHub Actions only verifies (manual or pull request) and builds images; deployment stays a manual `docker compose` step on the Pi. Do not add cloud infrastructure, paid services or extra always-on containers. Ask before changing the hosting, cost or authentication constraints.

Work with existing uncommitted changes, including other contributors' changes. Respect assigned file ownership; report a dependency outside your scope instead of editing it. Never revert someone else's work or regenerate a legacy career to resolve a conflict. Preserve SQLite originals and their companions offline; SQLite is neither a runtime nor a current import source.

Before changing a system, read its current implementation and [REQUIREMENTS.md](REQUIREMENTS.md). That document distinguishes implemented gameplay from known realism gaps; update it when those boundaries change.

## Pull Requests

- Keep changes focused and add regression coverage for changed behavior.
- Run the registered `npm run verify` entrypoint locally through `npm run test:local -- npm run verify` (a disposable PostgreSQL 18 container; add `--no-docker` before `--` to use a running loopback PostgreSQL from `SQL_*`): lint, production build, SQL-enabled unit/integration/save tests and browser tests. Install Playwright Chromium first with `npx playwright install chromium`. The [verify workflow](.github/workflows/verify.yml) runs the same suites against a throwaway PostgreSQL container without secrets.
- Account tests run with API, Store and saves in the persistence group of `npm run test:local -- npm run verify -- --parallel`. Local no-auth supplied-Store mode and synthetic principal tests do not prove hosted OpenID Connect isolation. Confirm missing registry, stale non-dbo schema, valid empty accounts, no-mutation skipped preparation and old-image rejection separately; do not claim deployment or test success without recorded results.
- Use the real SQL schema for integration and browser tests, not SQLite or a reduced persistence substitute. Tests use isolated `touchline_test_` / `touchline_e2e_` schemas. Remote tests require both `SQL_ALLOW_REMOTE_TESTS=true` and `SQL_TEST_DATABASE` matching `SQL_DATABASE`, plus verified TLS; never run tests against the Pi's production database.
- For interface or gameplay workflows, install Playwright Chromium with `npx playwright install chromium` and run `npm run test:e2e`. The browser suite uses separate ports and verifies the target database and isolated schema before mutation. `TEST_URL` must identify a test instance, never any hosted player's world.
- Never run destructive tests against a player's active world. Do not bypass test guards, silently skip unavailable SQL checks, or treat historical SQLite results as proof of SQL compatibility. Report checks actually run, their failures and any untested hosted (Pi, reverse proxy, sign-in) behavior.
- Keep secrets only in the ignored `.env`, never in documentation, tracked configuration, images, logs or test output. Never commit databases, exports, dependencies, generated builds or test artifacts.
- Migration and seed changes need explicit review. Inventory legacy sources first; conversion requires `--apply --yes`, and replacement requires a new backup path. Seed only a new empty database, never an existing career. Do not delete original databases, snapshots or sidecars after conversion.
- Invite access is the reviewed provisioning path: register the OpenID Connect app, keep OIDC, session, invite and SMTP secrets only in `.env`, create the registry with `accounts:migrate -- --apply --yes`, deploy, then approve requests through `/admin/invites`. Do not hand-add guests for normal access or authorize players by unverified email. Accepted invites are claimed on first sign-in; operators must not bypass the registry. Apply world migrations with `db:migrate -- --registered --apply --yes`.
- Back up with `scripts/pi-backup.sh` before every upgrade or migration. Roll back by restoring that backup with `scripts/pi-restore.sh`, never by running an older image against migrated data, deleting the registry, weakening sign-in or reseeding.
- Preserve replay compatibility when changing match rules. Version match snapshots instead of changing the interpretation of historical fixtures.
- Include a brief description of the behavior changed, the checks run and any remaining limitations.

## Bug Reports

Open a [GitHub issue](https://github.com/CarlosSardo/touchline/issues) with reproduction steps, expected and actual behavior, Node/browser versions and the in-game date. Include relevant error messages, but do not upload personal saves or credentials by default.

## License

Contributions are provided under the repository's [MIT License](LICENSE). Third-party dependencies and any contributed assets must retain their applicable license notices.
