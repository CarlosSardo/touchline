import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import express, { type NextFunction, type Request, type Response } from "express";
import * as oidc from "openid-client";
import { z } from "zod";
import { renderSignedOutPage, renderSignInErrorPage } from "./admin-pages.ts";

export const OIDC_SCOPE = "openid profile email groups";
export const DEFAULT_ADMIN_GROUP = "admins";
export const LOGIN_PATH = "/auth/login";
export const CALLBACK_PATH = "/auth/callback";
export const LOGOUT_PATH = "/auth/logout";
export const SIGNED_OUT_PATH = "/auth/signed-out";

const transactionLifetimeSeconds = 10 * 60;
const maxCookieLength = 4096;
const clockSkewSeconds = 60;
const maxSubjectLength = 255;
const maxUsernameLength = 200;
const maxDisplayNameLength = 200;
const maxGroups = 16;
const maxGroupLength = 64;
const emailSchema = z.string().trim().toLowerCase().max(320).email();

/** The signed-in person, as passed to account resolution and the admin pages. */
export interface AuthenticatedIdentity {
  /** The configured OIDC_ISSUER, exactly. */
  issuer: string;
  /** OIDC `sub` (Authelia: an opaque per-user UUID). */
  subject: string;
  /** `preferred_username`, falling back to `sub`. */
  username: string;
  /** `name`, falling back to the username (trimmed, at most 200 characters). */
  displayName: string;
  /** Lowercased, at most 320 characters. */
  email: string | null;
  groups: string[];
  /** Member of the configured ADMIN_GROUP. */
  admin: boolean;
}

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
  clientSecret: string;
  /** Provider sign-out page used when the discovery metadata has no end_session_endpoint (Authelia: {issuer}/logout). */
  logoutUrl: string | undefined;
  adminGroup: string;
  sessionSecret: string;
  sessionTtlSeconds: number;
  appOrigin: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  secureCookies: boolean;
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

/** ADMIN_GROUP: the identity provider group whose members may approve access at /admin. */
export function readAdminGroup(value: string | undefined): string {
  const group = value?.trim() || DEFAULT_ADMIN_GROUP;
  if (group.length > maxGroupLength || /[\s\p{Cc}]/u.test(group))
    throw new Error(`ADMIN_GROUP must be a group name without whitespace, up to ${maxGroupLength} characters.`);
  return group;
}

function httpsUrl(text: string, name: string, description: string): URL {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${name} must be ${description}.`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new Error(`${name} must be ${description} (HTTPS, without credentials or fragment).`);
  return url;
}

/** Reads the OpenID Connect and session settings; only called when REQUIRE_AUTH=true. */
export function readAuthConfiguration(environment: NodeJS.ProcessEnv, context: { appOrigin: string }): AuthConfiguration {
  const issuer = environment.OIDC_ISSUER?.trim() ?? "";
  if (!issuer || issuer.length > 255)
    throw new Error("REQUIRE_AUTH=true requires OIDC_ISSUER (the OpenID Connect provider's issuer URL, for example https://auth.example.com).");
  if (httpsUrl(issuer, "OIDC_ISSUER", "the provider's HTTPS issuer URL").search)
    throw new Error("OIDC_ISSUER must be the provider's HTTPS issuer URL without a query.");
  const clientId = environment.OIDC_CLIENT_ID?.trim() ?? "";
  if (!clientId || clientId.length > 255 || /\s/.test(clientId))
    throw new Error("REQUIRE_AUTH=true requires OIDC_CLIENT_ID (the client ID registered with the OpenID Connect provider).");
  const clientSecret = environment.OIDC_CLIENT_SECRET ?? "";
  if (!clientSecret)
    throw new Error("REQUIRE_AUTH=true requires OIDC_CLIENT_SECRET (the client secret, sent with client_secret_basic).");
  const logoutText = environment.OIDC_LOGOUT_URL?.trim();
  const logoutUrl = logoutText ? httpsUrl(logoutText, "OIDC_LOGOUT_URL", "the provider's HTTPS sign-out URL").href : undefined;
  const sessionSecret = environment.SESSION_SECRET ?? "";
  if (sessionSecret.length < 32)
    throw new Error("REQUIRE_AUTH=true requires SESSION_SECRET with at least 32 characters (for example `openssl rand -base64 48`).");
  if (sessionSecret === clientSecret)
    throw new Error("SESSION_SECRET must differ from OIDC_CLIENT_SECRET.");
  const ttlHours = Number(environment.SESSION_TTL_HOURS ?? 8);
  if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > 720)
    throw new Error("SESSION_TTL_HOURS must be an integer between 1 and 720.");
  return {
    issuer,
    clientId,
    clientSecret,
    logoutUrl,
    adminGroup: readAdminGroup(environment.ADMIN_GROUP),
    sessionSecret,
    sessionTtlSeconds: ttlHours * 60 * 60,
    appOrigin: context.appOrigin,
    redirectUri: `${context.appOrigin}${CALLBACK_PATH}`,
    postLogoutRedirectUri: `${context.appOrigin}${SIGNED_OUT_PATH}`,
    secureCookies: context.appOrigin.startsWith("https:"),
  };
}

const stringClaim = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const emailClaim = (value: unknown) => {
  const parsed = emailSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

/** Keeps string groups that fit the session cookie; the admin group is never dropped. */
function groupsClaim(value: unknown, adminGroup: string): string[] {
  if (!Array.isArray(value)) return [];
  const groups = [...new Set(value.filter((group): group is string =>
    typeof group === "string" && group.length > 0 && group.length <= maxGroupLength && !/\p{Cc}/u.test(group)))];
  if (groups.length <= maxGroups) return groups;
  const kept = groups.filter((group) => group !== adminGroup).slice(0, groups.includes(adminGroup) ? maxGroups - 1 : maxGroups);
  return groups.includes(adminGroup) ? [adminGroup, ...kept] : kept;
}

/**
 * Maps validated ID token + UserInfo claims (sub, preferred_username, name, email, groups) to the identity.
 * `issuer` is the configured OIDC_ISSUER: openid-client already checked the token's `iss` against the discovered issuer.
 */
export function identityFromClaims(
  claims: Record<string, unknown>,
  context: Pick<AuthConfiguration, "issuer" | "adminGroup">,
): AuthenticatedIdentity {
  const subject = typeof claims.sub === "string" ? claims.sub : "";
  if (!subject || subject.length > maxSubjectLength || subject.trim() !== subject || /\p{Cc}/u.test(subject))
    throw new AuthenticationRequiredError();
  const username = (stringClaim(claims.preferred_username) ?? subject).slice(0, maxUsernameLength).trim() || subject;
  const displayName = (stringClaim(claims.name) ?? username).slice(0, maxDisplayNameLength).trim() || username;
  const groups = groupsClaim(claims.groups, context.adminGroup);
  return {
    issuer: context.issuer,
    subject,
    username,
    displayName,
    email: claims.email_verified === false ? null : emailClaim(claims.email),
    groups,
    admin: groups.includes(context.adminGroup),
  };
}

/** The relying-party operations Touchline needs from an OpenID Connect provider. */
export interface OidcProvider {
  authorizationUrl(input: { state: string; nonce: string; codeChallenge: string; prompt?: string }): Promise<URL>;
  /**
   * Validates the authorization response (state, PKCE, ID token signature, issuer, audience, nonce), fetches UserInfo
   * (its `sub` must equal the ID token's) and returns the ID token claims overlaid with the UserInfo claims.
   */
  callback(currentUrl: URL, checks: { state: string; nonce: string; codeVerifier: string }): Promise<Record<string, unknown>>;
  /** The provider's RP-initiated logout URL when its metadata advertises a same-origin end_session_endpoint. */
  endSessionUrl(): Promise<URL | null>;
}

export interface OpenIdProviderOptions {
  /** Test seam: a fetch implementation for discovery, JWKS, token and UserInfo requests. */
  fetch?: oidc.CustomFetch;
}

const userInfoClaims = ["preferred_username", "name", "email", "email_verified", "groups"] as const;

export function createOpenIdProvider(auth: AuthConfiguration, options: OpenIdProviderOptions = {}): OidcProvider {
  let discovered: Promise<oidc.Configuration> | undefined;
  const configuration = () => {
    discovered ??= oidc.discovery(
      new URL(auth.issuer),
      auth.clientId,
      undefined,
      oidc.ClientSecretBasic(auth.clientSecret),
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
      const config = await configuration();
      const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
        pkceCodeVerifier: checks.codeVerifier,
        expectedState: checks.state,
        expectedNonce: checks.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims) throw new AuthenticationRequiredError();
      if (!config.serverMetadata().userinfo_endpoint) return { ...claims };
      // Authelia may release profile, email and groups only through UserInfo; fetchUserInfo enforces sub equality.
      const userInfo: Record<string, unknown> = await oidc.fetchUserInfo(config, tokens.access_token, claims.sub);
      const merged: Record<string, unknown> = { ...claims };
      for (const name of userInfoClaims) if (userInfo[name] !== undefined) merged[name] = userInfo[name];
      return merged;
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
  v: z.literal(2),
  iss: z.string().min(1),
  sub: z.string().min(1).max(maxSubjectLength),
  usr: z.string().min(1).max(maxUsernameLength),
  name: z.string().min(1).max(maxDisplayNameLength),
  email: z.string().max(320).nullable(),
  groups: z.array(z.string().min(1).max(maxGroupLength)).max(maxGroups),
  adm: z.boolean(),
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
    v: 2,
    iss: identity.issuer,
    sub: identity.subject,
    usr: identity.username,
    name: identity.displayName,
    email: identity.email,
    groups: identity.groups,
    adm: identity.admin,
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
  /** Identity provider origins the sign-out form POST may be redirected to (CSP form-action). */
  formActionOrigins: string[];
  /** The signed-in identity (signature, expiry and issuer checked), or null. */
  session(request: Request): AuthenticatedIdentity | null;
  /** Throws AuthenticationRequiredError without a valid session. Access approval is decided by Accounts.resolve. */
  authenticate(request: Request): AuthenticatedIdentity;
  /** Redirects anonymous browser requests to sign-in. */
  requireBrowserSession(request: Request, response: Response, next: NextFunction): void;
}

export function createAuthenticator(options: {
  auth: AuthConfiguration;
  provider?: OidcProvider;
  now?: () => Date;
}): Authenticator {
  const { auth } = options;
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
    const payload = parsed.data;
    if (payload.exp <= time || payload.iat > time + clockSkewSeconds || payload.iss !== auth.issuer) return null;
    return {
      issuer: payload.iss,
      subject: payload.sub,
      username: payload.usr,
      displayName: payload.name,
      email: payload.email,
      groups: payload.groups,
      admin: payload.adm,
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
      const prompt = request.query.prompt === "login" ? "login" : undefined;
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
      const identity = identityFromClaims(claims, auth);
      let value = signSession(identity, auth, now());
      // Only the admin group matters to Touchline; drop the others if non-ASCII names overflow the cookie.
      if (value.length > maxCookieLength)
        value = signSession({ ...identity, groups: identity.admin ? [auth.adminGroup] : [] }, auth, now());
      if (value.length > maxCookieLength) throw new Error("The session cookie would exceed the browser limit.");
      response.cookie(sessionCookie, value, {
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
    return response.redirect(303, target?.href ?? auth.logoutUrl ?? SIGNED_OUT_PATH);
  });

  router.get(SIGNED_OUT_PATH, (_request, response) =>
    noStore(response).status(200).type("text/html; charset=utf-8")
      .send(renderSignedOutPage({ signInUrl: `${LOGIN_PATH}?prompt=login` })));

  return {
    router,
    formActionOrigins: [...new Set([auth.issuer, ...(auth.logoutUrl ? [auth.logoutUrl] : [])].map((url) => new URL(url).origin))],
    session,
    authenticate(request) {
      const identity = session(request);
      if (!identity) throw new AuthenticationRequiredError();
      return identity;
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
  if (error instanceof oidc.ResponseBodyError) return `provider error ${error.error} (HTTP ${error.status})`;
  if (error instanceof oidc.ClientError) {
    const cause = error.cause instanceof Error ? ` (${error.cause.message})` : "";
    return `${error.code ?? "client error"}: ${error.message}${cause}`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return "unknown error";
}
