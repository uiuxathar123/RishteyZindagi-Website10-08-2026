import type { Metadata } from "next";
import { InterestsView } from "@/components/dashboard/InterestsView";

export const metadata: Metadata = {
  title: "Interests | Dashboard",
};

export default function DashboardInterestsPage() {
  return (
    <div>
      <h2 className="mb-1 font-serif text-2xl font-bold text-rz-navy">Interests</h2>
      <p className="mb-6 text-sm text-rz-muted">
        Manage interests you&apos;ve received and track the ones you&apos;ve sent. Interests need an active membership to send; you can always reply to ones you receive.
      </p>
      <InterestsView />
    </div>
  );
}
