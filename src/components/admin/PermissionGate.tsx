"use client";

import type { ReactNode } from "react";
import { ForbiddenScreen } from "@/components/admin/AdminUi";
import { useAdminSession } from "@/components/admin/AdminSessionProvider";

/**
 * B18: page-level guard for Admin Panel screens reachable by typing the URL. A Staff Admin whose role
 * lacks `needs` sees a clear "needs permission" screen instead of a page full of raw 403 errors.
 * Presentation only — every API behind the page enforces the same permission server-side
 * (see B18_PERMISSION_MATRIX.md and tests/b18-permission-matrix.test.ts). `mode="any"` lets the page
 * open when the admin holds at least one of the keys.
 */
export function PermissionGate({ needs, mode = "all", what, children }: { needs: string[]; mode?: "all" | "any"; what: string; children: ReactNode }) {
  const { can, admin } = useAdminSession();
  const allowed = mode === "any" ? needs.some(can) : needs.every(can);
  if (!allowed) {
    return (
      <ForbiddenScreen title="You need permission for this page">
        {what} requires the {needs.map((n) => `“${n}”`).join(mode === "any" ? " or " : " and ")} permission{needs.length > 1 ? "s" : ""}, which your role ({admin.role === "STAFF_ADMIN" ? "Staff Admin" : admin.role}) does not have. Ask a Super Admin to grant it.
      </ForbiddenScreen>
    );
  }
  return <>{children}</>;
}
