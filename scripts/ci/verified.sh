#!/usr/bin/env bash
# Prints "true" when commit SHA's exact git tree already passed the full Verify workflow on a pull request,
# so the CD workflow can skip re-running it after a squash merge of an up-to-date PR; "false" otherwise.
# The PR head must have the same tree as SHA (then the PR's test merge was that tree too), and its
# pull_request Verify run must have every job successful (no skipped suite).
# Usage: scripts/ci/verified.sh <sha>   (needs gh with read access; GITHUB_REPOSITORY or the git remote)
set -euo pipefail
sha=${1:?Usage: scripts/ci/verified.sh <sha>}
repo=${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}
say() { printf '%s\n' "$*" >&2; }
# GitHub API reads with retries: a transient error must not cost a full re-verification.
api() { local attempt; for attempt in 1 2 3; do gh api "$@" && return; sleep $((attempt * 3)); done; return 1; }

tree=$(api "repos/$repo/commits/$sha" --jq .commit.tree.sha)
for head in $(api "repos/$repo/commits/$sha/pulls" --jq '.[] | select(.merged_at != null) | .head.sha'); do
  head_tree=$(api "repos/$repo/commits/$head" --jq .commit.tree.sha)
  if [[ "$head_tree" != "$tree" ]]; then
    say "PR head $head has a different tree than $sha (main moved before the merge)."
    continue
  fi
  for run in $(api "repos/$repo/actions/workflows/verify.yml/runs?head_sha=$head&event=pull_request&status=success" \
    --jq '.workflow_runs[].id'); do
    jobs=$(api "repos/$repo/actions/runs/$run/jobs?per_page=100" --jq '[.jobs[] | .conclusion]')
    if jq -e 'length > 0 and all(. == "success")' <<< "$jobs" >/dev/null; then
      say "Verify run $run passed every job on PR head $head, which has the same tree as $sha."
      echo true
      exit 0
    fi
    say "Verify run $run on $head skipped or failed a job: $jobs"
  done
done
say "No complete Verify run for the tree of $sha; it will be verified now."
echo false
