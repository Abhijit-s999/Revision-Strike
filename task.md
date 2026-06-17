# Spanish Strike — Bug Hunt Log

## Already fixed (prior to this pass)
- hurdles.js syntax — line 424 is clean (verified with `node --check`)
- Audio.deflect() and Audio.damage() — present in audio.js
- game.js "dead code" at line 176 — file is restructured, no such issue
- Networking rewrite for role-aware P2P — done (net.js + game.js + ui.js)
- Spectator quiz view (showSpectateQuiz) — implemented
- Standoff (both answer same question, first correct wins) — implemented
- Character abilities applied at startArena — implemented

## Fixed in this pass
- [x] Guest never saw reload flash. Host runs physics for both players, but the
      reload-flash branch only fired when `localPlayer` matched. Host now sends a
      `reloadFlash` RPC to guest when guest's player reloads. (game.js)
- [x] Hurdles spectator timer leaked. `_showHurdleSpectator` set `this.timerInt`
      but `processHurdleResult` didn't clear it, so the bar kept ticking after the
      runner answered. Cleared at the top of `processHurdleResult`. (hurdles.js)
- [x] `UI.updateAmmo` silently dropped the third arg. Callsite passed
      `(player, ammo, maxAmmo)` but signature was `(player, ammo)`; max came from
      a global lookup. Signature now accepts maxAmmo with the global lookup as
      fallback. (ui.js)
- [x] Hurdles finish screen showed "Best Streak: 🔥" with no number. Now tracks
      `bestStreak` per runner and renders e.g. "🔥 x4". (hurdles.js)
- [x] When defender died from a quiz wrong-answer in MP, host sent both
      `gameOver` AND `hideQuiz` RPCs, briefly splashing the result over the
      game-over screen on the guest. Skip the `hideQuiz` when state is already
      gameover. (game.js — both host-defender and guest-defender paths)
