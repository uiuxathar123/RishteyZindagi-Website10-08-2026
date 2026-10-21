"use client";

import { useState } from "react";
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge, CompanyVerifiedBadge } from "@/components/ui/Badge";
import { PhotoImage } from "@/components/ui/PhotoImage";
import { asAdminApi } from "@/lib/api/client";
import { useAsync } from "@/lib/api/hooks";
import type { OwnerProfile, ProfileViewResponse } from "@/lib/api/types";
import { defaultAvatarSrc } from "@/lib/avatar/defaultAvatar";
import { formatDate, humanize } from "@/lib/format";
import { photoSrc, primaryPhotoUrl } from "@/lib/photo";
import { KeyValue } from "./AdminUi";

const dash = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "—" : String(v));
const heightLabel = (cm: number | null) => {
  if (!cm) return "—";
  const inches = Math.round(cm / 2.54);
  return `${cm} cm (${Math.floor(inches / 12)}′${inches % 12}″)`;
};

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-[13px] font-semibold text-rz-navy">{title}</h4>
      {children}
    </div>
  );
}

/** Photos: the selected one large, all of them as thumbnails; the default avatar when there are none. */
function Gallery({ profile }: { profile: OwnerProfile }) {
  const photos = [...profile.photos].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const current = photos.find((p) => p.id === selectedId) ?? photos[0];
  const avatar = defaultAvatarSrc({ gender: profile.gender, religion: profile.religion?.name, seed: profile.id });

  return (
    <div>
      <div className="relative mx-auto aspect-[4/5] w-full max-w-xs overflow-hidden rounded-lg border border-rz-border bg-rz-peach">
        <PhotoImage
          src={current ? photoSrc(current.url, "admin") : photoSrc(primaryPhotoUrl(photos), "admin")}
          alt={current ? `Photo of ${profile.displayName}` : `${profile.displayName} has not added a photo`}
          sizes="320px"
          fallbackSrc={avatar}
        />
        <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
          {photos.length === 0 && <Badge tone="gold">No photo uploaded — default avatar</Badge>}
          {current?.isPrimary && <Badge tone="navy">Main photo</Badge>}
          {current && current.moderation !== "VERIFIED" && <Badge tone="neutral">Photo {humanize(current.moderation).toLowerCase()}</Badge>}
        </div>
      </div>
      {photos.length > 1 && (
        <ul className="mt-3 flex flex-wrap justify-center gap-2" aria-label="All photos">
          {photos.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setSelectedId(p.id)}
                aria-label={`Show photo ${i + 1}`}
                aria-pressed={current?.id === p.id}
                className={`rz-focus relative block h-16 w-16 overflow-hidden rounded-md border-2 ${current?.id === p.id ? "border-rz-maroon" : "border-transparent"}`}
              >
                <PhotoImage src={photoSrc(p.url, "admin")} alt="" sizes="64px" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-center text-[12px] text-rz-muted">
        {photos.length} photo{photos.length === 1 ? "" : "s"}
      </p>
    </div>
  );
}

/** The member's full profile, as an admin sees it (no partner preferences — those are private to the member). */
export function UserProfileDetails({ profileId }: { profileId: string }) {
  const view = useAsync((signal) => asAdminApi.get<ProfileViewResponse>(`/profiles/${profileId}`, { signal }), [profileId]);

  return (
    <AsyncView data={view.data} error={view.error} loading={view.loading} reload={view.reload} skeleton={<ListSkeleton rows={4} />}>
      {(res) => {
        if (res.audience !== "admin" && res.audience !== "owner") return <p className="text-sm text-rz-muted">The full profile is not available to your role.</p>;
        const p = res.profile as OwnerProfile;
        const life = p.lifestyle ?? {};
        const fam = p.familyDetails ?? {};
        return (
          <div className="space-y-5">
            <Gallery profile={p} />

            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="font-serif text-lg font-semibold text-rz-navy">
                {p.displayName}, {p.age}
              </span>
              {p.companyVerified && <CompanyVerifiedBadge />}
              {p.approvalStatus && p.approvalStatus !== "APPROVED" && <Badge tone={p.approvalStatus === "REJECTED" ? "maroon" : "gold"}>Approval {humanize(p.approvalStatus).toLowerCase()}</Badge>}
            </div>
            {p.approvalStatus === "REJECTED" && p.approvalReason && <p className="text-center text-[13px] text-rz-maroon">Rejected: {p.approvalReason}</p>}

            <Group title="About">
              <p className="whitespace-pre-wrap break-words text-sm text-rz-text">{p.aboutMe?.trim() || "—"}</p>
            </Group>

            <Group title="Basic details">
              <KeyValue
                items={[
                  ["Profile ID", dash(p.profileId)],
                  ["Gender", humanize(p.gender)],
                  ["Date of birth", `${formatDate(p.dateOfBirth)} (${p.age} yrs)`],
                  ["Marital status", dash(p.maritalStatus?.name)],
                  ["Height", heightLabel(p.heightCm)],
                  ["Location", [p.city?.name, p.country?.name].filter(Boolean).join(", ") || "—"],
                ]}
              />
            </Group>

            <Group title="Religion and background">
              <KeyValue
                items={[
                  ["Religion", dash(p.religion?.name)],
                  ["Community", dash(p.community?.name)],
                  ["Mother tongue", dash(p.motherTongue?.name)],
                ]}
              />
            </Group>

            <Group title="Education and career">
              <KeyValue
                items={[
                  ["Education", dash(p.education?.name)],
                  ["Profession", dash(p.profession?.name)],
                  ["Income", dash(p.incomeRange)],
                ]}
              />
            </Group>

            <Group title="Lifestyle">
              <KeyValue
                items={[
                  ["Diet", life.diet ? humanize(life.diet) : "—"],
                  ["Smoking", life.smoking ? humanize(life.smoking) : "—"],
                  ["Drinking", life.drinking ? humanize(life.drinking) : "—"],
                  ["Disability", dash(life.disability)],
                ]}
              />
            </Group>

            <Group title="Family">
              <KeyValue
                items={[
                  ["Family type", fam.familyType ? humanize(fam.familyType) : "—"],
                  ["Family values", fam.familyValues ? humanize(fam.familyValues) : "—"],
                  ["Father", dash(fam.fatherOccupation)],
                  ["Mother", dash(fam.motherOccupation)],
                  ["Siblings", fam.siblings === undefined ? "—" : String(fam.siblings)],
                  ["Notes", dash(fam.notes)],
                ]}
              />
            </Group>

            {p.missingRequiredFields.length > 0 && (
              <p className="rounded-md bg-rz-cream p-2 text-[12px] text-rz-muted">Still missing: {p.missingRequiredFields.map((f) => humanize(f.replace(/([A-Z])/g, "_$1"))).join(", ")}</p>
            )}
          </div>
        );
      }}
    </AsyncView>
  );
}
