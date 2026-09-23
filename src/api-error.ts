import type { WorldActivity } from "../shared/api.ts";

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
