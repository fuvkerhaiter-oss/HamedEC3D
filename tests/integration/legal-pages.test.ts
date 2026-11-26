/** "Add legal pages" admin button on a real Postgres: drafts pre-filled from Settings, never overwrites, publish guard. */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { addLegalTemplates, setPagePublished } from "../../src/lib/admin/services/content";
import { LEGAL_PAGES } from "../../src/lib/legal/templates";
import { makeAdmin, startTestDb, type TestDb } from "./helpers";

let t: TestDb;
let admin: Awaited<ReturnType<typeof makeAdmin>>;
before(async () => {
  t = await startTestDb("legalpages");
  admin = await makeAdmin(t.sql);
  await t.sql`insert into public.store_settings (key, value) values ('store.seller', ${t.sql.json({ legalName: "Wego Test Srl", vatNumber: "IT00000000000", address: "Via Prova 1\n20100 Milano" })})
              on conflict (key) do update set value = excluded.value`;
});
after(() => t.close());

test("adds every legal page as a draft, pre-filled, and never touches existing pages", async () => {
  await t.sql`insert into public.cms_pages (slug, title, draft_body) values ('about', 'About', 'My own text')`;
  const added = await addLegalTemplates(t.sql, admin);
  assert.equal(added.length, LEGAL_PAGES.length - 1);
  const pages = await t.sql<{ slug: string; status: string; draft_body: string; published_body: string | null }[]>`select slug, status, draft_body, published_body from public.cms_pages`;
  assert.equal(pages.find((p) => p.slug === "about")!.draft_body, "My own text");
  const terms = pages.find((p) => p.slug === "terms")!;
  assert.equal(terms.status, "draft");
  assert.equal(terms.published_body, null, "nothing goes live");
  assert.ok(terms.draft_body.includes("Wego Test Srl") && terms.draft_body.includes("Via Prova 1, 20100 Milano") && !terms.draft_body.includes("[LEGAL COMPANY NAME]"));
  assert.deepEqual(await addLegalTemplates(t.sql, admin), [], "second click changes nothing");
});

test("publishing is refused while the TEMPLATE line is still there, allowed once removed", async () => {
  const [p] = await t.sql<{ id: string; draft_body: string }[]>`select id, draft_body from public.cms_pages where slug = 'privacy'`;
  await assert.rejects(setPagePublished(t.sql, admin, p!.id, true), /still a template/);
  await t.sql`update public.cms_pages set draft_body = ${p!.draft_body.replace(/^TEMPLATE[^\n]*\n+/, "")} where id = ${p!.id}`;
  await setPagePublished(t.sql, admin, p!.id, true);
  const [after] = await t.sql<{ status: string }[]>`select status from public.cms_pages where id = ${p!.id}`;
  assert.equal(after!.status, "published");
});
