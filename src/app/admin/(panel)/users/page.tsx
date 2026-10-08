import type { Metadata } from "next";
import { UsersClient } from "@/components/admin/UsersClient";

export const metadata: Metadata = {
  title: "Users",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AdminUsersPage({ searchParams }: { searchParams: { user?: string } }) {
  // `?user=<id>` (linked from reports / overview) opens that member's detail directly.
  const initialUserId = searchParams.user && UUID.test(searchParams.user) ? searchParams.user : undefined;
  return <UsersClient initialUserId={initialUserId} />;
}
