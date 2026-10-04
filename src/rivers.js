import { VALLEY_DIR } from './config.js';
import { vnoiseTex } from './noiseTexture.js';

// 草甸上蜿蜒的溪流：几条小河从东边流来，穿过草甸，向西（太阳的方向）流去，河谷有多长它们就有多长。
// 每条河的横向位置还会以几公里为周期慢慢漂移，所以它们时而靠拢、时而分开。
// 每条河的中线是沿流向的一串正弦叠加，到中线的距离用解析式近似：
//   d ≈ |v − c(u)| / √(1 + c′(u)²)
// 同一套参数同时生成 JS 版（羊群避水）和 GLSL 版（地面画水、草地让出河道）。

export const FLOW = { x: VALLEY_DIR.x, z: VALLEY_DIR.z }; // 流向：顺河谷向西
export const ACROSS = { x: -FLOW.z, z: FLOW.x };

// v0: 横向位置；w: 平均半宽（米，沿河会忽宽忽窄）；m: [振幅, 频率, 相位] × 3，从大弯到小弯
export const RIVERS = [
  { v0: -72, w: 1.5, m: [[38, 0.0105, 0.4], [9, 0.047, 1.9], [2.6, 0.15, 0.7]] },
  { v0: 14, w: 2.1, m: [[44, 0.0092, 2.2], [11, 0.041, 0.3], [3.0, 0.13, 2.6]] },
  { v0: 98, w: 1.2, m: [[30, 0.0118, 4.1], [8, 0.052, 3.3], [2.2, 0.17, 1.2]] },
];

// 横向的慢漂移：[振幅, 频率, 相位]
const DRIFT = [[34, 0.0011, 0.0], [28, 0.0009, 2.1], [30, 0.0013, 4.0]];

// 返回最近一条河的 { d: 到岸边的距离（负数 = 在水里）, w: 半宽, side: 在中线哪一侧 }
const out = { d: 1e9, w: 1, side: 1, ax: 0, az: 0 };
export function riverInfo(x, z) {
  const u = x * FLOW.x + z * FLOW.z;
  const v = x * ACROSS.x + z * ACROSS.z;
  out.d = 1e9;
  for (let i = 0; i < RIVERS.length; i++) {
    const r = RIVERS[i];
    const [da, df, dp] = DRIFT[i];
    let c = r.v0 + da * Math.sin(u * df + dp), dc = da * df * Math.cos(u * df + dp);
    for (const [a, f, p] of r.m) {
      c += a * Math.sin(u * f + p);
      dc += a * f * Math.cos(u * f + p);
    }
    const w = r.w * (0.7 + 0.6 * vnoiseTex(u * 0.04, i * 7));
    const d = Math.abs(v - c) / Math.sqrt(1 + dc * dc) - w;
    if (d < out.d) {
      out.d = d;
      out.w = w;
      out.side = v >= c ? 1 : -1;
    }
  }
  // 岸线不规则
  out.d += (vnoiseTex(x * 0.7, z * 0.7) - 0.5) * 0.5 + (vnoiseTex(x * 2.3, z * 2.3) - 0.5) * 0.18;
  // 离开河道的方向（横向）
  out.ax = ACROSS.x * out.side;
  out.az = ACROSS.z * out.side;
  return out;
}

const f = (n) => n.toFixed(5);

export const RIVER_GLSL = /* glsl */ `
// 沿流向 / 横跨河谷的坐标
float alongValley(vec2 p) { return dot(p, vec2(${f(FLOW.x)}, ${f(FLOW.z)})); }
float acrossValley(vec2 p) { return dot(p, vec2(${f(ACROSS.x)}, ${f(ACROSS.z)})); }

// 到最近河岸的距离（负数 = 水里），rw 返回该河的半宽
float riverDist(vec2 p, out float rw) {
  float u = dot(p, vec2(${f(FLOW.x)}, ${f(FLOW.z)}));
  float v = dot(p, vec2(${f(ACROSS.x)}, ${f(ACROSS.z)}));
  float best = 1e9;
  rw = 1.0;
  float c, dc, w, d;
${RIVERS.map((r, i) => `
  c = ${f(r.v0)} + ${f(DRIFT[i][0])} * sin(u * ${f(DRIFT[i][1])} + ${f(DRIFT[i][2])});
  dc = ${f(DRIFT[i][0] * DRIFT[i][1])} * cos(u * ${f(DRIFT[i][1])} + ${f(DRIFT[i][2])});
${r.m.map(([a, fr, p]) => `  c += ${f(a)} * sin(u * ${f(fr)} + ${f(p)});
  dc += ${f(a * fr)} * cos(u * ${f(fr)} + ${f(p)});`).join('\n')}
  w = ${f(r.w)} * (0.7 + 0.6 * vnoise(vec2(u * 0.04, ${f(i * 7)})));
  d = abs(v - c) * inversesqrt(1.0 + dc * dc) - w;
  if (d < best) { best = d; rw = w; }`).join('\n')}
  // 岸线的细小曲折：远到小于一个像素时逐渐抹平，否则岸边会变成一排锯齿
  float cd = length(p - cameraPosition.xz);
  best += (vnoise(p * 0.7) - 0.5) * 0.5 * (1.0 - smoothstep(60.0, 220.0, cd))
        + (vnoise(p * 2.3) - 0.5) * 0.18 * (1.0 - smoothstep(20.0, 70.0, cd));
  return best;
}

// 岸边露出泥土的宽度（米）：大多很窄，偶尔有一小片被踩出来的泥滩
float bankWidth(vec2 p) {
  return 0.12 + 0.35 * vnoise(p * 0.5) + 0.7 * smoothstep(0.72, 0.9, vnoise(p * 0.12 + 21.0));
}
`;
