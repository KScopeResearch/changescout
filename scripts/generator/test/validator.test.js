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
