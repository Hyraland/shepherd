import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { smoothstep } from './noise.js';
import { SUN_DIR } from './config.js';
import { SHEEP_CAPACITY, createRig, ContactShadows } from './sheep.js';
import { riverInfo } from './rivers.js';

// 羊群行为：
//  · 羊群总想聚到视线前方：每只羊在那团羊群里有自己的位置，视线转到哪儿就跟到哪儿
//  · 吃草（低头、零星挪步）与赶路（走/小跑）之间切换；邻居都走了，自己也会跟上（从众）
//  · 分离 / 对齐 / 聚合三种力，羊越多，对齐与聚合越强，自然挤成一团
//  · 人走近时会让开，抬头看你

const TAU = Math.PI * 2;
const wrapAngle = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
const SHADOW_OFF = new THREE.Vector2();

let nextId = 1;

export class Flock {
  constructor(scene, look, obstacles) {
    this.scene = scene;
    this.look = look;
    this.obstacles = obstacles;
    this.contact = new ContactShadows(scene);
    this.list = [];
    this._sphere = new THREE.Sphere();
  }

  // 羊群的半径：羊越多越大，但始终挤得很紧
  get spread() {
    return 1.0 + 0.36 * Math.sqrt(this.active);
  }

  // 换一种外观：骨架和行为不变，只换画法
  setLook(look) {
    for (const s of this.list) this.look.remove(s);
    this.look.dispose();
    this.look = look;
    for (const s of this.list) look.add(s);
  }

  _discard(i) {
    const s = this.list[i];
    this.look.remove(s);
    this.scene.remove(s.root);
    this.list.splice(i, 1);
  }

  get active() {
    let n = 0;
    for (const s of this.list) if (s.state !== 'leave') n++;
    return n;
  }

  activeList() {
    return this.list.filter((s) => s.state !== 'leave');
  }

  spawn(x, z, state = 'enter') {
    const v = createRig();
    const a = Math.random() * TAU, rr = Math.sqrt(Math.random());
    const s = {
      ...v, id: nextId++, x, z, vx: 0, vz: 0,
      heading: Math.random() * TAU, state,
      mode: state === 'enter' ? 'walk' : 'graze',
      offX: Math.cos(a) * rr, offY: Math.sin(a) * rr * 0.8,
      patience: Math.random() * 3,
      stepT: Math.random() * 3, wx: 0, wz: 0,
      phase: Math.random() * TAU, pitch: state === 'enter' ? 0 : 1.1, yaw: 0,
      lookT: 0, nextLook: 2 + Math.random() * 8,
      life: 0, shrink: 1, lx: 0, lz: 0,
    };
    // 实例缓冲满了：先收走最早离开的那只
    if (this.list.length >= SHEEP_CAPACITY) {
      const i = this.list.findIndex((o) => o.state === 'leave');
      this._discard(i >= 0 ? i : 0);
    }
    this.list.push(s);
    this.scene.add(s.root);
    this.look.add(s);
    this.pose(s, 0, 0, null);
    return s;
  }

  // 被送走的羊：朝视野外侧小跑离开，跑出画面后才真正消失
  dismiss(s, cam, fwdX, fwdZ) {
    s.state = 'leave';
    s.mode = 'walk';
    s.life = 0;
    const rx = -fwdZ, rz = fwdX;
    const side = Math.sign((s.x - cam.x) * rx + (s.z - cam.z) * rz) || 1;
    s.lx = cam.x + rx * side * 45 + fwdX * 6;
    s.lz = cam.z + rz * side * 45 + fwdZ * 6;
    s.lookT = 0;
  }

  update(dt, time, ctx) {
    const L = this.list;
    const n = this.active;
    const herd = 0.7 + 0.3 * smoothstep(3, 14, n);
    const spread = this.spread;
    const { cx, cz, fx, fz, cam } = ctx;
    const rx = -fz, rz = fx;

    for (let i = 0; i < L.length; i++) {
      const s = L[i];
      s.life += dt;

      let sepX = 0, sepZ = 0, aliX = 0, aliZ = 0, aliN = 0, cohX = 0, cohZ = 0, cohN = 0, walkN = 0;
      for (let j = 0; j < L.length; j++) {
        if (i === j) continue;
        const o = L[j];
        const dx = s.x - o.x, dz = s.z - o.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 64) continue;
        const d = Math.sqrt(d2) + 1e-4;
        const R = 0.62 * (s.scale + o.scale) + 0.15;
        if (d < R) { const w = 1 - d / R; sepX += (dx / d) * w; sepZ += (dz / d) * w; }
        if (o.state === 'leave' || s.state === 'leave') continue;
        if (d < 5) { aliX += o.vx; aliZ += o.vz; aliN++; if (o.mode === 'walk') walkN++; }
        cohX += o.x; cohZ += o.z; cohN++;
      }

      let dvx = 0, dvz = 0;
      if (s.state === 'leave') {
        const tx = s.lx - s.x, tz = s.lz - s.z, td = Math.hypot(tx, tz) + 1e-4;
        dvx = (tx / td) * 3.6; dvz = (tz / td) * 3.6;
      } else {
        const ax = cx + (s.offX * rx + s.offY * fx) * spread;
        const az = cz + (s.offX * rz + s.offY * fz) * spread;
        const tx = ax + fx * 0.6 - s.x, tz = az + fz * 0.6 - s.z;
        const td = Math.hypot(tx, tz) + 1e-4;

        if (s.state === 'enter') {
          dvx = (tx / td) * 3.4; dvz = (tz / td) * 3.4;
          if (td < 3) { s.state = 'flock'; s.mode = 'walk'; }
        } else if (s.mode === 'walk') {
          const sp = td > 12 ? 2.8 : Math.min(1.8, 0.5 + td * 0.3);
          dvx = (tx / td) * sp; dvz = (tz / td) * sp;
          if (aliN) { dvx += (aliX / aliN - s.vx) * 0.5 * herd; dvz += (aliZ / aliN - s.vz) * 0.5 * herd; }
          if (td < 1.2) { s.mode = 'graze'; s.stepT = 1 + Math.random() * 3; s.wx = s.wz = 0; }
        } else {
          s.stepT -= dt;
          if (s.stepT < 0) {
            if (Math.random() < 0.45) {
              const a = s.heading + (Math.random() - 0.5) * 1.6;
              const sp = 0.22 + Math.random() * 0.2;
              s.wx = Math.sin(a) * sp; s.wz = Math.cos(a) * sp;
              s.stepT = 0.8 + Math.random() * 1.5;
            } else {
              s.wx = s.wz = 0;
              s.stepT = 1.5 + Math.random() * 4;
            }
          }
          dvx = s.wx; dvz = s.wz;
          const ad = Math.hypot(ax - s.x, az - s.z);
          if (ad > 0.8 + s.patience * 0.3 + spread * 0.1) s.mode = 'walk';
          else if (aliN > 0 && walkN / aliN > 0.4 && Math.random() < dt * 1.5) s.mode = 'walk';
        }

        if (cohN) {
          const kx = cohX / cohN - s.x, kz = cohZ / cohN - s.z;
          const kd = Math.hypot(kx, kz) + 1e-4;
          const k = (s.mode === 'graze' ? 0.4 : 0.8) * herd * Math.min(kd / 2.5, 1);
          dvx += (kx / kd) * k; dvz += (kz / kd) * k;
        }
      }

      dvx += sepX * 1.6; dvz += sepZ * 1.6;

      // 给走过来的人让路
      {
        const dx = s.x - cam.x, dz = s.z - cam.z, d = Math.hypot(dx, dz) + 1e-4;
        if (d < 1.7) { const k = (1.7 - d) * 2.6; dvx += (dx / d) * k; dvz += (dz / d) * k; }
      }
      // 吃草时不站在溪水里；赶路时直接蹚过小溪跟上人
      if (s.state === 'flock' && s.mode === 'graze') {
        const ri = riverInfo(s.x, s.z);
        const R = 0.9 * s.scale + 0.4;
        if (ri.d < R) { const k = (R - ri.d) * 3.5; dvx += ri.ax * k; dvz += ri.az * k; }
      }
      for (const ob of this.obstacles) {
        const dx = s.x - ob.x, dz = s.z - ob.z, d = Math.hypot(dx, dz) + 1e-4, R = ob.r + 1.2;
        if (d < R) { const k = (R - d) * 3; dvx += (dx / d) * k; dvz += (dz / d) * k; }
      }

      const rate = s.state === 'flock' && s.mode === 'graze' ? 2.5 : 2.0;
      const kk = 1 - Math.exp(-dt * rate);
      s.vx += (dvx - s.vx) * kk;
      s.vz += (dvz - s.vz) * kk;
      const sp = Math.hypot(s.vx, s.vz);
      if (sp > 4.2) { s.vx *= 4.2 / sp; s.vz *= 4.2 / sp; }
      s.x += s.vx * dt;
      s.z += s.vz * dt;

      this.pose(s, dt, time, cam);
    }

    // 离开的羊：出了视野（或者实在太久）就收走
    for (let i = L.length - 1; i >= 0; i--) {
      const s = L[i];
      if (s.state !== 'leave') continue;
      const dist = Math.hypot(s.x - cam.x, s.z - cam.z);
      this._sphere.center.set(s.x, s.root.position.y + 0.5, s.z);
      this._sphere.radius = 1.2 * s.scale;
      const visible = ctx.frustum.intersectsSphere(this._sphere);
      if (s.life > 11) s.shrink -= dt * 1.4;
      if ((!visible && dist > 9) || s.shrink <= 0) this._discard(i);
    }
    for (const s of L) s.root.updateMatrixWorld(true);
    this.look.sync(L, dt, time);
    this.contact.sync(L);
  }

  pose(s, dt, time, cam) {
    const speed = Math.hypot(s.vx, s.vz);
    if (speed > 0.12) {
      const target = Math.atan2(s.vx, s.vz);
      const k = 1 - Math.exp(-dt * (speed > 1 ? 6 : 3));
      s.heading += wrapAngle(target - s.heading) * k;
    }

    s.phase += (dt * speed * 5.2) / s.scale;
    const amp = Math.min(speed / 1.3, 1) * (speed > 2.4 ? 0.75 : 0.5);
    const sw = Math.sin(s.phase) * amp;
    s.legs[0].rotation.x = sw;
    s.legs[1].rotation.x = -sw;
    s.legs[2].rotation.x = -sw;
    s.legs[3].rotation.x = sw;
    s.tilt.position.y = Math.abs(Math.cos(s.phase)) * 0.045 * Math.min(speed / 2.5, 1);

    // 头：吃草时低头啃，偶尔抬头张望；人靠近时会转头看你
    let tp, ty = 0;
    if (s.state === 'flock' && s.mode === 'graze' && cam) {
      const dcx = cam.x - s.x, dcz = cam.z - s.z, dc = Math.hypot(dcx, dcz);
      if (s.lookT > 0) s.lookT -= dt;
      else {
        s.nextLook -= dt * (dc < 8 ? 3 : 1);
        if (s.nextLook < 0) { s.lookT = 1.5 + Math.random() * 2.5; s.nextLook = 4 + Math.random() * 10; }
      }
      if (s.lookT > 0) {
        tp = 0.05;
        if (dc < 16) ty = Math.max(-0.9, Math.min(0.9, wrapAngle(Math.atan2(dcx, dcz) - s.heading)));
      } else {
        tp = 1.2 + 0.07 * Math.sin(time * 8 + s.id);
      }
    } else if (s.state === 'flock') {
      tp = 0.12 + 0.05 * Math.sin(s.phase * 2);
    } else {
      tp = -0.12 + 0.05 * Math.sin(s.phase * 2);
    }
    const kh = dt ? 1 - Math.exp(-dt * 4) : 1;
    s.pitch += (tp - s.pitch) * kh;
    s.yaw += (ty - s.yaw) * (dt ? 1 - Math.exp(-dt * 3) : 1);
    s.neck.rotation.x = s.pitch;
    s.neck.rotation.y = s.yaw;

    const sc = s.scale * Math.max(0, Math.min(1, s.shrink));
    s.root.scale.setScalar(Math.max(sc, 1e-3));
    const y = heightAt(s.x, s.z);
    s.root.position.set(s.x, y, s.z);
    s.root.rotation.y = s.heading;
    const hx = Math.sin(s.heading) * 0.5 * s.scale, hz = Math.cos(s.heading) * 0.5 * s.scale;
    const slope = heightAt(s.x + hx, s.z + hz) - heightAt(s.x - hx, s.z - hz);
    s.tilt.rotation.x = -Math.atan2(slope, s.scale);

    // 影子朝背光方向偏一点，转到羊的本地坐标里
    SHADOW_OFF.set(-SUN_DIR.x, -SUN_DIR.z).normalize().multiplyScalar(0.32);
    const c = Math.cos(s.heading), sn = Math.sin(s.heading);
    s.shadow.position.x = (SHADOW_OFF.x * c - SHADOW_OFF.y * sn) / s.scale;
    s.shadow.position.z = (SHADOW_OFF.x * sn + SHADOW_OFF.y * c) / s.scale;
  }
}
