// 背景音乐（“冬不拉曲”风格）：现场生成的一段哈萨克冬不拉曲（küy）。
//   冬不拉：两根弦按四度定弦（D3–G3），每次两根一起扫——上弦弹旋律，下弦是空弦 D 的持续音，
//           或者跟着上弦弹低四度的平行音（冬不拉最典型的声音）；
//   节奏：2/4 拍的“奔马”音型（每拍 咚–哒哒：下扫、上挑、下扫），偶尔换成均匀的十六分音符；
//   旋律：D 混合利底亚调式，常从高处起句、一路下行回到主音；一个两小节的动机重复、模进，
//         上句落在属音，下句落回主音；
//   低音：一把像库布孜的弓弦乐器拉着带沙沙擦弦声的持续音；有时有手鼓在每小节第一拍轻轻敲一下。
// 一段（四五十秒）：自由节奏的引子（慢慢扫几下空弦）→ 奔马段（主题 A 反复出现，中间穿插 B、C）→ 慢下来，收在一个长长的空弦扫弦上。
// 然后歇十几秒再来下一段。

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const D3 = 146.83;
const hz = (semi) => D3 * Math.pow(2, semi / 12);

// 上弦能弹的音（相对 D3 的半音数）：G3 A3 B3 C4 D4 E4 F#4 G4 A4 B4 C5 D5
const UP = [5, 7, 9, 10, 12, 14, 16, 17, 19, 21, 22, 24];
const TONIC = UP.indexOf(12);   // D4
// 两小节动机的音高走向（相对起音的音阶步数）
const SHAPES = [[0, 0, -1, -2], [0, 1, 0, -1], [0, 0, 0, -1], [0, -1, -2, -1], [0, 2, 1, 0], [0, -1, 0, -2], [0, 0, 1, -1]];

// 一拍里的扫弦：[拍内位置, 方向(1 下扫 / -1 上挑), 力度, 只扫上弦]
const PATTERNS = {
  gallop: [[0, 1, 1, false], [0.5, -1, 0.5, true], [0.75, 1, 0.75, false]],
  even: [[0, 1, 0.9, false], [0.25, -1, 0.5, true], [0.5, 1, 0.75, false], [0.75, -1, 0.5, true]],
  eighth: [[0, 1, 0.9, false], [0.5, 1, 0.7, false]],
  ring: [[0, 1, 1, false]],
};

export class KuyMusic {
  constructor(ctx, out) {
    this.ctx = ctx;
    // 混响：程序生成的衰减噪声当作冲激响应（越往后越暗）
    const conv = ctx.createConvolver();
    conv.buffer = this.impulse(2.8);
    const wet = ctx.createGain(); wet.gain.value = 0.38;
    const dry = ctx.createGain(); dry.gain.value = 0.7;
    this.in = ctx.createGain();
    this.in.connect(dry).connect(out);
    this.in.connect(conv).connect(wet).connect(out);
    // 冬不拉的琴身：低频和中高频两个共鸣峰
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 75;
    const body1 = ctx.createBiquadFilter(); body1.type = 'peaking'; body1.frequency.value = 230; body1.Q.value = 1.1; body1.gain.value = 5;
    const body2 = ctx.createBiquadFilter(); body2.type = 'peaking'; body2.frequency.value = 1700; body2.Q.value = 1.3; body2.gain.value = 3;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
    const pan = ctx.createStereoPanner(); pan.pan.value = -0.12;
    hp.connect(body1).connect(body2).connect(lp).connect(pan).connect(this.in);
    this.dombra = hp;
    this.bufs = new Map();
    this.last = [null, null];   // 两根弦各自正在响的音（新的一下会把它按住）
    this.next = ctx.currentTime + rand(12, 20);
  }

  impulse(sec) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / ctx.sampleRate;
        const k = 0.25 + 0.7 * Math.min(1, t / sec);
        lp += (Math.random() * 2 - 1 - lp) * (1 - k);
        d[i] = lp * Math.exp(-t * 2.6) * (t < 0.015 ? t / 0.015 : 1);
      }
    }
    return buf;
  }

  // 一根弦的一个音（Karplus–Strong 拨弦，羊肠弦：起音亮、衰减快），按音高缓存
  pluckBuffer(semi) {
    if (this.bufs.has(semi)) return this.bufs.get(semi);
    const ctx = this.ctx, sr = ctx.sampleRate, n = Math.floor(sr * 1.6);
    const buf = ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    const P = Math.max(2, Math.round(sr / hz(semi)));
    const ring = new Float32Array(P);
    let lp = 0;
    for (let i = 0; i < P; i++) { lp += (Math.random() * 2 - 1 - lp) * 0.8; ring[i] = lp; }
    let idx = 0;
    const pickAt = Math.round(P * 0.13);   // 拨弦位置靠近琴码：减掉一部分低次谐波，声音更“扁”更亮
    const hist = new Float32Array(P);
    for (let i = 0; i < n; i++) {
      const a = ring[idx], b = ring[(idx + 1) % P];
      ring[idx] = (a + b) * 0.5 * 0.992;
      hist[idx] = a;
      d[i] = a - 0.5 * hist[(idx - pickAt + P) % P];
      idx = (idx + 1) % P;
    }
    this.bufs.set(semi, buf);
    return buf;
  }

  // 拨一根弦：同一根弦上前一个还在响的音会被按住
  pluck(t, string, semi, vel) {
    const ctx = this.ctx;
    const prev = this.last[string];
    if (prev && prev.t < t) prev.g.gain.setTargetAtTime(0, t, 0.012);
    const s = ctx.createBufferSource();
    s.buffer = this.pluckBuffer(semi);
    s.playbackRate.value = 1 + (Math.random() - 0.5) * 0.003;
    const g = ctx.createGain(); g.gain.value = 0.092 * vel;
    s.connect(g).connect(this.dombra);
    s.start(t);
    s.stop(t + 1.6);
    this.last[string] = { t, g };
  }

  // 扫弦：下扫先低弦后高弦，上挑反过来；onlyUp = 只碰到上弦
  strum(t, lower, upper, dir, vel, onlyUp, spread = 0.012) {
    const j = () => (Math.random() - 0.5) * 0.008;
    if (onlyUp) { this.pluck(t + j(), 1, upper, vel * 0.8); return; }
    if (dir > 0) { this.pluck(t + j(), 0, lower, vel * 0.9); this.pluck(t + spread + j(), 1, upper, vel); }
    else { this.pluck(t + j(), 1, upper, vel * 0.85); this.pluck(t + spread * 0.8 + j(), 0, lower, vel * 0.6); }
  }

  // 低音持续音：像库布孜那样的擦弦声（锯齿波 + 带通的擦弦噪声 + 慢颤音）
  drone(t0, t1) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(hz(-2) , t0);             // 从 C3 滑上来
    osc.frequency.setTargetAtTime(hz(0), t0 + 0.2, 0.25);
    const vib = ctx.createOscillator(); vib.frequency.value = rand(4.2, 5.2);
    const vg = ctx.createGain(); vg.gain.value = 0.9;
    vib.connect(vg).connect(osc.frequency);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.8;
    const form = ctx.createBiquadFilter(); form.type = 'peaking'; form.frequency.value = 700; form.Q.value = 2; form.gain.value = 6;
    const g = ctx.createGain(); g.gain.value = 0;
    osc.connect(lp).connect(form).connect(g);
    // 擦弦的沙沙声
    const n = ctx.createBufferSource(); n.buffer = this.noise(); n.loop = true;
    const nb = ctx.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = 1800; nb.Q.value = 1.2;
    const ng = ctx.createGain(); ng.gain.value = 0.12;
    n.connect(nb).connect(ng).connect(g);
    const pan = ctx.createStereoPanner(); pan.pan.value = 0.2;
    g.connect(pan).connect(this.in);
    const L = 0.022;
    g.gain.setValueAtTime(0, t0);
    g.gain.setTargetAtTime(L, t0, 1.2);
    // 弓子换向时的起伏
    for (let t = t0 + rand(3, 5); t < t1 - 3; t += rand(3.5, 6)) {
      g.gain.setTargetAtTime(L * 0.6, t, 0.08);
      g.gain.setTargetAtTime(L * rand(0.9, 1.15), t + 0.25, 0.4);
    }
    g.gain.setTargetAtTime(0, t1 - 1.5, 0.8);
    for (const s of [osc, vib, n]) { s.start(t0); s.stop(t1 + 3); }
  }

  noise() {
    if (this._noise) return this._noise;
    const ctx = this.ctx, n = ctx.sampleRate * 2;
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return (this._noise = b);
  }

  // 手鼓：低沉的一下
  drum(t, vel) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(62, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09 * vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.35);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
    o.connect(g).connect(lp).connect(this.in);
    o.start(t); o.stop(t + 0.4);
  }

  // 一句（4 小节 = 8 拍）：两个动机，第二个模进下行，最后落在 target（UP 里的下标）
  phrase(start, target, evenP = 0.18) {
    const beats = [];
    const shapeA = pick(SHAPES);
    const shift = pick([0, -1, -1, -2]);
    const clamp = (i) => Math.max(0, Math.min(UP.length - 1, i));
    shapeA.forEach((d) => beats.push(clamp(start + d)));
    const s2 = start + shift;
    const shapeB = pick(SHAPES);
    beats.push(clamp(s2 + shapeB[0]), clamp(s2 + shapeB[1]));
    // 最后两拍走向落音
    const b6 = clamp(Math.round((beats[5] + target) / 2) + (Math.random() < 0.5 ? 1 : 0));
    beats.push(b6, target);
    return beats.map((idx, k) => ({
      idx,
      pat: k === 7 ? 'eighth' : k === 3 ? pick(['eighth', 'gallop']) : Math.random() < evenP ? 'even' : 'gallop',
      orn: Math.random() < 0.25,   // 上挑那一下碰到上方的邻音（左手的打音）
    }));
  }

  section(t0) {
    let t = t0;
    // —— 引子：自由节奏，慢慢扫几下空弦，再试探着弹几个音 ——
    const n0 = Math.floor(rand(2, 4));
    for (let i = 0; i < n0; i++) {
      this.strum(t, 0, 5, 1, rand(0.75, 0.95), false, rand(0.04, 0.07));
      t += rand(1.3, 2.0);
    }
    for (const s of pick([[12, 14, 12], [17, 14, 12], [12, 16, 17, 12]])) {
      this.strum(t, 0, s, 1, 0.8, false, 0.03);
      t += rand(0.55, 0.85);
    }
    const droneStart = t0 + rand(0.5, 2);
    t += 0.4;

    // —— 奔马段：几个部分（每部分是一对上下句），部分之间用一小节空弦的奔马音型连起来 ——
    // 主题 A 反复出现，中间穿插往高处走的 B、换成十六分音符和平行四度的 C；越往后越快一点
    let beat = 60 / rand(132, 146);
    const hi = UP.indexOf(pick([19, 21, 24]));
    const fifth = UP.indexOf(7);   // A3
    const clampI = (i) => Math.min(UP.length - 1, Math.max(0, i));
    const pair = (start, half, evenP) => {
      const a = this.phrase(start, half, evenP);
      return [a, a.slice(0, 6).concat(this.phrase(start, TONIC, evenP).slice(6))];
    };
    // 同一个主题再出现时，音不变，只换一换扫弦的花样
    const vary = (ph) => ph.map((b, k) => ({ ...b, orn: Math.random() < 0.3, pat: k === 7 || k === 3 ? b.pat : Math.random() < 0.2 ? 'even' : 'gallop' }));
    const themes = {
      A: pair(hi, pick([fifth, UP.indexOf(14)]), 0.15),
      B: pair(clampI(hi + pick([1, 2])), UP.indexOf(19), 0.15),
      C: pair(UP.indexOf(pick([14, 17])), fifth, 0.6),
    };
    const order = pick([['A', 'B', 'A', 'C', 'A'], ['A', 'B', 'C', 'B', 'A'], ['A', 'A', 'B', 'C', 'A'], ['A', 'B', 'A', 'C']]);
    const seen = {};
    const drumFrom = Math.random() < 0.7 ? 1 : 99;   // 手鼓多半从第二部分起加进来
    order.forEach((name, part) => {
      const phrases = seen[name] ? themes[name].map(vary) : themes[name];
      seen[name] = true;
      phrases.forEach((ph) => {
        const parallel = name === 'C' || Math.random() < 0.35;   // 下弦弹平行四度，还是空弦持续音
        ph.forEach((b, k) => {
          const up = UP[b.idx];
          const low = parallel ? Math.max(0, up - 5) : 0;
          const bar0 = k % 2 === 0;
          for (const [pos, dir, vel, onlyUp] of PATTERNS[b.pat]) {
            const u = onlyUp && b.orn && b.idx + 1 < UP.length ? UP[b.idx + 1] : up;
            this.strum(t + pos * beat, low, u, dir, vel * (bar0 && pos === 0 ? 1.1 : 0.95), onlyUp);
          }
          if (part >= drumFrom && bar0) this.drum(t, k === 0 ? 1 : 0.7);
          t += beat;
        });
      });
      if (part < order.length - 1) {
        // 过门：一小节空弦的奔马
        for (let i = 0; i < 2; i++) {
          for (const [pos, dir, vel, onlyUp] of PATTERNS.gallop) this.strum(t + pos * beat, 0, 12, dir, vel * 0.85, onlyUp);
          if (part >= drumFrom && i === 0) this.drum(t, 0.8);
          t += beat;
        }
        beat *= 0.985;
      }
    });

    // —— 收尾：空弦的奔马音型慢下来，最后一个长长的扫弦 ——
    let bt = beat;
    for (let i = 0; i < 4; i++) {
      for (const [pos, dir, vel, onlyUp] of PATTERNS.gallop) this.strum(t + pos * bt, 0, 12, dir, vel * (1 - i * 0.12), onlyUp);
      t += bt;
      bt *= 1.18;
    }
    this.strum(t, 0, 5, 1, 1, false, 0.06);
    this.strum(t + 0.02, 0, 12, 1, 0.7, false, 0.05);
    const end = t + 2.5;
    this.drone(droneStart, end);
    return end;
  }

  update(now) {
    if (now + 0.5 < this.next) return;
    const end = this.section(Math.max(now + 0.1, this.next));
    this.next = end + rand(12, 18);            // 一段之后歇十几秒
  }
}
