"use client";
/** Image Manager grid: quick upload/replace/delete per product, selection for bulk removal, bulk upload by file name. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { bulkDeleteImagesAction, deleteImageAction, matchFilesAction } from "@/app/admin/(panel)/products/image-actions";
import { ACCEPT, compressIfNeeded, inspectImage, uploadWithProgress } from "./client-image";

export interface GridRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  categoryName: string | null;
  imageCount: number;
  primaryId: string | null;
  primaryUrl: string | null;
  skus: string[];
}

type BulkItem = { file: File; productId: string | null; productName: string | null; state: "matched" | "unmatched" | "uploading" | "done" | "error"; pct: number; error?: string; setMain: boolean };

export function ImageManagerGrid({ rows, canEdit }: { rows: GridRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [bulk, setBulk] = useState<BulkItem[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const target = useRef<{ productId: string; replaceId: string | null } | null>(null);

  const say = (tone: "ok" | "bad", text: string) => setMsg({ tone, text });

  async function quickUpload(file: File | undefined) {
    const t = target.current;
    if (!file || !t) return;
    const info = await inspectImage(file);
    if (!info.ok) return say("bad", `${file.name}: ${info.error}`);
    setBusy(t.productId);
    const blob = await compressIfNeeded(file, info).catch(() => file);
    const fields: Record<string, string | Blob> = { file: blob, primary: "true" };
    if (t.replaceId) fields.replaceId = t.replaceId;
    const res = await uploadWithProgress(`/api/admin/products/${t.productId}/images`, fields, file.name, () => {});
    setBusy(null);
    say(res.ok ? "ok" : "bad", res.ok ? (t.replaceId ? "Main image replaced." : "Main image uploaded.") : res.body.error ?? "Upload failed");
    router.refresh();
  }

  async function quickDelete(r: GridRow) {
    if (!r.primaryId || !confirm(`Delete the main image of “${r.name}”? The next gallery image (if any) becomes the main image.`)) return;
    setBusy(r.id);
    const f = new FormData();
    f.append("productId", r.id);
    f.append("imageIds", r.primaryId);
    const res = await deleteImageAction(null, f);
    setBusy(null);
    say(res.ok ? "ok" : "bad", res.ok ? res.message ?? "Deleted." : res.error);
    router.refresh();
  }

  async function bulkRemove() {
    if (!selected.size || !confirm(`Remove ALL images of ${selected.size} product(s)? This cannot be undone.`)) return;
    const f = new FormData();
    selected.forEach((id) => f.append("ids", id));
    setBusy("bulk");
    const res = await bulkDeleteImagesAction(null, f);
    setBusy(null);
    setSelected(new Set());
    say(res.ok ? "ok" : "bad", res.ok ? res.message ?? "Done." : res.error);
    router.refresh();
  }

  async function pickBulk(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, 100);
    const f = new FormData();
    f.append("names", list.map((x) => x.name).join("\n"));
    const res = await matchFilesAction(null, f);
    if (!res.ok) return say("bad", res.error);
    const matches = res.data as { fileName: string; productId: string | null; productName: string | null; index: number | null }[];
    setBulk(list.map((file, i) => ({
      file, productId: matches[i]?.productId ?? null, productName: matches[i]?.productName ?? null,
      state: matches[i]?.productId ? "matched" : "unmatched", pct: 0, setMain: matches[i]?.index == null,
    })));
  }

  async function runBulk() {
    setBusy("bulk");
    let ok = 0, bad = 0;
    for (let i = 0; i < bulk.length; i++) {
      const it = bulk[i]!;
      if (it.state !== "matched" || !it.productId) continue;
      setBulk((b) => b.map((x, j) => (j === i ? { ...x, state: "uploading" } : x)));
      const info = await inspectImage(it.file);
      if (!info.ok) {
        bad++;
        setBulk((b) => b.map((x, j) => (j === i ? { ...x, state: "error", error: info.error } : x)));
        continue;
      }
      const blob = await compressIfNeeded(it.file, info).catch(() => it.file);
      const res = await uploadWithProgress("/api/admin/images/bulk", { file: blob, productId: it.productId, fileName: it.file.name, primary: String(it.setMain) }, it.file.name, (pct) =>
        setBulk((b) => b.map((x, j) => (j === i ? { ...x, pct } : x))),
      );
      if (res.ok) ok++;
      else bad++;
      setBulk((b) => b.map((x, j) => (j === i ? { ...x, state: res.ok ? "done" : "error", pct: 100, error: res.body.error } : x)));
    }
    setBusy(null);
    say(bad ? "bad" : "ok", `${ok} uploaded${bad ? `, ${bad} failed` : ""}.`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {msg && <p role="status" className={`rounded-xl px-4 py-2 text-sm ${msg.tone === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>{msg.text}</p>}

      {canEdit && (
        <details className="rounded-2xl border border-line bg-white">
          <summary className="cursor-pointer px-5 py-3 text-sm font-semibold">Bulk upload by file name</summary>
          <div className="border-t border-line p-5 text-sm">
            <p className="text-ink-soft">Name each file after the product <b>slug</b> or a variant <b>SKU</b> (e.g. <code>olive-oil.jpg</code>, <code>MOCK-OLIVE-OIL-1.webp</code>). Add <code>-2</code>, <code>-3</code>… for extra gallery images (<code>olive-oil-2.jpg</code>). Files without a suffix become the main image. You confirm the matches before anything is uploaded.</p>
            <input type="file" multiple accept={ACCEPT} onChange={(e) => void pickBulk(e.target.files)} className="mt-3 text-sm" aria-label="Choose files for bulk upload" />
            {bulk.length > 0 && (
              <>
                <ul className="mt-3 max-h-72 divide-y divide-line overflow-auto rounded-xl border border-line">
                  {bulk.map((b, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className="font-mono text-xs">{b.file.name}</span>
                      <span aria-hidden>→</span>
                      {b.productName ? <span className="font-medium">{b.productName}</span> : <span className="text-red-700">no matching product — skipped</span>}
                      {b.productId && b.state === "matched" && (
                        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={b.setMain} onChange={(e) => setBulk((all) => all.map((x, j) => (j === i ? { ...x, setMain: e.target.checked } : x)))} /> main</label>
                      )}
                      <span className="ml-auto text-xs">
                        {b.state === "uploading" && `${b.pct}%`}
                        {b.state === "done" && <span className="text-emerald-700">uploaded</span>}
                        {b.state === "error" && <span className="text-red-700">{b.error ?? "failed"}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex gap-2">
                  <button type="button" className="btn-primary" disabled={busy === "bulk" || !bulk.some((b) => b.state === "matched")} onClick={() => void runBulk()}>
                    Upload {bulk.filter((b) => b.state === "matched").length} matched file(s)
                  </button>
                  <button type="button" className="btn-ghost" disabled={busy === "bulk"} onClick={() => setBulk([])}>Clear</button>
                </div>
              </>
            )}
          </div>
        </details>
      )}

      {canEdit && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-ink px-4 py-2 text-sm text-cream">
          <span className="font-mono text-xs">{selected.size} selected</span>
          <button type="button" className="text-xs underline" onClick={() => setSelected(new Set())}>Clear</button>
          <button type="button" className="btn-danger ml-auto !py-1" disabled={busy === "bulk"} onClick={() => void bulkRemove()}>Remove all their images</button>
        </div>
      )}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {rows.map((r) => (
          <li key={r.id} className={`rounded-2xl border bg-white p-2 ${selected.has(r.id) ? "border-ink" : "border-line"}`} data-testid="image-manager-card">
            <div className="relative">
              {r.primaryUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- admin preview of storage objects
                <img src={r.primaryUrl} alt={r.name} className="aspect-square w-full rounded-xl bg-sand object-cover" loading="lazy" />
              ) : (
                <div className="grid aspect-square w-full place-items-center rounded-xl bg-sand text-center text-xs text-ink-soft">No image</div>
              )}
              {canEdit && (
                <label className="absolute left-2 top-2 rounded-md bg-white/90 p-1">
                  <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.id)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />
                </label>
              )}
              <span className="absolute right-2 top-2 rounded-full bg-ink/80 px-2 py-0.5 font-mono text-[10px] text-cream">{r.imageCount} img</span>
              {busy === r.id && <div className="absolute inset-0 grid place-items-center rounded-xl bg-ink/60 text-xs text-cream">Working…</div>}
            </div>
            <p className="mt-2 truncate text-sm font-medium" title={r.name}>{r.name}</p>
            <p className="truncate text-[11px] text-ink-soft">{r.categoryName ?? "No category"} · {r.status}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              <Link href={`/admin/products/${r.id}#images`} className="btn-primary !px-2.5 !py-1 text-xs">Manage</Link>
              {canEdit && (
                <>
                  <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" disabled={!!busy} onClick={() => { target.current = { productId: r.id, replaceId: r.primaryId }; fileInput.current?.click(); }}>
                    {r.primaryId ? "Replace" : "Upload"}
                  </button>
                  {r.primaryId && <button type="button" className="btn-danger !px-2.5 !py-1 text-xs" disabled={!!busy} onClick={() => void quickDelete(r)} aria-label={`Delete main image of ${r.name}`}>✕</button>}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      <input ref={fileInput} type="file" accept={ACCEPT} className="hidden" tabIndex={-1} aria-hidden onChange={(e) => { void quickUpload(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}
