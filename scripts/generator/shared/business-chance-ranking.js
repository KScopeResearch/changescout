/*
 * business-chance-ranking.js — Phase56 STEP5（Business Chance Engine V3.1）
 *
 * LLM が生成した「ビジネスチャンス候補（最低5件）」を、経営者への「近さ」で
 * 採点し順位付けする pure なランキングエンジン。
 *
 * 【厳守】
 *  - pure / deterministic（乱数・時刻・fetch・LLM・API を一切使わない）
 *  - 候補テキストの literal な特徴だけを見る。新しい事実・数字を作らない
 *  - 採用は Rank1。Near-field Distance Score 80 点以上を「合格」とする（RULE-THEME-10）
 *
 * 入力候補の形（RULE-THEME-9）:
 *   { title, why_now, why_company, first_action, expected_benefit, evidence? }
 */
"use strict";

const {
  CUSTOMER_SIDE_CHANGE,
  TOMORROW_ACTION_VERB,
  VAGUE_ACTION,
  KNOWN_GENERALITY,
  includesAny,
  businessSizeTier,
} = require("./theme-library");

// 顧客の痛み（Customer Pain）を示す語
const CUSTOMER_PAIN = CUSTOMER_SIDE_CHANGE.concat([
  "売上が伸び", "利益が残ら", "お金が残ら", "赤字", "資金繰り", "客単価", "閑散",
  "残業", "長時間労働", "属人化", "退職", "定着しない", "教育が回らない", "営業時間を短縮",
]);

// 業界・現場の変化を示す語
const INDUSTRY_CHANGE = [
  "業界", "業種", "同業", "現場", "店舗運営", "制作現場", "工場", "施工", "調剤", "外食産業",
  "参入", "淘汰", "再編", "縮小", "撤退", "統廃合", "受託依存", "下請け",
  "報酬改定", "法改正", "制度改正", "義務化", "規制", "2024年問題", "2025年問題",
  "トレンド", "普及", "定着", "導入が進", "標準に",
];

// why_company が会社固有の事実を根拠にしているか
const COMPANY_STRENGTH = [
  "実績", "経験", "ノウハウ", "強み", "一貫", "自社で", "現場で培った", "培った知見",
  "手掛けて", "支援してきた", "運営してきた", "開発から", "%削減", "％削減", "削減を実現",
];

/** src-N 参照を落として正規化。 */
function norm(text) {
  return String(text || "")
    .replace(/（src-\d+[^）]*）/g, "")
    .replace(/\(src-\d+[^)]*\)/g, "")
    .replace(/src-\d+/g, "")
    .replace(/\s+/g, "")
    .trim();
}

/** first_action が「明日の朝30分」でできるか（RULE-THEME-12）。 */
function passesTomorrowMorningTest(firstAction) {
  const t = norm(firstAction);
  if (!t) return false;
  if (includesAny(t, VAGUE_ACTION)) return false;
  // 具体動詞 + 目的語（数量・固有名）があるか
  const hasVerb = includesAny(t, TOMORROW_ACTION_VERB);
  const hasObject = /\d+\s*(社|件|店|名|人|軒|回|項目)|Google|LINE|Instagram|口コミ|レビュー|POS|補助金|プロフィール|メニュー|導線|既存顧客|取引先/.test(t);
  return hasVerb && hasObject;
}

/** why_now に「顧客側の変化」が最低1件あるか（RULE-THEME-11）。 */
function hasCustomerSideChange(whyNow) {
  return includesAny(norm(whyNow), CUSTOMER_SIDE_CHANGE);
}

/**
 * Near-field Distance Score（RULE-THEME-10・100点）。
 * @param {Object} candidate
 * @param {Object} [companyContext]
 * @returns {{total:number, breakdown:Object, tier:string, acceptable:boolean}}
 */
function scoreCandidate(candidate, companyContext) {
  const c = candidate || {};
  const whyNow = norm(c.why_now);
  const whyCompany = norm(c.why_company);
  const title = norm(c.title);
  const firstAction = norm(c.first_action);
  const combined = [whyNow, c.market_change, title].map(norm).join("");

  const b = {};

  // Customer Pain (20)
  b.customer_pain = includesAny(whyNow, CUSTOMER_PAIN) ? 20 : includesAny(combined, CUSTOMER_PAIN) ? 12 : 0;

  // Industry Change (15)
  b.industry_change = includesAny(whyNow, INDUSTRY_CHANGE) || includesAny(norm(c.market_change), INDUSTRY_CHANGE) ? 15 : 0;

  // Local / Japan relevance (15): Far は 0、Near は満点、Mid は中間
  const tier = businessSizeTier([title, whyNow, c.market_change].map(norm).join(""));
  b.local_relevance = tier === "near" ? 15 : tier === "mid" ? 10 : 0;

  // Why Company strength (15)
  b.why_company = includesAny(whyCompany, COMPANY_STRENGTH) ? 15 : whyCompany.length >= 30 ? 8 : 0;

  // First Action concreteness (15)
  b.first_action = passesTomorrowMorningTest(firstAction) ? 15 : includesAny(firstAction, VAGUE_ACTION) ? 0 : 7;

  // Novelty (10): 既知の一般論なら 0
  b.novelty = includesAny(combined, KNOWN_GENERALITY) ? 0 : 10;

  // Evidence availability (10)
  const evCount = Array.isArray(c.evidence) ? c.evidence.length : 0;
  const srcRefs = (String(c.why_now || "") + String(c.market_change || "")).match(/src-\d+/g);
  const refCount = srcRefs ? new Set(srcRefs).size : 0;
  b.evidence = evCount >= 4 || refCount >= 3 ? 10 : evCount >= 2 || refCount >= 2 ? 6 : 0;

  const total = Object.keys(b).reduce((s, k) => s + b[k], 0);
  return { total, breakdown: b, tier, acceptable: total >= 80 };
}

/**
 * 候補配列を「近さ」で降順ソートし、rank / score / acceptable を付けて返す（RULE-THEME-9）。
 * 副作用なし。AI 呼び出しなし。
 * @param {Array<Object>} candidates
 * @param {Object} [companyContext]
 * @returns {Array<Object>} sorted（[0] が採用候補 = Rank1）
 */
function rankBusinessChanceCandidates(candidates, companyContext) {
  const arr = (Array.isArray(candidates) ? candidates : []).map((cand, i) => {
    const s = scoreCandidate(cand, companyContext);
    return Object.assign({}, cand, {
      _origin: i,
      distanceScore: s.total,
      distanceBreakdown: s.breakdown,
      sizeTier: s.tier,
      acceptable: s.acceptable,
    });
  });
  arr.sort((a, b) => b.distanceScore - a.distanceScore || a._origin - b._origin);
  return arr.map((c, i) => {
    const out = Object.assign({}, c, { rank: i + 1 });
    delete out._origin;
    return out;
  });
}

module.exports = {
  scoreCandidate,
  rankBusinessChanceCandidates,
  passesTomorrowMorningTest,
  hasCustomerSideChange,
  CUSTOMER_PAIN,
  INDUSTRY_CHANGE,
  COMPANY_STRENGTH,
};
