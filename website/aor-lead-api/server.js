#!/usr/bin/env node
/**
 * server.js — AOPメール回収API（PJ2 第1実装: 安全なリード保存基盤）
 *
 * website/aor（受信者向け静的LP）のメール登録フォームから将来送信される想定の
 * リード情報を、最小限の4フィールド（email, company_slug, captured_at, consent）
 * だけ保存する、独立した最小限のHTTPサーバー。Node.js標準モジュールのみで実装する
 * （npm依存なし）。今回のスコープは「保存」までであり、メール送信・営業フォロー・
 * Adminでの一覧閲覧UI・実フロントエンド配線は含まない。
 *
 * 【重要】website/aor-admin（Review Dashboard）とは完全に独立したアプリケーションである
 * （website/aor/README.mdの「website/aor-adminとwebsite/aorは完全に別アプリケーション」
 * という既存の設計方針を踏襲し、三つ目の独立コンポーネントとして追加する）。認証・
 * セッション・CSRF等、aor-adminの仕組みは一切参照・共有しない（本APIは匿名の公開
 * エンドポイントのため、そもそもログインという概念が無い）。レート制限も専用の
 * ./rate-limit.js を使い、auth.jsのログイン試行レート制限とは独立させている。
 *
 * 【最重要】メールアドレスの生ログ非出力（構造的な保証）:
 *   このファイル内でリクエストボディの`email`・生ボディ文字列を
 *   logger.*() / console.*() へ渡す処理は一切書かない。エラーメッセージは常に
 *   固定文言のみを使い、ユーザー入力を含めない。emailが書き込まれる先は
 *   leads.jsonl（保存データそのもの）だけであり、admin-audit.jsonlや
 *   leads-audit.jsonl（イベントログ、timestamp/action/company_slug/successのみ）
 *   を含め、他のいかなるログにも出力しない。shared/redact.jsはAPIキー等の秘密情報
 *   専用（emailは非対応）のため、redactに頼るのではなく「そもそも渡さない」という
 *   構造で保証する。
 *
 * 保存先: LOGS_DIR（scripts/generator/logs/）配下に leads.jsonl / leads-audit.jsonl
 * を置く。json-file.jsのappendJsonLine()は元々「ログファイル（llm-usage.jsonl等）用」
 * として設計されており、この用途にもそのまま合致する。LOGS_DIR全体はbackup.jsの
 * TARGETS（label:"logs", required:true）で既にバックアップ対象になっているため、
 * backup.js自体の変更は不要（新規ディレクトリを切る場合はTARGETSへの追記が必要だが、
 * 既存のlogs配下に置く限りは既存設定がそのまま適用される）。
 *
 * 【未実装・今回のスコープ外（意図的な見送り）】
 *   - leads.jsonlの自動アーカイブ・保持期間ポリシー: docs/email-capture-design.md
 *     （Task27）で「削除/エクスポートAPI未実装」として保留されている個人情報の
 *     保持方針そのものに関わるため、今回勝手に決めず現状維持（無制限追記）とする。
 *     leads-audit.jsonl（PIIを含まない）側はadmin-audit.jsonlと同じくTask43の
 *     archiveIfOversize()を適用する。
 *   - ハニーポット: 未実装だが、bodyから許可フィールドのみをホワイトリストで
 *     取り出して保存する構造にしているため、将来ハニーポット用フィールドを
 *     追加しても保存データ側への影響なく検知ロジックを追加できる。
 *
 * 使い方:
 *   node website/aor-lead-api/server.js
 *   （LEAD_API_PORT環境変数でポート変更可、既定4700）
 */

const http = require("http");
const path = require("path");
const { URL } = require("url");

const { validateSlug } = require("../../scripts/generator/shared/path-safety");
const { appendJsonLine } = require("../../scripts/generator/shared/json-file");
const { nowIso } = require("../../scripts/generator/shared/date-utils");
const { createLogger } = require("../../scripts/generator/shared/logger");
const { LOGS_DIR } = require("../../scripts/generator/shared/paths");
const { archiveIfOversize } = require("../../scripts/generator/shared/log-rotation");
const rateLimit = require("./rate-limit");

const logger = createLogger("aor-lead-api");

const PORT = Number(process.env.LEAD_API_PORT) || 4700;

const LEADS_PATH = path.join(LOGS_DIR, "leads.jsonl");
const LEADS_AUDIT_PATH = path.join(LOGS_DIR, "leads-audit.jsonl");
const AUDIT_ARCHIVE_SIZE_BYTES = 10 * 1024 * 1024; // admin-audit.jsonlと同じ閾値（Task43踏襲）

// このAPIは4フィールドの小さなJSONのみを受け付けるため、aor-admin/server.jsの
// readJsonBody()（1MB上限、添付データ等も想定）よりも厳しい上限にする。
const MAX_BODY_BYTES = 10_000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254; // RFC 5321の実用上の上限

// ---------------------------------------------------------------------------
// バリデーション
// ---------------------------------------------------------------------------

/**
 * @param {*} email
 * @returns {{ok:boolean, error?:string}}
 */
function validateEmail(email) {
  if (typeof email !== "string" || email.length === 0) {
    return { ok: false, error: "emailは必須です" };
  }
  if (email.length > MAX_EMAIL_LENGTH) {
    return { ok: false, error: "emailが長すぎます" };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "emailの形式が不正です" };
  }
  return { ok: true };
}

/**
 * consentは厳密なboolean trueのみを許可する（文字列"true"やtruthyな値は拒否する）。
 * 明示的な同意の記録という意味を持つフィールドのため、型の緩さを許さない。
 * @param {*} consent
 * @returns {{ok:boolean, error?:string}}
 */
function validateConsent(consent) {
  if (consent !== true) {
    return { ok: false, error: "consentはtrueである必要があります" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// HTTPユーティリティ（aor-admin/server.jsと同じパターン）
// ---------------------------------------------------------------------------

/** @param {import("http").ServerResponse} res @param {number} status @param {Object} obj */
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * リクエストボディをJSONとして読み込む。上限超過・不正JSONはrejectする。
 * トップレベルがオブジェクトでない場合（null/配列/プリミティブ）は空オブジェクトとして扱う
 * （後続のバリデーションが自然に「必須項目が無い」エラーとして処理できるようにするため）。
 * @param {import("http").IncomingMessage} req
 * @returns {Promise<Object>}
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY_BYTES) {
        tooLarge = true;
        req.destroy();
      }
    });
    req.on("end", () => {
      if (tooLarge) return reject(new Error("too_large"));
      if (!data) return resolve({});
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch (e) {
        return reject(new Error("invalid_json"));
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return resolve({});
      }
      resolve(parsed);
    });
    req.on("error", reject);
  });
}

/** @param {import("http").IncomingMessage} req @returns {string} */
function clientIp(req) {
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

/**
 * CORSヘッダーを付与する。本APIは匿名・Cookie非使用（credentialless）のエンドポイントのため、
 * Originを無条件で反映してもセッションや認証情報の窃取リスクは無い。あくまで補助的な措置
 * であり、主たる防御はレート制限・入力検証・consent必須化である
 * （PJ2実装タスクの明示的な指示: 「Origin/CORSは補助的な防御に留める」）。
 * @param {import("http").IncomingMessage} req @param {import("http").ServerResponse} res
 */
function applyCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ---------------------------------------------------------------------------
// リードイベントログ（emailを含まない。admin-audit.jsonlとは別ファイル）
// ---------------------------------------------------------------------------

/**
 * leads-audit.jsonlへ1件追記する。
 * 【構造的な保証】この関数の引数にemailを渡してはならない（呼び出し側の責任）。
 * この関数自体もemailフィールドを一切扱わない実装にしている。
 * @param {{action:string, company_slug:?string, success:boolean}} entry
 */
function logLeadEvent(entry) {
  const record = {
    timestamp: nowIso(),
    action: entry.action,
    company_slug: entry.company_slug || null,
    success: !!entry.success,
  };
  try {
    archiveIfOversize(LEADS_AUDIT_PATH, AUDIT_ARCHIVE_SIZE_BYTES); // Task43のパターンを踏襲
    appendJsonLine(LEADS_AUDIT_PATH, record);
  } catch (e) {
    logger.error(`リードイベントログの書き込みに失敗しました: ${e.message}`); // emailを含まない固定文言
  }
}

// ---------------------------------------------------------------------------
// POST /api/leads 本体
// ---------------------------------------------------------------------------

/**
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 */
async function handleCreateLead(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    logLeadEvent({ action: "lead_rejected", company_slug: null, success: false });
    if (e.message === "too_large") {
      sendJson(res, 413, { ok: false, error: "リクエストボディが大きすぎます" });
    } else {
      sendJson(res, 400, { ok: false, error: "リクエストボディが不正なJSONです" });
    }
    return;
  }

  // company_slugの検証はshared/path-safety.jsのvalidateSlug()を再利用する（重複実装しない）。
  const slugCheck = validateSlug(body.company_slug);
  const emailCheck = validateEmail(body.email);
  const consentCheck = validateConsent(body.consent);

  if (!slugCheck.ok || !emailCheck.ok || !consentCheck.ok) {
    logLeadEvent({
      action: "lead_rejected",
      company_slug: slugCheck.ok ? body.company_slug : null,
      success: false,
    });
    const error = !emailCheck.ok ? emailCheck.error : !slugCheck.ok ? slugCheck.error : consentCheck.error;
    sendJson(res, 400, { ok: false, error });
    return;
  }

  // 保存するのは以下4フィールドのみ（許可リスト方式）。bodyに含まれるそれ以外の
  // フィールド（将来のハニーポット用フィールド等）は一切保存しない。
  // captured_atはクライアント指定値を無視し、必ずサーバー側で生成する。
  const record = {
    email: body.email,
    company_slug: body.company_slug,
    captured_at: nowIso(),
    consent: true,
  };

  try {
    appendJsonLine(LEADS_PATH, record);
  } catch (e) {
    logger.error(`リード保存に失敗しました: ${e.message}`); // emailを含まない固定文言
    logLeadEvent({ action: "lead_capture_failed", company_slug: body.company_slug, success: false });
    sendJson(res, 500, { ok: false, error: "サーバー内部でエラーが発生しました" });
    return;
  }

  logLeadEvent({ action: "lead_captured", company_slug: body.company_slug, success: true });
  sendJson(res, 201, { ok: true });
}

// ---------------------------------------------------------------------------
// サーバー起動
// ---------------------------------------------------------------------------

function startServer() {
  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host}`);
    } catch (e) {
      sendJson(res, 400, { ok: false, error: "不正なリクエストです" });
      return;
    }
    applyCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname !== "/api/leads") {
      sendJson(res, 404, { ok: false, error: "not found" });
      return;
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, OPTIONS");
      sendJson(res, 405, { ok: false, error: "method not allowed" });
      return;
    }

    const ip = clientIp(req);
    if (rateLimit.isBlocked(ip)) {
      logLeadEvent({ action: "lead_rate_limited", company_slug: null, success: false });
      sendJson(res, 429, { ok: false, error: "リクエストが多すぎます。しばらく待ってから再試行してください。" });
      return;
    }
    rateLimit.recordRequest(ip);

    try {
      await handleCreateLead(req, res);
    } catch (e) {
      logger.error(`予期しないエラー: ${e.message}`); // emailを含まない固定文言
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: "サーバー内部でエラーが発生しました" });
    }
  });

  server.listen(PORT, () => {
    console.log(`AOP Lead API: http://localhost:${PORT}`);
    console.log(`  保存先: ${LEADS_PATH}`);
    console.log(`  イベントログ: ${LEADS_AUDIT_PATH}`);
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  startServer,
  validateEmail,
  validateConsent,
  PORT,
  LEADS_PATH,
  LEADS_AUDIT_PATH,
};
