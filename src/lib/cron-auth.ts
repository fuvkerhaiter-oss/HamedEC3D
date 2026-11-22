import { timingSafeEqual } from "node:crypto";

/** Vercel Cron / external scheduler auth: `Authorization: Bearer $CRON_SECRET` (≥ 16 chars), constant-time compare. */
export function isCronAuthorized(req: Request, secret = process.env.CRON_SECRET ?? ""): boolean {
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return secret.length >= 16 && given.length === expected.length && timingSafeEqual(given, expected);
}
