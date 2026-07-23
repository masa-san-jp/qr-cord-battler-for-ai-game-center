// QR SMASH ARENA — 効果音 / BGM（Web Audio による手続き合成。外部ファイル不要）。
// window.SFX として公開。AudioContext はユーザー操作で resume する（ブラウザ制約）。
// ミュートは M キー、または SFX.toggleMute()。設定は localStorage に保存。
(function () {
  let ctx = null, master = null, muted = false;
  try { muted = localStorage.getItem('qrsmash_muted') === '1'; } catch (e) {}

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);
    return true;
  }

  // ユーザー操作時に呼ぶ（無音ブラウザ対策）
  function resume() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
  }

  const now = () => (ctx ? ctx.currentTime : 0);

  // 単音（周波数スイープ・エンベロープ付き）
  function tone(freq, dur, opt) {
    if (!ensure() || muted) return;
    opt = opt || {};
    const t = now();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = opt.type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opt.slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, opt.slideTo), t + dur);
    const peak = (opt.gain == null ? 0.3 : opt.gain);
    const atk = opt.attack == null ? 0.005 : opt.attack;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // ノイズ一撃（打撃・破壊のガリッ）
  function noise(dur, opt) {
    if (!ensure() || muted) return;
    opt = opt || {};
    const t = now();
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = opt.type || 'bandpass';
    f.frequency.value = opt.freq || 1400;
    f.Q.value = opt.q || 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opt.gain == null ? 0.35 : opt.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  // 属性ごとに色の違う打撃音（火=荒い / 水=丸い / 雷=鋭い…）
  const ELEM_FREQ = { '火': 220, '水': 320, '自然': 180, '雷': 520, '光': 660, '闇': 140 };

  const SFX = {
    resume,
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem('qrsmash_muted', muted ? '1' : '0'); } catch (e) {}
      if (master) master.gain.value = muted ? 0 : 0.9;
      return muted;
    },
    isMuted() { return muted; },

    // 連打チャージ（コッ…と軽い粒。連打で気持ちいい）
    tick() { tone(660 + Math.random() * 120, 0.05, { type: 'square', gain: 0.08 }); },
    // チャージ満タン→発射
    fire() { tone(300, 0.22, { type: 'sawtooth', slideTo: 900, gain: 0.28 }); noise(0.12, { freq: 2200, gain: 0.18 }); },
    // 攻撃着弾（属性色つき）
    hit(elem, dmg) {
      const base = ELEM_FREQ[elem] || 240;
      noise(0.11, { freq: 900 + (dmg || 10) * 6, gain: 0.34, q: 1.1 });
      tone(base, 0.14, { type: 'triangle', slideTo: base * 0.5, gain: 0.26 });
    },
    // 効果抜群（属性相性）— キラッ
    superEffective() { tone(1200, 0.16, { type: 'sine', slideTo: 1800, gain: 0.2 }); },
    // SUPER（大技ビーム）
    superBeam() {
      tone(140, 0.5, { type: 'sawtooth', slideTo: 60, gain: 0.3 });
      tone(600, 0.5, { type: 'square', slideTo: 1500, gain: 0.22 });
      noise(0.5, { type: 'lowpass', freq: 3000, gain: 0.22 });
    },
    // 反撃
    counter() { tone(880, 0.12, { type: 'square', slideTo: 1320, gain: 0.22 }); },
    // COMBO 上昇（数が増えるほど音程が上がる）
    combo(n) { tone(440 + Math.min(n, 12) * 60, 0.09, { type: 'sine', gain: 0.18 }); },
    // K.O.（ドーンと沈む）
    ko() {
      tone(200, 0.7, { type: 'sawtooth', slideTo: 40, gain: 0.34 });
      noise(0.6, { type: 'lowpass', freq: 1200, gain: 0.3 });
    },
    // 決着・勝利ジングル
    win() {
      const notes = [523, 659, 784, 1046];
      notes.forEach((f, i) => setTimeout(() => tone(f, 0.28, { type: 'triangle', gain: 0.26 }), i * 110));
    },
    // UI 決定
    ui() { tone(760, 0.08, { type: 'square', slideTo: 1040, gain: 0.18 }); },
    // ゲーム開始
    start() { [392, 523, 784].forEach((f, i) => setTimeout(() => tone(f, 0.14, { type: 'square', gain: 0.2 }), i * 70)); },
  };

  window.SFX = SFX;
  // どのキー/タップでも AudioContext を起こす（保険）
  window.addEventListener('keydown', resume, { once: false });
  window.addEventListener('pointerdown', resume, { once: false });
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyM') SFX.toggleMute(); });
})();
