/**
 * Live positions for the minimap (../hud/MiniMap). Written every frame from inside the 3D scene (MapTracker for the
 * shopper, BotShoppers for the demo bots) and read by the DOM minimap's own animation loop. Plain mutable module
 * state on purpose: no React re-render per frame.
 */
export interface MapDot {
  x: number;
  z: number;
  color: string;
  name: string;
}

export const mapLive = {
  player: { x: 0, z: 0, yaw: 0, valid: false },
  bots: [] as MapDot[],
};

/** Map heading of a camera yaw: forward = (−sin yaw, −cos yaw) in world x/z. */
export function forwardXZ(yaw: number): [number, number] {
  return [-Math.sin(yaw), -Math.cos(yaw)];
}
