#!/usr/bin/env bash
# Installs, or re-registers, the self-hosted GitHub Actions runner that runs CD's deploy job on the host
# (.github/workflows/cd.yml, label touchline-deploy). It lives in ~/actions-runner and runs as a systemd *user*
# service with lingering on, so it starts at boot without a login and needs no sudo. The runner only makes
# outbound HTTPS connections to GitHub and updates itself. Safe to re-run (for example after a host rebuild).
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
release=$(gh api repos/actions/runner/releases/latest)
version=$(jq -r .tag_name <<< "$release")
asset="actions-runner-linux-$arch-${version#v}.tar.gz"
digest=$(jq -r --arg asset "$asset" '.assets[] | select(.name == $asset) | .digest' <<< "$release")
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "install-runner: no sha256 digest for $asset" >&2; exit 1; }
# A one-hour registration token; it reaches the host on standard input, not on a command line here.
token=$(gh api -X POST "repos/$repo/actions/runners/registration-token" --jq .token)

echo ">> runner $version ($asset) on $host for $repo, label $label"
# shellcheck disable=SC2087 # the variables are meant to expand here
ssh "$host" 'bash -s' <<REMOTE
set -euo pipefail
dir=\$HOME/actions-runner
unit=\$HOME/.config/systemd/user/actions-runner.service
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
rm -f .runner .credentials .credentials_rsaparams
./config.sh --unattended --replace --url "https://github.com/$repo" --token "$token" \
  --name "\$(hostname)" --labels "$label" --work _work >/dev/null
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
KillMode=process
KillSignal=SIGINT
TimeoutStopSec=5min

[Install]
WantedBy=default.target
UNIT
loginctl enable-linger "\$USER" >/dev/null 2>&1 || true
[ "\$(loginctl show-user "\$USER" -p Linger --value)" = yes ] || echo "warning: lingering is off; the runner stops when \$USER logs out (sudo loginctl enable-linger \$USER)" >&2
systemctl --user daemon-reload
systemctl --user enable --now actions-runner.service
sleep 5
systemctl --user is-active actions-runner.service
REMOTE

for _ in 1 2 3 4 5 6; do
  status=$(gh api "repos/$repo/actions/runners" --jq ".runners[] | select(.labels[].name == \"$label\") | .status" | head -n 1)
  [[ "$status" == online ]] && { echo ">> runner online with label $label"; exit 0; }
  sleep 5
done
echo "install-runner: the runner did not come online; check 'systemctl --user status actions-runner' on $host" >&2
exit 1
