"use client";
/**
 * Product image manager: drag-and-drop/browse upload with previews, validation, client-side compression of
 * oversized files and per-file progress; gallery with drag-and-drop reorder (+ keyboard buttons), set main,
 * replace, delete, alt text and a full-size preview. Every change is persisted server-side.
 */
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { ImageView } from "@/lib/admin/services/images";
import { altImageAction, deleteImageAction, reorderImagesAction, setPrimaryImageAction } from "@/app/admin/(panel)/products/image-actions";
import { ACCEPT, compressIfNeeded, inspectImage, kb, uploadWithProgress } from "./client-image";

type Staged = {
  id: string;
  file: File;
  preview: string;
  width: number;
  height: number;
  error?: string;
  status: "ready" | "uploading" | "done" | "error";
  progress: number;
  alt: string;
};

type Toast = { id: number; tone: "ok" | "bad"; text: string };

function fd(o: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of ([] as string[]).concat(v)) f.append(k, x);
  return f;
}

export function ProductImageManager({ productId, productName, images: initial, canEdit, storageNote }: {
  productId: string;
  productName: string;
  images: ImageView[];
  canEdit: boolean;
  storageNote: { driver: string; detail: string };
}) {
  const router = useRouter();
  const inputId = useId();
  const [images, setImages] = useState(initial);
  const [order, setOrder] = useState(initial.map((i) => i.id));
  const [staged, setStaged] = useState<Staged[]>([]);
  const [mainStaged, setMainStaged] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null);
  const [replacing, setReplacing] = useState<{ id: string; pct: number } | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);
  const toastSeq = useRef(0);

  // Server state wins after every refresh (keeps local order edits only while dirty).
  const initialKey = initial.map((i) => `${i.id}:${i.storage_path}:${i.is_primary}:${i.sort_order}:${i.alt}`).join("|");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync from fresh server props after router.refresh()
    setImages(initial);
    setOrder(initial.map((i) => i.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey]);
  useEffect(() => () => staged.forEach((s) => URL.revokeObjectURL(s.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const toast = (tone: Toast["tone"], text: string) => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  };
  const byId = new Map(images.map((i) => [i.id, i]));
  const ordered = order.map((id) => byId.get(id)).filter((x): x is ImageView => !!x);
  const dirty = order.join() !== initial.map((i) => i.id).join();

  async function addFiles(list: FileList | File[]) {
    const files = Array.from(list).slice(0, 20);
    const items: Staged[] = [];
    for (const file of files) {
      const info = await inspectImage(file);
      items.push({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file), width: info.width, height: info.height, error: info.error, status: info.ok ? "ready" : "error", progress: 0, alt: "" });
    }
    setStaged((s) => [...s, ...items]);
    if (images.length === 0 && !mainStaged) setMainStaged(items.find((i) => !i.error)?.id ?? null);
  }

  async function uploadAll() {
    setBusy(true);
    let ok = 0, failed = 0;
    for (const s of staged.filter((x) => x.status === "ready")) {
      setStaged((all) => all.map((x) => (x.id === s.id ? { ...x, status: "uploading", progress: 0 } : x)));
      const blob = await compressIfNeeded(s.file, s).catch(() => s.file);
      const res = await uploadWithProgress(`/api/admin/products/${productId}/images`, { file: blob, alt: s.alt, primary: String(mainStaged === s.id) }, s.file.name, (pct) =>
        setStaged((all) => all.map((x) => (x.id === s.id ? { ...x, progress: pct } : x))),
      );
      setStaged((all) => all.map((x) => (x.id === s.id ? { ...x, status: res.ok ? "done" : "error", progress: 100, error: res.ok ? undefined : res.body.error ?? "Upload failed" } : x)));
      if (res.ok) ok++;
      else failed++;
    }
    setBusy(false);
    if (ok) toast("ok", `${ok} image(s) uploaded.`);
    if (failed) toast("bad", `${failed} upload(s) failed — see the messages below. Existing images were not changed.`);
    setStaged((all) => {
      all.filter((x) => x.status === "done").forEach((x) => URL.revokeObjectURL(x.preview));
      return all.filter((x) => x.status !== "done");
    });
    setMainStaged(null);
    router.refresh();
  }

  async function run(action: typeof setPrimaryImageAction, data: FormData, okText?: string) {
    setBusy(true);
    const r = await action(null, data);
    setBusy(false);
    if (r.ok) toast("ok", okText ?? r.message ?? "Saved.");
    else toast("bad", r.error);
    router.refresh();
    return r.ok;
  }

  async function onReplacePicked(file: File | undefined) {
    const id = replaceTarget.current;
    if (!file || !id) return;
    const info = await inspectImage(file);
    if (!info.ok) return toast("bad", `Can't use ${file.name}: ${info.error}`);
    setReplacing({ id, pct: 0 });
    const blob = await compressIfNeeded(file, info).catch(() => file);
    const res = await uploadWithProgress(`/api/admin/products/${productId}/images`, { file: blob, replaceId: id, alt: byId.get(id)?.alt ?? "" }, file.name, (pct) => setReplacing({ id, pct }));
    setReplacing(null);
    if (res.ok) toast("ok", "Image replaced.");
    else toast("bad", res.body.error ?? "Replace failed — the old image is still in place.");
    router.refresh();
  }

  function move(id: string, to: number) {
    setOrder((o) => {
      const from = o.indexOf(id);
      if (from < 0 || to < 0 || to >= o.length) return o;
      const n = [...o];
      n.splice(from, 1);
      n.splice(to, 0, id);
      return n;
    });
  }

  const readyCount = staged.filter((s) => s.status === "ready").length;

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-soft">Storage: {storageNote.detail}</p>

      {/* Gallery */}
      {ordered.length === 0 ? (
        <p className="rounded-xl bg-cream p-4 text-sm text-ink-soft">No images yet — the store shows a labelled placeholder for {productName}.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Product images (drag to reorder)">
          {ordered.map((im, idx) => (
            <li
              key={im.id}
              draggable={canEdit}
              onDragStart={() => setDragId(im.id)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragId && dragId !== im.id) move(dragId, idx);
              }}
              onDragEnd={() => setDragId(null)}
              className={`group relative rounded-xl border bg-white p-2 transition ${im.is_primary ? "border-brand ring-2 ring-brand/30" : "border-line"} ${dragId === im.id ? "opacity-50" : ""} ${canEdit ? "cursor-grab active:cursor-grabbing" : ""}`}
              data-testid="gallery-item"
            >
              <button type="button" className="block w-full" onClick={() => setLightbox({ url: im.url, alt: im.alt })} aria-label={`Preview image ${idx + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- admin preview of storage objects */}
                <img src={im.url} alt={im.alt || `${productName} image ${idx + 1}`} className="aspect-square w-full rounded-lg bg-sand object-cover" loading="lazy" />
              </button>
              {im.is_primary && <span className="absolute left-3 top-3 rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">Main</span>}
              {replacing?.id === im.id && (
                <div className="absolute inset-2 grid place-items-center rounded-lg bg-ink/60 text-sm text-cream">Replacing… {replacing.pct}%</div>
              )}
              <p className="mt-1.5 font-mono text-[10px] text-ink-soft">{im.width && im.height ? `${im.width}×${im.height}` : "size n/a"} · {kb(im.bytes)} · #{idx + 1}</p>
              {canEdit && (
                <>
                  <input
                    defaultValue={im.alt}
                    placeholder="Alt text"
                    aria-label={`Alt text for image ${idx + 1}`}
                    className="admin-input mt-1 !py-1 text-xs"
                    onBlur={(e) => e.target.value !== im.alt && run(altImageAction, fd({ productId, imageId: im.id, alt: e.target.value }))}
                  />
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <button type="button" className="btn-ghost !px-2 !py-0.5 text-xs" disabled={idx === 0} onClick={() => move(im.id, idx - 1)} aria-label={`Move image ${idx + 1} earlier`}>←</button>
                    <button type="button" className="btn-ghost !px-2 !py-0.5 text-xs" disabled={idx === ordered.length - 1} onClick={() => move(im.id, idx + 1)} aria-label={`Move image ${idx + 1} later`}>→</button>
                    {!im.is_primary && <button type="button" className="btn-ghost !px-2 !py-0.5 text-xs" disabled={busy} onClick={() => run(setPrimaryImageAction, fd({ productId, imageId: im.id }))}>Set main</button>}
                    <button type="button" className="btn-ghost !px-2 !py-0.5 text-xs" disabled={busy || !!replacing} onClick={() => { replaceTarget.current = im.id; replaceInput.current?.click(); }}>Replace</button>
                    <button type="button" className="btn-danger !px-2 !py-0.5 text-xs" disabled={busy} onClick={() => confirm("Delete this image? This cannot be undone.") && run(deleteImageAction, fd({ productId, imageIds: im.id }))} aria-label={`Delete image ${idx + 1}`}>Delete</button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && dirty && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-amber/15 px-4 py-2 text-sm">
          <span>Gallery order changed.</span>
          <button type="button" className="btn-primary !py-1" disabled={busy} onClick={() => run(reorderImagesAction, fd({ productId, order: order.join(",") }))}>Save order</button>
          <button type="button" className="btn-ghost !py-1" onClick={() => setOrder(initial.map((i) => i.id))}>Reset</button>
        </div>
      )}
      <input ref={replaceInput} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { void onReplacePicked(e.target.files?.[0]); e.target.value = ""; }} aria-hidden tabIndex={-1} />

      {/* Upload */}
      {canEdit && (
        <div>
          <label
            htmlFor={inputId}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files); }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${dragOver ? "border-brand bg-brand/5" : "border-line bg-cream/50 hover:border-ink/30"}`}
          >
            <span aria-hidden className="text-2xl">⇪</span>
            <span className="text-sm font-medium">Drop images here or <span className="text-brand underline">browse</span></span>
            <span className="text-xs text-ink-soft">WebP, JPEG, PNG or AVIF · up to 25 MB each (large images are compressed) · min 100×100 px · stored as optimized WebP</span>
          </label>
          <input id={inputId} type="file" accept={ACCEPT} multiple className="sr-only" onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />

          {staged.length > 0 && (
            <div className="mt-3 rounded-2xl border border-line bg-white p-3">
              <p className="mb-2 text-sm font-semibold">Ready to upload — preview before saving</p>
              <ul className="space-y-2">
                {staged.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-cream/60 p-2 text-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local object-URL preview */}
                    <img src={s.preview} alt="" className="h-16 w-16 rounded-lg object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{s.file.name}</p>
                      <p className="font-mono text-[11px] text-ink-soft">{s.width ? `${s.width}×${s.height}` : "?"} · {kb(s.file.size)} · {s.file.type.replace("image/", "").toUpperCase()}</p>
                      {s.status === "uploading" && (
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-sand" role="progressbar" aria-valuenow={s.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${s.file.name}`}>
                          <div className="h-full bg-brand transition-[width]" style={{ width: `${s.progress}%` }} />
                        </div>
                      )}
                      {s.error && <p className="text-xs text-red-700">{s.error}</p>}
                    </div>
                    {!s.error && s.status === "ready" && (
                      <>
                        <input value={s.alt} onChange={(e) => setStaged((all) => all.map((x) => (x.id === s.id ? { ...x, alt: e.target.value } : x)))} placeholder="Alt text" aria-label={`Alt text for ${s.file.name}`} className="admin-input !w-40 !py-1 text-xs" />
                        <label className="flex items-center gap-1 text-xs"><input type="radio" name="staged-main" checked={mainStaged === s.id} onChange={() => setMainStaged(s.id)} /> Main</label>
                      </>
                    )}
                    {s.status !== "uploading" && (
                      <button type="button" className="text-xs text-ink-soft underline" onClick={() => { URL.revokeObjectURL(s.preview); setStaged((all) => all.filter((x) => x.id !== s.id)); }}>Remove</button>
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center gap-2">
                <button type="button" className="btn-primary" disabled={busy || readyCount === 0} onClick={() => void uploadAll()}>
                  {busy ? "Uploading…" : `Upload ${readyCount} image${readyCount === 1 ? "" : "s"}`}
                </button>
                {mainStaged && <span className="text-xs text-ink-soft">The selected file becomes the main image.</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Notifications */}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <p key={t.id} role="status" className={`pointer-events-auto rounded-xl px-4 py-3 text-sm shadow-lg ${t.tone === "ok" ? "bg-ink text-cream" : "bg-red-700 text-white"}`}>{t.text}</p>
        ))}
      </div>

      {lightbox && (
        <div role="dialog" aria-modal="true" aria-label="Image preview" className="fixed inset-0 z-50 grid place-items-center bg-ink/80 p-4" onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- full-size preview */}
          <img src={lightbox.url} alt={lightbox.alt} className="max-h-[85vh] max-w-full rounded-xl bg-white object-contain" />
          <button type="button" className="absolute right-4 top-4 rounded-full bg-cream px-3 py-1 text-sm" onClick={() => setLightbox(null)}>Close</button>
        </div>
      )}
    </div>
  );
}
