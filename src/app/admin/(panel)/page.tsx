import type { Metadata } from "next";
import { OverviewClient } from "@/components/admin/OverviewClient";

export const metadata: Metadata = {
  title: "Overview",
  robots: { index: false, follow: false },
};

export default function AdminOverviewPage() {
  return <OverviewClient />;
}
