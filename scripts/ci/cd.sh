#!/usr/bin/env bash
# CD steps of .github/workflows/cd.yml, runnable anywhere with GitHub API access (gh, or curl + jq with GH_TOKEN):
#   scripts/ci/cd.sh candidate         prints the commit to release: the newest commit on main (closest to its
#                                      head) whose push passed CI (Verify), or nothing when there is none.
#   scripts/ci/cd.sh deploy <sha>      deploys <sha>'s CI image with scripts/deploy.sh, unless a newer verified
#                                      commit has appeared (its own CD run deploys it) or the host already runs
#                                      <sha> or a newer commit (never downgrades); then checks that the host's app
#                                      container runs <sha> and /api/health answers.
# Every run recomputes the release, so a CD run that GitHub dropped or one triggered by an older commit can't
# lose or roll back a release, and a newer commit that fails CI doesn't hold back an older verified one.
# Environment: DEPLOY_HOST (default carlos@raspberrypi; `local` on the host itself, as CD's self-hosted runner
# does), DEPLOY_SSH_OPTS, TOUCHLINE_DIR (default touchline), GHCR_TOKEN/GHCR_USER for the pull (see
# scripts/deploy.sh), GH_TOKEN for the GitHub API when gh is not installed.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."

usage='Usage: scripts/ci/cd.sh candidate | deploy <sha>'
command=${1:?$usage}
repo=${GITHUB_REPOSITORY:-$(git remote get-url origin | sed -E 's#^(https://github.com/|git@github.com:)##; s#\.git$##')}
host=${DEPLOY_HOST:-carlos@raspberrypi}
dir=${TOUCHLINE_DIR:-touchline}

# Messages go to stderr: stdout carries only results.
note() { if [[ -n "${GITHUB_ACTIONS:-}" ]]; then echo "::notice::$*" >&2; else echo "cd: $*" >&2; fi; }
summary() { if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then printf '%s\n' "$@" >> "$GITHUB_STEP_SUMMARY"; fi; }
# GitHub API reads and host commands with retries: a transient blip must not fail a release.
retry() { local attempt; for attempt in 1 2 3 4 5; do "$@" && return; sleep $((attempt * 5)); done; return 1; }
github() {
  if command -v gh >/dev/null; then gh api "$1" --jq "$2"; return; fi
  curl -fsSL -H "Authorization: Bearer ${GH_TOKEN:?GH_TOKEN is needed without gh}" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/$1" | jq -r "$2"
}
api() { retry github "$@"; }
# shellcheck disable=SC2086,SC2029 # DEPLOY_SSH_OPTS is a list of options; commands run on the host
remote() { if [[ "$host" == local ]]; then bash -c "$*"; else ssh ${DEPLOY_SSH_OPTS:-} "$host" "$@"; fi; }

# How many commits $2 is ahead of $1: 0 when they are the same commit, empty when $1 is not an ancestor of $2.
ahead() {
  local attempt
  for attempt in 1 2; do
    github "repos/$repo/compare/$1...$2" 'if .status == "ahead" or .status == "identical" then .ahead_by else "" end' 2>/dev/null && return
    sleep 3
  done
}

# The release: of the commits whose push passed CI, the one closest to main's head (main itself when verified).
desired() {
  local main best="" best_ahead="" sha distance
  main=$(api "repos/$repo/git/ref/heads/main" .object.sha)
  for sha in $(api "repos/$repo/actions/workflows/verify.yml/runs?branch=main&event=push&status=success&per_page=50" \
    '[.workflow_runs[].head_sha] | unique | .[]'); do
    distance=$(ahead "$sha" "$main")
    [[ -n "$distance" ]] || continue
    if [[ -z "$best_ahead" ]] || (( distance < best_ahead )); then best=$sha best_ahead=$distance; fi
  done
  echo "$best"
}

# The commit the host's app container runs (its image's revision label; empty when unknown).
running() {
  remote "cd ~/$dir 2>/dev/null && id=\$(docker compose ps -q app 2>/dev/null) && [ -n \"\$id\" ] \
    && docker inspect -f '{{ index .Config.Labels \"org.opencontainers.image.revision\" }}' \"\$id\" || true"
}

candidate() {
  local sha
  sha=$(desired)
  if [[ -z "$sha" ]]; then note "no commit on main has passed CI yet; nothing to release."; return; fi
  echo "$sha"
}

deploy() {
  local sha=${1:?$usage} release before after health
  [[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "cd: <sha> must be a full commit sha" >&2; exit 2; }
  retry remote true || { echo "cd: cannot reach $host" >&2; exit 1; }
  release=$(desired)
  if [[ -n "$release" && "$release" != "$sha" && -n "$(ahead "$sha" "$release")" ]]; then
    note "${release:0:12} passed CI after ${sha:0:12}; its own CD run deploys it."
    summary "Skipped: the newer verified ${release:0:12} is released by its own CD run."
    return
  fi
  before=$(retry running)
  if [[ -n "$before" && "$sha" == "$before"* ]]; then
    note "$host already runs ${sha:0:12}; nothing to deploy."
  elif [[ -n "$before" && -n "$(ahead "$sha" "$before")" ]]; then
    note "$host runs ${before:0:12}, which is newer than ${sha:0:12}; not downgrading."
    summary "Skipped: $host already runs the newer ${before:0:12}."
    return
  else
    scripts/deploy.sh "$host" "$sha"
  fi
  after=$(retry running)
  [[ -n "$after" && "$sha" == "$after"* ]] || { echo "cd: $host's app runs '${after:-nothing}', not ${sha:0:12}" >&2; exit 1; }
  health=$(retry remote "cd ~/$dir && curl -fsS --max-time 10 \"http://\$(docker compose port app 3001)/api/health\"")
  echo "cd: $host's app runs ${sha:0:12}; health $health" >&2
  summary "Deployed \`${sha:0:12}\` to \`$host\` (running container's revision verified; health \`$health\`)."
}

case "$command" in
  candidate) candidate ;;
  deploy) deploy "${2:-}" ;;
  *) echo "$usage" >&2; exit 2 ;;
esac
