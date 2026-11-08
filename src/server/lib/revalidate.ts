/**
 * Refreshes cached public pages after an admin changes their content (Blog Manager, Success Stories).
 * Those pages are cached for 60 seconds (`export const revalidate = 60`) so they are served from cache under load;
 * this makes an admin's change visible right away on the instance that handled the change, and every other
 * instance picks it up within the 60-second window at the latest.
 * Outside a Next.js request (tests, CLI scripts) there is no page cache to refresh, so nothing happens.
 */
import { revalidatePath } from "next/cache";

export function refreshPublicPages(...targets: Array<{ path: string; type?: "page" | "layout" }>): void {
  for (const t of targets) {
    try {
      revalidatePath(t.path, t.type);
    } catch {
      /* not inside a Next.js request: nothing cached */
    }
  }
}
