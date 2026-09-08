/**
 * normalize-sources.js
 *
 * 取得元（company/government/industry/news/statistics）が異なっていても、
 * 最終的に同じ構造へ正規化する。不足項目は null を許容する。
 *
 * 正規化後の構造:
 *   { id, title, url, organization, published_at, summary, quote,
 *     source_type, source_role, evidence_strength, score }
 *
 * id と score はこの段階では null（後段のcompany-context.js/score-sources.jsで確定する）。
 */

// Phase54 STEP8A.1: directory（企業DB・店舗/求人/見積ディレクトリ）と review（口コミ・評判サイト）を
// 追加した。検索結果には対象企業と無関係な、あるいは信頼度の低いこれらのページが混入し、
// テンプレ由来の source_type（government 等）のまま高スコアで扱われる事故があったため、
// classify-source.js が内容ベースでこの2型へ再分類する。
const VALID_SOURCE_TYPES = [
  "company",
  "government",
  "industry_association",
  "statistics",
  "news",
  "technology",
  "directory",
  "review",
];
const VALID_SOURCE_ROLES = ["company_fact", "market_change", "industry_trend", "evidence"];

const DEFAULT_STRENGTH_BY_TYPE = {
  company: "primary",
  government: "primary",
  statistics: "secondary",
  industry_association: "secondary",
  technology: "secondary",
  news: "reference",
  directory: "reference",
  review: "reference",
};

/**
 * 生のfetch結果1件を正規化する。取得に失敗した項目（ok:false）はnullを返す
 * （AIへ渡す情報として使えないため、この段階で除外する）。
 * @param {Object} raw - fetch-*.js のいずれかが返す生アイテム
 * @returns {Object|null} 正規化済みアイテム。除外対象はnull。
 */
function normalizeSource(raw) {
  if (!raw || raw.ok !== true) return null;

  const sourceType = VALID_SOURCE_TYPES.includes(raw.source_type) ? raw.source_type : "news";
  const sourceRole = VALID_SOURCE_ROLES.includes(raw.source_role) ? raw.source_role : "evidence";

  return {
    id: null,
    title: raw.label || null,
    url: raw.url || null,
    organization: raw.organization || null,
    published_at: raw.published_at || null,
    summary: raw.content || null,
    quote: raw.content || null,
    source_type: sourceType,
    source_role: sourceRole,
    evidence_strength: raw.evidence_strength || DEFAULT_STRENGTH_BY_TYPE[sourceType] || "reference",
    score: null,
    // Phase54 STEP8A.1: mock（合成）由来かどうか。classify-source.js が内容ベース再分類を
    // 行うかどうかの判断に使う（mock はホスト・本文が非実在のため再分類しない）。
    simulated: raw.simulated === true,
  };
}

/**
 * merge-sources.jsが返した配列をまとめて正規化する。
 * @param {Array<Object>} rawItems - mergeSources() の戻り値
 * @returns {Array<Object>} 正規化済みアイテムの配列（取得失敗分は除外済み）
 */
function normalizeSources(rawItems) {
  return (rawItems || []).map(normalizeSource).filter(Boolean);
}

module.exports = { normalizeSource, normalizeSources, VALID_SOURCE_TYPES, VALID_SOURCE_ROLES };
