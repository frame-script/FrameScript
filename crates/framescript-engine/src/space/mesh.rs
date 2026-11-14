//! The shapes of things in 3D, made on the CPU once and kept by what they were made from.
//!
//! Vertices are a position, a normal and a uv; uv (0, 0) is the top left of a picture. Faces are
//! counter-clockwise seen from outside. The shapes are those of three.js, with the same parameters.

use glam::Vec3;
use std::f32::consts::{PI, TAU};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

/// Floats per vertex: position, normal, uv.
pub const STRIDE: usize = 8;

pub struct MeshData {
    /// The renderers keep the buffers they make of it by this.
    pub id: u64,
    pub vertices: Vec<f32>,
    pub indices: Vec<u32>,
    /// The corners of the box all of it is in, in its own space.
    pub bounds: (Vec3, Vec3),
}

impl MeshData {
    fn new(vertices: Vec<f32>, indices: Vec<u32>) -> Arc<Self> {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let mut bounds = (Vec3::splat(f32::INFINITY), Vec3::splat(f32::NEG_INFINITY));
        for v in vertices.chunks_exact(STRIDE) {
            let p = Vec3::new(v[0], v[1], v[2]);
            bounds = (bounds.0.min(p), bounds.1.max(p));
        }
        if vertices.is_empty() {
            bounds = (Vec3::ZERO, Vec3::ZERO);
        }
        Arc::new(Self {
            id: NEXT.fetch_add(1, Ordering::Relaxed),
            vertices,
            indices,
            bounds,
        })
    }
}

/// What a shape is made from, as the scripts send it: the kind, then its numbers.
pub mod shape {
    pub const BOX: u32 = 0;
    pub const SPHERE: u32 = 1;
    /// Width, height, and how many pieces across and down.
    pub const PLANE: u32 = 2;
    pub const CYLINDER: u32 = 3;
    pub const TORUS: u32 = 4;
    /// Vertex count, index count, whether normals and uvs are given, then the positions, the
    /// normals, the uvs and the indices.
    pub const CUSTOM: u32 = 5;
}

/// Makes the shape `kind` from `args`.
pub fn make(kind: u32, args: &[f32]) -> Result<Arc<MeshData>, String> {
    let arg = |i: usize, default: f32| args.get(i).copied().filter(|v| v.is_finite()).unwrap_or(default);
    let segments = |i: usize, default: f32, least: u32| (arg(i, default).round().max(least as f32) as u32).min(1024);
    let mut m = Builder::default();
    match kind {
        shape::BOX => m.cuboid(arg(0, 1.0), arg(1, 1.0), arg(2, 1.0)),
        shape::SPHERE => m.sphere(arg(0, 1.0), segments(1, 48.0, 3), segments(2, 32.0, 2)),
        shape::PLANE => m.plane(arg(0, 1.0), arg(1, 1.0), segments(2, 1.0, 1), segments(3, 1.0, 1)),
        shape::CYLINDER => m.cylinder(arg(0, 1.0), arg(1, 1.0), arg(2, 1.0), segments(3, 48.0, 3)),
        shape::TORUS => m.torus(arg(0, 1.0), arg(1, 0.4), segments(2, 24.0, 2), segments(3, 64.0, 3)),
        shape::CUSTOM => return custom(args),
        other => return Err(format!("no shape {other}")),
    }
    Ok(MeshData::new(m.vertices, m.indices))
}

#[derive(Default)]
struct Builder {
    vertices: Vec<f32>,
    indices: Vec<u32>,
}

impl Builder {
    fn vertex(&mut self, p: Vec3, n: Vec3, uv: [f32; 2]) -> u32 {
        let i = (self.vertices.len() / STRIDE) as u32;
        self.vertices.extend_from_slice(&[p.x, p.y, p.z, n.x, n.y, n.z, uv[0], uv[1]]);
        i
    }

    /// A rectangle around `c`, half of it `right` and `up` across, facing `right × up`.
    fn face(&mut self, c: Vec3, right: Vec3, up: Vec3) {
        let n = right.cross(up).normalize();
        let base = self.vertex(c - right - up, n, [0.0, 1.0]);
        self.vertex(c + right - up, n, [1.0, 1.0]);
        self.vertex(c + right + up, n, [1.0, 0.0]);
        self.vertex(c - right + up, n, [0.0, 0.0]);
        self.indices.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
    }

    /// In the XY plane, facing +Z, cut into `ws` by `hs` rectangles (for what bends it).
    fn plane(&mut self, w: f32, h: f32, ws: u32, hs: u32) {
        let at = |i: u32, j: u32| j * (ws + 1) + i;
        for j in 0..=hs {
            for i in 0..=ws {
                let (u, v) = (i as f32 / ws as f32, j as f32 / hs as f32);
                self.vertex(Vec3::new((u - 0.5) * w, (0.5 - v) * h, 0.0), Vec3::Z, [u, v]);
            }
        }
        for j in 0..hs {
            for i in 0..ws {
                let (a, b, c, d) = (at(i, j + 1), at(i + 1, j + 1), at(i + 1, j), at(i, j));
                self.indices.extend_from_slice(&[a, b, c, a, c, d]);
            }
        }
    }

    fn cuboid(&mut self, w: f32, h: f32, d: f32) {
        let (x, y, z) = (Vec3::X * w / 2.0, Vec3::Y * h / 2.0, Vec3::Z * d / 2.0);
        self.face(x, -z, y);
        self.face(-x, z, y);
        self.face(y, x, -z);
        self.face(-y, x, z);
        self.face(z, x, y);
        self.face(-z, -x, y);
    }

    fn sphere(&mut self, r: f32, ws: u32, hs: u32) {
        let mut grid = Vec::new();
        for iy in 0..=hs {
            let v = iy as f32 / hs as f32;
            let phi = v * PI;
            let row: Vec<u32> = (0..=ws)
                .map(|ix| {
                    let u = ix as f32 / ws as f32;
                    let theta = u * TAU;
                    let n = Vec3::new(-theta.cos() * phi.sin(), phi.cos(), theta.sin() * phi.sin());
                    self.vertex(n * r, n, [u, v])
                })
                .collect();
            grid.push(row);
        }
        for iy in 0..hs as usize {
            for ix in 0..ws as usize {
                let a = grid[iy][ix + 1];
                let b = grid[iy][ix];
                let c = grid[iy + 1][ix];
                let d = grid[iy + 1][ix + 1];
                if iy != 0 {
                    self.indices.extend_from_slice(&[a, b, d]);
                }
                if iy != hs as usize - 1 {
                    self.indices.extend_from_slice(&[b, c, d]);
                }
            }
        }
    }

    fn cylinder(&mut self, top: f32, bottom: f32, h: f32, radial: u32) {
        let slope = (bottom - top) / h;
        let mut rows = Vec::new();
        for y in 0..=1u32 {
            let v = y as f32;
            let radius = v * (bottom - top) + top;
            let row: Vec<u32> = (0..=radial)
                .map(|x| {
                    let u = x as f32 / radial as f32;
                    let (sin, cos) = (u * TAU).sin_cos();
                    let p = Vec3::new(radius * sin, -v * h + h / 2.0, radius * cos);
                    let n = Vec3::new(sin, slope, cos).normalize();
                    self.vertex(p, n, [u, v])
                })
                .collect();
            rows.push(row);
        }
        for x in 0..radial as usize {
            let (a, b, c, d) = (rows[0][x], rows[1][x], rows[1][x + 1], rows[0][x + 1]);
            self.indices.extend_from_slice(&[a, b, d, b, c, d]);
        }
        for (radius, y, up) in [(top, h / 2.0, true), (bottom, -h / 2.0, false)] {
            if radius <= 0.0 {
                continue;
            }
            let n = if up { Vec3::Y } else { -Vec3::Y };
            let center = self.vertex(Vec3::Y * y, n, [0.5, 0.5]);
            let ring: Vec<u32> = (0..=radial)
                .map(|x| {
                    let (sin, cos) = (x as f32 / radial as f32 * TAU).sin_cos();
                    let uv = [sin * 0.5 + 0.5, if up { cos * 0.5 + 0.5 } else { 0.5 - cos * 0.5 }];
                    self.vertex(Vec3::new(radius * sin, y, radius * cos), n, uv)
                })
                .collect();
            for x in 0..radial as usize {
                let (p, q) = (ring[x], ring[x + 1]);
                let tri = if up { [center, p, q] } else { [center, q, p] };
                self.indices.extend_from_slice(&tri);
            }
        }
    }

    fn torus(&mut self, radius: f32, tube: f32, radial: u32, tubular: u32) {
        for j in 0..=radial {
            for i in 0..=tubular {
                let u = i as f32 / tubular as f32 * TAU;
                let v = j as f32 / radial as f32 * TAU;
                let p = Vec3::new(
                    (radius + tube * v.cos()) * u.cos(),
                    (radius + tube * v.cos()) * u.sin(),
                    tube * v.sin(),
                );
                let center = Vec3::new(radius * u.cos(), radius * u.sin(), 0.0);
                let uv = [i as f32 / tubular as f32, 1.0 - j as f32 / radial as f32];
                self.vertex(p, (p - center).normalize(), uv);
            }
        }
        let at = |j: u32, i: u32| (tubular + 1) * j + i;
        for j in 1..=radial {
            for i in 1..=tubular {
                let (a, b, c, d) = (at(j, i - 1), at(j - 1, i - 1), at(j - 1, i), at(j, i));
                self.indices.extend_from_slice(&[a, b, d, b, c, d]);
            }
        }
    }
}

/// A shape given vertex by vertex. Normals that aren't given are made from the faces.
fn custom(args: &[f32]) -> Result<Arc<MeshData>, String> {
    let count = |i: usize| args.get(i).map(|v| *v as usize).ok_or("the shape ends early");
    let (n, ni) = (count(0)?, count(1)?);
    let (has_normals, has_uvs) = (count(2)? != 0, count(3)? != 0);
    let mut at = 4;
    let mut take = |len: usize| -> Result<&[f32], String> {
        let part = args.get(at..at + len).ok_or("the shape ends early")?;
        at += len;
        Ok(part)
    };
    let positions = take(n * 3)?;
    let normals = if has_normals { Some(take(n * 3)?) } else { None };
    let uvs = if has_uvs { Some(take(n * 2)?) } else { None };
    let indices: Vec<u32> = if ni > 0 {
        take(ni)?.iter().map(|&i| i as u32).collect()
    } else {
        (0..n as u32).collect()
    };
    if let Some(bad) = indices.iter().find(|&&i| i as usize >= n) {
        return Err(format!("the index {bad} is past the {n} vertices"));
    }
    if !indices.len().is_multiple_of(3) {
        return Err(format!("{} indices aren't triangles", indices.len()));
    }
    let p = |i: usize| Vec3::new(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    let made: Vec<Vec3> = match normals {
        Some(_) => Vec::new(),
        None => {
            let mut sum = vec![Vec3::ZERO; n];
            for t in indices.chunks_exact(3) {
                let [a, b, c] = [t[0], t[1], t[2]].map(|i| i as usize);
                let face = (p(b) - p(a)).cross(p(c) - p(a));
                for i in [a, b, c] {
                    sum[i] += face;
                }
            }
            sum.into_iter().map(|s| s.normalize_or(Vec3::Y)).collect()
        }
    };
    let mut vertices = Vec::with_capacity(n * STRIDE);
    for i in 0..n {
        let normal = match normals {
            Some(ns) => Vec3::new(ns[i * 3], ns[i * 3 + 1], ns[i * 3 + 2]),
            None => made[i],
        };
        let uv = uvs.map_or([0.0, 0.0], |u| [u[i * 2], u[i * 2 + 1]]);
        let q = p(i);
        vertices.extend_from_slice(&[q.x, q.y, q.z, normal.x, normal.y, normal.z, uv[0], uv[1]]);
    }
    Ok(MeshData::new(vertices, indices))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn triangles(m: &MeshData) -> impl Iterator<Item = [Vec3; 4]> + '_ {
        let p = |i: u32| {
            let v = &m.vertices[i as usize * STRIDE..];
            (Vec3::new(v[0], v[1], v[2]), Vec3::new(v[3], v[4], v[5]))
        };
        m.indices.chunks_exact(3).map(move |t| {
            let (a, na) = p(t[0]);
            let (b, _) = p(t[1]);
            let (c, _) = p(t[2]);
            [a, b, c, na]
        })
    }

    /// Every face is counter-clockwise seen from where its normals point, and every normal is of
    /// length 1.
    #[test]
    fn faces_face_out() {
        for (kind, args) in [
            (shape::BOX, vec![1.0, 2.0, 3.0]),
            (shape::SPHERE, vec![1.5]),
            (shape::PLANE, vec![2.0, 1.0]),
            (shape::PLANE, vec![2.0, 1.0, 8.0, 3.0]),
            (shape::CYLINDER, vec![0.5, 1.0, 2.0]),
            (shape::CYLINDER, vec![0.0, 1.0, 2.0]),
            (shape::TORUS, vec![1.0, 0.3]),
        ] {
            let m = make(kind, &args).unwrap();
            assert!(!m.indices.is_empty());
            for [a, b, c, n] in triangles(&m) {
                let face = (b - a).cross(c - a);
                if face.length() < 1e-9 {
                    continue;
                }
                assert!(face.dot(n) > 0.0, "shape {kind}: a face looks in");
                assert!((n.length() - 1.0).abs() < 1e-4);
            }
        }
    }

    #[test]
    fn a_shape_of_its_own_gets_normals_from_its_faces() {
        // One triangle in the XY plane, counter-clockwise from +Z.
        let args = [3.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let m = make(shape::CUSTOM, &args).unwrap();
        assert_eq!(m.indices, [0, 1, 2]);
        assert_eq!(&m.vertices[3..6], &[0.0, 0.0, 1.0]);
        assert!(make(shape::CUSTOM, &[3.0, 3.0, 0.0, 0.0, 0.0]).is_err(), "too short");
    }
}
