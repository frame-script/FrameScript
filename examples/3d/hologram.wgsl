// A surface of light in bands that climb it: lit as any other, but glowing where the bands are and
// seen through between them.

struct Uniforms {
    tint: vec3f,
}
@group(1) @binding(0) var<uniform> u: Uniforms;

fn surface(in: SurfaceInput) -> Surface {
    var s = default_surface(in);
    let band = smoothstep(0.35, 0.5, fract(in.world_position.y * 6.0 - fs.time * 1.5));
    // Brighter at the edges, as glass is.
    let rim = pow(1.0 - abs(dot(normalize(fs.camera_position - in.world_position), s.normal)), 2.0);
    s.albedo = u.tint * 0.2;
    s.emissive = u.tint * (band * 0.8 + rim * 1.5);
    s.alpha = 0.35 + 0.65 * max(band, rim);
    return s;
}
