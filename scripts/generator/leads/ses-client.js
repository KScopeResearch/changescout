/**
 * ses-client.js — PJ2 Phase3本体: Amazon SES（SESv2 SendEmail API）への送信クライアント。
 *
 * 【調査結果に基づく設計判断】このプロジェクトにはpackage.jsonが存在せず、npm依存パッケージを
 * 一切使用しない方針（README.md）を貫いている。AWS SDK（aws-sdk / @aws-sdk/client-sesv2）も
 * 導入されていない。既存の外部API連携（llm/deepseek-provider.js・llm/openai-provider.js・
 * search/tavily-provider.js等）はいずれもNode標準の`fetch()`だけで直接HTTPS呼び出しを行っており、
 * 新規npm依存を追加していない。今回もこの既存方針をそのまま踏襲し、AWS SDKを追加せず、
 * `fetch()` + Node標準の`crypto`モジュールでSigV4（AWS Signature Version 4）署名を自前実装し、
 * SESv2の SendEmail REST API（`POST https://email.<region>.amazonaws.com/v2/email/outbound-emails`）
 * を直接呼び出す。SigV4署名ロジックの正しさは、AWS公式ドキュメントが公開している既知の
 * テストベクタ（署名鍵導出の例）に対する単体テスト（test/ses-client.test.js）で検証している。
 *
 * 【必要な環境変数】（既存のQWEN_API_KEY等と同じ「providerごとの環境変数」パターンを踏襲）
 *   - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION（必須。AWS標準の変数名をそのまま
 *     採用した。AWS CLI・全SDKで共通の慣例であり、本プロジェクト独自の名前を新設するより
 *     混乱が少ない）
 *   - AWS_SESSION_TOKEN（任意。一時credentialを使う場合のみ）
 *   - SES_FROM（必須。SESで検証済みの送信元メールアドレス。ユーザー指定の慣例名をそのまま採用）
 *   - SES_REPLY_TO（任意。未設定時はReply-Toヘッダーを付与しない）
 *
 * 【secretの扱い（構造的な保証）】AWS_SECRET_ACCESS_KEY等の値そのものを、エラーメッセージ・
 * ログ・例外オブジェクトのどのプロパティにも一切含めない実装にしている（そもそも文字列結合の
 * 対象にしない）。SES側から返るエラー応答本文（response body）はAWSが生成するものであり、
 * 呼び出し側のcredential値を含む設計にはなっていない（他providerのAPIキーと同様、相手が
 * 自分の入力値をエラーへ機械的に埋め込む構造ではない）。念のため、job-runner.jsの既存方針
 * （Task23）に倣い、送信失敗時のエラーメッセージは呼び出し元（send-initial-report.js）側で
 * shared/redact.jsのredactSecrets()を通してからhistoryへ保存する。
 */

const crypto = require("crypto");

const SERVICE = "ses";
const API_VERSION_PATH = "/v2/email/outbound-emails";

// SES自体の一時的な過負荷・ネットワーク瞬断に対する軽い再試行のみ。LLM/検索API同様の
// リトライ回数管理はプロバイダ切り替えを持たないため、環境変数化せずここに固定する
// （SES専用の環境変数をむやみに増やさない）。
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RETRIES = 2;

const REQUIRED_ENV_VARS = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "SES_FROM"];

/** @returns {boolean} SES送信に必要な環境変数がすべて設定されているか */
function isConfigured() {
  return REQUIRED_ENV_VARS.every((name) => !!process.env[name]);
}

/** @returns {string[]} 不足している環境変数名の一覧 */
function missingEnvVars() {
  return REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
}

// ---------------------------------------------------------------------------
// SigV4署名（AWS標準アルゴリズム、Node標準cryptoのみで実装）
// ---------------------------------------------------------------------------

/** @param {string|Buffer} key @param {string} data @returns {Buffer} */
function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

/** @param {string} data @returns {string} 16進数のSHA-256ハッシュ */
function sha256Hex(data) {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

/**
 * SigV4の署名鍵をAWS標準の4段階HMAC連鎖で導出する。
 * @param {string} secretAccessKey
 * @param {string} dateStamp - "YYYYMMDD"
 * @param {string} region
 * @param {string} service
 * @returns {Buffer}
 */
function deriveSigningKey(secretAccessKey, dateStamp, region, service) {
  const kDate = hmac("AWS4" + secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

/**
 * SigV4で署名したリクエストの各種ヘッダー・URLを組み立てる（Pure Function、I/Oなし。
 * テスト容易性のため、日時（`now`）を引数として注入できるようにしている）。
 * @param {{method:string, host:string, canonicalUri:string, payload:string,
 *   accessKeyId:string, secretAccessKey:string, sessionToken?:string, region:string, now?:Date}} params
 * @returns {{url:string, headers:Object}}
 */
function buildSignedRequest(params) {
  const { method, host, canonicalUri, payload, accessKeyId, secretAccessKey, sessionToken, region } = params;
  const now = params.now || new Date();

  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);

  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-date";
  const payloadHash = sha256Hex(payload);

  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = [algorithm, amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");

  const signingKey = deriveSigningKey(secretAccessKey, dateStamp, region, SERVICE);
  const signature = hmac(signingKey, stringToSign).toString("hex");

  const authorizationHeader =
    `${algorithm} Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers = {
    "Content-Type": "application/json",
    "X-Amz-Date": amzDate,
    Authorization: authorizationHeader,
  };
  // X-Amz-Security-Tokenはsigned headersに含めなくてもAWS側で許容される（未署名ヘッダーとして
  // 送付可能）。一時credentialを使う場合のみ付与する。
  if (sessionToken) headers["X-Amz-Security-Token"] = sessionToken;

  return { url: `https://${host}${canonicalUri}`, headers };
}

// ---------------------------------------------------------------------------
// SendEmail本体
// ---------------------------------------------------------------------------

/** @param {string} text @returns {string} */
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * SESv2 SendEmail APIのリクエストボディを組み立てる（Pure Function）。
 * @param {{to:string, from:string, replyTo?:string, subject:string, text:string, html:string,
 *   tags?:Array<{Name:string, Value:string}>}} params
 * @returns {Object}
 */
function buildSendEmailBody({ to, from, replyTo, subject, text, html, tags }) {
  const body = {
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: text, Charset: "UTF-8" },
          Html: { Data: html, Charset: "UTF-8" },
        },
      },
    },
  };
  if (replyTo) body.ReplyToAddresses = [replyTo];
  if (tags && tags.length) body.EmailTags = tags;
  return body;
}

/**
 * SESv2 SendEmail APIを1回呼び出す（内部関数。リトライ・タイムアウトはsendEmail()側で行う）。
 * @param {Object} bodyObj
 * @param {AbortSignal} [signal]
 * @returns {Promise<{messageId:string}>}
 */
async function callSendEmail(bodyObj, signal) {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION;
  const sessionToken = process.env.AWS_SESSION_TOKEN || undefined;

  const payload = JSON.stringify(bodyObj);
  const host = `email.${region}.amazonaws.com`;
  const { url, headers } = buildSignedRequest({
    method: "POST",
    host,
    canonicalUri: API_VERSION_PATH,
    payload,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    region,
  });

  const response = await fetch(url, { method: "POST", headers, body: payload, signal });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    let parsed = null;
    try {
      parsed = JSON.parse(errorText);
    } catch (e) {
      // JSONでない場合はerrorTextをそのままメッセージに使う
    }
    const code = (parsed && (parsed.__type || parsed.Type || parsed.code)) || null;
    const message = (parsed && parsed.message) || errorText || `HTTP ${response.status}`;
    const err = new Error(`SES API エラー: HTTP ${response.status}${code ? ` (${code})` : ""} ${message}`);
    err.code = code;
    err.statusCode = response.status;
    // 5xx・スロットリング系は再試行の余地がある、と後続の調査に伝えるための軽い目印
    // （このモジュール自身は再試行の要否を判断しない。send-initial-report.js側がhistoryに
    // 記録するだけの参考情報として使う）。
    err.retryable = response.status >= 500 || code === "TooManyRequestsException" || code === "ThrottlingException";
    throw err;
  }

  const data = await response.json();
  if (!data || typeof data.MessageId !== "string") {
    throw new Error("SES APIのレスポンスにMessageIdが含まれていません");
  }
  return { messageId: data.MessageId };
}

const { withRetryAndTimeout } = require("../shared/retry");

/**
 * 初期レポートメールを1通送信する。
 * @param {{to:string, subject:string, text:string, html:string, tags?:Array<{Name:string,Value:string}>}} params -
 *   `to`（宛先）以外はすべて呼び出し元が組み立てた完成形の値。fromEmailAddress/replyToは
 *   このモジュールが環境変数（SES_FROM/SES_REPLY_TO）から解決する。
 * @returns {Promise<{messageId:string}>}
 */
async function sendEmail({ to, subject, text, html, tags }) {
  if (!isConfigured()) {
    throw new Error(`SES送信に必要な環境変数が設定されていません: ${missingEnvVars().join(", ")}`);
  }

  const bodyObj = buildSendEmailBody({
    to,
    from: process.env.SES_FROM,
    replyTo: process.env.SES_REPLY_TO || undefined,
    subject,
    text,
    html,
    tags,
  });

  return withRetryAndTimeout((signal) => callSendEmail(bodyObj, signal), {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
    label: "SES SendEmail",
  });
}

module.exports = {
  isConfigured,
  missingEnvVars,
  sendEmail,
  // テスト・内部検証用に公開（SigV4署名の正しさをネットワーク非依存で検証するため）
  buildSignedRequest,
  deriveSigningKey,
  buildSendEmailBody,
  escapeHtml,
};
