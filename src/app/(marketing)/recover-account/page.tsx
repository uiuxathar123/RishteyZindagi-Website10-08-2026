import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { RecoverAccountFlow } from "@/components/auth/RecoverAccountFlow";

export const metadata: Metadata = {
  title: "Recover Your Account",
  description: "Restore an account you asked to delete, within the recovery period.",
  robots: { index: false, follow: true },
};

export default function RecoverAccountPage() {
  return (
    <Container className="flex min-h-[70vh] items-center justify-center py-16">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-3xl font-bold text-rz-navy">Recover your account</h1>
          <p className="mt-2 text-sm text-rz-muted">
            Changed your mind about deleting your account? Confirm your email and password, then enter the code we send. This only works during the recovery period after you asked for deletion.
          </p>
        </div>
        <div className="rounded-xl border border-rz-border bg-white p-6 shadow-card-sm md:p-8">
          <RecoverAccountFlow />
        </div>
        <p className="mt-6 text-center text-sm text-rz-muted">
          <Link href="/login" className="rz-focus font-semibold text-rz-maroon">
            Back to log in
          </Link>
        </p>
      </div>
    </Container>
  );
}
