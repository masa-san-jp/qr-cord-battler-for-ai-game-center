/*
 * QR SMASH ARENA — キャラクター描画層（AI 肖像 + フォールバック）
 *
 * 画面の主役は「ファイターのキャラ絵」。QR コードは表示しない（＝秘密のコレクション感を保つ）。
 * キャラ絵の出どころは 3 段で、ゲームを一切ブロックしない:
 *   1) 事前生成した静的 PNG  assets/portraits/<hex>.png   （展示は基本これ・即時）
 *   2) ライブ生成            POST :8771/generate          （無ければ裏で取得・~9s）
 *   3) どちらも未到着なら     決定論プレースホルダ（属性色のクリーチャー）を描く
 * → どの瞬間でも必ずキャラが見える。デモで確実に遊べることを最優先。
 *
 * グローバル window.QRPortraits を公開（ES module 不使用・file:// で動かすため）。
 */
(function (global) {
  'use strict';
  var ENDPOINT = (global.IMGGEN_ENDPOINT || 'http://127.0.0.1:8771') + '/generate';
  var cache = Object.create(null); // hex -> { img, state, ... }

  // 肖像プロンプトの一貫性ベースは core.js の単一ソース（QRCore.portraitPrompt）。
  function promptFor(f) {
    if (global.QRCore && global.QRCore.portraitPrompt) return global.QRCore.portraitPrompt(f);
    var el = (f.meta && f.meta.label) || 'elemental';
    return 'a tier ' + (f.tier || 'B') + ' ' + el.toLowerCase() + ' fighter monster, ' +
      'full-body fighting game character, anime game art, bold black outline, cel shaded, ' +
      'dynamic battle-ready pose, glowing elemental aura, plain dark gradient background, no text';
  }

  function roundPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function loadFromUrl(entry, url) {
    var img = new Image();
    img.onload = function () { entry.img = img; entry.state = 'ok'; };
    img.onerror = function () { liveGenerate(entry); };
    img.src = url;
  }
  function liveGenerate(entry) {
    if (entry.tried) { entry.state = 'fail'; return; }
    entry.tried = true;
    try {
      var ctrl = new AbortController();
      var to = setTimeout(function () { ctrl.abort(); }, 25000);
      fetch(ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({ prompt: entry.prompt, width: 512, height: 512,
          seed: entry.seed >>> 0, format: 'dataurl' }),
      }).then(function (r) { clearTimeout(to); return r.ok ? r.json() : null; })
        .then(function (d) {
          if (d && d.image) { var im = new Image();
            im.onload = function () { entry.img = im; entry.state = 'ok'; }; im.src = d.image; }
          else entry.state = 'fail';
        }).catch(function () { entry.state = 'fail'; });
    } catch (e) { entry.state = 'fail'; }
  }

  function request(f) {
    if (!f || !f.hex || cache[f.hex]) return;
    var entry = { img: null, state: 'load', tried: false, prompt: promptFor(f),
      seed: parseInt(f.hex.substring(0, 8), 16) || 1 };
    cache[f.hex] = entry;
    loadFromUrl(entry, 'assets/portraits/' + f.hex + '.png'); // 静的優先 → 失敗でライブ
  }
  function get(f) { var e = f && f.hex && cache[f.hex]; return e && e.state === 'ok' ? e.img : null; }

  // 既に生成済みの画像（dataurl）を key に直接セット（リアルタイム生成キャラ用）
  function setImage(key, dataurl) {
    var e = cache[key] || (cache[key] = { img: null, state: 'load' });
    var im = new Image();
    im.onload = function () { e.img = im; e.state = 'ok'; };
    im.onerror = function () { e.state = 'fail'; };
    im.src = dataurl;
  }

  // ---- 色ユーティリティ（16進 → 明暗/透過） ----
  function clampByte(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }
  function toRGB(hex) {
    hex = String(hex || '#888').replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var n = parseInt(hex, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function shade(hex, d) { var c = toRGB(hex); return 'rgb(' + clampByte(c[0] + d) + ',' + clampByte(c[1] + d) + ',' + clampByte(c[2] + d) + ')'; }
  function hexA(hex, a) { var c = toRGB(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  // 属性オーラ（本体の背面）。属性ごとにモチーフを変える。
  function drawAura(ctx, attr, cx, cy, s, col, glow, rng) {
    ctx.save();
    var rg = ctx.createRadialGradient(cx, cy, s * 0.06, cx, cy, s * 0.52);
    rg.addColorStop(0, hexA(glow, 0.5)); rg.addColorStop(0.5, hexA(col, 0.22)); rg.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(cx, cy, s * 0.52, 0, 7); ctx.fill();
    var i, a, k;
    if (attr === '光') {
      ctx.strokeStyle = glow; ctx.lineWidth = s * 0.018;
      for (i = 0; i < 14; i++) { a = (i / 14) * Math.PI * 2; ctx.globalAlpha = 0.14 + 0.12 * (i % 2); ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * s * 0.3, cy + Math.sin(a) * s * 0.3); ctx.lineTo(cx + Math.cos(a) * s * 0.5, cy + Math.sin(a) * s * 0.5); ctx.stroke(); }
    } else if (attr === '水') {
      ctx.strokeStyle = glow; ctx.lineWidth = s * 0.012;
      for (i = 1; i <= 4; i++) { ctx.globalAlpha = 0.32 - i * 0.05; ctx.beginPath(); ctx.arc(cx, cy, s * 0.28 + i * s * 0.06, 0, 7); ctx.stroke(); }
    } else if (attr === '雷') {
      ctx.strokeStyle = glow; ctx.lineWidth = s * 0.014; ctx.globalAlpha = 0.5;
      for (i = 0; i < 7; i++) { a = (i / 7) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * s * 0.24, cy + Math.sin(a) * s * 0.24); for (k = 1; k <= 3; k++) { var rr = s * (0.24 + 0.075 * k), aa = a + (rng() - 0.5) * 0.5; ctx.lineTo(cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr); } ctx.stroke(); }
    } else if (attr === '自然') {
      for (i = 0; i < 8; i++) { a = (i / 8) * Math.PI * 2; ctx.save(); ctx.translate(cx + Math.cos(a) * s * 0.42, cy + Math.sin(a) * s * 0.42); ctx.rotate(a); ctx.globalAlpha = 0.6; ctx.fillStyle = i % 2 ? glow : col; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.07, s * 0.03, 0, 0, 7); ctx.fill(); ctx.restore(); }
    } else if (attr === '闇') {
      for (i = 0; i < 6; i++) { a = (i / 6) * Math.PI * 2; var ox = cx + Math.cos(a) * s * 0.42, oy = cy + Math.sin(a) * s * 0.42; ctx.globalAlpha = 0.28; ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(ox, oy, s * 0.06, 0, 7); ctx.fill(); ctx.globalAlpha = 0.6; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(ox, oy, s * 0.035, 0, 7); ctx.fill(); }
    } else {
      for (i = 0; i < 9; i++) { a = (i / 9) * Math.PI * 2; ctx.save(); ctx.translate(cx + Math.cos(a) * s * 0.32, cy + Math.sin(a) * s * 0.32); ctx.rotate(a + Math.PI / 2); ctx.globalAlpha = 0.5; ctx.fillStyle = i % 2 ? glow : col; ctx.beginPath(); ctx.moveTo(0, -s * 0.1); ctx.quadraticCurveTo(s * 0.045, 0, 0, s * 0.05); ctx.quadraticCurveTo(-s * 0.045, 0, 0, -s * 0.1); ctx.fill(); ctx.restore(); }
    }
    ctx.restore();
  }

  // 肖像未到着でも必ず描く「決定論クリーチャー」。角つきエレメンタル獣（属性オーラ・セルシェード・太い黒縁）。
  function placeholder(ctx, f, x, y, size) {
    var s = size;
    var col = (f.meta && f.meta.color) || '#888', glow = (f.meta && f.meta.glow) || '#fff';
    var attr = f.attribute || '火', outline = '#0b1024';
    var seed = (parseInt((f.hex || '0').substring(0, 8), 16) >>> 0) ^ 0x51ce;
    var rng = global.QRCore ? global.QRCore.mulberry32(seed) : Math.random;
    var cx = x + s / 2, bodyCy = y + s * 0.56;

    ctx.save();
    roundPath(ctx, x, y, s, s, 18); ctx.clip();
    var bg = ctx.createLinearGradient(x, y, x, y + s);
    bg.addColorStop(0, '#111c3c'); bg.addColorStop(1, '#05070f');
    ctx.fillStyle = bg; ctx.fillRect(x, y, s, s);
    ctx.globalAlpha = 1;
    drawAura(ctx, attr, cx, bodyCy - s * 0.04, s, col, glow, rng);
    ctx.globalAlpha = 1;

    var bw = s * (0.29 + rng() * 0.06), bh = s * (0.29 + rng() * 0.05);
    var topY = bodyCy - bh, botY = bodyCy + bh;

    // 背びれ（種による）
    if (rng() < 0.6) {
      ctx.fillStyle = shade(col, -20); ctx.strokeStyle = outline; ctx.lineWidth = s * 0.012;
      for (var sp = -2; sp <= 2; sp++) { var spx = cx + sp * bw * 0.34, spy = topY + Math.abs(sp) * s * 0.028 + bh * 0.15; ctx.beginPath(); ctx.moveTo(spx - s * 0.03, spy); ctx.lineTo(spx, spy - s * 0.12); ctx.lineTo(spx + s * 0.03, spy); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    }
    // 足
    ctx.fillStyle = shade(col, -30); ctx.strokeStyle = outline; ctx.lineWidth = s * 0.018;
    for (var ft = -1; ft <= 1; ft += 2) { ctx.beginPath(); ctx.ellipse(cx + ft * bw * 0.52, botY + s * 0.01, bw * 0.3, s * 0.055, 0, 0, 7); ctx.fill(); ctx.stroke(); }
    // 胴（下がふくらむ卵型・セルシェード）
    ctx.beginPath();
    ctx.moveTo(cx, topY);
    ctx.bezierCurveTo(cx + bw * 1.15, topY, cx + bw * 1.05, botY, cx, botY);
    ctx.bezierCurveTo(cx - bw * 1.05, botY, cx - bw * 1.15, topY, cx, topY);
    ctx.closePath();
    var bgd = ctx.createLinearGradient(cx, topY, cx, botY);
    bgd.addColorStop(0, shade(col, 45)); bgd.addColorStop(0.55, col); bgd.addColorStop(1, shade(col, -50));
    ctx.fillStyle = bgd; ctx.fill();
    ctx.lineWidth = s * 0.024; ctx.strokeStyle = outline; ctx.stroke();
    // 腹プレート
    ctx.beginPath(); ctx.ellipse(cx, bodyCy + bh * 0.28, bw * 0.55, bh * 0.6, 0, 0, 7); ctx.fillStyle = hexA(glow, 0.32); ctx.fill();
    // 腕
    ctx.fillStyle = shade(col, -12); ctx.strokeStyle = outline; ctx.lineWidth = s * 0.02;
    for (var ar = -1; ar <= 1; ar += 2) { ctx.beginPath(); ctx.ellipse(cx + ar * bw * 1.02, bodyCy + bh * 0.18, bw * 0.2, bh * 0.34, ar * 0.3, 0, 7); ctx.fill(); ctx.stroke(); }

    // 角
    var horn = seed % 3;
    ctx.fillStyle = shade(col, 20); ctx.strokeStyle = outline; ctx.lineWidth = s * 0.016;
    var h;
    if (horn === 0) { for (h = -1; h <= 1; h += 2) { ctx.beginPath(); ctx.moveTo(cx + h * bw * 0.55, topY + s * 0.02); ctx.quadraticCurveTo(cx + h * bw * 1.0, topY - s * 0.16, cx + h * bw * 0.52, topY - s * 0.19); ctx.quadraticCurveTo(cx + h * bw * 0.5, topY - s * 0.05, cx + h * bw * 0.38, topY + s * 0.02); ctx.closePath(); ctx.fill(); ctx.stroke(); } }
    else if (horn === 1) { for (h = -1; h <= 1; h += 2) { ctx.beginPath(); ctx.moveTo(cx + h * bw * 0.5, topY); ctx.lineTo(cx + h * bw * 0.64, topY - s * 0.21); ctx.lineTo(cx + h * bw * 0.32, topY + s * 0.01); ctx.closePath(); ctx.fill(); ctx.stroke(); } }
    else { ctx.beginPath(); ctx.moveTo(cx - bw * 0.13, topY + s * 0.01); ctx.lineTo(cx, topY - s * 0.23); ctx.lineTo(cx + bw * 0.13, topY + s * 0.01); ctx.closePath(); ctx.fill(); ctx.stroke(); }

    // 目（発光）
    var eyeY = topY + bh * 0.62, eyeDx = bw * 0.42, er = s * 0.056;
    for (var e = -1; e <= 1; e += 2) { var ex = cx + e * eyeDx; var eg = ctx.createRadialGradient(ex, eyeY, 0, ex, eyeY, er * 1.9); eg.addColorStop(0, glow); eg.addColorStop(1, hexA(glow, 0)); ctx.globalAlpha = 0.85; ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(ex, eyeY, er * 1.9, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
    for (var e2 = -1; e2 <= 1; e2 += 2) { var ex2 = cx + e2 * eyeDx; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(ex2, eyeY, er, er * 1.15, 0, 0, 7); ctx.fill(); ctx.fillStyle = outline; ctx.beginPath(); ctx.arc(ex2, eyeY + er * 0.12, er * 0.5, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.95; ctx.beginPath(); ctx.arc(ex2 - er * 0.22, eyeY - er * 0.22, er * 0.18, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
    // 眉（力強い）
    ctx.strokeStyle = outline; ctx.lineWidth = s * 0.02; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - eyeDx - er, eyeY - er * 1.4); ctx.lineTo(cx - eyeDx * 0.3, eyeY - er * 0.7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + eyeDx + er, eyeY - er * 1.4); ctx.lineTo(cx + eyeDx * 0.3, eyeY - er * 0.7); ctx.stroke();
    // 口＋牙
    var my = eyeY + er * 2.1;
    ctx.lineWidth = s * 0.016; ctx.beginPath(); ctx.moveTo(cx - bw * 0.22, my); ctx.quadraticCurveTo(cx, my + s * 0.035, cx + bw * 0.22, my); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(cx - bw * 0.1, my); ctx.lineTo(cx - bw * 0.05, my + s * 0.032); ctx.lineTo(cx - bw * 0.02, my); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx + bw * 0.1, my); ctx.lineTo(cx + bw * 0.05, my + s * 0.032); ctx.lineTo(cx + bw * 0.02, my); ctx.closePath(); ctx.fill();
    // リムライト
    ctx.globalAlpha = 0.4; ctx.strokeStyle = glow; ctx.lineWidth = s * 0.012;
    ctx.beginPath(); ctx.moveTo(cx - bw * 0.92, bodyCy - bh * 0.2); ctx.quadraticCurveTo(cx - bw * 1.12, bodyCy, cx - bw * 0.78, botY - bh * 0.2); ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineCap = 'butt';
    ctx.restore();
  }

  // 大きく描く。肖像があれば肖像、無ければプレースホルダ。flash で被弾赤フラッシュ。
  function drawBig(ctx, f, x, y, size, flash) {
    try {
      var col = (f.meta && f.meta.color) || '#fff', img = get(f);
      if (img) {
        ctx.save(); roundPath(ctx, x, y, size, size, 18); ctx.clip();
        ctx.fillStyle = '#0d1430'; ctx.fillRect(x, y, size, size);
        ctx.drawImage(img, x, y, size, size); ctx.restore();
      } else {
        placeholder(ctx, f, x, y, size);
      }
      if (flash && flash > 0) {
        ctx.save(); roundPath(ctx, x, y, size, size, 18); ctx.clip();
        ctx.fillStyle = 'rgba(255,90,90,' + flash * 0.45 + ')'; ctx.fillRect(x, y, size, size);
        ctx.restore();
      }
      ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.globalAlpha = 0.85;
      roundPath(ctx, x + 2, y + 2, size - 4, size - 4, 16); ctx.stroke(); ctx.globalAlpha = 1;
    } catch (e) { /* never break the game loop */ }
  }

  global.QRPortraits = { request: request, get: get, setImage: setImage, drawBig: drawBig };
})(typeof window !== 'undefined' ? window : globalThis);
