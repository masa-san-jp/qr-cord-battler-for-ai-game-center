# 実機デモの起動手順（GB10 / DGX Spark）

QR をカメラで読み取り、GB10 上でリアルタイム生成したキャラで対戦するデモ。

## 一括起動

```bash
bash run-demo.sh
```

これで以下が立ち上がる（初回ロードは起動時に消化＝本番で待たせない）:

- ComfyUI + Qwen 画像生成（ウォーム）
- ファイター生成 API `:8771`（`/fighter` = QR文字列 → ローカル LLM gpt-oss:20b でパラメータ＋画像プロンプト → Qwen で画像、を一括）
- ゲーム配信 `:5000`
- カメラ対応ブラウザ（Chromium）を全画面で `http://localhost:5000/`

## 遊び方

- タイトルで **[3] QR を読み込んで召喚** → カメラに QR をかざす → 約 20〜25 秒で自キャラ生成 → 対戦
- **[1] 1P vs CPU** / **[2] 2P** はカメラ不要（すぐ遊べる）

## 必須ハード：USB webカメラ

[3] のスキャンには **USB webカメラを DGX に接続**しておくこと。未接続だと
「カメラを使えません（NotFoundError）」になる（OS に `/dev/video*` が無い状態）。

確認：

```bash
ls /dev/video*        # 接続されていれば video0 等が出る
```

## ブラウザの選択（カメラ権限）

- 本スクリプトは **Chromium（playwright 同梱・snap 非依存）** を使う。`--use-fake-ui-for-media-stream`
  で権限ダイアログを自動許可しつつ、実カメラがあればそれを使う。
- snap 版 Firefox を使う場合は、カメラ接続に管理者権限が必要：
  `sudo snap connect firefox:camera`

## 速度

- QR 読取 → 生成完了：約 20〜25 秒（LLM 約 13 秒＋画像 約 9 秒、GB10 実測）。生成中は演出表示。
- 速くしたい場合は、より軽い LLM に差し替え（`FIGHTER_MODEL` 環境変数）。

## 公開URL版との違い

GitHub Pages 版（`https://masa-san-jp.github.io/qr-cord-battler-for-ai-game-center/`）は
GB10 のローカルサービスに繋げないため、[3] は簡易（決定論）生成にフォールバックする。
リアルタイム生成のフルデモは必ず GB10 実機の localhost で動かすこと。
