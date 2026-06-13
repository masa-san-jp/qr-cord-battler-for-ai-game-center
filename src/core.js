/*
 * QR SMASH ARENA — 決定論的ファイター生成コア
 *
 * 「同じ QR 文字列 → 常に同じファイター」を保証する決定論生成。
 * ステータスは QR の内容から決まる 5 パラメータ（合計＝Tier）:
 *   HP / 攻撃力(atk) / 防御力(def) / 素早さ(spd) / カウンター率(ctr)
 *   Tier:  SSS=1000  SS=800  A=600  B=500（5 値の合計）
 * ビルド不要・file:// で動かすためグローバル window.QRCore で公開する。
 */
(function (global) {
  'use strict';

  // ---- ハッシュ (FNV-1a 複数オフセット) → 64hex ----
  function hashHex(str) {
    let h1 = 0x811c9dc5 >>> 0, h2 = 0x01000193 >>> 0, out = '';
    for (let pass = 0; pass < 8; pass++) {
      let h = (h1 ^ (pass * 0x9e3779b1)) >>> 0;
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; h ^= h >>> 15; }
      h2 = Math.imul(h2 ^ h, 0x85ebca6b) >>> 0;
      out += (h >>> 0).toString(16).padStart(8, '0');
    }
    return out;
  }
  function hashToSeed(hex) {
    const b = (o) => parseInt(hex.substring(o * 2, o * 2 + 2), 16);
    return ((b(0) << 24) | (b(1) << 16) | (b(2) << 8) | b(3)) >>> 0;
  }
  function mulberry32(seed) {
    let s = seed;
    return function () {
      s |= 0; s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- 属性 ----
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
  function affinityMultiplier(attacker, defender) { return ADVANTAGE[attacker] === defender ? 1.25 : 1.0; }

  // ---- Tier（5 パラメータの合計値） ----
  const TIERS = [
    { label: 'SSS', total: 1000, color: '#ffd23c' },
    { label: 'SS',  total: 800,  color: '#ff7be0' },
    { label: 'A',   total: 600,  color: '#c77bff' },
    { label: 'B',   total: 500,  color: '#5ad1ff' },
  ];
  function determineTier(roll) {
    if (roll < 0.04) return TIERS[0];
    if (roll < 0.18) return TIERS[1];
    if (roll < 0.48) return TIERS[2];
    return TIERS[3];
  }

  // ---- 名前 ----
  const NAME_A = ['グレン', 'アクア', 'ボルト', 'ヴェルデ', 'ルクス', 'ノクス', 'ザイン', 'クロム', 'リオ', 'ガイ'];
  const NAME_B = ['ガルド', 'ザード', 'ロス', 'ファング', 'クロウ', 'バーン', 'エッジ', 'ヴァイン', 'コア', 'レックス'];
  function generateName(rng) { return NAME_A[(rng() * NAME_A.length) | 0] + '・' + NAME_B[(rng() * NAME_B.length) | 0]; }

  // 合計 total を 5 値へ決定論的に配分（各値に下限ウェイトを与え 0 偏りを防ぐ）
  function distribute(rng, total) {
    const w = [rng() + 0.45, rng() + 0.45, rng() + 0.45, rng() + 0.45, rng() + 0.45];
    const sum = w[0] + w[1] + w[2] + w[3] + w[4];
    const v = w.map((x) => Math.max(1, Math.round((x / sum) * total)));
    let diff = total - (v[0] + v[1] + v[2] + v[3] + v[4]);
    v[0] += diff; // 端数を 1 つ目に寄せて合計を total へ厳密一致
    return v;
  }

  function generateFighter(payload) {
    const text = (payload && String(payload).trim()) || 'QR-' + Math.random();
    const hex = hashHex(text);
    const rng = mulberry32(hashToSeed(hex));

    const tier = determineTier(rng());
    const attribute = ATTRIBUTES[(rng() * ATTRIBUTES.length) | 0];
    const role = ['アタッカー', 'タンク', 'サポート', 'ヒーラー'][(rng() * 4) | 0];
    const [hp, atk, def, spd, ctr] = distribute(rng, tier.total);
    const ctrPct = Math.min(80, Math.round((ctr / tier.total) * 100));
    const name = generateName(rng);

    return {
      text, hex, name, attribute, role,
      tier: tier.label, tierTotal: tier.total, tierColor: tier.color,
      hp, atk, def, spd, ctr, ctrPct,
      meta: ATTR_META[attribute],
    };
  }

  // --- キャラ肖像の一貫性ベース ---------------------------------------
  // 既に生成したファイター群（角ありの鬼系クリーチャー・東洋風の装甲と帯・
  // 太い黒縁のセルシェード・属性オーラ・ダーク背景）から抽出した共通の絵柄。
  // 全ファイターをこの世界観で揃えるため、肖像プロンプトは必ずこの BASE を含める。
  // 可変部（属性/ロール/ティア）だけが個体差になる。
  const ROLE_EN = {
    'アタッカー': 'fierce attacker', 'タンク': 'armored guardian',
    'サポート': 'mystic support', 'ヒーラー': 'gentle healer',
  };
  const CHAR_BASE_PROMPT =
    'full-body fighting game character, anime game art, bold black outline, ' +
    'cel shaded, dynamic battle-ready pose, horned demon-creature humanoid in ' +
    'ornate oriental armor and sashes, clawed hands and feet, glowing elemental aura, ' +
    'vivid saturated colors, dramatic rim light, centered single character, ' +
    'plain dark gradient background, subtle vignette, no text, no logo, no UI';

  // ファイター f から肖像生成プロンプトを組む（可変部 + 共通 BASE）。
  function portraitPrompt(f) {
    const el = (f && f.meta && f.meta.label) || 'elemental';
    const role = (f && ROLE_EN[f.role]) || 'fighter';
    const tier = (f && f.tier) || 'B';
    return 'a tier ' + tier + ' ' + el.toLowerCase() + ' ' + role + ' monster, ' + CHAR_BASE_PROMPT;
  }

  global.QRCore = {
    hashHex, hashToSeed, mulberry32,
    ATTRIBUTES, ATTR_META, TIERS,
    affinityMultiplier, determineTier, generateFighter,
    ROLE_EN, CHAR_BASE_PROMPT, portraitPrompt,
  };
})(typeof window !== 'undefined' ? window : globalThis);
