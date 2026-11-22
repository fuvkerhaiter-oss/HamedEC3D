/**
 * Minimal AliExpress Open Platform (IOP) client: signed "sync" calls.
 * Protocol: POST form params {method, app_key, timestamp(ms), sign_method=sha256, access_token, ...business params};
 * sign = uppercase hex HMAC-SHA256(app_secret, concat of every param key+value sorted by key).
 * Server-side only. Credentials come from env (never NEXT_PUBLIC_*). Nothing is logged except method + error code.
 *
 * VERIFY before going live: check the method names and parameter shapes against the API console of YOUR
 * approved app (openservice.aliexpress.com). This client is unit-tested against recorded-shape fakes only.
 */
import { createHmac } from "node:crypto";
import { SupplierError } from "../types";

export interface IopConfig {
  appKey: string;
  appSecret: string;
  accessToken: string;
  /** Default https://api-sg.aliexpress.com/sync */
  endpoint?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export function iopSign(params: Record<string, string>, secret: string): string {
  const base = Object.keys(params)
    .filter((k) => k !== "sign")
    .sort()
    .map((k) => k + params[k])
    .join("");
  return createHmac("sha256", secret).update(base, "utf8").digest("hex").toUpperCase();
}

/** System APIs on the /rest gateway (e.g. /auth/token/create) sign apiPath + sorted key+value. */
export function iopSignRest(apiPath: string, params: Record<string, string>, secret: string): string {
  const base = apiPath + Object.keys(params).filter((k) => k !== "sign").sort().map((k) => k + params[k]).join("");
  return createHmac("sha256", secret).update(base, "utf8").digest("hex").toUpperCase();
}

export type IopParams = Record<string, string | number | boolean | object | undefined | null>;

const toStr = (v: IopParams[string]): string | undefined =>
  v === undefined || v === null ? undefined : typeof v === "object" ? JSON.stringify(v) : String(v);

export function createIopClient(cfg: IopConfig) {
  const endpoint = cfg.endpoint ?? "https://api-sg.aliexpress.com/sync";
  const doFetch = cfg.fetch ?? fetch;
  const now = cfg.now ?? Date.now;

  return {
    /** Calls `method` and returns the inner `<method>_response` object. Throws SupplierError on API / HTTP errors. */
    async call<T = Record<string, unknown>>(method: string, business: IopParams, signal: AbortSignal): Promise<T> {
      const params: Record<string, string> = {
        method,
        app_key: cfg.appKey,
        timestamp: String(now()),
        sign_method: "sha256",
        access_token: cfg.accessToken,
      };
      for (const [k, v] of Object.entries(business)) {
        const s = toStr(v);
        if (s !== undefined) params[k] = s;
      }
      params.sign = iopSign(params, cfg.appSecret);

      let res: Response;
      try {
        res = await doFetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
          body: new URLSearchParams(params).toString(),
          signal,
        });
      } catch (e) {
        if (signal.aborted) throw new SupplierError(`AliExpress ${method}: aborted`, "timeout");
        throw new SupplierError(`AliExpress ${method}: network error ${(e as Error).message}`, "unavailable");
      }
      if (res.status === 429) throw new SupplierError(`AliExpress ${method}: rate limited`, "rate_limited");
      if (res.status >= 500) throw new SupplierError(`AliExpress ${method}: HTTP ${res.status}`, "unavailable");
      let body: Record<string, unknown>;
      try {
        body = (await res.json()) as Record<string, unknown>;
      } catch {
        throw new SupplierError(`AliExpress ${method}: invalid JSON (HTTP ${res.status})`, "unavailable");
      }
      const err = iopError(body);
      if (err) throw new SupplierError(`AliExpress ${method}: ${err.code}${err.msg ? ` — ${err.msg}` : ""}`, classify(err.code));
      const key = `${method.replace(/\./g, "_")}_response`;
      const inner = body[key];
      if (!inner || typeof inner !== "object") throw new SupplierError(`AliExpress ${method}: missing ${key}`, "unknown");
      return inner as T;
    },
  };
}

export type IopClient = ReturnType<typeof createIopClient>;

function iopError(body: Record<string, unknown>): { code: string; msg: string } | null {
  const er = body.error_response as { code?: unknown; msg?: unknown; sub_code?: unknown; sub_msg?: unknown } | undefined;
  if (er) return { code: String(er.sub_code ?? er.code ?? "error"), msg: String(er.sub_msg ?? er.msg ?? "") };
  if (body.code !== undefined && String(body.code) !== "0") return { code: String(body.code), msg: String(body.message ?? "") };
  return null;
}

function classify(code: string): SupplierError["kind"] {
  const c = code.toLowerCase();
  if (c.includes("accesstoken") || c.includes("signature") || c.includes("appkey") || c.includes("auth") || c.includes("permission")) return "auth";
  if (c.includes("frequency") || c.includes("limit") || c.includes("flow")) return "rate_limited";
  if (c.includes("isp.") || c.includes("service") || c.includes("timeout")) return "unavailable";
  if (c.includes("param") || c.includes("missing") || c.includes("invalid")) return "invalid_request";
  return "rejected";
}
