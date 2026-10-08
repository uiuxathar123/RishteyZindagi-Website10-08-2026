"use client";

/**
 * Session awareness for the public header, as a small client island so the
 * marketing pages themselves stay static/cacheable. It asks the backend who
 * is signed in (`GET /bff/users/me`, cookie attached by the proxy) and
 * renders nothing but a same-size placeholder until the answer arrives, so a
 * signed-in member never briefly sees "Login / Create Profile" (and the
 * reverse). A plain fetch is used instead of the shared API client on
 * purpose: an anonymous 401 here is normal and must not trigger the
 * "session expired" redirect.
 */
import { Button, ButtonLink } from "@/components/ui/Button";
import { api } from "@/lib/api/client";
import type { PublicUser } from "@/lib/api/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export type HeaderSession =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "member"; user: PublicUser };

export function useHeaderSession() {
  const [session, setSession] = useState<HeaderSession>({ status: "loading" });
  const [loggingOut, setLoggingOut] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/bff/users/me", {
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!res.ok) {
          setSession({ status: "anonymous" });
          return;
        }
        const payload = (await res.json()) as { data?: { user?: PublicUser } };
        const user = payload?.data?.user;
        setSession(user ? { status: "member", user } : { status: "anonymous" });
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        setSession({ status: "anonymous" });
      }
    })();
    return () => controller.abort();
  }, []);

  const logout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await api.post("/auth/logout");
    } catch {
      /* an already-invalid session is logged out as far as the person is concerned */
    }
    setSession({ status: "anonymous" });
    setLoggingOut(false);
    router.refresh();
  }, [loggingOut, router]);

  return { session, logout, loggingOut };
}

export function HeaderActions({
  session,
  onLogout,
  loggingOut,
  layout,
}: {
  session: HeaderSession;
  onLogout: () => void;
  loggingOut: boolean;
  layout: "inline" | "stacked";
}) {
  if (session.status === "loading") {
    // Reserve the space so nothing jumps when the answer arrives.
    return <div aria-hidden="true" className={layout === "inline" ? "h-9 w-[210px]" : "h-11 w-full"} />;
  }
  const size = layout === "inline" ? "sm" : "md";
  const full = layout === "stacked";
  if (session.status === "member") {
    return (
      <>
        <ButtonLink href="/dashboard" variant="primary" size={size} fullWidth={full}>
          Dashboard
        </ButtonLink>
        <Button type="button" variant="outline" size={size} fullWidth={full} onClick={onLogout} disabled={loggingOut}>
          {loggingOut ? "Logging out…" : "Log out"}
        </Button>
      </>
    );
  }
  return (
    <>
      <ButtonLink href="/login" variant="outline" size={size} fullWidth={full}>
        Login
      </ButtonLink>
      <ButtonLink href="/signup" variant="primary" size={size} fullWidth={full}>
        Create Profile
      </ButtonLink>
    </>
  );
}
