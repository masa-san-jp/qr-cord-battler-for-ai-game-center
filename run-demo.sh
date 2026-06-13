#!/usr/bin/env bash
# QRコードバトラー — GB10 実機デモ 一括起動
# 画像生成(ComfyUI/Qwen) + ファイター生成API(:8771) + ゲーム配信(:5000) を立ち上げ、
# 画像モデルと LLM(gpt-oss:20b) を事前ウォームして、初回の待ちを消化する。
#
#   bash run-demo.sh
#   → ブラウザで http://localhost:5000/ を開く → タイトルで [3] → カメラに QR をかざす
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

# 1) 画像生成サービス（ComfyUI 起動 + Qwen ウォーム + :8771 の /generate /fighter）
bash "$HERE/imggen/serve.sh"

# 2) LLM(gpt-oss:20b) を事前ウォーム（QR→パラメータ生成の初回ロードをここで消化）
echo "[demo] warming gpt-oss:20b via /fighter ..."
curl -s -m 200 -X POST http://127.0.0.1:8771/fighter \
  -H 'Content-Type: application/json' -d '{"qr":"warmup"}' >/dev/null || true

# 3) ゲーム配信（:5000）。getUserMedia（カメラ）は localhost なら HTTPS 無しでも許可される
if ! curl -s -m 3 http://127.0.0.1:5000/index.html >/dev/null 2>&1; then
  echo "[demo] starting game server on :5000 ..."
  ( cd "$HERE" && nohup python3 -m http.server 5000 --bind 127.0.0.1 >/tmp/qrb_http.log 2>&1 & )
  sleep 1
fi

# 4) デモ用ブラウザを全画面で起動
#    カメラを使うため、snap 非依存で camera 権限を自動許可する Chromium を使う
#    （snap 版 Firefox は firefox:camera の接続に sudo が要るため避ける）。
CHROME="$(ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux/chrome 2>/dev/null | head -1)"
if [ -n "$CHROME" ] && [ -z "${NO_BROWSER:-}" ]; then
  echo "[demo] launching fullscreen browser ..."
  # アプリ窓モード（全画面にしない＝他の作業画面を潰さない）。大きさ/位置は自由に動かせる
  DISPLAY="${DISPLAY:-:1}" nohup "$CHROME" --no-sandbox --no-first-run --no-default-browser-check \
    --app='http://localhost:5000/index.html' --window-size=1280,760 --window-position=120,80 \
    --use-fake-ui-for-media-stream --user-data-dir=/tmp/qrb-chrome-profile \
    >/tmp/qrb_chrome.log 2>&1 &
fi

echo "[demo] READY → http://localhost:5000/"
echo "  [3] QR 読込（要・USB webカメラを DGX に接続） / [1] 1P vs CPU / [2] 2P （[1][2]はカメラ不要）"
