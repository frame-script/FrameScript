let device: GPUDevice | null = null;
let context: GPUCanvasContext | null = null;
let format: GPUTextureFormat;
let pipeline: GPURenderPipeline;
let sampler: GPUSampler;
let texture: GPUTexture | null = null;
let textureWidth = 0;
let textureHeight = 0;

export async function initWebGPU(canvas: HTMLCanvasElement) {
  if (!("gpu" in navigator)) throw new Error("WebGPU not supported");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No GPU adapter");
  device = await adapter.requestDevice();
  context = canvas.getContext("webgpu") as GPUCanvasContext;
  format = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format,
    alphaMode: "opaque",
  });

  sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });

  const shaderModule = device.createShaderModule({
    code: `
      struct VSOut {
        @builtin(position) position : vec4<f32>,
        @location(0) uv : vec2<f32>,
      };

      @vertex
      fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
        var pos = array<vec2<f32>, 6>(
          vec2<f32>(-1.0, -1.0),
          vec2<f32>( 1.0, -1.0),
          vec2<f32>(-1.0,  1.0),
          vec2<f32>(-1.0,  1.0),
          vec2<f32>( 1.0, -1.0),
          vec2<f32>( 1.0,  1.0),
        );
        var uv = array<vec2<f32>, 6>(
          vec2<f32>(0.0, 1.0),
          vec2<f32>(1.0, 1.0),
          vec2<f32>(0.0, 0.0),
          vec2<f32>(0.0, 0.0),
          vec2<f32>(1.0, 1.0),
          vec2<f32>(1.0, 0.0),
        );

        var out: VSOut;
        out.position = vec4<f32>(pos[vid], 0.0, 1.0);
        out.uv = uv[vid];
        return out;
      }

      @group(0) @binding(0) var myTex: texture_2d<f32>;
      @group(0) @binding(1) var mySampler: sampler;

      @fragment
      fn fs(in: VSOut) -> @location(0) vec4<f32> {
        return textureSample(myTex, mySampler, in.uv);
      }
    `,
  });

  pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shaderModule, entryPoint: "vs" },
    fragment: { module: shaderModule, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
}

export function uploadAndDrawFrame(
  frameData: Uint8Array,
  width: number,
  height: number,
) {
  if (!device || !context) return;

  if (!texture || textureWidth !== width || textureHeight !== height) {
    texture?.destroy();
    textureWidth = width;
    textureHeight = height;

    texture = device.createTexture({
      size: { width, height },
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  device.queue.writeTexture(
    { texture: texture! },
    frameData as unknown as GPUAllowSharedBufferSource,
    { bytesPerRow: width * 4 },
    { width, height, depthOrArrayLayers: 1 },
  );

  const view = context.getCurrentTexture().createView();
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: texture!.createView() },
      { binding: 1, resource: sampler },
    ],
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  });

  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(6, 1, 0, 0);
  pass.end();

  device.queue.submit([encoder.finish()]);
}
