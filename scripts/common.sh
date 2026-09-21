#!/usr/bin/env bash
set -euo pipefail
set +x

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

: "${AZURE_SUBSCRIPTION_ID:=3373ab04-1dd1-49b2-8884-3094cfd0ca06}"
: "${AZURE_TENANT_ID:=d588edc8-06a0-47ac-a9e6-aea06d1c6c25}"
: "${AZURE_LOCATION:=swedencentral}"
: "${AZURE_RESOURCE_GROUP:=rg-touchline}"
: "${AZURE_SQL_SERVER:=touchline-3373ab04}"
: "${AZURE_SQL_DATABASE:=touchline}"
: "${AZURE_SQL_CONNECTION_TYPE:=Redirect}"
: "${AZURE_APP:=touchline}"
: "${AZURE_ENVIRONMENT:=touchline-env}"
: "${AZURE_IDENTITY:=touchline-app}"
: "${GHCR_IMAGE:=ghcr.io/carlossardo/touchline}"
export AZURE_SUBSCRIPTION_ID AZURE_TENANT_ID AZURE_LOCATION AZURE_RESOURCE_GROUP
export AZURE_SQL_SERVER AZURE_SQL_DATABASE AZURE_APP AZURE_ENVIRONMENT AZURE_IDENTITY GHCR_IMAGE
export AZURE_SQL_CONNECTION_TYPE

fail() { printf '%s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || fail "$1 is required."; }
azure() {
  case "$1" in
    ad|extension) command az "$@" --only-show-errors ;;
    *) command az "$@" --subscription "$AZURE_SUBSCRIPTION_ID" --only-show-errors ;;
  esac
}
json_value() {
  node -e 'let text=""; process.stdin.on("data",chunk=>text+=chunk); process.stdin.on("end",()=>{let value=JSON.parse(text); for(const key of process.argv[1].split(".")) value=value?.[key]; if(value!==undefined&&value!==null) process.stdout.write(typeof value==="object"?JSON.stringify(value):String(value));});' "$1"
}
check_target() {
  need az
  need node
  [[ "$AZURE_SUBSCRIPTION_ID" =~ ^[a-fA-F0-9-]{36}$ ]] || fail "Invalid Azure subscription ID."
  [[ "$AZURE_SQL_SERVER" =~ ^[a-z][a-z0-9-]{1,61}[a-z0-9]$ ]] || fail "Invalid SQL server name."
  local actual_tenant
  actual_tenant="$(azure account show --query tenantId --output tsv)"
  [[ "$actual_tenant" == "$AZURE_TENANT_ID" ]] || fail "Azure tenant mismatch. Sign in to the intended tenant first."
  printf 'Subscription: %s\nResource group: %s\nRegion: %s\n' "$AZURE_SUBSCRIPTION_ID" "$AZURE_RESOURCE_GROUP" "$AZURE_LOCATION"
}
confirm_target() {
  [[ "${1:-}" == "--yes" ]] || fail "Review the target above, then rerun with --yes to authorize changes."
}
sql_environment() {
  export SQL_SERVER="${AZURE_SQL_SERVER}.database.windows.net" SQL_DATABASE="$AZURE_SQL_DATABASE"
  export SQL_ENCRYPT=true SQL_TRUST_SERVER_CERTIFICATE=false SQL_PORT=1433 SQL_SCHEMA=dbo
  unset SQL_USER SQL_PASSWORD SQL_TEST_MODE SQL_ALLOW_REMOTE_TESTS SQL_TEST_DATABASE GAME_DB SAVE_DIR AZURE_CLIENT_ID
}
verify_free_database() {
  local database
  database="$(azure sql db show --resource-group "$AZURE_RESOURCE_GROUP" --server "$AZURE_SQL_SERVER" --name "$AZURE_SQL_DATABASE" --output json)"
  [[ "$(printf '%s' "$database" | json_value useFreeLimit)" == "true" ]] || fail "Database is not on the SQL free offer. No changes made to its billing mode."
  [[ "$(printf '%s' "$database" | json_value freeLimitExhaustionBehavior)" == "AutoPause" ]] || fail "Database is configured for paid overage. Refusing to continue."
  [[ "$(printf '%s' "$database" | json_value maxSizeBytes)" -le 34359738368 ]] || fail "SQL storage exceeds the free-offer limit."
}