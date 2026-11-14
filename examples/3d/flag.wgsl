// A sheet that waves: each vertex goes back and forth with the time, more the farther it is from
// the pole on the left.

struct Uniforms {
    height: f32,
}
@group(1) @binding(0) var<uniform> u: Uniforms;

fn wave(x: f32) -> f32 {
    return sin(x * 3.0 - fs.time * 4.0) * (x + 1.0) * u.height;
}

fn vertex(v: Vertex) -> Vertex {
    var out = v;
    out.position.z += wave(v.position.x);
    // The slope of the wave, for the light.
    let slope = (wave(v.position.x + 0.01) - wave(v.position.x - 0.01)) / 0.02;
    out.normal = normalize(vec3f(-slope, 0.0, 1.0));
    return out;
}
