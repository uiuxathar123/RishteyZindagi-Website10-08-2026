import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Container } from "@/components/ui/Container";
import { LoginForm } from "@/components/auth/LoginForm";
import { Skeleton } from "@/components/ui/States";

export const metadata: Metadata = {
  title: "Log In",
  description: "Log in to your RishteyZindagi account.",
  alternates: { canonical: "/login" },
};

export default function LoginPage() {
  return (
    <Container className="flex min-h-[70vh] items-center justify-center py-16">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-3xl font-bold text-rz-navy">Welcome back</h1>
          <p className="mt-2 text-sm text-rz-muted">Log in to continue your search.</p>
        </div>
        {/* LoginForm reads ?next= / ?expired= on the client so this page stays static. */}
        <Suspense fallback={<Skeleton className="h-80 w-full rounded-xl" />}>
          <LoginForm />
        </Suspense>
        <p className="mt-6 text-center text-xs text-rz-muted">
          Asked to delete your account?{" "}
          <Link href="/recover-account" className="rz-focus font-semibold text-rz-maroon">
            Recover it
          </Link>
        </p>
      </div>
    </Container>
  );
}
