import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminSessionProvider } from "@/components/admin/AdminSessionProvider";
import { getAdminSession } from "@/lib/api/server";

// Always evaluated per request: the guard reads the admin session cookie.
export const dynamic = "force-dynamic";

/**
 * Guard + chrome for the staff Admin Panel (everything under /admin except
 * /admin/login). Validates the ADMIN session on the server (`GET /admin/me`
 * with the admin cookie only — a member session is never accepted here) and
 * redirects to /admin/login when there is none. The page content is never
 * rendered for a signed-out visitor.
 *
 * Separate app shell: does NOT import the public Header/Footer or the
 * member dashboard chrome.
 */
export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const identity = await getAdminSession();
  if (!identity) redirect("/admin/login");

  return (
    <AdminSessionProvider identity={identity} devToolsAllowed={process.env.NODE_ENV !== "production"}>
      <AdminShell>{children}</AdminShell>
    </AdminSessionProvider>
  );
}
