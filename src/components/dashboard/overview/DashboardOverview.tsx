"use client";

import { useSession } from "@/components/session/SessionProvider";
import { MembershipCard, ProfileCompletionCard, RecentNotifications, RecommendationsPreview, StatTiles, WarningsBanner } from "./widgets";

export function DashboardOverview() {
  const { user } = useSession();
  const first = user?.name?.trim().split(/\s+/)[0];
  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-serif text-2xl font-bold text-rz-navy">{first ? `Welcome back, ${first}` : "Welcome back"}</h2>
        <p className="mt-1 text-sm text-rz-muted">Here&apos;s a summary of your matrimonial profile and activity.</p>
      </div>
      <WarningsBanner />
      <ProfileCompletionCard />
      <StatTiles />
      <MembershipCard />
      <RecommendationsPreview />
      <RecentNotifications />
    </div>
  );
}
