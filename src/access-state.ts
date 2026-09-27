import type { AccessIssue, AccessIssueCode } from "./api-error.ts";

export interface AccessStateContent {
  eyebrow: string;
  heading: string;
  explanation: string;
  reminder?: string;
  primary?: {
    label: string;
    href: string;
  };
  secondary: {
    label: string;
    href: string;
  };
}

export const microsoftAccountReminder =
  "Touchline sign-in requires a personal Microsoft account: Outlook.com, Hotmail, Live.com, MSN, or any email address registered as a Microsoft account.";

const requestInvite = { label: "Request an invite", href: "/invite" };
const logout = {
  label: "Signed in with the wrong account?",
  href: "/.auth/logout?post_logout_redirect_uri=/",
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

const contentByCode: Record<AccessIssueCode, AccessStateContent> = {
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

export function accessStateContent(issue: Pick<AccessIssue, "code">) {
  return contentByCode[issue.code];
}
