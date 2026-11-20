import { AdminShell } from "@/features/admin/AdminShell";
import { ADMIN_NAV } from "@/features/admin/nav";
import { requirePage } from "@/lib/admin/guard";
import { ROLE_LABELS } from "@/lib/admin/permissions";
import { unreadCount } from "@/lib/admin/services/notifications";
import { getSql } from "@/lib/db/client";
import { logoutAction } from "../auth-actions";

export const dynamic = "force-dynamic";

export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePage();
  const allowed = ADMIN_NAV.filter((n) => session.permissions.has(n.permission)).map((n) => n.href);
  const unread = session.permissions.has("notifications.view") ? await unreadCount(getSql(), session.user.id) : 0;
  return (
    <AdminShell
      user={{ name: session.user.fullName, email: session.user.email, roleLabel: ROLE_LABELS[session.user.role] }}
      allowed={allowed}
      unread={unread}
      logout={logoutAction}
    >
      {children}
    </AdminShell>
  );
}
