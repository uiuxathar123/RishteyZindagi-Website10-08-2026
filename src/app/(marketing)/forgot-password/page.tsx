import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { ResetPasswordFlow } from "@/components/auth/ResetPasswordFlow";

export const metadata: Metadata = {
  title: "Reset Your Password",
  description: "Reset your RishteyZindagi password with a one-time verification code.",
  alternates: { canonical: "/forgot-password" },
};

export default function ForgotPasswordPage() {
  return (
    <Container className="flex min-h-[70vh] items-center justify-center py-16">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-3xl font-bold text-rz-navy">Reset your password</h1>
          <p className="mt-2 text-sm text-rz-muted">
            We&apos;ll email you a one-time code. Resetting signs you out of every device.
          </p>
        </div>
        <div className="rounded-xl border border-rz-border bg-white p-6 shadow-card-sm md:p-8">
          <ResetPasswordFlow />
        </div>
        <p className="mt-6 text-center text-sm text-rz-muted">
          Remembered it?{" "}
          <Link href="/login" className="rz-focus font-semibold text-rz-maroon">
            Back to log in
          </Link>
        </p>
      </div>
    </Container>
  );
}
