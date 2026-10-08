"use client";

import { Badge } from "@/components/ui/Badge";
import Link from "next/link";
import { useAdminSession } from "./AdminSessionProvider";
import { Card, KeyValue, NotAvailable, PageHeader } from "./AdminUi";
import { PERMISSION_LABELS } from "./adminTypes";
import { MatchingWeightsPanel, OtpConfigPanel } from "./SettingsPanels";

/** `/admin/settings` — the signed-in admin's own access, plus configuration their role may change. */
export function SettingsClient() {
  const { admin, permissions, can, isSuper } = useAdminSession();

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Settings" description="Your admin account and the platform configuration your role can change." />

      <Card title="Your admin account">
        <div className="space-y-5 p-5">
          <KeyValue
            items={[
              ["Name", admin.name],
              ["Email", admin.email],
              ["Role", <Badge key="r" tone={isSuper ? "gold" : "navy"}>{admin.role === "SUPER_ADMIN" ? "Super Admin" : admin.role === "STAFF_ADMIN" ? "Staff Admin" : admin.role}</Badge>],
            ]}
          />
          <div>
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-rz-muted">What your role can do</p>
            {permissions.length === 0 ? (
              <p className="text-sm text-rz-muted">No permissions are granted to this role.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
                {permissions.map((p) => (
                  <li key={p} className="flex flex-col rounded-md bg-rz-cream px-3 py-2">
                    <span className="font-mono text-[12px] text-rz-navy">{p}</span>
                    <span className="text-[12.5px] text-rz-muted">{PERMISSION_LABELS[p] ?? "Granted by Super Admin"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      {can("platform.settings.manage") ? (
        <>
          <OtpConfigPanel />
          <MatchingWeightsPanel />
          {isSuper && (
            <p className="text-[13px] text-rz-muted">
              Payment gateways are managed under{" "}
              <Link href="/admin/super/settings" className="rz-focus font-semibold text-rz-maroon hover:underline">
                Platform Settings
              </Link>
              .
            </p>
          )}
        </>
      ) : (
        <NotAvailable title="Platform configuration needs another role">
          OTP delivery, matching weights and payment gateways need the platform.settings.manage permission, which only Super Admin holds by default.
        </NotAvailable>
      )}

      <NotAvailable title="Operational switches are not available yet">
        Maintenance mode, closing sign-ups, requiring manual profile approval, email digests and the public support contact details have no backend storage, so they are not shown here rather than pretending to save.
      </NotAvailable>
    </div>
  );
}
