import * as THREE from 'three';
import { COMMON } from './shaders.js';
import { mulberry32 } from './noise.js';

// 脚边的野花：伊犁河谷 / 喀拉峻一带夏天草甸上最常见的几种，矮矮地开在草丛里——
//   黄：毛茛（五片圆圆的、亮亮的花瓣）、金莲花（橙黄色、合拢的小球）
//   白：蓍草（一把平顶的小白花簇）
//   紫：草原老鹳草（五片带脉纹的蓝紫色花瓣）
//   红：野罂粟 / 虞美人（四片大大的皱瓣，黑色的花心）
// 花的种类按颜色定：颜色取自和远处地面同一套花丛分布（flowerCover / flowerColor），所以会走进一片片以某种花为主的地块。
// 花冠是一个小圆片，花瓣的形状在片元着色器里按种类画出来；淡入淡出用 alpha-to-coverage 逐渐溶出，不会从地里“长出来”。
// 和草一样跟着相机平铺环绕。

const vert = /* glsl */ `
${COMMON}
attribute vec4 aFlower;
attribute float aPart;      // 0 = 茎，1 = 花冠
uniform vec3 uCenter;
uniform float uSize;
varying vec2 vQ;            // 花冠上的位置（单位圆）
varying float vKind;        // -1 茎，0 毛茛，1 金莲花，2 蓍草，3 老鹳草，4 野罂粟
varying vec3 vAlb;
varying vec3 vA;            // 颜色 = 底色 × vA + vB，再按 vFog 混雾
varying vec3 vB;
varying vec4 vFog;
varying float vFade;

void main() {
  vec2 c = uCenter.xz;
  vec2 local = mod(aFlower.xy - c + 0.5 * uSize, uSize) - 0.5 * uSize;
  vec2 wxz = c + local;
  float r1 = aFlower.z, r2 = aFlower.w;
  float dist = length(local);
  float fade = 1.0 - smoothstep(uSize * 0.3, uSize * 0.46, dist);

  // 只在花丛里出现；溪水里和岸边没有
  float cover = flowerCover(wxz);
  float alive = step(r2, cover) * step(0.001, fade);
  if (alive > 0.5) {
    float rw;
    alive *= step(bankWidth(wxz) + 0.2, riverDist(wxz, rw));
  }
  if (alive < 0.5) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }

  float hue = vnoise(wxz * 0.03 + 5.0) + (fract(r1 * 13.7) - 0.5) * 0.6;
  vec3 fc = flowerColor(hue) * (0.85 + 0.3 * fract(r1 * 31.7));
  float v = fract(r1 * 5.31);
  float kind = hue < 0.46 ? (v < 0.3 ? 1.0 : 0.0) : hue < 0.62 ? 2.0 : hue < 0.8 ? 3.0 : 4.0;
  if (kind == 1.0) fc = vec3(0.96, 0.5, 0.05) * (0.9 + 0.2 * v);

  // 茎高（都在草尖上下）和花冠半径，按种类
  float hs = kind == 0.0 ? 0.1 + 0.08 * r1
           : kind == 1.0 ? 0.14 + 0.08 * r1
           : kind == 2.0 ? 0.12 + 0.09 * r1
           : kind == 3.0 ? 0.11 + 0.08 * r1
           :               0.16 + 0.1 * r1;
  float hr = kind == 0.0 ? 0.022 : kind == 1.0 ? 0.024 : kind == 2.0 ? 0.034 : kind == 3.0 ? 0.027 : 0.042;
  hr *= 0.85 + 0.3 * fract(r1 * 7.3);
  float cup = kind == 0.0 ? 0.35 : kind == 1.0 ? 0.0 : kind == 2.0 ? 0.0 : kind == 3.0 ? 0.12 : 0.45;

  float gust = gustAt(wxz);
  vec2 bend = uWind * (0.06 + 0.3 * gust) + vec2(sin(uTime * 2.3 + r1 * 30.0), cos(uTime * 1.9 + r2 * 20.0)) * 0.04;

  float ground = terrainH(wxz) - 0.01;
  vec3 top = vec3(wxz.x + bend.x * hs, ground + hs, wxz.y + bend.y * hs);
  vec3 wp;
  vec3 V = normalize(cameraPosition - top);
  vQ = position.xz;
  if (aPart < 0.5) {
    float t = position.y;
    wp = vec3(wxz.x + position.x, ground + t * hs, wxz.y + position.z);
    wp.xz += bend * hs * t * t;
    vKind = -1.0;
  } else {
    // 花冠朝向“天空与观者之间”，从第一人称看去是一朵完整的花；花瓣按种类往上收成杯形
    vec3 n = normalize(mix(vec3(0.0, 1.0, 0.0), V, kind == 2.0 ? 0.35 : 0.55));
    vec3 tg = normalize(cross(n, vec3(0.31, 0.0, 0.95)));
    vec3 bt = cross(n, tg);
    float ra = r2 * 40.0;
    vec2 q = mat2(cos(ra), -sin(ra), sin(ra), cos(ra)) * position.xz;
    float r = length(q);
    float lift = cup * r * r;
    if (kind == 1.0) { q *= 0.75; lift = 0.85 * r * r; }        // 金莲花：花瓣合拢成小球
    if (kind == 2.0) lift = 0.18 * (1.0 - r * r);                // 蓍草：平顶微微拱起的花簇
    wp = top + (tg * q.x + bt * q.y) * hr + n * lift * hr;
    vKind = kind;
  }
  vAlb = fc;
  vFade = fade;

  // 和草地一样的二分色受光：投影 + 云影
  float cs = cloudShadowFast(wxz);
  float ss = sunShadowFast(top);
  float k = smoothstep(uToonEdge.x - uToonEdge.y, uToonEdge.x + uToonEdge.y, ss * clamp(uSunDir.y * 1.4 + 0.2, 0.0, 1.0)) * cs;
  vec3 realA = ambient(vec3(0.0, 1.0, 0.0)) + uSunColor * 0.8 * cs * ss;
  if (aPart < 0.5) {
    vA = mix(uToonLightDeep * realA, mix(uToonShadow, uToonLightDeep, k), uToonMix);
    vB = vec3(0.0);
  } else {
    vA = mix(realA, vec3(mix(0.35, 1.15, k) / uExposure), uToonMix);
    vB = uToonShadow * 0.4 * (1.0 - k) * uToonMix;
  }
  // 空气透视：fog(col) = col × w + rgb
  vec3 f0 = applyFog(vec3(0.0), wp);
  vec3 f1 = applyFog(vec3(1.0), wp);
  vFog = vec4(f0, (f1 - f0).g);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const frag = /* glsl */ `
varying vec2 vQ;
varying float vKind;
varying vec3 vAlb;
varying vec3 vA;
varying vec3 vB;
varying vec4 vFog;
varying float vFade;

float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// n 片花瓣的外轮廓：花瓣中间半径 1，两瓣之间凹进 depth
float petalR(float th, float n, float depth, float sharp) {
  return 1.0 - depth * pow(abs(sin(th * n * 0.5)), sharp);
}

void main() {
  vec3 alb = vec3(1.0);
  float mask = 1.0;
  if (vKind > -0.5) {
    float r = length(vQ);
    float th = atan(vQ.y, vQ.x);
    float aa = max(fwidth(r), 0.02);
    int kind = int(vKind + 0.5);
    alb = vAlb;
    if (kind == 0) {
      // 毛茛：五片圆瓣，靠花心更亮（花瓣有光泽），花心黄绿色带一圈花蕊
      float R = petalR(th, 5.0, 0.32, 2.0) * 0.98;
      mask = 1.0 - smoothstep(R - aa, R + aa, r);
      alb *= 1.0 + 0.35 * (1.0 - smoothstep(0.2, 0.7, r));
      float ring = smoothstep(0.14, 0.2, r) * (1.0 - smoothstep(0.22, 0.3, r));
      alb = mix(alb, vec3(0.55, 0.6, 0.12), 1.0 - smoothstep(0.12, 0.16, r));
      alb = mix(alb, vec3(1.0, 0.85, 0.3), ring * 0.8);
    } else if (kind == 1) {
      // 金莲花：一团合拢的橙黄花瓣，瓣缘稍深
      float R = petalR(th, 8.0, 0.12, 1.5);
      mask = 1.0 - smoothstep(R - aa, R + aa, r);
      alb *= 0.8 + 0.35 * (1.0 - r) + 0.12 * sin(th * 8.0);
    } else if (kind == 2) {
      // 蓍草：平顶花簇，由许多带黄心的小白花组成
      vec2 g = vQ * 4.2;
      vec2 cell = floor(g);
      float best = 0.0;
      float core = 0.0;
      for (int j = 0; j <= 1; j++) for (int i = 0; i <= 1; i++) {
        vec2 cc = cell + vec2(float(i), float(j));
        vec2 o = cc + vec2(h21(cc), h21(cc + 7.1)) * 0.6 + 0.2 - g;
        float d = length(o);
        float on = step(length((cc + 0.5) / 4.2), 0.95);
        best = max(best, on * (1.0 - smoothstep(0.32, 0.42, d)));
        core = max(core, on * (1.0 - smoothstep(0.08, 0.14, d)));
      }
      mask = best;
      alb *= 1.0 - 0.15 * r;
      alb = mix(alb, vec3(0.85, 0.78, 0.45), core * 0.6);
    } else if (kind == 3) {
      // 草原老鹳草：五片宽瓣，深色的脉纹从花心放射出来，花心发白
      float R = petalR(th, 5.0, 0.42, 1.3);
      mask = 1.0 - smoothstep(R - aa, R + aa, r);
      float vein = smoothstep(0.75, 1.0, abs(cos(th * 15.0))) * smoothstep(0.2, 0.35, r) * (1.0 - smoothstep(0.6, 0.9, r));
      alb *= 1.0 - 0.3 * vein;
      alb = mix(alb, vec3(0.88, 0.84, 0.9), (1.0 - smoothstep(0.1, 0.28, r)) * 0.7);
      alb = mix(alb, vec3(0.3, 0.2, 0.35), 1.0 - smoothstep(0.05, 0.09, r));
    } else {
      // 野罂粟 / 虞美人：四片大皱瓣，瓣缘颜色更亮，花心是一圈黑斑和一个青绿的子房
      float R = petalR(th, 4.0, 0.2, 1.4) * (1.0 + 0.04 * sin(th * 23.0) + 0.03 * sin(th * 41.0));
      mask = 1.0 - smoothstep(R - aa, R + aa, r * 1.02);
      alb *= 0.85 + 0.3 * smoothstep(0.3, 0.95, r);
      alb = mix(alb, vec3(0.05, 0.03, 0.04), (1.0 - smoothstep(0.22, 0.32, r)) * 0.85);
      alb = mix(alb, vec3(0.42, 0.5, 0.3), 1.0 - smoothstep(0.1, 0.14, r));
    }
  }
  vec3 col = alb * vA + vB;
  gl_FragColor = vec4(col * vFog.a + vFog.rgb, mask * vFade);
}
`;

function flowerGeometry() {
  const pos = [], part = [], idx = [];
  const add = (x, y, z, p) => { pos.push(x, y, z); part.push(p); return part.length - 1; };
  // 茎：两片交叉的细条
  const w = 0.0035;
  for (const [ax, az] of [[1, 0], [0, 1]]) {
    const a = add(-w * ax, 0, -w * az, 0), b = add(w * ax, 0, w * az, 0), c = add(w * ax, 1, w * az, 0), d = add(-w * ax, 1, -w * az, 0);
    idx.push(a, b, c, a, c, d);
  }
  // 花冠：单位圆片（中心 + 3 圈 × 16），形状在片元里画
  const S = 16, RINGS = [0.4, 0.75, 1.08];
  const center = add(0, 0, 0, 1);
  const rings = RINGS.map((r) => Array.from({ length: S }, (_, i) => {
    const a = (i / S) * Math.PI * 2;
    return add(Math.cos(a) * r, 0, Math.sin(a) * r, 1);
  }));
  for (let i = 0; i < S; i++) idx.push(center, rings[0][i], rings[0][(i + 1) % S]);
  for (let k = 0; k < RINGS.length - 1; k++) {
    for (let i = 0; i < S; i++) {
      const a = rings[k][i], b = rings[k][(i + 1) % S], c = rings[k + 1][i], d = rings[k + 1][(i + 1) % S];
      idx.push(a, c, d, a, d, b);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
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
    alphaToCoverage: true,  // 边缘抗锯齿，远处逐渐溶出
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  return mesh;
}
