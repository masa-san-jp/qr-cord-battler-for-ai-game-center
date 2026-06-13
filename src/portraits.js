/*
 * QR SMASH ARENA — AI ポートレイト層（任意・非破壊）
 *
 * 各ファイターの肖像を DGX Spark のローカル画像生成（Qwen, imggen/server.py）で用意し、
 * QR ボードに添える。読み込み方針は 3 段フォールバックで、ゲーム本体を一切ブロックしない:
 *   1) 事前生成した静的 PNG  assets/portraits/<hex>.png   ← 展示は基本これ（即時）
 *   2) ライブ生成            POST :8771/generate          ← 無ければ裏で取得（~9s）
 *   3) どちらも無ければ何も描かない（QR ボードがそのまま見える）
 *
 * 生成は 1 枚 ~9 秒なので「描けたら差し込む」非同期。間に合わなくてもゲームは成立する。
 * グローバル window.QRPortraits を公開（ES module 不使用・file:// で動かすため）。
 */
(function (global) {
  'use strict';
  var ENDPOINT = (global.IMGGEN_ENDPOINT || 'http://127.0.0.1:8771') + '/generate';
  var cache = Object.create(null); // hex -> { img, state: 'load'|'ok'|'fail' }

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
            im.onload = function () { entry.img = im; entry.state = 'ok'; };
            im.src = d.image; }
          else entry.state = 'fail';
        }).catch(function () { entry.state = 'fail'; });
    } catch (e) { entry.state = 'fail'; }
  }

  // ファイター 1 体の肖像取得を予約（重複は無視）
  function request(f) {
    if (!f || !f.hex) return;
    if (cache[f.hex]) return;
    var entry = { img: null, state: 'load', tried: false,
      prompt: promptFor(f), seed: (f.hex && parseInt(f.hex.substring(0, 8), 16)) || 1 };
    cache[f.hex] = entry;
    loadFromUrl(entry, 'assets/portraits/' + f.hex + '.png'); // 静的優先→失敗でライブ
  }

  function get(f) {
    var e = f && f.hex && cache[f.hex];
    return e && e.state === 'ok' ? e.img : null;
  }

  // 角丸＋属性カラー枠で肖像を描く（読み込み済みのときだけ）。失敗しても投げない。
  function draw(ctx, f, x, y, size) {
    var img = get(f);
    if (!img) return false;
    try {
      var r = 14, col = (f.meta && f.meta.color) || '#fff';
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + size, y, x + size, y + size, r);
      ctx.arcTo(x + size, y + size, x, y + size, r);
      ctx.arcTo(x, y + size, x, y, r);
      ctx.arcTo(x, y, x + size, y, r);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, x, y, size, size);
      ctx.restore();
      ctx.strokeStyle = col; ctx.lineWidth = 3;
      ctx.strokeRect(x + 1.5, y + 1.5, size - 3, size - 3);
      return true;
    } catch (e) { return false; }
  }

  global.QRPortraits = { request: request, get: get, draw: draw };
})(typeof window !== 'undefined' ? window : globalThis);
