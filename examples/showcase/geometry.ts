// Shapes made here, as numbers.
import type { GeometryData } from "framescript/3d"

/**
 * `n` by `n` columns `spacing` apart, centered on the origin: boxes from y = 0 to y = 1, without
 * bottoms, whose uv is the cell they are in (city.wgsl makes them as tall as it likes).
 */
export function columns(n: number, spacing: number, width: number): GeometryData {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const h = width / 2
  // Each face: four corners (x, y, z offsets from the column's foot), counter-clockwise seen from outside.
  const faces: [number[], number[][]][] = [
    [[0, 1, 0], [[-h, 1, h], [h, 1, h], [h, 1, -h], [-h, 1, -h]]],
    [[0, 0, 1], [[-h, 0, h], [h, 0, h], [h, 1, h], [-h, 1, h]]],
    [[0, 0, -1], [[h, 0, -h], [-h, 0, -h], [-h, 1, -h], [h, 1, -h]]],
    [[1, 0, 0], [[h, 0, h], [h, 0, -h], [h, 1, -h], [h, 1, h]]],
    [[-1, 0, 0], [[-h, 0, -h], [-h, 0, h], [-h, 1, h], [-h, 1, -h]]],
  ]
  const origin = ((n - 1) * spacing) / 2
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = i * spacing - origin
      const z = j * spacing - origin
      for (const [normal, corners] of faces) {
        const first = positions.length / 3
        for (const [dx, y, dz] of corners) {
          positions.push(x + dx, y, z + dz)
          normals.push(...normal)
          uvs.push(i + 0.5, j + 0.5)
        }
        indices.push(first, first + 1, first + 2, first, first + 2, first + 3)
      }
    }
  }
  return { positions, normals, uvs, indices }
}

/** A (p, q) torus knot: a tube of radius `tube` round a curve on a torus of radius `radius`. */
export function torusKnot(radius: number, tube: number, p = 2, q = 3, along = 320, round = 40): GeometryData {
  const curve = (u: number): [number, number, number] => {
    const qu = (q / p) * u
    const r = radius * (2 + Math.cos(qu)) * 0.5
    return [r * Math.cos(u), r * Math.sin(u), radius * Math.sin(qu) * 0.5]
  }
  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  const add = (a: number[], b: number[]) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const unit = (a: number[]) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1
    return [a[0] / l, a[1] / l, a[2] / l]
  }
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= along; i++) {
    const u = (i / along) * p * Math.PI * 2
    const p1 = curve(u)
    const p2 = curve(u + 0.01)
    const t = sub(p2, p1)
    let n = add(p2, p1)
    const b = unit(cross(t, n))
    n = unit(cross(b, t))
    for (let j = 0; j <= round; j++) {
      const v = (j / round) * Math.PI * 2
      const cx = -tube * Math.cos(v)
      const cy = tube * Math.sin(v)
      const offset = [cx * n[0] + cy * b[0], cx * n[1] + cy * b[1], cx * n[2] + cy * b[2]]
      positions.push(p1[0] + offset[0], p1[1] + offset[1], p1[2] + offset[2])
      normals.push(...unit(offset))
      uvs.push(i / along, j / round)
    }
  }
  for (let i = 0; i < along; i++) {
    for (let j = 0; j < round; j++) {
      const a = i * (round + 1) + j
      const b = (i + 1) * (round + 1) + j
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  return { positions, normals, uvs, indices }
}
