import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { openOnFirstUse, Store } from "./db.ts";
import { AccessDeniedError, AccessPendingError } from "./accounts.ts";
import { processCompetitionNotifications } from "./notifications.ts";
import { generateWorld } from "./world.ts";
import { createCalendar } from "./calendar.ts";
import { createApp, isCalendarDate, loanDurationError, MAX_LOAN_DAYS, readApiConfiguration } from "./app.ts";
import { sessionCookieName, signSession, type AuthenticatedIdentity } from "./auth.ts";
import { playerSearchChanged, players as searchPlayers } from "./queries.ts";
import { initialInbox, stateOf } from "./systems.ts";
import { Saves } from "./saves.ts";
import { tableName, WORLD_TABLES } from "./sql-schema.ts";
import { ageOn, addDays, addMonths, DEFAULT_ASSISTANT_DUTIES, groupCareerSaves } from "../shared/rules.ts";
import { CALL_UP_RULES } from "../shared/features/callups.ts";
import { clubTransfersChanged } from "./club-transfers.ts";
import type { AccountUser, SaveSlot } from "../shared/api.ts";
import { createUnexpectedEvent } from "./events.ts";

// Authelia subjects are opaque per-user UUIDs.
const owner = "11111111-1111-1111-1111-111111111111";
const guest = "22222222-2222-2222-2222-222222222222";
const secondGuest = "33333333-3333-3333-3333-333333333333";
const issuer = "https://auth.example.com";
const sessionSecret = "session-secret-abcdefghijklmnopqrstuvwxyz";
const configuration = {
  API_HOST: "0.0.0.0",
  REQUIRE_AUTH: "true",
  APP_ORIGIN: "https://touchline.example.com",
  OIDC_ISSUER: issuer,
  OIDC_CLIENT_ID: "touchline",
  OIDC_CLIENT_SECRET: "client-secret-value",
  SESSION_SECRET: sessionSecret,
};
type Profile = { email?: string; name?: string; username?: string; admin?: boolean };
const identityOf = (subject: string, profile: Profile = {}): AuthenticatedIdentity => ({
  issuer,
  subject,
  username: profile.username ?? "director",
  displayName: profile.name ?? "Sporting director",
  email: profile.email ?? null,
  groups: profile.admin ? ["admins", "family"] : ["family"],
  admin: profile.admin ?? false,
});
/** The account user an Accounts resolver would return for the identity. */
const userOf = (identity: AuthenticatedIdentity, id = identity.subject): AccountUser => ({
  id, username: identity.username, displayName: identity.displayName, email: identity.email, admin: identity.admin,
});
/** Cookie header for a signed-in session, as issued by GET /auth/callback (see auth.test.ts for the OIDC flow). */
const signedIn = (
  subject: string,
  profile: Profile = {},
  options: { secret?: string; issuedAt?: Date; issuer?: string } = {},
) =>
  `${sessionCookieName(true)}=${signSession(
    { ...identityOf(subject, profile), issuer: options.issuer ?? issuer },
    { sessionSecret: options.secret ?? sessionSecret, sessionTtlSeconds: 3600 },
    options.issuedAt,
  )}`;
const sqlIntegration = process.env.SQL_INTEGRATION_TESTS === "true";

describe("action input validation (no database)", () => {
  it("accepts only real calendar dates for a call-up end", () => {
    for (const value of ["2026-10-15", "2028-02-29", "2026-12-31"]) expect(isCalendarDate(value), value).toBe(true);
    for (const value of ["2026-13-45", "2027-02-29", "2026-04-31", "2026-00-10", "2026-1-05", "20261015", ""])
      expect(isCalendarDate(value), value).toBe(false);
  });

  it("limits loans between clubs of different countries to one season", () => {
    expect(MAX_LOAN_DAYS).toEqual({ domestic: 730, international: 380 });
    expect(loanDurationError({ type: "Two-year loan", crossBorder: false })).toBeNull();
    expect(loanDurationError({ type: "Cross-border loan", duration: 730, crossBorder: false })).toBeNull();
    expect(loanDurationError({ type: "Cross-border loan", duration: 380, crossBorder: true })).toBeNull();
    expect(loanDurationError({ type: "Standard loan", crossBorder: true })).toBeNull();
    expect(loanDurationError({ type: "Two-year loan", crossBorder: true })).toMatch(/at most one season \(380 days\)/);
    expect(loanDurationError({ type: "Loan with option", duration: 381, crossBorder: true })).toMatch(/at most one season/);
  });
});

describe("hosted access (no database)", () => {
  const app = (resolver?: Parameters<typeof createApp>[1]) => {
    for (const [name, value] of Object.entries(configuration)) vi.stubEnv(name, value);
    const store = Object.create(Store.prototype) as Store;
    return createApp(store, resolver ?? {
      async resolve(identity) {
        return { user: userOf(identity), store };
      },
    });
  };
  afterEach(() => vi.unstubAllEnvs());

  it.each([owner, guest, secondGuest])("admits the signed-in identity %s", async (subject) => {
    const response = await request(app()).get("/api/access-probe").set("Cookie", signedIn(subject));
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("API route not found.");
  });

  it("rejects anonymous requests and sessions issued for another provider", async () => {
    const resolve = vi.fn(async () => { throw new Error("Must not resolve"); });
    const application = app({ resolve });
    expect((await request(application).get("/api/access-probe")).status).toBe(401);
    const other = await request(application).get("/api/access-probe")
      .set("Cookie", signedIn(owner, { admin: true }, { issuer: "https://other.example.com" }));
    expect(other.status).toBe(401);
    expect(other.body).toEqual({ error: "Authentication required.", code: "authentication_required" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("passes the signed-in identity to account resolution", async () => {
    const store = Object.create(Store.prototype) as Store;
    const resolve = vi.fn(async (identity: AuthenticatedIdentity) => ({ user: userOf(identity), store }));
    const profile = { email: "player@example.test", name: "Player One", username: "player1" };
    const response = await request(app({ resolve })).get("/api/access-probe").set("Cookie", signedIn(guest, profile));
    expect(response.status).toBe(404);
    expect(resolve).toHaveBeenCalledWith({
      issuer, subject: guest, username: "player1", displayName: "Player One", email: "player@example.test",
      groups: ["family"], admin: false,
    } satisfies AuthenticatedIdentity);
    await request(app({ resolve })).get("/api/access-probe").set("Cookie", signedIn(owner, { admin: true }));
    expect(resolve).toHaveBeenLastCalledWith(expect.objectContaining({ subject: owner, groups: ["admins", "family"], admin: true }));
  });

  it.each([
    [new AccessPendingError(), "access_pending"],
    [new AccessDeniedError(), "access_denied"],
  ] as const)("answers 403 %s without opening a world", async (error, code) => {
    const resolve = vi.fn(async () => { throw error; });
    const response = await request(app({ resolve })).get("/api/me").set("Cookie", signedIn(guest));
    expect(response.status).toBe(403);
    expect(response.headers["retry-after"]).toBeUndefined();
    expect(response.body).toEqual({ error: error.message, code });
    expect(resolve).toHaveBeenCalledOnce();
  });

  it("rejects forged, tampered, expired and proxy identity headers before resolving an account", async () => {
    const resolve = vi.fn(async () => { throw new AccessPendingError(); });
    const application = app({ resolve });
    const valid = signedIn(guest).split("=")[1];
    const [body, signature] = valid.split(".");
    const forge = (changes: object) => Buffer.from(JSON.stringify({
      ...JSON.parse(Buffer.from(body, "base64url").toString("utf8")), ...changes,
    })).toString("base64url");
    for (const attempt of [
      { cookie: `${sessionCookieName(true)}=${forge({ sub: owner })}.${signature}` },
      { cookie: `${sessionCookieName(true)}=${forge({ adm: true, groups: ["admins"] })}.${signature}` },
      { cookie: signedIn(owner, {}, { secret: "another-secret-abcdefghijklmnopqrstuvwxyz" }) },
      { cookie: signedIn(owner, {}, { issuedAt: new Date(Date.now() - 2 * 3600_000) }) },
      { cookie: `touchline_session=${valid}` },
      // Forward-auth headers (Caddy + Authelia) are never trusted: only the signed OIDC session counts.
      { headers: { "Remote-User": "owner", "Remote-Groups": "admins", "Remote-Email": "owner@example.test" } },
    ]) {
      const probe = request(application).get("/api/me");
      if (attempt.cookie) probe.set("Cookie", attempt.cookie);
      if (attempt.headers) probe.set(attempt.headers);
      const response = await probe;
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "Authentication required.", code: "authentication_required" });
    }
    expect(resolve).not.toHaveBeenCalled();
  });

  it("redirects anonymous browser navigations to sign-in and keeps sign-in routes public", async () => {
    const application = app();
    const page = await request(application).get("/squad?tab=1");
    expect(page.status).toBe(302);
    expect(page.headers.location).toBe("/auth/login?returnTo=%2Fsquad%3Ftab%3D1");
    expect((await request(application).get("/")).headers.location).toBe("/auth/login");
    const signedOut = await request(application).get("/auth/signed-out");
    expect(signedOut.status).toBe(200);
    expect(signedOut.text).toContain("You're signed out");
    expect((await request(application).get("/invite")).headers.location).toBe("/auth/login?returnTo=%2Finvite");
    expect((await request(application).get("/admin")).headers.location).toBe("/auth/login?returnTo=%2Fadmin");
    const retiredInvites = await request(application).get("/admin/invites");
    expect(retiredInvites.status).toBe(301);
    expect(retiredInvites.headers.location).toBe("/admin");
    expect((await request(application).get("/squad").set("Cookie", signedIn(owner))).status).not.toBe(302);
    expect((await request(application).post("/squad")).status).toBe(401);
  });

  it("keeps anonymous health public without invoking account resolution", async () => {
    const resolve = vi.fn(async () => { throw new Error("Must not resolve health"); });
    const response = await request(app({ resolve })).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("fails on removed security variables and only warns about removed email variables", () => {
    for (const name of ["OWNER_OBJECT_ID", "ALLOWED_USER_OBJECT_IDS", "AUTH_HOME_TENANT_ID", "AZURE_TENANT_ID"]) {
      expect(() => readApiConfiguration({ ...configuration, [name]: owner }), name).toThrow(`removed: ${name}`);
      expect(() => readApiConfiguration({ API_HOST: "127.0.0.1", [name]: owner }), name).toThrow(`removed: ${name}`);
    }
    expect(readApiConfiguration({ ...configuration, OWNER_OBJECT_ID: " " }).warnings).toEqual([]);
    expect(() => readApiConfiguration({ ...configuration, INVITE_DB_SIZE_LIMIT_GB: "8" }))
      .toThrow("INVITE_DB_SIZE_LIMIT_GB was renamed to DB_SIZE_LIMIT_GB");
    expect(readApiConfiguration(configuration).warnings).toEqual([]);
    expect(readApiConfiguration({
      ...configuration,
      INVITE_SIGNING_SECRET: "12345678901234567890123456789012",
      EMAIL_TRANSPORT: "gmail",
      SMTP_USER: "touchline@example.test",
      SMTP_PASS: "app-password",
      APPROVER_EMAIL: "owner@example.test",
      OWNER_EMAIL: "owner@example.test",
    }).warnings).toEqual([
      "removed and ignored (email delivery no longer exists): INVITE_SIGNING_SECRET, EMAIL_TRANSPORT, APPROVER_EMAIL, OWNER_EMAIL, SMTP_PASS, SMTP_USER.",
    ]);
  });

  it("reads access capacity and the admin group", () => {
    expect(readApiConfiguration(configuration)).toEqual(expect.objectContaining({
      adminGroup: "admins",
      maxPlayers: 10,
      dbSizeLimitGb: 24,
      warnings: [],
    }));
    expect(readApiConfiguration({ ...configuration, MAX_PLAYERS: "4", DB_SIZE_LIMIT_GB: "2.5", ADMIN_GROUP: " touchline-admins " }))
      .toEqual(expect.objectContaining({ maxPlayers: 4, dbSizeLimitGb: 2.5, adminGroup: "touchline-admins" }));
    expect(readApiConfiguration({ ...configuration, ADMIN_GROUP: "touchline-admins" }).auth?.adminGroup).toBe("touchline-admins");
    for (const [overrides, message] of [
      [{ MAX_PLAYERS: "0" }, "MAX_PLAYERS"],
      [{ MAX_PLAYERS: "2.5" }, "MAX_PLAYERS"],
      [{ DB_SIZE_LIMIT_GB: "0" }, "DB_SIZE_LIMIT_GB"],
      [{ DB_SIZE_LIMIT_GB: "lots" }, "DB_SIZE_LIMIT_GB"],
      [{ ADMIN_GROUP: "touchline admins" }, "ADMIN_GROUP"],
      [{ ADMIN_GROUP: "a".repeat(65) }, "ADMIN_GROUP"],
    ] as const)
      expect(() => readApiConfiguration({ ...configuration, ...overrides }), message).toThrow(message);
  });

  it("validates hosted sign-in configuration strictly", () => {
    const hosted = readApiConfiguration(configuration);
    expect(hosted).toEqual(expect.objectContaining({ hosted: true, trustProxy: "loopback" }));
    expect(hosted.auth).toEqual({
      issuer,
      clientId: "touchline",
      clientSecret: "client-secret-value",
      logoutUrl: undefined,
      adminGroup: "admins",
      sessionSecret,
      sessionTtlSeconds: 8 * 3600,
      appOrigin: "https://touchline.example.com",
      redirectUri: "https://touchline.example.com/auth/callback",
      postLogoutRedirectUri: "https://touchline.example.com/auth/signed-out",
      secureCookies: true,
    });
    expect(readApiConfiguration({ ...configuration, REQUIRE_AUTH: "false", API_HOST: "127.0.0.1", APP_ORIGIN: undefined }))
      .toEqual(expect.objectContaining({ hosted: false, auth: undefined, trustProxy: false }));
    expect(readApiConfiguration({ API_HOST: "127.0.0.1" }).auth).toBeUndefined();
    expect(readApiConfiguration({ ...configuration, TRUST_PROXY: "1" }).trustProxy).toBe(1);
    expect(readApiConfiguration({ ...configuration, TRUST_PROXY: "loopback, 172.18.0.0/16" }).trustProxy).toBe("loopback,172.18.0.0/16");
    expect(readApiConfiguration({ ...configuration, SESSION_TTL_HOURS: "24" }).auth?.sessionTtlSeconds).toBe(24 * 3600);
    expect(readApiConfiguration({ ...configuration, OIDC_LOGOUT_URL: `${issuer}/logout?rd=https%3A%2F%2Ftouchline.example.com` }).auth?.logoutUrl)
      .toBe(`${issuer}/logout?rd=https%3A%2F%2Ftouchline.example.com`);
    for (const [overrides, message] of [
      [{ API_HOST: "0.0.0.0", REQUIRE_AUTH: undefined }, "Public API binding requires explicit REQUIRE_AUTH=true"],
      [{ REQUIRE_AUTH: "yes" }, "REQUIRE_AUTH must be true or false"],
      [{ APP_ORIGIN: undefined }, "REQUIRE_AUTH=true requires APP_ORIGIN"],
      [{ APP_ORIGIN: "http://touchline.example.com" }, "APP_ORIGIN must be an exact HTTPS hosted origin"],
      [{ APP_ORIGIN: "https://touchline.example.com/" }, "APP_ORIGIN must be an exact HTTPS hosted origin"],
      [{ OIDC_ISSUER: undefined }, "REQUIRE_AUTH=true requires OIDC_ISSUER"],
      [{ OIDC_ISSUER: " " }, "REQUIRE_AUTH=true requires OIDC_ISSUER"],
      [{ OIDC_ISSUER: "http://auth.example.com" }, "OIDC_ISSUER"],
      [{ OIDC_ISSUER: "auth.example.com" }, "OIDC_ISSUER"],
      [{ OIDC_ISSUER: "https://user:pass@auth.example.com" }, "OIDC_ISSUER"],
      [{ OIDC_ISSUER: "https://auth.example.com/?client=x" }, "OIDC_ISSUER"],
      [{ OIDC_CLIENT_ID: undefined }, "OIDC_CLIENT_ID"],
      [{ OIDC_CLIENT_ID: "touch line" }, "OIDC_CLIENT_ID"],
      [{ OIDC_CLIENT_SECRET: undefined }, "OIDC_CLIENT_SECRET"],
      [{ OIDC_LOGOUT_URL: "http://auth.example.com/logout" }, "OIDC_LOGOUT_URL"],
      [{ OIDC_LOGOUT_URL: "/logout" }, "OIDC_LOGOUT_URL"],
      [{ SESSION_SECRET: undefined }, "SESSION_SECRET"],
      [{ SESSION_SECRET: "too-short" }, "SESSION_SECRET"],
      [{ OIDC_CLIENT_SECRET: sessionSecret }, "SESSION_SECRET must differ from OIDC_CLIENT_SECRET"],
      [{ SESSION_TTL_HOURS: "0" }, "SESSION_TTL_HOURS"],
      [{ SESSION_TTL_HOURS: "1.5" }, "SESSION_TTL_HOURS"],
      [{ TRUST_PROXY: "true" }, "TRUST_PROXY=true"],
      [{ TRUST_PROXY: "proxy.example" }, "TRUST_PROXY must be"],
      [{ TRUST_PROXY: "10.0.0.0/33" }, "TRUST_PROXY must be"],
    ] as const)
      expect(() => readApiConfiguration({ ...configuration, ...overrides }), message).toThrow(message);
  });

  it("allows sign-out redirects only to the provider in the CSP form-action", async () => {
    const csp = async (environment: Record<string, string>) => {
      for (const [name, value] of Object.entries({ ...configuration, ...environment })) vi.stubEnv(name, value);
      const store = Object.create(Store.prototype) as Store;
      const application = createApp(store, { resolve: async (identity) => ({ user: userOf(identity), store }) });
      return (await request(application).get("/api/health")).headers["content-security-policy"];
    };
    expect(await csp({})).toMatch(/form-action 'self' https:\/\/auth\.example\.com$/);
    expect(await csp({ OIDC_LOGOUT_URL: `${issuer}/logout` })).toMatch(/form-action 'self' https:\/\/auth\.example\.com$/);
    expect(await csp({ OIDC_LOGOUT_URL: "https://sso.example.net/logout" }))
      .toMatch(/form-action 'self' https:\/\/auth\.example\.com https:\/\/sso\.example\.net$/);
  });

  it("preserves same-origin referrers for hosted cookie CSRF validation", async () => {
    const response = await request(app()).get("/");
    expect(response.headers["referrer-policy"]).toBe("same-origin");
  });

  it.each([owner, guest, secondGuest])("admits same-origin mutations for %s", async (subject) => {
    const response = await request(app()).post("/api/access-probe")
      .set("Cookie", signedIn(subject))
      .set("Origin", configuration.APP_ORIGIN)
      .set("Referer", `${configuration.APP_ORIGIN}/`)
      .send({ type: "read-news" });
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("API route not found.");
  });

  it.each([undefined, "null", "https://other.example.com"])("rejects mutations with untrusted origin %s", async (origin) => {
    const resolve = vi.fn(async () => { throw new Error("Untrusted origins must not resolve accounts"); });
    const mutation = request(app({ resolve })).post("/api/careers/prepare")
      .set("Cookie", signedIn(guest))
      .set("Referer", `${configuration.APP_ORIGIN}/`);
    if (origin) mutation.set("Origin", origin);
    expect((await mutation.send({ type: "read-news" })).status).toBe(403);
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe("SQL opened on the first request that needs it (no database)", () => {
  beforeEach(() => {
    for (const [name, value] of Object.entries(configuration)) vi.stubEnv(name, value);
  });
  afterEach(() => vi.unstubAllEnvs());
  const fakeDatabase = () => {
    const store = Object.create(Store.prototype) as Store;
    return {
      store,
      accounts: {
        async resolve(identity: AuthenticatedIdentity) {
          return { user: userOf(identity), store };
        },
      },
    };
  };

  it("never opens SQL for health, static files or anonymous and refused requests", async () => {
    const open = vi.fn(async () => { throw new Error("SQL must not be opened."); });
    const application = createApp(open);
    const health = await request(application).get("/api/health");
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: "ok" });
    expect((await request(application).get("/api/bootstrap")).status).toBe(401);
    expect((await request(application).get("/api/me").set("Cookie", `${sessionCookieName(true)}=not.a-session`)).status).toBe(401);
    expect((await request(application).get("/api/me")
      .set("Cookie", signedIn(owner, {}, { issuer: "https://other.example.com" }))).status).toBe(401);
    expect((await request(application).post("/api/careers/prepare")
      .set("Cookie", signedIn(owner)).send({})).status).toBe(403);
    expect((await request(application).get("/")).status).toBeLessThan(500);
    expect(open).not.toHaveBeenCalled();
  });

  it("answers 503 while SQL is unavailable, then opens it once for concurrent first requests", async () => {
    const open = vi.fn<() => Promise<ReturnType<typeof fakeDatabase>>>()
      .mockRejectedValueOnce(new Error("Database is not currently available (40613)"));
    const application = createApp(openOnFirstUse(open, { retryFor: 0 }).get);
    const unavailable = await request(application).get("/api/me").set("Cookie", signedIn(owner));
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers["retry-after"]).toBe("5");
    expect(unavailable.body).toEqual({
      error: "The game database is starting or unavailable. Try again in a moment.",
      code: "database_unavailable",
    });
    let finish: (database: ReturnType<typeof fakeDatabase>) => void = () => {};
    open.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = [owner, guest, secondGuest].map((subject) =>
      request(application).get("/api/access-probe").set("Cookie", signedIn(subject)).then((response) => response));
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    finish(fakeDatabase());
    for (const response of await Promise.all(pending)) {
      expect(response.status).toBe(404);
      expect(response.body.error).toBe("API route not found.");
    }
    expect((await request(application).get("/api/access-probe").set("Cookie", signedIn(guest))).status).toBe(404);
    expect(open).toHaveBeenCalledTimes(2);
  });
});

describe.skipIf(!sqlIntegration)("per-user HTTP isolation (two isolated SQL schemas)", () => {
  const fixture = { nations: ["SCO"], squads: "minimum" as const };
  let root: Store;
  let schemaOwner: Store;
  let ownerWorld: Store;
  let app: ReturnType<typeof createApp>;
  let baseline: { file: string; name: string };
  const access = (method: "get" | "post" | "patch" | "delete", path: string, subject = owner) =>
    request(app)[method](path)
      .set("Cookie", signedIn(subject, {
        name: subject === owner ? "Owner Director" : "Guest Director",
        username: subject === owner ? "owner" : "guest",
        email: "shared@example.test",
        admin: subject === owner,
      }))
      .set("Origin", configuration.APP_ORIGIN);

  beforeAll(async () => {
    root = await Store.createTest("user-api-root");
    schemaOwner = await Store.createTest("user-api-owner");
    ownerWorld = root.forSchema(schemaOwner.schemaName);
    expect(ownerWorld.schemaName).not.toBe(root.schemaName);
    await generateWorld(root, { ...fixture, seed: "existing-guest-world" });
    const state = await stateOf(root);
    state.started = true;
    state.director.name = "Existing guest director";
    await root.setMeta("state", state);
    await createCalendar(root);
    await initialInbox(root);
    baseline = await new Saves(root).create("Guest checkpoint");
  }, 300_000);

  beforeEach(async () => {
    for (const [name, value] of Object.entries(configuration)) vi.stubEnv(name, value);
    await ownerWorld.transaction(async () => {
      await ownerWorld.clearWorld();
      await ownerWorld.run("DELETE FROM save_slots");
    });
    await new Saves(root).restore(baseline.file);
    const worlds = new Map([[owner, ownerWorld], [guest, root]]);
    app = createApp(root, {
      async resolve(identity: AuthenticatedIdentity) {
        const store = worlds.get(identity.subject);
        if (identity.issuer !== issuer || !store) throw new AccessPendingError();
        // The admin flag in /api/me must follow the session's groups, not the stored account.
        const user = { ...userOf(identity, identity.subject === owner ? "owner-account" : "guest-account"), admin: false };
        return { user, store };
      },
    });
  }, 300_000);

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await ownerWorld?.close();
    await schemaOwner?.close();
    await root?.close();
  }, 300_000);

  it("returns verified profiles and empty owner state without email or root-world fallback", async () => {
    const world = await import("./world.ts");
    const generate = vi.spyOn(world, "generateWorld");
    const session = await access("get", "/api/me")
      .query({ schema: root.schemaName, userId: guest, email: "shared@example.test" });
    expect(session.status).toBe(200);
    expect(session.body).toEqual({
      user: { id: "owner-account", username: "owner", displayName: "Owner Director", email: "shared@example.test", admin: true },
      hasWorld: false,
      activity: null,
    });
    const empty = await access("get", "/api/bootstrap").query({ schema: root.schemaName });
    expect(empty.status).toBe(200);
    expect(empty.body).toBeNull();
    expect((await access("get", "/api/saves")).body).toEqual([]);
    expect((await access("get", "/api/health/details")).body.schema).toBe(ownerWorld.schemaName);
    expect((await access("post", "/api/saves").send({ name: "No world" })).status).toBe(409);
    expect((await access("get", "/api/saves/export")).status).toBe(409);
    expect((await access("post", "/api/careers").send({
      careerName: "Not prepared", background: "Former scout", clubId: 1,
    })).status).toBe(409);
    expect((await access("get", "/api/me", guest)).body).toEqual({
      user: { id: "guest-account", username: "guest", displayName: "Guest Director", email: "shared@example.test", admin: false },
      hasWorld: true,
      activity: null,
    });
    expect((await access("get", "/api/bootstrap", guest)).body.state.director.name).toBe("Existing guest director");
    const renamed = await access("get", "/api/me")
      .set("Cookie", signedIn(owner, { name: "Updated owner", username: "owner2", email: "updated@example.test" }));
    expect(renamed.body.user).toEqual({
      id: "owner-account", username: "owner2", displayName: "Updated owner", email: "updated@example.test", admin: false,
    });
    expect(await new Saves(ownerWorld).currentState()).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it("denies foreign save export, restore, load and deletion in both directions", async () => {
    const deny = async (subject: string, file: string) => {
      expect((await access("get", "/api/saves/export", subject).query({ file })).status).toBe(404);
      for (const [method, path] of [
        ["post", "/api/saves/restore"], ["post", "/api/careers/load"], ["delete", "/api/careers"],
      ] as const) {
        const response = await access(method, path, subject)
          .send({ file, schema: root.schemaName, userId: guest });
        expect(response.status, path).toBe(404);
      }
    };
    await deny(owner, baseline.file);
    expect(await new Saves(ownerWorld).currentState()).toBeNull();
    expect(await new Saves(ownerWorld).list()).toEqual([]);
    await generateWorld(ownerWorld, { ...fixture, seed: "separate-owner-world" });
    const saved = await new Saves(ownerWorld).create("Owner checkpoint");
    await deny(guest, saved.file);
    expect((await access("get", "/api/saves")).body.map((slot: SaveSlot) => slot.file)).toEqual([saved.file]);
    expect((await access("get", "/api/saves", guest)).body.map((slot: SaveSlot) => slot.file)).toEqual([baseline.file]);
    expect((await access("get", "/api/saves/export").query({ file: saved.file })).status).toBe(200);
  }, 300_000);

  it("prepares once on explicit action and finalizes the prepared world without generating or archiving it again", async () => {
    const world = await import("./world.ts");
    const generateWorldFixture = world.generateWorld;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const generate = vi.spyOn(world, "generateWorld").mockImplementation(async (store, options) => {
      entered();
      await gate;
      await generateWorldFixture(store, { ...options, ...fixture });
    });
    const pending = access("post", "/api/careers/prepare")
      .send({ schema: root.schemaName, displayName: "Untrusted name" }).then((response) => response);
    try {
      await Promise.race([started, pending.then(() => { throw new Error("Preparation ended before generation"); })]);
      const session = await access("get", "/api/me").timeout({ response: 20_000 });
      expect(session.status).toBe(200);
      expect(session.body).toEqual({
        user: { id: "owner-account", username: "owner", displayName: "Owner Director", email: "shared@example.test", admin: true },
        hasWorld: null,
        activity: { operation: "prepare_world", startedAt: expect.any(String) },
      });
      const startedAt: string = session.body.activity.startedAt;
      expect(new Date(startedAt).toISOString()).toBe(startedAt);
      for (const busy of [
        await access("get", "/api/bootstrap"),
        await access("post", "/api/careers/prepare").send({}),
      ]) {
        expect(busy.status).toBe(409);
        expect(busy.headers["retry-after"]).toBe("2");
        expect(busy.body).toEqual({
          error: "The game is saving or advancing. Please wait for that operation to finish.",
          code: "world_busy",
          operation: "prepare_world",
          startedAt,
        });
      }
      expect((await access("get", "/api/bootstrap", guest).timeout({ response: 20_000 })).status).toBe(200);
      expect((await access("get", "/api/me", guest)).body).toMatchObject({ hasWorld: true, activity: null });
    } finally {
      release();
      await pending;
    }
    const prepared = await pending;
    expect(prepared.status).toBe(200);
    expect(prepared.body).toEqual({ created: true });
    expect(generate).toHaveBeenCalledWith(ownerWorld, { seed: expect.stringMatching(/^touchline-/) });
    const state = await stateOf(ownerWorld);
    expect(state.started).toBe(false);
    expect(state.director.name).toBe("Owner Director");
    expect((await access("get", "/api/me")).body.hasWorld).toBe(true);
    expect((await access("get", "/api/bootstrap")).body.state).toEqual(state);
    expect((await access("post", "/api/careers/prepare").send({})).body).toEqual({ created: false });
    expect(await stateOf(ownerWorld)).toEqual(state);
    expect(await new Saves(ownerWorld).list()).toEqual([]);
    expect((await ownerWorld.get<{ total: number }>("SELECT COUNT(*) AS total FROM fixtures"))!.total).toBe(0);
    const clear = vi.spyOn(ownerWorld, "clearWorld");
    const career = await access("post", "/api/careers").send({
      careerName: "Owner season", background: "Former scout", clubId: state.clubId,
    });
    expect(career.status).toBe(200);
    expect(career.body.archived).toBeNull();
    expect(career.body.saved).toMatch(/\.touchline\.gz$/);
    expect(await stateOf(ownerWorld)).toMatchObject({ started: true, seed: state.seed, director: { name: "Owner Director" } });
    expect(generate).toHaveBeenCalledOnce();
    expect(clear).not.toHaveBeenCalled();
    expect(await new Saves(ownerWorld).list()).toHaveLength(1);
    // A resent start (e.g. after an ingress timeout) returns the finished result instead of another career.
    const replay = await access("post", "/api/careers").send({
      careerName: "Owner season", background: "Former scout", clubId: state.clubId,
    });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(career.body);
    expect(await new Saves(ownerWorld).list()).toHaveLength(1);
    expect((await ownerWorld.get<{ total: number }>("SELECT COUNT(*) AS total FROM fixtures"))!.total).toBeGreaterThan(0);
    expect((await ownerWorld.get<{ total: number }>("SELECT COUNT(*) AS total FROM news"))!.total).toBeGreaterThan(0);
    const finalized = await stateOf(ownerWorld);
    expect((await access("post", "/api/careers/prepare").send({})).body).toEqual({ created: false });
    expect(await stateOf(ownerWorld)).toEqual(finalized);
    expect((await new Saves(root).list()).map((slot) => slot.file)).toEqual([baseline.file]);
  }, 300_000);

  it("keeps an in-flight writer and its busy responses scoped to one user", async () => {
    await generateWorld(ownerWorld, { ...fixture, seed: "concurrent-owner-world" });
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const setMeta = ownerWorld.setMeta.bind(ownerWorld);
    vi.spyOn(ownerWorld, "setMeta").mockImplementation(async (key, value) => {
      if (key === "settings") {
        entered();
        await gate;
      }
      await setMeta(key, value);
    });
    const pending = access("patch", "/api/settings").send({ currency: "EUR" }).then((response) => response);
    try {
      await Promise.race([started, pending.then(() => { throw new Error("Writer ended before settings update"); })]);
      const busy = await access("get", "/api/bootstrap");
      expect(busy.status).toBe(409);
      expect(busy.headers["retry-after"]).toBe("2");
      expect(busy.body).toMatchObject({ code: "world_busy", operation: "update_settings", startedAt: expect.any(String) });
      expect((await access("get", "/api/me")).body).toMatchObject({
        hasWorld: null,
        activity: { operation: "update_settings", startedAt: busy.body.startedAt },
      });
      expect((await access("patch", "/api/settings", guest).send({ currency: "USD" })
        .timeout({ response: 20_000 })).status).toBe(200);
      expect((await access("get", "/api/bootstrap", guest)).body.settings.currency).toBe("USD");
      expect((await access("get", "/api/me", guest)).body).toMatchObject({ hasWorld: true, activity: null });
    } finally {
      release();
      await pending;
    }
    expect((await pending).status).toBe(200);
    expect((await access("get", "/api/bootstrap")).body.settings.currency).toBe("EUR");
    expect((await access("get", "/api/bootstrap", guest)).body.settings.currency).toBe("USD");
  }, 300_000);

  it("answers /api/me from router state while busy and with one plain read when idle", async () => {
    await generateWorld(ownerWorld, { ...fixture, seed: "session-owner-world" });
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const setMeta = ownerWorld.setMeta.bind(ownerWorld);
    vi.spyOn(ownerWorld, "setMeta").mockImplementation(async (key, value) => {
      if (key === "settings") {
        entered();
        await gate;
      }
      await setMeta(key, value);
    });
    const get = vi.spyOn(ownerWorld, "get");
    const all = vi.spyOn(ownerWorld, "all");
    const transaction = vi.spyOn(ownerWorld, "transaction");
    const pending = access("patch", "/api/settings").send({ currency: "EUR" }).then((response) => response);
    try {
      await Promise.race([started, pending.then(() => { throw new Error("Writer ended before settings update"); })]);
      for (const spy of [get, all, transaction]) spy.mockClear();
      for (let attempt = 0; attempt < 3; attempt++)
        expect((await access("get", "/api/me").timeout({ response: 20_000 })).body)
          .toMatchObject({ hasWorld: null, activity: { operation: "update_settings" } });
      expect(get).not.toHaveBeenCalled();
      expect(all).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      release();
      await pending;
    }
    expect((await pending).status).toBe(200);
    for (const spy of [get, all, transaction]) spy.mockClear();
    expect((await access("get", "/api/me")).body).toMatchObject({ hasWorld: true, activity: null });
    expect(get).toHaveBeenCalledOnce();
    expect(transaction).not.toHaveBeenCalled();
  }, 300_000);

  it("deletes only the confirmed active career, its world and snapshots, and answers busy while it runs", async () => {
    await generateWorld(ownerWorld, { ...fixture, seed: "deleted-owner-world" });
    await ownerWorld.setMeta("appearanceIndexVersion", 1);
    const ownerSaves = new Saves(ownerWorld);
    const initial = await stateOf(ownerWorld);
    await ownerWorld.setMeta("state", { ...initial, started: true, careerId: "kept-owner-career", careerName: "Kept career" });
    const kept = await ownerSaves.create("Kept career snapshot");
    await ownerWorld.setMeta("state", { ...initial, started: true, careerId: "deleted-owner-career", careerName: "Deleted career" });
    const doomed = [await ownerSaves.create("Deleted career first"), await ownerSaves.create("Deleted career autosave", true)];
    const active = await stateOf(ownerWorld);
    const chunkQuery = "SELECT chunks.ordinal, chunks.data FROM save_chunks AS chunks JOIN save_slots AS slots ON slots.id = chunks.save_id WHERE slots.career_id = ? ORDER BY chunks.ordinal";
    const keptChunks = await ownerWorld.all(chunkQuery, "kept-owner-career");
    expect(keptChunks.length).toBeGreaterThan(0);
    const guestState = await stateOf(root);
    const guestSlots = await new Saves(root).list();
    const confirm = { careerId: active.careerId, seed: active.seed };

    expect((await access("delete", "/api/careers/active").send({})).status).toBe(400);
    expect((await access("delete", "/api/careers/active").send({ seed: active.seed })).status).toBe(400);
    for (const body of [{ ...confirm, careerId: "kept-owner-career" }, { ...confirm, careerId: null }, { ...confirm, seed: "other-seed" }]) {
      const refused = await access("delete", "/api/careers/active").send(body);
      expect(refused.status).toBe(409);
      expect(refused.headers["retry-after"]).toBeUndefined();
      expect(refused.body).toEqual({ error: "The active career changed. Reload it before deleting.", code: "career_mismatch" });
    }
    expect((await access("delete", "/api/careers").send({ file: doomed[0].file })).status).toBe(400);
    expect(await stateOf(ownerWorld)).toEqual(active);
    expect((await ownerSaves.list()).map((slot) => slot.file).sort()).toEqual([kept.file, ...doomed.map((slot) => slot.file)].sort());

    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const discard = ownerWorld.discardWorld.bind(ownerWorld);
    vi.spyOn(ownerWorld, "discardWorld").mockImplementation(async () => {
      entered();
      await gate;
      return discard();
    });
    const pending = access("delete", "/api/careers/active")
      .send({ ...confirm, schema: root.schemaName, userId: guest }).then((response) => response);
    try {
      await Promise.race([started, pending.then(() => { throw new Error("Deletion ended before clearing the world"); })]);
      const session = await access("get", "/api/me").timeout({ response: 20_000 });
      expect(session.body).toMatchObject({ hasWorld: null, activity: { operation: "delete_career", startedAt: expect.any(String) } });
      for (const busy of [
        await access("get", "/api/bootstrap"),
        await access("delete", "/api/careers/active").send(confirm),
      ]) {
        expect(busy.status).toBe(409);
        expect(busy.headers["retry-after"]).toBe("2");
        expect(busy.body).toMatchObject({ code: "world_busy", operation: "delete_career", startedAt: session.body.activity.startedAt });
      }
      expect((await access("get", "/api/bootstrap", guest).timeout({ response: 20_000 })).status).toBe(200);
    } finally {
      release();
      await pending;
    }
    const deleted = await pending;
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ deleted: true, careerId: "deleted-owner-career", snapshots: 2, message: expect.any(String) });
    expect((await access("get", "/api/me")).body).toMatchObject({ hasWorld: false, activity: null });
    expect((await access("get", "/api/bootstrap")).body).toBeNull();
    expect((await access("get", "/api/saves")).body.map((slot: SaveSlot) => slot.file)).toEqual([kept.file]);
    expect(await ownerWorld.all(chunkQuery, "kept-owner-career")).toEqual(keptChunks);
    expect(await ownerWorld.all(chunkQuery, "deleted-owner-career")).toEqual([]);
    expect(await ownerWorld.all("SELECT key, value FROM meta")).toEqual([{ key: "appearanceIndexVersion", value: "1" }]);
    const counts = await ownerWorld.all<{ rows: number }>(WORLD_TABLES.filter((table) => table !== "meta").map((table) =>
      `SELECT count(*) AS rows FROM ${tableName(ownerWorld.schemaName, table)}`).join(" UNION ALL "));
    expect(counts).toHaveLength(WORLD_TABLES.length - 1);
    expect(counts.every((count) => count.rows === 0)).toBe(true);
    expect(await stateOf(root)).toEqual(guestState);
    expect(await new Saves(root).list()).toEqual(guestSlots);
    expect((await access("delete", "/api/careers/active").send(confirm)).status).toBe(404);

    const world = await import("./world.ts");
    const generateWorldFixture = world.generateWorld;
    vi.spyOn(world, "generateWorld").mockImplementation((store, options) => generateWorldFixture(store, { ...options, ...fixture }));
    expect((await access("post", "/api/careers/prepare").send({})).body).toEqual({ created: true });
    expect((await access("get", "/api/me")).body).toMatchObject({ hasWorld: true, activity: null });
    expect((await ownerSaves.list()).map((slot) => slot.file)).toEqual([kept.file]);
  }, 300_000);

  it("does not make another user's mutation wait for an in-flight reader", async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    vi.spyOn(ownerWorld, "all").mockImplementationOnce(async () => {
      entered();
      await gate;
      return [];
    });
    const pending = access("get", "/api/clubs").then((response) => response);
    try {
      await Promise.race([started, pending.then(() => { throw new Error("Reader ended before its query"); })]);
      expect((await access("patch", "/api/settings", guest).send({ currency: "EUR" })
        .timeout({ response: 20_000 })).status).toBe(200);
    } finally {
      release();
      await pending;
    }
    expect((await pending).status).toBe(200);
  });

  it("imports and loads into an empty world without transferring the authenticated account or touching the source", async () => {
    const before = await stateOf(root);
    const exported = await new Saves(root).export();
    try {
      const imported = await access("post", "/api/saves/import")
        .set("Content-Type", "application/gzip").send(await readFile(exported.file));
      expect(imported.status).toBe(200);
      expect((await access("get", "/api/me")).body).toMatchObject({ user: { id: "owner-account", displayName: "Owner Director" }, hasWorld: true });
      expect((await access("get", "/api/health/details")).body.schema).toBe(ownerWorld.schemaName);
      const slots = await new Saves(ownerWorld).list();
      expect(slots).toHaveLength(1);
      expect(slots[0].file).not.toBe(baseline.file);
      await ownerWorld.transaction(() => ownerWorld.clearWorld());
      const loaded = await access("post", "/api/careers/load").send({ file: slots[0].file });
      expect(loaded.status).toBe(200);
      expect(loaded.body.archived).toBeNull();
      expect(await new Saves(ownerWorld).list()).toHaveLength(1);
      await ownerWorld.transaction(() => ownerWorld.clearWorld());
      expect((await access("post", "/api/saves/restore").send({ file: slots[0].file })).status).toBe(200);
      await ownerWorld.transaction(() => ownerWorld.clearWorld());
      const deleted = await access("delete", "/api/careers").send({ file: slots[0].file });
      expect(deleted.status).toBe(200);
      expect(deleted.body.deleted).toBe(1);
      expect((await access("get", "/api/me")).body.hasWorld).toBe(false);
      expect(await stateOf(root)).toEqual(before);
      expect((await new Saves(root).list()).map((slot) => slot.file)).toEqual([baseline.file]);
      expect((await access("get", "/api/me", guest)).body.user.id).toBe("guest-account");
    } finally {
      await rm(exported.file, { force: true });
    }
  }, 300_000);

  it("uses an explicit local identity and ignores forged identity headers and resolver injection in no-auth mode", async () => {
    vi.stubEnv("API_HOST", "127.0.0.1");
    vi.stubEnv("REQUIRE_AUTH", "false");
    vi.stubEnv("APP_ORIGIN", undefined);
    const resolve = vi.fn(async () => { throw new Error("Local mode must not use a hosted identity"); });
    const local = createApp(ownerWorld, { resolve });
    const response = await request(local).get("/api/me").set("Cookie", signedIn(guest));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: { id: "local", username: "local", displayName: "Local director", email: null, admin: false },
      hasWorld: false, activity: null });
    expect(resolve).not.toHaveBeenCalled();
    expect((await request(local).get("/api/me").set("Host", "untrusted.example")
      .set("Cookie", signedIn(owner))).status).toBe(403);
  });
});

async function expectSchemaIntegrity(store: Store) {
  const tables = await store.all<{ name: string }>(
    "SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = ? ORDER BY tablename",
    store.schemaName,
  );
  expect(tables.length).toBeGreaterThan(0);
  // PostgreSQL keeps every validated constraint true for all rows; only NOT VALID constraints
  // or disabled (foreign-key) triggers could let inconsistent rows in.
  expect(
    await store.all(
      "SELECT conrelid::regclass::text AS table_name, conname FROM pg_catalog.pg_constraint WHERE connamespace = ?::regnamespace AND NOT convalidated",
      store.schemaName,
    ),
  ).toEqual([]);
  expect(
    await store.all(
      "SELECT tgrelid::regclass::text AS table_name, tgname FROM pg_catalog.pg_trigger JOIN pg_catalog.pg_class ON pg_class.oid = pg_trigger.tgrelid WHERE pg_class.relnamespace = ?::regnamespace AND pg_trigger.tgenabled = 'D'",
      store.schemaName,
    ),
  ).toEqual([]);
}

describe.skipIf(!sqlIntegration)("game HTTP API and SQL saves", () => {
  let store: Store;
  let app: Awaited<ReturnType<typeof createApp>>;
  beforeAll(async () => {
    store = await Store.createTest("http-api");
    await generateWorld(store, { nations: ["SCO", "IE"], squads: "minimum", seed: "http-api" });
    await createCalendar(store);
    await initialInbox(store);
    await store.setMeta("state", { ...await stateOf(store), started: true });
    app = await createApp(store);
  });
  afterAll(async () => {
    await store?.close();
  });

  it("reports the isolated SQL test schema without exposing a database file", async () => {
    const response = await request(app).get("/api/health/details");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      databaseName: store.database,
      schema: store.schemaName,
      testCareer: true,
    });
    expect(response.body.schema).toMatch(/^touchline_test_/);
    expect(response.body.schema).not.toBe("dbo");
    expect(response.body).not.toHaveProperty("path");
  });

  it("serves a player's GBE breakdown and validates the date", async () => {
    const { id } = (await store.get<{ id: number }>(
      "SELECT id FROM players WHERE age_group = 'Senior' AND club_id IS NOT NULL ORDER BY ability DESC, id LIMIT 1",
    ))!;
    const response = await request(app).get(`/api/players/${id}/gbe`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ playerId: id, ruleset: "fa-2026-27", passMark: 15 });
    expect(response.body.breakdown).toHaveLength(6);
    expect((await request(app).get(`/api/players/${id}/gbe?asOf=2027-01-01`)).body.asOf).toBe("2027-01-01");
    expect((await request(app).get(`/api/players/${id}/gbe?asOf=soon`)).status).toBe(400);
    expect((await request(app).get("/api/players/99999999/gbe")).status).toBe(404);
  });

  it("groups snapshots by career identity without merging unrelated or legacy saves", () => {
    const slot = (
      name: string,
      id: string | undefined,
      automatic: boolean,
      day: number,
    ): SaveSlot => ({
      file: `${randomUUID()}.touchline.gz`,
      name,
      automatic,
      compressed: true,
      size: 100,
      modified: `2026-07-${String(day).padStart(2, "0")}T12:00:00.000Z`,
      ...(id
        ? {
            career: {
              id,
              name: "My career",
              director: "Alex",
              club: "Northbridge",
              date: "2026-07-01",
              season: 2026,
            },
          }
        : {}),
    });
    const slots = [
      slot("manual", "one", false, 1),
      slot("auto-old", "one", true, 2),
      slot("auto-new", "one", true, 3),
      slot("other", "two", true, 4),
      slot("legacy-one", undefined, true, 1),
      slot("legacy-two", undefined, true, 2),
    ];
    const original = JSON.stringify(slots);
    const groups = groupCareerSaves(slots);
    expect(groups).toHaveLength(4);
    expect(groups[0].latest.file).toBe(slots[3].file);
    const career = groups.find((group) => group.key === "career:one")!;
    expect(career.autosaves.map((save) => save.file)).toEqual([
      slots[2].file,
      slots[1].file,
    ]);
    expect(career.manual).toHaveLength(1);
    expect(career.count).toBe(3);
    expect(career.size).toBe(300);
    expect(groupCareerSaves(slots, "manual")[0].count).toBe(3);
    expect(groupCareerSaves(slots, "nonexistent")).toHaveLength(0);
    expect(JSON.stringify(slots)).toBe(original);
  });

  it("serves real persistent player pages and supports combined indexed and attribute filters", async () => {
    const response = await request(app).get(
      "/api/players?position=ST&ageMax=23&potentialMin=60&pageSize=10",
    );
    expect(response.status).toBe(200);
    expect(response.body.players.length).toBeLessThanOrEqual(10);
    expect(
      response.body.players.every(
        (player: { position: string; age: number; potential: number }) =>
          player.position === "ST" &&
          player.age <= 23 &&
          player.potential >= 60,
      ),
    ).toBe(true);
    const attributes = await request(app).get(
      "/api/players?attribute=passing&attributeMin=70&personality=professionalism&personalityMin=50",
    );
    expect(attributes.status).toBe(200);
    expect(attributes.body.total).toBeGreaterThan(0);
  });

  it("filters numeric ranges from both ends and scopes clubs by country, league and division", async () => {
    type Row = { id: number; age: number; ability: number; club_id: number | null; contract_end: string };
    const count = async (where: string, ...params: (number | string)[]) =>
      (await store.get<{ count: number }>(
        `SELECT count(*) AS count FROM players WHERE role <> 'Retired' AND ${where}`,
        ...params,
      ))!.count;
    // A reversed pair is searched in order.
    const between = await request(app)
      .get("/api/players")
      .query({ ageMin: 21, ageMax: 18, abilityMin: 40, abilityMax: 70, pageSize: 100 });
    expect(between.status).toBe(200);
    expect(between.body.total).toBe(
      Math.min(10_000, await count("age BETWEEN 18 AND 21 AND ability BETWEEN 40 AND 70")),
    );
    expect(between.body.total).toBeGreaterThan(0);
    for (const player of between.body.players as Row[]) {
      expect(player.age).toBeGreaterThanOrEqual(18);
      expect(player.age).toBeLessThanOrEqual(21);
      expect(player.ability).toBeGreaterThanOrEqual(40);
      expect(player.ability).toBeLessThanOrEqual(70);
    }
    const league = (await store.get<{ id: number; country_id: number }>(
      "SELECT leagues.id, leagues.country_id FROM leagues WHERE kind = 'league' AND age_group = 'Senior' AND tier = 1 AND EXISTS (SELECT 1 FROM clubs WHERE clubs.league_id = leagues.id) ORDER BY leagues.id LIMIT 1",
    ))!;
    const clubs = await request(app)
      .get("/api/world/clubs")
      .query({ league: league.id, sort: "name", direction: "asc", pageSize: 100 });
    expect(clubs.status).toBe(200);
    const clubIds = new Set<number>(clubs.body.clubs.map((club: { id: number }) => club.id));
    expect(clubs.body.total).toBe(
      (await store.get<{ count: number }>("SELECT count(*) AS count FROM clubs WHERE league_id = ?", league.id))!.count,
    );
    expect(clubs.body.clubs.every((club: { league_id: number }) => club.league_id === league.id)).toBe(true);
    const inLeague = await request(app).get("/api/players").query({ league: league.id, pageSize: 100 });
    expect(inLeague.status).toBe(200);
    expect(inLeague.body.total).toBe(
      await count("club_id IN (SELECT id FROM clubs WHERE league_id = ?)", league.id),
    );
    expect((inLeague.body.players as Row[]).every((player) => clubIds.has(player.club_id!))).toBe(true);
    const club = [...clubIds][0];
    const atClub = await request(app).get("/api/players").query({ league: league.id, club, pageSize: 100 });
    expect(atClub.body.total).toBe(await count("club_id = ?", club));
    const topFlight = await request(app)
      .get("/api/players")
      .query({ clubCountry: league.country_id, tierMax: 1, pageSize: 10 });
    expect(topFlight.status).toBe(200);
    expect(topFlight.body.total).toBe(
      await count(
        "club_id IN (SELECT clubs.id FROM clubs JOIN leagues ON leagues.id = clubs.league_id WHERE clubs.country_id = ? AND leagues.tier = 1)",
        league.country_id,
      ),
    );
    // Contract ranges count whole months from today.
    const { date } = await stateOf(store);
    const expiring = await request(app)
      .get("/api/players")
      .query({ contractMonthsMin: 12, contractMonthsMax: 24, pageSize: 100 });
    expect(expiring.status).toBe(200);
    expect(expiring.body.total).toBe(
      Math.min(
        10_000,
        await count("contract_end >= ? AND contract_end <= ?", addMonths(date, 12), addMonths(date, 24)),
      ),
    );
    for (const player of expiring.body.players as Row[]) {
      expect(player.contract_end >= addMonths(date, 12)).toBe(true);
      expect(player.contract_end <= addMonths(date, 24)).toBe(true);
    }
    expect((await request(app).get("/api/players").query({ abilityMax: 100 })).status).toBe(400);
  });

  it("checks profile-JSON filters on a bounded candidate set in sort order and reports a lower bound", async () => {
    const query = { position: "CM", attribute: "passing", attributeMin: 50, sort: "ability", direction: "desc", pageSize: 10 };
    const passing =
      "(profile::jsonb #>> '{attributes,technical,passing}')::double precision + (ability - coalesce((profile::jsonb #>> '{baseAbility}')::double precision, ability)) >= 50";
    const candidates = (await store.all<{ id: number }>(
      "SELECT id FROM players WHERE role <> 'Retired' AND position = 'CM' ORDER BY ability DESC, lower(name), id LIMIT 40",
    )).map((row) => row.id);
    const expected = (await store.all<{ id: number }>(
      `SELECT id FROM players WHERE id = ANY(?::int[]) AND ${passing} ORDER BY ability DESC, lower(name), id`,
      candidates,
    )).map((row) => row.id);
    expect(expected.length).toBeGreaterThanOrEqual(10);
    playerSearchChanged(store);
    const bounded = await store.readTransaction(() => searchPlayers(store, query, { profileCandidates: 40 }));
    // Only the 40 best central midfielders were checked: the total is a lower bound, the first page is exact.
    expect(bounded).toMatchObject({ total: expected.length, totalCapped: true });
    expect(bounded.players.map((player) => player.id)).toEqual(expected.slice(0, 10));
    const exact = await store.readTransaction(() => searchPlayers(store, query));
    expect(exact).toMatchObject({
      total: (await store.get<{ count: number }>(
        `SELECT count(*) AS count FROM players WHERE role <> 'Retired' AND position = 'CM' AND ${passing}`,
      ))!.count,
      totalCapped: false,
    });
    expect(exact.players.map((player) => player.id)).toEqual(expected.slice(0, 10));
    // Height and weight are indexed columns now, equal to the profile values.
    expect(await store.get(
      "SELECT count(*) AS mismatched FROM players WHERE height IS DISTINCT FROM (profile::jsonb #>> '{identity,height}')::double precision OR weight IS DISTINCT FROM (profile::jsonb #>> '{identity,weight}')::double precision",
    )).toEqual({ mismatched: 0 });
  });

  it("pages and sorts player searches consistently with exact totals below the cap", async () => {
    const active = (await store.get<{ count: number }>(
      "SELECT count(*) AS count FROM players WHERE role <> 'Retired'",
    ))!.count;
    const all = await request(app).get("/api/players").query({ pageSize: 100 });
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(active);
    // The unfiltered search always reports the exact number of active players.
    expect(all.body.totalCapped).toBe(false);
    expect(all.body.pages).toBe(Math.max(1, Math.ceil(active / 100)));
    const ordered = all.body.players.map((player: { ability: number }) => player.ability);
    expect(ordered).toEqual([...ordered].sort((left, right) => right - left));
    // Same filter, other sort and page: the cached match set must give the same total and disjoint pages.
    const expected = await store.all<{ id: number }>(
      "SELECT id FROM players WHERE role <> 'Retired' AND position = 'ST' ORDER BY value ASC, lower(name) ASC, id ASC LIMIT 20",
    );
    const first = await request(app).get("/api/players").query({ position: "ST", sort: "value", direction: "asc", pageSize: 10 });
    const second = await request(app).get("/api/players").query({ position: "ST", sort: "value", direction: "asc", pageSize: 10, page: 2 });
    expect(second.body.total).toBe(first.body.total);
    expect([...first.body.players, ...second.body.players].map((player: { id: number }) => player.id)).toEqual(
      expected.map((row) => row.id),
    );
    // JSON-filtered searches rank their known match set; sorting by a JSON value keeps missing values last.
    const tall = await request(app).get("/api/players").query({ heightMin: 150, sort: "height", direction: "desc", pageSize: 100 });
    expect(tall.status).toBe(200);
    const heights = tall.body.players.map((player: { height: number | null }) => player.height ?? -1);
    expect(heights).toEqual([...heights].sort((left, right) => right - left));
  });

  it("filters explicit youth contract status without treating legacy contracts as free", async () => {
    const amateur = await request(app)
      .get("/api/players")
      .query({ contractStatus: "amateur", pageSize: 100 });
    expect(amateur.status).toBe(200);
    expect(amateur.body.total).toBeGreaterThan(0);
    for (const player of amateur.body.players)
      expect(
        JSON.parse(
          (await store.get<{ profile: string }>(
            "SELECT profile FROM players WHERE id = ?",
            player.id,
          ))!.profile,
        ).contract.status,
      ).toBe("amateur");
    expect(
      (
        await request(app)
          .get("/api/players")
          .query({ contractStatus: "unprotected" })
      ).status,
    ).toBe(400);
  });

  it("returns every major screen without placeholder data or SQL errors", async () => {
    for (const path of [
      "bootstrap",
      "dashboard",
      "squad",
      "scouting",
      "transfers",
      "loans",
      "staff",
      "assistant",
      "affiliates",
      "events",
      "training",
      "academy",
      "finances",
      "media",
      "leagues/1",
      "matches",
      "players/1",
      "players/1/interest",
      "world/clubs",
      "clubs/1",
    ]) {
      const response = await request(app).get(`/api/${path}`);
      expect(response.status, path).toBe(200);
    }
  });

  it("finds a player by secondary nationality and exposes all recorded nationalities", async () => {
    const player = (await store.get<{
      id: number;
      profile: string;
      country_id: number;
    }>(
      "SELECT id,profile,country_id FROM players WHERE country_id <> 1 ORDER BY id LIMIT 1",
    ))!;
    const profile = JSON.parse(player.profile);
    try {
      profile.identity.nationalities = [
        {
          countryId: player.country_id,
          code: "ES",
          country: "Spain",
          basis: "birth",
        },
        { countryId: 1, code: "EN", country: "England", basis: "parent" },
      ];
      await store.run(
        "UPDATE players SET profile = ? WHERE id = ?",
        JSON.stringify(profile),
        player.id,
      );
      // Nationalities are fixed at creation in the game; this direct edit bypasses every mutation route.
      playerSearchChanged(store, true);
      const response = await request(app)
        .get("/api/players")
        .query({
          country: 1,
          q: (await store.get<{ name: string }>(
            "SELECT name FROM players WHERE id = ?",
            player.id,
          ))!.name,
          pageSize: 100,
        });
      expect(response.status).toBe(200);
      expect(
        response.body.players.some(
          (entry: { id: number; nationalities: string[] }) =>
            entry.id === player.id && entry.nationalities.includes("England"),
        ),
      ).toBe(true);
      const dossier = await request(app).get(`/api/players/${player.id}`);
      // The v4 fixture's clubs are Scottish and Irish; the FA endorsement applies only to English clubs.
      expect(dossier.body.eligibility.association.gbe).toBeUndefined();
      if (dossier.body.signing)
        expect(dossier.body.signing.registration).toMatchObject({
          status: "registered",
          reasons: [expect.stringMatching(/^No work-permit endorsement is required/)],
        });
    } finally {
      await store.run(
        "UPDATE players SET profile = ? WHERE id = ?",
        player.profile,
        player.id,
      );
      playerSearchChanged(store, true);
    }
  });

  it("persists favorite competitions, emits result alerts once, and mutes topics without deleting their archive", async () => {
    const originalState = await stateOf(store);
    const settings = await store.meta("settings");
    const fixture = (await store.get<{
      id: number;
      date: string;
      league_id: number;
      status: string;
      home_goals: number | null;
      away_goals: number | null;
    }>(
      "SELECT id,date,league_id,status,home_goals,away_goals FROM fixtures WHERE league_id = 1 ORDER BY date LIMIT 1",
    ))!;
    try {
      expect(
        (
          await request(app)
            .put("/api/competitions/1/favorite")
            .send({ active: true, events: { fixtures: false, results: true } })
        ).status,
      ).toBe(200);
      expect(
        (await request(app).get("/api/competitions/favorites")).body[0]
          .leagueId,
      ).toBe(1);
      await store.run(
        "UPDATE fixtures SET status = 'played',home_goals = 2,away_goals = 1 WHERE id = ?",
        fixture.id,
      );
      await store.setMeta("state", { ...originalState, date: fixture.date });
      await processCompetitionNotifications(store);
      await processCompetitionNotifications(store);
      const feed = await request(app)
        .get("/api/news")
        .query({ category: "Competitions" });
      expect(feed.body).toHaveLength(1);
      expect(JSON.parse(feed.body[0].data).notificationType).toBe("results");
      expect(feed.body[0].body).toContain("2-1");
      expect(
        (
          await request(app)
            .patch("/api/settings")
            .send({ notifyCompetitions: false })
        ).status,
      ).toBe(200);
      expect(
        (
          await request(app)
            .get("/api/news")
            .query({ category: "Competitions" })
        ).body,
      ).toHaveLength(0);
      expect(
        (
          await request(app)
            .get("/api/news")
            .query({ category: "Competitions", archive: "1" })
        ).body,
      ).toHaveLength(1);
      await request(app)
        .put("/api/competitions/1/favorite")
        .send({ active: false });
      expect(
        (await request(app).get("/api/competitions/favorites")).body,
      ).toHaveLength(0);
    } finally {
      await store.setMeta("state", originalState);
      await store.setMeta("settings", settings);
      await store.run(
        "UPDATE fixtures SET status = ?,home_goals = ?,away_goals = ? WHERE id = ?",
        fixture.status,
        fixture.home_goals,
        fixture.away_goals,
        fixture.id,
      );
      await store.run("DELETE FROM competition_favorites WHERE league_id = 1");
      await store.run("DELETE FROM news WHERE category = 'Competitions'");
    }
  });

  it("browses every team through pagination and returns linked club profiles", async () => {
    const total = (await store.get<{ count: number }>(
      "SELECT count(*) AS count FROM clubs",
    ))!.count;
    const ids = new Set<number>();
    let page = 1;
    while (true) {
      const response = await request(app)
        .get("/api/world/clubs")
        .query({ page, pageSize: 100 });
      expect(response.status).toBe(200);
      expect(response.body.total).toBe(total);
      for (const club of response.body.clubs) ids.add(club.id);
      if (page >= response.body.pages) break;
      page++;
    }
    expect(ids.size).toBe(total);
    const countries = await request(app)
      .get("/api/world/clubs")
      .query({ type: "national", country: 1 });
    // Senior, U21, U20, U19 and U17.
    expect(countries.body.total).toBe(5);
    const profile = await request(app).get("/api/clubs/1");
    expect(profile.body.players.length).toBeGreaterThan(0);
    expect(profile.body.competitions.length).toBeGreaterThan(0);
    expect(
      profile.body.players.every(
        (player: { club_id: number }) => player.club_id === 1,
      ),
    ).toBe(true);
  });

  it("orders career clubs by country, division and name with consistent pagination and league labels", async () => {
    const original = await stateOf(store);
    const expected = await store.all<{ id: number }>(
      "SELECT clubs.id FROM clubs JOIN countries ON countries.id = clubs.country_id JOIN leagues ON leagues.id = clubs.league_id WHERE clubs.type = 'club' ORDER BY lower(countries.name),leagues.tier,lower(clubs.name),clubs.id LIMIT 20",
    );
    const ids: number[] = [];
    for (const page of [1, 2]) {
      const response = await request(app)
        .get("/api/world/clubs")
        .query({ type: "club", sort: "division", pageSize: 10, page });
      expect(response.status).toBe(200);
      for (const club of response.body.clubs) {
        ids.push(club.id);
        expect(club.league_name).toBeTruthy();
        expect(club.tier).toBeGreaterThanOrEqual(1);
      }
    }
    expect(ids).toEqual(expected.map((club) => club.id));
    // v4 models Scotland (country 1) and Ireland with one senior division each.
    const division = await request(app).get("/api/world/clubs").query({
      type: "club",
      sort: "division",
      country: 1,
      tier: 1,
      pageSize: 100,
    });
    expect(division.status).toBe(200);
    expect(division.body.clubs.length).toBeGreaterThan(0);
    expect(
      division.body.clubs.every(
        (club: { country_id: number; tier: number }) =>
          club.country_id === 1 && club.tier === 1,
      ),
    ).toBe(true);
    expect(await stateOf(store)).toEqual(original);
  });

  it("validates minor application evidence and does not accept a parental exception from request data", async () => {
    const original = await stateOf(store);
    // The v4 fixture (SCO, IE) has no EU/EEA club pair: an Irish club registers a club-less, never-registered
    // Scottish-Spanish youth, the EU/EEA 16-17 route.
    const irish = (await store.get<{ id: number }>(
      "SELECT MIN(clubs.id) AS id FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE clubs.type = 'club' AND countries.code = 'IE'",
    ))!;
    const player = (await store.get<{
      id: number;
      profile: string;
      age: number;
      birth_date: string;
      club_id: number;
      squad_club_id: number | null;
      country_id: number;
    }>(
      "SELECT players.id,players.profile,players.age,players.birth_date,players.club_id,players.squad_club_id,players.country_id FROM players JOIN countries ON countries.id = players.country_id WHERE countries.code = 'SCO' AND players.club_id IS NOT NULL AND players.parent_club_id IS NULL AND players.age_group <> 'Senior' ORDER BY players.id LIMIT 1",
    ))!;
    const profile = JSON.parse(player.profile);
    delete profile.registration;
    delete profile.homeBased;
    delete profile.familyMove;
    profile.identity.nationalities = [{ countryId: player.country_id, code: "ES", country: "Spain", basis: "parent" }];
    try {
      await store.setMeta("state", { ...original, clubId: irish.id });
      await store.run(
        "UPDATE players SET age = 17,birth_date = '2009-01-01',club_id = NULL,squad_club_id = NULL,profile = ? WHERE id = ?",
        JSON.stringify(profile),
        player.id,
      );
      const safeguards = {
        football: true,
        education: true,
        care: true,
        mentor: true,
        parentalConsent: true,
      };
      expect(
        (
          await request(app)
            .post("/api/action")
            .send({
              type: "minor-application",
              playerId: player.id,
              safeguards: { ...safeguards, parentalConsent: false },
            })
        ).status,
      ).toBe(400);
      expect(
        (
          await request(app).post("/api/action").send({
            type: "minor-application",
            playerId: player.id,
            safeguards,
          })
        ).status,
      ).toBe(200);
      expect(
        (await request(app).get(`/api/players/${player.id}`)).body.youthTransfer
          .application.status,
      ).toBe("pending");
      expect(
        (
          await request(app).post("/api/action").send({
            type: "minor-application",
            playerId: player.id,
            safeguards,
          })
        ).status,
      ).toBe(400);
      await store.run(
        "DELETE FROM minor_applications WHERE player_id = ?",
        player.id,
      );
      await store.run(
        "UPDATE players SET age = 15,birth_date = '2011-01-01' WHERE id = ?",
        player.id,
      );
      expect(
        (
          await request(app)
            .post("/api/action")
            .send({
              type: "minor-application",
              playerId: player.id,
              safeguards,
              familyMove: {
                verified: true,
                reason: "employment",
                countryId: 3,
              },
            })
        ).status,
      ).toBe(400);
      expect(
        await store.all(
          "SELECT id FROM minor_applications WHERE player_id = ?",
          player.id,
        ),
      ).toHaveLength(0);
    } finally {
      await store.setMeta("state", original);
      await store.run(
        "UPDATE players SET age = ?,birth_date = ?,profile = ?,club_id = ?,squad_club_id = ? WHERE id = ?",
        player.age,
        player.birth_date,
        player.profile,
        player.club_id,
        player.squad_club_id,
        player.id,
      );
    }
  });

  it("previews player interest without making offers or altering the career", async () => {
    const state = await stateOf(store);
    const before = await store.all(
      "SELECT id,club_id,wage,morale FROM players ORDER BY id",
    );
    const negotiations = await store.all("SELECT * FROM negotiations ORDER BY id");
    const result = await request(app)
      .get("/api/players/1/interest")
      .query({
        wage: 5000,
        role: "Squad player",
        years: 3,
        promises: JSON.stringify(["Youth pathway"]),
      });
    expect(result.status).toBe(200);
    expect(result.body.factors.length).toBeGreaterThan(5);
    expect(
      (
        await request(app)
          .get("/api/players/1/interest")
          .query({ promises: "not-json" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .get("/api/players/1/interest")
          .query({ promises: JSON.stringify(["Invalid promise"]) })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .get("/api/players/1/interest")
          .query({ negotiationId: 999999 })
      ).status,
    ).toBe(400);
    expect(await store.all("SELECT * FROM negotiations ORDER BY id")).toEqual(negotiations);
    expect(
      await store.all("SELECT id,club_id,wage,morale FROM players ORDER BY id"),
    ).toEqual(before);
    expect(await stateOf(store)).toEqual(state);
  });

  it("shows rival pursuits on the transfer desk and interest preview only as fogged views", async () => {
    const state = await stateOf(store);
    const target = (await store.get<{ id: number; club_id: number; wage: number; profile: string }>(
      "SELECT id,club_id,wage,profile FROM players WHERE club_id IS NOT NULL AND club_id <> ? AND role <> 'Retired' AND age_group = 'Senior' ORDER BY ability DESC,id LIMIT 1",
      state.clubId,
    ))!;
    const rival = (await store.get<{ id: number }>(
      "SELECT id FROM clubs WHERE type = 'club' AND id NOT IN (?,?) ORDER BY id LIMIT 1",
      state.clubId,
      target.club_id,
    ))!;
    const fee = 7_654_321;
    const id = Number(
      (
        await store.run(
          "INSERT INTO negotiations(player_id,buying_club_id,selling_club_id,type,stage,asking_price,offer,wage,interest,created,deadline,data) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          target.id,
          state.clubId,
          target.club_id,
          "Permanent transfer",
          "Club talks",
          10_000_000,
          0,
          target.wage,
          70,
          state.date,
          state.date,
          JSON.stringify({
            workflowVersion: 2,
            log: [],
            agent: JSON.parse(target.profile).agent,
            years: 4,
            role: "Regular starter",
            promises: [],
            rivals: [{ clubId: rival.id, since: state.date, status: "bid", fee, wage: 54_321, interest: 90, raises: 0, nextAction: state.date, source: "market" }],
          }),
        )
      ).lastInsertRowid,
    );
    try {
      const desk = await request(app).get("/api/transfers");
      expect(desk.status).toBe(200);
      const talks = desk.body.negotiations.find((negotiation: { id: number }) => negotiation.id === id);
      expect(JSON.parse(talks.data)).not.toHaveProperty("rivals");
      expect(talks.rivals).toHaveLength(1);
      expect(JSON.stringify(desk.body)).not.toContain(String(fee));
      const interest = await request(app).get(`/api/players/${target.id}/interest`);
      expect(interest.status).toBe(200);
      expect(interest.body.rivals).toHaveLength(1);
      expect(JSON.stringify(interest.body)).not.toContain(String(fee));
    } finally {
      await store.run("DELETE FROM negotiations WHERE id = ?", id);
    }
  });

  it("validates assistant delegation, event preferences and board affiliate actions", async () => {
    const assistant = await request(app).get("/api/assistant");
    expect(assistant.body.assistant.role).toBe("Sporting director assistant");
    expect(
      (
        await request(app)
          .post("/api/action")
          .send({
            type: "assistant-duties",
            duties: { ...DEFAULT_ASSISTANT_DUTIES, loans: true },
            weeklyBudget: 0,
          })
      ).status,
    ).toBe(200);
    expect((await request(app).get("/api/assistant")).body.duties.loans).toBe(
      true,
    );
    expect(
      (
        await request(app)
          .post("/api/action")
          .send({
            type: "assistant-duties",
            duties: { ...DEFAULT_ASSISTANT_DUTIES, sellPlayers: true },
            weeklyBudget: 0,
          })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .patch("/api/settings")
          .send({ unexpectedEvents: "high" })
      ).status,
    ).toBe(200);
    expect((await request(app).get("/api/events")).body.frequency).toBe("high");
    expect(
      (
        await request(app)
          .patch("/api/settings")
          .send({ unexpectedEvents: "always" })
      ).status,
    ).toBe(400);
    const event = await createUnexpectedEvent(store, "sponsor");
    expect(
      (
        await request(app)
          .post("/api/action")
          .send({ type: "event-response", id: event, choiceId: "invented" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/action")
          .send({ type: "event-response", id: event, choiceId: "decline" })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/action")
          .send({ type: "event-response", id: event, choiceId: "decline" })
      ).status,
    ).toBe(400);
    const state = await stateOf(store);
    const before = (await store.get<{ balance: number }>(
      "SELECT balance FROM clubs WHERE id = ?",
      state.clubId,
    ))!.balance;
    expect(
      (
        await request(app)
          .post("/api/action")
          .send({ type: "affiliate-request", purpose: "Development club" })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/action")
          .send({ type: "affiliate-request", purpose: "Scouting club" })
      ).status,
    ).toBe(400);
    expect(
      (await request(app).get("/api/affiliates")).body.requests[0].status,
    ).toBe("pending");
    expect(
      (await store.get<{ balance: number }>(
        "SELECT balance FROM clubs WHERE id = ?",
        state.clubId,
      ))!.balance,
    ).toBe(before);
    expect(
      (
        await request(app)
          .patch("/api/settings")
          .send({ unexpectedEvents: "medium" })
      ).status,
    ).toBe(200);
  });

  it("rejects malformed actions, injection attempts and remote origins while ignoring retired sync settings", async () => {
    expect(
      (
        await request(app).get(
          "/api/players?sort=ability;DROP%20TABLE%20players",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/action")
          .send({ type: "role", playerId: 1, role: "invalid" })
      ).status,
    ).toBe(400);
    const previousSync = (await store.meta<Record<string, unknown>>("settings")).cloudSync;
    expect(
      (await request(app).patch("/api/settings").send({ cloudSync: true }))
        .status,
    ).toBe(200);
    expect((await store.meta<Record<string, unknown>>("settings")).cloudSync).toBe(previousSync);
    expect(
      (
        await request(app)
          .post("/api/action")
          .set("Origin", "https://example.com")
          .send({ type: "read-news" })
      ).status,
    ).toBe(403);
    expect(
      (await request(app).post("/api/advance").send({ days: 100 })).status,
    ).toBe(400);
  });

  it("searches player names and treats SQL wildcard characters literally", async () => {
    const player = (await store.get<{ name: string }>(
      "SELECT name FROM players WHERE id = 1",
    ))!;
    const response = await request(app)
      .get("/api/players")
      .query({ q: player.name });
    expect(response.status).toBe(200);
    expect(
      response.body.players.some(
        (entry: { name: string }) => entry.name === player.name,
      ),
    ).toBe(true);
    const literalWildcard = await request(app)
      .get("/api/players")
      .query({ q: "%" });
    expect(literalWildcard.status).toBe(200);
    expect(literalWildcard.body.total).toBe(0);
  });

  it("persists local settings across reads", async () => {
    expect(
      (
        await request(app)
          .patch("/api/settings")
          .send({ theme: "dark", injuryFrequency: 20 })
      ).status,
    ).toBe(200);
    const response = await request(app).get("/api/bootstrap");
    expect(response.body.settings.theme).toBe("dark");
    expect(response.body.settings.injuryFrequency).toBe(20);
    expect(response.body.settings.cloudSync).toBe(false);
  });

  it("changes currency without rewriting balances, wages or stored transfer amounts", async () => {
    const before = await store.all(
      "SELECT id,balance,transfer_budget,wage_budget FROM clubs ORDER BY id",
    );
    const wages = await store.all(
      "SELECT id,wage,value FROM players ORDER BY id",
    );
    expect(
      (await request(app).patch("/api/settings").send({ currency: "EUR" }))
        .status,
    ).toBe(200);
    expect(
      (await request(app).get("/api/bootstrap")).body.settings.currency,
    ).toBe("EUR");
    expect(
      await store.all(
        "SELECT id,balance,transfer_budget,wage_budget FROM clubs ORDER BY id",
      ),
    ).toEqual(before);
    expect(
      await store.all("SELECT id,wage,value FROM players ORDER BY id"),
    ).toEqual(wages);
    expect(
      (await request(app).patch("/api/settings").send({ currency: "INVALID" }))
        .status,
    ).toBe(400);
    expect(
      (await request(app).patch("/api/settings").send({ currency: "GBP" }))
        .status,
    ).toBe(200);
  });

  it("exposes consistent club enterprise estimates without changing cash or squad values", async () => {
    const state = await stateOf(store);
    const before = await store.get("SELECT * FROM clubs WHERE id = ?", state.clubId);
    const players = await store.all("SELECT id,value,wage FROM players ORDER BY id");
    const finance = await request(app).get("/api/finances");
    const club = await request(app).get(`/api/clubs/${state.clubId}`);
    expect(finance.status).toBe(200);
    expect(club.status).toBe(200);
    expect(finance.body.valuation).toEqual(club.body.valuation);
    expect(finance.body.valuation.annualOperatingRevenue).toBeGreaterThan(0);
    expect(finance.body.valuation.enterpriseValue).toBe(Math.round(
      finance.body.valuation.annualOperatingRevenue * finance.body.valuation.revenueMultiple,
    ));
    expect(finance.body.valuation.enterpriseValue).not.toBe(finance.body.squadValue);
    expect(await store.get("SELECT * FROM clubs WHERE id = ?", state.clubId)).toEqual(before);
    expect(await store.all("SELECT id,value,wage FROM players ORDER BY id")).toEqual(players);
  });

  it("has no world expansion endpoint: one curated world, nothing to expand", async () => {
    const saves = new Saves(store);
    const state = await stateOf(store);
    const slots = await saves.list();
    expect((await request(app).post("/api/world/expand")).status).toBe(404);
    expect(await stateOf(store)).toEqual(state);
    expect(await saves.list()).toEqual(slots);
  });

  it("restores empty clause schedules and older settings while preserving its career", async () => {
    const saves = new Saves(store);
    const original = await stateOf(store);
    const count = (await store.get<{ count: number }>(
      "SELECT count(*) AS count FROM players",
    ))!.count;
    await store.run("DELETE FROM transfer_payments");
    await store.run("DELETE FROM buy_back_clauses");
    const oldSettings =
      await store.meta<Record<string, string | number | boolean>>("settings");
    delete oldSettings.currency;
    await store.setMeta("settings", oldSettings);
    const legacy = await saves.create("Before contract clauses");
    const savedState = await stateOf(store);
    await saves.restore(legacy.file);
    expect(await stateOf(store)).toEqual(savedState);
    expect((await stateOf(store)).date).toBe(original.date);
    expect(
      (await store.get<{ count: number }>(
        "SELECT count(*) AS count FROM players",
      ))!.count,
    ).toBe(count);
    expect(await store.all("SELECT * FROM transfer_payments")).toEqual([]);
    expect(await store.all("SELECT * FROM buy_back_clauses")).toEqual([]);
    expect((await request(app).get("/api/transfers")).status).toBe(200);
    await expectSchemaIntegrity(store);
  });

  it("adds assistants and starter affiliates to an older save without changing its career or squad", async () => {
    const saves = new Saves(store);
    await store.run("DELETE FROM club_support");
    await store.run(
      "DELETE FROM staff WHERE role = 'Sporting director assistant'",
    );
    await store.run(
      "DELETE FROM partnerships WHERE data::jsonb ->> 'origin' = 'initial'",
    );
    const originalPlayers = await store.all(
      "SELECT id,club_id,wage,contract_end FROM players ORDER BY id",
    );
    const originalClubs = await store.all(
      "SELECT id,balance,transfer_budget FROM clubs ORDER BY id",
    );
    const originalFixtures = await store.all(
      "SELECT id,date,status FROM fixtures ORDER BY id",
    );
    const saved = await saves.create("Before club support");
    const state = await stateOf(store);
    await saves.restore(saved.file);
    expect(await stateOf(store)).toEqual(state);
    expect(
      await store.all(
        "SELECT id,club_id,wage,contract_end FROM players ORDER BY id",
      ),
    ).toEqual(originalPlayers);
    expect(
      await store.all(
        "SELECT id,balance,transfer_budget FROM clubs ORDER BY id",
      ),
    ).toEqual(originalClubs);
    expect(
      await store.all("SELECT id,date,status FROM fixtures ORDER BY id"),
    ).toEqual(originalFixtures);
    expect(
      await store.all(
        "SELECT clubs.id FROM clubs LEFT JOIN staff ON staff.club_id = clubs.id AND staff.role = 'Sporting director assistant' WHERE clubs.type != 'national' GROUP BY clubs.id HAVING count(staff.id) != 1",
      ),
    ).toHaveLength(0);
    const loans = await request(app).get("/api/loans");
    expect(loans.body.partnerships.length).toBeGreaterThanOrEqual(1);
    expect(
      loans.body.partnerships.every(
        (link: { partner_id: number }) => link.partner_id !== state.clubId,
      ),
    ).toBe(true);
  });

  it("creates and restores a catalog checkpoint without losing the career", async () => {
    const saves = new Saves(store);
    const players = async () =>
      (await store.get<{ count: number }>("SELECT count(*) AS count FROM players"))!.count;
    const savedPlayers = await players();
    const slot = await saves.create("Regression save");
    expect(slot.file).toMatch(
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.touchline\.gz$/i,
    );
    expect(await saves.list()).toContainEqual(
      expect.objectContaining({
        file: slot.file,
        name: "Regression save",
        compressed: true,
      }),
    );
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2026-07-20",
    });
    await saves.restore(slot.file);
    expect((await stateOf(store)).date).toBe("2026-07-01");
    expect(savedPlayers).toBeGreaterThan(0);
    expect(await players()).toBe(savedPlayers);
    await expect(saves.restore("../../escape.touchline.gz")).rejects.toThrow(
      "not found",
    );
    await expect(saves.import(Buffer.from("not a database"))).rejects.toThrow(
      /checkpoint|save/i,
    );
  });

  it.each([true, false])(
    "streams portable checkpoints with saveCompression=%s without changing the career",
    async (compressed) => {
      const original = await stateOf(store);
      const settings =
        await store.meta<Record<string, string | number | boolean>>("settings");
      try {
        await store.setMeta("settings", {
          ...settings,
          saveCompression: compressed,
        });
        const exported = await request(app).get("/api/saves/export");
        expect(exported.status).toBe(200);
        expect(Buffer.isBuffer(exported.body)).toBe(true);
        expect(exported.headers["content-disposition"]).toContain(
          ".touchline.gz",
        );
        expect([...exported.body.subarray(0, 2)]).toEqual([0x1f, 0x8b]);
        await store.setMeta("state", { ...original, date: "2026-07-20" });
        const imported = await request(app)
          .post("/api/saves/import")
          .set("Content-Type", "application/octet-stream")
          .send(exported.body);
        expect(imported.status).toBe(200);
        expect(await stateOf(store)).toEqual(original);
        expect(
          (
            await request(app)
              .post("/api/saves/import")
              .set("Content-Type", "application/octet-stream")
              .send(Buffer.from("not a database"))
          ).status,
        ).toBe(400);
        expect(await stateOf(store)).toEqual(original);
        await expectSchemaIntegrity(store);
      } finally {
        await store.setMeta("state", original);
        await store.setMeta("settings", settings);
      }
    },
  );

  it("rolls back a partially restored world and its constraints when a SQL batch fails", async () => {
    const saves = new Saves(store);
    const checkpoint = await saves.create("Restore failure checkpoint");
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2026-07-21",
    });
    const state = await stateOf(store);
    const players = await store.all("SELECT * FROM players ORDER BY id");
    const clubs = await store.all("SELECT * FROM clubs ORDER BY id");
    const fixtures = await store.all("SELECT * FROM fixtures ORDER BY id");
    const catalog = await saves.list();
    const bulkInsert = store.bulkInsert.bind(store);
    const restoredTables: string[] = [];
    const failure = vi
      .spyOn(store, "bulkInsert")
      .mockImplementation(async (...args) => {
        if (args[0] === "players")
          throw new Error("Injected restore batch failure");
        const result = await bulkInsert(...args);
        restoredTables.push(args[0]);
        return result;
      });
    try {
      await expect(saves.restore(checkpoint.file)).rejects.toThrow(
        "Injected restore batch failure",
      );
      expect(restoredTables.length).toBeGreaterThan(0);
      failure.mockRestore();
      expect(await stateOf(store)).toEqual(state);
      expect(await store.all("SELECT * FROM players ORDER BY id")).toEqual(
        players,
      );
      expect(await store.all("SELECT * FROM clubs ORDER BY id")).toEqual(clubs);
      expect(await store.all("SELECT * FROM fixtures ORDER BY id")).toEqual(
        fixtures,
      );
      expect(await saves.list()).toEqual(catalog);
      await expectSchemaIntegrity(store);
    } finally {
      failure.mockRestore();
      await saves.restore(checkpoint.file);
    }
  });

  it("honors daily autosaves during a multi-day calendar advance", async () => {
    await request(app).patch("/api/settings").send({ autosave: "daily" });
    const response = await request(app).post("/api/advance").send({ days: 3 });
    expect(response.status).toBe(200);
    const saves = new Saves(store);
    const autosaves = (await saves.list()).filter((slot) => slot.automatic);
    expect(autosaves).toHaveLength(3);
    expect(autosaves.some((slot) => slot.career?.date === "2026-07-02")).toBe(
      true,
    );
    expect(autosaves.some((slot) => slot.career?.date === "2026-07-04")).toBe(
      true,
    );
  });

  it("commits every advanced day: a failure keeps the earlier days, reports them and logs the cause", async () => {
    await request(app).patch("/api/settings").send({ autosave: "off" });
    const start = (await stateOf(store)).date;
    const failing = addDays(start, 3);
    // A real SQL failure on day 3: PostgreSQL rejects the day's state update, which aborts that day's transaction.
    await store.exec(`CREATE OR REPLACE FUNCTION fail_advance() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.key = 'state' AND NEW.value::jsonb ->> 'date' = '${failing}' THEN
          RAISE EXCEPTION 'injected failure for %', NEW.value::jsonb ->> 'date';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER fail_advance BEFORE INSERT OR UPDATE ON meta FOR EACH ROW EXECUTE FUNCTION fail_advance();`);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const partial = await request(app).post("/api/advance").send({ days: 5 });
      expect(partial.status).toBe(200);
      expect(partial.body).toMatchObject({ from: start, date: addDays(start, 2), days: 2 });
      expect(partial.body.error).toBe(
        `The simulation stopped after ${addDays(start, 2)}; 2 days were simulated and kept. An unexpected server error occurred.`,
      );
      expect((await stateOf(store)).date).toBe(addDays(start, 2));
      const logged = errors.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).toContain(`Touchline: advance_days failed (POST /api/advance after 2 of 5 days, from ${addDays(start, 2)})`);
      expect(logged).toContain(`injected failure for ${failing}`);
      expect(logged).toMatch(/\n\s*at /);
      if (process.env.SQL_PASSWORD) expect(logged).not.toContain(process.env.SQL_PASSWORD);
      errors.mockClear();
      // The same failure on the first day of a request is an error response; nothing is half-done.
      const failed = await request(app).post("/api/advance").send({ days: 3 });
      expect(failed.status).toBe(500);
      expect(failed.body).toEqual({ error: "An unexpected server error occurred." });
      expect((await stateOf(store)).date).toBe(addDays(start, 2));
      expect(errors.mock.calls.map((call) => call.join(" ")).join("\n")).toContain("advance_days failed");
    } finally {
      errors.mockRestore();
      await store.exec("DROP TRIGGER IF EXISTS fail_advance ON meta; DROP FUNCTION IF EXISTS fail_advance();");
    }
    const resumed = await request(app).post("/api/advance").send({ days: 2 });
    expect(resumed.status).toBe(200);
    expect(resumed.body).toMatchObject({ date: addDays(start, 4), days: 2 });
    expect(resumed.body.error).toBeUndefined();
    // The world was never left busy.
    expect((await request(app).get("/api/me")).body.activity ?? null).toBeNull();
  });

  it("deletes only the selected inactive career and protects the active career and database", async () => {
    const saves = new Saves(store);
    const original = await stateOf(store);
    await store.setMeta("state", {
      ...original,
      careerId: "inactive-delete-test",
      careerName: "Old career",
    });
    const first = await saves.create("Old career");
    const second = await saves.create("Old checkpoint");
    await store.setMeta("state", {
      ...original,
      careerId: "active-delete-test",
      careerName: "Keep this career",
    });
    const active = await saves.create("Protected career");
    const activeState = await stateOf(store);
    const chunkQuery =
      "SELECT chunks.ordinal,chunks.data FROM save_chunks AS chunks JOIN save_slots AS slots ON slots.id = chunks.save_id WHERE slots.name = ? ORDER BY chunks.ordinal";
    const activeBytes = await store.all<{ ordinal: number; data: Buffer }>(
      chunkQuery,
      active.name,
    );
    expect(activeBytes.length).toBeGreaterThan(0);
    const inactiveIds = await store.all<{ id: string }>(
      "SELECT id FROM save_slots WHERE name IN (?,?)",
      first.name,
      second.name,
    );
    expect(inactiveIds).toHaveLength(2);
    const beforeSlots = await saves.list();
    expect(
      (await request(app).delete("/api/careers").send({ file: active.file }))
        .status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .delete("/api/careers")
          .send({ file: "../career.touchline.gz" })
      ).status,
    ).toBe(400);
    await expect(saves.deleteCareer(active.file)).rejects.toThrow(
      "active career",
    );
    const response = await request(app)
      .delete("/api/careers")
      .send({ file: first.file });
    expect(response.status).toBe(200);
    expect(response.body.deleted).toBe(2);
    for (const slot of inactiveIds)
      expect(
        await store.all(
          "SELECT save_id FROM save_chunks WHERE save_id = ?",
          slot.id,
        ),
      ).toEqual([]);
    expect(await saves.list()).toEqual(
      beforeSlots.filter(
        (slot) => slot.file !== first.file && slot.file !== second.file,
      ),
    );
    expect(await store.all(chunkQuery, active.name)).toEqual(activeBytes);
    expect(await stateOf(store)).toEqual(activeState);
    expect((await request(app).get("/api/bootstrap")).body.state).toEqual(
      activeState,
    );
    expect(
      (await request(app).delete("/api/careers").send({ file: first.file }))
        .status,
    ).toBe(404);
  });

  it("deletes a legacy snapshot without removing other unknown saves or the current career", async () => {
    const saves = new Saves(store);
    const first = await saves.create("Legacy one");
    const second = await saves.create("Legacy two");
    await store.run(
      "UPDATE save_slots SET career_id = NULL,career_metadata = NULL WHERE name IN (?,?)",
      first.name,
      second.name,
    );
    const original = await stateOf(store);
    const before = await saves.list();
    const response = await request(app)
      .delete("/api/careers")
      .send({ file: first.file });
    expect(response.status).toBe(200);
    expect(response.body.deleted).toBe(1);
    expect(await saves.list()).toEqual(
      before.filter((slot) => slot.file !== first.file),
    );
    expect((await saves.list()).some((slot) => slot.file === second.file)).toBe(
      true,
    );
    expect(await stateOf(store)).toEqual(original);
    expect((await request(app).get("/api/bootstrap")).body.state).toEqual(
      original,
    );
  });

  it("loads the oldest manual save of a career that is at the manual save cap", async () => {
    const saves = new Saves(store);
    const original = await stateOf(store);
    await store.setMeta("state", { ...original, careerId: "load-oldest-at-cap" });
    try {
      const manual = [];
      for (let index = 0; index < 10; index++) manual.push(await saves.create(`Cap ${index}`));
      // A change since the last save forces a real pre-load archive, which is what rotates the manual saves.
      await store.run("UPDATE clubs SET balance = balance + 1 WHERE id = ?", original.clubId);
      const response = await request(app).post("/api/careers/load").send({ file: manual[0].file });
      expect(response.status).toBe(200);
      const career = (await saves.list())
        .filter((slot) => slot.career?.id === "load-oldest-at-cap" && !slot.automatic)
        .map((slot) => slot.file);
      expect(career).toHaveLength(10);
      expect(career).toEqual(expect.arrayContaining([manual[0].file, response.body.archived]));
      expect(career).not.toContain(manual[1].file);
    } finally {
      await store.setMeta("state", original);
    }
  });

  it("lists a club's recorded transfers in and out by season with fees, terms and totals", async () => {
    const state = await stateOf(store);
    const [home, away] = await store.all<{ id: number; name: string }>(
      "SELECT id,name FROM clubs WHERE type = 'club' AND id <> ? ORDER BY id LIMIT 2",
      state.clubId,
    );
    const player = (await store.get<{ id: number; name: string; birth_date: string; position: string }>(
      "SELECT id,name,birth_date,position FROM players WHERE club_id = ? ORDER BY id LIMIT 1",
      home.id,
    ))!;
    const season = state.season - 3;
    const history: number[] = [];
    const record = async (entityType: string, date: string, data: object, rowSeason = season) =>
      history.push(
        Number(
          (
            await store.run(
              "INSERT INTO history(season,entity_type,entity_id,date,data) VALUES (?,?,?,?,?)",
              rowSeason,
              entityType,
              player.id,
              date,
              JSON.stringify({ name: player.name, ...data }),
            )
          ).lastInsertRowid,
        ),
      );
    const negotiation = Number(
      (
        await store.run(
          "INSERT INTO negotiations(player_id,buying_club_id,selling_club_id,type,stage,asking_price,offer,wage,interest,created,deadline,data) VALUES (?,?,?,?,'Completed',?,?,?,?,?,?,?)",
          player.id,
          away.id,
          home.id,
          "Permanent transfer",
          5_000_000,
          4_500_000,
          20_000,
          70,
          `${season}-08-01`,
          `${season}-08-08`,
          JSON.stringify({
            transferTerms: { upfrontPercent: 40, installments: 3, intervalMonths: 12, buyBackFee: 0, buyBackYears: 1, sellOnPercent: 15 },
          }),
        )
      ).lastInsertRowid,
    );
    try {
      await record("transfer", `${season}-07-10`, { from: null, to: home.id, club: home.name, fee: 0, type: "Free transfer" });
      await record("transfer", `${season}-08-20`, { from: home.id, to: away.id, club: away.name, fee: 4_500_000, type: "Permanent transfer" });
      await record("loan", `${season + 1}-01-15`, { from: away.id, to: home.id, club: home.name, fee: 250_000, type: "Standard loan" }, season);
      // A move between two other clubs mentioning the club only by name is not the club's.
      await record("transfer", `${season}-09-01`, { from: away.id, to: state.clubId, club: home.name, fee: 1 });
      // A call-up and its return are one squad movement, never a transfer.
      await record("squad", `${season}-10-01`, { fromClubId: away.id, toClubId: home.id, label: "First team", callUp: true, until: `${season}-10-05` });
      await record("squad", `${season}-10-06`, { fromClubId: home.id, toClubId: away.id, label: "B team", callUpReturn: true });

      const response = await request(app).get(`/api/clubs/${home.id}/transfers?season=${season}`);
      expect(response.status).toBe(200);
      expect(response.body.club).toMatchObject({ id: home.id, name: home.name });
      expect(typeof response.body.club.country.code).toBe("string");
      expect(response.body.seasons.map((entry: { season: number }) => entry.season)).toEqual(
        expect.arrayContaining([state.season, season]),
      );
      expect(response.body.groups).toHaveLength(1);
      const [group] = response.body.groups;
      expect(group.season).toBe(season);
      expect(group.totals).toEqual({
        spent: 250_000,
        received: 4_500_000,
        net: 4_250_000,
        countIn: 2,
        countOut: 1,
        countInternal: 0,
        countLoanEnds: 0,
        unknownFees: 0,
      });
      expect(group.transfers.map((entry: { kind: string; direction: string; club: { id: number } | null; fee: number }) => [entry.kind, entry.direction, entry.club?.id ?? null, entry.fee])).toEqual([
        ["loan", "in", away.id, 250_000],
        ["transfer", "out", away.id, 4_500_000],
        ["free", "in", null, 0],
      ]);
      expect(group.transfers[0]).not.toHaveProperty("callUp");
      expect(response.body.squadMoves).toEqual({
        total: 1,
        moves: [
          expect.objectContaining({
            kind: "callUp",
            date: `${season}-10-01`,
            until: `${season}-10-05`,
            returnedOn: `${season}-10-06`,
            days: 5,
            player: expect.objectContaining({ id: player.id, name: player.name }),
          }),
        ],
      });
      const sale = group.transfers[1];
      expect(sale.player).toEqual({
        id: player.id,
        name: player.name,
        position: player.position,
        ageAtMove: ageOn(player.birth_date, `${season}-08-20`),
      });
      expect(sale.terms).toMatchObject({ installments: 3, sellOnPercent: 15 });
      expect(group.transfers[2].terms).toBeNull();

      const outgoing = await request(app).get(`/api/clubs/${away.id}/transfers?season=${season}&direction=out&type=loan,transfer`);
      expect(outgoing.status).toBe(200);
      expect(outgoing.body.filter).toEqual({ season, direction: "out", types: ["loan", "transfer"] });
      expect(outgoing.body.groups[0].transfers.map((entry: { kind: string; club: { id: number } }) => [entry.kind, entry.club.id])).toEqual([
        ["loan", home.id],
        ["transfer", state.clubId],
      ]);

      const paged = await request(app).get(`/api/clubs/${home.id}/transfers?season=${season}&pageSize=2&page=2`);
      expect(paged.body).toMatchObject({ total: 3, pages: 2, page: 2, pageSize: 2 });
      expect(paged.body.groups[0].transfers).toHaveLength(1);

      // A newly recorded move is seen at once: only history ids above the cached scan are read.
      await record("transfer", `${season}-08-25`, { from: away.id, to: home.id, club: home.name, fee: 1_000_000, type: "Permanent transfer" });
      const again = await request(app).get(`/api/clubs/${home.id}/transfers?season=${season}&direction=in&type=transfer`);
      expect(again.body.total).toBe(1);
      expect(again.body.groups[0].totals.spent).toBe(1_250_000);

      expect((await request(app).get("/api/clubs/99999999/transfers")).status).toBe(404);
      for (const query of ["page=0", "pageSize=501", "direction=sideways", "type=gift", "type=squad", "season=abc"])
        expect((await request(app).get(`/api/clubs/${home.id}/transfers?${query}`)).status, query).toBe(400);
      expect((await request(app).get("/api/clubs/abc/transfers")).status).toBe(400);
    } finally {
      await store.run("DELETE FROM history WHERE id = ANY(?::int[])", history);
      await store.run("DELETE FROM negotiations WHERE id = ?", negotiation);
      // The scan cache assumes append-only move rows.
      clubTransfersChanged(store);
    }
  });

  it("rejects impossible call-up end dates and loans longer than a year between countries", async () => {
    const state = await stateOf(store);
    const own = (await store.get<{ id: number }>(
      "SELECT id FROM players WHERE club_id = ? AND role <> 'Retired' ORDER BY id LIMIT 1",
      state.clubId,
    ))!;
    const callUp = (date: string) =>
      request(app)
        .post("/api/action")
        .send({ type: "call-up", playerId: own.id, clubId: state.clubId, ageGroup: "Senior", duration: { kind: "until", date } });
    for (const date of ["2026-13-45", "2027-02-29"]) {
      const response = await callUp(date);
      expect(response.status, date).toBe(400);
      expect(response.body.error, date).toMatch(/valid date/);
    }
    const tooLong = await callUp(addDays(state.date, CALL_UP_RULES.maxDays + 1));
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toMatch(new RegExp(`at most ${CALL_UP_RULES.maxDays} days`));
    const foreign = await store.get<{ id: number }>(
      "SELECT players.id FROM players JOIN clubs ON clubs.id = players.club_id WHERE clubs.type = 'club' AND clubs.country_id <> (SELECT country_id FROM clubs WHERE id = ?) AND players.role <> 'Retired' AND players.parent_club_id IS NULL ORDER BY players.id LIMIT 1",
      state.clubId,
    );
    expect(foreign).toBeTruthy();
    const loan = await request(app).post("/api/action").send({ type: "enquiry", playerId: foreign!.id, dealType: "Two-year loan" });
    expect(loan.status).toBe(400);
    expect(loan.body.error).toMatch(/at most one season \(380 days\)/);
    expect(await store.get("SELECT id FROM negotiations WHERE player_id = ? AND type = 'Two-year loan'", foreign!.id)).toBeFalsy();
  });

  it("starts a fresh named career and can load the previous career without losing it", async () => {
    const original = await stateOf(store);
    const response = await request(app).post("/api/careers").send({
      name: "Jamie Director",
      careerName: "A new beginning",
      background: "Academy director",
      clubId: 2,
      seed: "career-regression",
    });
    expect(response.status).toBe(200);
    expect((await stateOf(store)).date).toBe("2026-07-01");
    expect((await stateOf(store)).clubId).toBe(2);
    expect((await stateOf(store)).director.name).toBe("Jamie Director");
    expect((await stateOf(store)).director.skills.development).toBe(2);
    expect((await stateOf(store)).careerName).toBe("A new beginning");
    const slots = await request(app).get("/api/saves");
    expect(
      slots.body.find(
        (slot: { file: string }) => slot.file === response.body.saved,
      ).career.director,
    ).toBe("Jamie Director");
    expect(
      (
        await request(app)
          .post("/api/careers/load")
          .send({ file: response.body.archived })
      ).status,
    ).toBe(200);
    expect((await stateOf(store)).date).toBe(original.date);
    expect((await stateOf(store)).clubId).toBe(original.clubId);
    expect((await stateOf(store)).director.name).toBe(original.director.name);
    expect(
      (await request(app).get("/api/saves")).body.some(
        (slot: { file: string }) => slot.file === response.body.saved,
      ),
    ).toBe(true);
  });
});
