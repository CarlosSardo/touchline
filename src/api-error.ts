import type { WorldActivity } from "../shared/api.ts";

export type AccessIssueCode =
  | "authentication_required"
  | "invite_required"
  | "account_not_provisioned"
  | "not_authorized"
  | "capacity_unavailable";

export interface AccessIssue {
  code: AccessIssueCode;
  status: number;
  message: string;
  retryAfter?: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryAfter?: number;
  readonly activity?: WorldActivity;

  constructor(
    message: string,
    status: number,
    details: { code?: string; retryAfter?: number; activity?: WorldActivity } = {},
  ) {
    super(message);
    this.status = status;
    this.code = details.code;
    this.retryAfter = details.retryAfter;
    this.activity = details.activity;
  }
}

const accessIssueCodes = new Set<string>([
  "authentication_required",
  "invite_required",
  "account_not_provisioned",
  "not_authorized",
  "capacity_unavailable",
]);

export function isAccessIssueCode(code: string | undefined): code is AccessIssueCode {
  return typeof code === "string" && accessIssueCodes.has(code);
}

export function isAccessIssue(failure: unknown): failure is ApiError & {
  code: AccessIssueCode;
} {
  return (
    failure instanceof ApiError &&
    isAccessIssueCode(failure.code) &&
    ((failure.status === 401 && failure.code === "authentication_required") ||
      (failure.status === 403 && failure.code !== "capacity_unavailable" && failure.code !== "authentication_required") ||
      (failure.status === 503 && failure.code === "capacity_unavailable"))
  );
}

export function accessIssueFromFailure(failure: unknown): AccessIssue | null {
  if (!isAccessIssue(failure)) return null;
  return {
    code: failure.code,
    status: failure.status,
    message: failure.message,
    retryAfter: failure.retryAfter,
  };
}

/** Only 409 world_busy is transient: the account's world is busy and the request was refused. */
export function isWorldBusy(failure: unknown): failure is ApiError {
  return (
    failure instanceof ApiError &&
    failure.status === 409 &&
    failure.code === "world_busy"
  );
}

/** The request may still be running on the server (gateway cut, network loss) or was refused as busy. */
export function isOutcomeUnknown(failure: unknown) {
  return (
    isWorldBusy(failure) ||
    (failure instanceof ApiError && [502, 504].includes(failure.status)) ||
    failure instanceof TypeError
  );
}
