/**
 * cli-utils.js
 *
 * Task18: CLIエントリポイントの共通処理。Task23でCLI全体のエラーハンドリング方針
 * （エラー内容を表示・exitCode=1・stack traceはDEBUG時のみ）の統一先とした。
 *
 * 【重要】Node.js v24 + Windows環境で、fetch()実行後にprocess.exit()を呼ぶとlibuvの
 * ネイティブアサーション（Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)）で
 * クラッシュする既知の問題がある（Task11で発見）。fetch()を使うCLI
 * （generate-company-report.js・experiments配下のスクリプト等）のエントリポイントで
 * この回避パターン（process.exit()を使わずprocess.exitCodeを設定する）がそれぞれ
 * 個別にコメント付きで実装されていたため、ここへ共通化した。
 */

const { isDebugEnabled } = require("./logger");

/**
 * CLIのmain関数を安全に実行する。例外を捕捉し、process.exitCode = 1 を設定する
 * （process.exit()は使わない。理由は本ファイル冒頭のコメント参照）。
 * AOR_DEBUG=true（または"1"）が設定されている場合のみ、エラーメッセージに加えて
 * stack traceも表示する（Task23。通常運用では利用者に不要な内部情報を見せないため）。
 * @param {() => Promise<void>} mainFn
 * @returns {Promise<void>}
 */
async function runCli(mainFn) {
  try {
    await mainFn();
  } catch (err) {
    console.error(`\n致命的エラー: ${err.message}`);
    if (isDebugEnabled() && err.stack) {
      console.error(err.stack);
    }
    process.exitCode = 1;
  }
}

module.exports = { runCli };
