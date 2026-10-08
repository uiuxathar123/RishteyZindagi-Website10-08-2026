import type { Metadata } from "next";
import { SettingsClient } from "@/components/admin/SettingsClient";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

export default function AdminSettingsPage() {
  return <SettingsClient />;
}
