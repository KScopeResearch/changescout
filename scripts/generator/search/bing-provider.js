/**
 * bing-provider.js
 *
 * Bing Web Search API（Microsoft Azure）を叩くprovider実装。
 * search-client.jsが要求する共通インタフェースを実装する。
 *
 * 【重要】このファイルはAPIキーなしでは実行できず、本プロジェクトでは実際に呼び出して
 * いない（プロジェクトルール: 有料外部サービスのAPIキーは設定しない）。コードとしては
 * 実際にBing Web Search APIへ接続できる想定で実装しているが、Task12時点では未検証
 * （動作未確認）。BING_SEARCH_API_KEYが環境変数に設定されていれば、ユーザー自身の
 * 判断・費用負担で有効化できる。未設定の場合、search-client.jsが自動的にmock providerへ
 * フォールバックする。
 *
 * エンドポイント・リクエスト形式は2026年8月時点でMicrosoft公式ドキュメントに記載の
 * 一般的な形（GET + Ocp-Apim-Subscription-Keyヘッダー）を踏襲しているが、実際に
 * 呼び出していないため、使用前に公式ドキュメントで最新の形式・エンドポイント
 * （リージョンによって異なる場合がある）を確認すること。
 */

const ENDPOINT = process.env.BING_SEARCH_ENDPOINT || "https://api.bing.microsoft.com/v7.0/search";
const MAX_RESULTS = Number(process.env.BING_MAX_RESULTS) || 5;

/** @returns {boolean} */
function isConfigured() {
  return !!process.env.BING_SEARCH_API_KEY;
}

/**
 * @param {string} query
 * @param {{signal?:AbortSignal}} [options]
 * @returns {Promise<{results:Array<Object>, usage:Object}>}
 */
async function searchRaw(query, options = {}) {
  const apiKey = process.env.BING_SEARCH_API_KEY;
  if (!apiKey) {
    throw new Error("BING_SEARCH_API_KEY が設定されていません");
  }

  const url = new URL(ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(MAX_RESULTS));
  url.searchParams.set("mkt", "ja-JP");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { "Ocp-Apim-Subscription-Key": apiKey },
    signal: options.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Bing Search API エラー: HTTP ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const rawResults = (data.webPages && Array.isArray(data.webPages.value)) ? data.webPages.value : [];

  const results = rawResults.map((item) => ({
    title: item.name || null,
    url: item.url || null,
    snippet: item.snippet || null,
    published_at: item.dateLastCrawled || null,
    organization: null,
  }));

  return {
    results,
    usage: { queries: 1, results_returned: results.length },
  };
}

module.exports = {
  id: "bing",
  displayName: "Bing Web Search API",
  requiresApiKey: true,
  isConfigured,
  searchRaw,
};
