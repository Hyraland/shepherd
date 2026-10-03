import * as THREE from 'three';
import { COMMON } from './shaders.js';
import { PALETTE } from './config.js';

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// 晴空：天顶深蓝，越近地平线越白；太阳周围有前向散射的光晕。
// 只有抬头看到的高处才有几朵云（地上的云影由它们投下）。
const frag = /* glsl */ `
${COMMON}
uniform vec3 uSunGlow;
varying vec3 vDir;

float fbm5(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = p * 2.02 + vec2(5.3, 1.7);
    a *= 0.5;
  }
  return s / 0.96875;
}

void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  float sd = max(dot(d, uSunDir), 0.0);

  // 晴空：地平线一窄条浅色 + 大气边缘的亮线，往上很快是深蓝（和水面倒影共用 skyColorAt）
  vec3 col = skyColorAt(d);
  // 太阳方向一圈淡淡的暖色光晕（只在太阳附近，不把整片天冲白）
  col += uSunGlow / uExposure * pow(sd, 12.0) * 0.3;

  float cover = 0.0;
  if (d.y > 0.5) {
    vec2 uv = d.xz / (d.y + 0.18) * 1.4;
    vec2 drift = vec2(-0.004, 0.0013) * uTime;
    float n = fbm5(uv + drift);
    float n2 = fbm5(uv + drift + normalize(uSunDir.xz) * 0.05);
    cover = cloudMaskAt(n) * smoothstep(0.5, 0.72, d.y);
    float lit = clamp(0.6 + (n - n2) * 6.0, 0.0, 1.0);
    vec3 cc = mix(vec3(0.62, 0.67, 0.78), vec3(1.0), lit) / uExposure;
    col = mix(col, cc, cover);
  }

  // 日轮：很亮（会被辉光晕开），不随曝光换算
  col += vec3(1.0, 0.95, 0.85) * pow(sd, 800.0) * 6.0 * (1.0 - cover);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createSky(U) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...U,
      uSunGlow: { value: new THREE.Color(PALETTE.sunGlow) },
    },
    vertexShader: vert,
    fragmentShader: frag,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
