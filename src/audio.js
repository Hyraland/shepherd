import { riverInfo, FLOW } from './rivers.js';
import { heightAt } from './terrain.js';

// 草原的声音，全部用 Web Audio 现场合成（不需要录音文件）：
//   风    ：低沉的风声 + 草叶沙沙声，一阵阵起伏
//   溪水  ：潺潺的流水声（流水 + 咕噜 + 细密的小气泡），沿着最近的那条溪，离得越近越响
//   羊叫  ：真实录音（assets/sounds，授权见 CREDITS.md），按每只羊的体型变调，从那只羊的位置传来；
//           录音加载不了时退回合成的“咩——”
//   熊蜂  ：离人最近的几只蜂的嗡嗡声，跟着蜂飞
//   云雀  ：天上偶尔一段急促婉转的鸣唱
// 浏览器要求用户先点一下 / 按一下键，声音才能开始。音量在开发面板「声音」里调。

const rand = (a, b) => a + Math.random() * (b - a);

export class Soundscape {
  constructor(tuning) {
    this.tuning = tuning;
    this.ctx = null;
    this.nextLark = rand(4, 10);
    this.lastBleat = 0;
    this.gust = 0;
  }

  // 第一次点击 / 按键时调用
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.bus = {};
    for (const k of ['wind', 'water', 'sheep', 'bees', 'birds']) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.master);
      this.bus[k] = g;
    }
    this.white = this.noiseBuffer('white', 4);
    this.pink = this.noiseBuffer('pink', 6);
    this.brown = this.noiseBuffer('brown', 6);
    this.buildWind();
    this.buildWater();
    this.buildBees();
    this.loadBleats();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) ctx.suspend(); else ctx.resume();
    });
  }

  async loadBleats() {
    const files = ['sheep_baa.ogg', 'sheep1.flac', 'sheepBleet.flac', 'sheep2.flac'];
    this.bleatBufs = [];
    await Promise.all(files.map(async (f) => {
      try {
        const r = await fetch(`assets/sounds/${f}`);
        if (!r.ok) return;
        this.bleatBufs.push(await this.ctx.decodeAudioData(await r.arrayBuffer()));
      } catch (e) { console.warn('羊叫录音加载失败', f, e); }
    }));
  }

  noiseBuffer(kind, seconds) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return buf;
  }

  loop(buf) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(0, Math.random() * buf.duration);
    return s;
  }

  panner(ref = 2, roll = 1) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = roll;
    p.maxDistance = 400;
    return p;
  }

  setPos(p, x, y, z) {
    const t = this.ctx.currentTime;
    if (p.positionX) {
      p.positionX.setTargetAtTime(x, t, 0.05); p.positionY.setTargetAtTime(y, t, 0.05); p.positionZ.setTargetAtTime(z, t, 0.05);
    } else p.setPosition(x, y, z);
  }

  // —— 风 ——
  buildWind() {
    const ctx = this.ctx;
    const low = this.loop(this.brown);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 380;
    this.windLow = ctx.createGain();
    low.connect(lp).connect(this.windLow).connect(this.bus.wind);
    // 草叶沙沙：左右各一路，不完全一样，听起来是一大片
    this.rustle = [];
    for (const pan of [-0.7, 0.7]) {
      const src = this.loop(this.pink);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.5;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 900;
      const g = ctx.createGain();
      const sp = ctx.createStereoPanner();
      sp.pan.value = pan;
      src.connect(hp).connect(bp).connect(g).connect(sp).connect(this.bus.wind);
      this.rustle.push({ g, bp, seed: Math.random() * 100 });
    }
  }

  // —— 溪水 ——
  // 潺潺的流水：沿着溪的上下游各放一个声源（声音是一条“线”，不是一个点），每个声源里有
  //   · 流水声：中高频的噪声，响度被每秒十来次的随机起伏推着走（哗啦哗啦地流，不是风那种缓慢的呼啸）；
  //   · 咕噜声：一路窄带噪声，中心频率在几百到一千多赫兹之间快速游走；
  //   · 细密的小气泡：每秒上百个极短、很轻的“嘀”，混在一起就是水流特有的细碎质感（不是一个个清楚的泉水叮咚声）
  buildWater() {
    const ctx = this.ctx;
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    this.waterGain.connect(this.bus.water);
    this.waterSrc = [0, 1].map(() => {
      const pan = this.panner(3, 1.1);
      const g = ctx.createGain();
      g.connect(pan).connect(this.waterGain);
      // 流水声
      const flow = this.loop(this.pink);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 350;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.45;
      const fg = ctx.createGain(); fg.gain.value = 0.16;
      const mod = this.loop(this.white);
      const mlp = ctx.createBiquadFilter(); mlp.type = 'lowpass'; mlp.frequency.value = 12;
      const mg = ctx.createGain(); mg.gain.value = 3.0;
      mod.connect(mlp).connect(mg).connect(fg.gain);
      flow.connect(hp).connect(bp).connect(fg).connect(g);
      // 咕噜声
      const gur = this.loop(this.white);
      const gbp = ctx.createBiquadFilter(); gbp.type = 'bandpass'; gbp.Q.value = 5; gbp.frequency.value = 900;
      const gg = ctx.createGain(); gg.gain.value = 0.1;
      gur.connect(gbp).connect(gg).connect(g);
      return { pan, g, gbp, gg, t: 0 };
    });
    this.nextBubble = 0;
  }

  // 一个极小的气泡：很短、很轻、音调往上滑
  bubble(t, out) {
    const ctx = this.ctx;
    const f0 = rand(900, 3200);
    const dur = rand(0.008, 0.03);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * rand(1.3, 1.9), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(rand(0.008, 0.03), t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0003, t + dur);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.01);
  }

  // —— 熊蜂（三个声部，分给离人最近的三只）——
  buildBees() {
    const ctx = this.ctx;
    this.beeVoices = [];
    for (let i = 0; i < 3; i++) {
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      o1.type = 'sawtooth'; o2.type = 'sawtooth';
      o1.frequency.value = 160; o2.frequency.value = 163;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 1.5;
      const g = ctx.createGain(); g.gain.value = 0;
      const p = this.panner(0.25, 1.6);
      o1.connect(lp); o2.connect(lp);
      lp.connect(g).connect(p).connect(this.bus.bees);
      o1.start(); o2.start();
      this.beeVoices.push({ o1, o2, g, p, base: rand(150, 200) });
    }
  }

  // —— 一声羊叫：咩——（小羊的声音更高、更短）——
  bleat(x, y, z, scale) {
    const ctx = this.ctx, t = ctx.currentTime + 0.02;
    if (this.bleatBufs?.length) {
      // 录音：随机挑一段，按体型变调（小羊更尖），每次略有不同
      const src = ctx.createBufferSource();
      src.buffer = this.bleatBufs[Math.floor(Math.random() * this.bleatBufs.length)];
      src.playbackRate.value = rand(0.92, 1.06) * Math.sqrt(0.76 / Math.max(scale, 0.5));   // 体型 0.6–0.92 → 音高 ×1.13–0.91
      const g = ctx.createGain();
      g.gain.value = rand(0.6, 0.9);
      const p = this.panner(2.5, 1);
      this.setPos(p, x, y, z);
      src.connect(g).connect(p).connect(this.bus.sheep);
      src.start(t);
      return;
    }
    const young = scale < 0.8;
    const dur = young ? rand(0.5, 0.8) : rand(0.75, 1.25);
    const f0 = (young ? rand(330, 420) : rand(210, 300));
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0 * 0.92, t);
    osc.frequency.linearRampToValueAtTime(f0 * 1.06, t + 0.12);
    osc.frequency.linearRampToValueAtTime(f0 * 0.94, t + dur);
    // 颤音：音高和响度一起抖（“咩—e—e—e”）
    const rate = rand(6.5, 10);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rate;
    const lfoF = ctx.createGain(); lfoF.gain.value = f0 * 0.035;
    lfo.connect(lfoF).connect(osc.frequency);
    const trem = ctx.createGain(); trem.gain.value = 0.6;
    const lfoA = ctx.createGain(); lfoA.gain.value = 0.4;
    lfo.connect(lfoA).connect(trem.gain);
    // 共振峰：从闭着嘴的 m 张开到 a
    const out = ctx.createGain();
    out.gain.value = 0;
    const formants = [[750, 7, 1.0], [1250, 9, 0.55], [2650, 11, 0.22]];
    for (const [f, q, a] of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = q;
      bp.frequency.setValueAtTime(f * 0.55, t);
      bp.frequency.linearRampToValueAtTime(f, t + 0.09);
      bp.frequency.linearRampToValueAtTime(f * 0.92, t + dur);
      const g = ctx.createGain(); g.gain.value = a * 3.2;
      osc.connect(bp).connect(g).connect(trem);
    }
    // 一点气声
    const br = ctx.createBufferSource();
    br.buffer = this.white;
    const bbp = ctx.createBiquadFilter(); bbp.type = 'bandpass'; bbp.frequency.value = 2200; bbp.Q.value = 1;
    const bg = ctx.createGain(); bg.gain.value = 0.08;
    br.connect(bbp).connect(bg).connect(trem);
    trem.connect(out);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.9, t + 0.06);
    out.gain.setValueAtTime(0.9, t + dur * 0.7);
    out.gain.linearRampToValueAtTime(0, t + dur);
    const p = this.panner(2.5, 1);
    this.setPos(p, x, y, z);
    out.connect(p).connect(this.bus.sheep);
    osc.start(t); lfo.start(t); br.start(t, Math.random() * 3);
    const end = t + dur + 0.05;
    osc.stop(end); lfo.stop(end); br.stop(end);
  }

  // —— 云雀：天上一段急促的鸣唱 ——
  lark(cx, cy, cz) {
    const ctx = this.ctx;
    const a = Math.random() * Math.PI * 2, r = rand(25, 60);
    const p = this.panner(10, 1);
    this.setPos(p, cx + Math.cos(a) * r, cy + rand(25, 45), cz + Math.sin(a) * r);
    p.connect(this.bus.birds);
    let t = ctx.currentTime + 0.05;
    const notes = Math.floor(rand(18, 55));
    let f = rand(3000, 4500);
    for (let i = 0; i < notes;) {
      // 一组同样的音快速重复几次（颤鸣），再换一个音
      const rep = Math.random() < 0.4 ? Math.floor(rand(3, 7)) : 1;
      f = Math.min(6200, Math.max(2400, f * rand(0.8, 1.25)));
      const d = rand(0.03, 0.09), sweep = rand(0.75, 1.35);
      for (let k = 0; k < rep && i < notes; k++, i++) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * sweep, t + d);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.12, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.001, t + d);
        o.connect(g).connect(p);
        o.start(t); o.stop(t + d + 0.01);
        t += d + (rep > 1 ? 0.012 : rand(0.015, 0.06));
      }
    }
  }

  update(dt, { camera, walker, flock, bees }) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const T = this.tuning.sound;
    const now = ctx.currentTime;
    const set = (param, v, tc = 0.15) => param.setTargetAtTime(v, now, tc);
    set(this.master.gain, T.master);
    for (const k of Object.keys(this.bus)) set(this.bus[k].gain, T[k] ?? 0, 0.2);

    // 听者跟着相机
    const L = ctx.listener;
    const p = camera.position;
    const m = camera.matrixWorld.elements;
    const fx = -m[8], fy = -m[9], fz = -m[10], ux = m[4], uy = m[5], uz = m[6];
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, now, 0.03); L.positionY.setTargetAtTime(p.y, now, 0.03); L.positionZ.setTargetAtTime(p.z, now, 0.03);
      L.forwardX.setTargetAtTime(fx, now, 0.03); L.forwardY.setTargetAtTime(fy, now, 0.03); L.forwardZ.setTargetAtTime(fz, now, 0.03);
      L.upX.setTargetAtTime(ux, now, 0.03); L.upY.setTargetAtTime(uy, now, 0.03); L.upZ.setTargetAtTime(uz, now, 0.03);
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }

    // 风：一阵阵起伏
    const tt = now;
    const g = 0.5 + 0.5 * (Math.sin(tt * 0.13) * 0.5 + Math.sin(tt * 0.29 + 1.3) * 0.3 + Math.sin(tt * 0.67 + 2.1) * 0.2);
    set(this.windLow.gain, 0.25 + 0.5 * g, 0.4);
    for (const r of this.rustle) {
      const h = 0.5 + 0.5 * Math.sin(tt * 0.41 + r.seed) * Math.sin(tt * 0.17 + r.seed * 2);
      set(r.g.gain, 0.05 + 0.5 * g * g * (0.6 + 0.4 * h), 0.3);
      set(r.bp.frequency, 1800 + 1400 * g, 0.5);
    }

    // 溪水：最近那条溪上、上下游各一个声源
    const ri = riverInfo(p.x, p.z);
    const off = ri.d + ri.w;
    const wx = p.x - ri.ax * off, wz = p.z - ri.az * off;
    const wy = heightAt(wx, wz) + 0.2;
    this.waterSrc.forEach((w, i) => {
      const k = i ? -8 : 8;
      this.setPos(w.pan, wx + FLOW.x * k, wy, wz + FLOW.z * k);
      // 咕噜声的音调快速游走
      w.t -= dt;
      if (w.t < 0) {
        w.t = rand(0.03, 0.09);
        w.gbp.frequency.setTargetAtTime(rand(450, 1500), now, 0.015);
        w.gg.gain.setTargetAtTime(rand(0.03, 0.14), now, 0.02);
      }
    });
    const wet = Math.min(1, ri.w / 1.6) * Math.max(0, 1 - Math.max(0, ri.d) / 50);
    set(this.waterGain.gain, wet > 0.01 ? Math.min(1, ri.w / 1.6) : 0, 0.4);
    if (wet > 0.02 && T.water > 0) {
      if (this.nextBubble < now) this.nextBubble = now + 0.02;
      const rate = 60 + 90 * wet;
      while (this.nextBubble < now + 0.12) {
        this.bubble(this.nextBubble, this.waterSrc[Math.random() < 0.5 ? 0 : 1].g);
        this.nextBubble += -Math.log(1 - Math.random()) / rate;
      }
    }

    // 羊叫（同一时间不扎堆）
    while (flock.bleats.length) {
      const s = flock.bleats.shift();
      if (now - this.lastBleat < 2.2 || s.state === 'leave') continue;
      this.lastBleat = now;
      const hx = Math.sin(s.heading) * 0.55 * s.scale, hz = Math.cos(s.heading) * 0.55 * s.scale;
      this.bleat(s.x + hx, s.root.position.y + 0.75 * s.scale, s.z + hz, s.scale);
    }

    // 熊蜂
    const near = bees.nearest(p, this.beeVoices.length);
    this.beeVoices.forEach((v, i) => {
      const n = near[i];
      if (!n || n.d > 7) { set(v.g.gain, 0, 0.1); return; }
      const b = n.b;
      this.setPos(v.p, b.x, b.y, b.z);
      const f = v.base * (b.state === 'hover' ? 0.94 : 1.06) * (1 + 0.03 * Math.sin(b.phase * 13));
      set(v.o1.frequency, f, 0.05);
      set(v.o2.frequency, f * 1.018, 0.05);
      set(v.g.gain, 0.22 * b.grow, 0.08);
    });

    // 云雀
    this.nextLark -= dt;
    if (this.nextLark < 0) {
      this.nextLark = rand(9, 28);
      this.lark(p.x, p.y, p.z);
    }
  }
}
