"use client";
/**
 * Super-admin editor for the 3D store supporters wall: title, add / edit / reorder / remove names with their
 * country, bulk paste, search. Saves the whole list at once through saveSupportersAction (validated again there).
 */
import { useMemo, useState } from "react";
import { ActionForm } from "@/features/admin/ActionForm";
import { saveSupportersAction } from "@/app/admin/(panel)/ops-actions";
import {
  countryName, countryOptions, DEFAULT_SUPPORTERS_TITLE, MAX_NAME, MAX_SUPPORTERS, parseSupporterLines,
  type Supporter, type SupportersWall,
} from "@/lib/storefront/supporters";

interface Row extends Supporter {
  id: number;
}

let seq = 0;
const withIds = (people: Supporter[]): Row[] => people.map((p) => ({ ...p, id: ++seq }));

export function SupportersEditor({ initial }: { initial: SupportersWall }) {
  const [title, setTitle] = useState(initial.title);
  const [rows, setRows] = useState<Row[]>(() => withIds(initial.people));
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [query, setQuery] = useState("");
  const [paste, setPaste] = useState("");
  const countries = useMemo(() => countryOptions(), []);

  const savedJson = useMemo(() => JSON.stringify(initial.people), [initial.people]);
  const people = rows.map(({ name: n, country: c }) => ({ name: n, country: c }));
  const json = JSON.stringify(people);
  const dirty = json !== savedJson || title !== initial.title;

  const q = query.trim().toLowerCase();
  const visible = q ? rows.filter((r) => r.name.toLowerCase().includes(q) || countryName(r.country).toLowerCase().includes(q)) : rows;
  const countryCount = new Set(rows.map((r) => r.country).filter(Boolean)).size;
  const full = rows.length >= MAX_SUPPORTERS;

  const update = (id: number, patch: Partial<Supporter>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const move = (id: number, d: -1 | 1) =>
    setRows((rs) => {
      const i = rs.findIndex((r) => r.id === id);
      const j = i + d;
      if (i < 0 || j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const add = () => {
    const n = name.trim();
    if (!n || full) return;
    setRows((rs) => [...rs, { id: ++seq, name: n.slice(0, MAX_NAME), country }]);
    setName("");
  };
  const importPaste = () => {
    const list = parseSupporterLines(paste).slice(0, MAX_SUPPORTERS - rows.length);
    if (!list.length) return;
    setRows((rs) => [...rs, ...withIds(list)]);
    setPaste("");
  };

  const select = (value: string, onChange: (v: string) => void, label: string) => (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="admin-input">
      <option value="">— No country —</option>
      {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
    </select>
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Names on the wall" value={rows.length} />
        <Stat label="Countries" value={countryCount} />
        <Stat label="Status" value={dirty ? "Unsaved changes" : "Saved"} tone={dirty ? "amber" : "ok"} />
      </div>

      <label className="block text-sm">
        <span className="font-medium">Board title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder={DEFAULT_SUPPORTERS_TITLE} className="admin-input mt-1" />
      </label>

      {/* Add one */}
      <form
        className="grid gap-2 rounded-xl border border-line bg-neutral-50 p-3 sm:grid-cols-[1fr_16rem_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_NAME} placeholder="Full name, e.g. Maria Rossi" className="admin-input" />
        {select(country, setCountry, "Country")}
        <button type="submit" className="btn-primary" disabled={!name.trim() || full}>Add person</button>
      </form>

      <details className="rounded-xl border border-dashed border-line">
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">Paste many names at once</summary>
        <div className="space-y-2 border-t border-line p-4">
          <p className="text-xs text-ink-soft">One person per line: <code>Name, Country</code> (country name or 2-letter code, e.g. <code>Maria Rossi, Italy</code> or <code>John Smith, US</code>). A line with just a name is added without a country.</p>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={5} className="admin-input font-mono text-xs" placeholder={"Maria Rossi, Italy\nJohn Smith, US\nAmira Ben Ali, Tunisia"} />
          <button type="button" onClick={importPaste} className="btn-ghost" disabled={!paste.trim() || full}>Add these names</button>
        </div>
      </details>

      {/* List */}
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">People ({rows.length})</h3>
          {rows.length > 6 && <input aria-label="Search people" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or country" className="admin-input ml-auto max-w-xs" />}
        </div>
        {rows.length === 0 ? (
          <p className="rounded-xl border border-line px-4 py-8 text-center text-sm text-ink-soft">No names yet. The board in the 3D store says “First supporters coming soon” until you add some.</p>
        ) : (
          <div className="max-h-[32rem] overflow-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-white text-left text-xs uppercase tracking-wide text-ink-soft shadow-[0_1px_0_var(--color-line,#e5e5e5)]">
                <tr>
                  <th className="w-12 px-3 py-2">#</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Country</th>
                  <th className="w-40 px-3 py-2 text-right">Order / remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((r) => {
                  const i = rows.indexOf(r);
                  return (
                    <tr key={r.id}>
                      <td className="px-3 py-1.5 font-mono text-xs text-ink-soft">{String(i + 1).padStart(2, "0")}</td>
                      <td className="px-3 py-1.5">
                        <input aria-label={`Name ${i + 1}`} value={r.name} onChange={(e) => update(r.id, { name: e.target.value.slice(0, MAX_NAME) })} className="admin-input" />
                      </td>
                      <td className="px-3 py-1.5">{select(r.country, (v) => update(r.id, { country: v }), `Country of ${r.name}`)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right">
                        <button type="button" onClick={() => move(r.id, -1)} disabled={i === 0} className="btn-ghost px-2" aria-label={`Move ${r.name} up`}>↑</button>
                        <button type="button" onClick={() => move(r.id, 1)} disabled={i === rows.length - 1} className="btn-ghost px-2" aria-label={`Move ${r.name} down`}>↓</button>
                        <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} className="btn-ghost px-2 text-red-700" aria-label={`Remove ${r.name}`}>Remove</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ActionForm action={saveSupportersAction} submitLabel="Save and publish to the 3D store">
        <input type="hidden" name="title" value={title} />
        <input type="hidden" name="people" value={json} />
        <p className="text-xs text-ink-soft">Names appear in this order on the board. Empty names are dropped when you save. Only publish names of people who agreed to be shown.</p>
      </ActionForm>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "ok" | "amber" }) {
  const color = tone === "amber" ? "text-amber-700" : tone === "ok" ? "text-emerald-700" : "";
  return (
    <div className="rounded-xl border border-line px-4 py-3">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}
