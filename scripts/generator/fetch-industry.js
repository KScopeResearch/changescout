/**
 * fetch-industry.js
 *
 * 業界団体レポート・技術ロードマップ等（業界情報）の取得。
 *
 * Task12: search-client.js経由の検索に対応した。fetch-government.js冒頭の注記を参照。
 * このカテゴリはquery-builder.jsから2件のクエリを受け取る（"会社名 業界動向" →
 * source_type: industry_association、"会社名 技術" → source_type: technology）。
 */

const { buildQueriesForCategory } = require("./search/query-builder");
const { search } = require("./search/search-client");

/**
 * 業界情報の候補を取得する。
 * @param {Object} context - {industryHint: string, companyName: string}
 * @returns {Promise<Array<Object>>} [{source_type, source_role, label, url, content, organization, published_at, ok, simulated}]
 */
async function fetchIndustry(context) {
  const companyName = (context && context.companyName) || "対象企業";
  const queries = buildQueriesForCategory("industry", companyName);

  const perQueryResults = await Promise.all(
    queries.map((q) => search(q.query, { sourceType: q.sourceType, sourceRole: q.sourceRole }))
  );

  return perQueryResults.flatMap((r) => r.results);
}

module.exports = { fetchIndustry };
