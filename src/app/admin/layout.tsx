import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s | RishteyZindagi Admin" },
  robots: { index: false, follow: false },
};

/**
 * Shared by every /admin URL, including the public /admin/login screen.
 * It adds no chrome and no session check — the sidebar shell and the admin
 * session guard live in the `(panel)` route group, so the login page can
 * render without a session while every other admin page cannot.
 */
export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
