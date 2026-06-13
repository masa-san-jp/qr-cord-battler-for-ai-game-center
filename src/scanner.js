/*
 * QRコードバトラー — ウェブカメラ QR スキャナ（任意機能）
 *
 * getUserMedia でカメラ映像を取り、jsQR で 1 フレームずつ QR を探す。
 * 検出した文字列がそのまま「自キャラの設計図」になる（決定論生成）。
 * カメラ未許可/無しでも他のモード（ランダム対戦）は遊べる＝非破壊。
 * グローバル window.QRScanner を公開（jsQR は src/vendor/jsQR.js が window.jsQR を提供）。
 */
(function (global) {
  'use strict';
  let stream = null, video = null, work = null, wctx = null, lastErr = null;

  async function start() {
    lastErr = null;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { lastErr = 'no-camera-api'; return false; }
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video = document.createElement('video');
      video.setAttribute('playsinline', ''); video.muted = true;
      video.srcObject = stream;
      await video.play();
      work = document.createElement('canvas');
      wctx = work.getContext('2d', { willReadFrequently: true });
      return true;
    } catch (e) { lastErr = (e && e.name) || 'error'; stop(); return false; }
  }

  function stop() {
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    video = null;
  }

  function ready() { return !!(video && video.readyState >= 2 && video.videoWidth > 0); }

  // 1 フレーム走査し、QR があれば {text} を返す。なければ null。
  function poll() {
    if (!ready() || !global.jsQR) return null;
    const w = video.videoWidth, h = video.videoHeight;
    if (work.width !== w) { work.width = w; work.height = h; }
    wctx.drawImage(video, 0, 0, w, h);
    let img;
    try { img = wctx.getImageData(0, 0, w, h); } catch (e) { return null; }
    const res = global.jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
    return res && res.data ? { text: res.data } : null;
  }

  // 映像を cover-fit で枠 (x,y,w,h) に描く
  function drawVideo(ctx, x, y, w, h) {
    if (!ready()) return false;
    const vw = video.videoWidth, vh = video.videoHeight;
    const scale = Math.max(w / vw, h / vh), dw = vw * scale, dh = vh * scale;
    ctx.drawImage(video, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    return true;
  }

  global.QRScanner = { start, stop, ready, poll, drawVideo, error: () => lastErr };
})(typeof window !== 'undefined' ? window : globalThis);
