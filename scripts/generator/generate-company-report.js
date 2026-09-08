#!/usr/bin/env node
/**
 * generate-company-report.js
 *
 * Task8〜Task11: 会社URL → 情報収集 → AI分析（LLM） → report.json(v2.4) を生成するCLI。
 *
 * 処理フロー（Task11で更新）:
 *   fetch → merge → normalize → deduplicate → score → company_context生成 →
 *   AI分析（llm-client.js、LLM_PROVIDER環境変数でprovider切替） →
 *   Quality Evaluation（品質評価） → 検証
 * （merge〜scoreはcompany-context.jsの内部で実行される。詳細はREADME.md参照）
 *
 * 使い方:
 *   node scripts/generator/generate-company-report.js https://company.jp
 *   LLM_PROVIDER=deepseek DEEPSEEK_API_KEY=... node scripts/generator/generate-company-report.js https://company.jp
 *
 * 出力:
 *   scripts/generator/output/<slug>/company_context.json
 *   scripts/generator/output/<slug>/report.json
 *   scripts/generator/output/<slug>/evaluation.md
 *
 * 【重要】Task11時点の制限（README.md参照）:
 *   - 会社自身のURLのみ実際にHTTP取得する（fetch-company.js）。
 *   - 官公庁・業界・ニュース・統計はTask12（Web検索連携）が未実装のため、
 *     明示的にラベル付けされたシミュレーションデータを返す。
 *   - 「AI分析」はTask11でllm-client.js経由の実LLM接続に対応した（openai/deepseek/qwen）。
 *     ただし本プロジェクトでは実際のAPIキーを設定していないため、デフォルトの
 *     LLM_PROVIDER=mock（simulate-ai-analysis.jsをそのまま利用）で動作確認している。
 *   - human_review.status は常に "pending_review" から開始する（誰もレビューしていないため）。
 */

const fs = require("fs");
const path = require("path");

const { buildCompanyContext, normalizeCompanyName } = require("./company-context");
const { cleanSummaryText } = require("./fetch-company"); // Phase54 STEP1: business_summary の後段クレンジング
const { saveCompanyContext } = require("./company-context-store"); // PJ2 AOR: company_context backend接続PoC
const { saveReport } = require("./report-store"); // PJ2 AOR: report backend接続（Phase B-3）
const { buildSourcePages } = require("./simulate-ai-analysis");
const { generateAnalysis, resolveProviderId } = require("./llm/llm-client");
const { evaluateReportQuality, renderEvaluationMarkdown } = require("./quality-evaluator");
const { validateReport } = require("./validate-report");
const { OUTPUT_DIR } = require("./shared/paths"); // Task18: パス計算の共通化
const { runCli } = require("./shared/cli-utils"); // Task18: process.exit()回避パターンの共通化
const { checkLlmConfig, checkSearchConfig } = require("./shared/config-validator"); // Task21: 起動時Configチェック

/**
 * URLからファイルシステムで安全に使えるslugを作る。
 * @param {string} url
 * @returns {string}
 */
function slugFromUrl(url) {
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/[^a-zA-Z0-9.-]/g, "-");
  } catch (e) {
    return "unknown-company";
  }
}

/**
 * context.input_url からホスト名を取り出す。
 * @param {Object} context
 * @returns {string}
 */
function hostnameOf(context) {
  try {
    return new URL(context.input_url).hostname;
  } catch (e) {
    return context.input_url;
  }
}

/**
 * 【Phase54 STEP1】会社ページ本文を company_profile.business_summary 用に 2〜3文へ要約する。
 * fetch-company.js の extractSummary が entity デコード・ナビ除去まで担うが、ここでは
 * さらに「文単位で先頭N文・最大M字」に切り詰める（ホームページ全文が summary になる問題の是正）。
 * @param {string} text
 * @param {{maxChars?:number, maxSentences?:number}} [options]
 * @returns {string}
 */
function summarizeBusinessText(text, options = {}) {
  const maxChars = options.maxChars || 400;
  const maxSentences = options.maxSentences || 3;
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (!t) return t;
  const sentences = t
    .split(/(?<=[。．！？!?])/)
    .map((s) => s.trim())
    .filter(Boolean);
  let out = sentences.slice(0, maxSentences).join("");
  if (!out) out = t;
  if (out.length > maxChars) {
    out = out.slice(0, maxChars).replace(/\s+\S*$/, "").trim();
  }
  return out;
}

/** @param {string} text @returns {string[]} 2文字以上の漢字列/3文字以上のカナ・英字列（照合トークン） */
function relevanceTokens(text) {
  return [...new Set((text || "").match(/[一-龠々]{2,}|[ァ-ヶー]{3,}|[A-Za-z]{3,}/g) || [])].map((t) =>
    t.toLowerCase()
  );
}

/**
 * 【Phase54 STEP1 / STEP8】source_pages から「表示用の上位ソース」と「隠れ件数」を作る（P2-1）。
 * 既存の source_pages は保持したまま、preview が上位のみ出せるよう report へ足す。
 *
 * 【STEP8 で並び基準を score → 関連性へ変更】STEP7 で illegame.com の top_sources に
 * EV自動車補助金・浦安市補助金一覧・同名のバー（Retty）が score 95-100 で混入していた。
 *
 * 【STEP8A.1 で Tier 制へ】classify-source.js が directory / review を正しく落とすように
 * なったのを受け、明示的な Tier で並べる:
 *   Tier A: 会社ページ（company・score>=80）
 *   Tier B: 外部市場の一次/二次情報（government/statistics/industry_association・score>=70・非ノイズ・関連）
 *   Tier C: 技術/報道（technology/news・score>=70・非ノイズ・関連）
 *   Tier D: それ以外の関連 source（非ノイズ・関連）
 *   Tier E: 分析が実際に引用した低関連 source（透明性のため末尾に載せる。引用されていない
 *           ノイズ〈directory/review/score<=30/reference〉は top に入れない）
 * 「関連」= evidence として引用された、または 会社名/Opportunity/事業概要 と語が重なる。
 * relevanceHints が空なら全 source を関連扱い（従来互換）。
 *
 * @param {Array<Object>} sourcePages
 * @param {{evidenceIds?:string[], relevanceHints?:string, n?:number}} [options]
 * @returns {{top_sources:Array<Object>, hidden_sources_count:number}}
 */
function buildTopSources(sourcePages, options = {}) {
  const n = options.n || 5;
  const evidenceIds = new Set(options.evidenceIds || []);
  const hints = relevanceTokens(options.relevanceHints || "");
  const all = Array.isArray(sourcePages) ? [...sourcePages] : [];

  const EXTERNAL = ["government", "statistics", "industry_association"];
  const isNoisy = (s) =>
    s.evidence_strength === "reference" ||
    s.source_type === "directory" ||
    s.source_type === "review" ||
    (typeof s.score === "number" && s.score <= 30);
  const isTopical = (s) => {
    const label = (s.label || s.title || "").toLowerCase();
    return hints.length === 0 ? true : hints.some((t) => label.includes(t));
  };
  const isRelevant = (s) => evidenceIds.has(s.id) || isTopical(s);
  const byScoreDesc = (a, b) => (b.score || 0) - (a.score || 0);

  const used = new Set();
  const take = (arr) =>
    arr.filter((s) => {
      if (used.has(s.id)) return false;
      used.add(s.id);
      return true;
    });

  const tierA = take(
    all.filter((s) => s.source_type === "company" && (s.score || 0) >= 80).sort(byScoreDesc)
  );
  const tierB = take(
    all
      .filter((s) => EXTERNAL.includes(s.source_type) && (s.score || 0) >= 70 && !isNoisy(s) && isRelevant(s))
      .sort(byScoreDesc)
  );
  const tierC = take(
    all
      .filter(
        (s) => ["technology", "news"].includes(s.source_type) && (s.score || 0) >= 70 && !isNoisy(s) && isRelevant(s)
      )
      .sort(byScoreDesc)
  );
  const tierD = take(all.filter((s) => !isNoisy(s) && isRelevant(s)).sort(byScoreDesc));
  // Tier E は「分析が引用した低score の外部 source」を透明性のため末尾に載せる。
  // directory / review は引用されていても top_sources に出さない（STEP4 / STEP8A.2 Gate-5）。
  const tierE = take(
    all
      .filter(
        (s) =>
          evidenceIds.has(s.id) &&
          isNoisy(s) &&
          s.source_type !== "directory" &&
          s.source_type !== "review"
      )
      .sort(byScoreDesc)
  );

  const ordered = [...tierA, ...tierB, ...tierC, ...tierD, ...tierE];
  const top = ordered.slice(0, n);
  return { top_sources: top, hidden_sources_count: Math.max(0, all.length - top.length) };
}

/**
 * company_context から最小限の company_profile を組み立てる（シミュレーション）。
 * 本来はAI分析（Task11）が担う役割だが、Task8/Task9時点ではreport.jsonの構造を
 * 満たすための最小限の値を機械的に生成する。
 * @param {Object} context - buildCompanyContext() の戻り値（Task9形式、context.sources使用）
 * @returns {Object} company_profile
 */
function buildCompanyProfile(context) {
  const companySource = context.sources.find((s) => s.source_type === "company");
  const ok = context.company_fetch_ok;
  const hostname = hostnameOf(context);

  // 【Phase53 STEP10.11】
  // - name: 会社ページ（source_type: "company"）の <title> 生値をそのまま使わず、
  //   normalizeCompanyName() で表示用に整える（"…へようこそ" 等の挨拶文・"公式サイト" の除去、
  //   法人格付き社名の抽出）。整えられない場合のみ生 title へフォールバックする。
  // - company source が context に無い場合の placeholder は company_fetch_ok の値で出し分ける
  //   （取得成功時に「取得に失敗」と誤表示しない）。company source の保持自体は
  //   deduplicate-sources.js（preferWithinGroup）側で対応済み。
  let name;
  let businessSummary;
  if (companySource) {
    name =
      normalizeCompanyName(companySource.title, { bodyText: companySource.summary }) ||
      companySource.title ||
      `（会社名を特定できませんでした: ${hostname}）`;
    // 【Phase54 STEP1】ホームページ全文がそのまま summary になっていた問題の是正:
    // fetch-company.js の cleanSummaryText（entity デコード・ナビ/メニュー/連絡先除去）を
    // 後段でもう一度かけ、2〜3文・最大400字へ切り詰める。
    businessSummary =
      summarizeBusinessText(cleanSummaryText(companySource.summary)) ||
      "（会社ページから事業概要を抽出できませんでした）";
  } else {
    name = ok ? `（会社名を特定できませんでした: ${hostname}）` : `（会社名未取得: ${hostname}）`;
    businessSummary = ok
      ? "（会社ページは取得できましたが本文を抽出できませんでした）"
      : "（会社ページの取得に失敗したため未取得）";
  }

  return {
    name,
    name_is_ai_estimated: true,
    domain: hostname,
    industry_label: context.industry_hint,
    industry_is_ai_estimated: true,
    business_summary: businessSummary,
    business_summary_is_ai_estimated: true,
    location: "不明（Task9時点では未取得）",
    founded_year: null,
    employee_range: "不明（Task9時点では未取得）",
    business_type: "不明",
    listed_status: "不明",
  };
}

/**
 * report.json 全体を組み立てる。AI分析はllm-client.js経由（Task11）。
 * @param {Object} context - buildCompanyContext() の戻り値
 * @returns {Promise<Object>} report.json（schema_version 2.4。既存フィールドは変更なし、
 *   ai_pipeline.llmはTask11で追加した内部用の追加情報）
 */
async function buildReport(context) {
  const analysis = await generateAnalysis(context);
  const sourcePages = buildSourcePages(context.sources);
  const companyProfile = buildCompanyProfile(context);
  // 【Phase54 STEP8】top_sources は「分析が引用した source + 会社名/Opportunity と語が重なる source」を優先。
  const fo = analysis.free_opportunity || {};
  const evidenceIds = (fo.evidence || []).map((e) => e && e.source_id).filter(Boolean);
  const relevanceHints = [
    companyProfile.name,
    companyProfile.business_summary,
    fo.title,
    ...(analysis.locked_opportunities || []).map((o) => o && o.title),
  ]
    .filter(Boolean)
    .join(" ");
  const { top_sources, hidden_sources_count } = buildTopSources(sourcePages, { evidenceIds, relevanceHints });
  const hostname = hostnameOf(context);
  const providerId = analysis.provider.id;

  return {
    id: `generated-${slugFromUrl(context.input_url)}`,
    meta: {
      schema_version: "2.4",
      generated_at: context.generated_at,
      pipeline_version: "phase1-generator-v0.3-llm",
      industry_category: context.industry_hint,
      note:
        "scripts/generator/generate-company-report.js により自動生成。Task11でAI分析をllm-client.js" +
        `経由の実LLM接続に対応（今回はLLM_PROVIDER=${providerId}で生成）。fetch-government/` +
        "fetch-industry/fetch-news/fetch-statisticsはTask12（Web検索連携）が未実装のため、" +
        "引き続きシミュレーションデータ。情報収集はmerge/normalize/deduplicate/scoreを経てスコア上位" +
        `${context.pipeline_stats.max_sources_for_ai}件に絞り込み済み。`,
    },
    company_profile: companyProfile,
    source_pages: sourcePages,
    // 【Phase54 STEP1】表示用（preview は上位のみ出す）。source_pages は全件保持（schema互換）。
    top_sources,
    hidden_sources_count,
    ai_pipeline: {
      note: "Task11でAI分析（free_opportunity/locked_opportunities/paid_analysis）をllm-client.js経由に変更。company_profileの推定・fetch-government等はTask11の対象外で従来通り。",
      company_context_generated_at: context.generated_at,
      pipeline_stats: context.pipeline_stats,
      llm: {
        provider: analysis.provider.id,
        display_name: analysis.provider.displayName,
        model: analysis.provider.model,
        usage: analysis.usage,
      },
    },
    free_opportunity: analysis.free_opportunity,
    locked_opportunities: analysis.locked_opportunities,
    paid_analysis: analysis.paid_analysis,
    send_target: {
      email: `info@${hostname}`,
      acquisition_route: "official_site_public_contact",
      acquisition_route_label: "企業公式サイトの公開連絡先（03_lead_generation.mdの適用除外に該当）",
      opt_in_recorded: false,
      opt_in_recorded_note: "送信前段階のため未記録。",
    },
    human_review: {
      status: "pending_review",
      reviewer: null,
      reviewed_at: null,
      review_duration_minutes: null,
      checklist: {
        company_info_accurate: null,
        citations_current_and_accurate: null,
        no_logical_leap_in_opportunity: null,
        recipient_source_is_lawful: null,
        no_duplicate_send: null,
      },
      notes: "AI生成直後の状態。人間によるレビュー・承認が完了するまで配信不可。",
      review_history: [{ at: context.generated_at, actor: "generate-company-report.js", action: "submitted_for_review" }],
    },
  };
}

/**
 * 会社URLから company_context.json / report.json / evaluation.md を生成し、ディスクへ保存する。
 * CLI（main()）とJob Runner（Task16のjob-engine.js）の両方から呼ばれる、副作用込みの中核処理。
 * console.logは行わない（呼び出し元がログ出力の要否・形式を決める）。
 *
 * @param {string} companyUrl - 対象企業のURL
 * @param {{onProgress?:(step:string, detail:Object)=>void}} [options] - 進捗コールバック（任意）。
 *   CLIはこれを使ってconsole.logし、Job Runnerはjobのイベントログに記録する
 * @returns {Promise<{context:Object, report:Object, evaluation:Object, validation:{ok:boolean,errors:string[],warnings:string[]}, slug:string, outDir:string, paths:{contextPath:string, reportPath:string, evaluationMdPath:string}}>}
 */
async function generateCompanyReport(companyUrl, options = {}) {
  const onProgress = options.onProgress || (() => {});
  if (!companyUrl) throw new Error("companyUrlが必須です");

  onProgress("fetch:start", { companyUrl });
  const context = await buildCompanyContext(companyUrl);
  onProgress("fetch:done", { pipeline_stats: context.pipeline_stats });

  const slug = slugFromUrl(companyUrl);
  const outDir = path.join(OUTPUT_DIR, slug);

  const contextPath = path.join(outDir, "company_context.json");
  // PJ2 AOR: company_context backend接続PoC。COMPANY_CONTEXT_STORE_BACKEND未設定時は
  // 既定でfilesystem backendが使われ、filesystem-backend.jsのcompanyContextFilePath(slug)は
  // 上記contextPathと全く同じ物理パスを指すため、既存の読み込み側（job-runner.jsの
  // getScheduledCompanyUrls()等）との互換性は維持される。
  await saveCompanyContext(slug, context);
  onProgress("context:saved", { contextPath });

  const providerId = resolveProviderId();
  onProgress("analysis:start", { providerId });
  const report = await buildReport(context);
  onProgress("analysis:done", { llm: report.ai_pipeline.llm });

  const evaluation = evaluateReportQuality(report);
  report.evaluation = evaluation;
  onProgress("evaluation:done", { evaluation });

  const reportPath = path.join(outDir, "report.json");
  // PJ2 AOR: report backend接続（Phase B-3）。REPORT_STORE_BACKEND未設定時は既定でfilesystem
  // backendが使われ、filesystem-backend.jsのreportFilePath(slug)は上記reportPathと
  // 全く同じ物理パスを指すため、既存の読み込み側（server.jsのloadCompany()等、今回は
  // 未接続のまま）との互換性は維持される。reportPath自体はpaths.reportPathとして
  // 戻り値・onProgressで引き続き使うため変数は残す（company_context移行時と同じ判断）。
  await saveReport(slug, report);
  onProgress("report:saved", { reportPath });

  const evaluationMdPath = path.join(outDir, "evaluation.md");
  // PJ2 AOR Phase 3-D-1: evaluation.mdは開発者向けの人間可読レポートであり、Reportそのもの
  // ではない（evaluation.score/grade/status/breakdown等のデータ実体はこの直前で
  // report.evaluation経由でreport.json側へ既に永続化済み。report.jsonはreport-store.js経由で
  // 既にS3対応済みのため、Lambda本番経路ではevaluation.md無しでも評価データは失われない）。
  // Lambda等、ローカルOUTPUT_DIRへの書き込みが成立しない/意味を持たない実行環境
  // （REPORT_STORE_BACKEND=s3で判定。report.jsonの永続化先と同じ判断軸を流用し、
  // evaluation.md専用の新しい環境変数は導入しない）では生成をスキップする。
  // filesystemバックエンド（既定）では従来通り常に生成する。
  if ((process.env.REPORT_STORE_BACKEND || "filesystem").toLowerCase() !== "s3") {
    fs.writeFileSync(evaluationMdPath, renderEvaluationMarkdown(report, evaluation), "utf-8");
    onProgress("evaluation_md:saved", { evaluationMdPath });
  }

  const validation = validateReport(report);
  onProgress("validation:done", { validation });

  return { context, report, evaluation, validation, slug, outDir, paths: { contextPath, reportPath, evaluationMdPath } };
}

async function main() {
  const companyUrl = process.argv[2];
  if (!companyUrl) {
    console.error("使い方: node generate-company-report.js <会社URL>");
    // Task23: このファイルは唯一fetch()を行うCLIであり、実行後のprocess.exit()はWindows+
    // Node v24でクラッシュしうる（cli-utils.js冒頭コメント参照）。この分岐はfetch()より前だが、
    // ファイル全体でexitコードの与え方を統一するため、ここもprocess.exitCodeに揃える。
    process.exitCode = 2;
    return;
  }

  // Task21: 実際にfetch/LLM呼び出しを始める前に、LLM_PROVIDER/SEARCH_PROVIDERの設定を検証する。
  // mock provider（既定値）はAPIキー不要のため常にOK。非mock providerでAPIキーが未設定の場合のみ
  // ここで早期に分かりやすいエラーを出す。検証ロジック自体はconfig-validator.js経由で
  // llm-client.js/search-client.jsのprovider抽象化をそのまま再利用しており、重複実装はしていない
  // （llm-client.js/search-client.js自体が持つ実行時チェックはそのまま維持している）。
  const llmConfigResult = checkLlmConfig();
  const searchConfigResult = checkSearchConfig();
  if (llmConfigResult.level === "error" || searchConfigResult.level === "error") {
    console.error("Configuration check failed");
    [llmConfigResult, searchConfigResult]
      .filter((r) => r.level === "error")
      .forEach((r) => console.error(`  [ERROR] ${r.message}`));
    process.exitCode = 1;
    return;
  }

  const providerId = resolveProviderId();
  let step = 0;
  const total = 6;

  const { context, report, evaluation, validation } = await generateCompanyReport(companyUrl, {
    onProgress(name, detail) {
      switch (name) {
        case "fetch:start":
          console.log(`[${++step}/${total}] 情報収集中: ${detail.companyUrl}`);
          console.log("      (fetch → merge → normalize → deduplicate → score)");
          break;
        case "fetch:done": {
          const s = detail.pipeline_stats;
          console.log(
            `      取得${s.fetched_total}件 → 正規化${s.normalized_total}件 → ` +
              `重複除去${s.duplicates_removed}件削除・${s.after_dedupe}件 → ` +
              `AI提供${s.selected_for_ai}件（上限${s.max_sources_for_ai}件）`
          );
          break;
        }
        case "context:saved":
          console.log(`[${++step}/${total}] company_context.json を保存: ${detail.contextPath}`);
          break;
        case "analysis:start":
          console.log(`[${++step}/${total}] AI分析中（LLM_PROVIDER=${detail.providerId}）`);
          break;
        case "analysis:done":
          console.log(
            `      provider: ${detail.llm.display_name}（model: ${detail.llm.model}）` +
              ` / トークン: 入力${detail.llm.usage.input_tokens ?? "不明"}・出力${detail.llm.usage.output_tokens ?? "不明"}` +
              ` / 推定コスト: ${detail.llm.usage.estimated_cost != null ? `$${detail.llm.usage.estimated_cost}` : "不明"}`
          );
          break;
        case "evaluation:done":
          console.log(`[${++step}/${total}] 品質評価中（quality-evaluator.js）`);
          console.log(
            `      スコア: ${detail.evaluation.score}/100（grade: ${detail.evaluation.grade} / status: ${detail.evaluation.status}）`
          );
          break;
        case "report:saved":
          console.log(`[${++step}/${total}] report.json を保存: ${detail.reportPath}`);
          break;
        case "evaluation_md:saved":
          console.log(`      evaluation.md を保存: ${detail.evaluationMdPath}`);
          break;
        case "validation:done":
          console.log(`[${++step}/${total}] 検証中`);
          console.log(`      検証結果: ${detail.validation.ok ? "PASS" : "FAIL"}`);
          detail.validation.errors.forEach((e) => console.log(`        ✗ ${e}`));
          detail.validation.warnings.forEach((w) => console.log(`        ⚠ ${w}`));
          break;
      }
    },
  });

  console.log("\n完了。");
  console.log(`会社取得: ${context.company_fetch_ok ? "成功" : `失敗（${context.company_fetch_error}）`}`);
  console.log(`AI分析provider: ${providerId}${providerId === "mock" ? "（ルールベース、APIキー不要）" : "（実LLM）"}`);
  console.log("官公庁・業界・ニュース・統計: シミュレーション（Task12実装後に実データ化）");

  process.exitCode = validation.ok ? 0 : 1;
}

if (require.main === module) {
  // Task18: process.exit()回避パターン（fetch()実行後にprocess.exit()を呼ぶとNode.js v24 +
  // Windows環境でlibuvがクラッシュする既知の問題への対処）はshared/cli-utils.jsのrunCli()に共通化した。
  runCli(main);
}

module.exports = {
  generateCompanyReport,
  slugFromUrl,
  buildReport,
  buildCompanyProfile,
  summarizeBusinessText,
  buildTopSources,
};
