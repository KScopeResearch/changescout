/**
 * lead-api-handler.js — PJ2 AOR Phase49 STEP6: website/aor-lead-api/server.js を AWS Lambda
 * （Function URL）から実行するための薄いアダプター。
 *
 * 【背景】受信者向け静的サイト（website/aor/）の配信停止ページ（unsubscribe.html）・
 * Phase4-A/B リンク（weekly-report-consent / paid-report-request）・公開フォーム（POST /api/leads）は
 * すべて `LEAD_API_BASE_URL` の HTTP エンドポイントへ fetch する設計だが、そのエンドポイントは
 * これまで本番へデプロイされていなかった（`common.js` の `LEAD_API_BASE_URL` は
 * `http://localhost:4700` のプレースホルダのまま）。このため、メール内の配信停止リンク／
 * `List-Unsubscribe` を辿っても実際の配信停止まで到達しなかった（Initial=blastengine /
 * Weekly=SES いずれも同じ）。
 *
 * 【設計方針】ロジック・ルーティングは一切ここに持たない。`server.js` から独立させた
 * `requestListener(req, res)` をそのまま呼ぶだけ（blastengine-webhook-handler.js と同じ
 * 「薄い HTTP アダプター」方針）。Lambda 実行環境と Node の http サーバの差分だけをこの
 * ファイルが吸収する:
 *   - Function URL v2 イベント → 最小限の req（EventEmitter、body を1チャンクで emit）
 *   - 応答収集用の res シム（setHeader / writeHead / end / headersSent）
 *   - クライアント IP は `requestContext.http.sourceIp`（`req.socket.remoteAddress` へ流す。
 *     `server.js` の `clientIp()` がこれを参照する）
 *
 * 【前提となる Lambda 実行環境の設定（コード側のみ。実際の Lambda 作成・Function URL 発行・
 * common.js の LEAD_API_BASE_URL 書き換え・サイトの再デプロイは本 STEP では行わない）】
 *   - LEAD_STORE_BACKEND=s3, LEAD_STORE_S3_BUCKET, AWS_REGION（他の Lambda adapter と同じ）
 *   - LEAD_API_ALLOWED_ORIGINS：配信サイトの Origin（例: https://d261eor7y01afd.cloudfront.net,
 *     https://aor.changescout.jp）をカンマ区切りで設定
 *   - AuthType=NONE の Function URL を想定（本 API は元々「匿名の公開エンドポイント」設計。
 *     token 検証・レート制限・入力検証・consent 必須化が防御。認証セッションは要求しない）
 *
 * 【既知の Lambda 環境上の制約（次 STEP のデプロイ設計で対応方針を決める）】
 *   - `leads-audit.jsonl` への追記はバンドル（読み取り専用）配下のため失敗するが、
 *     `logLeadEvent()` は失敗を握りつぶす設計であり、配信停止自体は Lead.history へ記録される
 *   - `rate-limit.js` はプロセス内メモリのため、コールドスタート・同時実行インスタンス間で
 *     共有されない（低頻度の配信停止/consent エンドポイントでは許容。主防御ではない）
 */

const { EventEmitter } = require("events");

// website/aor-lead-api/server.js の配置は、ローカル開発（リポジトリ相対）と Lambda デプロイ
// パッケージ（次 STEP で ZIP レイアウトを確定）で異なりうるため、候補パスを順に試す。
// blastengine-webhook-handler.js のように scripts/generator/ 配下だけで完結しない
// （server.js は website/ 配下）ため、この Lambda 用パッケージは website/aor-lead-api/ を
// 同梱する必要がある。詳細は本ファイル冒頭コメントと Phase49 STEP6 の報告参照。
const LEAD_API_CANDIDATES = [
  "../../../website/aor-lead-api/server", // リポジトリ相対（ローカル開発・テスト）
  "../../website/aor-lead-api/server", // ZIP: scripts/generator/ を剥がし website/ を同階層に置いた場合
  "../website/aor-lead-api/server", // ZIP: lambda/ を root、website/ を同階層に置いた場合
  "./aor-lead-api/server", // ZIP: lambda/ 配下へ同梱した場合
];
let leadApi = null;
let lastRequireError = null;
for (const p of LEAD_API_CANDIDATES) {
  try {
    leadApi = require(p);
    break;
  } catch (e) {
    lastRequireError = e;
  }
}
if (!leadApi) {
  throw new Error(
    `lead-api-handler: website/aor-lead-api/server の解決に失敗しました（試行: ${LEAD_API_CANDIDATES.join(", ")}）: ${
      lastRequireError && lastRequireError.message
    }`
  );
}

/** @param {Object} event Function URL v2 / API Gateway HTTP API payload format 2.0 */
function extractMethod(event) {
  const v2 = event && event.requestContext && event.requestContext.http && event.requestContext.http.method;
  if (typeof v2 === "string") return v2;
  if (typeof (event && event.httpMethod) === "string") return event.httpMethod;
  return "GET";
}

/** @param {Object} event @returns {string} path + `?` + query（server.js が `new URL(req.url, ...)` で解釈する） */
function extractUrl(event) {
  const rawPath = (event && (event.rawPath || event.path)) || "/";
  const rawQuery = (event && event.rawQueryString) || "";
  return rawQuery ? `${rawPath}?${rawQuery}` : rawPath;
}

/** @param {Object} event @returns {Object} 小文字キーのヘッダー（v2 は既に小文字。念のため正規化） */
function extractHeaders(event) {
  const out = {};
  const src = (event && event.headers) || {};
  for (const k of Object.keys(src)) out[k.toLowerCase()] = src[k];
  return out;
}

/** @param {Object} event @returns {Buffer} */
function extractBody(event) {
  if (!event || event.body == null) return Buffer.alloc(0);
  return event.isBase64Encoded ? Buffer.from(event.body, "base64") : Buffer.from(String(event.body), "utf8");
}

/**
 * server.js の requestListener(req, res) が必要とする最小限の req/res シムを組み立てる。
 * @param {Object} event
 * @returns {{req:Object, res:Object, done:Promise<{statusCode:number, headers:Object, body:string}>}}
 */
function buildReqRes(event) {
  const method = extractMethod(event);
  const headers = extractHeaders(event);
  const bodyBuf = extractBody(event);
  const sourceIp =
    (event && event.requestContext && event.requestContext.http && event.requestContext.http.sourceIp) ||
    headers["x-forwarded-for"] ||
    "unknown";

  const req = new EventEmitter();
  req.method = method;
  req.url = extractUrl(event);
  req.headers = headers;
  req.socket = { remoteAddress: sourceIp };
  req.destroy = () => {
    req.emit("end");
  };
  // requestListener が req.on("data"/"end") を登録した後にストリームを流す。
  process.nextTick(() => {
    if (bodyBuf.length) req.emit("data", bodyBuf);
    req.emit("end");
  });

  let statusCode = 200;
  const resHeaders = {};
  const chunks = [];
  let ended = false;
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));

  const res = {
    get headersSent() {
      return ended;
    },
    setHeader(name, value) {
      resHeaders[String(name).toLowerCase()] = value;
    },
    getHeader(name) {
      return resHeaders[String(name).toLowerCase()];
    },
    removeHeader(name) {
      delete resHeaders[String(name).toLowerCase()];
    },
    writeHead(code, maybeHeaders) {
      statusCode = code;
      if (maybeHeaders && typeof maybeHeaders === "object") {
        for (const k of Object.keys(maybeHeaders)) resHeaders[k.toLowerCase()] = maybeHeaders[k];
      }
      return res;
    },
    write(chunk) {
      if (chunk != null) chunks.push(Buffer.from(chunk));
      return true;
    },
    end(chunk) {
      if (chunk != null) chunks.push(Buffer.from(chunk));
      if (ended) return;
      ended = true;
      resolveDone({
        statusCode,
        headers: resHeaders,
        body: Buffer.concat(chunks).toString("utf8"),
      });
    },
  };

  return { req, res, done };
}

/**
 * @param {Object} event - Lambda Function URL / API Gateway HTTP API のプロキシ統合イベント
 * @returns {Promise<{statusCode:number, headers:Object, body:string}>}
 */
async function handler(event) {
  const { req, res, done } = buildReqRes(event || {});
  try {
    await leadApi.requestListener(req, res);
  } catch (e) {
    // requestListener 内部で捕捉されなかった想定外例外のみここへ到達する
    // （server.js は各ルートで try/catch し 500 を返す設計のため、通常は来ない）。
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "サーバー内部でエラーが発生しました" }));
    }
  }
  return done;
}

module.exports = { handler, buildReqRes };
