/**
 * One error type for every API failure so screens branch on `kind`
 * instead of parsing status codes themselves.
 *
 * The backend uses these statuses (see API_REFERENCE.md): 400 validation,
 * 401 not signed in / session expired, 403 not allowed, 404 not found,
 * 409 conflict, 429 rate limited, 503 service unavailable, 500 internal.
 * (There is no 422 — the backend reports validation failures as 400.)
 */
export type ApiErrorKind =
  | "validation"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "unavailable"
  | "server"
  | "network"
  | "aborted"
  | "unknown";

export interface ApiFieldIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly kind: ApiErrorKind;
  readonly details: ApiFieldIssue[];

  constructor(init: { status: number; code: string; message: string; kind: ApiErrorKind; details?: ApiFieldIssue[] }) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.kind = init.kind;
    this.details = init.details ?? [];
  }

  /** Message of the first field-level issue, if the backend sent any. */
  get firstIssue(): string | undefined {
    return this.details[0]?.message;
  }

  /** The best single sentence to show a person. */
  get friendlyMessage(): string {
    switch (this.kind) {
      case "network":
        return "We couldn't reach the server. Check your connection and try again.";
      case "rate_limited":
        return "You're doing that too quickly. Please wait a moment and try again.";
      case "unavailable":
        return this.message || "This service is temporarily unavailable.";
      case "server":
        return "Something went wrong on our side. Please try again in a moment.";
      case "unauthorized":
        return "Your session has ended. Please log in again.";
      default:
        return this.firstIssue ? `${this.message} ${this.firstIssue}` : this.message;
    }
  }
}

export function kindFromStatus(status: number): ApiErrorKind {
  if (status === 400 || status === 422) return "validation";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status === 503) return "unavailable";
  if (status >= 500) return "server";
  return "unknown";
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;
