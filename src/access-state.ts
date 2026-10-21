import type { AccessIssue } from "./api-error.ts";

export interface AccessStateLink {
  kind: "link";
  label: string;
  href: string;
}

/** A same-origin POST form (sign-out must not be a GET link). */
export interface AccessStateForm {
  kind: "form";
  label: string;
  action: string;
}

/** Re-runs the /api/me session check in place. */
export interface AccessStateRetry {
  kind: "retry";
  label: string;
  /** Shown after a check that still ends on this screen. */
  unchanged: string;
}

export type AccessStateAction = AccessStateLink | AccessStateForm | AccessStateRetry;

export interface AccessStateContent {
  eyebrow: string;
  heading: string;
  explanation: string;
  /** The first action is the primary one. */
  actions: [AccessStateAction, ...AccessStateAction[]];
}

export const signOutAction = "/auth/logout";
export const adminHref = "/admin";

/** Sign-in URL that returns to `returnTo` (a same-origin path) afterwards. */
export function signInHref(returnTo = "/") {
  return returnTo.startsWith("/") && !returnTo.startsWith("//") && returnTo !== "/"
    ? `/auth/login?returnTo=${encodeURIComponent(returnTo)}`
    : "/auth/login";
}

const signOut: AccessStateForm = { kind: "form", label: "Sign out", action: signOutAction };

export function accessStateContent(
  issue: Pick<AccessIssue, "code">,
  returnTo = "/",
): AccessStateContent {
  switch (issue.code) {
    case "authentication_required":
      return {
        eyebrow: "Signed out",
        heading: "Sign in to continue",
        explanation:
          "Your Touchline session has ended. Sign in again to pick up where you left off.",
        actions: [{ kind: "link", label: "Sign in", href: signInHref(returnTo) }],
      };
    case "access_pending":
      return {
        eyebrow: "Access requested",
        heading: "Waiting for approval",
        explanation:
          "Touchline is a small private group, so an admin approves every new player. Your request is in — once it is approved, check again to start your career.",
        actions: [
          {
            kind: "retry",
            label: "Check again",
            unchanged: "Not approved yet. Check again a little later.",
          },
          signOut,
        ],
      };
    case "access_denied":
      return {
        eyebrow: "Private group",
        heading: "Access not granted",
        explanation:
          "An admin has not granted this account access to Touchline. If you think that is a mistake, ask the admin who runs it.",
        actions: [signOut],
      };
    case "not_authorized":
      return {
        eyebrow: "Private group",
        heading: "You're not on the team sheet yet",
        explanation:
          "This account cannot open Touchline. Sign out and sign in with the account an admin approved.",
        actions: [
          { kind: "retry", label: "Try again", unchanged: "This account still cannot open Touchline." },
          { ...signOut, label: "Signed in with the wrong account?" },
        ],
      };
  }
}
