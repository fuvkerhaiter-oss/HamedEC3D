import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, Field, fmtDate, PageHeader } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { ADMIN_ROLES, ALL_PERMISSIONS, PERMISSIONS, ROLE_LABELS, roleDefaults } from "@/lib/admin/permissions";
import { listAdmins } from "@/lib/admin/services/people";
import { getSql } from "@/lib/db/client";
import { inviteAdminAction, resetPasswordAction, updateAdminAction } from "../ops-actions";

export const metadata = { title: "Admin Users" };

export default async function AdminsPage() {
  const session = await requirePage("admins.manage");
  const admins = await listAdmins(getSql());
  return (
    <>
      <PageHeader title="Team & logins" description="People who can sign in to this admin. Their role decides what they can see and change." />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          {admins.map((a) => {
            const defaults = new Set(roleDefaults(a.role));
            const self = a.id === session.user.id;
            return (
              <Card key={a.id}>
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{a.full_name || a.email}</span><span className="text-ink-soft">{a.email}</span>
                    <Badge tone="ink">{ROLE_LABELS[a.role]}</Badge>{!a.is_active && <Badge tone="red">deactivated</Badge>}{self && <Badge tone="blue">you</Badge>}
                    {a.locked_until && a.locked_until > new Date() && <Badge tone="amber">locked</Badge>}
                    <span className="ml-auto text-xs text-ink-soft">last sign-in {a.last_login_at ? fmtDate(a.last_login_at) : "never"} · {a.active_sessions} session(s)</span>
                  </summary>
                  <ActionForm action={updateAdminAction} submitLabel="Save access" className="mt-4">
                    <input type="hidden" name="id" value={a.id} />
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label="Name"><input name="fullName" defaultValue={a.full_name} className="admin-input" /></Field>
                      <Field label="Role"><select name="role" defaultValue={a.role} disabled={self} className="admin-input">{ADMIN_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>{self && <input type="hidden" name="role" value={a.role} />}</Field>
                      <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={a.is_active} disabled={self} className="h-4 w-4" /> Active{self && <input type="hidden" name="isActive" value="on" />}</label>
                    </div>
                    {a.role !== "SUPER_ADMIN" && (
                      <fieldset className="rounded-xl bg-cream p-3">
                        <legend className="px-1 text-xs font-semibold">Permission overrides (role default is pre-ticked)</legend>
                        <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                          {ALL_PERMISSIONS.filter((p) => p !== "admins.manage").map((p) => {
                            const isDefault = defaults.has(p);
                            const on = isDefault ? !a.revoked_permissions.includes(p) : a.extra_permissions.includes(p);
                            return (
                              <label key={p} className="flex items-center gap-2 text-xs" title={PERMISSIONS[p]}>
                                <input type="checkbox" name={isDefault ? "keep" : "extra"} value={p} defaultChecked={on} className="h-3.5 w-3.5" />
                                <span className={isDefault ? "" : "text-ink-soft"}>{p}</span>
                                {!isDefault && on && <Badge tone="blue">extra</Badge>}
                                {isDefault && <input type="hidden" name="defaults" value={p} />}
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>
                    )}
                  </ActionForm>
                  {!self && (
                    <ActionForm action={resetPasswordAction} inline className="mt-3" confirm="Reset this admin's password and sign them out?">
                      <input type="hidden" name="id" value={a.id} />
                      <input name="password" type="password" autoComplete="new-password" required placeholder="New temporary password" className="admin-input !w-64" aria-label="New temporary password" />
                      <button className="btn-ghost">Reset password</button>
                    </ActionForm>
                  )}
                </details>
              </Card>
            );
          })}
        </div>
        <Card title="Add an admin">
          <ActionForm action={inviteAdminAction} submitLabel="Create admin" resetOnSuccess>
            <Field label="Email"><input name="email" type="email" required className="admin-input" /></Field>
            <Field label="Name"><input name="fullName" className="admin-input" /></Field>
            <Field label="Role"><select name="role" defaultValue="SUPPORT" className="admin-input">{ADMIN_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></Field>
            <Field label="Temporary password" hint="12+ characters with letters and numbers. Share it securely; they can change it in Settings."><input name="password" type="password" autoComplete="new-password" required className="admin-input" /></Field>
          </ActionForm>
          <p className="mt-3 text-xs text-ink-soft">No invitation email is sent (no email provider configured).</p>
        </Card>
      </div>
    </>
  );
}
