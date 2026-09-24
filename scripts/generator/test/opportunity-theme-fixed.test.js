/**
 * opportunity-theme-fixed.test.js — Phase56 STEP9
 *
 * generate-company-report.js の `--opportunity-theme`（採用テーマ固定モード）の検証。
 * 実 LLM / 実 Tavily は一切呼ばない（mock provider + fake context のみ）。
 *
 * カバー範囲:
 *   Test A — 固定テーマ指定時: free_opportunity.title が指定値と完全一致し、AI によるテーマ再選択がない
 *   Test B — 未指定時: 既存動作（プロンプトに固定ブロックなし・title は従来どおり）を維持
 *   Test C — 異常系: 空テーマは固定モードにならない / 整合チェックは前後空白のみ許容
 *   + parseArgs / buildUserPrompt / assertFixedThemeIntegrity / mock-provider / provenance
 */

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const llmClient = require("../llm/llm-client");
const searchClient = require("../search/search-client");
const {
  buildUserPrompt,
  buildFixedThemeBlock,
  assertFixedThemeIntegrity,
  generateAnalysis,
  getProvider,
} = llmClient;
const { buildReport, parseArgs } = require("../generate-company-report");

// 【Phase90 P6d-1】本ファイルのテストがllm-usage.jsonl（コスト分析用の実運用ログ）を
// 汚さないよう、ファイル全体を専用の<tmp>/logs/へ向ける。
// 後片付けはファイル終了時のafter()と、異常終了時の保険のprocess.on("exit")の両方で行う。
const TEST_LOGS_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "p90-p6d1-theme-"));
const TEST_LOGS_DIR = path.join(TEST_LOGS_ROOT, "logs");
fs.mkdirSync(TEST_LOGS_DIR, { recursive: true });
function cleanupTestLogs() {
  fs.rmSync(TEST_LOGS_ROOT, { recursive: true, force: true });
  llmClient.configure();
  searchClient.configure();
}
after(cleanupTestLogs);
process.on("exit", cleanupTestLogs);
llmClient.configure({ logsDir: TEST_LOGS_DIR });
searchClient.configure({ logsDir: TEST_LOGS_DIR });

// §10: 実 LLM / 実 Tavily を絶対に呼ばない。node --test はテストファイル単位で別プロセスを
// 起動するため、ここでの process.env 変更は本ファイル内だけに閉じる（他テストへ波及しない）。
// buildReport() は providerId を明示できないため、env で mock を強制する。
process.env.LLM_PROVIDER = "mock";
process.env.SEARCH_PROVIDER = "mock";
delete process.env.DEEPSEEK_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.QWEN_API_KEY;
delete process.env.TAVILY_API_KEY;

const THEME = "中小製造業向け「AI品質検査」導入支援サービスの立ち上げ";

/** buildReport / generateAnalysis(mock) を通せる最小の company_context。 */
function fakeContext() {
  return {
    input_url: "https://example.com",
    industry_hint: "テスト業界",
    company_fetch_ok: true,
    generated_at: new Date().toISOString(),
    pipeline_stats: {
      fetched_total: 2,
      normalized_total: 2,
      duplicates_removed: 0,
      after_dedupe: 2,
      exact_url_duplicates_removed: 0,
      selected_for_ai: 2,
      max_sources_for_ai: 20,
    },
    sources: [
      {
        id: "src-1",
        source_type: "company",
        title: "Example 株式会社",
        url: "https://example.com",
        summary: "製造業向けの支援を行う会社です。",
        quote: "製造業向けの支援を行う会社です。",
        score: 92,
        evidence_strength: "primary",
      },
      {
        id: "src-2",
        source_type: "statistics",
        title: "製造業の人手不足統計",
        url: "https://stat.example.com/mfg",
        summary: "製造業の56.3%が人手不足を事業影響と回答。",
        quote: "製造業の56.3%が人手不足を事業影響と回答。",
        score: 80,
        evidence_strength: "secondary",
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Test A — 固定テーマ指定                                             */
/* ------------------------------------------------------------------ */

test("Test A: generateAnalysis(mock) は opportunityTheme を free_opportunity.title へ固定する", async () => {
  const result = await generateAnalysis(fakeContext(), { providerId: "mock", opportunityTheme: THEME });
  assert.equal(result.free_opportunity.title, THEME);
});

test("Test A: buildReport は固定テーマを title に反映し meta.opportunity_theme_fixed へ記録する", async () => {
  const report = await buildReport(fakeContext(), { opportunityTheme: THEME });
  assert.equal(report.free_opportunity.title, THEME);
  assert.equal(report.meta.opportunity_theme_fixed, THEME);
  assert.match(report.meta.note, /採用テーマを「.*」へ固定/);
});

test("Test A: 固定テーマモードのプロンプトにはテーマ再選択禁止の制約が含まれる", () => {
  const prompt = buildUserPrompt(fakeContext(), { opportunityTheme: THEME });
  assert.match(prompt, /採用テーマ固定/);
  assert.match(prompt, /FIXED OPPORTUNITY THEME/);
  assert.ok(prompt.includes(`「${THEME}」`), "テーマ文字列がプロンプトに埋め込まれている");
  assert.match(prompt, /再ランキング.*禁止|再選択/);
  assert.match(prompt, /一字一句同一/);
});

test("Test A: mock provider は opportunityTheme を受け取ると title を上書きする", async () => {
  const mock = getProvider("mock");
  const { content } = await mock.callRaw({
    context: fakeContext(),
    userPrompt: "x",
    opportunityTheme: THEME,
  });
  assert.equal(JSON.parse(content).free_opportunity.title, THEME);
});

/* ------------------------------------------------------------------ */
/* Test B — 未指定時は既存動作を維持                                   */
/* ------------------------------------------------------------------ */

test("Test B: opportunityTheme 未指定なら buildUserPrompt は固定ブロックを差し込まない", () => {
  const prompt = buildUserPrompt(fakeContext());
  assert.doesNotMatch(prompt, /採用テーマ固定/);
  assert.doesNotMatch(prompt, /FIXED OPPORTUNITY THEME/);
});

test("Test B: opportunityTheme 未指定の buildUserPrompt は従来と同一（company_context 節のみ付加）", () => {
  const ctx = fakeContext();
  const prompt = buildUserPrompt(ctx);
  // 従来の連結仕様: テンプレート + "## company_context …" + ```json <context> ```
  assert.match(prompt, /## company_context（実際の入力データ/);
  assert.ok(prompt.includes(JSON.stringify(ctx, null, 2)));
});

test("Test B: buildReport は未指定時 meta.opportunity_theme_fixed を持たない・title は AI 選定のまま", async () => {
  const report = await buildReport(fakeContext());
  assert.equal("opportunity_theme_fixed" in report.meta, false);
  assert.doesNotMatch(report.meta.note, /採用テーマを「/);
  assert.ok(report.free_opportunity.title); // 何らかのタイトルは付く
  assert.notEqual(report.free_opportunity.title, THEME);
});

test("Test B: generateAnalysis は未指定時、整合チェックを行わない（例外を投げない）", async () => {
  const result = await generateAnalysis(fakeContext(), { providerId: "mock" });
  assert.ok(result.free_opportunity.title);
});

/* ------------------------------------------------------------------ */
/* Test C — 異常系                                                     */
/* ------------------------------------------------------------------ */

test("Test C: 空文字テーマは固定モードにならない（buildUserPrompt に固定ブロックなし）", () => {
  const prompt = buildUserPrompt(fakeContext(), { opportunityTheme: "" });
  assert.doesNotMatch(prompt, /FIXED OPPORTUNITY THEME/);
});

test("Test C: assertFixedThemeIntegrity は title 不一致で例外を投げる", () => {
  assert.throws(
    () => assertFixedThemeIntegrity({ free_opportunity: { title: "別のテーマ" } }, THEME),
    /固定テーマ違反/
  );
});

test("Test C: assertFixedThemeIntegrity は完全一致で通る（前後空白は許容）", () => {
  assert.doesNotThrow(() =>
    assertFixedThemeIntegrity({ free_opportunity: { title: `  ${THEME}  ` } }, THEME)
  );
});

test("Test C: assertFixedThemeIntegrity は title 欠落でも例外を投げる", () => {
  assert.throws(() => assertFixedThemeIntegrity({ free_opportunity: {} }, THEME), /固定テーマ違反/);
});

test("Test C: buildFixedThemeBlock は quality-rules / Phase54ルール3 が不変であることを明記する", () => {
  const block = buildFixedThemeBlock(THEME);
  assert.match(block, /Phase54ルール3/);
  assert.match(block, /evidence に基づかない主張は禁止/);
});

/* ------------------------------------------------------------------ */
/* parseArgs（CLI）                                                    */
/* ------------------------------------------------------------------ */

test("parseArgs: 位置引数を会社URL・--opportunity-theme= をフラグとして分解する", () => {
  const { companyUrl, flags } = parseArgs(["https://kscope.co.jp", `--opportunity-theme=${THEME}`]);
  assert.equal(companyUrl, "https://kscope.co.jp");
  assert.equal(flags["opportunity-theme"], THEME);
});

test("parseArgs: フラグの順序は問わない", () => {
  const { companyUrl, flags } = parseArgs([`--opportunity-theme=${THEME}`, "https://kscope.co.jp"]);
  assert.equal(companyUrl, "https://kscope.co.jp");
  assert.equal(flags["opportunity-theme"], THEME);
});

test("parseArgs: フラグなしなら従来どおり URL のみ取得できる", () => {
  const { companyUrl, flags } = parseArgs(["https://kscope.co.jp"]);
  assert.equal(companyUrl, "https://kscope.co.jp");
  assert.deepEqual(flags, {});
});
