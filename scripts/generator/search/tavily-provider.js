/**
 * tavily-provider.js
 *
 * Tavily Search API（LLM向けに設計された検索API）を叩くprovider実装。
 * search-client.jsが要求する共通インタフェース（id/displayName/requiresApiKey/
 * isConfigured()/searchRaw()）を実装する。
 *
 * 【重要】このファイルはAPIキーなしでは実行できず、本プロジェクトでは実際に呼び出して
 * いない（プロジェクトルール: 有料外部サービスのAPIキーは設定しない）。コードとしては
 * 実際にTavily APIへ接続できる想定で実装しているが、Task12時点では未検証（動作未確認）。
 * TAVILY_API_KEYが環境変数に設定されていれば、ユーザー自身の判断・費用負担で有効化できる。
 * 未設定の場合、search-client.jsが自動的にmock providerへフォールバックする
 * （llm-client.jsとは異なり、検索はエラー停止ではなくフォールバックする設計。Task12 Task2）。
 *
 * エンドポイント・リクエスト形式は2026年8月時点でTavily公式ドキュメントに記載の
 * 一般的な形（POST + JSONボディ + api_keyフィールド）を踏襲しているが、実際に呼び出して
 * いないため、使用前に公式ドキュメントで最新の形式を確認すること。
 */

const ENDPOINT = "https://api.tavily.com/search";
const MAX_RESULTS = Number(process.env.TAVILY_MAX_RESULTS) || 5;

/** @returns {boolean} */
function isConfigured() {
  return !!process.env.TAVILY_API_KEY;
}

/**
 * @param {string} query
 * @param {{signal?:AbortSignal}} [options]
 * @returns {Promise<{results:Array<Object>, usage:Object}>}
 */
async function searchRaw(query, options = {}) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY が設定されていません");
  }

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: MAX_RESULTS,
      include_answer: false,
      search_depth: "basic",
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Tavily API エラー: HTTP ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const rawResults = Array.isArray(data.results) ? data.results : [];

  const results = rawResults.map((item) => ({
    title: item.title || null,
    url: item.url || null,
    snippet: item.content || null,
    published_at: item.published_date || null,
    organization: null, // Tavilyはorganization相当の情報を返さないため呼び出し側で補完しない
  }));

  return {
    results,
    usage: { queries: 1, results_returned: results.length, response_time: data.response_time || null },
  };
}

module.exports = {
  id: "tavily",
  displayName: "Tavily Search API",
  requiresApiKey: true,
  isConfigured,
  searchRaw,
};
