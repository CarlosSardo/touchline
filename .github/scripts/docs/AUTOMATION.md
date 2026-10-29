# Automated documentation maintenance

`.github/workflows/docs-maintenance.yml` starts on pushes to `main`. It skips
docs-only changes, performs a full guide baseline after automation or checker
policy changes and until a verified documentation PR has merged, and otherwise
reviews every source change since the source revision named by the latest merged
`docs: refresh documentation from <40-hex-sha>` commit.

The workflow has three trust boundaries:

1. The writer runs the pinned GitHub Copilot CLI in a non-interactive session
   with only read, search, and edit tools. Shell, MCP, URL access, temp-file
   access, and custom repository instructions are disabled. The runtime checks
   every path and file mode; only root README/DEVELOPMENT/CONTRIBUTING/
   REQUIREMENTS, Markdown guides under `website/src/content/docs/`, and
   allowlisted game-image paths can be proposed.
2. The fact-checker runs as a new Copilot CLI process in a clean detached
   checkout. It has read/search tools only. The runtime captures its bounded
   JSON response outside the checkout, and `fact-check.mjs` verifies the
   report's schema, exact revisions, tracked evidence, source references, and
   coverage. A passing model response alone is not sufficient. The docs site's
   locked dependencies and `npm --prefix website run verify` also run on the
   exact candidate tree without the Copilot token. Up to three writer/checker
   attempts are allowed; any uncertainty or exhausted attempt fails closed.
3. Only a separate publish job receives a repository-scoped GitHub App token.
   It checks the source revision is still current, verifies the artifact hash
   and reconstructed content tree, pushes a docs-only branch, opens a PR, and
   requests GitHub auto-merge. It never directly updates `main`, disables
   required checks, or bypasses branch protection. The PR workflow repeats the
   checker and website verification on the exact PR head. A failed gate leaves
   the last merged/published site unchanged.

## One-time repository configuration

Add these Actions secrets without putting their values in the repository:

| Secret | Configuration |
|---|---|
| `COPILOT_GITHUB_TOKEN` | A fine-grained PAT owned by a personal GitHub account, restricted to this repository, with the account-level **Copilot Requests** permission and only the repository read access needed for the private checkout. The same read-only credential is available only to the agent job and the isolated PR checker. |
| `DOCS_AUTOMATION_APP_ID` | The GitHub App ID for the automation identity. |
| `DOCS_AUTOMATION_APP_PRIVATE_KEY` | The private key for that App. Rotate it using the organization's normal secret-rotation process. |

Install the App on this repository with **Contents: read and write** and
**Pull requests: read and write**. The workflow requests only write access to
contents and pull requests in its short-lived publish-job token. Do not grant
the App permission to bypass branch protections or rulesets.

Protect the `docs-maintenance-verified-*` tag namespace with a tag ruleset:
only the automation App may create those tags, and nobody may update or delete
them. A tag is written only after a full successful review found no docs
changes; merged docs PR titles carry the verified source revision otherwise.
This durable anchor prevents repeated full baselines while preserving the last
successfully published source boundary.

Enable **Allow auto-merge** in repository settings. Keep the existing rulesets
and branch protections in force, and require the `Docs maintenance / Verify
docs maintenance PR` check if the repository requires checks for merges. Do not
add a required human approval for this bot if the intended policy is unattended
publication. If a protection, required check, or repository setting prevents
auto-merge, the PR remains unmerged and the existing published site is retained;
the automation does not work around the setting.
Require branches to be up to date before merge, or use a merge queue that
revalidates the current base; otherwise `main` could advance after the PR check
and before auto-merge.

Run **Docs maintenance** with `force_baseline: true` once after the docs site
and verifier are merged to seed the full guide baseline. A normal push only
starts a review when its commit includes an application-source change. Docs-only
automation PR merges do not recursively start another writer run.

## Runtime, access, and cost

The CLI is installed as `@github/copilot@1.0.105`, and Actions are pinned to
immutable commit SHAs in the workflow. Unattended CLI authentication uses
`COPILOT_GITHUB_TOKEN`, the environment-variable flow documented for CI/CD by
GitHub; the workflow does not use a device-code flow or an invented service
token. The writer cannot access the GitHub App token, and the publish job never
receives the Copilot PAT. The App token is used instead of `GITHUB_TOKEN` for
branch pushes and PR creation so those events can start their own validation
workflow; GitHub [suppresses most events caused by `GITHUB_TOKEN`](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow#triggering-a-workflow-from-a-workflow).

The CLI must reach GitHub Copilot's service to authenticate and request model
responses. Agent tools do not include shell, URL fetch, MCP, or nested-agent
access; GitHub-hosted runner network egress itself is not firewall-restricted by
this workflow. Documentation and source context are sent to GitHub Copilot for
processing under the account's Copilot policy.

Copilot CLI usage consumes GitHub AI Credits. Credit use varies with model,
input size, and the number of writer/checker calls; a run may use up to three
correction attempts. Included credits, additional-usage controls, and
organization policy depend on the Copilot plan. Review the current [Copilot
plans](https://docs.github.com/en/copilot/get-started/plans) and
[usage-based billing](https://docs.github.com/en/copilot/concepts/billing-and-usage/individuals/billing)
before enabling the secrets. GitHub's [CLI authentication
guide](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli)
documents the user-owned fine-grained PAT and Copilot Requests requirement;
the [programmatic CLI
guide](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically)
documents non-interactive use and least-privilege tool flags.

## Local checks

Run the orchestration unit tests without project dependencies:

```sh
node --test .github/scripts/docs/maintenance.test.mjs .github/scripts/docs/runtime.test.mjs
```

End-to-end execution requires the three secrets above, a GitHub App installed
with the listed permissions, repository auto-merge enabled, and a protected
`main`. Do not test by granting a personal token write access or disabling
branch protection.
