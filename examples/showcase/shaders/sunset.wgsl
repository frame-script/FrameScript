// The sky at sunset, on the inside of a sphere round the camera: shown as it is, without light.
// Hills in two layers at the horizon, the sun over them, and the first stars at the top.

struct Uniforms {
    zenith: vec4f,
    horizon: vec4f,
    sun_color: vec4f,
    near_hills: vec4f,
    far_hills: vec4f,
    /// Toward the sun.
    sun: vec3f,
}
@group(1) @binding(0) var<uniform> u: Uniforms;

fn hash(x: f32) -> f32 {
    return fract(sin(x * 127.1) * 43758.5453);
}

fn noise(x: f32) -> f32 {
    let i = floor(x);
    let f = fract(x);
    return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f));
}

fn ridge(x: f32, scale: f32) -> f32 {
    return noise(x * scale) * 0.6 + noise(x * scale * 2.3 + 4.0) * 0.3 + noise(x * scale * 5.1 + 9.0) * 0.1;
}

fn fragment(in: SurfaceInput) -> vec4f {
    let d = normalize(in.world_position - fs.camera_position);
    let e = d.y;
    let sun = normalize(u.sun);
    let toward = max(dot(d, sun), 0.0);

    var color = mix(u.horizon.rgb, u.zenith.rgb, pow(clamp(e * 3.0, 0.0, 1.0), 0.5));
    // The glow round the sun spreads along the horizon.
    color += u.sun_color.rgb * (pow(toward, 8.0) * 0.45 + pow(toward, 96.0) * 0.6) * (1.0 - clamp(e * 3.0, 0.0, 1.0) * 0.5);
    color += u.sun_color.rgb * smoothstep(0.9993, 0.9996, toward) * 3.0;

    let around = atan2(d.x, -d.z);
    let far = 0.035 + 0.07 * ridge(around, 3.0);
    let near = 0.01 + 0.06 * ridge(around + 20.0, 6.0);
    // The far hills have haze in them, from the sun.
    let haze = u.far_hills.rgb + u.sun_color.rgb * pow(toward, 4.0) * 0.25;
    color = mix(color, haze, smoothstep(far + 0.002, far - 0.002, e));
    color = mix(color, u.near_hills.rgb, smoothstep(near + 0.002, near - 0.002, e));

    let star = step(0.9985, fract(sin(dot(floor(d * 400.0), vec3f(12.9898, 78.233, 37.719))) * 43758.5453));
    color += vec3f(star * smoothstep(0.25, 0.7, e) * 0.8);
    return vec4f(color, 1.0);
}
