import { AdminShell } from "@/features/admin/AdminShell";
import { DbDownNotice } from "@/features/admin/DbDownNotice";
import { isDbUnreachable, logError } from "@/lib/log";
import { ADMIN_NAV } from "@/features/admin/nav";
import { requirePage } from "@/lib/admin/guard";
import { ROLE_LABELS } from "@/lib/admin/permissions";
import { unreadCount } from "@/lib/admin/services/notifications";
import { getSql } from "@/lib/db/client";
import { logoutAction } from "../auth-actions";

export const dynamic = "force-dynamic";
// DB queries give up after ~10 s (lib/db/client.ts); leave room to show the error instead of a platform 504.
export const maxDuration = 30;

async function loadShell() {
  const session = await requirePage();
  const unread = session.permissions.has("notifications.view") ? await unreadCount(getSql(), session.user.id) : 0;
  return { session, unread };
}

export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const shell = await loadShell().catch((err: unknown) => {
    if (!isDbUnreachable(err)) throw err; // includes redirect() to the login page
    logError("admin: database unreachable", err);
    return null;
  });
  if (!shell) return <DbDownNotice />;
  const { session, unread } = shell;
  const allowed = ADMIN_NAV.filter((n) => session.permissions.has(n.permission)).map((n) => n.href);
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
