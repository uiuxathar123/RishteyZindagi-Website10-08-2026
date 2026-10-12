/**
 * Centralized error hierarchy. Every layer (repository/service/controller)
 * throws one of these instead of a raw Error or a hand-rolled Response, so
 * `withErrorHandling` (middleware/error-handler.ts) can translate any of
 * them into the right HTTP status + the project's standard error envelope
 * in exactly one place. Nothing outside that translation step should ever
 * construct a Response by hand for an error case.
 */

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  /** Extra structured detail safe to return to the client (e.g. which
   * field failed validation). Never put a stack trace or internal detail
   * in here. */
  readonly details?: unknown;

  constructor(code: ErrorCode, statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message = "The request failed validation.", details?: unknown) {
    super("VALIDATION_ERROR", 400, message, details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Authentication is required or the credentials are invalid.") {
    super("AUTHENTICATION_ERROR", 401, message);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "You do not have permission to perform this action.", details?: unknown) {
    super("AUTHORIZATION_ERROR", 403, message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "The requested resource was not found.") {
    super("NOT_FOUND", 404, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "The request conflicts with existing data.", details?: unknown) {
    super("CONFLICT", 409, message, details);
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many requests. Please try again shortly.") {
    super("RATE_LIMITED", 429, message);
  }
}

export class InternalError extends AppError {
  constructor(message = "Something went wrong. Please try again.") {
    super("INTERNAL_ERROR", 500, message);
  }
}

/** B2: thrown when the active OTP delivery channel has no working provider
 * behind it (missing credentials, or a real integration was never wired
 * up) — deliberately distinct from InternalError so this honest "we can't
 * send OTPs right now" state is never confused with, or disguised as, an
 * unexpected bug. Never thrown with the credential name or value in the
 * message — see each provider's isConfigured() check. */
export class ServiceUnavailableError extends AppError {
  constructor(message = "This service is temporarily unavailable. Please try again later.", details?: unknown) {
    super("SERVICE_UNAVAILABLE", 503, message, details);
  }
}
