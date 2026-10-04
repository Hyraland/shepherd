// 草、地面、天空、羊共用的 GLSL：噪声、地形高度、草地底色、溪流、林地、阵风、云影、日照阴影与空气透视。
import { RIVER_GLSL } from './rivers.js';

// 噪声都从预烘的纹理里读（见 noiseTexture.js），一格 = 1 个噪声单位，32 格一循环
export const NOISE = /* glsl */ `
uniform sampler2D uNoise;

float vnoise(vec2 p) {
  return texture(uNoise, p * (1.0 / 32.0)).r;
}

// 带导数的梯度噪声（每个格点一个随机方向，取自噪声纹理里的格点值），返回 (值, ∂/∂x, ∂/∂y)。
// 导数处处连续，格点处也不平坦，用来算水面波纹的法线时不会出现方块状的高光
vec2 ngrad(vec2 c) {
  ivec2 t = ivec2(mod(c, 32.0)) * 8;
  float a = texelFetch(uNoise, t, 0).r * 6.2831853;
  return vec2(cos(a), sin(a));
}
vec3 gnoiseD(vec2 p) {
  vec2 i = floor(p), f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 ga = ngrad(i), gb = ngrad(i + vec2(1.0, 0.0)), gc = ngrad(i + vec2(0.0, 1.0)), gd = ngrad(i + vec2(1.0, 1.0));
  float va = dot(ga, f), vb = dot(gb, f - vec2(1.0, 0.0)), vc = dot(gc, f - vec2(0.0, 1.0)), vd = dot(gd, f - vec2(1.0, 1.0));
  float k = va - vb - vc + vd;
  return vec3(va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k,
              ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) + du * (u.yx * k + vec2(vb, vc) - va));
}

float fbm3(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(17.13, 9.71);
    a *= 0.5;
  }
  return s / 0.875;
}
`;

// 头顶飘过的云投下的影子：返回直射阳光剩下的比例（1 = 没有云）。需要 uTime。
// uCloud：x 覆盖多少、y 浓淡、z 边缘柔和、w 飘动速度（面板可调）
export const CLOUD = /* glsl */ `
uniform vec4 uCloud;
float cloudMaskAt(float n) {
  float thr = mix(0.74, 0.4, uCloud.x);
  return smoothstep(thr, thr + 0.015 + 0.2 * uCloud.z, n);
}
float cloudShadow(vec2 p) {
  float n = fbm3(p * 0.0075 - vec2(0.014, -0.004) * uTime * uCloud.w);
  return 1.0 - uCloud.y * cloudMaskAt(n);
}
`;

// 地面上画出来的野花（只能用在片元着色器里，要用 fwidth）：把地面分成旋转过的小格，每格里随机撒一朵
// （位置、大小、颜色都随机），看不出网格；cover 是这里有花的概率。远处一个像素里好几朵花时，用平均覆盖率代替，免得闪烁
export const WILDFLOWERS = /* glsl */ `
float wildflowers(vec2 w, float cover, float hueField, out vec3 color) {
  const mat2 R = mat2(0.8, -0.6, 0.6, 0.8);
  vec2 p = R * w / 0.45;                                    // 每格约 45 厘米
  vec2 cell = floor(p), f = fract(p);
  float best = 0.0;
  color = flowerColor(hueField);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      vec3 r = fl_hash3(c);
      if (r.z > cover) continue;
      vec2 d = vec2(float(i), float(j)) + r.xy - f;
      float rad = 0.12 + 0.1 * fract(r.z * 7.13);
      float px = fwidth(p.x) + 1e-4;
      float a = 1.0 - smoothstep(rad - px, rad + px, length(d));
      if (a > best) {
        best = a;
        color = flowerColor(hueField + (fract(r.z * 13.7) - 0.5) * 0.6) * (0.8 + 0.4 * fract(r.x * 31.7));
      }
    }
  }
  float far = smoothstep(0.35, 1.2, fwidth(p.x));
  return mix(best, cover * 0.12, far);
}
`;

export const COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;
uniform vec3 uGroundAmb;
uniform vec3 uFogColor;
uniform vec3 uHaze;
uniform vec3 uRiverGold;
uniform float uFogDensity;
uniform vec3 uGrassDeep;
uniform vec3 uGrassLight;
uniform vec3 uGrassDry;
uniform vec3 uGrassTip;
uniform vec3 uTransl;
uniform vec2 uWind;
uniform vec3 uZenith;
uniform vec3 uForest;
uniform vec3 uForestLit;
uniform vec3 uForestShade;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowOn;
uniform float uShadowTexel;
uniform float uToonMix;     // 0 = 写实光照，1 = 二分色
uniform vec3 uToonLight;
uniform vec3 uToonLightDeep;
uniform vec3 uToonShadow;
uniform vec2 uToonEdge;     // x: 明暗分界位置，y: 分界的柔和度
uniform float uToonVar;     // 颜色变化的幅度
uniform vec3 uWaterColor;
uniform float uWaterRefl;
uniform float uRipple;
uniform float uGlitter;
uniform float uFlowers;
uniform float uGrassHues;   // 草叶里“藏”的杂色有多少（见 grass.js）
uniform float uForestHues;  // 云杉枝片里藏的杂色（见 scenery.js）
uniform float uSkyBand;
uniform float uHazeLift;
uniform float uExposure;

#include <packing>
${NOISE}
${CLOUD}
${RIVER_GLSL}

// 与 noise.js 的 valleyTilt / nearHeight 保持一致
float valleyTilt(float u) {
  return -0.03 * u;
}

float terrainH(vec2 p) {
  float x = p.x;
  float z = p.y;
  return 7.0 * sin(x * 0.012 + 0.6) * cos(z * 0.010 - 0.4)
       + 4.0 * sin((x * 0.8 + z * 0.6) * 0.021 + 1.3)
       + 2.2 * sin((-x * 0.5 + z * 0.87) * 0.037 + 2.1)
       + 0.9 * sin((x * 0.95 + z * 0.31) * 0.071 + 0.4)
       + 0.35 * sin((x * 0.2 - z * 0.98) * 0.13 + 3.0)
       + valleyTilt(x * -0.892036 + z * 0.451965);
}

vec3 fieldColor(vec2 p) {
  float n1 = fbm3(p * 0.012);
  vec3 c = mix(uGrassDeep, uGrassLight, smoothstep(0.3, 0.75, n1));
  float dry = smoothstep(0.6, 0.82, fbm3(p * 0.007 + 7.0));
  c = mix(c, uGrassDry, dry * 0.4);
  c *= 0.92 + 0.16 * vnoise(p * 0.08 + 3.1);
  return c;
}

// 林地：与 scenery.js 里种树用的是同一张噪声（fbm3Tex），树和深色的林下地面对得上
float forestMask(vec2 p, float across) {
  float hills = smoothstep(170.0, 320.0, abs(across));
  float n = fbm3(p * 0.006 + vec2(11.0, 3.0));
  // 谷底（人能走到的地方）保持开阔，林子从两边的坡脚开始
  return smoothstep(0.5, 0.56, n + hills * 0.08 - (1.0 - hills) * 0.06) * smoothstep(170.0, 190.0, abs(across));
}

// 远处（没有种树的地方）的林地：边缘放宽、再用噪声打散，像一片片参差的林缘，而不是刀切的色块
float forestMaskFar(vec2 p, float across, float soft, float h) {
  float hills = smoothstep(170.0, 320.0, abs(across));
  float n = fbm3(p * 0.006 + vec2(11.0, 3.0)) + (vnoise(p * 0.035 + 2.7) - 0.5) * 0.12 * soft + (vnoise(p * 0.11) - 0.5) * 0.05 * soft;
  // 谷底中间不长树的那条带子只管低处的谷底；到了山坡上（比如河谷尽头的山）就不再有这条限制，否则会竖着留出一条空带
  float open = max(smoothstep(170.0, 190.0 + 60.0 * soft, abs(across)), smoothstep(30.0, 120.0, h));
  float valley = max(hills, smoothstep(30.0, 120.0, h));
  return smoothstep(0.5 - 0.04 * soft, 0.56 + 0.04 * soft, n + valley * 0.08 - (1.0 - valley) * 0.06) * open;
}

// 阵风：一团团顺风飘过的强风区（草被压弯、反光变亮）
float gustAt(vec2 p) {
  vec2 q = p - uWind * uTime * 4.5;
  float g1 = vnoise(q * 0.045 + vec2(0.0, uTime * 0.06));
  float g2 = vnoise(q * 0.12 + vec2(uTime * 0.1, 3.7));
  return smoothstep(0.38, 0.8, g1 * 0.7 + g2 * 0.3);
}

// 草叶用的省时版本：少几次纹理读取，远看和完整版几乎一样
vec3 fieldColorFast(vec2 p) {
  vec3 c = mix(uGrassDeep, uGrassLight, smoothstep(0.3, 0.75, vnoise(p * 0.012) * 0.7 + vnoise(p * 0.03 + 5.0) * 0.3));
  c = mix(c, uGrassDry, smoothstep(0.6, 0.82, vnoise(p * 0.007 + 7.0)) * 0.4);
  return c;
}
float cloudShadowFast(vec2 p) {
  vec2 q = p * 0.0075 - vec2(0.014, -0.004) * uTime * uCloud.w;
  float n = (vnoise(q) * 0.5 + vnoise(q * 2.03 + vec2(17.13, 9.71)) * 0.25) / 0.75;
  return 1.0 - uCloud.y * cloudMaskAt(n);
}

// 太阳的投影阴影（羊落在草上和地上的影子），5 点 PCF
float sunShadow(vec3 wp) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 sc = uShadowMatrix * vec4(wp, 1.0);
  vec3 c = sc.xyz / sc.w;
  if (c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0) return 1.0;
  float z = c.z - 0.0006;
  float t = uShadowTexel * 1.5;
  float s = step(z, unpackRGBAToDepth(texture(uShadowMap, c.xy)))
          + step(z, unpackRGBAToDepth(texture(uShadowMap, c.xy + vec2(t, 0.0))))
          + step(z, unpackRGBAToDepth(texture(uShadowMap, c.xy - vec2(t, 0.0))))
          + step(z, unpackRGBAToDepth(texture(uShadowMap, c.xy + vec2(0.0, t))))
          + step(z, unpackRGBAToDepth(texture(uShadowMap, c.xy - vec2(0.0, t))));
  return s / 5.0;
}

// 单点采样版本，给每帧要算几百万个顶点的草叶用
float sunShadowFast(vec3 wp) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 sc = uShadowMatrix * vec4(wp, 1.0);
  vec3 c = sc.xyz / sc.w;
  if (c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0) return 1.0;
  return step(c.z - 0.0006, unpackRGBAToDepth(texture(uShadowMap, c.xy)));
}

// 二分色（三渲二）的草：
//   light 是 0–1 的受光量（朝向 × 投影，不含云），按分界线切成亮面 / 暗面；
//   cloud 是云影剩下的阳光（1 = 没有云）：云影不是一刀切的暗面，而是介于亮暗之间的一层；
//   亮面里的叶根和深一些的草丛用「亮面深色」，vary 是局部深浅（-1–1），root 是叶根到叶尖（0–1）
// soft：明暗分界的柔和度（近处就是面板里的值；远山上会放宽，见 terrain.js）
vec3 toonGrassSoft(float light, float cloud, float vary, float root, float soft) {
  float k = smoothstep(uToonEdge.x - soft, uToonEdge.x + soft, light) * cloud;
  float deep = clamp((1.0 - root) * 0.9 - vary * 0.45, 0.0, 1.0) * uToonVar * 1.6;
  vec3 lit = mix(uToonLight, uToonLightDeep, clamp(deep, 0.0, 1.0));
  vec3 shade = uToonShadow * (1.0 + uToonVar * (vary * 0.3 + (root - 1.0) * 0.45));
  return mix(shade, lit, k);
}
vec3 toonGrass(float light, float cloud, float vary, float root) {
  return toonGrassSoft(light, cloud, vary, root, uToonEdge.y);
}

// 天空的颜色（天空球和水面倒影共用）：地平线上一窄条浅色，往上很快变成深蓝；
// 贴着地平线还有一道大气层边缘的亮线。uZenith / uFogColor 已经按曝光换算过
vec3 skyColorAt(vec3 d) {
  float el = asin(clamp(d.y, -1.0, 1.0));
  float t = clamp(el / max(uSkyBand, 0.02), 0.0, 1.0);
  vec3 col = mix(uFogColor, uZenith, pow(t, 0.5));
  col += (uFogColor * 0.15 + vec3(0.04, 0.05, 0.06)) * exp(-max(el, 0.0) / 0.006);
  return el < 0.0 ? uFogColor : col;
}

// 野花的颜色和花丛分布（地面、近处的花共用）
vec3 fl_hash3(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.xxy + q.yzz) * q.zyx);
}
vec3 flowerColor(float hue) {
  return hue < 0.46 ? vec3(0.9, 0.62, 0.06)          // 黄：毛茛、金莲花
       : hue < 0.62 ? vec3(0.88, 0.88, 0.82)         // 白：蓍草
       : hue < 0.8 ? vec3(0.42, 0.24, 0.66)          // 紫：草原老鹳草
       : vec3(0.72, 0.1, 0.06);                      // 红：野罂粟 / 虞美人（少一些）
}
float flowerCover(vec2 w) {
  float clump = vnoise(w * 0.06 + 2.0) * 0.55 + vnoise(w * 0.17 + 7.0) * 0.3 + vnoise(w * 0.6) * 0.15;
  return smoothstep(0.62 - 0.22 * uFlowers, 0.74 - 0.18 * uFlowers, clump) * min(1.0, uFlowers * 1.4);
}
// 天光：上面是蓝天，下面是草地反射的绿
vec3 ambient(vec3 N) {
  return mix(uGroundAmb, uSkyAmb, N.y * 0.5 + 0.5);
}

// 空气透视：远处融进地平线的浅蓝；朝太阳的方向稍微发白
vec3 applyFog(vec3 col, vec3 wp) {
  vec3 v = wp - cameraPosition;
  float d = length(v);
  // 雾气贴着谷底更浓，山顶更通透（uHazeLift 越大，雾气升得越高，远山越淡）
  float f = 1.0 - exp(-pow(d * uFogDensity, 2.0) * exp(-max(wp.y, 0.0) / uHazeLift));
  vec3 dir = v / max(d, 1e-3);
  float s = pow(max(dot(normalize(vec3(dir.x, 0.0, dir.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 3.0);
  return mix(col, mix(uFogColor, uHaze / uExposure, s * 0.35), f);
}
`;
