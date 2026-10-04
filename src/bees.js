import * as THREE from 'three';
import { COMMON } from './shaders.js';
import { heightAt } from './terrain.js';
import { vnoiseTex } from './noiseTexture.js';
import { smoothstep } from './noise.js';

// 草甸上的熊蜂（野蜂）：在人周围十来米内，从一朵花飞到另一朵花——
// 在花上停一会儿（悬停、轻轻晃），再拐着弯飞向附近的另一丛花。只在有花的地方出没（和花丛分布同一套）。
// 走远了的蜂会在前方的花丛里重新出现。身体是黄黑相间、白尾巴的毛茸茸小球，翅膀是一片快速扇动的虚影。

// 与 shaders.js 的 flowerCover 一致
function flowerCover(x, z, amount) {
  const clump = vnoiseTex(x * 0.06 + 2, z * 0.06 + 2) * 0.55 + vnoiseTex(x * 0.17 + 7, z * 0.17 + 7) * 0.3 + vnoiseTex(x * 0.6, z * 0.6) * 0.15;
  return smoothstep(0.62 - 0.22 * amount, 0.74 - 0.18 * amount, clump) * Math.min(1, amount * 1.4);
}

const vert = /* glsl */ `
${COMMON}
attribute float aPart;      // 0 = 身体，1 = 翅膀
attribute float aSide;      // 翅膀：-1 左，1 右
varying vec3 vN;
varying vec3 vWorld;
varying float vBand;
varying float vPart;
void main() {
  vec3 p = position;
  vec3 n = normal;
  if (aPart > 0.5) {
    // 翅膀绕身体的纵轴高速扇动（快到一帧一个位置，看上去就是一片虚影）
    float a = sin(uTime * 190.0 + float(gl_InstanceID) * 1.7) * 0.9 + 0.35;
    float c = cos(a), s = sin(a);
    vec2 q = vec2(abs(p.x), p.y - 0.55);
    q = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
    p = vec3(q.x * aSide, q.y + 0.55, p.z);
  }
  vBand = position.z;
  vPart = aPart;
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vN = normalize(mat3(modelMatrix * instanceMatrix) * n);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const frag = /* glsl */ `
${COMMON}
varying vec3 vN;
varying vec3 vWorld;
varying float vBand;
varying float vPart;
void main() {
  if (vPart > 0.5) {
    gl_FragColor = vec4(applyFog(vec3(0.85, 0.88, 0.92) / uExposure, vWorld), 0.35);
    return;
  }
  // 从头到尾：黑头、黄胸、黑腰、黄腹、白尾
  float z = vBand;
  vec3 yellow = vec3(0.95, 0.72, 0.12), black = vec3(0.05, 0.04, 0.035), white = vec3(0.92, 0.9, 0.84);
  vec3 alb = z > 0.62 ? black : z > 0.12 ? yellow : z > -0.2 ? black : z > -0.55 ? yellow : white;
  vec3 N = normalize(vN);
  float cs = cloudShadow(vWorld.xz);
  float ss = sunShadowFast(vWorld);
  float k = smoothstep(0.25, 0.45, ss * clamp(dot(N, uSunDir) * 0.6 + 0.4, 0.0, 1.0)) * cs;
  vec3 toon = mix(alb * 0.35 / uExposure + uToonShadow * 0.35, alb * 1.15 / uExposure, k);
  vec3 real = alb * (ambient(N) + uSunColor * max(dot(N, uSunDir), 0.0) * ss * cs);
  gl_FragColor = vec4(applyFog(mix(real, toon, uToonMix), vWorld), 1.0);
}
`;

function beeGeometry() {
  const body = new THREE.SphereGeometry(1, 10, 8).toNonIndexed();
  const pos = Array.from(body.attributes.position.array);
  const nor = Array.from(body.attributes.normal.array);
  const part = new Array(pos.length / 3).fill(0);
  const side = new Array(pos.length / 3).fill(0);
  // 两片翅膀：从背上伸向两侧、略向后
  for (const sd of [-1, 1]) {
    const w = [[0.1, 0.55, 0.25], [1.5, 0.55, 0.05], [1.4, 0.55, -0.45], [0.1, 0.55, -0.15]];
    for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
      for (const v of [w[a], w[b], w[c]]) {
        pos.push(v[0] * sd, v[1], v[2]);
        nor.push(0, 1, 0);
        part.push(1);
        side.push(sd);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  return g;
}

const RANGE = 12;   // 离人超过这么远就到前方重新出现

export class Bees {
  constructor(scene, U, tuning, count = 26) {
    this.tuning = tuning;
    this.count = count;
    this.list = [];
    const mat = new THREE.ShaderMaterial({
      uniforms: U, vertexShader: vert, fragmentShader: frag,
      side: THREE.DoubleSide, alphaToCoverage: true,
    });
    this.mesh = new THREE.InstancedMesh(beeGeometry(), mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  get amount() { return this.tuning.grass.flowers; }

  // 在 (x, z) 附近 r0–r1 米内找一处有花的地方
  findFlower(x, z, r0, r1, dirX = 0, dirZ = 0, spread = Math.PI) {
    const base = dirX || dirZ ? Math.atan2(dirX, dirZ) : 0;
    let best = null, bc = 0;
    for (let k = 0; k < 14; k++) {
      const a = base + (Math.random() * 2 - 1) * spread, r = r0 + Math.random() * (r1 - r0);
      const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
      const c = flowerCover(px, pz, this.amount);
      if (c > 0.25) return { x: px, z: pz };
      if (c > bc) { bc = c; best = { x: px, z: pz }; }
    }
    return best;
  }

  spawn(b, cam, fx, fz, near) {
    const spot = this.findFlower(cam.x, cam.z, near ? 1.5 : 6, near ? RANGE - 2 : RANGE - 1, fx, fz, near ? Math.PI : 1.6);
    if (!spot || flowerCover(spot.x, spot.z, this.amount) < 0.1) { b.hidden = true; return; }
    b.hidden = false;
    b.x = spot.x; b.z = spot.z; b.y = heightAt(spot.x, spot.z) + 0.18 + Math.random() * 0.12;
    b.tx = b.x; b.tz = b.z; b.ty = b.y;
    b.vx = b.vz = b.vy = 0;
    b.state = 'hover';
    b.t = 0.5 + Math.random() * 3;
    b.grow = near ? 1 : 0;
  }

  update(dt, time, cam, fx, fz) {
    if (this.amount < 0.02) { this.mesh.count = 0; this.list.length = 0; return; }
    while (this.list.length < this.count) {
      const b = { size: 0.9 + Math.random() * 0.3, phase: Math.random() * 100, heading: Math.random() * 6.28, speed: 1.2 + Math.random() * 1.2 };
      this.spawn(b, cam, fx, fz, true);
      this.list.push(b);
    }
    let n = 0;
    for (const b of this.list) {
      const dc = Math.hypot(b.x - cam.x, b.z - cam.z);
      if (b.hidden || dc > RANGE) {
        b.retry = (b.retry || 0) - dt;
        if (b.retry < 0) { this.spawn(b, cam, fx, fz, false); b.retry = 0.5; }
        if (b.hidden) continue;
      }
      b.grow = Math.min(1, b.grow + dt * 1.5);
      b.phase += dt;
      if (b.state === 'hover') {
        // 在花上悬停：一点点晃动
        b.t -= dt;
        const jx = Math.sin(b.phase * 3.1) * 0.012, jy = Math.sin(b.phase * 4.3) * 0.01, jz = Math.cos(b.phase * 2.7) * 0.012;
        b.x += (b.tx + jx - b.x) * (1 - Math.exp(-dt * 6));
        b.y += (b.ty + jy - b.y) * (1 - Math.exp(-dt * 6));
        b.z += (b.tz + jz - b.z) * (1 - Math.exp(-dt * 6));
        b.vx = b.vy = b.vz = 0;
        if (b.t < 0) {
          const spot = this.findFlower(b.x, b.z, 0.6, 3.5);
          if (spot) {
            b.tx = spot.x; b.tz = spot.z; b.ty = heightAt(spot.x, spot.z) + 0.16 + Math.random() * 0.14;
            b.state = 'fly'; b.d0 = Math.hypot(b.tx - b.x, b.tz - b.z) + 1e-3;
          } else b.t = 1;
        }
      } else {
        // 拐着弯飞过去，中途抬高一点
        const dx = b.tx - b.x, dz = b.tz - b.z, d = Math.hypot(dx, dz) + 1e-4;
        const prog = 1 - Math.min(1, d / b.d0);
        const sp = b.speed * Math.min(1, d * 2 + 0.25);
        const wob = Math.sin(b.phase * 7) * 0.9;
        const wx = dx / d + (-dz / d) * wob * 0.5, wz = dz / d + (dx / d) * wob * 0.5;
        const k = 1 - Math.exp(-dt * 5);
        b.vx += (wx * sp - b.vx) * k;
        b.vz += (wz * sp - b.vz) * k;
        const ty = b.ty + Math.sin(prog * Math.PI) * Math.min(0.35, b.d0 * 0.15);
        b.vy = (ty - b.y) * 4;
        // 别撞到人脸上
        const ex = b.x - cam.x, ez = b.z - cam.z, ed = Math.hypot(ex, ez) + 1e-4;
        if (ed < 1) { b.vx += (ex / ed) * (1 - ed) * 3; b.vz += (ez / ed) * (1 - ed) * 3; }
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        if (d < 0.06) { b.state = 'hover'; b.t = 0.8 + Math.random() * 3.5; }
      }
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > 0.1) {
        const target = Math.atan2(b.vx, b.vz);
        let da = target - b.heading;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        b.heading += da * (1 - Math.exp(-dt * 10));
      } else {
        b.heading += Math.sin(b.phase * 0.7) * dt * 0.6;
      }
      b.speedNow = sp;
      const pitch = b.state === 'hover' ? -0.35 : 0.05;   // 悬停时尾巴垂下、头微微抬起
      this._e.set(pitch, b.heading, Math.sin(b.phase * 5) * 0.15);
      this._q.setFromEuler(this._e);
      const g = b.size * b.grow;
      this._s.set(0.0082 * g, 0.0075 * g, 0.012 * g);
      this._p.set(b.x, b.y, b.z);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(n++, this._m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  // 离人最近的几只（给声音用）
  nearest(cam, k) {
    return this.list
      .filter((b) => !b.hidden)
      .map((b) => ({ b, d: Math.hypot(b.x - cam.x, b.y - cam.y, b.z - cam.z) }))
      .sort((a, c) => a.d - c.d)
      .slice(0, k);
  }
}
