/**
 * llm.test.js — Task18: llm/llm-client.js（mock providerのみ、APIキー不要）の自動テスト。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { generateAnalysis, getProvider, resolveProviderId, providerIds } = require("../llm/llm-client");
const { buildCompanyContext } = require("../company-context");

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
