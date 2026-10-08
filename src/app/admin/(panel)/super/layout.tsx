"use client";

import { ForbiddenScreen } from "@/components/admin/AdminUi";
import { useAdminSession } from "@/components/admin/AdminSessionProvider";

/**
 * Everything under /admin/super is Super Admin territory. A Staff Admin who
 * reaches one of these URLs sees an honest “Super Admin only” screen — no
 * redirect, so there is no loop. (This is a presentation guard: the API
 * behind each page also answers 403 to a role without the permission.)
 */
export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const { isSuper, admin } = useAdminSession();
  if (!isSuper) {
    return (
      <ForbiddenScreen title="Super Admin only">
        This area is limited to Super Admins. You are signed in as {admin.name} ({admin.role === "STAFF_ADMIN" ? "Staff Admin" : admin.role}), so the server will refuse these requests too.
      </ForbiddenScreen>
    );
  }
  return <>{children}</>;
}
