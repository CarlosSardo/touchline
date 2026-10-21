import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CustomFetch } from "openid-client";
import { Store } from "./db.ts";
import { createApp, readApiConfiguration } from "./app.ts";
import {
  AuthenticationRequiredError,
  CookieSigner,
  createAuthenticator,
  createOpenIdProvider,
  identityFromClaims,
  loginUrl,
  OIDC_SCOPE,
  readAdminGroup,
  readAuthConfiguration,
  readTrustProxy,
  safeReturnTo,
  sessionCookieName,
  signSession,
  transactionCookieName,
  type AuthConfiguration,
  type AuthenticatedIdentity,
  type OidcProvider,
} from "./auth.ts";

const appOrigin = "https://touchline.example.com";
const autheliaIssuer = "https://auth.sardohome.duckdns.org";
const clientId = "touchline";
const clientSecret = "client-secret-value";
const sessionSecret = "session-secret-abcdefghijklmnopqrstuvwxyz";
/** Authelia `sub`: an opaque per-user UUID. */
const subject = "3d1b3b8e-6f7a-4c4e-9d3e-0a5b8c2f1e77";
const sessionCookie = sessionCookieName(true);
const transactionCookie = transactionCookieName(true);

const authConfiguration = (overrides: Partial<AuthConfiguration> = {}): AuthConfiguration => ({
  ...readAuthConfiguration({
    OIDC_ISSUER: autheliaIssuer,
    OIDC_CLIENT_ID: clientId,
    OIDC_CLIENT_SECRET: clientSecret,
    SESSION_SECRET: sessionSecret,
  }, { appOrigin }),
  ...overrides,
});

type Claims = Record<string, unknown>;

/**
 * An Authelia 4.39-like OpenID Connect provider (discovery, JWKS, token endpoint with client_secret_basic, UserInfo)
 * served through openid-client's customFetch. Like Authelia without a claims policy, the ID token carries only the
 * protocol claims by default; profile, email and groups come from UserInfo.
 */
class AutheliaMock {
  readonly keys: { privateKey: KeyObject; publicKey: KeyObject };
  readonly kid = "authelia-rs256";
  readonly tokenRequests: { body: URLSearchParams; authorization: string | undefined }[] = [];
  readonly userInfoRequests: string[] = [];
  readonly grants = new Map<string, { challenge: string; redirectUri: string; idToken: Claims; userInfo: Claims }>();
  readonly accessTokens = new Map<string, Claims>();
  discoveryFailures = 0;
  /** Authelia 4.39 does not advertise RP-initiated logout. */
  endSession = false;
  userInfoEndpoint = true;
  metadataIssuer?: string;
  signingKey?: KeyObject;

  constructor(readonly base = autheliaIssuer) {
    this.keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  }

  /** What Authelia does when the browser arrives at the authorization endpoint and the user signs in (with 2FA). */
  authorize(authorizationUrl: string, claims: { idToken?: Claims; userInfo?: Claims } = {}) {
    const url = new URL(authorizationUrl);
    expect(url.origin + url.pathname).toBe(`${this.base}/api/oidc/authorization`);
    const params = url.searchParams;
    expect(params.get("client_id")).toBe(clientId);
    expect(params.get("response_type")).toBe("code");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("scope")).toBe("openid profile email groups");
    const code = randomUUID();
    this.grants.set(code, {
      challenge: params.get("code_challenge")!,
      redirectUri: params.get("redirect_uri")!,
      idToken: { nonce: params.get("nonce"), ...claims.idToken },
      userInfo: claims.userInfo ?? autheliaProfile,
    });
    return { code, state: params.get("state")!, redirectUri: params.get("redirect_uri")! };
  }

  idToken(claims: Claims) {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", kid: this.kid, typ: "JWT" };
    const payload = {
      iss: this.base, aud: [clientId], azp: clientId, iat: now, auth_time: now, exp: now + 3600, amr: ["pwd", "otp"],
      jti: randomUUID(), sub: subject, ...claims,
    };
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const input = `${encode(header)}.${encode(payload)}`;
    return `${input}.${sign("sha256", Buffer.from(input), this.signingKey ?? this.keys.privateKey).toString("base64url")}`;
  }

  readonly fetch: CustomFetch = async (url, options) => {
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
    const header = (name: string) =>
      Object.entries(options.headers).find(([key]) => key.toLowerCase() === name)?.[1];
    if (url === `${this.base}/.well-known/openid-configuration`) {
      if (this.discoveryFailures > 0) {
        this.discoveryFailures--;
        throw new TypeError("fetch failed");
      }
      return json({
        issuer: this.metadataIssuer ?? this.base,
        jwks_uri: `${this.base}/jwks.json`,
        authorization_endpoint: `${this.base}/api/oidc/authorization`,
        token_endpoint: `${this.base}/api/oidc/token`,
        ...(this.userInfoEndpoint ? { userinfo_endpoint: `${this.base}/api/oidc/userinfo` } : {}),
        ...(this.endSession ? { end_session_endpoint: `${this.base}/api/oidc/end-session` } : {}),
        introspection_endpoint: `${this.base}/api/oidc/introspection`,
        revocation_endpoint: `${this.base}/api/oidc/revocation`,
        response_types_supported: ["code", "id_token", "code id_token"],
        response_modes_supported: ["form_post", "query", "fragment"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        scopes_supported: ["offline_access", "openid", "profile", "groups", "email", "address", "phone"],
        claims_supported: ["sub", "preferred_username", "name", "email", "email_verified", "groups", "amr", "nonce"],
        subject_types_supported: ["public", "pairwise"],
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "client_secret_jwt", "private_key_jwt", "none"],
        code_challenge_methods_supported: ["S256"],
        id_token_signing_alg_values_supported: ["RS256", "none"],
        userinfo_signing_alg_values_supported: ["none", "RS256"],
        request_object_signing_alg_values_supported: ["RS256", "none"],
        require_pushed_authorization_requests: false,
      });
    }
    if (url === `${this.base}/jwks.json`)
      return json({ keys: [{ ...this.keys.publicKey.export({ format: "jwk" }), kid: this.kid, use: "sig", alg: "RS256" }] });
    if (url === `${this.base}/api/oidc/token` && options.method === "POST") {
      const body = new URLSearchParams(typeof options.body === "string" ? options.body : String(options.body));
      const authorization = header("authorization");
      this.tokenRequests.push({ body, authorization });
      // RFC 6749 section 2.3.1: form-urlencoded client_id:client_secret, then base64.
      const [user, password] = Buffer.from(authorization?.replace(/^Basic /, "") ?? "", "base64").toString("utf8").split(":")
        .map((part) => decodeURIComponent(part.replaceAll("+", " ")));
      if (!authorization?.startsWith("Basic ") || user !== clientId || password !== clientSecret || body.has("client_secret"))
        return json({ error: "invalid_client" }, 401);
      const grant = this.grants.get(body.get("code") ?? "");
      const verifier = body.get("code_verifier") ?? "";
      if (
        !grant || body.get("grant_type") !== "authorization_code" || body.get("redirect_uri") !== grant.redirectUri ||
        createHash("sha256").update(verifier).digest("base64url") !== grant.challenge
      )
        return json({ error: "invalid_grant" }, 400);
      this.grants.delete(body.get("code")!);
      const accessToken = `authelia_at_${randomUUID()}`;
      this.accessTokens.set(accessToken, { sub: grant.idToken.sub ?? subject, ...grant.userInfo });
      return json({
        access_token: accessToken, token_type: "bearer", expires_in: 3599, scope: OIDC_SCOPE, id_token: this.idToken(grant.idToken),
      });
    }
    if (url === `${this.base}/api/oidc/userinfo` && this.userInfoEndpoint) {
      const authorization = header("authorization") ?? "";
      this.userInfoRequests.push(authorization);
      const claims = this.accessTokens.get(authorization.replace(/^Bearer /i, ""));
      if (!claims) return json({ error: "invalid_token" }, 401, { "www-authenticate": 'Bearer error="invalid_token"' });
      return json(claims);
    }
    return json({ error: "not_found" }, 404);
  };
}

const autheliaProfile = {
  preferred_username: "kiko",
  name: "Kiko Sardo",
  email: "Kiko@Example.TEST",
  email_verified: true,
  groups: ["admins", "family"],
};
const playerProfile = { preferred_username: "player1", name: "Player One", email: "player1@example.test", email_verified: true, groups: ["family"] };

const cookies = (response: request.Response) => {
  const header = response.headers["set-cookie"] as unknown as string[] | undefined;
  return new Map((header ?? []).map((cookie) => {
    const [pair, ...attributes] = cookie.split(";").map((part) => part.trim());
    const separator = pair.indexOf("=");
    return [pair.slice(0, separator), { value: pair.slice(separator + 1), attributes }] as const;
  }));
};

function authApp(options: { issuer?: AutheliaMock; provider?: OidcProvider; now?: () => Date; auth?: Partial<AuthConfiguration> } = {}) {
  const issuer = options.issuer ?? new AutheliaMock();
  const auth = authConfiguration({ issuer: issuer.base, ...options.auth });
  const authenticator = createAuthenticator({
    auth,
    provider: options.provider ?? createOpenIdProvider(auth, { fetch: issuer.fetch }),
    now: options.now,
  });
  const app = express();
  app.use(authenticator.router);
  app.get("/whoami", (request, response) => {
    try {
      response.json(authenticator.authenticate(request));
    } catch (error) {
      const failure = error as AuthenticationRequiredError;
      response.status(failure.status).json({ code: failure.code });
    }
  });
  app.use(authenticator.requireBrowserSession);
  app.all("/page", (_request, response) => response.send("game"));
  return { app, issuer, auth, authenticator };
}

async function signIn(
  app: express.Express,
  issuer: AutheliaMock,
  claims: { idToken?: Claims; userInfo?: Claims } = {},
  path = "/auth/login",
) {
  const login = await request(app).get(path);
  expect(login.status).toBe(302);
  const transaction = cookies(login).get(transactionCookie)!;
  const grant = issuer.authorize(login.headers.location, claims);
  const callback = await request(app)
    .get(`/auth/callback?code=${encodeURIComponent(grant.code)}&state=${encodeURIComponent(grant.state)}&iss=${encodeURIComponent(issuer.base)}`)
    .set("Cookie", `${transactionCookie}=${transaction.value}`);
  return { login, transaction, grant, callback, session: cookies(callback).get(sessionCookie) };
}

const kiko: AuthenticatedIdentity = {
  issuer: autheliaIssuer,
  subject,
  username: "kiko",
  displayName: "Kiko Sardo",
  email: "kiko@example.test",
  groups: ["admins", "family"],
  admin: true,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("OpenID Connect sign-in against Authelia (Authorization Code + PKCE)", () => {
  it("signs in with state, nonce, PKCE and client_secret_basic, reads UserInfo and issues a hardened session cookie", async () => {
    const { app, issuer } = authApp();
    const { login, transaction, grant, callback, session } = await signIn(app, issuer, {}, "/auth/login?returnTo=%2Fsquad%3Fid%3D4%23squad");

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
    expect(token.body.get("code_verifier")).toMatch(/^[\w-]{43,128}$/);
    expect(token.body.get("redirect_uri")).toBe(`${appOrigin}/auth/callback`);
    expect(token.body.has("client_secret")).toBe(false);
    expect(token.authorization).toMatch(/^Basic /);
    expect(issuer.userInfoRequests).toEqual([expect.stringMatching(/^Bearer authelia_at_/)]);

    const whoami = await request(app).get("/whoami").set("Cookie", `${sessionCookie}=${session!.value}`);
    expect(whoami.status).toBe(200);
    expect(whoami.body).toEqual(kiko);
  });

  it("uses ID token claims when the provider has no UserInfo endpoint, and UserInfo claims over ID token claims", async () => {
    const issuer = new AutheliaMock();
    issuer.userInfoEndpoint = false;
    const { app } = authApp({ issuer });
    const { session } = await signIn(app, issuer, { idToken: playerProfile });
    expect((await request(app).get("/whoami").set("Cookie", `${sessionCookie}=${session!.value}`)).body)
      .toMatchObject({ username: "player1", displayName: "Player One", groups: ["family"], admin: false });

    const withUserInfo = authApp();
    const overlaid = await signIn(withUserInfo.app, withUserInfo.issuer, {
      idToken: { ...playerProfile, name: "Stale name" },
      userInfo: { ...playerProfile, name: "Fresh name", groups: ["family", "admins"] },
    });
    expect((await request(withUserInfo.app).get("/whoami").set("Cookie", `${sessionCookie}=${overlaid.session!.value}`)).body)
      .toMatchObject({ displayName: "Fresh name", groups: ["family", "admins"], admin: true });
  });

  it("keeps only the admin group when non-ASCII group names would overflow the session cookie", async () => {
    const { app, issuer } = authApp();
    const groups = [...Array.from({ length: 15 }, (_value, index) => `${index}`.padEnd(64, "€")), "admins"];
    const { callback, session } = await signIn(app, issuer, { userInfo: { ...autheliaProfile, name: "€".repeat(200), groups } });
    expect(callback.status).toBe(303);
    expect(session!.value.length).toBeLessThanOrEqual(4096);
    expect((await request(app).get("/whoami").set("Cookie", `${sessionCookie}=${session!.value}`)).body)
      .toMatchObject({ groups: ["admins"], admin: true });
  });

  it("refuses a UserInfo response for another subject", async () => {
    const { app, issuer } = authApp();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { callback } = await signIn(app, issuer, { userInfo: { ...autheliaProfile, sub: "another-user" } });
    expect(callback.status).toBe(400);
    expect(callback.text).toContain("Sign-in failed");
    expect(cookies(callback).has(sessionCookie)).toBe(false);
  });

  it("refuses a callback whose state does not match the browser's transaction", async () => {
    const { app, issuer } = authApp();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const login = await request(app).get("/auth/login");
    const grant = issuer.authorize(login.headers.location);
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
    const grant = issuer.authorize(login.headers.location);
    const transaction = cookies(login).get(transactionCookie)!.value;
    const callback = (cookie?: string) => {
      const pending = request(app).get(`/auth/callback?code=${grant.code}&state=${grant.state}`);
      return cookie ? pending.set("Cookie", `${transactionCookie}=${cookie}`) : pending;
    };
    expect((await callback()).status).toBe(400);
    const [body, signature] = transaction.split(".");
    const forged = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    forged.returnTo = "/admin";
    expect((await callback(`${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${signature}`)).status).toBe(400);
    expect((await callback(signSession(kiko, { sessionSecret, sessionTtlSeconds: 600 }))).status).toBe(400);
    now = new Date(Date.now() + 11 * 60_000);
    const expired = await callback(transaction);
    expect(expired.status).toBe(400);
    expect(expired.text).toContain("Sign-in expired");
    expect(issuer.tokenRequests).toEqual([]);
  });

  it.each([
    ["a different nonce", { nonce: "replayed-nonce" }],
    ["another audience", { aud: ["another-client"], azp: "another-client" }],
    ["another issuer", { iss: "https://auth.evil.example" }],
    ["an expired ID token", { exp: Math.floor(Date.now() / 1000) - 3600 }],
    ["no subject", { sub: "" }],
  ])("rejects an ID token with %s", async (_label, claims) => {
    const { app, issuer } = authApp();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { callback } = await signIn(app, issuer, { idToken: claims });
    expect(callback.status).toBe(400);
    expect(cookies(callback).has(sessionCookie)).toBe(false);
  });

  it("rejects an ID token signed with an unknown key", async () => {
    const { app, issuer } = authApp();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    issuer.signingKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const { callback } = await signIn(app, issuer);
    expect(callback.status).toBe(400);
    expect(cookies(callback).has(sessionCookie)).toBe(false);
  });

  it("fails sign-in when the token endpoint refuses the client credentials", async () => {
    const issuer = new AutheliaMock();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { app } = authApp({ issuer, auth: { clientSecret: "wrong-secret" } });
    const { callback } = await signIn(app, issuer);
    expect(callback.status).toBe(400);
    expect(issuer.tokenRequests).toHaveLength(1);
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
    const issuer = new AutheliaMock();
    issuer.discoveryFailures = 1;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { app } = authApp({ issuer });
    const unavailable = await request(app).get("/auth/login");
    expect(unavailable.status).toBe(502);
    expect(unavailable.text).toContain("Sign-in is unavailable");
    expect(cookies(unavailable).has(transactionCookie)).toBe(false);
    const { callback } = await signIn(app, issuer);
    expect(callback.status).toBe(303);
  });

  it("refuses discovery metadata for another issuer", async () => {
    const issuer = new AutheliaMock();
    issuer.metadataIssuer = "https://auth.evil.example";
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { app } = authApp({ issuer });
    expect((await request(app).get("/auth/login")).status).toBe(502);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("sign-in could not start"));
  });

  it("goes straight back when already signed in, and forces re-authentication only on request", async () => {
    const { app, issuer } = authApp();
    const { session } = await signIn(app, issuer);
    const again = await request(app).get("/auth/login?returnTo=%2F%23office").set("Cookie", `${sessionCookie}=${session!.value}`);
    expect(again.status).toBe(303);
    expect(again.headers.location).toBe("/#office");
    const reauthenticate = await request(app).get("/auth/login?prompt=login").set("Cookie", `${sessionCookie}=${session!.value}`);
    expect(reauthenticate.status).toBe(302);
    expect(new URL(reauthenticate.headers.location).searchParams.get("prompt")).toBe("login");
    for (const prompt of ["none", "select_account", "consent"]) {
      const ignored = await request(app).get(`/auth/login?prompt=${prompt}`);
      expect(new URL(ignored.headers.location).searchParams.get("prompt"), prompt).toBeNull();
    }
  });

  it("only returns to same-origin paths after sign-in", async () => {
    const { app, issuer } = authApp();
    for (const returnTo of ["https://evil.example/", "//evil.example/", "/\\evil.example", "/auth/logout", "javascript:alert(1)"]) {
      const { callback } = await signIn(app, issuer, {}, `/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
      expect(callback.headers.location, returnTo).toBe("/");
    }
  });
});

describe("sessions", () => {
  it("expires sessions and refuses cookies issued in the future, for another purpose or for another issuer", async () => {
    let now = new Date("2026-10-01T12:00:00Z");
    const { app, auth } = authApp({ now: () => now });
    const cookie = `${sessionCookie}=${signSession(kiko, auth, now)}`;
    expect((await request(app).get("/whoami").set("Cookie", cookie)).body).toEqual(kiko);
    now = new Date(now.getTime() + auth.sessionTtlSeconds * 1000);
    expect((await request(app).get("/whoami").set("Cookie", cookie)).body).toEqual({ code: "authentication_required" });
    now = new Date("2026-10-01T12:00:00Z");
    const future = signSession(kiko, auth, new Date(now.getTime() + 5 * 60_000));
    expect((await request(app).get("/whoami").set("Cookie", `${sessionCookie}=${future}`)).status).toBe(401);
    const iat = Math.floor(now.getTime() / 1000);
    const payload = {
      v: 2, iss: autheliaIssuer, sub: subject, usr: "kiko", name: "Kiko", email: null, groups: [], adm: true, iat, exp: iat + 600,
    };
    expect((await request(app).get("/whoami").set("Cookie", `${sessionCookie}=${new CookieSigner(sessionSecret, "session").sign(payload)}`)).status)
      .toBe(200);
    const transactionSigned = new CookieSigner(sessionSecret, "transaction").sign(payload);
    expect((await request(app).get("/whoami").set("Cookie", `${sessionCookie}=${transactionSigned}`)).status).toBe(401);
    const otherIssuer = signSession({ ...kiko, issuer: "https://auth.other.example" }, auth, now);
    expect((await request(app).get("/whoami").set("Cookie", `${sessionCookie}=${otherIssuer}`)).status).toBe(401);
    const previousFormat = new CookieSigner(sessionSecret, "session").sign({
      v: 1, tid: "9188040d-6c67-4c5b-b112-36a304b66dad", oid: subject, name: "Old", email: null, iat, exp: iat + 600,
    });
    expect((await request(app).get("/whoami").set("Cookie", `${sessionCookie}=${previousFormat}`)).status).toBe(401);
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

  it("refuses a session cookie whose admin flag or groups were edited", async () => {
    const { app, auth } = authApp();
    const player = { ...kiko, username: "player1", groups: ["family"], admin: false };
    const [body, signature] = signSession(player, auth).split(".");
    const forged = Buffer.from(JSON.stringify({
      ...JSON.parse(Buffer.from(body, "base64url").toString("utf8")), adm: true, groups: ["admins"],
    })).toString("base64url");
    expect((await request(app).get("/whoami").set("Cookie", `${sessionCookie}=${forged}.${signature}`)).status).toBe(401);
    expect((await request(app).get("/whoami").set("Cookie", `${sessionCookie}=${body}.${signature}`)).body).toEqual(player);
  });

  it("redirects anonymous browser requests to sign-in and refuses other anonymous methods", async () => {
    const { app, auth } = authApp();
    const page = await request(app).get("/page?x=1");
    expect(page.status).toBe(302);
    expect(page.headers.location).toBe("/auth/login?returnTo=%2Fpage%3Fx%3D1");
    expect((await request(app).post("/page")).status).toBe(401);
    expect((await request(app).get("/page").set("Cookie", `${sessionCookie}=${signSession(kiko, auth)}`)).text).toBe("game");
  });
});

describe("sign-out", () => {
  const logoutUrl = `${autheliaIssuer}/logout`;

  it("clears the session for same-origin posts and goes to OIDC_LOGOUT_URL when Authelia has no end_session_endpoint", async () => {
    const { app, issuer } = authApp({ auth: { logoutUrl } });
    const { session } = await signIn(app, issuer);
    const cookie = `${sessionCookie}=${session!.value}`;
    const crossSite = await request(app).post("/auth/logout").set("Cookie", cookie).set("Origin", "https://evil.example");
    expect(crossSite.status).toBe(403);
    expect(cookies(crossSite).has(sessionCookie)).toBe(false);
    expect((await request(app).post("/auth/logout").set("Cookie", cookie).set("Sec-Fetch-Site", "cross-site")).status).toBe(403);
    expect((await request(app).post("/auth/logout").set("Cookie", cookie)).status).toBe(403);

    const logout = await request(app).post("/auth/logout").set("Cookie", cookie).set("Origin", appOrigin);
    expect(logout.status).toBe(303);
    expect(logout.headers.location).toBe(logoutUrl);
    expect(cookies(logout).get(sessionCookie)?.attributes).toEqual(expect.arrayContaining([
      "Path=/", "HttpOnly", "Secure", "SameSite=Lax", "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ]));
    const sameOriginFetch = await request(app).post("/auth/logout").set("Sec-Fetch-Site", "same-origin");
    expect(sameOriginFetch.status).toBe(303);
  });

  it("uses the provider's end_session_endpoint when discovery advertises one", async () => {
    const issuer = new AutheliaMock();
    issuer.endSession = true;
    const { app } = authApp({ issuer, auth: { logoutUrl } });
    const logout = await request(app).post("/auth/logout").set("Origin", appOrigin);
    expect(logout.status).toBe(303);
    const target = new URL(logout.headers.location);
    expect(`${target.origin}${target.pathname}`).toBe(`${autheliaIssuer}/api/oidc/end-session`);
    expect(target.searchParams.get("client_id")).toBe(clientId);
    expect(target.searchParams.get("post_logout_redirect_uri")).toBe(`${appOrigin}/auth/signed-out`);
  });

  it("signs out locally without an end-session endpoint or OIDC_LOGOUT_URL, or when the provider is unreachable", async () => {
    const { app } = authApp();
    const local = await request(app).post("/auth/logout").set("Origin", appOrigin);
    expect(local.headers.location).toBe("/auth/signed-out");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing: OidcProvider = {
      authorizationUrl: async () => new URL(`${autheliaIssuer}/api/oidc/authorization`),
      callback: async () => ({}),
      endSessionUrl: async () => { throw new TypeError("fetch failed"); },
    };
    const offline = authApp({ provider: failing });
    const response = await request(offline.app).post("/auth/logout").set("Origin", appOrigin);
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe("/auth/signed-out");
    expect((await request(authApp({ provider: failing, auth: { logoutUrl } }).app).post("/auth/logout").set("Origin", appOrigin))
      .headers.location).toBe(logoutUrl);
    const page = await request(offline.app).get("/auth/signed-out");
    expect(page.text).toContain('href="/auth/login?prompt=login"');
    expect(page.headers["cache-control"]).toBe("no-store");
  });

  it("allows the sign-out redirect targets in CSP form-action", () => {
    expect(authApp().authenticator.formActionOrigins).toEqual([autheliaIssuer]);
    expect(authApp({ auth: { logoutUrl: `${autheliaIssuer}/logout` } }).authenticator.formActionOrigins).toEqual([autheliaIssuer]);
    expect(authApp({ auth: { logoutUrl: "https://sso.example.net/logout?rd=x" } }).authenticator.formActionOrigins)
      .toEqual([autheliaIssuer, "https://sso.example.net"]);
  });
});

describe("identity mapping", () => {
  const context = { issuer: autheliaIssuer, adminGroup: "admins" };

  it("maps Authelia claims and decides admin from the configured group", () => {
    expect(identityFromClaims({ iss: "ignored", sub: subject, ...autheliaProfile }, context)).toEqual(kiko);
    expect(identityFromClaims({ sub: subject, ...autheliaProfile }, { ...context, adminGroup: "family" }).admin).toBe(true);
    expect(identityFromClaims({ sub: subject, ...autheliaProfile }, { ...context, adminGroup: "owners" }).admin).toBe(false);
  });

  it("falls back to sub for the username and to the username for the display name", () => {
    expect(identityFromClaims({ sub: subject }, context)).toEqual({
      issuer: autheliaIssuer, subject, username: subject, displayName: subject, email: null, groups: [], admin: false,
    });
    expect(identityFromClaims({ sub: subject, preferred_username: "  kiko ", name: "   " }, context))
      .toMatchObject({ username: "kiko", displayName: "kiko" });
    expect(identityFromClaims({ sub: subject, preferred_username: "kiko", name: ` ${"x".repeat(300)} ` }, context).displayName)
      .toBe("x".repeat(200));
  });

  it("lowercases valid emails and drops invalid or explicitly unverified ones", () => {
    const email = (claims: Claims) => identityFromClaims({ sub: subject, ...claims }, context).email;
    expect(email({ email: " Kiko@Example.TEST " })).toBe("kiko@example.test");
    expect(email({ email: "kiko@example.test", email_verified: false })).toBeNull();
    expect(email({ email: "not-an-email" })).toBeNull();
    expect(email({ email: `${"a".repeat(320)}@example.test` })).toBeNull();
    expect(email({ email: 42 })).toBeNull();
  });

  it("keeps only string groups that fit the session and never drops the admin group", () => {
    const groups = (value: unknown, adminGroup = "admins") => identityFromClaims({ sub: subject, groups: value }, { ...context, adminGroup });
    expect(groups("admins")).toMatchObject({ groups: [], admin: false });
    expect(groups(["family", 7, null, "", "family", "x".repeat(65), "admins"])).toMatchObject({ groups: ["family", "admins"], admin: true });
    const many = Array.from({ length: 40 }, (_value, index) => `group-${index}`);
    expect(groups([...many, "admins"]).groups).toEqual(["admins", ...many.slice(0, 15)]);
    expect(groups(many).groups).toEqual(many.slice(0, 16));
  });

  it("refuses identities without a usable subject", () => {
    for (const sub of [undefined, "", " padded ", 42, "x".repeat(256), "a\u0000b"])
      expect(() => identityFromClaims({ sub, ...autheliaProfile }, context), String(sub)).toThrow(AuthenticationRequiredError);
  });

  it("keeps session cookies within the browser limit for the largest accepted identity", () => {
    const largest: AuthenticatedIdentity = {
      issuer: `${autheliaIssuer}/${"p".repeat(255 - autheliaIssuer.length - 1)}`,
      subject: "s".repeat(255),
      username: "u".repeat(200),
      displayName: "n".repeat(200),
      email: `${"e".repeat(300)}@example.test`,
      groups: Array.from({ length: 16 }, (_value, index) => `${index}`.padEnd(64, "g")),
      admin: true,
    };
    expect(signSession(largest, { sessionSecret, sessionTtlSeconds: 3600 }).length).toBeLessThanOrEqual(4096);
  });
});

describe("helpers and configuration", () => {
  it("sanitizes return paths", () => {
    expect(safeReturnTo("/squad?x=1#top")).toBe("/squad?x=1#top");
    expect(safeReturnTo("/a/../admin")).toBe("/admin");
    for (const value of [undefined, 42, ["/"], "", "squad", "//evil.example", "/\\evil.example", "https://evil.example/",
      "/auth/callback?code=x", "/\u0000", "/" + "a".repeat(2048)])
      expect(safeReturnTo(value), String(value)).toBe("/");
    expect(loginUrl("/")).toBe("/auth/login");
    expect(loginUrl("/admin?tab=pending")).toBe("/auth/login?returnTo=%2Fadmin%3Ftab%3Dpending");
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

  it("reads OIDC settings without provider defaults", () => {
    expect(authConfiguration()).toEqual(expect.objectContaining({
      issuer: autheliaIssuer, clientId, clientSecret, logoutUrl: undefined, adminGroup: "admins", secureCookies: true,
    }));
    const environment = { OIDC_ISSUER: autheliaIssuer, OIDC_CLIENT_ID: clientId, OIDC_CLIENT_SECRET: clientSecret, SESSION_SECRET: sessionSecret };
    expect(() => readAuthConfiguration({ ...environment, OIDC_ISSUER: undefined }, { appOrigin })).toThrow("requires OIDC_ISSUER");
    expect(() => readAuthConfiguration({ ...environment, OIDC_CLIENT_SECRET: undefined }, { appOrigin })).toThrow("OIDC_CLIENT_SECRET");
    expect(readAuthConfiguration({ ...environment, OIDC_LOGOUT_URL: ` ${autheliaIssuer}/logout ` }, { appOrigin }).logoutUrl)
      .toBe(`${autheliaIssuer}/logout`);
    expect(readAdminGroup(undefined)).toBe("admins");
    expect(readAdminGroup(" ")).toBe("admins");
    expect(readAdminGroup("touchline-admins")).toBe("touchline-admins");
    expect(() => readAdminGroup("two words")).toThrow("ADMIN_GROUP");
  });

  it("uses plain cookie names only for non-HTTPS origins", () => {
    expect(sessionCookieName(true)).toBe("__Host-touchline_session");
    expect(sessionCookieName(false)).toBe("touchline_session");
    expect(transactionCookieName(true)).toBe("__Host-touchline_signin");
    expect(readAuthConfiguration({
      OIDC_ISSUER: autheliaIssuer, OIDC_CLIENT_ID: clientId, OIDC_CLIENT_SECRET: clientSecret, SESSION_SECRET: sessionSecret,
    }, { appOrigin: "http://127.0.0.1:3001" }).secureCookies).toBe(false);
  });
});

describe("hosted app wiring", () => {
  const environment = {
    API_HOST: "0.0.0.0",
    REQUIRE_AUTH: "true",
    APP_ORIGIN: appOrigin,
    OIDC_ISSUER: autheliaIssuer,
    OIDC_CLIENT_ID: clientId,
    OIDC_CLIENT_SECRET: clientSecret,
    OIDC_LOGOUT_URL: `${autheliaIssuer}/logout`,
    ADMIN_GROUP: "admins",
    SESSION_SECRET: sessionSecret,
    TRUST_PROXY: "1",
  };

  it("signs an Authelia user in end to end and passes the identity to account resolution", async () => {
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
    const issuer = new AutheliaMock();
    const auth = readApiConfiguration().auth!;
    const store = Object.create(Store.prototype) as Store;
    const resolve = vi.fn(async (identity: AuthenticatedIdentity) => ({
      user: { id: "account", username: identity.username, displayName: identity.displayName, email: identity.email, admin: false },
      store,
    }));
    const app = createApp(store, { resolve }, { oidcProvider: createOpenIdProvider(auth, { fetch: issuer.fetch }) });

    expect((await request(app).get("/api/me")).body).toEqual({ error: "Authentication required.", code: "authentication_required" });
    const home = await request(app).get("/");
    expect(home.status).toBe(302);
    expect(home.headers.location).toBe("/auth/login");
    const login = await request(app).get("/auth/login");
    expect(login.headers["content-security-policy"]).toMatch(/form-action 'self' https:\/\/auth\.sardohome\.duckdns\.org$/);
    const grant = issuer.authorize(login.headers.location, { userInfo: playerProfile });
    const callback = await request(app).get(`/auth/callback?code=${grant.code}&state=${grant.state}`)
      .set("Cookie", `${transactionCookie}=${cookies(login).get(transactionCookie)!.value}`);
    expect(callback.status).toBe(303);
    const session = `${sessionCookie}=${cookies(callback).get(sessionCookie)!.value}`;
    const probe = await request(app).get("/api/access-probe").set("Cookie", session);
    expect(probe.status).toBe(404);
    expect(resolve).toHaveBeenCalledWith({
      issuer: autheliaIssuer, subject, username: "player1", displayName: "Player One", email: "player1@example.test",
      groups: ["family"], admin: false,
    } satisfies AuthenticatedIdentity);
    expect((await request(app).post("/api/careers/prepare").set("Cookie", session).send({})).status).toBe(403);
    const logout = await request(app).post("/auth/logout").set("Cookie", session).set("Origin", appOrigin);
    expect(logout.status).toBe(303);
    expect(logout.headers.location).toBe(`${autheliaIssuer}/logout`);
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
    const health = await request(app).get("/api/health");
    expect(health.headers["content-security-policy"]).toMatch(/form-action 'self'$/);
  });
});
