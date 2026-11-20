"use client";

import { useEffect, type RefObject } from "react";
import type { Object3D } from "three";
import type { InteractionTarget } from "./ui-store";

/**
 * Registry of raycastable objects. A null target marks a blocker (e.g. a shelf),
 * so products behind shelves can't be selected through them.
 */
const registry = new Map<Object3D, InteractionTarget | null>();
let cache: Object3D[] | null = null;

export const interactionRegistry = {
  objects(): Object3D[] {
    return (cache ??= Array.from(registry.keys()));
  },
  /** Walk up from the hit object to the registered ancestor. */
  resolve(obj: Object3D | null): InteractionTarget | null {
    for (let o: Object3D | null = obj; o; o = o.parent) {
      if (registry.has(o)) return registry.get(o) ?? null;
    }
    return null;
  },
};

/** Register an object; pass a memoized target (or null for a blocker). */
export function useInteractable(ref: RefObject<Object3D | null>, target: InteractionTarget | null): void {
  useEffect(() => {
    const obj = ref.current;
    if (!obj) return;
    registry.set(obj, target);
    cache = null;
    return () => {
      registry.delete(obj);
      cache = null;
    };
  }, [ref, target]);
}
