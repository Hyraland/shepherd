import * as THREE from 'three';
import { COMMON } from './shaders.js';
import { mulberry32 } from './noise.js';

// 脚边的野花：细茎上一朵小星形的花，长在和远处地面同一套花丛分布里（flowerCover），
// 颜色也取同一套（flowerColor），所以近处的花和远处的花海接得上。和草一样跟着相机平铺环绕。

const vert = /* glsl */ `
${COMMON}
attribute vec4 aFlower;
attribute float aPart;      // 0 = 茎，1 = 花瓣，2 = 花心
uniform vec3 uCenter;
uniform float uSize;
varying vec3 vCol;

void main() {
  vec2 c = uCenter.xz;
  vec2 local = mod(aFlower.xy - c + 0.5 * uSize, uSize) - 0.5 * uSize;
  vec2 wxz = c + local;
  float r1 = aFlower.z, r2 = aFlower.w;
  float dist = length(local);
  float fade = 1.0 - smoothstep(uSize * 0.32, uSize * 0.46, dist);

  // 只在花丛里出现；溪水里和岸边没有
  float cover = flowerCover(wxz);
  float rw;
  float rd = riverDist(wxz, rw);
  float alive = step(r2, cover) * fade * step(bankWidth(wxz) + 0.2, rd);

  float hs = (0.2 + 0.22 * r1) * alive;
  float hr = (0.03 + 0.025 * fract(r1 * 7.3)) * alive;
  float gust = gustAt(wxz);
  vec2 bend = uWind * (0.06 + 0.3 * gust) + vec2(sin(uTime * 2.3 + r1 * 30.0), cos(uTime * 1.9 + r2 * 20.0)) * 0.04;

  float ground = terrainH(wxz);
  vec3 top = vec3(wxz.x + bend.x * hs, ground + hs, wxz.y + bend.y * hs);
  vec3 wp;
  vec3 V = normalize(cameraPosition - top);
  float hue = vnoise(wxz * 0.03 + 5.0) + (fract(r1 * 13.7) - 0.5) * 0.6;
  vec3 fc = flowerColor(hue) * (0.8 + 0.4 * fract(r1 * 31.7));
  vec3 alb;
  if (aPart < 0.5) {
    float t = position.y;
    wp = vec3(wxz.x + position.x * alive, ground + t * hs, wxz.y + position.z * alive);
    wp.xz += bend * hs * t * t;
    alb = uToonLightDeep;
  } else {
    // 花冠朝向“天空与观者之间”，从第一人称看去总是一朵完整的小花
    vec3 n = normalize(mix(vec3(0.0, 1.0, 0.0), V, 0.55));
    vec3 tg = normalize(cross(n, vec3(0.31, 0.0, 0.95)));
    vec3 bt = cross(n, tg);
    float ra = r2 * 40.0;
    vec2 q = mat2(cos(ra), -sin(ra), sin(ra), cos(ra)) * position.xz;
    wp = top + (tg * q.x + bt * q.y) * hr + n * position.y * hr;
    alb = aPart > 1.5 ? mix(vec3(0.95, 0.75, 0.15), fc * 0.6, step(0.7, hue)) : fc;
  }

  // 和草地一样的二分色受光：投影 + 云影
  float cs = cloudShadowFast(wxz);
  float ss = sunShadowFast(top);
  float k = smoothstep(uToonEdge.x - uToonEdge.y, uToonEdge.x + uToonEdge.y, ss * clamp(uSunDir.y * 1.4 + 0.2, 0.0, 1.0)) * cs;
  vec3 toon = aPart < 0.5
    ? mix(uToonShadow, uToonLightDeep, k)
    : mix(alb * 0.35 / uExposure + uToonShadow * 0.4, alb * 1.15 / uExposure, k);
  vec3 real = alb * (ambient(vec3(0.0, 1.0, 0.0)) + uSunColor * 0.8 * cs * ss);
  vCol = applyFog(mix(real, toon, uToonMix), wp);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const frag = /* glsl */ `
varying vec3 vCol;
void main() { gl_FragColor = vec4(vCol, 1.0); }
`;

function flowerGeometry() {
  const pos = [], part = [];
  const tri = (a, b, c, p) => { pos.push(...a, ...b, ...c); part.push(p, p, p); };
  const w = 0.004;
  for (const [ax, az] of [[1, 0], [0, 1]]) {
    const v0 = [-w * ax, 0, -w * az], v1 = [w * ax, 0, w * az], v2 = [w * ax, 1, w * az], v3 = [-w * ax, 1, -w * az];
    tri(v0, v1, v2, 0); tri(v0, v2, v3, 0);
  }
  const N = 5, ring = [];
  for (let i = 0; i < 2 * N; i++) {
    const a = (i / (2 * N)) * Math.PI * 2, r = i % 2 ? 0.45 : 1.0;
    ring.push([Math.cos(a) * r, i % 2 ? 0 : 0.12, Math.sin(a) * r]);
  }
  for (let i = 0; i < 2 * N; i++) tri([0, -0.1, 0], ring[i], ring[(i + 1) % (2 * N)], 1);
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
    tri([0, 0.06, 0], [Math.cos(a0) * 0.3, 0.05, Math.sin(a0) * 0.3], [Math.cos(a1) * 0.3, 0.05, Math.sin(a1) * 0.3], 2);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  return g;
}

export function createFlowers(U, { count, size }) {
  const g = flowerGeometry();
  const rng = mulberry32(77);
  const a = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) { a[i * 4] = rng() * size; a[i * 4 + 1] = rng() * size; a[i * 4 + 2] = rng(); a[i * 4 + 3] = rng(); }
  g.setAttribute('aFlower', new THREE.InstancedBufferAttribute(a, 4));
  g.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uSize: { value: size } },
    vertexShader: vert,
    fragmentShader: frag,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  return mesh;
}
