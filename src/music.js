// 背景音乐：现场生成的一段哈萨克风格的草原小曲——
//   冬不拉：两根空弦（D–A）按 6/8 拍弹“马蹄”节奏（强–弱、强–弱，下拨上挑），这是哈萨克音乐最鲜明的声音；
//   旋律：斯布斯额式的长笛，D 混合利底亚调式（明亮的大调色彩，七级是还原 C——哈萨克民歌里很常见），
//         五声音阶为骨架；民歌式的结构：一句、重复一句（换个落音）、往高处走一句、再回来，
//         句尾是拖得长长的音，颤音慢慢加深，长音前常带新疆音乐里那种快速的回音（上–本–下–本）。
// 一段先由冬不拉引出、最后冬不拉收尾，然后安静很久，让风声、水声、羊叫在前面。
// 全部经过一个大的混响，像从草原远处飘来。

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const D4 = 293.66;
const hz = (semi) => D4 * Math.pow(2, semi / 12);

// D 混合利底亚（相对 D4 的半音数）
const SCALE = [-5, -3, 0, 2, 4, 5, 7, 9, 10, 12, 14, 16, 17, 19];
const PENTA = new Set([-5, -3, 0, 2, 4, 7, 9, 12, 14, 16, 19]);
// 一小节（6 个八分音符）里的节奏型
const RHYTHMS = [[2, 1, 2, 1], [3, 2, 1], [2, 1, 3], [1, 1, 1, 2, 1], [3, 3], [2, 1, 1, 1, 1], [1, 2, 1, 2], [3, 1, 1, 1]];
const ENDINGS = [[6], [1, 1, 4], [2, 1, 3]];

export class Music {
  constructor(ctx, out, white) {
    this.ctx = ctx;
    this.white = white;
    // 混响：程序生成的衰减噪声当作冲激响应（越往后越暗）
    const conv = ctx.createConvolver();
    conv.buffer = this.impulse(3.2);
    const wet = ctx.createGain(); wet.gain.value = 0.45;
    const dry = ctx.createGain(); dry.gain.value = 0.65;
    this.in = ctx.createGain();
    this.in.connect(dry).connect(out);
    this.in.connect(conv).connect(wet).connect(out);
    // 笛子的音色：基音为主，几个弱泛音
    const real = new Float32Array([0, 1, 0.42, 0.2, 0.1, 0.05, 0.025]);
    this.wave = ctx.createPeriodicWave(real, new Float32Array(real.length));
    this.plucks = {
      D3: this.pluckBuffer(146.83), A3: this.pluckBuffer(220), G3: this.pluckBuffer(196), D4: this.pluckBuffer(293.66),
    };
    this.next = ctx.currentTime + rand(12, 20);   // 先只有自然声，过一会儿才第一次响起
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
        d[i] = lp * Math.exp(-t * 2.4) * (t < 0.02 ? t / 0.02 : 1);
      }
    }
    return buf;
  }

  // 冬不拉的一根弦（Karplus–Strong 拨弦）
  pluckBuffer(f) {
    const ctx = this.ctx, sr = ctx.sampleRate, n = Math.floor(sr * 2.5);
    const buf = ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    const P = Math.round(sr / f);
    const ring = new Float32Array(P);
    let lp = 0;
    for (let i = 0; i < P; i++) { lp += (Math.random() * 2 - 1 - lp) * 0.6; ring[i] = lp; }
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const a = ring[idx], b = ring[(idx + 1) % P];
      ring[idx] = (a + b) * 0.5 * 0.996;
      d[i] = a;
      idx = (idx + 1) % P;
    }
    return buf;
  }

  // 扫弦：down = 从低到高（下拨，重），否则从高到低（上挑，轻、亮）
  strum(t, names, vel, down) {
    const ctx = this.ctx;
    if (!this.dombra) {
      const pan = ctx.createStereoPanner(); pan.pan.value = -0.25;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
      lp.connect(pan).connect(this.in);
      this.dombra = lp;
    }
    const order = down ? names : [...names].reverse();
    order.forEach((nm, j) => {
      const s = ctx.createBufferSource();
      s.buffer = this.plucks[nm];
      s.playbackRate.value = 1 + (Math.random() - 0.5) * 0.002;
      const g = ctx.createGain(); g.gain.value = 0.085 * vel * (down ? 1 : 0.7);
      s.connect(g).connect(this.dombra);
      s.start(t + j * (down ? 0.016 : 0.011));
      s.stop(t + 2.5);
    });
  }

  // 一句旋律（4 小节 6/8）：音符 [{semi, n(八分音符数)}]
  phrase(startSemi, peakSemi, endSemi) {
    const idx = (s) => { let b = 0; for (let i = 0; i < SCALE.length; i++) if (Math.abs(SCALE[i] - s) < Math.abs(SCALE[b] - s)) b = i; return b; };
    const bars = [pick(RHYTHMS), pick(RHYTHMS), pick(RHYTHMS), pick(ENDINGS)];
    const notes = [];
    bars.forEach((r, bi) => r.forEach((n, j) => notes.push({ n, bar: bi, onset: r.slice(0, j).reduce((a, b) => a + b, 0) })));
    const N = notes.length, peakAt = Math.floor(N * rand(0.35, 0.6));
    const i0 = idx(startSemi), ip = idx(peakSemi), ie = idx(endSemi);
    notes.forEach((nt, k) => {
      let target;
      if (k === N - 1) target = ie;
      else if (k <= peakAt) target = i0 + (ip - i0) * (k / Math.max(1, peakAt));
      else target = ip + (ie - ip) * ((k - peakAt) / (N - 1 - peakAt));
      let i = Math.round(target + (k && k < N - 1 ? pick([-1, 0, 0, 1]) : 0));
      i = Math.max(0, Math.min(SCALE.length - 1, i));
      let semi = SCALE[i];
      // 强拍（每小节第 1、4 个八分音符）和长音落在五声音阶的骨干音上
      if ((nt.onset === 0 || nt.onset === 3 || nt.n >= 3) && !PENTA.has(semi)) semi = SCALE[Math.min(SCALE.length - 1, i + 1)];
      nt.semi = k === N - 1 ? endSemi : semi;
    });
    return notes;
  }

  // 改写句尾（重复一句时换个落音）
  reEnd(notes, endSemi) {
    const out = notes.map((n) => ({ ...n }));
    const last = out.filter((n) => n.bar === 3);
    const pre = out.filter((n) => n.bar < 3);
    const fresh = this.phrase(pre.length ? pre[pre.length - 1].semi : 0, endSemi + 4, endSemi).filter((n) => n.bar === 3);
    return last.length ? [...pre, ...fresh] : out;
  }

  // 用一个持续发声的“笛子”吹一句（音和音连着，倚音、回音、颤音都在一条声音上）
  play(t0, notes, e, finalHold) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.setPeriodicWave(this.wave);
    const vib = ctx.createOscillator(); vib.frequency.value = rand(5.0, 5.8);
    const vibG = ctx.createGain(); vibG.gain.value = 0;
    vib.connect(vibG).connect(osc.frequency);
    const mix = ctx.createGain();
    osc.connect(mix);
    const br = ctx.createBufferSource(); br.buffer = this.white; br.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.8;
    const bg = ctx.createGain(); bg.gain.value = 0.12;
    br.connect(bp).connect(bg).connect(mix);
    // 一点点喉音持续音
    const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 146.83;
    const hlp = ctx.createBiquadFilter(); hlp.type = 'lowpass'; hlp.frequency.value = 380;
    const hg = ctx.createGain(); hg.gain.value = 0.09;
    hum.connect(hlp).connect(hg).connect(mix);
    const amp = ctx.createGain(); amp.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200;
    const pan = ctx.createStereoPanner(); pan.pan.value = 0.18;
    mix.connect(amp).connect(lp).connect(pan).connect(this.in);

    const F = osc.frequency, A = amp.gain, VG = vibG.gain;
    let t = t0;
    F.setValueAtTime(hz(notes[0].semi) * 0.98, t0);
    A.setValueAtTime(0, t0);
    notes.forEach((nt, k) => {
      const last = k === notes.length - 1;
      const f = hz(nt.semi);
      let dur = nt.n * e * (1 + (Math.random() - 0.5) * 0.06);
      if (last) dur += finalHold;
      const L = 0.07 * (0.9 + 0.1 * Math.min(1, (nt.semi + 5) / 24)) * (nt.onset === 0 ? 1.08 : 1);
      // 长音前的回音（上–本–下–本，很快），新疆音乐里常见的装饰
      const turn = nt.n >= 3 && k > 0 && Math.random() < 0.45;
      if (turn) {
        const up = f * Math.pow(2, 2 / 12), dn = f * Math.pow(2, -2 / 12);
        F.setTargetAtTime(up, t, 0.008); F.setTargetAtTime(f, t + 0.055, 0.008);
        F.setTargetAtTime(dn, t + 0.11, 0.008); F.setTargetAtTime(f, t + 0.165, 0.01);
      } else {
        F.setTargetAtTime(f, t, k === 0 ? 0.05 : (nt.n >= 3 && Math.random() < 0.3 ? 0.06 : 0.018));
      }
      VG.setTargetAtTime(f * 0.003, t, 0.04);
      if (k === 0) A.setTargetAtTime(L, t, 0.06);
      else { A.setTargetAtTime(L * 0.5, t, 0.008); A.setTargetAtTime(L, t + 0.035, 0.03); }
      if (dur > 1.0) {
        A.setTargetAtTime(L * 1.12, t + 0.12, dur * 0.25);
        VG.setTargetAtTime(f * 0.012, t + 0.35, dur * 0.25);
        if (last) A.setTargetAtTime(L * 0.55, t + dur * 0.55, dur * 0.25);
      }
      t += dur;
    });
    A.setTargetAtTime(0, t - 0.35, 0.18);
    const stop = t + 2;
    for (const s of [osc, vib, br, hum]) { s.start(t0); s.stop(stop); }
  }

  // 一整段：冬不拉引子 2 小节 → 2～4 句旋律（冬不拉一直弹着）→ 冬不拉收尾
  section(t0) {
    const e = rand(0.27, 0.31);                // 八分音符的长度（附点四分 ≈ 65–75 拍/分）
    const bar = 6 * e;
    // 民歌式结构：A（落在 A）、A′（落回 D）、B（往高处走，落在 A）、A′
    const A = this.phrase(pick([0, 4, 7]), pick([12, 14]), 7);
    const A2 = this.reEnd(A, 0);
    const B = this.phrase(pick([7, 9]), pick([16, 19]), pick([7, 9]));
    const plan = Math.random() < 0.6 ? [A, A2, B, A2] : [A, A2];
    const intro = 2, outro = 2;
    const bars = intro + plan.length * 4 + outro;
    // 冬不拉：每小节“强–弱、强–弱”（第 1、3、4、6 个八分音符），旋律落在 G / C 的小节换成 G–D 指法
    for (let b = 0; b < bars; b++) {
      const tb = t0 + b * bar;
      const pi = Math.floor((b - intro) / 4), pb = (b - intro) % 4;
      const ph = b >= intro && pi < plan.length ? plan[pi] : null;
      const strong = ph ? ph.find((n) => n.bar === pb && n.onset === 0) : null;
      const chord = strong && (strong.semi % 12 === 5 || strong.semi % 12 === 10 || strong.semi === -7) ? ['G3', 'D4'] : ['D3', 'A3'];
      const fade = b < bars - outro ? 1 : b === bars - 1 ? 0.5 : 0.75;
      if (b === bars - 1) { this.strum(tb, ['D3', 'A3', 'D4'], 0.8, true); break; }
      const swing = () => (Math.random() - 0.5) * 0.02;
      this.strum(tb + swing(), chord, 1.0 * fade, true);
      this.strum(tb + 2 * e + swing(), chord, 0.55 * fade, false);
      this.strum(tb + 3 * e + swing(), chord, 0.85 * fade, true);
      this.strum(tb + 5 * e + swing(), chord, 0.55 * fade, false);
    }
    plan.forEach((ph, i) => {
      const ts = t0 + (intro + i * 4) * bar;
      // 句尾长音稍微收短一点换气；最后一句拖进收尾的小节里
      const hold = i === plan.length - 1 ? bar * 1.2 : -0.18;
      this.play(ts, ph, e, hold);
    });
    return t0 + bars * bar;
  }

  update(now) {
    if (now + 0.5 < this.next) return;
    const end = this.section(Math.max(now + 0.1, this.next));
    this.next = end + rand(35, 80);            // 一段之后安静很久
  }
}
