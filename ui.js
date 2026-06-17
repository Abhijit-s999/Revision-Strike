// UI Controller — Revision Strike
const UI = {
  screens: {},
  selectedTopic: '__all__',

  init() {
    this.screens = {
      lobby: document.getElementById('screen-lobby'),
      charselect: document.getElementById('screen-charselect'),
      arena: document.getElementById('screen-arena'),
      gameover: document.getElementById('screen-gameover')
    };
  },

  showScreen(name) {
    Object.values(this.screens).forEach(s => s && s.classList.remove('active'));
    if (this.screens[name]) this.screens[name].classList.add('active');
  },

  // === Topic picker ===
  buildTopicGrid() {
    const grid = document.getElementById('topic-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.id = 'topic-btn-all';
    allBtn.className = 'topic-btn selected';
    allBtn.textContent = '🎲 Random Mix';
    allBtn.dataset.topic = '__all__';
    allBtn.onclick = () => this.selectTopic(allBtn);
    grid.appendChild(allBtn);
    TOPICS.forEach(t => {
      if (t == null) return; // skip undefined/null topics from malformed questions
      const btn = document.createElement('button');
      btn.id = 'topic-btn-' + t.replace(/\s+/g, '-');
      btn.className = 'topic-btn';
      btn.textContent = t;
      btn.dataset.topic = t;
      btn.onclick = () => this.selectTopic(btn);
      grid.appendChild(btn);
    });
  },

  selectTopic(btn) {
    if (btn.id && typeof Net !== 'undefined') Net.mirrorClick(btn.id);
    document.querySelectorAll('.topic-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    this.selectedTopic = btn.dataset.topic;
  },

  // === Character list ===
  CHARS: [
    { emoji: '🤺', name: 'El Matador',  ability: 'Estocada', desc: 'Faster bullets + dash' },
    { emoji: '💃', name: 'La Bailarina', ability: 'Gracia',   desc: '+15% speed, 25% dodge' },
    { emoji: '👨‍🍳', name: 'El Chef',    ability: 'Sazón',   desc: '4 ammo, fast reload, heal +10' },
    { emoji: '👩‍⚕️', name: 'La Doctora', ability: 'Cura',    desc: 'HP regen, +50% shield' }
  ],

  // === Character select (single player per device) ===
  // Called in both online MP and solo. In MP, there's one grid ("me"); the
  // remote player picks their own on their own device.
  buildCharSelectSingle(myName, role) {
    // Show the single-grid layout.
    const wrap = document.getElementById('charselect-wrap');
    wrap.classList.add('single-mode');
    document.getElementById('cs-me-name').textContent = myName;
    document.getElementById('cs-me-role-label').textContent =
      role === 'p1' ? '⚡ YOU ARE P1' : '🔥 YOU ARE P2';
    document.getElementById('cs-me-confirmed').classList.add('hidden');
    const them = document.getElementById('cs-them-confirmed');
    if (them) them.classList.add('hidden');

    const grid = document.getElementById('char-grid-me');
    grid.innerHTML = '';
    this.CHARS.forEach((ch, i) => {
      const card = document.createElement('div');
      card.className = 'char-card' + (i === 0 ? ' selected-me' : '');
      card.dataset.idx = i;
      card.innerHTML = `
        <span class="char-emoji">${ch.emoji}</span>
        <span class="char-name">${ch.name}</span>
        <span class="char-ability">${ch.ability || ''}</span>
        <span class="char-desc">${ch.desc || ''}</span>`;
      card.onclick = () => {
        grid.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected-me'));
        card.classList.add('selected-me');
      };
      grid.appendChild(card);
    });
  },

  getSelectedSingleIdx() {
    const el = document.querySelector('#char-grid-me .selected-me');
    return el ? parseInt(el.dataset.idx, 10) : 0;
  },

  // === HUD ===
  updateHP(player, hp) {
    const bar = document.getElementById(`hp-bar-${player}`);
    const text = document.getElementById(`hp-text-${player}`);
    if (!bar || !text) return;
    bar.style.width = Math.max(0, hp) + '%';
    text.textContent = Math.max(0, Math.round(hp)) + ' HP';
    if (hp < 30) bar.style.background = 'linear-gradient(90deg, #ff4757, #ff6b81)';
    else bar.style.background = '';
  },

  updateAmmo(player, ammo, maxAmmo) {
    const wrap = document.getElementById(`ammo-${player}`);
    if (!wrap) return;
    // Rebuild to respect maxAmmo (could be 3 or 4 depending on character)
    let max = maxAmmo;
    if (max == null) {
      const game = (typeof Game !== 'undefined') ? Game : null;
      max = game && game[player] ? game[player].maxAmmo : 3;
    }
    if (wrap.childElementCount !== max) {
      wrap.innerHTML = '';
      for (let i = 0; i < max; i++) {
        const s = document.createElement('span');
        s.className = 'ammo-bullet';
        s.textContent = '●';
        wrap.appendChild(s);
      }
    }
    wrap.querySelectorAll('.ammo-bullet').forEach((b, i) => {
      b.classList.toggle('spent', i >= ammo);
    });
  },

  updateScore(s1, s2) {
    const el = document.getElementById('hud-score');
    if (el) el.textContent = `${s1} – ${s2}`;
  },

  updateSRSIndicator(dueCount) {
    const el = document.getElementById('srs-indicator');
    if (el) el.textContent = dueCount > 0 ? `🔁 ${dueCount} due` : '✨ all fresh';
  },

  setControlsHint(localPlayer, soloMode) {
    const bar = document.querySelector('.controls-bar');
    if (!bar) return;
    if (soloMode) {
      bar.innerHTML = `<span>🎮 WASD move · SPACE shoot</span><span class="cb-sub">Solo mode · P2 is a dummy</span>`;
    } else if (typeof Net !== 'undefined' && Net.connected) {
      bar.innerHTML = `<span>🎮 WASD move · SPACE shoot</span><span class="cb-sub">You are ${localPlayer.toUpperCase()} — online MP</span>`;
    } else {
      bar.innerHTML = `<span>🎮 WASD move · SPACE shoot</span>`;
    }
  },

  // ============================================
  //  QUIZ (defender answers)
  // ============================================
  // answerOrder: the full list of answers in the exact order to display.
  // Both host/guest agree on this so spectator highlighting lines up.
  showQuiz(question, defenderName, answerOrder, timerBonus, onAnswer, onPick) {
    const overlay = document.getElementById('overlay-quiz');
    const result = document.getElementById('quiz-result');
    const card = document.getElementById('quiz-card');

    overlay.classList.remove('hidden');
    overlay.classList.remove('spectator-mode');
    result.classList.add('hidden');
    card.style.display = '';

    document.getElementById('incoming-text').textContent = defenderName.toUpperCase() + ', INCOMING!';
    document.getElementById('incoming-sub').textContent = 'Deflect the shot by answering correctly!';

    const banner = document.getElementById('incoming-banner');
    banner.style.animation = 'none'; void banner.offsetHeight; banner.style.animation = '';
    card.style.animation = 'none'; void card.offsetHeight; card.style.animation = '';

    document.getElementById('quiz-topic-tag').textContent = question.topic;
    document.getElementById('quiz-difficulty').textContent = question.complex ? '⭐⭐⭐' : '⭐';
    document.getElementById('quiz-player-tag').textContent = defenderName + ' defending';

    if (question.type === 'conjugation') {
      document.getElementById('quiz-lang-hint').textContent = '📝 Conjugate:';
    } else {
      document.getElementById('quiz-lang-hint').textContent = '🇬🇧 → 🇪🇸 What is this in Spanish?';
    }
    document.getElementById('quiz-question').textContent = question.q;
    document.getElementById('quiz-context').textContent = '';

    this._setupAnswerButtons(question, answerOrder || this._shuffleAnswers(question), timerBonus || 0, onAnswer, onPick);
  },

  _shuffleAnswers(q) {
    const a = [q.a, ...q.d];
    return a.sort(() => (typeof Net !== 'undefined' ? Net.random() : Math.random()) - 0.5);
  },

  // ============================================
  //  SPECTATE QUIZ (other player is answering)
  // ============================================
  showSpectateQuiz(question, defenderName, answerOrder, timerBonus) {
    const overlay = document.getElementById('overlay-quiz');
    const result = document.getElementById('quiz-result');
    const card = document.getElementById('quiz-card');

    overlay.classList.remove('hidden');
    overlay.classList.add('spectator-mode');
    result.classList.add('hidden');
    card.style.display = '';

    document.getElementById('incoming-text').textContent = '⏳ ' + defenderName.toUpperCase() + ' IS ANSWERING...';
    document.getElementById('incoming-sub').textContent = 'You are spectating. Watch their answer!';

    const banner = document.getElementById('incoming-banner');
    banner.style.animation = 'none'; void banner.offsetHeight; banner.style.animation = '';
    card.style.animation = 'none'; void card.offsetHeight; card.style.animation = '';

    document.getElementById('quiz-topic-tag').textContent = question.topic;
    document.getElementById('quiz-difficulty').textContent = question.complex ? '⭐⭐⭐' : '⭐';
    document.getElementById('quiz-player-tag').textContent = defenderName + ' defending';
    document.getElementById('quiz-lang-hint').textContent =
      question.type === 'conjugation' ? '📝 Conjugate:' : '🇬🇧 → 🇪🇸 What is this in Spanish?';
    document.getElementById('quiz-question').textContent = question.q;
    document.getElementById('quiz-context').textContent = '👀 Spectating — waiting for their answer...';

    const answers = answerOrder || this._shuffleAnswers(question);
    const grid = document.getElementById('quiz-answers');
    grid.innerHTML = '';
    answers.forEach((ans, i) => {
      const btn = document.createElement('button');
      btn.className = 'quiz-answer-btn spectator-btn';
      btn.textContent = ans;
      btn.dataset.answer = ans;
      btn.disabled = true;
      grid.appendChild(btn);
    });

    // Visual countdown (doesn't actually control anything; the defender's side does)
    let timeLeft = 15 + (timerBonus || 0);
    const totalTime = timeLeft;
    const timerBar = document.getElementById('quiz-timer-bar');
    const timerText = document.getElementById('quiz-timer-text');
    timerBar.style.width = '100%';
    if (this._spectateTimer) clearInterval(this._spectateTimer);
    this._spectateTimer = setInterval(() => {
      timeLeft -= 0.1;
      timerBar.style.width = Math.max(0, (timeLeft / totalTime * 100)) + '%';
      timerText.textContent = Math.max(0, Math.ceil(timeLeft)) + 's';
      if (timeLeft <= 0) clearInterval(this._spectateTimer);
    }, 100);
  },

  // Highlight the answer the defender is currently hovering on.
  spectateHighlight(answerText) {
    const grid = document.getElementById('quiz-answers');
    if (!grid) return;
    grid.querySelectorAll('.quiz-answer-btn').forEach(b => {
      b.classList.toggle('spectate-picked', b.dataset.answer === answerText);
    });
  },

  // ============================================
  //  STANDOFF (both players race for the same question)
  // ============================================
  // role: 'p1' or 'p2' → which player I am on this device
  showStandoff(question, p1Name, p2Name, answerOrder, role, onResult) {
    const overlay = document.getElementById('overlay-quiz');
    const result = document.getElementById('quiz-result');
    const card = document.getElementById('quiz-card');

    overlay.classList.remove('hidden');
    overlay.classList.remove('spectator-mode');
    result.classList.add('hidden');
    card.style.display = '';

    document.getElementById('incoming-text').textContent = '⚔️ STANDOFF!';
    document.getElementById('incoming-sub').textContent = `${p1Name} vs ${p2Name} — first correct answer wins!`;

    const banner = document.getElementById('incoming-banner');
    banner.style.animation = 'none'; void banner.offsetHeight; banner.style.animation = '';
    card.style.animation = 'none'; void card.offsetHeight; card.style.animation = '';

    document.getElementById('quiz-topic-tag').textContent = question.topic;
    document.getElementById('quiz-difficulty').textContent = '⚔️ STANDOFF';
    document.getElementById('quiz-player-tag').textContent = 'Race to the correct answer!';
    document.getElementById('quiz-lang-hint').textContent =
      question.type === 'conjugation' ? '📝 Conjugate:' : '🇬🇧 → 🇪🇸 What is this in Spanish?';
    document.getElementById('quiz-question').textContent = question.q;
    document.getElementById('quiz-context').textContent = 'Keys 1-4 to answer · or click';

    const answers = answerOrder || this._shuffleAnswers(question);
    const grid = document.getElementById('quiz-answers');
    grid.innerHTML = '';
    const keys = ['1','2','3','4'];
    let answered = false;
    const startTime = Date.now();
    let timerInt;

    const lockIn = (idx) => {
      if (answered) return;
      answered = true;
      clearInterval(timerInt);
      window.removeEventListener('keydown', keyHandler);
      const btn = grid.children[idx];
      const ansText = btn && btn.dataset.answer;
      const isCorrect = ansText === question.a;
      const elapsed = (Date.now() - startTime) / 1000;

      if (btn) btn.classList.add(isCorrect ? 'correct' : 'wrong');
      if (!isCorrect) {
        grid.querySelectorAll('.quiz-answer-btn').forEach(b => {
          if (b.dataset.answer === question.a) b.classList.add('correct');
        });
      }
      // winner is THIS role number if correct, else 0 (wrong/draw marker)
      const playerNum = role === 'p1' ? 1 : 2;
      setTimeout(() => onResult(isCorrect ? playerNum : 0, elapsed), 500);
    };

    answers.forEach((ans, i) => {
      const btn = document.createElement('button');
      btn.className = 'quiz-answer-btn';
      btn.dataset.answer = ans;
      btn.innerHTML = `<span class="key-label">[${keys[i]}]</span>${ans}`;
      btn.onclick = () => lockIn(i);
      grid.appendChild(btn);
    });

    const keyHandler = (e) => {
      if (answered) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const ki = keys.indexOf(e.key);
      if (ki >= 0) lockIn(ki);
    };
    window.addEventListener('keydown', keyHandler);
    this._quizKeyHandler = keyHandler;

    let timeLeft = 12;
    const timerBar = document.getElementById('quiz-timer-bar');
    const timerText = document.getElementById('quiz-timer-text');
    timerBar.style.width = '100%';
    timerInt = setInterval(() => {
      timeLeft -= 0.1;
      timerBar.style.width = Math.max(0, (timeLeft / 12 * 100)) + '%';
      timerText.textContent = Math.max(0, Math.ceil(timeLeft)) + 's';
      if (timeLeft <= 3) Audio.tick();
      if (timeLeft <= 0) {
        clearInterval(timerInt);
        if (!answered) {
          answered = true;
          window.removeEventListener('keydown', keyHandler);
          grid.querySelectorAll('.quiz-answer-btn').forEach(b => {
            if (b.dataset.answer === question.a) b.classList.add('correct');
          });
          setTimeout(() => onResult(0, 12), 500);
        }
      }
    }, 100);
  },

  showStandoffResult(winner, winnerName, correctAnswer) {
    const result = document.getElementById('quiz-result');
    result.classList.remove('hidden');
    if (winner && winner > 0 && winnerName) {
      document.getElementById('result-icon').textContent = '⚔️';
      const rt = document.getElementById('result-text');
      rt.textContent = winnerName + ' wins the standoff!';
      rt.className = 'result-text correct-text';
      document.getElementById('result-xp').textContent = 'Their shot lands! 💥';
      document.getElementById('correct-answer-reveal').classList.add('hidden');
      Audio.correct();
    } else {
      document.getElementById('result-icon').textContent = '💨';
      const rt = document.getElementById('result-text');
      rt.textContent = 'Draw! Both bullets vanish!';
      rt.className = 'result-text wrong-text';
      document.getElementById('result-xp').textContent = 'Nobody wins this round.';
      const reveal = document.getElementById('correct-answer-reveal');
      reveal.classList.remove('hidden');
      reveal.textContent = '✅ Correct: ' + correctAnswer;
      Audio.wrong();
    }
  },

  // ============================================
  //  Internals for defender-answer buttons
  // ============================================
  _setupAnswerButtons(question, answers, timerBonus, onAnswer, onPick) {
    const grid = document.getElementById('quiz-answers');
    grid.innerHTML = '';
    const keys = ['1','2','3','4'];
    let answered = false;
    const startTime = Date.now();
    let timerInt;

    const submit = (ans, btn) => {
      if (answered) return;
      answered = true;
      clearInterval(timerInt);
      window.removeEventListener('keydown', keyHandler);
      const elapsed = (Date.now() - startTime) / 1000;
      const isCorrect = ans === question.a;
      if (btn) btn.classList.add(isCorrect ? 'correct' : 'wrong');
      if (!isCorrect) {
        grid.querySelectorAll('.quiz-answer-btn').forEach(b => {
          if (b.dataset.answer === question.a) b.classList.add('correct');
        });
      }
      if (onPick) { try { onPick(ans); } catch {} }
      setTimeout(() => onAnswer(isCorrect, elapsed), 700);
    };

    answers.forEach((ans, i) => {
      const btn = document.createElement('button');
      btn.className = 'quiz-answer-btn';
      btn.dataset.answer = ans;
      btn.innerHTML = `<span class="key-label">[${keys[i]}]</span>${ans}`;
      btn.onmouseenter = () => { if (!answered && onPick) onPick(ans); };
      btn.onclick = () => submit(ans, btn);
      grid.appendChild(btn);
    });

    const keyHandler = (e) => {
      if (answered) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const idx = keys.indexOf(e.key);
      if (idx >= 0 && grid.children[idx]) {
        const btn = grid.children[idx];
        if (onPick && !answered) { try { onPick(btn.dataset.answer); } catch {} }
        submit(btn.dataset.answer, btn);
      }
    };
    window.addEventListener('keydown', keyHandler);
    this._quizKeyHandler = keyHandler;

    let timeLeft = 15 + (timerBonus || 0);
    const totalTime = timeLeft;
    const timerBar = document.getElementById('quiz-timer-bar');
    const timerText = document.getElementById('quiz-timer-text');
    timerBar.style.width = '100%';
    timerInt = setInterval(() => {
      timeLeft -= 0.1;
      timerBar.style.width = Math.max(0, (timeLeft / totalTime * 100)) + '%';
      timerText.textContent = Math.max(0, Math.ceil(timeLeft)) + 's';
      if (timeLeft <= 5) Audio.tick();
      if (timeLeft <= 0) {
        clearInterval(timerInt);
        if (!answered) {
          answered = true;
          window.removeEventListener('keydown', keyHandler);
          grid.querySelectorAll('.quiz-answer-btn').forEach(b => {
            if (b.dataset.answer === question.a) b.classList.add('correct');
          });
          setTimeout(() => onAnswer(false, totalTime), 700);
        }
      }
    }, 100);
  },

  // ============================================
  //  Result splash (defender-answer post-screen)
  // ============================================
  showResult(isCorrect, correctAnswer, streakLabel) {
    const result = document.getElementById('quiz-result');
    const overlay = document.getElementById('overlay-quiz');
    overlay.classList.remove('spectator-mode');
    result.classList.remove('hidden');
    document.getElementById('result-icon').textContent = isCorrect ? '🛡️' : '💥';
    const rt = document.getElementById('result-text');
    rt.textContent = isCorrect ? 'DEFLECTED!' : 'BOOM! Hit taken!';
    rt.className = 'result-text ' + (isCorrect ? 'correct-text' : 'wrong-text');
    let xpText = isCorrect ? '+10 XP · Shield activated!' : '-20 HP · Ouch!';
    if (streakLabel) xpText += ' ' + streakLabel;
    document.getElementById('result-xp').textContent = xpText;
    if (!isCorrect) {
      const reveal = document.getElementById('correct-answer-reveal');
      reveal.classList.remove('hidden');
      reveal.textContent = '✅ Correct: ' + correctAnswer;
    } else {
      document.getElementById('correct-answer-reveal').classList.add('hidden');
    }
    if (isCorrect) Audio.correct(); else Audio.wrong();
  },

  hideQuiz() {
    document.getElementById('overlay-quiz').classList.add('hidden');
    document.getElementById('overlay-quiz').classList.remove('spectator-mode');
    if (this._quizKeyHandler) window.removeEventListener('keydown', this._quizKeyHandler);
    if (this._spectateTimer) { clearInterval(this._spectateTimer); this._spectateTimer = null; }
  },

  showReloadFlash(word, english) {
    const el = document.getElementById('overlay-reload');
    if (!el) return;
    document.getElementById('reload-word').textContent = word;
    document.getElementById('reload-en').textContent = `(${english})`;
    el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetHeight; el.style.animation = '';
    setTimeout(() => el.classList.add('hidden'), 800);
  },

  showGameOver(winner, p1, p2, stats) {
    this.showScreen('gameover');
    document.getElementById('gameover-title').textContent = '🏆 GAME OVER';
    document.getElementById('winner-announce').innerHTML =
      `<span style="color:${winner === 1 ? 'var(--p1)' : 'var(--p2)'}">${winner === 1 ? p1.name : p2.name}</span> WINS!`;
    const podium = document.getElementById('podium');
    const w = winner === 1 ? p1 : p2, l = winner === 1 ? p2 : p1;
    podium.innerHTML = `
      <div class="podium-player winner"><div class="podium-rank">🥇</div>
        <div class="podium-name" style="color:${winner===1?'var(--p1)':'var(--p2)'}">${w.name}</div>
        <div class="podium-score">${stats[winner===1?'p1Correct':'p2Correct']} correct</div></div>
      <div class="podium-player loser"><div class="podium-rank">🥈</div>
        <div class="podium-name" style="color:${winner===1?'var(--p2)':'var(--p1)'}">${l.name}</div>
        <div class="podium-score">${stats[winner===1?'p2Correct':'p1Correct']} correct</div></div>`;
    const sg = document.getElementById('stats-grid');
    sg.innerHTML = `
      <div class="stat-card"><div class="stat-label">P1 Accuracy</div><div class="stat-val p1-color">${stats.p1Total?Math.round(stats.p1Correct/stats.p1Total*100):0}%</div></div>
      <div class="stat-card"><div class="stat-label">P2 Accuracy</div><div class="stat-val p2-color">${stats.p2Total?Math.round(stats.p2Correct/stats.p2Total*100):0}%</div></div>
      <div class="stat-card"><div class="stat-label">Questions Asked</div><div class="stat-val">${stats.p1Total+stats.p2Total}</div></div>
      <div class="stat-card"><div class="stat-label">Shots Fired</div><div class="stat-val">${stats.totalShots||0}</div></div>`;
    const summary = SRS.getSummary();
    document.getElementById('srs-summary-content').innerHTML = `
      <div class="srs-word-row"><span>🟢 Mastered</span><span class="srs-status mastered">${summary.mastered}</span></div>
      <div class="srs-word-row"><span>🟡 Learning</span><span class="srs-status learning">${summary.learning}</span></div>
      <div class="srs-word-row"><span>🔴 Needs work</span><span class="srs-status struggle">${summary.struggling}</span></div>`;
    Audio.gameOver();
    this.confetti();
  },

  confetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');
    const pieces = [];
    const colors = ['#ff4757','#2ed573','#ffa502','#6c5ce7','#fd79a8','#00ffaa','#ff6644'];
    for (let i = 0; i < 120; i++) {
      pieces.push({ x: Math.random()*canvas.width, y: Math.random()*-canvas.height,
        w: 6+Math.random()*6, h: 4+Math.random()*4, color: colors[Math.floor(Math.random()*colors.length)],
        vy: 2+Math.random()*4, vx: -1+Math.random()*2, rot: Math.random()*360, rv: -3+Math.random()*6 });
    }
    let frames = 0;
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach(p => {
        p.y += p.vy; p.x += p.vx; p.rot += p.rv;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot*Math.PI/180);
        ctx.fillStyle = p.color; ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h); ctx.restore();
      });
      if (++frames < 200) requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    draw();
  },

  shake() {
    const arena = document.getElementById('screen-arena');
    if (!arena) return;
    arena.classList.add('shake');
    setTimeout(() => arena.classList.remove('shake'), 300);
  }
};
