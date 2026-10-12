"use client";

import { Badge } from "@/components/ui/Badge";
import type { OwnerProfile } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { EditorTab, missingFieldInfo, profileDisplayStatus, verificationDisplay } from "./profileForm";

/**
 * Completion %, status, verification and the missing-field list — every
 * value here is read straight from the backend response; nothing is
 * recomputed on the client.
 */
export function StatusPanel({ profile, onGoto }: { profile: OwnerProfile; onGoto: (tab: EditorTab) => void }) {
  const status = profileDisplayStatus(profile.profileStatus);
  const verification = verificationDisplay(profile.verificationStatus);
  const pct = profile.profileCompletionPercent;
  const missing = profile.missingRequiredFields;
  const ready = profile.isReadyForVisibility;

  return (
    <section className="mb-5 rounded-lg border border-rz-border bg-white p-5 md:p-6" aria-label="Profile completion">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-serif text-lg font-semibold text-rz-navy">Profile completion</h3>
          {profile.profileId && (
            <p className="mt-0.5 text-xs text-rz-muted" data-testid="own-profile-id">
              Your profile ID: <span className="font-semibold tracking-wide text-rz-navy">{profile.profileId}</span> — share it so someone can find you with Advanced search.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          <Badge tone={verification.tone}>
            <ShieldCheck className="h-3 w-3" aria-hidden />
            {verification.label}
          </Badge>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Profile completion"
          className="h-2.5 flex-1 overflow-hidden rounded-full bg-rz-border/60"
        >
          <div className={cn("h-full rounded-full transition-all", ready ? "bg-rz-success" : "bg-rz-maroon")} style={{ width: `${pct}%` }} />
        </div>
        <span className="w-12 text-right text-sm font-bold text-rz-navy">{pct}%</span>
      </div>
      <p className="mt-1 text-xs text-rz-muted">Share of required details filled in, as calculated by RishteyZindagi.</p>

      {missing.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-semibold text-rz-navy">Still needed</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {missing.map((key) => {
              const info = missingFieldInfo(key);
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => onGoto(info.tab)}
                    className="rz-focus rounded-full border border-rz-border bg-rz-ivory px-3 py-1 text-[13px] font-medium text-rz-text hover:border-rz-maroon/50"
                  >
                    {info.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-4 rounded-md bg-rz-ivory px-4 py-3 text-sm text-rz-text">
        {ready ? (
          <p className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-rz-success" aria-hidden />
            <span>Your profile is ready: other members can find it in search and recommendations while your account is active.</span>
          </p>
        ) : (
          <p>
            <span className="font-semibold">How to become visible:</span> your profile appears in search and recommendations once every required detail above is filled in and you have at least one photo.
          </p>
        )}
        <p className="mt-2 text-[13px] text-rz-muted">{verification.help}</p>
      </div>
    </section>
  );
}
