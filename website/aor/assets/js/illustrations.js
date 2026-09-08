/*
 * illustrations.js — Phase55 STEP3
 *
 * report-preview の Hero / セクション見出しに使う、軽量な inline SVG。
 *
 * 【原則】
 *  - 外部画像を一切読み込まない（inline SVG のみ）
 *  - deterministic（同じ theme なら常に同じ図）。乱数・時刻・AI 生成は使わない
 *  - 装飾ではなく「市場→変化→機会→会社→行動」の理解を助けるための図
 *  - 色は currentColor / CSS 変数に委ねる。fill せずシンプルな stroke 中心
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

  // theme ごとの小さなグリフ（24x24, stroke=currentColor）
  var GLYPHS = {
    ai_dx:
      '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/>',
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
    generic_insight:
      '<path d="M4 20h16"/><path d="M7 20v-6M12 20V8M17 20v-10"/>',
  };

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
      '<svg' +
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
   * Hero 用の「市場 → 変化 → 機会 → 御社」フロー図。theme のグリフを「機会」の位置に置く。
   * @param {string} theme
   * @returns {string}
   */
  function hero(theme) {
    var accent = GLYPHS[theme] || GLYPHS.generic_insight;
    return (
      '<svg class="hero-illust__svg" viewBox="0 0 320 120" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' +
      // 市場（左・拡大する棒）
      '<g class="hero-illust__market"><path d="M18 92h10v-14h-10z"/><path d="M34 92h10v-28h-10z"/><path d="M50 92h10v-44h-10z"/></g>' +
      // 変化の矢印
      '<path class="hero-illust__flow" d="M70 66 L108 66"/>' +
      '<path class="hero-illust__flow" d="M100 60 L110 66 L100 72"/>' +
      // 機会（中央・円 + theme グリフ）
      '<circle class="hero-illust__opp" cx="160" cy="60" r="34"/>' +
      '<g transform="translate(148,48) scale(0.85)" class="hero-illust__accent">' +
      accent +
      "</g>" +
      // 御社へ（右・矢印 + 建物）
      '<path class="hero-illust__flow" d="M204 66 L244 66"/>' +
      '<path class="hero-illust__flow" d="M236 60 L246 66 L236 72"/>' +
      '<g class="hero-illust__company"><rect x="258" y="48" width="44" height="44" rx="2"/><path d="M268 92V64h10v28M288 92V72h6v20"/></g>' +
      "</svg>"
    );
  }

  /**
   * First Action 用の 3 ステップ図（ステップ数に応じてドットを描く）。
   * @param {number} count
   * @returns {string}
   */
  function steps(count) {
    var n = Math.max(1, Math.min(3, count || 1));
    var dots = "";
    for (var i = 0; i < n; i++) {
      var x = 12 + i * 26;
      dots += '<circle cx="' + x + '" cy="12" r="4"/>';
      if (i < n - 1) dots += '<path d="M' + (x + 5) + ' 12 H' + (x + 21) + '"/>';
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

  return { glyph: glyph, hero: hero, steps: steps, THEMES: Object.keys(GLYPHS) };
});
