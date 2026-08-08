#!/usr/bin/env node
/**
 * run-search-experiments.js
 *
 * Task12 Task7: 会社URLを入力に、検索（デフォルトmock provider）→
 * company_context生成（merge/normalize/deduplicate/score込み）→ AI分析（llm-client.js） →
 * quality evaluation まで一気通貫で実行し、結果を
 * scripts/generator/experiments/search-results/<slug>.json に保存する。
 *
 * generate-company-report.js との違い: report.json（schema_version 2.4のフルセット）は
 * 生成せず、Task9〜Task11の各段階の統計・出力を1ファイルにまとめた「検証用サマリー」を
 * 保存する点。実運用のCLIではなく、Task12の検索連携が既存パイプラインと正しく
 * 接続されているかを確認するための実験スクリプト。
 *
 * 使い方:
 *   node scripts/generator/experiments/run-search-experiments.js [company-url]
 *   （company-url省略時は https://example.com を使用）
 *   SEARCH_PROVIDER=tavily TAVILY_API_KEY=... node ... （APIキー未設定なら自動でmockにフォールバック）
 */

const fs = require("fs");
const path = require("path");

const { buildCompanyContext } = require("../company-context");
const { buildSourcePages } = require("../simulate-ai-analysis");
const { generateAnalysis } = require("../llm/llm-client");
const { evaluateReportQuality } = require("../quality-evaluator");
const { validateReport } = require("../validate-report");
const { resolveProviderId: resolveSearchProviderId } = require("../search/search-client");

const RESULTS_DIR = path.join(__dirname, "search-results");

/**
 * URLからファイルシステムで安全に使えるslugを作る（generate-company-report.jsと同じロジック）。
 * @param {string} url
 * @returns {string}
 */
function slugFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/[^a-zA-Z0-9.-]/g, "-");
  } catch (e) {
    return "unknown-company";
  }
}

async function main() {
  const companyUrl = process.argv[2] || "https://example.com";
  const searchProviderId = resolveSearchProviderId();

  console.log(`company_context生成中: ${companyUrl}（SEARCH_PROVIDER=${searchProviderId}）`);
  const context = await buildCompanyContext(companyUrl);
  console.log(`  pipeline_stats: ${JSON.stringify(context.pipeline_stats)}`);
  console.log(
    `  source_type内訳: ${JSON.stringify(
      context.sources.reduce((acc, s) => {
        acc[s.source_type] = (acc[s.source_type] || 0) + 1;
        return acc;
      }, {})
    )}`
  );

  console.log("AI分析中（llm-client.js）");
  const analysis = await generateAnalysis(context);

  const report = {
    id: `search-experiment-${slugFromUrl(companyUrl)}`,
    meta: { schema_version: "2.4", generated_at: context.generated_at, pipeline_version: "search-experiment-v1" },
    company_profile: { name: context.sources.find((s) => s.source_type === "company")?.title || "不明" },
    source_pages: buildSourcePages(context.sources),
    free_opportunity: analysis.free_opportunity,
    locked_opportunities: analysis.locked_opportunities,
    paid_analysis: analysis.paid_analysis,
    human_review: { status: "pending_review" },
  };

  console.log("品質評価中（quality-evaluator.js）");
  const evaluation = evaluateReportQuality(report);
  report.evaluation = evaluation;
  console.log(`  スコア: ${evaluation.score}/100（grade: ${evaluation.grade} / status: ${evaluation.status}）`);

  console.log("検証中（validate-report.js。company_profile等を簡略化しているため参考情報）");
  const validation = validateReport(report);

  const summary = {
    company_url: companyUrl,
    search_provider: searchProviderId,
    llm_provider: analysis.provider,
    pipeline_stats: context.pipeline_stats,
    source_type_breakdown: context.sources.reduce((acc, s) => {
      acc[s.source_type] = (acc[s.source_type] || 0) + 1;
      return acc;
    }, {}),
    source_pages: report.source_pages,
    evaluation,
    validation_note: "簡略化したreport.json相当のため、company_profile等の必須項目チェックはエラーになる場合がある（参考情報）",
    validation_error_count: validation.errors.length,
    generated_at: new Date().toISOString(),
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = path.join(RESULTS_DIR, `${slugFromUrl(companyUrl)}.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`\n結果を保存: ${outPath}`);
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    // fetch()を経由するため、この後にprocess.exit()は呼ばずprocess.exitCodeのみ設定する
    console.error(`検索実験スクリプトが失敗しました: ${err.message}`);
    process.exitCode = 1;
  });
