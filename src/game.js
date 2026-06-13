/*
 * QR SMASH ARENA — ゲーム本体
 * デストラクション × 対戦。QRボディ(=HP)を連打で破壊し尽くす。
 * 1P(vs CPU) / 2P 対戦。ビルド不要・file:// で動作。
 */
(function () {
  'use strict';
  const C = window.QRCore;
  const W = 1280, H = 720;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // ---- 入力状態 ----
  const keys = Object.create(null);
  const tap = { p1: false, p2: false }; // タッチ/クリックのワンショット
  let pointerSide = null;

  function resize() {
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.style.width = W * scale + 'px';
    canvas.style.height = H * scale + 'px';
  }
  window.addEventListener('resize', resize);

  window.addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (!keys[e.code]) keys[e.code] = { down: true, pressed: true };
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = null; });
  function pressed(code) { return keys[code] && keys[code].pressed; }
  function consumePressed(code) { if (keys[code] && keys[code].pressed) { keys[code].pressed = false; return true; } return false; }

  function canvasPos(ev) {
    const r = canvas.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width * W;
    return x;
  }
  canvas.addEventListener('pointerdown', (ev) => {
    const x = canvasPos(ev);
    pointerSide = x < W / 2 ? 'left' : 'right';
    if (pointerSide === 'left') tap.p1 = true; else tap.p2 = true;
  });

  // ---- ユーティリティ ----
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---- エフェクト系 ----
  let particles = [], floaters = [], projectiles = [], shake = 0, flash = 0, flashColor = '#fff';
  function addShake(m) { shake = Math.max(shake, m); }
  function addFlash(c, a) { flashColor = c; flash = Math.max(flash, a); }
  function burst(x, y, color, n, power) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(0.3, 1) * power;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - power * 0.3,
        life: rand(0.4, 0.9), max: 0.9, color, size: rand(2, 5) });
    }
  }
  function floatText(x, y, text, color, size) {
    floaters.push({ x, y, vy: -1.4, life: 1, text, color, size: size || 30 });
  }

  // ---- ゲーム状態 ----
  let state = 'TITLE';
  let mode = '1P';
  let fighters = null; // [left, right]
  let timer = 0, roundTime = 60;
  let combo = [0, 0], comboTimer = [0, 0], charge = [0, 0], superCount = [0, 0];
  let cpuTimer = 0;
  let winner = -1, resultTimer = 0, slowmo = 1;
  let titlePreview = null, titleT = 0;

  const PANEL = [
    { gx: 130, gy: 210, gsize: 360, side: 'left' },
    { gx: 790, gy: 210, gsize: 360, side: 'right' },
  ];

  function urlParam(k) {
    try { return new URLSearchParams(location.search).get(k); } catch (e) { return null; }
  }

  function makeFighter(idx, payload) {
    const f = C.generateFighter(payload || ('GACHA-' + Math.random()), 21);
    // 破壊用の状態を付与
    f.alive = f.grid.map((row) => row.slice());
    f.aliveCells = [];
    for (let y = 0; y < f.size; y++)
      for (let x = 0; x < f.size; x++)
        if (f.grid[y][x] && !C.isFinder(x, y, f.size)) f.aliveCells.push({ x, y });
    f.maxCore = f.aliveCells.length;
    f.coreRemaining = f.maxCore;
    f.hitFlash = 0;
    f.panel = PANEL[idx];
    return f;
  }

  function startRound(m) {
    mode = m;
    const p1 = urlParam('p1'), p2 = urlParam('p2');
    fighters = [makeFighter(0, p1), makeFighter(1, p2)];
    timer = roundTime;
    combo = [0, 0]; comboTimer = [0, 0]; charge = [0, 0]; superCount = [0, 0];
    cpuTimer = rand(0.2, 0.5);
    particles = []; floaters = []; projectiles = []; shake = 0; flash = 0;
    winner = -1; resultTimer = 0; slowmo = 1;
    state = 'BATTLE';
  }

  function cellWorld(f, c) {
    const cell = f.panel.gsize / f.size;
    return { x: f.panel.gx + c.x * cell + cell / 2, y: f.panel.gy + c.y * cell + cell / 2, cell };
  }

  function damage(targetIdx, attackerIdx, isSuper) {
    const atkF = fighters[attackerIdx], defF = fighters[targetIdx];
    if (defF.coreRemaining <= 0) return;
    const affinity = C.affinityMultiplier(atkF.attribute, defF.attribute);
    const comboMul = 1 + Math.min(combo[attackerIdx], 30) * 0.06;
    const defMul = 100 / (100 + defF.def * 0.55);
    let modules = atkF.atk * 0.07 * affinity * comboMul * defMul * (isSuper ? 3.2 : 1);
    modules = Math.max(1, Math.round(modules));
    modules = Math.min(modules, defF.coreRemaining);

    // 中心となる被弾位置
    const center = cellWorld(defF, defF.aliveCells[(Math.random() * defF.aliveCells.length) | 0]);
    for (let i = 0; i < modules; i++) {
      if (defF.aliveCells.length === 0) break;
      const idx = (Math.random() * defF.aliveCells.length) | 0;
      const c = defF.aliveCells.splice(idx, 1)[0];
      defF.alive[c.y][c.x] = 0;
      defF.coreRemaining--;
      const w = cellWorld(defF, c);
      burst(w.x, w.y, defF.meta.color, 2, 5);
    }
    defF.hitFlash = 1;
    burst(center.x, center.y, atkF.meta.glow, isSuper ? 40 : 16, isSuper ? 11 : 7);
    addShake(isSuper ? 22 : 9);
    if (isSuper) addFlash(atkF.meta.glow, 0.55);
    floatText(center.x + rand(-20, 20), center.y - 30,
      (affinity > 1 ? '効果抜群! ' : '') + modules, affinity > 1 ? '#ffe14d' : '#fff',
      isSuper ? 56 : 34 + Math.min(combo[attackerIdx], 20));

    combo[attackerIdx] = Math.min(combo[attackerIdx] + 1, 99);
    comboTimer[attackerIdx] = 1.3;

    if (defF.coreRemaining <= 0) triggerKO(attackerIdx);
  }

  function fire(attackerIdx, isSuper) {
    const targetIdx = 1 - attackerIdx;
    const atkF = fighters[attackerIdx], defF = fighters[targetIdx];
    const sx = atkF.panel.gx + atkF.panel.gsize / 2;
    const sy = atkF.panel.gy + atkF.panel.gsize / 2;
    const tx = defF.panel.gx + defF.panel.gsize / 2;
    const ty = defF.panel.gy + defF.panel.gsize / 2;
    projectiles.push({ x: sx, y: sy, sx, sy, tx, ty, t: 0,
      color: atkF.meta.color, glow: atkF.meta.glow, super: isSuper,
      target: targetIdx, attacker: attackerIdx });
  }

  function doMash(idx) {
    if (state !== 'BATTLE' || winner !== -1) return;
    const f = fighters[idx];
    if (f.coreRemaining <= 0) return;
    charge[idx] += 22 + f.spd * 0.18;
    if (charge[idx] >= 100) {
      charge[idx] -= 100;
      superCount[idx]++;
      const isSuper = superCount[idx] % 3 === 0;
      fire(idx, isSuper);
      if (isSuper) floatText(f.panel.gx + f.panel.gsize / 2, f.panel.gy - 40, 'SUPER!!', f.meta.glow, 50);
    }
  }

  function triggerKO(winIdx) {
    winner = winIdx;
    state = 'RESULT';
    resultTimer = 0;
    slowmo = 0.18;
    addShake(28);
    addFlash('#ffffff', 0.8);
    const f = fighters[1 - winIdx];
    burst(f.panel.gx + f.panel.gsize / 2, f.panel.gy + f.panel.gsize / 2, f.meta.color, 80, 13);
  }

  // ---- 更新 ----
  function update(dt) {
    titleT += dt;
    // エフェクト
    for (const p of particles) { p.life -= dt; p.x += p.vx; p.y += p.vy; p.vy += 0.25; p.vx *= 0.99; }
    particles = particles.filter((p) => p.life > 0);
    for (const f of floaters) { f.life -= dt * 1.4; f.y += f.vy; f.vy *= 0.96; }
    floaters = floaters.filter((f) => f.life > 0);
    shake *= 0.86; flash *= 0.9;

    for (const p of projectiles) {
      p.t += dt / 0.16;
      const e = p.t < 1 ? p.t : 1;
      p.x = p.sx + (p.tx - p.sx) * e;
      p.y = p.sy + (p.ty - p.sy) * e - Math.sin(e * Math.PI) * 90;
      if (p.t >= 1 && !p.done) { p.done = true; damage(p.target, p.attacker, p.super); }
    }
    projectiles = projectiles.filter((p) => p.t < 1.05);

    if (state === 'TITLE') {
      if (!titlePreview || titleT > 2.2) { titlePreview = [makeFighter(0), makeFighter(1)]; titleT = 0; }
      if (consumePressed('Digit1') || consumePressed('Numpad1')) startRound('1P');
      if (consumePressed('Digit2') || consumePressed('Numpad2')) startRound('2P');
      if (tap.p1 || tap.p2) { tap.p1 = tap.p2 = false; startRound('1P'); }
      return;
    }

    if (state === 'BATTLE') {
      for (let i = 0; i < 2; i++) {
        comboTimer[i] -= dt;
        if (comboTimer[i] <= 0) combo[i] = 0;
        fighters[i].hitFlash = Math.max(0, fighters[i].hitFlash - dt * 4);
      }
      // 入力: P1 = F / Space, P2 = J
      if (consumePressed('KeyF') || consumePressed('Space')) doMash(0);
      if (tap.p1) { tap.p1 = false; doMash(0); }
      if (mode === '2P') {
        if (consumePressed('KeyJ') || consumePressed('Enter')) doMash(1);
        if (tap.p2) { tap.p2 = false; doMash(1); }
      } else {
        tap.p2 = false;
        // CPU
        cpuTimer -= dt;
        if (cpuTimer <= 0) {
          doMash(1);
          const f = fighters[1];
          cpuTimer = clamp((260 - f.spd) / 1000, 0.12, 0.34) * rand(0.7, 1.4);
        }
      }
      timer -= dt;
      if (timer <= 0) {
        timer = 0;
        const a = fighters[0].coreRemaining / fighters[0].maxCore;
        const b = fighters[1].coreRemaining / fighters[1].maxCore;
        winner = a === b ? -2 : (a > b ? 0 : 1); // -2 = DRAW
        state = 'RESULT'; resultTimer = 0; slowmo = 0.4; addFlash('#fff', 0.5);
      }
      return;
    }

    if (state === 'RESULT') {
      resultTimer += dt;
      slowmo = Math.min(1, slowmo + dt * 0.5);
      if (resultTimer > 1.0 && (consumePressed('Space') || consumePressed('KeyF') || consumePressed('KeyJ') || consumePressed('Enter') || tap.p1 || tap.p2)) {
        tap.p1 = tap.p2 = false;
        state = 'TITLE'; titlePreview = null; titleT = 3;
      }
    }
  }

  // ---- 描画 ----
  function drawBackground() {
    ctx.fillStyle = '#070912';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = 'rgba(40,70,120,0.18)';
    ctx.lineWidth = 1;
    const off = (titleT * 30) % 40;
    for (let x = -40; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x + off, 0); ctx.lineTo(x + off, H); ctx.stroke(); }
    for (let y = -40; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y + off); ctx.lineTo(W, y + off); ctx.stroke(); }
    ctx.restore();
    // スキャンライン (原作CRTオマージュ)
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  }

  function drawGrid(f) {
    const cell = f.panel.gsize / f.size;
    const gx = f.panel.gx, gy = f.panel.gy;
    // 背景ボード
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(gx - 10, gy - 10, f.panel.gsize + 20, f.panel.gsize + 20);
    if (f.hitFlash > 0) {
      ctx.fillStyle = 'rgba(255,80,80,' + f.hitFlash * 0.3 + ')';
      ctx.fillRect(gx - 10, gy - 10, f.panel.gsize + 20, f.panel.gsize + 20);
    }
    for (let y = 0; y < f.size; y++) {
      for (let x = 0; x < f.size; x++) {
        if (!f.alive[y][x]) continue;
        const finder = C.isFinder(x, y, f.size);
        ctx.fillStyle = finder ? '#e8edff' : f.meta.color;
        ctx.fillRect(gx + x * cell + 0.5, gy + y * cell + 0.5, cell - 1, cell - 1);
      }
    }
    // ボード枠
    ctx.strokeStyle = f.meta.color; ctx.lineWidth = 3; ctx.globalAlpha = 0.8;
    ctx.strokeRect(gx - 10, gy - 10, f.panel.gsize + 20, f.panel.gsize + 20);
    ctx.globalAlpha = 1;
  }

  function drawHeader(f, idx) {
    const left = f.panel.side === 'left';
    const x = left ? f.panel.gx - 10 : f.panel.gx + f.panel.gsize + 10;
    const ax = left ? 'left' : 'right';
    ctx.textAlign = ax;
    // 属性チップ
    ctx.fillStyle = f.meta.color;
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillText(f.meta.label + ' / ' + f.attribute, x, 80);
    // 名前
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.fillText(f.name, x, 118);
    // レア度
    ctx.fillStyle = f.rarityMeta.color;
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillText('★' + f.rarityMeta.label + '  ATK ' + f.atk + '  SPD ' + f.spd, x, 150);
    // HPバー
    const bw = f.panel.gsize + 20, bx = f.panel.gx - 10;
    const ratio = f.coreRemaining / f.maxCore;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(bx, 170, bw, 18);
    ctx.fillStyle = ratio > 0.3 ? f.meta.color : '#ff3b3b';
    const fillW = bw * ratio;
    ctx.fillRect(left ? bx : bx + bw - fillW, 170, fillW, 18);
    ctx.textAlign = ax;
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px system-ui';
    ctx.fillText(f.coreRemaining + ' / ' + f.maxCore, x, 204 - 18);

    // チャージゲージ
    const cy = f.panel.gy + f.panel.gsize + 22;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(bx, cy, bw, 22);
    ctx.fillStyle = f.meta.glow;
    ctx.fillRect(left ? bx : bx + bw - bw * (charge[idx] / 100), cy, bw * (charge[idx] / 100), 22);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0a0a0a'; ctx.font = 'bold 14px system-ui';
    ctx.fillText('CHARGE', bx + bw / 2, cy + 16);

    // コンボ
    if (combo[idx] > 1) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffe14d';
      ctx.font = 'bold ' + (28 + Math.min(combo[idx], 20)) + 'px system-ui';
      ctx.fillText(combo[idx] + ' COMBO', f.panel.gx + f.panel.gsize / 2, f.panel.gy + f.panel.gsize / 2);
    }
  }

  function drawProjectiles() {
    for (const p of projectiles) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      const r = p.super ? 26 : 14;
      const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grd.addColorStop(0, '#fff');
      grd.addColorStop(0.4, p.glow);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawEffects() {
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    for (const f of floaters) {
      ctx.globalAlpha = clamp(f.life, 0, 1);
      ctx.textAlign = 'center';
      ctx.fillStyle = f.color;
      ctx.font = 'bold ' + f.size + 'px system-ui';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4;
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawTimer() {
    ctx.textAlign = 'center';
    ctx.fillStyle = timer < 10 ? '#ff3b3b' : '#fff';
    ctx.font = 'bold 64px system-ui';
    ctx.fillText(Math.ceil(timer), W / 2, 90);
    ctx.font = 'bold 18px system-ui';
    ctx.fillStyle = '#7d8aa5';
    ctx.fillText('VS', W / 2, 120);
  }

  function drawTitle() {
    // プレビューファイター
    if (titlePreview) {
      titlePreview[0].panel = PANEL[0]; titlePreview[1].panel = PANEL[1];
      titlePreview[0].hitFlash = 0; titlePreview[1].hitFlash = 0;
      ctx.globalAlpha = 0.5;
      drawGrid(titlePreview[0]); drawGrid(titlePreview[1]);
      ctx.globalAlpha = 1;
    }
    ctx.save();
    ctx.textAlign = 'center';
    // タイトル
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 92px system-ui';
    ctx.shadowColor = '#37a7ff'; ctx.shadowBlur = 30;
    ctx.fillText('QR SMASH', W / 2, 300);
    ctx.fillStyle = '#37a7ff';
    ctx.fillText('ARENA', W / 2, 392);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#7d8aa5';
    ctx.font = 'bold 24px system-ui';
    ctx.fillText('QRコードを連打で破壊しろ', W / 2, 440);

    // メニュー (説明不要・大きく)
    const blink = (Math.sin(titleT * 5) + 1) / 2;
    ctx.globalAlpha = 0.5 + blink * 0.5;
    ctx.fillStyle = '#ffe14d';
    ctx.font = 'bold 44px system-ui';
    ctx.fillText('▶ [1] 1P  vs  CPU', W / 2, 530);
    ctx.fillStyle = '#4cd964';
    ctx.fillText('▶ [2] 2P  対戦', W / 2, 590);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#55607a';
    ctx.font = 'bold 20px system-ui';
    ctx.fillText('連打: 1P = [F] / SPACE     2P = [J]     （画面タップでもOK）', W / 2, 660);
    ctx.restore();
  }

  function drawResult() {
    // 戦闘画面を背後に
    drawTimer();
    for (let i = 0; i < 2; i++) { drawGrid(fighters[i]); drawHeader(fighters[i], i); }
    drawProjectiles(); drawEffects();

    ctx.fillStyle = 'rgba(0,0,0,' + clamp(resultTimer, 0, 0.6) + ')';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    if (winner === -2) {
      ctx.fillStyle = '#fff'; ctx.font = 'bold 90px system-ui';
      ctx.fillText('DRAW', W / 2, H / 2);
    } else {
      const f = fighters[winner];
      ctx.fillStyle = f.meta.glow;
      ctx.font = 'bold 110px system-ui';
      ctx.shadowColor = f.meta.color; ctx.shadowBlur = 40;
      ctx.fillText('K.O.', W / 2, H / 2 - 40);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff'; ctx.font = 'bold 44px system-ui';
      const who = mode === '1P' ? (winner === 0 ? 'YOU WIN!' : 'CPU WIN') : ('PLAYER ' + (winner + 1) + ' WIN!');
      ctx.fillText(who, W / 2, H / 2 + 40);
      ctx.fillStyle = f.meta.color; ctx.font = 'bold 30px system-ui';
      ctx.fillText(f.name + '  (' + f.attribute + '・' + f.rarityMeta.label + ')', W / 2, H / 2 + 90);
    }
    if (resultTimer > 1.0) {
      ctx.globalAlpha = (Math.sin(titleT * 5) + 1) / 2;
      ctx.fillStyle = '#ffe14d'; ctx.font = 'bold 26px system-ui';
      ctx.fillText('PRESS  SPACE  TO  CONTINUE', W / 2, H - 60);
      ctx.globalAlpha = 1;
    }
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawBackground();
    const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
    ctx.setTransform(1, 0, 0, 1, sx, sy);

    if (state === 'TITLE') {
      drawTitle();
    } else if (state === 'BATTLE') {
      drawTimer();
      for (let i = 0; i < 2; i++) { drawGrid(fighters[i]); drawHeader(fighters[i], i); }
      drawProjectiles(); drawEffects();
    } else if (state === 'RESULT') {
      drawResult();
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (flash > 0.01) {
      ctx.globalAlpha = clamp(flash, 0, 1);
      ctx.fillStyle = flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  // ---- ループ ----
  let last = performance.now();
  function loop(now) {
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(dt, 0.05) * (state === 'RESULT' ? slowmo : 1);
    update(dt);
    render();
    // pressed フラグはフレーム末で消費済みのものを保持しないようリセット
    for (const k in keys) if (keys[k]) keys[k].pressed = false;
    requestAnimationFrame(loop);
  }

  resize();
  requestAnimationFrame(loop);
})();
