/**
 * job-engine.js
 *
 * Task16 要件⑨: 既存のgenerate-company-report.js / quality-evaluator.js /
 * validate-report.js / company-context.js（search）/ review-engine.js をJob経由で
 * 呼び出すための薄いアダプタ層。ロジックの再実装はしない（既存モジュールをそのまま使う）。
 *
 * 対応するjob type（最低対応の4種類）:
 *   - generate-report : 会社URL → フルパイプライン実行（generate-company-report.js）
 *   - quality-check    : 既存report.jsonを再評価（quality-evaluator.js）
 *   - review-sync       : ダミー実装（下記コメント参照）
 *   - search-refresh    : company_context.jsonのみ再生成（company-context.js）
 */

const fs = require("fs");
const path = require("path");

const { generateCompanyReport, slugFromUrl } = require("../generate-company-report");
const { evaluateReportQuality, renderEvaluationMarkdown } = require("../quality-evaluator");
const { validateReport } = require("../validate-report");
const { buildCompanyContext } = require("../company-context");
const { readJson, writeJson } = require("../shared/json-file"); // Task18: JSON読み書きの共通化
const { OUTPUT_DIR } = require("../shared/paths"); // Task18: パス計算の共通化

/**
 * generate-report: 会社URLからフルパイプラインを実行する。
 * @param {{url:string}} params
 * @returns {Promise<Object>} { slug, reportPath, evaluation, validation }
 */
async function runGenerateReport(params) {
  if (!params || !params.url) throw new Error('generate-report job には params.url が必須です');
  const { slug, evaluation, validation, paths } = await generateCompanyReport(params.url);
  return { slug, reportPath: paths.reportPath, evaluation, validation };
}

/**
 * quality-check: 既存のreport.jsonを読み直し、quality-evaluator.jsで再評価して
 * report.evaluation・evaluation.mdを更新する。AI分析・情報収集はやり直さない
 * （品質スコアのみを再計算したい場合の軽量ジョブ）。
 * @param {{slug:string}} params
 * @returns {Promise<Object>} { slug, evaluation, validation }
 */
async function runQualityCheck(params) {
  if (!params || !params.slug) throw new Error('quality-check job には params.slug が必須です');
  const outDir = path.join(OUTPUT_DIR, params.slug);
  const reportPath = path.join(outDir, "report.json");
  if (!fs.existsSync(reportPath)) {
    throw new Error(`report.jsonが見つかりません: ${reportPath}（先にgenerate-reportジョブを実行してください）`);
  }

  const report = readJson(reportPath);
  const evaluation = evaluateReportQuality(report);
  report.evaluation = evaluation;
  writeJson(reportPath, report);

  // PJ2 AOR Phase 3-D-1: generate-company-report.jsと同じ判断（ヘッダコメント参照）。
  // evaluation.mdは開発者向けの人間可読レポートであり、データ実体は既にreport.evaluation
  // 経由でreport.json（S3対応済み）へ保存済みのため、REPORT_STORE_BACKEND=s3では生成しない。
  const evaluationMdPath = path.join(outDir, "evaluation.md");
  if ((process.env.REPORT_STORE_BACKEND || "filesystem").toLowerCase() !== "s3") {
    fs.writeFileSync(evaluationMdPath, renderEvaluationMarkdown(report, evaluation), "utf-8");
  }

  const validation = validateReport(report);
  return { slug: params.slug, evaluation, validation };
}

/**
 * review-sync: 【ダミー実装】Task14で「review.json ↔ report.json.human_review は
 * 同期しない」と最終決定している（scripts/generator/review/review-schema.md
 * 「同期方針の最終決定（Task14）」参照）。本ジョブは、将来この方針を変更する場合の
 * 拡張ポイントとして型だけ用意したもので、現時点では実際の同期処理は行わない。
 * @param {{slug:string}} params
 * @returns {Promise<Object>} { slug, synced:false, note }
 */
async function runReviewSync(params) {
  if (!params || !params.slug) throw new Error('review-sync job には params.slug が必須です');
  const outDir = path.join(OUTPUT_DIR, params.slug);
  if (!fs.existsSync(path.join(outDir, "report.json"))) {
    throw new Error(`対象companyが見つかりません: ${params.slug}`);
  }
  return {
    slug: params.slug,
    synced: false,
    note:
      "review-syncはダミー実装です。Task14でreview.json↔report.json.human_reviewを" +
      "同期しないと最終決定したため、実際の同期処理は行っていません" +
      "（scripts/generator/review/review-schema.md「同期方針の最終決定（Task14）」参照）。",
  };
}

/**
 * search-refresh: 情報収集（fetch→merge→normalize→deduplicate→score）のみをやり直し、
 * company_context.jsonを更新する。report.json・AI分析はやり直さない
 * （検索結果だけ最新化したい場合の軽量ジョブ）。
 * @param {{url:string}} params
 * @returns {Promise<Object>} { slug, contextPath, pipeline_stats }
 */
async function runSearchRefresh(params) {
  if (!params || !params.url) throw new Error('search-refresh job には params.url が必須です');
  const context = await buildCompanyContext(params.url);
  const slug = slugFromUrl(params.url);
  const outDir = path.join(OUTPUT_DIR, slug);
  const contextPath = path.join(outDir, "company_context.json");
  writeJson(contextPath, context);
  return { slug, contextPath, pipeline_stats: context.pipeline_stats };
}

const HANDLERS = {
  "generate-report": runGenerateReport,
  "quality-check": runQualityCheck,
  "review-sync": runReviewSync,
  "search-refresh": runSearchRefresh,
};

/**
 * job typeに応じたハンドラを実行する。
 * @param {string} type
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function execute(type, params) {
  const handler = HANDLERS[type];
  if (!handler) {
    throw new Error(`未知のjob type: "${type}"。利用可能: ${Object.keys(HANDLERS).join(", ")}`);
  }
  return handler(params);
}

module.exports = { execute, JOB_TYPES: Object.keys(HANDLERS) };
