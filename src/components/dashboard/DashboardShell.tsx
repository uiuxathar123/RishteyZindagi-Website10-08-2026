"use client";

import { Logo } from "@/components/layout/Header";
import { useSession } from "@/components/session/SessionProvider";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import {
  Bell,
  Heart,
  LayoutGrid,
  LogOut,
  Menu,
  MessageCircle,
  MessagesSquare,
  Settings,
  Sparkles,
  Star,
  User,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";

/** Other dashboard views dispatch this after they change read-state so the bell updates at once. */
export const NOTIFICATIONS_CHANGED_EVENT = "rz:notifications-changed";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function InitialsAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rz-maroon text-xs font-bold text-white",
        className
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutGrid },
  { href: "/dashboard/profile", label: "My Profile", icon: User },
  { href: "/dashboard/matches", label: "Matches", icon: Sparkles },
  { href: "/dashboard/interests", label: "Interests", icon: Heart },
  { href: "/dashboard/shortlist", label: "Shortlist", icon: Star },
  { href: "/dashboard/messages", label: "Messages", icon: MessageCircle },
  { href: "/dashboard/groups", label: "Groups", icon: MessagesSquare },
  { href: "/dashboard/notifications", label: "Notifications", icon: Bell },
  { href: "/dashboard/membership", label: "Membership", icon: Users },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function LogoutButton({ className, onDone }: { className?: string; onDone?: () => void }) {
  const { logout } = useSession();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        onDone?.();
        await logout(); // navigates to /login
        setPending(false);
      }}
      className={className}
    >
      <LogOut className="h-[18px] w-[18px]" strokeWidth={1.8} />
      {pending ? "Logging out…" : "Log out"}
    </button>
  );
}

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Dashboard" className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rz-focus flex items-center gap-3 rounded-md px-3.5 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-rz-maroon text-white shadow-card-sm"
                : "text-rz-navy/80 hover:bg-white/70 hover:text-rz-maroon"
            )}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function pageTitleFor(pathname: string): string {
  const match = [...NAV_ITEMS].reverse().find((item) => isActive(pathname, item.href));
  return match?.label ?? "Dashboard";
}

export function DashboardShell({
  children,
  initialUnreadCount = 0,
}: {
  children: ReactNode;
  /** Server-rendered unread count so the badge is right on first paint. */
  initialUnreadCount?: number;
}) {
  const pathname = usePathname();
  const { user } = useSession();
  const displayName = user?.name ?? "Member";
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);

  const refreshUnread = useCallback(async () => {
    try {
      const r = await api.get<{ count: number }>("/notifications/unread-count");
      if (typeof r?.count === "number") setUnreadCount(r.count);
    } catch {
      /* keep the last known value; the bell is a convenience, not a gate */
    }
  }, []);

  useEffect(() => {
    void refreshUnread();
  }, [pathname, refreshUnread]);

  useEffect(() => {
    const id = window.setInterval(() => void refreshUnread(), 60_000);
    const onChanged = () => void refreshUnread();
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
    return () => {
      window.clearInterval(id);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
    };
  }, [refreshUnread]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDrawerOpen(false);
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div className="flex min-h-screen bg-rz-ivory">
      {/* Desktop sidebar */}
      <aside className="hidden w-[260px] shrink-0 flex-col border-r border-rz-border bg-rz-cream lg:flex">
        <div className="border-b border-rz-border/70 px-5 py-5">
          <Logo />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-5">
          <NavList pathname={pathname} />
        </div>
        <div className="border-t border-rz-border/70 px-3 py-4">
          <LogoutButton className="rz-focus flex w-full items-center gap-3 rounded-md px-3.5 py-2.5 text-sm font-medium text-rz-muted hover:bg-white/70 hover:text-rz-maroon disabled:opacity-60" />
        </div>
      </aside>

      {/* Mobile drawer */}
      <div
        className={cn(
          "fixed inset-0 z-overlay bg-rz-navy/40 transition-opacity duration-200 lg:hidden",
          drawerOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <aside
        id="rz-dashboard-drawer"
        className={cn(
          "fixed inset-y-0 left-0 z-modal flex w-[280px] max-w-[85vw] flex-col bg-rz-cream shadow-popover transition-transform duration-300 ease-rz lg:hidden",
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between border-b border-rz-border/70 px-5 py-5">
          <Logo />
          <button
            type="button"
            aria-label="Close menu"
            className="rz-focus flex h-9 w-9 items-center justify-center rounded-full text-rz-navy"
            onClick={() => setDrawerOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-5">
          <NavList pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
        </div>
        <div className="border-t border-rz-border/70 px-3 py-4">
          <LogoutButton className="rz-focus flex w-full items-center gap-3 rounded-md px-3.5 py-2.5 text-sm font-medium text-rz-muted hover:bg-white/70 hover:text-rz-maroon disabled:opacity-60" />
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-sticky flex h-[72px] shrink-0 items-center justify-between gap-3 border-b border-rz-border bg-white px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              aria-controls="rz-dashboard-drawer"
              className="rz-focus flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-rz-navy lg:hidden"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="truncate font-serif text-lg font-semibold text-rz-navy md:text-xl">
              {pageTitleFor(pathname)}
            </h1>
          </div>

          <div className="flex shrink-0 items-center gap-2 md:gap-4">
            <Link
              href="/dashboard/notifications"
              aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
              className="rz-focus relative flex h-10 w-10 items-center justify-center rounded-full text-rz-navy hover:bg-rz-peach/60"
            >
              <Bell className="h-5 w-5" strokeWidth={1.8} />
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rz-maroon px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>

            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="rz-focus flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-rz-peach/60"
              >
                <InitialsAvatar name={displayName} />
                <span className="hidden max-w-[160px] truncate text-sm font-semibold text-rz-navy sm:block">
                  {displayName}
                </span>
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-[calc(100%+8px)] w-52 rounded-md border border-rz-border bg-white py-1.5 shadow-popover"
                >
                  <Link
                    href="/dashboard/settings"
                    role="menuitem"
                    className="rz-focus block px-4 py-2.5 text-sm text-rz-text hover:bg-rz-peach/40"
                  >
                    Account settings
                  </Link>
                  <LogoutButton className="rz-focus flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-rz-maroon hover:bg-rz-peach/40 disabled:opacity-60" />
                </div>
              )}
            </div>
          </div>
        </header>

        {user && user.status !== "ACTIVE" && (
          <div role="alert" className="border-b border-rz-warning/30 bg-rz-warning/10 px-4 py-3 text-sm font-medium text-rz-text md:px-8">
            Your account status is {user.status.toLowerCase()}. Some features may be unavailable.
          </div>
        )}

        <main id="main-content" className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
