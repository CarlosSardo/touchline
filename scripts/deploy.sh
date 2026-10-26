#!/usr/bin/env bash
# Deploy a commit to a Docker host that already runs PostgreSQL and a reverse proxy, see
# deploy/host-deploy.sh and README ("Deploying from a checkout"). Only committed code is deployed.
# The commit goes over SSH as a tarball (host-deploy.sh and the compose file come from it). By default
# the host pulls the image CI published for it, ghcr.io/carlossardo/touchline:sha-<commit> (image.yml,
# commits on main), with its own `docker login ghcr.io`; with --build the host builds it from the source.
# Usage: scripts/deploy.sh [--build] <ssh-host> [git-ref]    e.g. scripts/deploy.sh carlos@raspberrypi
#   TOUCHLINE_DIR: deploy directory on the host, relative to the SSH user's home (default: touchline)
#   GHCR_TOKEN + GHCR_USER: pull with this token instead of the host's login (GitHub Actions: GITHUB_TOKEN
#     and github.actor). It goes to the host on stdin, is used for this one pull and deleted there.
#   DEPLOY_SSH_OPTS: extra ssh options, split on spaces (e.g. -o StrictHostKeyChecking=yes)
set -euo pipefail
cd "$(dirname "$0")/.."

usage='Usage: scripts/deploy.sh [--build] <ssh-host> [git-ref]'
build=
cleanup=
[ "${1:-}" != --build ] || { build=1; shift; }
host=${1:?$usage}
ref=${2:-HEAD}
dir=${TOUCHLINE_DIR:-touchline}
[[ $dir =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "TOUCHLINE_DIR may only contain letters, digits and ._/-" >&2; exit 2; }
ssh_opts=()
[ -z "${DEPLOY_SSH_OPTS:-}" ] || read -r -a ssh_opts <<<"$DEPLOY_SSH_OPTS"

sha=$(git rev-parse --verify "$ref^{commit}")
rev=${sha:0:12}
[ "$ref" != HEAD ] || [ -z "$(git status --porcelain --untracked-files=no)" ] \
  || echo "Note: uncommitted changes are not deployed." >&2

if [ -n "$build" ]; then
  echo ">> deploy $rev to $host:~/$dir (build on the host)"
  [ -z "${GHCR_TOKEN:-}" ] || echo "Note: GHCR_TOKEN is not used with --build." >&2
  remote="exec bash src.new/deploy/host-deploy.sh $rev"
elif [ -z "${GHCR_TOKEN:-}" ]; then
  echo ">> deploy $rev to $host:~/$dir (pull ghcr.io/carlossardo/touchline:sha-$sha)"
  remote="exec bash src.new/deploy/host-deploy.sh $rev --pull $sha"
else
  [[ ${GHCR_USER:-} =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "Set GHCR_USER to the GitHub user GHCR_TOKEN belongs to" >&2; exit 2; }
  echo ">> deploy $rev to $host:~/$dir (pull ghcr.io/carlossardo/touchline:sha-$sha with GHCR_TOKEN)"
  # Never in argv or a remote environment: user and token go on stdin into a mode-600 file, which
  # host-deploy.sh deletes on reading; the trap removes it if host-deploy.sh never gets to it.
  token=.ghcr-pull-token
  # shellcheck disable=SC2029 # $dir expands here on purpose (validated above)
  printf '%s\n%s\n' "$GHCR_USER" "$GHCR_TOKEN" | ssh "${ssh_opts[@]}" "$host" \
    "set -e; mkdir -p ~/$dir; cd ~/$dir; umask 077; rm -f $token; cat > $token"
  cleanup="trap 'rm -f $token' EXIT; "
  remote="bash src.new/deploy/host-deploy.sh $rev --pull $sha --token-file $token"
fi
# shellcheck disable=SC2029 # $dir and $remote expand here on purpose (validated above)
git archive --format=tar "$rev" | ssh "${ssh_opts[@]}" "$host" \
  "set -e; mkdir -p ~/$dir; cd ~/$dir; ${cleanup}rm -rf src.new; mkdir src.new; tar -x -C src.new; $remote"
