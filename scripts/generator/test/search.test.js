/**
 * search.test.js — Task18: search/search-client.js・query-builder.js・
 * deduplicate-sources.jsの自動テスト。Task12で発見した「会社名の偶然の包含による
 * 誤った重複統合」バグの回帰テストを含む。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { search, getProvider } = require("../search/search-client");
const { buildQueries, buildQueriesForCategory } = require("../search/query-builder");
const { isDuplicate, dedupeSourcesByExactUrl } = require("../deduplicate-sources");

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
  // 【PJ2 AOR Phase47 STEP4】providerIdを明示的に"mock"へ固定する。省略するとresolveProviderId()が
  // 環境変数SEARCH_PROVIDERに依存してしまい、開発者のローカルシェルでSEARCH_PROVIDER=tavily・
  // TAVILY_API_KEYが実際に設定されている場合（実レポート生成用）に、このテストが意図せず
  // 実Tavily APIを呼び出してしまう（CI環境ではSEARCH_PROVIDER未設定のため問題が顕在化せず、
  // run-all-tests.jsのコメントも「実APIキー未設定のため実API呼び出しテストは無い」という
  // CI環境限定の前提のまま書かれていた）。mock providerの挙動だけを検証する意図を明示するため、
  // 常にproviderId: "mock"を指定し、実行環境のSEARCH_PROVIDER/TAVILY_API_KEY設定に左右されない
  // hermeticなテストにする。
  const result = await search("テスト企業 補助金", {
    sourceType: "government",
    sourceRole: "market_change",
    providerId: "mock",
  });
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
  const original = process.env.TAVILY_API_KEY;
  delete process.env.TAVILY_API_KEY;
  try {
    const result = await search("test", { providerId: "tavily", sourceType: "news", sourceRole: "evidence" });
    assert.equal(result.provider, "mock", "TAVILY_API_KEY未設定のためmockにフォールバックするはず");
  } finally {
    if (original !== undefined) process.env.TAVILY_API_KEY = original;
  }
});

test("search: timeout処理（providerがハングしてもtimeoutMsで確定する）", async () => {
  const mock = getProvider("mock");
  const original = mock.searchRaw;
  mock.searchRaw = () => new Promise(() => {}); // 永久に解決しない
  try {
    // 【PJ2 AOR Phase47 STEP4】providerId: "mock"を明示。省略するとSEARCH_PROVIDER環境変数に
    // 依存し、ローカル開発環境でSEARCH_PROVIDER=tavily・TAVILY_API_KEY設定時に上記で
    // モック化したmock.searchRaw()が使われず、実Tavily APIを呼び出してしまう
    // （このテスト自体はtimeoutMs超過で偶然PASSしうるが、実API呼び出し自体は発生してしまう）。
    await assert.rejects(
      () =>
        search("timeout test", {
          sourceType: "news",
          sourceRole: "evidence",
          timeoutMs: 200,
          maxRetries: 0,
          providerId: "mock",
        }),
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
    // 【PJ2 AOR Phase47 STEP4】providerId: "mock"を明示（理由は上記2テストと同じ）。
    await assert.rejects(
      () =>
        search("bad shape", {
          sourceType: "news",
          sourceRole: "evidence",
          timeoutMs: 2000,
          maxRetries: 0,
          providerId: "mock",
        }),
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

// ---------------------------------------------------------------------------
// dedupeSourcesByExactUrl — URL完全一致の最終一意化（Phase53 STEP10.8.1）
// 実バグ: kouda@ab-i.jp のレポート生成で、会社ページ https://www.ab-i.jp が
// government / technology の検索結果として2件 source_pages に残り、
// validate-report.js の source_pages[].url 一意性チェックで reject された。
// ---------------------------------------------------------------------------

test("dedupeSourcesByExactUrl: 完全同一URLは1件に統合される", () => {
  const { deduplicated, removedCount } = dedupeSourcesByExactUrl([
    { id: "a", url: "https://www.ab-i.jp", title: "T1", score: 100 },
    { id: "b", url: "https://www.ab-i.jp", title: "T2", score: 87 },
  ]);
  assert.equal(deduplicated.length, 1);
  assert.equal(removedCount, 1);
  assert.equal(deduplicated[0].url, "https://www.ab-i.jp");
});

test("dedupeSourcesByExactUrl: 同一URL・異なるsource_type/roleでも1件（scoreが高い方を残す）", () => {
  const { deduplicated } = dedupeSourcesByExactUrl([
    { id: "gov", url: "https://www.ab-i.jp", source_type: "government", source_role: "market_change", score: 100 },
    { id: "tech", url: "https://www.ab-i.jp", source_type: "technology", source_role: "industry_trend", score: 87 },
  ]);
  assert.equal(deduplicated.length, 1);
  assert.equal(deduplicated[0].id, "gov", "scoreが高い方を残す");
});

test("dedupeSourcesByExactUrl: 同一URLに会社ページ(source_type:company)が含まれる場合は会社ページを最優先で残す", () => {
  const { deduplicated } = dedupeSourcesByExactUrl([
    { id: "gov", url: "https://www.ab-i.jp", source_type: "government", score: 100 },
    { id: "company", url: "https://www.ab-i.jp", source_type: "company", score: 50, title: "株式会社ABI" },
  ]);
  assert.equal(deduplicated.length, 1);
  assert.equal(deduplicated[0].id, "company", "scoreが低くても会社ページを残す（company_profile.name のため）");
});

test("dedupeSourcesByExactUrl: 異なるURLは全件保持され、並び順も維持される", () => {
  const input = [
    { id: "1", url: "https://www.ab-i.jp", score: 100 },
    { id: "2", url: "https://example.com", score: 90 },
    { id: "3", url: "https://other.example", score: 80 },
  ];
  const { deduplicated, removedCount } = dedupeSourcesByExactUrl(input);
  assert.deepEqual(
    deduplicated.map((s) => s.id),
    ["1", "2", "3"]
  );
  assert.equal(removedCount, 0);
});

test("dedupeSourcesByExactUrl: URLが空/nullの要素はそのまま残す（対象外）", () => {
  const { deduplicated } = dedupeSourcesByExactUrl([
    { id: "a", url: null },
    { id: "b", url: "" },
    { id: "c", url: "https://x.example" },
    { id: "d", url: "https://x.example" },
  ]);
  assert.deepEqual(
    deduplicated.map((s) => s.id),
    ["a", "b", "c"]
  );
});

test("dedupeSourcesByExactUrl: 空配列 / undefined を安全に扱う", () => {
  assert.deepEqual(dedupeSourcesByExactUrl([]), { deduplicated: [], removedCount: 0 });
  assert.deepEqual(dedupeSourcesByExactUrl(undefined), { deduplicated: [], removedCount: 0 });
});

test("dedupeSourcesByExactUrl: STEP10.8再現 — 15件中2件が同一URLでも、最終的にurl一意になる", () => {
  const sources = [];
  // STEP10.8 と同じ: [0] government と [9] technology が同じ https://www.ab-i.jp
  sources.push({ id: "s1", url: "https://www.ab-i.jp", source_type: "government", source_role: "market_change", score: 100 });
  for (let i = 2; i <= 9; i += 1) {
    sources.push({ id: `s${i}`, url: `https://src${i}.example/p`, source_type: "government", source_role: "market_change", score: 90 });
  }
  sources.push({ id: "s10", url: "https://www.ab-i.jp", source_type: "technology", source_role: "industry_trend", score: 87 });
  for (let i = 11; i <= 15; i += 1) {
    sources.push({ id: `s${i}`, url: `https://src${i}.example/p`, source_type: "technology", source_role: "industry_trend", score: 80 });
  }

  const { deduplicated } = dedupeSourcesByExactUrl(sources);
  const urls = deduplicated.map((s) => s.url);
  assert.equal(new Set(urls).size, urls.length, "重複URLが残っていないこと（validate-report.js の一意性チェックが通る）");
  assert.equal(deduplicated.length, 14, "同一URL 2件が1件に統合される");
});
