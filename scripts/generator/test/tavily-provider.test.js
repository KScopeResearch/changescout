/**
 * tavily-provider.test.js — scripts/generator/search/tavily-provider.js の自動テスト。
 *
 * 実Tavily APIへは一切接続しない（global.fetchを一時的にモック化し、リクエスト内容
 * だけを検証する）。今回の修正目的（認証をリクエストボディの`api_key`から
 * `Authorization: Bearer <key>`ヘッダーへ変更）が正しく反映されていること、
 * APIキーがエラーメッセージ等へ露出しないこと、既存のsearchRaw()戻り値の形が
 * 変わっていないことを確認する。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const FAKE_API_KEY = "tvly-test-fake-key-do-not-use";

function withFakeApiKey(t) {
  const original = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = FAKE_API_KEY;
  t.after(() => {
    if (original === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = original;
  });
}

function mockFetchOnce(t, handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

function freshTavilyProvider() {
  delete require.cache[require.resolve("../search/tavily-provider")];
  return require("../search/tavily-provider");
}

test("tavily-provider: searchRaw()はAuthorizationヘッダーにBearer形式でAPIキーを送信する", async (t) => {
  withFakeApiKey(t);
  const calls = mockFetchOnce(t, async () => ({
    ok: true,
    json: async () => ({ results: [], response_time: 0.1 }),
  }));

  const provider = freshTavilyProvider();
  await provider.searchRaw("test query");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${FAKE_API_KEY}`);
});

test("tavily-provider: リクエストボディにapi_keyフィールドを含まない", async (t) => {
  withFakeApiKey(t);
  const calls = mockFetchOnce(t, async () => ({
    ok: true,
    json: async () => ({ results: [], response_time: 0.1 }),
  }));

  const provider = freshTavilyProvider();
  await provider.searchRaw("test query");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.api_key, undefined, "ボディにapi_keyフィールドが残っていてはならない");
  assert.equal(body.query, "test query");
});

test("tavily-provider: APIキーの値がエラーメッセージへ露出しない", async (t) => {
  withFakeApiKey(t);
  mockFetchOnce(t, async () => ({
    ok: false,
    status: 401,
    text: async () => "Unauthorized",
  }));

  const provider = freshTavilyProvider();
  await assert.rejects(
    () => provider.searchRaw("test query"),
    (err) => {
      assert.ok(!err.message.includes(FAKE_API_KEY), "エラーメッセージにAPIキーの値が含まれてはならない");
      assert.ok(err.message.includes("401"));
      return true;
    }
  );
});

test("tavily-provider: 既存のsearchRaw()戻り値の形（results/usage）が変わっていない", async (t) => {
  withFakeApiKey(t);
  mockFetchOnce(t, async () => ({
    ok: true,
    json: async () => ({
      results: [{ title: "T", url: "https://example.com", content: "C", published_date: "2026-01-01" }],
      response_time: 0.42,
    }),
  }));

  const provider = freshTavilyProvider();
  const result = await provider.searchRaw("test query");

  assert.deepEqual(result.results, [
    { title: "T", url: "https://example.com", snippet: "C", published_at: "2026-01-01", organization: null },
  ]);
  assert.deepEqual(result.usage, { queries: 1, results_returned: 1, response_time: 0.42 });
});

test("tavily-provider: isConfigured()はTAVILY_API_KEYの有無をそのまま返す（変更なし）", (t) => {
  const original = process.env.TAVILY_API_KEY;
  t.after(() => {
    if (original === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = original;
  });

  delete process.env.TAVILY_API_KEY;
  assert.equal(freshTavilyProvider().isConfigured(), false);

  process.env.TAVILY_API_KEY = FAKE_API_KEY;
  assert.equal(freshTavilyProvider().isConfigured(), true);
});

test("tavily-provider: module.exportsの形（provider interface）が変わっていない", () => {
  const provider = freshTavilyProvider();
  assert.equal(provider.id, "tavily");
  assert.equal(provider.displayName, "Tavily Search API");
  assert.equal(provider.requiresApiKey, true);
  assert.equal(typeof provider.isConfigured, "function");
  assert.equal(typeof provider.searchRaw, "function");
});
