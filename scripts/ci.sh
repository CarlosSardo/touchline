#!/usr/bin/env bash
# Touchline CI: the one entrypoint GitHub Actions and developers run. It installs the pinned Dagger CLI,
# runs the touchline-ci Dagger module (.dagger/modules/touchline-ci) on a local Dagger engine in Docker and
# exports logs and reports to ci-logs/. No Dagger Cloud: no token, no cloud engine, no telemetry.
#
#   scripts/ci.sh [SUITES] [--seasons=N] [--full-world]   SUITES: all (default) or a comma list of static,backend,world,e2e
#   scripts/ci.sh backend|e2e --shard=N/M                 one database-isolated shard (as GitHub Actions runs them);
#                                                          without --shard every shard runs concurrently
#   scripts/ci.sh timings                                  refresh scripts/ci/test-timings.json (shard balance) from ci-logs/
#   scripts/ci.sh image [PLATFORMS]                        build the release image (default linux/amd64,linux/arm64), no push
#   scripts/ci.sh publish                                  build and push; needs IMAGE_REPOSITORY, IMAGE_TAGS (comma list),
#                                                          SOURCE_REVISION, REGISTRY_USER and REGISTRY_TOKEN
#   scripts/ci.sh dagger ARGS...                           run the pinned Dagger CLI with the same settings
#
# `all` runs static first and, if it passes, backend, world and e2e in parallel, like .github/workflows/ci.yml.
set -euo pipefail

DAGGER_VERSION=1.0.0-beta.21
SUITES=(static backend world e2e)

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
root=$PWD
logs="$root/ci-logs"

die() { printf 'ci: %s\n' "$*" >&2; exit 2; }

# --- Environment: local engine only, no Dagger Cloud, no telemetry -------------------------------------------
export DO_NOT_TRACK=1 DAGGER_NO_NAG=1
unset DAGGER_CLOUD_TOKEN DAGGER_CLOUD_ENGINE _EXPERIMENTAL_DAGGER_CLOUD_TOKEN
case "${DAGGER_ENGINE:-}" in cloud*) die "DAGGER_ENGINE=cloud is not used by Touchline CI; unset it." ;; esac
command -v docker >/dev/null || die "Docker is required (the Dagger engine runs as a container)."
docker info >/dev/null 2>&1 || die "The Docker daemon is unavailable or inaccessible."
# An empty Docker config keeps credential helpers and registry logins out of CI (as scripts/build.sh does).
docker_config="$(mktemp -d)"
trap 'rm -rf -- "$docker_config"' EXIT
printf '{}' > "$docker_config/config.json"
export DOCKER_CONFIG="$docker_config"

# --- Pinned Dagger CLI, checksum-verified --------------------------------------------------------------------
dagger_bin() {
  if command -v dagger >/dev/null && [[ "$(dagger version 2>/dev/null)" == *"v${DAGGER_VERSION}"* ]]; then
    command -v dagger; return
  fi
  local os arch dir archive base
  case "$(uname -s)" in Linux) os=linux ;; Darwin) os=darwin ;; *) die "unsupported OS $(uname -s)" ;; esac
  case "$(uname -m)" in x86_64|amd64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) die "unsupported CPU $(uname -m)" ;; esac
  dir="${XDG_CACHE_HOME:-$HOME/.cache}/touchline/dagger/v${DAGGER_VERSION}"
  if [[ ! -x "$dir/dagger" ]]; then
    archive="dagger_v${DAGGER_VERSION}_${os}_${arch}.tar.gz"
    base="https://dl.dagger.io/dagger/releases/${DAGGER_VERSION}"
    printf 'ci: installing Dagger v%s into %s\n' "$DAGGER_VERSION" "$dir" >&2
    mkdir -p "$dir"
    local tmp; tmp="$(mktemp -d)"
    curl -fsSL "$base/$archive" -o "$tmp/$archive"
    (cd "$tmp" && curl -fsSL "$base/checksums.txt" | grep " ${archive}\$" | sha256sum -c - >&2) || { rm -rf "$tmp"; die "checksum mismatch for $archive"; }
    tar -xzf "$tmp/$archive" -C "$tmp" dagger
    mv "$tmp/dagger" "$dir/dagger"
    rm -rf "$tmp"
  fi
  printf '%s\n' "$dir/dagger"
}
DAGGER="$(dagger_bin)"
dagger() { "$DAGGER" "$@"; }

progress=()
if [[ -n "${GITHUB_ACTIONS:-}" || ! -t 1 ]]; then progress=(--progress=logs); fi

summary() { if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then printf '%s\n' "$@" >> "$GITHUB_STEP_SUMMARY"; fi; }

# --- Suites --------------------------------------------------------------------------------------------------
run_suite() { # SUITE [dagger output file]
  local suite=$1 out=${2:-} args
  args=(api call report --suite="$suite" --seasons="$seasons" --full-world="$full_world" --shard="$shard" export --path="$logs/$suite")
  rm -rf -- "${logs:?}/$suite"
  mkdir -p "$logs"
  if [[ -n "$out" ]]; then dagger "${progress[@]:---progress=logs}" "${args[@]}" > "$out" 2>&1
  else dagger "${progress[@]}" "${args[@]}"; echo; fi
}

check_suite() { # SUITE -> 0 when every step passed
  local suite=$1 dir="$logs/$1" failed=0 step code
  # generated-code is recorded beside the static suite's own steps, so it alone doesn't mean the suite ran.
  if [[ ! -d "$dir/status" ]] || [[ -z "$(find "$dir/status" -mindepth 1 -maxdepth 1 ! -name generated-code -print -quit)" ]]; then
    printf 'ci: %s: no step results (the Dagger run failed before the steps; see its output)\n' "$suite"
    [[ -n "${GITHUB_ACTIONS:-}" ]] && echo "::error::${suite}: Dagger run failed before any step ran"
    summary "| ${suite} | (run failed) | ❌ |"
    return 1
  fi
  for step in $(ls "$dir/status" | sort); do
    code="$(cat "$dir/status/$step")"
    if [[ "$code" == 0 ]]; then
      printf 'ci: %-8s %-24s PASS\n' "$suite" "$step"; summary "| ${suite} | ${step} | ✅ |"
    else
      failed=1
      printf 'ci: %-8s %-24s FAIL (exit %s, log ci-logs/%s/%s.log)\n' "$suite" "$step" "$code" "$suite" "$step"
      summary "| ${suite} | ${step} | ❌ exit ${code} |"
      [[ -n "${GITHUB_ACTIONS:-}" ]] && echo "::error title=${suite}: ${step}::exit ${code}; see ci-logs/${suite}/${step}.log in the job artifacts"
    fi
  done
  if [[ "$suite" == world && -f "$dir/footprint.log" ]]; then
    summary "" "### Database footprint" '```' "$(grep -E '^[A-Za-z0-9_]+: [0-9.]+ MB reserved' "$dir/footprint.log" || true)" '```'
  fi
  return "$failed"
}

# The committed Dagger SDK code must match the module source (`npm run ci -- dagger generate -y` fixes it).
# Recorded as the static suite's generated-code step.
# Runs beside the static suite, whose export replaces ci-logs/static, so its result is written afterwards.
generated_check() {
  local out="$logs/generated-code.tmp" code=0
  mkdir -p "$logs"
  dagger --progress=logs check --typescript-sdk > "$out.log" 2>&1 || code=$?
  printf '%s\n' "$code" > "$out.status"
}
record_generated_check() {
  local dir="$logs/static"
  mkdir -p "$dir/status"
  mv "$logs/generated-code.tmp.log" "$dir/generated-code.log"
  mv "$logs/generated-code.tmp.status" "$dir/status/generated-code"
}

suites_cmd() {
  local selection=all
  seasons=3 full_world=false shard=""
  for argument in "$@"; do
    case "$argument" in
      --shard=*) shard=${argument#--shard=} ;;
      --seasons=*) seasons=${argument#--seasons=} ;;
      --full-world) full_world=true ;;
      --full-world=*) full_world=${argument#--full-world=} ;;
      -*) die "unknown option $argument" ;;
      *) selection=$argument ;;
    esac
  done
  [[ "$seasons" =~ ^[0-9]+$ ]] && (( seasons >= 1 && seasons <= 20 )) || die "--seasons must be a whole number from 1 to 20."
  [[ "$full_world" == true || "$full_world" == false ]] || die "--full-world must be true or false."
  selection="${selection//[[:space:]]/}"
  [[ "$selection" == all ]] && selection=$(IFS=,; echo "${SUITES[*]}")
  local selected=() suite
  IFS=, read -ra selected <<< "$selection"
  (( ${#selected[@]} > 0 )) || die "no suites selected"
  for suite in "${selected[@]}"; do [[ " ${SUITES[*]} " == *" $suite "* ]] || die "unknown suite '$suite' (use all or a comma list of ${SUITES[*]})"; done
  if [[ -n "$shard" ]]; then
    [[ "$shard" =~ ^[0-9]+/[0-9]+$ ]] || die "--shard must be N/M"
    [[ "${#selected[@]}" == 1 && ( "${selected[0]}" == backend || "${selected[0]}" == e2e ) ]] || die "--shard needs exactly one of backend or e2e"
  fi

  summary "### Touchline CI (Dagger v${DAGGER_VERSION})" "" "Suites: ${selection}${shard:+ (shard ${shard})} | simulation seasons: ${seasons} | full world: ${full_world}" "" "| Suite | Step | Result |" "|---|---|---|"
  local status=0 rest=()
  for suite in "${selected[@]}"; do [[ "$suite" == static ]] || rest+=("$suite"); done
  if [[ " ${selected[*]} " == *" static "* ]]; then
    generated_check & local generated=$!
    run_suite static || true
    wait "$generated" || true
    record_generated_check
    if ! check_suite static; then
      status=1
      if (( ${#rest[@]} > 0 )); then printf 'ci: static failed; skipping %s\n' "${rest[*]}"; fi
      return "$status"
    fi
  fi
  if (( ${#rest[@]} == 1 )); then
    run_suite "${rest[0]}" || true
    check_suite "${rest[0]}" || status=1
  elif (( ${#rest[@]} > 1 )); then
    local pids=()
    mkdir -p "$logs"
    for suite in "${rest[@]}"; do
      printf 'ci: running %s (Dagger output: ci-logs/%s.dagger.log)\n' "$suite" "$suite"
      run_suite "$suite" "$logs/$suite.dagger.log" & pids+=($!)
    done
    for pid in "${pids[@]}"; do wait "$pid" || true; done
    for suite in "${rest[@]}"; do check_suite "$suite" || status=1; done
  fi
  return "$status"
}

# --- Image ---------------------------------------------------------------------------------------------------
image_cmd() {
  local platforms=${1:-linux/amd64,linux/arm64} platform
  for platform in ${platforms//,/ }; do
    printf 'ci: building the release image for %s\n' "$platform"
    dagger "${progress[@]}" api call image --platform="$platform" --revision="$(git rev-parse HEAD 2>/dev/null || echo unknown)" \
      with-exec --args=node,--version stdout
  done
}

publish_cmd() {
  : "${IMAGE_REPOSITORY:?}" "${IMAGE_TAGS:?}" "${SOURCE_REVISION:?}" "${REGISTRY_USER:?}" "${REGISTRY_TOKEN:?}"
  local refs
  refs="$(dagger "${progress[@]}" api call publish --repository="$IMAGE_REPOSITORY" --tags="$IMAGE_TAGS" \
    --revision="$SOURCE_REVISION" --username="$REGISTRY_USER" --password=env:REGISTRY_TOKEN)"
  printf '%s\n' "$refs"
  local digest_ref
  digest_ref="$(printf '%s\n' "$refs" | grep -oE '[^ ]+@sha256:[0-9a-f]{64}' | head -n 1 || true)"
  [[ -n "$digest_ref" ]] || die "publish returned no digest reference"
  local image="${IMAGE_REPOSITORY}@${digest_ref##*@}"
  printf 'IMAGE=%s REVISION=%s\n' "$image" "$SOURCE_REVISION"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then printf 'image=%s\ndigest=%s\n' "$image" "${digest_ref##*@}" >> "$GITHUB_OUTPUT"; fi
  summary "Image: \`${image}\` (revision \`${SOURCE_REVISION}\`, linux/amd64 + linux/arm64)" "" \
    "Pin it on the Pi with \`TOUCHLINE_IMAGE=${image}\` in \`.env\`, then \`docker compose pull app && docker compose up -d\`."
}

timings_cmd() {
  [[ -d "$logs" ]] || die "no ci-logs/: run the backend and e2e suites first"
  dagger "${progress[@]}" api call updated-timings --reports="$logs" export --path="$root/scripts/ci/test-timings.json"
  printf '\nci: updated scripts/ci/test-timings.json\n'
}

case "${1:-all}" in
  image) shift; image_cmd "$@" ;;
  timings) timings_cmd ;;
  publish) shift; publish_cmd ;;
  dagger) shift; dagger "$@" ;;
  -h|--help|help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) suites_cmd "$@" ;;
esac
