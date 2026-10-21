import type { AccessIssueCode as ForbiddenCode, WorldActivity } from "../shared/api.ts";

/** 401 authentication_required, or one of the 403 codes for a signed-in identity without access. */
export type AccessIssueCode = "authentication_required" | ForbiddenCode;

export interface AccessIssue {
  code: AccessIssueCode;
  status: number;
  message: string;
  /** Set when an explicit re-check from the access screen ended on this refusal again. */
  rechecked?: boolean;
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
  "access_pending",
  "access_denied",
  "not_authorized",
] satisfies AccessIssueCode[]);

export function isAccessIssueCode(code: string | undefined): code is AccessIssueCode {
  return typeof code === "string" && accessIssueCodes.has(code);
}

export function isAccessIssue(failure: unknown): failure is ApiError & {
  code: AccessIssueCode;
} {
  return (
    failure instanceof ApiError &&
    isAccessIssueCode(failure.code) &&
    (failure.status === 401) === (failure.code === "authentication_required") &&
    (failure.status === 401 || failure.status === 403)
  );
}

export function accessIssueFromFailure(failure: unknown): AccessIssue | null {
  if (!isAccessIssue(failure)) return null;
  return {
    code: failure.code,
    status: failure.status,
    message: failure.message,
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
