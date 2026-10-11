import type { Metadata } from "next";
import { GroupsView } from "@/components/dashboard/GroupsView";

export const metadata: Metadata = { title: "Groups | Dashboard" };

export default function DashboardGroupsPage() {
  return (
    <div>
      <h2 className="mb-1 font-serif text-2xl font-bold text-rz-navy">Groups</h2>
      <p className="mb-6 text-sm text-rz-muted">Community circles run by our team. Join one to read and share with other members.</p>
      <GroupsView />
    </div>
  );
}
