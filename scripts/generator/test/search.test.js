/**
 * search.test.js — Task18: search/search-client.js・query-builder.js・
 * deduplicate-sources.jsの自動テスト。Task12で発見した「会社名の偶然の包含による
 * 誤った重複統合」バグの回帰テストを含む。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { search, getProvider } = require("../search/search-client");
const { buildQueries, buildQueriesForCategory } = require("../search/query-builder");
const { isDuplicate } = require("../deduplicate-sources");

test("query-builder: 会社名から最低5件のクエリを生成する", () => {
  const queries = buildQueries("テスト株式会社");
  assert.ok(queries.length >= 5);
  const categories = queries.map((q) => q.category);
  assert.ok(categories.includes("news"));
  assert.ok(categories.includes("government"));
  assert.ok(categories.includes("statistics"));
  assert.equal(categories.filter((c) => c === "industry").length, 2, "industryは2件（業界動向・技術）");
});

test("query-builder: buildQueriesForCategoryでカテゴリ別に絞り込める", () => {
  const govQueries = buildQueriesForCategory("government", "テスト株式会社");
  assert.equal(govQueries.length, 1);
  assert.equal(govQueries[0].sourceType, "government");
});

test("search: mock providerで検索結果が正しいsource_typeで返る", async () => {
  const result = await search("テスト企業 補助金", { sourceType: "government", sourceRole: "market_change" });
  assert.equal(result.provider, "mock");
  assert.ok(result.results.length > 0);
  result.results.forEach((r) => {
    assert.equal(r.source_type, "government");
    assert.equal(r.source_role, "market_change");
    assert.equal(r.simulated, true);
    assert.equal(r.ok, true);
  });
});

test("search: 未知のproviderIdはエラーを投げる", async () => {
  await assert.rejects(
    () => search("test", { providerId: "no-such-provider", sourceType: "news", sourceRole: "evidence" }),
    /未知のSEARCH_PROVIDER/
  );
});

test("search: APIキー未設定のprovider指定時はmockへ自動フォールバックする（エラーにしない）", async () => {
  const result = await search("test", { providerId: "tavily", sourceType: "news", sourceRole: "evidence" });
  assert.equal(result.provider, "mock", "TAVILY_API_KEY未設定のためmockにフォールバックするはず");
});

test("search: timeout処理（providerがハングしてもtimeoutMsで確定する）", async () => {
  const mock = getProvider("mock");
  const original = mock.searchRaw;
  mock.searchRaw = () => new Promise(() => {}); // 永久に解決しない
  try {
    await assert.rejects(
      () => search("timeout test", { sourceType: "news", sourceRole: "evidence", timeoutMs: 200, maxRetries: 0 }),
      /タイムアウト/
    );
  } finally {
    mock.searchRaw = original;
  }
});

test("search: 不正な戻り値（results欠如）はエラーになる", async () => {
  const mock = getProvider("mock");
  const original = mock.searchRaw;
  mock.searchRaw = async () => ({ notResults: [] });
  try {
    await assert.rejects(
      () => search("bad shape", { sourceType: "news", sourceRole: "evidence", timeoutMs: 2000, maxRetries: 0 }),
      /results配列がありません/
    );
  } finally {
    mock.searchRaw = original;
  }
});

test("回帰テスト（Task12バグ）: 短い会社名が長い検索結果タイトルに偶然含まれても誤って同一記事とみなさない", () => {
  // 実際に発生した事象の再現: 会社ページのタイトルが "Example Domain" のみで、
  // 検索結果タイトルが "Example Domain 補助金に関する検索結果（mock providerによる合成データ・1件目）" 等、
  // 会社名を含む全く別カテゴリのタイトルだった場合に誤統合されていた
  const companyItem = { title: "Example Domain", url: "https://example.com" };
  const govItem = {
    title: "Example Domain 補助金に関する検索結果（mock providerによる合成データ・1件目）",
    url: "https://source.example.com/mock-search/example-domain-1",
  };
  const newsItem = {
    title: "Example Domain 最新ニュースに関する検索結果（mock providerによる合成データ・1件目）",
    url: "https://source.example.com/mock-search/example-domain-2",
  };
  assert.equal(isDuplicate(companyItem, govItem), false, "会社名と無関係な検索結果タイトルは別記事として扱うべき");
  assert.equal(isDuplicate(companyItem, newsItem), false);
  assert.equal(isDuplicate(govItem, newsItem), false, "異なるカテゴリの検索結果同士も別記事のはず");
});

test("同一記事（タイトル完全一致）は引き続き重複として検出される", () => {
  const a = { title: "全く同じタイトルの記事", url: "https://source.example.com/a" };
  const b = { title: "全く同じタイトルの記事", url: "https://source.example.com/a/" };
  assert.equal(isDuplicate(a, b), true, "URL末尾スラッシュ違いは重複のはず");
});
