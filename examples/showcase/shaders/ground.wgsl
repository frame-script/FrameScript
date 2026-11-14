// A floor of glowing lines that runs past under what stands on it, and fades into the haze.

struct Uniforms {
    line: vec4f,
    haze: vec4f,
    /// Units a second that it runs toward -X.
    speed: f32,
    far: f32,
}
@group(1) @binding(0) var<uniform> u: Uniforms;

fn lines(p: vec2f) -> f32 {
    let w = fwidth(p) * 1.2;
    let g = abs(fract(p - 0.5) - 0.5) / max(w, vec2f(1e-4));
    return 1.0 - min(min(g.x, g.y), 1.0);
}

fn surface(in: SurfaceInput) -> Surface {
    var s = default_surface(in);
    let p = in.world_position.xz + vec2f(fs.time * u.speed, 0.0);
    let fine = lines(p);
    let coarse = lines(p / 4.0);
    s.emissive = u.line.rgb * (fine * 0.35 + coarse * 1.2);
    let far = smoothstep(u.far * 0.15, u.far, distance(fs.camera_position, in.world_position));
    s.albedo *= 1.0 - far;
    s.emissive = mix(s.emissive, u.haze.rgb, far);
    s.roughness = mix(s.roughness, 1.0, far);
    return s;
}
