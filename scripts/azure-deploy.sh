#!/usr/bin/env bash
set -euo pipefail
set +x

deploy_usage() {
  printf '%s\n' \
    'Usage: bash scripts/azure-deploy.sh --yes [--stage-only | --hold-ingress] [--skip-db-prepare] [--empty-worlds | --current-worlds] [--verification full|smoke] [--image ghcr.io/OWNER/IMAGE@sha256:DIGEST]' \
    '--stage-only builds/publishes and configures internal-only maintenance mode without opening SQL or enabling gameplay.' \
    '--hold-ingress builds a SQL-configured gameplay candidate but leaves ingress internal, without public probes or promotion.' \
    'Held candidates are recorded in .azure/held-app.json as pendingPromotion; runtime health and human sign-in remain unverified.' \
    'Promote only the inspected revision/digest using the guarded README procedure; rerunning deployment builds a new candidate.' \
    '--skip-db-prepare skips SQL export, migrations and runtime grants; read-only registry and every registered schema check remain mandatory.' \
    'Runs SQL-backed verification first. Without --image, builds locally, pushes privately and resolves the pushed digest.' \
    'A prebuilt --image (for example CI-built) ships gameplay only if its linux/amd64 config label org.opencontainers.image.revision' \
    'equals the clean checkout HEAD; the check reads GHCR with the pull token and needs no Docker. --hold-ingress still requires a local build.' \
    '--empty-worlds is for the release after a reviewed world reset: every registered world must be empty; the dbo export is skipped' \
    'and the smoke checks expect no career. The operator full backup must precede the reset.' \
    '--current-worlds accepts registered worlds that are each either empty or a complete career at the current WORLD_VERSION;' \
    'any older, newer or partial world refuses. The smoke checks and the dbo export follow the dbo world found.' \
    '--verification smoke runs a fresh build and read-only live API checks; it does not certify the full regression suite. Default: full.' \
    'Gameplay deployment requires an explicitly provisioned accounts.users registry, the preserved dbo career (or --empty-worlds), UMI and Consumption environment; other worlds may be empty.' \
    'Missing accounts block upgrades: review scripts/accounts-migrate.ts and separately provision with --apply --yes; deployment never binds users or seeds.' \
    'Required env: GHCR_USER, GHCR_PULL_TOKEN (or GHCR_TOKEN), AUTH_CLIENT_ID, AUTH_CLIENT_SECRET, INVITE_SIGNING_SECRET (created by azure:auth).' \
    'Optional SMTP_PASSWORD (Google app password for SMTP_USER): unset deploys EMAIL_TRANSPORT=disabled; requests still reach /admin/invites.' \
    'Invite settings: APPROVER_EMAIL, OWNER_EMAIL, SMTP_USER, MAX_PLAYERS (10), INVITE_DB_SIZE_LIMIT_GB (24); /invite is public.' \
    'Building (no --image) also requires GHCR_TOKEN with read:packages/write:packages and working Docker permissions.' \
    'Prefer a separate read:packages-only GHCR_PULL_TOKEN. Supply secrets locally, never in chat or CLI arguments.' \
    'Optional AUTH_SMOKE_TOKEN: owner access token for the configured app audience; never acquired automatically.' \
    '/api/health is SQL-free: only a signed-in /api/me proves that the new revision reaches SQL and a valid account registry.' \
    'With --skip-db-prepare the authenticated account probe is skipped to avoid profile refresh writes.' \
    'Without the probe, the owner /api/me check right after promotion is mandatory.' \
    'Optional ALLOWED_USER_OBJECT_IDS: comma-separated guest object IDs; unset preserves the deployed list, empty removes guests.' \
    'Run npm run azure:auth -- --yes --allow-personal-accounts: the app must accept personal Microsoft accounts (issuer common/v2.0).' \
    'SQL access uses scripts/azure-sql.sh; the dbo export precedes --registered world migrations and runtime authorization.' \
    'Runtime SQL permissions use a constrained identity-reseeding helper; no database-owner role is granted.' \
    'Reconciles exact advertised egress IP rules named touchline-app-<ip>; never enables blanket Azure SQL access.' \
    'Existing app ingress closes before SQL verification/preparation; this does not drain writers or replace the explicit cutover freeze.' \
    'Cold candidates use ARM/SQL checks; public HTTP readiness and old-revision deactivation run only on promotion.' \
    'Writes .touchline-deployment.json on success; this file must be ignored by Git.' \
    'Failures after app modification leave ingress internal. Rollback never restores data.'
}

deployment_sql() {
  [[ -f scripts/azure-sql.sh ]] || fail 'scripts/azure-sql.sh is required; no direct SQL/firewall fallback is permitted.'
  env -u AZURE_CLIENT_ID -u GHCR_TOKEN -u GHCR_PULL_TOKEN -u AUTH_CLIENT_SECRET -u AUTH_SMOKE_TOKEN \
    -u SMTP_PASSWORD -u INVITE_SIGNING_SECRET bash scripts/azure-sql.sh "$@"
}

deployment_readonly_smoke() {
  deployment_sql -- env -u CONTAINER_APP_NAME -u APP_ORIGIN REQUIRE_AUTH=false API_HOST=127.0.0.1 SQL_SCHEMA=dbo \
    node --import tsx --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import request from 'supertest';
import {Store} from './server/db.ts';
import {createApp} from './server/app.ts';
const store=await Store.open();
try {
  assert.equal(store.schemaName,'dbo');
  assert.equal(store.testMode,false);
  const before=await store.meta('state');
  const app=await createApp(store);
  for(const path of ['/api/health/details','/api/bootstrap','/api/dashboard','/api/players?pageSize=10','/api/saves']) {
    const response=await request(app).get(path);
    assert.equal(response.status,200,`Read-only ${path} failed`);
    if(path==='/api/health/details') {
      assert.equal(response.body.hosted,false);
      assert.equal(response.body.testCareer,false);
      assert.equal(response.body.schema,'dbo');
      assert.equal(response.body.databaseName,process.env.AZURE_SQL_DATABASE);
    }
    console.log(`[smoke] GET ${path}: 200`);
  }
  assert.deepEqual(await store.meta('state'),before,'Smoke checks must not alter the career');
  console.log('[smoke] Legacy dbo career unchanged in the internal synthetic app; public authentication was not changed. Complete gameplay/browser regression not rerun.');
} finally { await store.close(); }
NODE
}

deployment_empty_worlds_check() {
  printf '%s\n' '[verify] --empty-worlds: every registered world must be empty after the reviewed reset.'
  deployment_sql -- node --import tsx --input-type=module <<'NODE'
import {Store} from './server/db.ts';
import {registeredAccountSchemas} from './server/accounts.ts';
import {tableName} from './server/sql-schema.ts';
import {maskSchema} from './scripts/career-delete.ts';
const store=await Store.open();
try {
  for(const schema of await registeredAccountSchemas(store)) {
    const state=await store.get(`SELECT TOP (1) [key] FROM ${tableName(schema,'meta')} WHERE [key] = N'state'`);
    const club=await store.get(`SELECT TOP (1) [id] FROM ${tableName(schema,'clubs')}`);
    const player=await store.get(`SELECT TOP (1) [id] FROM ${tableName(schema,'players')}`);
    if(state || club || player)
      throw new Error(`--empty-worlds refused: ${maskSchema(schema)} still holds a world. Run the reviewed world reset first; deployment never deletes data.`);
    const slots=await store.get(`SELECT COUNT_BIG(*) AS [total] FROM ${tableName(schema,'save_slots')}`);
    console.log(`[sql] ${maskSchema(schema)}: world empty; ${Number(slots.total)} saved snapshot(s).`);
  }
} finally { await store.close(); }
NODE
}

deployment_current_worlds_check() {
  printf '%s\n' '[verify] --current-worlds: every registered world must be empty or a complete career at the current world version.'
  DEPLOY_DBO_WORLD_FILE="$1" deployment_sql -- node --import tsx --input-type=module <<'NODE'
import {writeFileSync} from 'node:fs';
import {Store} from './server/db.ts';
import {registeredAccountSchemas} from './server/accounts.ts';
import {tableName} from './server/sql-schema.ts';
import {WORLD_VERSION} from './shared/world-rules.ts';
import {maskSchema} from './scripts/career-delete.ts';
const store=await Store.open();
const json=row=>{ try { return row ? JSON.parse(row.value) : undefined; } catch { return null; } };
try {
  let dbo;
  for(const schema of await registeredAccountSchemas(store)) {
    const meta=key=>store.get(`SELECT TOP (1) [value] FROM ${tableName(schema,'meta')} WHERE [key] = ?`,key);
    const state=json(await meta('state')), world=json(await meta('world'));
    const club=await store.get(`SELECT TOP (1) [id] FROM ${tableName(schema,'clubs')}`);
    const player=await store.get(`SELECT TOP (1) [id] FROM ${tableName(schema,'players')}`);
    let kind;
    if(state===undefined && !club && !player) kind='empty';
    else if(typeof state?.date==='string' && state.date && club && player && world?.version===WORLD_VERSION) kind='career';
    else throw new Error(`--current-worlds refused: ${maskSchema(schema)} is neither empty nor a complete world at version ${WORLD_VERSION} (world version ${world?.version ?? 'missing'}). Review it; deployment never deletes or migrates worlds.`);
    if(schema.toLowerCase()==='dbo') dbo=kind;
    console.log(`[sql] ${maskSchema(schema)}: ${kind==='empty' ? 'world empty' : `career at world version ${WORLD_VERSION}`}.`);
  }
  if(!dbo) throw new Error('--current-worlds refused: dbo is not a registered world.');
  writeFileSync(process.env.DEPLOY_DBO_WORLD_FILE,dbo);
} finally { await store.close(); }
NODE
}

deployment_empty_smoke() {
  deployment_sql -- env -u CONTAINER_APP_NAME -u APP_ORIGIN REQUIRE_AUTH=false API_HOST=127.0.0.1 SQL_SCHEMA=dbo \
    node --import tsx --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import request from 'supertest';
import {Store} from './server/db.ts';
import {createApp} from './server/app.ts';
const store=await Store.open();
const career=()=>store.get("SELECT TOP (1) [key] FROM meta WHERE [key] = N'state'");
try {
  assert.equal(store.schemaName,'dbo');
  assert.equal(store.testMode,false);
  assert.equal(await career(),undefined,'The dbo world must be empty before the empty-world smoke.');
  const app=await createApp(store);
  for(const path of ['/api/health/details','/api/bootstrap','/api/saves']) {
    const response=await request(app).get(path);
    assert.equal(response.status,200,`Read-only ${path} failed`);
    if(path==='/api/health/details') {
      assert.equal(response.body.hosted,false);
      assert.equal(response.body.testCareer,false);
      assert.equal(response.body.schema,'dbo');
      assert.equal(response.body.databaseName,process.env.AZURE_SQL_DATABASE);
      assert.equal(response.body.date,'');
    }
    if(path==='/api/bootstrap') assert.equal(response.text,'null','An empty world must not bootstrap a career.');
    console.log(`[smoke] GET ${path}: 200`);
  }
  assert.equal(await career(),undefined,'Smoke checks must not create a career.');
  console.log('[smoke] Empty dbo world unchanged in the internal synthetic app; New career is verified by the owner after promotion.');
} finally { await store.close(); }
NODE
}

deployment_image_provenance() {
  local image="$1" pull_token="$2" revision
  need git
  [[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail '--image requires a clean tracked checkout of the reviewed commit.'
  revision="$(git rev-parse HEAD)"
  [[ "$revision" =~ ^[a-f0-9]{40}$ ]] || fail 'Could not resolve the checkout commit.'
  printf '[image] Verifying that %s was built from %s (GHCR metadata, no Docker).\n' "$image" "$revision"
  DEPLOY_IMAGE="$image" DEPLOY_REVISION="$revision" DEPLOY_PULL_TOKEN="$pull_token" node --input-type=module <<'NODE'
import {createHash} from 'node:crypto';
const {DEPLOY_IMAGE:image,DEPLOY_REVISION:revision,DEPLOY_PULL_TOKEN:token,GHCR_USER:user,GHCR_IMAGE:reference}=process.env;
const repository=reference.slice('ghcr.io/'.length), digest=image.slice(image.indexOf('@')+1);
const login=await fetch(`https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(`repository:${repository}:pull`)}`,
  {headers:{Authorization:`Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`},signal:AbortSignal.timeout(20000)});
if(login.status!==200) throw new Error('GHCR pull authentication failed; image provenance could not be checked.');
const {token:bearer}=await login.json();
const sha=bytes=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const fetchVerified=async (path,expected,accept)=>{
  const response=await fetch(`https://ghcr.io/v2/${repository}/${path}`,
    {headers:{Authorization:`Bearer ${bearer}`,...(accept?{Accept:accept}:{})},signal:AbortSignal.timeout(60000)});
  if(response.status!==200) throw new Error(`GHCR returned ${response.status} for ${path.split('/')[0]}.`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(sha(bytes)!==expected) throw new Error('GHCR content does not match its digest.');
  return JSON.parse(bytes.toString('utf8'));
};
const manifestTypes=['application/vnd.oci.image.index.v1+json','application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json','application/vnd.docker.distribution.manifest.v2+json'].join(', ');
let manifest=await fetchVerified(`manifests/${digest}`,digest,manifestTypes);
if(Array.isArray(manifest.manifests)) {
  const platforms=manifest.manifests.filter(entry=>entry.platform?.os==='linux' && entry.platform?.architecture==='amd64');
  if(platforms.length!==1) throw new Error('The image index must contain exactly one linux/amd64 manifest.');
  manifest=await fetchVerified(`manifests/${platforms[0].digest}`,platforms[0].digest,platforms[0].mediaType);
}
if(!manifest.config?.digest) throw new Error('The image manifest has no config.');
const config=await fetchVerified(`blobs/${manifest.config.digest}`,manifest.config.digest);
const labels=config.config?.Labels ?? {};
if(config.os!=='linux' || config.architecture!=='amd64') throw new Error('Azure Container Apps requires a linux/amd64 image.');
if(labels['org.opencontainers.image.source']?.toLowerCase()!=='https://github.com/carlossardo/touchline')
  throw new Error('The image source label does not name the Touchline repository.');
if(labels['org.opencontainers.image.revision']!==revision)
  throw new Error(`The image was built from ${labels['org.opencontainers.image.revision'] ?? 'an unknown revision'}, not the checkout ${revision}.`);
console.log('[image] Provenance verified: the digest carries the checkout commit.');
NODE
}

deployment_logging_check() {
  node -e 'let text=""; process.stdin.on("data",chunk=>text+=chunk); process.stdin.on("end",()=>{
    const logs=JSON.parse(text).properties?.appLogsConfiguration;
    if(!logs || ![null,"none"].includes(logs.destination) || logs.logAnalyticsConfiguration!=null) process.exit(1);
  });'
}

deployment_auth_check() {
  azure containerapp auth show --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --output json |
    node -e 'let text=""; process.stdin.on("data", chunk => text+=chunk); process.stdin.on("end", () => {
      const response=JSON.parse(text), config=response.properties ?? response;
      const provider=config.identityProviders?.azureActiveDirectory;
      const enabled=Object.entries(config.identityProviders ?? {}).filter(([,value])=>value?.enabled).map(([name])=>name);
      if(config.platform?.enabled!==true || config.globalValidation?.unauthenticatedClientAction!=="RedirectToLoginPage" ||
        config.globalValidation?.redirectToProvider || enabled.length!==1 || enabled[0]!=="azureActiveDirectory" ||
        JSON.stringify([...(config.globalValidation?.excludedPaths ?? [])].sort())!==JSON.stringify(["/api/health","/invite"]) ||
        provider?.enabled!==true || provider.registration?.clientId!==process.env.AUTH_CLIENT_ID ||
        provider.registration?.openIdIssuer!=="https://login.microsoftonline.com/common/v2.0" ||
        provider.registration?.clientSecretSettingName!=="entra-client-secret" || config.httpSettings?.requireHttps!==true)
        process.exit(1);
    });' || fail 'EasyAuth configuration did not match the required common/v2.0 issuer, client, public /invite path and authenticated sign-in policy.'
}

deployment_guest_allowlist() {
  node -e 'let text=""; process.stdin.on("data",chunk=>text+=chunk); process.stdin.on("end",()=>{
    const app=JSON.parse(text);
    const container=app?.properties?.template?.containers?.find(item=>item.name===process.env.AZURE_APP);
    const current=container?.env?.find(item=>item.name==="ALLOWED_USER_OBJECT_IDS")?.value ?? "";
    const ids=(process.env.ALLOWED_USER_OBJECT_IDS ?? current).split(",").map(value=>value.trim().toLowerCase()).filter(Boolean);
    if(ids.length>100 || ids.some(value=>!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(value)))
      throw new Error("ALLOWED_USER_OBJECT_IDS must contain at most 100 Entra object UUIDs.");
    process.stdout.write([...new Set(ids)].join(","));
  });'
}

deployment_candidate_check() {
  local revision="$1" origin="$2" candidate
  printf '%s\n' '[candidate] Checking immutable revision configuration without requiring a running replica.'
  candidate="$(azure containerapp revision show --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --revision "$revision" --output json)"
  DEPLOY_CANDIDATE="$candidate" DEPLOY_ORIGIN="$origin" DEPLOY_SCHEMA="$schema_version" DEPLOY_MAINTENANCE="${stage_only:-false}" node --input-type=module <<'NODE'
const environment=process.env, template=JSON.parse(environment.DEPLOY_CANDIDATE).properties?.template;
const container=template?.containers?.[0], entries=container?.env ?? [];
const values=Object.fromEntries(entries.map(item=>[item.name,item.value]));
const expected={NODE_ENV:'production',API_HOST:'0.0.0.0',API_PORT:'3001',REQUIRE_AUTH:'true',
  AZURE_TENANT_ID:environment.AZURE_TENANT_ID,APP_ORIGIN:environment.DEPLOY_ORIGIN,
  ALLOWED_USER_OBJECT_IDS:environment.ALLOWED_USER_OBJECT_IDS,
  APPROVER_EMAIL:environment.APPROVER_EMAIL,OWNER_EMAIL:environment.OWNER_EMAIL,SMTP_USER:environment.SMTP_USER,
  MAX_PLAYERS:environment.MAX_PLAYERS,INVITE_DB_SIZE_LIMIT_GB:environment.INVITE_DB_SIZE_LIMIT_GB,
  EMAIL_TRANSPORT:environment.EMAIL_TRANSPORT,
  SQL_SERVER:`${environment.AZURE_SQL_SERVER}.database.windows.net`,SQL_DATABASE:environment.AZURE_SQL_DATABASE,
  SQL_SCHEMA:'dbo',SQL_PORT:'1433',SQL_ENCRYPT:'true',SQL_TRUST_SERVER_CERTIFICATE:'false',
  TOUCHLINE_SCHEMA_VERSION:environment.DEPLOY_SCHEMA,TOUCHLINE_MAINTENANCE:environment.DEPLOY_MAINTENANCE};
const secretRefs=Object.fromEntries(entries.filter(item=>item.secretRef).map(item=>[item.name,item.secretRef]));
const expectedRefs=environment.EMAIL_TRANSPORT==='gmail' ?
  {INVITE_SIGNING_SECRET:'invite-signing-secret',SMTP_PASSWORD:'smtp-password'} : {INVITE_SIGNING_SECRET:'invite-signing-secret'};
const uuid=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
if(template?.containers?.length!==1 || container.name!==environment.AZURE_APP ||
   !container.image?.startsWith(`${environment.GHCR_IMAGE}@sha256:`) || !/@sha256:[a-f0-9]{64}$/.test(container.image) ||
   (template.scale?.minReplicas ?? 0)!==0 || template.scale?.maxReplicas!==1 ||
   Object.entries(expected).some(([name,value])=>values[name]!==value) ||
   JSON.stringify(secretRefs)!==JSON.stringify(expectedRefs) ||
   !uuid.test(values.OWNER_OBJECT_ID ?? '') || !uuid.test(values.AZURE_CLIENT_ID ?? '') ||
   values.SQL_TEST_MODE==='true' || values.SQL_ALLOW_REMOTE_TESTS==='true' ||
   entries.some(item=>['SQL_USER','SQL_PASSWORD','SQL_TEST_DATABASE','TOUCHLINE_E2E_SCHEMA','CONTAINER_APP_NAME'].includes(item.name)))
  throw new Error('Candidate must retain owner authentication, the selected SQL target/schema, private digest and 0..1 scale.');
NODE
}

deployment_schema_check() {
  printf '%s\n' '[sql] Checking account registry and world schema compatibility through read-only operator queries.'
  deployment_sql -- node --import tsx --input-type=module - "${1:-}" "${2:-registered}" <<'NODE'
import {Store} from './server/db.ts';
import {registeredAccountSchemas} from './server/accounts.ts';
import {maskIdentifier,maskSchema} from './scripts/career-delete.ts';
import {LEGACY_EMAIL,LEGACY_OBJECT_ID} from './server/legacy-account.ts';
import {CONSUMER_TENANT_ID} from './server/invite-store.ts';
const expectedVersion=process.argv[2], mode=process.argv[3];
if(!['registered','legacy-rollback'].includes(mode)) throw new Error('Unknown schema verification mode.');
const store=await Store.open();
try {
  let schemas;
  if(mode==='legacy-rollback') {
    const metadata=await store.get("SELECT HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'VIEW DEFINITION') AS can_inspect, SCHEMA_ID(N'accounts') AS registry_schema_id");
    if(metadata?.can_inspect!==1)
      throw new Error('Rollback blocked: database metadata visibility is required to establish whether the account registry exists. Use an authorized operator identity; do not bypass the guard.');
    if(metadata.registry_schema_id!==null)
      throw new Error('Runtime rollback blocked: the accounts registry exists, and retained revision metadata cannot prove per-user isolation for its immutable image. Schema versions or inherited environment markers are not proof. Keep the current isolated revision and prepare a reviewed forward fix; an old shared-world image requires a separately reviewed internal-only maintenance procedure. Never drop the registry to bypass this guard.');
    schemas=['dbo'];
  } else {
    try {
      schemas=await registeredAccountSchemas(store);
    } catch(error) {
      throw new Error('Release blocked: account registry or registered worlds are not ready. Review scripts/accounts-migrate.ts with explicit --tenant-id, --legacy-object-id and --legacy-email; provisioning requires a separate --apply --yes operation. Deployment never binds an owner, recreates a world or seeds data.', {cause:String(error?.message ?? error).replace(/touchline_user_\w+/gi,maskSchema)});
    }
    const registry=store.forSchema('accounts');
    try {
      const legacy=await registry.get("SELECT [tenant_id], [object_id], [email] FROM [accounts].[users] WHERE [game_schema] = N'dbo'");
      // dbo belongs to the legacy guest: either its original home-tenant identity or, after the automatic
      // first-sign-in rebind, its personal Microsoft account (consumers tenant) with the verified legacy email.
      const original=legacy?.tenant_id.toLowerCase()===process.env.AZURE_TENANT_ID?.toLowerCase() &&
        legacy?.object_id.toLowerCase()===LEGACY_OBJECT_ID;
      const rebound=legacy?.tenant_id.toLowerCase()===CONSUMER_TENANT_ID && legacy?.email?.toLowerCase()===LEGACY_EMAIL;
      if(!schemas.includes('dbo') || !(original || rebound))
        throw new Error(`Release blocked: dbo must remain bound to the approved legacy guest (object ID ${maskIdentifier(LEGACY_OBJECT_ID)} or its rebound personal Microsoft account, see server/legacy-account.ts), never implicitly to the platform owner. Review explicit account provisioning.`);
    } finally { await registry.close(); }
  }
  for(const schema of schemas) {
    const scoped=store.forSchema(schema);
    try {
      const row=await scoped.get('SELECT MAX(version) AS version FROM schema_migrations');
      if(!Number.isSafeInteger(row?.version) || row.version<1 || (expectedVersion && String(row.version)!==expectedVersion))
        throw new Error(`Candidate schema mismatch for ${maskSchema(schema)}; database downgrade/restore is never automatic.`);
      console.log(`[sql] ${maskSchema(schema)}: schema version ${row.version}`);
    } finally { await scoped.close(); }
  }
} finally { await store.close(); }
NODE
}

deployment_firewall() {
  local outbound rules plan operation rule_name address
  printf '%s\n' '[sql-firewall] Waiting up to 180 seconds for advertised ACA egress; the app opens SQL on its first signed-in request.'
  azure resource wait --ids "$app_id" --api-version 2024-03-01 \
    --custom 'length(properties.outboundIpAddresses || `[]`) > `0`' --interval 5 --timeout 180 --output none
  outbound="$(azure containerapp show --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --query properties.outboundIpAddresses --output json)"
  rules="$(azure sql server firewall-rule list --resource-group "$AZURE_RESOURCE_GROUP" --server "$AZURE_SQL_SERVER" --output json)"
  plan="$(DEPLOY_OUTBOUND="$outbound" DEPLOY_FIREWALL="$rules" node --input-type=module <<'NODE'
import {isIP} from 'node:net';
const outbound=JSON.parse(process.env.DEPLOY_OUTBOUND), rules=JSON.parse(process.env.DEPLOY_FIREWALL);
if(!Array.isArray(outbound) || !outbound.length || !Array.isArray(rules) ||
   outbound.some(address=>typeof address!=='string' || isIP(address)!==4 || address==='0.0.0.0'))
  throw new Error('Advertised egress must be a nonempty list of exact IPv4 addresses; blanket SQL access is forbidden.');
const addresses=[...new Set(outbound)].sort(), prefix='touchline-app-';
const owned=rules.filter(rule=>typeof rule.name==='string' && rule.name.startsWith(prefix) && isIP(rule.name.slice(prefix.length))===4);
if(owned.some(rule=>rule.startIpAddress!==rule.name.slice(prefix.length) || rule.endIpAddress!==rule.startIpAddress))
  throw new Error('An owned firewall name has unexpected IP bounds; operator review is required before changing rules.');
for(const address of addresses)
  if(!rules.some(rule=>rule.name===`${prefix}${address}`)) console.log(`create\t${prefix}${address}\t${address}`);
for(const rule of owned)
  if(!addresses.includes(rule.startIpAddress)) console.log(`delete\t${rule.name}\t${rule.startIpAddress}`);
NODE
)" || fail 'Egress/firewall metadata validation failed; no SQL firewall rules changed.'
  printf '%s\n' '[sql-firewall] Adding missing exact-IP rules, then pruning only stale touchline-app-<ip> rules.'
  while IFS=$'\t' read -r operation rule_name address; do
    case "$operation" in
      create) azure sql server firewall-rule create --resource-group "$AZURE_RESOURCE_GROUP" --server "$AZURE_SQL_SERVER" \
        --name "$rule_name" --start-ip-address "$address" --end-ip-address "$address" --output none ;;
      delete) azure sql server firewall-rule delete --resource-group "$AZURE_RESOURCE_GROUP" --server "$AZURE_SQL_SERVER" \
        --name "$rule_name" --output none ;;
      '') ;;
      *) fail 'Unexpected SQL firewall operation.' ;;
    esac
  done <<<"$plan"
}

deployment_traffic_check() {
  azure containerapp show --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --output json |
    DEPLOY_REVISION="$1" DEPLOY_EXTERNAL="$2" node -e 'let text=""; process.stdin.on("data",chunk=>text+=chunk); process.stdin.on("end",()=>{
      const config=JSON.parse(text).properties?.configuration, ingress=config?.ingress, traffic=ingress?.traffic;
      if(config?.activeRevisionsMode!=="Multiple" || ingress?.external!==(process.env.DEPLOY_EXTERNAL==="true") ||
        ingress?.targetPort!==3001 || ingress?.allowInsecure===true || traffic?.length!==1 ||
        traffic[0].revisionName!==process.env.DEPLOY_REVISION || traffic[0].latestRevision===true || traffic[0].weight!==100) process.exit(1);
    });' || fail 'Ingress and 100% selected-revision traffic were not confirmed.'
}

deployment_deactivate_others() {
  local selected="$1" active other
  deployment_traffic_check "$selected" true
  printf '%s\n' '[revisions] Traffic verified; retaining every nonselected revision inactive for rollback.'
  active="$(azure containerapp revision list --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --query '[?properties.active].name' --output tsv)"
  while IFS= read -r other; do
    if [[ -n "$other" && "$other" != "$selected" ]]; then
      azure containerapp revision deactivate --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --revision "$other" --output none
    fi
  done <<<"$active"
  active="$(azure containerapp revision list --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --query '[?properties.active].name' --output tsv)"
  [[ "$active" == "$selected" ]] || fail 'Expected only the selected revision to remain active.'
}

deployment_wait() {
  local revision="$1"
  printf '%s\n' '[readiness] Waiting up to 300 seconds for selected-revision readiness after HTTP wake-up.'
  azure containerapp revision show --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" \
    --revision "$revision" --output json >/dev/null
  azure resource wait --ids "${app_id}/revisions/${revision}" --api-version 2024-03-01 \
    --custom "properties.healthState=='Healthy' && properties.provisioningState=='Provisioned'" \
    --interval 5 --timeout 300 --output none
}

deployment_public_check() {
  local account_smoke_token="$smoke_token"
  if [[ "${skip_db_prepare:-false}" == true ]]; then
    if [[ -n "$account_smoke_token" ]]; then
      printf '%s\n' '[smoke] Authenticated account probe skipped with --skip-db-prepare to avoid profile refresh writes; manual sign-in verification remains pending.'
    fi
    account_smoke_token=''
  fi
  DEPLOY_ORIGIN="$1" AUTH_SMOKE_TOKEN="$account_smoke_token" node --input-type=module <<'NODE'
import { setTimeout } from 'node:timers/promises';
const origin=process.env.DEPLOY_ORIGIN;
const deadline=Date.now()+300000;
let healthy=false, attempt=0;
while(Date.now()<deadline) {
  attempt++;
  if(attempt===1 || attempt%10===0) console.log(`[readiness] Guarded HTTP wake/health attempt ${attempt} (300-second deadline; /api/health is SQL-free and proves only that the revision serves HTTP).`);
  try {
    const response=await fetch(`${origin}/api/health`, {redirect:'manual', signal:AbortSignal.timeout(Math.max(1,Math.min(10000,deadline-Date.now())))});
    if(response.status===200 && (await response.json()).status==='ok') { healthy=true; break; }
  } catch {}
  const delay=Math.min(2000,deadline-Date.now());
  if(delay>0) await setTimeout(delay);
}
if(!healthy) throw new Error('Public health did not become ready within 300 seconds; ingress will close.');
for(const path of ['/','/api/health/details']) {
  const headers=path==='/' ? {Accept:'text/html','User-Agent':'Mozilla/5.0'} : {Accept:'application/json'};
  const denied=await fetch(`${origin}${path}`, {redirect:'manual', headers, signal:AbortSignal.timeout(15000)});
  if(path!=='/' && [401,403].includes(denied.status)) continue;
  const location=denied.headers.get('location');
  const login=location ? new URL(location,origin) : null;
  const expectedLogin=login && ((login.origin===origin && login.pathname==='/.auth/login/aad') ||
    (login.origin==='https://login.microsoftonline.com' && (login.pathname.startsWith('/common/') || login.pathname.startsWith(`/${process.env.AZURE_TENANT_ID}/`))));
  if(denied.status!==302 || !expectedLogin) throw new Error('Anonymous game/API access must redirect to the configured sign-in provider.');
}
const invite=await fetch(`${origin}/invite`, {redirect:'manual', headers:{Accept:'text/html'}, signal:AbortSignal.timeout(60000)});
if(invite.status!==200 || !invite.headers.get('content-type')?.startsWith('text/html') || !(await invite.text()).includes('Request an invite'))
  throw new Error('Public /invite must serve the invite request page without sign-in; ingress will close.');
if(process.env.AUTH_SMOKE_TOKEN) {
  // The first signed-in request opens SQL and checks the registry: up to 90 s of connection retries, then 503.
  let response;
  for(let attempt=1;;attempt++) {
    try {
      response=await fetch(`${origin}/api/me`, {
        redirect:'manual', signal:AbortSignal.timeout(120000),
        headers:{Authorization:`Bearer ${process.env.AUTH_SMOKE_TOKEN}`},
      });
    } catch {
      throw new Error('Owner smoke /api/me failed or did not answer within 120 seconds; ingress will close.');
    }
    if(response.status!==503 || attempt===2) break;
    if((await response.json().catch(()=>null))?.code!=='database_unavailable') break;
    console.log('[smoke] /api/me: 503 database_unavailable (SQL starting or unavailable); retrying once.');
    await setTimeout(1000*Math.min(30,Math.max(1,Number(response.headers.get('retry-after'))||5)));
  }
  if(response.status===503) throw new Error('Owner smoke /api/me returned 503: the new revision could not open SQL or validate the account registry; ingress will close.');
  if(response.status!==200) throw new Error(`Owner smoke /api/me returned ${response.status}; ingress will close.`);
  const session=await response.json();
  const idle=typeof session.hasWorld==='boolean' && session.activity===null;
  const busy=session.hasWorld===null && session.activity!==null && typeof session.activity==='object' &&
    typeof session.activity.operation==='string' && typeof session.activity.startedAt==='string';
  if(!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(session.user?.id ?? '') ||
     typeof session.user?.displayName!=='string' || !session.user.displayName.trim() ||
     !(session.user.email===null || typeof session.user.email==='string') || !(idle || busy))
    throw new Error('Owner smoke did not return a provisioned human account profile; an empty or busy world is valid.');
}
console.log(`PUBLIC_HEALTH_OK INVITE_PAGE_PUBLIC SIGN_IN_REQUIRED ownerSmokeVerified=${Boolean(process.env.AUTH_SMOKE_TOKEN)}`);
NODE
}

deployment_private_registry() {
  node --input-type=module <<'NODE'
const repository=process.env.GHCR_IMAGE.slice('ghcr.io/'.length);
const response=await fetch(`https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(`repository:${repository}:pull`)}`, {signal:AbortSignal.timeout(20000)});
if([401,403].includes(response.status)) process.exit(0);
if(response.status!==200) throw new Error('Cannot establish private GHCR access policy.');
const {token}=await response.json();
if(!token) throw new Error('GHCR returned no anonymous access result.');
const tags=await fetch(`https://ghcr.io/v2/${repository}/tags/list`, {headers:{Authorization:`Bearer ${token}`}, signal:AbortSignal.timeout(20000)});
if(![401,403].includes(tags.status)) throw new Error('GHCR repository is public or its privacy cannot be established. Refusing to push/deploy.');
NODE
}

deployment_main() {
  local consent='' image='' stage_only=false hold_ingress=false verification=full skip_db_prepare=false empty_worlds=false current_worlds=false image_verified=false
  while (( $# )); do
    case "$1" in
      --help|-h) deploy_usage; return ;;
      --yes) consent=--yes; shift ;;
      --stage-only) stage_only=true; shift ;;
      --hold-ingress) hold_ingress=true; shift ;;
      --skip-db-prepare) skip_db_prepare=true; shift ;;
      --empty-worlds) empty_worlds=true; shift ;;
      --current-worlds) current_worlds=true; shift ;;
      --verification) [[ $# -ge 2 ]] || { deploy_usage >&2; return 2; }; verification="$2"; shift 2 ;;
      --image) [[ $# -ge 2 ]] || { deploy_usage >&2; return 2; }; image="$2"; shift 2 ;;
      *) deploy_usage >&2; return 2 ;;
    esac
  done
  source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
  [[ "$verification" == full || "$verification" == smoke ]] || fail '--verification must be full or smoke.'
  [[ "$hold_ingress" != true || "$stage_only" != true ]] || fail '--hold-ingress and --stage-only are mutually exclusive.'
  [[ "$hold_ingress" != true || -z "$image" ]] || fail '--hold-ingress requires a reviewed source build, not a prebuilt --image.'
  [[ "$empty_worlds" != true || "$stage_only" != true ]] || fail '--empty-worlds applies to gameplay deployments only.'
  [[ "$current_worlds" != true || "$stage_only" != true ]] || fail '--current-worlds applies to gameplay deployments only.'
  [[ "$current_worlds" != true || "$empty_worlds" != true ]] || fail '--empty-worlds and --current-worlds are mutually exclusive.'
  [[ "$consent" == --yes ]] || fail 'Deployment requires --yes. Use --help to review prerequisites.'
  [[ "$GHCR_IMAGE" =~ ^ghcr\.io/[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._/-]*$ ]] || fail 'GHCR_IMAGE must be an untagged private ghcr.io repository.'
  if [[ -n "$image" ]]; then
    [[ "$image" == "$GHCR_IMAGE"@sha256:* && "${image##*@sha256:}" =~ ^[a-f0-9]{64}$ ]] || fail '--image must pin the configured private GHCR repository to a sha256 digest.'
  fi
  [[ "${AUTH_CLIENT_ID:-}" =~ ^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$ ]] || fail 'Set AUTH_CLIENT_ID for your Entra application (npm run azure:auth -- --yes --allow-personal-accounts).'
  [[ -n "${INVITE_SIGNING_SECRET:-}" && ${#INVITE_SIGNING_SECRET} -ge 32 ]] 2>/dev/null || fail 'Set INVITE_SIGNING_SECRET (at least 32 characters; npm run azure:auth creates one in .env).'
  [[ -n "${AUTH_CLIENT_SECRET:-}" && -n "${GHCR_USER:-}" && -n "${GHCR_PULL_TOKEN:-${GHCR_TOKEN:-}}" ]] || fail 'Supply AUTH_CLIENT_SECRET, GHCR_USER and GHCR_PULL_TOKEN (or GHCR_TOKEN) locally.'
  local pull_token="${GHCR_PULL_TOKEN:-${GHCR_TOKEN:-}}" push_token="${GHCR_TOKEN:-}" auth_secret="$AUTH_CLIENT_SECRET"
  local smoke_token="${AUTH_SMOKE_TOKEN:-}" app_id invite_secret="$INVITE_SIGNING_SECRET" smtp_password="${SMTP_PASSWORD:-}"
  declare -g temp_dir='' touched=false completed=false
  unset GHCR_TOKEN GHCR_PULL_TOKEN AUTH_CLIENT_SECRET AUTH_SMOKE_TOKEN AZURE_CLIENT_ID INVITE_SIGNING_SECRET SMTP_PASSWORD
  APPROVER_EMAIL="${APPROVER_EMAIL:-sardo.kiko@gmail.com}" OWNER_EMAIL="${OWNER_EMAIL:-carlos.sardo@outlook.com}"
  SMTP_USER="${SMTP_USER:-sardo.kiko@gmail.com}" MAX_PLAYERS="${MAX_PLAYERS:-10}" INVITE_DB_SIZE_LIMIT_GB="${INVITE_DB_SIZE_LIMIT_GB:-24}"
  [[ "$MAX_PLAYERS" =~ ^[1-9][0-9]{0,2}$ && "$INVITE_DB_SIZE_LIMIT_GB" =~ ^[1-9][0-9]?$ ]] || fail 'MAX_PLAYERS and INVITE_DB_SIZE_LIMIT_GB must be small positive integers.'
  for address in "$APPROVER_EMAIL" "$OWNER_EMAIL" "$SMTP_USER"; do
    [[ "$address" =~ ^[^[:space:]@\"\']+@[^[:space:]@\"\']+\.[^[:space:]@\"\']+$ ]] || fail 'APPROVER_EMAIL, OWNER_EMAIL and SMTP_USER must be email addresses.'
  done
  if [[ -n "$smtp_password" ]]; then EMAIL_TRANSPORT=gmail; else
    EMAIL_TRANSPORT=disabled
    printf '%s\n' '[email] WARNING: SMTP_PASSWORD is not set. Deploying with EMAIL_TRANSPORT=disabled: invite requests are stored,' \
      '        but NO approval or welcome emails are sent until you redeploy with a Google app password. Review /admin/invites.' >&2
  fi
  export AUTH_CLIENT_ID GHCR_USER APPROVER_EMAIL OWNER_EMAIL SMTP_USER MAX_PLAYERS INVITE_DB_SIZE_LIMIT_GB EMAIL_TRANSPORT
  [[ -n "$image" || -n "$push_token" ]] || fail 'GHCR_TOKEN with read:packages/write:packages is required to push.'
  need node
  need npm
  [[ -f scripts/azure-sql.sh ]] || fail 'Main must provide scripts/azure-sql.sh before deployment.'
  if [[ -n "$image" && "$stage_only" != true ]]; then
    deployment_image_provenance "$image" "$pull_token"
    image_verified=true
  fi
  if [[ "$stage_only" != true && "$verification" == smoke ]]; then
    printf '%s\n' '[verify] Building before any Azure or SQL step, so ingress closes and the database wakes later.'
    npm run build
  fi
  printf '%s\n' '[deploy] Checking target, SQL free limits, managed identity and private registry.'
  check_target
  confirm_target "$consent"
  verify_free_database
  sql_environment
  local owner identity identity_id identity_client environment environment_id public_domain previous_revision='' schema_version
  owner="$(azure ad signed-in-user show --query id --output tsv)"
  [[ "$owner" =~ ^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$ ]] || fail 'An interactive owner Azure sign-in is required.'
  identity="$(azure identity show --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_IDENTITY" --output json)"
  identity_id="$(printf '%s' "$identity" | json_value id)"
  identity_client="$(printf '%s' "$identity" | json_value clientId)"
  environment="$(azure containerapp env show --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_ENVIRONMENT" --output json)"
  environment_id="$(printf '%s' "$environment" | json_value id)"
  public_domain="$(printf '%s' "$environment" | json_value properties.defaultDomain)"
  [[ "$public_domain" == *.azurecontainerapps.io && "$public_domain" != *[/:[:space:]]* && "$public_domain" != internal.* ]] || fail 'A public-capable Container Apps environment DNS suffix is required.'
  printf '%s' "$environment" | deployment_logging_check || fail 'Environment must have disabled log storage and no Log Analytics workspace.'
  deployment_private_registry
  local stamp backup=''
  stamp="$(date -u +%Y%m%d%H%M%S)-$$"
  schema_version="$(node --import tsx --input-type=module -e 'import {schemaMigrations} from "./server/sql-schema.ts"; console.log(schemaMigrations("dbo").at(-1).version)')"
  umask 077
  temp_dir="$(mktemp -d)"
  app_id="/subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/$AZURE_RESOURCE_GROUP/providers/Microsoft.App/containerApps/$AZURE_APP"
  # shellcheck disable=SC2154 # status is assigned inside the trap body.
  trap 'status=$?; trap - EXIT; if [[ "$touched" == true && "$completed" != true ]]; then azure containerapp ingress enable --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --type internal --target-port 3001 --transport auto --output none >/dev/null 2>&1 || printf "%s\n" "CRITICAL: Could not close ingress after failure; close it manually immediately." >&2; fi; rm -rf -- "$temp_dir"; exit "$status"' EXIT
  azure containerapp list --resource-group "$AZURE_RESOURCE_GROUP" --output json >"$temp_dir/apps.json"
  APP_NAME="$AZURE_APP" DEPLOY_STAGE_ONLY="$stage_only" node --input-type=module - "$temp_dir" <<'NODE'
import {readFileSync,writeFileSync} from 'node:fs';
const directory=process.argv[2], apps=JSON.parse(readFileSync(`${directory}/apps.json`,'utf8'));
const existing=apps.find(app=>app.name===process.env.APP_NAME);
if(existing && existing.tags?.['touchline-tooling']!=='local') throw new Error('Refusing to replace an app not managed by these scripts.');
if(existing?.properties?.configuration?.ingress?.external===true && process.env.DEPLOY_STAGE_ONLY==='true')
  throw new Error('Stage-only cannot replace an already-public app. Use the verified release workflow.');
writeFileSync(`${directory}/existing.json`, JSON.stringify(existing ?? null));
NODE
  ALLOWED_USER_OBJECT_IDS="$(deployment_guest_allowlist < "$temp_dir/existing.json")"
  export ALLOWED_USER_OBJECT_IDS
  previous_revision="$(node -e 'const app=require(process.argv[1]); process.stdout.write(app?.properties?.configuration?.ingress?.traffic?.find(item=>item.weight===100)?.revisionName ?? app?.properties?.latestReadyRevisionName ?? "")' "$temp_dir/existing.json")"
  if [[ "$(<"$temp_dir/existing.json")" != null ]]; then
    touched=true
    printf '%s\n' '[ingress] Closing existing ingress before SQL verification/preparation; writer drain remains an operator gate.'
    azure containerapp ingress enable --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --type internal --target-port 3001 --transport auto --output none
    [[ "$(azure containerapp show --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --query properties.configuration.ingress.external --output tsv)" == false ]] || fail 'Internal ingress was not confirmed; SQL preparation blocked.'
  fi
  if [[ "$stage_only" == true ]]; then
    printf '%s\n' '[stage] Internal-only maintenance deployment. No career or SQL permission changes; public promotion remains disabled.'
  else
    if [[ "$skip_db_prepare" == true ]]; then
      deployment_schema_check "$schema_version"
    else
      deployment_schema_check
    fi
    [[ -z "$image" || "$image_verified" == true ]] || fail 'Gameplay deployment with an unverified --image is blocked. Omit --image to build the reviewed source, or use a digest whose revision label equals the clean checkout HEAD.'
    if [[ "$empty_worlds" == true ]]; then
      deployment_empty_worlds_check
    elif [[ "$current_worlds" == true ]]; then
      deployment_current_worlds_check "$temp_dir/dbo-world"
      # An empty dbo takes the --empty-worlds smoke and skips the dbo export.
      if [[ "$(<"$temp_dir/dbo-world")" == empty ]]; then empty_worlds=true; fi
    else
      printf '%s\n' '[verify] Checking only the preserved dbo career, then running isolated SQL-backed verification; other registered worlds may be empty.'
      deployment_sql -- node --import tsx --input-type=module -e 'const {Store}=await import("./server/db.ts"); const {stateOf}=await import("./server/systems.ts"); const store=await Store.open(); try { if(!(await stateOf(store))?.date || !(await store.get("SELECT TOP(1) id FROM clubs"))) throw new Error("Load an initialized world before deployment; no seed is performed."); } finally { await store.close(); }'
    fi
    if [[ "$verification" == full ]]; then
      deployment_sql --tests -- npm run verify
    else
      printf '%s\n' '[verify] Focused release checks selected; full gameplay/browser regression will not be rerun.'
      if [[ "$empty_worlds" == true ]]; then
        deployment_empty_smoke
      else
        deployment_readonly_smoke
      fi
    fi
    if [[ "$skip_db_prepare" == true ]]; then
      printf '%s\n' '[deploy] Using the prepared database; SQL export, migrations and runtime grants skipped.'
    else
      if [[ "$empty_worlds" == true ]]; then
        printf '%s\n' '[backup] Skipped: registered worlds are empty; the operator full backup must precede the reset.'
      else
        backup=".azure/backups/pre-deploy-${stamp}.touchline.gz"
        mkdir -p .azure/backups
        printf '%s\n' '[backup] Exporting the legacy dbo active world before migration or permission changes; other worlds and save catalogs require separate operator backups.'
        deployment_sql -- node --import tsx scripts/data-export.ts --out "$backup"
      fi
      printf '%s\n' '[migrate] Applying explicit migrations to every registered world, then constrained world and registry-profile runtime grants.'
      deployment_sql -- node --import tsx scripts/db-migrate.ts --registered --apply --yes
      deployment_sql -- env OWNER_OBJECT_ID="$owner" node --import tsx scripts/db-authorize.ts --registered --client-id "$identity_client" --name "$AZURE_IDENTITY" --apply --yes
    fi
  fi
  if [[ -z "$image" ]]; then
    printf '%s\n' '[image] Building locally and pushing to private GHCR.'
    need docker
    docker info >/dev/null 2>&1 || fail 'Docker permission/daemon check failed. No build or push attempted.'
    local tag
    tag="$GHCR_IMAGE:local-$(git rev-parse --short HEAD)-$stamp"
    bash scripts/build.sh "$tag"
    mkdir "$temp_dir/docker"
    printf '%s' "$push_token" | DOCKER_CONFIG="$temp_dir/docker" docker login ghcr.io --username "$GHCR_USER" --password-stdin >/dev/null 2>&1 || fail 'Private GHCR login failed.'
    DOCKER_CONFIG="$temp_dir/docker" docker push "$tag"
    image="$(docker image inspect "$tag" --format '{{json .RepoDigests}}' | node -e 'let text=""; process.stdin.on("data",chunk=>text+=chunk); process.stdin.on("end",()=>{ const digest=JSON.parse(text).find(value=>value.startsWith(`${process.env.GHCR_IMAGE}@sha256:`)); if(!digest) process.exit(1); process.stdout.write(digest); });')"
  fi
  [[ "$image" == "$GHCR_IMAGE"@sha256:* && "${image##*@sha256:}" =~ ^[a-f0-9]{64}$ ]] || fail 'Registry did not return the expected immutable digest.'
  deployment_private_registry
  unset push_token
  local revision_suffix="d$stamp" revision origin fqdn
  revision="$AZURE_APP--$revision_suffix"
  origin="https://$AZURE_APP.$public_domain"
  DEPLOY_IMAGE="$image" DEPLOY_OWNER="$owner" DEPLOY_IDENTITY="$identity_id" DEPLOY_CLIENT="$identity_client" \
    DEPLOY_ENVIRONMENT="$environment_id" DEPLOY_REVISION="$revision_suffix" DEPLOY_SCHEMA="$schema_version" DEPLOY_ORIGIN="$origin" \
    DEPLOY_PULL_TOKEN="$pull_token" DEPLOY_AUTH_SECRET="$auth_secret" DEPLOY_INVITE_SECRET="$invite_secret" DEPLOY_SMTP_PASSWORD="$smtp_password" \
    DEPLOY_MAINTENANCE="$stage_only" node --input-type=module - "$temp_dir" <<'NODE'
import {writeFileSync} from 'node:fs';
const environment=process.env;
const values={NODE_ENV:'production',API_HOST:'0.0.0.0',API_PORT:'3001',REQUIRE_AUTH:'true',
  OWNER_OBJECT_ID:environment.DEPLOY_OWNER,AZURE_TENANT_ID:environment.AZURE_TENANT_ID,
  ALLOWED_USER_OBJECT_IDS:environment.ALLOWED_USER_OBJECT_IDS,
  APPROVER_EMAIL:environment.APPROVER_EMAIL,OWNER_EMAIL:environment.OWNER_EMAIL,SMTP_USER:environment.SMTP_USER,
  MAX_PLAYERS:environment.MAX_PLAYERS,INVITE_DB_SIZE_LIMIT_GB:environment.INVITE_DB_SIZE_LIMIT_GB,
  EMAIL_TRANSPORT:environment.EMAIL_TRANSPORT,
  APP_ORIGIN:environment.DEPLOY_ORIGIN,AZURE_CLIENT_ID:environment.DEPLOY_CLIENT,
  SQL_SERVER:`${environment.AZURE_SQL_SERVER}.database.windows.net`,SQL_DATABASE:environment.AZURE_SQL_DATABASE,
  SQL_SCHEMA:'dbo',SQL_PORT:'1433',SQL_ENCRYPT:'true',SQL_TRUST_SERVER_CERTIFICATE:'false',
  TOUCHLINE_SCHEMA_VERSION:environment.DEPLOY_SCHEMA,TOUCHLINE_MAINTENANCE:environment.DEPLOY_MAINTENANCE};
const body={location:environment.AZURE_LOCATION,tags:{'touchline-tooling':'local'},
  identity:{type:'UserAssigned',userAssignedIdentities:{[environment.DEPLOY_IDENTITY]:{}}},
  properties:{managedEnvironmentId:environment.DEPLOY_ENVIRONMENT,workloadProfileName:'Consumption',
    configuration:{activeRevisionsMode:'Multiple',
      secrets:[{name:'ghcr-pull',value:environment.DEPLOY_PULL_TOKEN},{name:'entra-client-secret',value:environment.DEPLOY_AUTH_SECRET},
        {name:'invite-signing-secret',value:environment.DEPLOY_INVITE_SECRET},
        ...(environment.DEPLOY_SMTP_PASSWORD ? [{name:'smtp-password',value:environment.DEPLOY_SMTP_PASSWORD}] : [])],
      registries:[{server:'ghcr.io',username:environment.GHCR_USER,passwordSecretRef:'ghcr-pull'}],
      ingress:{external:false,targetPort:3001,transport:'auto',allowInsecure:false,traffic:[{latestRevision:true,weight:100}]}},
    template:{revisionSuffix:environment.DEPLOY_REVISION,containers:[{name:environment.AZURE_APP,image:environment.DEPLOY_IMAGE,
      env:[...Object.entries(values).map(([name,value])=>({name,value})),{name:'INVITE_SIGNING_SECRET',secretRef:'invite-signing-secret'},
        ...(environment.DEPLOY_SMTP_PASSWORD ? [{name:'SMTP_PASSWORD',secretRef:'smtp-password'}] : [])],resources:{cpu:0.5,memory:'1Gi'},
      probes:[{type:'Readiness',httpGet:{path:'/api/health',port:3001},initialDelaySeconds:10,periodSeconds:5,failureThreshold:30}]}],
      scale:{minReplicas:0,maxReplicas:1}}}};
writeFileSync(`${process.argv[2]}/app.json`,JSON.stringify(body),{mode:0o600});
const auth={properties:{platform:{enabled:true},httpSettings:{requireHttps:true},
  globalValidation:{unauthenticatedClientAction:'RedirectToLoginPage',excludedPaths:['/api/health','/invite']},
  identityProviders:{azureActiveDirectory:{enabled:true,registration:{clientId:environment.AUTH_CLIENT_ID,
    clientSecretSettingName:'entra-client-secret',openIdIssuer:'https://login.microsoftonline.com/common/v2.0'},
    login:{loginParameters:['scope=openid profile email']},
    validation:{allowedAudiences:[environment.AUTH_CLIENT_ID,`api://${environment.AUTH_CLIENT_ID}`]}}}}};
writeFileSync(`${process.argv[2]}/auth.json`,JSON.stringify(auth),{mode:0o600});
NODE
  touched=true
  printf '%s\n' '[deploy] Applying the owner-guarded candidate with internal ingress and 0..1 replicas.'
  azure rest --method put --url "https://management.azure.com${app_id}?api-version=2024-03-01" --body "@$temp_dir/app.json" --output none 2>/dev/null || fail 'Container App apply failed; request details suppressed to protect credentials.'
  unset pull_token auth_secret invite_secret smtp_password
  deployment_firewall
  printf '%s\n' '[auth] Applying and verifying tenant-bound EasyAuth before opening ingress.'
  azure rest --method put --url "https://management.azure.com${app_id}/authConfigs/current?api-version=2024-03-01" --body "@$temp_dir/auth.json" --output none
  deployment_auth_check
  fqdn="$(azure containerapp show --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --query properties.configuration.ingress.fqdn --output tsv)"
  [[ "$fqdn" == "$AZURE_APP.$public_domain" || "$fqdn" == "$AZURE_APP.internal.$public_domain" ]] || fail 'Unexpected application FQDN.'
  deployment_candidate_check "$revision" "$origin"
  if [[ "$stage_only" != true ]]; then deployment_schema_check "$schema_version"; fi
  azure containerapp ingress traffic set --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --revision-weight "$revision=100" --output none
  deployment_traffic_check "$revision" false
  if [[ "$hold_ingress" == true ]]; then
    DEPLOY_IMAGE="$image" DEPLOY_REVISION="$revision" DEPLOY_ORIGIN="$origin" DEPLOY_INTERNAL_ORIGIN="https://$fqdn" \
      DEPLOY_SCHEMA="$schema_version" DEPLOY_VERIFICATION="$verification" DEPLOY_DB_PREPARE_SKIPPED="$skip_db_prepare" \
      DEPLOY_OWNER="$owner" DEPLOY_CLIENT="$identity_client" node --input-type=module <<'NODE'
import {writeFileSync,mkdirSync,renameSync} from 'node:fs';
const environment=process.env;
mkdirSync('.azure',{recursive:true});
const state={status:'pendingPromotion',subscriptionId:environment.AZURE_SUBSCRIPTION_ID,
  tenantId:environment.AZURE_TENANT_ID,resourceGroup:environment.AZURE_RESOURCE_GROUP,app:environment.AZURE_APP,
  image:environment.DEPLOY_IMAGE,revision:environment.DEPLOY_REVISION,origin:environment.DEPLOY_ORIGIN,
  internalOrigin:environment.DEPLOY_INTERNAL_ORIGIN,schemaVersion:Number(environment.DEPLOY_SCHEMA),
  authClientId:environment.AUTH_CLIENT_ID,ownerObjectId:environment.DEPLOY_OWNER,identityClientId:environment.DEPLOY_CLIENT,
  allowedUserObjectIds:environment.ALLOWED_USER_OBJECT_IDS,verification:environment.DEPLOY_VERIFICATION,
  databasePreparationSkipped:environment.DEPLOY_DB_PREPARE_SKIPPED==='true',maintenance:false,externalIngress:false,
  runtimeHealthVerified:false,ownerSmokeVerified:false,recordedAt:new Date().toISOString()};
writeFileSync('.azure/held-app.json.tmp',JSON.stringify(state,null,2)+'\n',{mode:0o600});
renameSync('.azure/held-app.json.tmp','.azure/held-app.json');
NODE
    completed=true
    printf 'Candidate held: pendingPromotion (NOT deployed)\nImage: %s\nRevision: %s\nInternal endpoint: https://%s\nPromotion origin (not opened): %s\n' "$image" "$revision" "$fqdn" "$origin"
    printf '%s\n' 'Ingress remains internal; no public wake/probe or old-revision deactivation performed. Runtime health and interactive identity verification remain pending.'
    printf '%s\n' 'Review .azure/held-app.json and the README held-candidate promotion procedure. Do not rerun deployment or use --image to promote.'
    rm -rf -- "$temp_dir"
    trap - EXIT
    return
  fi
  if [[ "$stage_only" == true ]]; then
    deployment_wait "$revision"
    DEPLOY_IMAGE="$image" DEPLOY_REVISION="$revision" DEPLOY_ORIGIN="$origin" node --input-type=module <<'NODE'
import {writeFileSync,mkdirSync} from 'node:fs';
mkdirSync('.azure',{recursive:true});
writeFileSync('.azure/staged-app.json',JSON.stringify({app:process.env.AZURE_APP,image:process.env.DEPLOY_IMAGE,
  revision:process.env.DEPLOY_REVISION,origin:process.env.DEPLOY_ORIGIN,maintenance:true,externalIngress:false,
  stagedAt:new Date().toISOString()},null,2),{mode:0o600});
NODE
    completed=true
    printf 'Staged %s\nImage: %s\nRevision: %s\nMaintenance enabled; public ingress and gameplay remain disabled.\n' "$AZURE_APP" "$image" "$revision"
    rm -rf -- "$temp_dir"
    trap - EXIT
    return
  fi
  printf '%s\n' '[traffic] Opening protected ingress to wake and validate only the selected candidate.'
  azure containerapp ingress enable --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --type external --target-port 3001 --transport auto --output none
  fqdn="$(azure containerapp show --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --query properties.configuration.ingress.fqdn --output tsv)"
  if [[ "https://$fqdn" != "$origin" ]]; then
    fail 'Public FQDN differs from the environment DNS suffix. Ingress closed; investigate before retrying.'
  fi
  deployment_auth_check
  deployment_public_check "$origin"
  deployment_wait "$revision"
  deployment_deactivate_others "$revision"
  DEPLOY_IMAGE="$image" DEPLOY_REVISION="$revision" DEPLOY_PREVIOUS="$previous_revision" DEPLOY_ORIGIN="$origin" \
    DEPLOY_BACKUP="$backup" DEPLOY_SCHEMA="$schema_version" DEPLOY_VERIFICATION="$verification" DEPLOY_DB_PREPARE_SKIPPED="$skip_db_prepare" OWNER_SMOKE_VERIFIED="$([[ -n "$smoke_token" && "$skip_db_prepare" != true ]] && printf true || printf false)" \
    node --input-type=module <<'NODE'
import {writeFileSync,renameSync} from 'node:fs';
const environment=process.env;
const state={subscriptionId:environment.AZURE_SUBSCRIPTION_ID,resourceGroup:environment.AZURE_RESOURCE_GROUP,
  app:environment.AZURE_APP,image:environment.DEPLOY_IMAGE,revision:environment.DEPLOY_REVISION,
  previousRevision:environment.DEPLOY_PREVIOUS,origin:environment.DEPLOY_ORIGIN,backup:environment.DEPLOY_BACKUP,
  schemaVersion:Number(environment.DEPLOY_SCHEMA),verification:environment.DEPLOY_VERIFICATION,databasePreparationSkipped:environment.DEPLOY_DB_PREPARE_SKIPPED==='true',ownerSmokeVerified:environment.OWNER_SMOKE_VERIFIED==='true',recordedAt:new Date().toISOString()};
writeFileSync('.touchline-deployment.json.tmp',JSON.stringify(state,null,2)+'\n',{mode:0o600});
renameSync('.touchline-deployment.json.tmp','.touchline-deployment.json');
NODE
  completed=true
  printf 'Deployed %s\nImage: %s\nRevision: %s\nOwner login: %s/.auth/login/aad\nRegister redirect: %s/.auth/login/aad/callback\n' "$origin" "$image" "$revision" "$origin" "$origin"
  [[ -n "$smoke_token" && "$skip_db_prepare" != true ]] || printf 'Owner smoke NOT verified and REQUIRED now: /api/health is SQL-free, so SQL and the account registry of this revision are unproven.\nSign in, open %s/api/me and allow 120 s (SQL retries for up to 90 s; on 503 database_unavailable reload once after 5 s). Anything but 200: close ingress.\n' "$origin"
  rm -rf -- "$temp_dir"
  trap - EXIT
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  deployment_main "$@"
fi