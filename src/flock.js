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
//  · 赶路时，偶尔有一只（或挨着的两三只）停下来啃几口草，落在后面，吃完再小跑着追上来；
//    每只羊在羊群里的位置也在慢慢漂移——羊群在走的时候内部是流动的

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
    this.bleats = []; // 想叫一声的羊（声音模块取走）
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
      nibbleIn: 6 + Math.random() * 20, nibbleT: 0, pace: 0.92 + Math.random() * 0.16,
      driftX: 0, driftY: 0, driftT: 0, bleatIn: state === 'enter' ? 0.8 + Math.random() * 2 : 8 + Math.random() * 40,
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
    // 羊群整体在不在赶路（羊群中心的移动速度，平滑过）
    if (this._hx === undefined) { this._hx = ctx.cx; this._hz = ctx.cz; this.herdSpeed = 0; }
    if (dt > 0) {
      const v = Math.hypot(ctx.cx - this._hx, ctx.cz - this._hz) / dt;
      this.herdSpeed += (v - this.herdSpeed) * (1 - Math.exp(-dt * 2));
    }
    this._hx = ctx.cx; this._hz = ctx.cz;
    const travelling = this.herdSpeed > 0.45;
    let nibbling = 0;
    for (const s of L) if (s.mode === 'nibble') nibbling++;
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
        // 在羊群里的位置慢慢漂移：隔一阵换一个方向挪，羊和羊之间会互相超过、错开
        s.driftT -= dt;
        if (s.driftT < 0) {
          s.driftT = 6 + Math.random() * 12;
          const a = Math.random() * TAU;
          s.driftX = Math.cos(a) * 0.05; s.driftY = Math.sin(a) * 0.05;
        }
        if (travelling) {
          s.offX += s.driftX * dt; s.offY += s.driftY * dt;
          const r = Math.hypot(s.offX, s.offY / 0.8);
          if (r > 1) { s.offX /= r; s.offY /= r; s.driftX *= -1; s.driftY *= -1; }
        }
        const ax = cx + (s.offX * rx + s.offY * fx) * spread;
        const az = cz + (s.offX * rz + s.offY * fz) * spread;
        const tx = ax + fx * 0.6 - s.x, tz = az + fz * 0.6 - s.z;
        const td = Math.hypot(tx, tz) + 1e-4;

        if (s.state === 'enter') {
          dvx = (tx / td) * 3.4; dvz = (tz / td) * 3.4;
          if (td < 3) { s.state = 'flock'; s.mode = 'walk'; }
        } else if (s.mode === 'nibble') {
          // 停下来啃几口：原地不动（偶尔挪半步），羊群从身边走过去
          s.nibbleT -= dt;
          s.stepT -= dt;
          if (s.stepT < 0) {
            const a = s.heading + (Math.random() - 0.5) * 1.2;
            const st = Math.random() < 0.3 ? 0.25 : 0;
            s.wx = Math.sin(a) * st; s.wz = Math.cos(a) * st;
            s.stepT = 0.6 + Math.random() * 1.2;
          }
          dvx = s.wx; dvz = s.wz;
          // 吃够了，或者落得太远、羊群停下了：抬头追上去
          if (s.nibbleT < 0 || td > 14 || !travelling) {
            s.mode = travelling ? 'catchup' : 'walk';
            s.nibbleIn = 10 + Math.random() * 25;
            s.bleatIn = Math.min(s.bleatIn, Math.random() < 0.35 ? 0.3 + Math.random() : 99);
          }
        } else if (s.mode === 'walk' || s.mode === 'catchup') {
          const catchup = s.mode === 'catchup';
          const sp = catchup
            ? Math.min(3.0, 1.2 + td * 0.3)
            : (td > 12 ? 2.8 : Math.min(1.8, 0.5 + td * 0.3)) * s.pace;
          dvx = (tx / td) * sp; dvz = (tz / td) * sp;
          if (aliN && !catchup) { dvx += (aliX / aliN - s.vx) * 0.5 * herd; dvz += (aliZ / aliN - s.vz) * 0.5 * herd; }
          if (catchup && td < 1.6) s.mode = 'walk';
          if (td < 1.2) { s.mode = 'graze'; s.stepT = 1 + Math.random() * 3; s.wx = s.wz = 0; }
          // 赶路途中停下来吃几口（同一时间最多两三只，挨着的羊有时会一起停）
          if (s.mode === 'walk' && travelling && td < 6) {
            s.nibbleIn -= dt;
            if (s.nibbleIn < 0 && nibbling < Math.max(1, Math.round(n * 0.18))) {
              s.mode = 'nibble';
              s.nibbleT = 1.8 + Math.random() * 3.5;
              s.stepT = 0; s.wx = s.wz = 0;
              nibbling++;
              for (const o of L) {
                if (o === s || o.mode !== 'walk' || nibbling >= Math.max(1, Math.round(n * 0.25))) continue;
                if (Math.hypot(o.x - s.x, o.z - s.z) < 1.8 && Math.random() < 0.35) {
                  o.mode = 'nibble'; o.nibbleT = s.nibbleT * (0.6 + Math.random() * 0.5); o.stepT = 0; o.wx = o.wz = 0;
                  nibbling++;
                }
              }
            } else if (s.nibbleIn < 0) s.nibbleIn = 1 + Math.random() * 3;
          }
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
          const k = (s.mode === 'graze' ? 0.4 : s.mode === 'nibble' ? 0 : 0.8) * herd * Math.min(kd / 2.5, 1);
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
      if (s.state === 'flock' && (s.mode === 'graze' || s.mode === 'nibble')) {
        const ri = riverInfo(s.x, s.z);
        const R = 0.9 * s.scale + 0.4;
        if (ri.d < R) { const k = (R - ri.d) * 3.5; dvx += ri.ax * k; dvz += ri.az * k; }
      }
      for (const ob of this.obstacles) {
        const dx = s.x - ob.x, dz = s.z - ob.z, d = Math.hypot(dx, dz) + 1e-4, R = ob.r + 1.2;
        if (d < R) { const k = (R - d) * 3; dvx += (dx / d) * k; dvz += (dz / d) * k; }
      }

      const rate = s.state === 'flock' && (s.mode === 'graze' || s.mode === 'nibble') ? 2.5 : 2.0;
      const kk = 1 - Math.exp(-dt * rate);
      s.vx += (dvx - s.vx) * kk;
      s.vz += (dvz - s.vz) * kk;
      const sp = Math.hypot(s.vx, s.vz);
      if (sp > 4.2) { s.vx *= 4.2 / sp; s.vz *= 4.2 / sp; }
      s.x += s.vx * dt;
      s.z += s.vz * dt;

      // 隔一阵叫一声（声音模块按位置播放）
      if (s.state !== 'leave') {
        s.bleatIn -= dt;
        if (s.bleatIn < 0) {
          this.bleats.push(s);
          s.bleatIn = 25 + Math.random() * 55;
        }
      }

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
    if (s.state === 'flock' && s.mode === 'nibble') {
      tp = 1.2 + 0.08 * Math.sin(time * 9 + s.id);
    } else if (s.state === 'flock' && s.mode === 'graze' && cam) {
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
