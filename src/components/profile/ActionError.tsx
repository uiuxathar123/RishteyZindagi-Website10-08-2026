import Link from "next/link";
import type { ApiError } from "@/lib/api/errors";

/** Is this 403 the backend's "you need an active membership" answer? */
export function isMembershipRequired(error: ApiError | null | undefined): boolean {
  return !!error && error.kind === "forbidden" && /membership/i.test(error.message);
}

/**
 * The real error from a failed action. The backend's 403 for "active
 * membership required" becomes an upgrade prompt; everything else shows the
 * server's own message (409 already sent, 429 slow down, 404 not available…).
 */
export function ActionError({ error, className }: { error: ApiError | null | undefined; className?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className={className ?? "mt-2 text-xs leading-snug text-rz-danger"}>
      {isMembershipRequired(error) ? (
        <>
          {error.message}{" "}
          <Link href="/membership" className="rz-focus font-semibold underline underline-offset-2">
            View membership plans
          </Link>
        </>
      ) : error.kind === "unauthorized" ? (
        <>
          Your session has ended.{" "}
          <Link href="/login" className="rz-focus font-semibold underline underline-offset-2">
            Log in again
          </Link>
        </>
      ) : (
        error.friendlyMessage
      )}
    </p>
  );
}
