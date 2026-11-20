/**
 * Pure product-placement generator for an imported store environment: puts real catalog products onto the
 * measured gondola faces (boards × bays), with facings, depth rows, price tags and aisle signs.
 * No three.js imports, so it is unit-testable.
 */
import type { Category, Product } from "../../lib/catalog/types";
import type { EnvLayout, ShelfFace, Vec3 } from "./env/types";

export type { Vec3 } from "./env/types";

export interface ItemPlacement {
  position: Vec3;
  scale: Vec3; // [width along shelf, height, depth]
  rotationY: number;
}

export interface PriceTag {
  productId: string;
  faceId: string;
  position: Vec3;
  rotationY: number;
  width: number;
}

export interface Sign {
  text: string;
  position: Vec3;
  rotationY: number;
}

export interface StoreLayout {
  items: Record<string, ItemPlacement[]>; // productId -> unit placements
  priceTags: PriceTag[];
  signs: Sign[];
  stockedFaces: string[];
  /** Products with no shelf space in the stocked faces (still sold via catalog/search). */
  unplaced: string[];
}

export const PLACEMENT = {
  facingGap: 0.012,
  depthGap: 0.01,
  maxDepthRows: 3,
  frontInset: 0.02,
  shelfClearance: 0.38,
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Height/width of one product's placeholder shape (same proportions on shelf, in flight and in the trolley). */
export function productItemDims(heightMeters: number): { h: number; w: number } {
  const h = clamp(heightMeters, 0.08, PLACEMENT.shelfClearance);
  return { h, w: clamp(h * 0.55, 0.07, 0.18) };
}

/** Face-local frame: `along` runs parallel to the shelf, `normal` points into the aisle. Faces here are axis-aligned. */
function faceAxes(face: ShelfFace) {
  const alongX = Math.abs(face.normal[2]) > 0.5; // normal ±Z → shelf runs along X
  const sign = alongX ? Math.sign(face.normal[2]) : Math.sign(face.normal[0]);
  return {
    rotationY: Math.atan2(face.normal[0], face.normal[2]),
    point: (along: number, y: number, depth: number): Vec3 =>
      alongX ? [along, y, face.frontEdge - sign * depth] : [face.frontEdge - sign * depth, y, along],
  };
}

/** Distribute categories over faces: each face gets a share; extra faces repeat categories. */
function categoriesForFaces(faceCount: number, cats: Category[]): Category[][] {
  if (cats.length === 0) return Array.from({ length: faceCount }, () => []);
  if (faceCount >= cats.length) return Array.from({ length: faceCount }, (_, i) => [cats[i % cats.length]!]);
  return Array.from({ length: faceCount }, (_, i) => cats.filter((_, ci) => ci % faceCount === i));
}

export function buildStoreLayout(
  categories: Category[],
  products: Product[],
  env: EnvLayout,
  stockFaceIds: readonly string[] | "all",
): StoreLayout {
  // Admin shelf mapping (product_shelf_placements): hidden products stay off the shelves (still sold in the
  // catalog); products pinned to a face go there first (that face is stocked even if not in the list);
  // higher priority is placed first. Everything else is distributed by category as before.
  const visible = products.filter((p) => p.variants.length > 0 && !p.shelf?.hiddenInStore);
  const faceIds = new Set(env.faces.map((f) => f.id));
  const pinnedFace = (p: Product) => (p.shelf?.faceId && faceIds.has(p.shelf.faceId) ? p.shelf.faceId : null);
  const byPriority = (a: Product, b: Product) => (b.shelf?.priority ?? 0) - (a.shelf?.priority ?? 0);
  const autoFaces = stockFaceIds === "all" ? env.faces : env.faces.filter((f) => stockFaceIds.includes(f.id));
  const pinnedIds = new Set(visible.map(pinnedFace).filter((id): id is string => id !== null));
  const faces = env.faces.filter((f) => autoFaces.includes(f) || pinnedIds.has(f.id));
  const byCat = new Map<string, Product[]>();
  for (const p of visible) {
    if (pinnedFace(p)) continue;
    const list = byCat.get(p.categoryId) ?? [];
    list.push(p);
    byCat.set(p.categoryId, list);
  }
  for (const list of byCat.values()) list.sort(byPriority);
  const cats = categories.filter((c) => (byCat.get(c.id)?.length ?? 0) > 0);
  const autoCats = categoriesForFaces(autoFaces.length, cats);
  const faceLists = faces.map((face) => {
    const pinned = visible.filter((p) => pinnedFace(p) === face.id).sort(byPriority);
    const ai = autoFaces.indexOf(face);
    return [...pinned, ...(ai >= 0 ? autoCats[ai]!.flatMap((c) => byCat.get(c.id) ?? []) : [])];
  });
  const faceCats = faceLists.map((list) => categories.filter((c) => list.some((p) => p.categoryId === c.id)));

  const items: Record<string, ItemPlacement[]> = {};
  const priceTags: PriceTag[] = [];
  const shelved = new Set<string>();

  faces.forEach((face, fi) => {
    const list = faceLists[fi]!;
    if (list.length === 0) return;
    const ax = faceAxes(face);
    const depthAvail = Math.abs(face.frontEdge - face.backEdge) - PLACEMENT.frontInset - 0.02;

    // Blocks = bays × boards, subdivided when there are more products than blocks.
    const baseBlocks = face.bays.length * face.boards.length;
    const split = Math.max(1, Math.ceil(list.length / baseBlocks));
    const spans: [number, number][] = face.bays.flatMap(([a, b]) =>
      Array.from({ length: split }, (_, s) => [a + ((b - a) * s) / split, a + ((b - a) * (s + 1)) / split] as [number, number]),
    );
    const blocks = spans.length * face.boards.length;

    // Vertical blocking: walk spans column by column, each product takes a contiguous run of blocks.
    let block = 0;
    spans.forEach(([a, b]) => {
      face.boards.forEach((boardY) => {
        const product = list[Math.floor((block * list.length) / blocks)]!;
        block++;
        const { h, w } = productItemDims(product.asset.heightMeters);
        const span = b - a;
        const pitch = w + PLACEMENT.facingGap;
        const facings = Math.max(1, Math.floor((span - 0.02) / pitch));
        const rows = clamp(Math.floor(depthAvail / (w + PLACEMENT.depthGap)), 1, PLACEMENT.maxDepthRows);
        const start = a + (span - facings * pitch) / 2 + pitch / 2;
        const inStock = product.variants.some((v) => v.stockQuantity > 0);
        priceTags.push({
          productId: product.id,
          faceId: face.id,
          position: ax.point((a + b) / 2, boardY - 0.035, -0.005),
          rotationY: ax.rotationY,
          width: Math.min(span - 0.04, 0.6),
        });
        shelved.add(product.id);
        if (!inStock) return; // honest empty facing: tag shows "Sold out"
        const arr = (items[product.id] ??= []);
        for (let f = 0; f < facings; f++) {
          for (let r = 0; r < rows; r++) {
            const depth = PLACEMENT.frontInset + w / 2 + r * (w + PLACEMENT.depthGap);
            arr.push({ position: ax.point(start + f * pitch, boardY + h / 2 + 0.002, depth), scale: [w, h, w], rotationY: ax.rotationY });
          }
        }
      });
    });
  });

  return {
    items,
    priceTags,
    signs: aisleSigns(env, faces, faceCats),
    stockedFaces: faces.map((f) => f.id),
    unplaced: visible.filter((p) => !shelved.has(p.id)).map((p) => p.id),
  };
}

/** One hanging sign at each end of every aisle formed by two facing stocked faces in the same column. */
function aisleSigns(env: EnvLayout, faces: ShelfFace[], faceCats: Category[][]): Sign[] {
  const signs: Sign[] = [];
  const done = new Set<string>();
  faces.forEach((a, i) => {
    faces.forEach((b, j) => {
      if (j <= i || done.has(a.id) || done.has(b.id)) return;
      if (a.normal[2] * b.normal[2] >= 0) return; // must face each other
      const gap = (b.frontEdge - a.frontEdge) * Math.sign(a.normal[2]);
      if (gap <= 0 || gap > 3.5) return;
      if (Math.abs(a.bays[0]![0] - b.bays[0]![0]) > 0.2) return; // same column
      done.add(a.id).add(b.id);
      const names = [...new Set([...faceCats[i]!, ...faceCats[j]!].map((c) => c.name))].join(" · ");
      const mid = (a.frontEdge + b.frontEdge) / 2;
      const x0 = a.bays[0]![0] - 0.45;
      const x1 = a.bays[a.bays.length - 1]![1] + 0.45;
      signs.push({ text: names, position: [x0, 2.75, mid], rotationY: -Math.PI / 2 });
      signs.push({ text: names, position: [x1, 2.75, mid], rotationY: Math.PI / 2 });
    });
  });
  return signs.filter((s) => s.position[0] > env.interior.min[0] && s.position[0] < env.interior.max[0]);
}
