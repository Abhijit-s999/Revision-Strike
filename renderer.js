// Canvas Renderer for Revision Strike
const Renderer = {
  canvas: null, ctx: null,
  W: 0, H: 0,
  particles: [],

  init() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  },

  resize() {
    // Fixed logical resolution so physics are perfectly synced across different screen sizes
    this.W = 1200;
    this.H = 700;
    this.canvas.width = this.W;
    this.canvas.height = this.H;

    const bar = document.querySelector('.hud-bar');
    const ctrl = document.querySelector('.controls-bar');
    const barH = bar ? bar.offsetHeight : 40;
    const ctrlH = ctrl ? ctrl.offsetHeight : 30;
    const availW = window.innerWidth;
    const availH = window.innerHeight - barH - ctrlH;

    // Scale canvas to fit window
    const scale = Math.min(availW / this.W, availH / this.H);
    this.canvas.style.width = `${this.W * scale}px`;
    this.canvas.style.height = `${this.H * scale}px`;
    this.canvas.style.position = 'absolute';
    this.canvas.style.left = `${(availW - this.W * scale) / 2}px`;
    this.canvas.style.top = `${barH + (availH - this.H * scale) / 2}px`;
  },

  clear() {
    this.ctx.fillStyle = '#0a0a1a';
    this.ctx.fillRect(0, 0, this.W, this.H);
  },

  drawWalls(walls) {
    this.ctx.fillStyle = '#1e1e3a';
    this.ctx.strokeStyle = '#2a2a5a';
    this.ctx.lineWidth = 2;
    walls.forEach(w => {
      this.ctx.fillRect(w.x, w.y, w.w, w.h);
      this.ctx.strokeRect(w.x, w.y, w.w, w.h);
    });
  },

  drawPlayer(p, color, dirAngle) {
    const c = this.ctx;
    // Body circle
    c.fillStyle = color;
    c.shadowColor = color;
    c.shadowBlur = 15;
    c.beginPath();
    c.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;

    // Direction indicator (gun barrel)
    const bx = p.x + Math.cos(dirAngle) * (p.r + 8);
    const by = p.y + Math.sin(dirAngle) * (p.r + 8);
    c.strokeStyle = color;
    c.lineWidth = 4;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(p.x + Math.cos(dirAngle) * p.r, p.y + Math.sin(dirAngle) * p.r);
    c.lineTo(bx, by);
    c.stroke();

    // Eyes
    const eyeOff = 4;
    const ex1 = p.x + Math.cos(dirAngle - 0.4) * eyeOff;
    const ey1 = p.y + Math.sin(dirAngle - 0.4) * eyeOff;
    const ex2 = p.x + Math.cos(dirAngle + 0.4) * eyeOff;
    const ey2 = p.y + Math.sin(dirAngle + 0.4) * eyeOff;
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(ex1, ey1, 2.5, 0, Math.PI*2); c.fill();
    c.beginPath(); c.arc(ex2, ey2, 2.5, 0, Math.PI*2); c.fill();

    // Name above
    c.fillStyle = color;
    c.font = '10px "Press Start 2P"';
    c.textAlign = 'center';
    c.fillText(p.name.substring(0,8), p.x, p.y - p.r - 10);
  },

  drawBullet(b, color) {
    const c = this.ctx;
    c.fillStyle = '#ff4757';
    c.shadowColor = '#ff4757';
    c.shadowBlur = 8;
    c.beginPath();
    c.arc(b.x, b.y, 4, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;
    // Trail
    c.strokeStyle = 'rgba(255,71,87,0.3)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(b.x, b.y);
    c.lineTo(b.x - b.vx * 3, b.y - b.vy * 3);
    c.stroke();
  },

  addParticle(x, y, color, count = 10) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 3;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        color,
        size: 2 + Math.random() * 3
      });
    }
  },

  updateParticles() {
    this.particles = this.particles.filter(p => p.life > 0);
    const c = this.ctx;
    this.particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.03;
      if (p.life > 0) {
        c.globalAlpha = p.life;
        c.fillStyle = p.color;
        c.beginPath();
        c.arc(p.x, p.y, Math.max(0, p.size * p.life), 0, Math.PI * 2);
        c.fill();
      }
    });
    c.globalAlpha = 1;
  },

  drawGrid() {
    const c = this.ctx;
    c.strokeStyle = 'rgba(255,255,255,0.02)';
    c.lineWidth = 1;
    for (let x = 0; x < this.W; x += 40) {
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, this.H); c.stroke();
    }
    for (let y = 0; y < this.H; y += 40) {
      c.beginPath(); c.moveTo(0, y); c.lineTo(this.W, y); c.stroke();
    }
  },

  drawShield(x, y, radius) {
    const c = this.ctx;
    c.strokeStyle = '#2ed573';
    c.shadowColor = '#2ed573';
    c.shadowBlur = 20;
    c.lineWidth = 3;
    c.beginPath();
    c.arc(x, y, radius + 12, 0, Math.PI * 2);
    c.stroke();
    c.shadowBlur = 0;
  },

  render(state) {
    this.clear();
    this.drawGrid();
    this.drawWalls(state.walls);
    state.bullets.forEach(b => this.drawBullet(b));
    this.drawPlayer(state.p1, '#00ffaa', state.p1.angle);
    this.drawPlayer(state.p2, '#ff6644', state.p2.angle);
    if (state.p1.shieldTimer > 0) this.drawShield(state.p1.x, state.p1.y, state.p1.r);
    if (state.p2.shieldTimer > 0) this.drawShield(state.p2.x, state.p2.y, state.p2.r);
    this.updateParticles();
  }
};
