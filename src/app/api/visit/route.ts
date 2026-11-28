import { cookies } from "next/headers";
import { ADMIN_COOKIE } from "@/lib/admin/guard";
import { getSql, isDbConfigured } from "@/lib/db/client";
import { logError } from "@/lib/log";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { anonymizeIp, cleanPath, geoFromHeaders, isTrackedPath, parseUserAgent, referrerHost, visitorKey } from "@/lib/visitors/parse";
import { recordHeartbeat, recordPageView } from "@/lib/visitors/service";

export const dynamic = "force-dynamic";

const done = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/**
 * Visitor log beacon (features/visitors/VisitBeacon.tsx): one call per page view, plus a "ping" every 2 minutes
 * while the tab is visible. IP, device and country are read here on the server, never trusted from the body.
 * Always answers 204 so the endpoint reveals nothing. Staff (admin cookie) are not counted.
 */
export async function POST(req: Request) {
  if (!isDbConfigured()) return done();
  const ip = clientIp(req);
  if (rateLimited(`visit:${ip}`, 90, 60_000)) return done();
  if ((await cookies()).get(ADMIN_COOKIE)) return done();

  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 2048) return done();
    body = JSON.parse(text) as Record<string, unknown>;
    if (!body || typeof body !== "object") return done();
  } catch {
    return done();
  }

  const ua = req.headers.get("user-agent")?.slice(0, 400) ?? null;
  const key = visitorKey(ip, ua);
  try {
    const db = getSql();
    if (body.t === "ping") {
      await recordHeartbeat(db, key);
      return done();
    }
    const path = cleanPath(body.path);
    if (!path || !isTrackedPath(path)) return done();
    const touch = typeof body.touch === "number" ? body.touch : null;
    const agent = parseUserAgent(ua, { mobile: req.headers.get("sec-ch-ua-mobile"), platform: req.headers.get("sec-ch-ua-platform"), touchPoints: touch });
    const geo = geoFromHeaders(req.headers);
    const screen = str(body.screen, 20);
    await recordPageView(db, {
      ip: anonymizeIp(ip),
      visitorKey: key,
      path,
      ...geo,
      timezone: geo.timezone ?? str(body.tz, 64),
      ...agent,
      userAgent: ua,
      language: str(body.lang, 20) ?? req.headers.get("accept-language")?.split(",")[0]?.trim().slice(0, 20) ?? null,
      screen: screen && /^\d{2,5}x\d{2,5}$/.test(screen) ? screen : null,
      referrerHost: referrerHost(body.ref, req.headers.get("x-forwarded-host") ?? req.headers.get("host")),
    });
  } catch (err) {
    logError("visit.record_failed", err);
  }
  return done();
}
