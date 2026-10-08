import type { Metadata } from "next";
import { ShortlistGrid } from "@/components/dashboard/ShortlistGrid";

export const metadata: Metadata = {
  title: "Shortlist | Dashboard",
};

export default function DashboardShortlistPage() {
  return (
    <div>
      <h2 className="mb-1 font-serif text-2xl font-bold text-rz-navy">Shortlist</h2>
      <p className="mb-6 text-sm text-rz-muted">Profiles you&apos;ve saved for a closer look, all in one place.</p>
      <ShortlistGrid />
    </div>
  );
}
