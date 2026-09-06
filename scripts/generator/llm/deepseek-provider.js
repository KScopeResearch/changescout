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

const { createLogger } = require("../shared/logger");

const logger = createLogger("deepseek-provider");

const ENDPOINT = "https://api.deepseek.com/chat/completions";
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
// PJ2 AOR: DeepSeek公式ドキュメント（JSON Outputガイド）が「JSON出力時はmax_tokensを
// 適切に設定してtruncationを防ぐこと」を明示的に推奨しているため、未指定だった状態から
// 明示指定へ変更した。8192は、実測の想定出力（mock生成でschema一式が約1,400〜2,000
// token相当）に対して十分な余裕を持たせつつ、モデル上限（384K token）に対しては
// 十分に低く抑えた値。DEEPSEEK_MAX_TOKENS環境変数で上書き可能。
const DEFAULT_MAX_TOKENS = Number(process.env.DEEPSEEK_MAX_TOKENS) || 8192;
// PJ2 AOR Test B（診断用の一時設定。本番既定値は変更しない）: DeepSeek V4 Flashは
// Thinking Modeが既定でenabled（reasoning_effort=high）であり、これがtimeoutの主要因か
// どうかを切り分けるための一時フラグ。DEEPSEEK_THINKING_DISABLED=true/1を明示指定した
// 場合のみthinkingを無効化する。未設定時は従来どおり何も送らず、DeepSeek側の既定挙動
// （thinking enabled）のまま。
//
// 【修正履歴】初回実装は`extra_body: { thinking: {...} }`という形でbodyへ追加していたが、
// `extra_body`はOpenAI公式SDK（Python/Node）が「SDKの型付き引数にない追加パラメータを
// リクエストbody直下へマージする」ためのSDK側だけの呼び出し規約であり、生のHTTP JSON
// bodyとして送っても意味を持たない（DeepSeek側が未知のフィールドとして無視する）。
// DeepSeek公式Chat Completion APIリファレンス（api-docs.deepseek.com/api/create-chat-completion/）
// で`thinking`が`model`/`messages`等と同列のトップレベルパラメータ（nullable object、
// サブフィールド`type`: "enabled"|"disabled"、既定"enabled"）であることを確認したため、
// `extra_body`でラップせずbody直下に`thinking`を直接置く形へ修正した。
const THINKING_DISABLED =
  process.env.DEEPSEEK_THINKING_DISABLED === "true" || process.env.DEEPSEEK_THINKING_DISABLED === "1";

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
      max_tokens: DEFAULT_MAX_TOKENS,
      ...(THINKING_DISABLED ? { thinking: { type: "disabled" } } : {}),
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    logger.warn("DeepSeek APIエラー応答（診断情報）", { http_status: response.status, model: MODEL });
    throw new Error(`DeepSeek API エラー: HTTP ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const choice = data.choices && data.choices[0];
  const message = choice && choice.message;
  const content = message && message.content;
  const reasoningContent = message && message.reasoning_content;
  const usage = data.usage || {};
  const reasoningTokens =
    usage.completion_tokens_details && typeof usage.completion_tokens_details.reasoning_tokens === "number"
      ? usage.completion_tokens_details.reasoning_tokens
      : null;

  // 【診断情報】プロンプト全文・content本文・Authorizationヘッダーは一切含めない。
  // HTTP status/response id/model/finish_reason/各フィールドの有無・長さ・token数のみを記録する
  // （PJ2 AOR: 前回のDeepSeek実運用テストで「content欠落」「30秒timeout」が発生した際、
  // 原因を切り分けるための生レスポンス情報が一切残っていなかったための対応）。
  const diagnostics = {
    http_status: response.status,
    response_id: data.id || null,
    response_model: data.model || null,
    finish_reason: (choice && choice.finish_reason) || null,
    has_content: !!content,
    has_reasoning_content: !!reasoningContent,
    content_length: content ? content.length : 0,
    reasoning_content_length: reasoningContent ? reasoningContent.length : 0,
    usage_prompt_tokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
    usage_completion_tokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
    usage_total_tokens: typeof usage.total_tokens === "number" ? usage.total_tokens : null,
    usage_reasoning_tokens: reasoningTokens,
  };

  if (!content) {
    logger.warn("DeepSeek応答にcontentが含まれていません（診断情報）", diagnostics);
    throw new Error("DeepSeek APIのレスポンスにcontentが含まれていません");
  }

  logger.info("DeepSeek応答を受信（診断情報）", diagnostics);

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
