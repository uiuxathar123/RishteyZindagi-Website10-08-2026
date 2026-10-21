import type { Metadata } from "next";
import { Suspense } from "react";
import { Container } from "@/components/ui/Container";
import { SignupFlow } from "@/components/auth/SignupFlow";
import { Skeleton } from "@/components/ui/States";

export const metadata: Metadata = {
  title: "Create Your Free Profile",
  description: "Create your free RishteyZindagi profile in a few minutes.",
  alternates: { canonical: "/signup" },
};

export default function SignupPage() {
  return (
    <Container className="py-12 md:py-16">
      <div className="mb-10 text-center">
        <h1 className="font-serif text-3xl font-bold text-rz-navy md:text-4xl">Create Your Free Profile</h1>
        <p className="mt-2 text-sm text-rz-muted">
          Verify your contact, set a password, and start your profile — it only takes a few minutes.
        </p>
      </div>
      {/* SignupFlow reads ?next= on the client so this page stays static. */}
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
        <SignupFlow />
      </Suspense>
    </Container>
  );
}
