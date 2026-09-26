// Fully synthesized sound: water plops, gloopy merges, underwater booms. No samples.

export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private wet!: GainNode;
  private dry!: GainNode;
  private noise!: AudioBuffer;
  muted = false;
  private last = new Map<string, number>();

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(comp).connect(ctx.destination);
    this.dry = ctx.createGain();
    this.dry.connect(this.master);
    // underwater-ish room: short dark reverb
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    conv.buffer = ir;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.28;
    this.wet.connect(lp).connect(conv).connect(this.master);
    const nl = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, nl, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nl; i++) nd[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  private ok(key: string, gap: number) {
    if (!this.ctx || this.muted) return false;
    const now = this.ctx.currentTime;
    if ((this.last.get(key) ?? -1) > now - gap) return false;
    this.last.set(key, now);
    return true;
  }

  private out(node: AudioNode, wet = 0.5) {
    node.connect(this.dry);
    const s = this.ctx!.createGain();
    s.gain.value = wet;
    node.connect(s).connect(this.wet);
  }

  /** resonant bubble "bloop": rising sine chirp */
  private blip(t: number, f0: number, f1: number, dur: number, vol: number, wet = 0.5) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const gn = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn);
    this.out(gn, wet);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseBurst(t: number, dur: number, vol: number, f0: number, f1: number, q = 1, type: BiquadFilterType = 'lowpass', wet = 0.5) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(gn);
    this.out(gn, wet);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  plop(size: number) {
    if (!this.ok('plop', 0.04)) return;
    const t = this.ctx!.currentTime;
    const base = 520 / (0.6 + size * 1.4);
    this.blip(t, base, base * 2.4, 0.13, 0.35);
    this.noiseBurst(t, 0.12, 0.12, 3000, 600, 0.8, 'bandpass', 0.3);
  }

  release() {
    if (!this.ok('release', 0.05)) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(t, 0.07, 0.05, 1800, 900, 2, 'bandpass', 0.1);
    this.blip(t + 0.01, 900, 1300, 0.05, 0.06, 0.1);
  }

  merge(tier: number, kind: string, combo: number) {
    if (!this.ok('merge', 0.03)) return;
    const t = this.ctx!.currentTime;
    const f = 380 * Math.pow(0.86, tier) * (1 + Math.min(combo - 1, 8) * 0.06);
    this.blip(t, f, f * 1.9, 0.18, 0.32);
    this.blip(t + 0.05, f * 1.5, f * 2.6, 0.14, 0.18);
    this.blip(t, f * 0.5, f * 0.35, 0.25, 0.25, 0.2);
    this.noiseBurst(t, 0.16, 0.08, 1200, 300, 1.2, 'lowpass', 0.4);
    if (kind === 'gold' || kind === 'opal' || kind === 'pearl') {
      [1, 1.25, 1.5, 2].forEach((m, i) => this.blip(t + 0.08 + i * 0.06, f * 2 * m, f * 2 * m * 1.02, 0.5, 0.08, 0.9));
    }
    if (kind === 'mud') this.blip(t, 110, 70, 0.3, 0.3, 0.2);
  }

  impact(speed: number) {
    if (!this.ok('impact', 0.06)) return;
    const t = this.ctx!.currentTime;
    this.blip(t, 140 + Math.random() * 40, 90, 0.12, Math.min(0.2, speed * 0.02), 0.3);
  }

  bubble() {
    if (!this.ok('bubble', 0.07)) return;
    const t = this.ctx!.currentTime;
    const f = 900 + Math.random() * 1400;
    this.blip(t, f, f * 1.6, 0.05, 0.04, 0.6);
  }

  fuse() {
    if (!this.ok('fuse', 0.12)) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(t, 0.1, 0.03, 5000, 3000, 3, 'bandpass', 0.3);
  }

  explode(tier: number) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const big = 1 + tier * 0.15;
    this.noiseBurst(t, 1.3 * big, 0.7, 2600, 90, 0.7, 'lowpass', 0.8);
    const o = ctx.createOscillator();
    const gn = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.9);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(0.9, t + 0.02);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 1.2 * big);
    o.connect(gn);
    this.out(gn, 0.4);
    o.start(t);
    o.stop(t + 1.4 * big);
    for (let i = 0; i < 16; i++) {
      const tt = t + 0.1 + Math.random() * 0.9;
      const f = 500 + Math.random() * 1800;
      this.blip(tt, f, f * 1.7, 0.05 + Math.random() * 0.05, 0.05, 0.7);
    }
  }

  discover() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => this.blip(t + i * 0.09, f, f * 1.01, 0.7, 0.09, 0.9));
  }

  gameOver() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    [392, 330, 262, 196].forEach((f, i) => this.blip(t + i * 0.18, f, f * 0.98, 0.8, 0.12, 0.9));
    this.noiseBurst(t, 2.5, 0.25, 800, 60, 0.7, 'lowpass', 0.9);
  }

  ui() {
    if (!this.ok('ui', 0.05)) return;
    const t = this.ctx!.currentTime;
    this.blip(t, 700, 1000, 0.06, 0.08, 0.3);
  }
}
