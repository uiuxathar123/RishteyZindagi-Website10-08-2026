import type { Metadata } from "next";
import { MembershipDashboard } from "@/components/dashboard/membership/MembershipDashboard";

export const metadata: Metadata = {
  title: "Membership | Dashboard",
};

export default function DashboardMembershipPage() {
  return (
    <div>
      <h2 className="mb-1 font-serif text-2xl font-bold text-rz-navy">Membership</h2>
      <p className="mb-6 text-sm text-rz-muted">
        Your plan, payments and invoices. Renew or upgrade any time for more visibility and features.
      </p>
      <MembershipDashboard />
    </div>
  );
}
