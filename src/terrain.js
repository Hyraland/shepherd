import * as THREE from 'three';
import { nearHeight, fbm, ridged, smoothstep } from './noise.js';
import { COMMON, WILDFLOWERS } from './shaders.js';
import { FLOW, ACROSS } from './rivers.js';

// 一条东西走向、两头都走不到尽头的河谷：谷底是起伏的草甸和蜿蜒的溪流，顺着河缓缓向西降低；
// 南北两侧是长满云杉的山坡。地形按 256m 的区块在人周围随走随生成（world.js）。
// 地平线上的雪山是一圈跟着人走的远景（像天空盒一样没有视差，所以永远走不到）。
// 注意：草叶区（相机周围 ~45m，|横向| < 200m）里只用 nearHeight，与 GLSL 的 terrainH 一致。

function hills(x, z, v) {
  if (v <= 200) return 0;
  const hill = smoothstep(200, 1100, v);
  return hill * (70 + 90 * fbm(x * 0.0025, z * 0.0025, 4)) + hill * hill * 45 * ridged(x * 0.004, z * 0.004, 4);
}

export function heightAt(x, z) {
  return nearHeight(x, z) + hills(x, z, Math.abs(x * ACROSS.x + z * ACROSS.z));
}

// 远景圈的高度（相对相机所在的谷底；x、z 是相对相机的偏移）
export function horizonHeight(x, z) {
  const r = Math.hypot(x, z);
  const u = x * FLOW.x + z * FLOW.z;
  const v = Math.abs(x * ACROSS.x + z * ACROSS.z);
  let h = -0.03 * u + hills(x + 5000, z - 3000, v);
  // 东边（上游）是高高的雪山，西边（下游、太阳的方向）河谷敞开，只有低矮的山脊
  const mask = 0.2 + 0.8 * (1 - smoothstep(-0.2, 0.7, u / r));
  const rg = ridged(x * 0.0019 + 7.1, z * 0.0019 - 2.3, 4);
  const broad = fbm(x * 0.0011 + 4.2, z * 0.0011 - 1.3, 3);
  h += smoothstep(1700, 2500, r) * mask * (60 + 130 * broad + 280 * Math.pow(rg, 1.6));
  // 内圈压到地形底下，由近处的区块地形挡住
  h -= 80 * (1 - smoothstep(1300, 1950, r));
  return h;
}

const vert = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const frag = /* glsl */ `
${COMMON}
${WILDFLOWERS}
uniform vec3 uRock;
uniform vec3 uSnow;
uniform vec3 uAlpine;
uniform vec2 uTexOffset;   // 远景圈跟着人走：纹理用它自己的局部坐标，才不会在山上“滑动”
uniform float uHOffset;
varying vec3 vWorld;
varying vec3 vN;

void main() {
  vec3 N = normalize(vN);
  vec2 p = vWorld.xz - uTexOffset;
  // 高度带（草甸 → 高山草甸 → 岩石 → 雪）按相对谷底的高度算
  float h = vWorld.y - uHOffset - valleyTilt(alongValley(p));
  float dist = length(vWorld - cameraPosition);
  float across = acrossValley(p);

  // 远处山坡的细节：用噪声扰动法线，补上网格分辨率不够的起伏
  float far = smoothstep(250.0, 900.0, dist);
  vec2 bump = vec2(vnoise(p * 0.035), vnoise(p * 0.035 + 19.7)) - 0.5
            + (vec2(vnoise(p * 0.11 + 3.3), vnoise(p * 0.11 + 8.1)) - 0.5) * 0.5;
  N = normalize(N + vec3(bump.x, 0.0, bump.y) * 0.9 * far * smoothstep(20.0, 120.0, h));

  vec3 base = fieldColor(p);
  // 近处是草丛底下的暗部，远处看到的是一片草尖
  vec3 alb = mix(base * 0.5, mix(base, uGrassTip, 0.25), smoothstep(5.0, 26.0, dist));
  float mn = fbm3(p * 0.01);
  alb = mix(alb, uAlpine * (0.85 + 0.3 * mn), smoothstep(160.0, 260.0, h));

  // 云杉林：深蓝绿，树冠斑驳
  float fm = forestMask(p, across) * (1.0 - smoothstep(260.0, 320.0, h + mn * 60.0));
  float crowns = vnoise(p * 0.7) * 0.55 + vnoise(p * 0.18) * 0.45;
  alb = mix(alb, uForest * (0.6 + 0.8 * crowns), fm);

  // 远山：顺着坡向的冲沟纹理——雪先积在沟里，岩脊露出来
  vec2 downhill = normalize(N.xz + 1e-4);
  float contour = dot(p, vec2(-downhill.y, downhill.x));
  float gully = vnoise(vec2(contour * 0.045, h * 0.012)) * 0.65 + vnoise(vec2(contour * 0.13, h * 0.03)) * 0.35;
  float mtn = smoothstep(200.0, 300.0, h);
  N = normalize(N + vec3(-downhill.y, 0.0, downhill.x) * (gully - 0.5) * 0.9 * mtn);
  float rock = smoothstep(280.0 + mn * 60.0, 360.0, h);
  rock = max(rock, smoothstep(0.42, 0.68, 1.0 - N.y) * smoothstep(200.0, 280.0, h));
  alb = mix(alb, uRock * (0.75 + 0.4 * mn) * (0.85 + 0.3 * gully), clamp(rock, 0.0, 1.0));
  float snowLine = 330.0 + mn * 70.0 - gully * 70.0;
  float snow = smoothstep(snowLine, snowLine + 22.0, h) * smoothstep(0.2, 0.5, N.y + gully * 0.25);
  alb = mix(alb, uSnow, snow);

#ifndef RING
  // 溪流：天然的岸——草一直长到水边，只露出一窄条不规则的湿泥土
  float rw;
  float rd = riverDist(p, rw);
  float aa = max(fwidth(rd), 0.015);
  float wv = max(rw, dist * 0.0026);                // 远处的细流也保持可见
  float water = 1.0 - smoothstep(-aa, aa, rd - (wv - rw));
  water *= mix(rw / wv, 1.0, 0.85);
  float nearBank = (1.0 - water) * (1.0 - smoothstep(80.0, 200.0, dist));
  float bw = bankWidth(p);
  float bank = (1.0 - smoothstep(bw * 0.6, bw + 0.08, rd)) * nearBank;
  vec3 soil = vec3(0.2, 0.17, 0.12) * (0.75 + 0.5 * vnoise(p * 2.7)) * (0.85 + 0.3 * vnoise(p * 0.6));
  alb = mix(alb, soil, bank);
  alb *= 1.0 - 0.4 * (1.0 - smoothstep(0.0, 0.12, rd)) * nearBank;   // 贴着水的一圈更湿、更深

#endif

  float cs = cloudShadow(vWorld.xz);
  float ss = sunShadow(vWorld);
  float sv = cs * ss;
  vec3 col = alb * (ambient(N) + uSunColor * max(dot(N, uSunDir), 0.0) * sv);

  // 二分色：草甸部分（不含林子、岩石、雪）用和草叶同样的亮面 / 暗面颜色，远近接得上
  {
    float meadow = (1.0 - fm) * (1.0 - clamp(rock, 0.0, 1.0)) * (1.0 - snow) * (1.0 - smoothstep(200.0, 300.0, h));
#ifndef RING
    meadow *= 1.0 - bank;
#endif
    float lightT = ss * clamp(dot(N, uSunDir) * 1.4, 0.0, 1.0);
    float root = mix(0.55, 1.0, smoothstep(5.0, 26.0, dist));
    vec3 toon = toonGrass(lightT, cs, (vnoise(p * 0.08 + 3.1) - 0.5) * 1.2, root);
    col = mix(col, toon, uToonMix * meadow);
    // 野花：远看是一片片带颜色的花海，近看是细碎的花点；暗面里的花跟着变暗
    if (uFlowers > 0.001 && meadow > 0.01) {
      float cover = flowerCover(p);
      if (cover > 0.001) {
        vec3 fc;
        float fl = wildflowers(p, cover, vnoise(p * 0.03 + 5.0), fc) * meadow * smoothstep(10.0, 18.0, dist);
        float k = smoothstep(uToonEdge.x - uToonEdge.y, uToonEdge.x + uToonEdge.y, lightT) * cs;
        vec3 litF = mix(fc * 0.35 / uExposure + uToonShadow * 0.4, fc * 1.15 / uExposure, k);
        col = mix(col, mix(fc * (ambient(N) + uSunColor * max(dot(N, uSunDir), 0.0) * sv), litF, uToonMix), fl * 0.9);
      }
    }
  }

#ifndef RING
  // 风吹过远处草甸时被压弯的草反着光，一阵阵亮起来
  float gustFade = smoothstep(14.0, 30.0, dist) * (1.0 - smoothstep(120.0, 300.0, dist));
  col += uSunColor * alb * 0.35 * gustAt(p) * gustFade * sv * (1.0 - fm);

  // 溪水（参考 earth_history）：水本身偏深，映出深蓝的天；细碎的波纹顺流而下，
  // 太阳在每一道波纹上留下一个很亮的小高光，经过辉光晕开就是一片闪闪发亮的碎光。
  // 远处的波纹小于一个像素，就把高光放宽成一条朝太阳方向的光带，带一点金色
  if (water > 0.001) {
    vec3 V = normalize(cameraPosition - vWorld);
    float along = alongValley(p), acr = acrossValley(p);
    float far = smoothstep(12.0, 260.0, dist);
    // 波纹高度场：三层不同尺度、顺流移动的噪声，按顺流 / 横跨两个方向求梯度
    vec2 r = vec2(along, acr) * uRipple;
    vec2 q1 = r * vec2(1.1, 2.0) + vec2(-uTime * 1.3, 0.0);
    vec2 q2 = r * vec2(2.9, 4.4) + vec2(-uTime * 2.1, uTime * 0.25);
    vec2 q3 = r * vec2(6.5, 7.5) + vec2(-uTime * 3.2, -uTime * 0.4);
    const float e = 0.12;
    float h0 = vnoise(q1) * 0.55 + vnoise(q2) * 0.3 + vnoise(q3) * 0.15;
    float ha = vnoise(q1 + vec2(e, 0.0)) * 0.55 + vnoise(q2 + vec2(e, 0.0)) * 0.3 + vnoise(q3 + vec2(e, 0.0)) * 0.15;
    float hc = vnoise(q1 + vec2(0.0, e)) * 0.55 + vnoise(q2 + vec2(0.0, e)) * 0.3 + vnoise(q3 + vec2(0.0, e)) * 0.15;
    float amp = 0.9 * mix(1.0, 0.35, far);
    vec2 g = vec2(ha - h0, hc - h0) / e * amp;
    vec2 gw = vec2(${FLOW.x.toFixed(6)} * g.x + ${ACROSS.x.toFixed(6)} * g.y, ${FLOW.z.toFixed(6)} * g.x + ${ACROSS.z.toFixed(6)} * g.y);
    vec3 Nw = normalize(vec3(-gw.x, 1.0, -gw.y));

    vec3 R = reflect(-V, Nw);
    R.y = abs(R.y);
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(Nw, V), 0.0), 5.0);
    vec3 wcol = uWaterColor * (0.55 + 0.45 * sv);
    wcol = mix(wcol, skyColorAt(R), clamp(fres * uWaterRefl * 1.2, 0.0, 1.0));

    // 太阳高光（GGX）：近处粗糙度很低 → 一粒粒碎光；远处放宽 → 一条光带
    float rough = mix(0.07, 0.24, far);
    float a2 = rough * rough * rough * rough;
    vec3 Hh = normalize(uSunDir + V);
    float nh = max(dot(Nw, Hh), 0.0);
    float dd = nh * nh * (a2 - 1.0) + 1.0;
    float D = a2 / (3.14159 * dd * dd);
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(Hh, V), 0.0), 5.0);
    float spec = min(D * F / (4.0 * max(dot(Nw, V), 0.15)) * max(dot(Nw, uSunDir), 0.0), 24.0);
    vec3 glintCol = mix(uSunColor, uRiverGold * length(uSunColor) * 0.6, far);
    wcol += glintCol * spec * sv * uGlitter;
    col = mix(col, wcol, water);
  }
#endif

  gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
}
`;

export function makeTerrainMaterial(U, ring = false) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uTexOffset: { value: new THREE.Vector2() }, uHOffset: { value: 0 } },
    defines: ring ? { RING: '' } : {},
    vertexShader: vert,
    fragmentShader: frag,
    side: THREE.DoubleSide, // 区块边缘的“裙边”从外侧也要看得见
  });
}

// 一块地形：(seg+1)² 的网格 + 四周向下垂的裙边（挡住相邻区块精度不同造成的缝）
export function chunkGeometry(x0, z0, size, seg) {
  const step = size / seg;
  const n = seg + 3; // 多一圈用来算法线
  const hs = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) hs[j * n + i] = heightAt(x0 + (i - 1) * step, z0 + (j - 1) * step);
  const H = (i, j) => hs[(j + 1) * n + (i + 1)];
  const m = seg + 1;
  const edge = 4 * seg;
  const pos = new Float32Array((m * m + edge) * 3);
  const nor = new Float32Array((m * m + edge) * 3);
  const N = new THREE.Vector3();
  let k = 0;
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      pos[k] = x0 + i * step; pos[k + 1] = H(i, j); pos[k + 2] = z0 + j * step;
      N.set(H(i - 1, j) - H(i + 1, j), 2 * step, H(i, j - 1) - H(i, j + 1)).normalize();
      nor[k] = N.x; nor[k + 1] = N.y; nor[k + 2] = N.z;
      k += 3;
    }
  }
  const idx = [];
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * m + i, b = a + 1, c = a + m, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // 裙边：沿四条边一圈
  const ring = [];
  for (let i = 0; i < seg; i++) ring.push(i);
  for (let j = 0; j < seg; j++) ring.push(j * m + seg);
  for (let i = seg; i > 0; i--) ring.push(seg * m + i);
  for (let j = seg; j > 0; j--) ring.push(j * m);
  const depth = step * 1.5 + 3;
  const base = m * m;
  ring.forEach((vi, r) => {
    const o = (base + r) * 3;
    pos[o] = pos[vi * 3]; pos[o + 1] = pos[vi * 3 + 1] - depth; pos[o + 2] = pos[vi * 3 + 2];
    nor[o] = nor[vi * 3]; nor[o + 1] = nor[vi * 3 + 1]; nor[o + 2] = nor[vi * 3 + 2];
  });
  for (let r = 0; r < ring.length; r++) {
    const a = ring[r], b = ring[(r + 1) % ring.length], a2 = base + r, b2 = base + ((r + 1) % ring.length);
    idx.push(a, a2, b, b, a2, b2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

// 地平线远景圈：r 1300 → 3600，跟着人移动（没有视差）
export function createHorizon(U) {
  const NR = 150, NS = 1400, r0 = 1300, r1 = 3600;
  const pos = new Float32Array((NR + 1) * NS * 3);
  let k = 0;
  for (let i = 0; i <= NR; i++) {
    const r = r0 + (r1 - r0) * Math.pow(i / NR, 1.2);
    for (let j = 0; j < NS; j++) {
      const a = (j / NS) * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      pos[k++] = x; pos[k++] = horizonHeight(x, z); pos[k++] = z;
    }
  }
  const idx = new Uint32Array(NR * NS * 6);
  k = 0;
  for (let i = 0; i < NR; i++) {
    for (let j = 0; j < NS; j++) {
      const a = i * NS + j, b = i * NS + ((j + 1) % NS);
      const c = (i + 1) * NS + j, d = (i + 1) * NS + ((j + 1) % NS);
      idx[k++] = a; idx[k++] = b; idx[k++] = c;
      idx[k++] = b; idx[k++] = d; idx[k++] = c;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mat = makeTerrainMaterial(U, true);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  // 每帧把远景圈挪到人脚下
  mesh.userData.follow = (x, z, groundY) => {
    mesh.position.set(x, groundY, z);
    mat.uniforms.uTexOffset.value.set(x, z);
    mat.uniforms.uHOffset.value = groundY;
  };
  return mesh;
}
