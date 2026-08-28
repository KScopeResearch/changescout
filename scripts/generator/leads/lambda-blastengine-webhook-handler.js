/**
 * lambda-blastengine-webhook-handler.js — PJ2 AOR Phase47 STEP1: blastengine Webhook
 * （HTTP POST）を受信し、scripts/generator/leads/process-blastengine-event.js の
 * コアロジックへ渡すLambda adapter。
 *
 * 【設計方針】ロジックは一切ここに持たない。既存の`leads/process-blastengine-event.js`の
 * `processBlastengineEvent()`をそのまま呼ぶだけ（他のLambda adapterと同じ方針）。
 * 本ファイル自身の責務は、HTTPトランスポート層（メソッド確認・Basic認証・JSON parse・
 * HTTPステータス組み立て）のみ。
 *
 * 【想定イベント形式】Lambda Function URL / API Gateway HTTP API（payload format 2.0）の
 * プロキシ統合イベントを想定する:
 *   {
 *     "requestContext": { "http": { "method": "POST" } },
 *     "headers": { "authorization": "Basic <base64>", ... },
 *     "body": "<JSON文字列>",
 *     "isBase64Encoded": false
 *   }
 * REST API（payload format 1.0）互換のため、event.httpMethodもフォールバックとして
 * 受け付ける。
 *
 * 【Webhook Security（docs/strategy_v2/13_architecture.md v1.1「6. Webhook Security」参照）】
 * blastengine Webhookには署名（HMAC等）機構が提供されないため、以下3層で防御する:
 *   1. HTTPS（Lambda Function URL / API Gatewayのエンドポイント自体がHTTPSのみを提供）
 *   2. Basic認証（本ファイルで検証。環境変数 BLASTENGINE_WEBHOOK_USER /
 *      BLASTENGINE_WEBHOOK_PASSWORD。今回は環境変数「名」のみをコードへ追加し、
 *      値の設定・blastengine管理画面側でのWebhook URL登録はPhase47の対象外
 *      （AWS/blastengine変更禁止のため））
 *   3. IPホワイトリスト（blastengine Webhook送信元IP: 3.114.82.121, 35.79.248.35。
 *      本ファイルでは実装しない。AWS側（API Gateway リソースポリシー / Lambda Function
 *      URLの前段に置くCloudFront・WAF等）でのIPホワイトリスト実施を想定する。
 *      アプリケーションコード側でIP検証を持たせない理由: クライアントIPの取得方法が
 *      API Gateway/Lambda Function URL/ALB等の配線によって異なり、コード側で検証すると
 *      配線変更のたびにこのファイルの修正が必要になるため、インフラ層の責務として
 *      分離する）
 *
 * 【前提となるLambda実行環境の設定（今回はコード側のみ。実際のURL発行・環境変数設定・
 * blastengine管理画面でのWebhook URL登録は行わない）】
 *   - BLASTENGINE_WEBHOOK_USER, BLASTENGINE_WEBHOOK_PASSWORD（値は今回設定しない）
 *   - LEAD_STORE_BACKEND=s3, LEAD_STORE_S3_BUCKET, AWS_REGION（他のLambda adapterと同じ）
 */

const crypto = require("crypto");

// 【テスト容易性】プロパティアクセス（require時の分割代入をしない）にすることで、
// テスト側からprocessBlastengineEventModule.processBlastengineEventを差し替え可能にしている
// （lambda-initial-report-delivery-handler.test.js等、既存adapterのテストと同じパターン）。
const processBlastengineEventModule = require("./process-blastengine-event");

/**
 * イベントからHTTPメソッドを取り出す（Lambda Function URL/HTTP API v2優先、
 * REST API/v1形式へフォールバック）。
 * @param {Object} event
 * @returns {string|null}
 */
function extractMethod(event) {
  const v2 = event && event.requestContext && event.requestContext.http && event.requestContext.http.method;
  if (typeof v2 === "string") return v2;
  if (typeof (event && event.httpMethod) === "string") return event.httpMethod;
  return null;
}

/**
 * イベントのheadersからAuthorizationヘッダーの値を取り出す（大文字小文字を区別しない。
 * API Gateway/Lambda Function URLはヘッダー名を小文字化して渡すことが多いが、
 * 呼び出し元・テスト双方の表記ゆれを吸収する）。
 * @param {Object} event
 * @returns {string|null}
 */
function extractAuthorizationHeader(event) {
  const headers = (event && event.headers) || {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === "authorization");
  return key ? headers[key] : null;
}

/**
 * Basic認証を検証する（Pure Function寄り。環境変数の読み取りのみ副作用）。
 * タイミング攻撃を避けるため、比較にはcrypto.timingSafeEqual()を使う
 * （auth.jsの既存の資格情報比較パターンと同じ考え方）。
 * 環境変数（BLASTENGINE_WEBHOOK_USER/BLASTENGINE_WEBHOOK_PASSWORD）が未設定の場合は、
 * 誰も認証できない状態が正しい（fail closed）ため、常にfalseを返す。
 * @param {string|null} authorizationHeader
 * @returns {boolean}
 */
function isAuthorized(authorizationHeader) {
  const expectedUser = process.env.BLASTENGINE_WEBHOOK_USER;
  const expectedPassword = process.env.BLASTENGINE_WEBHOOK_PASSWORD;
  if (!expectedUser || !expectedPassword) return false;

  if (typeof authorizationHeader !== "string" || !authorizationHeader.startsWith("Basic ")) return false;

  let decoded;
  try {
    decoded = Buffer.from(authorizationHeader.slice("Basic ".length), "base64").toString("utf8");
  } catch (e) {
    return false;
  }

  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) return false;
  const providedUser = decoded.slice(0, separatorIndex);
  const providedPassword = decoded.slice(separatorIndex + 1);

  return timingSafeEqualStrings(providedUser, expectedUser) && timingSafeEqualStrings(providedPassword, expectedPassword);
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqualStrings(a, b) {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // 長さが異なるとtimingSafeEqualが例外を投げるため、長さ不一致は先にfalseで返す
  // （長さの違い自体は秘匿すべき情報ではないため、タイミング攻撃の対象外）。
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * @param {number} statusCode
 * @param {Object} bodyObj
 * @returns {{statusCode:number, headers:Object, body:string}}
 */
function jsonResponse(statusCode, bodyObj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyObj),
  };
}

/**
 * @param {Object} event - Lambda Function URL / API Gatewayのプロキシ統合イベント
 * @returns {Promise<{statusCode:number, headers:Object, body:string}>}
 */
async function handler(event) {
  const method = extractMethod(event);
  if (method !== "POST") {
    return jsonResponse(405, { ok: false, error: "method not allowed" });
  }

  // Authorizationヘッダーの値自体はログへ一切出力しない（成功・失敗いずれの場合も）。
  const authorizationHeader = extractAuthorizationHeader(event);
  if (!isAuthorized(authorizationHeader)) {
    return jsonResponse(401, { ok: false, error: "authentication failed" });
  }

  const rawBody = typeof event.body === "string" ? event.body : "";
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return jsonResponse(400, { ok: false, error: "invalid_json" });
  }

  let results;
  try {
    results = await processBlastengineEventModule.processBlastengineEvent(payload);
  } catch (e) {
    // parseBlastengineEvent()の検証エラー（payload形状が不正）はここに到達する。
    // e.messageはフィールド名・型不整合等の説明のみでPII（mailaddress等の値）を
    // 含まない設計になっている（process-blastengine-event.js参照）。
    return jsonResponse(400, { ok: false, error: e.message });
  }

  return jsonResponse(200, { ok: true, results });
}

module.exports = { handler, isAuthorized, extractMethod, extractAuthorizationHeader };
