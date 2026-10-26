#!/usr/bin/env bash
# Runs on the host, started by scripts/deploy.sh in the deploy directory (for example ~/touchline) with
# the new source unpacked in ./src.new. Gets local/touchline:<rev> + :latest, installs
# deploy/compose.external-postgres.yaml as ./compose.yaml, creates or checks the account registry,
# migrates registered worlds, starts the app and checks /api/health.
#   host-deploy.sh <rev>                    builds the image from ./src.new (docker buildx)
#   host-deploy.sh <rev> --pull <commit> [--token-file <file>]
#     pulls ghcr.io/carlossardo/touchline:sha-<commit> and refuses it unless its
#     org.opencontainers.image.revision is <commit>. It uses the host's `docker login ghcr.io`, or with
#     --token-file a user and token (two lines, written by deploy.sh) that are deleted on reading and
#     used only for this pull, from a temporary Docker config.
# A failed build or pull leaves the running container untouched. Roll back by restoring a database
# backup, not by running an older image against migrated data.
set -euo pipefail
rev=${1:?Usage: deploy/host-deploy.sh <revision> [--pull <commit> [--token-file <file>]] (started by scripts/deploy.sh)}
sha=
token_file=
docker_config=
cleanup() { [ -z "$token_file" ] || rm -f "$token_file"; [ -z "$docker_config" ] || rm -rf "$docker_config"; }
trap cleanup EXIT
if [ "${2:-}" = --pull ]; then
  sha=${3:-}
  if [ "${4:-}" = --token-file ]; then
    token_file=${5:-}
    [[ $token_file =~ ^[A-Za-z0-9._-]+$ ]] || { echo "--token-file needs a file name in $PWD" >&2; token_file=; exit 2; }
    { IFS= read -r ghcr_user && IFS= read -r ghcr_token; } < "$token_file" || { echo "Cannot read user and token from $token_file" >&2; exit 2; }
    rm -f "$token_file"
  fi
  [[ $sha =~ ^[0-9a-f]{40}$ && ${sha:0:12} == "$rev" ]] || { echo "--pull needs the full commit of $rev" >&2; exit 2; }
fi
[ -d src.new ] || { echo "Run from the deploy directory with the source in ./src.new" >&2; exit 2; }
[ -n "$sha" ] || docker buildx version >/dev/null 2>&1 \
  || { echo "docker buildx is missing (Ubuntu: sudo apt-get install docker-buildx)" >&2; exit 1; }
[ -f .env ] || { echo "No .env in $PWD: create it first, see .env.example and README (Deploying from a checkout)" >&2; exit 1; }
# Without it compose falls back to port 3001 and the reverse proxy in front loses the app (502).
grep -Eq '^TOUCHLINE_PORT=[0-9]+$' .env || {
  echo "Set TOUCHLINE_PORT in $PWD/.env to the loopback port your reverse proxy forwards to; nothing was changed." >&2
  exit 1
}

# Pull and check the CI image before changing anything here.
if [ -n "$sha" ]; then
  remote=ghcr.io/carlossardo/touchline:sha-$sha
  echo ">> pull $remote"
  config=()
  if [ -n "$token_file" ]; then
    docker_config=$(mktemp -d "$PWD/.docker-config.XXXXXX")
    config=(--config "$docker_config")
  fi
  status=0
  out=$({
    if [ -n "$token_file" ]; then
      printf '%s\n' "$ghcr_token" | docker "${config[@]}" login ghcr.io -u "$ghcr_user" --password-stdin || exit
    fi
    docker "${config[@]}" pull -q "$remote"
  } 2>&1) || status=$?
  [ -z "$docker_config" ] || rm -rf "$docker_config"
  docker_config=
  unset ghcr_token
  if [ "$status" != 0 ]; then
    echo "$out" >&2
    echo "Could not pull $remote; nothing was changed. Either:" >&2
    echo "- the image does not exist yet: CI publishes it for commits on main (.github/workflows/image.yml)," >&2
    echo "  so wait for the image workflow, or build on the host with scripts/deploy.sh --build <host> <ref>; or" >&2
    if [ -n "$token_file" ]; then
      echo "- GHCR refused the token from deploy.sh (GHCR_USER/GHCR_TOKEN): it needs read access to the package" >&2
      echo "  (read:packages; in GitHub Actions, GITHUB_TOKEN with packages: read)." >&2
    else
      echo "- this host is not logged in to GHCR: docker login ghcr.io -u <github user>, with a classic personal" >&2
      echo "  access token that has only read:packages (see README, Deploying from a checkout)." >&2
    fi
    exit 1
  fi
  label=$(docker image inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$remote")
  if [ "$label" != "$sha" ]; then
    docker image rm "$remote" >/dev/null 2>&1 || true
    echo "Refusing $remote: its org.opencontainers.image.revision is '$label', not $sha; nothing was changed." >&2
    exit 1
  fi
  digests=$(docker image inspect -f '{{ join .RepoDigests " " }}' "$remote")
  echo ">> $digests"
fi

# The image is built or tagged here, so compose must run it and never try to pull it.
[ -z "$(tail -c 1 .env)" ] || echo >> .env
image=$(sed -n 's/^TOUCHLINE_IMAGE=//p' .env | tail -n 1)
case "$image" in
  "") echo 'TOUCHLINE_IMAGE=local/touchline:latest' >> .env ;;
  local/touchline:latest) ;;
  *) echo "TOUCHLINE_IMAGE in .env is $image; a deploy from a checkout runs local/touchline:latest" >&2; exit 1 ;;
esac
grep -q '^TOUCHLINE_PULL_POLICY=never$' .env || echo 'TOUCHLINE_PULL_POLICY=never' >> .env

rm -rf src && mv src.new src
if [ -z "$sha" ]; then
  echo ">> build local/touchline:$rev (a few minutes on a Raspberry Pi)"
  docker buildx build --load --build-arg SOURCE_REVISION="$rev" -t "local/touchline:$rev" -t local/touchline:latest src
else
  docker tag "$remote" "local/touchline:$rev"
  docker tag "$remote" local/touchline:latest
  # Leave only the local/touchline tags on the image, so the pruning below also frees it.
  for ref in "$remote" $digests; do docker image rm "$ref" >/dev/null 2>&1 || true; done
fi
cp src/deploy/compose.external-postgres.yaml compose.yaml

run() { docker compose run --rm --no-deps -T app "$@"; }
echo ">> account registry"
run npm run --silent accounts:migrate -- --apply --yes
echo ">> world migrations"
run npm run --silent db:migrate -- --registered --apply --yes

echo ">> start"
docker compose up -d --wait
curl -fsS "http://$(docker compose port app 3001)/api/health" && echo
[ -z "$sha" ] || echo ">> deployed $rev from $digests"
# Keep the three newest builds.
docker image ls local/touchline --format '{{.Tag}}' | grep -vx latest | tail -n +4 \
  | xargs -r -I{} docker image rm "local/touchline:{}" >/dev/null
