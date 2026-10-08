import type { Metadata } from "next";
import { ProfileEditor } from "@/components/dashboard/ProfileEditor";

export const metadata: Metadata = {
  title: "My Profile | Dashboard",
};

export default function DashboardProfilePage() {
  return (
    <div>
      <h2 className="mb-1 font-serif text-2xl font-bold text-rz-navy">My Profile</h2>
      <p className="mb-6 text-sm text-rz-muted">
        Keep your details and partner preferences up to date to get better matches.
      </p>
      <ProfileEditor />
    </div>
  );
}
