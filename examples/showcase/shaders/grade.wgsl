// The finish of every scene: colors that split toward the edges as a lens does, a vignette, and
// grain that changes each frame.

struct Uniforms {
    aberration: f32,
    vignette: f32,
    grain: f32,
}
@group(1) @binding(0) var<uniform> u: Uniforms;

fn pcg(v: u32) -> u32 {
    let state = v * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

fn effect(uv: vec2f) -> vec4f {
    let c = uv - 0.5;
    let k = u.aberration * dot(c, c);
    let middle = scene(uv);
    var color = vec3f(scene(uv - c * k).r, middle.g, scene(uv + c * k).b);

    let aspect = fs.resolution.x / fs.resolution.y;
    color *= 1.0 - u.vignette * smoothstep(0.25, 0.95, length(c * vec2f(aspect, 1.0)));

    let pixel = vec2u(uv * fs.resolution);
    let n = f32(pcg(pixel.x + pcg(pixel.y + pcg(u32(fs.frame))))) / 4294967295.0 - 0.5;
    color += n * u.grain * (0.04 + sqrt(max(color, vec3f(0.0))) * 0.3);
    return vec4f(max(color, vec3f(0.0)), middle.a);
}
