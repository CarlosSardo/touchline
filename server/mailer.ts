import nodemailer, { type Transporter } from "nodemailer";

export interface MailMessage { to: string; subject: string; text: string; html: string }
export interface Mailer { send(message: MailMessage): Promise<void> }

const HEADER_VALUE = /^[^\r\n]+$/;
const EMAIL_ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
let disabledHostedWarningLogged = false;

export class MailDisabledError extends Error {
  readonly code = "email_disabled";

  constructor() {
    super("Email delivery is disabled. Set EMAIL_TRANSPORT=gmail and SMTP_PASSWORD to send mail.");
    this.name = "MailDisabledError";
  }
}

function validateMailMessage(message: MailMessage) {
  if (!HEADER_VALUE.test(message.to) || !EMAIL_ADDRESS.test(message.to) || message.to.length > 320)
    throw new Error("Invalid recipient email address.");
  if (!HEADER_VALUE.test(message.subject))
    throw new Error("Invalid email subject.");
}

function linksFrom(message: MailMessage) {
  return [...new Set(`${message.text}\n${message.html}`.match(/https?:\/\/[^\s"'<>]+/g) ?? [])];
}

export class LogMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    validateMailMessage(message);
    this.sent.push(message);
    const links = linksFrom(message);
    console.log(`[mail:log] to=${message.to} subject="${message.subject}" links=${links.length ? links.join(" ") : "none"}`);
  }
}

export class DisabledMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    validateMailMessage(message);
    throw new MailDisabledError();
  }
}

class SmtpMailer implements Mailer {
  constructor(private readonly transporter: Transporter, private readonly from: string) {}

  async send(message: MailMessage): Promise<void> {
    validateMailMessage(message);
    await this.transporter.sendMail({ ...message, from: this.from });
  }
}

export function createMailer(environment: NodeJS.ProcessEnv = process.env): Mailer {
  const transport = (environment.EMAIL_TRANSPORT ?? "log").toLowerCase();
  if (transport === "log") {
    if (environment.REQUIRE_AUTH === "true")
      throw new Error("EMAIL_TRANSPORT=log is not allowed when REQUIRE_AUTH=true; use gmail or disabled.");
    return new LogMailer();
  }
  if (transport === "disabled") {
    if (environment.REQUIRE_AUTH === "true" && !disabledHostedWarningLogged) {
      disabledHostedWarningLogged = true;
      console.warn("[mail:disabled] Hosted email delivery is disabled; invite requests will be stored with email flags unset until SMTP is configured.");
    }
    return new DisabledMailer();
  }
  if (transport !== "gmail") throw new Error(`Unsupported EMAIL_TRANSPORT "${transport}". Use "gmail", "log", or "disabled".`);

  const user = environment.SMTP_USER;
  const pass = environment.SMTP_PASSWORD;
  if (!user || !pass) throw new Error("SMTP_USER and SMTP_PASSWORD are required when EMAIL_TRANSPORT=gmail.");
  if (!EMAIL_ADDRESS.test(user) || user.length > 320) throw new Error("SMTP_USER must be a valid email address.");

  return new SmtpMailer(nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  }), environment.SMTP_FROM || `Touchline <${user}>`);
}
