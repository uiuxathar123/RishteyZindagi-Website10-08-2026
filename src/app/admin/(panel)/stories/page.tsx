import type { Metadata } from "next";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { StoriesClient } from "@/components/admin/StoriesClient";

export const metadata: Metadata = { title: "Success Stories", robots: { index: false, follow: false } };

export default function AdminStoriesPage() {
  return (
    <PermissionGate needs={["content.manage"]} what="Success stories">
      <StoriesClient />
    </PermissionGate>
  );
}
