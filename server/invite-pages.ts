import { escapeHtml, microsoftAccountNotice } from "./invite-emails.ts";

export interface InviteRequestView {
  id: string;
  email: string;
  note: string | null;
  status: string;
  requestedAt: Date;
  decidedAt?: Date | null;
  decidedBy?: string | null;
  approvalEmailSent?: boolean;
  acceptedEmailSent?: boolean;
}
export interface InviteCapacityView {
  players: number;
  reserved: number;
  maxPlayers: number;
  databaseSizeGb: number;
  sizeLimitGb: number;
  available: boolean;
  reason: string | null;
}

const pageStyle = `
  :root{color-scheme:light dark;--text:#6b6375;--text-h:#08060d;--bg:#fff;--surface:#fff;--surface-2:#f4f3ec;--border:#e5e4e7;--accent:#aa3bff;--danger:#b91c1c;--ok:#15803d;--shadow:rgba(0,0,0,.10) 0 18px 44px}
  @media (prefers-color-scheme:dark){:root{--text:#9ca3af;--text-h:#f3f4f6;--bg:#16171d;--surface:#1f2028;--surface-2:#242631;--border:#2e303a;--accent:#c084fc;--danger:#f87171;--ok:#4ade80;--shadow:rgba(0,0,0,.35) 0 18px 44px}}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 "DM Sans","Manrope",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.01em}
  a{color:var(--accent)} .shell{width:min(980px,100%);min-height:100svh;margin:0 auto;padding:40px 20px;border-inline:1px solid var(--border)}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:28px;padding:clamp(22px,4vw,42px);box-shadow:var(--shadow)} .eyebrow{margin:0 0 10px;color:var(--accent);font-size:.78rem;font-weight:800;text-transform:uppercase;letter-spacing:.10em}
  h1{margin:0 0 14px;color:var(--text-h);font:700 clamp(2rem,6vw,4.2rem)/.96 "Manrope","DM Sans",system-ui,sans-serif;letter-spacing:-.05em} h2{margin:0 0 12px;color:var(--text-h);font-size:1.25rem} p{margin:0 0 16px}
  form{display:grid;gap:16px;margin-top:24px}.field{display:grid;gap:7px} label{color:var(--text-h);font-weight:800} input,textarea{width:100%;min-height:48px;border:1px solid var(--border);border-radius:14px;padding:12px 14px;background:var(--surface-2);color:var(--text-h);font:inherit} textarea{min-height:120px;resize:vertical}
  input:focus,textarea:focus,button:focus,a:focus{outline:3px solid color-mix(in srgb,var(--accent),transparent 58%);outline-offset:2px}.hint{font-size:.9rem}.button,button{min-height:48px;border:0;border-radius:999px;padding:13px 20px;background:var(--accent);color:#fff;font:800 .95rem/1 "DM Sans",system-ui,sans-serif;letter-spacing:.02em;text-decoration:none;cursor:pointer}.button.danger,button.danger{background:var(--danger)}button:disabled{cursor:not-allowed;opacity:.55}
  .notice,.capacity{margin:18px 0;padding:18px;border:1px solid var(--border);border-radius:20px;background:var(--surface-2)}.notice strong,.capacity strong{color:var(--text-h)}.error{border-color:var(--danger);color:var(--danger)}.success{border-color:var(--ok)}.hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.list{display:grid;gap:12px;margin:20px 0 0;padding:0;list-style:none}.request{padding:16px;border:1px solid var(--border);border-radius:18px;background:var(--surface-2)}.meta{color:var(--text);font-size:.92rem}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}@media (max-width:680px){.shell{padding:20px 14px;border:0}.grid{grid-template-columns:1fr}.actions .button,.actions button{width:100%;text-align:center}}`;

function layout(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'none'; img-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"><title>${escapeHtml(title)}</title><style>${pageStyle}</style></head><body><main class="shell">${body}</main></body></html>`;
}

function dateTime(date: Date) {
  return date.toISOString().replace(".000Z", "Z");
}

function capacityPanel(capacity: InviteCapacityView) {
  const unavailable = capacity.available ? "" : `<p class="error"><strong>Warning:</strong> ${escapeHtml(capacity.reason ?? "Capacity is unavailable.")}</p>`;
  return `<section class="capacity" aria-label="Capacity snapshot"><strong>Capacity snapshot</strong><div class="grid">
    <p>Players used/max<br><strong>${capacity.players}/${capacity.maxPlayers}</strong></p>
    <p>Reserved invites<br><strong>${capacity.reserved}</strong></p>
    <p>Database used<br><strong>${capacity.databaseSizeGb.toFixed(2)} GB</strong></p>
    <p>Database limit<br><strong>${capacity.sizeLimitGb} GB</strong></p>
  </div>${unavailable}</section>`;
}

export function renderInvitePage(input: { state: "form" | "submitted" | "error"; message?: string; email?: string; note?: string }): string {
  const message = input.state === "submitted"
    ? `<div class="notice success" role="status"><strong>Thanks — if approved you'll get an email at that address.</strong></div>`
    : input.state === "error" && input.message
      ? `<div class="notice error" role="alert">${escapeHtml(input.message)}</div>`
      : "";
  const notice = microsoftAccountNotice().html;
  return layout("Request an invite", `<section class="card">
    <p class="eyebrow">Touchline access</p>
    <h1>Request an invite</h1>
    <p>Touchline is a football sporting-director sim about building squads, managing transfers and steering a club through a living football world.</p>
    ${message}
    <div class="notice">${notice}</div>
    <form method="post" action="/invite">
      <div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" required maxlength="320" autocomplete="email" value="${escapeHtml(input.email ?? "")}"></div>
      <div class="field"><label for="note">Optional note</label><textarea id="note" name="note" maxlength="500" autocomplete="off">${escapeHtml(input.note ?? "")}</textarea><p class="hint">A sentence about who you are or why you want to play is enough.</p></div>
      <div class="hp" aria-hidden="true"><label for="website">Website</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>
      <div class="actions"><button type="submit">Request invite</button><a href="/">Already invited? Sign in</a></div>
    </form>
    <p class="hint">Privacy: we store your email and a hashed IP to review the request; denied requests are deleted after 30 days, unanswered requests after 60 days.</p>
  </section>`);
}

export function renderNotInvitedPage(input: { inviteUrl: string; logoutUrl: string; email: string | null }): string {
  const email = input.email ? `<p class="meta">Signed in as ${escapeHtml(input.email)}.</p>` : "";
  return layout("Invite required", `<section class="card">
    <p class="eyebrow">Access needed</p>
    <h1>You are not invited yet</h1>
    <p>Touchline is invite-only while the player worlds are capped.</p>
    ${email}
    <div class="notice">${microsoftAccountNotice(input.email ?? undefined).html}</div>
    <div class="actions"><a class="button" href="${escapeHtml(input.inviteUrl)}">Request an invite</a><a href="${escapeHtml(input.logoutUrl)}">Signed in with the wrong account?</a></div>
  </section>`);
}

export function renderAdminListPage(input: {
  requests: InviteRequestView[];
  capacity: InviteCapacityView;
  reviewUrl: (id: string, action: "accept" | "deny") => string;
  resendForm?: (request: InviteRequestView) => { action: string; token: string } | null;
}): string {
  const requests = input.requests.length ? input.requests.map((request) => `<li class="request">
    <h2>${escapeHtml(request.email)}</h2>
    <p class="meta">Status: ${escapeHtml(request.status)} · Requested ${dateTime(request.requestedAt)}</p>
    <p>${escapeHtml(request.note || "No note.")}</p>
    ${resendEmailForm(request, input.resendForm)}
    <div class="actions"><a class="button" href="${escapeHtml(input.reviewUrl(request.id, "accept"))}">Review accept</a><a class="button danger" href="${escapeHtml(input.reviewUrl(request.id, "deny"))}">Review deny</a></div>
  </li>`).join("") : `<li class="request">No invite requests.</li>`;
  return layout("Invite requests", `<section class="card">
    <p class="eyebrow">Touchline admin</p>
    <h1>Invite requests</h1>
    ${capacityPanel(input.capacity)}
    <ul class="list">${requests}</ul>
  </section>`);
}

function needsResend(request: InviteRequestView) {
  if (request.status === "pending") return request.approvalEmailSent === false;
  if (request.status === "accepted") return request.acceptedEmailSent === false;
  return false;
}

function resendEmailForm(
  request: InviteRequestView,
  resendForm?: (request: InviteRequestView) => { action: string; token: string } | null,
) {
  if (!needsResend(request) || !resendForm) return "";
  const form = resendForm(request);
  if (!form) return "";
  const kind = request.status === "accepted" ? "accepted email" : "approval email";
  return `<form method="post" action="${escapeHtml(form.action)}" aria-label="Resend ${kind}">
    <input type="hidden" name="token" value="${escapeHtml(form.token)}">
    <input type="hidden" name="action" value="resend">
    <div class="actions"><button type="submit">Resend email</button><span class="meta">${kind} not sent.</span></div>
  </form>`;
}

export function renderReviewPage(input: {
  request: InviteRequestView;
  action: "accept" | "deny";
  token: string;
  formAction: string;
  capacity: InviteCapacityView;
  error?: string;
}): string {
  const isAcceptBlocked = input.action === "accept" && !input.capacity.available;
  const error = input.error ? `<div class="notice error" role="alert">${escapeHtml(input.error)}</div>` : "";
  const confirm = input.action === "deny" ? "Confirm deny" : "Confirm accept";
  return layout(`Review invite ${input.action}`, `<section class="card">
    <p class="eyebrow">Approver review</p>
    <h1>${input.action === "accept" ? "Accept invite?" : "Deny invite?"}</h1>
    <p>The email link only opens this signed-in review page. Confirm below to make the decision.</p>
    ${error}
    <section class="notice">
      <h2>${escapeHtml(input.request.email)}</h2>
      <p class="meta">Requested ${dateTime(input.request.requestedAt)} · Status ${escapeHtml(input.request.status)}</p>
      <p>${escapeHtml(input.request.note || "No note.")}</p>
    </section>
    ${capacityPanel(input.capacity)}
    <form method="post" action="${escapeHtml(input.formAction)}">
      <input type="hidden" name="token" value="${escapeHtml(input.token)}">
      <input type="hidden" name="action" value="${input.action}">
      <div class="actions"><button class="${input.action === "deny" ? "danger" : ""}" type="submit"${isAcceptBlocked ? " disabled" : ""}>${confirm}</button></div>
      ${isAcceptBlocked ? `<p class="error">Accept is disabled: ${escapeHtml(input.capacity.reason ?? "capacity unavailable")}.</p>` : ""}
    </form>
  </section>`);
}

export function renderDecisionPage(input: {
  outcome: "accepted" | "denied" | "unchanged" | "capacity" | "not_found" | "expired";
  email?: string;
  listUrl: string;
  emailSent?: boolean;
}): string {
  const title = {
    accepted: "Invite accepted",
    denied: "Invite denied",
    unchanged: "No change needed",
    capacity: "Capacity unavailable",
    not_found: "Invite not found",
    expired: "Review link expired",
  }[input.outcome];
  const email = input.email ? `<p>${escapeHtml(input.email)}</p>` : "";
  const sent = input.outcome === "accepted" ? `<p class="meta">Accepted email ${input.emailSent ? "sent" : "not sent yet"}.</p>` : "";
  return layout(title, `<section class="card">
    <p class="eyebrow">Invite decision</p>
    <h1>${title}</h1>
    ${email}${sent}
    <div class="actions"><a class="button" href="${escapeHtml(input.listUrl)}">Back to invite list</a></div>
  </section>`);
}
