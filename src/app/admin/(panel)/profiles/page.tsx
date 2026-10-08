import type { Metadata } from "next";
import { ProfileApprovalsClient } from "@/components/admin/ProfileApprovalsClient";

export const metadata: Metadata = {
  title: "Profile Approvals",
  robots: { index: false, follow: false },
};

export default function AdminProfileApprovalsPage() {
  return <ProfileApprovalsClient />;
}
