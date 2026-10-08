import type { Metadata } from "next";
import { SettingsView } from "@/components/dashboard/SettingsView";

export const metadata: Metadata = {
  title: "Settings | Dashboard",
};

export default function DashboardSettingsPage() {
  return (
    <div>
      <h2 className="mb-1 font-serif text-2xl font-bold text-rz-navy">Settings</h2>
      <p className="mb-6 text-sm text-rz-muted">Your account, security and safety.</p>
      <SettingsView />
    </div>
  );
}
