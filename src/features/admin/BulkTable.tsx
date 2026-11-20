"use client";
/** Table with row selection + bulk action forms (each bulk form posts the selected ids). */
import { createContext, useContext, useState } from "react";

const Ctx = createContext<{ selected: Set<string>; toggle: (id: string) => void; setAll: (ids: string[] | null) => void; all: string[] } | null>(null);

export function BulkProvider({ ids, children }: { ids: string[]; children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const setAll = (all: string[] | null) => setSelected(new Set(all ?? []));
  return <Ctx.Provider value={{ selected, toggle, setAll, all: ids }}>{children}</Ctx.Provider>;
}

function useBulk() {
  const c = useContext(Ctx);
  if (!c) throw new Error("BulkProvider missing");
  return c;
}

export function SelectAll() {
  const { selected, setAll, all } = useBulk();
  const on = all.length > 0 && selected.size === all.length;
  return <input type="checkbox" aria-label="Select all on this page" checked={on} onChange={() => setAll(on ? null : all)} className="h-4 w-4 accent-[var(--color-brand)]" />;
}

export function SelectRow({ id, label }: { id: string; label: string }) {
  const { selected, toggle } = useBulk();
  return <input type="checkbox" aria-label={`Select ${label}`} checked={selected.has(id)} onChange={() => toggle(id)} className="h-4 w-4 accent-[var(--color-brand)]" />;
}

/** Renders children (bulk forms) only when something is selected; injects hidden `ids` inputs via SelectedIds. */
export function BulkBar({ children }: { children: React.ReactNode }) {
  const { selected, setAll } = useBulk();
  if (selected.size === 0) return null;
  return (
    <div className="sticky top-16 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-ink/20 bg-ink px-4 py-2 text-sm text-cream shadow-lg">
      <span className="font-mono text-xs">{selected.size} selected</span>
      <button className="text-xs underline opacity-70 hover:opacity-100" onClick={() => setAll(null)}>Clear</button>
      <span className="ml-auto flex flex-wrap items-center gap-2 [&_.btn-ghost]:!py-1 [&_.btn-danger]:!py-1 [&_.admin-input]:!py-1">{children}</span>
    </div>
  );
}

export function SelectedIds() {
  const { selected } = useBulk();
  return (
    <>
      {[...selected].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
    </>
  );
}
