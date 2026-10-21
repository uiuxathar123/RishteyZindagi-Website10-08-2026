import type { Metadata } from "next";
import { MatchmakingCaseClient } from "@/components/admin/MatchmakingCaseClient";

export const metadata: Metadata = {
  title: "Personal Matchmaking case",
  robots: { index: false, follow: false },
};

export default function SuperAdminMatchmakingCasePage({ params }: { params: { caseId: string } }) {
  return <MatchmakingCaseClient caseId={params.caseId} />;
}
