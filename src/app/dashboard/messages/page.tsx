import type { Metadata } from "next";
import { Suspense } from "react";
import { MessagesView } from "@/components/dashboard/MessagesView";

export const metadata: Metadata = {
  title: "Messages | Dashboard",
};

export default function DashboardMessagesPage() {
  return (
    <div>
      <h2 className="mb-1 font-serif text-2xl font-bold text-rz-navy">Messages</h2>
      <p className="mb-6 text-sm text-rz-muted">Conversations with members you&apos;re a mutual match with. Sending messages needs an active membership.</p>
      <Suspense fallback={<div className="h-[420px] animate-pulse rounded-lg bg-rz-border/40" role="status" aria-label="Loading" />}>
        <MessagesView />
      </Suspense>
    </div>
  );
}
