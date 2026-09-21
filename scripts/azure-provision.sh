#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

approved=""
sql_only=false
for argument in "$@"; do
  case "$argument" in
    --yes) approved=--yes ;;
    --sql-only) sql_only=true ;;
    --help) printf 'Usage: bash scripts/azure-provision.sh [--sql-only] --yes\nCreates SQL Free with Entra-only access. Without --sql-only, also creates the Consumption environment and managed identity. Never seeds or imports data.\n'; exit 0 ;;
    *) fail "Unknown argument: $argument" ;;
  esac
done
check_target
confirm_target "$approved"

ensure_provider() {
  if [[ "$(azure provider show --namespace "$1" --query registrationState --output tsv)" != "Registered" ]]; then
    printf 'Registering required resource provider %s...\n' "$1"
    azure provider register --namespace "$1" --wait --output none
  fi
}
ensure_provider Microsoft.Sql

owner_id="$(azure ad signed-in-user show --query id --output tsv)"
owner_name="$(azure ad signed-in-user show --query userPrincipalName --output tsv)"
[[ -n "$owner_id" && -n "$owner_name" ]] || fail "An interactive owner Azure login is required."

if [[ "$(azure group exists --name "$AZURE_RESOURCE_GROUP" --output tsv)" == "false" ]]; then
  azure group create --name "$AZURE_RESOURCE_GROUP" --location "$AZURE_LOCATION" --tags project=touchline environment=hobby --output none
fi
server_count="$(azure sql server list --resource-group "$AZURE_RESOURCE_GROUP" --query "length([?name=='$AZURE_SQL_SERVER'])" --output tsv)"
if [[ "$server_count" == "0" ]]; then
  printf 'Creating Entra-only SQL server...\n'
  azure sql server create --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_SQL_SERVER" --location "$AZURE_LOCATION" \
    --enable-ad-only-auth --external-admin-principal-type User --external-admin-name "$owner_name" --external-admin-sid "$owner_id" \
    --minimal-tls-version 1.2 --enable-public-network true --tags project=touchline --output none
else
  server_location="$(azure sql server show --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_SQL_SERVER" --query location --output tsv)"
  [[ "$server_location" == "$AZURE_LOCATION" ]] || fail "Existing SQL server is in another region. Refusing to replace it."
fi

case "$AZURE_SQL_CONNECTION_TYPE" in
  Default|Proxy|Redirect) ;;
  *) fail "AZURE_SQL_CONNECTION_TYPE must be Default, Proxy, or Redirect." ;;
esac
azure sql server conn-policy update --resource-group "$AZURE_RESOURCE_GROUP" --server "$AZURE_SQL_SERVER" \
  --connection-type "$AZURE_SQL_CONNECTION_TYPE" --output none

database_count="$(azure sql db list --resource-group "$AZURE_RESOURCE_GROUP" --server "$AZURE_SQL_SERVER" --query "length([?name=='$AZURE_SQL_DATABASE'])" --output tsv)"
if [[ "$database_count" == "0" ]]; then
  printf 'Creating SQL Free; exhaustion pauses the database, never enables overage...\n'
  azure sql db create --resource-group "$AZURE_RESOURCE_GROUP" --server "$AZURE_SQL_SERVER" --name "$AZURE_SQL_DATABASE" \
    --edition GeneralPurpose --family Gen5 --capacity 2 --compute-model Serverless --min-capacity 0.5 --auto-pause-delay 60 \
    --max-size 32GB --backup-storage-redundancy Local --zone-redundant false \
    --use-free-limit true --free-limit-exhaustion-behavior AutoPause --tags project=touchline --output none
fi
verify_free_database
azure sql db str-policy set --resource-group "$AZURE_RESOURCE_GROUP" --server "$AZURE_SQL_SERVER" --name "$AZURE_SQL_DATABASE" --retention-days 7 --output none
printf 'Verified SQL Free: %s / %s; no firewall access enabled yet.\n' "$AZURE_SQL_SERVER" "$AZURE_SQL_DATABASE"

if [[ "$sql_only" == "true" ]]; then exit 0; fi
ensure_provider Microsoft.App
ensure_provider Microsoft.ManagedIdentity
azure extension add --name containerapp --upgrade --output none
identity_count="$(azure identity list --resource-group "$AZURE_RESOURCE_GROUP" --query "length([?name=='$AZURE_IDENTITY'])" --output tsv)"
if [[ "$identity_count" == "0" ]]; then
  azure identity create --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_IDENTITY" --location "$AZURE_LOCATION" --tags project=touchline --output none
fi
environment_count="$(azure containerapp env list --resource-group "$AZURE_RESOURCE_GROUP" --query "length([?name=='$AZURE_ENVIRONMENT'])" --output tsv)"
if [[ "$environment_count" == "0" ]]; then
  azure containerapp env create --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_ENVIRONMENT" --location "$AZURE_LOCATION" \
    --enable-workload-profiles --logs-destination none --tags project=touchline --output none
fi
printf 'Consumption environment and managed identity ready. No app image has been deployed.\n'