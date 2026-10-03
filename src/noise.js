// JS 侧噪声与地形高度。nearHeight 必须与 shaders.js 里的 terrainH 逐项一致，
// 草叶在 GPU 上取高度，小羊在 CPU 上取高度，两边对齐才不会“悬空”。

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function hash2(ix, iz) {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbm(x, z, oct = 4) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x, z); n += a;
    x = x * 2.03 + 17.1; z = z * 2.03 + 9.7; a *= 0.5;
  }
  return s / n;
}

export function ridged(x, z, oct = 5) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    let v = 1 - Math.abs(2 * vnoise(x, z) - 1);
    v *= v;
    s += a * v; n += a;
    x = x * 2.1 + 5.3; z = z * 2.1 + 1.7; a *= 0.5;
  }
  return s / n;
}

export function nearHeight(x, z) {
  return 7.0 * Math.sin(x * 0.012 + 0.6) * Math.cos(z * 0.010 - 0.4)
       + 4.0 * Math.sin((x * 0.8 + z * 0.6) * 0.021 + 1.3)
       + 2.2 * Math.sin((-x * 0.5 + z * 0.87) * 0.037 + 2.1)
       + 0.9 * Math.sin((x * 0.95 + z * 0.31) * 0.071 + 0.4)
       + 0.35 * Math.sin((x * 0.2 - z * 0.98) * 0.13 + 3.0)
       + valleyTilt(x * -0.892036 + z * 0.451965);
}

// 谷底整体顺着河往西（下游）缓缓下降（3% 的坡），站在草甸上能望见下游远处的溪流。
// 方向等于 rivers.js 的 FLOW（太阳的水平方向），这里写成常数以免循环引用。
export function valleyTilt(u) {
  return -0.03 * u;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
