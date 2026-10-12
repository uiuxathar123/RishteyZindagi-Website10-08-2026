"use client";

import { ForbiddenScreen } from "@/components/admin/AdminUi";
import { useAdminSession } from "@/components/admin/AdminSessionProvider";
import { usePathname } from "next/navigation";

/** B19: screens that live under /admin/super but can be delegated to a Staff Admin who holds the matching permission. */
const DELEGABLE: Record<string, string> = {
  "/admin/super/membership-plans": "plans.manage",
  "/admin/super/communities": "communities.manage",
};

/**
 * Everything under /admin/super is Super Admin territory. A Staff Admin who
 * reaches one of these URLs sees an honest “Super Admin only” screen — no
 * redirect, so there is no loop. (This is a presentation guard: the API
 * behind each page also answers 403 to a role without the permission.)
 */
export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const { isSuper, admin, can } = useAdminSession();
  const pathname = usePathname() ?? "";
  const needed = Object.entries(DELEGABLE).find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[1];
  if (!isSuper && !(needed && can(needed))) {
    return (
      <ForbiddenScreen title="Super Admin only">
        This area is limited to Super Admins. You are signed in as {admin.name} ({admin.role === "STAFF_ADMIN" ? "Staff Admin" : admin.role}), so the server will refuse these requests too.
      </ForbiddenScreen>
    );
  }
  return <>{children}</>;
}
