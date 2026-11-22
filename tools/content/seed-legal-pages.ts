/**
 * Adds the legal page templates as DRAFTS in Admin → Website Content. Idempotent: an existing page (any slug
 * already present) is never touched, so your edits are safe. Usage: npm run content:legal
 *
 * `npm run content:legal -- --refresh-drafts` also replaces the DRAFT text of template pages that have never
 * been published (published_body is null) with the latest template. It overwrites unpublished edits to those
 * drafts, so only use it if you have not started filling them in. Published pages are never touched.
 */
import postgres from "postgres";
import { LEGAL_PAGES } from "./legal-templates";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  const refresh = process.argv.includes("--refresh-drafts");
  const sql = postgres(url, { max: 1 });
  try {
    for (const p of LEGAL_PAGES) {
      const rows = await sql`insert into public.cms_pages (slug, title, draft_body, status)
                             values (${p.slug}, ${p.title}, ${p.body}, 'draft')
                             on conflict (slug) do nothing returning id`;
      if (rows.length) {
        console.log(`added draft     /pages/${p.slug}  (${p.title})`);
        continue;
      }
      if (refresh) {
        const upd = await sql`update public.cms_pages set draft_body = ${p.body}, title = ${p.title}
                              where slug = ${p.slug} and published_body is null and draft_body <> ${p.body}
                              returning id`;
        console.log(`${upd.length ? "refreshed draft" : "kept existing  "} /pages/${p.slug}  (${p.title})`);
      } else {
        console.log(`kept existing   /pages/${p.slug}  (${p.title})`);
      }
    }
    console.log("\nNext: Admin → Website Content → fill the [bracketed] fields, have a lawyer review, then Publish.");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
