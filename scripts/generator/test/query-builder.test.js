/**
 * query-builder.test.js — Phase54 STEP8A.2（Query Builder 改善）
 *
 * 検索クエリを会社名中心から「会社固有クエリ + 市場クエリ（会社名を主語にしない）」へ
 * 変えたことを固定する。LLM・ネットワークは使わない。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildQueries,
  buildQueriesForCategory,
  extractBusinessKeywords,
  companyNameCores,
  deriveMarketSubject,
} = require("../search/query-builder");
const { downgradeSameNameLocalBusiness } = require("../classify-source");

// --- buildQueries: 会社固有 vs 市場 -------------------------------------

test("buildQueries: 会社固有クエリは1件だけで、会社名＋所在地＋会社概要", () => {
  const qs = buildQueries({ companyName: "株式会社カレイドスコープ", cityWard: "千代田区", industry: "経営コンサルティング業", keywords: ["新規事業", "M&A"] });
  const identity = qs.filter((q) => q.sourceRole === "company_fact");
  assert.equal(identity.length, 1);
  assert.match(identity[0].query, /株式会社カレイドスコープ/);
  assert.match(identity[0].query, /千代田区/);
});

test("buildQueries: 市場クエリは会社名を主語にしない（業種・キーワードが主語）", () => {
  const qs = buildQueries({ companyName: "株式会社カレイドスコープ", industry: "経営コンサルティング業", keywords: ["新規事業", "M&A"] });
  const market = qs.filter((q) => q.sourceRole !== "company_fact");
  assert.ok(market.length >= 4);
  for (const q of market) {
    assert.ok(!q.query.includes("株式会社カレイドスコープ"), `市場クエリに会社名が入っている: ${q.query}`);
    assert.match(q.query, /経営コンサルティング業|新規事業/);
  }
});

test("buildQueries: 市場クエリに「補助金/統計/業界動向/トレンド/最新動向」の観点が含まれる", () => {
  const qs = buildQueries({ companyName: "テスト社", industry: "アニメ産業", keywords: ["配信"] });
  const joined = qs.map((q) => q.query).join(" | ");
  assert.match(joined, /補助金|支援制度/);
  assert.match(joined, /市場規模|統計/);
  assert.match(joined, /業界動向/);
  assert.match(joined, /トレンド|課題/);
  assert.match(joined, /最新動向/);
});

test("buildQueries: 同名会社対策 — 所在地があれば会社固有クエリに必ず入れる", () => {
  const withCity = buildQueries({ companyName: "株式会社タカハシ", cityWard: "荒川区", prefecture: "東京都" });
  assert.match(withCity.find((q) => q.sourceRole === "company_fact").query, /荒川区/);
  const noCity = buildQueries({ companyName: "株式会社タカハシ" });
  assert.doesNotMatch(noCity.find((q) => q.sourceRole === "company_fact").query, /区|市|町|村/);
});

test("buildQueries: 業種が既定(中小企業)の場合はキーワードだけで市場主語を作る", () => {
  const qs = buildQueries({ companyName: "テスト社", industry: "中小企業", keywords: ["店舗ブランディング", "システム開発"] });
  const market = qs.find((q) => q.sourceType === "statistics");
  assert.ok(!market.query.includes("中小企業 市場規模"), market.query);
  assert.match(market.query, /店舗ブランディング|システム開発/);
});

test("buildQueries: 文字列（会社名）を渡す後方互換", () => {
  const qs = buildQueries("テスト株式会社");
  assert.ok(qs.length >= 5);
  assert.ok(qs.some((q) => q.query.includes("テスト株式会社")));
});

test("buildQueriesForCategory: government / statistics は1件、industry は2件", () => {
  const profile = { companyName: "テスト社", industry: "アニメ産業", keywords: ["配信"] };
  assert.equal(buildQueriesForCategory("government", profile).length, 1);
  assert.equal(buildQueriesForCategory("statistics", profile).length, 1);
  assert.equal(buildQueriesForCategory("industry", profile).length, 2);
});

// --- extractBusinessKeywords ------------------------------------------

test("extractBusinessKeywords: 会社名由来の語を除外する", () => {
  const text =
    "株式会社ABI アニメ制作から日本や中国でのコンテンツ配信。プロデュース事業、プロダクション事業、ライブ事業を展開。";
  const kw = extractBusinessKeywords(text, { title: "株式会社ABI", companyName: "株式会社ABI" });
  assert.ok(!kw.includes("ABI"));
  assert.ok(!kw.includes("株式会社"));
  assert.ok(kw.some((k) => /アニメ|コンテンツ|配信|プロデュース|プロダクション/.test(k)), JSON.stringify(kw));
});

test("extractBusinessKeywords: Webナビ語・地名・煽り文句を落とす", () => {
  const text = "お問い合わせ 採用情報 会社概要 私たちは日本と東京で最高のサービスを提供します。美容室・飲食店の店舗経営支援。";
  const kw = extractBusinessKeywords(text, { companyName: "テスト" });
  for (const noise of ["お問い合わせ", "採用情報", "会社概要", "日本", "東京", "サービス"]) {
    assert.ok(!kw.includes(noise), `${noise} が残っている: ${JSON.stringify(kw)}`);
  }
  assert.ok(kw.some((k) => /美容室|飲食店|店舗経営|経営支援/.test(k)), JSON.stringify(kw));
});

test("extractBusinessKeywords: 空文字でクラッシュしない", () => {
  assert.deepEqual(extractBusinessKeywords(""), []);
  assert.deepEqual(extractBusinessKeywords(null), []);
});

test("companyNameCores: 法人格を除いた核と分割セグメントを返す", () => {
  const cores = companyNameCores("株式会社イル・レガメ");
  assert.ok(cores.includes("イル・レガメ"));
  assert.ok(cores.includes("イル") || cores.includes("レガメ"));
});

// --- deriveMarketSubject ----------------------------------------------

test("deriveMarketSubject: 実業種があればキーワードは最大2件添える", () => {
  const s = deriveMarketSubject({ industry: "アニメ産業", keywords: ["制作", "配信", "海外展開", "IP"] });
  assert.match(s, /^アニメ産業/);
  assert.ok(s.split(" ").length <= 3, s);
});

test("deriveMarketSubject: 業種が無ければ既定の主語にフォールバック", () => {
  assert.match(deriveMarketSubject({ industry: "中小企業", keywords: [] }), /中小企業/);
});

// --- STEP4 Post-Filter: downgradeSameNameLocalBusiness ----------------

test("downgradeSameNameLocalBusiness: ディレクトリ掲載でない同名のバー/ネイル/飲食店を directory へ落とす", () => {
  const sources = [
    { id: "src-1", source_type: "company", url: "https://illegame.com", title: "イル・レガメ 公式", score: 93 },
    { id: "src-2", source_type: "news", url: "https://il-legame-bar.example.com", title: "イル・レガメ｜神保町のワインバー", score: 60 },
    { id: "src-3", source_type: "technology", url: "https://nail-illegame.example.jp", title: "ネイルサロン イル・レガメ 渋谷店", score: 55 },
    { id: "src-4", source_type: "government", url: "https://www.jetro.go.jp/report", title: "コンテンツ産業の市場調査", score: 95, evidence_strength: "primary" },
  ];
  const out = downgradeSameNameLocalBusiness(sources, { companyName: "株式会社イル・レガメ", targetUrl: "https://illegame.com" });
  assert.equal(out[1].source_type, "directory");
  assert.ok(out[1].score <= 30);
  assert.equal(out[2].source_type, "directory");
  assert.equal(out[3].source_type, "government", "無関係でない外部市場 source は触らない");
  assert.equal(out[0].source_type, "company", "company source は触らない");
});

test("downgradeSameNameLocalBusiness: 社名を含まないローカル店舗は触らない（誤爆防止）", () => {
  const sources = [{ id: "src-1", source_type: "news", url: "https://retty.me/y", title: "隣町のバー - Retty", score: 50 }];
  const out = downgradeSameNameLocalBusiness(sources, { companyName: "株式会社イル・レガメ", targetUrl: "https://illegame.com" });
  assert.equal(out[0].source_type, "news");
});
