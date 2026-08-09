/**
 * fetch-news.js
 *
 * 大手ニュース・専門メディア（ニュース）の取得。
 *
 * Task12: search-client.js経由の検索に対応した。fetch-government.js冒頭の注記を参照。
 *
 * 注意: docs/strategy_v2/04_company_analysis.md の「情報源の利用条件」により、
 * ニュース単独ではOpportunityの根拠にしない設計となっている。このモジュールが返す
 * データは常に evidence_strength: "reference"（補助的な裏付け、normalize-sources.jsが
 * source_typeから自動付与）としてのみ扱うこと。
 */

const { buildQueriesForCategory } = require("./search/query-builder");
const { search } = require("./search/search-client");

/**
 * ニュースの候補を取得する。
 * @param {Object} context - {industryHint: string, companyName: string}
 * @returns {Promise<Array<Object>>} [{source_type, source_role, label, url, content, organization, published_at, ok, simulated}]
 */
async function fetchNews(context) {
  const companyName = (context && context.companyName) || "対象企業";
  const queries = buildQueriesForCategory("news", companyName);

  const perQueryResults = await Promise.all(
    queries.map((q) => search(q.query, { sourceType: q.sourceType, sourceRole: q.sourceRole }))
  );

  return perQueryResults.flatMap((r) => r.results);
}

module.exports = { fetchNews };
