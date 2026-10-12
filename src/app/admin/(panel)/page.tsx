import type { Metadata } from "next";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { OverviewClient } from "@/components/admin/OverviewClient";

export const metadata: Metadata = {
  title: "Overview",
  robots: { index: false, follow: false },
};

export default function AdminOverviewPage() {
  return (
    <PermissionGate needs={["users.view"]} what="The overview">
      <OverviewClient />
    </PermissionGate>
  );
}
