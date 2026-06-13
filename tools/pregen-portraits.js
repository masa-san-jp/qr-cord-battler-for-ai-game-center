/*
 * 事前生成: 指定したファイター文字列の AI 肖像を作って assets/portraits/<hex>.png に保存する。
 * 展示では固定対戦（index.html?p1=...&p2=...）の肖像を先に焼いておけば、本番は即時表示になる。
 *
 *   node tools/pregen-portraits.js "推し文字列1" "推し文字列2" ...
 *   （引数なしならショーケース既定セットを生成）
 *
 * 要: imggen サービス（imggen/serve.sh → :8771）が起動済み。1 枚 ~9 秒。
 */
'use strict';
const fs = require('fs');
const path = require('path');
require('../src/core.js'); // sets globalThis.QRCore
const C = globalThis.QRCore;

const ENDPOINT = (process.env.IMGGEN_ENDPOINT || 'http://127.0.0.1:8771') + '/generate';
const OUT = path.join(__dirname, '..', 'assets', 'portraits');

const ROLE_EN = {
  'アタッカー': 'fierce attacker', 'タンク': 'armored guardian',
  'サポート': 'mystic support', 'ヒーラー': 'gentle healer',
};
function promptFor(f) {
  const el = (f.meta && f.meta.label) || 'elemental';
  const role = ROLE_EN[f.role] || 'fighter';
  return `a tier ${f.tier || 'B'} ${el.toLowerCase()} ${role} monster, fighting game ` +
    `character, anime game art, bold outline, dynamic pose, vivid colors, ` +
    `centered, plain dark background, no text`;
}

const DEFAULT = ['ドラゴン', 'フェニックス', 'カミナリ', 'もりのぬし', 'ひかりのきし', 'やみのおう'];

async function genOne(text) {
  const f = C.generateFighter(text, 21);
  const seed = parseInt(f.hex.substring(0, 8), 16) >>> 0;
  const body = JSON.stringify({ prompt: promptFor(f), width: 512, height: 512, seed, format: 'png' });
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const out = path.join(OUT, f.hex + '.png');
  fs.writeFileSync(out, buf);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  ${text}  -> ${f.attribute}/${f.role}/${f.rarity}  ${f.hex.slice(0, 8)}.png  (${buf.length}B, ${dt}s)`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const texts = process.argv.slice(2);
  const list = texts.length ? texts : DEFAULT;
  console.log(`pregen ${list.length} portrait(s) -> ${OUT}`);
  for (const t of list) {
    try { await genOne(t); } catch (e) { console.error(`  ${t}  FAILED: ${e.message}`); }
  }
  console.log('done.');
})();
