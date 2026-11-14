// Outlines as the same number of points, all starting at the top and going round clockwise, so that
// any one can turn into any other point by point.

export type Points = Float64Array

/** How many points every outline has. */
export const N = 180

/** Points along the closed polyline `corners`, evenly by length, starting at its first. */
function along(corners: [number, number][]): Points {
  const lengths = corners.map((p, i) => {
    const q = corners[(i + 1) % corners.length]
    return Math.hypot(q[0] - p[0], q[1] - p[1])
  })
  const total = lengths.reduce((a, b) => a + b, 0)
  const out = new Float64Array(N * 2)
  let edge = 0
  let before = 0
  for (let i = 0; i < N; i++) {
    const at = (i / N) * total
    while (before + lengths[edge] < at) before += lengths[edge++]
    const t = (at - before) / lengths[edge]
    const [p, q] = [corners[edge], corners[(edge + 1) % corners.length]]
    out[i * 2] = p[0] + (q[0] - p[0]) * t
    out[i * 2 + 1] = p[1] + (q[1] - p[1]) * t
  }
  return out
}

/** Points at even angles, each at the radius `r` gives for its angle (0 at the top, clockwise). */
function polar(r: (a: number) => number): Points {
  const out = new Float64Array(N * 2)
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2
    const d = r(a)
    out[i * 2] = Math.sin(a) * d
    out[i * 2 + 1] = -Math.cos(a) * d
  }
  return out
}

/** A regular polygon of `sides`, a corner at the top, its corners `r` out. */
export function polygon(sides: number, r: number): Points {
  const corners: [number, number][] = []
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2
    corners.push([Math.sin(a) * r, -Math.cos(a) * r])
  }
  return along(corners)
}

export const circle = (r: number) => polar(() => r)

/** A square standing on a side, its corners `r` out, starting at the middle of its top. */
export function square(r: number): Points {
  const s = r / Math.SQRT2
  return along([[0, -s], [s, -s], [s, s], [-s, s], [-s, -s]])
}

export function star(points: number, outer: number, inner: number): Points {
  const corners: [number, number][] = []
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2
    const r = i % 2 ? inner : outer
    corners.push([Math.sin(a) * r, -Math.cos(a) * r])
  }
  return along(corners)
}

export const flower = (petals: number, r: number, depth = 0.22) =>
  polar((a) => r * (1 - depth + depth * Math.cos(a * petals)))

/** A soft shape whose bumps move with `phase`. */
export const blob = (r: number, phase: number) =>
  polar((a) => r * (1 + 0.1 * Math.sin(a * 3 + phase) + 0.06 * Math.sin(a * 5 - phase * 1.7) + 0.04 * Math.cos(a * 2 + phase * 0.6)))

/** A heart, its dip at the top. */
export function heart(r: number): Points {
  const out = new Float64Array(N * 2)
  for (let i = 0; i < N; i++) {
    // From the dip, round the right lobe, down to the point, and up the left.
    const t = (i / N) * Math.PI * 2
    const x = 16 * Math.sin(t) ** 3
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
    out[i * 2] = (x / 17) * r
    out[i * 2 + 1] = (-y / 17) * r - r * 0.12
  }
  return out
}

/** Partway from `a` to `b`. */
export function between(a: Points, b: Points, t: number): Points {
  const out = new Float64Array(N * 2)
  for (let i = 0; i < N * 2; i++) out[i] = a[i] + (b[i] - a[i]) * t
  return out
}

/** Path data for the closed outline through `p`, moved to (x, y), scaled and turned. */
export function outline(p: Points, x = 0, y = 0, scale = 1, degrees = 0): string {
  const [c, s] = [Math.cos((degrees * Math.PI) / 180) * scale, Math.sin((degrees * Math.PI) / 180) * scale]
  let d = ""
  for (let i = 0; i < N; i++) {
    const [px, py] = [p[i * 2], p[i * 2 + 1]]
    d += `${i ? "L" : "M"}${(x + px * c - py * s).toFixed(2)} ${(y + px * s + py * c).toFixed(2)}`
  }
  return d + "Z"
}
