import { describe, expect, it } from "vitest";
import {
  renderAdminListPage,
  renderDecisionPage,
  renderInvitePage,
  renderNotInvitedPage,
  renderReviewPage,
  type InviteCapacityView,
  type InviteRequestView,
} from "./invite-pages.ts";

const request: InviteRequestView = {
  id: "abc",
  email: 'player"><script>alert(1)</script>@example.com',
  note: '<img src=x onerror="alert(1)">',
  status: "pending",
  requestedAt: new Date("2026-09-27T08:10:00.000Z"),
  approvalEmailSent: false,
  acceptedEmailSent: false,
};
const capacity: InviteCapacityView = {
  players: 10,
  reserved: 0,
  maxPlayers: 10,
  databaseSizeGb: 24,
  sizeLimitGb: 24,
  available: false,
  reason: "Player capacity reached",
};

const pages = () => [
  renderInvitePage({ state: "form", email: request.email, note: request.note ?? "" }),
  renderInvitePage({ state: "submitted" }),
  renderNotInvitedPage({ inviteUrl: "/invite", logoutUrl: "/.auth/logout?post_logout_redirect_uri=/", email: request.email }),
  renderAdminListPage({
    requests: [request],
    capacity,
    reviewUrl: (id, action) => `/admin/invites/${id}?action=${action}`,
    resendForm: (entry) => ({ action: `/admin/invites/${entry.id}/resend`, token: "resend-token" }),
  }),
  renderReviewPage({ request, action: "accept", token: "tok", formAction: "/admin/invites/abc/decision", capacity }),
  renderReviewPage({ request, action: "deny", token: "tok", formAction: "/admin/invites/abc/decision", capacity }),
  renderDecisionPage({ outcome: "accepted", email: request.email, listUrl: "/admin/invites", emailSent: true }),
];

describe("invite pages", () => {
  it("renders self-contained pages without script tags", () => {
    for (const page of pages()) {
      expect(page).toMatch(/^<!doctype html>/);
      expect(page).toContain("Content-Security-Policy");
      expect(page).toContain("form-action 'self'");
      expect(page).not.toMatch(/<script\b/i);
      expect(page).not.toMatch(/<img\b/i);
    }
  });

  it("escapes user values across pages", () => {
    for (const page of pages()) {
      expect(page).not.toContain(request.email);
      expect(page).not.toContain(request.note);
    }
    const unsafePages = [
      renderInvitePage({ state: "form", email: request.email, note: request.note ?? "" }),
      renderNotInvitedPage({ inviteUrl: "/invite", logoutUrl: "/", email: request.email }),
      renderAdminListPage({ requests: [request], capacity, reviewUrl: (id, action) => `/admin/invites/${id}?action=${action}` }),
      renderReviewPage({ request, action: "accept", token: "tok", formAction: "/admin/invites/abc/decision", capacity }),
      renderDecisionPage({ outcome: "accepted", email: request.email, listUrl: "/admin/invites", emailSent: true }),
    ];
    for (const page of unsafePages) expect(page).toContain("&lt;");
  });

  it("renders the invite form contract", () => {
    const page = renderInvitePage({ state: "form" });
    expect(page).toContain("<title>Request an invite</title>");
    expect(page).toContain('type="email"');
    expect(page).toContain('required maxlength="320"');
    expect(page).toContain('name="note" maxlength="500"');
    expect(page).toContain('name="website" tabindex="-1" autocomplete="off"');
    expect(page).toContain("football sporting-director sim");
    expect(page).toContain("we store your email and a hashed IP");
    expect(page).toContain("Already invited? Sign in");
  });

  it("keeps submitted invite state neutral", () => {
    expect(renderInvitePage({ state: "submitted", email: "duplicate@example.com" }))
      .toContain("Thanks — if approved you'll get an email at that address");
  });

  it("puts required personal Microsoft account wording on invite and not-invited pages", () => {
    const invite = renderInvitePage({ state: "form" });
    const notInvited = renderNotInvitedPage({ inviteUrl: "/invite", logoutUrl: "/", email: "player@example.com" });
    for (const page of [invite, notInvited]) {
      expect(page).toContain("personal Microsoft account");
      expect(page).toContain("Outlook.com, Hotmail, Live.com, MSN");
      expect(page).toContain("Work/school accounts, Google and Apple sign-in are not supported");
      expect(page).toContain("https://signup.live.com");
    }
  });

  it("renders review forms with token, action and capacity blocking for accept only", () => {
    const accept = renderReviewPage({ request, action: "accept", token: "tok", formAction: "/admin/invites/abc/decision", capacity });
    expect(accept).toContain('method="post" action="/admin/invites/abc/decision"');
    expect(accept).toContain('name="token" value="tok"');
    expect(accept).toContain('name="action" value="accept"');
    expect(accept).toContain("disabled");
    expect(accept).toContain("Player capacity reached");

    const deny = renderReviewPage({ request, action: "deny", token: "tok", formAction: "/admin/invites/abc/decision", capacity });
    expect(deny).toContain('name="action" value="deny"');
    expect(deny).toContain("Confirm deny");
    expect(deny).not.toContain('type="submit" disabled');
  });

  it("renders resend email forms for pending and accepted requests with unsent mail flags", () => {
    const page = renderAdminListPage({
      requests: [
        { ...request, id: "pending", status: "pending", approvalEmailSent: false },
        { ...request, id: "accepted", status: "accepted", acceptedEmailSent: false },
        { ...request, id: "sent", status: "pending", approvalEmailSent: true },
        { ...request, id: "denied", status: "denied", approvalEmailSent: false },
      ],
      capacity,
      reviewUrl: (id, action) => `/admin/invites/${id}?action=${action}`,
      resendForm: (entry) => ({ action: `/admin/invites/${entry.id}/resend`, token: `token-${entry.id}` }),
    });
    expect(page).toContain('method="post" action="/admin/invites/pending/resend"');
    expect(page).toContain('value="token-pending"');
    expect(page).toMatch(/approval email not sent/i);
    expect(page).toContain('method="post" action="/admin/invites/accepted/resend"');
    expect(page).toMatch(/accepted email not sent/i);
    expect(page).not.toContain("/admin/invites/sent/resend");
    expect(page).not.toContain("/admin/invites/denied/resend");
  });
});
