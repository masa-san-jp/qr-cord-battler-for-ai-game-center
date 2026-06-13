# キャラクター・スタイル基準 — QR SMASH ARENA

ファイターの見た目に一貫性を持たせるための基準。すでに生成したキャラ
（角ありの鬼系クリーチャー・東洋風の装甲と帯・太い黒縁のセルシェード・属性オーラ・
ダーク背景のダイナミックなポーズ）から抽出した。**新規キャラもこの世界観で揃える。**

## ベースプロンプト（単一ソース）

コードの正となる定義は `src/core.js` の `QRCore.CHAR_BASE_PROMPT` / `QRCore.portraitPrompt(f)`。
肖像生成は必ずこれを経由する（`tools/pregen-portraits.js` と `src/portraits.js` の両方が参照）。

```
<可変部> + ", " + CHAR_BASE_PROMPT
```

- **可変部**（個体差）: `a tier <T> <element> <role> monster`
  - element = 属性ラベル（FIRE / AQUA / BOLT / WILD / LUMEN / VOID）
  - role = アタッカー→fierce attacker / タンク→armored guardian / サポート→mystic support / ヒーラー→gentle healer
  - tier = SSS / SS / A / B …
- **CHAR_BASE_PROMPT**（共通の絵柄＝一貫性の芯）:

```
full-body fighting game character, anime game art, bold black outline, cel shaded,
dynamic battle-ready pose, horned demon-creature humanoid in ornate oriental armor and sashes,
clawed hands and feet, glowing elemental aura, vivid saturated colors, dramatic rim light,
centered single character, plain dark gradient background, subtle vignette, no text, no logo, no UI
```

## 抽出した絵柄の要素（既存キャラより）

- **シルエット**: 全身・角あり・鬼/オニ系のヒューマノイドクリーチャー。爪のある手足。
- **装い**: 東洋風の装甲・帯・サッシュ。ティアが上がるほど装飾過多に。
- **描画**: 太い黒縁＋セルシェード（アニメゲーム塗り）。
- **色**: 高彩度。属性で主色が決まる（火=赤橙 / 闇=紫 など、`ATTR_META` の color/glow に対応）。
- **演出**: 属性のオーラ・発光、ドラマチックなリムライト、ダイナミックな戦闘ポーズ。
- **背景**: 無地のダークグラデ＋軽いビネット（キャラを主役にする）。文字・UI は描かない。

## 属性 × 主色（core.js `ATTR_META` と一致）

| 属性 | label | 主色 |
|------|-------|------|
| 火 | FIRE | `#ff5a3c` |
| 水 | AQUA | `#37a7ff` |
| 雷 | BOLT | `#ffd23c` |
| 自然 | WILD | `#4cd964` |
| 光 | LUMEN | `#ffe9a8` |
| 闇 | VOID | `#a06bff` |

## 再生成・追加

```bash
# imggen サービス起動済み(:8771)で
node tools/pregen-portraits.js "推し文字列1" "推し文字列2" ...   # 指定キャラを焼く
node tools/pregen-portraits.js                                   # 既定ショーケースを焼く
```

決定論シードは文字列ハッシュ由来なので、**同じ文字列＝常に同じ見た目**。ベースを変えると
全キャラの作風が一斉に変わる（= 一貫性のレバー）。芯（角・東洋装甲・黒縁セルシェード・
属性オーラ・ダーク背景）は崩さず、足し引きはこの周辺に留める。
