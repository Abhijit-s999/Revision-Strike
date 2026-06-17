// Spaced Repetition System for Revision Strike
const SRS = {
  KEY: 'revisionStrike_srs',
  records: {},

  load() {
    try {
      const d = localStorage.getItem(this.KEY);
      this.records = d ? JSON.parse(d) : {};
    } catch { this.records = {}; }
  },

  save() {
    localStorage.setItem(this.KEY, JSON.stringify(this.records));
  },

  getRecord(qIndex) {
    if (!this.records[qIndex]) {
      this.records[qIndex] = {
        nextReview: 0,
        interval: 0,
        streak: 0,
        timesAsked: 0,
        timesCorrect: 0
      };
    }
    return this.records[qIndex];
  },

  // Call after answering a question
  // result: 'wrong' | 'slow' | 'fast'
  update(qIndex, result, isComplex) {
    const r = this.getRecord(qIndex);
    r.timesAsked++;
    const now = Date.now();

    if (result === 'wrong') {
      r.streak = 0;
      r.interval = 1; // 1 minute
      r.nextReview = now + 60 * 1000;
    } else if (result === 'slow') {
      r.streak++;
      r.timesCorrect++;
      r.interval = 5; // 5 minutes
      r.nextReview = now + 5 * 60 * 1000;
    } else { // fast
      r.streak++;
      r.timesCorrect++;
      if (r.streak >= 3) {
        r.interval = 9999; // retired
        r.nextReview = now + 999 * 60 * 1000;
      } else {
        r.interval = isComplex ? 10 : 7; // 10 min complex, 7 min simple
        r.nextReview = now + r.interval * 60 * 1000;
      }
    }
    this.save();
  },

  // Get next question index to ask from a filtered list
  pickNext(questionIndices) {
    const now = Date.now();
    // Priority 1: due for review
    const due = questionIndices.filter(i => {
      const r = this.records[i];
      return r && r.nextReview <= now && r.interval < 9999;
    });
    if (due.length > 0) {
      // Pick the most overdue
      due.sort((a, b) => (this.records[a].nextReview) - (this.records[b].nextReview));
      return due[0];
    }
    // Priority 2: never asked
    const fresh = questionIndices.filter(i => !this.records[i] || this.records[i].timesAsked === 0);
    if (fresh.length > 0) {
      return fresh[Math.floor(Net.random() * fresh.length)];
    }
    // Priority 3: random from non-retired
    const active = questionIndices.filter(i => {
      const r = this.records[i];
      return !r || r.interval < 9999;
    });
    if (active.length > 0) {
      return active[Math.floor(Net.random() * active.length)];
    }
    // All retired — just pick random
    return questionIndices[Math.floor(Net.random() * questionIndices.length)];
  },

  // Get summary stats
  getSummary() {
    const entries = Object.entries(this.records);
    let mastered = 0, learning = 0, struggling = 0;
    entries.forEach(([, r]) => {
      if (r.interval >= 9999) mastered++;
      else if (r.streak >= 1) learning++;
      else if (r.timesAsked > 0) struggling++;
    });
    return { mastered, learning, struggling, total: entries.length };
  },

  getDueCount(questionIndices) {
    const now = Date.now();
    return questionIndices.filter(i => {
      const r = this.records[i];
      return r && r.nextReview <= now && r.interval < 9999;
    }).length;
  }
};

SRS.load();
