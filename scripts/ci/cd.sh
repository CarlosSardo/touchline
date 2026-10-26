#!/usr/bin/env bash
# CD steps of .github/workflows/cd.yml, runnable anywhere with GitHub API access (gh, or curl + jq with GH_TOKEN):
#   scripts/ci/cd.sh candidate         prints the commit to release: the newest commit on main (closest to its
#                                      head) whose push passed CI (ci.yml), or nothing when there is none.
#   scripts/ci/cd.sh published <sha>   prints true when GHCR already has the sha-<sha> image (GHCR_USER/GHCR_TOKEN).
#   scripts/ci/cd.sh deployed <sha>    prints true when GitHub's newest production deployment is <sha> and it
#                                      succeeded (the scheduled reconcile then skips image and deploy); any doubt
#                                      prints false, so the full, idempotent release path runs.
#   scripts/ci/cd.sh deploy <sha>      deploys <sha>'s CI image with scripts/deploy.sh, unless a newer verified
#                                      commit has become the release or the host already runs <sha> or a newer
#                                      commit (never downgrades); then checks that the host's app container runs
#                                      <sha> and /api/health answers. Any GitHub API error aborts with nothing
#                                      changed (fail closed).
# Every run recomputes the release, so a CD run that GitHub dropped or one triggered by an older commit can't
# lose or roll back a release, and a newer commit that fails CI doesn't hold back an older verified one.
# Environment: DEPLOY_HOST (default carlos@raspberrypi; `local` on the host itself, as CD's self-hosted runner
# does), DEPLOY_SSH_OPTS, TOUCHLINE_DIR (default touchline), GHCR_TOKEN/GHCR_USER for the pull (see
# scripts/deploy.sh), GH_TOKEN for the GitHub API when gh is not installed.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."

usage='Usage: scripts/ci/cd.sh candidate | published <sha> | deployed <sha> | deploy <sha>'
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

COMPARE='if .status == "ahead" then "ahead \(.ahead_by)" else .status end'
# relation A B: how B relates to A: "identical", "ahead N" (B is N commits after A), "behind" (B is before A),
# "diverged", or "unknown" (GitHub doesn't know one of them). Fails on any other API error: callers fail closed.
relation() {
  local attempt out code
  for attempt in 1 2 3; do
    if command -v gh >/dev/null; then
      if out=$(gh api "repos/$repo/compare/$1...$2" --jq "$COMPARE" 2>&1); then echo "$out"; return; fi
      if grep -qE 'HTTP 40[4]|HTTP 422' <<< "$out"; then echo unknown; return; fi
    else
      out=$(curl -sS -o /dev/stdout -w '\n%{http_code}' -H "Authorization: Bearer ${GH_TOKEN:?GH_TOKEN is needed without gh}" \
        -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$repo/compare/$1...$2") || out=$'\n000'
      code=${out##*$'\n'}
      case "$code" in
        200) jq -r "$COMPARE" <<< "${out%$'\n'*}"; return ;;
        404|422) echo unknown; return ;;
      esac
    fi
    sleep $((attempt * 5))
  done
  echo "cd: GitHub compare $1...$2 failed" >&2
  return 1
}

# The release: of the commits whose push passed CI, the one closest to main's head (main itself when verified).
desired() {
  local main shas sha rel distance best="" best_distance=""
  main=$(api "repos/$repo/git/ref/heads/main" .object.sha) || return 1
  shas=$(api "repos/$repo/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=50" \
    '[.workflow_runs[].head_sha] | unique | .[]') || return 1
  for sha in $shas; do
    rel=$(relation "$sha" "$main") || return 1
    case "$rel" in
      identical) distance=0 ;;
      ahead\ *) distance=${rel#ahead } ;;
      *) continue ;;
    esac
    if [[ -z "$best_distance" ]] || (( distance < best_distance )); then best=$sha best_distance=$distance; fi
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
  sha=$(desired) || { echo "cd: could not determine the release" >&2; exit 1; }
  if [[ -z "$sha" ]]; then note "no commit on main has passed CI yet; nothing to release."; return; fi
  echo "$sha"
}

# published <sha>: true when ghcr.io/carlossardo/touchline:sha-<sha> exists (GHCR_TOKEN/GHCR_USER read it).
published() {
  local sha=${1:?$usage} token code
  token=$(curl -fsS -u "${GHCR_USER:?}:${GHCR_TOKEN:?}" \
    "https://ghcr.io/token?scope=repository:carlossardo/touchline:pull&service=ghcr.io" | jq -r .token) || { echo false; return; }
  code=$(curl -sS -o /dev/null -w '%{http_code}' -I -H "Authorization: Bearer $token" \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json' \
    "https://ghcr.io/v2/carlossardo/touchline/manifests/sha-$sha") || code=000
  if [[ "$code" == 200 ]]; then echo true; else echo false; fi
}

# deployed <sha>: true when the newest production deployment (CD's deploy job creates one per run) is <sha>
# and succeeded. A runner outage or failed deploy leaves a newer deployment that did not succeed, so it is false.
deployed() {
  local sha=${1:?$usage} id state
  [[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "cd: <sha> must be a full commit sha" >&2; exit 2; }
  id=$(api "repos/$repo/deployments?environment=production&per_page=1" ".[0] | select(.sha == \"$sha\") | .id") \
    || { echo false; return; }
  [[ -n "$id" ]] || { echo false; return; }
  state=$(api "repos/$repo/deployments/$id/statuses?per_page=1" '.[0].state // ""') || { echo false; return; }
  if [[ "$state" == success ]]; then echo true; else echo false; fi
}

deploy() {
  local sha=${1:?$usage} release before rel after health
  [[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "cd: <sha> must be a full commit sha" >&2; exit 2; }
  retry remote true || { echo "cd: cannot reach $host" >&2; exit 1; }
  release=$(desired) || { echo "cd: could not determine the release; nothing changed" >&2; exit 1; }
  if [[ -z "$release" ]]; then
    note "no commit on main has passed CI yet; nothing to deploy."
    return
  fi
  if [[ "$release" != "$sha" ]]; then
    note "the release is now ${release:0:12}, not ${sha:0:12}; the run that released it deploys it."
    summary "Skipped: the release is now \`${release:0:12}\`."
    return
  fi
  before=$(retry running)
  if [[ -n "$before" && "$sha" == "$before"* ]]; then
    note "$host already runs ${sha:0:12}; nothing to deploy."
  else
    rel=unknown
    [[ -z "$before" ]] || rel=$(relation "$sha" "$before") || { echo "cd: could not compare with the running ${before:0:12}; nothing changed" >&2; exit 1; }
    case "$rel" in
      identical) note "$host already runs ${sha:0:12}; nothing to deploy." ;;
      ahead\ *)
        note "$host runs ${before:0:12}, which is newer than ${sha:0:12}; not downgrading."
        summary "Skipped: $host already runs the newer \`${before:0:12}\`."
        return ;;
      *)
        # behind (an upgrade), diverged or unknown (for example a --build of another branch): the verified release wins.
        [[ "$rel" == behind || -z "$before" ]] || note "$host runs ${before:0:12} ($rel to ${sha:0:12}); replacing it with the verified release."
        scripts/deploy.sh "$host" "$sha" ;;
    esac
  fi
  after=$(retry running)
  [[ -n "$after" && "$sha" == "$after"* ]] || { echo "cd: $host's app runs '${after:-nothing}', not ${sha:0:12}" >&2; exit 1; }
  health=$(retry remote "cd ~/$dir && curl -fsS --max-time 10 \"http://\$(docker compose port app 3001)/api/health\"")
  echo "cd: $host's app runs ${sha:0:12}; health $health" >&2
  summary "Deployed \`${sha:0:12}\` to \`$host\` (running container's revision verified; health \`$health\`)."
}

case "$command" in
  candidate) candidate ;;
  published) published "${2:-}" ;;
  deployed) deployed "${2:-}" ;;
  relation) relation "${2:?$usage}" "${3:?$usage}" ;;
  deploy) deploy "${2:-}" ;;
  *) echo "$usage" >&2; exit 2 ;;
esac
