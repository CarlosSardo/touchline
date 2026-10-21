import { createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import express, { type NextFunction, type Request, type Response } from "express";
import * as oidc from "openid-client";
import { z } from "zod";
import type { AuthenticatedIdentity } from "./accounts.ts";
import { renderSignedOutPage, renderSignInErrorPage } from "./invite-pages.ts";
import { CONSUMER_TENANT_ID } from "./invite-store.ts";

/** Microsoft identity platform issuer for personal Microsoft accounts (the "consumers" tenant). */
export const DEFAULT_OIDC_ISSUER = `https://login.microsoftonline.com/${CONSUMER_TENANT_ID}/v2.0`;
/** UUIDv5 namespace for identities from non-Microsoft OpenID Connect providers (see identityFromClaims). */
export const OIDC_IDENTITY_NAMESPACE = "047c7acb-0a8d-4d9b-a891-85e48a9804b9";
export const OIDC_SCOPE = "openid profile email";
export const LOGIN_PATH = "/auth/login";
export const CALLBACK_PATH = "/auth/callback";
export const LOGOUT_PATH = "/auth/logout";
export const SIGNED_OUT_PATH = "/auth/signed-out";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const microsoftIssuer = /^https:\/\/login\.microsoftonline\.com\/([0-9a-f-]{36})\/v2\.0$/;
const transactionLifetimeSeconds = 10 * 60;
const maxCookieLength = 4096;
const clockSkewSeconds = 60;
const emailSchema = z.string().trim().toLowerCase().max(320).email();

export class AuthenticationRequiredError extends Error {
  readonly status = 401;
  readonly code = "authentication_required";

  constructor() {
    super("Authentication required.");
    this.name = "AuthenticationRequiredError";
  }
}

export class NotAuthorizedError extends Error {
  readonly status = 403;
  readonly code = "not_authorized";

  constructor() {
    super("This account is not authorized.");
    this.name = "NotAuthorizedError";
  }
}

export interface AuthConfiguration {
  issuer: string;
  clientId: string;
  clientSecret: string | undefined;
  sessionSecret: string;
  sessionTtlSeconds: number;
  appOrigin: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  secureCookies: boolean;
}

/** The parts of the API configuration that decide which signed-in identities may use the API. */
export interface AuthorizationPolicy {
  homeTenantId: string;
  ownerObjectId: string;
  allowedUserObjectIds: ReadonlySet<string>;
}

export type TrustProxySetting = false | number | string;

/** Parses TRUST_PROXY for `app.set("trust proxy", …)`. `true` (trust every hop) is refused: clients could forge X-Forwarded-For. */
export function readTrustProxy(value: string | undefined, hosted: boolean): TrustProxySetting {
  const text = value?.trim() ?? "";
  if (!text) return hosted ? "loopback" : false;
  if (text === "false") return false;
  if (text === "true")
    throw new Error(
      "TRUST_PROXY=true would trust client-supplied X-Forwarded-For headers; use a hop count (for example 1) or the reverse proxy addresses (loopback, uniquelocal or IP/CIDR list).",
    );
  if (/^\d+$/.test(text)) {
    const hops = Number(text);
    if (hops > 10) throw new Error("TRUST_PROXY hop count must be between 0 and 10.");
    return hops;
  }
  const entries = text.split(",").map((entry) => entry.trim());
  for (const entry of entries) {
    if (["loopback", "linklocal", "uniquelocal"].includes(entry)) continue;
    const [address, prefix, extra] = entry.split("/");
    const family = isIP(address ?? "");
    const prefixValid = prefix === undefined ||
      (/^\d+$/.test(prefix) && Number(prefix) <= (family === 6 ? 128 : 32));
    if (!family || extra !== undefined || !prefixValid)
      throw new Error(
        "TRUST_PROXY must be false, a hop count, or a comma-separated list of loopback, linklocal, uniquelocal and IP addresses/CIDR ranges.",
      );
  }
  return entries.join(",");
}

/** Reads the OpenID Connect and session settings; only called when REQUIRE_AUTH=true. */
export function readAuthConfiguration(
  environment: NodeJS.ProcessEnv,
  context: { appOrigin: string; inviteSigningSecret: string },
): AuthConfiguration {
  for (const [legacy, current] of [
    ["AUTH_CLIENT_ID", "OIDC_CLIENT_ID"],
    ["AUTH_CLIENT_SECRET", "OIDC_CLIENT_SECRET"],
  ] as const)
    if (environment[legacy] && !environment[current])
      throw new Error(`${legacy} was renamed to ${current}.`);
  const issuerText = environment.OIDC_ISSUER?.trim() || DEFAULT_OIDC_ISSUER;
  let issuer: URL;
  try {
    issuer = new URL(issuerText);
  } catch {
    throw new Error("OIDC_ISSUER must be the provider's HTTPS issuer URL.");
  }
  if (issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.search || issuer.hash)
    throw new Error("OIDC_ISSUER must be the provider's HTTPS issuer URL without credentials, query or fragment.");
  const clientId = environment.OIDC_CLIENT_ID?.trim() ?? "";
  if (!clientId || clientId.length > 255 || /\s/.test(clientId))
    throw new Error("REQUIRE_AUTH=true requires OIDC_CLIENT_ID (the application/client ID registered with the OpenID Connect provider).");
  const clientSecret = environment.OIDC_CLIENT_SECRET || undefined;
  const sessionSecret = environment.SESSION_SECRET ?? "";
  if (sessionSecret.length < 32)
    throw new Error("REQUIRE_AUTH=true requires SESSION_SECRET with at least 32 characters (for example `openssl rand -base64 48`).");
  if (sessionSecret === context.inviteSigningSecret)
    throw new Error("SESSION_SECRET must differ from INVITE_SIGNING_SECRET.");
  const ttlHours = Number(environment.SESSION_TTL_HOURS ?? 8);
  if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > 720)
    throw new Error("SESSION_TTL_HOURS must be an integer between 1 and 720.");
  return {
    issuer: issuerText,
    clientId,
    clientSecret,
    sessionSecret,
    sessionTtlSeconds: ttlHours * 60 * 60,
    appOrigin: context.appOrigin,
    redirectUri: `${context.appOrigin}${CALLBACK_PATH}`,
    postLogoutRedirectUri: `${context.appOrigin}${SIGNED_OUT_PATH}`,
    secureCookies: context.appOrigin.startsWith("https:"),
  };
}

/** Throws NotAuthorizedError unless the identity is a personal Microsoft account or an allow-listed home-tenant account. */
export function authorizeIdentity(identity: AuthenticatedIdentity, policy: AuthorizationPolicy): AuthenticatedIdentity {
  const homeTenant = !!policy.homeTenantId && identity.tenantId === policy.homeTenantId;
  const consumersTenant = identity.tenantId === CONSUMER_TENANT_ID;
  if (
    (!homeTenant && !consumersTenant) ||
    (homeTenant && identity.objectId !== policy.ownerObjectId && !policy.allowedUserObjectIds.has(identity.objectId))
  )
    throw new NotAuthorizedError();
  return identity;
}

/** RFC 9562 name-based UUID (version 5, SHA-1). */
export function uuidV5(name: string, namespace: string): string {
  if (!uuidPattern.test(namespace)) throw new Error("Invalid UUID namespace.");
  const hash = createHash("sha1")
    .update(Buffer.from(namespace.replaceAll("-", ""), "hex"))
    .update(name, "utf8")
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Derived account keys for a non-Microsoft provider: tenant = UUIDv5(issuer), object = UUIDv5(sub) inside that tenant. */
export function derivedIdentityKeys(issuer: string, subject: string) {
  const tenantId = uuidV5(`oidc-issuer:${issuer}`, OIDC_IDENTITY_NAMESPACE);
  return { tenantId, objectId: uuidV5(subject, tenantId) };
}

const stringClaim = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const emailClaim = (value: unknown) => {
  const parsed = emailSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

/**
 * Maps validated ID token claims to the account key.
 * Microsoft identity platform tokens (iss = https://login.microsoftonline.com/{tid}/v2.0) keep their (tid, oid) pair,
 * so accounts created behind Azure Easy Auth resolve to the same users. Any other provider gets a stable UUIDv5 pair
 * derived from (iss, sub), and only an `email` with `email_verified: true` is trusted.
 */
export function identityFromClaims(claims: Record<string, unknown>): AuthenticatedIdentity {
  const issuer = stringClaim(claims.iss);
  const subject = stringClaim(claims.sub);
  if (!issuer || !subject) throw new AuthenticationRequiredError();
  const displayName = (stringClaim(claims.name) ?? "Sporting director").slice(0, 200).trim() || "Sporting director";
  const microsoft = microsoftIssuer.exec(issuer);
  if (microsoft) {
    const tenantId = stringClaim(claims.tid)?.toLowerCase();
    const objectId = stringClaim(claims.oid)?.toLowerCase();
    if (!tenantId || !objectId || !uuidPattern.test(tenantId) || !uuidPattern.test(objectId) ||
        microsoft[1].toLowerCase() !== tenantId)
      throw new NotAuthorizedError();
    return {
      tenantId,
      objectId,
      displayName,
      email: emailClaim(claims.email) ?? emailClaim(claims.preferred_username),
    };
  }
  return {
    ...derivedIdentityKeys(issuer, subject),
    displayName,
    email: claims.email_verified === true ? emailClaim(claims.email) : null,
  };
}

/** The relying-party operations Touchline needs from an OpenID Connect provider. */
export interface OidcProvider {
  authorizationUrl(input: { state: string; nonce: string; codeChallenge: string; prompt?: string }): Promise<URL>;
  /** Validates the authorization response (state, PKCE, ID token signature, issuer, audience, nonce) and returns ID token claims. */
  callback(currentUrl: URL, checks: { state: string; nonce: string; codeVerifier: string }): Promise<Record<string, unknown>>;
  endSessionUrl(): Promise<URL | null>;
}

export interface OpenIdProviderOptions {
  /** Test seam: a fetch implementation for discovery, JWKS and token requests. */
  fetch?: oidc.CustomFetch;
}

export function createOpenIdProvider(auth: AuthConfiguration, options: OpenIdProviderOptions = {}): OidcProvider {
  let discovered: Promise<oidc.Configuration> | undefined;
  const configuration = () => {
    discovered ??= oidc.discovery(
      new URL(auth.issuer),
      auth.clientId,
      auth.clientSecret,
      undefined,
      {
        ...(options.fetch ? { [oidc.customFetch]: options.fetch } : {}),
        timeout: 15,
        // The token endpoint is trusted over TLS, but the ID token signature is verified against the JWKS as well.
        execute: [oidc.enableNonRepudiationChecks],
      },
    ).catch((error: unknown) => {
      discovered = undefined;
      throw error;
    });
    return discovered;
  };
  return {
    async authorizationUrl(input) {
      return oidc.buildAuthorizationUrl(await configuration(), {
        redirect_uri: auth.redirectUri,
        response_type: "code",
        response_mode: "query",
        scope: OIDC_SCOPE,
        state: input.state,
        nonce: input.nonce,
        code_challenge: input.codeChallenge,
        code_challenge_method: "S256",
        ...(input.prompt ? { prompt: input.prompt } : {}),
      });
    },
    async callback(currentUrl, checks) {
      const tokens = await oidc.authorizationCodeGrant(await configuration(), currentUrl, {
        pkceCodeVerifier: checks.codeVerifier,
        expectedState: checks.state,
        expectedNonce: checks.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims) throw new AuthenticationRequiredError();
      return { ...claims };
    },
    async endSessionUrl() {
      const config = await configuration();
      const endpoint = config.serverMetadata().end_session_endpoint;
      if (!endpoint || new URL(endpoint).origin !== new URL(auth.issuer).origin) return null;
      return oidc.buildEndSessionUrl(config, {
        client_id: auth.clientId,
        post_logout_redirect_uri: auth.postLogoutRedirectUri,
      });
    },
  };
}

const sessionPayloadSchema = z.object({
  v: z.literal(1),
  tid: z.string().regex(uuidPattern),
  oid: z.string().regex(uuidPattern),
  name: z.string().min(1).max(200),
  email: z.string().max(320).nullable(),
  iat: z.number().int(),
  exp: z.number().int(),
}).strict();
const transactionPayloadSchema = z.object({
  v: z.literal(1),
  state: z.string().min(16).max(256),
  nonce: z.string().min(16).max(256),
  verifier: z.string().min(43).max(128),
  returnTo: z.string().max(2048),
  exp: z.number().int(),
}).strict();

type SessionPayload = z.infer<typeof sessionPayloadSchema>;
type TransactionPayload = z.infer<typeof transactionPayloadSchema>;

/** HMAC-SHA256 signed, expiring cookie values. Keys are derived per purpose so a session can never pass as a sign-in transaction. */
export class CookieSigner {
  private readonly key: Buffer;

  constructor(secret: string, private readonly purpose: "session" | "transaction") {
    this.key = Buffer.from(hkdfSync("sha256", secret, "touchline-auth", `touchline ${purpose} cookie v1`, 32));
  }

  sign(payload: object): string {
    const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${body}.${this.mac(body).toString("base64url")}`;
  }

  /** Returns the decoded JSON payload when the signature matches, otherwise null. Does not check expiry. */
  verify(value: string | undefined): unknown {
    if (!value || value.length > maxCookieLength) return null;
    const [body, signature, extra] = value.split(".");
    if (!body || !signature || extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(signature))
      return null;
    const actual = Buffer.from(signature, "base64url");
    const expected = this.mac(body);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    try {
      return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch {
      return null;
    }
  }

  private mac(body: string) {
    return createHmac("sha256", this.key).update(`${this.purpose}.${body}`).digest();
  }
}

export function sessionCookieName(secure: boolean) {
  return secure ? "__Host-touchline_session" : "touchline_session";
}

export function transactionCookieName(secure: boolean) {
  return secure ? "__Host-touchline_signin" : "touchline_signin";
}

/** Signs a session cookie value for an identity (also used by tests to sign in without a provider). */
export function signSession(
  identity: AuthenticatedIdentity,
  auth: Pick<AuthConfiguration, "sessionSecret" | "sessionTtlSeconds">,
  now = new Date(),
): string {
  const iat = Math.floor(now.getTime() / 1000);
  const payload: SessionPayload = {
    v: 1,
    tid: identity.tenantId,
    oid: identity.objectId,
    name: identity.displayName,
    email: identity.email,
    iat,
    exp: iat + auth.sessionTtlSeconds,
  };
  return new CookieSigner(auth.sessionSecret, "session").sign(payload);
}

/** Reads one cookie from the Cookie header; the first occurrence wins (the __Host- prefix prevents injected duplicates). */
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

/** Accepts only same-origin absolute paths (no scheme, host, backslashes or control characters); anything else becomes "/". */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.length > 2048 ||
      [...value].some((character) => character === "\\" || character.charCodeAt(0) < 0x20 || character === "\u007f"))
    return "/";
  try {
    const base = "https://touchline.invalid";
    const url = new URL(value, base);
    if (url.origin !== base || url.pathname.startsWith("/auth/")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export function loginUrl(returnTo: string) {
  const target = safeReturnTo(returnTo);
  return target === "/" ? LOGIN_PATH : `${LOGIN_PATH}?returnTo=${encodeURIComponent(target)}`;
}

export interface Authenticator {
  router: express.Router;
  /** Origin of the identity provider, allowed as a CSP form-action target for the sign-out redirect. */
  providerOrigin: string;
  /** The signed-in identity (signature and expiry checked), or null. Does not apply the authorization policy. */
  session(request: Request): AuthenticatedIdentity | null;
  /** Throws AuthenticationRequiredError without a valid session and NotAuthorizedError outside the policy. */
  authenticate(request: Request): AuthenticatedIdentity;
  /** Redirects anonymous browser requests to sign-in (the old Easy Auth "RedirectToLoginPage" behaviour). */
  requireBrowserSession(request: Request, response: Response, next: NextFunction): void;
}

export function createAuthenticator(options: {
  auth: AuthConfiguration;
  policy: AuthorizationPolicy;
  provider?: OidcProvider;
  now?: () => Date;
}): Authenticator {
  const { auth, policy } = options;
  const provider = options.provider ?? createOpenIdProvider(auth);
  const now = options.now ?? (() => new Date());
  const seconds = () => Math.floor(now().getTime() / 1000);
  const sessions = new CookieSigner(auth.sessionSecret, "session");
  const transactions = new CookieSigner(auth.sessionSecret, "transaction");
  const sessionCookie = sessionCookieName(auth.secureCookies);
  const transactionCookie = transactionCookieName(auth.secureCookies);
  const cookieOptions = { httpOnly: true, secure: auth.secureCookies, sameSite: "lax", path: "/" } as const;
  const router = express.Router();

  const session = (request: Request): AuthenticatedIdentity | null => {
    const parsed = sessionPayloadSchema.safeParse(sessions.verify(readCookie(request, sessionCookie)));
    if (!parsed.success) return null;
    const time = seconds();
    if (parsed.data.exp <= time || parsed.data.iat > time + clockSkewSeconds) return null;
    return {
      tenantId: parsed.data.tid.toLowerCase(),
      objectId: parsed.data.oid.toLowerCase(),
      displayName: parsed.data.name,
      email: parsed.data.email,
    };
  };
  const readTransaction = (request: Request): TransactionPayload | null => {
    const parsed = transactionPayloadSchema.safeParse(transactions.verify(readCookie(request, transactionCookie)));
    return parsed.success && parsed.data.exp > seconds() ? parsed.data : null;
  };
  const noStore = (response: Response) => response.set("Cache-Control", "no-store");
  const errorPage = (response: Response, status: number, title: string, message: string) =>
    noStore(response).status(status).type("text/html; charset=utf-8")
      .send(renderSignInErrorPage({ title, message, retryUrl: LOGIN_PATH }));
  const sameOrigin = (request: Request) => {
    const origin = request.headers.origin;
    return origin ? origin === auth.appOrigin : request.headers["sec-fetch-site"] === "same-origin";
  };

  router.get(LOGIN_PATH, async (request, response, next) => {
    try {
      const returnTo = safeReturnTo(request.query.returnTo);
      const prompt = request.query.prompt === "select_account" ? "select_account" : undefined;
      noStore(response);
      if (!prompt && session(request)) return response.redirect(303, returnTo);
      const verifier = oidc.randomPKCECodeVerifier();
      const transaction: TransactionPayload = {
        v: 1,
        state: oidc.randomState(),
        nonce: oidc.randomNonce(),
        verifier,
        returnTo,
        exp: seconds() + transactionLifetimeSeconds,
      };
      const target = await provider.authorizationUrl({
        state: transaction.state,
        nonce: transaction.nonce,
        codeChallenge: await oidc.calculatePKCECodeChallenge(verifier),
        prompt,
      });
      response.cookie(transactionCookie, transactions.sign(transaction), {
        ...cookieOptions,
        maxAge: transactionLifetimeSeconds * 1000,
      });
      return response.redirect(302, target.href);
    } catch (error) {
      console.error(`Touchline: sign-in could not start (${describeAuthError(error)}).`);
      if (!response.headersSent)
        return errorPage(response, 502, "Sign-in is unavailable", "The sign-in provider could not be reached. Try again in a moment.");
      next(error);
    }
  });

  router.get(CALLBACK_PATH, async (request, response) => {
    noStore(response);
    const transaction = readTransaction(request);
    response.clearCookie(transactionCookie, cookieOptions);
    if (!transaction) {
      if (session(request)) return response.redirect(303, "/");
      return errorPage(response, 400, "Sign-in expired", "This sign-in attempt expired or was started in another tab. Start again.");
    }
    try {
      const search = new URL(request.originalUrl, auth.appOrigin).search;
      const claims = await provider.callback(new URL(`${auth.redirectUri}${search}`), {
        state: transaction.state,
        nonce: transaction.nonce,
        codeVerifier: transaction.verifier,
      });
      const identity = identityFromClaims(claims);
      response.cookie(sessionCookie, signSession(identity, auth, now()), {
        ...cookieOptions,
        maxAge: auth.sessionTtlSeconds * 1000,
      });
      return response.redirect(303, transaction.returnTo);
    } catch (error) {
      if (error instanceof oidc.AuthorizationResponseError)
        return errorPage(response, 400, "Sign-in cancelled", "Sign-in was cancelled or refused by the identity provider.");
      const providerUnavailable = error instanceof TypeError ||
        (error instanceof oidc.ClientError && /fetch|timeout|abort/i.test(error.message));
      console.error(`Touchline: sign-in callback failed (${describeAuthError(error)}).`);
      return providerUnavailable
        ? errorPage(response, 502, "Sign-in is unavailable", "The sign-in provider could not be reached. Try again in a moment.")
        : errorPage(response, 400, "Sign-in failed", "The sign-in response could not be verified. Start again.");
    }
  });

  router.post(LOGOUT_PATH, async (request, response) => {
    noStore(response);
    if (!sameOrigin(request))
      return response.status(403).json({ error: "A same-origin request is required." });
    response.clearCookie(sessionCookie, cookieOptions);
    response.clearCookie(transactionCookie, cookieOptions);
    let target: URL | null = null;
    try {
      target = await provider.endSessionUrl();
    } catch (error) {
      console.error(`Touchline: provider sign-out unavailable (${describeAuthError(error)}); signed out locally.`);
    }
    return response.redirect(303, target?.href ?? SIGNED_OUT_PATH);
  });

  router.get(SIGNED_OUT_PATH, (_request, response) =>
    noStore(response).status(200).type("text/html; charset=utf-8")
      .send(renderSignedOutPage({ signInUrl: `${LOGIN_PATH}?prompt=select_account` })));

  return {
    router,
    providerOrigin: new URL(auth.issuer).origin,
    session,
    authenticate(request) {
      const identity = session(request);
      if (!identity) throw new AuthenticationRequiredError();
      return authorizeIdentity(identity, policy);
    },
    requireBrowserSession(request, response, next) {
      if (session(request)) return next();
      noStore(response);
      if (request.method === "GET" || request.method === "HEAD")
        return response.redirect(302, loginUrl(request.originalUrl));
      response.status(401).json({ error: "Authentication required.", code: "authentication_required" });
    },
  };
}

function describeAuthError(error: unknown) {
  if (error instanceof oidc.AuthorizationResponseError) return `authorization error ${error.error}`;
  if (error instanceof oidc.ResponseBodyError) return `token endpoint error ${error.error} (HTTP ${error.status})`;
  if (error instanceof oidc.ClientError) {
    const cause = error.cause instanceof Error ? ` (${error.cause.message})` : "";
    return `${error.code ?? "client error"}: ${error.message}${cause}`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return "unknown error";
}
