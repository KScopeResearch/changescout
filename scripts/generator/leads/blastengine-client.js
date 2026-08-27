/**
 * blastengine-client.js — PJ2 AOR Phase45 STEP3B: Initial AOR専用のblastengine送信クライアント。
 *
 * 【SES Client互換】`ses-client.js`と同じ公開契約（`sendEmail()`の引数・戻り値の形、
 * `escapeHtml()`・`missingEnvVars()`の存在）を実装する。`send-initial-report.js`側は
 * `options.sendEmail || client.sendEmail`という既存の依存性注入パターンをそのまま使うだけで
 * 差し替えが完結する（Phase39〜40で確定した最小差し替え方針）。
 *
 * 【対象範囲】Initial AOR専用。Weekly AOR（`send-weekly-report.js`）は引き続き`ses-client.js`を
 * 使用し、本ファイルには一切依存しない。
 *
 * 【npm依存】本プロジェクトの既存方針（npm依存を極力使わない。`ses-client.js`が自前でSigV4を
 * 実装しているのと同じ考え方）を踏襲し、Node標準の`fetch`・`crypto`のみで実装する。新規npm
 * パッケージは追加していない。
 *
 * 【要検証事項（実装時点でAPIへ一切接続していないため、公式ドキュメント本文で必ず確認すること）】
 *   - 認証トークンの正確な生成手順（`buildAuthToken()`のコメント参照。公開情報からの推測に
 *     基づく実装であり、実際のAPIへの接続確認は本Phaseの対象外）
 *   - リクエストボディの`encode`フィールドの既定値（本実装では"UTF-8"を仮定）
 *   - `headers`フィールド（List-Unsubscribe等のカスタムヘッダーをAPIへ渡す方法）の実際の
 *     フィールド名・対応可否。`docs/external-provider-confirmations.md`「2. blastengine —
 *     正式回答」ではList-Unsubscribeヘッダー付与自体は「可能」との案内があったが、APIリクエスト
 *     上の具体的なパラメータ名は今回未確認のため、本実装では`headers`というキー名で仮置きしている
 *   - `tags`（PJ2のlead_id追跡用）に相当するカスタムメタデータ機能の有無。今回は未確認のため、
 *     `sendEmail()`の引数としては受け取るが、実際のAPIリクエストへは反映していない
 *
 * これらはすべて、実際にblastengineへ接続する前（Phase45より後の実装Phase）に、
 * `https://blastengine.jp/documents/`の一次資料で確認・修正すべき事項として明記する。
 */

const crypto = require("crypto");
const { withRetryAndTimeout } = require("../shared/retry");

const TRANSACTION_API_URL = "https://app.engn.jp/api/v1/deliveries/transaction";

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RETRIES = 2;

// BLASTENGINE_REPLY_TOはSES_REPLY_TOと同じく任意（未設定時はReply-Toを付与しない）。
const REQUIRED_ENV_VARS = ["BLASTENGINE_USER_ID", "BLASTENGINE_API_KEY", "BLASTENGINE_FROM"];

/** @returns {boolean} blastengine送信に必要なアプリ設定が揃っているか */
function isConfigured() {
  return REQUIRED_ENV_VARS.every((name) => !!process.env[name]);
}

/** @returns {string[]} 不足している必須環境変数の一覧 */
function missingEnvVars() {
  return REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
}

/** @param {string} text @returns {string} */
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * 認証トークンを組み立てる（Pure Function）。blastengineサポートからの説明
 * 「ユーザIDとAPIキーを連結してSHA256ハッシュ化し、Base64エンコードする」という情報に
 * 基づく実装だが、これは公開情報からの推測であり、実際のAPI接続で検証していない
 * （このファイル冒頭「要検証事項」参照）。
 * @param {string} userId
 * @param {string} apiKey
 * @returns {string}
 */
function buildAuthToken(userId, apiKey) {
  const hashHex = crypto.createHash("sha256").update(`${userId}${apiKey}`, "utf8").digest("hex");
  return Buffer.from(hashHex, "utf8").toString("base64");
}

/**
 * blastengine APIへのリクエストヘッダーを組み立てる（Pure Function）。
 * @param {string} token
 * @returns {Object}
 */
function buildRequestHeaders(token) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Transaction APIのリクエストボディを組み立てる（Pure Function）。
 * @param {{to:string, from:string, fromName?:string, subject:string, text:string, html:string,
 *   headers?:Object}} params
 * @returns {Object}
 */
function buildSendEmailBody({ to, from, fromName, subject, text, html, headers }) {
  const body = {
    from: fromName ? { email: from, name: fromName } : { email: from },
    to,
    subject,
    text_part: text,
    html_part: html,
    encode: "UTF-8",
  };
  // 【要検証】List-Unsubscribe等のカスタムヘッダーをAPIへ渡す実際のフィールド名は未確認。
  // ここでは"headers"というキー名で仮置きしている（このファイル冒頭「要検証事項」参照）。
  if (headers && Object.keys(headers).length) {
    body.headers = headers;
  }
  return body;
}

/**
 * Transaction APIを1回呼び出す（内部関数。リトライ・タイムアウトはsendEmail()側で行う）。
 * @param {Object} bodyObj
 * @param {AbortSignal} [signal]
 * @param {{fetchImpl?:Function}} [options] - fetchImplはテスト時にfetch()を差し替えるための
 *   フック（省略時はNode標準のグローバルfetchを使う。ses-client.jsのcredentialProviderと
 *   同じ依存性注入パターン）
 * @returns {Promise<{messageId:string}>}
 */
async function callSendEmail(bodyObj, signal, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const token = buildAuthToken(process.env.BLASTENGINE_USER_ID, process.env.BLASTENGINE_API_KEY);
  const payload = JSON.stringify(bodyObj);

  const response = await fetchImpl(TRANSACTION_API_URL, {
    method: "POST",
    headers: buildRequestHeaders(token),
    body: payload,
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    let parsed = null;
    try {
      parsed = JSON.parse(errorText);
    } catch (e) {
      // JSONでない場合はerrorTextをそのままメッセージに使う
    }
    const code = (parsed && (parsed.code || parsed.error)) || null;
    const message = (parsed && parsed.message) || errorText || `HTTP ${response.status}`;
    const err = new Error(`blastengine APIエラー: HTTP ${response.status}${code ? ` (${code})` : ""} ${message}`);
    err.code = code;
    err.statusCode = response.status;
    err.retryable = response.status >= 500 || response.status === 429;
    throw err;
  }

  const data = await response.json();
  if (!data || typeof data.delivery_id === "undefined" || data.delivery_id === null) {
    throw new Error("blastengine APIのレスポンスにdelivery_idが含まれていません");
  }
  // 共通契約（messageId: string）に合わせ、blastengineの数値delivery_idを文字列化する
  // （Phase40で確定した「delivery_id → String(delivery_id)」変換）。
  return { messageId: String(data.delivery_id) };
}

/**
 * Initial AORメールを1通送信する。SES Clientのsendmail()と同じ公開契約。
 * @param {{to:string, subject:string, text:string, html:string,
 *   tags?:Array<{Name:string,Value:string}>, headers?:Object}} params - `tags`は現時点では
 *   APIリクエストへ反映していない（このファイル冒頭「要検証事項」参照）。`headers`は
 *   List-Unsubscribe等のカスタムヘッダーを想定
 * @param {{fetchImpl?:Function}} [options] - callSendEmail()と同じDIフック
 * @returns {Promise<{messageId:string}>}
 */
async function sendEmail({ to, subject, text, html, headers }, options = {}) {
  if (!isConfigured()) {
    throw new Error(`blastengine送信に必要な環境変数が設定されていません: ${missingEnvVars().join(", ")}`);
  }

  const bodyObj = buildSendEmailBody({
    to,
    from: process.env.BLASTENGINE_FROM,
    subject,
    text,
    html,
    headers,
  });

  return withRetryAndTimeout((signal) => callSendEmail(bodyObj, signal, options), {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
    label: "blastengine Transaction API",
  });
}

module.exports = {
  isConfigured,
  missingEnvVars,
  sendEmail,
  escapeHtml,
  // テスト・内部検証用に公開
  buildAuthToken,
  buildRequestHeaders,
  buildSendEmailBody,
  callSendEmail,
};
