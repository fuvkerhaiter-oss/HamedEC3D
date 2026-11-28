/** Building blocks of the shop renter dashboard (/seller). Server-safe (no hooks). */
import Link from "next/link";
import { signFont, signText } from "@/lib/rentals/sign-fonts";

export function PageTitle({ title, description, actions, eyebrow }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: string }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-light">{eyebrow}</p>}
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ title, description, actions, children, className = "", pad = true }: { title?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`rounded-2xl bg-white ring-1 ring-line shadow-card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            {title && <h2 className="font-display text-lg font-bold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-ink-soft">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={pad ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export function StatCard({ label, value, hint, href, tone = "default" }: { label: string; value: React.ReactNode; hint?: React.ReactNode; href?: string; tone?: "default" | "good" | "warn" }) {
  const body = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">{label}</p>
      <p className={`mt-1 font-display text-3xl font-extrabold ${tone === "good" ? "text-brand-light" : tone === "warn" ? "text-amber-deep" : ""}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-soft">{hint}</p>}
    </>
  );
  const cls = "block rounded-2xl bg-white p-5 ring-1 ring-line shadow-card";
  return href ? (
    <Link href={href} className={`${cls} transition hover:ring-ink/30`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

const TONES = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber/15 text-ink ring-amber/40",
  gray: "bg-sand text-ink-soft ring-line",
  red: "bg-red-50 text-red-700 ring-red-200",
  ink: "bg-ink text-white ring-ink",
} as const;

export function Pill({ children, tone = "gray" }: { children: React.ReactNode; tone?: keyof typeof TONES }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${TONES[tone]}`}>{children}</span>;
}

export function Callout({ tone = "info", title, children }: { tone?: "info" | "warn" | "bad" | "ok"; title?: string; children: React.ReactNode }) {
  const c = { info: "bg-sand/60 ring-line", warn: "bg-amber/10 ring-amber/40", bad: "bg-red-50 ring-red-200 text-red-900", ok: "bg-emerald-50 ring-emerald-200 text-emerald-900" }[tone];
  return (
    <div role={tone === "bad" ? "alert" : undefined} className={`rounded-2xl px-4 py-3 text-sm ring-1 ${c}`}>
      {title && <p className="font-bold">{title}</p>}
      <div className={title ? "mt-0.5" : ""}>{children}</div>
    </div>
  );
}

/** Small amber-on-ink preview of the shop's 3D fascia sign. */
export function SignPreview({ name, accent, fontId, pending }: { name: string; accent: string; fontId?: string | null; pending?: boolean }) {
  const f = signFont(fontId);
  return (
    <div className="rounded-xl bg-[#0d1311] p-1.5 ring-2" style={{ boxShadow: `0 0 0 2px ${accent}` }}>
      <div className="rounded-lg border border-white/10 px-4 py-3 text-center">
        <p
          className="truncate text-xl tracking-[0.06em]"
          style={{
            color: accent,
            fontFamily: `var(${f.cssVar}), "Arial Black", sans-serif`,
            fontWeight: f.weight,
          }}
        >
          {signText(name, f)}
        </p>
        <p className="mt-0.5 text-[10px] tracking-[0.3em] text-white/70">{pending ? "AWAITING APPROVAL" : "NOW OPEN"}</p>
      </div>
    </div>
  );
}
