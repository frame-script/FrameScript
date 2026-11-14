// The color of the background at a point of it: waves of two colors that drift with the time.

struct Uniforms {
    low: vec4f,
    high: vec4f,
    speed: f32,
}
@group(1) @binding(0) var<uniform> u: Uniforms;

fn shade(uv: vec2f) -> vec4f {
    let t = fs.time * u.speed;
    let p = (uv - 0.5) * vec2f(fs.resolution.x / fs.resolution.y, 1.0) * 6.0;
    let wave = sin(p.x + t) + sin(p.y * 1.3 - t * 0.7) + sin(length(p) * 1.5 - t * 1.3);
    return mix(u.low, u.high, 0.5 + wave / 6.0);
}
