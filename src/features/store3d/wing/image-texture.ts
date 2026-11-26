"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";
import { canOptimize, resizedImageUrl } from "@/lib/catalog/image";

/**
 * Loads an image as a texture (sRGB), served through the image optimiser when allowed. Returns null while loading,
 * when there's no URL or when it fails (callers show a placeholder); disposes the texture on change/unmount.
 */
export function useImageTexture(url: string | null, width: 256 | 640 = 256): THREE.Texture | null {
  const [state, setState] = useState<{ url: string; tex: THREE.Texture } | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    let loaded: THREE.Texture | null = null;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      canOptimize(url) ? resizedImageUrl(url, width) : url,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        loaded = t;
        if (alive) setState({ url, tex: t });
        else t.dispose();
      },
      undefined,
      () => {}, // missing / blocked image: keep the placeholder
    );
    return () => {
      alive = false;
      loaded?.dispose();
    };
  }, [url, width]);
  return url && state?.url === url ? state.tex : null;
}
