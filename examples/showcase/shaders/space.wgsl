// Deep space on the inside of a sphere round the camera, shown as it is: a nebula of noise warped by
// noise, and stars.

struct Uniforms {
    deep: vec4f,
    glow: vec4f,
    hot: vec4f,
    brightness: f32,
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

fn fragment(in: SurfaceInput) -> vec4f {
    let d = normalize(in.world_position - fs.camera_position);
    // Looking down -Z: the sky as a picture in front.
    let p = d.xy / max(-d.z, 0.3) * 1.6 + vec2f(3.0, 1.0);
    let t = fs.time * 0.08;
    let q = vec2f(fbm(p + vec2f(0.0, t)), fbm(p + vec2f(5.2, 1.3) - t * 0.7));
    let r = vec2f(fbm(p + 3.5 * q + vec2f(1.7, 9.2) + t * 0.5), fbm(p + 3.5 * q + vec2f(8.3, 2.8) - t * 0.4));
    let f = fbm(p + 3.5 * r);
    var color = mix(u.deep.rgb, u.glow.rgb, clamp(f * f * 2.2, 0.0, 1.0));
    color = mix(color, u.hot.rgb, clamp(length(r) * f - 0.45, 0.0, 1.0) * 1.2);
    color *= f * f * 2.6 * u.brightness;

    let g = d.xy / max(-d.z, 0.3) * 500.0;
    let h = hash(g + vec2f(91.0, 17.0));
    color += vec3f(step(0.997, h) * smoothstep(0.55, 0.0, length(fract(g) - 0.5)) * (0.6 + 0.4 * sin(fs.time * 2.0 + h * 300.0)));
    return vec4f(color, 1.0);
}
