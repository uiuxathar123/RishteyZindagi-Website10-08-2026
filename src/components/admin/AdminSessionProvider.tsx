"use client";

/**
 * Client-side view of the signed-in ADMIN (a separate identity from the
 * member session). The session token itself lives in an httpOnly cookie held
 * by the /bff proxy; this provider only carries who is signed in and which
 * permission keys their role holds, as returned by `GET /admin/me`.
 *
 * `can()` is a presentation aid (hide screens that would 403). The backend
 * checks the real permission on every request regardless.
 */
import { createContext, ReactNode, useCallback, useContext, useMemo } from "react";
import { useRouter } from "next/navigation";
import { adminApi } from "@/lib/api/client";
import type { AdminIdentity } from "@/lib/api/types";

interface AdminSessionValue {
  admin: AdminIdentity["admin"];
  permissions: string[];
  isSuper: boolean;
  /** true when the server is not running in production (dev-only switches may be offered). */
  devToolsAllowed: boolean;
  can: (permission: string) => boolean;
  logout: () => Promise<void>;
}

const Ctx = createContext<AdminSessionValue | null>(null);

export function AdminSessionProvider({
  identity,
  devToolsAllowed,
  children,
}: {
  identity: AdminIdentity;
  devToolsAllowed: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const { admin, permissions } = identity;

  const can = useCallback((p: string) => permissions.includes(p), [permissions]);

  const logout = useCallback(async () => {
    try {
      // The proxy maps /admin/logout onto the shared auth/logout, using the ADMIN cookie.
      await adminApi.post("/logout");
    } catch {
      /* a 401 means the session is already gone; leaving is correct either way */
    }
    router.replace("/admin/login");
    router.refresh();
  }, [router]);

  const value = useMemo<AdminSessionValue>(
    () => ({ admin, permissions, isSuper: admin.role === "SUPER_ADMIN", devToolsAllowed, can, logout }),
    [admin, permissions, devToolsAllowed, can, logout]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdminSession(): AdminSessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAdminSession must be used inside <AdminSessionProvider>");
  return v;
}
