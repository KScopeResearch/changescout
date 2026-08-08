#!/usr/bin/env node
/**
 * run-experiments.js
 *
 * Task11 Task8: mock/deepseek/qwen/openaiの各providerで同一のcompany_contextを分析し、
 * 結果を scripts/generator/experiments/<provider>-result.json に保存する。
 * DeepSeek/Qwen/OpenAIについては、対応するAPIキーが環境変数に設定されていない場合、
 * 実際には呼び出さず「スキップ」として記録する（本プロジェクトでは有料APIキーを
 * 設定していないため、通常はmock以外すべてスキップになる）。
 *
 * 使い方:
 *   node scripts/generator/experiments/run-experiments.js [company-url]
 *   （company-url省略時は https://example.com を使用）
 */

const fs = require("fs");
const path = require("path");

const { buildCompanyContext } = require("../company-context");
const { generateAnalysis, getProvider } = require("../llm/llm-client");

const EXPERIMENTS_DIR = __dirname;
const PROVIDER_IDS = ["mock", "deepseek", "qwen", "openai"];

/**
 * @param {string} providerId
 * @param {Object} context
 * @returns {Promise<Object>} experiments/<provider>-result.jsonへ書き込む内容
 */
async function runOne(providerId, context) {
  const provider = getProvider(providerId);

  if (provider.requiresApiKey && !provider.isConfigured()) {
    return {
      provider: providerId,
      skipped: true,
      reason: "APIキー未設定のため未実行（本プロジェクトでは有料APIキーを設定していない）",
      would_use_model: provider.model,
    };
  }

  const startedAt = Date.now();
  try {
    const result = await generateAnalysis(context, { providerId });
    return {
      provider: providerId,
      skipped: false,
      duration_ms: Date.now() - startedAt,
      model: result.provider.model,
      usage: result.usage,
      free_opportunity_title: result.free_opportunity && result.free_opportunity.title,
      locked_opportunities_count: Array.isArray(result.locked_opportunities) ? result.locked_opportunities.length : 0,
      result,
    };
  } catch (err) {
    return {
      provider: providerId,
      skipped: false,
      error: err.message,
    };
  }
}

async function main() {
  const companyUrl = process.argv[2] || "https://example.com";
  console.log(`company_context生成中: ${companyUrl}`);
  const context = await buildCompanyContext(companyUrl);

  const summary = [];
  for (const providerId of PROVIDER_IDS) {
    console.log(`\n--- provider: ${providerId} ---`);
    const outcome = await runOne(providerId, context);
    const outPath = path.join(EXPERIMENTS_DIR, `${providerId}-result.json`);
    fs.writeFileSync(outPath, JSON.stringify(outcome, null, 2), "utf-8");

    if (outcome.skipped) {
      console.log(`スキップ: ${outcome.reason}`);
    } else if (outcome.error) {
      console.log(`エラー: ${outcome.error}`);
    } else {
      console.log(
        `成功: model=${outcome.model} / トークン 入力${outcome.usage.input_tokens}・出力${outcome.usage.output_tokens}` +
          ` / 推定コスト $${outcome.usage.estimated_cost} / ${outcome.duration_ms}ms`
      );
    }
    summary.push({ provider: providerId, skipped: !!outcome.skipped, error: outcome.error || null });
  }

  console.log("\n=== 実験結果サマリー ===");
  summary.forEach((s) => {
    console.log(`  ${s.provider}: ${s.skipped ? "スキップ（APIキー未設定）" : s.error ? `エラー（${s.error}）` : "成功"}`);
  });
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    // fetch()を経由するため、この後にprocess.exit()は呼ばずprocess.exitCodeのみ設定する
    // （Windows + Node v24でのlibuvクラッシュを避けるため。generate-company-report.js参照）
    console.error(`実験スクリプトが失敗しました: ${err.message}`);
    process.exitCode = 1;
  });
