import express, { type Request, type Response } from "express";
import { AuthenticationRequiredError, loginUrl, type AuthenticatedIdentity } from "./auth.ts";
import { DatabaseUnavailableError } from "./db.ts";
import {
  adminFlashCodes,
  pageContentSecurityPolicy,
  renderAdminPage,
  renderStatusPage,
  type AccessCapacityView,
  type AccessRequestView,
  type AdminFlashCode,
  type PlayerView,
} from "./admin-pages.ts";

/** The admin operations of `Accounts` (server/accounts.ts) used by the admin page. */
export interface AccessAdministration {
  listAccess(): Promise<{ requests: AccessRequestView[]; players: PlayerView[]; capacity: AccessCapacityView }>;
  approve(requestId: string, decidedBy: string): Promise<{ status: "approved" | "capacity"; reason?: string }>;
  deny(requestId: string, decidedBy: string): Promise<unknown>;
}

export interface AdminRouteOptions {
  configuration?: { requireAuth: boolean; appOrigin: string | undefined };
  /** Returns the signed-in identity; throws AuthenticationRequiredError without a session. */
  authenticate?: (request: Request) => AuthenticatedIdentity;
  /** The account registry, or a function opening it on first use (undefined when there is none). */
  accounts?: AccessAdministration | (() => Promise<AccessAdministration | undefined>);
}

const ADMIN_PATH = "/admin";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function html(response: Response, status: number, body: string) {
  response.set("Cache-Control", "no-store");
  response.set("Content-Security-Policy", pageContentSecurityPolicy);
  return response.status(status).type("text/html; charset=utf-8").send(body);
}

function forbidden(response: Response) {
  return html(response, 403, renderStatusPage({
    eyebrow: "Touchline admin",
    title: "Admins only",
    message: "Your account can't open the admin page. Ask the Touchline owner if you think this is a mistake.",
  }));
}

function clientErrorStatus(error: unknown): number | undefined {
  if (!(error instanceof Error) || !("status" in error)) return undefined;
  const status = Number(error.status);
  return Number.isInteger(status) && status >= 400 && status < 500 ? status : undefined;
}

export function isAccessAdministration(value: unknown): value is AccessAdministration {
  const candidate = value as Partial<AccessAdministration> | null | undefined;
  return typeof candidate?.listAccess === "function" &&
    typeof candidate.approve === "function" &&
    typeof candidate.deny === "function";
}

export function createAdminRouter(options: AdminRouteOptions) {
  const { configuration, authenticate } = options;
  if (!configuration || !authenticate)
    throw new Error("Admin routes require configuration and authenticate.");
  const router = express.Router();
  // Local development has no account registry, so there is nothing to administer.
  if (!configuration.requireAuth) return router;

  const accounts = async () => {
    const source = options.accounts;
    const resolved = typeof source === "function" ? await source() : source;
    if (!resolved) throw new Error("The account registry is not available.");
    return resolved;
  };

  /** The signed-in admin, or a reason to refuse: anonymous ("signed_out") or any other identity ("forbidden"). */
  const admin = (request: Request): AuthenticatedIdentity | "signed_out" | "forbidden" => {
    try {
      const identity = authenticate(request);
      return identity.admin ? identity : "forbidden";
    } catch (error) {
      return error instanceof AuthenticationRequiredError ? "signed_out" : "forbidden";
    }
  };

  /** Forms are only accepted from Touchline itself (CSRF): exact Origin, or Sec-Fetch-Site when Origin is absent. */
  const sameOrigin = (request: Request) => {
    const origin = request.headers.origin;
    const fetchSite = request.headers["sec-fetch-site"];
    if (fetchSite !== undefined && fetchSite !== "same-origin") return false;
    if (origin === undefined) return fetchSite === "same-origin";
    const expected = configuration.appOrigin ?? `${request.protocol}://${request.get("host") ?? ""}`;
    return origin === expected;
  };

  router.get("/admin/invites", (_request, response) => {
    response.set("Cache-Control", "no-store");
    response.redirect(301, ADMIN_PATH);
  });

  router.get(ADMIN_PATH, async (request, response, next) => {
    const identity = admin(request);
    if (identity === "signed_out") {
      response.set("Cache-Control", "no-store");
      return response.redirect(302, loginUrl(ADMIN_PATH));
    }
    if (identity === "forbidden") return forbidden(response);
    try {
      const overview = await (await accounts()).listAccess();
      const code = adminFlashCodes.find((candidate) => candidate === request.query.result);
      const requestId = typeof request.query.request === "string" ? request.query.request : undefined;
      const name = requestId
        ? overview.requests.find((entry) => entry.id === requestId)?.displayName
        : undefined;
      return html(response, 200, renderAdminPage({
        ...overview,
        flash: code ? { code, name } : undefined,
        signedInAs: identity.username,
      }));
    } catch (error) {
      if (error instanceof DatabaseUnavailableError) {
        response.set("Retry-After", "5");
        return html(response, 503, renderStatusPage({
          eyebrow: "Touchline admin",
          title: "Database unavailable",
          message: "The admin page can't load right now. Try again in a moment.",
          link: { href: ADMIN_PATH, label: "Try again" },
        }));
      }
      next(error);
    }
  });

  router.post("/admin/access/:id/:action", async (request, response, next) => {
    const action = request.params.action;
    if (action !== "approve" && action !== "deny") return next();
    if (!sameOrigin(request))
      return html(response, 403, renderStatusPage({
        eyebrow: "Touchline admin",
        title: "Request refused",
        message: "Access decisions can only be submitted from the Touchline admin page.",
        link: { href: ADMIN_PATH, label: "Open the admin page" },
      }));
    const identity = admin(request);
    if (identity === "signed_out")
      return html(response, 401, renderStatusPage({
        eyebrow: "Touchline admin",
        title: "Sign in required",
        message: "Your session has ended. Sign in again to manage access.",
        link: { href: loginUrl(ADMIN_PATH), label: "Sign in" },
      }));
    if (identity === "forbidden") return forbidden(response);
    const id = request.params.id;
    const done = (code: AdminFlashCode) => {
      const query = new URLSearchParams({ result: code });
      if (uuidPattern.test(id)) query.set("request", id.toLowerCase());
      response.set("Cache-Control", "no-store");
      return response.redirect(303, `${ADMIN_PATH}?${query}`);
    };
    if (!uuidPattern.test(id)) return done("not_found");
    try {
      const registry = await accounts();
      if (action === "approve") {
        const result = await registry.approve(id.toLowerCase(), identity.username);
        return done(result.status === "capacity" ? "capacity" : "approved");
      }
      await registry.deny(id.toLowerCase(), identity.username);
      return done("denied");
    } catch (error) {
      if (error instanceof DatabaseUnavailableError) return done("unavailable");
      const status = clientErrorStatus(error);
      if (status === 404) return done("not_found");
      if (status !== undefined) return done("refused");
      next(error);
    }
  });

  return router;
}
