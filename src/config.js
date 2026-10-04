import * as THREE from 'three';
import { noiseTexture } from './noiseTexture.js';

// 河谷的走向（顺流向西）。固定不变：调太阳方向不会让河谷跟着转
export const VALLEY_DIR = { x: -0.892036, z: 0.451965 };

// 太阳方向：由面板里的高度角 / 方位角算出来，原地更新（各处引用的都是这同一个向量）
// 默认：午后的太阳挂在西南偏西，正对河谷向西敞开的方向
export const SUN_DIR = new THREE.Vector3(-0.75, 0.43, 0.38).normalize();
export function sunFromAngles(elevationDeg, azimuthDeg, out = SUN_DIR) {
  const e = THREE.MathUtils.degToRad(elevationDeg), a = THREE.MathUtils.degToRad(azimuthDeg);
  const hx = VALLEY_DIR.x * Math.cos(a) - VALLEY_DIR.z * Math.sin(a);
  const hz = VALLEY_DIR.x * Math.sin(a) + VALLEY_DIR.z * Math.cos(a);
  return out.set(hx * Math.cos(e), Math.sin(e), hz * Math.cos(e)).normalize();
}

// 曝光和云影参数：几个模块（后期、three 自带材质的云影补丁）直接共用这些 uniform 对象
export const exposureUniform = { value: 1.3 };
export const cloudUniform = { value: new THREE.Vector4(0.5, 0.92, 0.3, 1) }; // 覆盖、浓淡、边缘柔和、飘动速度
export const bloomUniform = { value: 0.35 };

// 自定义着色器里用的是“辐照度/π”的量纲；three 的灯光强度 = 这里的值 × π
export const SUN_RADIANCE = 2.2;
export const SKY_RADIANCE = 0.6;
export const GROUND_RADIANCE = 0.22;

export const MAX_SHEEP = 50;
export const START_SHEEP = 8;
export const WALK_SPEED = 1.1; // m/s
export const FOG_DENSITY = 0.00042;
export const EXPOSURE = 1.3; // 默认曝光（面板里可调）：偏亮，阳光下的羊毛接近过曝

// 可调参数的默认值（开发面板里调，调好后存进项目的 tuning.json，启动时以它为准）
export const TUNING_DEFAULTS = {
  grass: {
    toon: true,             // false = 写实光照
    light: '#a2b64e',       // 亮面
    lightDeep: '#7c9136',   // 亮面里的深色：叶根、颜色深一些的草丛
    shadow: '#3f5e2d',      // 暗面
    edge: 0.35,             // 明暗分界位置（受光量 0–1）
    softness: 0.06,         // 分界的柔和度
    variation: 0.5,         // 每丛深浅、叶根到叶尖的变化
    flowers: 0.4,           // 野花的多少（0 = 没有）
  },
  sheep: {
    toon: true,             // false = 写实材质
    light: '#fbf3e4',       // 亮面：阳光下白羊毛看起来的颜色
    shadow: '#97a395',      // 暗面：阴影里白羊毛看起来的颜色
    followGrass: 0.3,       // 暗面向草地暗面的色相靠拢多少
    edge: 0.42,
    softness: 0.2,
    texture: 0.55,          // 贴图细节（0 = 平涂，1 = 原贴图）
    fuzz: 0.3,              // 毛绒的凹凸感（只在近处）
    rim: 0.25,              // 受光一侧的边缘亮光
    brightness: 1.0,        // 整体亮度
    highlight: 0.3,         // 正对太阳的部分额外提亮（接近过曝的白）
  },
  sky: {
    elevation: 27,          // 太阳高度角（度）
    azimuth: 0,             // 太阳方位（度，0 = 顺着河谷向下游/西边，正值往北转）
    sun: 2.2,               // 阳光强度
    skyLight: 0.6,          // 天光（阴影里的亮度）
    zenith: '#2a66bd',      // 天顶颜色（屏幕上看到的颜色，不受曝光影响）
    horizon: '#c2d8ee',     // 地平线颜色（远处的雾也是这个颜色）
    band: 0.32,             // 地平线浅色带的高度（越小，蓝色越往下压）
    haze: 0.5,              // 空气中的雾气：远山被冲淡成蓝白色的程度
    exposure: 1.3,          // 曝光（只影响写实着色的部分：水、林子、山体；草和羊的颜色不受它影响）
    bloom: 0.35,            // 强光（水面闪光、日轮）的辉光
    cloudCover: 0.5,        // 云影覆盖的多少
    cloudStrength: 0.6,     // 云影的浓淡（1 = 和投影一样暗）
    cloudSoftness: 0.3,     // 云影边缘的柔和
    cloudSpeed: 1,          // 云飘动的速度
  },
  water: {
    color: '#1d3a44',       // 水本身的颜色（偏深，才显得出倒影和闪光）
    reflection: 0.85,       // 天空倒影的强度
    ripple: 1.0,            // 波纹的细碎程度
    glitter: 1.0,           // 阳光闪光的强度
    glitterColor: '#ffe2a8',// 闪光的颜色（远处朝太阳的河段会泛这个颜色）
    lake: '#2f6fae',        // 远处湖水的颜色（再叠上天空倒影和金色的碎光）
  },
  sound: {                  // 音量（0 = 静音）
    master: 0.8,
    wind: 0.19,
    water: 0.8,
    sheep: 0.8,
    bees: 0.7,
    birds: 0.5,
  },
};

// 面板里的预设：只覆盖列出来的项，其余（比如羊）保持不变
export const TUNING_PRESETS = {
  '原野（参考 earth_history 的结尾）': {
    grass: { light: '#a9b95c', lightDeep: '#7f8f42', shadow: '#5a678c', variation: 0.4, flowers: 0.45 },
    sky: {
      elevation: 24, azimuth: 0, sun: 2.4, skyLight: 0.6, zenith: '#2a66bd', horizon: '#c2d8ee',
      band: 0.32, haze: 0.55, exposure: 1.15, bloom: 0.35,
    },
    water: { color: '#1d3a44', reflection: 0.85, ripple: 1.0, glitter: 1.0, glitterColor: '#ffe2a8', lake: '#2f6fae' },
  },
  '我上一版调的': {
    grass: { toon: true, light: '#c7ea66', lightDeep: '#4c66a4', shadow: '#5c69a3', edge: 0.05, softness: 0.045, variation: 0.35, flowers: 0 },
    sky: {
      elevation: 28.5, azimuth: 1, sun: 3.75, skyLight: 0.6, zenith: '#0056b3', horizon: '#5681c8', exposure: 2.2,
      cloudCover: 0.26, cloudStrength: 0.35, cloudSoftness: 1, cloudSpeed: 0.65,
    },
  },
};

// 面板里选的是“屏幕上看到的颜色”：转成线性值并抵消曝光，这样色调映射之后正好是选中的颜色
export function screenColor(hex, out = new THREE.Color()) {
  return out.set(hex).multiplyScalar(1 / exposureUniform.value);
}

const c = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);

export const PALETTE = {
  sun: '#fff5e6',
  sky: '#9bbce6',
  ground: '#728450',
  fog: '#a9cbee',
  zenith: '#1f5cc9',
  sunGlow: '#fff4e2',
};

// 所有自定义着色器共用的 uniform（对象共享引用，改一处处处生效）
export function createSharedUniforms() {
  return {
    uNoise: { value: noiseTexture() },
    uTime: { value: 45 }, // 云影的起始位置：一进来正好站在阳光里
    uSunDir: { value: SUN_DIR.clone() },
    uSunColor: { value: c(PALETTE.sun, SUN_RADIANCE) },
    uSkyAmb: { value: c(PALETTE.sky, SKY_RADIANCE) },
    uGroundAmb: { value: c(PALETTE.ground, GROUND_RADIANCE) },
    uFogColor: { value: c(PALETTE.fog) },
    uHaze: { value: c('#eef2f2') }, // 朝太阳方向的远景：被照透的、偏白的薄雾
    uRiverGold: { value: c('#ffae38') }, // 远处的溪流反射阳光的金色
    uFogDensity: { value: FOG_DENSITY },
    uGrassDeep: { value: c('#4d7036') },
    uGrassLight: { value: c('#829c50') },
    uGrassDry: { value: c('#a29e6c') },
    uGrassTip: { value: c('#a0b26a') },
    uTransl: { value: c('#d4de92', 0.45) },
    uWind: { value: new THREE.Vector2(1, -0.3).normalize() },
    uCenter: { value: new THREE.Vector3() },
    uRock: { value: c('#8a8c98') },
    uSnow: { value: c('#f4f7ff') },
    uAlpine: { value: c('#64804c') },
    uForest: { value: c('#22352b') },
    uForestLit: { value: new THREE.Color() },   // 二分色的云杉：亮面 / 暗面（由草地的颜色推出来，见 applyTuning）
    uForestShade: { value: new THREE.Color() },
    uZenith: { value: c(PALETTE.zenith) },
    uShadowMap: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowOn: { value: 0 },
    uShadowTexel: { value: 1 / 2048 },
    // 以下由 applyTuning 填值
    uToonMix: { value: 1 },
    uToonLight: { value: new THREE.Color() },
    uToonLightDeep: { value: new THREE.Color() },
    uToonShadow: { value: new THREE.Color() },
    uToonEdge: { value: new THREE.Vector2() },
    uToonVar: { value: 0.5 },
    uSheepLight: { value: new THREE.Color() },
    uSheepShadow: { value: new THREE.Color() },
    uSheepEdge: { value: new THREE.Vector2() },
    uSheepTex: { value: 0.5 },
    uSheepFuzz: { value: 0.5 },
    uSheepRim: { value: 0.25 },
    uSheepGain: { value: 1 },
    uSheepHi: { value: 0.3 },
    uCloud: cloudUniform,
    uWaterColor: { value: new THREE.Color() },
    uLakeColor: { value: new THREE.Color() },
    uWaterRefl: { value: 0.85 },
    uRipple: { value: 1 },
    uGlitter: { value: 1 },
    uFlowers: { value: 0.4 },
    uSkyBand: { value: 0.2 },
    uHazeLift: { value: 400 },
    uExposure: exposureUniform,
  };
}

// 把可调参数写进 uniform
const _a = new THREE.Color(), _b = new THREE.Color();
export function applyTuning(U, t) {
  const g = t.grass, s = t.sheep, w = t.water, k = t.sky;
  // 天空和太阳（先设曝光，后面的颜色换算要用）
  exposureUniform.value = k.exposure;
  sunFromAngles(k.elevation, k.azimuth);
  U.uSunDir.value.copy(SUN_DIR);
  U.uSunColor.value.set(PALETTE.sun).multiplyScalar(k.sun);
  U.uSkyAmb.value.set(PALETTE.sky).multiplyScalar(k.skyLight);
  U.uGroundAmb.value.set(PALETTE.ground).multiplyScalar(GROUND_RADIANCE * k.skyLight / SKY_RADIANCE);
  // 天空、雾的颜色也按“屏幕上看到的颜色”换算，调曝光时天空不会跟着发白
  screenColor(k.zenith, U.uZenith.value);
  screenColor(k.horizon, U.uFogColor.value);
  U.uSkyBand.value = k.band;
  U.uFogDensity.value = 0.00018 + 0.0006 * k.haze;
  U.uHazeLift.value = 220 + 500 * k.haze;
  bloomUniform.value = k.bloom;
  cloudUniform.value.set(k.cloudCover, k.cloudStrength, k.cloudSoftness, k.cloudSpeed);

  U.uToonMix.value = g.toon ? 1 : 0;
  screenColor(g.light, U.uToonLight.value);
  screenColor(g.lightDeep, U.uToonLightDeep.value);
  screenColor(g.shadow, U.uToonShadow.value);
  U.uToonEdge.value.set(g.edge, g.softness);
  U.uToonVar.value = g.variation;
  // 云杉林和草地同一套色系：亮面是压暗、稍偏冷的“亮面深色”，暗面是压暗的草地暗面
  U.uForestLit.value.copy(U.uToonLightDeep.value).lerp(U.uToonShadow.value, 0.25).multiplyScalar(0.7);
  U.uForestShade.value.copy(U.uToonShadow.value).multiplyScalar(0.58);

  screenColor(s.light, U.uSheepLight.value);
  // 羊的暗面：按 followGrass 向草地暗面的色相靠拢（保持原来的亮度）
  _a.set(s.shadow);
  _b.set(g.shadow);
  const la = _a.r * 0.2126 + _a.g * 0.7152 + _a.b * 0.0722;
  const lb = Math.max(1e-4, _b.r * 0.2126 + _b.g * 0.7152 + _b.b * 0.0722);
  _b.multiplyScalar(la / lb);
  _a.lerp(_b, s.followGrass);
  U.uSheepShadow.value.copy(_a).multiplyScalar(1 / EXPOSURE);
  U.uSheepEdge.value.set(s.edge, s.softness);
  U.uSheepTex.value = s.texture;
  U.uSheepFuzz.value = s.fuzz;
  U.uSheepRim.value = s.rim;
  U.uSheepGain.value = s.brightness;
  U.uSheepHi.value = s.highlight;

  screenColor(w.color, U.uWaterColor.value);
  screenColor(w.lake, U.uLakeColor.value);
  U.uWaterRefl.value = w.reflection;
  U.uRipple.value = w.ripple;
  U.uGlitter.value = w.glitter;
  U.uRiverGold.value.set(w.glitterColor);
  U.uFlowers.value = g.flowers;
}
