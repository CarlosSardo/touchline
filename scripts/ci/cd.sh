#!/usr/bin/env bash
# CD steps of .github/workflows/cd.yml, runnable anywhere with gh, git and SSH access to the host:
#   scripts/ci/cd.sh candidate <sha>   prints true when <sha> is the newest commit on main and passed CI
#                                      (Verify, push event); false when main has moved on (the newer commit's
#                                      CI starts its own release); fails when <sha> was never verified.
#   scripts/ci/cd.sh deploy <sha>      deploys <sha>'s CI image with scripts/deploy.sh, unless the host already
#                                      runs it or a newer commit (never downgrades) or main has moved on; then
#                                      checks the host runs <sha> and is healthy.
# Environment: DEPLOY_HOST (default carlos@raspberrypi; `local` on the host itself, as CD's self-hosted runner
# does), DEPLOY_SSH_OPTS, TOUCHLINE_DIR (default touchline), GHCR_TOKEN/GHCR_USER for the pull (see
# scripts/deploy.sh), GH_TOKEN for the GitHub API (gh if installed, otherwise curl + jq).
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."

command=${1:?Usage: scripts/ci/cd.sh candidate|deploy <sha>}
sha=${2:?Usage: scripts/ci/cd.sh candidate|deploy <sha>}
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "cd: <sha> must be a full commit sha" >&2; exit 2; }
repo=${GITHUB_REPOSITORY:-$(git remote get-url origin | sed -E 's#^(https://github.com/|git@github.com:)##; s#\.git$##')}
host=${DEPLOY_HOST:-carlos@raspberrypi}
dir=${TOUCHLINE_DIR:-touchline}

note() { if [[ -n "${GITHUB_ACTIONS:-}" ]]; then echo "::notice::$*"; else echo "cd: $*"; fi; }
summary() { if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then printf '%s\n' "$@" >> "$GITHUB_STEP_SUMMARY"; fi; }
# GitHub API and SSH with retries: a transient blip must not fail a release.
retry() { local attempt; for attempt in 1 2 3 4 5; do "$@" && return; sleep $((attempt * 5)); done; return 1; }
# api PATH JQ: a GitHub API read, through gh when installed, otherwise curl + jq with GH_TOKEN.
github() {
  if command -v gh >/dev/null; then gh api "$1" --jq "$2"; return; fi
  curl -fsSL -H "Authorization: Bearer ${GH_TOKEN:?GH_TOKEN is needed without gh}" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/$1" | jq -r "$2"
}
api() { retry github "$@"; }
# shellcheck disable=SC2086,SC2029 # DEPLOY_SSH_OPTS is a list of options; commands run on the host
remote() { if [[ "$host" == local ]]; then bash -c "$*"; else ssh ${DEPLOY_SSH_OPTS:-} "$host" "$@"; fi; }
newest() { api "repos/$repo/git/ref/heads/main" .object.sha; }
running() {
  remote "docker image inspect local/touchline:latest -f '{{ index .Config.Labels \"org.opencontainers.image.revision\" }}' 2>/dev/null || true"
}

candidate() {
  local main verified
  main=$(newest)
  if [[ "$main" != "$sha" ]]; then
    note "${sha:0:12} is no longer the newest commit on main (${main:0:12}); that commit's CI releases it."
    echo false; return
  fi
  verified=$(api "repos/$repo/actions/workflows/verify.yml/runs?head_sha=$sha&event=push&status=success" .total_count)
  if [[ "$verified" == 0 ]]; then
    echo "cd: ${sha:0:12} has no successful CI run on main; refusing to release it" >&2; exit 1
  fi
  echo true
}

deploy() {
  local before after main full health
  retry remote true || { echo "cd: cannot reach $host" >&2; exit 1; }
  before=$(retry running)
  # The host's image records its commit (the full sha from CI, 12 characters from a --build deploy).
  if [[ -n "$before" && "$sha" == "$before"* ]]; then
    note "$host already runs ${sha:0:12}; nothing to deploy."
  elif [[ -n "$before" ]] && full=$(git rev-parse -q --verify "$before^{commit}") && git merge-base --is-ancestor "$sha" "$full"; then
    note "$host runs ${full:0:12}, which is newer than ${sha:0:12}; not downgrading."
    summary "Skipped: $host already runs the newer ${full:0:12}."
    return
  else
    main=$(newest)
    if [[ "$main" != "$sha" ]]; then
      note "main moved on to ${main:0:12} during the release; its own release deploys it."
      summary "Skipped: main moved on to ${main:0:12}."
      return
    fi
    scripts/deploy.sh "$host" "$sha"
  fi
  after=$(retry running)
  [[ -n "$after" && "$sha" == "$after"* ]] || { echo "cd: $host runs '${after:-nothing}', not ${sha:0:12}" >&2; exit 1; }
  health=$(retry remote "cd ~/$dir && curl -fsS --max-time 10 \"http://\$(docker compose port app 3001)/api/health\"")
  echo "cd: $host runs ${sha:0:12}; health $health"
  summary "Deployed \`${sha:0:12}\` to \`$host\` (running revision verified; health \`$health\`)."
}

case "$command" in
  candidate) candidate ;;
  deploy) deploy ;;
  *) echo "Usage: scripts/ci/cd.sh candidate|deploy <sha>" >&2; exit 2 ;;
esac
