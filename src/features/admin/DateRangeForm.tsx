"use client";
import { useState } from "react";
import { RANGE_PRESETS } from "@/lib/admin/date-range";

/** GET form for date filtering (preset or custom range). */
export function DateRangeForm({ range, from, to }: { range: string; from?: string; to?: string }) {
  const [preset, setPreset] = useState(range);
  return (
    <form className="flex flex-wrap items-end gap-2" aria-label="Date range">
      <label className="text-xs">
        <span className="sr-only">Period</span>
        <select name="range" value={preset} onChange={(e) => setPreset(e.target.value)} className="admin-input !w-auto !py-1.5">
          {Object.entries(RANGE_PRESETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      {preset === "custom" && (
        <>
          <label className="text-xs"><span className="sr-only">From</span><input type="date" name="from" defaultValue={from} required className="admin-input !w-auto !py-1.5" /></label>
          <label className="text-xs"><span className="sr-only">To</span><input type="date" name="to" defaultValue={to} required className="admin-input !w-auto !py-1.5" /></label>
        </>
      )}
      <button className="btn-ghost !py-1.5">Apply</button>
    </form>
  );
}
