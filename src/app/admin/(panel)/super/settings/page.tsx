import type { Metadata } from "next";
import { PlatformSettingsClient } from "@/components/admin/PlatformSettingsClient";

export const metadata: Metadata = {
  title: "Platform Settings",
  robots: { index: false, follow: false },
};

export default function SuperAdminSettingsPage() {
  return <PlatformSettingsClient />;
}
