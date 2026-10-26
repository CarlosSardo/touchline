#!/usr/bin/env bash
# Prints "true" when commit SHA's exact git tree already passed the full Verify workflow on a pull request,
# so CI can skip re-running it after a squash merge of an up-to-date PR; "false" otherwise (reasons on stderr).
# A pull_request run tests the PR's test merge commit, not the PR head, so its Plan job logs the tree it tested
# ("touchline-tested-tree=<tree> commit=<sha>"). Reuse needs a merged PR into main whose pull_request Verify run
# has every job successful (no skipped suite) and a recorded tested tree equal to SHA's tree. Runs without the
# record are never reused, and any error means "false" (fail closed).
# Usage: scripts/ci/verified.sh <sha>   (needs gh with read access; GITHUB_REPOSITORY or the git remote)

# Reads a job log on stdin; prints "<tree> <commit>" when it records exactly one tested tree, else fails.
tested_tree() {
  local records
  records=$(sed -nE 's/^(\xEF\xBB\xBF)?([0-9TZ:.-]+ )?touchline-tested-tree=([0-9a-f]{40}) commit=([0-9a-f]{40})\r?$/\3 \4/p' | sort -u)
  [[ "$records" =~ ^[0-9a-f]{40}\ [0-9a-f]{40}$ ]] && printf '%s\n' "$records"
}
# Sourcing the script only defines tested_tree (for tests).
[[ "${BASH_SOURCE[0]}" == "$0" ]] || return 0

say() { printf '%s\n' "$*" >&2; }
# Exactly one answer on stdout and exit status 0, whatever happens: any error before "true" means "false".
answer=false
finish() {
  local status=$?
  (( status == 0 )) || say "Error (exit ${status}) while checking ${sha:-the commit}; not reusing."
  echo "$answer"
  exit 0
}
trap finish EXIT
set -euo pipefail
sha=${1:?Usage: scripts/ci/verified.sh <sha>}
repo=${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}
# GitHub API reads with retries: a transient error must not cost a full re-verification.
api() { local attempt; for attempt in 1 2 3; do gh api "$@" && return; sleep $((attempt * 3)); done; return 1; }
# Job logs contain terminal colour codes, which gh >= 2.97 refuses to print without this flag.
raw=()
if gh api --help 2>/dev/null | grep -q -- --allow-escape-sequences; then raw=(--allow-escape-sequences); fi

tree=$(api "repos/$repo/commits/$sha" --jq .commit.tree.sha)
heads=$(api "repos/$repo/commits/$sha/pulls" --jq '.[] | select(.merged_at != null and .base.ref == "main") | .head.sha')
for head in $heads; do
  runs=$(api "repos/$repo/actions/workflows/verify.yml/runs?head_sha=$head&event=pull_request&status=success" \
    --jq '.workflow_runs[].id')
  for run in $runs; do
    jobs=$(api "repos/$repo/actions/runs/$run/jobs?per_page=100")
    if ! jq -e '.jobs | length > 0 and all(.conclusion == "success")' <<< "$jobs" >/dev/null; then
      say "Verify run $run on PR head $head skipped or failed a job: $(jq -c '[.jobs[].conclusion]' <<< "$jobs")"
      continue
    fi
    plan=$(jq -r '[.jobs[] | select(.name == "Plan") | .id] | if length == 1 then .[0] else empty end' <<< "$jobs")
    if [[ -z "$plan" ]]; then say "Verify run $run has no single Plan job."; continue; fi
    if ! record=$(api "${raw[@]}" "repos/$repo/actions/jobs/$plan/logs" | tested_tree); then
      say "Verify run $run did not record the tree it tested (older run or log unavailable); not reusing it."
      continue
    fi
    read -r tested commit <<< "$record"
    if [[ "$tested" == "$tree" ]]; then
      say "Verify run $run passed every job on tree $tree (test merge $commit of PR head $head), the tree of $sha."
      answer=true
      exit 0
    fi
    say "Verify run $run tested tree $tested (test merge $commit), not $sha's tree $tree (main moved before the merge)."
  done
done
say "No complete Verify run tested the tree of $sha; it will be verified now."
