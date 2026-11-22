/**
 * CMS plain-text format → blocks (rendered as text, never HTML). Blank line = new block.
 * "# Title" = section heading; the lines under it (without a blank line) are its first paragraph.
 * A block whose lines all start with "• " or "- " = bullet list. A short first line with no
 * punctuation followed by more lines (e.g. "How to withdraw") = sub-heading.
 */
export type CmsBlock =
  | { kind: "h2" | "h3" | "p"; text: string }
  | { kind: "list"; items: string[] };

const BULLET = /^[•-]\s+/;
const SUBHEADING = /^[A-Z][A-Za-z0-9 ,'&()/-]{0,59}$/;

function paragraph(lines: string[], out: CmsBlock[]) {
  if (!lines.length) return;
  if (lines.length > 1 && SUBHEADING.test(lines[0]!)) {
    out.push({ kind: "h3", text: lines[0]! });
    lines = lines.slice(1);
  }
  // Runs of bullet lines become lists; the text lines between them stay paragraphs.
  let i = 0;
  while (i < lines.length) {
    const bullet = BULLET.test(lines[i]!);
    let j = i;
    while (j < lines.length && BULLET.test(lines[j]!) === bullet) j++;
    const run = lines.slice(i, j);
    out.push(bullet ? { kind: "list", items: run.map((l) => l.replace(BULLET, "")) } : { kind: "p", text: run.join("\n") });
    i = j;
  }
}

export function parseCmsBody(body: string): CmsBlock[] {
  const out: CmsBlock[] = [];
  for (const raw of body.split(/\r?\n\s*\r?\n/)) {
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (lines[0]!.startsWith("#")) {
      out.push({ kind: "h2", text: lines[0]!.replace(/^#+\s*/, "") });
      paragraph(lines.slice(1), out);
    } else paragraph(lines, out);
  }
  return out;
}
