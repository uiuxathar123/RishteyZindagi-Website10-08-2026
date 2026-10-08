import type { Metadata } from "next";
import { AuditLogClient } from "@/components/admin/AuditLogClient";

export const metadata: Metadata = {
  title: "Audit Log",
  robots: { index: false, follow: false },
};

export default function SuperAdminAuditLogPage() {
  return <AuditLogClient />;
}
