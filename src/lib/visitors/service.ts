/** Visitor log (site_visits / site_visit_pages): recording from /api/visit and the super-admin reports. Server only. */
import type { Db, Sql, Tx } from "../db/client";
import type { DeviceType } from "./parse";

/** A visit ends after this long without a page view or heartbeat. */
export const VISIT_IDLE_MINUTES = 30;
/** "Online now" = seen within this many minutes. */
export const LIVE_MINUTES = 5;
/** Rows older than this are deleted by the daily maintenance cron (keep in step with the privacy policy). */
export const VISIT_RETENTION_DAYS = 90;
/** A single visit never records more pages than this (runaway tab, script). */
const MAX_PAGES_PER_VISIT = 300;
/** Heartbeats stop extending a visit after this long (a tab left open overnight is not a 10-hour visit). */
const MAX_VISIT_HOURS = 6;

export interface VisitInput {
  ip: string;
  visitorKey: string;
  path: string;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  device: DeviceType;
  os: string | null;
  browser: string | null;
  isBot: boolean;
  userAgent: string | null;
  language: string | null;
  screen: string | null;
  referrerHost: string | null;
}

/**
 * A page view: continues the open visit of this browser, or starts a new one. Serialised per browser
 * (transaction advisory lock), so two beacons arriving at the same moment can't open two visits.
 */
export async function recordPageView(sql: Sql, v: VisitInput): Promise<{ visitId: string; created: boolean }> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${"visit:" + v.visitorKey}, 0))`;
    return pageViewLocked(tx as unknown as Tx, v);
  }) as Promise<{ visitId: string; created: boolean }>;
}

async function pageViewLocked(db: Tx, v: VisitInput): Promise<{ visitId: string; created: boolean }> {
  const [open] = await db<{ id: string; last_path: string; recent: boolean; page_views: number }[]>`
    select id, last_path, page_views, last_seen_at > now() - interval '3 seconds' as recent from public.site_visits
     where visitor_key = ${v.visitorKey} and last_seen_at > now() - make_interval(mins => ${VISIT_IDLE_MINUTES})
     order by last_seen_at desc limit 1`;
  if (open) {
    // The same page again within 3 s (double render, quick reload) is one view.
    const repeat = open.recent && open.last_path === v.path;
    const count = !repeat && open.page_views < MAX_PAGES_PER_VISIT;
    await db`
      update public.site_visits set last_seen_at = now(), last_path = ${v.path},
             page_views = page_views + ${count ? 1 : 0}
       where id = ${open.id}`;
    if (count) await db`insert into public.site_visit_pages (visit_id, path) values (${open.id}, ${v.path})`;
    return { visitId: open.id, created: false };
  }
  const [row] = await db<{ id: string }[]>`
    insert into public.site_visits (ip, visitor_key, country, region, city, timezone, device, os, browser, is_bot, user_agent,
                                    language, screen, landing_path, last_path, referrer_host, is_returning)
    values (${v.ip}, ${v.visitorKey}, ${v.country}, ${v.region}, ${v.city}, ${v.timezone}, ${v.device}, ${v.os}, ${v.browser}, ${v.isBot},
            ${v.userAgent}, ${v.language}, ${v.screen}, ${v.path}, ${v.path}, ${v.referrerHost},
            exists (select 1 from public.site_visits where visitor_key = ${v.visitorKey}))
    returning id`;
  await db`insert into public.site_visit_pages (visit_id, path) values (${row!.id}, ${v.path})`;
  return { visitId: row!.id, created: true };
}

/** "Still here" ping from an open tab: keeps the visit (and "online now") alive. Never creates a visit. */
export async function recordHeartbeat(db: Db, visitorKey: string): Promise<boolean> {
  const rows = await db`
    update public.site_visits set last_seen_at = now()
     where id = (select id from public.site_visits
                  where visitor_key = ${visitorKey} and last_seen_at > now() - make_interval(mins => ${VISIT_IDLE_MINUTES})
                    and started_at > now() - make_interval(hours => ${MAX_VISIT_HOURS})
                  order by last_seen_at desc limit 1)`;
  return rows.count > 0;
}

/** Daily cron: delete visits past the retention period (their pages go with them). */
export async function purgeOldVisits(db: Db): Promise<number> {
  const rows = await db`delete from public.site_visits where started_at < now() - make_interval(days => ${VISIT_RETENTION_DAYS})`;
  return rows.count;
}

// ---------------------------------------------------------------- reports

export interface VisitFilter {
  from: Date;
  to: Date;
  country?: string;
  device?: string;
  q?: string;
  bots?: boolean;
}

export interface VisitRow {
  id: string;
  ip: string;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  device: DeviceType;
  os: string | null;
  browser: string | null;
  is_bot: boolean;
  user_agent: string | null;
  language: string | null;
  screen: string | null;
  landing_path: string;
  last_path: string;
  referrer_host: string | null;
  page_views: number;
  is_returning: boolean;
  started_at: Date;
  last_seen_at: Date;
  duration_s: number;
  online: boolean;
  visits_by_ip: number;
}

const normQ = (q: string | undefined) => (q ?? "").trim().slice(0, 100);
const normCountry = (c: string | undefined) => (c && /^[A-Z]{2}$/.test(c) ? c : null);
const normDevice = (d: string | undefined) => (d && ["desktop", "mobile", "tablet", "bot", "unknown"].includes(d) ? d : null);

/** The shared WHERE clause (postgres.js fragment). */
function where(db: Db, f: VisitFilter) {
  const q = normQ(f.q);
  const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const country = normCountry(f.country);
  const device = normDevice(f.device);
  return db`
    v.started_at >= ${f.from} and v.started_at < ${f.to}
    and (${!!f.bots}::boolean or not v.is_bot)
    and (${country}::text is null or v.country = ${country})
    and (${device}::text is null or v.device = ${device})
    and (${q} = '' or v.ip = ${q} or v.ip ilike ${like} or v.city ilike ${like} or v.region ilike ${like}
         or v.landing_path ilike ${like} or v.referrer_host ilike ${like} or v.browser ilike ${like} or v.os ilike ${like})`;
}

export async function listVisits(db: Db, f: VisitFilter, page = 1, pageSize = 50): Promise<{ rows: VisitRow[]; total: number }> {
  const size = Math.min(Math.max(pageSize, 1), 200);
  const p = Math.max(1, page);
  const rows = await db<(VisitRow & { total: number })[]>`
    select v.id, v.ip, v.country, v.region, v.city, v.timezone, v.device, v.os, v.browser, v.is_bot, v.user_agent, v.language, v.screen,
           v.landing_path, v.last_path, v.referrer_host, v.page_views, v.is_returning, v.started_at, v.last_seen_at,
           extract(epoch from v.last_seen_at - v.started_at)::int as duration_s,
           v.last_seen_at > now() - make_interval(mins => ${LIVE_MINUTES}) as online,
           (select count(*)::int from public.site_visits x where x.ip = v.ip) as visits_by_ip,
           count(*) over ()::int as total
      from public.site_visits v
     where ${where(db, f)}
     order by v.started_at desc, v.id
     limit ${size} offset ${(p - 1) * size}`;
  return { rows, total: rows[0]?.total ?? 0 };
}

/** Pages seen during each visit, oldest first. */
export async function pagesForVisits(db: Db, ids: string[]): Promise<Map<string, { path: string; viewed_at: Date }[]>> {
  const out = new Map<string, { path: string; viewed_at: Date }[]>();
  if (!ids.length) return out;
  const rows = await db<{ visit_id: string; path: string; viewed_at: Date }[]>`
    select visit_id, path, viewed_at from public.site_visit_pages where visit_id = any(${ids}::uuid[]) order by viewed_at, id`;
  for (const r of rows) {
    const list = out.get(r.visit_id) ?? [];
    list.push({ path: r.path, viewed_at: r.viewed_at });
    out.set(r.visit_id, list);
  }
  return out;
}

export interface VisitSummary {
  visits: number;
  visitors: number;
  pageViews: number;
  avgDuration: number;
  bounceRate: number; // 0..1, visits with one page
  returning: number;
  countries: number;
}

export interface Breakdown {
  label: string;
  value: number;
}

export interface VisitReport {
  summary: VisitSummary;
  previous: Pick<VisitSummary, "visits" | "visitors">;
  liveNow: number;
  series: Breakdown[];
  hourly: boolean;
  countries: (Breakdown & { code: string | null })[];
  cities: Breakdown[];
  devices: Breakdown[];
  browsers: Breakdown[];
  os: Breakdown[];
  landing: Breakdown[];
  referrers: Breakdown[];
  hours: Breakdown[];
}

const HOUR = 3_600_000;

export async function visitReport(db: Db, f: VisitFilter): Promise<VisitReport> {
  const w = () => where(db, f);
  const len = f.to.getTime() - f.from.getTime();
  const prev = { ...f, from: new Date(f.from.getTime() - len), to: f.from };
  const hourly = len <= 2 * 24 * HOUR;
  const stepS = hourly ? 3600 : 86400;

  const top = (col: string, limit = 10) => db<Breakdown[]>`
    select coalesce(${db(col)}, '—') as label, count(*)::int as value from public.site_visits v
     where ${w()} group by 1 order by 2 desc, 1 limit ${limit}`;

  const [sumRows, prevRows, liveRows, seriesRows, countries, cities, devices, browsers, os, landing, referrers, hours] = await Promise.all([
    db<{ visits: number; visitors: number; page_views: number; avg_duration: number; bounces: number; returning: number; countries: number }[]>`
      select count(*)::int as visits, count(distinct v.visitor_key)::int as visitors, coalesce(sum(v.page_views), 0)::int as page_views,
             coalesce(avg(extract(epoch from v.last_seen_at - v.started_at)), 0)::float as avg_duration,
             count(*) filter (where v.page_views <= 1)::int as bounces, count(*) filter (where v.is_returning)::int as returning,
             count(distinct v.country)::int as countries
        from public.site_visits v where ${w()}`,
    db<{ visits: number; visitors: number }[]>`
      select count(*)::int as visits, count(distinct v.visitor_key)::int as visitors from public.site_visits v where ${where(db, prev)}`,
    db<{ n: number }[]>`
      select count(*)::int as n from public.site_visits where not is_bot and last_seen_at > now() - make_interval(mins => ${LIVE_MINUTES})`,
    db<{ t: number; value: number }[]>`
      select (floor(extract(epoch from v.started_at) / ${stepS}) * ${stepS})::bigint as t, count(*)::int as value from public.site_visits v
       where ${w()} group by 1 order by 1`,
    db<(Breakdown & { code: string | null })[]>`
      select v.country as code, coalesce(v.country, '—') as label, count(*)::int as value from public.site_visits v
       where ${w()} group by 1 order by 3 desc, 1 limit 15`,
    db<Breakdown[]>`
      select concat_ws(', ', v.city, v.country) as label, count(*)::int as value from public.site_visits v
       where ${w()} and v.city is not null group by 1 order by 2 desc, 1 limit 10`,
    top("v.device", 6),
    db<Breakdown[]>`
      select coalesce(regexp_replace(v.browser, ' [0-9]+$', ''), '—') as label, count(*)::int as value from public.site_visits v
       where ${w()} group by 1 order by 2 desc, 1 limit 8`,
    db<Breakdown[]>`
      select coalesce(regexp_replace(v.os, ' [0-9]+$', ''), '—') as label, count(*)::int as value from public.site_visits v
       where ${w()} group by 1 order by 2 desc, 1 limit 8`,
    top("v.landing_path", 10),
    top("v.referrer_host", 10),
    db<Breakdown[]>`
      select lpad(extract(hour from v.started_at at time zone 'UTC')::int::text, 2, '0') as label, count(*)::int as value
        from public.site_visits v where ${w()} group by 1 order by 1`,
  ]);

  // Zero-filled time series.
  const step = hourly ? HOUR : 24 * HOUR;
  const counts = new Map(seriesRows.map((r) => [Number(r.t) * 1000, r.value]));
  const series: Breakdown[] = [];
  for (let t = Math.floor(f.from.getTime() / step) * step; t < f.to.getTime() && series.length < 400; t += step) {
    const iso = new Date(t).toISOString();
    series.push({ label: hourly ? `${iso.slice(5, 10)} ${iso.slice(11, 13)}:00` : iso.slice(0, 10), value: counts.get(t) ?? 0 });
  }
  const hourMap = new Map(hours.map((h) => [h.label, h.value]));
  const s = sumRows[0]!;
  return {
    summary: {
      visits: s.visits, visitors: s.visitors, pageViews: s.page_views, avgDuration: s.avg_duration,
      bounceRate: s.visits ? s.bounces / s.visits : 0, returning: s.returning, countries: s.countries,
    },
    previous: prevRows[0] ?? { visits: 0, visitors: 0 },
    liveNow: liveRows[0]?.n ?? 0,
    series,
    hourly,
    countries,
    cities,
    devices,
    browsers,
    os,
    landing,
    referrers,
    hours: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).map((h) => ({ label: `${h}:00`, value: hourMap.get(h) ?? 0 })),
  };
}

/** Visitors on the site right now (seen within LIVE_MINUTES), newest first. */
export async function liveVisits(db: Db, limit = 20) {
  return db<Pick<VisitRow, "id" | "ip" | "country" | "city" | "device" | "browser" | "os" | "last_path" | "started_at" | "last_seen_at">[]>`
    select id, ip, country, city, device, browser, os, last_path, started_at, last_seen_at from public.site_visits
     where not is_bot and last_seen_at > now() - make_interval(mins => ${LIVE_MINUTES})
     order by last_seen_at desc limit ${limit}`;
}

/** Distinct countries seen in the period (for the filter menu). */
export async function visitCountries(db: Db, from: Date, to: Date): Promise<string[]> {
  const rows = await db<{ country: string }[]>`
    select distinct country from public.site_visits where started_at >= ${from} and started_at < ${to} and country is not null order by 1`;
  return rows.map((r) => r.country);
}
