/**
 * B19: site-wide maintenance gate, applied once by `withErrorHandling` to every `/api/v1` route.
 *
 * While the Super Admin has maintenance mode ON, every member-facing endpoint answers 503 (code SERVICE_UNAVAILABLE,
 * `details.maintenance = true`, the configured message). These stay reachable so the site can be brought back and
 * so money/ops traffic is never dropped:
 *   - /api/v1/admin/**      Super Admin / Staff Admin (they must be able to switch maintenance off)
 *   - /api/v1/webhooks/**   payment-provider callbacks (dropping one could lose a paid order)
 *   - /api/v1/internal/**   scheduled jobs
 *   - /api/v1/health, /api/v1/site-status
 * The setting is read on every request (no cache), so turning it on or off takes effect on the next request.
 * A missing/unreadable setting means "not in maintenance".
 */
import { ServiceUnavailableError } from "@/server/lib/errors";
import { MAINTENANCE_DEFAULT_MESSAGE, getMaintenance } from "@/server/modules/platform-settings/platform-settings.service";

const EXEMPT_PREFIXES = ["/api/v1/admin", "/api/v1/webhooks", "/api/v1/internal", "/api/v1/health", "/api/v1/site-status"];

export function isMaintenanceExempt(pathname: string): boolean {
  return EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function enforceMaintenance(req: Request): Promise<void> {
  const pathname = new URL(req.url).pathname;
  if (isMaintenanceExempt(pathname)) return;
  let m;
  try {
    m = await getMaintenance();
  } catch {
    return; // never turn a settings-read hiccup into an outage
  }
  if (m.enabled) throw new ServiceUnavailableError(m.message || MAINTENANCE_DEFAULT_MESSAGE, { maintenance: true });
}
