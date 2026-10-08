import type { Metadata } from "next";
import { StaffClient } from "@/components/admin/StaffClient";

export const metadata: Metadata = {
  title: "Staff & Roles",
  robots: { index: false, follow: false },
};

export default function SuperAdminStaffPage() {
  return <StaffClient />;
}
