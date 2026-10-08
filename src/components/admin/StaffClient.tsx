"use client";

/**
 * `/admin/super/staff` — real staff management over /admin/staff and /admin/roles.
 *
 *  - Every list / state shown comes from the API; a change is displayed only after the API accepted it.
 *  - A temporary password is returned by the server exactly once (create / reset). It is held in
 *    component state only while the one-time dialog is open, never written to storage or the URL,
 *    and the staff member is forced to choose their own password at first sign-in.
 *  - Super Admin accounts cannot be edited here (the server enforces this too).
 */
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Select, Textarea } from "@/components/ui/Input";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import type { AdminRoleView, RolesResponse, StaffMember, StaffPage } from "@/lib/api/pcp-types";
import { timeAgo } from "@/lib/format";
import { Copy, KeyRound, Plus, ShieldCheck, UserCog } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAdminSession } from "./AdminSessionProvider";
import { ActionError, Card, fieldIssue, Modal, NotAvailable, PageHeader, Pagination, SuccessNote, td, th } from "./AdminUi";

const PAGE_SIZE = 20;
const roleLabel = (r: string) => (r === "SUPER_ADMIN" ? "Super Admin" : r === "STAFF_ADMIN" ? "Staff Admin" : r.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()));

export function StaffClient() {
  const { can, isSuper } = useAdminSession();
  if (!can("staff.manage") && !isSuper) {
    return (
      <div className="max-w-3xl space-y-6">
        <PageHeader title="Staff & Roles" icon={<UserCog className="h-5 w-5 text-rz-gold-rich" strokeWidth={1.8} />} description="Manage admin accounts and their roles." />
        <NotAvailable title="Your role cannot manage staff">The “staff.manage” permission is required.</NotAvailable>
      </div>
    );
  }
  return <StaffManager />;
}

function StaffManager() {
  const { admin } = useAdminSession();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ title: string; email: string; password: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => setPage(1), [status]);

  const roles = useAsync((signal) => adminApi.get<RolesResponse>("/roles", { signal }), []);
  const list = useAsync(
    (signal) => adminApi.get<StaffPage>("/staff", { query: { status: status || undefined, page, pageSize: PAGE_SIZE }, signal }),
    [status, page]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff & Roles"
        icon={<UserCog className="h-5 w-5 text-rz-gold-rich" strokeWidth={1.8} />}
        description="Create admin accounts, change roles, suspend or restore access and reset passwords. Every action is written to the audit log."
        actions={
          <Button type="button" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)} disabled={!roles.data}>
            Add staff member
          </Button>
        }
      />

      <div className="max-w-xs">
        <FieldLabel htmlFor="staff-status">Status</FieldLabel>
        <Select id="staff-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
        </Select>
      </div>

      {note && <SuccessNote>{note}</SuccessNote>}

      <AsyncView
        data={list.data}
        error={list.error}
        loading={list.loading}
        reload={list.reload}
        skeleton={<ListSkeleton rows={4} />}
        isEmpty={(d) => d.items.length === 0}
        empty={{ title: "No staff accounts", description: "Add the first staff member." }}
      >
        {(data) => (
          <div className="overflow-hidden rounded-lg border border-rz-border bg-white shadow-card-sm">
            <div className="relative overflow-x-auto" aria-busy={list.loading}>
              <table className="w-full min-w-[780px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-rz-border bg-rz-cream text-left">
                    <th className={th}>Name</th>
                    <th className={th}>Role</th>
                    <th className={th}>Status</th>
                    <th className={th}>Last active</th>
                    <th className={th}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((s) => (
                    <StaffRow
                      key={s.id}
                      staff={s}
                      self={s.email.toLowerCase() === admin.email.toLowerCase()}
                      roles={roles.data?.roles ?? []}
                      onChanged={(msg) => {
                        setNote(msg);
                        list.reload();
                      }}
                      onSecret={(password) => setSecret({ title: "Password reset", email: s.email, password })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={setPage} disabled={list.loading} />
          </div>
        )}
      </AsyncView>

      <RolesEditor roles={roles} />

      {creating && roles.data && (
        <CreateStaffModal
          roles={roles.data.roles}
          onClose={() => setCreating(false)}
          onCreated={(email, password) => {
            setCreating(false);
            setNote(`Staff account created for ${email}.`);
            setSecret({ title: "Staff account created", email, password });
            list.reload();
            roles.reload();
          }}
        />
      )}
      {secret && <TemporaryPasswordModal {...secret} onClose={() => setSecret(null)} />}
    </div>
  );
}

function StaffRow({
  staff,
  self,
  roles,
  onChanged,
  onSecret,
}: {
  staff: StaffMember;
  self: boolean;
  roles: AdminRoleView[];
  onChanged: (msg: string) => void;
  onSecret: (password: string) => void;
}) {
  const locked = staff.role === "SUPER_ADMIN" || self;
  const update = useAction((body: Record<string, string>) => adminApi.patch<{ staff: StaffMember }>(`/staff/${staff.id}`, body));
  const reset = useAction(() => adminApi.post<{ staff: StaffMember; temporaryPassword: string }>(`/staff/${staff.id}/reset-password`));
  const assignable = roles.filter((r) => r.name !== "SUPER_ADMIN");

  async function changeRole(roleName: string) {
    if (roleName === staff.role) return;
    if (await update.run({ roleName })) onChanged(`${staff.name} is now ${roleLabel(roleName)}.`);
  }
  async function toggle() {
    const next = staff.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    if (await update.run({ status: next })) onChanged(`${staff.name} ${next === "ACTIVE" ? "can sign in again" : "has been suspended"}.`);
  }
  async function resetPw() {
    const res = await reset.run();
    if (res) {
      onChanged(`Password reset for ${staff.name}.`);
      onSecret(res.temporaryPassword);
    }
  }

  return (
    <tr className="border-b border-rz-border last:border-0">
      <td className={td}>
        <div className="font-medium text-rz-text">{staff.name}</div>
        <div className="text-[12.5px] text-rz-muted">{staff.email}</div>
        {staff.mustChangePassword && <div className="mt-1 text-[12px] text-rz-warning">Must set a new password at next sign-in</div>}
      </td>
      <td className={td}>
        {locked ? (
          <Badge tone={staff.role === "SUPER_ADMIN" ? "gold" : "navy"}>{roleLabel(staff.role)}</Badge>
        ) : (
          <Select aria-label={`Role for ${staff.name}`} value={staff.role} disabled={update.pending} onChange={(e) => changeRole(e.target.value)}>
            {!assignable.some((r) => r.name === staff.role) && <option value={staff.role}>{roleLabel(staff.role)}</option>}
            {assignable.map((r) => (
              <option key={r.id} value={r.name}>
                {roleLabel(r.name)}
              </option>
            ))}
          </Select>
        )}
      </td>
      <td className={td}>
        <Badge tone={staff.status === "ACTIVE" ? "success" : "maroon"}>{staff.status === "ACTIVE" ? "Active" : "Suspended"}</Badge>
      </td>
      <td className={`${td} text-rz-muted`}>{staff.lastActiveAt ? timeAgo(staff.lastActiveAt) : "Never"}</td>
      <td className={td}>
        {locked ? (
          <span className="text-[12.5px] text-rz-muted">{self ? "This is you" : "Protected"}</span>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" size="sm" variant="outline" disabled={update.pending} onClick={toggle}>
              {staff.status === "ACTIVE" ? "Suspend" : "Restore"}
            </Button>
            <Button type="button" size="sm" variant="ghost" icon={<KeyRound className="h-4 w-4" />} disabled={reset.pending} onClick={resetPw}>
              {reset.pending ? "Resetting…" : "Reset password"}
            </Button>
          </div>
        )}
        <ActionError error={update.error ?? reset.error} className="mt-2" />
      </td>
    </tr>
  );
}

function CreateStaffModal({ roles, onClose, onCreated }: { roles: AdminRoleView[]; onClose: () => void; onCreated: (email: string, password: string) => void }) {
  const assignable = useMemo(() => roles.filter((r) => r.name !== "SUPER_ADMIN"), [roles]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roleName, setRoleName] = useState(assignable[0]?.name ?? "");
  const create = useAction((body: { name: string; email: string; roleName: string }) =>
    adminApi.post<{ staff: StaffMember; temporaryPassword: string }>("/staff", body)
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await create.run({ name, email, roleName });
    if (res) onCreated(res.staff.email, res.temporaryPassword);
  }

  return (
    <Modal title="Add staff member" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <FieldLabel htmlFor="staff-name">Full name</FieldLabel>
          <Input id="staff-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} aria-invalid={!!fieldIssue(create.error, "name")} />
          {fieldIssue(create.error, "name") && <p className="mt-1 text-[12.5px] text-rz-danger">{fieldIssue(create.error, "name")}</p>}
        </div>
        <div>
          <FieldLabel htmlFor="staff-email">Email</FieldLabel>
          <Input id="staff-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" aria-invalid={!!fieldIssue(create.error, "email")} />
          {fieldIssue(create.error, "email") && <p className="mt-1 text-[12.5px] text-rz-danger">{fieldIssue(create.error, "email")}</p>}
        </div>
        <div>
          <FieldLabel htmlFor="staff-role">Role</FieldLabel>
          <Select id="staff-role" value={roleName} onChange={(e) => setRoleName(e.target.value)} required>
            {assignable.map((r) => (
              <option key={r.id} value={r.name}>
                {roleLabel(r.name)} — {r.permissions.length} permission{r.permissions.length === 1 ? "" : "s"}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-[12px] text-rz-muted">You can only assign a role whose permissions you already hold.</p>
        </div>
        <ActionError error={create.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.pending || !name.trim() || !email.trim() || !roleName}>
            {create.pending ? "Creating…" : "Create account"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function TemporaryPasswordModal({ title, email, password, onClose }: { title: string; email: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose} footer={<Button type="button" onClick={onClose}>I have saved it</Button>}>
      <div className="space-y-3 text-sm">
        <p>
          Temporary password for <strong>{email}</strong>. It is shown <strong>only once</strong> — share it through a secure channel. They will be required to choose their own password at first sign-in.
        </p>
        <div className="flex items-center gap-2 rounded-md border border-rz-border bg-rz-cream px-3 py-2">
          <code data-testid="temp-password" className="min-w-0 flex-1 break-all font-mono text-[15px] text-rz-navy">
            {password}
          </code>
          <Button type="button" size="sm" variant="outline" icon={<Copy className="h-4 w-4" />} onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RolesEditor({ roles }: { roles: ReturnType<typeof useAsync<RolesResponse>> }) {
  const { isSuper } = useAdminSession();
  return (
    <Card title="Roles & permissions" description="Which actions each role may perform. The Super Admin role is protected and cannot be edited.">
      <div className="p-5">
        <AsyncView data={roles.data} error={roles.error} loading={roles.loading} reload={roles.reload} skeleton={<ListSkeleton rows={2} />}>
          {(data) => <RolesBody data={data} canEdit={isSuper} onSaved={() => roles.reload()} />}
        </AsyncView>
      </div>
    </Card>
  );
}

function RolesBody({ data, canEdit, onSaved }: { data: RolesResponse; canEdit: boolean; onSaved: () => void }) {
  const [selectedId, setSelectedId] = useState(data.roles.find((r) => !r.protected)?.id ?? data.roles[0]?.id ?? "");
  const role = data.roles.find((r) => r.id === selectedId) ?? data.roles[0];
  const [checked, setChecked] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [saved, setSaved] = useState(false);
  const [creating, setCreating] = useState(false);
  const save = useAction((permissions: string[]) => adminApi.put<unknown>(`/roles/${role.id}/permissions`, { permissions }));

  useEffect(() => {
    setChecked(new Set(role?.permissions ?? []));
    setSaved(false);
  }, [role?.id, role?.permissions]);

  if (!role) return <p className="text-sm text-rz-muted">No roles defined.</p>;
  const editable = canEdit && !role.protected;
  const dirty = checked.size !== role.permissions.length || role.permissions.some((p) => !checked.has(p));

  async function onSave() {
    setSaved(false);
    if (await save.run([...checked].sort())) {
      setSaved(true);
      onSaved();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem]">
          <FieldLabel htmlFor="role-select">Role</FieldLabel>
          <Select id="role-select" value={role.id} onChange={(e) => setSelectedId(e.target.value)}>
            {data.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {roleLabel(r.name)} ({r.members} member{r.members === 1 ? "" : "s"})
              </option>
            ))}
          </Select>
        </div>
        {canEdit && (
          <Button type="button" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New role
          </Button>
        )}
      </div>
      {role.description && <p className="text-[13px] text-rz-muted">{role.description}</p>}
      {role.protected && (
        <p className="flex items-center gap-2 text-[13px] text-rz-muted">
          <ShieldCheck className="h-4 w-4" aria-hidden /> Protected role — always holds every permission.
        </p>
      )}
      <fieldset disabled={!editable}>
        <legend className="sr-only">Permissions for {roleLabel(role.name)}</legend>
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {data.permissions.map((p) => (
            <li key={p.key}>
              <label className="flex cursor-pointer items-start gap-2 rounded-md bg-rz-cream px-3 py-2 text-sm has-[:disabled]:cursor-default">
                <input
                  type="checkbox"
                  className="rz-focus mt-1 accent-rz-maroon"
                  checked={role.protected ? true : checked.has(p.key)}
                  onChange={(e) =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(p.key);
                      else next.delete(p.key);
                      return next;
                    })
                  }
                />
                <span>
                  <span className="block font-mono text-[12px] text-rz-navy">{p.key}</span>
                  {p.description && <span className="block text-[12.5px] text-rz-muted">{p.description}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {editable ? (
        <div className="flex items-center gap-3">
          <Button type="button" disabled={!dirty || save.pending} onClick={onSave}>
            {save.pending ? "Saving…" : "Save permissions"}
          </Button>
          {saved && !dirty && <SuccessNote>Permissions saved.</SuccessNote>}
        </div>
      ) : (
        !role.protected && <p className="text-[12.5px] text-rz-muted">Only a Super Admin can edit role permissions.</p>
      )}
      <ActionError error={save.error} />
      {creating && (
        <CreateRoleModal
          data={data}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            onSaved();
          }}
        />
      )}
    </div>
  );
}

function CreateRoleModal({ data, onClose, onCreated }: { data: RolesResponse; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const create = useAction((body: { name: string; description?: string; permissions: string[] }) => adminApi.post<unknown>("/roles", body));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await create.run({ name: name.trim(), description: description.trim() || undefined, permissions: [...perms].sort() });
    if (res !== undefined) onCreated();
  }

  return (
    <Modal title="New role" onClose={onClose} variant="drawer">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <FieldLabel htmlFor="role-name">Name</FieldLabel>
          <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={40} aria-invalid={!!fieldIssue(create.error, "name")} />
          {fieldIssue(create.error, "name") && <p className="mt-1 text-[12.5px] text-rz-danger">{fieldIssue(create.error, "name")}</p>}
        </div>
        <div>
          <FieldLabel htmlFor="role-desc">Description (optional)</FieldLabel>
          <Textarea id="role-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} rows={2} />
        </div>
        <fieldset>
          <legend className="mb-2 text-[12.5px] font-semibold text-rz-muted">Permissions</legend>
          <ul className="space-y-1.5">
            {data.permissions.map((p) => (
              <li key={p.key}>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="rz-focus mt-1 accent-rz-maroon"
                    checked={perms.has(p.key)}
                    onChange={(e) =>
                      setPerms((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(p.key);
                        else next.delete(p.key);
                        return next;
                      })
                    }
                  />
                  <span>
                    <span className="font-mono text-[12px] text-rz-navy">{p.key}</span>
                    {p.description && <span className="block text-[12.5px] text-rz-muted">{p.description}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <ActionError error={create.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.pending || name.trim().length < 3}>
            {create.pending ? "Creating…" : "Create role"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
