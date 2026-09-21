#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

tests=false
while (( $# )); do
  case "$1" in
    --tests) tests=true; shift ;;
    --) shift; break ;;
    --help) printf 'Usage: bash scripts/azure-sql.sh [--tests] -- COMMAND [ARGUMENTS...]\nTemporarily permits only this workstation IP, uses Azure identity, and removes access on exit. --tests explicitly enables isolated remote test schemas.\n'; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
done
(( $# )) || fail "Specify a command after --."
check_target
verify_free_database
sql_environment
if [[ "$tests" == "true" ]]; then
  export SQL_ALLOW_REMOTE_TESTS=true SQL_TEST_DATABASE="$SQL_DATABASE"
fi
operator_ip="${AZURE_OPERATOR_IP:-}"
if [[ -z "$operator_ip" ]]; then
  operator_ip="$(node --input-type=module -e 'import {isIPv4} from "node:net"; const response=await fetch("https://api.ipify.org?format=json",{signal:AbortSignal.timeout(15000)}); if(!response.ok) throw new Error("Unable to discover operator IP"); const {ip}=await response.json(); if(!isIPv4(ip)) throw new Error("An IPv4 operator address is required"); process.stdout.write(ip);')"
fi
node -e 'if(!require("node:net").isIPv4(process.argv[1]) || process.argv[1]==="0.0.0.0") process.exit(1)' "$operator_ip" || fail "AZURE_OPERATOR_IP must be one explicit public IPv4 address."
rule="touchline-operator-$$-$(date +%s)"
created=false
cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$created" == "true" ]]; then
    printf 'Removing temporary operator-only SQL firewall access...\n'
    if ! azure sql server firewall-rule delete --resource-group "$AZURE_RESOURCE_GROUP" --server "$AZURE_SQL_SERVER" --name "$rule" --output none; then
      printf 'WARNING: remove temporary SQL firewall rule %s manually.\n' "$rule" >&2
      if [[ "$status" == "0" ]]; then status=1; fi
    else
      printf 'Temporary SQL firewall access removed. Command exit status: %s\n' "$status"
    fi
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
created=true
azure sql server firewall-rule create --resource-group "$AZURE_RESOURCE_GROUP" --server "$AZURE_SQL_SERVER" --name "$rule" \
  --start-ip-address "$operator_ip" --end-ip-address "$operator_ip" --output none
printf 'Temporary operator-only SQL access enabled. Running requested command.\n'
"$@"