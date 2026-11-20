import type { Permission } from "@/lib/admin/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: string; // short glyph
  permission: Permission;
  group: "Sell" | "Operate" | "Grow" | "System";
}

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Overview", icon: "◎", permission: "dashboard.view", group: "Sell" },
  { href: "/admin/orders", label: "Orders", icon: "▤", permission: "orders.view", group: "Sell" },
  { href: "/admin/products", label: "Products", icon: "▦", permission: "products.view", group: "Sell" },
  { href: "/admin/categories", label: "Categories", icon: "☰", permission: "categories.manage", group: "Sell" },
  { href: "/admin/inventory", label: "Inventory", icon: "▥", permission: "inventory.view", group: "Sell" },
  { href: "/admin/customers", label: "Customers", icon: "◍", permission: "customers.view", group: "Sell" },
  { href: "/admin/suppliers", label: "Suppliers", icon: "⇄", permission: "suppliers.view", group: "Operate" },
  { href: "/admin/shipping", label: "Shipping & Delivery", icon: "➚", permission: "shipping.manage", group: "Operate" },
  { href: "/admin/payments", label: "Payments", icon: "€", permission: "payments.view", group: "Operate" },
  { href: "/admin/store", label: "Store (3D shelves)", icon: "◫", permission: "store.manage", group: "Operate" },
  { href: "/admin/discounts", label: "Discounts & Coupons", icon: "%", permission: "discounts.manage", group: "Grow" },
  { href: "/admin/analytics", label: "Analytics & Reports", icon: "↗", permission: "analytics.view", group: "Grow" },
  { href: "/admin/reviews", label: "Reviews", icon: "★", permission: "reviews.moderate", group: "Grow" },
  { href: "/admin/content", label: "Website Content", icon: "¶", permission: "content.manage", group: "Grow" },
  { href: "/admin/notifications", label: "Notifications", icon: "◔", permission: "notifications.view", group: "System" },
  { href: "/admin/settings", label: "Settings", icon: "⚙", permission: "settings.manage", group: "System" },
  { href: "/admin/admins", label: "Admin Users", icon: "◈", permission: "admins.manage", group: "System" },
  { href: "/admin/activity", label: "Activity Log", icon: "≡", permission: "activity.view", group: "System" },
];

export const BREADCRUMB_LABELS: Record<string, string> = Object.fromEntries(ADMIN_NAV.map((n) => [n.href.split("/").pop() || "admin", n.label]));
