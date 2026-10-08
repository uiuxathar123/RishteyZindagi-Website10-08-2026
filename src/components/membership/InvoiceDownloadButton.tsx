"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

/**
 * Downloads the invoice PDF (`GET /invoices/:id/download`) through the
 * same-origin proxy (the httpOnly cookie rides along; no token in the URL).
 * It is a real link (works without JS) enhanced to fetch the bytes first so
 * a failed request shows a message instead of saving an error body as a file.
 */
export function InvoiceDownloadButton({
  invoiceId,
  invoiceNumber,
  className,
}: {
  invoiceId: string;
  invoiceNumber: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const href = api.url(`/invoices/${invoiceId}/download`);

  async function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(href, { credentials: "same-origin", headers: { Accept: "application/pdf" } });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.includes("application/pdf")) {
        let message = res.status === 401 ? "Your session has ended. Please log in again." : "The invoice could not be downloaded.";
        if (type.includes("application/json")) {
          try {
            const body = (await res.json()) as { error?: { message?: string } };
            if (body?.error?.message) message = body.error.message;
          } catch {
            /* keep the generic message */
          }
        }
        setError(message);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoiceNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start">
      <a
        href={href}
        download={`${invoiceNumber}.pdf`}
        onClick={onClick}
        aria-busy={busy}
        className={cn(
          "rz-focus inline-flex items-center gap-1.5 rounded-full border border-rz-maroon bg-white px-3 py-1.5 text-xs font-semibold text-rz-maroon hover:bg-rz-maroon/5",
          busy && "pointer-events-none opacity-60",
          className
        )}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Download className="h-3.5 w-3.5" aria-hidden />}
        {busy ? "Preparing…" : "Download PDF"}
        <span className="sr-only"> for invoice {invoiceNumber}</span>
      </a>
      {error && (
        <span role="alert" className="mt-1 text-xs text-rz-danger">
          {error}
        </span>
      )}
    </span>
  );
}
