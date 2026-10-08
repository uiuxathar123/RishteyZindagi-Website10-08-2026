"use client";

import { Logo } from "@/components/layout/Header";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/utils";
import { useAdminSession } from "./AdminSessionProvider";
import {
  LayoutDashboard,
  Users,
  UserCheck,
  Flag,
  Settings,
  LogOut,
  Menu,
  X,
  Crown,
  UserCog,
  SlidersHorizontal,
  IndianRupee,
  ScrollText,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Permission keys the admin needs to see this entry (all of them). Presentation only: the API enforces. */
  needs?: string[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, needs: ["users.view"] },
  { href: "/admin/users", label: "Users", icon: Users, needs: ["users.view"] },
  { href: "/admin/profiles", label: "Profile Approvals", icon: UserCheck, needs: ["users.view", "profiles.verify"] },
  { href: "/admin/reports", label: "Reports", icon: Flag, needs: ["reports.resolve"] },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

/**
 * The highest-privilege tier, above regular Staff Admin — kept in the same
 * shell/sidebar (rather than a separate app) but visually set apart by a
 * divider, a small gold "Super Admin" label, and a Crown glyph, so it never
 * reads as just another Staff Admin page. The group is only listed for a
 * SUPER_ADMIN; a Staff Admin who types the URL gets a "Super Admin only"
 * screen, and every API behind these pages enforces its own permission.
 */
const SUPER_ADMIN_NAV_ITEMS: NavItem[] = [
  { href: "/admin/super", label: "Super Overview", icon: Crown },
  { href: "/admin/super/staff", label: "Staff & Roles", icon: UserCog },
  { href: "/admin/super/settings", label: "Platform Settings", icon: SlidersHorizontal, needs: ["platform.settings.manage"] },
  { href: "/admin/super/revenue", label: "Revenue", icon: IndianRupee, needs: ["payments.review"] },
  { href: "/admin/super/audit-log", label: "Audit Log", icon: ScrollText, needs: ["audit.view"] },
];

function isActive(pathname: string, href: string) {
  if (href === "/admin" || href === "/admin/super") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rz-focus flex items-center gap-3 rounded-md px-3.5 py-2.5 text-[14px] font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-white",
        active && "bg-white/10 font-semibold text-white"
      )}
    >
      <Icon
        className={cn("h-[18px] w-[18px] shrink-0", active ? "text-rz-gold-soft" : "text-white/50")}
        strokeWidth={1.8}
      />
      <span className="truncate">{label}</span>
      {active && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-rz-gold-soft" aria-hidden="true" />}
    </Link>
  );
}

function SidebarNav({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const { can, isSuper } = useAdminSession();
  const visible = (item: NavItem) => !item.needs || item.needs.every(can);
  const main = NAV_ITEMS.filter(visible);
  const superItems = isSuper ? SUPER_ADMIN_NAV_ITEMS.filter(visible) : [];
  return (
    <nav aria-label="Admin" className="flex flex-1 flex-col gap-1 px-3 py-4">
      {main.map((item) => (
        <NavLink key={item.href} {...item} active={isActive(pathname, item.href)} onNavigate={onNavigate} />
      ))}

      {superItems.length > 0 && (
        <>
          <div className="mx-1.5 mt-4 flex items-center gap-2 border-t border-white/10 pt-4">
            <Crown className="h-3.5 w-3.5 text-rz-gold-soft" strokeWidth={1.8} />
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-rz-gold-soft">
              Super Admin
            </span>
          </div>
          {superItems.map((item) => (
            <NavLink key={item.href} {...item} active={isActive(pathname, item.href)} onNavigate={onNavigate} />
          ))}
        </>
      )}
    </nav>
  );
}

/**
 * Fully separate app shell for the staff Admin Panel — deliberately does
 * NOT import or render the public Header/Footer (see `(marketing)/layout`)
 * or the member dashboard's chrome. A darker navy sidebar with a gold
 * active-state accent (instead of the maroon accent used across the rest
 * of the product) signals "internal tool" at a glance.
 *
 * Identity, role and permissions come from the admin session
 * (`AdminSessionProvider`, fed by `GET /admin/me`); Log out revokes the
 * admin session through the proxy.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { admin, isSuper, logout } = useAdminSession();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-screen bg-rz-cream">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-toast focus:rounded-md focus:bg-rz-navy focus:px-4 focus:py-2.5 focus:text-white"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <aside className="hidden w-[248px] shrink-0 flex-col bg-rz-navy-dark lg:flex">
        <div className="flex h-[76px] items-center overflow-hidden border-b border-white/10 px-5">
          <Logo variant="inverted" />
        </div>
        <SidebarNav pathname={pathname} />
        <div className="border-t border-white/10 p-4">
          <p className="px-1 text-[11px] leading-relaxed text-white/40">
            Staff tools — internal use only. The menu only lists what your role may use; every action is checked again by the server.
          </p>
        </div>
      </aside>

      {/* Mobile slide-over drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-overlay lg:hidden">
          <div
            className="absolute inset-0 bg-rz-navy-dark/60"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative flex h-full w-[260px] max-w-[80vw] flex-col bg-rz-navy-dark shadow-popover">
            <div className="flex h-[76px] items-center justify-between border-b border-white/10 px-5">
              <Logo variant="inverted" />
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setDrawerOpen(false)}
                className="rz-focus flex h-9 w-9 items-center justify-center rounded-full text-white/80"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarNav pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-header flex h-[76px] shrink-0 items-center justify-between gap-4 border-b border-rz-border bg-white px-4 md:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              aria-controls="rz-admin-drawer"
              onClick={() => setDrawerOpen(true)}
              className="rz-focus flex h-10 w-10 items-center justify-center rounded-full text-rz-navy lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Badge tone="gold">{isSuper ? "Super Admin" : "Staff Access"}</Badge>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden min-w-0 text-right sm:block">
              <p className="truncate text-[13.5px] font-semibold text-rz-navy">{admin.name}</p>
              <p className="truncate text-[11.5px] text-rz-muted">
                {admin.email} · {admin.role === "SUPER_ADMIN" ? "Super Admin" : admin.role === "STAFF_ADMIN" ? "Staff Admin" : admin.role}
              </p>
            </div>
            <Avatar alt={admin.name} size="sm" />
            <button
              type="button"
              disabled={loggingOut}
              onClick={async () => {
                setLoggingOut(true);
                await logout();
              }}
              className="rz-focus flex items-center gap-1.5 rounded-full border border-rz-border px-3 py-2 text-[13px] font-semibold text-rz-muted transition-colors hover:border-rz-maroon/40 hover:text-rz-maroon disabled:opacity-60"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{loggingOut ? "Logging out…" : "Log out"}</span>
            </button>
          </div>
        </header>

        <main id="main-content" className="flex-1 px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
