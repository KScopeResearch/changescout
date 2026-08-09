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

test("generateAnalysis: mock providerでschema通りのfree_opportunity/locked_opportunities/paid_analysisを返す", async () => {
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
