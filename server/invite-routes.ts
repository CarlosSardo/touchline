import express, { type Request, type Response } from "express";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AuthenticatedIdentity } from "./accounts.ts";
import { DatabaseUnavailableError, type Store } from "./db.ts";
import { approvalEmail, acceptedEmail } from "./invite-emails.ts";
import {
  renderAdminListPage,
  renderDecisionPage,
  renderInvitePage,
  renderReviewPage,
} from "./invite-pages.ts";
import { createMailer, type Mailer } from "./mailer.ts";
import {
  CONSUMER_TENANT_ID,
  InviteStore,
  type Capacity,
  type InviteLimits,
  type InviteRequest,
} from "./invite-store.ts";
import type { ApiConfiguration } from "./app.ts";

type InviteAction = "accept" | "deny";
type InviteTokenAction = InviteAction | "resend";
type TokenStatus = "valid" | "expired" | "invalid";
type PrincipalParser = (
  encoded: unknown,
  configuration: Pick<ApiConfiguration, "allowedUserObjectIds" | "ownerObjectId" | "tenantId">,
) => AuthenticatedIdentity;

export interface InviteStoreLike {
  create(input: { email: string; note: string | null; ipHash: string | null }):
    Promise<{ status: "created" | "duplicate" | "rate_limited"; request?: InviteRequest }>;
  get(id: string): Promise<InviteRequest | undefined>;
  list(): Promise<InviteRequest[]>;
  capacity(): Promise<Capacity>;
  decide(id: string, action: InviteAction, decidedBy: string):
    Promise<{ outcome: "accepted" | "denied" | "unchanged" | "capacity" | "not_found"; request?: InviteRequest; capacity?: Capacity }>;
  markEmailSent(id: string, kind: "approval" | "accepted"): Promise<void>;
  purgeExpired(): Promise<number>;
}

export interface InviteRouteOptions {
  configuration?: ApiConfiguration;
  getStore?: () => Promise<Store>;
  parsePrincipal?: PrincipalParser;
  inviteStore?: InviteStoreLike | ((root: Store) => InviteStoreLike);
  mailer?: Mailer;
  now?: () => Date;
}

const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const loopbackAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const tokenLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const hourMs = 60 * 60 * 1000;
const bodySchema = z.object({
  email: z.string().trim().toLowerCase().max(320).email(),
  note: z.string().trim().max(500).optional(),
  website: z.string().optional().default(""),
});
const actionSchema = z.enum(["accept", "deny"]);

export function signInviteToken(input: {
  id: string;
  action: InviteTokenAction;
  secret: string;
  now?: Date;
  expiresAt?: number;
}) {
  const exp = input.expiresAt ?? Math.floor(((input.now ?? new Date()).getTime() + tokenLifetimeMs) / 1000);
  const signature = createHmac("sha256", input.secret)
    .update(`${input.id}|${input.action}|${exp}`)
    .digest("base64url");
  return `${signature}.${exp}`;
}

export function verifyInviteToken(input: {
  token: string | undefined;
  id: string;
  action: InviteTokenAction;
  secret: string;
  now?: Date;
}): TokenStatus {
  const [signature, expText, extra] = (input.token ?? "").split(".");
  if (!signature || !expText || extra || !/^\d+$/.test(expText)) return "invalid";
  const exp = Number(expText);
  if (!Number.isSafeInteger(exp)) return "invalid";
  const expected = signInviteToken({ id: input.id, action: input.action, secret: input.secret, expiresAt: exp }).split(".")[0];
  const actualBytes = Buffer.from(signature, "base64url");
  const expectedBytes = Buffer.from(expected, "base64url");
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes))
    return "invalid";
  return exp < Math.floor((input.now ?? new Date()).getTime() / 1000) ? "expired" : "valid";
}

function html(response: Response, status: number, body: string) {
  response.set("Cache-Control", "no-store");
  return response.status(status).type("text/html; charset=utf-8").send(body);
}

function statusPage(title: string, message: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:system-ui,sans-serif;max-width:42rem;margin:4rem auto;padding:0 1rem;line-height:1.5}</style></head><body><h1>${title}</h1><p>${message}</p></body></html>`;
}

function localRequest(request: Request) {
  if (!loopbackAddresses.has(request.socket.remoteAddress ?? "")) return false;
  try {
    const host = new URL(`http://${request.headers.host ?? ""}`);
    return loopbackHosts.has(host.hostname);
  } catch {
    return false;
  }
}

function sameOriginRequest(request: Request, configuration: ApiConfiguration) {
  const suppliedOrigin = request.headers.origin;
  if (configuration.hosted)
    return !!suppliedOrigin && suppliedOrigin === configuration.appOrigin;
  if (!suppliedOrigin) return false;
  try {
    const origin = new URL(suppliedOrigin);
    return origin.origin === suppliedOrigin &&
      ["http:", "https:"].includes(origin.protocol) &&
      loopbackHosts.has(origin.hostname) &&
      localRequest(request);
  } catch {
    return false;
  }
}

function baseUrl(request: Request, configuration: ApiConfiguration) {
  if (configuration.appOrigin) return configuration.appOrigin;
  const host = request.headers.host ?? "127.0.0.1:3001";
  return `http://${host}`;
}

function clientIp(request: Request, configuration: ApiConfiguration) {
  if (configuration.hosted) {
    const forwarded = request.headers["x-forwarded-for"];
    const entries = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
      ?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const value = entries?.at(-1);
    if (value) return value;
  }
  return request.socket.remoteAddress ?? "";
}

function ipHash(request: Request, configuration: ApiConfiguration) {
  const ip = clientIp(request, configuration);
  return ip ? createHash("sha256").update(configuration.inviteSigningSecret).update(ip).digest("hex") : null;
}

function inviteLimits(configuration: ApiConfiguration): InviteLimits {
  return {
    maxPlayers: configuration.maxPlayers,
    sizeLimitGb: configuration.inviteDbSizeLimitGb,
    ownerObjectId: configuration.ownerObjectId,
    ownerEmail: configuration.ownerEmail,
  };
}

export function createInviteRouter(options: InviteRouteOptions) {
  const { configuration, getStore, parsePrincipal } = options;
  if (!configuration || !getStore || !parsePrincipal)
    throw new Error("Invite routes require configuration, getStore and parsePrincipal.");
  const router = express.Router();
  const parseForm = express.urlencoded({ extended: false, limit: "8kb" });
  let lazyMailer: Mailer | undefined = options.mailer;
  const mailer = () => {
    lazyMailer ??= createMailer();
    return lazyMailer;
  };
  const now = options.now ?? (() => new Date());
  let cachedStore: { root: Store; invites: InviteStoreLike } | undefined;
  let lastPurge = 0;

  const invites = async () => {
    if (options.inviteStore && typeof options.inviteStore !== "function")
      return options.inviteStore;
    const root = await getStore();
    if (!cachedStore || cachedStore.root !== root) {
      cachedStore = {
        root,
        invites: typeof options.inviteStore === "function"
          ? options.inviteStore(root)
          : new InviteStore(root, inviteLimits(configuration)),
      };
    }
    return cachedStore.invites;
  };
  const purge = async (store: InviteStoreLike) => {
    const tick = now().getTime();
    if (tick - lastPurge < hourMs) return;
    lastPurge = tick;
    try {
      await store.purgeExpired();
    } catch {
      console.error("Touchline: invite retention purge failed.");
    }
  };
  const reviewUrl = (id: string, action: InviteAction) =>
    `/admin/invites/${encodeURIComponent(id)}?action=${action}&token=${encodeURIComponent(signInviteToken({
      id,
      action,
      secret: configuration.inviteSigningSecret,
      now: now(),
    }))}`;
  const resendForm = (request: { id: string; status: string }) =>
    request.status === "pending" || request.status === "accepted"
      ? {
        action: `/admin/invites/${encodeURIComponent(request.id)}/resend`,
        token: signInviteToken({
          id: request.id,
          action: "resend",
          secret: configuration.inviteSigningSecret,
          now: now(),
        }),
      }
      : null;
  const sendApproval = async (request: Request, store: InviteStoreLike, invite: InviteRequest) => {
    const capacity = await store.capacity();
    const root = baseUrl(request, configuration);
    const email = approvalEmail({
      request: invite,
      acceptUrl: `${root}${reviewUrl(invite.id, "accept")}`,
      denyUrl: `${root}${reviewUrl(invite.id, "deny")}`,
      listUrl: `${root}/admin/invites`,
      capacity,
    });
    await mailer().send({ to: configuration.approverEmail, ...email });
    await store.markEmailSent(invite.id, "approval");
  };
  const sendAccepted = async (request: Request, store: InviteStoreLike, invite: InviteRequest) => {
    const email = acceptedEmail({
      email: invite.email,
      appUrl: baseUrl(request, configuration),
      inviteUrl: `${baseUrl(request, configuration)}/invite`,
    });
    await mailer().send({ to: invite.email, ...email });
    await store.markEmailSent(invite.id, "accepted");
  };
  const requireApprover = (request: Request): { ok: true; identity: AuthenticatedIdentity } | { ok: false } => {
    if (!configuration.requireAuth) {
      return localRequest(request)
        ? { ok: true, identity: { tenantId: configuration.tenantId || "local", objectId: "local", displayName: "Local director", email: configuration.approverEmail } }
        : { ok: false };
    }
    try {
      const identity = parsePrincipal(request.headers["x-ms-client-principal"], configuration);
      if (
        (identity.tenantId === configuration.tenantId && identity.objectId === configuration.ownerObjectId) ||
        (identity.tenantId === CONSUMER_TENANT_ID && identity.email === configuration.ownerEmail) ||
        (identity.tenantId === CONSUMER_TENANT_ID && identity.email === configuration.approverEmail)
      )
        return { ok: true, identity };
    } catch {
      return { ok: false };
    }
    return { ok: false };
  };

  router.get("/invite", (_request, response) =>
    html(response, 200, renderInvitePage({ state: "form" })),
  );

  router.post("/invite", parseForm, async (request, response, next) => {
    try {
      if (!sameOriginRequest(request, configuration))
        return html(response, 403, renderInvitePage({ state: "error", message: "Submit the invite form from Touchline." }));
      const parsed = bodySchema.safeParse(request.body);
      if (!parsed.success)
        return html(response, 400, renderInvitePage({ state: "error", message: "Enter a valid email address and keep the note under 500 characters." }));
      if (parsed.data.website.trim())
        return html(response, 200, renderInvitePage({ state: "submitted" }));
      const store = await invites();
      await purge(store);
      const result = await store.create({
        email: parsed.data.email,
        note: parsed.data.note?.trim() || null,
        ipHash: ipHash(request, configuration),
      });
      if (result.status === "rate_limited")
        return html(response, 429, renderInvitePage({ state: "error", message: "Too many invite requests. Try again later." }));
      if (result.status === "created" && result.request) {
        try {
          await sendApproval(request, store, result.request);
        } catch {
          console.error("Touchline: invite approval email failed.");
        }
      }
      return html(response, 200, renderInvitePage({ state: "submitted" }));
    } catch (error) {
      if (error instanceof DatabaseUnavailableError) {
        response.set("Retry-After", "3600");
        return html(response, 503, renderInvitePage({
          state: "error",
          message: "Invite requests are paused for a short while. Please try again in a few days.",
        }));
      }
      next(error);
    }
  });

  router.get("/admin/invites", async (request, response, next) => {
    try {
      if (!requireApprover(request).ok)
        return html(response, 403, statusPage("Forbidden", "You are not authorized to review invite requests."));
      const store = await invites();
      const [requests, capacity] = await Promise.all([store.list(), store.capacity()]);
      return html(response, 200, renderAdminListPage({ requests, capacity, reviewUrl, resendForm }));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/invites/:id", async (request, response, next) => {
    try {
      if (!requireApprover(request).ok)
        return html(response, 403, statusPage("Forbidden", "You are not authorized to review invite requests."));
      const action = actionSchema.safeParse(request.query.action);
      if (!action.success)
        return html(response, 400, statusPage("Invalid request", "Choose accept or deny from the invite list."));
      const tokenStatus = verifyInviteToken({
        id: request.params.id,
        action: action.data,
        token: typeof request.query.token === "string" ? request.query.token : undefined,
        secret: configuration.inviteSigningSecret,
        now: now(),
      });
      if (tokenStatus !== "valid")
        return html(response, tokenStatus === "expired" ? 410 : 403, renderDecisionPage({ outcome: "expired", listUrl: "/admin/invites" }));
      const store = await invites();
      const invite = await store.get(request.params.id);
      if (!invite)
        return html(response, 404, renderDecisionPage({ outcome: "not_found", listUrl: "/admin/invites" }));
      return html(response, 200, renderReviewPage({
        request: invite,
        action: action.data,
        token: String(request.query.token),
        formAction: `/admin/invites/${encodeURIComponent(request.params.id)}/decision`,
        capacity: await store.capacity(),
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/invites/:id/decision", parseForm, async (request, response, next) => {
    try {
      const approver = requireApprover(request);
      if (!approver.ok)
        return html(response, 403, statusPage("Forbidden", "You are not authorized to review invite requests."));
      if (!sameOriginRequest(request, configuration))
        return html(response, 403, statusPage("Forbidden", "Submit decisions from Touchline."));
      const action = actionSchema.safeParse(request.body.action);
      if (!action.success)
        return html(response, 400, statusPage("Invalid request", "Choose accept or deny from the review page."));
      const tokenStatus = verifyInviteToken({
        id: request.params.id,
        action: action.data,
        token: typeof request.body.token === "string" ? request.body.token : undefined,
        secret: configuration.inviteSigningSecret,
        now: now(),
      });
      if (tokenStatus !== "valid")
        return html(response, tokenStatus === "expired" ? 410 : 403, renderDecisionPage({ outcome: "expired", listUrl: "/admin/invites" }));
      const store = await invites();
      const decision = await store.decide(request.params.id, action.data, approver.identity.email ?? approver.identity.displayName);
      if (decision.outcome === "capacity") {
        const invite = decision.request ?? await store.get(request.params.id);
        if (!invite)
          return html(response, 404, renderDecisionPage({ outcome: "not_found", listUrl: "/admin/invites" }));
        return html(response, 409, renderReviewPage({
          request: invite,
          action: action.data,
          token: request.body.token,
          formAction: `/admin/invites/${encodeURIComponent(request.params.id)}/decision`,
          capacity: decision.capacity ?? await store.capacity(),
          error: decision.capacity?.reason ?? "Capacity is unavailable.",
        }));
      }
      let emailSent = false;
      if (decision.outcome === "accepted" && decision.request) {
        try {
          await sendAccepted(request, store, decision.request);
          emailSent = true;
        } catch {
          console.error("Touchline: invite accepted email failed.");
        }
      }
      return html(response, 200, renderDecisionPage({
        outcome: decision.outcome,
        email: decision.request?.email,
        listUrl: "/admin/invites",
        emailSent,
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/invites/:id/resend", parseForm, async (request, response, next) => {
    try {
      if (!requireApprover(request).ok)
        return html(response, 403, statusPage("Forbidden", "You are not authorized to review invite requests."));
      if (!sameOriginRequest(request, configuration))
        return html(response, 403, statusPage("Forbidden", "Submit resend requests from Touchline."));
      if (request.body.action !== "resend")
        return html(response, 400, statusPage("Invalid request", "Use the resend form from the invite list."));
      const tokenStatus = verifyInviteToken({
        id: request.params.id,
        action: "resend",
        token: typeof request.body.token === "string" ? request.body.token : undefined,
        secret: configuration.inviteSigningSecret,
        now: now(),
      });
      if (tokenStatus !== "valid")
        return html(response, tokenStatus === "expired" ? 410 : 403, renderDecisionPage({ outcome: "expired", listUrl: "/admin/invites" }));
      const store = await invites();
      const invite = await store.get(request.params.id);
      if (!invite)
        return html(response, 404, renderDecisionPage({ outcome: "not_found", listUrl: "/admin/invites" }));
      if (invite.status !== "pending" && invite.status !== "accepted")
        return html(response, 409, statusPage("No email to resend", "Only pending or accepted invites have resendable emails."));
      let sent = false;
      try {
        if (invite.status === "pending")
          await sendApproval(request, store, invite);
        else
          await sendAccepted(request, store, invite);
        sent = true;
      } catch {
        console.error("Touchline: invite resend email failed.");
      }
      return html(response, 200, statusPage(
        sent ? "Email resent" : "Email not sent",
        sent ? "The invite email was sent." : "The invite remains stored, but email delivery is currently unavailable.",
      ));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
