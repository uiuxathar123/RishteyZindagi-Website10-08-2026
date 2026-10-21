import { Suspense } from "react";
import type { Metadata } from "next";
import { MatchmakingAdminClient } from "@/components/admin/MatchmakingAdminClient";
import { ListSkeleton } from "@/components/ui/AsyncView";

export const metadata: Metadata = {
  title: "Personal Matchmaking",
  robots: { index: false, follow: false },
};

// Super Admin only: the /admin/super layout refuses other roles, and every API behind this page checks the role.
// The tabs read the URL (?tab=…), hence the Suspense boundary.
export default function SuperAdminMatchmakingPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <MatchmakingAdminClient />
    </Suspense>
  );
}
