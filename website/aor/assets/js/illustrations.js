/*
 * illustrations.js — Phase56 STEP2（Hero Illustration V3.5 / Business Chance scenes）
 *
 * report-preview の Hero / セクション見出し / Benefit カードに使う inline SVG。
 *
 * 【原則】
 *  - 外部画像を一切読み込まない（inline SVG のみ）。AI 画像生成も使わない
 *  - deterministic（同じ theme なら常に同じ図）。乱数・時刻は使わない
 *  - Hero は抽象図形ではなく「何のチャンスか」が一目で分かる具体シーン
 *    （店舗 / 人物 / スマホ / チャート / ロボット / 地図 / 書類 など具象の組み合わせ）
 *  - 色は currentColor + SVG 内 <defs> の淡いグラデーション。CSS 変数でテーマ色を渡す
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

  // ---- 小さなグリフ（セクション見出し・Benefit カード用。24x24 stroke） --------
  var GLYPHS = {
    ai_dx: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/>',
    dx: '<rect x="3" y="4" width="18" height="13" rx="1"/><path d="M8 21h8M12 17v4M8 9l3 3-3 3M13 15h4"/>',
    new_business: '<path d="M12 20v-8"/><path d="M12 12c0-3 2-5 5-5 0 3-2 5-5 5z"/><path d="M12 12c0-3-2-5-5-5 0 3 2 5 5 5z"/><path d="M7 20h10"/>',
    overseas: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    subsidy_policy: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    hr: '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M3 20c0-3 2-5 5-5s5 2 5 5M13 20c0-3 2-5 5-5s3 2 3 5"/>',
    restaurant: '<path d="M6 3v8a2 2 0 0 0 4 0V3M8 11v10"/><path d="M17 3c-2 0-3 2-3 5s1 4 3 4v9"/>',
    retail: '<path d="M6 8h12l-1 12H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    manufacturing: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M4.2 7l2.6 1.5M17.2 15.5l2.6 1.5M4.2 17l2.6-1.5M17.2 8.5l2.6-1.5"/>',
    saas: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 9h18M7 13h4M7 15.5h7"/>',
    marketing: '<path d="M4 10v4l10 4V6z"/><path d="M14 8a4 4 0 0 1 0 8"/><path d="M6 14v4a1.5 1.5 0 0 0 3 0"/>',
    content_media: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/>',
    healthcare: '<path d="M12 21s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9z"/><path d="M12 8v6M9 11h6"/>',
    finance: '<path d="M4 19h16M6 19V9M11 19V5M16 19v-7M21 19V11"/>',
    sustainability: '<path d="M12 21c5-1 8-5 8-10 0-4-3-8-8-8-1 5 1 9 5 11-4 1-8-1-9-5-1 4 0 11 4 12z"/>',
    education: '<path d="M3 8l9-4 9 4-9 4z"/><path d="M7 10v5c0 1.5 2.5 3 5 3s5-1.5 5-3v-5M21 8v6"/>',
    logistics: '<path d="M2 7h11v9H2zM13 10h5l3 3v3h-8z"/><circle cx="6" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
    construction: '<path d="M4 21h16M6 21V10l6-4 6 4v11M10 21v-5h4v5"/>',
    agriculture: '<path d="M12 22V9M12 9c-1-3-4-4-6-4 0 3 2 6 6 6zM12 12c1-3 4-5 7-5 0 4-3 6-7 6z"/>',
    tourism: '<path d="M12 2l2 6h6l-5 4 2 7-5-4-5 4 2-7-5-4h6z"/>',
    generic_insight: '<path d="M4 20h16"/><path d="M7 20v-6M12 20V8M17 20v-10"/>',
    // Phase66 STEP6: Metrics の3指標インジケーター（節目の年）用。カレンダー+フラグ。
    milestone: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/><path d="M12 12v5l3-1.5z"/>',
    // Phase67 STEP15: Premium UI 共通アイコン（Emoji 不使用・SVG のみ）
    shield_check: '<path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
    building: '<path d="M4 21V6l8-3 8 3v15"/><path d="M4 21h16M9 9h2M13 9h2M9 13h2M13 13h2M9 17h2M13 17h2"/>',
    brain_circuit: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="7" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="14" r="1.2" fill="currentColor" stroke="none"/><circle cx="16" cy="14" r="1.2" fill="currentColor" stroke="none"/><path d="M12 7v2M8 14l2.5-2M16 14l-2.5-2"/>',
    line_chart: '<path d="M3 20h18"/><path d="M3 20V4"/><path d="M5 16l4-5 4 3 6-8"/>',
    rocket: '<path d="M12 2c3 2 5 6 4 11l-4 4-4-4c-1-5 1-9 4-11z"/><circle cx="12" cy="9" r="1.6"/><path d="M8.5 16.5L6 21l4.5-2M15.5 16.5L18 21l-4.5-2"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
    sparkles: '<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
    check_circle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9"/>',
    // Phase67 STEP2 STEP15: 追加アイコン（Dashboard / Network / Profile / Milestone / Stack）
    intelligence_dashboard:
      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M7 13v3M12 12v4M17 14v2"/>',
    market_network:
      '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="M6.6 7.2L10.6 11M17.4 7.2L13.4 11M6.6 16.8L10.6 13M17.4 16.8L13.4 13"/>',
    company_profile:
      '<rect x="3" y="10" width="7" height="11"/><path d="M10 21V5l8-2v18"/><path d="M6 14h1M6 17h1M14 8h1M14 12h1M14 16h1"/>',
    rocket_milestone:
      '<path d="M12 2c3 2 5 6 4 11l-4 4-4-4c-1-5 1-9 4-11z"/><circle cx="12" cy="9" r="1.6"/><path d="M3 21l4-1M21 21l-4-1"/>',
    evidence_stack:
      '<rect x="5" y="7" width="14" height="4" rx="1"/><rect x="5" y="13" width="14" height="4" rx="1"/><path d="M8 7V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>',
    // Phase68 STEP15: Locked カード用の Premium ロック（common.js の 🔒 絵文字置き換え）
    lock_premium:
      '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.4" fill="currentColor" stroke="none"/>',
    // Phase68 STEP15: CTA 矢印（→ テキストの代替として使える SVG）
    cta_arrow: '<path d="M5 12h14M13 5l7 7-7 7"/>',
  };
  var THEMES = Object.keys(GLYPHS);

  function glyph(theme, opts) {
    var o = opts || {};
    var size = o.size || 22;
    var cls = o.className ? ' class="' + o.className + '"' : "";
    var body = GLYPHS[theme] || GLYPHS.generic_insight;
    return (
      "<svg" +
      cls +
      ' width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      body +
      "</svg>"
    );
  }

  // ---- Hero シーンの共通パーツ（原点付近に描き、translate/scale で配置） -------
  // すべて stroke=currentColor / fill は surface か薄い currentColor。
  var SURFACE = 'var(--color-surface, #fff)';
  var P = {
    // 店舗（間口・庇・のれん）
    shop:
      '<path d="M2 20h30M4 20v-9h26v9" fill="' + SURFACE + '"/>' +
      '<path d="M2 11l3-6h24l3 6z" fill="' + SURFACE + '"/><path d="M2 11h30"/>' +
      '<rect x="8" y="13" width="7" height="7" fill="' + SURFACE + '"/><rect x="19" y="13" width="7" height="5" fill="' + SURFACE + '"/>',
    // 人物（頭・肩）
    person:
      '<circle cx="8" cy="6" r="4" fill="' + SURFACE + '"/><path d="M1 22c0-5 3-8 7-8s7 3 7 8" fill="' + SURFACE + '"/>',
    // スマホ
    phone:
      '<rect x="0" y="0" width="14" height="24" rx="2.5" fill="' + SURFACE + '"/><path d="M0 5h14M0 19h14"/><circle cx="7" cy="21.5" r="0.9" fill="currentColor" stroke="none"/>',
    // 上昇チャート
    chartUp:
      '<path d="M0 22h26M2 22V6"/><path d="M4 18l6-6 5 4 9-11" stroke-dasharray="0"/><path d="M24 5h4v4" />',
    // 棒グラフ
    bars:
      '<path d="M0 22h24"/><rect x="2" y="14" width="4" height="8" fill="currentColor" stroke="none" opacity="0.35"/><rect x="9" y="9" width="4" height="13" fill="currentColor" stroke="none" opacity="0.45"/><rect x="16" y="4" width="4" height="18" fill="currentColor" stroke="none" opacity="0.6"/>',
    // ロボット
    robot:
      '<rect x="2" y="6" width="20" height="16" rx="3" fill="' + SURFACE + '"/><circle cx="9" cy="13" r="2"/><circle cx="15" cy="13" r="2"/><path d="M9 18h6M12 6V2M12 2h-2M12 2h2"/>',
    // 吹き出し
    chat:
      '<path d="M1 3h20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-5 5v-5H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="' + SURFACE + '"/><path d="M6 8h12M6 12h8"/>',
    // 地球
    globe:
      '<circle cx="13" cy="13" r="13" fill="' + SURFACE + '"/><path d="M0 13h26M13 0c5 4 5 22 0 26M13 0c-5 4-5 22 0 26"/>',
    // 日本列島（ごく簡略）
    jp:
      '<path d="M4 3c3 1 3 5 6 6s2 5 5 7 1 5-2 6-6-1-8-4-3-6-4-9 2-11 5-13z" fill="' + SURFACE + '"/>',
    // コンテナ
    container:
      '<rect x="0" y="4" width="28" height="16" rx="1.5" fill="' + SURFACE + '"/><path d="M6 4v16M12 4v16M18 4v16M24 4v16"/>',
    // 書類
    doc:
      '<path d="M2 1h12l6 6v16H2z" fill="' + SURFACE + '"/><path d="M14 1v6h6M6 12h10M6 16h10M6 20h6"/>',
    // 印鑑
    stamp:
      '<rect x="3" y="16" width="14" height="4" rx="1" fill="' + SURFACE + '"/><path d="M8 16v-5a2 2 0 1 1 4 0v5" fill="' + SURFACE + '"/>',
    // コイン
    coin:
      '<ellipse cx="10" cy="10" rx="10" ry="4" fill="' + SURFACE + '"/><path d="M0 10v5c0 2.2 4.5 4 10 4s10-1.8 10-4v-5"/><path d="M10 8v4"/>',
    // 工場
    factory:
      '<path d="M0 22h30M2 22V10l7 4V10l7 4V6h12v16" fill="' + SURFACE + '"/><path d="M22 10h4M22 14h4M22 18h4"/>',
    // ロボットアーム
    arm:
      '<path d="M2 22h8M6 22V12M6 12l7-6M13 6l7 3" /><circle cx="6" cy="12" r="2" fill="' + SURFACE + '"/><circle cx="13" cy="6" r="2" fill="' + SURFACE + '"/><rect x="19" y="6" width="6" height="5" rx="1" fill="' + SURFACE + '"/>',
    // ダッシュボード
    dashboard:
      '<rect x="0" y="0" width="30" height="22" rx="2.5" fill="' + SURFACE + '"/><path d="M0 6h30"/><rect x="4" y="10" width="9" height="8" rx="1"/><path d="M17 11h9M17 14h9M17 17h6"/>',
    // カート
    cart:
      '<path d="M0 2h4l3 14h14l3-9H6" fill="none"/><circle cx="9" cy="21" r="2"/><circle cx="19" cy="21" r="2"/>',
    // 皿＋フォーク
    plate:
      '<circle cx="12" cy="12" r="10" fill="' + SURFACE + '"/><circle cx="12" cy="12" r="5"/>',
    // ハート（医療・信頼）
    heart:
      '<path d="M12 21S3 15 3 8.5A5.5 5.5 0 0 1 12 4a5.5 5.5 0 0 1 9 4.5C21 15 12 21 12 21z" fill="' + SURFACE + '"/><path d="M7 11h3l1.5-3 2 5 1.5-2h3"/>',
    // 芽（サステナ・農業）
    sprout:
      '<path d="M10 22V10M10 10C10 6 7 4 3 4c0 4 3 6 7 6zM10 12c0-3 3-5 7-5 0 3-3 5-7 5z" fill="' + SURFACE + '"/>',
    // 帽子（教育）
    cap:
      '<path d="M0 7l13-5 13 5-13 5z" fill="' + SURFACE + '"/><path d="M6 10v6c0 1.8 3.1 3 7 3s7-1.2 7-3v-6M24 8v6"/>',
    // 建物（建設・建築）
    building:
      '<path d="M2 22h24M5 22V4h12v18M17 22V9h6v13" fill="' + SURFACE + '"/><path d="M8 8h2M13 8h2M8 12h2M13 12h2M8 16h2M13 16h2M19 13h2M19 17h2"/>',
    // トラック
    truck:
      '<path d="M0 4h16v12H0zM16 8h6l4 4v4h-10z" fill="' + SURFACE + '"/><circle cx="6" cy="19" r="2.4"/><circle cx="20" cy="19" r="2.4"/>',
    // キャッシュレス端末
    pos:
      '<rect x="2" y="0" width="16" height="22" rx="2" fill="' + SURFACE + '"/><path d="M2 6h16"/><rect x="5" y="9" width="10" height="5" rx="1"/><path d="M6 18h8"/>',
    // 温泉マーク（観光）
    onsen:
      '<path d="M0 22h24" /><path d="M2 22v-8h20v8" fill="' + SURFACE + '"/><path d="M7 11c0-3-2-3-2-5s2-2 2-4M12 11c0-3-2-3-2-5s2-2 2-4M17 11c0-3-2-3-2-5s2-2 2-4"/>',
    // API 接続
    api:
      '<circle cx="5" cy="12" r="4" fill="' + SURFACE + '"/><circle cx="21" cy="12" r="4" fill="' + SURFACE + '"/><path d="M9 12h8M13 8l4 4-4 4"/>',
  };

  function place(prop, x, y, scale, cls) {
    return (
      '<g transform="translate(' + x + "," + y + ") scale(" + (scale || 1) + ')"' +
      (cls ? ' class="' + cls + '"' : "") + ">" + (P[prop] || "") + "</g>"
    );
  }

  // theme → シーン構成（parts の配列）。存在しない theme は generic_insight。
  var SCENES = {
    ai_dx: [["robot", 40, 96, 2.1, "hi-a"], ["dashboard", 150, 78, 1.5, "hi-b"], ["chat", 176, 150, 1.5, "hi-c"], ["bars", 44, 168, 1.4, "hi-c"]],
    dx: [["dashboard", 44, 84, 2.3, "hi-a"], ["chartUp", 168, 96, 1.9, "hi-b"], ["phone", 214, 150, 1.2, "hi-c"]],
    saas: [["dashboard", 40, 80, 2.4, "hi-a"], ["api", 176, 150, 1.7, "hi-b"], ["chartUp", 168, 78, 1.5, "hi-c"]],
    new_business: [["chartUp", 44, 84, 2.5, "hi-a"], ["person", 190, 120, 2.0, "hi-b"], ["bars", 176, 168, 1.4, "hi-c"]],
    overseas: [["jp", 44, 90, 3.0, "hi-a"], ["globe", 150, 78, 2.2, "hi-b"], ["container", 150, 168, 1.7, "hi-c"]],
    content_media: [["dashboard", 44, 82, 2.2, "hi-a"], ["chat", 176, 78, 1.6, "hi-b"], ["person", 60, 150, 1.8, "hi-c"]],
    subsidy_policy: [["doc", 52, 78, 2.4, "hi-a"], ["stamp", 176, 96, 2.0, "hi-b"], ["coin", 168, 170, 1.7, "hi-c"]],
    hr: [["person", 48, 96, 2.3, "hi-a"], ["person", 132, 108, 2.1, "hi-b"], ["person", 210, 100, 2.3, "hi-c"], ["chartUp", 150, 176, 1.2, "hi-c"]],
    restaurant: [["shop", 40, 78, 2.5, "hi-a"], ["phone", 214, 120, 1.3, "hi-b"], ["plate", 176, 160, 1.7, "hi-c"]],
    retail: [["shop", 40, 78, 2.3, "hi-a"], ["cart", 180, 110, 1.9, "hi-b"], ["phone", 232, 150, 1.1, "hi-c"]],
    manufacturing: [["factory", 40, 84, 2.3, "hi-a"], ["arm", 176, 100, 2.0, "hi-b"], ["bars", 176, 176, 1.3, "hi-c"]],
    marketing: [["chat", 44, 82, 2.0, "hi-a"], ["chartUp", 168, 92, 1.9, "hi-b"], ["phone", 214, 150, 1.2, "hi-c"], ["person", 60, 156, 1.6, "hi-c"]],
    healthcare: [["heart", 44, 84, 2.6, "hi-a"], ["person", 190, 110, 2.0, "hi-b"], ["doc", 176, 160, 1.4, "hi-c"]],
    finance: [["coin", 44, 100, 2.4, "hi-a"], ["chartUp", 160, 88, 1.9, "hi-b"], ["bars", 168, 168, 1.4, "hi-c"]],
    sustainability: [["sprout", 48, 84, 2.7, "hi-a"], ["factory", 168, 92, 1.7, "hi-b"], ["chartUp", 176, 172, 1.2, "hi-c"]],
    education: [["cap", 44, 92, 2.6, "hi-a"], ["person", 190, 116, 2.0, "hi-b"], ["dashboard", 160, 166, 1.3, "hi-c"]],
    logistics: [["truck", 40, 96, 2.4, "hi-a"], ["container", 168, 88, 1.7, "hi-b"], ["dashboard", 170, 168, 1.3, "hi-c"]],
    construction: [["building", 40, 76, 2.5, "hi-a"], ["doc", 200, 110, 1.5, "hi-b"], ["person", 210, 168, 1.5, "hi-c"]],
    agriculture: [["sprout", 44, 84, 2.9, "hi-a"], ["truck", 168, 120, 1.6, "hi-b"], ["dashboard", 168, 172, 1.2, "hi-c"]],
    tourism: [["onsen", 44, 92, 2.4, "hi-a"], ["globe", 170, 84, 1.7, "hi-b"], ["phone", 224, 150, 1.2, "hi-c"]],
    generic_insight: [["chartUp", 44, 88, 2.6, "hi-a"], ["dashboard", 160, 80, 1.6, "hi-b"], ["person", 200, 150, 1.7, "hi-c"]],
  };

  // Phase67 STEP4: Business Intelligence 背景レイヤー（建物のシルエット・AIノード＋接続線・
  // 円形チャート・光るポイント）。deterministic な固定レイアウト（乱数・時刻は使わない）。
  // 既存の業種別シーン（SCENES）の背後に重ね、テーマの具象性は保ったまま高級感を足す。
  function biBackdrop() {
    var nodes = [
      [40, 40], [96, 26], [230, 34], [268, 66], [30, 150], [258, 168], [60, 208], [220, 210],
    ];
    var links = [
      [0, 1], [1, 2], [2, 3], [0, 4], [3, 5], [4, 6], [5, 7], [1, 4], [2, 5],
    ];
    var lines = links
      .map(function (l) {
        var a = nodes[l[0]], b = nodes[l[1]];
        return '<line class="hi-bi__link" x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '"/>';
      })
      .join("");
    var dots = nodes
      .map(function (n, i) {
        var r = i % 3 === 0 ? 3 : 2;
        return '<circle class="hi-bi__node" cx="' + n[0] + '" cy="' + n[1] + '" r="' + r + '" fill="currentColor" stroke="none"/>';
      })
      .join("");
    var glow = [[96, 26], [230, 34], [30, 150], [220, 210]]
      .map(function (n) {
        return '<circle class="hi-bi__glow" cx="' + n[0] + '" cy="' + n[1] + '" r="9" fill="currentColor" stroke="none"/>';
      })
      .join("");
    return (
      '<g class="hi-bi" aria-hidden="true">' +
      '<circle class="hi-bi__ring" cx="150" cy="120" r="86" stroke-dasharray="4 7"/>' +
      '<circle class="hi-bi__ring hi-bi__ring--chart" cx="150" cy="120" r="70" stroke-dasharray="130 350"/>' +
      lines +
      dots +
      glow +
      "</g>"
    );
  }

  /**
   * Hero 用の大型シーン。theme のオブジェクトを配置した具体イラスト。
   * 背景に Business Intelligence レイヤー（ノード網・円形チャート・光点）、
   * 前景に業種別の具体シーン（建物・人物・チャート等）を重ねる。
   * @param {string} theme
   * @returns {string}
   */
  function hero(theme) {
    var parts = SCENES[theme] || SCENES.generic_insight;
    var scene = parts.map(function (p) { return place(p[0], p[1], p[2], p[3], p[4]); }).join("");
    return (
      '<svg class="hero-illust__svg" viewBox="0 0 300 240" fill="none" ' +
      'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' +
      "<defs>" +
      '<linearGradient id="hiBg" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="currentColor" stop-opacity="0.14"/>' +
      '<stop offset="1" stop-color="currentColor" stop-opacity="0.03"/>' +
      "</linearGradient>" +
      "</defs>" +
      '<rect x="10" y="14" width="280" height="212" rx="22" fill="url(#hiBg)" stroke="none"/>' +
      '<ellipse class="hi-shadow" cx="150" cy="214" rx="120" ry="10" fill="currentColor" stroke="none" opacity="0.06"/>' +
      biBackdrop() +
      scene +
      "</svg>"
    );
  }

  function steps(count) {
    var n = Math.max(1, Math.min(3, count || 1));
    var dots = "";
    for (var i = 0; i < n; i++) {
      var x = 12 + i * 26;
      dots += '<circle cx="' + x + '" cy="12" r="4"/>';
      if (i < n - 1) dots += '<path d="M' + (x + 5) + " 12 H" + (x + 21) + '"/>';
    }
    return (
      '<svg width="' + (12 + n * 26) + '" height="24" viewBox="0 0 ' + (12 + n * 26) + ' 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true" focusable="false">' +
      dots +
      "</svg>"
    );
  }

  return { glyph: glyph, hero: hero, steps: steps, THEMES: THEMES, SCENE_THEMES: Object.keys(SCENES) };
});
