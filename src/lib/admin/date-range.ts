/** Dashboard date ranges (UTC days). Pure. `to` is exclusive. */

export const RANGE_PRESETS = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", ytd: "Year to date", custom: "Custom" } as const;
export type RangePreset = keyof typeof RANGE_PRESETS;

export interface DateRange {
  preset: RangePreset;
  from: Date;
  to: Date;
  label: string;
}

const DAY = 86_400_000;
const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function parseDay(s: string | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function resolveRange(params: { range?: string; from?: string; to?: string }, now = new Date()): DateRange {
  const today = startOfUtcDay(now);
  const tomorrow = new Date(today.getTime() + DAY);
  const preset = (params.range && params.range in RANGE_PRESETS ? params.range : "30d") as RangePreset;
  if (preset === "custom") {
    const from = parseDay(params.from);
    const toDay = parseDay(params.to);
    if (from && toDay && from <= toDay && toDay.getTime() - from.getTime() <= 3 * 366 * DAY) {
      return { preset, from, to: new Date(toDay.getTime() + DAY), label: `${isoDay(from)} → ${isoDay(toDay)}` };
    }
    return resolveRange({ range: "30d" }, now);
  }
  const days = { today: 1, "7d": 7, "30d": 30, "90d": 90 } as const;
  const from = preset === "ytd" ? new Date(Date.UTC(now.getUTCFullYear(), 0, 1)) : new Date(tomorrow.getTime() - days[preset] * DAY);
  return { preset, from, to: tomorrow, label: RANGE_PRESETS[preset] };
}

/** Every UTC day in the range (for zero-filled chart series). */
export function daysIn(range: DateRange): string[] {
  const out: string[] = [];
  for (let t = range.from.getTime(); t < range.to.getTime(); t += DAY) out.push(isoDay(new Date(t)));
  return out;
}

/** The equally long period immediately before (for % change). */
export function previousRange(range: DateRange): DateRange {
  const len = range.to.getTime() - range.from.getTime();
  return { preset: "custom", from: new Date(range.from.getTime() - len), to: range.from, label: "Previous period" };
}
