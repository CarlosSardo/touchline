# Automated documentation maintenance

`.github/workflows/docs-maintenance.yml` starts on pushes to `main`. It skips
docs-only changes and performs a full guide baseline on every source or
automation-policy review. Every current guide is checked against the exact
current implementation. Earlier reports, commit titles/authors, PR metadata,
and tags never establish a main source-review boundary. Only an authenticated
identical-input PR verdict can avoid repeating that same independent review.

The workflow has three trust boundaries:

1. The writer runs the pinned GitHub Copilot CLI in a non-interactive session
   with concrete `view`, `rg`, `glob`, and `apply_patch` tools. The checker only
   receives `view`, `rg`, and `glob`. Shell, MCP, URL access, temp-file
   access, custom repository instructions, folder trust, workspace hooks, and
   workspace MCP servers are disabled. The runtime checks
   every path and file mode; only root README/DEVELOPMENT/CONTRIBUTING/
   REQUIREMENTS and Markdown guides under the selected site's
   `website/src/content/docs/` or `docs/src/content/docs/` can be
   proposed. Binary images are not writable or eligible for automatic review.
2. The fact-checker runs as a new Copilot CLI process in a clean detached
   checkout. It has read/search tools only. The runtime captures its bounded
   JSON response outside the checkout, and `fact-check.mjs` verifies the
   report's schema, exact revisions, tracked evidence, source references, and
   coverage. A passing model response alone is not sufficient. The docs site's
   locked dependencies and its `npm run verify` also run on the
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
   screenshot-provenance workflow exists. A one-way site migration may relocate
   existing images only with identical Git blob IDs and regular-file modes.
   Regular-file relocations count once toward the 80-file limit; changed text
   still requires normal review. Image URLs may follow an authenticated exact
   relocation, but changed image bytes, alt text, and destinations
   still block. Badge hyperlink changes do not alter the embedded badge image.
   This never authenticates a new or changed gameplay image. Exactly one tracked site
   manifest/lock pair must exist, under `website/` or `docs/`; ambiguous,
   missing, symlinked, or executable site manifests fail. A failed gate leaves the last
   merged/published site unchanged.

The user-requested social preview has a separate, deliberately fixed provenance
record in trusted `maintenance.mjs`: the reviewed
`docs/public/images/social/touchline-docs.png` must match SHA-256
`80b29db681d49c8554180a210073a5e5d60ee68c53a621edf93edd76ac7dd91e`,
and its `docs/scripts/social-card.html` source must match SHA-256
`2e6ce0dea9bc2847b679de0ba4021a7406ffa811453ec0c87d0ca6cbfba8b680`.
Both must be tracked regular mode `100644` files; the PNG must be 1200x630.
Missing or altered bytes, source, paths or modes fail closed. This attests only
the exact reviewed intentional artwork, not a gameplay observation or arbitrary
binary. The independent report must still cover the HTML source with current-code
evidence; neither the artwork nor that HTML is implementation evidence for product
claims. The validator reports authenticated artwork separately, never as textual
model evidence. Updating these pins requires an ordinary policy-only PR before
an artwork change; neither pin is configurable through reports or workflow input.
The AI writer cannot modify either file, and the gameplay screenshot policy is
unchanged.

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
separate PR-only cost control described below; main writer reviews never reuse
an earlier baseline.

## PR review cost controls

Body/title edits do not trigger this workflow. Superseded PR runs are cancelled;
main maintenance remains serialized without cancellation during publication.
Required PR checks remain unfiltered. Deterministic manifest, policy, content,
site build and link checks run before a paid checker request; maintenance also
builds the source site before invoking its writer and each candidate before its
independent checker.

A passing independent PR report may be reused only for the identical head SHA,
head tree, base SHA and digest of the trusted workflow, runtime, validators and
agent profiles. The candidate workflow must exactly match the trusted base
workflow. The runtime downloads its verdict artifact using read-only Actions
access, verifies the GitHub-hosted run/attempt is a successful `pull_request`
execution of the expected workflow on that exact PR/head/base, and reruns the
protected report validator on the clean exact checkout. No passing skip-only
check, title, author, branch name, PR comment, tag or model-awarded result is
provenance. Artifacts expire after seven days; missing/expired provenance requires
a fresh budgeted review, and malformed/inaccessible provenance fails closed.
Neither cached nor fresh reports replace current deterministic site checks.
The read-only Actions token is removed from build and agent subprocesses.

At most three fresh PR-review workflow starts per PR per UTC day may reach AI.
The cap conservatively counts previous failed/cancelled runs and rerun attempts,
including runs that stopped before AI; authenticated reuse is checked before the
cap and does not call the model. At the cap, the required check fails with an
explicit message rather than silently passing, delaying itself or creating a
new run. There is no next-day scheduler or unbounded retry. An unavailable or
truncated Actions history fails closed. This bounds paid independent PR checks,
not the separate main writer's existing maximum three correction attempts.

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

The runtime inserts the trusted agent profile into each fresh prompt rather than
trusting candidate agent configuration through `--agent`/folder trust. It uses
the CLI's concrete tool names, not profile aliases, for the actual tool filter.
Checker responses must be one complete JSON object (an enclosing JSON Markdown
fence is accepted only when it wraps the whole response); prefixes, suffixes,
multiple objects, stale reports, and unsupported facts still fail closed.
Diagnostics identify only the response format, byte/line counts, and fixed
authentication/quota/trust/tool/error-envelope signal labels, separately for
stdout and stderr. They never echo model/source text, raw CLI errors, or secrets.
These heuristic labels help triage failures; they neither establish the root
cause nor turn a failed response into a passing report.

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
