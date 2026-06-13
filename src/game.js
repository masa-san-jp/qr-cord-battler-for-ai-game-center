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
  const SHOWCASE = ['ドラゴン', 'フェニックス', 'カミナリ', 'もりのぬし', 'ひかりのきし', 'やみのおう'];
  const PANEL = [
    { gx: 80, gy: 180, gsize: 420, side: 'left' },
    { gx: 780, gy: 180, gsize: 420, side: 'right' },
  ];
  function urlParam(k) { try { return new URLSearchParams(location.search).get(k); } catch (e) { return null; } }
  const pickShowcase = () => SHOWCASE[(Math.random() * SHOWCASE.length) | 0];

  function makeFighter(idx, payload) {
    const f = C.generateFighter(payload);
    f.maxhp = f.hp;     // HP パラメータ＝体力プール
    f.hitFlash = 0;
    f.panel = PANEL[idx];
    return f;
  }

  function startRound(m) {
    mode = m;
    const p1 = urlParam('p1'), p2 = urlParam('p2');
    if (m === '1P') {
      fighters = [makeFighter(0, p1 || pickShowcase()), makeFighter(1, pickShowcase())]; // 右=CPU ランダム素材
    } else {
      fighters = [makeFighter(0, p1 || pickShowcase()), makeFighter(1, p2 || pickShowcase())]; // 左=先行 右=後行
    }
    if (window.QRPortraits) { QRPortraits.request(fighters[0]); QRPortraits.request(fighters[1]); }
    // ターン順：素早さが高い方が先攻（同値は先行=左）
    const first = fighters[0].spd >= fighters[1].spd ? 0 : 1;
    battle = { seq: [], i: 0, timer: 1.0, log: first === 0 ? fighters[0].name + ' が先攻！' : fighters[1].name + ' が先攻！' };
    for (let t = 0; t < 3; t++) { battle.seq.push(first, 1 - first); } // 3 ターン × 2 攻撃
    particles = []; floaters = []; projectiles = []; shake = 0; flash = 0;
    winner = -1; resultTimer = 0; slowmo = 1;
    state = 'BATTLE';
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
    fireFx(aIdx);
    // 回避率：相手(B)の HP と 防御が高いほど避けやすい。素早さ差も少し加味。
    let dodge = ((B.maxhp + B.def) / B.tierTotal) * 55 + (B.spd - A.spd) * 0.05;
    dodge = clamp(dodge, 5, 75);
    const cb = charCenter(B);
    if (Math.random() * 100 < dodge) {
      floatText(cb.x, cb.y - 40, 'MISS', '#9fb3d9', 38);
      battle.log = A.name + ' の攻撃 → 回避！';
      return;
    }
    // 命中：攻撃力ベース × 属性相性
    const aff = C.affinityMultiplier(A.attribute, B.attribute);
    const dmg = Math.max(1, Math.round(A.atk * 0.4 * aff));
    B.hp = Math.max(0, B.hp - dmg); B.hitFlash = 1;
    burst(cb.x, cb.y, A.meta.glow, 16, 7); addShake(9);
    floatText(cb.x + rand(-20, 20), cb.y - 30, (aff > 1 ? '効果抜群! ' : '') + dmg, aff > 1 ? '#ffe14d' : '#fff', 42);
    battle.log = A.name + ' の攻撃 → ' + dmg + ' ダメージ' + (aff > 1 ? '（効果抜群）' : '');
    if (B.hp <= 0) return;
    // カウンター：B が確率で反撃
    if (Math.random() * 100 < B.ctrPct) {
      const cd = Math.max(1, Math.round(B.atk * 0.4 * C.affinityMultiplier(B.attribute, A.attribute)));
      A.hp = Math.max(0, A.hp - cd); A.hitFlash = 1;
      const ca = charCenter(A);
      burst(ca.x, ca.y, B.meta.glow, 14, 6); addShake(8);
      floatText(ca.x, ca.y - 30, 'COUNTER ' + cd, '#ff7be0', 36);
      battle.log += '  ' + B.name + ' のカウンター → ' + cd;
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
      if (consumePressed('Digit1') || consumePressed('Numpad1')) startRound('1P');
      else if (consumePressed('Digit2') || consumePressed('Numpad2')) startRound('2P');
      else if (tap.any) { tap.any = false; startRound('1P'); }
      tap.any = false;
      return;
    }

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
    ctx.fillStyle = f.meta.color; ctx.font = 'bold 22px system-ui';
    ctx.fillText(f.meta.label + ' / ' + f.attribute, x, 44);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 30px system-ui';
    ctx.fillText(f.name, x, 80);
    ctx.fillStyle = f.tierColor; ctx.font = 'bold 22px system-ui';
    ctx.fillText('TIER ' + f.tier + '（計 ' + f.tierTotal + '）', x, 108);
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
    ctx.fillStyle = '#fff'; ctx.font = 'bold 92px system-ui'; ctx.shadowColor = '#37a7ff'; ctx.shadowBlur = 30;
    ctx.fillText('QR SMASH', W / 2, 300); ctx.fillStyle = '#37a7ff'; ctx.fillText('ARENA', W / 2, 392);
    ctx.shadowBlur = 0; ctx.fillStyle = '#7d8aa5'; ctx.font = 'bold 24px system-ui';
    ctx.fillText('QR が授ける戦士で、3 ターンの自動バトル', W / 2, 440);
    const blink = (Math.sin(titleT * 5) + 1) / 2; ctx.globalAlpha = 0.5 + blink * 0.5;
    ctx.fillStyle = '#ffe14d'; ctx.font = 'bold 44px system-ui'; ctx.fillText('▶ [1] 1P  vs  CPU', W / 2, 530);
    ctx.fillStyle = '#4cd964'; ctx.fillText('▶ [2] 2P  対戦', W / 2, 590);
    ctx.globalAlpha = 1; ctx.fillStyle = '#55607a'; ctx.font = 'bold 20px system-ui';
    ctx.fillText('1 か 2 を押す（画面タップでも開始）', W / 2, 660);
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
      ctx.fillStyle = f.meta.color; ctx.font = 'bold 26px system-ui';
      ctx.fillText(f.name + '  (' + f.attribute + '・TIER ' + f.tier + ')', W / 2, cy + sz + 148);
    }
    if (resultTimer > 1.0) {
      ctx.globalAlpha = (Math.sin(titleT * 5) + 1) / 2; ctx.fillStyle = '#ffe14d'; ctx.font = 'bold 26px system-ui';
      ctx.fillText('PRESS  SPACE  TO  CONTINUE', W / 2, H - 40); ctx.globalAlpha = 1;
    }
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawBackground();
    const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
    ctx.setTransform(1, 0, 0, 1, sx, sy);
    if (state === 'TITLE') drawTitle();
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
  resize();
  requestAnimationFrame(loop);
})();
