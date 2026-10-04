import * as THREE from 'three';
import { exposureUniform, bloomUniform } from './config.js';

// 场景渲染到线性 HDR 缓冲（4x MSAA），加上辉光，再做 Khronos PBR Neutral 色调映射并转成 sRGB。
// 只加 ±0.5/255 的抖动来消除天空的色带，肉眼看不出噪点。

const frag = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uExposure;
varying vec2 vUv;

// Khronos PBR Neutral：保持色相和饱和度，只压高光
vec3 neutral(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  color *= uExposure;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float dither(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
}

void main() {
  vec3 hdr = texture2D(tDiffuse, vUv).rgb + texture2D(tBloom, vUv).rgb * uBloom;
  vec3 col = toSRGB(clamp(neutral(hdr), 0.0, 1.0));
  col += dither(gl_FragCoord.xy) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

// —— 辉光 ——
// 逐级缩小（13 点采样，第一级只取超过阈值的亮部，并按亮度加权平均，压住单个像素的闪烁），
// 再逐级放大（3×3 帐篷滤波）叠回去。每一级都是平滑的滤波，所以一粒很小的水面闪光
// 会晕成一圈圆润的光。
const quadVert = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const downFrag = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uFirst;
varying vec2 vUv;
vec3 tap(float x, float y) { return texture2D(tSrc, vUv + vec2(x, y) * uTexel).rgb; }
vec3 bright(vec3 c) {
  float b = max(c.r, max(c.g, c.b));
  float soft = clamp(b - uThreshold + 0.5, 0.0, 1.0);
  soft = soft * soft * 0.5;
  return c * max(soft, b - uThreshold) / max(b, 1e-4);
}
// 只轻微按亮度加权：水面闪光本来就该一闪一闪，压得太狠就没有光晕了
float karis(vec3 c) { return 1.0 / (1.0 + 0.08 * dot(c, vec3(0.2126, 0.7152, 0.0722))); }
void main() {
  vec3 a = tap(-2.0, 2.0), b = tap(0.0, 2.0), c = tap(2.0, 2.0);
  vec3 d = tap(-2.0, 0.0), e = tap(0.0, 0.0), f = tap(2.0, 0.0);
  vec3 g = tap(-2.0, -2.0), h = tap(0.0, -2.0), i = tap(2.0, -2.0);
  vec3 j = tap(-1.0, 1.0), k = tap(1.0, 1.0), l = tap(-1.0, -1.0), m = tap(1.0, -1.0);
  vec3 g0 = (j + k + l + m) * 0.25, g1 = (a + b + d + e) * 0.25, g2 = (b + c + e + f) * 0.25;
  vec3 g3 = (d + e + g + h) * 0.25, g4 = (e + f + h + i) * 0.25;
  vec3 col;
  if (uFirst > 0.5) {
    g0 = bright(g0); g1 = bright(g1); g2 = bright(g2); g3 = bright(g3); g4 = bright(g4);
    float w0 = karis(g0) * 0.5, w1 = karis(g1) * 0.125, w2 = karis(g2) * 0.125, w3 = karis(g3) * 0.125, w4 = karis(g4) * 0.125;
    col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  } else {
    col = g0 * 0.5 + (g1 + g2 + g3 + g4) * 0.125;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;
const upFrag = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uWeight;
varying vec2 vUv;
vec3 tap(float x, float y) { return texture2D(tSrc, vUv + vec2(x, y) * uTexel).rgb; }
void main() {
  vec3 c = tap(0.0, 0.0) * 4.0
         + (tap(-1.0, 0.0) + tap(1.0, 0.0) + tap(0.0, -1.0) + tap(0.0, 1.0)) * 2.0
         + tap(-1.0, -1.0) + tap(1.0, -1.0) + tap(-1.0, 1.0) + tap(1.0, 1.0);
  gl_FragColor = vec4(c / 16.0 * uWeight, 1.0);
}
`;

class Bloom {
  constructor(levels = 6) {
    this.levels = levels;
    this.mips = [];
    for (let i = 0; i < levels; i++) {
      const t = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
      t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter;
      t.texture.generateMipmaps = false;
      this.mips.push(t);
    }
    this.down = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 2.2 }, uFirst: { value: 0 } },
      vertexShader: quadVert, fragmentShader: downFrag, depthTest: false, depthWrite: false,
    });
    this.up = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } },
      vertexShader: quadVert, fragmentShader: upFrag, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, transparent: true,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.down);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h) {
    this.mips.forEach((t, i) => t.setSize(Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1))));
  }

  get texture() { return this.mips[0].texture; }

  render(renderer, src) {
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    // 逐级缩小
    let input = src;
    this.quad.material = this.down;
    for (let i = 0; i < this.levels; i++) {
      this.down.uniforms.tSrc.value = input;
      this.down.uniforms.uTexel.value.set(1 / input.image.width, 1 / input.image.height);
      this.down.uniforms.uFirst.value = i === 0 ? 1 : 0;
      renderer.setRenderTarget(this.mips[i]);
      renderer.render(this.scene, this.cam);
      input = this.mips[i].texture;
    }
    // 逐级放大并叠加：越大的光晕权重越低，主要是贴着亮点的一圈
    this.quad.material = this.up;
    for (let i = this.levels - 1; i > 0; i--) {
      const s = this.mips[i].texture;
      this.up.uniforms.tSrc.value = s;
      this.up.uniforms.uTexel.value.set(1 / s.image.width, 1 / s.image.height);
      this.up.uniforms.uWeight.value = 0.8;
      renderer.setRenderTarget(this.mips[i - 1]);
      renderer.render(this.scene, this.cam);
    }
    renderer.autoClear = auto;
  }
}

export class Post {
  constructor() {
    this.rt = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        tBloom: { value: null },
        uBloom: { value: 0 },
        uExposure: exposureUniform, // 面板里可调
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: frag,
      depthTest: false,
      depthWrite: false,
    });
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
    // 辉光：只有很亮的地方（水面的闪光、日轮）会晕开（阈值高：只晕开刺眼的光）
    this.bloom = new Bloom();
    this.mat.uniforms.tBloom.value = this.bloom.texture;
  }

  setSize(w, h, dpr) {
    this.rt.setSize(Math.round(w * dpr), Math.round(h * dpr));
    this.bloom.setSize(Math.round(w * dpr), Math.round(h * dpr));
    this.mat.uniforms.tBloom.value = this.bloom.texture;
  }

  render(renderer, scene, camera) {
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, camera);
    this.mat.uniforms.uBloom.value = bloomUniform.value * 1.2;
    if (bloomUniform.value > 0.001) this.bloom.render(renderer, this.rt.texture);
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.cam);
  }
}
