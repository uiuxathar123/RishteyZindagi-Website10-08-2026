import type { Metadata } from "next";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { ReportsClient } from "@/components/admin/ReportsClient";

export const metadata: Metadata = {
  title: "Reports",
  robots: { index: false, follow: false },
};

export default function AdminReportsPage() {
  return (
    <PermissionGate needs={["reports.resolve"]} what="Reports">
      <ReportsClient />
    </PermissionGate>
  );
}
