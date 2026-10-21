export type AccessRequestStatus = "pending" | "approved" | "denied";

export interface AccessRequestView {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  status: AccessRequestStatus;
  requestedAt: Date;
  decidedAt?: Date | null;
  decidedBy?: string | null;
}

export interface PlayerView {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  createdAt?: Date | null;
  admin?: boolean;
}

export interface AccessCapacityView {
  players: number;
  maxPlayers: number;
  databaseGb: number;
  databaseLimitGb: number;
}

export type AdminFlashCode = "approved" | "denied" | "capacity" | "not_found" | "refused" | "unavailable";

export const adminFlashCodes: readonly AdminFlashCode[] = ["approved", "denied", "capacity", "not_found", "refused", "unavailable"];

/** Server-rendered pages never run scripts and only submit forms back to Touchline. */
export const pageContentSecurityPolicy =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'none'; img-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
  h3{margin:28px 0 12px;color:var(--text);font:700 1.15rem/1.3 "Manrope Variable","Manrope",system-ui,sans-serif}
  p{margin:0 0 14px} .lead{font-size:1.02rem} .meta,.hint{color:var(--muted);font-size:.88rem;overflow-wrap:anywhere} .hint{margin:0}
  :focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 45%,transparent);outline-offset:2px}
  .button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:9px 16px;border:1px solid transparent;border-radius:8px;
    font-family:inherit;font-size:.9rem;font-weight:650;line-height:1.2;text-decoration:none;cursor:pointer;white-space:nowrap;transition:filter .2s,background .2s}
  .button:hover{filter:brightness(.96)} .button:disabled{cursor:not-allowed;opacity:.45;filter:none}
  .button-primary{background:var(--accent);color:var(--on-accent)} .button-secondary{background:var(--surface);color:var(--text);border-color:var(--line)}
  .button-danger{background:color-mix(in srgb,var(--red) 12%,var(--surface));color:var(--red);border-color:color-mix(in srgb,var(--red) 28%,var(--surface))}
  .actions{display:flex;flex-wrap:wrap;gap:10px 12px;align-items:center} .inline-form{display:contents}
  .page-head{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:baseline;justify-content:space-between}
  .notice{margin:20px 0;padding:14px 16px;border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:8px;background:var(--accent-soft)}
  .notice p{margin:4px 0 0} .notice.error{border-left-color:var(--red);background:color-mix(in srgb,var(--red) 10%,var(--surface));color:var(--text)}
  .notice.success{border-left-color:var(--green);background:color-mix(in srgb,var(--green) 10%,var(--surface))}
  .stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;margin:20px 0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--line)}
  .stat{display:grid;gap:2px;padding:12px 14px;background:var(--surface-2)} .stat span{color:var(--muted);font-size:.78rem} .stat strong{font-size:1.1rem;font-variant-numeric:tabular-nums}
  .stats-warning{grid-column:1/-1;margin:0;padding:10px 14px;background:color-mix(in srgb,var(--red) 10%,var(--surface));color:var(--red);font-weight:600}
  .list{display:grid;gap:12px;margin:0;padding:0;list-style:none}
  .request{display:grid;gap:10px;padding:16px 18px;border:1px solid var(--line);border-radius:10px;background:var(--surface-2)}
  .request-head{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:space-between} .request p{margin:0}
  .empty{color:var(--muted);font-style:italic}
  .badge{display:inline-flex;align-items:center;min-height:22px;padding:2px 9px;border-radius:999px;font-size:.75rem;font-weight:700;
    background:color-mix(in srgb,currentColor 12%,transparent);white-space:nowrap}
  .badge.pending{color:var(--amber)} .badge.approved,.badge.admin{color:var(--green)} .badge.denied{color:var(--red)}
  @media (max-width:640px){.shell{padding:16px 12px}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.actions .button{flex:1 1 auto}}`;

function layout(title: string, body: string, wide = false) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${pageContentSecurityPolicy}"><title>${escapeHtml(title)}</title><style>${pageStyle}</style></head><body><main class="shell${wide ? " wide" : ""}">${body}</main></body></html>`;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
});

function dateTime(date: Date) {
  return `<time datetime="${date.toISOString()}">${dateFormat.format(date)} UTC</time>`;
}

function badge(kind: string, label: string) {
  return `<span class="badge ${escapeHtml(kind)}">${escapeHtml(label)}</span>`;
}

const statusLabels: Record<AccessRequestStatus, string> = { pending: "Pending", approved: "Approved", denied: "Denied" };

/** Why approvals would currently fail, or null when there is room. */
export function capacityProblem(capacity: AccessCapacityView): string | null {
  if (capacity.players >= capacity.maxPlayers)
    return `the player limit (${capacity.maxPlayers}) is reached`;
  if (capacity.databaseGb >= capacity.databaseLimitGb)
    return `the database size limit (${formatGb(capacity.databaseLimitGb)} GB) is reached`;
  return null;
}

function formatGb(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function capacityPanel(capacity: AccessCapacityView) {
  const problem = capacityProblem(capacity);
  const warning = problem
    ? `<p class="stats-warning" role="alert">Approvals are blocked: ${escapeHtml(problem)}.</p>`
    : "";
  return `<section class="stats" aria-label="Capacity">
    <div class="stat"><span>Players</span><strong>${capacity.players} / ${capacity.maxPlayers}</strong></div>
    <div class="stat"><span>Free player slots</span><strong>${Math.max(0, capacity.maxPlayers - capacity.players)}</strong></div>
    <div class="stat"><span>Database used</span><strong>${capacity.databaseGb.toFixed(2)} GB</strong></div>
    <div class="stat"><span>Database limit</span><strong>${formatGb(capacity.databaseLimitGb)} GB</strong></div>
    ${warning}</section>`;
}

function identityMeta(entry: { username: string; email: string | null }) {
  return [`@${escapeHtml(entry.username)}`, entry.email ? escapeHtml(entry.email) : null].filter(Boolean).join(" · ");
}

function decisionForm(id: string, action: "approve" | "deny", label: string, style: string) {
  return `<form class="inline-form" method="post" action="/admin/access/${encodeURIComponent(id)}/${action}"><button class="button ${style}" type="submit">${escapeHtml(label)}</button></form>`;
}

function requestItem(request: AccessRequestView) {
  const decided = request.decidedAt
    ? ` · ${statusLabels[request.status]} ${dateTime(request.decidedAt)}${request.decidedBy ? ` by ${escapeHtml(request.decidedBy)}` : ""}`
    : "";
  const actions = request.status === "pending"
    ? decisionForm(request.id, "approve", "Approve", "button-primary") + decisionForm(request.id, "deny", "Deny", "button-danger")
    : request.status === "denied"
      ? decisionForm(request.id, "approve", "Approve", "button-secondary")
      : "";
  return `<li class="request">
    <div class="request-head"><h2>${escapeHtml(request.displayName)}</h2>${badge(request.status, statusLabels[request.status])}</div>
    <p class="meta">${identityMeta(request)}</p>
    <p class="meta">Requested ${dateTime(request.requestedAt)}${decided}</p>
    ${actions ? `<div class="actions">${actions}</div>` : ""}
  </li>`;
}

function playerItem(player: PlayerView) {
  const joined = player.createdAt ? `<p class="meta">Joined ${dateTime(player.createdAt)}</p>` : "";
  return `<li class="request">
    <div class="request-head"><h2>${escapeHtml(player.displayName)}</h2>${player.admin ? badge("admin", "Admin") : ""}</div>
    <p class="meta">${identityMeta(player)}</p>
    ${joined}
  </li>`;
}

function list(items: string[], empty: string) {
  return `<ul class="list">${items.length ? items.join("") : `<li class="request"><p class="empty">${escapeHtml(empty)}</p></li>`}</ul>`;
}

function flashNotice(flash: { code: AdminFlashCode; name?: string } | undefined, capacity: AccessCapacityView) {
  if (!flash) return "";
  const who = flash.name ? escapeHtml(flash.name) : "the request";
  const success = (text: string) => `<div class="notice success" role="status" id="flash"><strong>${text}</strong></div>`;
  const error = (text: string) => `<div class="notice error" role="alert" id="flash"><strong>${text}</strong></div>`;
  switch (flash.code) {
    case "approved":
      return success(`Approved ${who}. They can sign in to Touchline now.`);
    case "denied":
      return success(`Denied ${who}.`);
    case "capacity": {
      const problem = capacityProblem(capacity);
      return error(`Couldn't approve ${who}: ${escapeHtml(problem ?? "capacity is unavailable")}.`);
    }
    case "not_found":
      return error("That access request no longer exists.");
    case "refused":
      return error(`${flash.name ? who : "That request"} can't be changed: approved players can't be denied.`);
    case "unavailable":
      return error("The database is unavailable right now. Try again in a moment.");
  }
}

export function renderAdminPage(input: {
  requests: AccessRequestView[];
  players: PlayerView[];
  capacity: AccessCapacityView;
  flash?: { code: AdminFlashCode; name?: string };
  signedInAs?: string;
}): string {
  const pending = input.requests.filter((request) => request.status === "pending");
  const denied = input.requests.filter((request) => request.status === "denied");
  const signedIn = input.signedInAs ? `<p class="meta">Signed in as ${escapeHtml(input.signedInAs)}</p>` : "";
  return layout("Touchline admin", `<section class="card">
    <div class="page-head"><p class="eyebrow">Touchline admin</p><a href="/">Back to Touchline</a></div>
    <h1>Access</h1>
    ${signedIn}
    ${flashNotice(input.flash, input.capacity)}
    ${capacityPanel(input.capacity)}
    <h3>Pending requests (${pending.length})</h3>
    ${list(pending.map(requestItem), "No pending requests.")}
    <h3>Denied (${denied.length})</h3>
    ${list(denied.map(requestItem), "No denied requests.")}
    <h3>Players (${input.players.length})</h3>
    ${list(input.players.map(playerItem), "No players yet.")}
    <p class="hint">People appear here after signing in to Touchline for the first time. Admins never use a player slot.</p>
  </section>`, true);
}

export function renderStatusPage(input: { title: string; message: string; eyebrow?: string; link?: { href: string; label: string } }): string {
  const link = input.link ?? { href: "/", label: "Back to Touchline" };
  return layout(input.title, `<section class="card">
    <p class="eyebrow">${escapeHtml(input.eyebrow ?? "Touchline")}</p>
    <h1>${escapeHtml(input.title)}</h1>
    <p class="lead">${escapeHtml(input.message)}</p>
    <div class="actions"><a class="button button-primary" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></div>
  </section>`);
}

export function renderSignedOutPage(input: { signInUrl: string }): string {
  return layout("Signed out", `<section class="card">
    <p class="eyebrow">Touchline access</p>
    <h1>You're signed out</h1>
    <p class="lead">Your Touchline session has ended on this device.</p>
    <div class="actions"><a class="button button-primary" href="${escapeHtml(input.signInUrl)}">Sign in</a></div>
  </section>`);
}

export function renderSignInErrorPage(input: { title: string; message: string; retryUrl: string }): string {
  return layout(input.title, `<section class="card">
    <p class="eyebrow">Touchline sign-in</p>
    <h1>${escapeHtml(input.title)}</h1>
    <div class="notice error" role="alert">${escapeHtml(input.message)}</div>
    <div class="actions"><a class="button button-primary" href="${escapeHtml(input.retryUrl)}">Try signing in again</a></div>
  </section>`);
}
