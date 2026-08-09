/**
 * date-utils.js
 *
 * Task18: 日付関連の共通化。ISO8601の正規表現はvalidate-report.jsに個別定義されていたものを
 * ここへ移し、validate-report.jsはこちらを参照する形にした（正規表現の二重管理を避ける）。
 */

const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** @returns {string} 現在時刻のISO8601文字列 */
function nowIso() {
  return new Date().toISOString();
}

/** @param {string} value @returns {boolean} */
function isValidIso8601(value) {
  return typeof value === "string" && ISO_8601_PATTERN.test(value);
}

module.exports = { ISO_8601_PATTERN, nowIso, isValidIso8601 };
