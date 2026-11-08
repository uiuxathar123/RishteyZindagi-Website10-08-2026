import type { Metadata } from "next";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { BlogClient } from "@/components/admin/BlogClient";

export const metadata: Metadata = { title: "Blog", robots: { index: false, follow: false } };

export default function AdminBlogPage() {
  return (
    <PermissionGate needs={["blog.manage"]} what="Blog">
      <BlogClient />
    </PermissionGate>
  );
}
