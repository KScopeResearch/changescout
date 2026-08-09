/**
 * logger.js
 *
 * Task18: 共通ロガー。DEBUG/INFO/WARN/ERRORの4段階。
 *
 * 【重要】既存CLIの「ユーザー向け出力」（generate-company-report.jsの[1/6]進捗表示、
 * review-cli.js/job-cli.jsのコマンド結果表示、validate-report.js/quality-evaluator.jsの
 * 検証結果表示など）はこのロガーに置き換えていない。それらは「CLIの出力仕様そのもの」
 * であり、フォーマットを変えると既存CLIとの互換性を損なうため（Task18の要件
 * 「既存CLIとの互換性は維持してください」）。本ロガーは、これまで各ファイルに
 * ばらばらに書かれていた console.warn/console.error（内部エラー・リトライ警告等の
 * 運用ログ）を置き換える対象として導入した。
 *
 * 使い方:
 *   const { createLogger } = require("./shared/logger");
 *   const logger = createLogger("llm-client");
 *   logger.warn("リトライします", { attempt: 1 });
 *
 * DEBUGレベルは既定で無効。AOR_DEBUG=true（または"1"）で有効化する。
 */

const LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };

function isDebugEnabled() {
  return process.env.AOR_DEBUG === "true" || process.env.AOR_DEBUG === "1";
}

/**
 * @param {"DEBUG"|"INFO"|"WARN"|"ERROR"} level
 * @param {string} scope - ログの発生源（モジュール名等）
 * @param {string} message
 * @param {Object} [extra]
 */
function log(level, scope, message, extra) {
  const minLevel = isDebugEnabled() ? LEVELS.DEBUG : LEVELS.INFO;
  if (LEVELS[level] < minLevel) return;

  const line = `[${new Date().toISOString()}] [${level}] [${scope}] ${message}`;
  const target = LEVELS[level] >= LEVELS.WARN ? console.error : console.log;
  if (extra !== undefined) {
    target(line, extra);
  } else {
    target(line);
  }
}

/**
 * scope（発生源）を固定したロガーインスタンスを作る。
 * @param {string} scope
 * @returns {{debug:Function, info:Function, warn:Function, error:Function}}
 */
function createLogger(scope) {
  return {
    debug: (message, extra) => log("DEBUG", scope, message, extra),
    info: (message, extra) => log("INFO", scope, message, extra),
    warn: (message, extra) => log("WARN", scope, message, extra),
    error: (message, extra) => log("ERROR", scope, message, extra),
  };
}

module.exports = { createLogger, isDebugEnabled, LEVELS };
