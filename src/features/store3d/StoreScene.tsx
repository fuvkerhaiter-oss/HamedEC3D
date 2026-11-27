"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Environment, Lightformer, Text, useGLTF } from "@react-three/drei";
import { useCart } from "@/features/cart/cart-store";
import { categoryColor } from "@/lib/catalog/colors";
import { resizedImageUrl } from "@/lib/catalog/image";
import { priceIn, type Category, type Product } from "@/lib/catalog/types";
import { MARKETS } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { ASSETS } from "./assets/registry";
import { reshapeSupermarket } from "./env/reshape";
import { RentalShops } from "./wing/RentalShops";
import type { Box, EnvLayout } from "./env/types";
import { useInteractable } from "./interactables";
import type { ItemPlacement, PriceTag, StoreLayout } from "./layout";
import { useStoreUi, type InteractionTarget } from "./ui-store";
import { NewWing } from "./wing/NewWing";
import { ChristmasDecor } from "./xmas/ChristmasDecor";
import { XmasSpeakers } from "./xmas/XmasSpeakers";
import { CHRISTMAS_ON } from "./env/christmas";
import type { SupportersWall } from "@/lib/storefront/supporters";
import type { PublicShop } from "@/features/rentals/format";

export interface StoreCatalog {
  categories: Category[];
  products: Product[];
  /** Admin setting store.stock_all_faces; undefined = STORE_CONFIG default. */
  stockAllFaces?: boolean;
  /** Supporters wall at the chained wing (admin /admin/supporters); absent = empty board. */
  supporters?: SupportersWall;
  /** Rental shop availability + approved brand names (lib/rentals/public); absent = every shop "for rent". */
  shops?: PublicShop[];
}

const center = (b: Box) => b.min.map((v, i) => (v + b.max[i]!) / 2) as [number, number, number];

export function StoreScene({ env, layout, catalog, lowPower = false }: { env: EnvLayout; layout: StoreLayout; catalog: StoreCatalog; lowPower?: boolean }) {
  const colorOf = useMemo(() => {
    const cat = new Map(catalog.categories.map((c, i) => [c.id, categoryColor(c.slug, i)]));
    // Per-product colour from the layout (neighbours on a shelf differ); category colour only as a fallback.
    return (p: Product) => layout.colors[p.id] ?? cat.get(p.categoryId) ?? categoryColor(undefined);
  }, [catalog.categories, layout.colors]);
  const productById = useMemo(() => new Map(catalog.products.map((p) => [p.id, p])), [catalog.products]);

  return (
    <>
      <Lighting env={env} lowPower={lowPower} />
      <SupermarketModel />
      <NewWing env={env} lowPower={lowPower} supporters={catalog.supporters} />
      <RentalShops shops={catalog.shops} />
      {CHRISTMAS_ON && <ChristmasDecor env={env} lowPower={lowPower} />}
      {CHRISTMAS_ON && <XmasSpeakers env={env} lowPower={lowPower} />}
      <ShelfBlockers env={env} />
      {catalog.products.map((p) => {
        const placements = layout.items[p.id];
        return placements ? (
          <group key={`${p.id}-${placements.length}`}>
            <ProductInstances product={p} placements={placements} color={colorOf(p)} />
            {p.imageUrl && <ProductPhotoFaces url={resizedImageUrl(p.imageUrl, lowPower ? 256 : 640)} placements={placements} maxSize={lowPower ? 256 : 512} />}
          </group>
        ) : null;
      })}
      <PriceTags tags={layout.priceTags} productById={productById} />
      {layout.signs.map((s, i) => <AisleSign key={i} text={s.text} position={s.position} rotationY={s.rotationY} />)}
      {env.checkout && <CheckoutZone box={env.checkout} />}
    </>
  );
}

/** Material name of the floor tiles in supermarket.glb. */
const FLOOR_MATERIAL = "Material";

/** Imported store architecture + fixtures (see assets/registry.ts and ASSET_INVENTORY.md). */
function SupermarketModel() {
  const a = ASSETS.supermarket;
  const { scene } = useGLTF(a.url);
  // Far wall out, its fridge banks moved into the new hall (once per cached scene; see env/extension.ts).
  useMemo(() => reshapeSupermarket(scene), [scene]);
  useLayoutEffect(() => {
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = a.castShadow;
        m.receiveShadow = a.receiveShadow;
        // The source floor/wall normal maps are very strong (quilted look in-browser); soften them.
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat.normalMap) mat.normalScale.set(0.3, 0.3);
        // Floor tiles were authored half-metallic and mirror-smooth: every tile looked puffy and wet.
        // Polished vinyl: non-metal, soft sheen, barely any relief.
        if (mat.name === FLOOR_MATERIAL) {
          mat.metalness = 0;
          mat.roughness = 0.42;
          mat.normalScale.set(0.08, 0.08);
        }
      }
    });
  }, [scene, a.castShadow, a.receiveShadow]);
  return <primitive object={scene} scale={a.scale} rotation={a.rotation} position={a.position} />;
}

/** lowPower (phones/tablets): half-res shadow map (4× less memory + fill) and env map; same look at phone pixel sizes. */
function Lighting({ env, lowPower }: { env: EnvLayout; lowPower: boolean }) {
  const { min, max } = env.interior;
  const w = max[0] - min[0];
  const d = max[2] - min[2];
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const h = env.ceilingY;
  return (
    <>
      <hemisphereLight args={["#fffaf0", "#b9ae9c", 0.45]} />
      <directionalLight
        position={[cx + 6, 14, cz + 6]}
        intensity={0.85}
        castShadow
        shadow-mapSize={lowPower ? [1024, 1024] : [2048, 2048]}
        shadow-camera-left={-w / 2 - 2}
        shadow-camera-right={w / 2 + 2}
        shadow-camera-top={d / 2 + 2}
        shadow-camera-bottom={-d / 2 - 2}
        shadow-camera-far={45}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      {/* Local reflections from the ceiling panels, without downloading an HDR file. */}
      <Environment resolution={lowPower ? 128 : 256} frames={1} environmentIntensity={0.7}>
        <Lightformer form="rect" intensity={1.1} position={[cx, h, cz]} rotation-x={Math.PI / 2} scale={[w, d, 1]} />
        <Lightformer form="rect" intensity={0.7} color="#ffe2b8" position={[cx, 1.5, max[2]]} scale={[w, 3, 1]} />
        <Lightformer form="rect" intensity={0.6} position={[min[0], 2, cz]} rotation-y={Math.PI / 2} scale={[d, 3, 1]} />
      </Environment>
    </>
  );
}

/** Invisible dividers so the crosshair can't pick products through the back of a gondola. */
function ShelfBlockers({ env }: { env: EnvLayout }) {
  return (
    <>
      {env.runs.map((r) => <Blocker key={r.id} box={r.box} />)}
    </>
  );
}
function Blocker({ box }: { box: Box }) {
  const ref = useRef<THREE.Mesh>(null);
  useInteractable(ref, null);
  const [cx, cy, cz] = center(box);
  return (
    <mesh ref={ref} position={[cx, cy, cz]} visible={false}>
      <boxGeometry args={[box.max[0] - box.min[0], box.max[1] - box.min[1], 0.06]} />
      <meshBasicMaterial />
    </mesh>
  );
}

function ProductInstances({ product, placements, color }: { product: Product; placements: ItemPlacement[]; color: string }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const target = useMemo<InteractionTarget>(
    () => ({ key: `product:${product.id}`, kind: "product", productId: product.id, label: product.name }),
    [product.id, product.name],
  );
  useInteractable(ref, target);
  const highlighted = useStoreUi((s) => s.target?.key === target.key);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    placements.forEach((it, i) => {
      q.setFromEuler(e.set(0, it.rotationY, 0));
      m.compose(p.set(...it.position), q, s.set(...it.scale));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(color).offsetHSL(0, 0, (((i * 37) % 7) - 3) * 0.012));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [placements, color]);

  // Placeholder shapes until a product GLB is uploaded for this product (never a look-alike of another product).
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, placements.length]} castShadow receiveShadow>
      <boxGeometry />
      <meshStandardMaterial roughness={0.5} emissive={color} emissiveIntensity={highlighted ? 0.45 : 0} />
    </instancedMesh>
  );
}

/**
 * The product's main image (managed in Admin → Product images) as a front label on every shelf placeholder.
 * One texture + one instanced plane mesh per product; nothing renders if the image can't be loaded.
 */
function ProductPhotoFaces({ url, placements, maxSize }: { url: string; placements: ItemPlacement[]; maxSize: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let disposed = false;
    let tex: THREE.Texture | null = null;
    const loader = new THREE.ImageLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(url, (img) => {
      if (disposed) return;
      // Uploaded photos can be 2400 px+ (≈20 MB of GPU memory each with mipmaps). A shelf label never needs
      // that: downscale before upload so a large catalog can't exhaust phone (especially iPhone) GPU memory.
      const t = downscaledTexture(img, maxSize);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      tex = t;
      setTexture(t);
    }, undefined, () => setTexture(null));
    return () => {
      disposed = true;
      tex?.dispose();
    };
  }, [url, maxSize]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh || !texture) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const offset = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    placements.forEach((it, i) => {
      q.setFromEuler(e.set(0, it.rotationY, 0));
      offset.set(0, 0, it.scale[2] / 2 + 0.002).applyQuaternion(q); // just in front of the box's aisle-facing side
      pos.set(...it.position).add(offset);
      m.compose(pos, q, scl.set(it.scale[0] * 0.9, it.scale[1] * 0.9, 1));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [placements, texture]);

  if (!texture) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, placements.length]} raycast={() => null}>
      <planeGeometry />
      <meshStandardMaterial map={texture} roughness={0.6} />
    </instancedMesh>
  );
}

/** Texture from an image, resized on a canvas so its longest side is at most `maxSize` px. */
function downscaledTexture(img: HTMLImageElement, maxSize: number): THREE.Texture {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const k = maxSize / Math.max(w, h, 1);
  if (k < 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * k));
    canvas.height = Math.max(1, Math.round(h * k));
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return new THREE.CanvasTexture(canvas);
    }
  }
  const t = new THREE.Texture(img);
  t.needsUpdate = true;
  return t;
}

/** Shelf-edge labels with live prices from the catalog, in the shopper's market currency. */
function PriceTags({ tags, productById }: { tags: PriceTag[]; productById: Map<string, Product> }) {
  const market = MARKETS[useCart((s) => s.market)];
  return (
    <>
      {tags.map((t, i) => {
        const p = productById.get(t.productId);
        if (!p) return null;
        const prices = p.variants.map((v) => priceIn(v, market.currency)).filter((m) => m !== null);
        const cheapest = prices.sort((a, b) => a.amount - b.amount)[0];
        const soldOut = p.variants.every((v) => v.stockQuantity <= 0);
        const label = soldOut ? "Sold out" : cheapest ? `${prices.length > 1 ? "from " : ""}${formatMoney(cheapest, market.locale)}` : "—";
        return (
          <group key={i} position={t.position} rotation-y={t.rotationY}>
            <mesh position={[0, 0, 0.002]}>
              <planeGeometry args={[0.2, 0.045]} />
              <meshStandardMaterial color={soldOut ? "#fde8e6" : "#ffffff"} roughness={0.6} />
            </mesh>
            <Text position={[0, 0.006, 0.004]} fontSize={0.022} color={soldOut ? "#b42318" : "#111513"} anchorX="center" anchorY="middle">
              {label}
            </Text>
            <Text position={[0, -0.013, 0.004]} fontSize={0.0105} maxWidth={0.19} color="#2a302d" anchorX="center" anchorY="middle">
              {p.name}
            </Text>
          </group>
        );
      })}
    </>
  );
}

function AisleSign({ text, position, rotationY }: { text: string; position: [number, number, number]; rotationY: number }) {
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh>
        <boxGeometry args={[2.3, 0.34, 0.04]} />
        <meshStandardMaterial color="#111513" roughness={0.4} />
      </mesh>
      {/* Printed on both faces so the sign reads from either end of the aisle. */}
      {[0, Math.PI].map((r) => (
        <Text key={r} rotation-y={r} position={[0, 0, r ? -0.025 : 0.025]} fontSize={0.11} maxWidth={2.15} color="#f7f4ee" anchorX="center" anchorY="middle" textAlign="center">
          {text}
        </Text>
      ))}
    </group>
  );
}

/** The imported checkout counter becomes an interaction zone (opens cart & checkout). */
function CheckoutZone({ box }: { box: Box }) {
  const ref = useRef<THREE.Mesh>(null);
  const target = useMemo<InteractionTarget>(() => ({ key: "checkout", kind: "checkout", label: "Checkout counter" }), []);
  useInteractable(ref, target);
  const [cx, cy, cz] = center(box);
  return (
    <>
      <mesh ref={ref} position={[cx, cy, cz]} visible={false}>
        <boxGeometry args={[box.max[0] - box.min[0] + 0.1, box.max[1] - box.min[1] + 0.1, box.max[2] - box.min[2] + 0.1]} />
        <meshBasicMaterial />
      </mesh>
      <Text position={[cx + 0.9, 2.3, cz]} rotation-y={Math.PI / 2} fontSize={0.28} color="#111513" anchorX="center" anchorY="middle">
        Checkout
      </Text>
    </>
  );
}
