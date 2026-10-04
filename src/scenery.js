import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { mulberry32, smoothstep } from './noise.js';
import { fbm3Tex } from './noiseTexture.js';
import { riverInfo, ACROSS } from './rivers.js';
import { COMMON } from './shaders.js';

// 天山云杉（雪岭云杉）：又细又高、像一根柱子，枝条短而下垂，树梢是一根细尖。
// 每根枝条是两片交叉的“枝片”（贴一张带透明边的云杉枝贴图，见 branchTexture），一轮一轮绕着树干长，
// 越往下的枝条垂得越厉害——轮廓是毛糙参差的枝梢，而不是一层层光滑的圆锥。
// 光照用整棵树冠的“体积法线”（从树干往外、略朝上），朝阳的半边亮、背阳的半边暗，不会一片片切出暗面；
// 顶点上的 aAo 是遮蔽：靠近树干、树冠下部更暗。aAo < 0 表示树干。
// detail=false 是给 450 米以外用的简化版（更少的枝条，每根只有一片）。
function spruceGeometry(detail) {
  const rng = mulberry32(detail ? 11 : 5);
  const pos = [], nor = [], uv = [], ao = [], rnd = [];
  let cardRand = 0;   // 每片枝片一个随机数（藏色用）
  const push = (p, n, t, o) => { pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); uv.push(t[0], t[1]); ao.push(o); rnd.push(cardRand); };
  const quad = (a, b, c, d, n, ta, tb, tc, td, oa, ob, oc, od) => {
    cardRand = rng();
    push(a, n, ta, oa); push(b, n, tb, ob); push(c, n, tc, oc);
    push(a, n, ta, oa); push(c, n, tc, oc); push(d, n, td, od);
  };
  const add = (p, v, k) => [p[0] + v[0] * k, p[1] + v[1] * k, p[2] + v[2] * k];
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];

  // 树干：细细一根，从枝条的缝隙里透出来
  const TS = 5;
  for (let i = 0; i < TS; i++) {
    const a0 = (i / TS) * Math.PI * 2, a1 = ((i + 1) / TS) * Math.PI * 2, r = 0.008;
    const p0 = [Math.cos(a0) * r, 0, Math.sin(a0) * r], p1 = [Math.cos(a1) * r, 0, Math.sin(a1) * r];
    const n = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)];
    quad(p0, p1, [p1[0], 0.55, p1[2]], [p0[0], 0.55, p0[2]], n, [0, 0], [0, 0], [0, 0], [0, 0], -1, -1, -1, -1);
  }

  // 树冠轮廓：下半截几乎一样粗，往上收成细尖
  const R = (t) => 0.125 * Math.pow(1 - t, 0.62) * (1 - 0.12 * t) + 0.006;
  const N = detail ? 26 : 10;     // 枝条的轮数
  const B = detail ? 9 : 5;       // 每轮的枝条数
  let rot = rng() * Math.PI * 2;
  for (let k = 0; k < N; k++) {
    const t = (k + rng() * 0.6) / N;
    const y = 0.07 + t * 0.86;
    const nb = Math.max(3, Math.round(B * (1 - t * 0.45)));
    rot += 2.39996;                 // 黄金角：上下两轮的枝条错开
    for (let i = 0; i < nb; i++) {
      const a = rot + ((i + (rng() - 0.5) * 0.6) / nb) * Math.PI * 2;
      const reach = R(t) * (0.8 + rng() * 0.4);
      // 越往下垂得越厉害（雪岭云杉的枝条像垂下来的帘子）
      const droop = 0.22 + 0.42 * (1 - t) + (rng() - 0.5) * 0.2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const dir = norm([ca * Math.cos(droop), -Math.sin(droop), sa * Math.cos(droop)]);
      const len = reach / Math.cos(droop);
      const base = [ca * 0.01, y, sa * 0.01];
      const tip = add(base, dir, len);
      const tan = [-sa, 0, ca];
      const vert = norm(cross(dir, tan));
      const w = len * 0.6;
      // 体积法线：从树干往外、略朝上（上部更朝上）
      const n = norm([ca, 0.3 + 0.35 * t, sa]);
      const aoBase = 0.42 + 0.25 * t, aoTip = 0.8 + 0.2 * t;
      const sides = detail
        ? [norm(add(tan, vert, 1)), norm(add(tan, vert, -1))]
        : [norm(add(tan, vert, i % 2 ? 1 : -1))];
      for (const sd of sides) {
        quad(add(base, sd, -w * 0.5), add(tip, sd, -w * 0.5), add(tip, sd, w * 0.5), add(base, sd, w * 0.5), n,
          [0, 0], [1, 0], [1, 1], [0, 1], aoBase, aoTip, aoTip, aoBase);
      }
    }
  }
  // 树梢：一根直立的细尖（两片交叉的窄枝片，贴图的枝梢朝上）
  for (const sd of [[1, 0, 0], [0, 0, 1]]) {
    const b0 = [0, 0.91, 0], b1 = [0, 1.03, 0], w = 0.009;
    quad(add(b0, sd, -w), add(b1, sd, -w), add(b1, sd, w), add(b0, sd, w), [0, 0.6, 0.8],
      [0.35, 0.15], [1, 0.3], [1, 0.75], [0.35, 0.85], 0.55, 0.7, 0.7, 0.55);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aAo', new THREE.Float32BufferAttribute(ao, 1));
  g.setAttribute('aRand', new THREE.Float32BufferAttribute(rnd, 1));
  return g;
}

// 云杉枝贴图（运行时用 canvas 画一次）：u 从树干（0）到枝梢（1），v 是枝片的宽度方向。
// 中间一根主枝，沿着它长出一簇簇小枝：下侧的小枝长而下垂（像帘子），上侧的短而斜向前，
// 每根小枝两边是密密的短针叶；小枝之间留着缝隙，所以整根枝条的轮廓是参差、透光的，不像一片叶子。
// RGB 是明暗（下侧、靠近主枝更暗，朝上的一侧和枝梢更亮），A 是覆盖。
function branchTexture() {
  const W = 256, H = 128;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const rng = mulberry32(77);
  ctx.lineCap = 'round';
  const X = (u) => 4 + u * (W - 12);
  const yc = (u) => H * (0.4 + 0.08 * u * u);                  // 主枝略向下弯
  const env = (u) => Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.05 + 0.03)), 0.55) * (1 - 0.3 * u);
  const gray = (b) => { const v = Math.round(Math.max(0, Math.min(1, b)) * 255); return `rgb(${v},${v},${v})`; };
  const line = (x0, y0, x1, y1, b, w) => {
    ctx.strokeStyle = gray(b); ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  };
  // 一根带针叶的小枝：从 (x, y) 朝 ang 方向长 len，途中慢慢下弯
  const twig = (x, y, ang, len, curl, b0, b1) => {
    let px = x, py = y, a = ang;
    const steps = Math.max(3, Math.round(len / 2.2));
    for (let i = 0; i < steps; i++) {
      const f = i / steps;
      const nx = px + Math.cos(a) * 2.2, ny = py + Math.sin(a) * 2.2;
      line(px, py, nx, ny, b0 * 0.7, 1);
      const nl = (2.4 + rng() * 1.8) * (1 - 0.35 * f);
      const b = b0 + (b1 - b0) * f + (rng() - 0.5) * 0.12;
      for (const sd of [-1, 1]) {
        if (rng() < 0.15) continue;
        const na = a + sd * (0.9 + rng() * 0.5) - 0.25;
        line(nx, ny, nx + Math.cos(na) * nl, ny + Math.sin(na) * nl, b, 1 + rng() * 0.5);
      }
      px = nx; py = ny; a += curl;
    }
  };
  // 主枝本身的针叶
  for (let i = 0; i < 110; i++) {
    const u = i / 110, x = X(u), y = yc(u);
    for (const sd of [-1, 1]) {
      const na = sd * (1.0 + rng() * 0.5) - 0.3;
      const nl = 3 + rng() * 2;
      line(x, y, x + Math.cos(na) * nl, y + Math.sin(na) * nl, 0.38 + 0.2 * u + (sd < 0 ? 0.1 : 0), 1.1);
    }
  }
  // 下侧：长而下垂的小枝（帘子）
  for (let i = 0; i < 30; i++) {
    const u = 0.04 + (i + rng() * 0.8) / 30 * 0.92;
    const e = env(u);
    if (rng() < 0.12) continue;                      // 偶尔空一段，透光
    const len = H * (0.22 + rng() * 0.28) * e;
    twig(X(u), yc(u), 0.75 + rng() * 0.5, len, 0.025, 0.36 + 0.15 * u, 0.5 + 0.25 * u);
  }
  // 上侧：短而斜向前的小枝
  for (let i = 0; i < 24; i++) {
    const u = 0.06 + (i + rng() * 0.8) / 24 * 0.9;
    const e = env(u);
    if (rng() < 0.15) continue;
    const len = H * (0.1 + rng() * 0.16) * e;
    twig(X(u), yc(u), -0.55 - rng() * 0.45, len, 0.06, 0.55 + 0.15 * u, 0.8 + 0.2 * u);
  }
  // 枝梢：一小撮更亮的新芽
  twig(X(0.97), yc(0.97), 0.1, 10, 0.02, 0.7, 0.95);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// 与 shaders.js 里的 forestMask 相同
function forestMask(x, z) {
  const across = Math.abs(x * ACROSS.x + z * ACROSS.z);
  const hills = smoothstep(170, 320, across);
  const n = fbm3Tex(x * 0.006 + 11, z * 0.006 + 3);
  return smoothstep(0.5, 0.56, n + hills * 0.08 - (1 - hills) * 0.06) * smoothstep(170, 190, across);
}

// 一个区块里的树：用区块坐标做种子，同一块地每次生成的树都一样
export function treesForChunk(ci, cj, size, dense, material, geometry) {
  const rng = mulberry32(((ci * 73856093) ^ (cj * 19349663)) >>> 0);
  const candidates = dense ? 520 : 200;
  const items = [];
  for (let k = 0; k < candidates; k++) {
    const x = (ci + rng()) * size, z = (cj + rng()) * size;
    const ht = 14 + rng() * 16, wd = ht * (0.75 + rng() * 0.45), rot = rng() * Math.PI * 2, tint = 0.82 + rng() * 0.36;
    const lx = (rng() - 0.5) * 0.06, lz = (rng() - 0.5) * 0.06;   // 有的树微微歪着
    if (forestMask(x, z) < 0.5) continue;
    if (riverInfo(x, z).d < 3) continue;
    items.push({ x, z, ht, wd, rot, tint, lx, lz });
  }
  if (!items.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  const e = new THREE.Euler();
  items.forEach((t, i) => {
    q.setFromEuler(e.set(t.lx, t.rot, t.lz));
    sc.set(t.wd, t.ht, t.wd);
    p.set(t.x, heightAt(t.x, t.z) - 0.4, t.z);
    m.compose(p, q, sc);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, col.setScalar(t.tint));
  });
  mesh.computeBoundingSphere();
  // 树冠底部的半径，人和羊都绕开
  mesh.userData.obstacles = items.map((t) => ({ x: t.x, z: t.z, r: 0.19 * t.wd * 0.85 }));
  return mesh;
}

// 云杉的材质：和草地同一套二分色——亮面 / 暗面颜色在面板“云杉林”里调（uForestLit / uForestShade），
// 枝片贴图和 aAo 只给明暗；关掉二分色时是普通的写实光照。
// 透明边用 alpha-to-coverage：远处贴图缩小时按 mip 级别把覆盖补回来，树不会越远越稀
const treeVert = /* glsl */ `
uniform float uTime;
attribute float aAo;
attribute float aRand;
varying float vRand;
varying vec3 vN;
varying vec3 vWorld;
varying vec2 vUv;
varying float vAo;
varying float vTint;
void main() {
  vec3 p = position;
  // 树冠上部随风轻轻晃
  float id = float(gl_InstanceID);
  float sw = p.y * p.y;
  p.x += sin(uTime * 0.9 + id * 1.7) * 0.004 * sw;
  p.z += cos(uTime * 0.7 + id * 2.3) * 0.003 * sw;
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vWorld = wp.xyz;
  vUv = uv;
  vAo = aAo;
  vRand = fract(aRand + float(gl_InstanceID) * 0.618034);
  vTint = 1.0;
#ifdef USE_INSTANCING_COLOR
  vTint = instanceColor.r;
#endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const treeFrag = /* glsl */ `
${COMMON}
uniform sampler2D uBranch;
varying vec3 vN;
varying vec3 vWorld;
varying vec2 vUv;
varying float vAo;
varying float vTint;
varying float vRand;
void main() {
  float a = 1.0, b;
  if (vAo < 0.0) {
    b = 0.3;                                   // 树干
  } else {
    vec4 tx = texture2D(uBranch, vUv);
    vec2 ts = vUv * vec2(256.0, 128.0);
    float mip = max(0.0, 0.5 * log2(max(dot(dFdx(ts), dFdx(ts)), dot(dFdy(ts), dFdy(ts)))));
    a = tx.a * (1.0 + mip * 0.3);
    a = clamp((a - 0.45) / max(fwidth(a), 1e-4) + 0.5, 0.0, 1.0);
    if (a < 0.01) discard;
    b = tx.r * vAo;
  }
  float f = clamp(b * 1.5, 0.3, 1.3) * vTint;
  vec3 N = normalize(vN);
  float cs = cloudShadow(vWorld.xz);
  float ss = sunShadow(vWorld + N * 0.3);
  float ndl = dot(N, uSunDir);
  float k = smoothstep(0.25, 0.6, ss * clamp(ndl * 0.8 + 0.45, 0.0, 1.0)) * cs;
  vec3 toon = mix(uForestShade, uForestLit, k) * f;
  // 藏色（和草地一样）：一部分枝片悄悄换成别的色相——向阳的是赭黄、玫瑰、薄荷、柠檬，
  // 背阳的是紫、蓝、青、梅红；亮度不变，远看仍是一片深绿的林子
  if (vAo >= 0.0 && fract(vRand * 7.13) < uForestHues * 0.5) {
    float hr = fract(vRand * 19.7);
    vec3 warm = hr < 0.3 ? vec3(1.0, 0.72, 0.3) : hr < 0.55 ? vec3(1.0, 0.5, 0.55) : hr < 0.8 ? vec3(0.45, 0.95, 0.75) : vec3(0.95, 0.95, 0.4);
    vec3 cool = hr < 0.3 ? vec3(0.55, 0.42, 0.95) : hr < 0.6 ? vec3(0.3, 0.48, 1.0) : hr < 0.85 ? vec3(0.25, 0.75, 0.8) : vec3(0.8, 0.38, 0.75);
    vec3 hue = mix(cool, warm, k);
    const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
    hue *= dot(toon, LUM) / max(dot(hue, LUM), 1e-4);
    toon = mix(toon, hue, (0.35 + 0.4 * clamp(b * 1.5, 0.0, 1.0)) * min(1.0, uForestHues * 1.5));
  }
  vec3 real = vec3(0.07, 0.12, 0.085) * f * (ambient(N) + uSunColor * max(ndl, 0.0) * ss * cs);
  gl_FragColor = vec4(applyFog(mix(real, toon, uToonMix), vWorld), a);
}
`;

let shared = null;
export function treeAssets(U) {
  shared ||= {
    detailed: spruceGeometry(true),
    simple: spruceGeometry(false),
    material: new THREE.ShaderMaterial({
      uniforms: { ...U, uBranch: { value: branchTexture() } },
      vertexShader: treeVert, fragmentShader: treeFrag,
      side: THREE.DoubleSide, alphaToCoverage: true,
    }),
  };
  return shared;
}
