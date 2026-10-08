import type { Metadata } from "next";
import { NotificationsList } from "@/components/dashboard/NotificationsList";

export const metadata: Metadata = {
  title: "Notifications | Dashboard",
};

export default function DashboardNotificationsPage() {
  return (
    <div>
      <h2 className="mb-1 font-serif text-2xl font-bold text-rz-navy">Notifications</h2>
      <p className="mb-6 text-sm text-rz-muted">Updates about your account, interests and matches.</p>
      <NotificationsList />
    </div>
  );
}
