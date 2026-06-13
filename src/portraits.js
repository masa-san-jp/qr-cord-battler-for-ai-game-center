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

  var ROLE_EN = {
    'アタッカー': 'fierce attacker', 'タンク': 'armored guardian',
    'サポート': 'mystic support', 'ヒーラー': 'gentle healer',
  };
  function promptFor(f) {
    var el = (f.meta && f.meta.label) || 'elemental';
    var role = ROLE_EN[f.role] || 'fighter';
    return 'a ' + f.rarity + ' rank ' + el.toLowerCase() + ' ' + role +
      ' monster, fighting game character, anime game art, bold outline, ' +
      'dynamic pose, vivid colors, centered, plain dark background, no text';
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

  // 肖像未到着でも必ず描く決定論クリーチャー。属性色・簡素（描画を軽く）。
  function placeholder(ctx, f, x, y, size) {
    var col = (f.meta && f.meta.color) || '#888', glow = (f.meta && f.meta.glow) || '#fff';
    var seed = (parseInt(f.hex.substring(0, 8), 16) >>> 0) ^ 0x55;
    var rng = global.QRCore ? global.QRCore.mulberry32(seed) : Math.random;
    ctx.save();
    roundPath(ctx, x, y, size, size, 18); ctx.clip();
    var g = ctx.createLinearGradient(x, y, x, y + size);
    g.addColorStop(0, '#101a36'); g.addColorStop(1, '#060a18');
    ctx.fillStyle = g; ctx.fillRect(x, y, size, size);
    var cx = x + size / 2, cy = y + size * 0.54, r = size * 0.28;
    ctx.globalAlpha = 0.92; ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(cx, cy, r * (0.92 + rng() * 0.16), r * (1.02 + rng() * 0.16), 0, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
    var ex = r * 0.46, ey = cy - r * 0.18;
    ctx.fillStyle = '#fff'; ctx.beginPath();
    ctx.arc(cx - ex, ey, r * 0.19, 0, 7); ctx.arc(cx + ex, ey, r * 0.19, 0, 7); ctx.fill();
    ctx.fillStyle = '#0c1024'; ctx.beginPath();
    ctx.arc(cx - ex, ey + 2, r * 0.09, 0, 7); ctx.arc(cx + ex, ey + 2, r * 0.09, 0, 7); ctx.fill();
    ctx.fillStyle = glow; ctx.textAlign = 'center';
    ctx.font = 'bold ' + Math.round(size * 0.12) + 'px system-ui';
    ctx.globalAlpha = 0.8; ctx.fillText(f.attribute, cx, y + size * 0.92); ctx.globalAlpha = 1;
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

  global.QRPortraits = { request: request, get: get, drawBig: drawBig };
})(typeof window !== 'undefined' ? window : globalThis);
