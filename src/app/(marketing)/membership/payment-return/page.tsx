import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Container, Section } from "@/components/ui/Container";
import { PaymentReturnClient } from "@/components/membership/PaymentReturnClient";
import { getMemberSession } from "@/lib/api/server";

export const metadata: Metadata = {
  title: "Payment status",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where PhonePe (and any redirect-style gateway) sends the member back. The URL is NOT trusted:
 * the page asks our server to verify the payment with the gateway and shows only that answer. */
export default async function PaymentReturnPage({ searchParams }: { searchParams: { paymentId?: string } }) {
  const paymentId = typeof searchParams.paymentId === "string" && UUID.test(searchParams.paymentId) ? searchParams.paymentId : "";
  const user = await getMemberSession();
  if (!user) {
    const here = `/membership/payment-return${paymentId ? `?paymentId=${paymentId}` : ""}`;
    redirect(`/login?next=${encodeURIComponent(here)}`);
  }
  return (
    <Section>
      <Container className="max-w-2xl">
        <Link href="/dashboard/membership" className="rz-focus mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-rz-maroon">
          ← My membership
        </Link>
        <PaymentReturnClient paymentId={paymentId} />
      </Container>
    </Section>
  );
}
