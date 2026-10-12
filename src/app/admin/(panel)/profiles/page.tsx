import type { Metadata } from "next";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { ProfileApprovalsClient } from "@/components/admin/ProfileApprovalsClient";

export const metadata: Metadata = {
  title: "Profile Approvals",
  robots: { index: false, follow: false },
};

export default function AdminProfileApprovalsPage() {
  return (
    <PermissionGate needs={["users.view", "profiles.verify"]} what="Profile approvals">
      <ProfileApprovalsClient />
    </PermissionGate>
  );
}
