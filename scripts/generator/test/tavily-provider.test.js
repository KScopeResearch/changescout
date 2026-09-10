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

// ---------------------------------------------------------------------------
// Phase57 STEP2 — preferredDomains (include_domains) / excludeTerms
// ---------------------------------------------------------------------------

test("Phase57-2 buildRequestBody: preferredDomains があれば include_domains に入れる", () => {
  const p = freshTavilyProvider();
  const base = p.buildRequestBody("q");
  assert.equal(base.include_domains, undefined);
  assert.equal(base.query, "q");

  const withDom = p.buildRequestBody("q", { preferredDomains: ["meti.go.jp", "jetro.go.jp", "  ", ""] });
  assert.deepEqual(withDom.include_domains, ["meti.go.jp", "jetro.go.jp"]);
  // 既存フィールドは不変
  assert.equal(withDom.include_answer, false);
  assert.equal(withDom.search_depth, "basic");
});

test("Phase57-2 applyExcludeTerms: タイトル/URL に除外語を含む結果を落とす", () => {
  const p = freshTavilyProvider();
  const results = [
    { title: "株式会社ABI 会社概要", url: "https://ab-i.jp/company" },
    { title: "ABI 新卒採用・求人情報【就活会議】", url: "https://syukatsu-kaigi.jp/companies/x" },
    { title: "株式会社ABIの評判・口コミ", url: "https://openwork.jp/x" },
    { title: "アニメ市場規模レポート2026", url: "https://tdb.co.jp/report" },
  ];
  const out = p.applyExcludeTerms(results, ["求人", "採用", "評判", "口コミ"]);
  assert.deepEqual(out.map((r) => r.url), ["https://ab-i.jp/company", "https://tdb.co.jp/report"]);
  // 空/未指定はそのまま
  assert.equal(p.applyExcludeTerms(results, []).length, 4);
  assert.equal(p.applyExcludeTerms(results, undefined).length, 4);
});

test("Phase57-2 searchRaw: include_domains をリクエストへ送り、excludeTerms で結果を絞る", async (t) => {
  withFakeApiKey(t);
  const calls = mockFetchOnce(t, async () => ({
    ok: true,
    json: async () => ({
      results: [
        { title: "AI外観検査 実態調査", url: "https://meti.go.jp/x", content: "c", published_date: "2026-01-01" },
        { title: "製造業AI 求人まとめ", url: "https://example.com/jobs", content: "c" },
      ],
      response_time: 0.1,
    }),
  }));
  const provider = freshTavilyProvider();
  const res = await provider.searchRaw("中小製造業 AI 品質検査", {
    preferredDomains: ["meti.go.jp", "ipa.go.jp"],
    excludeTerms: ["求人"],
  });
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.include_domains, ["meti.go.jp", "ipa.go.jp"]);
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].url, "https://meti.go.jp/x");
  assert.equal(res.usage.excluded, 1);
});
