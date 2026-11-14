// A surface whose color turns with the angle it is seen at, as a soap film or a beetle's back.

struct Uniforms {
    /// How far round the colors it is at once.
    shift: f32,
    metalness: f32,
    roughness: f32,
}
@group(1) @binding(0) var<uniform> u: Uniforms;

fn palette(t: f32) -> vec3f {
    let c = vec3f(0.5) + vec3f(0.5) * cos(6.28318 * (vec3f(1.0, 1.0, 1.0) * t + vec3f(0.0, 0.33, 0.67)));
    return c * c;
}

fn surface(in: SurfaceInput) -> Surface {
    var s = default_surface(in);
    let v = normalize(fs.camera_position - in.world_position);
    let facing = clamp(dot(s.normal, v), 0.0, 1.0);
    s.albedo = mix(vec3f(0.85, 0.82, 0.9), palette(facing * 1.4 + u.shift + in.uv.x * 0.5), 0.65);
    s.metalness = u.metalness;
    s.roughness = u.roughness;
    s.emissive = palette(u.shift + 0.5) * pow(1.0 - facing, 4.0) * 0.6;
    return s;
}
