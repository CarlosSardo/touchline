import type { MailMessage } from "./mailer.ts";

interface InviteRequestEmail { id: string; email: string; note: string | null; requestedAt: Date }
interface InviteCapacityEmail {
  players: number; reserved: number; maxPlayers: number; databaseSizeGb: number; sizeLimitGb: number; available: boolean
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function style(value: string) {
  return ` style="${value}"`;
}

function actionButton(label: string, href: string, background: string) {
  return `<a${style(`display:inline-block;margin:8px 10px 8px 0;padding:14px 22px;border-radius:999px;background:${background};color:#ffffff;font-weight:800;text-decoration:none;letter-spacing:.04em;`)} href="${escapeHtml(href)}">${label}</a>`;
}

function textCapacity(capacity: InviteCapacityEmail) {
  return [
    `Players used/max: ${capacity.players}/${capacity.maxPlayers}`,
    `Reserved accepted invites: ${capacity.reserved}`,
    `Database: ${capacity.databaseSizeGb.toFixed(2)} GB / ${capacity.sizeLimitGb} GB`,
    capacity.available ? "Capacity: available" : "WARNING: capacity is unavailable; accepting is blocked until capacity is freed.",
  ].join("\n");
}

function htmlCapacity(capacity: InviteCapacityEmail) {
  const warning = capacity.available
    ? ""
    : `<p${style("margin:12px 0 0;color:#b91c1c;font-weight:800;")}>Warning: capacity is unavailable; accepting is blocked until capacity is freed.</p>`;
  return `<div${style("margin:18px 0;padding:16px;border:1px solid #d7dce5;border-radius:16px;background:#f8fafc;color:#273244;")}>
    <strong>Capacity snapshot</strong>
    <ul${style("margin:10px 0 0;padding-left:20px;")}>
      <li>Players used/max: ${capacity.players}/${capacity.maxPlayers}</li>
      <li>Reserved accepted invites: ${capacity.reserved}</li>
      <li>Database: ${capacity.databaseSizeGb.toFixed(2)} GB / ${capacity.sizeLimitGb} GB</li>
    </ul>
    ${warning}
  </div>`;
}

export function microsoftAccountNotice(email?: string): { text: string; html: string } {
  const approved = email ? `exactly ${email}` : "exactly the approved email address";
  const htmlApproved = email ? `exactly <strong>${escapeHtml(email)}</strong>` : "exactly the approved email address";
  const text = `Sign in with a personal Microsoft account (Outlook.com, Hotmail, Live.com, MSN, or any email address registered as a Microsoft account) using ${approved}. Work/school accounts, Google and Apple sign-in are not supported. No Microsoft account yet? Create one free at https://signup.live.com with this email.`;
  const html = `<div${style("margin:20px 0;padding:18px;border:2px solid #aa3bff;border-radius:18px;background:rgba(170,59,255,.10);color:#171221;")}>
    <strong>Personal Microsoft account required</strong>
    <p${style("margin:8px 0 0;")}>Sign in with a <strong>personal Microsoft account</strong> (Outlook.com, Hotmail, Live.com, MSN, or any email address registered as a Microsoft account) using ${htmlApproved}. Work/school accounts, Google and Apple sign-in are not supported. No Microsoft account yet? Create one free at <a href="https://signup.live.com">https://signup.live.com</a> with this email.</p>
  </div>`;
  return { text, html };
}

export function approvalEmail(input: {
  request: InviteRequestEmail;
  acceptUrl: string;
  denyUrl: string;
  listUrl: string;
  capacity: InviteCapacityEmail;
}): Pick<MailMessage, "subject" | "text" | "html"> {
  const requestedAt = input.request.requestedAt.toISOString();
  const note = input.request.note?.trim() || "None";
  const subject = "New Touchline invite request";
  const text = [
    "New Touchline invite request",
    "",
    `Requester: ${input.request.email}`,
    `Note: ${note}`,
    `Requested: ${requestedAt} UTC`,
    "",
    textCapacity(input.capacity),
    "",
    "ACCEPT:",
    input.acceptUrl,
    "",
    "DENY:",
    input.denyUrl,
    "",
    "These links open review pages where the approver signs in and confirms before a decision is made.",
    `Full list: ${input.listUrl}`,
  ].join("\n");
  const html = `<!doctype html><html><body${style("margin:0;padding:24px;background:#f4f3ec;color:#171221;font-family:'DM Sans','Manrope',Arial,sans-serif;")}>
    <main${style("max-width:680px;margin:0 auto;padding:26px;border:1px solid #d7dce5;border-radius:24px;background:#ffffff;")}>
      <p${style("margin:0 0 8px;color:#6b6375;text-transform:uppercase;letter-spacing:.08em;font-size:12px;font-weight:800;")}>Touchline access</p>
      <h1${style("margin:0 0 16px;font-size:30px;line-height:1.1;color:#08060d;")}>New invite request</h1>
      <p${style("margin:0 0 10px;")}><strong>Requester:</strong> ${escapeHtml(input.request.email)}</p>
      <p${style("margin:0 0 10px;")}><strong>Note:</strong> ${escapeHtml(note)}</p>
      <p${style("margin:0 0 10px;")}><strong>Requested:</strong> ${escapeHtml(requestedAt)} UTC</p>
      ${htmlCapacity(input.capacity)}
      <div${style("margin:18px 0;")}>
        ${actionButton("ACCEPT", input.acceptUrl, "#15803d")}
        ${actionButton("DENY", input.denyUrl, "#b91c1c")}
      </div>
      <p${style("margin:12px 0;color:#6b6375;")}>These links open review pages where the approver signs in and confirms before a decision is made.</p>
      <p${style("margin:18px 0 0;")}><a href="${escapeHtml(input.listUrl)}">View the full invite list</a></p>
    </main>
  </body></html>`;
  return { subject, text, html };
}

export function acceptedEmail(input: { email: string; appUrl: string; inviteUrl: string }): Pick<MailMessage, "subject" | "text" | "html"> {
  const notice = microsoftAccountNotice(input.email);
  const subject = "You're in — welcome to Touchline";
  const text = [
    "Congratulations, you can now sign in and play Touchline.",
    "",
    `App: ${input.appUrl}`,
    "",
    notice.text,
    "",
    `If you need the invite page again: ${input.inviteUrl}`,
  ].join("\n");
  const html = `<!doctype html><html><body${style("margin:0;padding:24px;background:#f4f3ec;color:#171221;font-family:'DM Sans','Manrope',Arial,sans-serif;")}>
    <main${style("max-width:680px;margin:0 auto;padding:28px;border:1px solid #d7dce5;border-radius:24px;background:#ffffff;")}>
      <p${style("margin:0 0 8px;color:#6b6375;text-transform:uppercase;letter-spacing:.08em;font-size:12px;font-weight:800;")}>Welcome to Touchline</p>
      <h1${style("margin:0 0 16px;font-size:32px;line-height:1.1;color:#08060d;")}>Congratulations, you can now sign in and play Touchline.</h1>
      <p${style("margin:0 0 18px;color:#273244;")}>Your approved address is <strong>${escapeHtml(input.email)}</strong>.</p>
      <p${style("margin:0 0 18px;")}><a${style("display:inline-block;padding:14px 22px;border-radius:999px;background:#aa3bff;color:#fff;font-weight:800;text-decoration:none;")} href="${escapeHtml(input.appUrl)}">Open Touchline</a></p>
      ${notice.html}
      <p${style("margin:18px 0 0;color:#6b6375;font-size:14px;")}>Invite page: <a href="${escapeHtml(input.inviteUrl)}">${escapeHtml(input.inviteUrl)}</a></p>
    </main>
  </body></html>`;
  return { subject, text, html };
}
