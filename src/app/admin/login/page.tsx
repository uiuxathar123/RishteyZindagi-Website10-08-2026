import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminLoginForm } from "@/components/admin/AdminLoginForm";
import { Logo } from "@/components/layout/Header";
import { getAdminSession } from "@/lib/api/server";

export const metadata: Metadata = {
  title: "Admin Login",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  // Already signed in as an admin: go straight to the panel.
  if (await getAdminSession()) redirect("/admin");

  return (
    <main className="flex min-h-screen items-center justify-center bg-rz-cream px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-lg border border-rz-border bg-white p-6 shadow-card-sm md:p-8">
          <h1 className="font-serif text-2xl font-bold text-rz-navy">Admin sign in</h1>
          <p className="mt-1 text-sm text-rz-muted">Staff and Super Admin accounts only. Member accounts cannot sign in here.</p>
          <AdminLoginForm />
        </div>
      </div>
    </main>
  );
}
