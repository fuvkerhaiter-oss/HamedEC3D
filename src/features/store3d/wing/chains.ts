/**
 * Chain layout: a chain hangs between two anchors with a parabolic sag and is built from rigid copies of one chain
 * segment (the model is 1 m long along +X). Each copy is placed on a chord of the curve and scaled uniformly so the
 * chords tile the whole curve without gaps. Pure math (unit tested); the renderer turns it into one InstancedMesh.
 */
export type V3 = [number, number, number];

export interface ChainSpan {
  from: V3;
  to: V3;
  /** Lowest point below the straight line between the anchors, in meters (0 = taut). */
  sag: number;
}

export interface SegmentPose {
  position: V3;
  /** Unit direction of the segment (its local +X). */
  dir: V3;
  /** Uniform scale (segment model is 1 m long). */
  scale: number;
}

/** Point on the sagging chain at t ∈ [0, 1]. */
export function chainPoint(span: ChainSpan, t: number): V3 {
  const { from: a, to: b } = span;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - 4 * span.sag * t * (1 - t), a[2] + (b[2] - a[2]) * t];
}

/** Approximate arc length (dense polyline). */
export function chainLength(span: ChainSpan, samples = 64): number {
  let len = 0;
  let p = chainPoint(span, 0);
  for (let i = 1; i <= samples; i++) {
    const q = chainPoint(span, i / samples);
    len += Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    p = q;
  }
  return len;
}

/**
 * Segments for one span. `segmentLength` is the wanted length of one copy (= its uniform scale); the count is rounded
 * so copies fit end to end; chord endpoints are spaced evenly by arc length.
 */
export function chainSegments(span: ChainSpan, segmentLength: number): SegmentPose[] {
  const samples = 128;
  const pts: V3[] = [];
  const acc: number[] = [0];
  for (let i = 0; i <= samples; i++) {
    pts.push(chainPoint(span, i / samples));
    if (i > 0) {
      const p = pts[i - 1]!, q = pts[i]!;
      acc.push(acc[i - 1]! + Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]));
    }
  }
  const total = acc[samples]!;
  const n = Math.max(1, Math.round(total / segmentLength));
  const at = (s: number): V3 => {
    let i = 1;
    while (i < samples && acc[i]! < s) i++;
    const k = (s - acc[i - 1]!) / Math.max(1e-9, acc[i]! - acc[i - 1]!);
    const p = pts[i - 1]!, q = pts[i]!;
    return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k];
  };
  const out: SegmentPose[] = [];
  for (let j = 0; j < n; j++) {
    const a = at((total * j) / n);
    const b = at((total * (j + 1)) / n);
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(...d);
    out.push({
      position: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
      dir: [d[0] / len, d[1] / len, d[2] / len],
      scale: len,
    });
  }
  return out;
}
