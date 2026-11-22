import raw from "./supermarket.layout.json";
import { extendLayout } from "./extension";
import type { EnvLayout, Vec3 } from "./types";

/** Measured layout of public/models/env/supermarket.glb (regenerate with tools/assets/build_env.py). */
export const SUPERMARKET = raw as unknown as EnvLayout;

export const STORE_CONFIG = {
  /** Just inside the entrance, looking down the benchmark aisle (between runs L1 and L2). */
  spawn: [-9.0, 1.0, -1.27] as Vec3,
  spawnYaw: -Math.PI / 2, // facing +X
  /** Quality benchmark: the first fully stocked aisle. */
  benchmarkFaces: ["L1N", "L2S"],
  /** Flip to true once the benchmark aisle is approved to stock every gondola face. */
  stockAllFaces: false,
} as const;

/** The store as shoppers walk it: SUPERMARKET with the far wall opened into the new hall + coming-soon wing (./extension). */
export const STORE_ENV: EnvLayout = extendLayout(SUPERMARKET);
