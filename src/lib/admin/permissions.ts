/**
 * Admin RBAC. Roles grant a default permission set; each admin user can additionally have
 * permissions granted (extra) or removed (revoked). Every server action/route checks a permission.
 * Pure module (unit tested, safe to import from client components for UI hints only).
 */
export const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN", "PRODUCT_MANAGER", "ORDER_MANAGER", "SUPPORT"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: "Super admin",
  ADMIN: "Admin",
  PRODUCT_MANAGER: "Product manager",
  ORDER_MANAGER: "Order manager",
  SUPPORT: "Support",
};

export const PERMISSIONS = {
  "dashboard.view": "View the overview dashboard",
  "products.view": "View products",
  "products.edit": "Create and edit products, variants, prices and images",
  "products.publish": "Publish, unpublish and archive products",
  "products.delete": "Delete products (soft delete when ordered)",
  "products.import": "Import/export products via CSV",
  "products.costs": "See supplier costs and margins",
  "categories.manage": "Create, edit, reorder categories",
  "inventory.view": "View stock levels and movements",
  "inventory.adjust": "Adjust stock (with a reason)",
  "orders.view": "View orders",
  "orders.manage": "Change order status, add notes and shipments",
  "orders.refund": "Issue refunds",
  "orders.export": "Export orders",
  "customers.view": "View customers (masked contact details)",
  "customers.pii": "See full customer contact details and addresses",
  "suppliers.view": "View suppliers",
  "suppliers.manage": "Manage suppliers, mappings and supplier orders",
  "shipping.manage": "Manage shipping zones, methods and rates",
  "payments.view": "View payments, refunds and provider status",
  "finance.view": "View profit, expenses and exchange rates",
  "finance.manage": "Record expenses and exchange rates",
  "discounts.manage": "Manage discount codes",
  "analytics.view": "View analytics and download reports",
  "reviews.moderate": "Moderate reviews",
  "store.manage": "Configure the 3D store shelves",
  "content.manage": "Edit homepage content and CMS pages",
  "notifications.view": "View admin notifications",
  "settings.manage": "Change store settings",
  "admins.manage": "Manage admin users and permissions",
  "activity.view": "View the activity log",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly Permission[] | "all">> = {
  SUPER_ADMIN: "all",
  ADMIN: ALL_PERMISSIONS.filter((p) => p !== "admins.manage"),
  PRODUCT_MANAGER: [
    "dashboard.view", "products.view", "products.edit", "products.publish", "products.delete", "products.import",
    "products.costs", "categories.manage", "inventory.view", "inventory.adjust", "suppliers.view", "store.manage",
    "reviews.moderate", "content.manage", "notifications.view", "analytics.view",
  ],
  ORDER_MANAGER: [
    "dashboard.view", "products.view", "inventory.view", "orders.view", "orders.manage", "orders.refund",
    "orders.export", "customers.view", "customers.pii", "suppliers.view", "suppliers.manage", "payments.view",
    "shipping.manage", "notifications.view", "analytics.view",
  ],
  SUPPORT: ["dashboard.view", "products.view", "inventory.view", "orders.view", "customers.view", "reviews.moderate", "notifications.view"],
};

export function isAdminRole(v: string): v is AdminRole {
  return (ADMIN_ROLES as readonly string[]).includes(v);
}

export function isPermission(v: string): v is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, v);
}

export function roleDefaults(role: AdminRole): Permission[] {
  const r = ROLE_PERMISSIONS[role];
  return r === "all" ? [...ALL_PERMISSIONS] : [...r];
}

/** Effective permissions = role defaults + extra − revoked. SUPER_ADMIN always has everything; admins.manage is SUPER_ADMIN only. */
export function effectivePermissions(role: AdminRole, extra: readonly string[] = [], revoked: readonly string[] = []): Set<Permission> {
  const set = new Set<Permission>(roleDefaults(role));
  if (role === "SUPER_ADMIN") return set;
  for (const p of extra) if (isPermission(p) && p !== "admins.manage") set.add(p);
  for (const p of revoked) if (isPermission(p)) set.delete(p);
  return set;
}

/** Only a SUPER_ADMIN manages admins; nobody changes their own role or deactivates themselves. */
export function canManageAdmin(
  actor: { id: string; role: AdminRole },
  target: { id: string; role: AdminRole },
  change: { role?: AdminRole; deactivate?: boolean } = {},
): boolean {
  if (actor.role !== "SUPER_ADMIN") return false;
  if (actor.id === target.id && ((change.role && change.role !== target.role) || change.deactivate)) return false;
  return true;
}

export class ForbiddenError extends Error {
  override name = "ForbiddenError";
  constructor(readonly permission: Permission) {
    super(`You don't have permission to do this (${permission}).`);
  }
}
