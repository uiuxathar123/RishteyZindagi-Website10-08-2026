import type { Metadata } from "next";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { PlansClient } from "@/components/admin/PlansClient";

export const metadata: Metadata = {
  title: "Membership Plans",
  robots: { index: false, follow: false },
};

export default function SuperAdminPlansPage() {
  return (
    <PermissionGate needs={["plans.manage"]} what="Membership plans">
      <PlansClient />
    </PermissionGate>
  );
}
