import type { Metadata } from "next";
import { MatchesView } from "@/components/dashboard/member/MatchesView";

export const metadata: Metadata = {
  title: "Matches | Dashboard",
};

export default function DashboardMatchesPage() {
  return (
    <div>
      <h2 className="mb-1 font-serif text-2xl font-bold text-rz-navy">Your Matches</h2>
      <p className="mb-6 text-sm text-rz-muted">
        Profiles recommended for you from your partner preferences, plus the members you&apos;ve matched with.
      </p>
      <MatchesView />
    </div>
  );
}
