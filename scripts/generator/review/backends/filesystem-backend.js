/**
 * filesystem-backend.js — review-store.js（PoC）の既定バックエンド。
 * scripts/generator/output/<company_slug>/review.json への読み書きを行う。
 *
 * leads/backends/filesystem-backend.jsと同型の設計（同じjson-file.js/path-safety.jsを
 * 再利用し、独自のI/Oロジックを新設しない）。既存のreview-engine.jsのloadReview/
 * saveReview（任意のファイルパスを直接受け取る既存API）とは別物であり、こちらは
 * company_slugという安定したidentifierを受け取る新しいI/O層である点が異なる
 * （詳細はreview-store.jsのコメント参照）。
 *
 * 【重要】このバックエンドが読み書きするパス（OUTPUT_DIR/<slug>/review.json）は、
 * 既存のreview-engine.js/review-cli.js/publish-report.js/website/aor-admin/server.jsが
 * 実際に使っているreview.jsonと**同じ物理ファイル**を指す（company_slugが実在の
 * slugと一致する場合）。PoCのテストでは、既存データに触れないよう必ずテスト専用の
 * slug（例: "test-review-store-poc-*"）を使うこと。
 */

const fs = require("fs");
const path = require("path");

const { readJson, writeJson } = require("../../shared/json-file");
const { validateSlug, isWithinDir } = require("../../shared/path-safety");
const { OUTPUT_DIR } = require("../../shared/paths");

/**
 * company_slugからreview.jsonのファイルパスを安全に組み立てる
 * （leads/backends/filesystem-backend.jsのleadFilePath()と同じ考え方）。
 * @param {string} slug
 * @returns {string}
 */
function reviewFilePath(slug) {
  const check = validateSlug(slug);
  if (!check.ok) throw new Error(`不正なcompany_slugです: ${check.error}`);
  const filePath = path.join(OUTPUT_DIR, slug, "review.json");
  if (!isWithinDir(filePath, OUTPUT_DIR)) throw new Error("不正なcompany_slugです（パス検証に失敗しました）");
  return filePath;
}

/**
 * @param {string} slug
 * @returns {Promise<Object|null>} 存在しない場合はnull
 */
async function readReview(slug) {
  const filePath = reviewFilePath(slug);
  if (!fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

/**
 * @param {string} slug
 * @param {Object} review
 * @returns {Promise<void>}
 */
async function writeReview(slug, review) {
  writeJson(reviewFilePath(slug), review);
}

module.exports = { readReview, writeReview, reviewFilePath };
