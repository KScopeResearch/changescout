/*
 * illustrations.js — Phase56 STEP1（Hero / First-View redesign）
 *
 * report-preview の Hero / セクション見出し / Benefit カードに使う inline SVG。
 *
 * 【原則】
 *  - 外部画像を一切読み込まない（inline SVG のみ）。AI 画像生成も使わない
 *  - deterministic（同じ theme なら常に同じ図）。乱数・時刻は使わない
 *  - 色は currentColor / CSS 変数（gradient は SVG 内 <defs> で currentColor から生成）
 *  - aria-hidden 前提（意味は本文が担う）
 *
 * UMD。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Illustrations = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // theme ごとの小さなグリフ（24x24, stroke=currentColor, fill=none）。
  // Phase56: 12 → 20 テーマへ拡張。
  var GLYPHS = {
    ai_dx:
      '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/>',
    dx:
      '<rect x="3" y="4" width="18" height="13" rx="1"/><path d="M8 21h8M12 17v4M8 9l3 3-3 3M13 15h4"/>',
    new_business:
      '<path d="M12 20v-8"/><path d="M12 12c0-3 2-5 5-5 0 3-2 5-5 5z"/><path d="M12 12c0-3-2-5-5-5 0 3 2 5 5 5z"/><path d="M7 20h10"/>',
    overseas:
      '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    subsidy_policy:
      '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    hr:
      '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M3 20c0-3 2-5 5-5s5 2 5 5M13 20c0-3 2-5 5-5s3 2 3 5"/>',
    restaurant:
      '<path d="M6 3v8a2 2 0 0 0 4 0V3M8 11v10"/><path d="M17 3c-2 0-3 2-3 5s1 4 3 4v9"/>',
    retail:
      '<path d="M6 8h12l-1 12H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    manufacturing:
      '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M4.2 7l2.6 1.5M17.2 15.5l2.6 1.5M4.2 17l2.6-1.5M17.2 8.5l2.6-1.5"/>',
    saas:
      '<path d="M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.5A3.5 3.5 0 0 1 18 18H7z"/>',
    marketing:
      '<path d="M4 10v4l10 4V6z"/><path d="M14 8a4 4 0 0 1 0 8"/><path d="M6 14v4a1.5 1.5 0 0 0 3 0"/>',
    content_media:
      '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/>',
    healthcare:
      '<path d="M12 21s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9z"/><path d="M12 8v6M9 11h6"/>',
    finance:
      '<path d="M4 19h16M6 19V9M11 19V5M16 19v-7M21 19V11"/>',
    sustainability:
      '<path d="M12 21c5-1 8-5 8-10 0-4-3-8-8-8-1 5 1 9 5 11-4 1-8-1-9-5-1 4 0 11 4 12z"/>',
    education:
      '<path d="M3 8l9-4 9 4-9 4z"/><path d="M7 10v5c0 1.5 2.5 3 5 3s5-1.5 5-3v-5M21 8v6"/>',
    logistics:
      '<path d="M2 7h11v9H2zM13 10h5l3 3v3h-8z"/><circle cx="6" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
    construction:
      '<path d="M4 21h16M6 21V10l6-4 6 4v11M10 21v-5h4v5"/>',
    agriculture:
      '<path d="M12 22V9M12 9c-1-3-4-4-6-4 0 3 2 6 6 6zM12 12c1-3 4-5 7-5 0 4-3 6-7 6z"/>',
    tourism:
      '<path d="M12 2l2 6h6l-5 4 2 7-5-4-5 4 2-7-5-4h6z"/>',
    generic_insight:
      '<path d="M4 20h16"/><path d="M7 20v-6M12 20V8M17 20v-10"/>',
  };

  var THEMES = Object.keys(GLYPHS);

  /**
   * theme のグリフ SVG 文字列を返す。未知 theme は generic_insight。
   * @param {string} theme
   * @param {{size?:number, className?:string}} [opts]
   * @returns {string}
   */
  function glyph(theme, opts) {
    var o = opts || {};
    var size = o.size || 22;
    var cls = o.className ? ' class="' + o.className + '"' : "";
    var body = GLYPHS[theme] || GLYPHS.generic_insight;
    return (
      "<svg" +
      cls +
      ' width="' +
      size +
      '" height="' +
      size +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      body +
      "</svg>"
    );
  }

  /**
   * Hero 用の大型シーン。gradient + 背景円 + アクセント形 + theme グリフ（大）。
   * currentColor をベースに SVG 内 <defs> で淡いグラデーションを作るので、
   * CSS 側でテーマ色を currentColor に渡すだけで色が付く（外部画像・stylesheet 不要）。
   * @param {string} theme
   * @returns {string}
   */
  function hero(theme) {
    var g = GLYPHS[theme] || GLYPHS.generic_insight;
    // グリフを中央（120,120 付近）に 4.4 倍で配置（24*4.4≈106）
    return (
      '<svg class="hero-illust__svg" viewBox="0 0 300 260" fill="none" ' +
      'stroke="currentColor" aria-hidden="true" focusable="false">' +
      "<defs>" +
      '<linearGradient id="heroGrad" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="currentColor" stop-opacity="0.16"/>' +
      '<stop offset="1" stop-color="currentColor" stop-opacity="0.03"/>' +
      "</linearGradient>" +
      '<linearGradient id="heroRing" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="currentColor" stop-opacity="0.5"/>' +
      '<stop offset="1" stop-color="currentColor" stop-opacity="0.12"/>' +
      "</linearGradient>" +
      "</defs>" +
      // 背景の大きな円（グラデ塗り）
      '<circle class="hero-illust__bg" cx="150" cy="128" r="104" fill="url(#heroGrad)" stroke="none"/>' +
      // うっすらリング
      '<circle class="hero-illust__ring" cx="150" cy="128" r="104" fill="none" stroke="url(#heroRing)" stroke-width="1.4"/>' +
      // アクセント（拡大を示す小さな棒グラフ）
      '<g class="hero-illust__accent-shapes" stroke="none" fill="currentColor">' +
      '<rect x="44" y="196" width="12" height="16" rx="2" opacity="0.25"/>' +
      '<rect x="62" y="184" width="12" height="28" rx="2" opacity="0.32"/>' +
      '<rect x="80" y="168" width="12" height="44" rx="2" opacity="0.4"/>' +
      "</g>" +
      // 変化の弧
      '<path class="hero-illust__flow" d="M56 92 C110 44 190 44 244 92" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="3 5" opacity="0.55"/>' +
      '<path class="hero-illust__flow" d="M238 84 l8 10 -12 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>' +
      // 中央：機会の円 + theme グリフ（大）
      '<circle class="hero-illust__opp" cx="150" cy="122" r="46" fill="var(--color-surface, #fff)" stroke="currentColor" stroke-width="1.6"/>' +
      '<g class="hero-illust__mark" transform="translate(97,69) scale(4.4)" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      g +
      "</g>" +
      // 御社ドット
      '<circle cx="150" cy="214" r="5" fill="currentColor" stroke="none" opacity="0.7"/>' +
      '<path d="M150 168 V206" stroke="currentColor" stroke-width="1.4" opacity="0.35"/>' +
      "</svg>"
    );
  }

  /**
   * First Action 用の 1〜3 ステップ図。
   * @param {number} count
   * @returns {string}
   */
  function steps(count) {
    var n = Math.max(1, Math.min(3, count || 1));
    var dots = "";
    for (var i = 0; i < n; i++) {
      var x = 12 + i * 26;
      dots += '<circle cx="' + x + '" cy="12" r="4"/>';
      if (i < n - 1) dots += '<path d="M' + (x + 5) + " 12 H" + (x + 21) + '"/>';
    }
    return (
      '<svg width="' +
      (12 + n * 26) +
      '" height="24" viewBox="0 0 ' +
      (12 + n * 26) +
      ' 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" aria-hidden="true" focusable="false">' +
      dots +
      "</svg>"
    );
  }

  return { glyph: glyph, hero: hero, steps: steps, THEMES: THEMES };
});
