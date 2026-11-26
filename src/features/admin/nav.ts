import type { Permission } from "@/lib/admin/permissions";
import type { IconName } from "./icons";

export interface NavItem {
  href: string;
  /** Plain-language name shown in the menu. */
  label: string;
  /** One short sentence: what you do on this page. */
  hint: string;
  icon: IconName;
  permission: Permission;
  group: NavGroup;
}

export const NAV_GROUPS = ["Every day", "Products", "Money & delivery", "Setup"] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Home", hint: "Your to-do list and how the shop is doing", icon: "home", permission: "dashboard.view", group: "Every day" },
  { href: "/admin/orders", label: "Orders", hint: "See new orders, ship them, refund them", icon: "orders", permission: "orders.view", group: "Every day" },
  { href: "/admin/customers", label: "Customers", hint: "People who bought from you", icon: "customers", permission: "customers.view", group: "Every day" },
  { href: "/admin/notifications", label: "Alerts", hint: "Things that happened and may need you", icon: "bell", permission: "notifications.view", group: "Every day" },

  { href: "/admin/products", label: "Products", hint: "Add, edit and publish what you sell", icon: "products", permission: "products.view", group: "Products" },
  { href: "/admin/products/images", label: "Product photos", hint: "Upload and manage product pictures", icon: "photo", permission: "products.view", group: "Products" },
  { href: "/admin/categories", label: "Categories", hint: "Groups like Food, Toys, Snacks", icon: "categories", permission: "categories.manage", group: "Products" },
  { href: "/admin/inventory", label: "Stock (Inventory)", hint: "How many of each item you have", icon: "stock", permission: "inventory.view", group: "Products" },
  { href: "/admin/store", label: "3D store shelves", hint: "What shoppers see on the 3D shelves", icon: "shelves", permission: "store.manage", group: "Products" },
  { href: "/admin/reviews", label: "Reviews", hint: "Approve or hide customer reviews", icon: "star", permission: "reviews.moderate", group: "Products" },

  { href: "/admin/payments", label: "Payments", hint: "Money received and refunds", icon: "card", permission: "payments.view", group: "Money & delivery" },
  { href: "/admin/discounts", label: "Discount codes", hint: "Coupons customers type at checkout", icon: "tag", permission: "discounts.manage", group: "Money & delivery" },
  { href: "/admin/analytics", label: "Reports", hint: "Sales, profit and downloads", icon: "chart", permission: "analytics.view", group: "Money & delivery" },
  { href: "/admin/shipping", label: "Shipping prices", hint: "Countries you deliver to and what it costs", icon: "truck", permission: "shipping.manage", group: "Money & delivery" },
  { href: "/admin/suppliers", label: "Suppliers", hint: "Companies that send products to customers", icon: "supplier", permission: "suppliers.view", group: "Money & delivery" },
  { href: "/admin/rentals", label: "Shop rentals", hint: "Brands renting the shops in the 3D store", icon: "store", permission: "orders.view", group: "Every day" },
  { href: "/admin/rentals/tenants", label: "Shop tenants", hint: "Renters' shops, products, traffic and fees", icon: "customers", permission: "orders.view", group: "Every day" },
  { href: "/admin/dropshipping", label: "Dropshipping", hint: "Automatic supplier orders, kill switch, orders that need you", icon: "truck", permission: "suppliers.view", group: "Every day" },

  { href: "/admin/content", label: "Website text", hint: "Homepage banner and pages like Terms", icon: "text", permission: "content.manage", group: "Setup" },
  { href: "/admin/settings", label: "Shop settings", hint: "Shop name, taxes, invoice details", icon: "settings", permission: "settings.manage", group: "Setup" },
  { href: "/admin/supporters", label: "Supporters wall", hint: "Names on the 3D “supported us from the beginning” board", icon: "star", permission: "admins.manage", group: "Setup" },
  { href: "/admin/admins", label: "Team & logins", hint: "Who can sign in to this admin", icon: "team", permission: "admins.manage", group: "Setup" },
  { href: "/admin/activity", label: "Change history", hint: "Who changed what, and who visited the website", icon: "history", permission: "activity.view", group: "Setup" },
];

/** The menu item a path belongs to (longest matching href wins, so /admin/products/images ≠ Products). */
export function navItemFor(path: string, items: NavItem[] = ADMIN_NAV): NavItem | undefined {
  let best: NavItem | undefined;
  for (const n of items) {
    const hit = n.href === "/admin" ? path === "/admin" : path === n.href || path.startsWith(n.href + "/");
    if (hit && (!best || n.href.length > best.href.length)) best = n;
  }
  return best;
}

export const BREADCRUMB_LABELS: Record<string, string> = {
  ...Object.fromEntries(ADMIN_NAV.map((n) => [n.href.split("/").pop() || "admin", n.label])),
  new: "New",
  invoice: "Invoice",
  visitors: "Website visitors",
};

/** "How this page works" guides — plain language, no technical words. Keyed by menu href. */
export interface PageGuide {
  what: string;
  steps: string[];
}

export const PAGE_GUIDES: Record<string, PageGuide> = {
  "/admin": {
    what: "This is your starting point. The top box lists what needs your attention right now. Below it you can see how much you sold.",
    steps: ["Work through the “To do now” list from top to bottom.", "Use the big buttons for the most common jobs.", "Change the period (for example “Last 7 days”) to see other numbers."],
  },
  "/admin/orders": {
    what: "Every purchase in your shop is an order. Use the tabs to see only the orders that need something from you.",
    steps: ["Open the “Ready to send” tab — these customers have paid.", "Click an order number to open it. A yellow box tells you exactly what to do next.", "Orders marked TEST are practice orders, not real customers."],
  },
  "/admin/customers": {
    what: "A list of everyone who placed an order, with how much they spent.",
    steps: ["Search by name or email.", "Click “Orders” next to a customer to see what they bought."],
  },
  "/admin/notifications": {
    what: "The shop tells you here when something happens: a new paid order, an item running out, a supplier problem.",
    steps: ["Read the newest alerts first.", "Click an alert to go to the page where you can fix it.", "Mark alerts as read when you have dealt with them."],
  },
  "/admin/products": {
    what: "Everything you sell. Customers only see products that are “Live in shop”. Drafts are hidden until you publish them.",
    steps: ["Click “New product” to add something to sell.", "On the product page add at least one size/option with a price and stock, then press Publish.", "Tick several products to publish, hide or move them all at once."],
  },
  "/admin/products/images": {
    what: "All product photos in one place. Photos appear in the shop, on the product page, in the cart and on the 3D shelves.",
    steps: ["Use the filter “Missing images” to find products without a photo.", "Click “Manage” to add or change photos for one product.", "Bulk upload: name each file like the product (for example olive-oil.jpg) and drop them all at once."],
  },
  "/admin/categories": {
    what: "Categories group your products (for example Food, Toys). They appear as filters in the shop and as aisle signs in the 3D store.",
    steps: ["Add a category with a name.", "Use the arrows to change the order — the shop uses the same order.", "Turn a category off to hide it without deleting it."],
  },
  "/admin/inventory": {
    what: "How many items you have. “Available” is what customers can still buy (stock minus items held for unpaid orders).",
    steps: ["Use “Low stock” to see items that are running out.", "Click “Change…” on a row to correct the number. Always write a short reason.", "Every change is saved in the history, so you can always check it later."],
  },
  "/admin/store": {
    what: "A map of the 3D store shelves. It shows which product sits on which shelf.",
    steps: ["Find a product on the map.", "To move or hide a product on the shelves, open the product and use the “3D shelf” section."],
  },
  "/admin/reviews": {
    what: "Reviews written by customers. Only reviews you approve are shown in the shop.",
    steps: ["Read new reviews.", "Click Approve to show it, or Hide to keep it private."],
  },
  "/admin/payments": {
    what: "Money customers paid you, and refunds you gave back. An order becomes “Paid” only when the payment company confirms it — you can't do it by hand.",
    steps: ["Check the box at the top to see if payments are switched on.", "Look at recent payments and refunds in the tables.", "To refund a customer, open the order and use “Refund”."],
  },
  "/admin/discounts": {
    what: "Codes customers type at checkout to get money off (for example SUMMER10).",
    steps: ["Fill in the form: code, percent or fixed amount, and optional dates.", "Share the code with your customers.", "Turn a code off when the offer ends."],
  },
  "/admin/analytics": {
    what: "Your sales and profit for a period. Profit is an estimate until all supplier costs are entered.",
    steps: ["Choose a period at the top right.", "Add business costs (ads, fees) under Expenses so profit is correct.", "Download a spreadsheet (CSV) for your accountant."],
  },
  "/admin/shipping": {
    what: "Where you deliver and how much customers pay for delivery. Customers only see delivery options for their country.",
    steps: ["1. Create an area (for example “Italy” or “Europe”) and choose its countries.", "2. Add a delivery option to it (for example “Standard 3–5 days”).", "3. Set the price. You can make delivery free above an order amount."],
  },
  "/admin/suppliers": {
    what: "Suppliers are the companies that pack and send your products. When a customer pays, the order is split so each supplier gets only their items.",
    steps: ["Add each company you buy from.", "Link products to their supplier on the product page.", "For a paid order: place it with the supplier, then type their order number on the order page."],
  },
  "/admin/content": {
    what: "Text on your website: the homepage banner and pages like Terms, Privacy and Returns.",
    steps: ["Change the homepage text and press Save (leave empty to keep the default).", "Open a page, edit it, then press Publish so customers can see it.", "Terms, Privacy and Returns must be published before the shop can take real orders."],
  },
  "/admin/settings": {
    what: "Basic information about your business: shop name, contact email, company details for invoices, and tax rates.",
    steps: ["Fill in your company details once — they are printed on invoices.", "Add the tax (VAT) rate for each country you sell to. Ask your accountant if unsure.", "Change your own password at the bottom."],
  },
  "/admin/rentals": {
    what: "Brands rent the four shop units in the 3D store from the public “Rent a shop” page. A booking becomes paid only when Stripe confirms the payment; the tenant gets a confirmation email and a reminder 7 days before the end.",
    steps: ["When a new rental is paid, check the brand and tick “Show this name on the shop's sign”.", "Reply to the tenant's email to collect their logo and products.", "Anything marked “Needs you” was paid but couldn't be activated: move it to a free shop or refund it."],
  },
  "/admin/rentals/tenants": {
    what: "Every brand renting a shop has its own dashboard (/seller) where they edit their brand, products and payment links. Here you see all of them: their shop, products, traffic and the monthly fee you charge them.",
    steps: ["Open a tenant to see their products and how many shoppers view and click them.", "Set a monthly fee: it's added to their next rent payment (each month of it).", "Hide a product that breaks the rules, or pause the whole shop. They see the reason in their dashboard."],
  },
  "/admin/supporters": {
    what: "The people who supported you from the beginning. Their names and countries scroll on a 3D board next to the “Coming soon” wing in the 3D store. Only super admins can change it.",
    steps: ["Type a name, pick the country and press “Add person”, or paste many names at once.", "Use the arrows to change the order and fix names right in the table.", "Press “Save and publish” — the 3D store shows the new list within a minute."],
  },
  "/admin/admins": {
    what: "People who can sign in to this admin. Each person gets a role that decides what they can see and change.",
    steps: ["Add a team member with their email and a role.", "“Super admin” can do everything — give it only to owners.", "Turn an account off when someone leaves."],
  },
  "/admin/activity": {
    what: "A diary of every change made in the admin: who did it, when, and what was before and after. Nobody can edit or delete it.",
    steps: ["Search for a product, order number or person.", "Use it to find out what happened if something looks wrong.", "Super admins: open “Website visitors” to see who visited the site — IP address, country and city, device, browser, time they came in and the pages they saw."],
  },
};
