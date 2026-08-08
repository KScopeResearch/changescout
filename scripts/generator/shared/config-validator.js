/**
 * config-validator.js
 *
 * Task21: 起動時・CLI実行前に環境変数設定を検証するための共通モジュール。
 *
 * 【設計方針】LLM_PROVIDER/SEARCH_PROVIDER別に必要なAPIキー名をこのファイルへ
 * 新たにハードコードすることはしていない。llm-client.js・search-client.jsは
 * すでにprovider抽象化（`resolveProviderId()`・`getProvider(id)`・
 * provider.requiresApiKey・provider.isConfigured()）を持っており、providerごとに
 * 必要なキーが変わる、という要件はその既存の仕組みがそのまま満たす。
 * ここでは「今選ばれているproviderが実行可能な状態か」を判定するだけで、
 * provider追加時にもこのファイルの変更は不要（重複実装を避けるための設計）。
 *
 * secret値（APIキーそのもの）は一切ログ・メッセージに含めない。変数名と
 * provider idのみを扱う。
 */

const llmClient = require("../llm/llm-client");
const searchClient = require("../search/search-client");

const ADMIN_REQUIRED_VARS = ["ADMIN_USER", "ADMIN_PASSWORD"];

/**
 * 指定した環境変数名がすべて設定されているかを検証する。
 * @param {string[]} names
 * @returns {{ok:boolean, missing:string[]}}
 */
function checkRequiredVars(names) {
  const missing = names.filter((name) => !process.env[name]);
  return { ok: missing.length === 0, missing };
}

/**
 * llm-client.js/search-client.js共通: 現在選択されているproviderが
 * 実行可能な状態かを検証する。
 *
 * mock provider（既定値、APIキー不要）は常にok。非mock providerが選ばれている場合のみ、
 * provider.requiresApiKey && !provider.isConfigured() を見る。
 *
 * @param {{resolveProviderId:()=>string, getProvider:(id?:string)=>Object}} client
 * @param {{kind:string, envVarName:string}} meta - kind: 表示用ラベル(例:"LLM")、
 *   envVarName: provider切替に使う環境変数名（例:"LLM_PROVIDER"）
 * @param {"error"|"warn"} levelWhenMissing - APIキー未設定時の重大度
 *   （llm-client.jsは未設定だと実行時に例外を投げるためerror、
 *   search-client.jsは自動的にmockへフォールバックする設計のためwarnとする。
 *   ここでもsearch-client.jsの既存フォールバック挙動を変更しない）
 * @returns {{ok:boolean, level:"info"|"warn"|"error", providerId:string, message:string}}
 */
function checkProviderConfig(client, meta, levelWhenMissing) {
  const providerId = client.resolveProviderId();

  if (providerId === "mock") {
    return { ok: true, level: "info", providerId, message: `${meta.kind} provider: mock（APIキー不要）` };
  }

  let provider;
  try {
    provider = client.getProvider(providerId);
  } catch (err) {
    return { ok: false, level: "error", providerId, message: err.message };
  }

  if (provider.requiresApiKey && !provider.isConfigured()) {
    return {
      ok: false,
      level: levelWhenMissing,
      providerId,
      message:
        `${meta.envVarName}=${providerId}（${provider.displayName}）が指定されていますが、` +
        `対応するAPIキー環境変数が設定されていません。詳細はscripts/generator/README.mdを参照してください。`,
    };
  }

  return { ok: true, level: "info", providerId, message: `${meta.kind} provider: ${provider.displayName}（設定OK）` };
}

/** @returns {{ok:boolean, level:string, providerId:string, message:string}} */
function checkLlmConfig() {
  // llm-client.js: APIキー未設定の非mock providerはgenerateAnalysis()実行時に例外を投げる
  // （分析結果の信頼性に直結するため）設計なので、ここでもerror扱いにする。
  return checkProviderConfig(llmClient, { kind: "LLM", envVarName: "LLM_PROVIDER" }, "error");
}

/** @returns {{ok:boolean, level:string, providerId:string, message:string}} */
function checkSearchConfig() {
  // search-client.js: APIキー未設定の非mock providerは自動的にmockへフォールバックする
  // （エラーにしない）既存設計なので、ここでは警告(warn)にとどめ、起動をブロックしない。
  return checkProviderConfig(searchClient, { kind: "検索", envVarName: "SEARCH_PROVIDER" }, "warn");
}

/**
 * Review Dashboard（website/aor-admin）の管理者認証に必要な環境変数を検証する。
 * @returns {{ok:boolean, level:"info"|"error", providerId:null, message:string}}
 */
function checkAdminConfig() {
  const { ok, missing } = checkRequiredVars(ADMIN_REQUIRED_VARS);
  return {
    ok,
    level: ok ? "info" : "error",
    providerId: null,
    message: ok
      ? "管理画面認証: ADMIN_USER/ADMIN_PASSWORD 設定OK"
      : `環境変数 ${missing.join(", ")} が設定されていません。Review Dashboardは認証なしでの起動を許可していません。`,
  };
}

/**
 * すべての設定チェックをまとめて実行する。
 * @returns {{ok:boolean, results:Array<{ok:boolean, level:string, providerId:?string, message:string}>}}
 */
function checkAll() {
  const results = [checkAdminConfig(), checkLlmConfig(), checkSearchConfig()];
  const hasError = results.some((r) => r.level === "error");
  return { ok: !hasError, results };
}

/**
 * checkAll()/個別チェックの結果配列を、人間が読める複数行テキストに整形する。
 * @param {Array<{level:string, message:string}>} results
 * @returns {string}
 */
function formatReport(results) {
  return results.map((r) => `  [${r.level.toUpperCase()}] ${r.message}`).join("\n");
}

module.exports = {
  ADMIN_REQUIRED_VARS,
  checkRequiredVars,
  checkLlmConfig,
  checkSearchConfig,
  checkAdminConfig,
  checkAll,
  formatReport,
};
