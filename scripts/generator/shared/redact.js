/**
 * redact.js
 *
 * Task23: 永続ログ（job-history.jsonl・admin-audit.jsonl）へ書き込む前に、
 * APIキーらしき文字列を機械的に伏せ字にする最終防衛線。
 *
 * 【背景】本プロジェクトはこれまでmock providerのみで運用しており、実際に秘密情報が
 * ログへ漏れた事例はない。しかし、job-history.jsonlの`error`フィールドは
 * generate-company-report.js（llm-client.js/search-client.js経由）が投げた例外の
 * `message`をそのまま記録する設計であり、実LLM/検索providerのエラーメッセージには
 * 外部APIのレスポンス本文（`HTTP ${status} ${errorText}`、openai-provider.js等参照）が
 * そのまま含まれる。外部APIがエラー本文にAPIキーの一部を含めて返す可能性を完全には
 * 否定できないため、構造的な保険として導入する。
 *
 * 【非完全性の明記】正規表現ベースの簡易的な保険であり、あらゆる秘密情報の形式を
 * 検出できるわけではない。既知のprovider（OpenAI/DeepSeek/Qwen: `sk-...`、
 * Tavily: `tvly-...`）のキー接頭辞と、`Authorization: Bearer ...`、
 * `XXX_API_KEY=...`/`XXX_ACCESS_KEY=...`/`XXX_SECRET...=...`のような明示的なキー代入
 * パターンのみを対象にする。会社名・URLのスラグ等の長い文字列を無差別に伏せ字化すると
 * 運用上のデバッグ情報が失われるため、あえて汎用的な「32文字以上の英数字」のような
 * 広すぎる正則は使わない。
 *
 * 【PJ2 Phase3で追加】AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY（`ses-client.js`が使う
 * AWS認証情報）は変数名に"API_KEY"を含まない（"ACCESS_KEY"/"SECRET"）ため、既存の
 * パターンのままでは伏せ字化されなかった。ses-client.js自体はこれらの値をエラー
 * メッセージへ一切含めない構造的な保証を持つが（該当ファイルのコメント参照）、
 * 念のための多層防御として対象キーワードへ"ACCESS_KEY"/"SECRET"を追加した。
 */

// 捕捉グループを持たないパターン（マッチ全体をそのまま[REDACTED]に置き換える）
const SECRET_PATTERNS_WHOLE_MATCH = [
  /\bsk-[A-Za-z0-9_-]{8,}/g, // OpenAI/DeepSeek/Qwen(DashScope)系のキー接頭辞
  /\btvly-[A-Za-z0-9_-]{8,}/g, // Tavily系のキー接頭辞
  /Bearer\s+[A-Za-z0-9._-]{10,}/gi, // Authorizationヘッダーがエラー文言に混入した場合
];

// "XXX_API_KEY=value"/"XXX_ACCESS_KEY=value"/"XXX_SECRET...=value"形式。
// キー名（$1）は残し、値の部分だけを[REDACTED]に置き換える。
const SECRET_ASSIGNMENT_PATTERN = /([A-Za-z0-9_]*(?:API_KEY|ACCESS_KEY|SECRET)[A-Za-z0-9_]*\s*[:=]\s*)([^\s,"')}\]]{6,})/gi;

/**
 * @param {string} text
 * @returns {string} 既知の秘密情報パターンを`[REDACTED]`に置き換えたテキスト
 */
function redactSecrets(text) {
  if (typeof text !== "string" || !text) return text;
  let result = text;
  for (const pattern of SECRET_PATTERNS_WHOLE_MATCH) {
    result = result.replace(pattern, "[REDACTED]");
  }
  result = result.replace(SECRET_ASSIGNMENT_PATTERN, "$1[REDACTED]");
  return result;
}

module.exports = { redactSecrets };
