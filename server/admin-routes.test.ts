import express, { type Request } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { AuthenticationRequiredError, NotAuthorizedError, type AuthenticatedIdentity } from "./auth.ts";
import { DatabaseUnavailableError } from "./db.ts";
import type { AccessCapacityView, AccessRequestView, PlayerView } from "./admin-pages.ts";
import { createAdminRouter, isAccessAdministration, type AccessAdministration } from "./admin-routes.ts";

const appOrigin = "https://touchline.example.test";
const pendingId = "aaaaaaaa-0000-4000-8000-000000000001";
const deniedId = "aaaaaaaa-0000-4000-8000-000000000002";
const approvedId = "aaaaaaaa-0000-4000-8000-000000000003";

const identity = (overrides: Partial<AuthenticatedIdentity> = {}): AuthenticatedIdentity => ({
  issuer: "https://auth.example.test",
  subject: "owner-sub",
  username: "owner",
  displayName: "Owner",
  email: "owner@example.test",
  groups: ["admins"],
  admin: true,
  ...overrides,
});
const player = identity({ subject: "player-sub", username: "pat", displayName: "Pat", groups: [], admin: false });

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

class FakeAccounts implements AccessAdministration {
  requests = new Map<string, AccessRequestView>();
  players: PlayerView[] = [];
  capacity: AccessCapacityView = { players: 1, maxPlayers: 10, databaseGb: 0.5, databaseLimitGb: 24 };
  calls: { action: "approve" | "deny"; id: string; decidedBy: string }[] = [];
  listed = 0;
  failWith: unknown;

  constructor() {
    const base = { username: "x", email: null, requestedAt: new Date("2026-10-20T08:00:00Z"), decidedAt: null, decidedBy: null };
    this.requests.set(pendingId, { ...base, id: pendingId, username: "pat", displayName: "Pat <Smith>", status: "pending" });
    this.requests.set(deniedId, { ...base, id: deniedId, displayName: "Dana", status: "denied" });
    this.requests.set(approvedId, { ...base, id: approvedId, displayName: "Alex", status: "approved" });
    this.players.push({ id: "bbbbbbbb-0000-4000-8000-000000000001", username: "alex", displayName: "Alex", email: null, createdAt: new Date() });
  }

  async listAccess() {
    this.listed += 1;
    if (this.failWith) throw this.failWith;
    return { requests: [...this.requests.values()], players: this.players, capacity: this.capacity };
  }

  async approve(id: string, decidedBy: string) {
    this.calls.push({ action: "approve", id, decidedBy });
    if (this.failWith) throw this.failWith;
    const entry = this.requests.get(id);
    if (!entry) throw new HttpError(404, "Access request not found.");
    if (entry.status === "approved") return { status: "approved" as const };
    if (this.capacity.players >= this.capacity.maxPlayers) return { status: "capacity" as const, reason: "Player limit reached." };
    entry.status = "approved";
    this.capacity.players += 1;
    return { status: "approved" as const };
  }

  async deny(id: string, decidedBy: string) {
    this.calls.push({ action: "deny", id, decidedBy });
    if (this.failWith) throw this.failWith;
    const entry = this.requests.get(id);
    if (!entry) throw new HttpError(404, "Access request not found.");
    if (entry.status === "approved") throw new HttpError(409, "Approved requests can't be denied.");
    entry.status = "denied";
    return { status: "denied" };
  }
}

/** The fake session: an `x-test-user` header of "admin" or "player"; anything else is anonymous. */
function authenticate(request: Request): AuthenticatedIdentity {
  const user = request.headers["x-test-user"];
  if (user === "admin") return identity();
  if (user === "player") return player;
  if (user === "unauthorized") throw new NotAuthorizedError();
  throw new AuthenticationRequiredError();
}

function makeApp(options: { accounts?: FakeAccounts; requireAuth?: boolean; lazy?: boolean } = {}) {
  const accounts = options.accounts ?? new FakeAccounts();
  const app = express();
  app.use(createAdminRouter({
    configuration: { requireAuth: options.requireAuth ?? true, appOrigin },
    authenticate,
    accounts: options.lazy ? async () => accounts : accounts,
  }));
  return { app, accounts };
}

const adminPost = (app: express.Express, path: string) =>
  request(app).post(path).set("x-test-user", "admin").set("Origin", appOrigin);

describe("admin page access", () => {
  it("redirects anonymous browsers to sign-in and back to /admin", async () => {
    const { app, accounts } = makeApp();
    const response = await request(app).get("/admin");
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/auth/login?returnTo=%2Fadmin");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(accounts.listed).toBe(0);
  });

  it("refuses signed-in non-admins with a 403 page", async () => {
    const { app, accounts } = makeApp();
    for (const user of ["player", "unauthorized"]) {
      const response = await request(app).get("/admin").set("x-test-user", user);
      expect(response.status).toBe(403);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.text).toContain("Admins only");
    }
    expect(accounts.listed).toBe(0);
  });

  it("renders the admin page for admins with a strict CSP", async () => {
    const { app } = makeApp({ lazy: true });
    const response = await request(app).get("/admin").set("x-test-user", "admin");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-security-policy"]).toContain("form-action 'self';");
    expect(response.headers["content-security-policy"]).toContain("script-src 'none'");
    expect(response.text).toContain("Pat &lt;Smith&gt;");
    expect(response.text).toContain(`/admin/access/${pendingId}/approve`);
    expect(response.text).toContain(`/admin/access/${pendingId}/deny`);
    expect(response.text).toContain(`/admin/access/${deniedId}/approve`);
    expect(response.text).toContain("1 / 10");
    expect(response.text).toContain("Signed in as owner");
    expect(response.text).not.toContain('id="flash"');
  });

  it("only renders flash messages for known codes", async () => {
    const { app } = makeApp();
    const known = await request(app).get(`/admin?result=approved&request=${pendingId}`).set("x-test-user", "admin");
    expect(known.text).toContain("Approved Pat &lt;Smith&gt;.");
    const unknown = await request(app).get("/admin?result=%3Cscript%3E&request=%3Cb%3E").set("x-test-user", "admin");
    expect(unknown.status).toBe(200);
    expect(unknown.text).not.toContain('id="flash"');
    expect(unknown.text).not.toContain("<b>");
  });

  it("shows a 503 page while the database is unavailable", async () => {
    const { app, accounts } = makeApp();
    accounts.failWith = new DatabaseUnavailableError();
    const response = await request(app).get("/admin").set("x-test-user", "admin");
    expect(response.status).toBe(503);
    expect(response.headers["retry-after"]).toBe("5");
    expect(response.text).toContain("Database unavailable");
  });

  it("is not served in local development", async () => {
    const { app } = makeApp({ requireAuth: false });
    expect((await request(app).get("/admin").set("x-test-user", "admin")).status).toBe(404);
    expect((await adminPost(app, `/admin/access/${pendingId}/approve`)).status).toBe(404);
  });

  it("requires configuration and authenticate", () => {
    expect(() => createAdminRouter({})).toThrow("Admin routes require configuration and authenticate.");
  });

  it("recognizes account registries with admin operations", () => {
    expect(isAccessAdministration(new FakeAccounts())).toBe(true);
    expect(isAccessAdministration({ resolve: async () => undefined })).toBe(false);
    expect(isAccessAdministration(undefined)).toBe(false);
  });
});

describe("admin decisions", () => {
  it("approves a pending request and redirects back with a flash", async () => {
    const { app, accounts } = makeApp();
    const response = await adminPost(app, `/admin/access/${pendingId}/approve`);
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe(`/admin?result=approved&request=${pendingId}`);
    expect(accounts.calls).toEqual([{ action: "approve", id: pendingId, decidedBy: "owner" }]);
    expect(accounts.requests.get(pendingId)?.status).toBe("approved");
  });

  it("denies a pending request", async () => {
    const { app, accounts } = makeApp();
    const response = await adminPost(app, `/admin/access/${pendingId.toUpperCase()}/deny`);
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe(`/admin?result=denied&request=${pendingId}`);
    expect(accounts.calls).toEqual([{ action: "deny", id: pendingId, decidedBy: "owner" }]);
  });

  it("re-approves a denied request", async () => {
    const { app, accounts } = makeApp();
    const response = await adminPost(app, `/admin/access/${deniedId}/approve`);
    expect(response.headers.location).toBe(`/admin?result=approved&request=${deniedId}`);
    expect(accounts.requests.get(deniedId)?.status).toBe("approved");
  });

  it("reports the capacity outcome without approving", async () => {
    const { app, accounts } = makeApp();
    accounts.capacity.players = 10;
    const response = await adminPost(app, `/admin/access/${pendingId}/approve`);
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe(`/admin?result=capacity&request=${pendingId}`);
    expect(accounts.requests.get(pendingId)?.status).toBe("pending");
    const page = await request(app).get(response.headers.location).set("x-test-user", "admin");
    expect(page.text).toContain("Couldn't approve Pat &lt;Smith&gt;: the player limit (10) is reached.");
  });

  it("maps refused, unknown and unavailable outcomes to flashes", async () => {
    const { app, accounts } = makeApp();
    expect((await adminPost(app, `/admin/access/${approvedId}/deny`)).headers.location)
      .toBe(`/admin?result=refused&request=${approvedId}`);
    expect((await adminPost(app, "/admin/access/cccccccc-0000-4000-8000-000000000009/approve")).headers.location)
      .toBe("/admin?result=not_found&request=cccccccc-0000-4000-8000-000000000009");
    expect((await adminPost(app, "/admin/access/not-a-uuid/approve")).headers.location).toBe("/admin?result=not_found");
    accounts.failWith = new DatabaseUnavailableError();
    expect((await adminPost(app, `/admin/access/${pendingId}/approve`)).headers.location)
      .toBe(`/admin?result=unavailable&request=${pendingId}`);
    expect(accounts.calls.map((call) => call.id)).not.toContain("not-a-uuid");
  });

  it("passes unexpected errors to the error handler", async () => {
    const { app, accounts } = makeApp();
    accounts.failWith = new Error("boom");
    app.use((_error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
      response.status(500).send("handled");
    });
    const response = await adminPost(app, `/admin/access/${pendingId}/approve`);
    expect(response.status).toBe(500);
    expect(response.text).toBe("handled");
  });

  it("refuses cross-origin and origin-less posts before deciding", async () => {
    const { app, accounts } = makeApp();
    const path = `/admin/access/${pendingId}/approve`;
    const crossOrigin = await request(app).post(path).set("x-test-user", "admin").set("Origin", "https://evil.example");
    expect(crossOrigin.status).toBe(403);
    expect(crossOrigin.text).toContain("Request refused");
    const sameSite = await request(app).post(path).set("x-test-user", "admin")
      .set("Origin", appOrigin).set("Sec-Fetch-Site", "same-site");
    expect(sameSite.status).toBe(403);
    const nullOrigin = await request(app).post(path).set("x-test-user", "admin").set("Origin", "null");
    expect(nullOrigin.status).toBe(403);
    const missing = await request(app).post(path).set("x-test-user", "admin");
    expect(missing.status).toBe(403);
    const crossSite = await request(app).post(path).set("x-test-user", "admin").set("Sec-Fetch-Site", "cross-site");
    expect(crossSite.status).toBe(403);
    expect(accounts.calls).toEqual([]);
    const fetchMetadataOnly = await request(app).post(path).set("x-test-user", "admin").set("Sec-Fetch-Site", "same-origin");
    expect(fetchMetadataOnly.status).toBe(303);
  });

  it("requires an admin to decide", async () => {
    const { app, accounts } = makeApp();
    const path = `/admin/access/${pendingId}/approve`;
    const anonymous = await request(app).post(path).set("Origin", appOrigin);
    expect(anonymous.status).toBe(401);
    expect(anonymous.text).toContain("/auth/login?returnTo=%2Fadmin");
    const nonAdmin = await request(app).post(path).set("x-test-user", "player").set("Origin", appOrigin);
    expect(nonAdmin.status).toBe(403);
    expect(accounts.calls).toEqual([]);
  });

  it("only accepts approve and deny as actions", async () => {
    const { app, accounts } = makeApp();
    expect((await adminPost(app, `/admin/access/${pendingId}/revoke`)).status).toBe(404);
    expect((await request(app).get(`/admin/access/${pendingId}/approve`).set("x-test-user", "admin")).status).toBe(404);
    expect(accounts.calls).toEqual([]);
  });
});

describe("retired invite routes", () => {
  it("permanently redirects the old invite list to /admin", async () => {
    const { app } = makeApp();
    const response = await request(app).get("/admin/invites");
    expect(response.status).toBe(301);
    expect(response.headers.location).toBe("/admin");
  });

  it("no longer serves /invite", async () => {
    const { app } = makeApp();
    expect((await request(app).get("/invite")).status).toBe(404);
    expect((await request(app).post("/invite").set("Origin", appOrigin).type("form").send({ email: "a@b.test" })).status).toBe(404);
    expect((await request(app).get(`/admin/invites/${pendingId}?action=accept`).set("x-test-user", "admin")).status).toBe(404);
  });
});
