/**
 * fetch-statistics.js
 *
 * 公的統計（政府統計等）の取得。
 *
 * Task12: search-client.js経由の検索に対応した。fetch-government.js冒頭の注記を参照。
 */

const { buildQueriesForCategory } = require("./search/query-builder");
const { search } = require("./search/search-client");

/**
 * 公的統計の候補を取得する。
 * @param {Object} context - {industryHint: string, companyName: string}
 * @returns {Promise<Array<Object>>} [{source_type, source_role, label, url, content, organization, published_at, ok, simulated}]
 */
async function fetchStatistics(context) {
  const companyName = (context && context.companyName) || "対象企業";
  const queries = buildQueriesForCategory("statistics", companyName);

  const perQueryResults = await Promise.all(
    queries.map((q) => search(q.query, { sourceType: q.sourceType, sourceRole: q.sourceRole }))
  );

  return perQueryResults.flatMap((r) => r.results);
}

module.exports = { fetchStatistics };
