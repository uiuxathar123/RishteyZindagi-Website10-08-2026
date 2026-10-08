"use client";

import { Badge } from "@/components/ui/Badge";
import { UserCog } from "lucide-react";
import { useAdminSession } from "./AdminSessionProvider";
import { Card, KeyValue, NotAvailable, PageHeader } from "./AdminUi";
import { PERMISSION_LABELS } from "./adminTypes";

/**
 * `/admin/super/staff` — the platform has NO staff-management API (no list,
 * invite, role-change or disable endpoint), so this page does not pretend to
 * manage anyone. It explains how accounts exist today and shows the one
 * thing the API does expose: the signed-in admin's own role and permissions.
 */
export function StaffClient() {
  const { admin, permissions } = useAdminSession();

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Staff & Roles"
        icon={<UserCog className="h-5 w-5 text-rz-gold-rich" strokeWidth={1.8} />}
        description="Staff management is not available yet."
      />

      <NotAvailable title="Staff management is not available yet">
        There is no API to list, invite, change the role of, or disable staff accounts, so this screen offers none of those actions. Admin accounts are created outside the product:
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            The development Super Admin is created by the seed script (<code className="font-mono text-[12px]">npm run db:seed</code> with <code className="font-mono text-[12px]">SEED_DEV_SUPER_ADMIN=true</code>; see <code className="font-mono text-[12px]">src/server/db/seed.ts</code>).
          </li>
          <li>
            A Staff Admin is a row in <code className="font-mono text-[12px]">admin_users</code> whose role is <code className="font-mono text-[12px]">STAFF_ADMIN</code> and whose password is stored with the project’s own <code className="font-mono text-[12px]">hashPassword()</code> helper (<code className="font-mono text-[12px]">src/server/lib/password.ts</code>), inserted by a one-off script run by an engineer.
          </li>
          <li>Role changes and disabling an account are likewise done directly in the database for now.</li>
        </ul>
      </NotAvailable>

      <Card title="Your role" description="The only role information the API exposes is for the account you are signed in with.">
        <div className="space-y-5 p-5">
          <KeyValue
            items={[
              ["Name", admin.name],
              ["Email", admin.email],
              ["Role", <Badge key="r" tone="gold">{admin.role === "SUPER_ADMIN" ? "Super Admin" : admin.role}</Badge>],
            ]}
          />
          <div>
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-rz-muted">Permissions held by this role (read-only)</p>
            <ul className="grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
              {permissions.map((p) => (
                <li key={p} className="flex flex-col rounded-md bg-rz-cream px-3 py-2">
                  <span className="font-mono text-[12px] text-rz-navy">{p}</span>
                  <span className="text-[12.5px] text-rz-muted">{PERMISSION_LABELS[p] ?? "Granted by Super Admin"}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      <NotAvailable title="Role to permission matrix">
        There is no endpoint that lists roles or what each role may do, so a full matrix cannot be drawn. The server defaults are: Super Admin holds every permission; Staff Admin holds <code className="font-mono text-[12px]">admin.ping</code>, <code className="font-mono text-[12px]">users.view</code>, <code className="font-mono text-[12px]">profiles.verify</code> and <code className="font-mono text-[12px]">reports.resolve</code>.
      </NotAvailable>
    </div>
  );
}
