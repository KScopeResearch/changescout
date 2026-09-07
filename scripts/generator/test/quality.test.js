/**
 * quality.test.js — Task18: quality-evaluator.js（evaluateReportQuality）の自動テスト。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const {
  evaluateReportQuality,
  gradeFromScore,
  statusFromScore,
  classifySourceRelevance,
  summarizeRelevance,
} = require("../quality-evaluator");
const { readJson } = require("../shared/json-file");
const { REPORT_FIXTURES_DIR } = require("../shared/paths");

// Phase53 STEP10.13 用のヘルパー: source_pages を組み立てた最小 report を作る。
function reportWithSources(sourcePages, extra = {}) {
  return {
    meta: { schema_version: "2.4" },
    company_profile: { name: "テスト" },
    source_pages: sourcePages.map((s, i) => ({
      id: `src-${i + 1}`,
      source_type: s.source_type,
      source_role: s.source_role || "evidence",
      evidence_strength: s.evidence_strength || "secondary",
      label: s.label || `s${i + 1}`,
      url: s.url || `https://ex${i + 1}.example`,
      published_at: null,
      score: s.score,
    })),
    free_opportunity: {
      title: "t",
      evidence: (extra.evidence || []).map((id) => ({ source_id: id, quote: "q" })),
      extended_analysis: {},
    },
    human_review: { status: extra.humanReview || "pending_review" },
    ...extra.top,
  };
}

test("good.jsonはPASS/grade A相当のスコアになる", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  const evaluation = evaluateReportQuality(report);
  assert.equal(evaluation.status, "PASS");
  assert.equal(evaluation.grade, "A");
  assert.ok(evaluation.score >= 90);
});

test("average.jsonはREVIEWになる", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "average.json"));
  const evaluation = evaluateReportQuality(report);
  assert.equal(evaluation.status, "REVIEW");
});

test("bad.jsonはFAILになる", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "bad.json"));
  const evaluation = evaluateReportQuality(report);
  assert.equal(evaluation.status, "FAIL");
  assert.ok(evaluation.score <= 49);
});

test("breakdownの各項目points合計がscoreと一致する", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  const evaluation = evaluateReportQuality(report);
  const sum = Object.values(evaluation.breakdown).reduce((acc, item) => acc + item.points, 0);
  assert.equal(sum, evaluation.score);
});

test("gradeFromScore: 境界値が仕様どおりマッピングされる", () => {
  assert.equal(gradeFromScore(100), "A");
  assert.equal(gradeFromScore(90), "A");
  assert.equal(gradeFromScore(89), "B");
  assert.equal(gradeFromScore(80), "B");
  assert.equal(gradeFromScore(79), "C");
  assert.equal(gradeFromScore(70), "C");
  assert.equal(gradeFromScore(69), "D");
  assert.equal(gradeFromScore(0), "D");
});

test("statusFromScore: 境界値が仕様どおりマッピングされる", () => {
  assert.equal(statusFromScore(100), "PASS");
  assert.equal(statusFromScore(80), "PASS");
  assert.equal(statusFromScore(79), "REVIEW");
  assert.equal(statusFromScore(50), "REVIEW");
  assert.equal(statusFromScore(49), "FAIL");
  assert.equal(statusFromScore(0), "FAIL");
});

test("human_review.statusがapprovedなら該当breakdown項目が満点になる", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  const evaluation = evaluateReportQuality(report);
  assert.equal(evaluation.breakdown.human_review_status.points, evaluation.breakdown.human_review_status.max);
});

test("情報源が0件の場合でも例外を投げずに低スコアを返す", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "bad.json"));
  report.source_pages = [];
  const evaluation = evaluateReportQuality(report);
  assert.equal(evaluation.status, "FAIL");
  assert.ok(evaluation.score >= 0);
});

// ---------------------------------------------------------------------------
// Phase53 STEP10.13 — Source Relevance を評価軸に追加（P2-4 修正）
// ---------------------------------------------------------------------------

test("classifySourceRelevance: company=A / 低score・reference=D / 高score=B / 中間=C", () => {
  assert.equal(classifySourceRelevance({ source_type: "company", score: 93 }), "A");
  assert.equal(classifySourceRelevance({ source_type: "government", score: 30 }), "D");
  assert.equal(classifySourceRelevance({ source_type: "news", score: 35, evidence_strength: "reference" }), "D");
  assert.equal(classifySourceRelevance({ source_type: "government", score: 100 }), "B");
  assert.equal(classifySourceRelevance({ source_type: "technology", score: 55 }), "C");
  assert.equal(classifySourceRelevance({ source_type: "news" }), "C"); // score無し（旧データ）
});

test("STEP10.13 Test A: government source でも関連性が低い（D）なら presence 加点しない", () => {
  const report = reportWithSources([
    { source_type: "company", score: 90 },
    { source_type: "government", score: 30, evidence_strength: "reference" }, // 無関係な自治体補助金など
    { source_type: "industry_association", score: 85 },
  ]);
  const ev = evaluateReportQuality(report);
  assert.equal(ev.breakdown.government_presence.points, 0, "D の government では加点されない");
  assert.ok(ev.breakdown.government_presence.detail.includes("関連性が低い"));
});

test("STEP10.13 Test B: company source は関連性 A として扱われる", () => {
  const { counts } = summarizeRelevance([{ source_type: "company", score: 88 }]);
  assert.equal(counts.A, 1);
});

test("STEP10.13 Test C: 同名別法人（guard で score<=30 に降格済み）は D として集計される", () => {
  const { counts } = summarizeRelevance([
    { source_type: "technology", score: 30, evidence_strength: "reference" }, // abi-inc.co.jp 相当
    { source_type: "company", score: 90 },
  ]);
  assert.equal(counts.D, 1);
  assert.equal(counts.A, 1);
});

test("STEP10.13 Test D: reference + 低score のみに依存した source 群は関連性軸で低評価", () => {
  const report = reportWithSources([
    { source_type: "government", score: 28, evidence_strength: "reference" },
    { source_type: "news", score: 25, evidence_strength: "reference" },
    { source_type: "industry_association", score: 30, evidence_strength: "reference" },
  ]);
  const ev = evaluateReportQuality(report);
  assert.ok(ev.breakdown.source_relevance.points <= 3, `got ${ev.breakdown.source_relevance.points}`);
});

test("STEP10.13 Test E: A/B 比率が高い source 群は関連性軸で高評価", () => {
  const report = reportWithSources([
    { source_type: "company", score: 90 },
    { source_type: "government", score: 95 },
    { source_type: "statistics", score: 92 },
    { source_type: "industry_association", score: 88 },
    { source_type: "technology", score: 85 },
  ]);
  const ev = evaluateReportQuality(report);
  assert.ok(ev.breakdown.source_relevance.points >= 11, `got ${ev.breakdown.source_relevance.points}`);
  assert.equal(ev.breakdown.source_relevance.noiseRatio, 0);
});

test("STEP10.13 Test F: D/noise 比率が高い source 群は関連性軸で低評価 + 警告", () => {
  const report = reportWithSources([
    { source_type: "company", score: 90 },
    { source_type: "government", score: 95 },
    ...Array.from({ length: 6 }, () => ({ source_type: "government", score: 30, evidence_strength: "reference" })),
  ]);
  const ev = evaluateReportQuality(report);
  assert.ok(ev.breakdown.source_relevance.noiseRatio >= 0.5);
  assert.ok(ev.breakdown.source_relevance.points <= 6);
  assert.ok(ev.warnings.some((w) => w.includes("関連性が低い")));
});

test("STEP10.13 Test G: illegame.com 型（company 1 + 高score noise の government 数件 + 低score noise 多数）は A 評価にならない", () => {
  const report = reportWithSources(
    [
      { source_type: "company", score: 93 },
      { source_type: "government", score: 100 }, // 桐生市 移住助成（現状は高score）
      { source_type: "government", score: 100 }, // 日高市
      { source_type: "government", score: 100 },
      { source_type: "statistics", score: 95 },
      { source_type: "industry_association", score: 90 },
      { source_type: "technology", score: 87 },
      { source_type: "technology", score: 87 },
      { source_type: "news", score: 80 },
      ...Array.from({ length: 6 }, () => ({ source_type: "news", score: 28, evidence_strength: "reference" })),
    ],
    { evidence: ["src-1", "src-2", "src-3", "src-5"], humanReview: "pending_review" }
  );
  const ev = evaluateReportQuality(report);
  assert.notEqual(ev.grade, "A", `illegame 型で grade A は不適切（score=${ev.score}）`);
});

test("STEP10.13 Test H: ab-i.jp 型（company + 業界・市場関連 source が大半、noise 1件）は関連 source が適切に評価される", () => {
  const report = reportWithSources(
    [
      { source_type: "company", score: 90 },
      ...Array.from({ length: 4 }, () => ({ source_type: "government", score: 100 })),
      { source_type: "statistics", score: 95 },
      ...Array.from({ length: 3 }, () => ({ source_type: "industry_association", score: 90 })),
      ...Array.from({ length: 4 }, () => ({ source_type: "technology", score: 87 })),
      { source_type: "industry_association", score: 30, evidence_strength: "reference" }, // abi-inc 相当
    ],
    { evidence: ["src-1", "src-2", "src-6", "src-9"] }
  );
  const ev = evaluateReportQuality(report);
  assert.ok(ev.breakdown.source_relevance.points >= 10, `関連 source 多数なら高評価: got ${ev.breakdown.source_relevance.points}`);
  assert.ok(ev.breakdown.source_relevance.relevantRatio >= 0.85);
});

test("STEP10.13 Test I: STEP10.12 relevance guard の結果（score<=30/reference）を Evaluator が D として認識する", () => {
  const guardDowngraded = { source_type: "government", score: 30, evidence_strength: "reference" };
  assert.equal(classifySourceRelevance(guardDowngraded), "D");
});

test("STEP10.13 Test J: score を持たない旧形式 report でも評価軸がクラッシュせず中立点を返す", () => {
  const report = reportWithSources([
    { source_type: "company" },
    { source_type: "government" },
    { source_type: "news" },
  ]);
  report.source_pages.forEach((s) => delete s.score);
  const ev = evaluateReportQuality(report);
  assert.ok(Number.isFinite(ev.score));
  assert.equal(ev.breakdown.source_relevance.relevantRatio, null);
  assert.ok(ev.breakdown.source_relevance.points > 0, "旧形式は中立点（0ではない）");
});

test("STEP10.13: 12→13項目になっても breakdown 合計 === score（good/average/bad）", () => {
  ["good.json", "average.json", "bad.json"].forEach((name) => {
    const ev = evaluateReportQuality(readJson(path.join(REPORT_FIXTURES_DIR, name)));
    const sum = Object.values(ev.breakdown).reduce((a, i) => a + i.points, 0);
    assert.equal(sum, ev.score, `${name}: sum(${sum}) !== score(${ev.score})`);
    assert.ok(ev.score >= 0 && ev.score <= 100);
  });
});
