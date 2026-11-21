/**
 * Adds the legal page templates as DRAFTS in Admin → Website Content. Idempotent: an existing page (any slug
 * already present) is never touched, so your edits are safe. Usage: npm run content:legal
 */
import postgres from "postgres";
import { LEGAL_PAGES } from "./legal-templates";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  const sql = postgres(url, { max: 1 });
  try {
    for (const p of LEGAL_PAGES) {
      const rows = await sql`insert into public.cms_pages (slug, title, draft_body, status)
                             values (${p.slug}, ${p.title}, ${p.body}, 'draft')
                             on conflict (slug) do nothing returning id`;
      console.log(`${rows.length ? "added draft" : "kept existing"}  /pages/${p.slug}  (${p.title})`);
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
