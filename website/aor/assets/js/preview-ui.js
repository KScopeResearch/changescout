/*
 * preview-ui.js — Phase55 STEP3
 *
 * report-preview の描画に使う「pure な view model 変換」を集約する。
 * DOM を触らない・fetch しない・LLM/API を呼ばない・乱数を使わない
 * （同じ report なら常に同じ結果）。
 *
 * UMD: ブラウザ（<script>）と Node（テスト）の両方で使える。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      typeof require === "function" ? require("./market-stats.js") : root.MarketStats
    );
  } else {
    root.PreviewUI = factory(root.MarketStats);
  }
})(typeof self !== "undefined" ? self : this, function (MarketStats) {
  "use strict";

  var extractMarketNumbers = (MarketStats && MarketStats.extractMarketNumbers) || function () {
    return [];
  };
  var countMarketMomentum = (MarketStats && MarketStats.countMarketMomentum) || function () {
    return 0;
  };

  // ---------------------------------------------------------------------------
  // Hero variant（Phase55 STEP2: A=営業提案書 / B=市場インサイト / C=AIアナリスト）
  // ---------------------------------------------------------------------------

  /**
   * @param {Object} report - published JSON
   * @returns {"A"|"B"}  ※ C は「明確な自動判定条件が無い」ため STEP3 では採用しない（STEP2 §49）
   */
  function pickHeroVariant(report) {
    var fo = (report && report.free_opportunity) || {};
    var ea = fo.extended_analysis || {};
    var all = extractMarketNumbers([fo.why_now, fo.market_change, ea.market_size], {
      max: 30,
      maxPerKind: 30,
    });
    if (countMarketMomentum(all) < 2) return "A";
    // B は「日本の会社にとって信じられる規模感」であること＝先頭の数値が円建て
    var top = all
      .slice()
      .sort(function (a, b) {
        var rank = { size: 0, growth: 1, multiple: 1, cagr: 1 };
        return (rank[a.kind] == null ? 5 : rank[a.kind]) - (rank[b.kind] == null ? 5 : rank[b.kind]);
      })[0];
    var topIsYen = top && /円/.test(top.value) && !/ドル/.test(top.value);
    return topIsYen ? "B" : "A";
  }

  // ---------------------------------------------------------------------------
  // Visual theme（deterministic。存在する asset にしか割り当てない）
  // ---------------------------------------------------------------------------

  var THEME_RULES = [
    ["overseas", /(海外|中国|グローバル|越境|輸出|インバウンド|日中|ローカライズ)/],
    ["content_media", /(アニメ|映像|コンテンツ|IP|ゲーム|メディア|放送|配信|エンタメ)/],
    ["ai_dx", /(生成AI|AI活用|AI導入|\bAI\b|ＡＩ|DX|デジタル化|業務効率|自動化)/],
    ["subsidy_policy", /(補助金|助成金|政策|制度|公募|IP360|クールジャパン|白書)/],
    ["new_business", /(新規事業|事業開発|インキュベーション|立ち上げ|新サービス|事業再生)/],
    ["hr", /(人材|採用|人手不足|育成|研修|離職|労働力|省人化)/],
    ["restaurant", /(飲食|レストラン|美容室|サロン|店舗|外食|ネイル)/],
    ["retail", /(小売|EC|通販|物販|流通|卸)/],
    ["manufacturing", /(製造|工場|生産|加工|部品)/],
    ["saas", /(SaaS|プラットフォーム|システム開発|ソフトウェア|クラウド)/],
    ["marketing", /(マーケティング|集客|広告|ブランディング|プロモーション)/],
  ];

  var KNOWN_THEMES = THEME_RULES.map(function (r) {
    return r[0];
  }).concat(["generic_insight"]);

  /**
   * @param {Object} report
   * @returns {string} THEME_RULES のいずれか、または "generic_insight"
   */
  function pickVisualTheme(report) {
    var cp = (report && report.company_profile) || {};
    var fo = (report && report.free_opportunity) || {};
    // 優先度: Opportunity title → industry_label → market_change の順で見る
    var title = String(fo.title || "");
    var industry = String(cp.industry_label || "");
    var mc = String(fo.market_change || "");
    for (var i = 0; i < THEME_RULES.length; i++) {
      if (THEME_RULES[i][1].test(title)) return THEME_RULES[i][0];
    }
    for (var j = 0; j < THEME_RULES.length; j++) {
      if (THEME_RULES[j][1].test(industry)) return THEME_RULES[j][0];
    }
    for (var k = 0; k < THEME_RULES.length; k++) {
      if (THEME_RULES[k][1].test(mc)) return THEME_RULES[k][0];
    }
    return "generic_insight";
  }

  // ---------------------------------------------------------------------------
  // Opportunity view model
  // ---------------------------------------------------------------------------

  var FORWARD_VERB_RE = /(の立ち上げ|の提供|の開発|の展開|の構築|の体系化|化)$/;

  /**
   * Opportunity title を Hero 用の平叙文（「〜できます」）へ機械変換する。
   * LLM は使わない。変換できない場合は title をそのまま返す。
   * @param {string} title
   * @returns {string}
   */
  function opportunityHeadline(title) {
    var t = String(title || "").trim();
    if (!t) return "";
    // 「XXXの立ち上げ」→「XXXを、新しい一手にできます。」
    var m = t.match(/^(.*?)(の立ち上げ|の提供|の開発|の展開|の構築|の体系化と展開|の商品化)$/);
    if (m) {
      return m[1] + "に、御社が取り組める余地があります。";
    }
    return t;
  }

  /**
   * confidence_note から「高/中/低」と留保を1行に要約する。
   * @param {string} note
   * @returns {{level:string, caveat:string}}
   */
  function confidenceLine(note) {
    var n = String(note || "");
    var level = "中";
    if (/確度が高い|信頼度が高い|確実性が高い/.test(n)) level = "高";
    if (/確度は低い|限定的|推測の域|不確実性が高い/.test(n)) level = "低";
    var caveat = "";
    var cm = n.match(/([^。]*?(追加調査が必要|今後更新される可能性|異なる可能性|最新の情報を確認)[^。]*)。?/);
    if (cm) caveat = cm[1].replace(/^本分析は[^、]*、?/, "").replace(/^、/, "").trim();
    return { level: level, caveat: caveat };
  }

  /**
   * extended_analysis.priority から「見込まれるインパクト」を1〜2文に短縮する。
   * @param {string} priority
   * @returns {string}
   */
  function expectedImpact(priority) {
    var p = String(priority || "").trim();
    if (!p) return "";
    var sentences = p.split(/(?<=。)/).filter(Boolean);
    return sentences.slice(0, 2).join("").trim();
  }

  /**
   * @param {Object} report
   * @param {Object} [opts]
   * @returns {Object} Opportunity カードの view model
   */
  function buildOpportunityViewModel(report, opts) {
    var fo = (report && report.free_opportunity) || {};
    var ea = fo.extended_analysis || {};
    var stats = extractMarketNumbers([fo.why_now, fo.market_change, ea.market_size], opts || {});
    return {
      title: String(fo.title || ""),
      headline: opportunityHeadline(fo.title),
      whyNow: String(fo.why_now || ""),
      whyCompany: String(fo.why_company || ""),
      marketChange: String(fo.market_change || ""),
      impact: expectedImpact(ea.priority),
      confidence: confidenceLine(ea.confidence_note),
      stats: stats,
      evidenceCount: Array.isArray(fo.evidence) ? fo.evidence.length : 0,
    };
  }

  // ---------------------------------------------------------------------------
  // First Action view model（1文を「調べる→比較する→試す」の step へ緩く分割）
  // ---------------------------------------------------------------------------

  /**
   * @param {string} firstAction
   * @returns {string[]}  1〜3 ステップ。無理に3分割しない。
   */
  function buildFirstActionViewModel(firstAction) {
    var a = String(firstAction || "").trim();
    if (!a) return [];
    // 「〜し、〜する」「〜した上で、〜」等の接続で最大3分割
    var parts = a
      .split(/(?:した上で、|したうえで、|し、(?=[^、]{6,})|してから、|、その上で、|。)/)
      .map(function (s) {
        return s.trim().replace(/[、。]$/, "");
      })
      .filter(function (s) {
        return s.length >= 4;
      });
    if (parts.length <= 1) return [a.replace(/。$/, "")];
    return parts.slice(0, 3).map(function (s, i) {
      // 末尾を「〜する」に整える（体言止め/連用形は最小限のみ）
      return s;
    });
  }

  // ---------------------------------------------------------------------------
  // Human Review line
  // ---------------------------------------------------------------------------

  /**
   * @param {Object} report
   * @returns {{approved:boolean, line:string}}
   */
  function humanReviewLine(report) {
    var hr = (report && report.human_review) || {};
    var approved = hr.status === "approved";
    if (!approved) {
      return { approved: false, line: "内容を運営がレビュー中です" };
    }
    var when = "";
    var d = hr.reviewed_at ? new Date(hr.reviewed_at) : null;
    if (d && !isNaN(d.getTime())) {
      when = d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日、";
    }
    return {
      approved: true,
      line: when + "運営がこのレポートの内容と出典を確認しました",
    };
  }

  // ---------------------------------------------------------------------------
  // Sources のカテゴリ分け（既存 metadata の source_type のみを使う。生成しない）
  // ---------------------------------------------------------------------------

  var SOURCE_CATEGORY = {
    company: { key: "company", label: "企業情報" },
    government: { key: "policy", label: "政府・制度" },
    statistics: { key: "stats", label: "統計・市場データ" },
    industry_association: { key: "industry", label: "業界動向" },
    technology: { key: "industry", label: "業界動向" },
    news: { key: "news", label: "報道" },
    directory: { key: "other", label: "その他" },
    review: { key: "other", label: "その他" },
  };
  var SOURCE_CATEGORY_ORDER = ["stats", "policy", "industry", "company", "news", "other"];

  /**
   * @param {Array<Object>} sourcePages - top_sources または source_pages
   * @returns {Array<{key:string, label:string, items:Array<Object>}>}
   */
  function categorizeSources(sourcePages) {
    var buckets = {};
    (sourcePages || []).forEach(function (sp) {
      var cat = SOURCE_CATEGORY[sp.source_type] || { key: "other", label: "その他" };
      if (!buckets[cat.key]) buckets[cat.key] = { key: cat.key, label: cat.label, items: [] };
      buckets[cat.key].items.push(sp);
    });
    return SOURCE_CATEGORY_ORDER.filter(function (k) {
      return buckets[k];
    }).map(function (k) {
      return buckets[k];
    });
  }

  return {
    pickHeroVariant: pickHeroVariant,
    pickVisualTheme: pickVisualTheme,
    KNOWN_THEMES: KNOWN_THEMES,
    opportunityHeadline: opportunityHeadline,
    confidenceLine: confidenceLine,
    expectedImpact: expectedImpact,
    buildOpportunityViewModel: buildOpportunityViewModel,
    buildFirstActionViewModel: buildFirstActionViewModel,
    humanReviewLine: humanReviewLine,
    categorizeSources: categorizeSources,
  };
});
