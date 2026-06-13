/*
 * QR SMASH ARENA — ゲーム本体（自動バトル版）
 * QR から決まる 5 パラメータ（HP/攻撃/防御/素早さ/カウンター率）で、最大 3 ターンの自動対戦。
 * 連打なし。1P=左自分/右CPU、2P=左先行/右後行。ビルド不要・file:// で動作。
 */
(function () {
  'use strict';
  const C = window.QRCore;
  const W = 1280, H = 720;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // ---- 入力 ----
  const keys = Object.create(null);
  const tap = { any: false };
  function resize() {
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.style.width = W * scale + 'px';
    canvas.style.height = H * scale + 'px';
  }
  window.addEventListener('resize', resize);
  window.addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (!keys[e.code]) keys[e.code] = { pressed: true };
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = null; });
  function consumePressed(code) { if (keys[code] && keys[code].pressed) { keys[code].pressed = false; return true; } return false; }
  canvas.addEventListener('pointerdown', () => { tap.any = true; });

  // ---- ユーティリティ ----
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---- エフェクト ----
  let particles = [], floaters = [], projectiles = [], shake = 0, flash = 0, flashColor = '#fff';
  function addShake(m) { shake = Math.max(shake, m); }
  function addFlash(c, a) { flashColor = c; flash = Math.max(flash, a); }
  function burst(x, y, color, n, power) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(0.3, 1) * power;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - power * 0.3, life: rand(0.4, 0.9), max: 0.9, color, size: rand(2, 5) });
    }
  }
  function floatText(x, y, text, color, size) { floaters.push({ x, y, vy: -1.4, life: 1, text, color, size: size || 30 }); }

  // ---- 状態 ----
  let state = 'TITLE', mode = '1P', fighters = null, battle = null;
  let winner = -1, resultTimer = 0, slowmo = 1;
  let titlePreview = null, titleT = 0, showcaseIdx = 0;
  let scan = { phase: 'idle', msg: '' }, summon = { phase: 'idle', msg: '', t: 0 }, scanSeq = 0;
  const SHOWCASE = ['ドラゴン', 'フェニックス', 'カミナリ', 'もりのぬし', 'ひかりのきし', 'やみのおう'];
  // GB10 上で QR文字列→LLM(パラメータ+プロンプト)→画像 を返すエンドポイント（実機 localhost のみ）
  const FIGHTER_API = (window.IMGGEN_ENDPOINT || 'http://127.0.0.1:8771') + '/fighter';
  const PANEL = [
    { gx: 80, gy: 180, gsize: 420, side: 'left' },
    { gx: 780, gy: 180, gsize: 420, side: 'right' },
  ];
  function urlParam(k) { try { return new URLSearchParams(location.search).get(k); } catch (e) { return null; } }
  const pickShowcase = () => SHOWCASE[(Math.random() * SHOWCASE.length) | 0];
  const sideLabel = (idx) => (mode === '1P' ? (idx === 0 ? 'あなた' : 'CPU') : ('PLAYER ' + (idx + 1)));

  function makeFighter(idx, payload) {
    const f = C.generateFighter(payload);
    f.maxhp = f.hp;     // HP パラメータ＝体力プール
    f.hitFlash = 0;
    f.panel = PANEL[idx];
    return f;
  }

  // fighters[] が用意済みの前提で対戦を開始する
  function beginBattle(m) {
    mode = m;
    if (window.QRPortraits) { QRPortraits.request(fighters[0]); QRPortraits.request(fighters[1]); }
    const first = fighters[0].spd >= fighters[1].spd ? 0 : 1; // 素早さが高い方が先攻（同値は左）
    battle = { seq: [], i: 0, timer: 1.0, log: sideLabel(first) + ' が先攻！' };
    for (let t = 0; t < 3; t++) { battle.seq.push(first, 1 - first); } // 3 ターン × 2 攻撃
    particles = []; floaters = []; projectiles = []; shake = 0; flash = 0;
    winner = -1; resultTimer = 0; slowmo = 1;
    state = 'BATTLE';
  }

  function startRound(m, p1override) {
    const p1 = p1override || urlParam('p1'), p2 = urlParam('p2');
    if (m === '1P') fighters = [makeFighter(0, p1 || pickShowcase()), makeFighter(1, pickShowcase())]; // 右=CPU ランダム
    else fighters = [makeFighter(0, p1 || pickShowcase()), makeFighter(1, p2 || pickShowcase())]; // 左=先行 右=後行
    beginBattle(m);
  }

  function tierColorOf(label) { const t = (C.TIERS || []).find((x) => x.label === label); return t ? t.color : '#5ad1ff'; }

  // GB10 が返したスペック（パラメータ＋生成画像）から自キャラを組む
  function fighterFromSpec(idx, spec) {
    const key = 'scan-' + (scanSeq++);
    const f = {
      text: 'scanned', hex: key, attribute: spec.attribute,
      meta: C.ATTR_META[spec.attribute] || C.ATTR_META['火'],
      tier: spec.tier, tierTotal: spec.tierTotal, tierColor: tierColorOf(spec.tier),
      hp: spec.hp, maxhp: spec.hp, atk: spec.atk, def: spec.def, spd: spec.spd,
      ctr: spec.ctr, ctrPct: spec.ctrPct, hitFlash: 0, panel: PANEL[idx],
    };
    if (window.QRPortraits && spec.image) QRPortraits.setImage(key, spec.image);
    return f;
  }

  function enterScan() {
    state = 'SCAN'; scan = { phase: 'starting', msg: 'カメラを起動しています…' };
    if (!window.QRScanner) { scan = { phase: 'error', msg: 'スキャナを読み込めません' }; return; }
    QRScanner.start().then((ok) => {
      scan = ok ? { phase: 'scanning', msg: 'QR コードをカメラにかざしてください' }
                : { phase: 'error', msg: 'カメラを使えません（' + (QRScanner.error() || '') + '）　C で戻る' };
    });
  }

  // QR 文字列 → GB10 でリアルタイム生成（パラメータ＋画像）→ 対戦開始
  function startSummon(text) {
    if (window.QRScanner) QRScanner.stop();
    addFlash('#fff', 0.7);
    state = 'SUMMON'; summon = { phase: 'gen', msg: 'GB10 が戦士を生成中…', t: 0, qr: text };
    fetch(FIGHTER_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ qr: text }) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http ' + r.status))))
      .then((spec) => { fighters = [fighterFromSpec(0, spec), makeFighter(1, pickShowcase())]; beginBattle('1P'); })
      .catch(() => { startRound('1P', text); }); // 生成サーバ不通でも簡易生成で必ず遊べる
  }

  const charCenter = (f) => ({ x: f.panel.gx + f.panel.gsize / 2, y: f.panel.gy + f.panel.gsize / 2 });

  function fireFx(aIdx) {
    const s = charCenter(fighters[aIdx]), t = charCenter(fighters[1 - aIdx]);
    projectiles.push({ x: s.x, y: s.y, sx: s.x, sy: s.y, tx: t.x, ty: t.y, t: 0, color: fighters[aIdx].meta.color, glow: fighters[aIdx].meta.glow });
  }

  // 1 回の攻撃を解決する（回避→命中→ダメージ→カウンター）
  function resolveAttack(aIdx) {
    const A = fighters[aIdx], B = fighters[1 - aIdx];
    if (A.hp <= 0 || B.hp <= 0) return;
    const aL = sideLabel(aIdx), bL = sideLabel(1 - aIdx);
    fireFx(aIdx);
    // 回避率：相手(B)の HP と 防御が高いほど避けやすい。素早さ差も少し加味。
    let dodge = ((B.maxhp + B.def) / B.tierTotal) * 55 + (B.spd - A.spd) * 0.05;
    dodge = clamp(dodge, 5, 75);
    const cb = charCenter(B);
    if (Math.random() * 100 < dodge) {
      floatText(cb.x, cb.y - 40, 'MISS', '#9fb3d9', 38);
      battle.log = aL + ' の攻撃 → 回避！';
      return;
    }
    // 命中：攻撃力ベース × 属性相性
    const aff = C.affinityMultiplier(A.attribute, B.attribute);
    const dmg = Math.max(1, Math.round(A.atk * 0.4 * aff));
    B.hp = Math.max(0, B.hp - dmg); B.hitFlash = 1;
    burst(cb.x, cb.y, A.meta.glow, 16, 7); addShake(9);
    floatText(cb.x + rand(-20, 20), cb.y - 30, (aff > 1 ? '効果抜群! ' : '') + dmg, aff > 1 ? '#ffe14d' : '#fff', 42);
    battle.log = aL + ' の攻撃 → ' + dmg + ' ダメージ' + (aff > 1 ? '（効果抜群）' : '');
    if (B.hp <= 0) return;
    // カウンター：B が確率で反撃
    if (Math.random() * 100 < B.ctrPct) {
      const cd = Math.max(1, Math.round(B.atk * 0.4 * C.affinityMultiplier(B.attribute, A.attribute)));
      A.hp = Math.max(0, A.hp - cd); A.hitFlash = 1;
      const ca = charCenter(A);
      burst(ca.x, ca.y, B.meta.glow, 14, 6); addShake(8);
      floatText(ca.x, ca.y - 30, 'COUNTER ' + cd, '#ff7be0', 36);
      battle.log += '  ' + bL + ' のカウンター → ' + cd;
    }
  }

  function finishBattle() {
    const a = fighters[0].hp, b = fighters[1].hp;
    winner = a === b ? -2 : (a > b ? 0 : 1); // HP 0 即決も残 HP 判定もこの一行で成立
    state = 'RESULT'; resultTimer = 0; slowmo = 0.25; addFlash('#fff', 0.6); addShake(18);
  }

  // ---- 更新 ----
  function update(dt) {
    titleT += dt;
    for (const p of particles) { p.life -= dt; p.x += p.vx; p.y += p.vy; p.vy += 0.25; p.vx *= 0.99; }
    particles = particles.filter((p) => p.life > 0);
    for (const f of floaters) { f.life -= dt * 1.4; f.y += f.vy; f.vy *= 0.96; }
    floaters = floaters.filter((f) => f.life > 0);
    shake *= 0.86; flash *= 0.9;
    for (const p of projectiles) {
      p.t += dt / 0.16; const e = p.t < 1 ? p.t : 1;
      p.x = p.sx + (p.tx - p.sx) * e; p.y = p.sy + (p.ty - p.sy) * e - Math.sin(e * Math.PI) * 90;
    }
    projectiles = projectiles.filter((p) => p.t < 1.05);

    if (state === 'TITLE') {
      if (!titlePreview || titleT > 2.4) {
        const a = SHOWCASE[showcaseIdx % SHOWCASE.length], b = SHOWCASE[(showcaseIdx + 1) % SHOWCASE.length];
        showcaseIdx += 2;
        titlePreview = [makeFighter(0, a), makeFighter(1, b)];
        if (window.QRPortraits) { QRPortraits.request(titlePreview[0]); QRPortraits.request(titlePreview[1]); }
        titleT = 0;
      }
      if (consumePressed('Digit1') || consumePressed('Numpad1')) enterScan();        // vs CPU = QR で自分を召喚 → CPU 戦
      else if (consumePressed('Digit2') || consumePressed('Numpad2')) startRound('2P');
      else if (tap.any) { tap.any = false; enterScan(); }
      tap.any = false;
      return;
    }

    if (state === 'SCAN') {
      if (consumePressed('KeyC') || consumePressed('Escape') || consumePressed('Backspace')) {
        if (window.QRScanner) QRScanner.stop(); state = 'TITLE'; titlePreview = null; titleT = 3; tap.any = false; return;
      }
      if (scan.phase === 'scanning' && window.QRScanner) {
        const r = QRScanner.poll();
        if (r && r.text) { startSummon(r.text); return; }
      }
      tap.any = false;
      return;
    }

    if (state === 'SUMMON') { summon.t += dt; tap.any = false; return; }

    if (state === 'BATTLE') {
      for (let i = 0; i < 2; i++) fighters[i].hitFlash = Math.max(0, fighters[i].hitFlash - dt * 4);
      if (consumePressed('Space') || tap.any) { tap.any = false; battle.i = battle.seq.length; } // スキップ→判定
      battle.timer -= dt;
      if (battle.timer <= 0) {
        if (battle.i >= battle.seq.length || fighters[0].hp <= 0 || fighters[1].hp <= 0) {
          finishBattle();
        } else {
          resolveAttack(battle.seq[battle.i]); battle.i++;
          battle.timer = (fighters[0].hp <= 0 || fighters[1].hp <= 0) ? 0.7 : 0.95;
        }
      }
      return;
    }

    if (state === 'RESULT') {
      resultTimer += dt; slowmo = Math.min(1, slowmo + dt * 0.5);
      if (resultTimer > 1.0 && (consumePressed('Space') || consumePressed('Enter') || tap.any)) {
        tap.any = false; state = 'TITLE'; titlePreview = null; titleT = 3;
      }
      tap.any = false;
    }
  }

  // ---- 描画 ----
  function drawBackground() {
    ctx.fillStyle = '#070912'; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.globalAlpha = 0.5; ctx.strokeStyle = 'rgba(40,70,120,0.18)'; ctx.lineWidth = 1;
    const off = (titleT * 30) % 40;
    for (let x = -40; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x + off, 0); ctx.lineTo(x + off, H); ctx.stroke(); }
    for (let y = -40; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y + off); ctx.lineTo(W, y + off); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  }

  // キャラを大きく描く（QR は表示しない＝秘密のコレクション感）。被弾は hitFlash。
  function drawCharacter(f) {
    const p = f.panel;
    if (window.QRPortraits) QRPortraits.drawBig(ctx, f, p.gx, p.gy, p.gsize, f.hitFlash || 0);
    else { ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(p.gx, p.gy, p.gsize, p.gsize); ctx.strokeStyle = f.meta.color; ctx.lineWidth = 4; ctx.strokeRect(p.gx, p.gy, p.gsize, p.gsize); }
  }

  function drawHeader(f) {
    const left = f.panel.side === 'left';
    const x = left ? f.panel.gx : f.panel.gx + f.panel.gsize;
    ctx.textAlign = left ? 'left' : 'right';
    ctx.fillStyle = f.meta.color; ctx.font = 'bold 26px system-ui';
    ctx.fillText(f.meta.label + ' / ' + f.attribute, x, 62);
    ctx.fillStyle = f.tierColor; ctx.font = 'bold 26px system-ui';
    ctx.fillText('TIER ' + f.tier + '（計 ' + f.tierTotal + '）', x, 98);
    // HP バー（キャラ上）
    const bw = f.panel.gsize, bx = f.panel.gx, ratio = clamp(f.hp / f.maxhp, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(bx, 122, bw, 18);
    ctx.fillStyle = ratio > 0.3 ? f.meta.color : '#ff3b3b';
    ctx.fillRect(left ? bx : bx + bw - bw * ratio, 122, bw * ratio, 18);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 15px system-ui'; ctx.textAlign = left ? 'left' : 'right';
    ctx.fillText('HP ' + Math.ceil(f.hp) + ' / ' + f.maxhp, x, 158);
    // 5 パラメータ（キャラ下）
    ctx.textAlign = 'center'; ctx.font = 'bold 19px system-ui'; ctx.fillStyle = '#cdd6ee';
    ctx.fillText('攻 ' + f.atk + '   防 ' + f.def + '   速 ' + f.spd + '   反 ' + f.ctrPct + '%', f.panel.gx + f.panel.gsize / 2, f.panel.gy + f.panel.gsize + 26);
  }

  function drawBattleCenter() {
    ctx.textAlign = 'center';
    const turn = Math.min(3, Math.floor(battle.i / 2) + 1);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 40px system-ui';
    ctx.fillText('TURN ' + turn + ' / 3', W / 2, 66);
    ctx.fillStyle = '#9fb3d9'; ctx.font = 'bold 18px system-ui';
    ctx.fillText('VS', W / 2, 92);
    ctx.fillStyle = '#e8f0ff'; ctx.font = 'bold 22px system-ui';
    ctx.fillText(battle.log || '', W / 2, H - 26);
  }

  function drawProjectiles() {
    for (const p of projectiles) {
      ctx.save(); ctx.globalAlpha = 0.9; const r = 16;
      const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grd.addColorStop(0, '#fff'); grd.addColorStop(0.4, p.glow); grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
  }
  function drawEffects() {
    for (const p of particles) { ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size); }
    ctx.globalAlpha = 1;
    for (const f of floaters) {
      ctx.globalAlpha = clamp(f.life, 0, 1); ctx.textAlign = 'center'; ctx.fillStyle = f.color;
      ctx.font = 'bold ' + f.size + 'px system-ui'; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4;
      ctx.strokeText(f.text, f.x, f.y); ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawTitle() {
    if (titlePreview) {
      titlePreview[0].panel = PANEL[0]; titlePreview[1].panel = PANEL[1];
      titlePreview[0].hitFlash = 0; titlePreview[1].hitFlash = 0;
      ctx.globalAlpha = 0.4; drawCharacter(titlePreview[0]); drawCharacter(titlePreview[1]); ctx.globalAlpha = 1;
    }
    ctx.save(); ctx.textAlign = 'center';
    ctx.fillStyle = '#fff'; ctx.font = 'bold 80px system-ui'; ctx.shadowColor = '#37a7ff'; ctx.shadowBlur = 30;
    ctx.fillText('QRコードバトラー', W / 2, 336);
    ctx.shadowBlur = 0; ctx.fillStyle = '#7d8aa5'; ctx.font = 'bold 24px system-ui';
    ctx.fillText('QR が授ける戦士で、3 ターンの自動バトル', W / 2, 392);
    const blink = (Math.sin(titleT * 5) + 1) / 2; ctx.globalAlpha = 0.55 + blink * 0.45;
    ctx.fillStyle = '#ffe14d'; ctx.font = 'bold 46px system-ui'; ctx.fillText('▶ [1] vs CPU', W / 2, 538);
    ctx.fillStyle = '#4cd964'; ctx.fillText('▶ [2] 2P 対戦', W / 2, 598);
    ctx.globalAlpha = 1; ctx.fillStyle = '#55607a'; ctx.font = 'bold 19px system-ui';
    ctx.fillText('QR を読み込んで自分の戦士を召喚 → 対戦', W / 2, 658);
    ctx.restore();
  }

  function drawResult() {
    ctx.fillStyle = '#05060d'; ctx.fillRect(0, 0, W, H);
    drawEffects();
    ctx.textAlign = 'center';
    if (winner === -2) {
      ctx.fillStyle = '#fff'; ctx.font = 'bold 96px system-ui'; ctx.fillText('DRAW', W / 2, H / 2);
    } else {
      const f = fighters[winner], sz = 320, cx = W / 2 - sz / 2, cy = 96;
      if (window.QRPortraits) QRPortraits.drawBig(ctx, f, cx, cy, sz, 0);
      ctx.fillStyle = f.meta.glow; ctx.font = 'bold 68px system-ui'; ctx.shadowColor = f.meta.color; ctx.shadowBlur = 40;
      const koText = (fighters[1 - winner].hp <= 0) ? 'K.O.' : 'JUDGE';
      ctx.fillText(koText, W / 2, cy + sz + 64); ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff'; ctx.font = 'bold 40px system-ui';
      const who = mode === '1P' ? (winner === 0 ? 'YOU WIN!' : 'CPU WIN') : ('PLAYER ' + (winner + 1) + ' WIN!');
      ctx.fillText(who, W / 2, cy + sz + 112);
      ctx.fillStyle = f.meta.color; ctx.font = 'bold 28px system-ui';
      ctx.fillText(f.attribute + ' 属性  ・  TIER ' + f.tier, W / 2, cy + sz + 148);
    }
    if (resultTimer > 1.0) {
      ctx.globalAlpha = (Math.sin(titleT * 5) + 1) / 2; ctx.fillStyle = '#ffe14d'; ctx.font = 'bold 26px system-ui';
      ctx.fillText('PRESS  SPACE  TO  CONTINUE', W / 2, H - 40); ctx.globalAlpha = 1;
    }
  }

  function drawScan() {
    const bw = 760, bh = 500, bx = W / 2 - bw / 2, by = 90;
    ctx.fillStyle = '#0a0e1c'; ctx.fillRect(bx, by, bw, bh);
    if (window.QRScanner && scan.phase === 'scanning') {
      ctx.save(); ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
      QRScanner.drawVideo(ctx, bx, by, bw, bh); ctx.restore();
      const s = 280, rx = W / 2 - s / 2, ry = by + bh / 2 - s / 2, L = 48;
      ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 6;
      const corner = (cx, cy, dx, dy) => { ctx.beginPath(); ctx.moveTo(cx, cy + dy * L); ctx.lineTo(cx, cy); ctx.lineTo(cx + dx * L, cy); ctx.stroke(); };
      corner(rx, ry, 1, 1); corner(rx + s, ry, -1, 1); corner(rx, ry + s, 1, -1); corner(rx + s, ry + s, -1, -1);
    }
    ctx.strokeStyle = '#37a7ff'; ctx.lineWidth = 4; ctx.strokeRect(bx, by, bw, bh);
    ctx.textAlign = 'center';
    ctx.fillStyle = scan.phase === 'error' ? '#ff7b7b' : '#fff'; ctx.font = 'bold 32px system-ui';
    ctx.fillText(scan.msg || '', W / 2, by + bh + 54);
    ctx.fillStyle = '#7d8aa5'; ctx.font = 'bold 20px system-ui';
    ctx.fillText('C で戻る', W / 2, by + bh + 90);
  }

  function drawSummon() {
    ctx.fillStyle = '#05060d'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    const cx = W / 2, cy = H / 2 - 30, R = 92;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate((summon.t || 0) * 3);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.globalAlpha = 0.25 + 0.75 * (i / 12); ctx.fillStyle = '#5ad1ff';
      ctx.beginPath(); ctx.arc(Math.cos(a) * R, Math.sin(a) * R, 7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore(); ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff'; ctx.font = 'bold 40px system-ui';
    ctx.fillText(summon.msg || 'GB10 が戦士を生成中…', W / 2, cy + 180);
    ctx.fillStyle = '#7d8aa5'; ctx.font = 'bold 22px system-ui';
    const dots = '.'.repeat(1 + (Math.floor((summon.t || 0) * 2) % 3));
    ctx.fillText('QR の内容から、その場で生成しています' + dots, W / 2, cy + 222);
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawBackground();
    const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
    ctx.setTransform(1, 0, 0, 1, sx, sy);
    if (state === 'TITLE') drawTitle();
    else if (state === 'SCAN') drawScan();
    else if (state === 'SUMMON') drawSummon();
    else if (state === 'BATTLE') { for (let i = 0; i < 2; i++) { drawCharacter(fighters[i]); drawHeader(fighters[i]); } drawProjectiles(); drawEffects(); drawBattleCenter(); }
    else if (state === 'RESULT') drawResult();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (flash > 0.01) { ctx.globalAlpha = clamp(flash, 0, 1); ctx.fillStyle = flashColor; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  }

  // ---- ループ ----
  let last = performance.now();
  function loop(now) {
    let dt = (now - last) / 1000; last = now;
    dt = Math.min(dt, 0.05) * (state === 'RESULT' ? slowmo : 1);
    update(dt); render();
    for (const k in keys) if (keys[k]) keys[k].pressed = false;
    requestAnimationFrame(loop);
  }
  window.QRBattler = { summon: startSummon, scan: enterScan }; // デモ/検証用フック
  resize();
  requestAnimationFrame(loop);
})();
