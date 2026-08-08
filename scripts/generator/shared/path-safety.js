/**
 * path-safety.js
 *
 * Task25（本番公開前の最終セキュリティ監査）: 「slug」（会社ディレクトリ名。
 * `scripts/generator/output/<slug>/`、`website/aor/data/<slug>.json`等で使われる）を
 * ユーザー入力（URLパスセグメント・CLI引数）から受け取って`path.join()`する箇所すべてに
 * 共通のパストラバーサル対策を提供する。
 *
 * 【発見の経緯】`scripts/generator/publish-report.js`（Task24）の`slug`引数検証が
 * 無かったことをTask25の監査で発見し、修正した際に切り出した。同じ
 * `path.join(OUTPUT_DIR, slug, ...)`パターンは`website/aor-admin/server.js`の
 * `loadCompany()`（Task14から存在）にも見つかったため、両方から共通で使えるよう
 * `shared/`へ配置した（重複実装を避けるため）。
 *
 * 【実際の悪用可能性についての補足】Node標準のURL/HTTPパーサは`../`のような
 * ドットセグメントをルーティングに渡す前に正規化して取り除くため、HTTP経由での
 * 悪用は実際には成立しないことをTask25で実測確認済み（詳細はdocs/final-audit-report.md
 * 参照）。ただしCLI引数（`process.argv`）はこの保護を経由しないため無防備であり、
 * また「URLパーサの内部挙動に暗黙的に依存する」設計は多層防御の観点で脆弱である。
 * そのため、呼び出し経路に関わらずこのモジュールで明示的に検証する。
 */

const path = require("path");

// 既存のslug（"example.com"・"company-01-manufacturing"・
// "sakuraba-seimitsu.example.jp"等）はいずれも英数字・ドット・ハイフンのみで
// 構成されるため、それ以外の文字は一律拒否する。
const SAFE_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * slugが安全なファイル名として使える形式かを検証する。
 * @param {string} slug
 * @returns {{ok:boolean, error?:string}}
 */
function validateSlug(slug) {
  if (!slug || typeof slug !== "string") {
    return { ok: false, error: "slugが空です" };
  }
  if (!SAFE_SLUG_PATTERN.test(slug) || slug.includes("..")) {
    return {
      ok: false,
      error: `不正なslugです（英数字・ドット・ハイフンのみ使用可、".."は使用不可）: ${JSON.stringify(slug)}`,
    };
  }
  return { ok: true };
}

/**
 * targetPathがbaseDir配下に収まっているかを確認する（多層防御。
 * website/aor-admin/server.jsのserveStatic()が元々使っていたパターンを一般化した）。
 * @param {string} targetPath
 * @param {string} baseDir
 * @returns {boolean}
 */
function isWithinDir(targetPath, baseDir) {
  const normalized = path.normalize(targetPath);
  const normalizedBase = path.normalize(baseDir + path.sep);
  return normalized === path.normalize(baseDir) || normalized.startsWith(normalizedBase);
}

module.exports = { validateSlug, isWithinDir, SAFE_SLUG_PATTERN };
