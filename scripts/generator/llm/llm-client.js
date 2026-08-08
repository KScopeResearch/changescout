/**
 * llm-client.js
 *
 * Task11: 特定AIサービスに依存しないLLM抽象化レイヤー。
 * `simulate-ai-analysis.js`（Task8）を直接呼んでいた`generate-company-report.js`は、
 * 代わりに本モジュールの`generateAnalysis(context)`を呼ぶ。
 *
 * 提供する機能（Task1要件）:
 *   - provider切替（環境変数 LLM_PROVIDER、または明示的なオプション指定）
 *   - retry（指数バックオフ）
 *   - timeout（AbortController）
 *   - エラー処理（設定不備・HTTPエラー・不正JSON・形状不正を明確なエラーメッセージで報告）
 *   - token使用量取得（provider.callRaw()の戻り値から）
 *   - 推定コスト計算（provider.pricingを使用）
 *
 * provider（openai/deepseek/qwen/mock）は全て同じインタフェースを実装する:
 *   {
 *     id, displayName, model, requiresApiKey, pricing: {inputPerMillion, outputPerMillion, ...},
 *     isConfigured(): boolean,
 *     callRaw({context, systemPrompt, userPrompt, timeoutMs, signal}): Promise<{content, usage}>
 *   }
 * mock以外はcontent内にJSON文字列（free_opportunity/locked_opportunities/paid_analysisの3キー）を
 * 返すことを期待する。mockはcontextを直接使い、同じ形のJSON文字列を合成する。
 */

const fs = require("fs");
const path = require("path");

const mockProvider = require("./mock-provider");
const openaiProvider = require("./openai-provider");
const deepseekProvider = require("./deepseek-provider");
const qwenProvider = require("./qwen-provider");
const { withRetryAndTimeout } = require("../shared/retry");
const { appendJsonLine } = require("../shared/json-file");
const { PROMPTS_DIR, LOGS_DIR } = require("../shared/paths");
const { nowIso } = require("../shared/date-utils");
const { createLogger } = require("../shared/logger");
const { archiveIfOversize } = require("../shared/log-rotation"); // Task43

const logger = createLogger("llm-client");

const PROVIDERS = {
  mock: mockProvider,
  openai: openaiProvider,
  deepseek: deepseekProvider,
  qwen: qwenProvider,
};

const DEFAULT_PROVIDER_ID = "mock";
const DEFAULT_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 30000;
const DEFAULT_MAX_RETRIES = Number.isFinite(Number(process.env.LLM_MAX_RETRIES))
  ? Number(process.env.LLM_MAX_RETRIES)
  : 2;

const LOG_FILE = path.join(LOGS_DIR, "llm-usage.jsonl");
// Task43: コスト分析用途のため自動削除はしない。サイズ超過時はアーカイブのみ（Task42方針）。
const ARCHIVE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

const REQUIRED_ANALYSIS_KEYS = ["free_opportunity", "locked_opportunities", "paid_analysis"];

/**
 * LLM_PROVIDER環境変数からprovider idを決定する。未設定時はmock。
 * @returns {string}
 */
function resolveProviderId() {
  return (process.env.LLM_PROVIDER || DEFAULT_PROVIDER_ID).toLowerCase();
}

/**
 * provider idからproviderモジュールを取得する。
 * @param {string} [id] - 省略時はresolveProviderId()
 * @returns {Object} provider
 */
function getProvider(id) {
  const providerId = (id || resolveProviderId()).toLowerCase();
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new Error(
      `未知のLLM_PROVIDER: "${providerId}"。利用可能なprovider: ${Object.keys(PROVIDERS).join(", ")}`
    );
  }
  return provider;
}

/** @param {string} filename @returns {string} */
function loadPrompt(filename) {
  return fs.readFileSync(path.join(PROMPTS_DIR, filename), "utf-8");
}

/**
 * company_contextをJSONとして埋め込んだユーザープロンプトを組み立てる。
 * @param {Object} context - buildCompanyContext()の戻り値
 * @returns {string}
 */
function buildUserPrompt(context) {
  const template = loadPrompt("opportunity-generation.md");
  return (
    `${template}\n\n` +
    `## company_context（実際の入力データ。sources[]に存在する情報のみを事実として使用すること）\n\n` +
    "```json\n" +
    JSON.stringify(context, null, 2) +
    "\n```\n"
  );
}

/**
 * providerを retry + timeout でラップして呼び出す（Task18: 共通実装はshared/retry.jsへ移動。
 * ハードタイムアウトの二重保証という設計意図・エラーメッセージ形式は変更していない）。
 * @param {Object} provider
 * @param {{context:Object, systemPrompt:string, userPrompt:string}} payload
 * @param {{timeoutMs:number, maxRetries:number}} options
 * @returns {Promise<{content:string, usage:Object}>}
 */
function callWithRetryAndTimeout(provider, payload, { timeoutMs, maxRetries }) {
  return withRetryAndTimeout((signal) => provider.callRaw({ ...payload, timeoutMs, signal }), {
    timeoutMs,
    maxRetries,
    label: provider.displayName,
    onRetry: ({ attempt, maxRetries: total, message, delayMs }) =>
      logger.warn(`${provider.id} 呼び出し失敗（${attempt + 1}/${total + 1}回目): ${message} — ${delayMs}ms後に再試行`),
  });
}

/**
 * AIの応答テキストからJSONオブジェクトを取り出す。前後に説明文やコードフェンスが
 * 付与されていても、最初の"{"から最後の"}"までを抽出して救済を試みる。
 * @param {string} content
 * @returns {Object}
 */
function extractJson(content) {
  const trimmed = (content || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch (directParseError) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (fallbackParseError) {
        // フォールバックも失敗した場合は元のエラーを使って下に投げる
      }
    }
    throw new Error(`AIの出力をJSONとして解釈できませんでした: ${directParseError.message}`);
  }
}

/**
 * AI出力の最低限の形状（必須キーの存在・型）を検証する。
 * report.json全体の詳細な整合性検証はvalidate-report.jsが別途行う。
 * @param {Object} parsed
 */
function validateAnalysisShape(parsed) {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI出力がJSONオブジェクトではありません");
  }
  const missing = REQUIRED_ANALYSIS_KEYS.filter((key) => !(key in parsed));
  if (missing.length) {
    throw new Error(`AI出力に必須キーがありません: ${missing.join(", ")}`);
  }
  if (typeof parsed.free_opportunity !== "object" || parsed.free_opportunity === null) {
    throw new Error("AI出力のfree_opportunityがオブジェクトではありません");
  }
  if (!Array.isArray(parsed.locked_opportunities)) {
    throw new Error("AI出力のlocked_opportunitiesが配列ではありません");
  }
  if (typeof parsed.paid_analysis !== "object" || parsed.paid_analysis === null) {
    throw new Error("AI出力のpaid_analysisがオブジェクトではありません");
  }
}

/**
 * token使用量とprovider.pricingから推定コスト（USD）を計算する。
 * @param {{input_tokens:number|null, output_tokens:number|null}} usage
 * @param {{inputPerMillion:number, outputPerMillion:number}} pricing
 * @returns {number|null}
 */
function calculateCost(usage, pricing) {
  if (!pricing || usage.input_tokens == null || usage.output_tokens == null) return null;
  const inputCost = (usage.input_tokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (usage.output_tokens / 1_000_000) * pricing.outputPerMillion;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

/**
 * コストログを scripts/generator/logs/llm-usage.jsonl へ追記する（Task7）。
 * @param {Object} entry
 */
function writeLog(entry) {
  archiveIfOversize(LOG_FILE, ARCHIVE_SIZE_BYTES); // Task43
  appendJsonLine(LOG_FILE, entry);
}

/**
 * company_contextからAI分析結果（free_opportunity/locked_opportunities/paid_analysis）を
 * provider非依存に生成する。schema_version 2.4のsource_pages等はここでは生成しない
 * （generate-company-report.js側でbuildSourcePages()と合成する）。
 *
 * @param {Object} context - buildCompanyContext()の戻り値
 * @param {Object} [options]
 * @param {string} [options.providerId] - 明示的にproviderを指定する場合（省略時はLLM_PROVIDER環境変数）
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxRetries]
 * @returns {Promise<{free_opportunity:Object, locked_opportunities:Array, paid_analysis:Object, usage:Object, provider:Object}>}
 */
async function generateAnalysis(context, options = {}) {
  const provider = getProvider(options.providerId);

  if (provider.requiresApiKey && !provider.isConfigured()) {
    throw new Error(
      `LLM_PROVIDER=${provider.id} が指定されていますが、必要なAPIキー（環境変数）が設定されていません。` +
        `LLM_PROVIDER=mock を指定するとAPIキーなしで動作確認できます。`
    );
  }

  const systemPrompt = `${loadPrompt("system-analysis.md")}\n\n${loadPrompt("quality-rules.md")}`;
  const userPrompt = buildUserPrompt(context);

  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : DEFAULT_MAX_RETRIES;

  const startedAt = Date.now();
  const { content, usage } = await callWithRetryAndTimeout(
    provider,
    { context, systemPrompt, userPrompt },
    { timeoutMs, maxRetries }
  );
  const durationMs = Date.now() - startedAt;

  const parsed = extractJson(content);
  validateAnalysisShape(parsed);

  const normalizedUsage = {
    input_tokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null,
    output_tokens: typeof usage.output_tokens === "number" ? usage.output_tokens : null,
  };
  const estimatedCost = calculateCost(normalizedUsage, provider.pricing);

  writeLog({
    provider: provider.id,
    model: provider.model || null,
    input_tokens: normalizedUsage.input_tokens,
    output_tokens: normalizedUsage.output_tokens,
    estimated_cost: estimatedCost,
    duration_ms: durationMs,
    created_at: nowIso(),
  });

  return {
    free_opportunity: parsed.free_opportunity,
    locked_opportunities: parsed.locked_opportunities,
    paid_analysis: parsed.paid_analysis,
    usage: { ...normalizedUsage, estimated_cost: estimatedCost },
    provider: { id: provider.id, displayName: provider.displayName, model: provider.model || null },
  };
}

module.exports = {
  generateAnalysis,
  resolveProviderId,
  getProvider,
  extractJson,
  validateAnalysisShape,
  calculateCost,
  providerIds: Object.keys(PROVIDERS),
};
