/**
 * filesystem-backend.js — company-context-store.js（PoC）の既定バックエンド。
 * scripts/generator/output/<company_slug>/company_context.json への読み書きを行う。
 *
 * leads/backends/filesystem-backend.js・review/backends/filesystem-backend.jsと同型の
 * 設計（同じjson-file.js/path-safety.jsを再利用し、独自のI/Oロジックを新設しない）。
 *
 * 【重要】このバックエンドが読み書きするパス（OUTPUT_DIR/<slug>/company_context.json）は、
 * 既存のgenerate-company-report.js/job-engine.js（search-refresh）が実際に使っている
 * company_context.jsonと**同じ物理ファイル**を指す（company_slugが実在のslugと
 * 一致する場合）。PoCのテストでは、既存データに触れないよう必ずテスト専用の
 * slug（例: "test-company-context-store-poc-*"）を使うこと。
 */

const fs = require("fs");
const path = require("path");

const { readJson, writeJson } = require("../../shared/json-file");
const { validateSlug, isWithinDir } = require("../../shared/path-safety");
const { OUTPUT_DIR } = require("../../shared/paths");

/**
 * company_slugからcompany_context.jsonのファイルパスを安全に組み立てる
 * （review/backends/filesystem-backend.jsのreviewFilePath()と同じ考え方）。
 * @param {string} slug
 * @returns {string}
 */
function companyContextFilePath(slug) {
  const check = validateSlug(slug);
  if (!check.ok) throw new Error(`不正なcompany_slugです: ${check.error}`);
  const filePath = path.join(OUTPUT_DIR, slug, "company_context.json");
  if (!isWithinDir(filePath, OUTPUT_DIR)) throw new Error("不正なcompany_slugです（パス検証に失敗しました）");
  return filePath;
}

/**
 * @param {string} slug
 * @returns {Promise<Object|null>} 存在しない場合はnull
 */
async function readCompanyContext(slug) {
  const filePath = companyContextFilePath(slug);
  if (!fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

/**
 * @param {string} slug
 * @param {Object} context
 * @returns {Promise<void>}
 */
async function writeCompanyContext(slug, context) {
  writeJson(companyContextFilePath(slug), context);
}

module.exports = { readCompanyContext, writeCompanyContext, companyContextFilePath };
