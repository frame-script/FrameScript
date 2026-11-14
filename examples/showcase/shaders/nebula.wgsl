// A nebula: noise warped by noise (after Inigo Quilez), in three colors, with stars over it.

struct Uniforms {
    deep: vec4f,
    glow: vec4f,
    hot: vec4f,
    /// From black (0) to all of it (1).
    reveal: f32,
    drift: f32,
    zoom: f32,
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
    let a = hash(i);
    let b = hash(i + vec2f(1.0, 0.0));
    let c = hash(i + vec2f(0.0, 1.0));
    let d = hash(i + vec2f(1.0, 1.0));
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

fn fbm(p0: vec2f) -> f32 {
    var p = p0;
    var a = 0.5;
    var s = 0.0;
    for (var i = 0; i < 6; i++) {
        s += a * noise(p);
        p = mat2x2f(1.6, 1.2, -1.2, 1.6) * p;
        a *= 0.5;
    }
    return s;
}

fn shade(uv: vec2f) -> vec4f {
    let aspect = fs.resolution.x / fs.resolution.y;
    let c = (uv - 0.5) * vec2f(aspect, 1.0);
    let p = c * 2.6 / u.zoom + vec2f(3.0, 1.0);
    let t = fs.time * u.drift;
    let q = vec2f(fbm(p + vec2f(0.0, t)), fbm(p + vec2f(5.2, 1.3) - t * 0.7));
    let r = vec2f(fbm(p + 2.6 * q + vec2f(1.7, 9.2) + t * 0.5), fbm(p + 2.6 * q + vec2f(8.3, 2.8) - t * 0.4));
    let f = fbm(p + 2.6 * r);

    var color = mix(u.deep.rgb, u.glow.rgb, clamp(f * f * 2.2, 0.0, 1.0));
    color = mix(color, u.hot.rgb, clamp(length(r) * f - 0.45, 0.0, 1.0) * 1.2);
    color *= f * f * f * 2.4;

    // Stars: a few cells of three pixels hold one, which twinkles.
    let g = uv * fs.resolution / 3.0;
    let h = hash(g + vec2f(91.0, 17.0));
    let twinkle = 0.55 + 0.45 * sin(fs.time * 2.5 + h * 300.0);
    color += vec3f(step(0.9965, h) * smoothstep(0.55, 0.0, length(fract(g) - 0.5)) * twinkle);

    color *= smoothstep(1.25, 0.25, length(c));
    return vec4f(color * u.reveal, 1.0);
}
