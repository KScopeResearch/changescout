/*
 * report-teaser.js — Phase56 STEP2（Business Chance Copy & Insight）
 *
 * published report JSON から「メール teaser」と「Preview Hero / Card」が共有する派生値を作る。
 * すべて pure / deterministic（乱数・時刻依存・LLM・API・fetch なし）。
 *
 * ブラウザ側 website/aor/assets/js/preview-ui.js と同じ判定ロジックを持つ関数
 * （pickVisualTheme / humanReviewLine / salutation / oneLineSummary / expectedBenefit /
 *  rerankMarketStats）は scripts/generator/test/report-teaser-parity.test.js が両者一致を保証する。
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

// --- 宛名（Phase56 STEP2 GOAL-1: 会社名 + 経営者様） --------------------------
const CORP_SUFFIX_RE = /(株式会社|有限会社|合同会社|合名会社|合資会社|一般社団法人|一般財団法人|特定非営利活動法人|NPO法人)/;

/**
 * company_profile.name から「<会社名> 経営者様」を作る。
 * name が無い / ドメインらしい場合は fallback（"ご担当者様"）。
 * @param {string} name
 * @returns {string}
 */
function salutation(name) {
  const n = String(name || "").trim();
  if (!n) return "ご担当者様";
  // ドメイン・slug らしき文字列（英数と . や - のみ）は会社名として扱わない
  if (/^[a-z0-9][a-z0-9.\-_]*\.[a-z]{2,}$/i.test(n) || !/[ぁ-んァ-ヶ一-龠A-Za-z]/.test(n)) {
    return "ご担当者様";
  }
  return n + " 経営者様";
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
  const cut = t.slice(0, max);
  const lastPeriod = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("．"));
  if (lastPeriod >= max * 0.4) return cut.slice(0, lastPeriod + 1);
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

// --- 「一言でいうと」（Phase56 STEP2: Business Chance を 20〜40 字で言い切る） ---
/**
 * Opportunity title から「◯◯を始めるチャンスがあります。」型の一言を作る。
 * LLM は使わない。20〜44 字を目安に整える。
 * @param {string} title
 * @returns {string}
 */
function oneLineSummary(title) {
  let t = String(title || "").trim().replace(/（src-\d+[^）]*）/g, "");
  if (!t) return "";
  // 「XXXの立ち上げ / の提供 / の展開 / …」→ 「XXXを始めるチャンスがあります。」
  const m = t.match(/^(.*?)(の立ち上げ|の提供|の展開|の構築|の開発|の商品化|の体系化と展開|の導入|の強化|の拡大)$/);
  let core = m ? m[1] : t.replace(/。$/, "");
  // 長すぎる core は主要部だけ（最初の読点まで、または 34 字）
  if (core.length > 34) {
    const comma = core.slice(0, 34).lastIndexOf("・");
    core = comma > 12 ? core.slice(0, comma) : core.slice(0, 34);
  }
  const verb = m ? "を始めるチャンスがあります。" : "に取り組むチャンスがあります。";
  return core + verb;
}

// --- 「このチャンスで期待できること」（売上/集客/採用/利益/業務効率 いずれか1〜2） ---
const BENEFIT_HINTS = [
  ["売上", /(売上|収益|客単価|単価|LTV|購入額|受注)/],
  ["集客", /(集客|新規顧客|来店|問い合わせ|リード|認知|流入|予約)/],
  ["リピート", /(リピート|再来|継続|定着|会員|ファン|定期)/],
  ["採用・定着", /(採用|人材確保|離職|定着|応募)/],
  ["利益率", /(利益|粗利|コスト削減|原価|マージン)/],
  ["業務効率", /(効率化|工数|時間短縮|自動化|省力|生産性)/],
];

/**
 * extended_analysis.priority / market_change / why_company から
 * 期待できる経営インパクトのラベルを 1〜2 個返す。
 * @param {Object} report
 * @returns {string[]}
 */
function expectedBenefit(report) {
  const fo = (report && report.free_opportunity) || {};
  const ea = fo.extended_analysis || {};
  const hay = [ea.priority, fo.market_change, fo.why_company, fo.why_now, fo.title].map(String).join(" ");
  const hits = [];
  for (const [label, re] of BENEFIT_HINTS) {
    if (re.test(hay) && hits.indexOf(label) === -1) hits.push(label);
    if (hits.length >= 2) break;
  }
  if (!hits.length) hits.push("業務効率");
  return hits;
}

// --- Opportunity headline（Preview Hero の見出し。preview-ui と同一方針） ------
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
  const local = rerankMarketStats(all);
  const momentum = local.filter(
    (n) => (n.kind === "size" || n.kind === "growth" || n.kind === "multiple" || n.kind === "cagr") && !n.isWorld
  ).length;
  if (momentum < 2) return "A";
  const rank = { size: 0, growth: 1, multiple: 1, cagr: 1 };
  const top = local
    .filter((n) => !n.isWorld)
    .slice()
    .sort((a, b) => (rank[a.kind] == null ? 5 : rank[a.kind]) - (rank[b.kind] == null ? 5 : rank[b.kind]))[0];
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

// --- Market Snapshot 並べ替え（Phase56 STEP2 GOAL-4） -------------------------
// 表示優先: 地域 > 業界 > 補助金 > 日本市場 > 世界市場（最後）。
// 世界市場（米ドル / 兆ドル / 「世界」ラベル）は isWorld=true を立てて末尾へ。
const WORLD_RE = /(米ドル|USドル|US\$|世界|グローバル|global)/i;
const LOCAL_RE = /(地域|商店街|市内|県内|近隣|エリア|沿線|地元|自治体|市区町村)/;
const INDUSTRY_RE = /(業界|業種|同業|市場調査|需要|導入率|活用率|来店|客数|口コミ|予約)/;
const SUBSIDY_RE = /(補助|助成|給付|交付|公募)/;
const JP_RE = /(国内|日本|全国)/;

function statTier(stat) {
  const s = (stat.label || "") + " " + (stat.value || "");
  if (WORLD_RE.test(s)) return 4;
  if (LOCAL_RE.test(s)) return 0;
  if (INDUSTRY_RE.test(s)) return 1;
  if (SUBSIDY_RE.test(s)) return 2;
  if (JP_RE.test(s)) return 3;
  return 1.5; // 地域とも世界とも取れない一般値は業界寄りに置く
}

/**
 * 抽出済み market numbers を「経営者に近い順」に並べ替える。
 * 各要素に isWorld / tier を付与して返す（元配列は変更しない）。
 * @param {Array} stats
 * @returns {Array}
 */
function rerankMarketStats(stats) {
  const arr = (stats || []).map((s, i) => {
    const tier = statTier(s);
    return Object.assign({}, s, { tier: tier, isWorld: tier >= 4, _i: i });
  });
  const kindRank = { size: 0, growth: 1, multiple: 1, cagr: 1, money: 2, percent: 2, milestone: 3, year: 5 };
  arr.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    const ka = kindRank[a.kind] == null ? 4 : kindRank[a.kind];
    const kb = kindRank[b.kind] == null ? 4 : kindRank[b.kind];
    return ka - kb || a._i - b._i;
  });
  return arr.map((s) => {
    const out = Object.assign({}, s);
    delete out._i;
    return out;
  });
}

/**
 * メール / Hero 用に上位 max 件の市場数字を選ぶ。
 * 世界市場しか無い場合は各要素に worldOnly=true を付ける（呼び出し側で「参考データ」と表示）。
 * @param {Object} report @param {{max?:number}} [opts]
 * @returns {Array<{value:string,label:string,isWorld:boolean,worldOnly:boolean}>}
 */
function selectMarketStats(report, opts) {
  const fo = (report && report.free_opportunity) || {};
  const ea = fo.extended_analysis || {};
  const max = (opts && opts.max) || 3;
  const raw = extractMarketNumbers([fo.why_now, fo.market_change, ea.market_size], { max: 10, maxPerKind: 2 });
  const ranked = rerankMarketStats(raw);
  const worldOnly = ranked.length > 0 && ranked.every((s) => s.isWorld);
  return ranked.slice(0, max).map((s) => ({
    value: s.value,
    label: labelWithScope(s),
    kind: s.kind,
    isWorld: !!s.isWorld,
    worldOnly: worldOnly,
    sourceId: s.sourceId || null,
  }));
}

/**
 * メール teaser の view model。Preview Hero / Card と「同じ published JSON から」派生する。
 * @param {Object} report - published report JSON
 * @param {string} reportUrl
 * @returns {Object}
 */
function buildTeaser(report, reportUrl) {
  const r = report || {};
  const cp = r.company_profile || {};
  const fo = r.free_opportunity || {};
  const companyName = (cp.name && String(cp.name).trim()) || "";
  const review = humanReviewLine(r);

  // メール teaser の市場数字: 経営者に近い順、米ドル建て / 長すぎる値は避ける、最大2件。
  const selected = selectMarketStats(r, { max: 6 });
  const short = selected.filter((n) => n.value.replace(/[,，]/g, "").length <= 10);
  const nonUsd = (short.length ? short : selected).filter((n) => !/ドル/.test(n.value));
  const pool = nonUsd.length ? nonUsd : short.length ? short : selected;
  const stats = pool.slice(0, 2);

  return {
    companyName,
    hasCompanyName: !!companyName,
    salutation: salutation(companyName),
    theme: pickVisualTheme(r),
    heroVariant: pickHeroVariant(r),
    opportunityTitle: String(fo.title || "").trim(),
    chanceSummary: oneLineSummary(fo.title),
    hasOpportunity: !!String(fo.title || "").trim(),
    whyNow: excerpt(fo.why_now, 110),
    whyCompany: firstSentence(fo.why_company) || excerpt(fo.why_company, 90),
    expectedBenefit: expectedBenefit(r),
    firstStep: excerpt(fo.first_action, 90),
    marketStats: stats.map((s) => ({ value: s.value, label: s.label, isWorld: s.isWorld, worldOnly: s.worldOnly })),
    reviewApproved: review.approved,
    reviewLine: review.line,
    reportUrl: reportUrl || "",
  };
}

// --- 件名・プリヘッダー（Phase56 STEP2 GOAL: ビジネスチャンス / 無料強調） --------
function subject(teaser, opts) {
  const kind = (opts && opts.kind) || "initial";
  const who = teaser.hasCompanyName ? `【${teaser.companyName} 経営者様】` : "";
  if (kind === "weekly") {
    return `${who}御社のビジネスチャンスレポートを更新しました`;
  }
  if (teaser.hasOpportunity) {
    return `${who}御社に関係する新しいビジネスチャンスを見つけました`;
  }
  return `${who}御社向けのビジネスチャンスレポートが完成しました`;
}

function preheader(teaser) {
  if (teaser && teaser.hasOpportunity) {
    return "無料で読めるレポートです。なぜ今・なぜ御社・今日からできる一歩を5分で整理しました。";
  }
  return "無料で読めるレポートです。御社に関係する市場の動きを整理しています。";
}

module.exports = {
  THEME_RULES,
  KNOWN_THEMES,
  pickVisualTheme,
  salutation,
  humanReviewLine,
  pickHeroVariant,
  opportunityHeadline,
  oneLineSummary,
  expectedBenefit,
  rerankMarketStats,
  selectMarketStats,
  excerpt,
  firstSentence,
  labelWithScope,
  buildTeaser,
  subject,
  preheader,
};
