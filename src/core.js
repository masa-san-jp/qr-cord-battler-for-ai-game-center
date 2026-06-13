/*
 * QR SMASH ARENA — 決定論的ファイター生成コア
 *
 * packages/core (qr-cord-battler モノレポ) の生成ロジックを vendor したもの。
 * 「同じ文字列(QR) → 常に同じファイター」を保証する決定論的生成。
 * ビルド不要で file:// から動かすため、ESモジュールではなくグローバル(window.QRCore)で公開する。
 */
(function (global) {
  'use strict';

  // ---- ハッシュ: 文字列 -> 64hex 相当のシード列 (FNV-1a を複数オフセットで) ----
  // 本家は SHA-256 を使うが、ブラウザ同梱・同期実行のため軽量ハッシュで代替。
  // 目的は「決定論的・良分布」であって暗号強度ではない。
  function hashHex(str) {
    let h1 = 0x811c9dc5 >>> 0;
    let h2 = 0x01000193 >>> 0;
    let out = '';
    for (let pass = 0; pass < 8; pass++) {
      let h = (h1 ^ (pass * 0x9e3779b1)) >>> 0;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
        h ^= h >>> 15;
      }
      h2 = Math.imul(h2 ^ h, 0x85ebca6b) >>> 0;
      out += (h >>> 0).toString(16).padStart(8, '0');
    }
    return out; // 64 hex chars
  }

  // ---- mulberry32 (本家 rng.ts と同一) ----
  function hashToSeed(hex) {
    const b = (o) => parseInt(hex.substring(o * 2, o * 2 + 2), 16);
    return ((b(0) << 24) | (b(1) << 16) | (b(2) << 8) | b(3)) >>> 0;
  }
  function mulberry32(seed) {
    let s = seed;
    return function () {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- 属性 (本家 attribute.ts と同一) ----
  const ATTRIBUTES = ['火', '水', '雷', '自然', '光', '闇'];
  const ATTR_META = {
    '火':   { color: '#ff5a3c', glow: '#ffb199', label: 'FIRE' },
    '水':   { color: '#37a7ff', glow: '#a8dbff', label: 'AQUA' },
    '雷':   { color: '#ffd23c', glow: '#fff2a8', label: 'BOLT' },
    '自然': { color: '#4cd964', glow: '#bff5c4', label: 'WILD' },
    '光':   { color: '#ffe9a8', glow: '#fffbe6', label: 'LUMEN' },
    '闇':   { color: '#a06bff', glow: '#d9c4ff', label: 'VOID' },
  };
  const ADVANTAGE = { '火': '自然', '自然': '雷', '雷': '水', '水': '火', '光': '闇', '闇': '光' };

  function affinityMultiplier(attacker, defender) {
    return ADVANTAGE[attacker] === defender ? 1.25 : 1.0;
  }

  // ---- レア度 (本家 rarity.ts 準拠の閾値) ----
  function determineRarity(roll) {
    if (roll < 0.02) return 'SSR';
    if (roll < 0.12) return 'SR';
    if (roll < 0.40) return 'R';
    return 'N';
  }
  const RARITY_META = {
    N:   { mult: 1.0,  label: 'N',   color: '#9aa3b2' },
    R:   { mult: 1.12, label: 'R',   color: '#5ad1ff' },
    SR:  { mult: 1.28, label: 'SR',  color: '#c77bff' },
    SSR: { mult: 1.5,  label: 'SSR', color: '#ffd23c' },
  };

  // ---- 名前生成 (雰囲気用・簡易) ----
  const NAME_A = ['グレン', 'アクア', 'ボルト', 'ヴェルデ', 'ルクス', 'ノクス', 'ザイン', 'クロム', 'リオ', 'ガイ'];
  const NAME_B = ['ガルド', 'ザード', 'ロス', 'ファング', 'クロウ', 'バーン', 'エッジ', 'ヴァイン', 'コア', 'レックス'];
  function generateName(rng) {
    return NAME_A[Math.floor(rng() * NAME_A.length)] + '・' + NAME_B[Math.floor(rng() * NAME_B.length)];
  }

  // ---- QRモジュールパターン生成 ----
  // スキャン可能な本物のQRではなく「決定論的にQRらしく見える」グリッド。
  // 各黒モジュール = HPの実体。3隅にファインダーパターンを描く。
  function generateGrid(hex, size) {
    const rng = mulberry32(hashToSeed(hex) ^ 0xA5A5A5A5);
    const g = [];
    for (let y = 0; y < size; y++) {
      const row = [];
      for (let x = 0; x < size; x++) row.push(rng() < 0.5 ? 1 : 0);
      g.push(row);
    }
    // ファインダーパターン (7x7) を 3隅に
    const stamp = (ox, oy) => {
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 7; x++) {
          const border = x === 0 || x === 6 || y === 0 || y === 6;
          const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
          g[oy + y][ox + x] = border || core ? 1 : 0;
        }
      }
      // separator (8px周囲を白) — 端からはみ出さない範囲で
      for (let y = -1; y <= 7; y++) {
        for (let x = -1; x <= 7; x++) {
          if (x >= 0 && x < 7 && y >= 0 && y < 7) continue;
          const px = ox + x, py = oy + y;
          if (px >= 0 && px < size && py >= 0 && py < size) g[py][px] = 0;
        }
      }
    };
    stamp(0, 0);
    stamp(size - 7, 0);
    stamp(0, size - 7);
    return g;
  }

  function isFinder(x, y, size) {
    const inBox = (ox, oy) => x >= ox && x < ox + 7 && y >= oy && y < oy + 7;
    return inBox(0, 0) || inBox(size - 7, 0) || inBox(0, size - 7);
  }

  // ---- ファイター生成 (本家 generateCharacter 準拠の順序) ----
  function generateFighter(payload, gridSize) {
    const text = (payload && String(payload).trim()) || 'QR-' + Math.random();
    const hex = hashHex(text);
    const rng = mulberry32(hashToSeed(hex));

    const rarity = determineRarity(rng());
    const attribute = ATTRIBUTES[Math.floor(rng() * ATTRIBUTES.length)];
    const role = ['アタッカー', 'タンク', 'サポート', 'ヒーラー'][Math.floor(rng() * 4)];

    const rmul = RARITY_META[rarity].mult;
    const atk = Math.round((60 + rng() * 60) * rmul);   // 攻撃力 → 1ヒットで壊すモジュール数に影響
    const spd = Math.round((40 + rng() * 60) * rmul);   // 速度 → チャージ効率
    const def = Math.round((20 + rng() * 50) * rmul);   // 防御 → 被ダメ軽減
    const name = generateName(rng);

    const size = gridSize || 21;
    const grid = generateGrid(hex, size);
    let coreModules = 0;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (grid[y][x] && !isFinder(x, y, size)) coreModules++;

    return {
      text, hex, name, rarity, attribute, role,
      atk, spd, def,
      meta: ATTR_META[attribute],
      rarityMeta: RARITY_META[rarity],
      grid, size, coreModules,
    };
  }

  global.QRCore = {
    hashHex, mulberry32, hashToSeed,
    ATTRIBUTES, ATTR_META, RARITY_META,
    affinityMultiplier, generateFighter, generateGrid, isFinder,
  };
})(typeof window !== 'undefined' ? window : globalThis);
