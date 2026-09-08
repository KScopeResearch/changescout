/*
 * market-numbers.js — Phase55 STEP4（canonical / CommonJS）
 *
 * why_now / market_change / market_size に literal に出現する数値だけを正規表現で抽出する。
 * ブラウザ版 website/aor/assets/js/market-stats.js と同一ロジック（parity は
 * scripts/generator/test/market-numbers-parity.test.js が保証する）。
 *
 * 【厳守】数字を作らない・推測しない・丸めない。LLM/API は呼ばない。
 * Lambda bundle は website/ を含まないため、送信側（email-teaser.js）はこちらを使う。
 */
"use strict";

  // 金額（兆・億・万の複合と、円 / 米ドル を扱う。小数も許容）
  var MONEY_RE =
    /約?\s*\d[\d,，.]*(?:\s*兆\s*\d[\d,，.]*)?(?:\s*億\s*\d[\d,，.]*)?(?:\s*万\s*\d[\d,，.]*)?\s*(?:兆|億|万)?\s*(?:米ドル|USドル|US\$|ドル|円)/g;
  var CAGR_RE = /CAGR\s*[＋+]?\s*\d+(?:\.\d+)?\s*[%％]?/g;
  var MULTIPLE_RE = /約?\s*\d+(?:\.\d+)?\s*倍/g;
  var PERCENT_RE = /[＋+]?\s*\d+(?:\.\d+)?\s*[%％]|\d+(?:\.\d+)?\s*割(?:半ば|強|弱)?/g;
  var YEAR_RE = /(?:19|20)\d{2}\s*年(?:度)?/g;

  var PATTERNS = [
    { kind: "cagr", re: CAGR_RE },
    { kind: "multiple", re: MULTIPLE_RE },
    { kind: "money", re: MONEY_RE },
    { kind: "percent", re: PERCENT_RE },
    { kind: "year", re: YEAR_RE },
  ];

  var SIZE_HINT = /(市場規模|市場は|市場が|市場を|市場全体|市場、|海外市場|海外分野|海外売上|規模|売上|産業市場|サービス市場)/;
  var GROWTH_HINT = /(成長|拡大|増加|増と|伸び|前年比|過去最高|突破|上昇|急増|急速|2桁成長|牽引)/;
  var POLICY_HINT = /(補助金|助成金|制度|政策|公募|目標|創設|拡充|IP360|クールジャパン|JLOX|白書|警告)/;

  // 出力の優先度（Hero variant 判定・上位N件の選抜に使う）
  var KIND_RANK = { size: 0, growth: 1, multiple: 1, cagr: 1, money: 2, percent: 3, milestone: 4, year: 9 };

  var GENERIC_LABEL = {
    size: "市場規模",
    growth: "成長率",
    cagr: "年平均成長率(CAGR)",
    multiple: "拡大幅",
    money: "金額",
    percent: "割合",
    milestone: "節目の年",
    year: "年",
  };

  // 「〇〇市場」「〇〇の成長率」などの名詞句をラベルとして拾う。
  var NOUN_LABEL_RE =
    /([一-龠ァ-ヶーA-Za-z0-9]{2,12})(市場規模|市場全体|市場|規模|売上|成長率|需要|投資額|補助|助成|事業者|導入率|活用率)/g;
  var BAD_LABEL_RE = /(兆|億|万|米ドル|ドル|円|%|％|\d{3,})/;

  /**
   * value の周辺から短いラベル（〜16字）を作る。名詞句が拾えればそれ、
   * 拾えなければ kind に応じた汎用ラベル。
   * @param {string} text @param {number} start @param {number} end @param {string} kind
   * @returns {string}
   */
  function pickLabel(text, start, end, kind) {
    var winStart = Math.max(0, start - 50);
    var ctx = text.slice(winStart, Math.min(text.length, end + 16));
    var best = "";
    var m;
    var re = new RegExp(NOUN_LABEL_RE.source, "g");
    while ((m = re.exec(ctx)) !== null) {
      // 単語の途中から切り出した断片（"ニメ市場" 等）を弾く: 直前の文字が漢字/カナならスキップ
      var prev = m.index > 0 ? ctx.charAt(m.index - 1) : "";
      if (/[一-龠ァ-ヶー]/.test(prev)) continue;
      if (BAD_LABEL_RE.test(m[1])) continue; // "9,000億" 等の数値断片を弾く
      var cand = (m[1] + m[2]).replace(/src-\d+/g, "");
      if (cand.length <= 16 && cand.length > best.length) best = cand;
    }
    return best || GENERIC_LABEL[kind] || "";
  }

  function classifyKind(rawKind, context) {
    if (rawKind === "cagr" || rawKind === "multiple") return rawKind;
    if (rawKind === "money") return SIZE_HINT.test(context) ? "size" : "money";
    if (rawKind === "percent") return GROWTH_HINT.test(context) ? "growth" : "percent";
    if (rawKind === "year") return POLICY_HINT.test(context) ? "milestone" : "year";
    return rawKind;
  }

  /**
   * テキスト（複数を結合可）から市場数値を抽出する。
   * @param {string|string[]} input
   * @param {{max?:number, includeYears?:boolean}} [options]
   * @returns {Array<{value:string, kind:string, label:string, sourceId:(string|null)}>}
   */
  function extractMarketNumbers(input, options) {
    var opts = options || {};
    var max = typeof opts.max === "number" ? opts.max : 3;
    var maxPerKind = typeof opts.maxPerKind === "number" ? opts.maxPerKind : 2;
    var includeYears = opts.includeYears === true;
    var text = Array.isArray(input) ? input.filter(Boolean).join("\n") : String(input || "");
    if (!text.trim()) return [];

    var claimed = [];
    var raw = [];

    for (var p = 0; p < PATTERNS.length; p++) {
      var re = new RegExp(PATTERNS[p].re.source, "g");
      var m;
      while ((m = re.exec(text)) !== null) {
        if (m[0].replace(/\s/g, "") === "") {
          re.lastIndex++;
          continue;
        }
        var start = m.index;
        var end = start + m[0].length;
        var overlaps = claimed.some(function (c) {
          return start < c[1] && end > c[0];
        });
        if (overlaps) continue;
        claimed.push([start, end]);

        var context = text.slice(Math.max(0, start - 44), Math.min(text.length, end + 24));
        var srcMatch = context.match(/src-\d+/);
        var kind = classifyKind(PATTERNS[p].kind, context);
        raw.push({
          value: m[0].replace(/\s+/g, "").replace(/[，]/g, ","),
          kind: kind,
          label: pickLabel(text, start, end, kind),
          sourceId: srcMatch ? srcMatch[0] : null,
          index: start,
        });
      }
    }

    // value 重複除去（最初の出現を採用）
    var seen = {};
    var deduped = raw.filter(function (n) {
      if (seen[n.value]) return false;
      seen[n.value] = true;
      return true;
    });

    // 素の年（milestone でない year）は既定で除外
    if (!includeYears) {
      deduped = deduped.filter(function (n) {
        return n.kind !== "year";
      });
    }

    // 優先度（kind rank）→ 出現順
    deduped.sort(function (a, b) {
      var ra = KIND_RANK[a.kind] == null ? 5 : KIND_RANK[a.kind];
      var rb = KIND_RANK[b.kind] == null ? 5 : KIND_RANK[b.kind];
      return ra - rb || a.index - b.index;
    });

    // 同一 kind は maxPerKind まで（同じ数字が並んで見飽きるのを防ぐ）
    var perKind = {};
    var picked = [];
    for (var i = 0; i < deduped.length && picked.length < max; i++) {
      var k = deduped[i].kind;
      perKind[k] = (perKind[k] || 0) + 1;
      if (perKind[k] > maxPerKind) continue;
      picked.push(deduped[i]);
    }

    return picked.map(function (n) {
      return { value: n.value, kind: n.kind, label: n.label, sourceId: n.sourceId };
    });
  }

  /**
   * 「規模・成長・倍率・CAGR」に該当する件数（Hero variant B 判定用）。
   * @param {Array} nums
   * @returns {number}
   */
  function countMarketMomentum(nums) {
    return (nums || []).filter(function (n) {
      return n.kind === "size" || n.kind === "growth" || n.kind === "multiple" || n.kind === "cagr";
    }).length;
  }

  module.exports = { extractMarketNumbers: extractMarketNumbers, countMarketMomentum: countMarketMomentum };
