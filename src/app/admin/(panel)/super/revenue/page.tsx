import type { Metadata } from "next";
import { RevenueClient } from "@/components/admin/RevenueClient";

export const metadata: Metadata = {
  title: "Revenue",
  robots: { index: false, follow: false },
};

export default function SuperAdminRevenuePage() {
  return <RevenueClient />;
}
