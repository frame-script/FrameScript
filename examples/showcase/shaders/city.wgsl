// A city of columns, one mesh: each column is a box from y = 0 to y = 1 whose uv is its cell, and
// the vertex hook makes it as tall as the noise and the rings of the beat say. Their tops glow, more
// the taller they are, and what is far fades into the fog.

struct Uniforms {
    low: vec4f,
    high: vec4f,
    body: vec4f,
    fog: vec4f,
    /// Seconds since the last kick.
    kick: f32,
    /// How much they move, from 0 to 1.
    energy: f32,
    /// Columns across.
    grid: f32,
    /// Where the fog is all there is.
    far: f32,
}
@group(1) @binding(0) var<uniform> u: Uniforms;

fn hash(p: vec2f) -> f32 {
    let q = vec2u(vec2i(floor(p)) + vec2i(4096));
    var h = (q.x * 1597334677u) ^ (q.y * 3812015801u);
    h = (h ^ (h >> 16u)) * 2246822519u;
    return f32(h ^ (h >> 13u)) / 4294967295.0;
}

fn noise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let w = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i), hash(i + vec2f(1.0, 0.0)), w.x),
        mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), w.x),
        w.y,
    );
}

fn height(cell: vec2f) -> f32 {
    let t = fs.time;
    let n = noise(cell * 0.11 + vec2f(t * 0.35, t * 0.12)) * 0.7 + noise(cell * 0.31 - t * 0.2) * 0.3;
    var h = 0.12 + 2.2 * n * n * n * u.energy;
    // A ring that leaves the middle at each kick.
    let d = length(cell - u.grid * 0.5);
    let ring = d - u.kick * 46.0;
    h += 1.4 * u.energy * exp(-ring * ring * 0.08) * exp(-u.kick * 1.8);
    // Now and then, a tower.
    h += step(0.985, hash(cell + vec2f(7.0, 3.0))) * (1.5 + 0.5 * sin(t * 2.0 + cell.x)) * u.energy;
    return h;
}

fn vertex(v: Vertex) -> Vertex {
    var out = v;
    out.position.y = v.position.y * height(v.uv);
    return out;
}

fn surface(in: SurfaceInput) -> Surface {
    var s = default_surface(in);
    let h = height(in.uv);
    let tone = clamp((h - 0.12) / 2.6, 0.0, 1.0);
    let glow = mix(u.low.rgb, u.high.rgb, tone);
    s.albedo = u.body.rgb;
    s.metalness = 0.2;
    s.roughness = 0.35;
    let top = smoothstep(0.5, 0.9, in.normal.y);
    // A band at the top of each side, and faint floors below it.
    let edge = smoothstep(h - 0.06, h - 0.01, in.world_position.y) * (1.0 - top);
    let floors = step(0.82, fract(in.world_position.y * 6.0)) * 0.08 * tone;
    let light = max(top * (0.12 + 1.6 * tone * tone), edge * (0.5 + 1.5 * tone) + floors);
    s.emissive = glow * light;
    let far = smoothstep(u.far * 0.3, u.far, distance(fs.camera_position, in.world_position));
    s.albedo *= 1.0 - far;
    s.emissive = mix(s.emissive, u.fog.rgb, far);
    return s;
}
