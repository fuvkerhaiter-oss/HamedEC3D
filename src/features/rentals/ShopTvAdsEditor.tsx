"use client";

/**
 * Seller editor for the big wall-mounted TVs inside their 3D shop (/seller/shop).
 * Owners can upload up to 8 ad banners, reorder them, remove them, and preview the live slideshow.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RowAction } from "@/features/seller/forms";
import { deleteAdSlideAction, moveAdSlideAction } from "@/app/seller/actions";

export interface AdSlideItem {
  id: string;
  url: string;
}

export function ShopTvAdsEditor({ slides, maxSlides, brandName }: { slides: AdSlideItem[]; maxSlides: number; brandName: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (slides.length <= 1) {
      setActive(0);
      return;
    }
    const id = setInterval(() => {
      setActive((i) => (i + 1) % slides.length);
    }, 3500);
    return () => clearInterval(id);
  }, [slides.length]);

  const current = slides[active % Math.max(1, slides.length)];

  async function upload(file: File) {
    setError(null);
    setBusy(true);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("target", "ad");
    try {
      const res = await fetch("/api/seller/image", { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) throw new Error(body.error ?? "Upload failed.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/avif" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <button type="button" disabled={busy || slides.length >= maxSlides} onClick={() => input.current?.click()} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
            {busy ? "Uploading…" : `Add TV ad (${slides.length}/${maxSlides})`}
          </button>
          <span className="text-xs text-ink-soft">16:9 widescreen images (JPG, PNG, WebP, up to 10 MB) look sharpest on the big TVs.</span>
        </div>
        {error && (
          <p className="text-xs font-medium text-red-700" role="alert">
            {error}
          </p>
        )}

        {slides.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-sand/40 px-4 py-6 text-center text-sm text-ink-soft">
            No ad images yet. Upload your promos, new arrivals, or brand banners to play on the big widescreen TVs inside your 3D shop.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {slides.map((s, i) => (
              <div key={s.id} className="overflow-hidden rounded-xl bg-sand/50 ring-1 ring-line">
                <div className="relative aspect-video bg-ink">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.url} alt={`Ad slide ${i + 1}`} className="h-full w-full object-cover" />
                  <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold text-white">#{i + 1}</span>
                </div>
                <div className="flex items-center justify-between gap-1 px-2.5 py-2">
                  <div className="flex items-center gap-1">
                    {i > 0 && (
                      <RowAction action={moveAdSlideAction} fields={{ id: s.id, dir: "up" }} className="btn-ghost px-2 py-1 text-xs">
                        ←
                      </RowAction>
                    )}
                    {i < slides.length - 1 && (
                      <RowAction action={moveAdSlideAction} fields={{ id: s.id, dir: "down" }} className="btn-ghost px-2 py-1 text-xs">
                        →
                      </RowAction>
                    )}
                  </div>
                  <RowAction action={deleteAdSlideAction} fields={{ id: s.id }} confirm="Remove this ad slide?" className="btn-danger px-2.5 py-1 text-xs">
                    Remove
                  </RowAction>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Live TV preview */}
      <aside className="space-y-2">
        <p className="text-sm font-semibold">Live 3D TV preview</p>
        <div className="rounded-2xl bg-[#111418] p-2.5 shadow-card ring-2 ring-white/10">
          <div className="relative aspect-video overflow-hidden rounded-lg bg-[#090c0f]">
            {current ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={current.url} alt="Live TV preview" className="h-full w-full object-cover transition-opacity duration-500" />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#161b22] to-[#0a0d10] px-4 text-center">
                <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-amber">{brandName}</p>
                <p className="mt-1 text-[11px] text-white/60">Your TV ad slideshow will play here</p>
              </div>
            )}
            <span className="absolute left-2 top-2 rounded bg-black/75 px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-amber">AD</span>
            {slides.length > 1 && (
              <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
                {slides.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-label={`Preview slide ${i + 1}`}
                    onClick={() => setActive(i)}
                    className={`h-1.5 rounded-full transition-all ${i === active % slides.length ? "w-4 bg-amber" : "w-1.5 bg-white/40"}`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
        <p className="text-xs text-ink-soft">Shown on two big widescreen TVs mounted inside your shop, cycling automatically every few seconds.</p>
      </aside>
    </div>
  );
}
