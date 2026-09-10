/**
 * mock-provider.js
 *
 * APIキー不要の擬似プロバイダー。Task8で作成した`simulate-ai-analysis.js`
 * （ルールベースのシミュレーション）をそのまま利用する（Task11 Task5:
 * simulate-ai-analysis.jsは削除せず、役割をこのファイルへ移管する）。
 *
 * 他のprovider（openai/deepseek/qwen）と同じ`callRaw()`インタフェースを実装することで、
 * llm-client.jsは呼び出し元から見てmockも実LLMも区別なく扱える。
 * 実際にはプロンプト文字列（systemPrompt/userPrompt）を使わず、`context`を直接
 * `simulateAiAnalysis()`に渡す点だけが他のproviderと異なる（API課金が発生しないため）。
 */

const { simulateAiAnalysis } = require("../simulate-ai-analysis");

const PRICING = {
  inputPerMillion: 0,
  outputPerMillion: 0,
  currency: "USD",
  asOf: "—",
  note: "ローカルのルールベース処理のため課金は発生しない。",
};

/** @returns {boolean} mockは常に利用可能 */
function isConfigured() {
  return true;
}

/**
 * 文字数からおおまかなトークン数を見積もる（日本語混在テキストのため厳密ではない）。
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

/**
 * @param {{context:Object, systemPrompt:string, userPrompt:string, opportunityTheme?:string}} args
 * @returns {Promise<{content:string, usage:{input_tokens:number, output_tokens:number}}>}
 */
async function callRaw({ context, userPrompt, opportunityTheme }) {
  const analysis = simulateAiAnalysis(context);
  // 【Phase56 STEP9】採用テーマ固定モード。mock はルールベースでプロンプトを読まないため、
  // 実 LLM がプロンプト制約に従うのと同じ結果（title == 指定テーマ）をここで再現する。
  const freeOpportunity = opportunityTheme
    ? { ...analysis.free_opportunity, title: opportunityTheme }
    : analysis.free_opportunity;
  const content = JSON.stringify({
    free_opportunity: freeOpportunity,
    locked_opportunities: analysis.locked_opportunities,
    paid_analysis: analysis.paid_analysis,
  });

  return {
    content,
    usage: {
      input_tokens: estimateTokens(userPrompt),
      output_tokens: estimateTokens(content),
    },
  };
}

module.exports = {
  id: "mock",
  displayName: "Mock（ルールベース・APIキー不要）",
  model: "mock-rule-based-v1",
  requiresApiKey: false,
  pricing: PRICING,
  isConfigured,
  callRaw,
};
