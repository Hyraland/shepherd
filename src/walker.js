import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { WALK_SPEED } from './config.js';
import { FLOW, ACROSS } from './rivers.js';

// 人在草甸上慢慢走。两种走法：
//  · free（默认）：往视线的方向走——转头看向哪里，脚步就慢慢转过去，羊群聚在视线前方，始终跟人在一起
//  · path：沿一条固定的环形小路走（以切换时所在的位置为中心），视角可以自由转动，羊群跟着行走方向
// 沿着河谷可以一直走下去（地形随走随生成）；横向靠近两边林坡时，脚步会慢慢顺着林边转开，
// 不会撞上一堵看不见的墙。绕开树。

export function pathRadius(a) {
  return 95 + 30 * Math.sin(2 * a + 0.8) + 14 * Math.sin(3 * a + 2.1);
}

const TAU = Math.PI * 2;
const wrapAngle = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
const fwdX = (yaw) => -Math.sin(yaw);
const fwdZ = (yaw) => -Math.cos(yaw);
const yawOf = (dx, dz) => Math.atan2(-dx, -dz);

// 横跨河谷方向的活动范围：V_SOFT 以外开始顺着林边转开，V_MAX 是硬边界
// （要留在草叶着色器和 CPU 地形高度一致的区域里：|v| + 草叶半径 < 200）
const V_SOFT = 95, V_MAX = 150;

export class Walker {
  constructor() {
    const pts = [];
    const N = 18;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const r = pathRadius(a);
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    this.curve.arcLengthDivisions = 3000;
    this.length = this.curve.getLength();

    this.mode = 'free';
    this.s = 0;
    this.pathU = 0; // 小路环线的中心沿河谷的位置
    this.onPath = true;
    this.speed = 0;
    this.walking = true;
    this.stride = 0;
    this.obstacles = [];

    const p = this.point(0);
    const q = this.point(4);
    this.x = p.x;
    this.z = p.z;
    this.heading = yawOf(q.x - p.x, q.z - p.z);
    this.camYaw = this.targetYaw = this.heading;
    this.lookPitch = this.targetPitch = 0;
    this.eyeY = null;
    this._p = new THREE.Vector3();
    this._q = new THREE.Vector3();
  }

  u(s) { return (((s % this.length) + this.length) % this.length) / this.length; }
  point(s, out = new THREE.Vector3()) {
    this.curve.getPointAt(this.u(s), out);
    out.x += FLOW.x * this.pathU;
    out.z += FLOW.z * this.pathU;
    return out;
  }
  tangent(s, out = new THREE.Vector3()) { return this.curve.getTangentAt(this.u(s), out); }

  look(dx, dy) {
    this.targetYaw -= dx;
    this.targetPitch = Math.max(-0.75, Math.min(0.55, this.targetPitch - dy));
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'path') {
      // 小路环线挪到当前位置附近（沿河谷方向），找到最近的点，先走过去再沿路走
      this.pathU = this.x * FLOW.x + this.z * FLOW.z;
      let best = 0, bd = Infinity;
      for (let s = 0; s < this.length; s += 2) {
        const p = this.point(s, this._p);
        const d = (p.x - this.x) ** 2 + (p.z - this.z) ** 2;
        if (d < bd) { bd = d; best = s; }
      }
      this.s = best;
      this.onPath = Math.sqrt(bd) < 0.5;
    }
  }

  // 羊群该聚在哪个方向的前方：自由漫步时是视线方向，走小路时是行走方向
  herdForward(out) {
    const yaw = this.mode === 'free' ? this.camYaw : this.heading;
    out.set(fwdX(yaw), 0, fwdZ(yaw));
    return out;
  }

  update(dt, camera) {
    const target = this.walking ? WALK_SPEED : 0;
    this.speed += (target - this.speed) * (1 - Math.exp(-dt * 1.6));
    const step = this.speed * dt;
    this.stride += step * 1.9 * Math.PI;

    const kLook = 1 - Math.exp(-dt * 8);

    if (this.mode === 'path') {
      if (this.onPath) {
        this.s += step;
        const p = this.point(this.s, this._p);
        const ahead = this.point(this.s + 7, this._q);
        const pathYaw = yawOf(ahead.x - p.x, ahead.z - p.z);
        const turn = wrapAngle(pathYaw - this.heading) * (1 - Math.exp(-dt * 1.2));
        this.heading += turn;
        // 路拐弯时视角也跟着转
        this.targetYaw += turn;
        this.camYaw += turn;
        this.x = p.x;
        this.z = p.z;
      } else {
        const p = this.point(this.s, this._p);
        const dx = p.x - this.x, dz = p.z - this.z, d = Math.hypot(dx, dz);
        this.heading += wrapAngle(yawOf(dx, dz) - this.heading) * (1 - Math.exp(-dt * 3));
        const m = Math.min(d, Math.max(step, WALK_SPEED * dt));
        this.x += fwdX(this.heading) * m;
        this.z += fwdZ(this.heading) * m;
        if (d < 0.5) this.onPath = true;
      }
    } else {
      // 脚步慢慢转向视线方向
      this.heading += wrapAngle(this.camYaw - this.heading) * (1 - Math.exp(-dt * 1.8));
      let mx = fwdX(this.heading), mz = fwdZ(this.heading);
      // 靠近两边林坡时，往外走的那一部分慢慢消失，只剩顺着河谷的分量
      const v = this.x * ACROSS.x + this.z * ACROSS.z;
      const out = mx * ACROSS.x + mz * ACROSS.z;
      if (out * v > 0) {
        const keep = 1 - THREE.MathUtils.smoothstep(Math.abs(v), V_SOFT, V_MAX);
        mx -= ACROSS.x * out * (1 - keep);
        mz -= ACROSS.z * out * (1 - keep);
      }
      this.x += mx * step;
      this.z += mz * step;
      this.constrain();
    }

    this.camYaw += (this.targetYaw - this.camYaw) * kLook;
    this.lookPitch += (this.targetPitch - this.lookPitch) * kLook;

    const ax = this.x + fwdX(this.heading) * 7, az = this.z + fwdZ(this.heading) * 7;
    const ground = heightAt(this.x, this.z);
    const groundAhead = heightAt(ax, az);
    const amp = this.speed / WALK_SPEED;
    const bob = Math.sin(this.stride * 2) * 0.028 * amp;
    const eye = ground + 1.62;
    this.eyeY = this.eyeY === null ? eye : this.eyeY + (eye - this.eyeY) * (1 - Math.exp(-dt * 6));

    const sway = Math.sin(this.stride) * 0.025 * amp;
    camera.position.set(this.x + Math.cos(this.heading) * sway, this.eyeY + bob, this.z - Math.sin(this.heading) * sway);

    // 视线朝着上坡/下坡时稍微抬头/低头
    const slopePitch = Math.atan2(groundAhead - ground, 7) * 0.45 * Math.max(0, Math.cos(this.camYaw - this.heading));
    camera.rotation.order = 'YXZ';
    camera.rotation.set(-0.07 + slopePitch + this.lookPitch, this.camYaw, Math.sin(this.stride) * 0.004 * amp);
  }

  // 自由漫步：留在谷底，绕开树
  constrain() {
    const u = this.x * FLOW.x + this.z * FLOW.z;
    let v = this.x * ACROSS.x + this.z * ACROSS.z;
    v = Math.min(V_MAX, Math.max(-V_MAX, v));
    this.x = FLOW.x * u + ACROSS.x * v;
    this.z = FLOW.z * u + ACROSS.z * v;
    for (const o of this.obstacles) {
      const dx = this.x - o.x, dz = this.z - o.z, R = o.r + 0.6;
      const d2 = dx * dx + dz * dz;
      if (d2 < R * R && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        this.x = o.x + (dx / d) * R;
        this.z = o.z + (dz / d) * R;
      }
    }
  }
}
