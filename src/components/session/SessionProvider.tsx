"use client";

/**
 * Member session state for client components. The session itself lives in
 * an httpOnly cookie held by the /bff proxy; this provider only knows
 * "who is signed in" by asking the backend (`GET /users/me`). It never
 * stores a token.
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setUnauthorizedHandler } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import type { PublicUser } from "@/lib/api/types";

interface SessionValue {
  user: PublicUser | null;
  /** true until the first `/users/me` answer arrives (skipped when `initialUser` is given). */
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children, initialUser }: { children: ReactNode; initialUser?: PublicUser | null }) {
  const [user, setUser] = useState<PublicUser | null>(initialUser ?? null);
  const [loading, setLoading] = useState(initialUser === undefined);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      setUser((await api.get<{ user: PublicUser }>("/users/me")).user);
    } catch (e) {
      if (isApiError(e) && e.kind === "unauthorized") setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialUser === undefined) void refresh();
  }, [initialUser, refresh]);

  const leave = useCallback(() => {
    setUser(null);
    router.replace("/login");
    router.refresh();
  }, [router]);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      /* the cookie is cleared on 401 as well; leaving is correct either way */
    }
    leave();
  }, [leave]);

  const logoutAll = useCallback(async () => {
    await api.post("/auth/logout-all"); // errors propagate so the UI can say it failed
    leave();
  }, [leave]);

  const value = useMemo(() => ({ user, loading, refresh, logout, logoutAll }), [user, loading, refresh, logout, logoutAll]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

/** Like useSession but returns null outside a provider (public pages, header). */
export function useOptionalSession(): SessionValue | null {
  return useContext(SessionContext);
}

/**
 * Mounted once in the root layout: when any signed-in call comes back 401
 * (session expired / revoked) send the person to the matching login page,
 * remembering where they were.
 */
export function UnauthorizedRedirect() {
  useEffect(() => {
    let redirecting = false;
    setUnauthorizedHandler((realm) => {
      if (redirecting) return;
      redirecting = true;
      const here = window.location.pathname + window.location.search;
      if (realm === "admin") {
        window.location.assign("/admin/login");
      } else {
        window.location.assign(`/login?expired=1&next=${encodeURIComponent(here)}`);
      }
    });
    return () => setUnauthorizedHandler(null);
  }, []);
  return null;
}
