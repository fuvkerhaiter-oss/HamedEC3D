"use client";

/**
 * A shop renter's published products on the gondola shelves of their open shop: each product fills one bay of one
 * shelf (three facings: a white box with the product photo on its front) with a price tag on the shelf edge, best
 * slots first (env/shop-interior productSlots). Aim + E opens the in-store product panel (hud/TenantProductPanel);
 * "Buy" goes to the renter's own payment page.
 */
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import { fmtPrice, type PublicStorefront, type PublicTenantProduct } from "@/features/rentals/format";
import { productSlots, type ProductSlot } from "../env/shop-interior";
import { SHOP_UNITS } from "../env/shops";
import { useInteractable } from "../interactables";
import type { InteractionTarget } from "../ui-store";
import { useImageTexture } from "./image-texture";

const FACINGS = [-0.62, 0, 0.62];
const BOX = { w: 0.34, d: 0.24 } as const;

export function TenantShelves({ shopId, store }: { shopId: string; store: PublicStorefront }) {
  const unit = SHOP_UNITS.find((u) => u.id === shopId);
  const slots = useMemo(() => (unit ? productSlots(unit) : []), [unit]);
  const side = useMemo(() => new THREE.MeshStandardMaterial({ color: "#f4f2ec", roughness: 0.6 }), []);
  return (
    <group>
      {store.products.slice(0, slots.length).map((p, i) => (
        <ProductOnShelf key={p.id} product={p} slot={slots[i]!} shopId={shopId} accent={store.accent} brand={store.brand} side={side} />
      ))}
    </group>
  );
}

function ProductOnShelf({ product, slot, shopId, accent, brand, side }: { product: PublicTenantProduct; slot: ProductSlot; shopId: string; accent: string; brand: string; side: THREE.Material }) {
  const ref = useRef<THREE.Group>(null);
  const target = useMemo<InteractionTarget>(() => ({ key: `tp:${product.id}`, kind: "tenantProduct", productId: product.id, shopId, label: product.title }), [product.id, product.title, shopId]);
  useInteractable(ref, target);
  const tex = useImageTexture(product.imageUrl);
  const h = Math.min(0.38, slot.height - 0.04);
  const front = useMemo(() => (tex ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }) : new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 })), [tex, accent]);
  // Box faces: +x, −x, +y, −y, +z (front: the photo), −z.
  const mats = useMemo(() => [side, side, side, side, front, side], [side, front]);
  const tagColor = accent.toLowerCase() === "#ffffff" ? "#f7c416" : accent;
  return (
    <group ref={ref} position={slot.position} rotation-y={slot.yaw}>
      {FACINGS.map((x) => (
        <mesh key={x} position={[x, h / 2 + 0.005, 0]} material={mats} castShadow>
          <boxGeometry args={[BOX.w, h, BOX.d]} />
        </mesh>
      ))}
      {!tex &&
        FACINGS.map((x) => (
          <Text key={x} position={[x, h / 2, BOX.d / 2 + 0.002]} fontSize={0.035} maxWidth={BOX.w - 0.04} color="#ffffff" anchorX="center" anchorY="middle" textAlign="center">
            {product.title}
          </Text>
        ))}
      {/* shelf-edge price tag */}
      <group position={[0, -0.035, 0.205]}>
        <mesh>
          <planeGeometry args={[0.36, 0.07]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
        <mesh position={[-0.155, 0, 0.001]}>
          <planeGeometry args={[0.05, 0.07]} />
          <meshBasicMaterial color={tagColor} toneMapped={false} />
        </mesh>
        <Text position={[0.025, 0.008, 0.002]} fontSize={0.03} color="#111513" anchorX="center" anchorY="middle" fontWeight={800}>
          {fmtPrice(product.price, product.currency)}
        </Text>
        <Text position={[0.025, -0.021, 0.002]} fontSize={0.013} maxWidth={0.28} color="#454b47" anchorX="center" anchorY="middle">
          {`${brand} · ${product.title}`.slice(0, 44)}
        </Text>
      </group>
    </group>
  );
}
