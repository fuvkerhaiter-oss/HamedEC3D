import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbLd, siteUrl } from "@/lib/seo/site";

export interface Crumb {
  name: string;
  path: string;
}

/** Visible breadcrumb trail + matching schema.org BreadcrumbList (last item = current page). */
export function Breadcrumbs({ items, className = "", tone = "light" }: { items: Crumb[]; className?: string; tone?: "light" | "dark" }) {
  const link = tone === "dark" ? "hover:text-white hover:underline" : "hover:text-ink hover:underline";
  return (
    <>
      <JsonLd data={breadcrumbLd(siteUrl(), items)} />
      <nav aria-label="Breadcrumb" className={`text-xs ${tone === "dark" ? "text-white/65" : "text-ink-soft"} ${className}`}>
        <ol className="flex flex-wrap items-center gap-1.5">
          {items.map((c, i) => (
            <li key={c.path} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden>/</span>}
              {i === items.length - 1 ? (
                <span aria-current="page" className={tone === "dark" ? "font-medium text-white" : "font-medium text-ink"}>{c.name}</span>
              ) : (
                <Link href={c.path} className={link}>{c.name}</Link>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
