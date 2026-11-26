import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { parseUserAgent, visitorKey } from "../../src/lib/visitors/parse";
import { listVisits, liveVisits, pagesForVisits, purgeOldVisits, recordHeartbeat, recordPageView, visitCountries, visitReport, type VisitInput } from "../../src/lib/visitors/service";
import { startTestDb, type TestDb } from "./helpers";

let t: TestDb;
before(async () => {
  t = await startTestDb("visitors");
});
after(() => t.close());

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

const visit = (ip: string, ua: string, path: string, o: Partial<VisitInput> = {}): VisitInput => ({
  ip, visitorKey: visitorKey(ip, ua), path, country: "IT", region: "RM", city: "Rome", timezone: "Europe/Rome",
  ...parseUserAgent(ua), userAgent: ua, language: "it-IT", screen: "390x844", referrerHost: null, ...o,
});

test("page views continue one visit; a new browser starts another; returning is detected", async () => {
  const a = await recordPageView(t.sql, visit("203.0.113.5", IPHONE, "/", { referrerHost: "google.com" }));
  assert.equal(a.created, true);
  const again = await recordPageView(t.sql, visit("203.0.113.5", IPHONE, "/")); // same page within 3 s → same view
  assert.equal(again.visitId, a.visitId);
  const b = await recordPageView(t.sql, visit("203.0.113.5", IPHONE, "/store"));
  assert.equal(b.visitId, a.visitId);
  assert.equal(b.created, false);

  const c = await recordPageView(t.sql, visit("198.51.100.7", WIN, "/catalog", { country: "US", region: "CA", city: "San Francisco", timezone: "America/Los_Angeles" }));
  assert.notEqual(c.visitId, a.visitId);

  // A visit idle for > 30 min is over: the next view is a new, returning visit.
  await t.sql`update public.site_visits set started_at = now() - interval '2 hours', last_seen_at = now() - interval '1 hour' where id = ${a.visitId}`;
  const d = await recordPageView(t.sql, visit("203.0.113.5", IPHONE, "/rent-a-shop"));
  assert.equal(d.created, true);
  const [row] = await t.sql<{ is_returning: boolean; device: string; os: string; page_views: number }[]>`select is_returning, device, os, page_views from public.site_visits where id = ${d.visitId}`;
  assert.deepEqual(row, { is_returning: true, device: "mobile", os: "iOS 18", page_views: 1 });

  const [first] = await t.sql<{ page_views: number; last_path: string; referrer_host: string }[]>`select page_views, last_path, referrer_host from public.site_visits where id = ${a.visitId}`;
  assert.deepEqual(first, { page_views: 2, last_path: "/store", referrer_host: "google.com" });
  const pages = await pagesForVisits(t.sql, [a.visitId]);
  assert.deepEqual(pages.get(a.visitId)!.map((p) => p.path), ["/", "/store"]);

  await recordPageView(t.sql, visit("192.0.2.9", BOT, "/", { country: null, region: null, city: null }));
});

test("heartbeat keeps the open visit alive and never creates one", async () => {
  assert.equal(await recordHeartbeat(t.sql, visitorKey("198.51.100.7", WIN)), true);
  assert.equal(await recordHeartbeat(t.sql, visitorKey("10.9.9.9", WIN)), false);
  const live = await liveVisits(t.sql);
  assert.ok(live.some((v) => v.ip === "198.51.100.7"));
  assert.ok(!live.some((v) => v.ip === "192.0.2.9"), "bots are not 'online now'");
});

test("report numbers and filters", async () => {
  const f = { from: new Date(Date.now() - 3 * 86_400_000), to: new Date(Date.now() + 60_000) };
  const list = await listVisits(t.sql, f);
  assert.equal(list.total, 3);
  assert.equal((await listVisits(t.sql, { ...f, bots: true })).total, 4);
  assert.equal((await listVisits(t.sql, { ...f, country: "US" })).total, 1);
  assert.equal((await listVisits(t.sql, { ...f, device: "mobile" })).total, 2);
  assert.equal((await listVisits(t.sql, { ...f, q: "203.0.113.5" })).total, 2);
  assert.equal((await listVisits(t.sql, { ...f, q: "francisco" })).total, 1);
  assert.equal(list.rows.find((r) => r.ip === "203.0.113.5")!.visits_by_ip, 2);

  const r = await visitReport(t.sql, f);
  assert.equal(r.summary.visits, 3);
  assert.equal(r.summary.visitors, 2);
  assert.equal(r.summary.pageViews, 4);
  assert.equal(r.summary.countries, 2);
  assert.equal(r.summary.returning, 1);
  assert.deepEqual(r.countries.map((c) => [c.code, c.value]), [["IT", 2], ["US", 1]]);
  assert.deepEqual(r.devices.map((d) => [d.label, d.value]), [["mobile", 2], ["desktop", 1]]);
  assert.deepEqual(r.browsers.map((d) => d.label).sort(), ["Chrome", "Safari"]);
  assert.deepEqual(r.os.map((d) => d.label).sort(), ["Windows", "iOS"]);
  assert.equal(r.referrers.find((x) => x.label === "google.com")?.value, 1);
  assert.equal(r.series.reduce((s, x) => s + x.value, 0), 3);
  assert.equal(r.hours.length, 24);
  assert.ok(r.liveNow >= 1);
  assert.deepEqual(await visitCountries(t.sql, f.from, f.to), ["IT", "US"]);
});

test("purge removes visits past retention, with their pages", async () => {
  await t.sql`update public.site_visits set started_at = now() - interval '200 days', last_seen_at = now() - interval '200 days' where ip = '198.51.100.7'`;
  assert.equal(await purgeOldVisits(t.sql), 1);
  const [row] = await t.sql<{ n: number }[]>`select count(*)::int as n from public.site_visit_pages p join public.site_visits v on v.id = p.visit_id where v.ip = '198.51.100.7'`;
  assert.equal(row!.n, 0);
});
