import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Container, Section } from "@/components/ui/Container";
import { CheckoutClient } from "@/components/membership/CheckoutClient";
import { getMemberSession } from "@/lib/api/server";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: true },
};

export const dynamic = "force-dynamic";

interface CheckoutPageProps {
  searchParams: { plan?: string };
}

export default async function CheckoutPage({ searchParams }: CheckoutPageProps) {
  const planCode = typeof searchParams.plan === "string" ? searchParams.plan.slice(0, 64) : "";

  // Checkout needs a signed-in member (the backend enforces this too).
  const user = await getMemberSession();
  if (!user) {
    const here = `/membership/checkout${planCode ? `?plan=${encodeURIComponent(planCode)}` : ""}`;
    redirect(`/login?next=${encodeURIComponent(here)}`);
  }

  return (
    <Section>
      <Container className="max-w-2xl">
        <Link
          href="/membership"
          className="rz-focus mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-rz-maroon"
        >
          ← Back to Membership Plans
        </Link>

        <div className="mb-6">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-rz-maroon">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Secure Checkout
          </p>
          <h1 className="font-serif text-3xl font-bold text-rz-navy">Complete your purchase</h1>
        </div>

        <CheckoutClient planCode={planCode} />
      </Container>
    </Section>
  );
}
