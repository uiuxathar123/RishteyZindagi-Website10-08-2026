import type { Metadata } from "next";
import { SuperOverviewClient } from "@/components/admin/SuperOverviewClient";

export const metadata: Metadata = {
  title: "Super Overview",
  robots: { index: false, follow: false },
};

export default function SuperAdminOverviewPage() {
  return <SuperOverviewClient />;
}
