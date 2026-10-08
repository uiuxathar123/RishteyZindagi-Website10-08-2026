import type { Metadata } from "next";
import { ReportsClient } from "@/components/admin/ReportsClient";

export const metadata: Metadata = {
  title: "Reports",
  robots: { index: false, follow: false },
};

export default function AdminReportsPage() {
  return <ReportsClient />;
}
