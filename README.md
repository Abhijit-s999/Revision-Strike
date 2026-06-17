# Revision Strike ⚔️

A free, two-player browser game for revising **any** school subject. Two players, one MCQ pool, two ways to compete:

- **Revision Strike** — a top-down arena shooter where every bullet that lands triggers a multiple-choice question. Answer right to deflect the shot, answer wrong to lose HP.
- **Duo Hurdles** — a side-scrolling race where each hurdle is an MCQ. Get it right, sprint forward. Get it wrong, stumble.

Everything runs in the browser. No accounts, no servers to deploy. Multiplayer uses peer-to-peer (PeerJS) — both players just open the same URL.

---

## How to play (Windows)

1. **Download or clone** this repo.
2. Double-click **`install.bat`** once — it checks you have Python (used to serve the files locally). If you don't, it points you to the installer.
3. Double-click **`start.bat`** — your browser opens to the game. Leave the black window open while you play.
4. Pick **🎯 Solo Practice** to play alone vs. a dummy, or **🌐 Online Multiplayer** to play with a friend.

### Playing with a friend

Both players need to open the **same URL**:
- If you're both on the same Wi-Fi: one of you runs `start.bat`, then the other opens `http://<your-ip>:8765/index.html` from their laptop.
- If you're far apart: host the files anywhere (GitHub Pages works, so does an [ngrok](https://ngrok.com) tunnel) and share that URL. PeerJS handles the actual connection between browsers.

First to open the page = **P1 (host)**. Second = **P2 (guest)**.

### Controls

| Action | Key |
|--------|-----|
| Move | **WASD** |
| Shoot | **SPACE** |
| Pick MCQ answer | **1 / 2 / 3 / 4** (or click) |
| Character select | **A / D** to cycle, **SPACE** to confirm |
| Hurdles sprint | Hold **SPACE** / **D** / **→** |

---

## Using your own questions

The game ships with a starter pack (Spanish vocab from the original build, plus the topics in `questions.txt`). To revise *your own* subject, write a `.txt` file and upload it in the lobby.

### File format

```
TOPIC: Math

Q: What is 7 × 8?
A: 56
D: 54
D: 64
D: 49

Q: What is the square root of 144?
A: 12
D: 14
D: 11
D: 24


TOPIC: Geography

Q: Capital of Japan?
A: Tokyo
D: Beijing
D: Seoul
D: Bangkok
```

Rules:
- `TOPIC:` sticks until you change it. Default is `General`.
- Each question is one block: `Q:`, `A:`, then exactly **3** `D:` lines (distractors).
- Lines starting with `#` are comments. Blank lines are ignored.
- Prefix `Q:` with `!` (`!Q:`) to mark the question as **complex** — gets a 3-star difficulty tag and a longer spaced-repetition interval.

A full annotated example is in [`questions.txt`](questions.txt) — copy it, edit it, then upload your copy in the lobby. Your friend doesn't need to upload anything; the **host** drives the question pool, and the guest just receives the questions over the network.

### Where to upload it

- **Revision Strike** lobby → **📄 Load Questions File** widget under the topic picker.
- **Duo Hurdles** lobby → same widget under the topic grid.

---

## What's inside

| File | What it does |
|------|--------------|
| `index.html`, `game.js`, `ui.js`, `renderer.js` | The arena shooter |
| `hurdles.html`, `hurdles.js`, `hurdles.css` | The hurdles race |
| `questions.js` | Built-in MCQ starter pack |
| `questions.txt` | Template for student-written questions |
| `loader.js` | Parses uploaded `.txt` files into the in-game question pool |
| `srs.js` | Lightweight spaced-repetition scheduler |
| `net.js` | PeerJS multiplayer layer (host = P1, guest = P2) |
| `audio.js` | Web-Audio sound effects (no audio files needed) |
| `style.css` | Shared styling |
| `install.bat`, `start.bat` | Windows one-click launchers |

No Node, no npm, no build step. Just files served over HTTP.

---

## Character abilities (Revision Strike only)

| Character | Ability | Effect |
|-----------|---------|--------|
| 🤺 El Matador | Estocada | Bullets travel 40% faster |
| 💃 La Bailarina | Gracia | +15% movement speed, 25% chance bullets pass through |
| 👨‍🍳 El Chef | Sazón | Starts with 4 ammo (max 4), 30% faster reload, +10 HP on correct answer |
| 👩‍⚕️ La Doctora | Cura | +1 HP every 3s, +50% shield duration, +3s on quiz timer |

You can rename these to fit your class theme by editing `Game.CHAR_ABILITIES` in `game.js` and `UI.CHARS` in `ui.js` — same indices.

---

## License

MIT. Do whatever you want with it — fork it for your class, repackage it, add your own subjects.

## Credits

Built for IB AB Initio Spanish revision, then generalized so anyone can use it for any MCQ-based study material.
