import type { Metadata } from "next";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { CommunitiesClient } from "@/components/admin/CommunitiesClient";

export const metadata: Metadata = {
  title: "Communities",
  robots: { index: false, follow: false },
};

export default function SuperAdminCommunitiesPage() {
  return (
    <PermissionGate needs={["communities.manage"]} what="Communities">
      <CommunitiesClient />
    </PermissionGate>
  );
}
