// Revision Strike — proper multiplayer + character abilities
//
// Modes:
//   - Solo: one player; P2 is an idle dummy (for practice)
//   - Online MP (host): runs authoritative physics, broadcasts state, routes quizzes
//   - Online MP (guest): sends input to host, receives state, shows UI via RPC
//
// Controls (per device): WASD = move, SPACE = shoot
//   - In online MP, the *local* player is either P1 (host) or P2 (guest).
//   - In solo, the local player is always P1; P2 is a stationary bot.
//
// Quiz routing:
//   - When a bullet hits a player, that player is the "defender" and must answer.
//   - The *other* player sees a spectate overlay with live answer previews.
//   - Standoff: both bullets collide within 500ms → both players get the SAME question;
//              first correct answer wins, or draw on timeout / both wrong.

const Game = {
  state: 'lobby',
  p1: null, p2: null,
  bullets: [],
  walls: [],
  keys: {},
  animId: null,
  topic: '__all__',
  questionPool: [],
  stats: { p1Correct: 0, p1Total: 0, p2Correct: 0, p2Total: 0, totalShots: 0, p1Score: 0, p2Score: 0 },
  lastP1Shot: 0, lastP2Shot: 0,
  STANDOFF_WINDOW: 500,
  p1Streak: 0, p2Streak: 0,
  localPlayer: 'p1',  // 'p1' or 'p2' — which player am I controlling?
  soloMode: false,    // true when playing offline vs dummy
  reloadWords: [
    ['Recargar','Reload'],['Fuego','Fire'],['Rapido','Fast'],['Listo','Ready'],
    ['Vamos','Let\'s go'],['Preparar','Prepare'],['Fuerza','Strength'],['Victoria','Victory']
  ],

  // === Character abilities ===
  // Each character has a passive buff. Balanced around a baseline of
  // speed=3.5, maxAmmo=3, bullet speed=7, shield=180f (~3s).
  CHAR_ABILITIES: [
    { name: 'El Matador', emoji: '🤺', ability: 'Estocada', desc: 'Bullets 40% faster + dash',
      bulletSpeed: 1.4, moveSpeed: 1.0, maxAmmo: 3, reloadMult: 1.0,
      shieldMult: 1.0, quizTimerBonus: 0, healOnCorrect: 0, regenRate: 0,
      dodgeChance: 0, dashCooldown: 300 },
    { name: 'La Bailarina', emoji: '💃', ability: 'Gracia', desc: '+15% speed, 25% dodge',
      bulletSpeed: 1.0, moveSpeed: 1.15, maxAmmo: 3, reloadMult: 1.0,
      shieldMult: 0.7, quizTimerBonus: 0, healOnCorrect: 0, regenRate: 0,
      dodgeChance: 0.25, dashCooldown: 0 },
    { name: 'El Chef', emoji: '👨‍🍳', ability: 'Sazón', desc: '4 ammo, fast reload, heal +10',
      bulletSpeed: 1.0, moveSpeed: 1.0, maxAmmo: 4, reloadMult: 0.7,
      shieldMult: 1.0, quizTimerBonus: 0, healOnCorrect: 10, regenRate: 0,
      dodgeChance: 0, dashCooldown: 0 },
    { name: 'La Doctora', emoji: '👩‍⚕️', ability: 'Cura', desc: 'HP regen, +50% shield, +3s quiz',
      bulletSpeed: 1.0, moveSpeed: 1.0, maxAmmo: 3, reloadMult: 1.0,
      shieldMult: 1.5, quizTimerBonus: 3, healOnCorrect: 0, regenRate: 1,
      dodgeChance: 0, dashCooldown: 0 }
  ],

  init() {
    UI.init();
    UI.buildTopicGrid();
    this.bindEvents();
  },

  bindEvents() {
    document.getElementById('lobby-start-btn').onclick = () => {
      Net.mirrorClick('lobby-start-btn');
      this.goToCharSelect();
    };
    document.getElementById('rematch-btn').onclick = () => {
      Net.mirrorClick('rematch-btn');
      if (Net.connected && !Net.isHost) return; // guest waits for host's startArena RPC
      if (Net.connected && Net.isHost) {
        Net.send({ t: 'rpc', cmd: 'startArena', picks: this._csPicks || { p1: 0, p2: 1 } });
      }
      this.startArena();
    };
    document.getElementById('go-lobby-btn').onclick = () => {
      Net.mirrorClick('go-lobby-btn');
      this.state = 'lobby';
      Net.captureKeys(false);
      UI.showScreen('lobby');
    };
    ['p1-name','p2-name'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => Net.mirrorInput(id));
    });
    const coopBtn = document.getElementById('btn-coop');
    if (coopBtn) coopBtn.onclick = () => Net.start();
    const soloBtn = document.getElementById('btn-solo');
    if (soloBtn) soloBtn.onclick = () => {
      this.soloMode = true;
      this.goToCharSelect();
    };
  },

  // === Character select (single char per device in MP, both cards in solo) ===
  goToCharSelect() {
    const localName = (document.getElementById('p1-name').value.trim()) || 'You';
    const remoteName = (document.getElementById('p2-name').value.trim()) || 'Opponent';

    // In online MP, the local player picks exactly one character for themselves.
    // In solo, the local player picks their own character; P2 (dummy) defaults to #1.
    const online = Net.connected;
    this.topic = UI.selectedTopic;
    this._csStarted = false; // reset so rematch works

    if (online) {
      const role = Net.localRole;          // 'p1' or 'p2'
      const myName = role === 'p1' ? localName : remoteName;
      UI.buildCharSelectSingle(myName, role);
      UI.showScreen('charselect');
      this.state = 'charselect';
      this._csConfirmed = { p1: false, p2: false };

      const csHandler = (e) => {
        if (this.state !== 'charselect') return;
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        const cards = document.querySelectorAll('#char-grid-me .char-card');
        if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') this._cycleChar(cards, 'me', -1);
        if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') this._cycleChar(cards, 'me', 1);
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          if (this._csConfirmed[role]) return;
          this._csConfirmed[role] = true;
          const idx = UI.getSelectedSingleIdx();
          if (!this._csPicks) this._csPicks = { p1: 0, p2: 0 };
          this._csPicks[role] = idx;
          document.getElementById('cs-me-confirmed').classList.remove('hidden');
          Audio.correct();
          // Tell peer my pick — use dedicated 'csPick' type so host also receives it from guest
          Net.send({ t: 'csPick', role, idx, confirmed: true });
          this._csCheckBothReady();
        }
      };
      window.addEventListener('keydown', csHandler);
      this._csHandler = csHandler;
    } else {
      // Solo: pick MY char; P2 is a dummy using El Matador.
      UI.buildCharSelectSingle(localName, 'p1');
      UI.showScreen('charselect');
      this.state = 'charselect';
      this._csConfirmed = { p1: false, p2: true };     // bot auto-ready
      this._csPicks = { p1: 0, p2: 0 };

      const csHandler = (e) => {
        if (this.state !== 'charselect') return;
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        const cards = document.querySelectorAll('#char-grid-me .char-card');
        if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') this._cycleChar(cards, 'me', -1);
        if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') this._cycleChar(cards, 'me', 1);
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          if (this._csConfirmed.p1) return;
          this._csConfirmed.p1 = true;
          this._csPicks.p1 = UI.getSelectedSingleIdx();
          document.getElementById('cs-me-confirmed').classList.remove('hidden');
          Audio.correct();
          window.removeEventListener('keydown', csHandler);
          setTimeout(() => this.startArena(), 400);
        }
      };
      window.addEventListener('keydown', csHandler);
      this._csHandler = csHandler;
    }
  },

  _cycleChar(cards, who, dir) {
    if (!cards || cards.length === 0) return;
    const cls = `selected-${who}`;
    let cur = 0;
    cards.forEach((c, i) => { if (c.classList.contains(cls)) cur = i; });
    cards[cur].classList.remove(cls);
    cur = (cur + dir + cards.length) % cards.length;
    cards[cur].classList.add(cls);
    Audio.tick();
  },

  // Remote peer picked a character / confirmed. Received by BOTH host and guest.
  handleCsPick(data) {
    if (!this._csPicks) this._csPicks = { p1: 0, p2: 0 };
    if (!this._csConfirmed) this._csConfirmed = { p1: false, p2: false };
    this._csPicks[data.role] = data.idx;
    if (data.confirmed) this._csConfirmed[data.role] = true;
    // Show "opponent ready" banner
    const el = document.getElementById('cs-them-confirmed');
    if (el) {
      el.classList.remove('hidden');
      el.textContent = '✅ Opponent ready!';
    }
    this._csCheckBothReady();
  },

  _csCheckBothReady() {
    if (!this._csConfirmed) return;
    if (!this._csConfirmed.p1 || !this._csConfirmed.p2) return;
    if (this._csStarted) return; // prevent double-fire
    this._csStarted = true;
    if (this._csHandler) { window.removeEventListener('keydown', this._csHandler); this._csHandler = null; }

    if (Net.isHost) {
      // Host is authoritative: pick the final character indices and tell guest to start.
      // By now _csPicks has both players' choices (host saved its own when confirming,
      // guest's arrived via csPick message).
      const picks = this._csPicks || { p1: 0, p2: 0 };
      const p1n = document.getElementById('p1-name').value.trim() || 'Player 1';
      const p2n = document.getElementById('p2-name').value.trim() || 'Player 2';
      Net.send({ t: 'rpc', cmd: 'startArena', picks, p1Name: p1n, p2Name: p2n });
      setTimeout(() => this.startArena(), 400);
    }
    // Guest does nothing here — it waits for the host's 'startArena' RPC.
  },

  generateWalls(W, H) {
    const walls = [];
    const hW = W / 2;
    walls.push({ x: hW-15, y: H*0.05, w: 30, h: 55 });
    walls.push({ x: hW-15, y: H*0.8, w: 30, h: 55 });
    walls.push({ x: hW-60, y: H/2-8, w: 120, h: 16 });
    walls.push({ x: hW-8, y: H*0.3, w: 16, h: 40 });
    walls.push({ x: hW-8, y: H*0.6, w: 16, h: 40 });
    const qx = W * 0.25;
    walls.push({ x: qx-25, y: H*0.18, w: 50, h: 50 });
    walls.push({ x: qx-25, y: H*0.62, w: 50, h: 50 });
    walls.push({ x: W-qx-25, y: H*0.18, w: 50, h: 50 });
    walls.push({ x: W-qx-25, y: H*0.62, w: 50, h: 50 });
    walls.push({ x: W*0.15, y: H*0.35, w: 18, h: 100 });
    walls.push({ x: W*0.85-18, y: H*0.35, w: 18, h: 100 });
    walls.push({ x: W*0.08, y: H*0.1, w: 60, h: 14 });
    walls.push({ x: W*0.08, y: H*0.1, w: 14, h: 55 });
    walls.push({ x: W*0.92-60, y: H*0.1, w: 60, h: 14 });
    walls.push({ x: W*0.92-14, y: H*0.1, w: 14, h: 55 });
    walls.push({ x: W*0.08, y: H*0.82, w: 60, h: 14 });
    walls.push({ x: W*0.08, y: H*0.72, w: 14, h: 55 });
    walls.push({ x: W*0.92-60, y: H*0.82, w: 60, h: 14 });
    walls.push({ x: W*0.92-14, y: H*0.72, w: 14, h: 55 });
    walls.push({ x: W*0.33, y: H*0.28, w: 28, h: 28 });
    walls.push({ x: W*0.67-28, y: H*0.28, w: 28, h: 28 });
    walls.push({ x: W*0.33, y: H*0.62, w: 28, h: 28 });
    walls.push({ x: W*0.67-28, y: H*0.62, w: 28, h: 28 });
    walls.push({ x: W*0.2, y: H*0.5-4, w: 45, h: 8 });
    walls.push({ x: W*0.8-45, y: H*0.5-4, w: 45, h: 8 });
    walls.push({ x: W*0.42, y: H*0.15, w: 16, h: 16 });
    walls.push({ x: W*0.58-16, y: H*0.15, w: 16, h: 16 });
    walls.push({ x: W*0.42, y: H*0.78, w: 16, h: 16 });
    walls.push({ x: W*0.58-16, y: H*0.78, w: 16, h: 16 });
    walls.push({ x: W*0.28, y: H*0.45, w: 20, h: 20 });
    walls.push({ x: W*0.72-20, y: H*0.45, w: 20, h: 20 });
    return walls;
  },

  startArena() {
    const p1n = (document.getElementById('p1-name').value.trim()) || 'Player 1';
    const p2n = (document.getElementById('p2-name').value.trim()) || 'Player 2';
    const picks = this._csPicks || { p1: 0, p2: 1 };
    const ab1 = this.CHAR_ABILITIES[picks.p1] || this.CHAR_ABILITIES[0];
    const ab2 = this.CHAR_ABILITIES[picks.p2] || this.CHAR_ABILITIES[1];
    Renderer.init();
    const W = Renderer.W, H = Renderer.H;

    this.p1 = this._makePlayer(60, H/2, 'right', p1n, picks.p1, ab1);
    this.p2 = this._makePlayer(W-60, H/2, 'left', p2n, picks.p2, ab2);

    // Who am I?
    if (Net.connected) this.localPlayer = Net.localRole;
    else this.localPlayer = 'p1';   // solo always controls P1

    this.bullets = [];
    this.stats = { p1Correct: 0, p1Total: 0, p2Correct: 0, p2Total: 0, totalShots: 0, p1Score: 0, p2Score: 0 };
    this.lastP1Shot = 0; this.lastP2Shot = 0;
    this.p1Streak = 0; this.p2Streak = 0;

    if (this.topic === '__all__') this.questionPool = QUESTIONS.map((_,i) => i);
    else this.questionPool = QUESTIONS.map((q,i) => q.topic === this.topic ? i : -1).filter(i => i >= 0);
    if (this.questionPool.length === 0) this.questionPool = QUESTIONS.map((_,i) => i);

    this.walls = this.generateWalls(W, H);
    document.getElementById('hud-p1-name').textContent = p1n + (ab1.emoji ? ' ' + ab1.emoji : '');
    document.getElementById('hud-p2-name').textContent = p2n + (ab2.emoji ? ' ' + ab2.emoji : '');
    document.getElementById('hud-topic').textContent = this.topic === '__all__' ? 'Random Mix' : this.topic;
    UI.updateHP('p1', 100); UI.updateHP('p2', 100);
    UI.updateAmmo('p1', this.p1.ammo, this.p1.maxAmmo);
    UI.updateAmmo('p2', this.p2.ammo, this.p2.maxAmmo);
    UI.updateScore(0, 0);
    UI.updateSRSIndicator(SRS.getDueCount(this.questionPool));
    UI.setControlsHint(this.localPlayer, this.soloMode);
    UI.showScreen('arena');
    Audio.ensure();

    if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
    this.state = 'playing';
    this.lastTime = performance.now();
    this.accumulator = 0;
    // Start capturing keys for this client's player
    Net.captureKeys(true);
    this.animId = requestAnimationFrame((t) => this.loop(t));
  },

  _makePlayer(x, y, dir, name, charIdx, ab) {
    return {
      x, y, r: 14, dir, hp: 100,
      ammo: ab.maxAmmo, maxAmmo: ab.maxAmmo,
      reloading: false, reloadTimer: 0,
      name, charIdx,
      shieldTimer: 0, shootCooldown: 0,
      speed: 3.5 * ab.moveSpeed,
      bulletSpeedMult: ab.bulletSpeed,
      reloadMult: ab.reloadMult,
      shieldMult: ab.shieldMult,
      quizTimerBonus: ab.quizTimerBonus,
      healOnCorrect: ab.healOnCorrect,
      regenRate: ab.regenRate,
      dodgeChance: ab.dodgeChance,
      dashCooldown: ab.dashCooldown,
      dashTimer: 0, dashActive: 0,
      regenTick: 0
    };
  },

  dirToAngle(dir) {
    return dir === 'right' ? 0 : dir === 'down' ? Math.PI/2 : dir === 'left' ? Math.PI : -Math.PI/2;
  },

  // Main loop: host runs physics + broadcasts, guest only renders what host tells it.
  loop(time) {
    if (this.state !== 'playing') { this.animId = null; return; }
    const dt = time - this.lastTime;
    this.lastTime = time;
    this.accumulator += dt;
    const step = 1000 / 60;

    if (Net.connected && !Net.isHost) {
      // Guest just renders the last known state.
      this._renderFrame();
      this.animId = requestAnimationFrame((t) => this.loop(t));
      return;
    }

    while (this.accumulator >= step) {
      this.update();
      this.accumulator -= step;
      if (this.state !== 'playing') break;
    }

    this._renderFrame();

    if (Net.connected && Net.isHost) {
      Net.send({
        t: 'gameState',
        state: this.state,
        p1: this.p1, p2: this.p2,
        bullets: this.bullets,
        stats: this.stats,
        p1Streak: this.p1Streak, p2Streak: this.p2Streak
      });
    }
    this.animId = requestAnimationFrame((t) => this.loop(t));
  },

  _renderFrame() {
    Renderer.render({
      p1: { ...this.p1, angle: this.dirToAngle(this.p1.dir) },
      p2: { ...this.p2, angle: this.dirToAngle(this.p2.dir) },
      bullets: this.bullets, walls: this.walls,
      stats: this.stats, p1Streak: this.p1Streak, p2Streak: this.p2Streak,
      state: this.state
    });
  },

  resumeGame() {
    UI.hideQuiz();
    const isOver = this.p1.hp <= 0 || this.p2.hp <= 0;
    if (isOver) { this.endGame(); return; }
    this.bullets = [];
    this.state = 'playing';
    this.lastTime = performance.now();
    this.accumulator = 0;
    Net.captureKeys(true);
    if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
    this.animId = requestAnimationFrame((t) => this.loop(t));
  },

  // === Physics update (host / solo only) ===
  update() {
    const p1 = this.p1, p2 = this.p2;
    const W = Renderer.W, H = Renderer.H;

    // Build a keys snapshot from:
    //   - Net.localKeys → local player's keys
    //   - Net.remoteKeys → remote player's keys (host-side only)
    // In solo, local → P1 (P2 is a dummy that doesn't move).
    const hasKey = (set, key) => {
      if (!set) return false;
      if (set.has(key)) return true;
      if (key === ' ' && set.has('Space')) return true;
      if (key.length === 1) {
        const code = 'Key' + key.toUpperCase();
        if (set.has(code)) return true;
        if (set.has(key.toUpperCase()) || set.has(key.toLowerCase())) return true;
      }
      return false;
    };

    // Which pressed-key set belongs to which player?
    let p1Keys, p2Keys;
    if (Net.connected) {
      // Host is always P1; guest is always P2. On host:
      //   Net.localKeys  = host's keys  = P1 input
      //   Net.remoteKeys = guest's keys = P2 input
      p1Keys = Net.localKeys;
      p2Keys = Net.remoteKeys;
    } else {
      // Solo: local player controls P1, P2 is idle dummy.
      p1Keys = Net.localKeys;
      p2Keys = null;
    }

    // Movement — P1
    if (hasKey(p1Keys,'w')) { p1.y -= p1.speed; p1.dir = 'up'; }
    if (hasKey(p1Keys,'s')) { p1.y += p1.speed; p1.dir = 'down'; }
    if (hasKey(p1Keys,'a')) { p1.x -= p1.speed; p1.dir = 'left'; }
    if (hasKey(p1Keys,'d')) { p1.x += p1.speed; p1.dir = 'right'; }
    // Movement — P2
    if (hasKey(p2Keys,'w')) { p2.y -= p2.speed; p2.dir = 'up'; }
    if (hasKey(p2Keys,'s')) { p2.y += p2.speed; p2.dir = 'down'; }
    if (hasKey(p2Keys,'a')) { p2.x -= p2.speed; p2.dir = 'left'; }
    if (hasKey(p2Keys,'d')) { p2.x += p2.speed; p2.dir = 'right'; }

    // Clamp + wall collision
    [p1,p2].forEach(p => { p.x = Math.max(p.r, Math.min(W-p.r, p.x)); p.y = Math.max(p.r, Math.min(H-p.r, p.y)); });
    for (let iter = 0; iter < 3; iter++) {
      this.walls.forEach(w => {
        [p1,p2].forEach(p => {
          const cx = Math.max(w.x, Math.min(w.x+w.w, p.x));
          const cy = Math.max(w.y, Math.min(w.y+w.h, p.y));
          const dx = p.x-cx, dy = p.y-cy;
          if (dx*dx+dy*dy < p.r*p.r) {
            const d = Math.sqrt(dx*dx+dy*dy) || 1;
            p.x = cx+dx/d*p.r; p.y = cy+dy/d*p.r;
          }
        });
      });
    }

    // Shooting cooldowns
    if (p1.shootCooldown > 0) p1.shootCooldown--;
    if (p2.shootCooldown > 0) p2.shootCooldown--;

    const p1shoot = hasKey(p1Keys,' ');
    const p2shoot = Net.connected && hasKey(p2Keys,' ');

    if (p1shoot && p1.ammo > 0 && p1.shootCooldown <= 0 && !p1.reloading) this.shoot(p1, 1);
    if (p2shoot && p2.ammo > 0 && p2.shootCooldown <= 0 && !p2.reloading) this.shoot(p2, 2);

    // Reload
    [p1,p2].forEach((p, i) => {
      if (p.ammo <= 0 && !p.reloading) {
        p.reloading = true;
        p.reloadTimer = Math.floor(120 * (p.reloadMult || 1));
        const rw = this.reloadWords[Math.floor(Math.random()*this.reloadWords.length)];
        // Host runs physics for both players. Show flash on the owning client only:
        //  - host shows flash for its own player (P1)
        //  - host tells guest (via RPC) to show flash for guest's player (P2)
        if ((i === 0 && this.localPlayer === 'p1') || (i === 1 && this.localPlayer === 'p2')) {
          UI.showReloadFlash(rw[0], rw[1]); Audio.reload();
        } else if (Net.connected && Net.isHost && i === 1) {
          Net.send({ t: 'rpc', cmd: 'reloadFlash', word: rw[0], english: rw[1] });
        }
      }
      if (p.reloading) {
        p.reloadTimer--;
        if (p.reloadTimer <= 0) {
          p.ammo = p.maxAmmo; p.reloading = false;
          UI.updateAmmo(i===0?'p1':'p2', p.ammo, p.maxAmmo);
        }
      }
    });

    if (p1.shieldTimer > 0) p1.shieldTimer--;
    if (p2.shieldTimer > 0) p2.shieldTimer--;

    // Regen ability (La Doctora)
    [p1,p2].forEach((p, i) => {
      if (p.regenRate > 0 && p.hp > 0 && p.hp < 100) {
        p.regenTick = (p.regenTick || 0) + 1;
        if (p.regenTick >= 180) {
          p.hp = Math.min(100, p.hp + p.regenRate);
          p.regenTick = 0;
          UI.updateHP(i===0?'p1':'p2', p.hp);
        }
      }
    });

    // Standoff check — bullets exist and were fired close in time
    if (this.lastP1Shot && this.lastP2Shot &&
        Math.abs(this.lastP1Shot - this.lastP2Shot) < this.STANDOFF_WINDOW) {
      const b1 = this.bullets.find(b => b.owner === 1 && b.age < 20);
      const b2 = this.bullets.find(b => b.owner === 2 && b.age < 20);
      if (b1 && b2) {
        this.triggerStandoff(b1, b2);
        this.lastP1Shot = 0; this.lastP2Shot = 0;
        return;
      }
    }
    const now = Date.now();
    if (this.lastP1Shot && now - this.lastP1Shot > this.STANDOFF_WINDOW) this.lastP1Shot = 0;
    if (this.lastP2Shot && now - this.lastP2Shot > this.STANDOFF_WINDOW) this.lastP2Shot = 0;

    // Bullet stepping
    this.bullets = this.bullets.filter(b => {
      b.x += b.vx; b.y += b.vy; b.age = (b.age || 0) + 1; b.bounces = b.bounces || 0;
      if (b.x < 0 || b.x > W) { b.vx *= -1; b.bounces++; }
      if (b.y < 0 || b.y > H) { b.vy *= -1; b.bounces++; }
      if (b.bounces > 1) return false;
      for (const w of this.walls) {
        if (b.x > w.x && b.x < w.x+w.w && b.y > w.y && b.y < w.y+w.h) {
          if (b.x-b.vx <= w.x || b.x-b.vx >= w.x+w.w) b.vx *= -1;
          if (b.y-b.vy <= w.y || b.y-b.vy >= w.y+w.h) b.vy *= -1;
          b.bounces++;
          Renderer.addParticle(b.x, b.y, '#ff4757', 3);
          break;
        }
      }
      if (b.bounces > 1) return false;
      const target = b.owner === 1 ? p2 : p1;
      const owner = b.owner === 1 ? p1 : p2;
      // Don't instantly self-hit at spawn
      if (b.age < 10) {
        const sx = b.x - owner.x, sy = b.y - owner.y;
        if (sx*sx + sy*sy < (owner.r + 20) ** 2) return b.age < 300;
      }
      const dx = b.x - target.x, dy = b.y - target.y;
      if (dx*dx + dy*dy < (target.r + 4) ** 2) {
        if (target.shieldTimer > 0) {
          Renderer.addParticle(b.x, b.y, '#2ed573', 8);
          return false;
        }
        if (target.dodgeChance > 0 && Math.random() < target.dodgeChance) {
          Renderer.addParticle(b.x, b.y, '#ffa502', 6);
          return false;
        }
        if (this.state === 'playing') this.triggerQuiz(b.owner === 1 ? 2 : 1, b);
        return false;
      }
      return b.age < 300;
    });
  },

  shoot(player, owner) {
    const angle = this.dirToAngle(player.dir);
    const speed = 7 * (player.bulletSpeedMult || 1);
    this.bullets.push({
      x: player.x + Math.cos(angle)*(player.r+10),
      y: player.y + Math.sin(angle)*(player.r+10),
      vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed,
      owner, age: 0, bounces: 0
    });
    player.ammo--; player.shootCooldown = 20;
    this.stats.totalShots++;
    UI.updateAmmo(owner===1?'p1':'p2', player.ammo, player.maxAmmo);
    Audio.shoot();
    if (owner === 1) this.lastP1Shot = Date.now();
    else this.lastP2Shot = Date.now();
  },

  getStreakDamage(streak) {
    if (streak >= 5) return 40;
    if (streak >= 3) return 30;
    return 20;
  },

  getStreakLabel(streak) {
    if (streak >= 5) return '🔥🔥🔥 ON FIRE! 2x DMG';
    if (streak >= 3) return '🔥🔥 Hot streak! +10 DMG';
    return '';
  },

  // === Quiz flow (defender answers; other player spectates) ===
  // `defender` is 1 or 2 (the player that got hit).
  triggerQuiz(defender, b) {
    this.state = 'quiz';
    if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
    Net.captureKeys(false);
    Audio.hit(); UI.shake();

    const qIdx = SRS.pickNext(this.questionPool);
    const question = QUESTIONS[qIdx];
    this.currentQuiz = { qIdx, defender, attacker: b.owner };
    const defPlayer = defender === 1 ? this.p1 : this.p2;
    const defRole = defender === 1 ? 'p1' : 'p2';
    const timerBonus = defPlayer.quizTimerBonus || 0;

    // Determine a random answer order that both clients agree on (for spectator to match).
    const answerOrder = this._makeAnswerOrder(question);

    if (Net.connected && Net.isHost) {
      if (defRole === 'p2') {
        // Guest is defender → guest answers, host spectates.
        Net.send({
          t: 'rpc', cmd: 'showQuiz',
          question, defenderName: defPlayer.name, canAnswer: true,
          answerOrder, timerBonus
        });
        UI.showSpectateQuiz(question, defPlayer.name, answerOrder, timerBonus);
      } else {
        // Host is defender → host answers, guest spectates.
        Net.send({
          t: 'rpc', cmd: 'showQuiz',
          question, defenderName: defPlayer.name, canAnswer: false,
          answerOrder, timerBonus
        });
        UI.showQuiz(question, defPlayer.name, answerOrder, timerBonus,
          (isCorrect, timeTaken) => {
            this.processQuizResult(isCorrect, timeTaken);
            // If the defender just died, endGame already sent a 'gameOver' RPC;
            // don't follow it with a 'hideQuiz' that would splash a result over the game-over screen.
            if (this.state === 'gameover') return;
            const streakLabel = this.getStreakLabel(
              this.currentQuiz.attacker === 1 ? this.p1Streak : this.p2Streak);
            Net.send({ t: 'rpc', cmd: 'hideQuiz',
              isCorrect, answer: question.a, streakLabel,
              p1: this.p1, p2: this.p2, stats: this.stats,
              p1Streak: this.p1Streak, p2Streak: this.p2Streak });
          },
          (pickedAnswer) => {
            // Live preview: every time defender highlights an answer, tell spectator.
            Net.send({ t: 'rpc', cmd: 'quizPick', pickedAnswer });
          }
        );
      }
    } else {
      // Solo: P1 is always defender when hit by P2's bullet; in solo P2 never shoots,
      // so defender is always 1. Still handle both cases for safety.
      UI.showQuiz(question, defPlayer.name, answerOrder, timerBonus,
        (isCorrect, timeTaken) => this.processQuizResult(isCorrect, timeTaken),
        null
      );
    }
  },

  _makeAnswerOrder(question) {
    const answers = [question.a, ...question.d];
    // Deterministic shuffle using Net.random so both sides agree in MP
    for (let i = answers.length - 1; i > 0; i--) {
      const j = Math.floor(Net.random() * (i + 1));
      [answers[i], answers[j]] = [answers[j], answers[i]];
    }
    return answers;
  },

  // Host receives guest's answer (guest was the defender)
  handleGuestQuizAnswer(data) {
    if (!this.currentQuiz) return;
    const question = QUESTIONS[this.currentQuiz.qIdx];
    this.processQuizResult(data.isCorrect, data.timeTaken);
    // If the defender (guest) just died, endGame fired and sent gameOver — skip the result splash.
    if (this.state === 'gameover') return;
    const streakLabel = this.getStreakLabel(
      this.currentQuiz.attacker === 1 ? this.p1Streak : this.p2Streak);
    // Hide spectate on host, and tell guest the final result
    UI.showResult(data.isCorrect, question.a, streakLabel);
    Net.send({ t: 'rpc', cmd: 'hideQuiz',
      isCorrect: data.isCorrect, answer: question.a, streakLabel,
      p1: this.p1, p2: this.p2, stats: this.stats,
      p1Streak: this.p1Streak, p2Streak: this.p2Streak });
    setTimeout(() => this.resumeGame(), 1500);
  },

  // Host receives guest's live answer-preview highlight
  handleGuestQuizPick(data) {
    UI.spectateHighlight(data.pickedAnswer);
  },

  processQuizResult(isCorrect, timeTaken) {
    if (!this.currentQuiz) return;
    const { qIdx, defender, attacker } = this.currentQuiz;
    const defPlayer = defender === 1 ? this.p1 : this.p2;
    const statsKey = defender === 1 ? 'p1' : 'p2';
    const atkKey   = attacker === 1 ? 'p1' : 'p2';

    this.stats[statsKey+'Total']++;
    const question = QUESTIONS[qIdx];
    const srsResult = !isCorrect ? 'wrong' : (timeTaken > 10 ? 'slow' : 'fast');
    SRS.update(qIdx, srsResult, !!question.complex);

    if (isCorrect) {
      Audio.deflect();
      this.stats[statsKey+'Correct']++;
      defPlayer.shieldTimer = Math.floor(180 * (defPlayer.shieldMult || 1));
      if (defender === 1) { this.p1Streak++; this.p2Streak = 0; }
      else                { this.p2Streak++; this.p1Streak = 0; }
      if (defPlayer.healOnCorrect > 0) {
        defPlayer.hp = Math.min(100, defPlayer.hp + defPlayer.healOnCorrect);
        UI.updateHP(defender===1?'p1':'p2', defPlayer.hp);
      }
      Renderer.addParticle(defPlayer.x, defPlayer.y, '#2ed573', 20);
    } else {
      Audio.damage();
      this.stats[atkKey+'Score']++;
      const atkStreak = attacker === 1 ? this.p1Streak : this.p2Streak;
      const dmg = this.getStreakDamage(atkStreak);
      defPlayer.hp -= dmg;
      if (attacker === 1) this.p1Streak++; else this.p2Streak++;
      if (defender === 1) this.p1Streak = 0; else this.p2Streak = 0;
      UI.updateHP(defender===1?'p1':'p2', defPlayer.hp);
      Renderer.addParticle(defPlayer.x, defPlayer.y, '#ff4757', 20);
      if (defPlayer.hp <= 0) { this.endGame(); return; }
    }

    // Solo shows result here; MP-host shows result here too (for host path);
    // MP-host with guest-defender path triggers showResult in handleGuestQuizAnswer.
    if (!Net.connected) {
      const streakLabel = this.getStreakLabel(
        attacker === 1 ? this.p1Streak : this.p2Streak);
      UI.showResult(isCorrect, question.a, streakLabel);
      UI.updateScore(this.stats.p1Score, this.stats.p2Score);
      UI.updateSRSIndicator(SRS.getDueCount(this.questionPool));
      setTimeout(() => this.resumeGame(), 1500);
    } else if (Net.isHost) {
      UI.updateScore(this.stats.p1Score, this.stats.p2Score);
      UI.updateSRSIndicator(SRS.getDueCount(this.questionPool));
      // If host was defender, host shows result in onAnswer callback (above).
      if (defender === 1) {
        const streakLabel = this.getStreakLabel(
          attacker === 1 ? this.p1Streak : this.p2Streak);
        UI.showResult(isCorrect, question.a, streakLabel);
        setTimeout(() => this.resumeGame(), 1500);
      }
      // If guest was defender, resume is triggered in handleGuestQuizAnswer.
    }
  },

  // === Standoff (both players answer the same question) ===
  triggerStandoff(b1, b2) {
    this.state = 'standoff';
    if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
    Net.captureKeys(false);
    Audio.hit(); UI.shake();
    this.bullets = this.bullets.filter(b => b !== b1 && b !== b2);
    Renderer.addParticle((b1.x+b2.x)/2, (b1.y+b2.y)/2, '#ffa502', 20);

    const qIdx = SRS.pickNext(this.questionPool);
    const question = QUESTIONS[qIdx];
    this.currentStandoffQuiz = qIdx;
    this._standoffAnswered = { p1: null, p2: null };
    this._standoffResolved = false;
    const answerOrder = this._makeAnswerOrder(question);

    if (Net.connected && Net.isHost) {
      Net.send({
        t: 'rpc', cmd: 'showStandoff',
        question, p1Name: this.p1.name, p2Name: this.p2.name,
        answerOrder
      });
      UI.showStandoff(question, this.p1.name, this.p2.name, answerOrder, 'p1',
        (winner, elapsed) => {
          if (!this._standoffAnswered.p1) {
            this._standoffAnswered.p1 = { winner, elapsed };
            this._resolveStandoff(qIdx);
          }
        });
    } else if (!Net.connected) {
      // Solo: only P1 answers; treat as defender quiz essentially.
      UI.showStandoff(question, this.p1.name, this.p2.name, answerOrder, 'p1',
        (winner, elapsed) => {
          // In solo, P2 is a dummy and can never "win" the standoff.
          // Resolve immediately with P1's answer.
          const w = (winner === 1) ? 1 : 0;
          this.processStandoffResult(w, elapsed, qIdx);
        });
    }
    // Guest side is handled in handleRPC (cmd==='showStandoff').
  },

  handleGuestStandoffAnswer(data) {
    if (this._standoffResolved) return;
    if (!this._standoffAnswered.p2) {
      this._standoffAnswered.p2 = { winner: data.winner, elapsed: data.elapsed };
      this._resolveStandoff(this.currentStandoffQuiz);
    }
  },

  _resolveStandoff(qIdx) {
    if (this._standoffResolved) return;
    const p1a = this._standoffAnswered.p1;
    const p2a = this._standoffAnswered.p2;
    // First correct answer wins. Otherwise wait until either:
    //   - someone answers correctly, OR
    //   - both have answered (then draw or whoever had the correct one).
    let winner = null, elapsed = 12;

    if (p1a && p1a.winner === 1) { winner = 1; elapsed = p1a.elapsed; }
    else if (p2a && p2a.winner === 2) { winner = 2; elapsed = p2a.elapsed; }
    else if (p1a && p2a) {
      // Both answered wrong / timed out → draw
      winner = 0;
      elapsed = Math.max(p1a.elapsed, p2a.elapsed);
    } else {
      // Waiting for the other answer
      return;
    }

    this._standoffResolved = true;
    this.processStandoffResult(winner, elapsed, qIdx);
  },

  processStandoffResult(winner, elapsed, qIdx) {
    this.stats.p1Total++; this.stats.p2Total++;
    const question = QUESTIONS[qIdx];
    if (winner === 1) {
      this.p1Streak++; this.p2Streak = 0;
      this.stats.p1Correct++; this.stats.p1Score++;
      this.p2.hp -= this.getStreakDamage(this.p1Streak);
      SRS.update(qIdx, elapsed < 10 ? 'fast' : 'slow', !!question.complex);
    } else if (winner === 2) {
      this.p2Streak++; this.p1Streak = 0;
      this.stats.p2Correct++; this.stats.p2Score++;
      this.p1.hp -= this.getStreakDamage(this.p2Streak);
      SRS.update(qIdx, elapsed < 10 ? 'fast' : 'slow', !!question.complex);
    } else {
      this.p1Streak = 0; this.p2Streak = 0;
      SRS.update(qIdx, 'wrong', !!question.complex);
    }
    UI.updateHP('p1', this.p1.hp); UI.updateHP('p2', this.p2.hp);

    const winnerName = winner === 1 ? this.p1.name : (winner === 2 ? this.p2.name : null);

    if (Net.connected && Net.isHost) {
      Net.send({ t: 'rpc', cmd: 'hideStandoff',
        winner, winnerName, correctAnswer: question.a,
        p1: this.p1, p2: this.p2, stats: this.stats,
        p1Streak: this.p1Streak, p2Streak: this.p2Streak });
    }
    UI.showStandoffResult(winner, winnerName, question.a);
    UI.updateScore(this.stats.p1Score, this.stats.p2Score);
    UI.updateSRSIndicator(SRS.getDueCount(this.questionPool));
    if (this.p1.hp <= 0 || this.p2.hp <= 0) {
      setTimeout(() => this.endGame(), 1500);
    } else {
      setTimeout(() => this.resumeGame(), 1500);
    }
  },

  // === Guest side: apply host's authoritative snapshot ===
  applyGameState(data) {
    // If we were in a quiz/standoff/gameover, don't let stale playing-state rewind us.
    if (data.state === 'playing' && this.state !== 'playing') {
      // Host resumed play — follow suit
      this.state = 'playing';
      if (!this.animId) {
        this.lastTime = performance.now();
        Net.captureKeys(true);
        this.animId = requestAnimationFrame((t) => this.loop(t));
      }
    } else if (data.state !== 'playing' && this.state === 'playing') {
      this.state = data.state;
    } else {
      this.state = data.state;
    }
    if (data.p1) this.p1 = data.p1;
    if (data.p2) this.p2 = data.p2;
    if (data.bullets) this.bullets = data.bullets;
    if (data.stats) this.stats = data.stats;
    if (typeof data.p1Streak === 'number') this.p1Streak = data.p1Streak;
    if (typeof data.p2Streak === 'number') this.p2Streak = data.p2Streak;
    if (this.p1) { UI.updateHP('p1', this.p1.hp); UI.updateAmmo('p1', this.p1.ammo, this.p1.maxAmmo); }
    if (this.p2) { UI.updateHP('p2', this.p2.hp); UI.updateAmmo('p2', this.p2.ammo, this.p2.maxAmmo); }
    UI.updateScore(this.stats.p1Score || 0, this.stats.p2Score || 0);
  },

  // === Guest side: host-driven RPCs ===
  handleRPC(data) {
    if (data.cmd === 'startArena') {
      // Host tells guest to start arena with the agreed-upon picks and names
      if (this._csHandler) { window.removeEventListener('keydown', this._csHandler); this._csHandler = null; }
      this._csPicks = data.picks;
      // Sync the name fields so startArena reads the right names
      if (data.p1Name) { const el = document.getElementById('p1-name'); if (el) el.value = data.p1Name; }
      if (data.p2Name) { const el = document.getElementById('p2-name'); if (el) el.value = data.p2Name; }
      setTimeout(() => this.startArena(), 400);
      return;
    }
    if (data.cmd === 'showQuiz') {
      this.state = 'quiz';
      if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
      Net.captureKeys(false);
      Audio.hit(); UI.shake();
      if (data.canAnswer) {
        UI.showQuiz(data.question, data.defenderName, data.answerOrder, data.timerBonus || 0,
          (isCorrect, timeTaken) => Net.send({ t: 'quizAnswer', isCorrect, timeTaken }),
          (pickedAnswer) => Net.send({ t: 'quizPick', pickedAnswer })
        );
      } else {
        UI.showSpectateQuiz(data.question, data.defenderName, data.answerOrder, data.timerBonus || 0);
      }
    } else if (data.cmd === 'quizPick') {
      UI.spectateHighlight(data.pickedAnswer);
    } else if (data.cmd === 'hideQuiz') {
      if (data.p1) this.p1 = data.p1;
      if (data.p2) this.p2 = data.p2;
      if (data.stats) this.stats = data.stats;
      if (typeof data.p1Streak === 'number') this.p1Streak = data.p1Streak;
      if (typeof data.p2Streak === 'number') this.p2Streak = data.p2Streak;
      UI.updateHP('p1', this.p1.hp); UI.updateHP('p2', this.p2.hp);
      UI.updateScore(this.stats.p1Score || 0, this.stats.p2Score || 0);
      if (data.isCorrect) Audio.deflect(); else Audio.damage();
      UI.showResult(data.isCorrect, data.answer, data.streakLabel);
      setTimeout(() => this.resumeGame(), 1500);
    } else if (data.cmd === 'showStandoff') {
      this.state = 'standoff';
      if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
      Net.captureKeys(false);
      Audio.hit(); UI.shake();
      UI.showStandoff(data.question, data.p1Name, data.p2Name, data.answerOrder, 'p2',
        (winner, elapsed) => Net.send({ t: 'standoffAnswer', winner, elapsed }));
    } else if (data.cmd === 'hideStandoff') {
      if (data.p1) this.p1 = data.p1;
      if (data.p2) this.p2 = data.p2;
      if (data.stats) this.stats = data.stats;
      if (typeof data.p1Streak === 'number') this.p1Streak = data.p1Streak;
      if (typeof data.p2Streak === 'number') this.p2Streak = data.p2Streak;
      UI.updateHP('p1', this.p1.hp); UI.updateHP('p2', this.p2.hp);
      UI.updateScore(this.stats.p1Score || 0, this.stats.p2Score || 0);
      UI.showStandoffResult(data.winner, data.winnerName, data.correctAnswer);
      setTimeout(() => this.resumeGame(), 1500);
    } else if (data.cmd === 'gameOver') {
      this.state = 'gameover';
      this.p1 = data.p1; this.p2 = data.p2; this.stats = data.stats;
      if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
      Net.captureKeys(false);
      UI.showGameOver(data.winner, this.p1, this.p2, this.stats);
    } else if (data.cmd === 'reloadFlash') {
      UI.showReloadFlash(data.word, data.english);
      Audio.reload();
    }
  },

  endGame() {
    this.state = 'gameover';
    if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
    Net.captureKeys(false);
    // Winner: the one with HP > 0 (or higher HP if both positive)
    let winner;
    if (this.p1.hp <= 0 && this.p2.hp <= 0) winner = this.p1.hp >= this.p2.hp ? 1 : 2;
    else if (this.p1.hp <= 0) winner = 2;
    else if (this.p2.hp <= 0) winner = 1;
    else winner = this.p1.hp >= this.p2.hp ? 1 : 2;

    if (Net.connected && Net.isHost) {
      Net.send({ t: 'rpc', cmd: 'gameOver', winner,
        p1: this.p1, p2: this.p2, stats: this.stats });
    }
    UI.showGameOver(winner, this.p1, this.p2, this.stats);
  }
};

window.addEventListener('DOMContentLoaded', () => Game.init());
