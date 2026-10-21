import { describe, expect, it } from "vitest";
import {
  capacityProblem,
  pageContentSecurityPolicy,
  renderAdminPage,
  renderSignedOutPage,
  renderSignInErrorPage,
  renderStatusPage,
  type AccessCapacityView,
  type AccessRequestView,
  type PlayerView,
} from "./admin-pages.ts";

const hostile = '"><script>alert(1)</script>';
const pending: AccessRequestView = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  username: `pat${hostile}`,
  displayName: `Pat <img src=x onerror="alert(1)">`,
  email: `pat${hostile}@example.test`,
  status: "pending",
  requestedAt: new Date("2026-10-20T08:10:00.000Z"),
  decidedAt: null,
  decidedBy: null,
};
const denied: AccessRequestView = {
  ...pending,
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  username: "dana",
  displayName: "Dana",
  email: null,
  status: "denied",
  decidedAt: new Date("2026-10-20T09:00:00.000Z"),
  decidedBy: `owner${hostile}`,
};
const approved: AccessRequestView = { ...denied, id: "aaaaaaaa-0000-4000-8000-000000000003", username: "alex", displayName: "Alex", status: "approved" };
const player: PlayerView = {
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  username: "alex",
  displayName: `Alex ${hostile}`,
  email: "alex@example.test",
  createdAt: new Date("2026-10-20T09:00:00.000Z"),
};
const capacity: AccessCapacityView = { players: 3, maxPlayers: 10, databaseGb: 1.234, databaseLimitGb: 24 };

const page = (overrides: Partial<Parameters<typeof renderAdminPage>[0]> = {}) =>
  renderAdminPage({ requests: [pending, denied, approved], players: [player], capacity, ...overrides });

describe("admin pages", () => {
  it("renders self-contained pages with a strict CSP and no scripts", () => {
    const pages = [
      page(),
      renderSignedOutPage({ signInUrl: "/auth/login" }),
      renderSignInErrorPage({ title: "Sign-in failed", message: "Start again.", retryUrl: "/auth/login" }),
      renderStatusPage({ title: "Admins only", message: "No." }),
    ];
    expect(pageContentSecurityPolicy).toContain("form-action 'self';");
    expect(pageContentSecurityPolicy).toContain("script-src 'none'");
    for (const html of pages) {
      expect(html).toMatch(/^<!doctype html>/);
      expect(html).toContain(`content="${pageContentSecurityPolicy}"`);
      expect(html).not.toMatch(/<script\b/i);
      expect(html).not.toMatch(/<img\b/i);
      expect(html).not.toMatch(/invite|microsoft|email us/i);
    }
  });

  it("escapes every user-controlled value", () => {
    const html = page({ flash: { code: "approved", name: pending.displayName }, signedInAs: `owner${hostile}` });
    expect(html).not.toContain(hostile);
    expect(html).not.toContain(pending.displayName);
    expect(html).toContain("Pat &lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("@pat&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("by owner&quot;&gt;&lt;script&gt;");
    expect(renderSignInErrorPage({ title: hostile, message: hostile, retryUrl: hostile })).not.toContain(hostile);
    expect(renderStatusPage({ title: hostile, message: hostile, link: { href: hostile, label: hostile } })).not.toContain(hostile);
  });

  it("shows pending requests with approve and deny, denied with approve, and current players", () => {
    const html = page();
    expect(html).toContain("Pending requests (1)");
    expect(html).toContain(`method="post" action="/admin/access/${pending.id}/approve"`);
    expect(html).toContain(`method="post" action="/admin/access/${pending.id}/deny"`);
    expect(html).toContain("Denied (1)");
    expect(html).toContain(`method="post" action="/admin/access/${denied.id}/approve"`);
    expect(html).not.toContain(`/admin/access/${denied.id}/deny`);
    expect(html).not.toContain(`/admin/access/${approved.id}/`);
    expect(html).toContain("Players (1)");
    expect(html).toContain("alex@example.test");
    expect(html).toContain('<time datetime="2026-10-20T08:10:00.000Z">');
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).not.toMatch(/<form[^>]*action="https?:/);
  });

  it("renders empty states", () => {
    const html = renderAdminPage({ requests: [], players: [], capacity });
    expect(html).toContain("No pending requests.");
    expect(html).toContain("No denied requests.");
    expect(html).toContain("No players yet.");
    expect(html).not.toContain("/admin/access/");
  });

  it("renders capacity and warns when approvals are blocked", () => {
    const html = page();
    expect(html).toContain("3 / 10");
    expect(html).toContain("1.23 GB");
    expect(html).toContain("24 GB");
    expect(html).not.toContain("Approvals are blocked");
    expect(capacityProblem(capacity)).toBeNull();
    const full = { ...capacity, players: 10 };
    expect(capacityProblem(full)).toBe("the player limit (10) is reached");
    expect(page({ capacity: full })).toContain("Approvals are blocked: the player limit (10) is reached.");
    const disk = { ...capacity, databaseGb: 24.5 };
    expect(capacityProblem(disk)).toBe("the database size limit (24 GB) is reached");
    expect(page({ capacity: disk })).toContain('role="alert"');
  });

  it("marks admins among players", () => {
    expect(page({ players: [{ ...player, admin: true }] })).toContain('<span class="badge admin">Admin</span>');
    expect(page()).not.toContain('<span class="badge admin">');
  });

  it("renders flash messages from fixed codes", () => {
    expect(page({ flash: { code: "approved", name: "Pat" } })).toContain("Approved Pat. They can sign in to Touchline now.");
    expect(page({ flash: { code: "denied", name: "Pat" } })).toContain("Denied Pat.");
    expect(page({ flash: { code: "capacity", name: "Pat" }, capacity: { ...capacity, players: 10 } }))
      .toContain("Couldn't approve Pat: the player limit (10) is reached.");
    expect(page({ flash: { code: "capacity" } })).toContain("Couldn't approve the request: capacity is unavailable.");
    expect(page({ flash: { code: "not_found" } })).toContain("That access request no longer exists.");
    expect(page({ flash: { code: "refused" } })).toContain("approved players can't be denied");
    expect(page({ flash: { code: "unavailable" } })).toContain("database is unavailable");
    expect(page()).not.toContain('id="flash"');
  });

  it("renders signed-out and sign-in error pages with a sign-in link", () => {
    const signedOut = renderSignedOutPage({ signInUrl: "/auth/login" });
    expect(signedOut).toContain("You're signed out");
    expect(signedOut).toContain('href="/auth/login"');
    const failed = renderSignInErrorPage({ title: "Sign-in expired", message: "Start <again>.", retryUrl: "/auth/login" });
    expect(failed).toContain("<h1>Sign-in expired</h1>");
    expect(failed).toContain("Start &lt;again&gt;.");
    expect(failed).toContain('href="/auth/login"');
  });
});
