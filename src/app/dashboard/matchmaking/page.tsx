import type { Metadata } from "next";
import { MyMatchmakingClient } from "@/components/matchmaking/MyMatchmakingClient";

export const metadata: Metadata = {
  title: "Personal Matchmaking | Dashboard",
};

export default function DashboardMatchmakingPage() {
  return (
    <div>
      <h2 className="mb-1 font-serif text-2xl font-bold text-rz-navy">Personal Matchmaking</h2>
      <p className="mb-6 text-sm text-rz-muted">Your case, the profiles your matchmaking team has shared with you, and your privacy choice.</p>
      <MyMatchmakingClient />
    </div>
  );
}
