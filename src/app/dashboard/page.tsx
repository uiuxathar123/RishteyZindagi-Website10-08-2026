import type { Metadata } from "next";
import { DashboardOverview } from "@/components/dashboard/overview/DashboardOverview";

export const metadata: Metadata = {
  title: "Overview | Dashboard",
};

export default function DashboardOverviewPage() {
  return <DashboardOverview />;
}
