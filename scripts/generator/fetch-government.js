/**
 * fetch-government.js
 *
 * 官公庁資料（一次情報）の取得。
 *
 * Task12: search-client.js（scripts/generator/search/）経由の検索に対応した。
 * SEARCH_PROVIDER環境変数でmock/tavily/bingを切替可能（デフォルトはmock、APIキー不要。
 * tavily/bingが指定されてもAPIキー未設定なら自動的にmockへフォールバックする）。
 * クエリは query-builder.js が会社名から自動生成する（このカテゴリでは1件: "会社名 補助金"）。
 */

const { buildQueriesForCategory } = require("./search/query-builder");
const { search } = require("./search/search-client");

/**
 * 官公庁資料の候補を取得する。
 * @param {Object} context - {industryHint: string, companyName: string}
 * @returns {Promise<Array<Object>>} [{source_type, source_role, label, url, content, organization, published_at, ok, simulated}]
 */
async function fetchGovernment(context) {
  const companyName = (context && context.companyName) || "対象企業";
  const queries = buildQueriesForCategory("government", companyName);

  const perQueryResults = await Promise.all(
    queries.map((q) => search(q.query, { sourceType: q.sourceType, sourceRole: q.sourceRole }))
  );

  return perQueryResults.flatMap((r) => r.results);
}

module.exports = { fetchGovernment };
