import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { DatabaseUnavailableError, Store } from "./db.ts";
import { createApp } from "./app.ts";
import { CONSUMER_TENANT_ID, type Capacity, type InviteRequest } from "./invite-store.ts";
import { signInviteToken, type InviteStoreLike } from "./invite-routes.ts";
import { sessionCookieName, signSession } from "./auth.ts";
import { OWNER_EMAIL_DEFAULT } from "./legacy-account.ts";
import type { MailMessage, Mailer } from "./mailer.ts";

const owner = "11111111-1111-1111-1111-111111111111";
const guest = "22222222-2222-2222-2222-222222222222";
const tenant = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const secret = "12345678901234567890123456789012";
const appOrigin = "https://touchline.example.com";
const sessionSecret = "session-secret-abcdefghijklmnopqrstuvwxyz";
const configuration = {
  API_HOST: "0.0.0.0",
  REQUIRE_AUTH: "true",
  OWNER_OBJECT_ID: owner,
  AUTH_HOME_TENANT_ID: tenant,
  APP_ORIGIN: appOrigin,
  OIDC_CLIENT_ID: "touchline-client",
  SESSION_SECRET: sessionSecret,
  INVITE_SIGNING_SECRET: secret,
  EMAIL_TRANSPORT: "gmail",
  APPROVER_EMAIL: "approver@example.test",
  OWNER_EMAIL: OWNER_EMAIL_DEFAULT,
};
/** Cookie header for a signed-in session, as issued by GET /auth/callback. */
const signedIn = (objectId: string, tenantId = tenant, profile: { email?: string; name?: string } = {}) =>
  `${sessionCookieName(true)}=${signSession({
    tenantId,
    objectId,
    displayName: profile.name ?? "Sporting director",
    email: profile.email ?? null,
  }, { sessionSecret, sessionTtlSeconds: 3600 })}`;
const ownerHeaders = { Cookie: signedIn(owner), Origin: appOrigin };
const invite = (overrides: Partial<InviteRequest> = {}): InviteRequest => ({
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  email: "player@example.test",
  note: "please",
  status: "pending",
  requestedAt: new Date("2026-09-27T08:00:00Z"),
  decidedAt: null,
  decidedBy: null,
  approvalEmailSent: false,
  acceptedEmailSent: false,
  ...overrides,
});
const capacity = (overrides: Partial<Capacity> = {}): Capacity => ({
  players: 1,
  reserved: 0,
  maxPlayers: 10,
  databaseSizeGb: 1,
  sizeLimitGb: 24,
  available: true,
  reason: null,
  ...overrides,
});

class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  async send(message: MailMessage) {
    this.sent.push(message);
  }
}

class FakeInviteStore implements InviteStoreLike {
  requests = new Map<string, InviteRequest>();
  createResult: "created" | "duplicate" | "rate_limited" = "created";
  cap = capacity();
  createCalls: { email: string; note: string | null; ipHash: string | null }[] = [];
  decisions: { id: string; action: "accept" | "deny"; decidedBy: string }[] = [];
  marked: { id: string; kind: "approval" | "accepted" }[] = [];
  purged = 0;

  constructor(request = invite()) {
    this.requests.set(request.id, request);
  }

  async create(input: { email: string; note: string | null; ipHash: string | null }) {
    this.createCalls.push(input);
    const request = [...this.requests.values()][0];
    return this.createResult === "rate_limited" ? { status: "rate_limited" as const } : { status: this.createResult, request };
  }

  async get(id: string) {
    return this.requests.get(id);
  }

  async list() {
    return [...this.requests.values()];
  }

  async capacity() {
    return this.cap;
  }

  async decide(id: string, action: "accept" | "deny", decidedBy: string) {
    this.decisions.push({ id, action, decidedBy });
    const request = this.requests.get(id);
    if (!request) return { outcome: "not_found" as const };
    if (request.status !== "pending") return { outcome: "unchanged" as const, request };
    if (action === "accept" && !this.cap.available) return { outcome: "capacity" as const, request, capacity: this.cap };
    const status = action === "accept" ? "accepted" : "denied";
    const decided = { ...request, status, decidedAt: new Date("2026-09-27T09:00:00Z"), decidedBy } as InviteRequest;
    this.requests.set(id, decided);
    return { outcome: status, request: decided } as const;
  }

  async markEmailSent(id: string, kind: "approval" | "accepted") {
    this.marked.push({ id, kind });
  }

  async purgeExpired() {
    this.purged += 1;
    return 0;
  }
}

function makeApp(store = new FakeInviteStore(), mailer = new FakeMailer()) {
  vi.stubEnv("SMTP_USER", "approver@example.test");
  vi.stubEnv("SMTP_PASSWORD", "not-used-by-fake");
  for (const [name, value] of Object.entries(configuration)) vi.stubEnv(name, value);
  return {
    store,
    mailer,
    app: createApp(Object.create(Store.prototype) as Store, {
      async resolve(identity) {
        return { user: { id: identity.objectId, displayName: identity.displayName, email: identity.email }, store: Object.create(Store.prototype) as Store };
      },
    }, { inviteStore: store, mailer, now: () => new Date("2026-09-27T10:00:00Z") }),
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("invite request routes", () => {
  it("renders the public form without opening invite storage", async () => {
    const { app, store } = makeApp();
    const response = await request(app).get("/invite");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.text).toContain("personal Microsoft account");
    expect(store.createCalls).toEqual([]);
  });

  it("rejects cross-origin posts before storing", async () => {
    const { app, store } = makeApp();
    const response = await request(app).post("/invite")
      .set("Origin", "https://evil.example")
      .type("form").send({ email: "player@example.test" });
    expect(response.status).toBe(403);
    expect(store.createCalls).toEqual([]);
  });

  it("pretends success for the honeypot", async () => {
    const { app, store, mailer } = makeApp();
    const response = await request(app).post("/invite")
      .set("Origin", appOrigin)
      .type("form").send({ email: "bot@example.test", website: "filled" });
    expect(response.status).toBe(200);
    expect(response.text).toContain("Thanks");
    expect(store.createCalls).toEqual([]);
    expect(mailer.sent).toEqual([]);
  });

  it("validates the email and note", async () => {
    const { app, store } = makeApp();
    const response = await request(app).post("/invite")
      .set("Origin", appOrigin)
      .type("form").send({ email: "bad", note: "x".repeat(501) });
    expect(response.status).toBe(400);
    expect(store.createCalls).toEqual([]);
  });

  it("returns 429 for store rate limits", async () => {
    const store = new FakeInviteStore();
    store.createResult = "rate_limited";
    const { app } = makeApp(store);
    const response = await request(app).post("/invite")
      .set("Origin", appOrigin)
      .type("form").send({ email: "player@example.test" });
    expect(response.status).toBe(429);
    expect(response.text).toContain("Too many");
  });

  it("shows a friendly paused page while the database is unavailable", async () => {
    const store = new FakeInviteStore();
    store.create = async () => { throw new DatabaseUnavailableError(); };
    const { app } = makeApp(store);
    const response = await request(app).post("/invite")
      .set("Origin", appOrigin)
      .type("form").send({ email: "player@example.test" });
    expect(response.status).toBe(503);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("paused");
  });

  it("sends only the approver email for new requests and dedupes identical responses", async () => {
    const { app, store, mailer } = makeApp();
    const first = await request(app).post("/invite")
      .set("Origin", appOrigin)
      .set("X-Forwarded-For", "203.0.113.10, 10.0.0.1")
      .type("form").send({ email: "PLAYER@Example.TEST", note: " Hello " });
    expect(first.status).toBe(200);
    expect(store.createCalls[0]).toMatchObject({ email: "player@example.test", note: "Hello" });
    expect(store.createCalls[0].ipHash).toBe(
      createHash("sha256").update(secret).update("10.0.0.1").digest("hex"),
    );
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe("approver@example.test");
    expect(mailer.sent[0].text).toContain("/admin/invites/");
    expect(mailer.sent.some((message) => message.to === "player@example.test")).toBe(false);
    expect(store.marked).toEqual([{ id: invite().id, kind: "approval" }]);

    store.createResult = "duplicate";
    const second = await request(app).post("/invite")
      .set("Origin", appOrigin)
      .type("form").send({ email: "player@example.test" });
    expect(second.status).toBe(200);
    expect(second.text).toBe(first.text);
    expect(mailer.sent).toHaveLength(1);
    expect(store.purged).toBe(1);
  });

  it("hashes the address seen by Express according to TRUST_PROXY", async () => {
    vi.stubEnv("TRUST_PROXY", "false");
    const direct = makeApp();
    await request(direct.app).post("/invite")
      .set("Origin", appOrigin)
      .set("X-Forwarded-For", "203.0.113.10")
      .type("form").send({ email: "player@example.test" });
    expect(direct.store.createCalls[0].ipHash).not.toBe(
      createHash("sha256").update(secret).update("203.0.113.10").digest("hex"),
    );
    vi.stubEnv("TRUST_PROXY", "2");
    const twoHops = makeApp();
    await request(twoHops.app).post("/invite")
      .set("Origin", appOrigin)
      .set("X-Forwarded-For", "198.51.100.7, 203.0.113.10, 10.0.0.1")
      .type("form").send({ email: "player@example.test" });
    expect(twoHops.store.createCalls[0].ipHash).toBe(
      createHash("sha256").update(secret).update("203.0.113.10").digest("hex"),
    );
  });
});

describe("invite admin routes", () => {
  it("requires an approver", async () => {
    const { app } = makeApp();
    const response = await request(app).get("/admin/invites")
      .set("Cookie", signedIn(guest, CONSUMER_TENANT_ID, { email: "someone@example.test" }));
    expect(response.status).toBe(403);
    expect((await request(app).get("/admin/invites")
      .set("Cookie", signedIn(guest, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", { email: OWNER_EMAIL_DEFAULT }))).status).toBe(403);
    expect((await request(app).get("/admin/invites")
      .set("Cookie", signedIn(owner, CONSUMER_TENANT_ID))).status).toBe(403);
  });

  it("sends anonymous approvers through sign-in and back to the emailed review link", async () => {
    const { app, store } = makeApp();
    const list = await request(app).get("/admin/invites");
    expect(list.status).toBe(302);
    expect(list.headers.location).toBe("/auth/login?returnTo=%2Fadmin%2Finvites");
    const token = signInviteToken({ id: invite().id, action: "accept", secret, now: new Date("2026-09-27T10:00:00Z") });
    const review = `/admin/invites/${invite().id}?action=accept&token=${encodeURIComponent(token)}`;
    const link = await request(app).get(review);
    expect(link.status).toBe(302);
    expect(link.headers.location).toBe(`/auth/login?returnTo=${encodeURIComponent(review)}`);
    const forged = await request(app).get("/admin/invites")
      .set("Cookie", `${sessionCookieName(true)}=${signSession({ tenantId: tenant, objectId: owner, displayName: "Owner", email: null }, { sessionSecret: "another-secret-abcdefghijklmnopqrstuvwxyz", sessionTtlSeconds: 3600 })}`);
    expect(forged.status).toBe(302);
    const post = await request(app).post(`/admin/invites/${invite().id}/decision`)
      .set("Origin", appOrigin)
      .type("form").send({ action: "accept", token });
    expect(post.status).toBe(403);
    expect(store.decisions).toEqual([]);
  });

  it("lists invites with fresh review tokens", async () => {
    const { app } = makeApp();
    const response = await request(app).get("/admin/invites").set(ownerHeaders);
    expect(response.status).toBe(200);
    expect(response.text).toContain("player@example.test");
    expect(response.text).toContain("action=accept");
    expect(response.text).toContain(`/admin/invites/${invite().id}/resend`);
    expect(response.text).toContain("token=");
  });

  it("treats the consumers-tenant owner email as an approver", async () => {
    const { app } = makeApp();
    const response = await request(app).get("/admin/invites")
      .set("Cookie", signedIn(guest, CONSUMER_TENANT_ID, { email: OWNER_EMAIL_DEFAULT }));
    expect(response.status).toBe(200);
    expect(response.text).toContain("player@example.test");
  });

  it("treats the consumers-tenant approver email as an approver and records it as the decider", async () => {
    const { app, store } = makeApp();
    const approver = signedIn(guest, CONSUMER_TENANT_ID, { email: "approver@example.test" });
    expect((await request(app).get("/admin/invites").set("Cookie", approver)).status).toBe(200);
    const token = signInviteToken({ id: invite().id, action: "deny", secret, now: new Date("2026-09-27T10:00:00Z") });
    const response = await request(app).post(`/admin/invites/${invite().id}/decision`)
      .set("Cookie", approver).set("Origin", appOrigin)
      .type("form").send({ action: "deny", token });
    expect(response.status).toBe(200);
    expect(store.decisions).toEqual([{ id: invite().id, action: "deny", decidedBy: "approver@example.test" }]);
  });

  it("rejects tampered, expired and mismatched review tokens", async () => {
    const requestId = invite().id;
    const { app } = makeApp();
    const token = signInviteToken({ id: requestId, action: "accept", secret, now: new Date("2026-09-27T10:00:00Z") });
    expect((await request(app).get(`/admin/invites/${requestId}?action=accept&token=tampered`).set(ownerHeaders)).status).toBe(403);
    const expired = signInviteToken({ id: requestId, action: "accept", secret, expiresAt: 1 });
    expect((await request(app).get(`/admin/invites/${requestId}?action=accept&token=${expired}`).set(ownerHeaders)).status).toBe(410);
    expect((await request(app).get(`/admin/invites/${requestId}?action=deny&token=${token}`).set(ownerHeaders)).status).toBe(403);
    expect((await request(app).get(`/admin/invites/${guest}?action=accept&token=${token}`).set(ownerHeaders)).status).toBe(403);
  });

  it("renders a review page for a valid token", async () => {
    const requestId = invite().id;
    const token = signInviteToken({ id: requestId, action: "accept", secret, now: new Date("2026-09-27T10:00:00Z") });
    const { app } = makeApp();
    const response = await request(app).get(`/admin/invites/${requestId}?action=accept&token=${token}`).set(ownerHeaders);
    expect(response.status).toBe(200);
    expect(response.text).toContain("Accept invite");
    expect(response.text).toContain("player@example.test");
  });

  it("blocks accept when capacity is unavailable", async () => {
    const store = new FakeInviteStore();
    store.cap = capacity({ available: false, reason: "player_limit" });
    const { app } = makeApp(store);
    const token = signInviteToken({ id: invite().id, action: "accept", secret, now: new Date("2026-09-27T10:00:00Z") });
    const response = await request(app).post(`/admin/invites/${invite().id}/decision`)
      .set(ownerHeaders)
      .type("form").send({ action: "accept", token });
    expect(response.status).toBe(409);
    expect(response.text).toContain("player_limit");
  });

  it("accepts and sends the requester email once", async () => {
    const { app, store, mailer } = makeApp();
    const token = signInviteToken({ id: invite().id, action: "accept", secret, now: new Date("2026-09-27T10:00:00Z") });
    const response = await request(app).post(`/admin/invites/${invite().id}/decision`)
      .set(ownerHeaders)
      .type("form").send({ action: "accept", token });
    expect(response.status).toBe(200);
    expect(response.text).toContain("Invite accepted");
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe("player@example.test");
    expect(store.marked).toContainEqual({ id: invite().id, kind: "accepted" });

    const again = await request(app).post(`/admin/invites/${invite().id}/decision`)
      .set(ownerHeaders)
      .type("form").send({ action: "accept", token });
    expect(again.status).toBe(200);
    expect(again.text).toContain("No change");
    expect(mailer.sent).toHaveLength(1);
  });

  it("denies silently", async () => {
    const { app, store, mailer } = makeApp();
    const token = signInviteToken({ id: invite().id, action: "deny", secret, now: new Date("2026-09-27T10:00:00Z") });
    const response = await request(app).post(`/admin/invites/${invite().id}/decision`)
      .set(ownerHeaders)
      .type("form").send({ action: "deny", token });
    expect(response.status).toBe(200);
    expect(response.text).toContain("Invite denied");
    expect(store.decisions[0].action).toBe("deny");
    expect(mailer.sent).toEqual([]);
  });

  it("resends pending approval and accepted requester emails", async () => {
    const { app, store, mailer } = makeApp();
    const pendingToken = signInviteToken({ id: invite().id, action: "resend", secret, now: new Date("2026-09-27T10:00:00Z") });
    const pending = await request(app).post(`/admin/invites/${invite().id}/resend`)
      .set(ownerHeaders)
      .type("form").send({ action: "resend", token: pendingToken });
    expect(pending.status).toBe(200);
    expect(pending.text).toContain("Email resent");
    expect(mailer.sent[0].to).toBe("approver@example.test");
    expect(store.marked).toContainEqual({ id: invite().id, kind: "approval" });

    store.requests.set(invite().id, invite({ status: "accepted", approvalEmailSent: true }));
    const accepted = await request(app).post(`/admin/invites/${invite().id}/resend`)
      .set(ownerHeaders)
      .type("form").send({ action: "resend", token: pendingToken });
    expect(accepted.status).toBe(200);
    expect(mailer.sent[1].to).toBe("player@example.test");
    expect(store.marked).toContainEqual({ id: invite().id, kind: "accepted" });
  });

  it("keeps resend failures non-fatal and leaves email flags unset", async () => {
    const mailer = new FakeMailer();
    mailer.send = vi.fn(async () => { throw new Error("disabled"); });
    const { app, store } = makeApp(new FakeInviteStore(), mailer);
    const token = signInviteToken({ id: invite().id, action: "resend", secret, now: new Date("2026-09-27T10:00:00Z") });
    const response = await request(app).post(`/admin/invites/${invite().id}/resend`)
      .set(ownerHeaders)
      .type("form").send({ action: "resend", token });
    expect(response.status).toBe(200);
    expect(response.text).toContain("Email not sent");
    expect(store.marked).toEqual([]);
  });

  it("rejects tampered resend tokens and wrong-origin resend posts", async () => {
    const { app, store } = makeApp();
    const response = await request(app).post(`/admin/invites/${invite().id}/resend`)
      .set(ownerHeaders)
      .type("form").send({ action: "resend", token: "tampered" });
    expect(response.status).toBe(403);
    const token = signInviteToken({ id: invite().id, action: "resend", secret, now: new Date("2026-09-27T10:00:00Z") });
    const origin = await request(app).post(`/admin/invites/${invite().id}/resend`)
      .set("Cookie", signedIn(owner))
      .set("Origin", "https://evil.example")
      .type("form").send({ action: "resend", token });
    expect(origin.status).toBe(403);
    expect(store.marked).toEqual([]);
  });

  it("requires same-origin decision posts", async () => {
    const { app, store } = makeApp();
    const token = signInviteToken({ id: invite().id, action: "deny", secret, now: new Date("2026-09-27T10:00:00Z") });
    const response = await request(app).post(`/admin/invites/${invite().id}/decision`)
      .set("Cookie", signedIn(owner))
      .set("Origin", "https://evil.example")
      .type("form").send({ action: "deny", token });
    expect(response.status).toBe(403);
    expect(store.decisions).toEqual([]);
  });
});
