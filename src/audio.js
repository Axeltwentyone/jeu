// Ambiance sonore 100 % synthétisée : circulation, oiseaux, grillons, musique du maquis.
export class Ambience {
  constructor() { this.ctx = null; this.enabled = true; }

  start() {
    if (this.ctx) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(ctx.destination);
    // bruit brun réutilisable
    const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    this.noiseBuf = buf;
    const wbuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), wd = wbuf.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
    this.whiteBuf = wbuf;

    // rumeur de la ville (circulation lointaine)
    const n = ctx.createBufferSource(); n.buffer = buf; n.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    this.city = ctx.createGain(); this.city.gain.value = 0.12;
    n.connect(lp).connect(this.city).connect(this.master); n.start();
    // vent / clapotis
    const n2 = ctx.createBufferSource(); n2.buffer = buf; n2.loop = true; n2.playbackRate.value = 1.7;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.4;
    this.wind = ctx.createGain(); this.wind.gain.value = 0.03;
    n2.connect(bp).connect(this.wind).connect(this.master); n2.start();

    this.music = ctx.createGain(); this.music.gain.value = 0; this.music.connect(this.master);
    this.nextBeat = ctx.currentTime + 0.1; this.step = 0;
    this.birdT = 0; this.cricketT = 0; this.hornT = 8;
  }

  /** Sons d'interface et d'interaction, synthétisés. */
  play(name) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const tone = (f, d, type = 'sine', v = 0.08, t0 = t, f2) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f, t0);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + d);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(v, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      o.connect(g).connect(this.master); o.start(t0); o.stop(t0 + d + 0.02);
    };
    const noise = (d, freq, v, t0 = t, type = 'bandpass') => {
      const src = ctx.createBufferSource(); src.buffer = this.whiteBuf; const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      const g = ctx.createGain(); g.gain.setValueAtTime(v, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      src.connect(f).connect(g).connect(this.master); src.start(t0, Math.random() * 0.5, d + 0.05);
    };
    if (name === 'click') tone(1400, 0.05, 'sine', 0.05);
    if (name === 'key') noise(0.03, 3500 + Math.random() * 1500, 0.12);
    if (name === 'error') { tone(220, 0.15, 'square', 0.04); tone(180, 0.2, 'square', 0.04, t + 0.12); }
    if (name === 'cash') { tone(1320, 0.12, 'triangle', 0.07); tone(1760, 0.25, 'triangle', 0.07, t + 0.08); noise(0.08, 6000, 0.05, t + 0.02, 'highpass'); }
    if (name === 'objective') { [660, 880, 1100].forEach((f, i) => tone(f, 0.25, 'sine', 0.06, t + i * 0.09)); }
    if (name === 'door') { noise(0.25, 300, 0.25, t, 'lowpass'); tone(90, 0.2, 'sine', 0.12, t + 0.02, 60); }
    if (name === 'honk') this.horn(t);
  }

  setEnabled(on) { this.enabled = on; if (this.master) this.master.gain.value = on ? 0.7 : 0; }

  /* --- sons ponctuels --- */
  chirp(t0, vol) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    const f = 2600 + Math.random() * 2400;
    o.frequency.setValueAtTime(f, t0); o.frequency.exponentialRampToValueAtTime(f * (0.6 + Math.random() * 0.8), t0 + 0.09);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    o.connect(g).connect(this.master); o.start(t0); o.stop(t0 + 0.15);
  }
  cricket(t0, vol) {
    const ctx = this.ctx;
    for (let k = 0; k < 3; k++) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 4300 + Math.random() * 300;
      const t = t0 + k * 0.05;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.linearRampToValueAtTime(0, t + 0.035);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.05);
    }
  }
  horn(t0) { // klaxon lointain de taxi
    const ctx = this.ctx, o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = o2.type = 'sawtooth'; o.frequency.value = 410; o2.frequency.value = 520; lp.type = 'lowpass'; lp.frequency.value = 1200;
    const dur = 0.25 + Math.random() * 0.4;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.025, t0 + 0.02); g.gain.setValueAtTime(0.025, t0 + dur); g.gain.linearRampToValueAtTime(0, t0 + dur + 0.05);
    o.connect(lp); o2.connect(lp); lp.connect(g).connect(this.master); o.start(t0); o2.start(t0); o.stop(t0 + dur + 0.1); o2.stop(t0 + dur + 0.1);
  }

  /* --- boucle "coupé-décalé" du maquis (kick, shaker, basse, guitare) --- */
  scheduleMusic() {
    const ctx = this.ctx, spb = 60 / 124 / 4; // doubles-croches à 124 bpm
    const bass = [45, 0, 45, 0, 0, 52, 0, 50, 45, 0, 45, 0, 0, 40, 43, 0];
    const gtr = [69, 76, 72, 76, 69, 76, 74, 76, 67, 74, 71, 74, 67, 74, 72, 74];
    while (this.nextBeat < ctx.currentTime + 0.25) {
      const t = this.nextBeat, s = this.step % 16, bar = Math.floor(this.step / 16) % 4;
      if (s % 4 === 0) { // grosse caisse
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
        g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        o.connect(g).connect(this.music); o.start(t); o.stop(t + 0.2);
      }
      { // shaker
        const src = ctx.createBufferSource(); src.buffer = this.whiteBuf; const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
        const g = ctx.createGain(); const v = s % 2 ? 0.05 : 0.09; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        src.connect(hp).connect(g).connect(this.music); src.start(t, Math.random() * 0.5, 0.06);
      }
      if (s === 4 || s === 12) { // claquement
        const src = ctx.createBufferSource(); src.buffer = this.whiteBuf; const bpf = ctx.createBiquadFilter(); bpf.type = 'bandpass'; bpf.frequency.value = 1800;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        src.connect(bpf).connect(g).connect(this.music); src.start(t, 0, 0.14);
      }
      const bn = bass[s] + (bar === 3 ? -2 : 0);
      if (bass[s]) {
        const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(); o.type = 'triangle'; lp.frequency.value = 500;
        o.frequency.value = 440 * Math.pow(2, (bn - 69) / 12);
        g.gain.setValueAtTime(0.28, t); g.gain.exponentialRampToValueAtTime(0.001, t + spb * 1.8);
        o.connect(lp).connect(g).connect(this.music); o.start(t); o.stop(t + spb * 2);
      }
      { // guitare "seben" pincée
        const note = gtr[s] + (bar >= 2 ? -3 : 0);
        const o = ctx.createOscillator(), g = ctx.createGain(), bpf = ctx.createBiquadFilter(); o.type = 'square'; bpf.type = 'bandpass'; bpf.frequency.value = 1500; bpf.Q.value = 2;
        o.frequency.value = 440 * Math.pow(2, (note - 69) / 12);
        g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        o.connect(bpf).connect(g).connect(this.music); o.start(t); o.stop(t + 0.18);
      }
      this.nextBeat += spb; this.step++;
    }
  }

  /** hour: heure de jeu ; distMaquis: distance au maquis (m) */
  update(dt, hour, distMaquis, day) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const night = 1 - day;
    this.city.gain.setTargetAtTime(0.06 + day * 0.08, now, 0.5);
    // oiseaux le jour (surtout le matin), grillons la nuit
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = 0.2 + Math.random() * (hour < 10 ? 1.2 : 3.5);
      if (day > 0.4) { const n = 1 + Math.floor(Math.random() * 4); for (let i = 0; i < n; i++) this.chirp(now + i * 0.13, 0.012 * day); }
    }
    this.cricketT -= dt;
    if (this.cricketT <= 0) { this.cricketT = 0.25 + Math.random() * 0.4; if (night > 0.5) this.cricket(now, 0.006 * night); }
    this.hornT -= dt;
    if (this.hornT <= 0) { this.hornT = 6 + Math.random() * 20; if (hour > 6 && hour < 22) this.horn(now); }
    // musique du maquis : surtout le soir, atténuée par la distance
    const open = hour >= 11 && hour < 24 ? 1 : hour < 1.5 ? 1 : 0;
    const loud = (hour >= 18 || hour < 1.5) ? 1 : 0.45;
    const vol = open * loud * Math.min(1, 5 / Math.max(5, distMaquis)) ** 1.3 * 0.55;
    this.music.gain.setTargetAtTime(vol, now, 0.3);
    if (vol > 0.002) this.scheduleMusic(); else this.nextBeat = now + 0.05;
  }
}
