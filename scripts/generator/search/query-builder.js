/**
 * query-builder.js
 *
 * Task12 Task4: 会社名から検索クエリを自動生成する。
 * カテゴリ（government/industry/news/statistics）ごとに、対応する検索クエリと
 * 付与すべきsource_type/source_roleを組み立てる。fetch-*.jsはこれを使って
 * search-client.jsへ渡すクエリを得る（検索エンジン固有の実装を意識しない）。
 *
 * 最低5クエリを生成する（Task12要件）: news 1件・government 1件・industry 2件
 * （業界動向＋技術、industry_association/technologyの2つのsource_typeに対応）・
 * statistics 1件 = 計5件。
 */

/**
 * @typedef {Object} SearchQuerySpec
 * @property {string} category - "government"|"industry"|"news"|"statistics"
 * @property {string} query - 実際に検索エンジンへ渡すクエリ文字列
 * @property {string} sourceType - 付与するAOR公式source_type
 * @property {string} sourceRole - 付与するAOR公式source_role
 */

/** カテゴリごとのクエリ定義。company名は呼び出し時に埋め込む。 */
const QUERY_TEMPLATES = [
  { category: "news", suffix: "最新ニュース", sourceType: "news", sourceRole: "evidence" },
  { category: "government", suffix: "補助金", sourceType: "government", sourceRole: "market_change" },
  { category: "industry", suffix: "業界動向", sourceType: "industry_association", sourceRole: "industry_trend" },
  { category: "industry", suffix: "技術", sourceType: "technology", sourceRole: "industry_trend" },
  { category: "statistics", suffix: "市場", sourceType: "statistics", sourceRole: "industry_trend" },
];

/**
 * 会社名から全カテゴリ分の検索クエリ（最低5件）を生成する。
 * @param {string} companyName - 会社名（不明な場合はホスト名等の代替文字列でも可）
 * @returns {SearchQuerySpec[]}
 */
function buildQueries(companyName) {
  const name = (companyName || "").trim() || "対象企業";
  return QUERY_TEMPLATES.map((tpl) => ({
    category: tpl.category,
    query: `${name} ${tpl.suffix}`,
    sourceType: tpl.sourceType,
    sourceRole: tpl.sourceRole,
  }));
}

/**
 * 指定カテゴリ分のクエリのみを取り出す（fetch-government.js等が使う）。
 * @param {string} category - "government"|"industry"|"news"|"statistics"
 * @param {string} companyName
 * @returns {SearchQuerySpec[]}
 */
function buildQueriesForCategory(category, companyName) {
  return buildQueries(companyName).filter((q) => q.category === category);
}

module.exports = { buildQueries, buildQueriesForCategory, QUERY_TEMPLATES };
