import type { Metadata } from "next";
import { GroupsClient } from "@/components/admin/GroupsClient";
import { PermissionGate } from "@/components/admin/PermissionGate";

export const metadata: Metadata = { title: "Community Groups", robots: { index: false, follow: false } };

export default function AdminGroupsPage() {
  return (
    <PermissionGate needs={["groups.manage"]} what="Community groups">
      <GroupsClient />
    </PermissionGate>
  );
}
