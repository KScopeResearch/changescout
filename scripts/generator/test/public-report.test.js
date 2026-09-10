/**
 * public-report.test.js — Phase58 STEP1: Public Report Contract / Data Boundary Hardening。
 *
 * shared/public-report.js の buildPublicReport()（allowlist 射影）と
 * findInternalFieldLeaks()（多層防御チェック）を検証する。
 *
 * 本質: 「公開画面に表示されない」ではなく「公開 JSON そのものに存在しない」を保証する。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const {
  buildPublicReport,
  findInternalFieldLeaks,
  normalizePublishedAt,
  PUBLIC_TOP_LEVEL_FIELDS,
  PUBLIC_META_FIELDS,
  PUBLIC_HUMAN_REVIEW_FIELDS,
} = require("../shared/public-report");
const { readJson } = require("../shared/json-file");
const { checkPublicReportInternalFields } = require("../shared/public-data-safety-check");

const GOOD = readJson(path.join(__dirname, "..", "fixtures", "good.json"));

/** 内部フィールドを一通り盛った、生成直後相当の report を作る。 */
function internalRichReport() {
  return {
    ...GOOD,
    id: "generated-test.example.com",
    meta: {
      schema_version: "2.4",
      generated_at: "2026-09-10T00:00:00.000Z",
      pipeline_version: "phase1-generator-v0.3-llm",
      industry_category: "テスト業",
      note: "LLM_PROVIDER=deepseek で生成。内部 Task メモ。シミュレーションデータ。",
      opportunity_theme_fixed: "テストテーマ",
      opportunity_theme_search_applied: true,
    },
    ai_pipeline: { provider: "deepseek", model: "deepseek-v4-flash" },
    evaluation: {
      score: 82,
      grade: "B",
      status: "PASS",
      reasons: ["x"],
      warnings: [],
      improvements: [],
      breakdown: { source_relevance: { points: 8, max: 15 } },
    },
    send_target: {
      email: "info@test.example.com",
      acquisition_route: "official_site_public_contact",
      opt_in_recorded: false,
    },
    human_review: {
      status: "approved",
      reviewer: "Claude",
      reviewed_at: "2026-09-10T01:00:00.000Z",
      review_duration_minutes: 12,
      checklist: { company_info_accurate: true },
      notes: "内部レビューメモ",
      review_history: [{ at: "2026-09-10T01:00:00.000Z", actor: "Claude", action: "approved" }],
    },
  };
}

// ---------------------------------------------------------------------------
// Test 1 — Public Projection: 内部フィールドは公開 JSON に存在しない
// ---------------------------------------------------------------------------
test("Test1: buildPublicReport は evaluation / ai_pipeline / send_target / 内部レビュー運用情報を落とす", () => {
  const pub = buildPublicReport(internalRichReport());

  assert.equal("evaluation" in pub, false, "evaluation は公開しない");
  assert.equal("ai_pipeline" in pub, false, "ai_pipeline は公開しない");
  assert.equal("send_target" in pub, false, "send_target は公開しない");

  assert.equal("reviewer" in pub.human_review, false);
  assert.equal("notes" in pub.human_review, false);
  assert.equal("checklist" in pub.human_review, false);
  assert.equal("review_history" in pub.human_review, false);
  assert.equal("review_duration_minutes" in pub.human_review, false);
  assert.deepEqual(Object.keys(pub.human_review).sort(), ["reviewed_at", "status"]);

  assert.equal("note" in pub.meta, false, "meta.note（内部生成メモ）は公開しない");
  assert.equal("pipeline_version" in pub.meta, false, "meta.pipeline_version は公開しない");

  // 文字列化しても LLM provider 名・reviewer キー・evaluation ブロックが出てこないこと（直 fetch 相当）
  const serialized = JSON.stringify(pub);
  assert.equal(/deepseek/i.test(serialized), false, "LLM provider 名が公開 JSON に出てはいけない");
  assert.equal(/"reviewer"\s*:/.test(serialized), false, "reviewer キーが公開 JSON に出てはいけない");
  assert.equal(/"evaluation"\s*:/.test(serialized), false, "evaluation ブロックが公開 JSON に出てはいけない");
  assert.equal(pub.evaluation, undefined);
});

test("Test1b: source relevance / government presence 等の評価内訳も公開 JSON から取得できない", () => {
  const pub = buildPublicReport(internalRichReport());
  const serialized = JSON.stringify(pub);
  for (const marker of ["source_relevance", "breakdown", '"grade"', '"status":"PASS"']) {
    assert.equal(serialized.includes(marker), false, `${marker} が公開 JSON に出てはいけない`);
  }
});

// ---------------------------------------------------------------------------
// Test 2 — Allowlist Future Safety: 未知の内部フィールドは漏れない
// ---------------------------------------------------------------------------
test("Test2: 未知のトップレベル内部フィールドは公開 JSON へ漏れない（allowlist 方式）", () => {
  const report = { ...internalRichReport(), future_internal_secret: "must-not-leak", another_new_field: { x: 1 } };
  const pub = buildPublicReport(report);
  assert.equal("future_internal_secret" in pub, false);
  assert.equal("another_new_field" in pub, false);
  assert.equal(JSON.stringify(pub).includes("must-not-leak"), false);
});

test("Test2b: 未知の meta / human_review サブフィールドも漏れない", () => {
  const report = internalRichReport();
  report.meta.future_meta_secret = "leak-meta";
  report.human_review.future_hr_secret = "leak-hr";
  const pub = buildPublicReport(report);
  assert.equal("future_meta_secret" in pub.meta, false);
  assert.equal("future_hr_secret" in pub.human_review, false);
  assert.equal(JSON.stringify(pub).includes("leak-meta"), false);
  assert.equal(JSON.stringify(pub).includes("leak-hr"), false);
});

test("Test2c: findInternalFieldLeaks は allowlist 外フィールド・内部専用キーを検出する", () => {
  assert.deepEqual(findInternalFieldLeaks(buildPublicReport(internalRichReport())), [], "正常な射影は違反ゼロ");

  const leaky = { ...buildPublicReport(internalRichReport()), evaluation: { score: 1 }, sneaky: true };
  const leaks = findInternalFieldLeaks(leaky);
  assert.ok(leaks.some((v) => v.includes("evaluation")));
  assert.ok(leaks.some((v) => v.includes("sneaky")));

  // 公開コンテナの内側にネストされた内部専用キーも検出する
  const nested = buildPublicReport(internalRichReport());
  nested.company_profile = { ...nested.company_profile, ai_pipeline: { provider: "x" } };
  assert.ok(findInternalFieldLeaks(nested).some((v) => v.includes("company_profile.ai_pipeline")));
});

// ---------------------------------------------------------------------------
// Test 3 — Public Required Fields: 公開に必要なフィールドは維持される
// ---------------------------------------------------------------------------
test("Test3: 公開 renderer / teaser が必要とするフィールドは維持される", () => {
  const pub = buildPublicReport(internalRichReport());

  // renderer（report-preview.js / preview-ui.js / paid-preview.js）
  assert.ok(pub.company_profile, "company_profile");
  assert.ok(pub.free_opportunity, "free_opportunity");
  assert.ok(Array.isArray(pub.source_pages), "source_pages");
  assert.ok(pub.locked_opportunities, "locked_opportunities");
  assert.ok(pub.paid_analysis, "paid_analysis");
  assert.ok(pub.meta && pub.meta.generated_at, "meta.generated_at");

  // human_review line（「運営が確認しました」＋日付）
  assert.equal(pub.human_review.status, "approved");
  assert.ok(pub.human_review.reviewed_at);

  // free_opportunity の中身はそのまま（公開コンテンツ）
  assert.deepEqual(pub.free_opportunity, internalRichReport().free_opportunity);
});

test("Test3b: 入力は変更されない（純粋関数）", () => {
  const report = internalRichReport();
  const before = JSON.stringify(report);
  buildPublicReport(report);
  assert.equal(JSON.stringify(report), before, "buildPublicReport は入力 report を変更してはならない");
});

// ---------------------------------------------------------------------------
// Test 4 — Published Timestamp
// ---------------------------------------------------------------------------
test("Test4: meta.published_at は valid な ISO 8601 で、generated_at <= published_at", () => {
  const report = internalRichReport();
  const pub = buildPublicReport(report, { publishedAt: "2026-09-10T12:37:06.000Z" });
  assert.equal(pub.meta.published_at, "2026-09-10T12:37:06.000Z");
  assert.ok(new Date(report.meta.generated_at) <= new Date(pub.meta.published_at));

  // 省略時は現在時刻（ISO 8601）
  const now = buildPublicReport(report);
  assert.match(now.meta.published_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(!isNaN(new Date(now.meta.published_at).getTime()));

  // Date オブジェクトも受け付ける
  const d = new Date("2026-01-02T03:04:05.000Z");
  assert.equal(buildPublicReport(report, { publishedAt: d }).meta.published_at, d.toISOString());

  // 不正値は現在時刻へフォールバック
  assert.match(normalizePublishedAt("not-a-date"), /^\d{4}-\d{2}-\d{2}T/);
  assert.match(normalizePublishedAt(undefined), /^\d{4}-\d{2}-\d{2}T/);
});

test("Test4b: meta が無い report でも published_at 付きの meta を生成する", () => {
  const { meta, ...noMeta } = internalRichReport();
  const pub = buildPublicReport(noMeta, { publishedAt: "2026-09-10T12:00:00.000Z" });
  assert.equal(pub.meta.published_at, "2026-09-10T12:00:00.000Z");
});

// ---------------------------------------------------------------------------
// Test 5 — Renderer Compatibility（実 renderer が読むフィールド集合をカバー）
// ---------------------------------------------------------------------------
test("Test5: renderer / teaser が参照する既知フィールド一覧が全て射影結果に含まれる", () => {
  const pub = buildPublicReport(internalRichReport());
  // report-preview.js: data.company_profile / free_opportunity / source_pages / top_sources /
  //   hidden_sources_count / locked_opportunities / meta
  // preview-ui.js: report.company_profile / free_opportunity / human_review
  // paid-preview.js: data.company_profile / paid_analysis / meta
  // report-teaser.js: report.company_profile / free_opportunity / human_review
  const requiredTopLevel = [
    "company_profile",
    "free_opportunity",
    "source_pages",
    "locked_opportunities",
    "paid_analysis",
    "meta",
    "human_review",
  ];
  for (const f of requiredTopLevel) {
    assert.ok(f in pub, `renderer 必須フィールド ${f} が欠落している`);
    assert.ok(PUBLIC_TOP_LEVEL_FIELDS.includes(f), `${f} が allowlist に無い`);
  }
  // top_sources / hidden_sources_count は元 report にあれば維持
  const withTop = { ...internalRichReport(), top_sources: [{ id: "src-1" }], hidden_sources_count: 3 };
  const pub2 = buildPublicReport(withTop);
  assert.deepEqual(pub2.top_sources, [{ id: "src-1" }]);
  assert.equal(pub2.hidden_sources_count, 3);
});

// ---------------------------------------------------------------------------
// Test 6 — Stale Published State（isPublished は存在判定、承認状態とは独立）
// ---------------------------------------------------------------------------
test("Test6: isPublished（存在判定）と isPublishable（承認判定）は別物であることを明示する", () => {
  // Phase57 STEP6 I-3: website/aor/data/<slug>.json が残っているだけで isPublished()==true に
  // なるが、それは「現在の report が承認・公開可能」を意味しない。
  // 本 STEP では isPublished() のセマンティクスは変更しない（send-initial-report.js /
  // lambda handler / admin server / dashboard-aggregates での広範な副作用を避けるため）。
  // 正しい「公開かつ承認済み」判定が必要な呼び出し元は isPublished() と isPublishable() を
  // 併用する必要がある、という契約をテストで固定する。
  const engine = require("../review/review-engine");

  // 承認レビューが無い（HOLD 相当）
  const holdReport = { ...GOOD, evaluation: { ...GOOD.evaluation, status: "REVIEW", grade: "C", score: 71 } };
  const noReview = engine.createEmptyReview("generated-hold");
  assert.equal(engine.isPublishable(noReview, holdReport.evaluation, holdReport).publishable, false);

  // 承認レビューがある
  const okReport = { ...GOOD };
  const approved = engine.approve(engine.createEmptyReview(okReport.id), { reviewer: "tester" });
  assert.equal(engine.isPublishable(approved, okReport.evaluation, okReport).publishable, true);
});

// ---------------------------------------------------------------------------
// Test 7 — PII Safety（射影後に個人情報・Lead metadata が混入しない）
// ---------------------------------------------------------------------------
test("Test7: 射影結果に個人情報・Lead 識別子・内部 delivery metadata が混入しない", () => {
  const report = internalRichReport();
  // Lead 由来の情報を意図的に混ぜる（本来 report には無いが、防御確認）
  report.lead_id = "abc123";
  report.report_token = "tok_xyz";
  report.recipient_email = "person@example.com";
  report.delivery_status = "queued";

  const pub = buildPublicReport(report);
  const serialized = JSON.stringify(pub);

  assert.equal("lead_id" in pub, false);
  assert.equal("report_token" in pub, false);
  assert.equal("recipient_email" in pub, false);
  assert.equal("delivery_status" in pub, false);
  assert.equal("send_target" in pub, false);
  assert.equal(serialized.includes("abc123"), false);
  assert.equal(serialized.includes("tok_xyz"), false);
  assert.equal(serialized.includes("person@example.com"), false);

  // findInternalFieldLeaks / safety-check helper も違反を報告しない（正常な射影のため）
  assert.deepEqual(findInternalFieldLeaks(pub), []);
  assert.equal(checkPublicReportInternalFields(pub).ok, true);
});

test("Test7b: checkPublicReportInternalFields は evaluation を含む旧コントラクト JSON を違反として報告する", () => {
  const legacy = { ...GOOD }; // good.json は evaluation / send_target を含む（旧コントラクト相当）
  const res = checkPublicReportInternalFields(legacy);
  assert.equal(res.ok, false);
  assert.ok(res.violations.some((v) => v.includes("evaluation")));
});

// ---------------------------------------------------------------------------
// allowlist 定数の健全性
// ---------------------------------------------------------------------------
test("allowlist 定数: 内部専用フィールドが allowlist に含まれていない", () => {
  for (const forbidden of ["evaluation", "ai_pipeline", "send_target"]) {
    assert.equal(PUBLIC_TOP_LEVEL_FIELDS.includes(forbidden), false);
  }
  for (const forbidden of ["note", "pipeline_version"]) {
    assert.equal(PUBLIC_META_FIELDS.includes(forbidden), false);
  }
  for (const forbidden of ["reviewer", "notes", "checklist", "review_history"]) {
    assert.equal(PUBLIC_HUMAN_REVIEW_FIELDS.includes(forbidden), false);
  }
});
