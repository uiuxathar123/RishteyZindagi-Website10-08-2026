import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { SessionProvider } from "@/components/session/SessionProvider";
import { getMemberSession, serverGet } from "@/lib/api/server";

// Always evaluated per request: the page depends on the signed-in cookie.
export const dynamic = "force-dynamic";

/** Best-effort current path (the layout has no direct access to it). */
function currentPath(): string {
  const h = headers();
  const raw = h.get("x-invoke-path") ?? h.get("next-url") ?? h.get("x-pathname") ?? "";
  if (raw.startsWith("/dashboard") && !raw.startsWith("//")) return raw;
  return "/dashboard";
}

/**
 * Chrome for every logged-in member route. The session is validated on the
 * server (GET /users/me with the httpOnly cookie) before anything renders:
 * a signed-out visitor is redirected to /login and never sees dashboard
 * markup. The backend still authorises every API call independently.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getMemberSession();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(currentPath())}`);
  }

  const unread = await serverGet<{ count: number }>("member", "/notifications/unread-count");

  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-toast focus:rounded-md focus:bg-rz-navy focus:px-4 focus:py-2.5 focus:text-white"
      >
        Skip to main content
      </a>
      <SessionProvider initialUser={user}>
        <DashboardShell initialUnreadCount={unread?.count ?? 0}>{children}</DashboardShell>
      </SessionProvider>
    </div>
  );
}
