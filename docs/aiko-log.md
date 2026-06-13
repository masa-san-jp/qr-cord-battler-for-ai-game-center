# アイコ作業ログ — qr-cord-battler-for-ai-game-center（DGX Spark ハッカソン 2026-06-13）

全アイコ（maid / aiko-dev / aiko-pr / hisyo）の稼働を **15 分刻みのハートビート**で記録する。
基準は本日 **13:00 JST**。15 分ごとにスロットが進み、担当アイコがローテーションする。

## ローテーション

スロット番号 = `floor((現在時刻 − 13:00 JST) / 15分)`。担当は番号 mod 4 で決まる:

| 番号 mod 4 | 担当 |
|---|---|
| 0 | maid |
| 1 | aiko-dev |
| 2 | aiko-pr |
| 3 | hisyo |

## 記法

- **ハートビート**（15 分ごと・自動）: `- HH:MM JST **[persona]** 🫀 稼働中（…）`
- **イベント**（着手・完了・ブロッカー・引き継ぎ・随時）: `- HH:MM JST **[persona]** 内容`
- 末尾に追記のみ。上書き禁止。時刻は JST。
- 追記は必ず `docs/aiko-log.sh` 経由（並行 push でも壊れない・どの repo でも自動判別）。
  - ハートビート: `docs/aiko-log.sh --heartbeat`
  - イベント: `docs/aiko-log.sh <persona> "<メッセージ>"`

---

## ログ
- `14:44 JST` **[maid]** ログ基盤セットアップ完了。repo自動判別の共通スクリプトで稼働開始。15分ハートビート対象に追加
