/**
 * auth.js — Review Dashboard の認証・セッション・CSRF・監査ログ（Task15）。
 *
 * Node.js標準モジュールのみで実装（新規npm依存なし）。server.jsからこのモジュールの
 * 関数を呼ぶだけで済むよう、認証まわりのロジックをすべてここに集約する。
 *
 * 認証フロー:
 *   1. リクエストにセッションCookie（sid）があり、有効であればそのまま認証済みとして扱う
 *   2. なければ Authorization: Basic ヘッダーを確認する。ADMIN_USER/ADMIN_PASSWORDと
 *      一致すれば新規セッションを発行し、Set-Cookieで返す（以降はCookieのみで認証される。
 *      Basic認証のネイティブダイアログは初回ログイン時にのみ表示される）
 *   3. どちらもなければ 401 + WWW-Authenticate: Basic を返し、ブラウザに認証ダイアログを
 *      出させる
 *
 * セッションはメモリ内のMapで保持する（DB不要という要件どおり）。プロセス再起動で
 * 全セッションが失われるが、社内向け管理ツールのPhase1 MVPとして許容する。
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { appendJsonLine } = require("../../scripts/generator/shared/json-file"); // Task18: JSON読み書きの共通化
const { nowIso } = require("../../scripts/generator/shared/date-utils");
const { createLogger } = require("../../scripts/generator/shared/logger");
const { checkRequiredVars, ADMIN_REQUIRED_VARS } = require("../../scripts/generator/shared/config-validator"); // Task21
const { redactSecrets } = require("../../scripts/generator/shared/redact"); // Task23: 永続ログへの秘密情報混入対策
const { archiveIfOversize } = require("../../scripts/generator/shared/log-rotation"); // Task43

const logger = createLogger("aor-admin-auth");

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8時間
const COOKIE_NAME = "sid";

const AUDIT_LOG_PATH = path.join(__dirname, "..", "..", "scripts", "generator", "logs", "admin-audit.jsonl");
// Task43: admin-audit.jsonlは監査・セキュリティ用途のため自動削除はしない。サイズ超過時は
// アーカイブ（別ファイルへ退避）するのみで、過去のアーカイブ自体は削除しない
// （Task42のハイブリッド方式で決定した方針）。
const ARCHIVE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

/** @type {Map<string, {username:string, csrfToken:string, createdAt:number, expiresAt:number}>} */
const sessions = new Map();

// ---------------------------------------------------------------------------
// ログイン試行レート制限（Task41、Task40の設計検討に基づく）
//
// sessionsと同じくプロセス内メモリのMapで管理する（DB不要方針を維持、npm非依存）。
// IPアドレス単位（ADMIN_USER/ADMIN_PASSWORDが単一組み合わせのため、ユーザー名単位だと
// 正当な利用者を誤ってロックアウトするリスクが高くなる。詳細はTask40の設計検討参照）。
// プロセス再起動でこのMapも失われ、全IPのブロック状態がリセットされる（sessionsと同じ
// 既知の制約。社内向け管理ツールのPhase1 MVPとして許容する）。
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5分: この時間内の失敗を1回の試行群として数える
const RATE_LIMIT_MAX_ATTEMPTS = 5; // 時間窓内でこの回数失敗したらブロックする
const RATE_LIMIT_BLOCK_MS = 10 * 60 * 1000; // 10分: ブロックする期間
// 上記3値は「管理画面用途で通常利用を妨げず、総当たり試行を現実的に遅延させるバランス」
// という目安（Task40）。環境変数化はせず、SESSION_TTL_MS等と同様にコード内定数として扱う。

/** @type {Map<string, {count:number, firstAttemptAt:number, blockedUntil:number}>} */
const failedAttempts = new Map();

/**
 * 指定IPが現在ブロック中かどうかを返す。
 * `now`はテスト時に時刻を固定できるよう任意で渡せる（review-engine.jsのapprove()等と
 * 同じパターン、省略時は呼び出し時点の時刻を使う）。
 * @param {string} ip
 * @param {number} [now]
 * @returns {boolean}
 */
function isBlocked(ip, now) {
  const entry = failedAttempts.get(ip);
  return !!entry && entry.blockedUntil > (now ?? Date.now());
}

/**
 * 認証失敗を記録し、時間窓内の失敗回数が閾値に達した場合はブロックを設定する。
 * @param {string} ip
 * @param {number} [now]
 */
function recordFailedAttempt(ip, now) {
  const t = now ?? Date.now();
  const entry = failedAttempts.get(ip);

  if (!entry || t - entry.firstAttemptAt > RATE_LIMIT_WINDOW_MS) {
    // 初回の失敗、または前回の時間窓から十分に時間が経っている場合は窓をリセットする
    failedAttempts.set(ip, { count: 1, firstAttemptAt: t, blockedUntil: 0 });
    return;
  }

  entry.count += 1;
  if (entry.count >= RATE_LIMIT_MAX_ATTEMPTS) {
    entry.blockedUntil = t + RATE_LIMIT_BLOCK_MS;
  }
}

/**
 * 認証成功時に、そのIPの失敗履歴をクリアする（正しい認証情報を入力すればすぐに
 * 通常状態へ戻れるようにするため）。
 * @param {string} ip
 */
function clearFailedAttempts(ip) {
  failedAttempts.delete(ip);
}

// ---------------------------------------------------------------------------
// 環境変数（Task15要件⑨: 未設定なら起動拒否）
// ---------------------------------------------------------------------------

/**
 * ADMIN_USER/ADMIN_PASSWORDが設定されているかを検証する。未設定ならエラーメッセージを返す。
 * 認証なしでレビュー承認・却下ができてしまう状態でサーバーが立ち上がることを防ぐため、
 * 起動時に必ずチェックし、欠けていれば起動そのものを拒否する（server.js側でprocess.exit(1)）。
 *
 * 【Task21】必須環境変数名のリスト（ADMIN_REQUIRED_VARS）と実際の存在チェックは
 * scripts/generator/shared/config-validator.js（checkRequiredVars）に共通化した。
 * ここではReview Dashboard固有の案内文言を組み立てるだけで、判定ロジック自体の
 * 重複実装はしていない。
 * @returns {{ok:boolean, message:?string}}
 */
function checkRequiredEnv() {
  const { ok, missing } = checkRequiredVars(ADMIN_REQUIRED_VARS);
  if (!ok) {
    return {
      ok: false,
      message:
        `環境変数 ${missing.join(", ")} が設定されていません。Review Dashboardは人間レビューの` +
        `承認・却下を扱うため、認証なしでの起動は許可していません。` +
        `ADMIN_USER=... ADMIN_PASSWORD=... node website/aor-admin/server.js のように設定してください。`,
    };
  }
  return { ok: true, message: null };
}

// ---------------------------------------------------------------------------
// Cookie / Basic認証パース
// ---------------------------------------------------------------------------

/** @param {import("http").IncomingMessage} req @returns {Object<string,string>} */
function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return header.split(";").reduce((acc, part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return acc;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

/** @param {import("http").IncomingMessage} req @returns {{user:string, pass:string}|null} */
function parseBasicAuth(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Basic ")) return null;
  let decoded;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
  } catch (e) {
    return null;
  }
  const idx = decoded.indexOf(":");
  if (idx === -1) return null;
  return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
}

/**
 * 長さの違いから情報が漏れないよう、SHA-256ハッシュ同士をtimingSafeEqualで比較する。
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeCompare(a, b) {
  const bufA = crypto.createHash("sha256").update(String(a)).digest();
  const bufB = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// セッション管理
// ---------------------------------------------------------------------------

/**
 * 新規セッションを作成し、Mapへ登録する。
 * @param {string} username
 * @returns {{sid:string, session:Object}}
 */
function createSession(username) {
  const sid = crypto.randomBytes(32).toString("hex");
  const csrfToken = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  const session = { username, csrfToken, createdAt: now, expiresAt: now + SESSION_TTL_MS };
  sessions.set(sid, session);
  return { sid, session };
}

/**
 * リクエストのCookieから有効なセッションを取得する。期限切れは自動的に破棄する。
 * @param {import("http").IncomingMessage} req
 * @returns {{sid:string, session:Object}|null}
 */
function getSessionFromRequest(req) {
  const cookies = parseCookies(req);
  const sid = cookies[COOKIE_NAME];
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(sid);
    return null;
  }
  return { sid, session };
}

/** @param {string} sid */
function destroySession(sid) {
  sessions.delete(sid);
}

/** @param {import("http").ServerResponse} res @param {string} sid */
function setSessionCookie(res, sid) {
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${sid}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAgeSec}`);
}

/** @param {import("http").ServerResponse} res */
function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`);
}

// ---------------------------------------------------------------------------
// 認証本体
// ---------------------------------------------------------------------------

/**
 * リクエストを認証する。既存の有効なセッションがあればそれを使い、なければ
 * Authorization: Basic ヘッダーを確認して新規セッションを発行する。
 * どちらも成立しない場合は401チャレンジを送出して呼び出し元にnullを返す
 * （呼び出し元はnullが返ったら処理を中断すること）。
 *
 * 【Task41】既存の有効なセッションによる認証（上記）はレート制限の対象外
 * （既にログイン済みの利用者の通常操作を妨げないため）。新規ログイン試行
 * （Basic認証ヘッダーの検証）のみがレート制限の対象。
 *
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 * @param {{ip:string}} meta
 * @returns {{sid:string, session:Object}|null}
 */
function authenticate(req, res, meta) {
  const existing = getSessionFromRequest(req);
  if (existing) return existing;

  if (isBlocked(meta.ip)) {
    logAudit({ user: null, ip: meta.ip, action: "login_rate_limited", target: null, success: false });
    res.writeHead(401, {
      "WWW-Authenticate": 'Basic realm="AOR Review Dashboard"',
      "Content-Type": "text/plain; charset=utf-8",
    });
    res.end("401 Unauthorized: ログイン試行が多すぎるため、一時的にブロックされています。しばらく待ってから再試行してください。");
    return null;
  }

  const creds = parseBasicAuth(req);
  if (creds) {
    const adminUser = process.env.ADMIN_USER;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (safeCompare(creds.user, adminUser) && safeCompare(creds.pass, adminPassword)) {
      const { sid, session } = createSession(creds.user);
      setSessionCookie(res, sid);
      clearFailedAttempts(meta.ip);
      logAudit({ user: creds.user, ip: meta.ip, action: "login_success", target: null, success: true });
      return { sid, session };
    }
    recordFailedAttempt(meta.ip);
    logAudit({ user: creds.user, ip: meta.ip, action: "login_failed", target: null, success: false });
  } else {
    logAudit({ user: null, ip: meta.ip, action: "unauthenticated", target: req.url, success: false });
  }

  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="AOR Review Dashboard"',
    "Content-Type": "text/plain; charset=utf-8",
  });
  res.end("401 Unauthorized: Review Dashboardへのアクセスには認証が必要です。");
  return null;
}

// ---------------------------------------------------------------------------
// CSRF（Task15要件⑦: POST時のみ検証）
// ---------------------------------------------------------------------------

/**
 * POSTリクエストのCSRFトークン（X-CSRF-Tokenヘッダー）がセッションのものと一致するかを検証する。
 * @param {import("http").IncomingMessage} req
 * @param {Object} session
 * @returns {boolean}
 */
function verifyCsrf(req, session) {
  const token = req.headers["x-csrf-token"];
  if (!token || !session.csrfToken) return false;
  return safeCompare(token, session.csrfToken);
}

// ---------------------------------------------------------------------------
// 監査ログ（Task15要件⑤）
// ---------------------------------------------------------------------------

/**
 * scripts/generator/logs/admin-audit.jsonl へ1件追記する。
 *
 * 【Task23】`detail`はredactSecrets()を通してから書き込む（job-runner.jsのwriteHistory()と
 * 同じ理由。`detail`にはreview-engine.js/job-runner.js等が投げたエラーメッセージが
 * そのまま入ることがあるため、永続ファイルへの構造的な保険として適用する）。
 * @param {{user:?string, ip:?string, action:string, target:?string, success:boolean, detail?:string}} entry
 */
function logAudit(entry) {
  const record = {
    at: nowIso(),
    user: entry.user || null,
    ip: entry.ip || null,
    action: entry.action,
    target: entry.target || null,
    success: !!entry.success,
    detail: entry.detail ? redactSecrets(entry.detail) : null,
  };
  try {
    archiveIfOversize(AUDIT_LOG_PATH, ARCHIVE_SIZE_BYTES); // Task43
    appendJsonLine(AUDIT_LOG_PATH, record);
  } catch (e) {
    logger.error(`監査ログの書き込みに失敗しました: ${e.message}`);
  }
}

/** @param {import("http").IncomingMessage} req @returns {string} */
function clientIp(req) {
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

/** @param {import("http").ServerResponse} res */
function applySecurityHeaders(res) {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
}

module.exports = {
  SESSION_TTL_MS,
  COOKIE_NAME,
  AUDIT_LOG_PATH,
  checkRequiredEnv,
  authenticate,
  getSessionFromRequest,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  verifyCsrf,
  logAudit,
  clientIp,
  applySecurityHeaders,
  // Task41: ログイン試行レート制限（テストから直接呼べるよう公開する）
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_BLOCK_MS,
  isBlocked,
  recordFailedAttempt,
  clearFailedAttempts,
};
