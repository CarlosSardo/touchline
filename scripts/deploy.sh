#!/usr/bin/env bash
# Deploy a commit to a Docker host that already runs PostgreSQL and a reverse proxy, see
# deploy/host-deploy.sh and README ("Deploying from a checkout"). Only committed code is deployed.
# The commit goes over SSH as a tarball (host-deploy.sh and the compose file come from it). By default
# the host pulls the image CI published for it, ghcr.io/carlossardo/touchline:sha-<commit> (cd.yml,
# commits on main), with its own `docker login ghcr.io`; with --build the host builds it from the source.
# Usage: scripts/deploy.sh [--build] <ssh-host> [git-ref]    e.g. scripts/deploy.sh carlos@raspberrypi
#   The host `local` runs the same steps on this machine without SSH (the CD runner on the host itself).
#   TOUCHLINE_DIR: deploy directory on the host, relative to the SSH user's home (default: touchline)
#   GHCR_TOKEN + GHCR_USER: pull with this token instead of the host's login (GitHub Actions: GITHUB_TOKEN
#     and github.actor). It goes to the host on stdin, is used for this one pull and deleted there.
#   The source is unpacked into a fresh ~/<dir>/src.new.XXXXXX first, then host-deploy.sh runs from it in
#   a second session (one deploy at a time: it waits for ~/<dir>/.deploy.lock).
#   DEPLOY_SSH_OPTS: extra ssh options, split on spaces (e.g. -o StrictHostKeyChecking=yes)
set -euo pipefail
cd "$(dirname "$0")/.."

usage='Usage: scripts/deploy.sh [--build] <ssh-host|local> [git-ref]'
build=
[ "${1:-}" != --build ] || { build=1; shift; }
host=${1:?$usage}
ref=${2:-HEAD}
dir=${TOUCHLINE_DIR:-touchline}
[[ $dir =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "TOUCHLINE_DIR may only contain letters, digits and ._/-" >&2; exit 2; }
ssh_opts=()
[ -z "${DEPLOY_SSH_OPTS:-}" ] || read -r -a ssh_opts <<<"$DEPLOY_SSH_OPTS"
# shellcheck disable=SC2029 # the command expands here on purpose ($dir is validated above)
on_host() { if [ "$host" = local ]; then bash -c "$1"; else ssh "${ssh_opts[@]}" "$host" "$1"; fi; }

sha=$(git rev-parse --verify "$ref^{commit}")
rev=${sha:0:12}
[ "$ref" != HEAD ] || [ -z "$(git status --porcelain --untracked-files=no)" ] \
  || echo "Note: uncommitted changes are not deployed." >&2

if [ -n "$build" ]; then
  echo ">> deploy $rev to $host:~/$dir (build on the host)"
  [ -z "${GHCR_TOKEN:-}" ] || echo "Note: GHCR_TOKEN is not used with --build." >&2
  args="$rev --build $sha"
elif [ -z "${GHCR_TOKEN:-}" ]; then
  echo ">> deploy $rev to $host:~/$dir (pull ghcr.io/carlossardo/touchline:sha-$sha)"
  args="$rev --pull $sha"
else
  [[ ${GHCR_USER:-} =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "Set GHCR_USER to the GitHub user GHCR_TOKEN belongs to" >&2; exit 2; }
  echo ">> deploy $rev to $host:~/$dir (pull ghcr.io/carlossardo/touchline:sha-$sha with GHCR_TOKEN)"
  args="$rev --pull $sha"
fi
src=$(git archive --format=tar "$rev" | on_host \
  "set -e; mkdir -p ~/$dir; cd ~/$dir; s=\$(mktemp -d src.new.XXXXXX); trap 'rm -rf \$s' EXIT; chmod 755 \$s; tar -x -C \$s; trap - EXIT; echo \$s")
src=${src##*$'\n'}
[[ $src =~ ^src\.new\.[A-Za-z0-9]{6}$ ]] || { echo "Unexpected staging directory from the host: $src" >&2; exit 1; }
# The trap removes the staging directory (and token file) even if host-deploy.sh cannot start.
run="set -e; cd ~/$dir; t=; trap 'rm -rf $src; rm -f \$t' EXIT"
if [ -z "${GHCR_TOKEN:-}" ] || [ -n "$build" ]; then
  on_host "$run; bash $src/deploy/host-deploy.sh $args" </dev/null
else
  # Never in argv or a remote environment: user and token go on stdin into a fresh mode-600 file,
  # which host-deploy.sh deletes on reading.
  printf '%s\n%s\n' "$GHCR_USER" "$GHCR_TOKEN" | on_host \
    "$run; t=\$(mktemp .ghcr-pull-token.XXXXXX); cat > \$t; bash $src/deploy/host-deploy.sh $args --token-file \$t"
fi
