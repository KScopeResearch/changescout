/**
 * filesystem-backend.js — report-store.js（Phase B-1〜B-3）の既定バックエンド。
 * scripts/generator/output/<company_slug>/report.json への読み書きを行う。
 *
 * company-context-store/backends/filesystem-backend.js・review/backends/filesystem-backend.jsと
 * 同型の設計（同じjson-file.js/path-safety.jsを再利用し、独自のI/Oロジックを新設しない）。
 *
 * 【重要】このバックエンドが読み書きするパス（OUTPUT_DIR/<slug>/report.json）は、
 * 既存のgenerate-company-report.js/job-engine.js（quality-check）が実際に使っている
 * report.jsonと**同じ物理ファイル**を指す（company_slugが実在のslugと一致する場合）。
 * テストでは、既存データに触れないよう必ずテスト専用のslug
 * （例: "test-report-store-poc-*"）を使うこと。
 *
 * 【readReport()のJSON不正時の挙動】company-context-store/backends/filesystem-backend.jsと
 * 同じくreadJson()（パース失敗時に例外を投げる）を使う。これは、既存のjob-engine.jsの
 * runQualityCheck()がreport.jsonの読み込み失敗を握りつぶさず例外として扱う既存挙動と一致する
 * （report.jsonが存在しない場合と、存在するが壊れている場合とで、意図的に挙動を分けている。
 * 前者はloadReport()がnullを返し、呼び出し側が「report.jsonが見つかりません」という
 * 既存の分かりやすいエラーメッセージを組み立てる。後者はreadJson()の例外がそのまま
 * 呼び出し元へ伝播する。いずれも既存のgenerate-company-report.js/job-engine.jsの
 * 呼び出し元がこれまで期待していた挙動と変わらない）。
 */

const fs = require("fs");
const path = require("path");

const { readJson, writeJson } = require("../../shared/json-file");
const { validateSlug, isWithinDir } = require("../../shared/path-safety");
const { OUTPUT_DIR } = require("../../shared/paths");

/**
 * company_slugからreport.jsonのファイルパスを安全に組み立てる
 * （company-context-store/backends/filesystem-backend.jsのcompanyContextFilePath()と
 * 同じ考え方）。
 * @param {string} slug
 * @returns {string}
 */
function reportFilePath(slug) {
  const check = validateSlug(slug);
  if (!check.ok) throw new Error(`不正なcompany_slugです: ${check.error}`);
  const filePath = path.join(OUTPUT_DIR, slug, "report.json");
  if (!isWithinDir(filePath, OUTPUT_DIR)) throw new Error("不正なcompany_slugです（パス検証に失敗しました）");
  return filePath;
}

/**
 * @param {string} slug
 * @returns {Promise<Object|null>} 存在しない場合はnull
 */
async function readReport(slug) {
  const filePath = reportFilePath(slug);
  if (!fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

/**
 * @param {string} slug
 * @param {Object} report
 * @returns {Promise<void>}
 */
async function writeReport(slug, report) {
  writeJson(reportFilePath(slug), report);
}

module.exports = { readReport, writeReport, reportFilePath };
