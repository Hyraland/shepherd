import * as THREE from 'three';
import { mulberry32 } from './noise.js';

// 预先烘好的可平铺平滑值噪声（32×32 个格点，每格 8 个像素，三次插值）。
// 着色器里一次纹理读取就代替了四次哈希计算——草叶每个顶点都要算好几层噪声，这是主要的开销。
export const NOISE_CELLS = 32;
const RES = 256;

let tex = null;
let texData = null;
export function noiseTexture() {
  if (tex) return tex;
  const rng = mulberry32(1234);
  const lattice = new Float32Array(NOISE_CELLS * NOISE_CELLS);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng();
  const at = (x, y) => lattice[((y + NOISE_CELLS) % NOISE_CELLS) * NOISE_CELLS + ((x + NOISE_CELLS) % NOISE_CELLS)];
  const data = new Uint8Array(RES * RES);
  const step = RES / NOISE_CELLS;
  for (let y = 0; y < RES; y++) {
    for (let x = 0; x < RES; x++) {
      const gx = x / step, gy = y / step;
      const ix = Math.floor(gx), iy = Math.floor(gy);
      let fx = gx - ix, fy = gy - iy;
      fx = fx * fx * (3 - 2 * fx);
      fy = fy * fy * (3 - 2 * fy);
      const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
      const v = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
      data[y * RES + x] = Math.round(v * 255);
    }
  }
  texData = data;
  tex = new THREE.DataTexture(data, RES, RES, THREE.RedFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// 与着色器里的 vnoise / fbm3 完全一致的 CPU 版本（双线性采样同一张纹理），
// 用来让树的位置和地面上画出来的林子对得上
export function vnoiseTex(x, z) {
  if (!texData) noiseTexture();
  const u = (x / NOISE_CELLS) * RES - 0.5, v = (z / NOISE_CELLS) * RES - 0.5;
  const ix = Math.floor(u), iy = Math.floor(v);
  const fx = u - ix, fy = v - iy;
  const m = RES - 1;
  const t = (a, b) => texData[(b & m) * RES + (a & m)] / 255;
  const a = t(ix, iy), b = t(ix + 1, iy), c = t(ix, iy + 1), d = t(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export function fbm3Tex(x, z) {
  let s = 0, a = 0.5;
  for (let i = 0; i < 3; i++) {
    s += a * vnoiseTex(x, z);
    x = x * 2.03 + 17.13; z = z * 2.03 + 9.71;
    a *= 0.5;
  }
  return s / 0.875;
}
