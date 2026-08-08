/**
 * qwen-provider.js
 *
 * Qwen（Alibaba Cloud DashScope、OpenAI互換モード）を叩くprovider実装。
 * 低コスト高性能AIとしてユーザーが候補に挙げているprovider（Task11 Task2）。
 * llm-client.jsが要求する共通インタフェースを実装する。
 *
 * 【重要】このファイルはAPIキーなしでは実行できず、本プロジェクトでは実際に呼び出して
 * いない（プロジェクトルール: 有料外部サービスのAPIキーは設定しない）。コードとしては
 * 実際にDashScopeのOpenAI互換エンドポイントへ接続できる想定で実装しているが、
 * Task11時点では未検証（動作未確認）。QWEN_API_KEYが環境変数に設定されていれば、
 * ユーザー自身の判断・費用負担で有効化できる。
 *
 * DashScopeのOpenAI互換エンドポイントが`response_format: {type:"json_object"}`を
 * 常にサポートするとは限らないため、llm-client.js側のJSON抽出処理（```json```コード
 * フェンス除去・部分一致抽出）と組み合わせて頑健性を持たせている。
 */

const ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const MODEL = process.env.QWEN_MODEL || "qwen-plus";

const PRICING = {
  inputPerMillion: 0.4,
  outputPerMillion: 1.2,
  currency: "USD",
  asOf: "2026-08時点の目安（qwen-plus）。qwen-turboはさらに安価（目安 $0.05/$0.20）",
  note: "要最新確認: https://www.alibabacloud.com/help/en/model-studio/ 。入力サイズによって価格帯（tier）が変わる場合がある。",
};

/** @returns {boolean} */
function isConfigured() {
  return !!process.env.QWEN_API_KEY;
}

/**
 * @param {{systemPrompt:string, userPrompt:string, timeoutMs:number, signal:AbortSignal}} args
 * @returns {Promise<{content:string, usage:{input_tokens:number|null, output_tokens:number|null}}>}
 */
async function callRaw({ systemPrompt, userPrompt, signal }) {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) {
    throw new Error("QWEN_API_KEY が設定されていません");
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
    throw new Error(`Qwen(DashScope) API エラー: HTTP ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) {
    throw new Error("Qwen(DashScope) APIのレスポンスにcontentが含まれていません");
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
  id: "qwen",
  displayName: "Qwen (Alibaba DashScope)",
  model: MODEL,
  requiresApiKey: true,
  pricing: PRICING,
  isConfigured,
  callRaw,
};
