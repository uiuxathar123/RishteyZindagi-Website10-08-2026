"use client";

/**
 * Dashboard overview widgets. Each one loads its own data (so one slow or
 * failing endpoint never blanks the page) and handles loading, empty and
 * error on its own. Nothing here is computed on the client except simple
 * counts of what the API returned.
 */
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/States";
import { MatchScore } from "@/components/profile/MatchScore";
import { api } from "@/lib/api/client";
import { useAsync } from "@/lib/api/hooks";
import type { ApiError } from "@/lib/api/errors";
import type {
  InterestView,
  MatchView,
  MyMembership,
  NotificationView,
  Page,
  ProfileCompletion,
  RecommendationItem,
  RecommendationsPage,
  ShortlistView,
  WarningView,
} from "@/lib/api/types";
import { formatDate, timeAgo } from "@/lib/format";
import { primaryPhotoUrl, photoSrc } from "@/lib/photo";
import { Bell, Heart, ShieldAlert, ShieldCheck, Sparkles, Star } from "lucide-react";
import Link from "next/link";
import { ReactNode } from "react";

function CardError({ error, onRetry, what }: { error: ApiError; onRetry: () => void; what: string }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-rz-muted">
      <span>Couldn&apos;t load {what}: {error.friendlyMessage}</span>
      <button type="button" onClick={onRetry} className="rz-focus font-semibold text-rz-maroon">
        Retry
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------- warnings */

export function WarningsBanner() {
  const { data } = useAsync((signal) => api.get<{ warnings: WarningView[] }>("/warnings/me", { signal }), []);
  const open = (data?.warnings ?? []).filter((w) => !w.acknowledgedAt);
  if (open.length === 0) return null;
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-lg border border-rz-warning/40 bg-rz-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rz-warning" />
        <div>
          <p className="text-sm font-semibold text-rz-navy">
            You have {open.length} unacknowledged warning{open.length === 1 ? "" : "s"} from our team
          </p>
          <p className="mt-0.5 text-xs text-rz-muted">Please read and acknowledge {open.length === 1 ? "it" : "them"} in Settings.</p>
        </div>
      </div>
      <ButtonLink href="/dashboard/settings#warnings" variant="outline" size="sm" className="shrink-0">
        Review warnings
      </ButtonLink>
    </div>
  );
}

/* ------------------------------------------------------ profile completion */

export function ProfileCompletionCard() {
  const state = useAsync((signal) => api.get<ProfileCompletion>("/profiles/me/completion", { signal }), []);
  const { data, error, loading, reload } = state;

  let body: ReactNode;
  if (loading && !data) {
    body = (
      <div className="flex min-w-0 items-center gap-4">
        <Skeleton className="h-16 w-16 shrink-0 rounded-full" />
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-4 w-56 max-w-full" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
      </div>
    );
  } else if (error?.kind === "not_found") {
    body = (
      <>
        <div>
          <p className="font-serif text-base font-semibold text-rz-navy">You haven&apos;t started your profile yet</p>
          <p className="mt-1 text-sm text-rz-muted">Create your profile to appear in search and receive recommendations.</p>
        </div>
        <ButtonLink href="/dashboard/profile" variant="primary" size="sm" className="shrink-0">
          Create Profile
        </ButtonLink>
      </>
    );
  } else if (error && !data) {
    body = <CardError error={error} onRetry={reload} what="your profile completion" />;
  } else if (data) {
    const pct = data.profileCompletionPercent;
    body = (
      <>
        <div className="flex items-center gap-4">
          <MatchScore value={pct} size={64} />
          <div>
            <p className="font-serif text-base font-semibold text-rz-navy">Your profile is {pct}% complete</p>
            <p className="mt-1 text-sm text-rz-muted">
              {data.profileStatus === "READY_FOR_VISIBILITY"
                ? "Your profile is visible to other members."
                : data.missingRequiredFields.length > 0
                  ? `Still needed to go live: ${data.missingRequiredFields.length} item${data.missingRequiredFields.length === 1 ? "" : "s"}.`
                  : "Complete your profile to appear higher in match results."}
            </p>
          </div>
        </div>
        {data.profileStatus !== "READY_FOR_VISIBILITY" && (
          <ButtonLink href="/dashboard/profile" variant="primary" size="sm" className="shrink-0">
            Complete Profile
          </ButtonLink>
        )}
      </>
    );
  }

  return (
    <section className="flex flex-col items-start gap-5 rounded-lg border border-rz-border bg-white p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
      {body}
    </section>
  );
}

/* ---------------------------------------------------------------- stat tiles */

function StatTile({
  label,
  href,
  icon: Icon,
  load,
}: {
  label: string;
  href: string;
  icon: typeof Heart;
  load: (signal: AbortSignal) => Promise<number>;
}) {
  const { data, error, loading, reload } = useAsync(load, []);
  return (
    <Link
      href={href}
      className="rz-focus flex flex-col gap-3 rounded-lg border border-rz-border bg-white p-4 transition-colors hover:border-rz-maroon/40 md:p-5"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-rz-peach text-rz-maroon">
        <Icon className="h-5 w-5" strokeWidth={1.8} />
      </span>
      <div>
        {loading && data === null ? (
          <Skeleton className="h-7 w-10" />
        ) : error && data === null ? (
          <p className="font-serif text-2xl font-bold text-rz-muted" title={error.friendlyMessage}>
            —
          </p>
        ) : (
          <p className="font-serif text-2xl font-bold text-rz-navy">{data}</p>
        )}
        <p className="text-xs font-medium text-rz-muted">
          {label}
          {error && data === null && (
            <button
              type="button"
              className="rz-focus ml-1.5 font-semibold text-rz-maroon"
              onClick={(e) => {
                e.preventDefault();
                reload();
              }}
            >
              Retry
            </button>
          )}
        </p>
      </div>
    </Link>
  );
}

export function StatTiles() {
  return (
    <section aria-label="Activity summary" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatTile
        label="Interests received (pending)"
        href="/dashboard/interests"
        icon={Heart}
        load={async (signal) => {
          const r = await api.get<{ interests: InterestView[] }>("/interactions/interests", { query: { direction: "received" }, signal });
          return r.interests.filter((i) => i.status === "PENDING").length;
        }}
      />
      <StatTile
        label="Mutual matches"
        href="/dashboard/interests"
        icon={Sparkles}
        load={async (signal) => (await api.get<{ matches: MatchView[] }>("/interactions/matches", { signal })).matches.length}
      />
      <StatTile
        label="Shortlisted"
        href="/dashboard/shortlist"
        icon={Star}
        load={async (signal) => (await api.get<{ shortlist: ShortlistView[] }>("/interactions/shortlist", { signal })).shortlist.length}
      />
      <StatTile
        label="Unread notifications"
        href="/dashboard/notifications"
        icon={Bell}
        load={async (signal) => (await api.get<{ count: number }>("/notifications/unread-count", { signal })).count}
      />
    </section>
  );
}

/* ---------------------------------------------------------------- membership */

export function MembershipCard() {
  const { data, error, loading, reload } = useAsync((signal) => api.get<MyMembership>("/memberships/me", { signal }), []);
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-rz-border bg-white p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
      <div className="flex items-center gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-rz-peach text-rz-maroon">
          <ShieldCheck className="h-6 w-6" strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          {loading && !data ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          ) : error && !data ? (
            <CardError error={error} onRetry={reload} what="your membership" />
          ) : data?.isActive ? (
            <>
              <p className="flex flex-wrap items-center gap-2 font-serif text-base font-semibold text-rz-navy">
                {data.planName ?? "Membership"} <Badge tone="success">Active</Badge>
              </p>
              <p className="mt-1 text-sm text-rz-muted">
                {data.membership?.expiresAt ? `Valid until ${formatDate(data.membership.expiresAt)}` : "Active membership"}
              </p>
            </>
          ) : (
            <>
              <p className="font-serif text-base font-semibold text-rz-navy">No active membership</p>
              <p className="mt-1 text-sm text-rz-muted">A membership is needed to send interests and chat with matches.</p>
            </>
          )}
        </div>
      </div>
      {!(loading && !data) && !(error && !data) && (
        <ButtonLink href="/dashboard/membership" variant={data?.isActive ? "outline" : "primary"} size="sm" className="shrink-0">
          {data?.isActive ? "Manage" : "View plans"}
        </ButtonLink>
      )}
    </section>
  );
}

/* ----------------------------------------------------------- recommendations */

function CompactProfile({ item }: { item: RecommendationItem }) {
  const p = item.profile;
  const photo = photoSrc(primaryPhotoUrl(p.photos));
  const where = [p.city, p.country].filter(Boolean).join(", ");
  return (
    <Link
      href={`/dashboard/members/${p.id}`}
      className="rz-focus flex items-center gap-3 rounded-lg border border-rz-border bg-white p-3 transition-colors hover:border-rz-maroon/40"
    >
      <Avatar src={photo} alt="" size="lg" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-rz-navy">{p.displayName}</span>
        <span className="block truncate text-xs text-rz-muted">
          {p.age} yrs{where ? ` · ${where}` : ""}
        </span>
        {p.profession && <span className="block truncate text-xs text-rz-muted">{p.profession}</span>}
      </span>
      <MatchScore value={Math.round(item.compatibilityScore)} size={44} />
    </Link>
  );
}

export function RecommendationsPreview() {
  const { data, error, loading, reload } = useAsync(
    (signal) => api.get<RecommendationsPage>("/profiles/me/recommendations", { query: { pageSize: 4 }, signal }),
    []
  );

  let body: ReactNode;
  if (loading && !data) {
    body = (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  } else if (error && !data) {
    body =
      error.kind === "not_found" || error.kind === "forbidden" ? (
        <p className="rounded-lg border border-dashed border-rz-border bg-white p-5 text-sm text-rz-muted">
          Recommendations appear once your profile is created and ready.{" "}
          <Link href="/dashboard/profile" className="rz-focus font-semibold text-rz-maroon">
            Go to My Profile
          </Link>
        </p>
      ) : (
        <CardError error={error} onRetry={reload} what="recommendations" />
      );
  } else if (data?.status === "preferences_not_configured") {
    body = (
      <p className="rounded-lg border border-dashed border-rz-border bg-white p-5 text-sm text-rz-muted">
        Set your partner preferences to start receiving recommendations.{" "}
        <Link href="/dashboard/profile" className="rz-focus font-semibold text-rz-maroon">
          Set preferences
        </Link>
      </p>
    );
  } else if (data && data.items.length === 0) {
    body = (
      <p className="rounded-lg border border-dashed border-rz-border bg-white p-5 text-sm text-rz-muted">
        No recommendations match your preferences yet. Check back as new members join, or widen your preferences.
      </p>
    );
  } else if (data) {
    body = (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.items.slice(0, 4).map((item) => (
          <CompactProfile key={item.profile.id} item={item} />
        ))}
      </div>
    );
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-serif text-lg font-semibold text-rz-navy">
          Recommended for you
          {data && data.status === "ok" && data.total > 0 && (
            <span className="ml-2 text-sm font-normal text-rz-muted">({data.total} match{data.total === 1 ? "" : "es"})</span>
          )}
        </h3>
        <Link href="/dashboard/matches" className="rz-focus text-sm font-semibold text-rz-maroon">
          View all
        </Link>
      </div>
      {body}
    </section>
  );
}

/* ------------------------------------------------------------ recent activity */

export function RecentNotifications() {
  const { data, error, loading, reload } = useAsync(
    (signal) => api.get<Page<NotificationView>>("/notifications", { query: { pageSize: 5 }, signal }),
    []
  );
  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-serif text-lg font-semibold text-rz-navy">Recent notifications</h3>
        <Link href="/dashboard/notifications" className="rz-focus text-sm font-semibold text-rz-maroon">
          View all
        </Link>
      </div>
      {loading && !data ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : error && !data ? (
        <CardError error={error} onRetry={reload} what="notifications" />
      ) : data && data.items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-rz-border bg-white p-5 text-sm text-rz-muted">
          Nothing yet — interests, matches and account updates will appear here.
        </p>
      ) : data ? (
        <ul className="divide-y divide-rz-border overflow-hidden rounded-lg border border-rz-border bg-white">
          {data.items.map((n) => (
            <li key={n.id}>
              <Link
                href="/dashboard/notifications"
                className="rz-focus flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-rz-cream/60 sm:px-5"
              >
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rz-peach text-rz-maroon">
                  <Bell className="h-4 w-4" strokeWidth={1.8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${n.isRead ? "font-medium text-rz-text" : "font-semibold text-rz-navy"}`}>{n.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-rz-muted">{n.body}</span>
                </span>
                <span className="shrink-0 whitespace-nowrap pt-0.5 text-xs text-rz-muted">{timeAgo(n.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
