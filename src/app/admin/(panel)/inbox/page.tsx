import type { Metadata } from "next";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { SupportInboxClient } from "@/components/admin/SupportInboxClient";

export const metadata: Metadata = { title: "Support Inbox", robots: { index: false, follow: false } };

export default function AdminInboxPage() {
  return (
    <PermissionGate needs={["support.manage"]} what="The support inbox">
      <SupportInboxClient />
    </PermissionGate>
  );
}
