// Duo Hurdles — proper multiplayer + spectator view
//
// Modes:
//   - Solo: one runner; P2 is idle dummy
//   - Online MP (host): authoritative physics, broadcasts state
//   - Online MP (guest): sends input to host, receives state, answers own hurdles
//
// Controls per device:
//   SPACE or →/D → sprint (auto-run + boost while held)
//   When a hurdle triggers: 1-4 keys to answer (only for the runner that hit it)
//
// Questions: MCQ from the shared QUESTIONS pool (built-in or uploaded via
// loader.js). Each hurdle draws one question; topic picker filters the pool.

const Hurdles = {
  state: 'lobby',
  topic: '__all__',
  numHurdles: 20,
  p1: null, p2: null,
  canvas: null, ctx: null,
  W: 0, H: 0,
  hurdleData: [],
  raceStart: 0,
  animId: null,
  quizActive: false,
  currentHurdle: null,
  soloMode: false,
  localPlayer: 'p1',
  timerInt: null,
  _quizKeyHandler: null,

  init() {
    this.buildTopicGrid();
    document.getElementById('h-start-btn').onclick = () => {
      if (typeof Net !== 'undefined') Net.mirrorClick('h-start-btn');
      this.startRace();
    };
    document.getElementById('h-rematch-btn').onclick = () => {
      if (typeof Net !== 'undefined') Net.mirrorClick('h-rematch-btn');
      this.startRace();
    };
    document.getElementById('h-lobby-btn').onclick = () => {
      if (typeof Net !== 'undefined') Net.mirrorClick('h-lobby-btn');
      this.showScreen('h-lobby');
      Net.captureKeys(false);
    };
    ['h-p1-name','h-p2-name'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => {
        if (typeof Net !== 'undefined') Net.mirrorInput(id);
      });
    });
    const soloBtn = document.getElementById('h-btn-solo');
    if (soloBtn) soloBtn.onclick = () => {
      this.soloMode = true;
      this.startRace();
    };
  },

  showScreen(id) {
    document.querySelectorAll('.h-screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  },

  buildTopicGrid() {
    const grid = document.getElementById('h-topic-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.id = 'h-topic-btn-all';
    allBtn.className = 'h-topic-btn selected';
    allBtn.textContent = '🎲 Mixed';
    allBtn.dataset.topic = '__all__';
    allBtn.onclick = () => this._selectTopic(allBtn);
    grid.appendChild(allBtn);
    (typeof TOPICS !== 'undefined' ? TOPICS : []).forEach(t => {
      if (t == null) return;
      const btn = document.createElement('button');
      btn.id = 'h-topic-btn-' + t.replace(/\s+/g, '-');
      btn.className = 'h-topic-btn';
      btn.textContent = t;
      btn.dataset.topic = t;
      btn.onclick = () => this._selectTopic(btn);
      grid.appendChild(btn);
    });
    this.topic = '__all__';
  },

  _selectTopic(btn) {
    if (btn.id && typeof Net !== 'undefined') Net.mirrorClick(btn.id);
    document.querySelectorAll('.h-topic-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    this.topic = btn.dataset.topic;
  },

  // Pick a question (from the host's filtered pool) and produce the
  // payload that matches what _showHurdleAnswer / _showHurdleSpectator expect.
  generateQuestion(questionPool) {
    const qIdx = (typeof SRS !== 'undefined' && SRS.pickNext)
      ? SRS.pickNext(questionPool)
      : questionPool[Math.floor(Net.random() * questionPool.length)];
    const q = QUESTIONS[qIdx];
    // Shuffle answers deterministically with the shared seed
    const answers = [q.a, ...q.d.slice(0, 3)];
    for (let i = answers.length - 1; i > 0; i--) {
      const j = Math.floor(Net.random() * (i + 1));
      [answers[i], answers[j]] = [answers[j], answers[i]];
    }
    return {
      qIdx,
      question: q.q,
      topic: q.topic,
      correct: q.a,
      complex: !!q.complex,
      distractors: q.d.slice(0, 3),
      answerOrder: answers
    };
  },

  startRace() {
    const n1 = document.getElementById('h-p1-name').value.trim() || 'Runner 1';
    const n2 = document.getElementById('h-p2-name').value.trim() || 'Runner 2';
    this.canvas = document.getElementById('hurdle-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.W = 1200;
    this.H = 700;
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this._fitCanvas();
    window.addEventListener('resize', () => this._fitCanvas());

    this.p1 = { name: n1, x: 50, lane: this.H*0.3, hurdle: 0, correct: 0, total: 0, speed: 1.0, boost: 0, stumble: 0, streak: 0, bestStreak: 0 };
    this.p2 = { name: n2, x: 50, lane: this.H*0.7, hurdle: 0, correct: 0, total: 0, speed: 1.0, boost: 0, stumble: 0, streak: 0, bestStreak: 0 };

    // Who am I?
    if (Net.connected) this.localPlayer = Net.localRole;
    else this.localPlayer = 'p1';

    // Build the filtered question pool for this race
    let pool;
    if (this.topic === '__all__' || !this.topic) {
      pool = QUESTIONS.map((_, i) => i);
    } else {
      pool = QUESTIONS.map((q, i) => q.topic === this.topic ? i : -1).filter(i => i >= 0);
    }
    if (pool.length === 0) pool = QUESTIONS.map((_, i) => i);
    this.questionPool = pool;

    this.hurdleData = [];
    const spacing = (this.W - 180) / this.numHurdles;
    for (let i = 0; i < this.numHurdles; i++) {
      const isSuper = (i + 1) % 5 === 0;
      this.hurdleData.push({
        xPos: 130 + spacing * i,
        isSuper,
        q1: this.generateQuestion(pool),
        q2: this.generateQuestion(pool),
        p1Done: false, p2Done: false
      });
    }

    document.getElementById('race-p1-name').textContent = n1;
    document.getElementById('race-p2-name').textContent = n2;
    this.raceStart = Date.now();
    this.quizActive = false;
    this.currentHurdle = null;
    this.showScreen('h-race');
    this.state = 'racing';
    Audio.ensure();
    this.lastTime = performance.now();
    this.accumulator = 0;
    Net.captureKeys(true);
    if (this.animId) cancelAnimationFrame(this.animId);
    this.animId = requestAnimationFrame((t) => this.loop(t));
  },

  _fitCanvas() {
    const availW = window.innerWidth;
    const availH = window.innerHeight - 80;
    const scale = Math.min(availW / this.W, availH / this.H);
    this.canvas.style.width = `${this.W * scale}px`;
    this.canvas.style.height = `${this.H * scale}px`;
    this.canvas.style.position = 'absolute';
    this.canvas.style.left = `${(availW - this.W * scale) / 2}px`;
    this.canvas.style.top = `${80 + (availH - this.H * scale) / 2}px`;
  },

  loop(time) {
    if (this.state !== 'racing') return;
    const dt = (time || performance.now()) - (this.lastTime || time);
    this.lastTime = time || performance.now();
    this.accumulator = (this.accumulator || 0) + dt;
    const step = 1000 / 60;

    if (Net.connected && !Net.isHost) {
      // Guest: just render
      this.render();
      this.animId = requestAnimationFrame((t) => this.loop(t));
      return;
    }

    while (this.accumulator >= step) {
      this.update();
      this.accumulator -= step;
      if (this.state !== 'racing') break;
    }

    if (Net.connected && Net.isHost) {
      Net.send({
        t: 'hurdlesState',
        state: this.state,
        p1: this.p1, p2: this.p2
      });
    }

    if (this.state === 'racing') {
      this.render();
      this.animId = requestAnimationFrame((t) => this.loop(t));
    }
  },

  update() {
    // Determine if each runner wants to "sprint" based on pressed keys.
    // Sprint adds to base speed.
    const isSprinting = (set) => {
      if (!set) return false;
      return set.has(' ') || set.has('Space') ||
             set.has('d') || set.has('D') || set.has('KeyD') ||
             set.has('ArrowRight');
    };
    let p1Sprint = false, p2Sprint = false;
    if (Net.connected) {
      p1Sprint = isSprinting(Net.localKeys);   // host = P1
      p2Sprint = isSprinting(Net.remoteKeys);  // guest = P2
    } else {
      p1Sprint = isSprinting(Net.localKeys);   // solo → P1
      p2Sprint = false;                         // P2 is dummy
    }

    const runnerStep = (p, sprint) => {
      if (p.stumble > 0) { p.stumble--; return; }
      const sprintBoost = sprint ? 0.6 : 0;
      const s = p.speed + (p.boost > 0 ? 2.0 : 0) + sprintBoost;
      p.x += s;
      if (p.boost > 0) p.boost--;
    };
    runnerStep(this.p1, p1Sprint);
    runnerStep(this.p2, p2Sprint);

    // Check hurdle collisions
    if (!this.quizActive) {
      for (let i = 0; i < this.hurdleData.length; i++) {
        const h = this.hurdleData[i];
        if (!h.p1Done && this.p1.x >= h.xPos - 5 && this.p1.stumble <= 0) {
          h.p1Done = true;
          this.triggerHurdle(1, i);
          return;
        }
        if (!h.p2Done && this.p2.x >= h.xPos - 5 && this.p2.stumble <= 0) {
          h.p2Done = true;
          this.triggerHurdle(2, i);
          return;
        }
      }
    }

    // HUD
    document.getElementById('race-p1-hurdle').textContent = `${this.p1.hurdle}/${this.numHurdles}`;
    document.getElementById('race-p2-hurdle').textContent = `${this.p2.hurdle}/${this.numHurdles}`;
    const elapsed = ((Date.now() - this.raceStart) / 1000).toFixed(1);
    document.getElementById('race-timer').textContent = elapsed + 's';

    if (this.p1.x >= this.W - 40 || this.p2.x >= this.W - 40) this.finishRace();
  },

  // `player` is 1 or 2 (the runner that hit the hurdle)
  triggerHurdle(player, idx) {
    this.quizActive = true;
    this.state = 'quiz';
    cancelAnimationFrame(this.animId);
    Net.captureKeys(false);
    const h = this.hurdleData[idx];
    this.currentHurdle = { player, idx };
    const q = player === 1 ? h.q1 : h.q2;
    const runnerName = player === 1 ? this.p1.name : this.p2.name;
    const runnerRole = player === 1 ? 'p1' : 'p2';

    if (Net.connected && Net.isHost) {
      if (runnerRole === 'p2') {
        // Guest is the runner → they answer; host spectates.
        Net.send({ t: 'rpc', cmd: 'showHurdle', q, isSuper: h.isSuper, player, canAnswer: true });
        this._showHurdleSpectator(q, h.isSuper, player, runnerName);
      } else {
        // Host is the runner → host answers; guest spectates.
        Net.send({ t: 'rpc', cmd: 'showHurdle', q, isSuper: h.isSuper, player, canAnswer: false });
        this._showHurdleAnswer(q, h.isSuper, player, runnerName);
      }
    } else {
      // Solo: always P1 → they always answer
      if (player === 1) this._showHurdleAnswer(q, h.isSuper, player, runnerName);
      else {
        // P2 is dummy but can hit a hurdle if host-like path; should never happen in solo
        this._showHurdleSpectator(q, h.isSuper, player, runnerName);
      }
    }
  },

  // For the RUNNER answering the question
  _showHurdleAnswer(q, isSuper, player, runnerName) {
    const overlay = document.getElementById('h-quiz-overlay');
    const result = document.getElementById('h-quiz-result');
    const card = document.getElementById('h-quiz-card');
    overlay.classList.remove('hidden');
    overlay.classList.remove('h-spectator-mode');
    result.classList.add('hidden');
    card.style.display = 'block';

    const p = player === 1 ? this.p1 : this.p2;
    document.getElementById('h-quiz-who').innerHTML = isSuper
      ? `<span style="color:#ffd700;font-size:14px">⭐ SUPER HURDLE ⭐</span><br>${runnerName} — Hurdle ${p.hurdle+1}`
      : `🏃 ${runnerName} — Hurdle ${p.hurdle + 1}`;
    document.getElementById('h-topic-tag').textContent = q.topic || 'General';
    document.getElementById('h-question').textContent = q.question;

    const answers = q.answerOrder || [q.correct, ...q.distractors].slice(0, 4);
    const grid = document.getElementById('h-quiz-answers');
    grid.innerHTML = '';
    const keys = ['1','2','3','4'];
    let answered = false;
    const startTime = Date.now();
    const timeLimit = isSuper ? 5 : 8;

    const doAnswer = (idx) => {
      if (answered) return;
      answered = true;
      clearInterval(this.timerInt);
      if (this._quizKeyHandler) window.removeEventListener('keydown', this._quizKeyHandler);
      const picked = answers[idx];
      const isCorrect = picked === q.correct;
      const elapsed = (Date.now() - startTime) / 1000;

      // Highlight
      const btn = grid.children[idx];
      if (btn) btn.classList.add(isCorrect ? 'correct' : 'wrong');
      if (!isCorrect) {
        grid.querySelectorAll('.h-ans-btn').forEach(b => {
          if (b.dataset.answer === q.correct) b.classList.add('correct');
        });
      }

      if (Net.connected && !Net.isHost) {
        Net.send({ t: 'answerHurdle', isCorrect, elapsed, picked });
      } else {
        this.processHurdleResult(isCorrect, elapsed, picked);
      }
    };

    answers.forEach((ans, i) => {
      const btn = document.createElement('button');
      btn.className = 'h-ans-btn';
      btn.dataset.answer = ans;
      btn.innerHTML = `<span class="h-key">[${keys[i]}]</span>${ans}`;
      btn.onmouseenter = () => {
        if (!answered && Net.connected && !Net.isHost) {
          // Guest previewing → tell host → host relays to spectator
          Net.send({ t: 'hurdlePick', picked: ans });
        } else if (!answered && Net.connected && Net.isHost) {
          // Host previewing → send directly to guest as spectate-pick relay
          Net.send({ t: 'rpc', cmd: 'hSpectateAnswer', picked: ans });
        }
      };
      btn.onclick = () => doAnswer(i);
      grid.appendChild(btn);
    });

    const kh = (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const i = keys.indexOf(e.key);
      if (i >= 0) {
        const btn = grid.children[i];
        if (btn && !answered) {
          // Send preview as well
          if (Net.connected && !Net.isHost) Net.send({ t: 'hurdlePick', picked: btn.dataset.answer });
          else if (Net.connected && Net.isHost) Net.send({ t: 'rpc', cmd: 'hSpectateAnswer', picked: btn.dataset.answer });
        }
        doAnswer(i);
      }
    };
    window.addEventListener('keydown', kh);
    this._quizKeyHandler = kh;

    let timeLeft = timeLimit;
    const timerBar = document.getElementById('h-quiz-timer');
    timerBar.style.width = '100%';
    timerBar.style.background = isSuper ? 'linear-gradient(90deg, gold, #ff4757)' : '';
    this.timerInt = setInterval(() => {
      timeLeft -= 0.1;
      timerBar.style.width = Math.max(0, (timeLeft / timeLimit * 100)) + '%';
      if (timeLeft <= 0) {
        clearInterval(this.timerInt);
        if (!answered) {
          answered = true;
          if (this._quizKeyHandler) window.removeEventListener('keydown', this._quizKeyHandler);
          grid.querySelectorAll('.h-ans-btn').forEach(b => {
            if (b.dataset.answer === q.correct) b.classList.add('correct');
          });
          if (Net.connected && !Net.isHost) {
            Net.send({ t: 'answerHurdle', isCorrect: false, elapsed: timeLimit, picked: null });
          } else {
            this.processHurdleResult(false, timeLimit, 'Timeout');
          }
        }
      }
    }, 100);
  },

  // For the SPECTATOR (other runner)
  _showHurdleSpectator(q, isSuper, player, runnerName) {
    const overlay = document.getElementById('h-quiz-overlay');
    const result = document.getElementById('h-quiz-result');
    const card = document.getElementById('h-quiz-card');
    overlay.classList.remove('hidden');
    overlay.classList.add('h-spectator-mode');
    result.classList.add('hidden');
    card.style.display = 'block';

    document.getElementById('h-quiz-who').innerHTML =
      `⏳ <span style="color:var(--warning)">${runnerName} is answering...</span>` +
      (isSuper ? '<br><span style="color:#ffd700;font-size:14px">⭐ SUPER HURDLE ⭐</span>' : '');
    document.getElementById('h-topic-tag').textContent = q.topic || 'General';
    document.getElementById('h-question').textContent = q.question;

    const answers = q.answerOrder || [q.correct, ...q.distractors].slice(0, 4);
    const grid = document.getElementById('h-quiz-answers');
    grid.innerHTML = '';
    answers.forEach((ans) => {
      const btn = document.createElement('button');
      btn.className = 'h-ans-btn h-spectator-btn';
      btn.dataset.answer = ans;
      btn.textContent = ans;
      btn.disabled = true;
      grid.appendChild(btn);
    });

    let timeLeft = isSuper ? 5 : 8;
    const total = timeLeft;
    const timerBar = document.getElementById('h-quiz-timer');
    timerBar.style.width = '100%';
    if (this.timerInt) clearInterval(this.timerInt);
    this.timerInt = setInterval(() => {
      timeLeft -= 0.1;
      timerBar.style.width = Math.max(0, (timeLeft / total * 100)) + '%';
      if (timeLeft <= 0) clearInterval(this.timerInt);
    }, 100);
  },

  hSpectateHighlight(picked) {
    const grid = document.getElementById('h-quiz-answers');
    if (!grid) return;
    grid.querySelectorAll('.h-ans-btn').forEach(b => {
      b.classList.toggle('spectate-picked', b.dataset.answer === picked);
    });
  },

  processHurdleResult(isCorrect, elapsed, answerText) {
    if (!this.currentHurdle) return;
    const { player, idx } = this.currentHurdle;
    const h = this.hurdleData[idx];
    const p = player === 1 ? this.p1 : this.p2;

    // Clear any lingering interval (spectator side never cleared its own timer).
    if (this.timerInt) { clearInterval(this.timerInt); this.timerInt = null; }

    // Update SRS so the same question gets prioritized / spaced properly
    const qObj = player === 1 ? h.q1 : h.q2;
    if (qObj && typeof qObj.qIdx === 'number' && typeof SRS !== 'undefined') {
      const result = !isCorrect ? 'wrong' : (elapsed > (h.isSuper ? 4 : 6) ? 'slow' : 'fast');
      SRS.update(qObj.qIdx, result, !!qObj.complex);
    }

    p.total++; p.hurdle++;
    let msg = '';

    if (isCorrect) {
      p.correct++; p.streak++;
      const isFast = elapsed < (h.isSuper ? 3 : 5);
      if (h.isSuper) {
        p.boost = 150;
        p.speed = Math.min(2.5, p.speed + 0.15);
        msg = `<span>🌟</span><span style="color:gold">SUPER! Mega boost! 🚀🚀🚀${p.streak>=3?' 🔥x'+p.streak:''}</span>`;
      } else if (isFast) {
        p.boost = 90;
        msg = `<span>✅</span><span style="color:var(--success)">Speed boost! 🚀${p.streak>=3?' 🔥x'+p.streak:''}</span>`;
      } else {
        msg = `<span>✅</span><span style="color:var(--success)">Clean jump!${p.streak>=3?' 🔥x'+p.streak:''}</span>`;
      }
      if (p.streak >= 3) p.speed = Math.min(2.5, p.speed + 0.05);
      Audio.correct();
    } else {
      p.streak = 0;
      p.stumble = h.isSuper ? 150 : 90;
      p.speed = Math.max(0.8, p.speed - 0.1);
      msg = `<span>❌</span><span style="color:var(--danger)">${h.isSuper?'SUPER FAIL! 💀':'Crash!'}</span>`;
      Audio.wrong();
    }
    p.bestStreak = Math.max(p.bestStreak || 0, p.streak);

    if (Net.connected && Net.isHost) {
      Net.send({ t: 'rpc', cmd: 'hideHurdle',
        isCorrect, msg, p1: this.p1, p2: this.p2, picked: answerText });
    }

    this.showHurdleResult(isCorrect, msg, () => {
      this.quizActive = false;
      this.currentHurdle = null;
      this.state = 'racing';
      this.lastTime = performance.now();
      Net.captureKeys(true);
      this.animId = requestAnimationFrame((t) => this.loop(t));
    });
  },

  handleGuestAnswer(data) {
    // Guest was runner, sent their answer to host
    this.processHurdleResult(data.isCorrect, data.elapsed, data.picked);
  },

  handleGuestPick(data) {
    // Guest was runner, previewing an answer; relay to spectator (host shows highlight locally)
    this.hSpectateHighlight(data.picked);
    // And relay to all peers (but since we're P2P there are only 2, this is already local)
  },

  applyGameState(data) {
    this.state = data.state;
    if (data.p1) this.p1 = data.p1;
    if (data.p2) this.p2 = data.p2;
    // Update HUD
    if (this.p1) document.getElementById('race-p1-hurdle').textContent = `${this.p1.hurdle}/${this.numHurdles}`;
    if (this.p2) document.getElementById('race-p2-hurdle').textContent = `${this.p2.hurdle}/${this.numHurdles}`;
    if (this.raceStart) {
      const elapsed = ((Date.now() - this.raceStart) / 1000).toFixed(1);
      const timerEl = document.getElementById('race-timer');
      if (timerEl) timerEl.textContent = elapsed + 's';
    }
  },

  handleRPC(data) {
    if (data.cmd === 'showHurdle') {
      this.state = 'quiz';
      this.quizActive = true;
      this.currentHurdle = { player: data.player, idx: -1 };
      cancelAnimationFrame(this.animId);
      Net.captureKeys(false);
      const runnerName = data.player === 1 ? (this.p1 ? this.p1.name : 'Runner 1') : (this.p2 ? this.p2.name : 'Runner 2');
      if (data.canAnswer) {
        this._showHurdleAnswer(data.q, data.isSuper, data.player, runnerName);
      } else {
        this._showHurdleSpectator(data.q, data.isSuper, data.player, runnerName);
      }
    } else if (data.cmd === 'hSpectateAnswer') {
      // Host is relaying its own answer preview to guest
      this.hSpectateHighlight(data.picked);
    } else if (data.cmd === 'hideHurdle') {
      clearInterval(this.timerInt);
      if (data.p1) this.p1 = data.p1;
      if (data.p2) this.p2 = data.p2;
      if (data.isCorrect) Audio.correct(); else Audio.wrong();
      this.showHurdleResult(data.isCorrect, data.msg, () => {
        this.quizActive = false;
        this.currentHurdle = null;
        this.state = 'racing';
        this.lastTime = performance.now();
        Net.captureKeys(true);
        this.animId = requestAnimationFrame((t) => this.loop(t));
      });
    } else if (data.cmd === 'hFinishRace') {
      if (data.p1) this.p1 = data.p1;
      if (data.p2) this.p2 = data.p2;
      this.state = 'finished';
      cancelAnimationFrame(this.animId);
      Net.captureKeys(false);
      this._renderFinish();
    }
  },

  showHurdleResult(isCorrect, msg, cb) {
    const overlay = document.getElementById('h-quiz-overlay');
    const result = document.getElementById('h-quiz-result');
    document.getElementById('h-quiz-card').style.display = 'none';
    result.classList.remove('hidden');
    result.className = isCorrect ? 'h-result correct' : 'h-result wrong';
    result.innerHTML = `<h3>${isCorrect ? '✅ CORRECT!' : '❌ WRONG!'}</h3><p>${msg}</p>`;
    setTimeout(() => {
      overlay.classList.add('hidden');
      overlay.classList.remove('h-spectator-mode');
      cb();
    }, 1500);
  },

  render() {
    const c = this.ctx;
    c.fillStyle = '#0a0a1a'; c.fillRect(0, 0, this.W, this.H);
    c.strokeStyle = 'rgba(255,255,255,0.03)';
    for (let x = 0; x < this.W; x += 40) { c.beginPath(); c.moveTo(x,0); c.lineTo(x,this.H); c.stroke(); }
    c.fillStyle = 'rgba(46,213,115,0.05)'; c.fillRect(0, this.p1.lane-35, this.W, 70);
    c.fillStyle = 'rgba(255,102,68,0.05)'; c.fillRect(0, this.p2.lane-35, this.W, 70);
    c.strokeStyle = 'rgba(255,255,255,0.1)'; c.setLineDash([8,8]);
    c.beginPath(); c.moveTo(0, this.H/2); c.lineTo(this.W, this.H/2); c.stroke(); c.setLineDash([]);
    this.hurdleData.forEach((h, i) => {
      const done = h.p1Done && h.p2Done;
      if (h.isSuper) {
        c.fillStyle = done ? 'rgba(255,215,0,0.15)' : 'rgba(255,215,0,0.8)';
        c.fillRect(h.xPos-5, this.p1.lane-25, 10, 50);
        c.fillRect(h.xPos-5, this.p2.lane-25, 10, 50);
        if (!done) {
          c.fillStyle = 'gold'; c.font = '10px sans-serif'; c.textAlign = 'center';
          c.fillText('⭐', h.xPos, this.H/2+4);
        }
      } else {
        c.fillStyle = done ? 'rgba(255,255,255,0.08)' : 'rgba(255,165,2,0.5)';
        c.fillRect(h.xPos-3, this.p1.lane-20, 6, 40);
        c.fillRect(h.xPos-3, this.p2.lane-20, 6, 40);
      }
      c.fillStyle = 'rgba(255,255,255,0.2)'; c.font = '7px "Press Start 2P"'; c.textAlign = 'center';
      c.fillText(i+1, h.xPos, this.H/2+4);
    });
    c.fillStyle = 'rgba(255,215,0,0.3)'; c.fillRect(this.W-40, 0, 4, this.H);
    c.font = '10px "Press Start 2P"'; c.fillStyle = 'gold';
    c.save(); c.translate(this.W-20, this.H/2); c.rotate(-Math.PI/2); c.fillText('FINISH', 0, 0); c.restore();
    this.drawRunner(this.p1, '#2ed573');
    this.drawRunner(this.p2, '#ff6644');
    const diff = Math.abs(this.p1.x - this.p2.x).toFixed(0);
    if (diff > 30) {
      const lead = this.p1.x > this.p2.x ? this.p1.name : this.p2.name;
      c.fillStyle = 'rgba(255,255,255,0.4)'; c.font = '10px Outfit'; c.textAlign = 'center';
      c.fillText(`${lead} leads!`, this.W/2, 18);
    }
    // Indicate local player
    if (Net.connected || this.soloMode) {
      const me = this.localPlayer === 'p1' ? this.p1 : this.p2;
      c.fillStyle = 'rgba(0,255,170,0.7)';
      c.font = '8px "Press Start 2P"'; c.textAlign = 'center';
      c.fillText('YOU', me.x, me.lane - 40);
    }
  },

  drawRunner(p, color) {
    const c = this.ctx;
    c.fillStyle = color; c.shadowColor = color; c.shadowBlur = p.boost > 0 ? 30 : 8;
    c.beginPath(); c.arc(p.x, p.lane, 12, 0, Math.PI*2); c.fill(); c.shadowBlur = 0;
    if (p.streak >= 3) {
      c.font = '14px sans-serif'; c.textAlign = 'center';
      c.fillText('🔥', p.x, p.lane - 22);
      c.fillStyle = 'rgba(255,165,0,0.5)'; c.font = '8px "Press Start 2P"';
      c.fillText('x' + p.streak, p.x + 15, p.lane - 18);
    }
    if (p.stumble > 0) {
      c.strokeStyle = '#ff4757'; c.lineWidth = 2;
      c.beginPath(); c.arc(p.x, p.lane, 16, 0, Math.PI*2); c.stroke();
      c.fillStyle = '#ff4757'; c.font = '14px sans-serif'; c.textAlign = 'center';
      c.fillText('💫', p.x, p.lane-20);
    }
    if (p.boost > 0) { c.font = '12px sans-serif'; c.textAlign = 'center'; c.fillText('🚀', p.x-20, p.lane); }
    c.fillStyle = color; c.font = '9px "Press Start 2P"'; c.textAlign = 'center';
    c.fillText(p.name.substring(0,8), p.x, p.lane+28);
  },

  finishRace() {
    this.state = 'finished';
    cancelAnimationFrame(this.animId);
    Net.captureKeys(false);
    if (Net.connected && Net.isHost) {
      Net.send({ t: 'rpc', cmd: 'hFinishRace', p1: this.p1, p2: this.p2 });
    }
    this._renderFinish();
  },

  _renderFinish() {
    const winner = this.p1.x >= this.p2.x ? this.p1 : this.p2;
    const totalTime = ((Date.now() - this.raceStart)/1000).toFixed(1);
    document.getElementById('h-finish-title').textContent = `🏆 ${winner.name} Wins!`;
    const bestStreak = Math.max(this.p1.bestStreak || 0, this.p2.bestStreak || 0);
    document.getElementById('h-finish-stats').innerHTML = `
      <div class="h-stat"><div class="h-stat-label">${this.p1.name} Accuracy</div><div class="h-stat-val" style="color:var(--p1)">${this.p1.total?Math.round(this.p1.correct/this.p1.total*100):0}%</div></div>
      <div class="h-stat"><div class="h-stat-label">${this.p2.name} Accuracy</div><div class="h-stat-val" style="color:var(--p2)">${this.p2.total?Math.round(this.p2.correct/this.p2.total*100):0}%</div></div>
      <div class="h-stat"><div class="h-stat-label">Race Time</div><div class="h-stat-val">${totalTime}s</div></div>
      <div class="h-stat"><div class="h-stat-label">Best Streak</div><div class="h-stat-val">${bestStreak > 0 ? '🔥 x' + bestStreak : '—'}</div></div>`;
    this.showScreen('h-finish');
    Audio.gameOver();
    const cv = document.getElementById('confetti-canvas-h');
    if (!cv) return;
    cv.width = window.innerWidth; cv.height = window.innerHeight;
    const cx = cv.getContext('2d');
    const pcs = [];
    const cols = ['#ff4757','#2ed573','#ffa502','#6c5ce7','#fd79a8','gold'];
    for(let i=0;i<120;i++) pcs.push({x:Math.random()*cv.width,y:Math.random()*-cv.height,w:6+Math.random()*5,h:4+Math.random()*4,color:cols[Math.floor(Math.random()*cols.length)],vy:2+Math.random()*3,vx:-1+Math.random()*2,rot:Math.random()*360,rv:-3+Math.random()*6});
    let f=0;
    (function dr(){cx.clearRect(0,0,cv.width,cv.height);pcs.forEach(p=>{p.y+=p.vy;p.x+=p.vx;p.rot+=p.rv;cx.save();cx.translate(p.x,p.y);cx.rotate(p.rot*Math.PI/180);cx.fillStyle=p.color;cx.fillRect(-p.w/2,-p.h/2,p.w,p.h);cx.restore()});if(++f<180)requestAnimationFrame(dr);else cx.clearRect(0,0,cv.width,cv.height)})();
  }
};

window.addEventListener('DOMContentLoaded', () => Hurdles.init());
