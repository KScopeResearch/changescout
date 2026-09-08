/*
 * report-teaser.js — Phase55 STEP4（canonical / CommonJS）
 *
 * published report JSON から「メール teaser」と「Preview Hero」が共有する派生値を作る。
 * すべて pure / deterministic（乱数・時刻依存・LLM・API・fetch なし）。
 *
 * ブラウザ側 website/aor/assets/js/preview-ui.js と同じ判定ロジックを持つ関数
 * （pickVisualTheme / humanReviewLine）は、
 * scripts/generator/test/report-teaser-parity.test.js が両者一致を保証する。
 *
 * Lambda bundle は website/ を含まないため、送信側（send-initial-report.js /
 * send-weekly-report.js）は本モジュールを使う。
 */
"use strict";

const { extractMarketNumbers } = require("./market-numbers");

// --- Visual theme（preview-ui.js の THEME_RULES と同一・同順） ---------------
const THEME_RULES = [
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
const KNOWN_THEMES = THEME_RULES.map((r) => r[0]).concat(["generic_insight"]);

function pickVisualTheme(report) {
  const cp = (report && report.company_profile) || {};
  const fo = (report && report.free_opportunity) || {};
  const title = String(fo.title || "");
  const industry = String(cp.industry_label || "");
  const mc = String(fo.market_change || "");
  for (const [name, re] of THEME_RULES) if (re.test(title)) return name;
  for (const [name, re] of THEME_RULES) if (re.test(industry)) return name;
  for (const [name, re] of THEME_RULES) if (re.test(mc)) return name;
  return "generic_insight";
}

// --- Human Review line（preview-ui.js の humanReviewLine と同一） --------------
function humanReviewLine(report) {
  const hr = (report && report.human_review) || {};
  const approved = hr.status === "approved";
  if (!approved) return { approved: false, line: "内容を運営がレビュー中です" };
  let when = "";
  const d = hr.reviewed_at ? new Date(hr.reviewed_at) : null;
  if (d && !isNaN(d.getTime())) {
    when = d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日、";
  }
  return { approved: true, line: when + "運営がこのレポートの内容と出典を確認しました" };
}

// --- テキスト抜粋（メール teaser 用に短くする。要約はしない・切り取るだけ） ------
/**
 * 文頭から maxLen 以内に収まる完全な文を返す（句点で区切る）。src-N 参照は落とす。
 * @param {string} text @param {number} [maxLen=120]
 * @returns {string}
 */
function excerpt(text, maxLen) {
  const max = maxLen || 120;
  let t = String(text || "")
    .replace(/（src-\d+(?:,\s*src-\d+)*）/g, "")
    .replace(/\(src-\d+(?:,\s*src-\d+)*\)/g, "")
    .replace(/src-\d+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  if (t.length <= max) return t;
  // maxLen 以内で最後の句点まで
  const cut = t.slice(0, max);
  const lastPeriod = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("．"));
  if (lastPeriod >= max * 0.4) return cut.slice(0, lastPeriod + 1);
  // 句点が無ければ読点、それも無ければそのまま + …
  const lastComma = cut.lastIndexOf("、");
  if (lastComma >= max * 0.5) return cut.slice(0, lastComma) + "…";
  return cut.replace(/[、。]?$/, "") + "…";
}

function firstSentence(text) {
  const t = String(text || "").trim().replace(/（src-\d+[^）]*）/g, "").replace(/src-\d+/g, "").trim();
  if (!t) return "";
  const m = t.match(/^[\s\S]*?。/);
  return (m ? m[0] : t).trim();
}

// --- Opportunity headline（preview-ui.js の opportunityHeadline と同一方針） ----
function opportunityHeadline(title) {
  const t = String(title || "").trim();
  if (!t) return "";
  const m = t.match(/^(.*?)(の立ち上げ|の提供|の開発|の展開|の構築|の体系化と展開|の商品化)$/);
  if (m) return m[1] + "に、御社が取り組める余地があります。";
  return t;
}

// --- Hero variant（preview-ui.js の pickHeroVariant と同一） -------------------
function pickHeroVariant(report) {
  const fo = (report && report.free_opportunity) || {};
  const ea = fo.extended_analysis || {};
  const all = extractMarketNumbers([fo.why_now, fo.market_change, ea.market_size], { max: 30, maxPerKind: 30 });
  const momentum = all.filter(
    (n) => n.kind === "size" || n.kind === "growth" || n.kind === "multiple" || n.kind === "cagr"
  ).length;
  if (momentum < 2) return "A";
  const rank = { size: 0, growth: 1, multiple: 1, cagr: 1 };
  const top = all.slice().sort((a, b) => (rank[a.kind] == null ? 5 : rank[a.kind]) - (rank[b.kind] == null ? 5 : rank[b.kind]))[0];
  const topIsYen = top && /円/.test(top.value) && !/ドル/.test(top.value);
  return topIsYen ? "B" : "A";
}

// stat label に世界市場スコープを付ける（数字は変えない。preview 側と同一） --------
function labelWithScope(stat) {
  if (!stat) return "";
  const lbl = stat.label || "";
  if (/ドル/.test(stat.value || "") && /市場/.test(lbl) && !/世界|グローバル|国内/.test(lbl)) {
    return "世界の" + lbl;
  }
  return lbl;
}

/**
 * メール teaser の view model。Preview Hero と「同じ published JSON から」派生する。
 * @param {Object} report - published report JSON
 * @param {string} reportUrl
 * @returns {Object}
 */
function buildTeaser(report, reportUrl) {
  const r = report || {};
  const cp = r.company_profile || {};
  const fo = r.free_opportunity || {};
  const ea = fo.extended_analysis || {};
  const companyName = (cp.name && String(cp.name).trim()) || "";
  const review = humanReviewLine(r);

  // メール teaser では最大2件。KIND_RANK 順（size/growth/multiple/cagr を優先）は
  // extractMarketNumbers 側で担保済み。メールで読みやすいよう、
  // (1) 米ドル建ての数値は他に候補があれば避ける
  // (2) value が長すぎる（11字以上）ものは他に候補があれば避ける
  const cands = extractMarketNumbers([fo.why_now, fo.market_change, ea.market_size], { max: 8, maxPerKind: 2 });
  const short = cands.filter((n) => n.value.replace(/[,，]/g, "").length <= 10);
  const nonUsd = (short.length ? short : cands).filter((n) => !/ドル/.test(n.value));
  const pool = nonUsd.length ? nonUsd : short.length ? short : cands;
  const stats = pool.slice(0, 2);

  return {
    companyName,
    hasCompanyName: !!companyName,
    theme: pickVisualTheme(r),
    heroVariant: pickHeroVariant(r),
    opportunityTitle: String(fo.title || "").trim(),
    hasOpportunity: !!String(fo.title || "").trim(),
    whyNow: excerpt(fo.why_now, 110),
    whyCompany: firstSentence(fo.why_company) || excerpt(fo.why_company, 90),
    marketStats: stats.map((s) => ({ value: s.value, label: labelWithScope(s) })),
    reviewApproved: review.approved,
    reviewLine: review.line,
    reportUrl: reportUrl || "",
  };
}

// --- 件名・プリヘッダー（published JSON から安全生成。煽り・数字捏造なし） --------
function subject(teaser, opts) {
  const kind = (opts && opts.kind) || "initial";
  const who = teaser.hasCompanyName ? `【${teaser.companyName} 様】` : "";
  if (kind === "weekly") {
    return `${who}御社の市場機会レポートを更新しました`;
  }
  if (teaser.hasOpportunity) {
    return `${who}御社に関係する新しい市場機会を整理しました`;
  }
  return `${who}御社向けの市場分析レポートが完成しました`;
}

function preheader(teaser) {
  if (teaser.hasOpportunity && teaser.whyCompany) {
    return "御社の事業との接点が考えられる市場機会と、いま起きている変化を1件に絞って整理しました。";
  }
  return "公開情報と市場データをもとに、御社に関係する市場の動きを整理しています。";
}

module.exports = {
  THEME_RULES,
  KNOWN_THEMES,
  pickVisualTheme,
  humanReviewLine,
  pickHeroVariant,
  opportunityHeadline,
  excerpt,
  firstSentence,
  labelWithScope,
  buildTeaser,
  subject,
  preheader,
};
