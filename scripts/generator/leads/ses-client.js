/**
 * ses-client.js — PJ2 Phase3本体: Amazon SES（SESv2 SendEmail API）への送信クライアント。
 *
 * 【調査結果に基づく設計判断】本プロジェクトはnpm依存パッケージを極力使用しない方針
 * （README.md）だが、`@aws-sdk/client-s3`（Lead永続化のS3バックエンド専用）だけは既存の
 * 例外として導入済み。SESについても、SESv2 SendEmail REST APIへの`fetch()`呼び出しと
 * SigV4署名は引き続き自前実装のまま維持し、AWS SDKのSESクライアント自体
 * （`@aws-sdk/client-sesv2`等）は導入していない。SigV4署名ロジックの正しさは、AWS公式
 * ドキュメントが公開している既知のテストベクタ（署名鍵導出の例）に対する単体テスト
 * （test/ses-client.test.js）で検証している。PJ2次工程で、認証情報の取得元のみ
 * `@aws-sdk/client-s3`の依存として既に存在する`@aws-sdk/credential-provider-node`を
 * 明示依存化して利用するようにした（詳細は下記「認証情報の取得元」参照）。
 *
 * 【必要な環境変数】（既存のQWEN_API_KEY等と同じ「providerごとの環境変数」パターンを踏襲）
 *   - AWS_REGION（必須）
 *   - SES_FROM（必須。SESで検証済みの送信元メールアドレス。ユーザー指定の慣例名をそのまま採用）
 *   - SES_REPLY_TO（任意。未設定時はReply-Toヘッダーを付与しない）
 *
 * 【PJ2次工程: 認証情報の取得元をAWS SDK credential provider chainへ移行】
 * 署名処理（SigV4）自体は変更していない（引き続き自前実装、下記参照）。変更したのは
 * 「署名に使うaccessKeyId/secretAccessKey/sessionTokenをどこから取得するか」のみ。
 * 従来は`process.env.AWS_ACCESS_KEY_ID`等を直接読んでいたが、これだとIAM Identity Center
 * のSSOセッション（`AWS_PROFILE`経由）や一時credentialに対応できない
 * （`leads/backends/s3-backend.js`が`@aws-sdk/client-s3`のcredential provider chainに
 * 委ねることでSSOにそのまま対応できているのと対照的）。`resolveCredentials()`が
 * `@aws-sdk/credential-provider-node`の`defaultProvider()`（env→profile→SSO→IMDS等の
 * 標準チェーン、S3側と同じ解決ロジック）から取得する。環境変数`AWS_ACCESS_KEY_ID`/
 * `AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`が設定されている場合はチェーンの中で
 * 最優先されるため、旧来の長期アクセスキー運用は無変更で動作し続ける。
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
const { defaultProvider } = require("@aws-sdk/credential-provider-node");

const SERVICE = "ses";
const API_VERSION_PATH = "/v2/email/outbound-emails";

// SES自体の一時的な過負荷・ネットワーク瞬断に対する軽い再試行のみ。LLM/検索API同様の
// リトライ回数管理はプロバイダ切り替えを持たないため、環境変数化せずここに固定する
// （SES専用の環境変数をむやみに増やさない）。
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RETRIES = 2;

// PJ2次工程: AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_SESSION_TOKENはここから除外した。
// これらは「必須の環境変数」ではなく、credential provider chainが解決する複数の経路
// （env / named profile・SSO / IMDS等）のうちの1つに過ぎないため、環境変数の有無だけでは
// 「送信可能かどうか」を正しく判定できない（SSO利用時に誤ってfalse判定してしまう）。
// AWS_REGION・SES_FROMはアプリ側の必須設定として引き続き同期チェックの対象とする。
const REQUIRED_ENV_VARS = ["AWS_REGION", "SES_FROM"];

/** @returns {boolean} SES送信に必要なアプリ設定（AWS_REGION・SES_FROM）が揃っているか */
function isConfigured() {
  return REQUIRED_ENV_VARS.every((name) => !!process.env[name]);
}

/** @returns {string[]} 不足しているアプリ設定（AWS_REGION・SES_FROM）の一覧 */
function missingEnvVars() {
  return REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
}

/**
 * AWS credentialをcredential provider chain経由で解決する（I/O）。
 * @param {{credentialProvider?: () => Promise<{accessKeyId:string, secretAccessKey:string, sessionToken?:string}>}} [options] -
 *   `credentialProvider`はテスト時にchain全体を差し替えるためのフック（省略時は
 *   `@aws-sdk/credential-provider-node`の`defaultProvider()`を使う。実際のcredential解決
 *   （AWS_PROFILE・SSOトークンキャッシュ参照等）を伴うため、テストではフェイクの関数に
 *   差し替える。send-initial-report.jsのoptions.sendEmailと同じ依存性注入パターン）。
 * @returns {Promise<{accessKeyId:string, secretAccessKey:string, sessionToken?:string}>}
 */
async function resolveCredentials(options = {}) {
  const provider = options.credentialProvider || defaultProvider();
  return provider();
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
 * @param {{credentialProvider?: Function}} [options] - resolveCredentials()と同じDIフック
 * @returns {Promise<{messageId:string}>}
 */
async function callSendEmail(bodyObj, signal, options = {}) {
  const { accessKeyId, secretAccessKey, sessionToken } = await resolveCredentials(options);
  const region = process.env.AWS_REGION;

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
 * @param {{credentialProvider?: Function}} [options] - resolveCredentials()と同じDIフック
 *   （省略時はcredential provider chainをそのまま使う。既存呼び出し元との後方互換性のため
 *   第2引数は省略可能）。
 * @returns {Promise<{messageId:string}>}
 */
async function sendEmail({ to, subject, text, html, tags }, options = {}) {
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

  return withRetryAndTimeout((signal) => callSendEmail(bodyObj, signal, options), {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
    label: "SES SendEmail",
  });
}

module.exports = {
  isConfigured,
  missingEnvVars,
  resolveCredentials,
  sendEmail,
  // テスト・内部検証用に公開（SigV4署名の正しさをネットワーク非依存で検証するため）
  buildSignedRequest,
  deriveSigningKey,
  buildSendEmailBody,
  escapeHtml,
};
