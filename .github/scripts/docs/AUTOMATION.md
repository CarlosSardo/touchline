# Automated documentation maintenance

`.github/workflows/docs-maintenance.yml` starts on pushes to `main`. It skips
docs-only changes and performs a full guide baseline on every source or
automation-policy review. Every current guide is checked against the exact
current implementation. Earlier reports, commit titles/authors, PR metadata,
and tags are never reused as verification or as a source-review boundary.

The workflow has three trust boundaries:

1. The writer runs the pinned GitHub Copilot CLI in a non-interactive session
   with only read, search, and edit tools. Shell, MCP, URL access, temp-file
   access, custom repository instructions, folder trust, workspace hooks, and
   workspace MCP servers are disabled. The runtime checks
   every path and file mode; only root README/DEVELOPMENT/CONTRIBUTING/
   REQUIREMENTS and Markdown guides under `website/src/content/docs/` can be
   proposed. Binary images are not writable or eligible for automatic review.
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
   requests GitHub auto-merge only after API checks confirm strict `main`
   protection requires the exact docs-verification check, requires no human
   approval, and blocks force-pushes/deletion. It never directly updates
   `main`, disables required checks, or bypasses branch protection. A separate
   configuration job checks branch protection before the AI job can run.
   The docs check runs on every pull request so its required status exists even
   when no documentation changed; for such PRs it passes without invoking
   Copilot or minting a policy token. Documentation changes, including mixed source-and-documentation
   PRs, are independently checked on the exact PR head; changes to automation
   policy cannot be combined with documentation changes. Changes under
   `website/public/images/game/` fail closed until a separate authenticated
   screenshot-provenance workflow exists. A failed gate leaves the last
   merged/published site unchanged.

## One-time repository configuration

Add these Actions secrets without putting their values in the repository:

| Secret | Configuration |
|---|---|
| `COPILOT_GITHUB_TOKEN` | A fine-grained PAT owned by a personal GitHub account, restricted to this repository, with the account-level **Copilot Requests** permission and only the repository read access needed for the private checkout. The same read-only credential is available only to the agent job and the isolated PR checker. |
| `DOCS_AUTOMATION_APP_ID` | The GitHub App ID for the automation identity. |
| `DOCS_AUTOMATION_APP_PRIVATE_KEY` | The private key for that App. Rotate it using the organization's normal secret-rotation process. |

Install the App on this repository with **Contents: read and write**,
**Pull requests: read and write**, and **Administration: read** so the runtime
can confirm branch protection before publishing. The workflow requests
administration read access in separate preflight and same-repository verifier
steps; the publish-job token requests contents and pull-request writes plus
administration read. The verifier's runtime strips this token before starting
Copilot or running the candidate build. Do not grant the App permission to
bypass branch protections or rulesets.

Protect `main` with classic branch protection that requires branches to be up
to date and both `Verify docs maintenance PR` and `Required CI` from GitHub
Actions (app ID `15368`). These are the exact check-run names; do not prepend
workflow names. Require zero PR
approvals, block force pushes and deletion, and do not require human approval
or code-owner review in any active repository or inherited ruleset. The runtime
reads both classic protection and effective branch rules before
requesting auto-merge; an unavailable policy API or a missing rule fails
closed.

No verification tags, tag rulesets, Checks write permission, or organization
migration are required. If a full review finds no documentation changes, the
run succeeds without creating a commit, tag, or PR. Its result does not exempt
any content from the next full review. Authenticated cached provenance is a
possible future optimization, not part of this workflow.

Enable **Allow auto-merge** in repository settings. The workflow requires
classic branch protection with the strict check above; merge-queue-only setups
are not supported because this workflow does not subscribe to `merge_group`.
The runtime will not merge when protection cannot be read, is incomplete, or
requires human review. Keep repository protections in force; the automation
never works around them.

Run **Docs maintenance** with `force_baseline: true` once after the docs site
and verifier are merged to perform the initial full guide baseline. A normal push only
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

Always reviewing the complete baseline costs more than incremental cached
verification, but avoids trusting forgeable or unavailable provenance markers.
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
