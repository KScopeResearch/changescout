/**
 * rate-limit.js — website/aor-lead-api専用の、IPアドレスベースの独立したレート制限。
 *
 * website/aor-admin/auth.js のログイン試行レート制限（Task41）とは目的が異なるため、
 * 実装を共有・改変せず独立させている（PJ2実装タスクの明示的な指示）。
 * ログイン用は「認証失敗の回数」だけを数えるが、こちらは匿名の公開フォームに対する
 * スパム・大量送信対策のため「成功・失敗を問わず全リクエスト数」を時間窓内で数える
 * （正規の利用者が同じフォームを短時間に何度も送信することは通常想定しにくいため）。
 *
 * auth.jsのfailedAttemptsと同じく、プロセス内メモリのMapで管理する（DB不要方針を維持、
 * npm非依存）。プロセス再起動でリセットされる制約も既存実装と同じ、Phase1として許容する。
 */

const WINDOW_MS = 10 * 60 * 1000; // 10分: この時間内のリクエストを1回の試行群として数える
const MAX_REQUESTS = 5; // 時間窓内でこの回数に達したらブロックする（auth.jsのRATE_LIMIT_MAX_ATTEMPTSと同じ`>=`判定）
const BLOCK_MS = 30 * 60 * 1000; // 30分: ブロックする期間
// 上記3値は「匿名公開フォームへの通常利用（1社につき1回程度の登録）を妨げず、
// 大量送信・スクレイピング的な連投を現実的に抑制するバランス」という目安。
// auth.jsのRATE_LIMIT_*と同様、環境変数化はせずコード内定数として扱う。

/** @type {Map<string, {count:number, windowStart:number, blockedUntil:number}>} */
const requestLog = new Map();

/**
 * 指定IPが現在ブロック中かどうかを返す。
 * `now`はテスト時に時刻を固定できるよう任意で渡せる（auth.jsのisBlocked()と同じパターン）。
 * @param {string} ip
 * @param {number} [now]
 * @returns {boolean}
 */
function isBlocked(ip, now) {
  const entry = requestLog.get(ip);
  return !!entry && entry.blockedUntil > (now ?? Date.now());
}

/**
 * リクエストを1件記録し、時間窓内のリクエスト数が閾値を超えた場合はブロックを設定する。
 * 成功・失敗（バリデーションエラー等）を問わず、/api/leadsに到達したPOSTリクエストは
 * すべてここでカウントする。
 * @param {string} ip
 * @param {number} [now]
 */
function recordRequest(ip, now) {
  const t = now ?? Date.now();
  const entry = requestLog.get(ip);

  if (!entry || t - entry.windowStart > WINDOW_MS) {
    // 初回のリクエスト、または前回の時間窓から十分に時間が経っている場合は窓をリセットする
    requestLog.set(ip, { count: 1, windowStart: t, blockedUntil: 0 });
    return;
  }

  entry.count += 1;
  if (entry.count >= MAX_REQUESTS) {
    entry.blockedUntil = t + BLOCK_MS;
  }
}

module.exports = { WINDOW_MS, MAX_REQUESTS, BLOCK_MS, isBlocked, recordRequest };
