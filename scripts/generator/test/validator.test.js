/**
 * validator.test.js — Task18: validate-report.js（validateReport/validateReview）の自動テスト。
 * Node標準の node:test / node:assert のみを使用（npm依存なし）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { validateReport, validateReview } = require("../validate-report");
const { readJson } = require("../shared/json-file");
const { REPORT_FIXTURES_DIR, REVIEW_FIXTURES_DIR } = require("../shared/paths");

test("validateReport: good.jsonはPASSする", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  const result = validateReport(report);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("validateReport: average.json/bad.jsonも構造としてはPASSする（品質はquality-evaluator.jsが別途判定）", () => {
  ["average.json", "bad.json"].forEach((name) => {
    const report = readJson(path.join(REPORT_FIXTURES_DIR, name));
    const result = validateReport(report);
    assert.equal(result.ok, true, `${name} は構造的にはPASSするはず`);
  });
});

test("validateReport: 必須フィールド欠如を検出する", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  delete report.paid_analysis;
  const result = validateReport(report);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("paid_analysis")));
});

test("validateReport: source_pages[].idの重複を検出する", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.source_pages[1].id = report.source_pages[0].id;
  const result = validateReport(report);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("重複")));
});

test("validateReport: source_pages[].published_atが正常なISO8601形式ならPASSする", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.source_pages[0].published_at = "2026-01-01T00:00:00+09:00";
  const result = validateReport(report);
  assert.equal(result.ok, true);
});

test("validateReport: source_pages[].published_atがnullでもPASSする（Task32: Tavily実検索で公開日が取得できないケースへの対応）", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.source_pages[0].published_at = null;
  const result = validateReport(report);
  assert.equal(result.ok, true);
});

test("validateReport: source_pages[].published_atが存在しなくてもPASSする（Task32）", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  delete report.source_pages[0].published_at;
  const result = validateReport(report);
  assert.equal(result.ok, true);
});

test("validateReport: source_pages[].published_atが不正な文字列の場合は検出する（Task32: 取得できないこととは区別する）", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.source_pages[0].published_at = "not-a-date";
  const result = validateReport(report);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("published_at")));
});

test("validateReport: evidence[].source_idがsource_pagesに実在しない場合を検出する", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.free_opportunity.evidence.push({ source_id: "src-does-not-exist", quote: "test" });
  const result = validateReport(report);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("src-does-not-exist")));
});

test("validateReport: priority_matrixで同一idが複数象限に重複割り当てされている場合を検出する", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  const quadrants = report.paid_analysis.priority_matrix.quadrants;
  quadrants.high_impact_high_effort.opportunity_ids.push(quadrants.high_impact_low_effort.opportunity_ids[0]);
  const result = validateReport(report);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("重複して割り当てられています")));
});

test("validateReport: evaluationフィールドの不正値を検出する", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.evaluation.status = "INVALID_STATUS";
  const result = validateReport(report);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("evaluation.status")));
});

test("validateReport: fact区分に推測表現があれば警告する（エラーにはしない）", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.free_opportunity.why_now = "対応した方がよいかもしれません。";
  const result = validateReport(report);
  assert.equal(result.ok, true, "推測表現は警告のみでokはtrueのまま");
  assert.ok(result.warnings.some((w) => w.includes("推測表現")));
});

// ---------------------------------------------------------------------------
// Phase53 STEP10.12 — Opportunity Evidence Gate（すべて警告、okはtrueのまま）
// ---------------------------------------------------------------------------

test("STEP10.12 Test E: evidence が全て低スコア/reference の source のみなら警告する", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.source_pages.forEach((s) => {
    s.score = 20;
    s.evidence_strength = "reference";
  });
  const result = validateReport(report);
  assert.equal(result.ok, true, "関連性の問題は警告のみ");
  assert.ok(
    result.warnings.some((w) => w.includes("関連性が低いと判断された source")),
    `期待した警告がない: ${JSON.stringify(result.warnings)}`
  );
});

test("STEP10.12 Test F: evidence に source_type:\"company\" が無ければ警告する（未確認の会社主張への注意）", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  // company source(src-1) を evidence から外す
  report.free_opportunity.evidence = report.free_opportunity.evidence.filter((e) => e.source_id !== "src-1");
  const result = validateReport(report);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((w) => w.includes('source_type:"company"')));
});

test("STEP10.12 Test G: 会社source + 通常スコアの健全な evidence では関連性の警告を出さない（false positive 防止）", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  const result = validateReport(report);
  assert.equal(result.ok, true);
  assert.ok(!result.warnings.some((w) => w.includes("関連性")), `不要な関連性警告: ${JSON.stringify(result.warnings)}`);
  assert.ok(!result.warnings.some((w) => w.includes('source_type:"company"')));
});

test("STEP10.12 Test H: 日本の施策（クールジャパン/JLOX）を中国政府の施策として記述したら警告する", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.free_opportunity.why_now =
    "中国政府は2024年に「新たなクールジャパン戦略」を公表し、コンテンツ輸出を後押ししています。";
  const bad = validateReport(report);
  assert.equal(bad.ok, true);
  assert.ok(bad.warnings.some((w) => w.includes("中国政府の施策として記述")), JSON.stringify(bad.warnings));

  // 正しい主体（日本政府）なら警告は出ない
  const report2 = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report2.free_opportunity.why_now =
    "日本政府は2024年に「新たなクールジャパン戦略」を公表し、コンテンツ輸出を後押ししています。";
  const good = validateReport(report2);
  assert.ok(!good.warnings.some((w) => w.includes("中国政府の施策として記述")));
});

test("STEP10.12 Test H2: 「中国政府系助成金」と日本の施策名が同一 Opportunity に併存したら警告する", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.free_opportunity.title = "中国政府系助成金を活用したアニメ配信支援";
  report.free_opportunity.why_now = "JLOX+の海外展開支援（最大4,000万円）を活用できます。";
  const result = validateReport(report);
  assert.ok(result.warnings.some((w) => w.includes("助成金の主体（日本／中国）を確認")), JSON.stringify(result.warnings));
});

test("validateReport: STEP10.12 の追加チェックは good.json の ok/errors を変えない", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  const result = validateReport(report);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

// ---------------------------------------------------------------------------
// Phase54 STEP1 — Opportunity / Market Change の品質警告（すべて警告、ok は true のまま）
// ---------------------------------------------------------------------------

/** good.json をベースに free_opportunity / company_profile を差し替えた report を作る。 */
function reportWith(overrides) {
  const r = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  if (overrides.company_profile) Object.assign(r.company_profile, overrides.company_profile);
  if (overrides.free_opportunity) Object.assign(r.free_opportunity, overrides.free_opportunity);
  if (overrides.source_pages) r.source_pages = overrides.source_pages;
  return r;
}

test("STEP1 RC-2: 既存事業の言い換え（〜の強化 + business_summary と高重複）は警告する", () => {
  const r = reportWith({
    company_profile: { business_summary: "当社は新規事業立ち上げ支援と企業再生支援を行うコンサルティング会社です。" },
    free_opportunity: { title: "新規事業立ち上げ支援サービスの強化" },
  });
  const v = validateReport(r);
  assert.equal(v.ok, true);
  assert.ok(v.warnings.some((w) => w.includes("既存事業の言い換え")), JSON.stringify(v.warnings));
});

test("STEP1 RC-2: 前向きな新方向（AI活用 等）が title にあれば既存事業警告を出さない", () => {
  const r = reportWith({
    company_profile: { business_summary: "当社は新規事業立ち上げ支援と企業再生支援を行うコンサルティング会社です。" },
    free_opportunity: { title: "生成AIを活用した中小企業向け新規事業診断サービスの立ち上げ" },
  });
  const v = validateReport(r);
  assert.ok(!v.warnings.some((w) => w.includes("既存事業の言い換え")), JSON.stringify(v.warnings));
});

test("STEP1 RC-2: evidence が1件なら警告 / 2件以上なら evidence-count 警告なし", () => {
  const one = reportWith({ free_opportunity: { evidence: [{ source_id: "src-1", quote: "q" }] } });
  assert.ok(validateReport(one).warnings.some((w) => w.includes("evidence が1件")));

  const two = reportWith({
    free_opportunity: {
      evidence: [
        { source_id: "src-1", quote: "q" },
        { source_id: "src-2", quote: "q" },
      ],
    },
  });
  assert.ok(!validateReport(two).warnings.some((w) => w.includes("evidence が") && w.includes("件しか")));
});

test("STEP1 RC-2: evidence に関連性のある外部市場 source が無いと警告する", () => {
  const sp = [
    { id: "src-1", source_type: "company", source_role: "company_fact", label: "自社", url: "https://a", score: 90, evidence_strength: "primary" },
    { id: "src-2", source_type: "government", source_role: "market_change", label: "無関係補助金", url: "https://b", score: 30, evidence_strength: "reference" },
  ];
  const r = reportWith({
    source_pages: sp,
    free_opportunity: {
      evidence: [
        { source_id: "src-1", quote: "q" },
        { source_id: "src-2", quote: "q" },
      ],
    },
  });
  const v = validateReport(r);
  assert.ok(v.warnings.some((w) => w.includes("関連性のある外部市場 source")), JSON.stringify(v.warnings));
});

test("STEP1 RC-2: 関連性のある government/statistics 等が evidence にあれば外部市場警告は出ない", () => {
  const v = validateReport(readJson(path.join(REPORT_FIXTURES_DIR, "good.json")));
  assert.ok(!v.warnings.some((w) => w.includes("関連性のある外部市場 source")), JSON.stringify(v.warnings));
});

test("STEP1 RC-3 Case A/B: market_change が company source のみ → 警告 / external あり → 警告なし", () => {
  const sp = [
    { id: "src-1", source_type: "company", source_role: "company_fact", label: "自社", url: "https://a", score: 90, evidence_strength: "primary" },
    { id: "src-2", source_type: "government", source_role: "market_change", label: "統計", url: "https://b", score: 95, evidence_strength: "primary" },
  ];
  const companyOnly = reportWith({ source_pages: sp, free_opportunity: { market_change: "当社は昔からこの事業をやっています（src-1）。" } });
  assert.ok(validateReport(companyOnly).warnings.some((w) => w.includes("market_change が company source のみ")));

  const withExternal = reportWith({ source_pages: sp, free_opportunity: { market_change: "市場は年10%成長しています（src-2）。当社の事業（src-1）に追い風です。" } });
  assert.ok(!validateReport(withExternal).warnings.some((w) => w.includes("market_change が company source のみ")));
});

test("STEP1 RC-3 Case C: market_change が source_id を1件も引用していない → 警告", () => {
  const r = reportWith({ free_opportunity: { market_change: "なんとなく市場が伸びている気がします。" } });
  assert.ok(validateReport(r).warnings.some((w) => w.includes("source_id を1件も引用していません")));
});

test("STEP1 RC-3: market_change が情報不足を正直に書いている場合は警告しない", () => {
  const r = reportWith({
    free_opportunity: { market_change: "公開情報からは対象企業の市場に関する外部データを十分に取得できなかった。" },
  });
  assert.ok(!validateReport(r).warnings.some((w) => w.includes("market_change")));
});

test("STEP1: 追加チェックは good.json の ok/errors を変えない", () => {
  const v = validateReport(readJson(path.join(REPORT_FIXTURES_DIR, "good.json")));
  assert.equal(v.ok, true);
  assert.deepEqual(v.errors, []);
});

test("validateReview: 4種類のfixtureすべてがPASSする", () => {
  ["pending.json", "approved.json", "needs_revision.json", "rejected.json"].forEach((name) => {
    const review = readJson(path.join(REVIEW_FIXTURES_DIR, name));
    const result = validateReview(review);
    assert.equal(result.ok, true, `${name} はvalidateReviewでPASSするはず`);
  });
});

test("validateReview: 不正なstatusを検出する", () => {
  const result = validateReview({ status: "unknown", comments: [], fixes: [], history: [] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("review.status")));
});

test("validateReview: pending_review以外でreviewerが欠けている場合を検出する", () => {
  const result = validateReview({ status: "approved", reviewer: null, comments: [], fixes: [], history: [] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("reviewer")));
});

test("validateReview: history[].atが不正な日付形式の場合を検出する", () => {
  const result = validateReview({
    status: "pending_review",
    comments: [],
    fixes: [],
    history: [{ at: "not-a-date", action: "comment_added" }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("history[0].at")));
});
