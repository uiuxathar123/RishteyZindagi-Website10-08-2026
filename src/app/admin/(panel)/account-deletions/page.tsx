import type { Metadata } from "next";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { AccountDeletionsClient } from "@/components/admin/AccountDeletionsClient";

export const metadata: Metadata = {
  title: "Account deletions",
  robots: { index: false, follow: false },
};

export default function AdminAccountDeletionsPage() {
  return (
    <PermissionGate needs={["users.view"]} what="Account deletions">
      <AccountDeletionsClient />
    </PermissionGate>
  );
}
