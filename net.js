// Net.js — P2P multiplayer via PeerJS
// Host = Player 1, Guest = Player 2.
// Fixed room ID: first to connect becomes host, second becomes guest.
// Key capture is scoped to gameplay so lobby inputs aren't affected.

const Net = {
  peer: null,
  conn: null,
  connected: false,
  enabled: false,
  ROOM_ID: 'revision-strike-v1-' + (typeof GAME_ROOM !== 'undefined' ? GAME_ROOM : 'main'),
  _fromPeer: false,
  _seed: 12345,
  isHost: false,
  localRole: null,    // 'p1' or 'p2'

  localKeys: new Set(),
  remoteKeys: new Set(),
  _capturing: false,
  _inputInterval: null,
  _keydown: null,
  _keyup: null,
  _blur: null,

  random() {
    this._seed = (this._seed * 9301 + 49297) % 233280;
    return this._seed / 233280;
  },

  _showStatus(msg, isError) {
    document.querySelectorAll('.net-status').forEach(el => {
      el.textContent = msg;
      el.style.color = isError ? '#ff4757' : '#2ed573';
    });
  },

  start() {
    if (this.enabled) return;
    this.enabled = true;
    this._showStatus('Connecting...');
    this._tryHost();
  },

  _tryHost() {
    // Attempt to claim the host ID. If it's taken, connect as guest instead.
    try { this.peer = new Peer(this.ROOM_ID); }
    catch (e) { this._showStatus('PeerJS failed to init', true); return; }

    this.peer.on('open', () => {
      this._showStatus('⏳ Waiting for friend...');
    });

    this.peer.on('connection', (conn) => {
      this.conn = conn;
      this._setupConn(conn);
    });

    this.peer.on('error', (err) => {
      if (err && err.type === 'unavailable-id') {
        // Room ID already taken — be the guest instead
        try { this.peer.destroy(); } catch {}
        this.peer = null;
        this._joinAsGuest();
      } else {
        this._showStatus('Error: ' + (err.message || err.type || err), true);
      }
    });
  },

  _joinAsGuest() {
    try { this.peer = new Peer(); }
    catch (e) { this._showStatus('PeerJS failed to init', true); return; }

    this.peer.on('open', () => {
      this._showStatus('Joining...');
      const conn = this.peer.connect(this.ROOM_ID, { reliable: true });
      this.conn = conn;
      this._setupConn(conn);
    });

    this.peer.on('error', (e) => {
      this._showStatus('Error: ' + (e.message || e.type), true);
    });
  },

  _setupConn(conn) {
    conn.on('open', () => {
      this.connected = true;
      this.isHost = (this.peer.id === this.ROOM_ID);
      this.localRole = this.isHost ? 'p1' : 'p2';
      this._showStatus(this.isHost ? '✅ You are Player 1 (Host)' : '✅ You are Player 2 (Guest)');

      if (this.isHost) {
        this._seed = Math.floor(Math.random() * 1000000);
        try {
          this.send({ t: 'seed', val: this._seed,
            srs: (typeof SRS !== 'undefined' ? SRS.records : {}) });
        } catch {}
      }
    });

    conn.on('data', (data) => {
      this._fromPeer = true;
      try { this._handleMessage(data); } finally { this._fromPeer = false; }
    });

    conn.on('close', () => {
      this.connected = false;
      this._showStatus('❌ Disconnected', true);
    });
  },

  // Enable/disable key capture. Call with true when entering arena/race,
  // false when returning to lobby/quiz. This prevents lobby inputs being swallowed.
  captureKeys(on) {
    if (on && !this._capturing) {
      this._capturing = true;
      this.localKeys.clear();
      this.remoteKeys.clear();

      this._keydown = (e) => {
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        this.localKeys.add(e.key);
        this.localKeys.add(e.code);
      };
      this._keyup = (e) => {
        this.localKeys.delete(e.key);
        this.localKeys.delete(e.code);
      };
      this._blur = () => this.localKeys.clear();

      window.addEventListener('keydown', this._keydown);
      window.addEventListener('keyup', this._keyup);
      window.addEventListener('blur', this._blur);

      if (this._inputInterval) clearInterval(this._inputInterval);
      this._inputInterval = setInterval(() => {
        if (this.connected && !this.isHost) {
          this.send({ t: 'input', keys: Array.from(this.localKeys) });
        }
      }, 50);

    } else if (!on && this._capturing) {
      this._capturing = false;
      if (this._keydown) window.removeEventListener('keydown', this._keydown);
      if (this._keyup)   window.removeEventListener('keyup',   this._keyup);
      if (this._blur)    window.removeEventListener('blur',    this._blur);
      this._keydown = this._keyup = this._blur = null;
      if (this._inputInterval) { clearInterval(this._inputInterval); this._inputInterval = null; }
      this.localKeys.clear();
      this.remoteKeys.clear();
    }
  },

  _handleMessage(data) {
    switch (data.t) {
      case 'seed':
        this._seed = data.val;
        if (data.srs && typeof SRS !== 'undefined') SRS.records = data.srs;
        break;

      case 'input':
        if (this.isHost) this.remoteKeys = new Set(data.keys || []);
        break;

      case 'gameState':
        if (!this.isHost && typeof Game !== 'undefined') Game.applyGameState(data);
        break;

      case 'hurdlesState':
        if (!this.isHost && typeof Hurdles !== 'undefined') Hurdles.applyGameState(data);
        break;

      case 'rpc':
        if (!this.isHost) {
          const hurdlesCmds = new Set([
            'showHurdle', 'hideHurdle', 'hFinishRace',
            'hSpectateHurdle', 'hSpectateAnswer'
          ]);
          if (typeof Hurdles !== 'undefined' && hurdlesCmds.has(data.cmd)) {
            Hurdles.handleRPC(data);
          } else if (typeof Game !== 'undefined') {
            Game.handleRPC(data);
          }
        }
        break;

      case 'csPick':
        if (typeof Game !== 'undefined') Game.handleCsPick(data);
        break;

      case 'quizAnswer':
        if (this.isHost && typeof Game !== 'undefined') Game.handleGuestQuizAnswer(data);
        break;

      case 'quizPick':
        if (this.isHost && typeof Game !== 'undefined') Game.handleGuestQuizPick(data);
        break;

      case 'standoffAnswer':
        if (this.isHost && typeof Game !== 'undefined') Game.handleGuestStandoffAnswer(data);
        break;

      case 'answerHurdle':
        if (this.isHost && typeof Hurdles !== 'undefined') Hurdles.handleGuestAnswer(data);
        break;

      case 'hurdlePick':
        if (this.isHost && typeof Hurdles !== 'undefined') Hurdles.handleGuestPick(data);
        break;

      case 'click': {
        const el = document.getElementById(data.id);
        if (el) el.click();
        break;
      }
      case 'input_field': {
        const input = document.getElementById(data.id);
        if (input) input.value = data.v;
        break;
      }
    }
  },

  send(data) {
    if (this.conn && this.connected) {
      try { this.conn.send(data); } catch (e) {}
    }
  },

  mirrorClick(id) {
    if (this._fromPeer) return;
    this.send({ t: 'click', id });
  },

  mirrorInput(id) {
    if (this._fromPeer) return;
    const el = document.getElementById(id);
    if (el) this.send({ t: 'input_field', id, v: el.value });
  }
};
