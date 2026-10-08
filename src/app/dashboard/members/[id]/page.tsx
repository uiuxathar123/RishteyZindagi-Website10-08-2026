import type { Metadata } from "next";
import { MemberProfileView } from "@/components/dashboard/member/MemberProfileView";

export const metadata: Metadata = {
  title: "Member profile | Dashboard",
};

export default function MemberProfilePage({ params }: { params: { id: string } }) {
  return <MemberProfileView profileId={params.id} />;
}
