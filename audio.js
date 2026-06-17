// Audio engine - Web Audio API (no files needed)
const Audio = {
  ctx: null,
  init() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
  },
  ensure() {
    if (!this.ctx) this.init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  beep(freq, dur, type = 'square', vol = 0.15) {
    this.ensure();
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = vol;
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(); o.stop(this.ctx.currentTime + dur);
  },
  shoot() { this.beep(800, 0.08, 'sawtooth', 0.1); },
  hit() { this.beep(150, 0.2, 'sine', 0.2); },
  correct() {
    this.beep(523, 0.1, 'sine', 0.12);
    setTimeout(() => this.beep(659, 0.1, 'sine', 0.12), 100);
    setTimeout(() => this.beep(784, 0.15, 'sine', 0.12), 200);
  },
  wrong() {
    this.beep(300, 0.15, 'sawtooth', 0.1);
    setTimeout(() => this.beep(200, 0.2, 'sawtooth', 0.1), 150);
  },
  reload() { this.beep(400, 0.05, 'triangle', 0.08); setTimeout(() => this.beep(600, 0.05, 'triangle', 0.08), 80); },
  gameOver() {
    [523,659,784,1047].forEach((f,i) => setTimeout(() => this.beep(f, 0.3, 'sine', 0.1), i*150));
  },
  tick() { this.beep(1000, 0.03, 'square', 0.05); },
  deflect() {
    this.beep(600, 0.08, 'sine', 0.1);
    setTimeout(() => this.beep(900, 0.1, 'sine', 0.1), 80);
    setTimeout(() => this.beep(1200, 0.12, 'sine', 0.1), 160);
  },
  damage() {
    this.beep(120, 0.25, 'sawtooth', 0.15);
    setTimeout(() => this.beep(80, 0.3, 'sawtooth', 0.12), 100);
  }
};
