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

  // ---------------------------------------------------------------------------
  // Market Snapshot 並べ替え（Phase56 STEP2: 地域 > 業界 > 補助金 > 日本 > 世界）
  // shared/report-teaser.js の rerankMarketStats と同一ロジック（parity テストあり）。
  // ---------------------------------------------------------------------------
  var WORLD_RE = /(米ドル|USドル|US\$|世界|グローバル|global)/i;
  var LOCAL_RE = /(地域|商店街|市内|県内|近隣|エリア|沿線|地元|自治体|市区町村)/;
  var INDUSTRY_RE = /(業界|業種|同業|市場調査|需要|導入率|活用率|来店|客数|口コミ|予約)/;
  var SUBSIDY_RE = /(補助|助成|給付|交付|公募)/;
  var JP_RE = /(国内|日本|全国)/;

  function statTier(stat) {
    var s = (stat.label || "") + " " + (stat.value || "");
    if (WORLD_RE.test(s)) return 4;
    if (LOCAL_RE.test(s)) return 0;
    if (INDUSTRY_RE.test(s)) return 1;
    if (SUBSIDY_RE.test(s)) return 2;
    if (JP_RE.test(s)) return 3;
    return 1.5;
  }

  function rerankMarketStats(stats) {
    var arr = (stats || []).map(function (s, i) {
      var tier = statTier(s);
      return Object.assign({}, s, { tier: tier, isWorld: tier >= 4, _i: i });
    });
    var kindRank = { size: 0, growth: 1, multiple: 1, cagr: 1, money: 2, percent: 2, milestone: 3, year: 5 };
    arr.sort(function (a, b) {
      if (a.tier !== b.tier) return a.tier - b.tier;
      var ka = kindRank[a.kind] == null ? 4 : kindRank[a.kind];
      var kb = kindRank[b.kind] == null ? 4 : kindRank[b.kind];
      return ka - kb || a._i - b._i;
    });
    return arr.map(function (s) {
      var out = Object.assign({}, s);
      delete out._i;
      return out;
    });
  }

  /**
   * @param {Object} report - published JSON
   * @returns {"A"|"B"}
   */
  function pickHeroVariant(report) {
    var fo = (report && report.free_opportunity) || {};
    var ea = fo.extended_analysis || {};
    var all = extractMarketNumbers([fo.why_now, fo.market_change, ea.market_size], {
      max: 30,
      maxPerKind: 30,
    });
    var local = rerankMarketStats(all);
    var momentum = local.filter(function (n) {
      return (n.kind === "size" || n.kind === "growth" || n.kind === "multiple" || n.kind === "cagr") && !n.isWorld;
    }).length;
    if (momentum < 2) return "A";
    // B は「日本の会社にとって信じられる規模感」＝世界市場でない・円建ての数値が先頭
    var rank = { size: 0, growth: 1, multiple: 1, cagr: 1 };
    var top = local
      .filter(function (n) {
        return !n.isWorld;
      })
      .slice()
      .sort(function (a, b) {
        return (rank[a.kind] == null ? 5 : rank[a.kind]) - (rank[b.kind] == null ? 5 : rank[b.kind]);
      })[0];
    var topIsYen = top && /円/.test(top.value) && !/ドル/.test(top.value);
    return topIsYen ? "B" : "A";
  }

  // --- 宛名（Phase56 STEP2 GOAL-1）: shared/report-teaser.js の salutation と同一 ---
  function salutation(name) {
    var n = String(name || "").trim();
    if (!n) return "ご担当者様";
    if (/^[a-z0-9][a-z0-9.\-_]*\.[a-z]{2,}$/i.test(n) || !/[ぁ-んァ-ヶ一-龠A-Za-z]/.test(n)) {
      return "ご担当者様";
    }
    return n + " 経営者様";
  }

  // --- 「一言でいうと」: shared/report-teaser.js の oneLineSummary と同一 ---
  function oneLineSummary(title) {
    var t = String(title || "").trim().replace(/（src-\d+[^）]*）/g, "");
    if (!t) return "";
    var m = t.match(/^(.*?)(の立ち上げ|の提供|の展開|の構築|の開発|の商品化|の体系化と展開|の導入|の強化|の拡大)$/);
    var core = m ? m[1] : t.replace(/。$/, "");
    if (core.length > 34) {
      var comma = core.slice(0, 34).lastIndexOf("・");
      core = comma > 12 ? core.slice(0, comma) : core.slice(0, 34);
    }
    var verb = m ? "を始めるチャンスがあります。" : "に取り組むチャンスがあります。";
    return core + verb;
  }

  // --- 期待できること: shared/report-teaser.js の expectedBenefit と同一 ---
  var BENEFIT_HINTS = [
    ["売上", /(売上|収益|客単価|単価|LTV|購入額|受注)/],
    ["集客", /(集客|新規顧客|来店|問い合わせ|リード|認知|流入|予約)/],
    ["リピート", /(リピート|再来|継続|定着|会員|ファン|定期)/],
    ["採用・定着", /(採用|人材確保|離職|定着|応募)/],
    ["利益率", /(利益|粗利|コスト削減|原価|マージン)/],
    ["業務効率", /(効率化|工数|時間短縮|自動化|省力|生産性)/],
  ];
  function expectedBenefit(report) {
    var fo = (report && report.free_opportunity) || {};
    var ea = fo.extended_analysis || {};
    var hay = [ea.priority, fo.market_change, fo.why_company, fo.why_now, fo.title].map(String).join(" ");
    var hits = [];
    for (var i = 0; i < BENEFIT_HINTS.length; i++) {
      if (BENEFIT_HINTS[i][1].test(hay) && hits.indexOf(BENEFIT_HINTS[i][0]) === -1) hits.push(BENEFIT_HINTS[i][0]);
      if (hits.length >= 2) break;
    }
    if (!hits.length) hits.push("業務効率");
    return hits;
  }

  // ---------------------------------------------------------------------------
  // Visual theme（deterministic。存在する asset にしか割り当てない）
  // ---------------------------------------------------------------------------

  // NOTE: Phase56 STEP3 のイラストは 20 テーマへ拡張したが（illustrations.js の THEMES）、
  // pickVisualTheme が返す集合（KNOWN_THEMES）は email 側 shared/report-teaser.js と parity を
  // 保つため 12 のまま。新ドメイン（healthcare/finance/... のルーティング）は両者同時に
  // 拡張する別 STEP で行う。ここで返さないテーマのグリフは「将来のための予備」。
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

  /**
   * why_company を Hero サブコピー用に 1〜2 文へ短縮する（src-N は落とす）。
   * @param {string} whyCompany
   * @returns {string}
   */
  function heroSubcopy(whyCompany) {
    var t = String(whyCompany || "").replace(/（src-\d+[^）]*）/g, "").replace(/\s+/g, "").trim();
    if (!t) return "";
    var sentences = t.split(/(?<=。)/).filter(Boolean);
    var out = sentences.slice(0, 2).join("");
    return out || t.slice(0, 120);
  }

  /**
   * 1文を句点までに切り詰める（src-N を落とす。maxLen 超過時は「…」）。
   * @param {string} text @param {number} [maxLen]
   * @returns {string}
   */
  function summarizeSentence(text, maxLen) {
    var lim = maxLen || 110;
    var t = String(text || "").replace(/（src-\d+[^）]*）/g, "").replace(/\s+/g, "").trim();
    if (!t) return "";
    var first = (t.match(/^[\s\S]*?。/) || [t])[0];
    if (first.length <= lim) return first;
    return t.slice(0, lim).replace(/[、。]?$/, "") + "…";
  }

  /**
   * Hero 直下の Benefit カード3枚（なぜ今 / なぜ御社 / 今日できること）の view model。
   * 各テキストは published JSON から機械抽出のみ。
   * @param {Object} report
   * @returns {Array<{key:string, label:string, text:string}>}
   */
  function benefitCards(report) {
    var fo = (report && report.free_opportunity) || {};
    var cards = [
      { key: "why_now", label: "なぜ今なのか", text: summarizeSentence(fo.why_now, 120) },
      { key: "why_company", label: "なぜ御社なのか", text: summarizeSentence(fo.why_company, 120) },
      { key: "first_action", label: "今日からできる一歩", text: summarizeSentence(fo.first_action, 120) },
    ];
    return cards.filter(function (c) {
      return c.text && c.text.length > 0;
    });
  }

  // ---------------------------------------------------------------------------
  // Market Snapshot（数字カード + 比較バー + タイムライン用の年）
  // ---------------------------------------------------------------------------

  /**
   * @param {Object} report
   * @returns {{stats:Array, hasComparison:boolean, multiple:(Object|undefined), years:string[], worldOnly:boolean}}
   */
  function marketSnapshot(report) {
    var fo = (report && report.free_opportunity) || {};
    var ea = fo.extended_analysis || {};
    var text = [fo.why_now, fo.market_change, ea.market_size];
    // Phase56 STEP2: 経営者に近い順（地域>業界>補助金>日本>世界）。世界市場は末尾。
    var ranked = rerankMarketStats(extractMarketNumbers(text, { max: 8, maxPerKind: 2 }));
    var worldOnly = ranked.length > 0 && ranked.every(function (s) { return s.isWorld; });
    var stats = ranked.slice(0, 4).map(function (s) {
      return { value: s.value, kind: s.kind, label: s.label, sourceId: s.sourceId || null, isWorld: !!s.isWorld, worldOnly: worldOnly };
    });
    var withYears = extractMarketNumbers(text, { max: 30, maxPerKind: 30, includeYears: true });
    var years = withYears
      .filter(function (n) {
        return n.kind === "year" || n.kind === "milestone";
      })
      .map(function (n) {
        var m = String(n.value).match(/(19|20)\d{2}/);
        return m ? m[0] : null;
      })
      .filter(Boolean);
    // 重複除去 + 昇順
    var uniqYears = years
      .filter(function (y, i) {
        return years.indexOf(y) === i;
      })
      .sort()
      .slice(0, 4);
    var multiple = stats.filter(function (s) {
      return s.kind === "multiple";
    })[0];
    var momentum = countMarketMomentum(stats.filter(function (s) { return !s.isWorld; }));
    return {
      stats: stats,
      hasComparison: !!multiple,
      multiple: multiple,
      years: uniqYears,
      hasMomentum: momentum >= 2,
      worldOnly: worldOnly,
    };
  }

  // ---------------------------------------------------------------------------
  // Trust / Micro Proof（CTA 直前）
  // ---------------------------------------------------------------------------

  function trustItems(report) {
    var approved = ((report && report.human_review) || {}).status === "approved";
    return [
      { key: "no_signup", label: "登録不要" },
      { key: "free", label: "無料で閲覧" },
      { key: "reviewed", label: approved ? "人間が確認済み" : "運営がレビュー中" },
      { key: "unsub", label: "配信はいつでも停止可" },
    ];
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
    heroSubcopy: heroSubcopy,
    summarizeSentence: summarizeSentence,
    benefitCards: benefitCards,
    marketSnapshot: marketSnapshot,
    trustItems: trustItems,
    salutation: salutation,
    oneLineSummary: oneLineSummary,
    expectedBenefit: expectedBenefit,
    rerankMarketStats: rerankMarketStats,
  };
});
