/**
 * LOCAL DEVELOPMENT ONLY: opens a few DEMO rental shops in the 3D store (complimentary TEST leases, open storefronts,
 * logos, sign names, door styles and published products with generated images) so every shop feature can be seen
 * without paying. Products link to a placeholder URL, never a real checkout. Refuses to run against a non-local DB.
 *   npm run db:seed-demo-shops            (re-run = replace the demo shops)
 *   npm run db:seed-demo-shops -- --clear (remove them only)
 * Leaves SHOP 04 free so the "FOR RENT" state stays visible.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { createSql } from "../../src/lib/db/client";
import { getMediaStorage } from "../../src/lib/media/storage";

const env = readFileSync(path.resolve(import.meta.dirname, "..", "..", ".env.local"), "utf8");
const url = process.env.DATABASE_URL ?? /^DATABASE_URL=(.+)$/m.exec(env)?.[1]?.trim();
if (!url || !/@(127\.0\.0\.1|localhost):/.test(url)) {
  console.error("Refusing: DATABASE_URL must point to the local development database.");
  process.exit(1);
}
const storage = getMediaStorage(process.env);
if (storage && storage.driver !== "local") {
  console.error("Refusing: media storage is not the local dev store (Supabase keys are set). Images would go to a real bucket.");
  process.exit(1);
}

const DEMO_EMAIL = (n: number) => `demo-shop-${n}@demo.local`;
const DEMO_LINK = "https://example.com/demo-checkout"; // placeholder, not a real payment link

interface DemoShop {
  shopId: string;
  brand: string;
  tagline: string;
  about: string;
  accent: string;
  door: { frame: string; light: string; effect: "steady" | "breathe" | "chase" | "rainbow"; level: number };
  font: string;
  category: string;
  products: { title: string; description: string; price: number; color: string }[];
}

const SHOPS: DemoShop[] = [
  {
    shopId: "shop-1", brand: "Paws & Co (DEMO)", tagline: "Toys and treats for happy pets", accent: "#ff5b2e", font: "bricolage", category: "Pets",
    about: "DEMO shop for local testing. Handmade toys, beds and natural treats for dogs and cats.",
    door: { frame: "#2b2f6b", light: "#ffd34d", effect: "chase", level: 85 },
    products: [
      { title: "Rope tug toy", description: "Cotton rope toy, 40 cm. Demo product.", price: 1290, color: "#ff8a5b" },
      { title: "Cosy cat bed", description: "Soft round bed, washable cover. Demo product.", price: 3490, color: "#8ec5ff" },
      { title: "Chicken treats", description: "Air-dried chicken bites, 200 g. Demo product.", price: 790, color: "#ffd166" },
      { title: "Squeaky duck", description: "Latex squeaky toy. Demo product.", price: 590, color: "#f7e15c" },
      { title: "Leather collar", description: "Adjustable collar, size M. Demo product.", price: 2190, color: "#a0522d" },
      { title: "Food bowl set", description: "Two ceramic bowls. Demo product.", price: 1890, color: "#7bd389" },
    ],
  },
  {
    shopId: "shop-2", brand: "Green Leaf (DEMO)", tagline: "Plants for every room", accent: "#2bb673", font: "bricolage", category: "Home & garden",
    about: "DEMO shop for local testing. Easy-care houseplants, pots and plant food.",
    door: { frame: "#1f3d2b", light: "#9dffb0", effect: "breathe", level: 75 },
    products: [
      { title: "Monstera in pot", description: "Monstera deliciosa, 60 cm. Demo product.", price: 3990, color: "#2f9e5b" },
      { title: "Succulent trio", description: "Three mini succulents. Demo product.", price: 1490, color: "#9bd17a" },
      { title: "Terracotta pot", description: "Hand-thrown pot, 18 cm. Demo product.", price: 1190, color: "#d9774b" },
      { title: "Plant food", description: "Liquid fertiliser, 250 ml. Demo product.", price: 690, color: "#5cc0a8" },
    ],
  },
  {
    shopId: "shop-3", brand: "Sweet Tooth (DEMO)", tagline: "Candy, cookies and cakes", accent: "#e84a9a", font: "bricolage", category: "Food",
    about: "DEMO shop for local testing. Small-batch sweets baked to order.",
    door: { frame: "#5b1e46", light: "#ff9de2", effect: "rainbow", level: 90 },
    products: [
      { title: "Macaron box", description: "Twelve assorted macarons. Demo product.", price: 1990, color: "#f4a6c9" },
      { title: "Chocolate cookies", description: "Bag of eight cookies. Demo product.", price: 890, color: "#8b5a3c" },
      { title: "Lollipop bunch", description: "Ten fruit lollipops. Demo product.", price: 490, color: "#ff6b6b" },
      { title: "Birthday cake", description: "Vanilla cake, serves 8. Demo product.", price: 3290, color: "#ffe08a" },
      { title: "Gummy bears", description: "250 g fruit gummies. Demo product.", price: 390, color: "#7ad3ff" },
    ],
  },
];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function image(label: string, color: string, round = false): Promise<Buffer> {
  const words = label.split(" ");
  const lines = words.length > 2 ? [words.slice(0, Math.ceil(words.length / 2)).join(" "), words.slice(Math.ceil(words.length / 2)).join(" ")] : [label];
  const text = lines.map((l, i) => `<text x="256" y="${270 + (i - (lines.length - 1) / 2) * 56}" font-family="Arial, sans-serif" font-size="${round ? 150 : 48}" font-weight="700" fill="#1b1b1b" text-anchor="middle" dominant-baseline="middle">${esc(l)}</text>`).join("");
  const bg = round ? `<circle cx="256" cy="256" r="250" fill="${color}" stroke="#fff7e6" stroke-width="12"/>` : `<rect width="512" height="512" rx="36" fill="${color}"/><rect x="24" y="24" width="464" height="464" rx="28" fill="none" stroke="#ffffff88" stroke-width="6"/><text x="256" y="470" font-family="Arial, sans-serif" font-size="26" fill="#1b1b1b99" text-anchor="middle">DEMO</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">${bg}${text}</svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 82 }).toBuffer();
}

async function upload(tenantId: string, data: Buffer): Promise<{ bucket: string; path: string } | null> {
  if (!storage) return null;
  const key = `${tenantId}/${randomUUID()}.webp`;
  await storage.put(key, data, "image/webp");
  return { bucket: storage.bucket, path: key };
}

const reference = () => {
  const abc = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  return "RS-" + [...randomBytes(6)].map((b) => abc[b % abc.length]).join("");
};

const sql = createSql(url, 2);
try {
  // Remove previous demo data (identified by the demo email domain). Media files are left on the local disk.
  const old = await sql<{ user_id: string }[]>`select distinct user_id from public.shop_leases where email like 'demo-shop-%@demo.local' and user_id is not null`;
  if (old.length) await sql`delete from public.tenant_accounts where user_id in ${sql(old.map((o) => o.user_id))}`;
  const gone = await sql`delete from public.shop_leases where email like 'demo-shop-%@demo.local' returning id`;
  if (gone.length) console.log(`removed ${gone.length} previous demo lease(s)`);
  if (process.argv.includes("--clear")) process.exit(0);

  const now = new Date();
  const end = new Date(now);
  end.setMonth(end.getMonth() + 3);
  for (const [i, s] of SHOPS.entries()) {
    const [busy] = await sql`select 1 from public.shop_leases where shop_id = ${s.shopId}
                              and ((status = 'active' and ends_at > now()) or (status = 'pending_payment' and hold_expires_at > now())) limit 1`;
    if (busy) {
      console.log(`skip   ${s.shopId}: already rented or held by a non-demo lease`);
      continue;
    }
    const userId = randomUUID();
    await sql.begin(async (tx) => {
      await tx`insert into public.shop_leases (reference, shop_id, plan, months, currency, amount, regular_amount, promo_name, status,
                 brand_name, contact_name, email, category, description, country, fee_amount, user_id,
                 display_name, display_approved, is_test, terms_accepted_at, hold_expires_at, starts_at, ends_at, provider, admin_note)
               values (${reference()}, ${s.shopId}, 'quarterly', 3, 'EUR', 0, 0, 'Complimentary', 'active',
                 ${s.brand}, 'Demo Tenant', ${DEMO_EMAIL(i + 1)}, ${s.category}, ${s.about}, 'IT', 0, ${userId},
                 ${s.brand.replace(" (DEMO)", "").slice(0, 40)}, true, true, ${now}, ${now}, ${now}, ${end}, 'complimentary',
                 'DEMO shop created by tools/db/seed-demo-shops.ts (local dev only).')`;
      const [t] = await tx<{ id: string }[]>`
        insert into public.tenant_accounts (user_id, brand_name, tagline, about, accent_color, contact_email, storefront_open,
          door_color, door_light_color, door_light_effect, door_light_level, sign_font, default_payment_url, admin_note)
        values (${userId}, ${s.brand}, ${s.tagline}, ${s.about}, ${s.accent}, ${DEMO_EMAIL(i + 1)}, true,
          ${s.door.frame}, ${s.door.light}, ${s.door.effect}, ${s.door.level}, ${s.font}, ${DEMO_LINK}, 'DEMO tenant (local dev only).')
        returning id`;
      const logo = await upload(t!.id, await image(s.brand[0]!, s.accent, true));
      if (logo) await tx`update public.tenant_accounts set logo_bucket = ${logo.bucket}, logo_path = ${logo.path} where id = ${t!.id}`;
      for (const [n, p] of s.products.entries()) {
        const img = await upload(t!.id, await image(p.title, p.color));
        await tx`insert into public.tenant_products (tenant_id, title, description, price, currency, image_bucket, image_path, payment_url, status, sort)
                 values (${t!.id}, ${p.title}, ${p.description}, ${p.price}, 'EUR', ${img?.bucket ?? null}, ${img?.path ?? null}, ${DEMO_LINK}, 'published', ${n + 1})`;
      }
    });
    console.log(`opened ${s.shopId}: ${s.brand} with ${s.products.length} products${storage ? "" : " (no images: media storage off)"}`);
  }
} finally {
  await sql.end();
}
