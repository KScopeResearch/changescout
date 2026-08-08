/**
 * openai-provider.js
 *
 * OpenAI Chat Completions APIを叩くprovider実装（比較用）。
 * llm-client.jsが要求する共通インタフェース（id/displayName/model/requiresApiKey/
 * pricing/isConfigured()/callRaw()）を実装する。
 *
 * 【重要】このファイルはAPIキーなしでは実行できず、本プロジェクトでは実際に呼び出して
 * いない（プロジェクトルール: 有料外部サービスのAPIキーは設定しない）。コードとしては
 * 実際にOpenAI APIへ接続できる想定で実装しているが、Task11時点では未検証（動作未確認）。
 * OPENAI_API_KEYが環境変数に設定されていれば、ユーザー自身の判断・費用負担で有効化できる。
 *
 * 料金（`pricing`）は2026年8月時点のgpt-4o-mini想定の目安値であり、正確な請求額の
 * 保証はしない。実際に予算判断へ使う前に、OpenAI公式のpricingページで最新価格を
 * 必ず確認すること。
 */

const ENDPOINT = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const PRICING = {
  inputPerMillion: 0.15,
  outputPerMillion: 0.6,
  currency: "USD",
  asOf: "2026-08時点の目安（gpt-4o-mini）",
  note: "要最新確認: https://openai.com/api/pricing/ 。バッチ・キャッシュ利用時は別料金。",
};

/** @returns {boolean} */
function isConfigured() {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * @param {{systemPrompt:string, userPrompt:string, timeoutMs:number, signal:AbortSignal}} args
 * @returns {Promise<{content:string, usage:{input_tokens:number|null, output_tokens:number|null}}>}
 */
async function callRaw({ systemPrompt, userPrompt, signal }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY が設定されていません");
  }

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`OpenAI API エラー: HTTP ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) {
    throw new Error("OpenAI APIのレスポンスにcontentが含まれていません");
  }

  const usage = data.usage || {};
  return {
    content,
    usage: {
      input_tokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
      output_tokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
    },
  };
}

module.exports = {
  id: "openai",
  displayName: "OpenAI",
  model: MODEL,
  requiresApiKey: true,
  pricing: PRICING,
  isConfigured,
  callRaw,
};
