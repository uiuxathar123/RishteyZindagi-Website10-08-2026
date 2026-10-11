import type { Metadata } from "next";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { SecurityEventsClient } from "@/components/admin/SecurityEventsClient";

export const metadata: Metadata = {
  title: "Security Events",
  robots: { index: false, follow: false },
};

export default function SuperAdminSecurityEventsPage() {
  return (
    <PermissionGate needs={["audit.view"]} what="Security events">
      <SecurityEventsClient />
    </PermissionGate>
  );
}
