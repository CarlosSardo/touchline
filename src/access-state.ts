import type { AccessIssue, AccessIssueCode } from "./api-error.ts";

export interface AccessStateLink {
  label: string;
  href: string;
}

/** A same-origin POST form (sign-out must not be a GET link). */
export interface AccessStateForm {
  label: string;
  action: string;
}

export interface AccessStateContent {
  eyebrow: string;
  heading: string;
  explanation: string;
  reminder?: string;
  primary?: AccessStateLink;
  secondary: AccessStateLink | AccessStateForm;
}

export const signOutAction = "/auth/logout";

/** Sign-in URL that returns to `returnTo` (a same-origin path) afterwards. */
export function signInHref(returnTo = "/") {
  return returnTo.startsWith("/") && !returnTo.startsWith("//") && returnTo !== "/"
    ? `/auth/login?returnTo=${encodeURIComponent(returnTo)}`
    : "/auth/login";
}

export const microsoftAccountReminder =
  "Touchline sign-in requires a personal Microsoft account: Outlook.com, Hotmail, Live.com, MSN, or any email address registered as a Microsoft account.";

const requestInvite = { label: "Request an invite", href: "/invite" };
const logout: AccessStateForm = {
  label: "Signed in with the wrong account?",
  action: signOutAction,
};

const inviteContent: AccessStateContent = {
  eyebrow: "Invite-only access",
  heading: "You're not on the team sheet yet",
  explanation:
    "Touchline is private while the early squad is forming. Request an invite and sign in again with the exact personal Microsoft account that gets approved.",
  reminder: microsoftAccountReminder,
  primary: requestInvite,
  secondary: logout,
};

const contentByCode: Record<Exclude<AccessIssueCode, "authentication_required">, AccessStateContent> = {
  invite_required: inviteContent,
  account_not_provisioned: inviteContent,
  not_authorized: inviteContent,
  capacity_unavailable: {
    eyebrow: "Capacity unavailable",
    heading: "Touchline is full right now",
    explanation:
      "Touchline is full right now — your invite is safe; try again later.",
    reminder: microsoftAccountReminder,
    secondary: logout,
  },
};

export function accessStateContent(
  issue: Pick<AccessIssue, "code">,
  returnTo = "/",
): AccessStateContent {
  if (issue.code === "authentication_required")
    return {
      eyebrow: "Signed out",
      heading: "Sign in to continue",
      explanation:
        "Your Touchline session has ended. Sign in again to pick up where you left off.",
      reminder: microsoftAccountReminder,
      primary: { label: "Sign in", href: signInHref(returnTo) },
      secondary: requestInvite,
    };
  return contentByCode[issue.code];
}
