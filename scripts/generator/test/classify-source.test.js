/**
 * classify-source.test.js — Phase54 STEP8A.1（Source Classification Root Cause Fix）
 *
 * classify-source.js の内容ベース再分類を固定する。検索クエリのテンプレートが付けた
 * source_type（"<会社名> 補助金" → government 等）を信頼せず、ドメイン・タイトルから
 * directory / review / government / statistics / company を正しく判定できることを確認する。
 * LLM・ネットワークは一切使わない。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  classifySource,
  isLocalDirectory,
  reclassifySources,
  applyScoreCaps,
} = require("../classify-source");
const { buildTopSources } = require("../generate-company-report");
const { validateReport } = require("../validate-report");

const TARGET = "https://illegame.com";
const c = (item, targetUrl = TARGET) => classifySource(item, { targetUrl });

// --- directory 分類（RC-A1 / STEP3: Local Directory Guard）--------------------

test("Retty のバー紹介ページは directory（government ではない）", () => {
  const r = c({
    url: "https://retty.me/area/PRE13/ARE11/SUB1104/100000601984",
    title: "ILLegame（イル レガメ)）（神保町/バー） - Retty（レッティ）",
    source_type: "government",
  });
  assert.equal(r.source_type, "directory");
  assert.equal(r.evidenceStrength, "reference");
  assert.ok(r.scoreCap <= 30);
});

test("ホットペッパービューティーの口コミページは directory/review 系（score<=30）", () => {
  const r = c({
    url: "https://beauty.hotpepper.jp/kr/slnH000661043/review",
    title: "口コミ｜ネイルイルレガーメ(Nail il legame)｜ホットペッパービューティー",
    source_type: "technology",
  });
  assert.ok(["directory", "review"].includes(r.source_type), `actual: ${r.source_type}`);
  assert.ok(r.scoreCap <= 30);
});

test("Google マップの店舗ページは directory", () => {
  const r = c({
    url: "https://www.google.com/maps/place/IL+Legame/@35.6,139.7,17z",
    title: "IL Legame - Google マップ",
    source_type: "government",
  });
  assert.equal(r.source_type, "directory");
});

test("Baseconnect / Musubu の企業DBページは directory", () => {
  const r = c({
    url: "https://baseconnect.in/companies/abcdef",
    title: "株式会社イル・レガメの会社情報 - Baseconnect",
    source_type: "government",
  });
  assert.equal(r.source_type, "directory");
});

test("全国法人リスト（houjin.jp）の企業詳細は directory", () => {
  const r = c({
    url: "https://houjin.jp/c/8010001148581",
    title: "株式会社イル・レガメ(東京都千代田区)の企業詳細 - 全国法人リスト",
    source_type: "government",
  });
  assert.equal(r.source_type, "directory");
});

test("BIZMAPS / SalesNow / アラームボックス の企業情報は directory", () => {
  for (const item of [
    { url: "https://biz-maps.com/item/V2lkj0n215", title: "株式会社イル・レガメの企業情報（電話番号・住所）｜BIZMAPS（ビズマップ）" },
    { url: "https://salesnow.jp/db/companies/jcbn4ubusaaaasfg6", title: "株式会社イル・レガメ" },
    { url: "https://alarmbox.jp/companyinfo/entities/8010001148581", title: "株式会社イル・レガメ(東京都千代田区)の評判・口コミ・インボイス登録番号・会社概要 | アラームボックス" },
  ]) {
    const r = c({ ...item, source_type: "news" });
    assert.ok(["directory", "review"].includes(r.source_type), `${item.url} → ${r.source_type}`);
  }
});

test("Creema / goope（ハンドメイド通販・無料HP作成）は directory", () => {
  assert.equal(c({ url: "https://www.creema.jp/c/illegame", title: "il legame のギャラリー | ハンドメイド通販・販売のCreema" }).source_type, "directory");
  assert.equal(c({ url: "https://r.goope.jp/il-legame", title: "il legameの公式サイト｜ハンドメイドの革製品" }).source_type, "directory");
});

test("求人サイト（Indeed / リクナビ）は directory", () => {
  assert.equal(c({ url: "https://jp.indeed.com/cmp/株式会社イル・レガメ", title: "株式会社イル・レガメの求人 | Indeed" }).source_type, "directory");
});

// --- review 分類 -----------------------------------------------------------

test("OpenWork（カイシャの評判）は review", () => {
  const r = c({ url: "https://www.openwork.jp/company_answer.php?m_id=a000000&q_no=1", title: "株式会社イル・レガメの評判・口コミ | OpenWork" });
  assert.equal(r.source_type, "review");
  assert.ok(r.scoreCap <= 30);
});

// --- government 分類（RC-A2）----------------------------------------------

test("JETRO（jetro.go.jp）は government", () => {
  assert.equal(c({ url: "https://www.jetro.go.jp/ext_images/_Reports/02/2026/xxxx/animation.pdf", title: "中国のアニメに関する市場調査 2025年度更新版", source_type: "statistics" }).source_type, "government");
});

test("VIPO（vipo.or.jp）は government（指示書 RC-A2 で明示）", () => {
  assert.equal(c({ url: "https://www.vipo.or.jp/interview/list/detail?i=745", title: "急速に成長をする中国アニメ配信市場で", source_type: "industry_association" }).source_type, "government");
});

test("総務省・経産省など省庁ドメイン(.go.jp)は government", () => {
  assert.equal(c({ url: "https://www.meti.go.jp/shingikai/mono_info_service/xxx/pdf/003_04_02.pdf", title: "業界の現状及びアクションプラン（案）について 【アニメ】", source_type: "industry_association" }).source_type, "government");
  assert.equal(c({ url: "https://www.soumu.go.jp/main_content/000900000.pdf", title: "情報通信白書", source_type: "news" }).source_type, "government");
});

test("自治体ドメイン（city.*.jp / lg.jp）は government", () => {
  assert.equal(c({ url: "https://www.city.chiyoda.lg.jp/koho/sangyo/hojokin.html", title: "千代田区 中小企業向け補助金", source_type: "news" }).source_type, "government");
});

test("民間の補助金まとめサイト（hojokin-agent.jp 等）は government ではない（RC-A2）", () => {
  const r = c({ url: "https://hojokin-agent.jp/subsidy/307", title: "令和7年度「放送コンテンツ製作促進事業」間接補助事業者 | 補助金エージェント", source_type: "government" });
  assert.notEqual(r.source_type, "government");
  assert.ok(r.scoreCap != null && r.scoreCap <= 30);
});

test("「使える補助金まとめ」型の記事は government ではない（RC-A2）", () => {
  const r = c({ url: "https://hojyokin-portal.jp/columns/movie_hojyo", title: "【2026年版・一覧】映画・映像・動画制作に使える補助金まとめ", source_type: "government" });
  assert.notEqual(r.source_type, "government");
});

// --- statistics 分類（RC-A3）--------------------------------------------

test("e-Stat / 政府統計は statistics", () => {
  assert.equal(c({ url: "https://www.e-stat.go.jp/stat-search/files?stat_infid=000040108", title: "経済構造実態調査 産業別統計表", source_type: "government" }).source_type, "government"); // .go.jp は government が優先
  assert.equal(c({ url: "https://example-research.com/report", title: "国内アニメ市場の市場規模・市場調査レポート 2025", source_type: "news" }).source_type, "statistics");
});

test("帝国データバンク・矢野経済研究所は statistics", () => {
  assert.equal(c({ url: "https://www.tdb.co.jp/report/industry/20250813-anime24y", title: "「アニメ制作市場」動向調査2025｜株式会社 帝国データバンク[TDB]", source_type: "industry_association" }).source_type, "statistics");
});

test("SEO記事・比較記事は statistics にしない（RC-A3）", () => {
  const r = c({ url: "https://blog.example.com/anime-market", title: "アニメ市場の市場規模まとめ｜おすすめ動画配信サービス比較ランキング記事", source_type: "statistics" });
  assert.notEqual(r.source_type, "statistics");
});

// --- company collision（RC-A4）-----------------------------------------

test("対象企業ドメイン（サブドメイン含む）は company", () => {
  assert.equal(c({ url: "https://illegame.com/", title: "イル・レガメのホームページ", source_type: "company" }).source_type, "company");
  assert.equal(
    classifySource({ url: "https://news.ab-i.jp/2026/01", title: "ニュース", source_type: "news" }, { targetUrl: "https://www.ab-i.jp" }).source_type,
    "company"
  );
});

test("別ドメインの同名他社サイトは company にしない（RC-A4: abi-inc.co.jp / kaleidoscope-jp.com）", () => {
  const abi = classifySource(
    { url: "https://abi-inc.co.jp/", title: "株式会社ABI｜先端バイオ", source_type: "company" },
    { targetUrl: "https://www.ab-i.jp" }
  );
  assert.notEqual(abi.source_type, "company");
  assert.ok(abi.scoreCap != null && abi.scoreCap <= 30);

  const kaleido = classifySource(
    { url: "https://kaleidoscope-jp.com/", title: "KALEIDOSCOPE 株式会社", source_type: "company" },
    { targetUrl: "https://kscope.co.jp" }
  );
  assert.notEqual(kaleido.source_type, "company");
});

// --- mock（simulated）は再分類しない -----------------------------------

test("simulated（mock）由来はテンプレ由来の型を維持する", () => {
  const r = c({
    url: "https://source.example.com/mock-search/xxx-1",
    title: "○○ 補助金 に関する検索結果（mock providerによる合成データ）",
    source_type: "government",
    simulated: true,
  });
  assert.equal(r.source_type, "government");
  assert.equal(r.scoreCap, null);
});

// --- isLocalDirectory ---------------------------------------------------

test("isLocalDirectory: 対象ドメインと別の店舗/企業DBページで true、自社ページで false", () => {
  assert.equal(isLocalDirectory({ url: "https://retty.me/area/PRE13/x", title: "バー - Retty" }, TARGET), true);
  assert.equal(isLocalDirectory({ url: "https://illegame.com/", title: "自社" }, TARGET), false);
  assert.equal(isLocalDirectory({ url: "https://www.jetro.go.jp/x.pdf", title: "市場調査" }, TARGET), false);
});

// --- reclassifySources / applyScoreCaps -------------------------------

test("reclassifySources + applyScoreCaps: directory は score<=30・evidence_strength=reference になる", () => {
  const normalized = [
    { id: null, url: "https://illegame.com/", title: "自社", source_type: "company", evidence_strength: "primary", score: null, simulated: false },
    { id: null, url: "https://retty.me/area/x", title: "バー - Retty", source_type: "government", evidence_strength: "primary", score: null, simulated: false },
    { id: null, url: "https://www.jetro.go.jp/report.pdf", title: "中国アニメ市場調査", source_type: "statistics", evidence_strength: "secondary", score: null, simulated: false },
  ];
  const re = reclassifySources(normalized, { targetUrl: TARGET });
  assert.equal(re[0].source_type, "company");
  assert.equal(re[1].source_type, "directory");
  assert.equal(re[1].evidence_strength, "reference");
  assert.equal(re[2].source_type, "government");

  const scored = applyScoreCaps(re.map((s, i) => ({ ...s, score: [93, 95, 95][i] })));
  assert.equal(scored[0].score, 93);
  assert.ok(scored[1].score <= 30, `directory は cap される: ${scored[1].score}`);
  assert.equal(scored[2].score, 95);
});

// --- top source exclusion（STEP4）------------------------------------

test("buildTopSources: directory / review は top_sources に出さない（cited でも）", () => {
  const sourcePages = [
    { id: "src-1", source_type: "company", score: 93, label: "イル・レガメのホームページ" },
    { id: "src-2", source_type: "directory", score: 30, evidence_strength: "reference", label: "バー - Retty" },
    { id: "src-3", source_type: "review", score: 30, evidence_strength: "reference", label: "評判 - OpenWork" },
    { id: "src-4", source_type: "government", score: 100, evidence_strength: "primary", label: "AI導入補助金 デジタル化支援" },
  ];
  const { top_sources } = buildTopSources(sourcePages, {
    evidenceIds: ["src-1", "src-4"],
    relevanceHints: "イル・レガメ AI導入 デジタル化 補助金",
  });
  const ids = top_sources.map((s) => s.id);
  assert.deepEqual(ids, ["src-1", "src-4"]);
  assert.ok(!ids.includes("src-2"));
  assert.ok(!ids.includes("src-3"));
});

// --- market change validation（STEP5）------------------------------

function baseReport() {
  return {
    meta: { schema_version: "2.4", generated_at: "2026-09-08T00:00:00.000Z" },
    company_profile: { name: "テスト社", business_summary: "アニメの企画・制作。" },
    source_pages: [
      { id: "src-1", source_type: "company", source_role: "company_fact", label: "自社", url: "https://a.example", score: 90, evidence_strength: "primary" },
      { id: "src-2", source_type: "directory", source_role: "evidence", label: "Retty", url: "https://retty.me/x", score: 25, evidence_strength: "reference" },
      { id: "src-3", source_type: "government", source_role: "market_change", label: "市場統計", url: "https://x.go.jp/y", score: 90, evidence_strength: "primary" },
    ],
    free_opportunity: {
      title: "AI活用の新サービス立ち上げ",
      why_now: "外部環境が変化している。",
      why_company: "自社は制作力がある（src-1）。",
      market_change: "アニメIPの海外需要が伸びている。",
      first_action: "既存顧客にヒアリングする。",
      extended_analysis: { summary: "x", risk: "y", roadmap: "z" },
      evidence: [{ source_id: "src-1", quote: "q" }, { source_id: "src-3", quote: "q" }],
    },
    locked_opportunities: [],
    paid_analysis: {
      decision_summary: { recommendation: "x", rationale: "y", risks: "z" },
      additional_opportunities: [],
      priority_matrix: {
        quadrants: {
          high_impact_low_effort: { opportunity_ids: [] },
          high_impact_high_effort: { opportunity_ids: [] },
          low_impact_low_effort: { opportunity_ids: [] },
          low_impact_high_effort: { opportunity_ids: [] },
        },
      },
    },
    evaluation: { score: 80, grade: "B", status: "PASS", reasons: [], warnings: [], improvements: [] },
  };
}

test("STEP5: market_change が directory のみを引用していたら error（HOLD）", () => {
  const r = baseReport();
  r.free_opportunity.market_change =
    "同業のバーが賑わっており、地域の集客が伸びているとされる（src-2）。この流れは当社にとって好機である。";
  const v = validateReport(r);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("外部市場 source")), JSON.stringify(v.errors));
});

test("STEP5: market_change が score>=70 の government を引用していれば PASS", () => {
  const r = baseReport();
  r.free_opportunity.market_change =
    "アニメIPの海外需要が拡大し、政府統計でも市場成長が確認できる（src-3）。当社が参入する好機である。";
  const v = validateReport(r);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test("STEP6: Opportunity evidence が directory/reference のみなら error（HOLD）", () => {
  const r = baseReport();
  r.free_opportunity.evidence = [{ source_id: "src-2", quote: "q" }];
  const v = validateReport(r);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("directory/review・reference")), JSON.stringify(v.errors));
});
