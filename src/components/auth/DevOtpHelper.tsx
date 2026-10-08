"use client";

/**
 * Development convenience: when the backend's OTP config has dev mode ON
 * (never possible in production — the routes return 404 there), shows a
 * button that reveals the pending code so the flow can be completed
 * without a real SMS/email provider. Renders nothing otherwise.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import type { OtpPurpose } from "@/lib/api/types";

export function DevOtpHelper({ identifier, purpose, onCode }: { identifier: string; purpose: OtpPurpose; onCode?: (code: string) => void }) {
  const [available, setAvailable] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .get<{ available: boolean }>("/dev/status")
      .then((r) => live && setAvailable(!!r?.available))
      .catch(() => live && setAvailable(false));
    return () => {
      live = false;
    };
  }, []);

  if (!available) return null;

  const reveal = async () => {
    setMsg(null);
    try {
      const r = await api.get<{ code: string | null }>("/dev/otp-code", { query: { identifier, purpose } });
      if (r?.code) {
        setCode(r.code);
        onCode?.(r.code);
      } else {
        setMsg("No pending code found. Request one first.");
      }
    } catch (e) {
      setMsg((e as { kind?: string })?.kind === "not_found" ? "No pending code found. Request one first." : "Could not read the development code.");
    }
  };

  return (
    <div className="mt-4 rounded-md border border-dashed border-amber-400 bg-amber-50 p-3 text-[12.5px] text-amber-900">
      <p className="font-semibold">Development mode — no real SMS/email is sent</p>
      {code ? (
        <p className="mt-1">
          Your code: <span className="font-mono text-base font-bold tracking-widest">{code}</span>
        </p>
      ) : (
        <button type="button" onClick={reveal} className="mt-1 underline underline-offset-2">
          Show my verification code
        </button>
      )}
      {msg && <p className="mt-1">{msg}</p>}
    </div>
  );
}
