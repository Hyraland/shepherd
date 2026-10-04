import * as THREE from 'three';
import { COMMON } from './shaders.js';

// 插画风的羊：和草地用同一套受光量（太阳朝向 × 云影 × 投影），按分界切成亮面 / 暗面两种“光色”，
// 再乘上羊自己的颜色（贴图可以调得更平）。没有镜面反射；
// 毛绒感来自贴图明暗做的凹凸；边缘亮光只出现在受光的一侧。

let U = null;
let tuning = null;
export function initSheepShading(sharedUniforms, t) {
  U = sharedUniforms;
  tuning = t;
}
export const sheepToonEnabled = () => tuning?.sheep.toon ?? true;

// 低头 / 转头：不是把头单独转开（那样脖子处会裂开），而是每个顶点按权重混合——
// 从肩膀到头，权重从 0 平滑地升到 1，脖子一带被拉伸、弯曲，头和身体始终连在一起
export const NECK_GLSL = /* glsl */ `
vec3 neckBend(vec3 p, inout vec3 nrm, vec2 head, vec3 pivot, vec4 neck) {
  float w = smoothstep(neck.x, neck.y, p.z) * smoothstep(neck.z, neck.w, p.y);
  if (w <= 0.0) return p;
  float cp = cos(head.x), sp = sin(head.x), cy = cos(head.y), sy = sin(head.y);
  mat3 R = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy) * mat3(1.0, 0.0, 0.0, 0.0, cp, sp, 0.0, -sp, cp);
  nrm = normalize(mix(nrm, R * nrm, w));
  return mix(p, R * (p - pivot) + pivot, w);
}
`;

const vert = /* glsl */ `
#ifdef GAIT
attribute vec2 aGait;
uniform float uHip;
#endif
#ifdef NECK
attribute vec2 aHead;
uniform vec3 uPivot;
uniform vec4 uNeck;
${NECK_GLSL}
#endif
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWorld;
varying float vTint;

void main() {
  vec3 p = position;
  vec3 nrm = normal;
#ifdef GAIT
  {
    // 腿的摆动：髋部以下绕髋部高度的横轴转动，对角线两条腿同相
    float w = smoothstep(uHip, uHip - 0.12, p.y);
    if (w > 0.0 && aGait.y > 0.0) {
      bool front = p.z > 0.0;
      bool left = p.x > 0.0;
      float a = sin(aGait.x + (front == left ? 0.0 : 3.14159)) * aGait.y * w;
      float dy = p.y - uHip;
      p.y = uHip + dy * cos(a);
      p.z += dy * sin(a);
    }
  }
#endif
#ifdef NECK
  p = neckBend(p, nrm, aHead, uPivot, uNeck);
#endif
  mat4 im = mat4(1.0);
#ifdef USE_INSTANCING
  im = instanceMatrix;
#endif
  vec4 wp = modelMatrix * im * vec4(p, 1.0);
  vN = normalize(mat3(modelMatrix * im) * nrm);
  vUv = uv;
  vWorld = wp.xyz;
#ifdef USE_INSTANCING_COLOR
  vTint = instanceColor.r;
#else
  vTint = 1.0;
#endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const frag = /* glsl */ `
${COMMON}
uniform vec3 uBaseColor;
uniform vec3 uSheepLight;
uniform vec3 uSheepShadow;
uniform vec2 uSheepEdge;
uniform float uSheepTex;
uniform float uSheepFuzz;
uniform float uSheepRim;
uniform float uSheepGain;
uniform float uSheepHi;
#ifdef HAS_MAP
uniform sampler2D map;
#endif
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWorld;
varying float vTint;

// 白羊毛的贴图大约是这个亮度；除掉它，亮面颜色就是“阳光下白羊毛看起来的颜色”
const float WOOL_GAIN = 1.35;

void main() {
#ifdef HAS_MAP
  vec3 tex = texture2D(map, vUv).rgb;
  vec3 flatC = textureLod(map, vUv, 5.0).rgb;   // 很模糊的一级 mipmap = 平涂的底色
#else
  vec3 tex = vec3(1.0);
  vec3 flatC = vec3(1.0);
#endif
  vec3 alb = mix(flatC, tex, uSheepTex) * uBaseColor * vTint;

  // 毛绒凹凸：用贴图的明暗当高度，按屏幕导数扰动法线
  vec3 N0 = normalize(vN);
  if (!gl_FrontFacing) N0 = -N0;
#ifdef HAS_MAP
  float hgt = dot(textureLod(map, vUv, 2.5).rgb, vec3(0.3333));
#else
  float hgt = 0.0;
#endif
  vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
  vec3 r1 = cross(dpy, N0), r2 = cross(N0, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dFdx(hgt) * r1 + dFdy(hgt) * r2);
  // 只在近处起作用：远了贴图的细节小于一个像素，导数凹凸只会变成噪点
  float near = 1.0 - smoothstep(2.0, 6.0, length(cameraPosition - vWorld));
  vec3 N = normalize(abs(det) * N0 - uSheepFuzz * 0.1 * near * grad);

  // 受光量：柔和的朝向 × 投影 —— 和草地同一个来源；云影是介于亮暗之间的一层
  // （投影取样点沿法线外移一段，避免羊身上自己挡自己出现的麻点）
  float ss = sunShadow(vWorld + N0 * 0.22 + uSunDir * 0.08);
  float lightT = ss * clamp(dot(N, uSunDir) * 0.6 + 0.4, 0.0, 1.0);
  float k = smoothstep(uSheepEdge.x - uSheepEdge.y, uSheepEdge.x + uSheepEdge.y, lightT) * cloudShadow(vWorld.xz);
  vec3 col = alb * mix(uSheepShadow, uSheepLight, k) * WOOL_GAIN * uSheepGain;

  // 正对太阳的地方再提亮一些，接近过曝的白
  float facing = pow(max(dot(N, uSunDir), 0.0), 2.0);
  col += uSheepLight * facing * uSheepHi * k * 1.2;

  // 受光一侧的边缘亮光
  vec3 V = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += uSheepLight * alb * rim * uSheepRim * k;

  gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
}
`;

export function makeSheepMaterial({ map, color, side, hip, neck }) {
  const defines = {};
  if (map) defines.HAS_MAP = '';
  if (hip != null) defines.GAIT = '';
  if (neck) defines.NECK = '';
  return new THREE.ShaderMaterial({
    uniforms: {
      ...U,
      map: { value: map || null },
      uBaseColor: { value: (color || new THREE.Color(1, 1, 1)).clone() },
      uHip: { value: hip ?? 0 },
      uPivot: { value: neck ? neck.pivot.clone() : new THREE.Vector3() },
      uNeck: { value: neck ? neck.range.clone() : new THREE.Vector4() },
    },
    defines,
    vertexShader: vert,
    fragmentShader: frag,
    side: side ?? THREE.FrontSide,
  });
}
