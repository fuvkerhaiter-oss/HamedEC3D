"use client";

/**
 * Big 16:9 Smart OLED TV for rental shop interiors (wall-mounted or ceiling-suspended with support poles).
 * Cycles through the shop owner's uploaded ad images with a sleek bezel, ambient backlight halo,
 * "AD" corner badge, and slide indicator dots. Falls back to a branded promo screen when no ads are uploaded.
 */
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { RoundedBox, Text } from "@react-three/drei";
import { useImageTexture } from "./image-texture";

function useFallbackScreen(brand: string | null, accent: string): THREE.CanvasTexture | null {
  const tex = useMemo(() => {
    if (typeof document === "undefined") return null;
    const c = new THREE.Color(accent);
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const ink = lum < 0.15 ? "#f7c416" : accent;
    const cv = document.createElement("canvas");
    cv.width = 1024;
    cv.height = 576;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    const g = ctx.createLinearGradient(0, 0, 1024, 576);
    g.addColorStop(0, "#12161c");
    g.addColorStop(1, "#080a0d");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 576);
    const rad = ctx.createRadialGradient(512, 288, 30, 512, 288, 460);
    rad.addColorStop(0, `${ink}33`);
    rad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, 1024, 576);
    ctx.strokeStyle = `${ink}88`;
    ctx.lineWidth = 4;
    ctx.strokeRect(32, 32, 960, 512);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = ink;
    ctx.font = '800 62px "Segoe UI", system-ui, sans-serif';
    ctx.fillText((brand || "YOUR BRAND").toUpperCase().slice(0, 22), 512, 250);
    ctx.fillStyle = "#e6e1d6";
    ctx.font = '600 28px "Segoe UI", system-ui, sans-serif';
    ctx.fillText("SPECIAL OFFERS & NEW ARRIVALS", 512, 330);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [brand, accent]);
  useLayoutEffect(() => () => tex?.dispose(), [tex]);
  return tex;
}

function SlideTexturePlane({ url, w, h, z }: { url: string; w: number; h: number; z: number }) {
  const tex = useImageTexture(url, 640);
  if (!tex) return null;
  return (
    <mesh position={[0, 0, z]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  );
}

function TvFace({
  w,
  h,
  zDir,
  activeUrl,
  fallback,
  slidesCount,
  idx,
}: {
  w: number;
  h: number;
  zDir: 1 | -1;
  activeUrl: string | null;
  fallback: THREE.CanvasTexture | null;
  slidesCount: number;
  idx: number;
}) {
  return (
    <group rotation-y={zDir < 0 ? Math.PI : 0}>
      <mesh position={[0, 0, 0.041]}>
        <planeGeometry args={[w - 0.12, h - 0.12]} />
        {fallback ? <meshBasicMaterial map={fallback} toneMapped={false} /> : <meshBasicMaterial color="#0b0e12" />}
      </mesh>
      {activeUrl && <SlideTexturePlane key={activeUrl} url={activeUrl} w={w - 0.12} h={h - 0.12} z={0.042} />}
      <group position={[-w / 2 + 0.24, h / 2 - 0.18, 0.046]}>
        <mesh>
          <planeGeometry args={[0.26, 0.12]} />
          <meshBasicMaterial color="#0d1311" transparent opacity={0.82} />
        </mesh>
        <Text position={[0, 0, 0.002]} fontSize={0.07} letterSpacing={0.14} color="#f7c416" anchorX="center" anchorY="middle" fontWeight={800}>
          AD
        </Text>
      </group>
      {slidesCount > 1 && (
        <group position={[0, -h / 2 + 0.12, 0.046]}>
          {Array.from({ length: slidesCount }, (_, i) => {
            const x = (i - (slidesCount - 1) / 2) * 0.11;
            const on = i === idx % slidesCount;
            return (
              <mesh key={i} position={[x, 0, 0]}>
                <circleGeometry args={[on ? 0.032 : 0.02, 12]} />
                <meshBasicMaterial color={on ? "#f7c416" : "#ffffff"} transparent opacity={on ? 1 : 0.45} toneMapped={false} />
              </mesh>
            );
          })}
        </group>
      )}
    </group>
  );
}

export function ShopTv({
  position,
  rotationY = 0,
  slides,
  brand,
  accent,
  width = 3.6,
  ceilingY,
  doubleSided = false,
}: {
  position: [number, number, number];
  rotationY?: number;
  slides: readonly string[];
  brand: string | null;
  accent: string;
  width?: number;
  /** When set, suspends the TV from this ceiling height with two steel support poles. */
  ceilingY?: number;
  doubleSided?: boolean;
}) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    // One slide or none: nothing to rotate (the index is always read modulo the slide count below).
    if (slides.length <= 1) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % slides.length), 4500);
    return () => clearInterval(id);
  }, [slides.length]);

  const h = (width * 9) / 16;
  const activeUrl = slides.length ? slides[idx % slides.length]! : null;
  const fallback = useFallbackScreen(brand, accent);
  const poleLen = ceilingY !== undefined ? Math.max(0.1, ceilingY - (position[1] + h / 2)) : 0;

  return (
    <group position={position} rotation-y={rotationY}>
      {/* ceiling support poles & flange plates */}
      {ceilingY !== undefined &&
        [-width * 0.3, width * 0.3].map((px, i) => (
          <group key={i} position={[px, h / 2, 0]}>
            <mesh position={[0, poleLen / 2, 0]}>
              <cylinderGeometry args={[0.032, 0.032, poleLen, 12]} />
              <meshStandardMaterial color="#23272b" metalness={0.8} roughness={0.28} />
            </mesh>
            <mesh position={[0, poleLen - 0.015, 0]}>
              <cylinderGeometry args={[0.09, 0.09, 0.03, 16]} />
              <meshStandardMaterial color="#14181c" metalness={0.7} roughness={0.35} />
            </mesh>
          </group>
        ))}

      {/* ambient backlight halo */}
      {!doubleSided && (
        <mesh position={[0, 0, 0.004]}>
          <planeGeometry args={[width + 0.36, h + 0.36]} />
          <meshBasicMaterial color={accent} transparent opacity={0.18} depthWrite={false} toneMapped={false} />
        </mesh>
      )}

      {/* slim outer bezel */}
      <RoundedBox args={[width + 0.08, h + 0.08, 0.07]} radius={0.025} smoothness={2} position={[0, 0, 0]}>
        <meshStandardMaterial color="#111418" metalness={0.65} roughness={0.26} />
      </RoundedBox>

      <TvFace w={width} h={h} zDir={1} activeUrl={activeUrl} fallback={fallback} slidesCount={slides.length} idx={idx} />
      {doubleSided && <TvFace w={width} h={h} zDir={-1} activeUrl={activeUrl} fallback={fallback} slidesCount={slides.length} idx={idx} />}
    </group>
  );
}
