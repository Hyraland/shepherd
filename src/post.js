import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { exposureUniform, bloomUniform } from './config.js';

// 场景渲染到线性 HDR 缓冲（4x MSAA），这里做 Khronos PBR Neutral 色调映射并转成 sRGB。
// 只加 ±0.5/255 的抖动来消除天空的色带，肉眼看不出噪点。

const frag = /* glsl */ `
uniform sampler2D tDiffuse;
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
  vec3 col = toSRGB(clamp(neutral(texture2D(tDiffuse, vUv).rgb), 0.0, 1.0));
  col += dither(gl_FragCoord.xy) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Post {
  constructor() {
    this.rt = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.rt.texture },
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
    // 辉光：只有很亮的地方（水面的闪光、日轮）会晕开，叠回 HDR 缓冲后再做色调映射
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.4, 2.2); // 阈值高：只晕开刺眼的光
  }

  setSize(w, h, dpr) {
    this.rt.setSize(Math.round(w * dpr), Math.round(h * dpr));
    this.bloom.setSize(Math.round(w * dpr), Math.round(h * dpr));
  }

  render(renderer, scene, camera) {
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, camera);
    if (bloomUniform.value > 0.001) {
      this.bloom.strength = bloomUniform.value;
      this.bloom.render(renderer, null, this.rt, 0, false);
    }
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.cam);
  }
}
