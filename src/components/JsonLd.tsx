import { serializeJsonLd } from "@/lib/seo/site";

/** schema.org structured data (server-rendered, "<" escaped). */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
