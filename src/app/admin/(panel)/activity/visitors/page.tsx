import Link from "next/link";
import { ActivityTabs } from "@/features/admin/ActivityTabs";
import { AutoRefresh } from "@/features/admin/AutoRefresh";
import { Badge, BarChart, Card, CsvLink, EmptyState, HBars, Notice, PageHeader, Pagination, Stat, Table, fmtDate } from "@/features/admin/ui";
import { resolveRange } from "@/lib/admin/date-range";
import { requirePage } from "@/lib/admin/guard";
import { getSql } from "@/lib/db/client";
import { countryName } from "@/lib/storefront/supporters";
import { flagEmoji, fmtDuration, isPrivateIp } from "@/lib/visitors/parse";
import { liveVisits, listVisits, pagesForVisits, visitCountries, visitReport, VISIT_RETENTION_DAYS, type VisitFilter, type VisitRow } from "@/lib/visitors/service";

export const metadata = { title: "Website visitors" };
export const dynamic = "force-dynamic";

const PERIODS = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days" } as const;
const DEVICES = { desktop: "Computer", mobile: "Phone", tablet: "Tablet", bot: "Bot / crawler", unknown: "Unknown" } as const;
const DEVICE_ICON: Record<string, string> = { desktop: "🖥️", mobile: "📱", tablet: "📲", bot: "🤖", unknown: "❔" };
const PAGE_SIZE = 50;

const pct = (n: number) => `${Math.round(n * 100)}%`;
const nf = new Intl.NumberFormat("en-GB");
const place = (code: string | null, ip?: string) => (code ? `${flagEmoji(code)} ${countryName(code)}` : ip && isPrivateIp(ip) ? "🏠 Local network" : "🌐 Unknown");

function change(now: number, before: number): string | undefined {
  if (!before) return now ? "new this period" : undefined;
  const d = (now - before) / before;
  return `${d >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(d * 100))}% vs previous period`;
}

function ago(d: Date): string {
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** The visitor's own clock when they came in (their time zone), e.g. "14:32 Europe/Rome". */
function localTime(d: Date, tz: string | null): string | null {
  if (!tz) return null;
  try {
    return `${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz })} their time (${tz})`;
  } catch {
    return null;
  }
}

export default async function VisitorsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requirePage("admins.manage"); // super admins only (IP addresses are personal data)
  const sp = await searchParams;
  const range = resolveRange({ range: sp.range && sp.range in PERIODS ? sp.range : "7d" });
  const page = Math.max(1, Number(sp.page) || 1);
  const filter: VisitFilter = { from: range.from, to: range.to, country: sp.country || undefined, device: sp.device || undefined, q: sp.q || undefined, bots: sp.bots === "1" };
  const db = getSql();

  let data;
  try {
    const [report, list, live, countries] = await Promise.all([visitReport(db, filter), listVisits(db, filter, page, PAGE_SIZE), liveVisits(db), visitCountries(db, range.from, range.to)]);
    data = { report, list, live, countries, pages: await pagesForVisits(db, list.rows.map((r) => r.id)) };
  } catch (err) {
    const missing = err instanceof Error && /site_visits/.test(err.message);
    return (
      <>
        <PageHeader title="Change history" description="Who visited your website, from where, on which device and when." />
        <ActivityTabs active="visitors" showVisitors />
        <Notice tone="warn" title={missing ? "The visitor log isn't set up yet" : "Couldn't load the visitor log"}>
          {missing ? "Run the database update (migration 20261201000001_site_visits.sql), then reload this page." : "Try again in a moment."}
        </Notice>
      </>
    );
  }
  const { report, list, live, countries, pages } = data;
  const s = report.summary;
  const params = { range: range.preset, country: sp.country, device: sp.device, q: sp.q, bots: sp.bots };
  const exportHref = `/api/admin/export/visitors?${new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]))}`;

  return (
    <>
      <PageHeader
        eyebrow={range.label}
        title="Change history"
        description="Who visited your website: their IP address, country and city, device, browser, the time they came in and the pages they saw."
        actions={<><AutoRefresh seconds={30} /><CsvLink href={exportHref}>Download CSV</CsvLink></>}
      />
      <ActivityTabs active="visitors" showVisitors={session.permissions.has("admins.manage")} />

      <form className="mb-5 flex flex-wrap items-center gap-2" aria-label="Filter visitors">
        <select name="range" defaultValue={range.preset} className="admin-input !w-auto !py-1.5" aria-label="Period">
          {Object.entries(PERIODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="country" defaultValue={sp.country ?? ""} className="admin-input !w-auto !py-1.5" aria-label="Country">
          <option value="">All countries</option>
          {countries.map((c) => <option key={c} value={c}>{place(c)}</option>)}
        </select>
        <select name="device" defaultValue={sp.device ?? ""} className="admin-input !w-auto !py-1.5" aria-label="Device">
          <option value="">All devices</option>
          {Object.entries(DEVICES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input name="q" defaultValue={sp.q} placeholder="IP, city, page, browser…" className="admin-input !w-56 !py-1.5" aria-label="Search visitors" />
        <label className="flex items-center gap-1.5 text-sm text-ink-soft">
          <input type="checkbox" name="bots" value="1" defaultChecked={sp.bots === "1"} /> Include bots
        </label>
        <button className="btn-ghost !py-1.5">Filter</button>
        {(sp.country || sp.device || sp.q || sp.bots) && <Link href={`?range=${range.preset}`} className="text-sm text-brand underline">Clear</Link>}
      </form>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Online now" value={<span className="inline-flex items-center gap-2">{report.liveNow > 0 && <span aria-hidden className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />}{nf.format(report.liveNow)}</span>} hint="Active in the last 5 minutes" />
        <Stat label="Visits" value={nf.format(s.visits)} hint={change(s.visits, report.previous.visits)} />
        <Stat label="Unique visitors" value={nf.format(s.visitors)} hint={change(s.visitors, report.previous.visitors)} />
        <Stat label="Pages viewed" value={nf.format(s.pageViews)} hint={s.visits ? `${(s.pageViews / s.visits).toFixed(1)} per visit` : undefined} />
        <Stat label="Average time on site" value={fmtDuration(s.avgDuration)} />
        <Stat label="Left after one page" value={pct(s.bounceRate)} hint="Bounce rate" tone={s.bounceRate > 0.7 && s.visits > 20 ? "warn" : "default"} />
        <Stat label="Returning visitors" value={s.visits ? pct(s.returning / s.visits) : "—"} hint={`${nf.format(s.returning)} visits from people who came before`} />
        <Stat label="Countries" value={nf.format(s.countries)} />
      </div>

      <Card title={`Visits ${report.hourly ? "per hour" : "per day"} (UTC)`} className="mb-5">
        <BarChart data={report.series.map((d) => ({ key: d.label, value: d.value }))} format={(n) => nf.format(n)} label="Visits" />
      </Card>

      {live.length > 0 && (
        <Card title={<span className="inline-flex items-center gap-2"><span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />On the website right now ({live.length})</span>} pad={false} className="mb-5">
          <Table head={["Visitor", "Where", "Device", "Looking at", "Arrived"]}>
            {live.map((v) => (
              <tr key={v.id}>
                <td className="font-mono text-xs">{v.ip}</td>
                <td className="text-sm">{place(v.country, v.ip)}{v.city && <span className="block text-xs text-ink-soft">{v.city}</span>}</td>
                <td className="text-xs">{DEVICE_ICON[v.device]} {[v.browser, v.os].filter(Boolean).join(" · ") || DEVICES[v.device]}</td>
                <td className="font-mono text-xs">{v.last_path}</td>
                <td className="whitespace-nowrap text-xs text-ink-soft">{ago(v.started_at)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Breakdown title="Countries" rows={report.countries.map((c) => ({ label: place(c.code), value: c.value, href: c.code ? `?${new URLSearchParams({ range: range.preset, country: c.code })}` : undefined }))} total={s.visits} />
        <Breakdown title="Cities" rows={report.cities} total={s.visits} empty="City needs the hosting platform's location data (Vercel adds it automatically)." />
        <Breakdown title="Devices" rows={report.devices.map((d) => ({ label: `${DEVICE_ICON[d.label] ?? ""} ${DEVICES[d.label as keyof typeof DEVICES] ?? d.label}`, value: d.value, href: `?${new URLSearchParams({ range: range.preset, device: d.label })}` }))} total={s.visits} />
        <Breakdown title="Browsers" rows={report.browsers} total={s.visits} />
        <Breakdown title="Operating systems" rows={report.os} total={s.visits} />
        <Breakdown title="Where they came from" rows={report.referrers.map((r) => ({ ...r, label: r.label === "—" ? "Direct / typed the address" : r.label }))} total={s.visits} />
        <Breakdown title="First page they opened" rows={report.landing} total={s.visits} mono />
        <Card title="Busiest hours (UTC)">
          <BarChart data={report.hours.map((h) => ({ key: h.label, value: h.value }))} format={(n) => nf.format(n)} label="Visits by hour of day" />
        </Card>
      </div>

      <Card title="Visit log" actions={<span className="text-xs text-ink-soft">Newest first · kept {VISIT_RETENTION_DAYS} days · your own admin visits are not counted</span>} pad={false}>
        {list.rows.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No visits found">Visits appear here a few seconds after someone opens your website. Try a longer period or clear the filters.</EmptyState>
          </div>
        ) : (
          <Table head={["Came in", "IP address", "Location", "Device", "Visit", "Source"]}>
            {list.rows.map((v) => <VisitTr key={v.id} v={v} pages={pages.get(v.id) ?? []} rangePreset={range.preset} />)}
          </Table>
        )}
        <Pagination page={page} total={list.total} pageSize={PAGE_SIZE} params={params} />
      </Card>
    </>
  );
}

function Breakdown({ title, rows, total, empty, mono }: { title: string; rows: { label: string; value: number; href?: string }[]; total: number; empty?: string; mono?: boolean }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-soft">{empty ?? "No data in this period."}</p>
      ) : (
        <>
          <div className={mono ? "[&_li>span:first-child]:font-mono [&_li>span:first-child]:text-xs" : ""}>
            <HBars rows={rows} format={(n) => `${nf.format(n)}${total ? ` · ${pct(n / total)}` : ""}`} />
          </div>
          {rows.some((r) => r.href) && (
            <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {rows.filter((r) => r.href).slice(0, 8).map((r) => <Link key={r.label} href={r.href!} className="text-brand underline">{r.label}</Link>)}
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function VisitTr({ v, pages, rangePreset }: { v: VisitRow; pages: { path: string; viewed_at: Date }[]; rangePreset: string }) {
  const local = localTime(v.started_at, v.timezone);
  return (
    <tr className="align-top">
      <td className="whitespace-nowrap text-xs">
        <span className="font-medium text-ink">{fmtDate(v.started_at)}</span>
        <span className="block text-ink-soft">{ago(v.started_at)}</span>
        {local && <span className="block text-[11px] text-ink-soft">{local}</span>}
      </td>
      <td className="min-w-[9rem] text-xs">
        <Link href={`?${new URLSearchParams({ range: rangePreset, q: v.ip })}`} className="font-mono text-ink underline decoration-line underline-offset-2 hover:decoration-brand" title="Show every visit from this IP">{v.ip}</Link>
        <span className="mt-1 flex flex-wrap gap-1">
          {v.online && <Badge tone="green">Online</Badge>}
          {v.is_bot ? <Badge tone="amber">Bot</Badge> : v.is_returning ? <Badge tone="blue">Returning</Badge> : <Badge>New</Badge>}
          {v.visits_by_ip > 1 && <Badge>{v.visits_by_ip} visits</Badge>}
        </span>
      </td>
      <td className="min-w-[9rem] text-sm">
        {place(v.country, v.ip)}
        {(v.city || v.region) && <span className="block text-xs text-ink-soft">{[v.city, v.region].filter(Boolean).join(", ")}</span>}
        {v.language && <span className="block text-[11px] text-ink-soft">Language {v.language}</span>}
      </td>
      <td className="min-w-[11rem] text-xs">
        <span className="whitespace-nowrap font-medium">{DEVICE_ICON[v.device]} {DEVICES[v.device]}</span>
        <span className="block text-ink-soft">{[v.browser, v.os].filter(Boolean).join(" · ") || "—"}</span>
        {v.screen && <span className="block text-[11px] text-ink-soft">Screen {v.screen}</span>}
        {v.user_agent && (
          <details className="mt-1">
            <summary className="cursor-pointer text-[11px] text-ink-soft">User agent</summary>
            <p className="mt-1 max-w-xs break-all font-mono text-[10px] text-ink-soft">{v.user_agent}</p>
          </details>
        )}
      </td>
      <td className="min-w-[11rem] text-xs">
        <span className="whitespace-nowrap font-medium">{v.page_views} page{v.page_views === 1 ? "" : "s"} · {fmtDuration(v.duration_s)}</span>
        <span className="block font-mono text-[11px] text-ink-soft">→ {v.landing_path}</span>
        {pages.length > 1 && (
          <details className="mt-1">
            <summary className="cursor-pointer text-[11px] text-brand">Pages they saw</summary>
            <ol className="mt-1 max-h-48 space-y-0.5 overflow-auto font-mono text-[11px]">
              {pages.map((p, i) => (
                <li key={i} className="flex gap-2"><span className="text-ink-soft">{p.viewed_at.toISOString().slice(11, 19)}</span><span className="break-all">{p.path}</span></li>
              ))}
            </ol>
          </details>
        )}
      </td>
      <td className="text-xs">{v.referrer_host ?? <span className="text-ink-soft">Direct</span>}</td>
    </tr>
  );
}
