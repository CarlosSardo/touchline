#!/usr/bin/env bash
# Installs, or re-registers, the self-hosted GitHub Actions runner that runs CD's deploy job on the host
# (.github/workflows/cd.yml, label touchline-deploy). It lives in ~/actions-runner and runs as a systemd *user*
# service with lingering on, so it starts at boot without a login and needs no sudo. The runner only makes
# outbound HTTPS connections to GitHub and updates itself. Safe to re-run (for example after a host rebuild).
# The label is only routing, so a job-started hook (scripts/ci/runner-job-guard.sh, installed in
# ~/actions-runner-hooks, outside the runner's directory and its _work checkouts) fails every job but CD's deploy
# job from main before any of its steps runs. The host's prerequisites are checked first.
# Run from a checkout with gh logged in as a repository admin:
#   scripts/ci/install-runner.sh <ssh-host>        e.g. scripts/ci/install-runner.sh carlos@raspberrypi
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."

host=${1:?Usage: scripts/ci/install-runner.sh <ssh-host>}
label=touchline-deploy
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)

case "$(ssh "$host" uname -m)" in
  aarch64|arm64) arch=arm64 ;;
  x86_64|amd64) arch=x64 ;;
  *) echo "install-runner: unsupported CPU on $host" >&2; exit 1 ;;
esac

echo ">> checking prerequisites on $host"
ssh "$host" 'bash -s' <<'REMOTE'
set -euo pipefail
missing=()
need() { command -v "$1" >/dev/null 2>&1 || missing+=("$1 (sudo apt-get install $2)"); }
need curl curl
need jq jq
need flock util-linux
need git git
need tar tar
need sha256sum coreutils
need loginctl systemd
if command -v docker >/dev/null 2>&1; then
  docker compose version >/dev/null 2>&1 \
    || missing+=("the docker compose plugin (sudo apt-get install docker-compose-v2, or docker-compose-plugin from Docker's apt repository)")
  docker info >/dev/null 2>&1 || missing+=("access to the Docker daemon (sudo usermod -aG docker $USER, then log in again)")
else
  missing+=("docker (sudo apt-get install docker.io docker-compose-v2, or https://docs.docker.com/engine/install/; then sudo usermod -aG docker $USER)")
fi
systemctl --user show-environment >/dev/null 2>&1 \
  || missing+=("a working 'systemctl --user' (the systemd user manager of $USER; XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-unset})")
if [ ${#missing[@]} -gt 0 ]; then
  echo "install-runner: $(hostname) is missing:" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  exit 1
fi
# Lingering starts the user's services at boot and keeps them running after logout.
loginctl enable-linger "$USER" >/dev/null 2>&1 || true
if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != yes ]; then
  echo "install-runner: lingering is off for $USER, so the runner would stop at logout and not start at boot;" \
    "run once as an administrator: sudo loginctl enable-linger $USER" >&2
  exit 1
fi
REMOTE

release=$(gh api repos/actions/runner/releases/latest)
version=$(jq -r .tag_name <<< "$release")
asset="actions-runner-linux-$arch-${version#v}.tar.gz"
digest=$(jq -r --arg asset "$asset" '.assets[] | select(.name == $asset) | .digest' <<< "$release")
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "install-runner: no sha256 digest for $asset" >&2; exit 1; }
# A one-hour registration token; it reaches the host on standard input, not on a command line here.
token=$(gh api -X POST "repos/$repo/actions/runners/registration-token" --jq .token)

echo ">> job guard on $host"
# shellcheck disable=SC2016 # expanded on the host
ssh "$host" 'set -e; d=$HOME/actions-runner-hooks; mkdir -p "$d"; chmod 755 "$d"
  cat > "$d/runner-job-guard.sh.new"; chmod 755 "$d/runner-job-guard.sh.new"
  mv -f "$d/runner-job-guard.sh.new" "$d/runner-job-guard.sh"' < scripts/ci/runner-job-guard.sh

echo ">> runner $version ($asset) on $host for $repo, label $label"
# shellcheck disable=SC2087 # the variables are meant to expand here
ssh "$host" 'bash -s' <<REMOTE
set -euo pipefail
dir=\$HOME/actions-runner
hook=\$HOME/actions-runner-hooks/runner-job-guard.sh
unit=\$HOME/.config/systemd/user/actions-runner.service
# The guard must let CD's deploy job through and refuse anything else, or no job runs here.
guard() { env -i PATH="\$PATH" GITHUB_REPOSITORY="$repo" GITHUB_JOB=deploy GITHUB_EVENT_NAME=workflow_run "\$@" bash -e "\$hook" >/dev/null; }
guard GITHUB_WORKFLOW_REF="$repo/.github/workflows/cd.yml@refs/heads/main" \
  || { echo "install-runner: the job guard refuses CD's deploy job of $repo" >&2; exit 1; }
if guard GITHUB_WORKFLOW_REF="$repo/.github/workflows/ci.yml@refs/heads/main"; then
  echo "install-runner: the job guard lets other workflows through" >&2; exit 1
fi
# Stop signals every process of the unit (the default KillMode=control-group); with KillMode=process only run.sh got
# it, and the Runner.Listener under it outlived the stop and kept taking jobs with its old settings (no hook). The
# unit is written and reloaded before the stop, so the stop also clears such a leftover listener.
mkdir -p "\$(dirname "\$unit")"
cat > "\$unit" <<'UNIT'
[Unit]
Description=GitHub Actions runner for CarlosSardo/touchline CD deploys (label touchline-deploy)
Wants=network-online.target
After=network-online.target

[Service]
WorkingDirectory=%h/actions-runner
ExecStart=%h/actions-runner/run.sh
Restart=always
RestartSec=10
KillSignal=SIGINT
TimeoutStopSec=5min

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user stop actions-runner.service 2>/dev/null || true
mkdir -p "\$dir"
cd "\$dir"
if [ "\$(cat .runner-version 2>/dev/null)" != "$version" ] || [ ! -x ./run.sh ]; then
  curl -fsSL -o runner.tar.gz "https://github.com/actions/runner/releases/download/$version/$asset"
  echo "${digest#sha256:}  runner.tar.gz" | sha256sum -c --quiet -
  tar -xzf runner.tar.gz
  rm runner.tar.gz
  echo "$version" > .runner-version
fi
# Re-registration replaces the runner of the same name (its old credentials are local to this directory).
rm -f .runner .runner_migrated .credentials .credentials_migrated .credentials_rsaparams
./config.sh --unattended --replace --url "https://github.com/$repo" --token "$token" \
  --name "\$(hostname)" --labels "$label" --work _work >/dev/null
# The runner reads .env at start; the hook runs before every job's first step and a non-zero exit fails the job.
touch .env
{ grep -v '^ACTIONS_RUNNER_HOOK_JOB_STARTED=' .env || true; echo "ACTIONS_RUNNER_HOOK_JOB_STARTED=\$hook"; } > .env.new
mv -f .env.new .env
systemctl --user enable actions-runner.service
systemctl --user restart actions-runner.service
sleep 5
systemctl --user is-active actions-runner.service
grep '^ACTIONS_RUNNER_HOOK_JOB_STARTED=' .env
cgroup=/sys/fs/cgroup\$(systemctl --user show -p ControlGroup --value actions-runner.service)/cgroup.procs
listeners=\$(xargs -r -I{} cat /proc/{}/comm < "\$cgroup" 2>/dev/null | grep -c '^Runner.Listener\$' || true)
[ "\$listeners" = 1 ] || { echo "install-runner: \$listeners runner listeners in actions-runner.service, expected 1" >&2; exit 1; }
REMOTE

for _ in 1 2 3 4 5 6; do
  status=$(gh api "repos/$repo/actions/runners" --jq ".runners[] | select(.labels[].name == \"$label\") | .status" | head -n 1)
  [[ "$status" == online ]] && { echo ">> runner online with label $label"; exit 0; }
  sleep 5
done
echo "install-runner: the runner did not come online; check 'systemctl --user status actions-runner' on $host" >&2
exit 1
