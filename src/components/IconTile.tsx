import type { LucideIcon } from "lucide-react";

/** A line icon in a soft rounded tile: the house style for card and empty-state icons (no emoji). */
export function IconTile({ icon: Icon, size = "md", className = "" }: { icon: LucideIcon; size?: "md" | "lg"; className?: string }) {
  const box = size === "lg" ? "h-14 w-14 rounded-2xl" : "h-11 w-11 rounded-xl";
  const glyph = size === "lg" ? "h-7 w-7" : "h-5 w-5";
  return (
    <span aria-hidden className={`inline-grid shrink-0 place-items-center bg-amber/15 text-ink ring-1 ring-amber/40 ${box} ${className}`}>
      <Icon className={glyph} strokeWidth={1.75} />
    </span>
  );
}
