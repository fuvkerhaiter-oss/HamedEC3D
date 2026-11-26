"use client";

/**
 * Door frame colour + lighting editor with a live animated preview (the same light maths as the 3D door,
 * lib/rentals/door-style.ts). Used by tenants (/seller/shop) and admins (/admin/rentals/tenants/:id); the caller
 * passes its own server action (validated again there) and any hidden fields (e.g. the tenant id for admins).
 */
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  DEFAULT_DOOR_STYLE,
  DOOR_EFFECT_LABELS,
  DOOR_EFFECTS,
  doorLightLevel,
  FRAME_SWATCHES,
  levelScale,
  LIGHT_SWATCHES,
  rainbowHue,
  type DoorStyle,
} from "@/lib/rentals/door-style";

type Result = { ok: true; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };
type Action = (prev: Result | null, fd: FormData) => Promise<Result>;

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary px-5 py-2.5">
      {pending ? "Saving…" : "Save door"}
    </button>
  );
}

function Swatches({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (v: string) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 block text-sm font-semibold">{label}</legend>
      <div className="flex flex-wrap items-center gap-2">
        {options.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-label={`${label} ${c}`}
            aria-pressed={value === c}
            className={`h-8 w-8 rounded-full ring-1 ring-line transition ${value === c ? "scale-110 outline outline-2 outline-offset-2 outline-ink" : ""}`}
            style={{ background: c }}
          />
        ))}
        <input type="color" value={value} onChange={(e) => onChange(e.target.value.toLowerCase())} className="h-8 w-10 cursor-pointer rounded border border-line bg-white" aria-label={`${label}: custom colour`} />
      </div>
    </fieldset>
  );
}

// ───────────────────────── preview (canvas) ─────────────────────────

const hexRgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function DoorPreview({ style }: { style: DoorStyle }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const styleRef = useRef(style);
  useEffect(() => {
    styleRef.current = style;
  }, [style]);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const t0 = performance.now();
    const draw = () => {
      const s = styleRef.current;
      const t = reduce ? 0.8 : (performance.now() - t0) / 1000;
      const W = cv.width;
      const H = cv.height;
      const k = levelScale(s.level);
      // wall + floor
      ctx.fillStyle = "#cfcac2";
      ctx.fillRect(0, 0, W, H);
      const floorY = H * 0.86;
      ctx.fillStyle = "#e9e7e2";
      ctx.fillRect(0, floorY, W, H - floorY);
      // door geometry
      const dw = W * 0.34;
      const dh = H * 0.62;
      const x0 = (W - dw) / 2;
      const y0 = floorY - dh;
      const fw = W * 0.03;
      // room behind the glass
      const g = ctx.createLinearGradient(0, y0, 0, floorY);
      g.addColorStop(0, "#fff8ea");
      g.addColorStop(1, "#d8c2a0");
      ctx.fillStyle = g;
      ctx.fillRect(x0, y0, dw, dh);
      // frame, canopy, mullions
      ctx.fillStyle = s.frame;
      ctx.fillRect(x0 - fw, y0 - fw, fw, dh + fw);
      ctx.fillRect(x0 + dw, y0 - fw, fw, dh + fw);
      ctx.fillRect(x0 - fw * 2.2, y0 - fw * 1.9, dw + fw * 4.4, fw * 0.9);
      ctx.fillRect(x0 + dw / 2 - 2, y0 + dh * 0.12, 4, dh * 0.88);
      ctx.fillRect(x0, y0 + dh * 0.12, dw, 4);
      // light points around the door (same loop as the 3D door: up left, across, down right, back along the floor)
      const per = 2 * dh + dw;
      const pts: [number, number, number][] = [];
      const N = 64;
      for (let i = 0; i < N; i++) {
        const d = (i / N) * per;
        const u = (d / per) * 0.8;
        if (d < dh) pts.push([x0 - fw / 2, floorY - d, u]);
        else if (d < dh + dw) pts.push([x0 + (d - dh), y0 - fw / 2, u]);
        else pts.push([x0 + dw + fw / 2, y0 + (d - dh - dw), u]);
      }
      for (let i = 0; i < 16; i++) pts.push([x0 + dw - (i / 15) * dw, floorY + 6, 0.8 + (i / 15) * 0.2]);
      const [lr, lg, lb] = hexRgb(s.light);
      let sum = 0;
      for (const [x, y, u] of pts) {
        const a = doorLightLevel(s.effect, t, u) * k;
        sum += a;
        let c = `rgba(${lr},${lg},${lb},`;
        if (s.effect === "rainbow") c = `hsla(${Math.round(rainbowHue(t, u) * 360)},100%,60%,`;
        ctx.shadowColor = `${c}${Math.min(1, a)})`;
        ctx.shadowBlur = 14 * a;
        ctx.fillStyle = s.effect === "off" ? "rgba(255,255,255,0.25)" : `${c}${0.25 + 0.75 * Math.min(1, a)})`;
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      // glow pool on the floor
      const avg = sum / pts.length;
      if (avg > 0.01) {
        const pool = ctx.createRadialGradient(W / 2, floorY + 4, 2, W / 2, floorY + 4, dw);
        const col = s.effect === "rainbow" ? `hsla(${Math.round(rainbowHue(t, 0.5) * 360)},100%,60%,` : `rgba(${lr},${lg},${lb},`;
        pool.addColorStop(0, `${col}${0.45 * avg})`);
        pool.addColorStop(1, `${col}0)`);
        ctx.fillStyle = pool;
        ctx.fillRect(0, floorY - 10, W, H - floorY + 10);
      }
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} width={420} height={260} className="h-auto w-full rounded-2xl ring-1 ring-line" aria-label="Preview of the shop door" role="img" />;
}

// ───────────────────────── editor ─────────────────────────

export function DoorStyleEditor({ action, initial, fields = {}, stacked = false }: { action: Action; initial: DoorStyle; fields?: Record<string, string>; stacked?: boolean }) {
  const [state, formAction] = useActionState(action, null);
  const [s, setS] = useState<DoorStyle>(initial);
  const set = (p: Partial<DoorStyle>) => setS((x) => ({ ...x, ...p }));
  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={formAction} className={`grid gap-6 ${stacked ? "" : "md:grid-cols-[1fr_minmax(0,420px)]"}`}>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="frame" value={s.frame} />
      <input type="hidden" name="light" value={s.light} />
      <input type="hidden" name="effect" value={s.effect} />
      <div className="space-y-5">
        <Swatches label="Door colour" value={s.frame} options={FRAME_SWATCHES} onChange={(frame) => set({ frame })} />
        {fe.frame && <p className="text-xs font-medium text-red-700">{fe.frame}</p>}
        <fieldset>
          <legend className="mb-1.5 block text-sm font-semibold">Lighting</legend>
          <div className="flex flex-wrap gap-2">
            {DOOR_EFFECTS.map((e) => (
              <button
                key={e}
                type="button"
                aria-pressed={s.effect === e}
                title={DOOR_EFFECT_LABELS[e].hint}
                onClick={() => set({ effect: e })}
                className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 transition ${s.effect === e ? "bg-ink text-white ring-ink" : "bg-white ring-line hover:bg-sand"}`}
              >
                {DOOR_EFFECT_LABELS[e].label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-soft">{DOOR_EFFECT_LABELS[s.effect].hint}</p>
        </fieldset>
        {s.effect !== "off" && s.effect !== "rainbow" && <Swatches label="Light colour" value={s.light} options={LIGHT_SWATCHES} onChange={(light) => set({ light })} />}
        {s.effect !== "off" && (
          <div>
            <label htmlFor="door-level" className="mb-1 flex justify-between text-sm font-semibold">
              <span>Brightness</span>
              <span className="tabular-nums text-ink-soft">{s.level}%</span>
            </label>
            <input id="door-level" name="level" type="range" min={0} max={100} step={5} value={s.level} onChange={(e) => set({ level: Number(e.target.value) })} className="w-full accent-[var(--color-brand)]" />
          </div>
        )}
        {s.effect === "off" && <input type="hidden" name="level" value={s.level} />}
        <div className="flex flex-wrap items-center gap-3">
          <SaveButton />
          <button type="button" className="btn-ghost px-4 py-2.5" onClick={() => setS({ ...DEFAULT_DOOR_STYLE })}>
            Reset to default
          </button>
        </div>
        {state && (
          <p role={state.ok ? "status" : "alert"} className={`rounded-xl px-3 py-2 text-sm ${state.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
            {state.ok ? (state.message ?? "Saved.") : state.error}
          </p>
        )}
      </div>
      <div>
        <DoorPreview style={s} />
        <p className="mt-2 text-xs text-ink-soft">Live preview. In the 3D store the frame, neon outline, LED lines and the glow on the wall and floor use these settings.</p>
      </div>
    </form>
  );
}
