/**
 * llm.test.js — Task18: llm/llm-client.js（mock providerのみ、APIキー不要）の自動テスト。
 */

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const llmClient = require("../llm/llm-client");
const searchClient = require("../search/search-client");
const { generateAnalysis, getProvider, resolveProviderId, providerIds } = llmClient;
const { buildCompanyContext } = require("../company-context");
const { LOGS_DIR } = require("../shared/paths");

// 【Phase90 P6d-1】本ファイルのテストがllm-usage.jsonl / search-usage.jsonl（コスト分析用の
// 実運用ログ）を汚さないよう、ファイル全体を専用の<tmp>/logs/へ向ける。
// 後片付けはファイル終了時のafter()と、異常終了時の保険のprocess.on("exit")の両方で行う。
const TEST_LOGS_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "p90-p6d1-llm-"));
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

/** generateAnalysis(mock)を通せる最小のcompany_context（ネットワーク・検索を使わない）。 */
function fakeContext() {
  return {
    input_url: "https://example.com",
    industry_hint: "テスト業界",
    company_fetch_ok: true,
    generated_at: new Date().toISOString(),
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
    ],
  };
}

/**
 * fnの実行中、共有LOGS_DIR配下への書き込み系fs呼び出しを記録し、実際には実行しない
 * （テストが失敗した場合でも実運用ログに触れないため）。それ以外のパスはそのまま通す。
 * 他テストファイルは別プロセスなので、記録されるのは本テスト自身の呼び出しだけ。
 * @param {Function} fn
 * @returns {Promise<{result:*, sharedWrites:string[]}>}
 */
async function interceptSharedLogWrites(fn) {
  const sharedDir = path.resolve(LOGS_DIR) + path.sep;
  const sharedWrites = [];
  const names = ["appendFileSync", "writeFileSync", "renameSync", "mkdirSync", "copyFileSync"];
  const originals = {};
  for (const name of names) {
    originals[name] = fs[name];
    fs[name] = function intercepted(p, ...rest) {
      if (typeof p === "string" && (path.resolve(p) + path.sep).startsWith(sharedDir)) {
        sharedWrites.push(`${name}:${path.resolve(p)}`);
        return undefined;
      }
      return originals[name].call(this, p, ...rest);
    };
  }
  try {
    return { result: await fn(), sharedWrites };
  } finally {
    Object.assign(fs, originals);
  }
}

/** @returns {Object[]} */
function readLogLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

test("providerIds: mock/openai/deepseek/qwenの4種が登録されている", () => {
  assert.deepEqual(providerIds.sort(), ["deepseek", "mock", "openai", "qwen"].sort());
});

test("resolveProviderId: LLM_PROVIDER未設定時はmock", () => {
  const original = process.env.LLM_PROVIDER;
  delete process.env.LLM_PROVIDER;
  try {
    assert.equal(resolveProviderId(), "mock");
  } finally {
    if (original !== undefined) process.env.LLM_PROVIDER = original;
  }
});

test("getProvider: 未知のprovider idは例外を投げる", () => {
  assert.throws(() => getProvider("no-such-provider"), /未知のLLM_PROVIDER/);
});

test("openai/deepseek/qwen: APIキー未設定時はisConfigured()がfalse", () => {
  ["openai", "deepseek", "qwen"].forEach((id) => {
    const provider = getProvider(id);
    assert.equal(provider.requiresApiKey, true);
    // このテスト環境ではAPIキーを設定していない前提
    if (!process.env[`${id.toUpperCase()}_API_KEY`]) {
      assert.equal(provider.isConfigured(), false);
    }
  });
});

test("mock provider: requiresApiKey=false、isConfigured()は常にtrue", () => {
  const mock = getProvider("mock");
  assert.equal(mock.requiresApiKey, false);
  assert.equal(mock.isConfigured(), true);
});

test("generateAnalysis: mock providerでschema通りのfree_opportunity/locked_opportunities/paid_analysisを返す", async (t) => {
  // 【PJ2 AOR Phase47 STEP4】buildCompanyContext()は内部でfetch-government.js等を通じて
  // search/search-client.jsのsearch()を呼ぶが、providerIdを指定していないためSEARCH_PROVIDER
  // 環境変数に従う。このテスト自体はLLM（generateAnalysis）のmock providerの戻り値形状のみを
  // 検証する意図であり、検索結果の内容には依存しないが、ローカル開発環境でSEARCH_PROVIDER=tavily・
  // TAVILY_API_KEYが実際に設定されている場合（実レポート生成用）、本テストはこれまで検出されずに
  // 意図せず実Tavily APIを呼び出していた（アサーション対象がLLM側の戻り値のみのため、検索が
  // 実Tavilyを使っていてもテスト自体は成功してしまい、これまで発覚していなかった）。
  // generator.test.js・create-lead-from-email.test.jsと同じ二重の対処（SEARCH_PROVIDER=mock固定 +
  // TAVILY_API_KEY削除）を適用する。本テストには明示的timeoutが無く、orphaned Promiseによる
  // 遅延実行のリスクが無いため、t.after()による復元で問題ない。
  const originalProvider = process.env.SEARCH_PROVIDER;
  const originalApiKey = process.env.TAVILY_API_KEY;
  process.env.SEARCH_PROVIDER = "mock";
  delete process.env.TAVILY_API_KEY;
  t.after(() => {
    if (originalProvider === undefined) delete process.env.SEARCH_PROVIDER;
    else process.env.SEARCH_PROVIDER = originalProvider;
    if (originalApiKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = originalApiKey;
  });

  const context = await buildCompanyContext("https://example.com");
  const result = await generateAnalysis(context, { providerId: "mock" });

  assert.ok(result.free_opportunity.title);
  assert.ok(Array.isArray(result.locked_opportunities));
  assert.ok(result.paid_analysis.decision_summary);
  assert.equal(result.provider.id, "mock");
  assert.equal(result.usage.estimated_cost, 0, "mockは課金なしのはず");
});

test("generateAnalysis: APIキー未設定のprovider指定時は明確なエラーで停止する（フォールバックしない）", async () => {
  const original = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    await assert.rejects(
      () => generateAnalysis({ sources: [], input_url: "https://example.com" }, { providerId: "deepseek" }),
      /APIキー.*設定されていません/
    );
  } finally {
    if (original !== undefined) process.env.DEEPSEEK_API_KEY = original;
  }
});

test("generateAnalysis: 未知のprovider idは例外を投げる", async () => {
  await assert.rejects(
    () => generateAnalysis({ sources: [] }, { providerId: "no-such-provider" }),
    /未知のLLM_PROVIDER/
  );
});

// ---------------------------------------------------------------------------
// Phase90 P6d-1: llm-usage.jsonlのlogsDir DI
// ---------------------------------------------------------------------------

test("[P6d-T1] configure({logsDir})後のgenerateAnalysisはtmpのllm-usage.jsonlだけに書き、実運用ログには書かない", async () => {
  const tmpLog = path.join(TEST_LOGS_DIR, "llm-usage.jsonl");
  const before = readLogLines(tmpLog).length;

  const { result, sharedWrites } = await interceptSharedLogWrites(() =>
    generateAnalysis(fakeContext(), { providerId: "mock" })
  );

  assert.equal(result.provider.id, "mock");
  const lines = readLogLines(tmpLog);
  assert.equal(lines.length, before + 1, "tmpのllm-usage.jsonlに1行追記されるはず");
  assert.equal(lines[lines.length - 1].provider, "mock");
  assert.deepEqual(sharedWrites, [], "実運用のscripts/generator/logs/へは書かないはず");
});

test("[P6d-T3] llm-client: configure()でlogsDirが既定のLOGS_DIRへ戻る", (t) => {
  t.after(() => llmClient.configure({ logsDir: TEST_LOGS_DIR }));
  assert.equal(llmClient.getLogsDir(), TEST_LOGS_DIR, "前提: 本ファイルはtmpへ向いている");

  llmClient.configure();
  assert.equal(llmClient.getLogsDir(), LOGS_DIR);

  llmClient.configure({ logsDir: TEST_LOGS_DIR });
  llmClient.configure({});
  assert.equal(llmClient.getLogsDir(), LOGS_DIR, "logsDir省略でも既定へ戻るはず");
});

test("[P6d-T4] llm-client: tmpへ向けている間は実運用logs/配下へのfs書き込みが0件（ローテーション含む）", async () => {
  const { sharedWrites } = await interceptSharedLogWrites(async () => {
    await generateAnalysis(fakeContext(), { providerId: "mock" });
    await generateAnalysis(fakeContext(), { providerId: "mock" });
  });
  assert.deepEqual(sharedWrites, []);
});

test("[P6d-T5] llm-client後方互換: configureしない（既定）経路は従来どおりLOGS_DIR/llm-usage.jsonlへ書こうとする", async (t) => {
  t.after(() => llmClient.configure({ logsDir: TEST_LOGS_DIR }));
  llmClient.configure();

  // 実運用ログへは実際には書かず、書き込み先だけを確認する
  const { sharedWrites } = await interceptSharedLogWrites(() => generateAnalysis(fakeContext(), { providerId: "mock" }));

  assert.ok(
    sharedWrites.includes(`appendFileSync:${path.join(LOGS_DIR, "llm-usage.jsonl")}`),
    `既定のLOGS_DIR/llm-usage.jsonlへの追記のはず（実際: ${JSON.stringify(sharedWrites)}）`
  );
});
