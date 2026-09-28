import { escapeHtml, microsoftAccountNoticeBody } from "./invite-emails.ts";

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

// Mirrors the game's theme tokens and button system in src/game.css (teal accent, 6–8px radii).
const pageStyle = `
  :root{color-scheme:light dark;--bg:#f5f7f8;--surface:#fff;--surface-2:#f9fafb;--text:#25302f;--muted:#56625e;--line:#e1e7e4;
    --accent:#087f6d;--on-accent:#fff;--accent-soft:color-mix(in srgb,var(--accent) 9%,var(--surface));--red:#b3443c;--on-red:#fff;
    --green:#137a61;--amber:#8a6212;--shadow:0 1px 2px rgba(16,36,28,.05),0 12px 32px rgba(16,36,28,.07)}
  @media (prefers-color-scheme:dark){:root{--bg:#171b1d;--surface:#202628;--surface-2:#282f31;--text:#edf3ef;--muted:#b3c1ba;--line:#3b4546;
    --accent:#86c4b8;--on-accent:#10241c;--red:#f29186;--on-red:#2b0f0c;--green:#70c9aa;--amber:#dfb866;--shadow:0 12px 32px rgba(0,0,0,.35)}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 "DM Sans Variable","DM Sans",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
  a{color:var(--accent);text-underline-offset:3px} strong{color:var(--text);font-weight:700}
  .shell{width:min(760px,100%);margin:0 auto;padding:48px 20px} .shell.wide{width:min(980px,100%)}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:clamp(22px,4vw,36px);box-shadow:var(--shadow)}
  .eyebrow{margin:0 0 8px;color:var(--accent);font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
  h1{margin:0 0 12px;color:var(--text);font:800 clamp(1.8rem,4.5vw,2.6rem)/1.1 "Manrope Variable","Manrope",system-ui,sans-serif;letter-spacing:-.02em}
  h2{margin:0;color:var(--text);font:700 1.05rem/1.3 "Manrope Variable","Manrope",system-ui,sans-serif;overflow-wrap:anywhere}
  p{margin:0 0 14px} .lead{font-size:1.02rem} .meta,.hint{color:var(--muted);font-size:.88rem} .hint{margin:0}
  .form{display:grid;gap:18px;margin-top:24px} .field{display:grid;gap:6px} label{font-weight:700}
  input,textarea{width:100%;min-height:44px;border:1px solid var(--line);border-radius:8px;padding:10px 12px;background:var(--surface-2);color:var(--text);font:inherit}
  input:hover,textarea:hover{border-color:color-mix(in srgb,var(--accent) 35%,var(--line))} textarea{min-height:112px;resize:vertical}
  :focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 45%,transparent);outline-offset:2px}
  .button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:9px 16px;border:1px solid transparent;border-radius:8px;
    font-family:inherit;font-size:.9rem;font-weight:650;line-height:1.2;text-decoration:none;cursor:pointer;white-space:nowrap;transition:filter .2s,background .2s}
  .button:hover{filter:brightness(.96)} .button:disabled{cursor:not-allowed;opacity:.45;filter:none}
  .button-primary{background:var(--accent);color:var(--on-accent)} .button-secondary{background:var(--surface);color:var(--text);border-color:var(--line)}
  .button-danger{background:color-mix(in srgb,var(--red) 12%,var(--surface));color:var(--red);border-color:color-mix(in srgb,var(--red) 28%,var(--surface))}
  .button-danger-strong{background:var(--red);color:var(--on-red)}
  .actions{display:flex;flex-wrap:wrap;gap:10px 12px;align-items:center} .inline-form{display:contents}
  .notice{margin:20px 0;padding:14px 16px;border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:8px;background:var(--accent-soft)}
  .notice p{margin:4px 0 0} .notice.error{border-left-color:var(--red);background:color-mix(in srgb,var(--red) 10%,var(--surface));color:var(--text)}
  .notice.success{border-left-color:var(--green);background:color-mix(in srgb,var(--green) 10%,var(--surface))} .error-text{margin:10px 0 0;color:var(--red)}
  .stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;margin:20px 0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--line)}
  .stat{display:grid;gap:2px;padding:12px 14px;background:var(--surface-2)} .stat span{color:var(--muted);font-size:.78rem} .stat strong{font-size:1.1rem;font-variant-numeric:tabular-nums}
  .stats-warning{grid-column:1/-1;margin:0;padding:10px 14px;background:color-mix(in srgb,var(--red) 10%,var(--surface));color:var(--red);font-weight:600}
  .list{display:grid;gap:12px;margin:0;padding:0;list-style:none}
  .request{display:grid;gap:10px;padding:16px 18px;border:1px solid var(--line);border-radius:10px;background:var(--surface-2)}
  .request-head{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:space-between} .request p{margin:0}
  .note{padding-left:12px;border-left:2px solid var(--line)} .note.empty{color:var(--muted);font-style:italic}
  .badge{display:inline-flex;align-items:center;min-height:22px;padding:2px 9px;border-radius:999px;font-size:.75rem;font-weight:700;
    background:color-mix(in srgb,currentColor 12%,transparent);white-space:nowrap}
  .badge.pending,.badge.warn{color:var(--amber)} .badge.accepted,.badge.claimed{color:var(--green)} .badge.denied{color:var(--red)}
  .hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden} .divider{height:1px;margin:24px 0 16px;background:var(--line);border:0}
  @media (max-width:640px){.shell{padding:16px 12px}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.actions .button{flex:1 1 auto}}`;

function layout(title: string, body: string, wide = false) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'none'; img-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"><title>${escapeHtml(title)}</title><style>${pageStyle}</style></head><body><main class="shell${wide ? " wide" : ""}">${body}</main></body></html>`;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
});

function dateTime(date: Date) {
  return `<time datetime="${date.toISOString()}">${dateFormat.format(date)} UTC</time>`;
}

function statusBadge(status: string) {
  const known = ["pending", "accepted", "denied", "claimed"].includes(status) ? status : "";
  const label = status ? status[0].toUpperCase() + status.slice(1) : status;
  return `<span class="badge ${known}">${escapeHtml(label)}</span>`;
}

function noteBlock(note: string | null) {
  return note?.trim()
    ? `<p class="note">${escapeHtml(note)}</p>`
    : `<p class="note empty">No note.</p>`;
}

function accountNotice(email?: string) {
  return `<div class="notice"><strong>Personal Microsoft account required</strong><p>${microsoftAccountNoticeBody(email)}</p></div>`;
}

function capacityPanel(capacity: InviteCapacityView) {
  const unavailable = capacity.available ? "" : `<p class="stats-warning" role="alert">Warning: ${escapeHtml(capacity.reason ?? "Capacity is unavailable.")}</p>`;
  return `<section class="stats" aria-label="Capacity snapshot">
    <div class="stat"><span>Players</span><strong>${capacity.players} / ${capacity.maxPlayers}</strong></div>
    <div class="stat"><span>Reserved invites</span><strong>${capacity.reserved}</strong></div>
    <div class="stat"><span>Database used</span><strong>${capacity.databaseSizeGb.toFixed(2)} GB</strong></div>
    <div class="stat"><span>Database limit</span><strong>${capacity.sizeLimitGb} GB</strong></div>
    ${unavailable}</section>`;
}

export function renderInvitePage(input: { state: "form" | "submitted" | "error"; message?: string; email?: string; note?: string }): string {
  const message = input.state === "submitted"
    ? `<div class="notice success" role="status"><strong>Thanks — if approved you'll get an email at that address.</strong></div>`
    : input.state === "error" && input.message
      ? `<div class="notice error" role="alert">${escapeHtml(input.message)}</div>`
      : "";
  return layout("Request an invite", `<section class="card">
    <p class="eyebrow">Touchline access</p>
    <h1>Request an invite</h1>
    <p class="lead">Touchline is a football sporting-director sim about building squads, managing transfers and steering a club through a living football world.</p>
    ${message}
    ${accountNotice()}
    <form class="form" method="post" action="/invite">
      <div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" required maxlength="320" autocomplete="email" value="${escapeHtml(input.email ?? "")}"></div>
      <div class="field"><label for="note">Optional note</label><textarea id="note" name="note" maxlength="500" autocomplete="off">${escapeHtml(input.note ?? "")}</textarea><p class="hint">A sentence about who you are or why you want to play is enough.</p></div>
      <div class="hp" aria-hidden="true"><label for="website">Website</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>
      <div class="actions"><button class="button button-primary" type="submit">Request invite</button><a href="/">Already invited? Sign in</a></div>
    </form>
    <hr class="divider">
    <p class="hint">Privacy: we store your email and a hashed IP to review the request; denied requests are deleted after 30 days, unanswered requests after 60 days.</p>
  </section>`);
}

export function renderNotInvitedPage(input: { inviteUrl: string; logoutUrl: string; email: string | null }): string {
  const email = input.email ? `<p class="meta">Signed in as ${escapeHtml(input.email)}.</p>` : "";
  return layout("Invite required", `<section class="card">
    <p class="eyebrow">Access needed</p>
    <h1>You are not invited yet</h1>
    <p class="lead">Touchline is invite-only while the player worlds are capped.</p>
    ${email}
    ${accountNotice(input.email ?? undefined)}
    <div class="actions"><a class="button button-primary" href="${escapeHtml(input.inviteUrl)}">Request an invite</a><a href="${escapeHtml(input.logoutUrl)}">Signed in with the wrong account?</a></div>
  </section>`);
}

export function renderAdminListPage(input: {
  requests: InviteRequestView[];
  capacity: InviteCapacityView;
  reviewUrl: (id: string, action: "accept" | "deny") => string;
  resendForm?: (request: InviteRequestView) => { action: string; token: string } | null;
}): string {
  const requests = input.requests.length ? input.requests.map((request) => {
    const pending = request.status === "pending";
    const decisions = pending
      ? `<a class="button button-primary" href="${escapeHtml(input.reviewUrl(request.id, "accept"))}">Review accept</a><a class="button button-danger" href="${escapeHtml(input.reviewUrl(request.id, "deny"))}">Review deny</a>`
      : "";
    const resend = resendEmailForm(request, input.resendForm);
    const actions = decisions || resend ? `<div class="actions">${decisions}${resend}</div>` : "";
    return `<li class="request">
    <div class="request-head"><h2>${escapeHtml(request.email)}</h2>${statusBadge(request.status)}</div>
    <p class="meta">Requested ${dateTime(request.requestedAt)}${emailWarning(request)}</p>
    ${noteBlock(request.note)}
    ${actions}
  </li>`;
  }).join("") : `<li class="request"><p class="meta">No invite requests yet.</p></li>`;
  return layout("Invite requests", `<section class="card">
    <p class="eyebrow">Touchline admin</p>
    <h1>Invite requests</h1>
    ${capacityPanel(input.capacity)}
    <ul class="list">${requests}</ul>
  </section>`, true);
}

function needsResend(request: InviteRequestView) {
  if (request.status === "pending") return request.approvalEmailSent === false;
  if (request.status === "accepted") return request.acceptedEmailSent === false;
  return false;
}

function emailWarning(request: InviteRequestView) {
  if (!needsResend(request)) return "";
  return ` · <span class="badge warn">${request.status === "accepted" ? "Accepted" : "Approval"} email not sent</span>`;
}

function resendEmailForm(
  request: InviteRequestView,
  resendForm?: (request: InviteRequestView) => { action: string; token: string } | null,
) {
  if (!needsResend(request) || !resendForm) return "";
  const form = resendForm(request);
  if (!form) return "";
  const kind = request.status === "accepted" ? "accepted email" : "approval email";
  return `<form class="inline-form" method="post" action="${escapeHtml(form.action)}" aria-label="Resend ${kind}">
    <input type="hidden" name="token" value="${escapeHtml(form.token)}">
    <input type="hidden" name="action" value="resend">
    <button class="button button-secondary" type="submit">Resend ${kind}</button>
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
    <p class="lead">The email link only opens this signed-in review page. Confirm below to make the decision.</p>
    ${error}
    <section class="request">
      <div class="request-head"><h2>${escapeHtml(input.request.email)}</h2>${statusBadge(input.request.status)}</div>
      <p class="meta">Requested ${dateTime(input.request.requestedAt)}</p>
      ${noteBlock(input.request.note)}
    </section>
    ${capacityPanel(input.capacity)}
    <form class="form" method="post" action="${escapeHtml(input.formAction)}">
      <input type="hidden" name="token" value="${escapeHtml(input.token)}">
      <input type="hidden" name="action" value="${input.action}">
      <div class="actions"><button class="button ${input.action === "deny" ? "button-danger-strong" : "button-primary"}" type="submit"${isAcceptBlocked ? " disabled" : ""}>${confirm}</button><a href="/admin/invites">Back to invite list</a></div>
      ${isAcceptBlocked ? `<p class="error-text">Accept is disabled: ${escapeHtml(input.capacity.reason ?? "capacity unavailable")}.</p>` : ""}
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
  const email = input.email ? `<p class="lead"><strong>${escapeHtml(input.email)}</strong></p>` : "";
  const sent = input.outcome === "accepted" ? `<p class="meta">Accepted email ${input.emailSent ? "sent" : "not sent yet"}.</p>` : "";
  return layout(title, `<section class="card">
    <p class="eyebrow">Invite decision</p>
    <h1>${title}</h1>
    ${email}${sent}
    <div class="actions"><a class="button button-primary" href="${escapeHtml(input.listUrl)}">Back to invite list</a></div>
  </section>`);
}
