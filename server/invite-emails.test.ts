import { describe, expect, it } from "vitest";
import { acceptedEmail, approvalEmail, microsoftAccountNotice } from "./invite-emails.ts";

const capacity = {
  players: 9,
  reserved: 1,
  maxPlayers: 10,
  databaseSizeGb: 21.25,
  sizeLimitGb: 24,
  available: false,
};

describe("invite email templates", () => {
  it("escapes user values in approval email HTML and keeps header values static", () => {
    const email = approvalEmail({
      request: {
        id: "abc",
        email: 'bad"><script>alert(1)</script>@example.com',
        note: '<img src=x onerror="alert(1)">',
        requestedAt: new Date("2026-09-27T08:10:00.000Z"),
      },
      acceptUrl: "https://touchline.example/admin/invites/abc?action=accept",
      denyUrl: "https://touchline.example/admin/invites/abc?action=deny",
      listUrl: "https://touchline.example/admin/invites",
      capacity,
    });
    expect(email.subject).toBe("New Touchline invite request");
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;@example.com");
    expect(email.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(email.text).toContain("WARNING: capacity is unavailable");
    expect(email.text).toContain("Requested: 2026-09-27T08:10:00.000Z UTC");
  });

  it("includes accept, deny, full list links and approver confirmation wording", () => {
    const email = approvalEmail({
      request: { id: "abc", email: "player@example.com", note: null, requestedAt: new Date("2026-09-27T08:10:00.000Z") },
      acceptUrl: "https://touchline.example/admin/invites/abc?action=accept",
      denyUrl: "https://touchline.example/admin/invites/abc?action=deny",
      listUrl: "https://touchline.example/admin/invites",
      capacity: { ...capacity, available: true },
    });
    expect(email.text).toContain("ACCEPT:");
    expect(email.text).toContain("DENY:");
    expect(email.text).toContain("where the approver signs in and confirms");
    expect(email.html).toContain("View the full invite list");
  });

  it("puts the required personal Microsoft account wording in the accepted email", () => {
    const email = acceptedEmail({
      email: 'player+one"><b>@example.com',
      appUrl: "https://touchline.example/",
      inviteUrl: "https://touchline.example/invite",
    });
    expect(email.subject).toBe("You're in — welcome to Touchline");
    expect(email.text).toContain("Congratulations, you can now sign in and play Touchline.");
    expect(email.text).toContain("personal Microsoft account (Outlook.com, Hotmail, Live.com, MSN, or any email address registered as a Microsoft account)");
    expect(email.text).toContain("using exactly player+one\"><b>@example.com");
    expect(email.text).toContain("Work/school accounts, Google and Apple sign-in are not supported");
    expect(email.text).toContain("https://signup.live.com");
    expect(email.html).toContain("player+one&quot;&gt;&lt;b&gt;@example.com");
    expect(email.html).not.toContain("<script>");
  });

  it("shares the Microsoft-account notice helper with pages", () => {
    const notice = microsoftAccountNotice();
    expect(notice.text).toContain("exactly the approved email address");
    expect(notice.html).toContain("Personal Microsoft account required");
  });
});
