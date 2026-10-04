import * as THREE from 'three';
import { nearHeight, fbm, ridged, smoothstep, valleyTilt } from './noise.js';
import { COMMON, WILDFLOWERS } from './shaders.js';
import { FLOW, ACROSS } from './rivers.js';

// 一条东西走向、两头都走不到尽头的河谷：谷底是起伏的草甸和蜿蜒的溪流，顺着河缓缓向西降低；
// 南北两侧是长满云杉的山坡。地形按 256m 的区块在人周围随走随生成（world.js）。
// 地平线上的雪山是一圈跟着人走的远景（像天空盒一样没有视差，所以永远走不到）。
// 注意：草叶区（相机周围 ~45m，|横向| < 200m）里只用 nearHeight，与 GLSL 的 terrainH 一致。

const mix = (a, b, t) => a + (b - a) * t;

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
  // 下游的湖：湖盆压到湖面以下，远岸和两侧抬到湖面以上
  // （只管区块地形以外的部分；里面一圈压在区块地形底下，近岸由区块地形和湖面自然相交）
  const sd = lakeSdf(u, x * ACROSS.x + z * ACROSS.z);
  const outer = smoothstep(1850, 2050, r);
  // 湖盆往岸边缓缓抬起，岸线就是山坡和湖面相交的地方（不会切出陡壁）
  if (sd < 0) h = Math.min(h, mix(h, LAKE.level - 4, smoothstep(0, 220, -sd)));
  else {
    // 只在湖的附近（下游方向、离岸几百米内）把地面抬到湖面以上，别处不动
    const nearLake = smoothstep(LAKE.u0 - 300, LAKE.u0 + 200, u) * (1 - smoothstep(400, 700, sd));
    if (nearLake > 0) h = Math.max(h, LAKE.level + (0.6 + Math.min(sd, 700) * 0.07) * outer * nearLake - 80 * (1 - outer * nearLake));
  }
  return h;
}

// 河谷下游远处的湖（坐标相对远景圈的中心，也就是人所在位置的河谷中线）。
// 湖和远景圈一起跟着人走，所以永远在一公里开外——只能远远地望着，几条溪流都朝它流去。
// level 是湖面相对人所在处谷底的高度；近岸是草甸的低洼处没进湖面里，岸线自然弯曲
export const LAKE = { u0: 450, u1: 3300, half: 520, level: -0.03 * 650 - 6 };
export function lakeSdf(u, v) {
  const cu = (LAKE.u0 + LAKE.u1) / 2, au = (LAKE.u1 - LAKE.u0) / 2;
  // 岸线：湖湾和伸进湖里的岬角
  const half = LAKE.half * (0.8 + 0.45 * fbm(u * 0.0016 + 3.1, 0.7, 3)) * smoothstep(LAKE.u0 - 300, LAKE.u0 + 900, u) + 1;
  const e = Math.hypot((u - cu) / au, v / half) - 1;
  return e * Math.min(au, half) + (fbm(u * 0.004 + 1.7, v * 0.004 - 2.2, 3) - 0.5) * 260;
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

// 水面碎光的一层：每格里一颗圆亮点（只有一部分格子有），各自随机闪一下
float sparkHash(vec2 c, float k) {
  vec3 p3 = fract(vec3(mod(c, 4096.0).xyx) * 0.1031 + k * 0.173);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float sparkLayer(vec2 x, float dens, float seed) {
  vec2 cell = floor(x);
  float h1 = sparkHash(cell, seed), h2 = sparkHash(cell, seed + 7.0);
  vec2 off = vec2(fract(h1 * 13.1), fract(h2 * 7.7)) * 0.4 + 0.3;
  float dm = 1.0 - smoothstep(0.12, 0.38, length(fract(x) - off));
  float tw = fract(h1 * 7.3 + uTime * (0.5 + h2));
  float flash = smoothstep(0.0, 0.1, tw) * (1.0 - smoothstep(0.15, 0.45, tw));
  return step(1.0 - dens, h2) * flash * dm;
}

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
  // 近处和种了树的地方完全一致；900 米外没有树了，林缘逐渐变得参差
  float fSoft = smoothstep(900.0, 1600.0, dist);
  float fm = (fSoft > 0.0 ? forestMaskFar(p, across, fSoft, h) : forestMask(p, across)) * (1.0 - smoothstep(260.0, 320.0, h + mn * 60.0));
  float crowns = vnoise(p * 0.7) * 0.55 + vnoise(p * 0.18) * 0.45;
  alb = mix(alb, uForest * (0.6 + 0.8 * crowns), fm);

  // 远山：顺着坡向的冲沟纹理——雪先积在沟里，岩脊露出来
  vec2 downhill = normalize(N.xz + 1e-4);
  float contour = dot(p, vec2(-downhill.y, downhill.x));
  float gully = vnoise(vec2(contour * 0.045, h * 0.012)) * 0.65 + vnoise(vec2(contour * 0.13, h * 0.03)) * 0.35;
  float mtn = smoothstep(200.0, 300.0, h);
  N = normalize(N + vec3(-downhill.y, 0.0, downhill.x) * (gully - 0.5) * 0.9 * mtn);
  float big = (fbm3(p * 0.0022 + vec2(3.7, 8.1)) - 0.5) * 2.0;   // 沿山脉的大尺度起伏（雪线、岩石线都跟着它）
  float rock = smoothstep(265.0 + big * 90.0 + mn * 60.0, 345.0 + big * 90.0, h + (gully - 0.5) * 60.0);
  rock = max(rock, smoothstep(0.42, 0.68, 1.0 - N.y) * smoothstep(200.0, 280.0, h));
  alb = mix(alb, uRock * (0.75 + 0.4 * mn) * (0.85 + 0.3 * gully), clamp(rock, 0.0, 1.0));
  // 雪：雪线不是一条平线——
  //   · 沿着山脉大幅起伏（几百米一个波，±100 米）；
  //   · 沟里积雪，顺着冲沟往下拖出一条条雪舌，山脊和陡壁露出岩石；
  //   · 背阴的坡留得住雪，雪线更低；边缘被打碎成一块块残雪
  float tongue = smoothstep(0.5, 0.8, gully);
  float shade = 1.0 - clamp(dot(N, uSunDir) * 1.6 + 0.2, 0.0, 1.0);
  float snowLine = 315.0 + big * 105.0 + mn * 40.0 - tongue * 130.0 + (1.0 - gully) * 45.0 - shade * 55.0;
  float patchy = (vnoise(p * 0.035 + 4.4) - 0.5) * 60.0 + (vnoise(p * 0.11) - 0.5) * 25.0;
  float snow = smoothstep(snowLine, snowLine + 14.0, h + patchy);
  snow *= smoothstep(0.3, 0.55, N.y + tongue * 0.25 + (vnoise(p * 0.06 + 9.0) - 0.5) * 0.25);
  // 雪坡上顺着坡向露出的一道道岩脊
  float rib = vnoise(vec2(contour * 0.11 + 7.7, h * 0.02));
  snow *= 1.0 - 0.85 * smoothstep(0.34, 0.2, rib) * smoothstep(0.65, 0.4, N.y + 0.2 * tongue);
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
    float bare = (1.0 - clamp(rock, 0.0, 1.0)) * (1.0 - snow);
    float meadow = (1.0 - fm) * bare;
#ifndef RING
    meadow *= 1.0 - bank;
#endif
    // 远处的明暗按真实的山形来分（不用补细节的扰动法线，否则阴影会跟着噪声变成一块块斑），
    // 分界也随距离放宽：近处是清楚的二分色，远山上是柔和的过渡
    float farL = smoothstep(120.0, 700.0, dist);
    vec3 Nl = normalize(mix(N, normalize(vN), farL));
    float softL = mix(uToonEdge.y, 0.55, smoothstep(200.0, 2000.0, dist));
    float lightT = ss * clamp(dot(Nl, uSunDir) * 1.4, 0.0, 1.0);
    float root = mix(0.55, 1.0, smoothstep(5.0, 26.0, dist));
    vec3 toon = toonGrassSoft(lightT, cs, (vnoise(p * 0.08 + 3.1) - 0.5) * 1.2, root, softL);
    // 高山草甸：同一套颜色，稍暗一些
    toon *= 1.0 - 0.2 * smoothstep(160.0, 260.0, h);
    col = mix(col, toon, uToonMix * meadow);
    // 林地（远处成片的云杉）：和近处的云杉同一套亮面 / 暗面
    float kF = smoothstep(0.35 - softL * 0.6, 0.6 + softL * 0.6, ss * clamp(dot(Nl, uSunDir) * 0.8 + 0.45, 0.0, 1.0)) * cs;
    // 远处一棵棵树冠小于一个像素，用中等尺度的一簇簇深浅代替
    float clumps = mix(crowns, vnoise(p * 0.045 + 5.1) * 0.6 + vnoise(p * 0.12) * 0.4, fSoft);
    vec3 toonF = mix(uForestShade, uForestLit, kF) * (0.7 + 0.6 * clumps);
    col = mix(col, toonF, uToonMix * fm * bare);
    // 岩石和雪也分亮面 / 暗面：受光的雪是白的，背光的雪是透着天光的蓝，岩石背光面是深一些的蓝灰
    float kM = smoothstep(0.04, 0.2 + softL * 0.4, dot(normalize(mix(N, normalize(vN), farL * 0.6)), uSunDir) * ss) * mix(1.0, cs, 0.7);
    vec3 rockT = mix(uToonShadow * 0.7, vec3(0.52, 0.53, 0.58) / uExposure * (0.85 + 0.3 * mn), kM);
    vec3 snowT = mix(uToonShadow * 1.45 + vec3(0.05, 0.08, 0.16) / uExposure, vec3(0.96, 0.97, 1.0) / uExposure, kM);
    vec3 mtnT = mix(rockT, snowT, snow);
    col = mix(col, mtnT, uToonMix * (1.0 - bare));
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
    // 三层各转一个角度，格点不会对齐
    const mat2 R2 = mat2(0.76, 0.65, -0.65, 0.76), R3 = mat2(0.45, -0.89, 0.89, 0.45);
    vec2 q1 = r * vec2(1.1, 2.0) + vec2(-uTime * 1.3, 0.0);
    vec2 q2 = R2 * (r * vec2(2.9, 4.4)) + vec2(-uTime * 2.1, uTime * 0.25);
    vec2 q3 = R3 * (r * vec2(6.5, 7.5)) + vec2(-uTime * 3.2, -uTime * 0.4);
    // 每个像素盖住多少个波纹单位：某一层波纹细到一个像素以下时就把它淡出（否则每个像素随机亮一下，像雪花屏），
    // 淡出的那部分起伏折算成更大的粗糙度——远处的碎光就合成一条柔和的光带
    // 像素盖住的范围按面积估计（斜看时被压扁的那个方向不算满），过渡放得很宽，
    // 细节是一点点淡出的，看不出“近处精细、远处平滑”的分界
    vec2 rx = dFdx(r), ry = dFdy(r);
    float fpArea = sqrt(abs(rx.x * ry.y - rx.y * ry.x));
    float fp = max(mix(fpArea, length(rx) + length(ry), 0.5), 1e-4);
    float w1 = 1.0 - smoothstep(0.08, 0.9, fp * 2.0);
    float w2 = 1.0 - smoothstep(0.08, 0.9, fp * 5.0);
    float w3 = 1.0 - smoothstep(0.08, 0.9, fp * 9.0);
    const float amp = 0.75;
    vec3 n1 = gnoiseD(q1);
    vec2 g = (n1.yz * 0.55 * w1 + transpose(R2) * gnoiseD(q2).yz * 0.3 * w2 + transpose(R3) * gnoiseD(q3).yz * 0.15 * w3) * amp;
    float smear0 = clamp(1.0 - w1, 0.0, 1.0);
    float lost = (0.3025 * (1.0 - w1 * w1) + 0.09 * (1.0 - w2 * w2) + 0.0225 * (1.0 - w3 * w3)) * amp * amp * 0.6;
    vec2 gw = vec2(${FLOW.x.toFixed(6)} * g.x + ${ACROSS.x.toFixed(6)} * g.y, ${FLOW.z.toFixed(6)} * g.x + ${ACROSS.z.toFixed(6)} * g.y);
    vec3 Nw = normalize(vec3(-gw.x, 1.0, -gw.y));

    vec3 R = reflect(-V, Nw);
    // 倒影只取地平线以上一点的天色：贴地平线那一窄条发白的天会在水面上变成一块块白斑
    R = normalize(vec3(R.x, max(abs(R.y), 0.16 + 0.08 * smear0), R.z));
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(Nw, V), 0.0), 5.0);
    vec3 wcol = uWaterColor * (0.55 + 0.45 * sv);
    // 掠射角的倒影也不要强到像镜子（否则远处的溪面整条发白）
    wcol = mix(wcol, skyColorAt(R), min(fres * uWaterRefl * 1.2, 0.55));

    // 太阳闪光：把水面看成一面起伏的粗糙镜子，先算出“能把阳光反射进眼睛”的那片区域（光斑）——
    // 用最大那层波纹的法线 + 较大的粗糙度，光斑边缘柔和、随波纹成团。
    // 光斑里密密地撒满细小的亮点（一两个像素，随机一闪一闪、顺流漂走），整体再带一层柔光，
    // 经过辉光晕开就是一片耀眼的碎光；光斑以外的水面只有零星几点。
    vec3 Hh = normalize(uSunDir + V);
    vec2 gl = n1.yz * 0.55 * amp * w1 * 0.5;   // 只取一半起伏：光斑成团但边缘柔和，不显出波纹的纹路
    vec3 Nl = normalize(vec3(-(${FLOW.x.toFixed(6)} * gl.x + ${ACROSS.x.toFixed(6)} * gl.y), 1.0, -(${FLOW.z.toFixed(6)} * gl.x + ${ACROSS.z.toFixed(6)} * gl.y)));
    float a2L = 0.32 * 0.32 + lost;
    float nhL = max(dot(Nl, Hh), 0.0);
    float ddL = nhL * nhL * (a2L - 1.0) + 1.0;
    float lobe = a2L * a2L / (ddL * ddL);            // 0..1，光斑中心 = 1
    // 远处朝着太阳方位的水面（掠射角，镜面光斑照不到）保留一点金色的光路
    float az = dot(normalize(-V.xz), normalize(uSunDir.xz + 1e-5));
    float azp = smoothstep(0.8, 1.0, az) * far * 0.55;
    float path = max(lobe, azp);
    // 亮点的格子随距离加大（每格约三个像素），两档之间平滑过渡，远近都是同样细小的亮点
    vec2 sq = vec2(along, acr) - vec2(uTime * 0.8, 0.0);
    vec2 sx = dFdx(sq), sy = dFdy(sq);
    float sfp = mix(sqrt(abs(sx.x * sy.y - sx.y * sy.x)), length(sx) + length(sy), 0.5);
    float L = log2(max(sfp * 3.0, 0.02) / 0.02);
    float l0 = floor(L), cs0 = 0.02 * exp2(l0);
    float dens = 0.012 + 0.5 * path * path;
    float spark = mix(sparkLayer(sq / cs0, dens, l0), sparkLayer(sq / (cs0 * 2.0), dens, l0 + 1.0), fract(L));
    // 颜色：光斑中心的亮点接近白（过曝），边缘和远处的光路偏金色
    vec3 gold = mix(uSunColor, uRiverGold * length(uSunColor) * 0.6, 0.9);
    vec3 sparkCol = mix(gold, uSunColor, lobe);
    wcol += (gold * (lobe * lobe * 0.12 + azp * azp * 0.06) + sparkCol * spark * (0.5 + 7.0 * path)) * sv * uGlitter;
    col = mix(col, wcol, water);
  }
#endif

  vec3 outC = applyFog(col, vWorld);
  // 高处的山体站在雾气上面：雪峰和山坡保持清楚的颜色和明暗（像插画里那样），只有山脚融进雾里
  // （区块地形和远景圈用同一个规则，两者交接处才不会出现一块颜色不同的区域）
  outC = mix(outC, mix(col, outC, 0.5), smoothstep(20.0, 420.0, h));


  gl_FragColor = vec4(outC, 1.0);
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

// 地平线远景圈：r 1300 → 3600，跟着人沿河谷移动（没有视差）
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
  // 每帧把远景圈挪到人所在处的河谷中线上（高度取那里谷底的平均高度，不随脚下的小起伏上下晃）
  mesh.userData.follow = (x, z) => {
    const u = x * FLOW.x + z * FLOW.z;
    const cx = u * FLOW.x, cz = u * FLOW.z, groundY = valleyTilt(u);
    mesh.position.set(cx, groundY, cz);
    mat.uniforms.uTexOffset.value.set(cx, cz);
    mat.uniforms.uHOffset.value = groundY;
  };
  return mesh;
}

// 湖面：一张跟着远景圈走的平面，按岸线（lakeSdf，逐顶点算好）裁出形状；
// 草甸那一段只在地面低于湖面的地方露出来（和区块地形用同一个解析高度判断，岸线稳定不闪）
const lakeVert = /* glsl */ `
attribute float aSdf;
varying vec3 vWorld;
varying vec2 vLocal;
varying float vSdf;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vLocal = position.xz;
  vSdf = aSdf;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const lakeFrag = /* glsl */ `
${COMMON}
uniform vec3 uLakeColor;
varying vec3 vWorld;
varying vec2 vLocal;
varying float vSdf;
void main() {
  if (vSdf > 0.0) discard;
  float along = alongValley(vLocal);
  float depth = vWorld.y - terrainH(vWorld.xz);
  if (along < 1900.0 && depth < 0.0) discard;
  depth = along < 1900.0 ? depth : 8.0;

  vec3 V = normalize(cameraPosition - vWorld);
  vec3 dir = -V;
  vec2 p = vLocal;
  // 远看的细碎波纹小于一个像素：统计上把倒影的角度抬高，映出来的是更蓝的天
  float n1 = vnoise(p * 0.02 + vec2(uTime * 0.05, 0.0));
  float n2 = vnoise(p * 0.07 + vec2(0.0, uTime * 0.08));
  vec3 R = normalize(vec3(dir.x, abs(dir.y) + 0.13 + 0.04 * (n1 * 0.6 + n2 * 0.4), dir.z));
  vec3 lc = mix(uLakeColor, skyColorAt(R), 0.5 * uWaterRefl);
  // 岸边的浅水透出一点青绿
  lc = mix(lc * vec3(0.9, 1.15, 1.0) + vec3(0.0, 0.03, 0.02), lc, smoothstep(0.2, 2.5, depth));
  // 湖比周围的远景通透一些，免得被雾冲成一条白线
  vec3 col = mix(applyFog(lc, vWorld), lc, 0.75);

  // 太阳在水面上的光路：朝着太阳的方位最亮，往两边散开
  float az = dot(normalize(dir.xz), normalize(uSunDir.xz + 1e-5));
  float path = smoothstep(0.78, 1.0, az);
  float sunLit = cloudShadow(vWorld.xz);
  // 碎光：以湖为参照的小格子（越远格子越长，保持三四个像素大），每格里一颗圆圆的亮点随机闪一下，
  // 朝太阳的光路上更密——远看是一片波光粼粼（不用大块的亮纹，那样会像流动的白斑）
  float r = length(p);
  vec2 cc = vec2(atan(p.y, p.x) / 0.0038, log(r) / 0.11);
  vec2 cell = floor(cc);
  float h1 = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  float h2 = fract(sin(dot(cell, vec2(269.5, 183.3))) * 43758.5453);
  vec2 off = vec2(fract(h1 * 13.1), fract(h2 * 7.7)) * 0.4 + 0.3;
  float dotm = 1.0 - smoothstep(0.12, 0.32, length(fract(cc) - off));
  float tw = fract(h1 * 7.3 + uTime * (0.4 + 0.8 * h2));
  float flash = smoothstep(0.0, 0.1, tw) * (1.0 - smoothstep(0.15, 0.45, tw));
  float spark = step(1.0 - mix(0.03, 0.14, path), h2) * flash * dotm;
  vec3 gold = mix(uSunColor, uRiverGold * length(uSunColor) * 0.6, 0.85);
  col += gold * (path * path * 0.025 + spark * (0.9 + 3.6 * path)) * uGlitter * sunLit;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createLake(U) {
  const STEP = 25;
  const u0 = LAKE.u0 - 100, u1 = LAKE.u1 + 300, v1 = LAKE.half * 1.6;
  const nu = Math.ceil((u1 - u0) / STEP), nv = Math.ceil((2 * v1) / STEP);
  const pos = [], sdf = [], idx = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = u0 + i * STEP, v = -v1 + j * STEP;
      pos.push(u * FLOW.x + v * ACROSS.x, LAKE.level, u * FLOW.z + v * ACROSS.z);
      sdf.push(lakeSdf(u, v));
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      if (Math.min(sdf[a], sdf[b], sdf[c], sdf[d]) > STEP) continue;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aSdf', new THREE.Float32BufferAttribute(sdf, 1));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: lakeVert,
    fragmentShader: lakeFrag,
    side: THREE.DoubleSide,
    polygonOffset: true,      // 和岸边几乎贴平的地面之间不打架
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.userData.follow = (x, z) => {
    const u = x * FLOW.x + z * FLOW.z;
    mesh.position.set(u * FLOW.x, valleyTilt(u), u * FLOW.z);
  };
  return mesh;
}
