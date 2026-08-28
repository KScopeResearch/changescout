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
 * 【Phase45 STEP3C: 公式APIドキュメント（https://blastengine.jp/documents/ のRedoc生成
 * リファレンス）を一次資料として照合し、STEP3Bの推測実装を修正した】
 *   - 認証トークン生成（`buildAuthToken()`）: 公式ドキュメント記載のシェルスクリプト例
 *     （`sha256 → 小文字化 → base64`、hex文字列をbase64化する。バイト列への変換は行わない）
 *     と実装が一致することを確認済み。**修正不要だった**
 *   - リクエストヘッダー形式（`Authorization: Bearer <token>`）: 公式記載と一致。**修正不要**
 *   - List-Unsubscribe: 公式ドキュメントにより、汎用的な`headers`キーではなく
 *     `list_unsubscribe: {mailto?, url?}`という専用フィールドであることが判明したため修正した
 *     （下記`buildSendEmailBody()`参照）。**実API検証（2026-08）で追加判明**: `list_unsubscribe.mailto`は
 *     bare email addressだとHTTP 400（`{validation.pattern.error}`）になり、`mailto:`スキーム付きの
 *     URIが必須。`normalizeMailto()`で正規化する。また実エラーレスポンスは
 *     `{"error_messages":{"<field>":{"<subfield>":["msg"]}}}`のようにネストするため、
 *     `flattenErrorMessages()`で再帰的に抽出する（旧`error_messages.main`専用実装では欠落していた）。
 *     DKIM設定必須・データサイズ目安980byte以内という
 *     公式の注意事項があるが、これらはインフラ側（DNS/SES等）の設定事項でありコード側では
 *     対応不要（本Phaseでも変更していない）
 *   - Reply-To: `reply_to: {email, name}`という専用フィールドが存在することが判明したため追加した
 *   - エラーレスポンス形式: `{"error_messages": {"main": ["メッセージ", ...]}}`であることが
 *     判明したため、エラーメッセージの抽出方法を修正した。機械可読な`code`相当のフィールドは
 *     公式ドキュメントに記載がないため、`err.code`は常に`null`とする
 *   - レート制限: 500 req/min、`X-Rate-Limit-Remaining`・`X-Rate-Limit-Retry-After-Seconds`
 *     ヘッダーで通知される。429を受け取った場合の`retryable: true`判定は既存のまま正しい
 *   - `insert_code`（配列、`{key, value}`）はメール本文内の差し込みコード（テンプレート変数の
 *     置換）用の機能であり、PJ2のlead_id追跡用メタデータ/タグとは異なる。PJ2側は本文を
 *     送信前に自前で組み立て済み（`buildEmailContent()`）のため`insert_code`は使用しない。
 *     lead_id追跡に相当するAPI機能は引き続き確認できなかったため、`tags`は`sendEmail()`の
 *     引数としては受け取るが、実際のAPIリクエストへは反映しない（STEP3Bから変更なし）
 *   - Webhook（Bounce/Complaint相当のイベント通知）: `https://blastengine.jp/webhook/`により、
 *     イベント種別は`DROP`/`SOFTERROR`/`HARDERROR`の3種類のみで、SESのような明示的な
 *     Complaint（苦情）イベントは提供されていないことが判明した。署名検証の仕組みは
 *     ドキュメントに記載がなく、リトライは最大3回。**本Phaseでは仕様確認のみ、実装はしていない**
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
 * list_unsubscribe.mailto用に"mailto:"スキームを正規化する（Pure Function）。
 * 既に"mailto:"が付いていればそのまま、bare email addressなら"mailto:"を付与する。
 * 空文字・非文字列はそのまま返す（呼び出し側のガードに委ねる）。
 * @param {string} value
 * @returns {string}
 */
function normalizeMailto(value) {
  if (typeof value !== "string" || value === "") return value;
  return /^mailto:/i.test(value) ? value : `mailto:${value}`;
}

/**
 * Transaction APIのリクエストボディを組み立てる（Pure Function）。フィールド名は
 * 公式APIドキュメント（Phase45 STEP3Cで確認）に基づく。
 * @param {{to:string, from:string, fromName?:string, replyTo?:string, replyToName?:string,
 *   subject:string, text:string, html:string, unsubscribe?:{mailto?:string, url?:string}}} params
 * @returns {Object}
 */
function buildSendEmailBody({ to, from, fromName, replyTo, replyToName, subject, text, html, unsubscribe }) {
  const body = {
    from: fromName ? { email: from, name: fromName } : { email: from },
    to,
    subject,
    text_part: text,
    html_part: html,
    encode: "UTF-8",
  };
  if (replyTo) {
    body.reply_to = replyToName ? { email: replyTo, name: replyToName } : { email: replyTo };
  }
  // 公式フィールド名は"list_unsubscribe"（{mailto?, url?}）。mailto・urlのいずれも任意。
  // 【実API検証（2026-08時点）で判明】list_unsubscribe.mailtoはbare email addressだと
  // HTTP 400 {"error_messages":{"list_unsubscribe":{"mailto":["{validation.pattern.error}"]}}}
  // となる。"mailto:"スキーム付きのURI（RFC 8058相当）でなければ受け付けない。呼び出し側は
  // bare email（例: process.env.BLASTENGINE_FROM）を渡してくるため、ここで正規化する。
  if (unsubscribe && (unsubscribe.mailto || unsubscribe.url)) {
    body.list_unsubscribe = {};
    if (unsubscribe.mailto) body.list_unsubscribe.mailto = normalizeMailto(unsubscribe.mailto);
    if (unsubscribe.url) body.list_unsubscribe.url = unsubscribe.url;
  }
  return body;
}

/**
 * blastengineの`error_messages`（配列・ネストしたオブジェクトの混在）を、人間が原因を
 * 理解できる文字列配列へ平坦化する（Pure Function）。
 *
 * 対応する形:
 *   - `{"main": ["msg", ...]}`               → `["msg", ...]`（"main"はprefixを付けない＝旧挙動を維持）
 *   - `{"list_unsubscribe": {"mailto": ["msg"]}}` → `["list_unsubscribe.mailto: msg"]`
 *   - 上記の混在、文字列単体の値、任意の深さのネスト
 *
 * APIキー・Authorizationヘッダー・Bearerトークン・リクエストボディ・PIIはこの関数の
 * 入力（サーバーが返すバリデーションメッセージのみ）に含まれないため、そのまま抽出してよい。
 * 想定外の型（数値・真偽値など）はStringに変換して取り込む。
 *
 * @param {*} errorMessages - `parsed.error_messages` 相当
 * @param {string} [pathPrefix] - 再帰用のフィールドパス
 * @returns {string[]|null}
 */
function flattenErrorMessages(errorMessages, pathPrefix = "") {
  if (errorMessages === null || typeof errorMessages !== "object") return null;

  const out = [];
  const walk = (node, path) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      node.forEach((item) => walk(item, path));
      return;
    }
    if (typeof node === "object") {
      Object.keys(node).forEach((key) => {
        walk(node[key], path ? `${path}.${key}` : key);
      });
      return;
    }
    // プリミティブ（文字列・数値・真偽値）
    const text = String(node);
    if (text === "") return;
    // "main"直下のメッセージは従来どおりprefixなし。それ以外はフィールドパスを前置する。
    out.push(path && path !== "main" ? `${path}: ${text}` : text);
  };

  walk(errorMessages, pathPrefix);
  return out.length ? out : null;
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
    // 公式エラー形式（Phase45 STEP3Cで確認）: {"error_messages": {"main": ["...", ...]}}。
    // ただし実API検証（2026-08）で、フィールド単位のバリデーションエラーは
    // {"error_messages": {"list_unsubscribe": {"mailto": ["{validation.pattern.error}"]}}}
    // のようにネストしたオブジェクトで返ることを確認した。mainだけを見る旧実装では
    // この種のエラー原因が完全に欠落するため、ネストを再帰的に平坦化して抽出する。
    // 機械可読なcode相当のフィールドはドキュメントに記載が無いため常にnullとする。
    const messages = parsed ? flattenErrorMessages(parsed.error_messages) : null;
    const message = (messages && messages.length && messages.join(" / ")) || errorText || `HTTP ${response.status}`;
    const err = new Error(`blastengine APIエラー: HTTP ${response.status} ${message}`);
    err.code = null;
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
 *   tags?:Array<{Name:string,Value:string}>, unsubscribe?:{mailto?:string, url?:string}}} params -
 *   `tags`は現時点ではAPIリクエストへ反映していない（このファイル冒頭のコメント参照。
 *   blastengineにlead_id追跡に相当するメタデータ機能は確認できていない）。`unsubscribe`は
 *   List-Unsubscribe相当（`list_unsubscribe`フィールド）を組み立てるための入力
 * @param {{fetchImpl?:Function}} [options] - callSendEmail()と同じDIフック
 * @returns {Promise<{messageId:string}>}
 */
async function sendEmail({ to, subject, text, html, unsubscribe }, options = {}) {
  if (!isConfigured()) {
    throw new Error(`blastengine送信に必要な環境変数が設定されていません: ${missingEnvVars().join(", ")}`);
  }

  const bodyObj = buildSendEmailBody({
    to,
    from: process.env.BLASTENGINE_FROM,
    replyTo: process.env.BLASTENGINE_REPLY_TO || undefined,
    subject,
    text,
    html,
    unsubscribe,
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
  normalizeMailto,
  flattenErrorMessages,
  callSendEmail,
};
