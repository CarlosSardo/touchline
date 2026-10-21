import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CustomFetch } from "openid-client";
import type { AuthenticatedIdentity } from "./accounts.ts";
import { Store } from "./db.ts";
import { createApp, readApiConfiguration } from "./app.ts";
import {
  authorizeIdentity,
  AuthenticationRequiredError,
  CookieSigner,
  createAuthenticator,
  createOpenIdProvider,
  DEFAULT_OIDC_ISSUER,
  derivedIdentityKeys,
  identityFromClaims,
  loginUrl,
  NotAuthorizedError,
  readAuthConfiguration,
  readTrustProxy,
  safeReturnTo,
  sessionCookieName,
  signSession,
  transactionCookieName,
  uuidV5,
  type AuthConfiguration,
  type OidcProvider,
} from "./auth.ts";
import { CONSUMER_TENANT_ID } from "./invite-store.ts";

const appOrigin = "https://touchline.example.com";
const clientId = "touchline-client";
const clientSecret = "client-secret-value";
const sessionSecret = "session-secret-abcdefghijklmnopqrstuvwxyz";
const homeTenant = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const owner = "11111111-1111-1111-1111-111111111111";
const msaObject = "00000000-0000-0000-1234-56789abcdef0";
const sessionCookie = sessionCookieName(true);
const transactionCookie = transactionCookieName(true);

const authConfiguration = (overrides: Partial<AuthConfiguration> = {}): AuthConfiguration => ({
  ...readAuthConfiguration({ OIDC_CLIENT_ID: clientId, OIDC_CLIENT_SECRET: clientSecret, SESSION_SECRET: sessionSecret }, {
    appOrigin,
    inviteSigningSecret: "invite-secret-abcdefghijklmnopqrstuvwxyz",
  }),
  ...overrides,
});
const policy = { homeTenantId: homeTenant, ownerObjectId: owner, allowedUserObjectIds: new Set([owner]) };

/** A minimal OpenID Connect provider (discovery, JWKS, token endpoint) served through openid-client's customFetch. */
class MockIssuer {
  readonly keys: { privateKey: KeyObject; publicKey: KeyObject };
  readonly kid = "test-key";
  readonly tokenRequests: URLSearchParams[] = [];
  readonly grants = new Map<string, { challenge: string; redirectUri: string; claims: Record<string, unknown> }>();
  discoveryFailures = 0;
  endSession = true;
  signingKey?: KeyObject;

  /** `base` is the configured OIDC_ISSUER; Microsoft's multi-tenant metadata advertises a `{tenantid}` template instead. */
  constructor(readonly base: string, readonly options: { metadataIssuer?: string; tokenIssuer?: string } = {}) {
    this.keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  }

  get issuer() {
    return this.options.tokenIssuer ?? this.base;
  }

  /** What the provider does when the browser arrives at the authorization endpoint and the user signs in. */
  authorize(authorizationUrl: string, claims: Record<string, unknown> = {}) {
    const url = new URL(authorizationUrl);
    expect(url.origin + url.pathname).toBe(`${this.base}/authorize`);
    const params = url.searchParams;
    expect(params.get("client_id")).toBe(clientId);
    expect(params.get("response_type")).toBe("code");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("scope")).toBe("openid profile email");
    const code = randomUUID();
    this.grants.set(code, {
      challenge: params.get("code_challenge")!,
      redirectUri: params.get("redirect_uri")!,
      claims: { nonce: params.get("nonce"), ...claims },
    });
    return { code, state: params.get("state")!, redirectUri: params.get("redirect_uri")! };
  }

  idToken(claims: Record<string, unknown>) {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", kid: this.kid, typ: "JWT" };
    const payload = { iss: this.issuer, aud: clientId, iat: now, nbf: now, exp: now + 3600, sub: "pairwise-subject", ...claims };
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const input = `${encode(header)}.${encode(payload)}`;
    return `${input}.${sign("sha256", Buffer.from(input), this.signingKey ?? this.keys.privateKey).toString("base64url")}`;
  }

  readonly fetch: CustomFetch = async (url, options) => {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url === `${this.base}/.well-known/openid-configuration`) {
      if (this.discoveryFailures > 0) {
        this.discoveryFailures--;
        throw new TypeError("fetch failed");
      }
      return json({
        issuer: this.options.metadataIssuer ?? this.base,
        authorization_endpoint: `${this.base}/authorize`,
        token_endpoint: `${this.base}/token`,
        jwks_uri: `${this.base}/keys`,
        ...(this.endSession ? { end_session_endpoint: `${this.base}/logout` } : {}),
        response_types_supported: ["code"],
        subject_types_supported: ["pairwise"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url === `${this.base}/keys`)
      return json({ keys: [{ ...this.keys.publicKey.export({ format: "jwk" }), kid: this.kid, use: "sig", alg: "RS256" }] });
    if (url === `${this.base}/token` && options.method === "POST") {
      const body = new URLSearchParams(typeof options.body === "string" ? options.body : String(options.body));
      this.tokenRequests.push(body);
      const grant = this.grants.get(body.get("code") ?? "");
      const verifier = body.get("code_verifier") ?? "";
      if (
        !grant || body.get("grant_type") !== "authorization_code" || body.get("redirect_uri") !== grant.redirectUri ||
        createHash("sha256").update(verifier).digest("base64url") !== grant.challenge ||
        body.get("client_id") !== clientId || body.get("client_secret") !== clientSecret
      )
        return json({ error: "invalid_grant" }, 400);
      this.grants.delete(body.get("code")!);
      return json({ access_token: "opaque", token_type: "Bearer", expires_in: 3600, id_token: this.idToken(grant.claims) });
    }
    return json({ error: "not_found" }, 404);
  };
}

const cookies = (response: request.Response) => {
  const header = response.headers["set-cookie"] as unknown as string[] | undefined;
  return new Map((header ?? []).map((cookie) => {
    const [pair, ...attributes] = cookie.split(";").map((part) => part.trim());
    const separator = pair.indexOf("=");
    return [pair.slice(0, separator), { value: pair.slice(separator + 1), attributes }] as const;
  }));
};

function authApp(options: { issuer?: MockIssuer; provider?: OidcProvider; now?: () => Date; auth?: Partial<AuthConfiguration> } = {}) {
  const issuer = options.issuer ?? new MockIssuer(DEFAULT_OIDC_ISSUER);
  const auth = authConfiguration({ issuer: issuer.base, ...options.auth });
  const authenticator = createAuthenticator({
    auth,
    policy,
    provider: options.provider ?? createOpenIdProvider(auth, { fetch: issuer.fetch }),
    now: options.now,
  });
  const app = express();
  app.use(authenticator.router);
  app.get("/whoami", (request, response) => {
    try {
      response.json(authenticator.authenticate(request));
    } catch (error) {
      const failure = error as AuthenticationRequiredError | NotAuthorizedError;
      response.status(failure.status).json({ code: failure.code });
    }
  });
  app.use(authenticator.requireBrowserSession);
  app.all("/page", (_request, response) => response.send("game"));
  return { app, issuer, auth, authenticator };
}

async function signIn(
  app: express.Express,
  issuer: MockIssuer,
  claims: Record<string, unknown>,
  path = "/auth/login",
) {
  const login = await request(app).get(path);
  expect(login.status).toBe(302);
  const transaction = cookies(login).get(transactionCookie)!;
  const grant = issuer.authorize(login.headers.location, claims);
  const callback = await request(app)
    .get(`/auth/callback?code=${encodeURIComponent(grant.code)}&state=${encodeURIComponent(grant.state)}`)
    .set("Cookie", `${transactionCookie}=${transaction.value}`);
  return { login, transaction, grant, callback, session: cookies(callback).get(sessionCookie) };
}

const msaClaims = {
  tid: CONSUMER_TENANT_ID,
  oid: msaObject,
  name: "Player One",
  email: "Player.One@Outlook.com",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("OpenID Connect sign-in (Authorization Code + PKCE)", () => {
  it("signs in a personal Microsoft account with state, nonce and PKCE and issues a hardened session cookie", async () => {
    const { app, issuer } = authApp();
    const { login, transaction, grant, callback, session } = await signIn(app, issuer, msaClaims, "/auth/login?returnTo=%2Fsquad%3Fid%3D4%23squad");

    expect(login.headers["cache-control"]).toBe("no-store");
    expect(grant.redirectUri).toBe(`${appOrigin}/auth/callback`);
    const authorization = new URL(login.headers.location).searchParams;
    expect(authorization.get("state")).toMatch(/^[\w-]{40,}$/);
    expect(authorization.get("nonce")).toMatch(/^[\w-]{40,}$/);
    expect(authorization.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(authorization.get("prompt")).toBeNull();
    expect(transaction.attributes).toEqual(expect.arrayContaining(["Path=/", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=600"]));
    expect(transaction.value).not.toContain(authorization.get("code_challenge"));

    expect(callback.status).toBe(303);
    expect(callback.headers.location).toBe("/squad?id=4#squad");
    expect(session?.attributes).toEqual(expect.arrayContaining(["Path=/", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=28800"]));
    expect(cookies(callback).get(transactionCookie)?.attributes).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    const token = issuer.tokenRequests[0];
    expect(token.get("code_verifier")).toMatch(/^[\w-]{43,128}$/);
    expect(token.get("redirect_uri")).toBe(`${appOrigin}/auth/callback`);

    const whoami = await request(app).get("/whoami").set("Cookie", `${sessionCookie}=${session!.value}`);
    expect(whoami.status).toBe(200);
    expect(whoami.body).toEqual({
      tenantId: CONSUMER_TENANT_ID,
      objectId: msaObject,
      displayName: "Player One",
      email: "player.one@outlook.com",
    } satisfies AuthenticatedIdentity);
  });

  it("refuses a callback whose state does not match the browser's transaction", async () => {
    const { app, issuer } = authApp();
    const login = await request(app).get("/auth/login");
    const grant = issuer.authorize(login.headers.location, msaClaims);
    const callback = await request(app)
      .get(`/auth/callback?code=${grant.code}&state=attacker-state`)
      .set("Cookie", `${transactionCookie}=${cookies(login).get(transactionCookie)!.value}`);
    expect(callback.status).toBe(400);
    expect(callback.text).toContain("Sign-in failed");
    expect(cookies(callback).has(sessionCookie)).toBe(false);
    expect(issuer.tokenRequests).toEqual([]);
  });

  it("refuses callbacks without, with a tampered or with an expired transaction cookie", async () => {
    let now = new Date();
    const { app, issuer } = authApp({ now: () => now });
    const login = await request(app).get("/auth/login");
    const grant = issuer.authorize(login.headers.location, msaClaims);
    const transaction = cookies(login).get(transactionCookie)!.value;
    const callback = (cookie?: string) => {
      const pending = request(app).get(`/auth/callback?code=${grant.code}&state=${grant.state}`);
      return cookie ? pending.set("Cookie", `${transactionCookie}=${cookie}`) : pending;
    };
    expect((await callback()).status).toBe(400);
    const [body, signature] = transaction.split(".");
    const forged = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    forged.returnTo = "/admin/invites";
    expect((await callback(`${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${signature}`)).status).toBe(400);
    expect((await callback(signSession({ tenantId: CONSUMER_TENANT_ID, objectId: msaObject, displayName: "x", email: null }, {
      sessionSecret, sessionTtlSeconds: 600,
    }))).status).toBe(400);
    now = new Date(Date.now() + 11 * 60_000);
    const expired = await callback(transaction);
    expect(expired.status).toBe(400);
    expect(expired.text).toContain("Sign-in expired");
    expect(issuer.tokenRequests).toEqual([]);
  });

  it.each([
    ["a different nonce", { nonce: "replayed-nonce" }],
    ["another audience", { aud: "another-client" }],
    ["another issuer", { iss: "https://login.microsoftonline.com/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/v2.0" }],
    ["an expired ID token", { exp: Math.floor(Date.now() / 1000) - 3600 }],
  ])("rejects an ID token with %s", async (_label, claims) => {
    const { app, issuer } = authApp();
    const { callback } = await signIn(app, issuer, { ...msaClaims, ...claims });
    expect(callback.status).toBe(400);
    expect(cookies(callback).has(sessionCookie)).toBe(false);
  });

  it("rejects an ID token signed with an unknown key", async () => {
    const { app, issuer } = authApp();
    issuer.signingKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const { callback } = await signIn(app, issuer, msaClaims);
    expect(callback.status).toBe(400);
    expect(cookies(callback).has(sessionCookie)).toBe(false);
  });

  it("explains a cancelled sign-in without creating a session", async () => {
    const { app, issuer } = authApp();
    const login = await request(app).get("/auth/login");
    const { state } = issuer.authorize(login.headers.location);
    const callback = await request(app)
      .get(`/auth/callback?error=access_denied&error_description=${encodeURIComponent("<b>no</b>")}&state=${state}`)
      .set("Cookie", `${transactionCookie}=${cookies(login).get(transactionCookie)!.value}`);
    expect(callback.status).toBe(400);
    expect(callback.text).toContain("Sign-in cancelled");
    expect(callback.text).not.toContain("<b>no</b>");
    expect(cookies(callback).has(sessionCookie)).toBe(false);
  });

  it("retries discovery after the provider was unreachable", async () => {
    const issuer = new MockIssuer(DEFAULT_OIDC_ISSUER);
    issuer.discoveryFailures = 1;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { app } = authApp({ issuer });
    const unavailable = await request(app).get("/auth/login");
    expect(unavailable.status).toBe(502);
    expect(unavailable.text).toContain("Sign-in is unavailable");
    expect(cookies(unavailable).has(transactionCookie)).toBe(false);
    const { callback } = await signIn(app, issuer, msaClaims);
    expect(callback.status).toBe(303);
  });

  it("supports the Microsoft multi-tenant (common) endpoint for an allow-listed home-tenant owner", async () => {
    const issuer = new MockIssuer("https://login.microsoftonline.com/common/v2.0", {
      metadataIssuer: "https://login.microsoftonline.com/{tenantid}/v2.0",
      tokenIssuer: `https://login.microsoftonline.com/${homeTenant}/v2.0`,
    });
    const { app } = authApp({ issuer });
    const { callback, session } = await signIn(app, issuer, { tid: homeTenant, oid: owner, name: "Owner" });
    expect(callback.status).toBe(303);
    const whoami = await request(app).get("/whoami").set("Cookie", `${sessionCookie}=${session!.value}`);
    expect(whoami.body).toMatchObject({ tenantId: homeTenant, objectId: owner, displayName: "Owner" });
    const mismatched = await signIn(app, issuer, { tid: CONSUMER_TENANT_ID, oid: msaObject });
    expect(mismatched.callback.status).toBe(400);
  });

  it("goes straight back when already signed in, and forces account selection only on request", async () => {
    const { app, issuer } = authApp();
    const { session } = await signIn(app, issuer, msaClaims);
    const again = await request(app).get("/auth/login?returnTo=%2F%23office").set("Cookie", `${sessionCookie}=${session!.value}`);
    expect(again.status).toBe(303);
    expect(again.headers.location).toBe("/#office");
    const select = await request(app).get("/auth/login?prompt=select_account").set("Cookie", `${sessionCookie}=${session!.value}`);
    expect(select.status).toBe(302);
    expect(new URL(select.headers.location).searchParams.get("prompt")).toBe("select_account");
    const ignored = await request(app).get("/auth/login?prompt=none");
    expect(new URL(ignored.headers.location).searchParams.get("prompt")).toBeNull();
  });

  it("only returns to same-origin paths after sign-in", async () => {
    const { app, issuer } = authApp();
    for (const returnTo of ["https://evil.example/", "//evil.example/", "/\\evil.example", "/auth/logout", "javascript:alert(1)"]) {
      const { callback } = await signIn(app, issuer, msaClaims, `/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
      expect(callback.headers.location, returnTo).toBe("/");
    }
  });
});

describe("sessions", () => {
  const identity: AuthenticatedIdentity = { tenantId: CONSUMER_TENANT_ID, objectId: msaObject, displayName: "Player", email: null };

  it("expires sessions and refuses cookies issued in the future or for another purpose", async () => {
    let now = new Date("2026-10-01T12:00:00Z");
    const { app, auth } = authApp({ now: () => now });
    const cookie = `${sessionCookie}=${signSession(identity, auth, now)}`;
    expect((await request(app).get("/whoami").set("Cookie", cookie)).status).toBe(200);
    now = new Date(now.getTime() + auth.sessionTtlSeconds * 1000);
    expect((await request(app).get("/whoami").set("Cookie", cookie)).body).toEqual({ code: "authentication_required" });
    now = new Date("2026-10-01T12:00:00Z");
    const future = signSession(identity, auth, new Date(now.getTime() + 5 * 60_000));
    expect((await request(app).get("/whoami").set("Cookie", `${sessionCookie}=${future}`)).status).toBe(401);
    const transactionSigned = new CookieSigner(sessionSecret, "transaction").sign({
      v: 1, tid: identity.tenantId, oid: identity.objectId, name: "Player", email: null, iat: 1, exp: 4_000_000_000,
    });
    expect((await request(app).get("/whoami").set("Cookie", `${sessionCookie}=${transactionSigned}`)).status).toBe(401);
  });

  it("verifies signatures of the exact length only and ignores malformed cookies", () => {
    const signer = new CookieSigner(sessionSecret, "session");
    const value = signer.sign({ a: 1 });
    expect(signer.verify(value)).toEqual({ a: 1 });
    const [body, signature] = value.split(".");
    for (const bad of [
      undefined, "", body, `${body}.`, `${body}.${signature}.x`, `${body}.${signature.slice(0, -2)}`,
      `${body}.${signature}AA`, `${body}x.${signature}`, `${body}.${signature.replace(/^./, (c) => c === "A" ? "B" : "A")}`,
      `${"a".repeat(5000)}.${signature}`,
    ])
      expect(signer.verify(bad), String(bad)).toBeNull();
    expect(new CookieSigner("another-secret-abcdefghijklmnopqrstuvwxyz", "session").verify(value)).toBeNull();
  });

  it("applies the authorization policy on every request, not only at sign-in", async () => {
    const { app, auth } = authApp();
    const other = { ...identity, tenantId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" };
    const response = await request(app).get("/whoami").set("Cookie", `${sessionCookie}=${signSession(other, auth)}`);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ code: "not_authorized" });
  });

  it("redirects anonymous browser requests to sign-in and refuses other anonymous methods", async () => {
    const { app, auth } = authApp();
    const page = await request(app).get("/page?x=1");
    expect(page.status).toBe(302);
    expect(page.headers.location).toBe("/auth/login?returnTo=%2Fpage%3Fx%3D1");
    expect((await request(app).post("/page")).status).toBe(401);
    expect((await request(app).get("/page").set("Cookie", `${sessionCookie}=${signSession(identity, auth)}`)).text).toBe("game");
  });
});

describe("sign-out", () => {
  it("clears the session and ends the provider session for same-origin posts", async () => {
    const { app, issuer } = authApp();
    const { session } = await signIn(app, issuer, msaClaims);
    const cookie = `${sessionCookie}=${session!.value}`;
    const crossSite = await request(app).post("/auth/logout").set("Cookie", cookie).set("Origin", "https://evil.example");
    expect(crossSite.status).toBe(403);
    expect(cookies(crossSite).has(sessionCookie)).toBe(false);
    expect((await request(app).post("/auth/logout").set("Cookie", cookie).set("Sec-Fetch-Site", "cross-site")).status).toBe(403);
    expect((await request(app).post("/auth/logout").set("Cookie", cookie)).status).toBe(403);

    const logout = await request(app).post("/auth/logout").set("Cookie", cookie).set("Origin", appOrigin);
    expect(logout.status).toBe(303);
    const target = new URL(logout.headers.location);
    expect(`${target.origin}${target.pathname}`).toBe(`${issuer.base}/logout`);
    expect(target.searchParams.get("client_id")).toBe(clientId);
    expect(target.searchParams.get("post_logout_redirect_uri")).toBe(`${appOrigin}/auth/signed-out`);
    expect(cookies(logout).get(sessionCookie)?.attributes).toEqual(expect.arrayContaining([
      "Path=/", "HttpOnly", "Secure", "SameSite=Lax", "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ]));
    const sameOriginFetch = await request(app).post("/auth/logout").set("Sec-Fetch-Site", "same-origin");
    expect(sameOriginFetch.status).toBe(303);
  });

  it("signs out locally when the provider has no end-session endpoint or is unreachable", async () => {
    const issuer = new MockIssuer(DEFAULT_OIDC_ISSUER);
    issuer.endSession = false;
    const { app } = authApp({ issuer });
    const local = await request(app).post("/auth/logout").set("Origin", appOrigin);
    expect(local.headers.location).toBe("/auth/signed-out");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing: OidcProvider = {
      authorizationUrl: async () => new URL("https://login.example/authorize"),
      callback: async () => ({}),
      endSessionUrl: async () => { throw new TypeError("fetch failed"); },
    };
    const offline = authApp({ provider: failing });
    const response = await request(offline.app).post("/auth/logout").set("Origin", appOrigin);
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe("/auth/signed-out");
    const page = await request(offline.app).get("/auth/signed-out");
    expect(page.text).toContain('href="/auth/login?prompt=select_account"');
    expect(page.headers["cache-control"]).toBe("no-store");
  });
});

describe("identity mapping", () => {
  it("keeps Microsoft (tid, oid) account keys and the Easy Auth email fallback", () => {
    expect(identityFromClaims({ iss: DEFAULT_OIDC_ISSUER, sub: "s", ...msaClaims })).toEqual({
      tenantId: CONSUMER_TENANT_ID, objectId: msaObject, displayName: "Player One", email: "player.one@outlook.com",
    });
    expect(identityFromClaims({
      iss: DEFAULT_OIDC_ISSUER, sub: "s", tid: CONSUMER_TENANT_ID.toUpperCase(), oid: msaObject.toUpperCase(),
      preferred_username: "Gamer@Hotmail.com",
    })).toEqual({ tenantId: CONSUMER_TENANT_ID, objectId: msaObject, displayName: "Sporting director", email: "gamer@hotmail.com" });
    expect(identityFromClaims({
      iss: DEFAULT_OIDC_ISSUER, sub: "s", tid: CONSUMER_TENANT_ID, oid: msaObject, preferred_username: "+44 7700 900123",
      name: "x".repeat(300),
    })).toMatchObject({ email: null, displayName: "x".repeat(200) });
  });

  it("refuses Microsoft tokens with missing or inconsistent tenant and object claims", () => {
    for (const claims of [
      { tid: CONSUMER_TENANT_ID },
      { oid: msaObject },
      { tid: homeTenant, oid: msaObject },
      { tid: CONSUMER_TENANT_ID, oid: "not-a-uuid" },
    ])
      expect(() => identityFromClaims({ iss: DEFAULT_OIDC_ISSUER, sub: "s", ...claims })).toThrow(NotAuthorizedError);
    expect(() => identityFromClaims({ iss: DEFAULT_OIDC_ISSUER, ...msaClaims })).toThrow(AuthenticationRequiredError);
  });

  it("derives stable UUIDv5 keys for other providers and trusts only verified email", () => {
    const issuer = "https://accounts.example.com";
    const identity = identityFromClaims({ iss: issuer, sub: "248289761001", tid: CONSUMER_TENANT_ID, oid: msaObject, email: "a@b.example" });
    expect(identity).toEqual({ ...derivedIdentityKeys(issuer, "248289761001"), displayName: "Sporting director", email: null });
    expect(identity.tenantId).not.toBe(CONSUMER_TENANT_ID);
    expect(identity.tenantId).toBe(uuidV5(`oidc-issuer:${issuer}`, "047c7acb-0a8d-4d9b-a891-85e48a9804b9"));
    expect(identity.objectId).toBe(uuidV5("248289761001", identity.tenantId));
    expect(identityFromClaims({ iss: issuer, sub: "248289761001", email: "A@B.example", email_verified: true }).email).toBe("a@b.example");
    expect(identityFromClaims({ iss: `${issuer}/`, sub: "248289761001" }).tenantId).not.toBe(identity.tenantId);
    expect(() => authorizeIdentity(identity, policy)).toThrow(NotAuthorizedError);
    expect(authorizeIdentity(identity, { homeTenantId: identity.tenantId, ownerObjectId: identity.objectId, allowedUserObjectIds: new Set() }))
      .toBe(identity);
  });

  it("computes RFC 9562 version 5 UUIDs", () => {
    expect(uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });

  it("authorizes personal accounts and only allow-listed home-tenant accounts", () => {
    const profile = { displayName: "x", email: null };
    const guest = "22222222-2222-2222-2222-222222222222";
    const allowed = { ...policy, allowedUserObjectIds: new Set([owner, guest]) };
    expect(authorizeIdentity({ tenantId: CONSUMER_TENANT_ID, objectId: guest, ...profile }, policy).objectId).toBe(guest);
    expect(authorizeIdentity({ tenantId: homeTenant, objectId: owner, ...profile }, policy).objectId).toBe(owner);
    expect(authorizeIdentity({ tenantId: homeTenant, objectId: guest, ...profile }, allowed).objectId).toBe(guest);
    expect(() => authorizeIdentity({ tenantId: homeTenant, objectId: guest, ...profile }, policy)).toThrow(NotAuthorizedError);
    expect(() => authorizeIdentity({ tenantId: owner, objectId: owner, ...profile }, policy)).toThrow(NotAuthorizedError);
    const consumersOnly = { homeTenantId: "", ownerObjectId: "", allowedUserObjectIds: new Set<string>() };
    expect(() => authorizeIdentity({ tenantId: homeTenant, objectId: owner, ...profile }, consumersOnly)).toThrow(NotAuthorizedError);
    expect(() => authorizeIdentity({ tenantId: "", objectId: "", ...profile }, consumersOnly)).toThrow(NotAuthorizedError);
  });
});

describe("helpers and configuration", () => {
  it("sanitizes return paths", () => {
    expect(safeReturnTo("/squad?x=1#top")).toBe("/squad?x=1#top");
    expect(safeReturnTo("/a/../admin/invites")).toBe("/admin/invites");
    for (const value of [undefined, 42, ["/"], "", "squad", "//evil.example", "/\\evil.example", "https://evil.example/",
      "/auth/callback?code=x", "/\u0000", "/" + "a".repeat(2048)])
      expect(safeReturnTo(value), String(value)).toBe("/");
    expect(loginUrl("/")).toBe("/auth/login");
    expect(loginUrl("/admin/invites?token=a.b")).toBe("/auth/login?returnTo=%2Fadmin%2Finvites%3Ftoken%3Da.b");
  });

  it("reads TRUST_PROXY without allowing every hop to be trusted", () => {
    expect(readTrustProxy(undefined, true)).toBe("loopback");
    expect(readTrustProxy(undefined, false)).toBe(false);
    expect(readTrustProxy("false", true)).toBe(false);
    expect(readTrustProxy("1", true)).toBe(1);
    expect(readTrustProxy("loopback, uniquelocal, 10.1.2.3, fd00::/8", true)).toBe("loopback,uniquelocal,10.1.2.3,fd00::/8");
    for (const value of ["true", "11", "proxy", "10.0.0.0/40", "10.0.0.0/8/1", "::1/129"])
      expect(() => readTrustProxy(value, true), value).toThrow("TRUST_PROXY");
  });

  it("uses plain cookie names only for non-HTTPS origins", () => {
    expect(sessionCookieName(true)).toBe("__Host-touchline_session");
    expect(sessionCookieName(false)).toBe("touchline_session");
    expect(readAuthConfiguration({ OIDC_CLIENT_ID: clientId, SESSION_SECRET: sessionSecret }, {
      appOrigin: "http://127.0.0.1:3001", inviteSigningSecret: "x",
    }).secureCookies).toBe(false);
  });
});

describe("hosted app wiring", () => {
  const environment = {
    API_HOST: "0.0.0.0",
    REQUIRE_AUTH: "true",
    APP_ORIGIN: appOrigin,
    OIDC_CLIENT_ID: clientId,
    OIDC_CLIENT_SECRET: clientSecret,
    SESSION_SECRET: sessionSecret,
    INVITE_SIGNING_SECRET: "invite-secret-abcdefghijklmnopqrstuvwxyz",
    EMAIL_TRANSPORT: "disabled",
  };

  it("signs a personal Microsoft account in end to end and passes the identity to account resolution", async () => {
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
    const issuer = new MockIssuer(DEFAULT_OIDC_ISSUER);
    const auth = readApiConfiguration().auth!;
    const store = Object.create(Store.prototype) as Store;
    const resolve = vi.fn(async (identity: AuthenticatedIdentity) =>
      ({ user: { id: "account", displayName: identity.displayName, email: identity.email }, store }));
    const app = createApp(store, { resolve }, { oidcProvider: createOpenIdProvider(auth, { fetch: issuer.fetch }) });

    expect((await request(app).get("/api/me")).body).toEqual({ error: "Authentication required.", code: "authentication_required" });
    const home = await request(app).get("/");
    expect(home.status).toBe(302);
    expect(home.headers.location).toBe("/auth/login");
    const login = await request(app).get("/auth/login");
    expect(login.headers["content-security-policy"]).toContain("form-action 'self' https://login.microsoftonline.com");
    const grant = issuer.authorize(login.headers.location, { ...msaClaims, email: undefined, preferred_username: "Player@Example.TEST" });
    const callback = await request(app).get(`/auth/callback?code=${grant.code}&state=${grant.state}`)
      .set("Cookie", `${transactionCookie}=${cookies(login).get(transactionCookie)!.value}`);
    expect(callback.status).toBe(303);
    const session = `${sessionCookie}=${cookies(callback).get(sessionCookie)!.value}`;
    const probe = await request(app).get("/api/access-probe").set("Cookie", session);
    expect(probe.status).toBe(404);
    expect(resolve).toHaveBeenCalledWith({
      tenantId: CONSUMER_TENANT_ID, objectId: msaObject, displayName: "Player One", email: "player@example.test",
    });
    expect((await request(app).post("/api/careers/prepare").set("Cookie", session).send({})).status).toBe(403);
    const logout = await request(app).post("/auth/logout").set("Cookie", session).set("Origin", appOrigin);
    expect(logout.status).toBe(303);
    expect(logout.headers.location).toMatch(/^https:\/\/login\.microsoftonline\.com\/9188040d-6c67-4c5b-b112-36a304b66dad\/v2\.0\/logout\?/);
  });

  it("does not mount sign-in routes in local mode", async () => {
    vi.stubEnv("REQUIRE_AUTH", "false");
    vi.stubEnv("API_HOST", "127.0.0.1");
    vi.stubEnv("APP_ORIGIN", undefined);
    const app = createApp(Object.create(Store.prototype) as Store);
    const response = await request(app).get("/auth/login");
    // Without auth routes this falls through to the SPA shell (when a build exists) or 404; never a provider redirect.
    expect(response.headers.location).toBeUndefined();
    expect([200, 404]).toContain(response.status);
    if (response.status === 200) expect(response.headers["content-type"]).toMatch(/text\/html/);
    const invite = await request(app).get("/invite");
    expect(invite.headers["content-security-policy"]).toMatch(/form-action 'self'$/);
  });
});
