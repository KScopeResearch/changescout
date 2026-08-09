/**
 * search-client.js
 *
 * Task12 Task1: 特定検索サービスに依存しない検索抽象化レイヤー。
 * fetch-government.js / fetch-industry.js / fetch-news.js / fetch-statistics.js は
 * 本モジュールの`search(query, options)`のみを呼び、実際にどのproviderが動くかは
 * `SEARCH_PROVIDER`環境変数で切り替わる。
 *
 * llm-client.js（Task11）との設計上の違い（Task12 Task2の要件）:
 *   - llm-client.js: APIキー未設定時はエラーで停止する（分析結果の信頼性に直結するため）
 *   - search-client.js: APIキー未設定時は**自動的にmock providerへフォールバックする**
 *     （検索は情報収集の一部に過ぎず、mockでもパイプライン全体を最後まで検証できるため。
 *     ユーザー指示「未設定の場合：必ずmockへfallbackする」に対応）
 *
 * 提供する機能: provider切替・timeout・retry・エラー処理・usage logging（Task1要件）。
 * timeout/retryの実装はllm-client.jsと同じ堅牢なパターン（Promise.raceによる
 * ハードタイムアウト。provider実装がAbortSignalを尊重しなくても必ずtimeoutMsで確定する）。
 */

const path = require("path");

const mockProvider = require("./mock-search-provider");
const tavilyProvider = require("./tavily-provider");
const bingProvider = require("./bing-provider");
const { validateSearchRawShape, toRawSourceItem } = require("./search-interface");
const { withRetryAndTimeout } = require("../shared/retry");
const { appendJsonLine } = require("../shared/json-file");
const { LOGS_DIR } = require("../shared/paths");
const { nowIso } = require("../shared/date-utils");
const { createLogger } = require("../shared/logger");
const { archiveIfOversize } = require("../shared/log-rotation"); // Task43

const logger = createLogger("search-client");

const PROVIDERS = {
  mock: mockProvider,
  tavily: tavilyProvider,
  bing: bingProvider,
};

const DEFAULT_PROVIDER_ID = "mock";
const DEFAULT_TIMEOUT_MS = Number(process.env.SEARCH_TIMEOUT_MS) || 15000;
const DEFAULT_MAX_RETRIES = Number.isFinite(Number(process.env.SEARCH_MAX_RETRIES))
  ? Number(process.env.SEARCH_MAX_RETRIES)
  : 2;

const LOG_FILE = path.join(LOGS_DIR, "search-usage.jsonl");
// Task43: コスト分析用途のため自動削除はしない。サイズ超過時はアーカイブのみ（Task42方針）。
const ARCHIVE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * SEARCH_PROVIDER環境変数からprovider idを決定する。未設定時はmock。
 * @returns {string}
 */
function resolveProviderId() {
  return (process.env.SEARCH_PROVIDER || DEFAULT_PROVIDER_ID).toLowerCase();
}

/**
 * provider idからproviderモジュールを取得する（存在しないidはエラー）。
 * @param {string} [id] - 省略時はresolveProviderId()
 * @returns {Object} provider
 */
function getProvider(id) {
  const providerId = (id || resolveProviderId()).toLowerCase();
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new Error(`未知のSEARCH_PROVIDER: "${providerId}"。利用可能なprovider: ${Object.keys(PROVIDERS).join(", ")}`);
  }
  return provider;
}

/**
 * providerを retry + timeout でラップして呼び出す（Task18: 共通実装はshared/retry.jsへ移動。
 * llm-client.jsと同じ堅牢なパターン。形状検証（validateSearchRawShape）の失敗もリトライ
 * 対象に含める点は元の実装と同じ挙動を維持している）。
 * @param {Object} provider
 * @param {string} query
 * @param {Object} options
 * @param {{timeoutMs:number, maxRetries:number}} config
 * @returns {Promise<{results:Array, usage:Object}>}
 */
function callWithRetryAndTimeout(provider, query, options, { timeoutMs, maxRetries }) {
  return withRetryAndTimeout(
    async (signal) => {
      const raw = await provider.searchRaw(query, { ...options, signal });
      validateSearchRawShape(raw);
      return raw;
    },
    {
      timeoutMs,
      maxRetries,
      label: provider.displayName,
      onRetry: ({ attempt, maxRetries: total, message, delayMs }) =>
        logger.warn(`${provider.id} 検索失敗（${attempt + 1}/${total + 1}回目): ${message} — ${delayMs}ms後に再試行`),
    }
  );
}

/** @param {Object} entry */
function writeLog(entry) {
  archiveIfOversize(LOG_FILE, ARCHIVE_SIZE_BYTES); // Task43
  appendJsonLine(LOG_FILE, entry);
}

/**
 * クエリを検索し、AOR公式のsource_type/source_roleを付与した生fetchアイテム形式で返す。
 * APIキー未設定の非mock providerが指定された場合は、自動的にmockへフォールバックする
 * （エラーにはしない。search-client.js独自の設計、llm-client.jsとは異なる）。
 *
 * @param {string} query - 検索クエリ文字列
 * @param {Object} options
 * @param {string} options.sourceType - 結果に付与するAOR公式source_type
 * @param {string} options.sourceRole - 結果に付与するAOR公式source_role
 * @param {string} [options.providerId] - 明示的にproviderを指定する場合（省略時はSEARCH_PROVIDER環境変数）
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxRetries]
 * @returns {Promise<{results:Array<Object>, usage:Object, provider:string}>}
 *   resultsの各要素は normalize-sources.js が期待する生fetchアイテム形式
 *   （source_type, source_role, label, url, content, organization, published_at, ok, simulated）
 */
async function search(query, options = {}) {
  let provider = getProvider(options.providerId);
  const requestedProviderId = provider.id;
  let usedFallback = false;

  if (provider.requiresApiKey && !provider.isConfigured()) {
    logger.warn(`SEARCH_PROVIDER=${provider.id} のAPIキーが未設定のため、mockへフォールバックします。`);
    provider = PROVIDERS.mock;
    usedFallback = true;
  }

  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : DEFAULT_MAX_RETRIES;

  const startedAt = Date.now();
  const raw = await callWithRetryAndTimeout(provider, query, options, { timeoutMs, maxRetries });
  const durationMs = Date.now() - startedAt;

  const simulated = provider.id === "mock";
  const results = raw.results.map((hit) =>
    toRawSourceItem(hit, { sourceType: options.sourceType, sourceRole: options.sourceRole, simulated })
  );

  writeLog({
    requested_provider: requestedProviderId,
    used_provider: provider.id,
    fallback: usedFallback,
    query,
    source_type: options.sourceType || null,
    result_count: results.length,
    duration_ms: durationMs,
    created_at: nowIso(),
  });

  return { results, usage: raw.usage || {}, provider: provider.id };
}

module.exports = {
  search,
  resolveProviderId,
  getProvider,
  providerIds: Object.keys(PROVIDERS),
};
