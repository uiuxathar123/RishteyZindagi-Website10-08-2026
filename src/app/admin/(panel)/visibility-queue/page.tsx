import type { Metadata } from "next";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { VisibilityQueueClient } from "@/components/admin/VisibilityQueueClient";

export const metadata: Metadata = {
  title: "Visibility Queue",
  robots: { index: false, follow: false },
};

export default function AdminVisibilityQueuePage() {
  return (
    <PermissionGate needs={["profiles.approve"]} what="The visibility queue">
      <VisibilityQueueClient />
    </PermissionGate>
  );
}
