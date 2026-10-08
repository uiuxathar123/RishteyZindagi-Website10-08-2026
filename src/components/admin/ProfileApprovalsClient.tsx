"use client";

import { AsyncView } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { PhotoImage } from "@/components/ui/PhotoImage";
import { Skeleton } from "@/components/ui/States";
import { adminApi, asAdminApi } from "@/lib/api/client";
import { useAsync } from "@/lib/api/hooks";
import type { AdminUserSummary, OwnerProfile, Page, ProfileViewResponse } from "@/lib/api/types";
import { formatDate, humanize } from "@/lib/format";
import { photoSrc, primaryPhotoUrl } from "@/lib/photo";
import { Calendar, MapPin, UserCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ApiErrorView } from "@/components/ui/AsyncView";
import { Pagination, PageHeader } from "./AdminUi";
import type { AdminUserDetailFull } from "./adminTypes";
import { VerifyControls } from "./VerifyControls";

const PAGE_SIZE = 9;

/**
 * `/admin/profiles` — the manual verification queue: members whose profile
 * verification is PENDING (`GET /admin/users?verificationStatus=PENDING`).
 * Each card loads the member's profile and photos with the ADMIN session
 * (`GET /profiles/{id}` as admin; photos via the admin photo proxy) and
 * approves / rejects through `PATCH /admin/profiles/{id}/verify`.
 */
export function ProfileApprovalsClient() {
  const [page, setPage] = useState(1);
  const [decided, setDecided] = useState<Record<string, "VERIFIED" | "REJECTED" | "UNVERIFIED">>({});
  const list = useAsync(
    (signal) =>
      adminApi.get<Page<AdminUserSummary>>("/users", { query: { verificationStatus: "PENDING", page, pageSize: PAGE_SIZE }, signal }),
    [page]
  );

  const decidedCount = Object.keys(decided).length;

  return (
    <div>
      <PageHeader
        title="Profile Approvals"
        icon={<UserCheck className="h-5 w-5 text-rz-navy" strokeWidth={1.8} />}
        description={
          list.data
            ? `${list.data.total} awaiting review${decidedCount > 0 ? ` · ${decidedCount} decided on this page` : ""}`
            : "Profiles waiting for manual verification"
        }
      />

      <AsyncView
        data={list.data}
        error={list.error}
        loading={list.loading}
        reload={list.reload}
        skeleton={
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[420px] w-full" />
            ))}
          </div>
        }
        isEmpty={(d) => d.items.length === 0}
        empty={{ title: "All caught up", description: "There are no profiles waiting for manual approval right now." }}
      >
        {(data) => (
          <>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {data.items.map((u) => (
                <ApprovalCard
                  key={u.id}
                  user={u}
                  decision={decided[u.id]}
                  onDecided={(s) => setDecided((prev) => ({ ...prev, [u.id]: s }))}
                />
              ))}
            </div>
            {data.totalPages > 1 && (
              <div className="mt-5 overflow-hidden rounded-lg border border-rz-border bg-white">
                <Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={setPage} disabled={list.loading} />
              </div>
            )}
            {decidedCount > 0 && (
              <p className="mt-3 text-[13px] text-rz-muted">
                Decided profiles leave the queue the next time this list reloads.{" "}
                <button type="button" onClick={() => { setDecided({}); list.reload(); }} className="rz-focus font-semibold text-rz-maroon hover:underline">
                  Refresh queue
                </button>
              </p>
            )}
          </>
        )}
      </AsyncView>
    </div>
  );
}

function ApprovalCard({
  user,
  decision,
  onDecided,
}: {
  user: AdminUserSummary;
  decision?: "VERIFIED" | "REJECTED" | "UNVERIFIED";
  onDecided: (s: "VERIFIED" | "REJECTED" | "UNVERIFIED") => void;
}) {
  // The list row carries no profile id, so resolve it from the member detail, then load the profile.
  const data = useAsync(async (signal) => {
    const { user: detail } = await adminApi.get<{ user: AdminUserDetailFull }>(`/users/${user.id}`, { signal });
    if (!detail.profile) return { detail, profile: null as OwnerProfile | null };
    const view = await asAdminApi.get<ProfileViewResponse>(`/profiles/${detail.profile.id}`, { signal });
    return { detail, profile: view.audience === "owner" || view.audience === "admin" ? (view.profile as OwnerProfile) : null };
  }, [user.id]);

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-rz-border bg-white shadow-card-sm">
      {data.loading && !data.data ? (
        <div className="p-4" role="status" aria-label="Loading profile">
          <Skeleton className="aspect-[4/5] w-full" />
          <Skeleton className="mt-4 h-5 w-2/3" />
          <Skeleton className="mt-2 h-4 w-1/2" />
        </div>
      ) : data.error ? (
        <div className="p-4">
          <ApiErrorView error={data.error} onRetry={data.reload} />
        </div>
      ) : data.data ? (
        <CardBody user={user} detail={data.data.detail} profile={data.data.profile} decision={decision} onDecided={onDecided} />
      ) : null}
    </div>
  );
}

function CardBody({
  user,
  detail,
  profile,
  decision,
  onDecided,
}: {
  user: AdminUserSummary;
  detail: AdminUserDetailFull;
  profile: OwnerProfile | null;
  decision?: "VERIFIED" | "REJECTED" | "UNVERIFIED";
  onDecided: (s: "VERIFIED" | "REJECTED" | "UNVERIFIED") => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const photos = profile?.photos ?? [];
  const primary = photoSrc(primaryPhotoUrl(photos), "admin");
  const others = photos.filter((p) => photoSrc(p.url, "admin") !== primary);
  const place = [profile?.city?.name, profile?.country?.name].filter(Boolean).join(", ") || [user.city, user.country].filter(Boolean).join(", ");

  return (
    <>
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-rz-peach">
        <PhotoImage src={primary} alt={`Primary photo of ${user.name}`} sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 90vw" />
        {photos.length === 0 && (
          <div className="absolute left-3 top-3">
            <Badge tone="gold">No photo uploaded</Badge>
          </div>
        )}
        {decision && (
          <div className="absolute right-3 top-3">
            <Badge tone={decision === "VERIFIED" ? "success" : "maroon"}>{decision === "VERIFIED" ? "Approved" : decision === "REJECTED" ? "Rejected" : "Reset"}</Badge>
          </div>
        )}
      </div>

      {others.length > 0 && (
        <div className="border-b border-rz-border px-4 py-2">
          <button type="button" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)} className="rz-focus text-[12.5px] font-semibold text-rz-maroon hover:underline">
            {showAll ? "Hide other photos" : `Show ${others.length} more photo${others.length === 1 ? "" : "s"}`}
          </button>
          {showAll && (
            <div className="mt-2 grid grid-cols-3 gap-2">
              {others.map((p) => (
                <div key={p.id} className="relative aspect-square overflow-hidden rounded-md bg-rz-peach">
                  <PhotoImage src={photoSrc(p.url, "admin")} alt={`Additional photo of ${user.name}`} sizes="120px" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-1 flex-col p-4">
        <h3 className="font-serif text-lg font-semibold text-rz-navy">
          {profile ? `${profile.displayName}, ${profile.age}` : user.name}
        </h3>
        {place && (
          <p className="mt-1 flex items-center gap-1 text-xs text-rz-muted">
            <MapPin className="h-3.5 w-3.5" />
            {place}
          </p>
        )}
        <p className="mt-1 flex items-center gap-1 text-xs text-rz-muted">
          <Calendar className="h-3.5 w-3.5" />
          Joined {formatDate(user.createdAt)} · profile {detail.profile?.profileCompletionPercent ?? 0}% complete
        </p>
        {profile && (
          <p className="mt-2 text-[12.5px] text-rz-text">
            {[humanize(profile.gender), profile.religion?.name, profile.education?.name, profile.profession?.name].filter(Boolean).join(" · ")}
          </p>
        )}
        {profile?.aboutMe && <p className="mt-2 line-clamp-3 break-words text-[12.5px] text-rz-muted">{profile.aboutMe}</p>}
        <Link href={`/admin/users?user=${user.id}`} className="rz-focus mt-2 text-[12.5px] font-semibold text-rz-maroon hover:underline">
          Full member record
        </Link>

        <div className="mt-auto border-t border-rz-border pt-4">
          {detail.profile ? (
            <VerifyControls profileId={detail.profile.id} current={decision ?? detail.profile.verificationStatus} onChanged={onDecided} compact />
          ) : (
            <p className="text-sm text-rz-muted">This member has no profile record to verify.</p>
          )}
        </div>
      </div>
    </>
  );
}

