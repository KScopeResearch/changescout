/**
 * deepseek-provider.js
 *
 * DeepSeek API（OpenAI互換のchat completionsエンドポイント）を叩くprovider実装。
 * 低コスト高性能AIとしてユーザーが優先的に使いたいprovider（Task11 Task2）。
 * llm-client.jsが要求する共通インタフェースを実装する。
 *
 * 【重要】このファイルはAPIキーなしでは実行できず、本プロジェクトでは実際に呼び出して
 * いない（プロジェクトルール: 有料外部サービスのAPIキーは設定しない）。コードとしては
 * 実際にDeepSeek APIへ接続できる想定で実装しているが、Task11時点では未検証（動作未確認）。
 * DEEPSEEK_API_KEYが環境変数に設定されていれば、ユーザー自身の判断・費用負担で有効化できる。
 *
 * モデル名・料金はDeepSeek側の都合で頻繁に変わるため、`DEEPSEEK_MODEL`環境変数で
 * 上書き可能にしている。デフォルトは互換性重視で`"deepseek-chat"`（DeepSeekが
 * 提供する「最新モデルへのエイリアス」）としているが、このエイリアス名が使えなくなった
 * 場合は`DEEPSEEK_MODEL`を実際のモデルID（例: 最新のV系モデル名）に明示的に設定すること。
 * 料金（`pricing`）も同様に目安であり、使用前に公式pricingページで要確認。
 */

const ENDPOINT = "https://api.deepseek.com/chat/completions";
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

const PRICING = {
  inputPerMillion: 0.14,
  outputPerMillion: 0.28,
  currency: "USD",
  asOf: "2026-08時点の目安（cache miss想定、cache hit時はさらに安価）",
  note: "要最新確認: https://api-docs.deepseek.com/quick_start/pricing 。モデル名の変更・retireに伴い価格帯も変わりうる。",
};

/** @returns {boolean} */
function isConfigured() {
  return !!process.env.DEEPSEEK_API_KEY;
}

/**
 * @param {{systemPrompt:string, userPrompt:string, timeoutMs:number, signal:AbortSignal}} args
 * @returns {Promise<{content:string, usage:{input_tokens:number|null, output_tokens:number|null}}>}
 */
async function callRaw({ systemPrompt, userPrompt, signal }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY が設定されていません");
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
    throw new Error(`DeepSeek API エラー: HTTP ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) {
    throw new Error("DeepSeek APIのレスポンスにcontentが含まれていません");
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
  id: "deepseek",
  displayName: "DeepSeek",
  model: MODEL,
  requiresApiKey: true,
  pricing: PRICING,
  isConfigured,
  callRaw,
};
