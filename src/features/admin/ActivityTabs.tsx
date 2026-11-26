import Link from "next/link";

/** Tabs on Change history: admin changes (everyone with activity.view) and the visitor log (super admins). */
export function ActivityTabs({ active, showVisitors }: { active: "changes" | "visitors"; showVisitors: boolean }) {
  const tabs = [
    { key: "changes", href: "/admin/activity", label: "Admin changes" },
    ...(showVisitors ? [{ key: "visitors", href: "/admin/activity/visitors", label: "Website visitors" }] : []),
  ];
  if (tabs.length < 2) return null;
  return (
    <nav className="mb-5 flex gap-1 border-b border-line" aria-label="Change history sections">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition ${active === t.key ? "border-brand text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
