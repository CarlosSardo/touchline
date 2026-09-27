import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs, parseEnv, promisify } from "node:util";
import { isMain } from "./data-export.ts";

const execute = promisify(execFile);

async function azure<Result>(args: string[]): Promise<Result> {
  const environment = { ...process.env };
  for (const key of ["GHCR_TOKEN", "GHCR_PULL_TOKEN", "AUTH_CLIENT_SECRET", "AUTH_SMOKE_TOKEN", "SMTP_PASSWORD", "INVITE_SIGNING_SECRET"])
    delete environment[key];
  try {
    const { stdout } = await execute("az", [...args, "--only-show-errors", "--output", "json"], {
      env: environment,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout.trim() ? JSON.parse(stdout) as Result : undefined as Result;
  } catch {
    throw new Error(`Azure ${args.slice(0, 3).join(" ")} failed. Check your Azure login and application-registration permissions. Response details suppressed to protect credentials.`);
  }
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    yes: { type: "boolean" }, help: { type: "boolean" }, "allow-personal-accounts": { type: "boolean" },
  } });
  if (values.help) {
    console.log("Usage: tsx scripts/azure-auth.ts --yes [--allow-personal-accounts]\n" +
      "Creates or updates the Touchline sign-in application and callback for the provisioned Container Apps environment.\n" +
      "--allow-personal-accounts (required by the invite flow) makes the app accept personal Microsoft accounts\n" +
      "(Outlook.com, Hotmail, Live) as well as work accounts: signInAudience AzureADandPersonalMicrosoftAccount, v2 tokens.\n" +
      "Without it the app must stay single-tenant. Also creates INVITE_SIGNING_SECRET when missing.\n" +
      "Stores credentials only in the ignored .env with mode 0600 (created from .env.example if missing); never prints them.\n" +
      "Existing configured credentials are preserved. No SQL or career data is changed.");
    return;
  }
  if (!values.yes) throw new Error("Application registration requires --yes.");
  const personal = values["allow-personal-accounts"] === true;
  const audience = personal ? "AzureADandPersonalMicrosoftAccount" : "AzureADMyOrg";
  try {
    await writeFile(".env", await readFile(".env.example", "utf8"), { mode: 0o600, flag: "wx" });
    console.log("[Entra] Created .env from .env.example (mode 0600).");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  const local = parseEnv(await readFile(".env", "utf8"));
  const settings = { ...local, ...process.env };
  const subscription = settings.AZURE_SUBSCRIPTION_ID;
  const tenant = settings.AZURE_TENANT_ID;
  const group = settings.AZURE_RESOURCE_GROUP;
  const app = settings.AZURE_APP ?? "touchline";
  const environmentName = settings.AZURE_ENVIRONMENT ?? "touchline-env";
  if (!subscription || !tenant || !group || !/^[a-z][a-z0-9-]{1,30}$/.test(app))
    throw new Error("Configure the Azure subscription, tenant, resource group and app in .env first.");
  const account = await azure<{ tenantId: string }>(["account", "show", "--subscription", subscription]);
  if (account.tenantId !== tenant) throw new Error("Azure tenant mismatch.");
  const environment = await azure<{ properties: { defaultDomain: string } }>([
    "containerapp", "env", "show", "--name", environmentName, "--resource-group", group, "--subscription", subscription,
  ]);
  const domain = environment.properties.defaultDomain;
  if (!/^[a-z0-9.-]+\.azurecontainerapps\.io$/.test(domain))
    throw new Error("Unexpected Container Apps environment domain.");
  const callback = `https://${app}.${domain}/.auth/login/aad/callback`;
  console.log(`[Entra] Configuring ${personal ? "work and personal Microsoft account" : "single-tenant"} sign-in; callback ${callback}`);
  await mkdir(".azure", { recursive: true, mode: 0o700 });
  let recorded: { appId: string; id: string } | undefined;
  try {
    recorded = JSON.parse(await readFile(".azure/auth-app.json", "utf8"));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  let clientId = settings.AUTH_CLIENT_ID || recorded?.appId;
  if (clientId && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(clientId))
    throw new Error("Invalid existing application ID.");
  if (!clientId) {
    const created = await azure<{ appId: string; id: string }>([
      "ad", "app", "create", "--display-name", "Touchline hobby", "--sign-in-audience", audience,
      "--web-redirect-uris", callback, "--enable-id-token-issuance", "true",
    ]);
    clientId = created.appId;
    recorded = { appId: created.appId, id: created.id };
    await writeFile(".azure/auth-app.json", JSON.stringify(recorded), { mode: 0o600, flag: "wx" });
  }
  let registration = await azure<{ signInAudience: string; web: { redirectUris?: string[] } }>(["ad", "app", "show", "--id", clientId]);
  if (personal && registration.signInAudience === "AzureADMyOrg") {
    // Entra only accepts personal accounts on apps issuing v2 access tokens.
    await azure(["ad", "app", "update", "--id", clientId, "--set", "api.requestedAccessTokenVersion=2"]);
    await azure(["ad", "app", "update", "--id", clientId, "--sign-in-audience", audience]);
    registration = await azure(["ad", "app", "show", "--id", clientId]);
  }
  if (registration.signInAudience !== audience)
    throw new Error(personal
      ? "Existing application could not be switched to work and personal Microsoft accounts. No credentials changed."
      : "Existing application must be single-tenant; pass --allow-personal-accounts for the invite flow. No credentials changed.");
  const redirects = [...new Set([...(registration.web?.redirectUris ?? []), callback])];
  await azure(["ad", "app", "update", "--id", clientId, "--web-redirect-uris", ...redirects, "--enable-id-token-issuance", "true"]);
  const principals = await azure<{ id: string }[]>(["ad", "sp", "list", "--filter", `appId eq '${clientId}'`]);
  if (!principals.length) await azure(["ad", "sp", "create", "--id", clientId]);
  let secret = settings.AUTH_CLIENT_SECRET;
  if (!secret) {
    const credential = await azure<{ password: string }>([
      "ad", "app", "credential", "reset", "--id", clientId, "--append", "--display-name", "Touchline local deployment", "--years", "1",
    ]);
    secret = credential.password;
    if (!secret) throw new Error("Azure did not return a client credential.");
  }
  const latest = await readFile(".env", "utf8");
  const inviteSecret = settings.INVITE_SIGNING_SECRET && settings.INVITE_SIGNING_SECRET.length >= 32
    ? settings.INVITE_SIGNING_SECRET : randomBytes(48).toString("base64url");
  const updates: Record<string, string> = { AUTH_CLIENT_ID: clientId, AUTH_CLIENT_SECRET: secret, INVITE_SIGNING_SECRET: inviteSecret };
  const seen = new Set<string>();
  const lines = latest.split(/\r?\n/).map((line) => {
    const match = /^(?:export\s+)?(AUTH_CLIENT_ID|AUTH_CLIENT_SECRET|INVITE_SIGNING_SECRET)=/.exec(line);
    if (!match) return line;
    const key = match[1];
    if (seen.has(key)) throw new Error(`Duplicate ${key} entries in .env; refusing to rewrite it.`);
    seen.add(key);
    return `${key}='${updates[key].replaceAll("'", "'\\''")}'`;
  });
  for (const [key, value] of Object.entries(updates))
    if (!seen.has(key)) lines.push(`${key}='${value.replaceAll("'", "'\\''")}'`);
  await chmod(".env", 0o600);
  await writeFile(".env", lines.join("\n"), { mode: 0o600 });
  console.log(`[Entra] Sign-in application (${audience}), service principal and callback configured. Credentials and the invite signing secret stored privately in .env; no secret values printed.`);
}

if (isMain(import.meta.url))
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Entra setup failed.");
    process.exitCode = 1;
  });