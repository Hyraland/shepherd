import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { mulberry32, smoothstep } from './noise.js';
import { fbm3Tex } from './noiseTexture.js';
import { riverInfo, ACROSS } from './rivers.js';
import { COMMON } from './shaders.js';

// 天山云杉（雪岭云杉）：只会在 20 米开外被看到，所以按远观来做——
// 细高的塔形树冠，一层层下垂的枝层，枝层边缘参差（枝梢），里深外浅、底面更暗，
// 法线朝外上方（柔和的体积感，而不是一面面的平光）。
// detail=false 是给 600 米以外用的简化版。
function spruceGeometry(detail) {
  const rng = mulberry32(detail ? 11 : 5);
  const pos = [], nor = [], col = [];
  const C = (hex) => new THREE.Color(hex);
  const inner = C('#13241c'), under = C('#0e1a15'), tipA = C('#2c4b3a'), tipB = C('#3a5c45'), bark = C('#3d2c21');
  const push = (p, n, c) => { pos.push(...p); nor.push(...n); col.push(c.r, c.g, c.b); };
  const tri = (a, b, c) => { push(...a); push(...b); push(...c); };
  const outward = (x, z, up) => { const l = Math.hypot(x, z, up); return [x / l, up / l, z / l]; };

  // 树干（只露出一小截）
  const TS = 6;
  for (let i = 0; i < TS; i++) {
    const a0 = (i / TS) * Math.PI * 2, a1 = ((i + 1) / TS) * Math.PI * 2, r = 0.02;
    const p0 = [Math.cos(a0) * r, 0, Math.sin(a0) * r], p1 = [Math.cos(a1) * r, 0, Math.sin(a1) * r];
    const q0 = [p0[0], 0.14, p0[2]], q1 = [p1[0], 0.14, p1[2]];
    const n0 = outward(Math.cos(a0), Math.sin(a0), 0), n1 = outward(Math.cos(a1), Math.sin(a1), 0);
    tri([p0, n0, bark], [q0, n0, bark], [p1, n1, bark]);
    tri([p1, n1, bark], [q0, n0, bark], [q1, n1, bark]);
  }

  // 树冠轮廓：窄而直，顶部收成尖
  const R = (y) => 0.135 * Math.pow(Math.max(0, 1 - (y - 0.06) / 0.94), 0.72) + 0.006;
  const N = detail ? 12 : 5;      // 枝层数
  const M = detail ? 10 : 6;      // 每层的枝梢数
  for (let k = 0; k < N; k++) {
    const yb = 0.07 + (k / N) * 0.86;
    const h = (0.86 / N) * (detail ? 1.9 : 1.6);   // 层与层互相叠住
    const r0 = R(yb);
    const rot = rng() * Math.PI * 2;
    const shade = 0.85 + rng() * 0.3;
    const apex = [0, yb + h, 0];
    const ring = [];
    for (let i = 0; i < M; i++) {
      const a = rot + (i / M) * Math.PI * 2;
      const tip = detail ? i % 2 === 0 : true;
      const rr = r0 * (tip ? 1 + (rng() - 0.5) * 0.25 : 0.68);
      const droop = tip ? 0.022 + rng() * 0.015 : -0.008;
      const c = tipA.clone().lerp(tipB, rng()).multiplyScalar(tip ? shade : shade * 0.8);
      ring.push({ p: [Math.cos(a) * rr, yb - droop, Math.sin(a) * rr], n: outward(Math.cos(a), Math.sin(a), 0.6), c });
    }
    const underC = [0, yb + h * 0.25, 0];
    for (let i = 0; i < M; i++) {
      const A = ring[i], B = ring[(i + 1) % M];
      tri([apex, [0, 1, 0], inner], [B.p, B.n, B.c], [A.p, A.n, A.c]);
      if (detail) tri([A.p, [A.n[0], -0.6, A.n[2]], under], [B.p, [B.n[0], -0.6, B.n[2]], under], [underC, [0, -1, 0], under]);
    }
  }
  // 树梢
  const top = 0.07 + 0.86 + 0.86 / N;
  const tipC = tipB.clone().multiplyScalar(0.9);
  for (let i = 0; i < 5; i++) {
    const a0 = (i / 5) * Math.PI * 2, a1 = ((i + 1) / 5) * Math.PI * 2, r = 0.012;
    tri([[0, 1.04, 0], [0, 1, 0], tipC],
      [[Math.cos(a1) * r, top, Math.sin(a1) * r], outward(Math.cos(a1), Math.sin(a1), 0.4), tipC],
      [[Math.cos(a0) * r, top, Math.sin(a0) * r], outward(Math.cos(a0), Math.sin(a0), 0.4), tipC]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
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
    const ht = 14 + rng() * 14, wd = ht * (0.85 + rng() * 0.3), rot = rng() * Math.PI * 2, tint = 0.85 + rng() * 0.3;
    if (forestMask(x, z) < 0.5) continue;
    if (riverInfo(x, z).d < 3) continue;
    items.push({ x, z, ht, wd, rot, tint });
  }
  if (!items.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  items.forEach((t, i) => {
    q.setFromAxisAngle(up, t.rot);
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

// 云杉的材质：和草地同一套二分色——亮面 / 暗面颜色由草地的颜色推出来（uForestLit / uForestShade），
// 顶点色只留下明暗（里深外浅、底面更暗）；关掉二分色时是普通的写实光照
const treeVert = /* glsl */ `
varying vec3 vN;
varying vec3 vWorld;
varying float vShade;
varying vec3 vReal;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vWorld = wp.xyz;
  float tint = 1.0;
#ifdef USE_INSTANCING_COLOR
  tint = instanceColor.r;
#endif
  vReal = color * tint;
  vShade = dot(color, vec3(0.2126, 0.7152, 0.0722)) / 0.075 * tint;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const treeFrag = /* glsl */ `
${COMMON}
varying vec3 vN;
varying vec3 vWorld;
varying float vShade;
varying vec3 vReal;
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  float cs = cloudShadow(vWorld.xz);
  float ss = sunShadow(vWorld + N * 0.3);
  float ndl = dot(N, uSunDir);
  float k = smoothstep(0.3, 0.55, ss * clamp(ndl * 0.8 + 0.45, 0.0, 1.0)) * cs;
  vec3 toon = mix(uForestShade, uForestLit, k) * clamp(vShade, 0.35, 1.5);
  vec3 real = vReal * (ambient(N) + uSunColor * max(ndl, 0.0) * ss * cs);
  gl_FragColor = vec4(applyFog(mix(real, toon, uToonMix), vWorld), 1.0);
}
`;

let shared = null;
export function treeAssets(U) {
  shared ||= {
    detailed: spruceGeometry(true),
    simple: spruceGeometry(false),
    material: new THREE.ShaderMaterial({ uniforms: U, vertexShader: treeVert, fragmentShader: treeFrag, vertexColors: true, side: THREE.DoubleSide }),
  };
  return shared;
}
