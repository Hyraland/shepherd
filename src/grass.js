import * as THREE from 'three';
import { COMMON } from './shaders.js';
import { mulberry32 } from './noise.js';

// 草叶放在一块跟着相机“平铺环绕”的方形区域里：
// 实例坐标对区域边长取模，所以每根草在世界里位置固定，只在边缘处悄悄换位。
// 两层：脚边极细极密的一层，稍远处稀一些、宽一些的一层，再远交给地面着色。
// 两层之间不是一条分界线，而是在一段很宽的距离里，每根草按自己的随机阈值逐根隐去 / 出现，
// 近层变稀的同时远层变密，看不出接缝。
// 草是短的（多数 12–30 厘米，偶有高草丛），一丛丛长，叶片从丛心向四周散开。

const vert = /* glsl */ `
${COMMON}
attribute vec4 aBlade;
uniform vec3 uCenter;
uniform float uSize;
uniform vec2 uFadeIn;   // 从多远开始出现（x→y），x<0 表示从脚下就有
uniform vec2 uFadeOut;  // 到多远逐渐消失（x→y）
uniform float uWidth;
uniform float uHeight;
varying vec3 vCol;

// 每个格子一个随机数：直接读噪声纹理的格点值（比 sin 哈希便宜得多，32 格一循环）
float h21(vec2 p) { return vnoise(p); }

void main() {
  vec2 c = uCenter.xz;
  vec2 local = mod(aBlade.xy - c + 0.5 * uSize, uSize) - 0.5 * uSize;
  vec2 wxz = c + local;
  float r1 = aBlade.z;
  float r2 = aBlade.w;

  // 一丛一丛：叶片被拉向最近的丛心（丛心在格子里随机抖动，取周围四格里最近的那个，
  // 形成不规则的泰森多边形，不会排成行）
  const float CS = 0.45;
  vec2 g = wxz / CS - 0.5;
  vec2 base = floor(g);
  vec2 cell = base, center = vec2(0.0);
  float best = 1e9;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 cc = base + vec2(float(i), float(j));
      vec2 cp = (cc + vec2(h21(cc), h21(cc + vec2(13.0, 7.0)))) * CS;
      float d2 = dot(cp - wxz, cp - wxz);
      if (d2 < best) { best = d2; cell = cc; center = cp; }
    }
  }
  float clumpy = 0.3 + 0.35 * vnoise(wxz * 0.15 + 2.0);
  wxz = mix(wxz, center, clumpy * (0.3 + 0.6 * r2));
  vec2 splay = wxz - center;
  splay = splay / max(length(splay), 0.02);
  float clumpH = 0.6 + 0.8 * h21(cell + vec2(5.0, 19.0));

  // 逐根淡入淡出（随机阈值），代替一刀切的分界
  float dist = length(wxz - c);
  float w = 1.0 - smoothstep(uFadeOut.x, uFadeOut.y, dist);
  if (uFadeIn.x >= 0.0) w *= smoothstep(uFadeIn.x, uFadeIn.y, dist);
  float thr = fract(r1 * 7.31 + r2 * 3.17);
  float alive = smoothstep(thr - 0.06, thr + 0.02, w);

  // 溪流里不长草，岸边的草矮一些
  float rw;
  float rd = riverDist(wxz, rw);
  float bw = bankWidth(wxz);
  float shore = smoothstep(bw, bw + 0.8, rd);
  alive *= smoothstep(bw * 0.5, bw + 0.05, rd);   // 草一直长到岸边，只让出露泥土的那一窄条

  float tall = smoothstep(0.55, 0.8, vnoise(wxz * 0.05 + 9.0));
  float hgt = uHeight * (0.6 + 0.7 * r2) * clumpH * (0.75 + 1.0 * tall) * (0.5 + 0.5 * shore) * (0.4 + 0.6 * alive);
  float wid = uWidth * (0.7 + 0.6 * r1) * alive;
  float ang = r1 * 31.4 + r2 * 6.28;
  vec2 fdir = vec2(cos(ang), sin(ang));
  vec2 side = vec2(-fdir.y, fdir.x);
  float t = position.y;

  // 风：阵风顺着风向扫过（短草更硬，只是轻轻压低）；平时叶片朝四周散开，各自微微颤动
  float gust = gustAt(wxz);
  float flutter = sin(uTime * 3.4 + r1 * 40.0) * (0.03 + 0.05 * gust);
  vec2 bend = splay * (0.12 + 0.38 * r2) + uWind * (0.05 + 0.32 * gust) + side * flutter;
  float k = pow(t, 1.5);

  vec3 wp = vec3(wxz.x, terrainH(wxz), wxz.y);
  wp.xz += side * position.x * wid + bend * k * hgt;
  float b2 = min(dot(bend, bend), 0.9);
  wp.y += t * hgt * sqrt(1.0 - b2 * k * 0.8);

  // 叶片法线（双面：总是朝向观察者那一面），远处渐渐并向地面法线
  float dk = 1.5 * pow(max(t, 0.001), 0.5);
  vec3 tangent = normalize(vec3(bend.x * dk, 1.0, bend.y * dk));
  vec3 N = normalize(cross(vec3(side.x, 0.0, side.y), tangent));
  vec3 V = normalize(cameraPosition - wp);
  if (dot(N, V) < 0.0) N = -N;
  float far = smoothstep(3.0, 30.0, dist);
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.3 + 0.4 * far));

  // 颜色：每丛深浅不同，约一成是枯黄的叶片，叶尖偏浅偏黄
  vec3 fc = fieldColorFast(wxz) * (0.85 + 0.3 * h21(cell + vec2(9.0, 3.0)));
  vec3 tipc = mix(fc, uGrassTip, 0.15 + 0.35 * r1);
  float dry = step(0.9, fract(r2 * 13.7 + r1 * 3.3));
  tipc = mix(tipc, uGrassDry * 1.15, dry * 0.85);
  vec3 alb = mix(fc * 0.35, tipc, smoothstep(0.0, 1.0, t));
  float ao = mix(0.22, 1.0, smoothstep(0.0, 0.9, t));

  float cs = cloudShadowFast(wxz);
  float ss = sunShadowFast(wp);
  float sv = cs * ss;
  float diff = max(dot(N, uSunDir), 0.0) * 0.85 + 0.15;
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), 32.0) * 0.12;
  float trans = pow(max(dot(-V, uSunDir), 0.0), 3.0) * t * t * (1.0 - dry * 0.5);
  vec3 col = alb * ambient(N) * ao
           + (alb * diff * ao + spec + uTransl * trans + alb * 0.25 * gust * t) * uSunColor * sv;

  // 二分色：法线大半并向地面，整片草按太阳 / 云影 / 投影切成亮暗两块
  float lightT = ss * clamp(dot(normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.65)), uSunDir) * 1.4, 0.0, 1.0);
  float vary = (h21(cell + vec2(9.0, 3.0)) - 0.5) * 2.0 + dry * 0.8;
  vec3 toon = toonGrass(lightT, cs, vary, t) * (1.0 + 0.15 * gust * t);
  // 藏色（像油画里的草）：一部分草叶悄悄换成别的色相——亮面里是粉、橙、柠檬黄、薄荷青，
  // 暗面里是紫、蓝、青、玫红；亮度不变、只换色相，所以远看仍是一片和谐的绿。
  // 杂色的多少随地块慢慢变化，越往叶尖越明显
  float hp = fract(r1 * 3.97 + r2 * 11.31);
  float region = vnoise(wxz * 0.07 + 21.0);
  if (hp < uGrassHues * 0.55 * (0.4 + 1.2 * region)) {
    float hr = fract(r1 * 17.13 + r2 * 5.71);
    vec3 warm = hr < 0.25 ? vec3(1.0, 0.5, 0.6) : hr < 0.5 ? vec3(1.0, 0.62, 0.3) : hr < 0.75 ? vec3(0.95, 0.92, 0.35) : vec3(0.5, 0.95, 0.78);
    vec3 cool = hr < 0.3 ? vec3(0.55, 0.42, 0.95) : hr < 0.6 ? vec3(0.32, 0.5, 1.0) : hr < 0.85 ? vec3(0.28, 0.78, 0.8) : vec3(0.85, 0.4, 0.8);
    float litK = smoothstep(uToonEdge.x - 0.1, uToonEdge.x + 0.1, lightT) * cs;
    vec3 hue = mix(cool, warm, litK);
    const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
    hue *= dot(toon, LUM) / max(dot(hue, LUM), 1e-3);
    toon = mix(toon, hue, (0.35 + 0.45 * t) * min(1.0, uGrassHues * 1.5));
  }
  col = mix(col, toon, uToonMix);

  vCol = applyFog(col, wp);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const frag = /* glsl */ `
varying vec3 vCol;
void main() { gl_FragColor = vec4(vCol, 1.0); }
`;

function bladeGeometry(segs) {
  const pos = [];
  for (let i = 0; i < segs; i++) {
    const y = i / segs;
    const w = 0.5 * (1 - Math.pow(y, 1.3));
    pos.push(-w, y, 0, w, y, 0);
  }
  pos.push(0, 1, 0);
  const idx = [];
  for (let i = 0; i < segs - 1; i++) {
    const a = 2 * i, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, d, a, d, c);
  }
  const l = 2 * (segs - 1);
  idx.push(l, l + 1, 2 * segs);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function scatter(count, size, seed) {
  const rng = mulberry32(seed);
  const a = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    a[i * 4] = rng() * size;
    a[i * 4 + 1] = rng() * size;
    a[i * 4 + 2] = rng();
    a[i * 4 + 3] = rng();
  }
  return a;
}

export function createGrass(U, { count, size, fadeIn = [-1, 0], fadeOut, width, height, segs, seed }) {
  const g = bladeGeometry(segs);
  g.setAttribute('aBlade', new THREE.InstancedBufferAttribute(scatter(count, size, seed), 4));
  g.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...U,
      uSize: { value: size },
      uFadeIn: { value: new THREE.Vector2(fadeIn[0], fadeIn[1]) },
      uFadeOut: { value: new THREE.Vector2(fadeOut[0], fadeOut[1]) },
      uWidth: { value: width },
      uHeight: { value: height },
    },
    vertexShader: vert,
    fragmentShader: frag,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.userData.maxCount = count;
  return mesh;
}
