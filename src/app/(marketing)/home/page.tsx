import { redirect } from "next/navigation";

// The brief lists both `/` and `/home` — `/` is canonical, `/home` redirects
// so no link ever 404s regardless of which one was used.
export default function HomeAliasPage() {
  redirect("/");
}
