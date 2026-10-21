import { redirect } from "next/navigation";

// Kept so older links still work: this screen is now a tab of the Personal Matchmaking page.
export default function Page() {
  redirect("/admin/super/matchmaking?tab=introductions");
}
