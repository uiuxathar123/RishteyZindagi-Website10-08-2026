"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * B19: shows the Super Admin's maintenance message to members and visitors. Polls the public, unauthenticated
 * `/bff/site-status` (on/off + message only) once a minute and on first load. Never shown inside the Admin Panel,
 * which keeps working during maintenance. If the status cannot be read the banner stays hidden.
 */
export function SiteStatusBanner() {
  const pathname = usePathname();
  const [message, setMessage] = useState<string | null>(null);
  const inAdmin = pathname?.startsWith("/admin") ?? false;

  useEffect(() => {
    if (inAdmin) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/bff/site-status", { cache: "no-store" });
        const body = (await res.json()) as { data?: { maintenance?: boolean; message?: string } };
        if (!cancelled) setMessage(body.data?.maintenance ? body.data.message || "We are undergoing maintenance. Please try again shortly." : null);
      } catch {
        /* keep the previous state */
      }
    }
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [inAdmin]);

  if (inAdmin || !message) return null;
  return (
    <div role="status" data-testid="maintenance-banner" className="bg-rz-maroon px-4 py-2 text-center text-sm font-semibold text-white">
      {message}
    </div>
  );
}
