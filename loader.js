// loader.js — parse student-uploaded questions.txt and feed the game pool.
//
// File format (see questions.txt for full doc):
//   # comment
//   TOPIC: <topic name>            (sticks until changed)
//   [!]Q: <question>               (leading ! marks complex / 3-star)
//   A: <correct answer>
//   D: <distractor>                (exactly 3 of these per question)
//
// Output shape matches the built-in QUESTIONS array:
//   { q, a, d: [d1,d2,d3], topic, type: 'mcq', complex: bool }

const QuestionLoader = {
  parseText(txt) {
    const out = [];
    const errors = [];
    let topic = 'General';
    let cur = null; // { q, a, d, complex, topic, line }
    let lineNo = 0;

    const flush = () => {
      if (!cur) return;
      if (!cur.q) { errors.push(`Line ${cur.line}: question block missing Q:`); cur = null; return; }
      if (!cur.a) { errors.push(`Line ${cur.line}: "${cur.q}" missing A:`); cur = null; return; }
      if (cur.d.length !== 3) {
        errors.push(`Line ${cur.line}: "${cur.q}" needs exactly 3 D: lines (got ${cur.d.length})`);
        cur = null; return;
      }
      out.push({
        q: cur.q, a: cur.a, d: cur.d.slice(),
        topic: cur.topic, type: 'mcq', complex: cur.complex
      });
      cur = null;
    };

    for (const raw of txt.split(/\r?\n/)) {
      lineNo++;
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;

      const mTopic = line.match(/^TOPIC\s*:\s*(.+)$/i);
      if (mTopic) { topic = mTopic[1].trim() || 'General'; continue; }

      const mQ = line.match(/^(!)?\s*Q\s*:\s*(.+)$/i);
      if (mQ) {
        flush(); // previous question
        cur = { q: mQ[2].trim(), a: null, d: [], complex: !!mQ[1], topic, line: lineNo };
        continue;
      }

      const mA = line.match(/^A\s*:\s*(.+)$/i);
      if (mA) {
        if (!cur) { errors.push(`Line ${lineNo}: A: without a Q: before it`); continue; }
        cur.a = mA[1].trim();
        continue;
      }

      const mD = line.match(/^D\s*:\s*(.+)$/i);
      if (mD) {
        if (!cur) { errors.push(`Line ${lineNo}: D: without a Q: before it`); continue; }
        cur.d.push(mD[1].trim());
        continue;
      }

      errors.push(`Line ${lineNo}: unrecognized — "${line.slice(0, 60)}"`);
    }
    flush();

    return { questions: out, errors };
  },

  // Replace the global QUESTIONS / TOPICS with a parsed set.
  // Returns { count, topics, errors }.
  apply(parsed, sourceName) {
    if (!parsed.questions.length) {
      return { count: 0, topics: [], errors: parsed.errors.concat(['No valid questions found.']) };
    }
    window.QUESTIONS = parsed.questions;
    window.TOPICS = [...new Set(parsed.questions.map(q => q.topic))];
    window.QUESTIONS_SOURCE = sourceName || 'custom';
    // Reset SRS so old records don't reference the wrong question indices
    if (typeof SRS !== 'undefined') {
      SRS.records = {};
      try { SRS.save(); } catch {}
    }
    // Rebuild topic picker if UI is initialized
    if (typeof UI !== 'undefined' && UI.buildTopicGrid) UI.buildTopicGrid();
    return { count: parsed.questions.length, topics: window.TOPICS, errors: parsed.errors };
  },

  // Wire up the file <input> element to read .txt files via FileReader.
  bindFileInput(inputEl, statusEl) {
    inputEl.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const parsed = this.parseText(String(reader.result || ''));
        const result = this.apply(parsed, file.name);
        if (statusEl) {
          if (result.count === 0) {
            statusEl.textContent = '❌ ' + (result.errors[0] || 'Parse failed');
            statusEl.style.color = '#ff4757';
          } else {
            const errSuffix = result.errors.length ? ` (${result.errors.length} warnings)` : '';
            statusEl.textContent = `✅ Loaded ${result.count} questions across ${result.topics.length} topics from ${file.name}${errSuffix}`;
            statusEl.style.color = '#2ed573';
            if (result.errors.length) console.warn('Question file warnings:', result.errors);
          }
        }
      };
      reader.onerror = () => {
        if (statusEl) {
          statusEl.textContent = '❌ Could not read file';
          statusEl.style.color = '#ff4757';
        }
      };
      reader.readAsText(file);
    });
  }
};
