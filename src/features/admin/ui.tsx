/** Server-safe admin UI primitives (brand tokens from globals.css). */
import Link from "next/link";
import { formatMoney, isCurrencyCode, money } from "@/lib/money";

export function fmtMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || !currency || !isCurrencyCode(currency)) return "—";
  return formatMoney(money(amount, currency), currency === "EUR" ? "it-IT" : "en-US");
}

export function fmtDate(d: Date | string | null | undefined, withTime = true): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}), timeZone: "UTC" }) + (withTime ? " UTC" : "");
}

export function PageHeader({ title, eyebrow, description, actions }: { title: string; eyebrow?: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="text-sm font-medium text-brand">{eyebrow}</p>}
        <h1 className="mt-1 font-display text-3xl leading-tight sm:text-4xl">{title}</h1>
        {description && <div className="mt-2 max-w-2xl text-sm text-ink-soft">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "", pad = true }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`rounded-2xl border border-line bg-white ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {actions}
        </header>
      )}
      <div className={pad ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone = "default", href }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "default" | "warn" | "bad"; href?: string }) {
  const body = (
    <>
      <p className="text-sm font-medium text-ink-soft">{label}</p>
      <p className={`mt-2 font-display text-2xl leading-none sm:text-3xl ${tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : ""}`}>{value}</p>
      {hint && <p className="mt-2 text-xs text-ink-soft">{hint}</p>}
    </>
  );
  const cls = "block rounded-2xl border border-line bg-white p-4 sm:p-5";
  return href ? <Link href={href} className={`${cls} transition hover:border-ink/30`}>{body}</Link> : <div className={cls}>{body}</div>;
}

const TONES: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  gray: "bg-sand/60 text-ink-soft ring-line",
  ink: "bg-ink text-cream ring-ink",
};

const STATUS_TONE: Record<string, keyof typeof TONES> = {
  published: "green", draft: "gray", archived: "amber", deleted: "red",
  pending_payment: "amber", paid: "blue", processing: "blue", submitted_to_supplier: "blue", supplier_accepted: "blue",
  shipped: "green", delivered: "green", cancelled: "gray", refund_requested: "amber", refunded: "gray", failed: "red",
  pending: "amber", succeeded: "green", partially_refunded: "amber", manual: "green", submitting: "amber", submitted: "green", manual_required: "amber",
  approved: "green", rejected: "red", hidden: "gray", not_configured: "gray", sent: "green", queued: "amber",
  in_transit: "blue", out_for_delivery: "blue", exception: "red", label_created: "gray", unpublished: "gray",
  info: "blue", warning: "amber", critical: "red",
};

export function Badge({ children, tone = "gray" }: { children: React.ReactNode; tone?: keyof typeof TONES }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TONES[tone]}`}>{children}</span>;
}

/** Plain-language names for stored status codes (orders, products, payments, shipments…). */
export const STATUS_LABEL: Record<string, string> = {
  // orders
  pending_payment: "Waiting for payment", paid: "Paid – ready to send", processing: "Being prepared",
  submitted_to_supplier: "Sent to supplier", supplier_accepted: "Supplier confirmed", shipped: "Shipped",
  delivered: "Delivered", cancelled: "Cancelled", refund_requested: "Refund asked", refunded: "Refunded", failed: "Failed",
  // products / pages
  published: "Live in shop", draft: "Draft (hidden)", archived: "Archived (hidden)", deleted: "Deleted", unpublished: "Hidden",
  // payments, refunds, supplier orders, emails
  pending: "Pending", succeeded: "Received", partially_refunded: "Partly refunded", manual: "Done by hand",
  submitting: "Sending…", submitted: "Placed with supplier", manual_required: "You must place it",
  not_configured: "Not set up", sent: "Sent", queued: "Waiting to send",
  // reviews
  approved: "Approved", rejected: "Rejected", hidden: "Hidden",
  // shipments
  label_created: "Label created", in_transit: "On the way", out_for_delivery: "Out for delivery", exception: "Delivery problem",
  // alerts
  info: "Info", warning: "Warning", critical: "Urgent",
};

/** One-sentence explanation shown when hovering an order status. */
export const ORDER_STATUS_HELP: Record<string, string> = {
  pending_payment: "The customer has not paid yet. Unpaid orders cancel themselves after 25 hours.",
  paid: "The customer paid. You now need to send the order to your supplier.",
  processing: "You are preparing this order.",
  submitted_to_supplier: "The order was sent to the supplier. Waiting for them to confirm.",
  supplier_accepted: "The supplier confirmed. Add the tracking number when it ships.",
  shipped: "The parcel is on its way to the customer.",
  delivered: "The customer received the parcel. Nothing more to do.",
  cancelled: "This order was cancelled. Nothing more to do.",
  refund_requested: "The customer asked for their money back.",
  refunded: "The money was given back to the customer.",
  failed: "The payment did not go through.",
};

export const statusLabel = (status: string) => STATUS_LABEL[status] ?? status.replace(/_/g, " ");

export function StatusBadge({ status }: { status: string }) {
  return (
    <span title={ORDER_STATUS_HELP[status]}>
      <Badge tone={STATUS_TONE[status] ?? "gray"}>{statusLabel(status)}</Badge>
    </span>
  );
}

export function TestBadge() {
  return <Badge tone="amber">TEST</Badge>;
}

export function SampleBadge() {
  return <Badge tone="ink">Sample</Badge>;
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-white/60 px-6 py-12 text-center">
      <p className="font-display text-xl">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-ink-soft">{children}</div>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "bad" | "ok"; title?: string; children: React.ReactNode }) {
  const cls = { info: "border-sky-200 bg-sky-50 text-sky-900", warn: "border-amber-200 bg-amber-50 text-amber-900", bad: "border-red-200 bg-red-50 text-red-900", ok: "border-emerald-200 bg-emerald-50 text-emerald-900" }[tone];
  return (
    <div role={tone === "bad" ? "alert" : "note"} className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? "mt-1" : ""}>{children}</div>
    </div>
  );
}

/** Horizontally scrollable table wrapper (no page-level horizontal scroll on phones). */
export function Table({ head, children, empty }: { head: React.ReactNode[]; children: React.ReactNode; empty?: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            {head.map((h, i) => (
              <th key={i} scope="col" className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-ink-soft">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/70 [&_td]:px-4 [&_td]:py-2.5 [&_td]:align-middle">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export function Pagination({ page, total, pageSize, params }: { page: number; total: number; pageSize: number; params: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="px-4 py-3 text-sm text-ink-soft">{total} result{total === 1 ? "" : "s"}</p>;
  const href = (p: number) => "?" + new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter((e): e is [string, string] => !!e[1])).toString();
  return (
    <nav className="flex items-center justify-between gap-2 px-4 py-3 text-sm" aria-label="Pagination">
      <span className="text-sm text-ink-soft">{total} results · page {page} of {pages}</span>
      <span className="flex gap-2">
        {page > 1 && <Link className="btn-ghost" href={href(page - 1)}>← Previous page</Link>}
        {page < pages && <Link className="btn-ghost" href={href(page + 1)}>Next page →</Link>}
      </span>
    </nav>
  );
}

export function Field({ label, hint, children, error }: { label: string; hint?: React.ReactNode; children: React.ReactNode; error?: string }) {
  // The hint sits outside <label> so the control's accessible name is just the label text.
  return (
    <div className="text-sm">
      <label className="block">
        <span className="font-medium">{label}</span>
        <div className="mt-1">{children}</div>
      </label>
      {hint && !error && <span className="mt-1 block text-xs text-ink-soft">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-700">{error}</span>}
    </div>
  );
}

export const inputCls = "admin-input";

/** Minimal SVG bar chart (single series, zero-filled days). Native hover titles; values also in the table view. */
export function BarChart({ data, format, label }: { data: { key: string; value: number }[]; format: (n: number) => string; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 640, h = 160, gap = 2;
  const bw = Math.max(1, (w - gap * (data.length - 1)) / Math.max(1, data.length));
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${h + 18}`} className="h-44 w-full" role="img" aria-label={`${label}: total ${format(total)}`}>
        {[0.5, 1].map((f) => (
          <line key={f} x1={0} x2={w} y1={h - h * f} y2={h - h * f} stroke="var(--color-line)" strokeDasharray="2 4" />
        ))}
        <line x1={0} x2={w} y1={h} y2={h} stroke="var(--color-line)" />
        {data.map((d, i) => {
          const bh = d.value === 0 ? 0 : Math.max(2, (d.value / max) * (h - 8));
          return (
            <g key={d.key}>
              <rect x={i * (bw + gap)} y={0} width={bw} height={h} fill="transparent">
                <title>{`${d.key}: ${format(d.value)}`}</title>
              </rect>
              {bh > 0 && (
                <rect x={i * (bw + gap)} y={h - bh} width={bw} height={bh} rx={Math.min(4, bw / 2)} fill="var(--color-brand)" className="pointer-events-none">
                  <title>{`${d.key}: ${format(d.value)}`}</title>
                </rect>
              )}
            </g>
          );
        })}
        <text x={0} y={h + 14} fontSize="10" fill="var(--color-ink-soft)" fontFamily="var(--font-mono)">{data[0]?.key}</text>
        <text x={w} y={h + 14} fontSize="10" fill="var(--color-ink-soft)" fontFamily="var(--font-mono)" textAnchor="end">{data.at(-1)?.key}</text>
        <text x={w} y={10} fontSize="10" fill="var(--color-ink-soft)" fontFamily="var(--font-mono)" textAnchor="end">max {format(max)}</text>
      </svg>
      <details className="mt-1 text-xs text-ink-soft">
        <summary className="cursor-pointer">Show the numbers</summary>
        <div className="mt-2 max-h-48 overflow-auto font-mono">
          {data.filter((d) => d.value).map((d) => <div key={d.key} className="flex justify-between gap-4"><span>{d.key}</span><span>{format(d.value)}</span></div>)}
          {total === 0 && <p>No data in this period.</p>}
        </div>
      </details>
    </figure>
  );
}

/** Horizontal bars for categorical breakdowns (single hue, labels in ink). */
export function HBars({ rows, format = String }: { rows: { label: string; value: number }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm" title={`${r.label}: ${format(r.value)}`}>
          <span className="truncate text-ink-soft">{r.label}</span>
          <span className="h-2 rounded-full bg-sand/70"><span className="block h-2 rounded-full bg-brand" style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="font-mono text-xs">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Plain anchor for file downloads (CSV route handlers are not pages, so next/link doesn't apply). */
export function CsvLink({ href, children, className = "btn-ghost" }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a href={href} className={className} download>{children}</a>
  );
}
