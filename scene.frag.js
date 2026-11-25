export default /* wgsl */ `
struct Light {
  position : vec4f,
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

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var colorSampler : sampler;
@group(0) @binding(2) var colorMap : texture_2d<f32>;

// Phong por fragmento, calculado no espaco da camera.
@fragment
fn main(
  @builtin(front_facing) frontFacing : bool,
  @location(0) viewPosition : vec3f,
  @location(1) viewNormal : vec3f,
  @location(2) uv : vec2f,
) -> @location(0) vec4f {
  var normal = normalize(viewNormal);
  if (!frontFacing) {
    normal = -normal; // base aberta do bunny vista por dentro
  }
  let viewDir = normalize(-viewPosition);

  // Cor base: textura amostrada (chao) ou 1 (cores solidas ficam em ka/kd).
  var base = vec3f(1.0);
  if (uniforms.material.params.y > 0.5) {
    base = textureSample(colorMap, colorSampler, uv).rgb;
  }

  let m = uniforms.material;
  var color = uniforms.ambient.rgb * m.ka.rgb * base;

  for (var i = 0u; i < 2u; i++) {
    let light = uniforms.lights[i];
    // As luzes sao definidas no mundo e levadas ao espaco da camera.
    let lightPosition = (uniforms.view * light.position).xyz;
    let lightDir = normalize(lightPosition - viewPosition);

    let nDotL = max(dot(normal, lightDir), 0.0);
    let reflected = reflect(-lightDir, normal);
    var specularFactor = 0.0;
    if (nDotL > 0.0) {
      specularFactor = pow(max(dot(reflected, viewDir), 0.0), m.params.x);
    }

    color += light.diffuse.rgb * m.kd.rgb * base * nDotL;
    color += light.specular.rgb * m.ks.rgb * specularFactor;
  }

  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;
