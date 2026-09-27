import { describe, expect, it, vi } from "vitest";
import { createMailer, DisabledMailer, LogMailer, MailDisabledError, type MailMessage } from "./mailer.ts";

const message: MailMessage = {
  to: "approver@example.com",
  subject: "Invite",
  text: "Open https://touchline.example/invite",
  html: '<a href="https://touchline.example/invite">Open</a>',
};

describe("mailer", () => {
  it("uses the log transport by default and records sent mail", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const mailer = createMailer({});
      expect(mailer).toBeInstanceOf(LogMailer);
      await mailer.send(message);
      expect((mailer as LogMailer).sent).toEqual([message]);
      expect(log.mock.calls[0][0]).toContain("https://touchline.example/invite");
    } finally {
      log.mockRestore();
    }
  });

  it("selects gmail only when the required SMTP configuration is present", () => {
    expect(() => createMailer({ EMAIL_TRANSPORT: "gmail", SMTP_USER: "touchline@example.com" }))
      .toThrow("SMTP_USER and SMTP_PASSWORD are required");
    expect(() => createMailer({ EMAIL_TRANSPORT: "gmail", SMTP_PASSWORD: "secret" }))
      .toThrow("SMTP_USER and SMTP_PASSWORD are required");
    expect(() => createMailer({ EMAIL_TRANSPORT: "gmail", SMTP_USER: "touchline@example.com", SMTP_PASSWORD: "secret" }))
      .not.toThrow();
  });

  it("rejects header injection and invalid recipients before sending", async () => {
    const mailer = createMailer({});
    await expect(mailer.send({ ...message, to: "victim@example.com\r\nbcc:attacker@example.com" }))
      .rejects.toThrow("Invalid recipient");
    await expect(mailer.send({ ...message, to: "not-an-address" })).rejects.toThrow("Invalid recipient");
    await expect(mailer.send({ ...message, subject: "Invite\nbcc:attacker@example.com" }))
      .rejects.toThrow("Invalid email subject");
  });

  it("rejects unsupported transports clearly", () => {
    expect(() => createMailer({ EMAIL_TRANSPORT: "smtp" })).toThrow('Unsupported EMAIL_TRANSPORT "smtp"');
  });

  it("uses disabled transport for hosted deploys without SMTP and throws a typed send error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const mailer = createMailer({ EMAIL_TRANSPORT: "disabled", REQUIRE_AUTH: "true" });
      expect(mailer).toBeInstanceOf(DisabledMailer);
      await expect(mailer.send(message)).rejects.toBeInstanceOf(MailDisabledError);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("Hosted email delivery is disabled"));
    } finally {
      warn.mockRestore();
    }
  });

  it("rejects log transport when hosted auth is required", () => {
    expect(() => createMailer({ EMAIL_TRANSPORT: "log", REQUIRE_AUTH: "true" }))
      .toThrow("EMAIL_TRANSPORT=log is not allowed");
  });
});
