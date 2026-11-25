export default /* wgsl */ `
struct Light {
  position : vec4f,   // posicao no mundo (w = 1)
  diffuse : vec4f,
  specular : vec4f,
};

struct Material {
  ka : vec4f,
  kd : vec4f,
  ks : vec4f,
  params : vec4f,     // x = expoente especular, y = usa textura (1) ou nao (0)
};

struct Uniforms {
  model : mat4x4f,
  view : mat4x4f,
  projection : mat4x4f,
  normalMatrix : mat4x4f,
  ambient : vec4f,
  lights : array<Light, 2>,
  material : Material,
};

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) viewPosition : vec3f,
  @location(1) viewNormal : vec3f,
  @location(2) uv : vec2f,
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

@vertex
fn main(
  @location(0) position : vec4f,
  @location(1) normal : vec4f,
  @location(2) uv : vec2f,
) -> VertexOutput {
  let viewPosition = uniforms.view * uniforms.model * position;

  var output : VertexOutput;
  output.position = uniforms.projection * viewPosition;
  output.viewPosition = viewPosition.xyz;
  output.viewNormal = (uniforms.normalMatrix * normal).xyz;
  output.uv = uv;
  return output;
}
`;
