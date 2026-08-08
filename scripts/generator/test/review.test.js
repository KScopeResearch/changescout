/**
 * review.test.js — Task18: review-engine.js（Pure Function）の自動テスト。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const engine = require("../review/review-engine");

test("createEmptyReview: 初期状態はpending_review", () => {
  const review = engine.createEmptyReview("test-report-id");
  assert.equal(review.status, "pending_review");
  assert.equal(review.report_id, "test-report-id");
  assert.equal(review.reviewer, null);
  assert.deepEqual(review.comments, []);
  assert.deepEqual(review.fixes, []);
  assert.deepEqual(review.history, []);
});

test("approve: statusがapprovedになり、historyに1件追加される", () => {
  const review = engine.createEmptyReview("test");
  const next = engine.approve(review, { reviewer: "alice", comment: "OK", now: "2026-01-01T00:00:00Z" });
  assert.equal(next.status, "approved");
  assert.equal(next.reviewer, "alice");
  assert.equal(next.history.length, 1);
  assert.equal(next.history[0].action, "approved");
  assert.equal(next.history[0].from_status, "pending_review");
  assert.equal(next.history[0].to_status, "approved");
});

test("approve: reviewerなしでは例外を投げる", () => {
  const review = engine.createEmptyReview("test");
  assert.throws(() => engine.approve(review, {}), /reviewer/);
});

test("Pure Function: approveは元のreviewオブジェクトを変更しない", () => {
  const review = engine.createEmptyReview("test");
  const before = JSON.stringify(review);
  engine.approve(review, { reviewer: "alice", now: "2026-01-01T00:00:00Z" });
  assert.equal(JSON.stringify(review), before, "元のreviewは変更されないはず");
});

test("reject: statusがrejectedになる", () => {
  const review = engine.createEmptyReview("test");
  const next = engine.reject(review, { reviewer: "bob", comment: "根拠不足", now: "2026-01-01T00:00:00Z" });
  assert.equal(next.status, "rejected");
});

test("requestRevision: needs_revisionになり、fixesが追加される", () => {
  const review = engine.createEmptyReview("test");
  const next = engine.requestRevision(review, {
    reviewer: "carol",
    fixes: ["Aを直す", "Bを直す"],
    now: "2026-01-01T00:00:00Z",
  });
  assert.equal(next.status, "needs_revision");
  assert.equal(next.fixes.length, 2);
  assert.equal(next.fixes[0].description, "Aを直す");
  assert.equal(next.fixes[0].resolved, false);
});

test("addComment: statusを変更せずコメントのみ追加する", () => {
  const review = engine.createEmptyReview("test");
  const next = engine.addComment(review, { actor: "dave", text: "確認中", now: "2026-01-01T00:00:00Z" });
  assert.equal(next.status, "pending_review");
  assert.equal(next.comments.length, 1);
  assert.equal(next.history[next.history.length - 1].action, "comment_added");
});

test("addFix: statusを変更せず修正指示のみ追加する", () => {
  const review = engine.createEmptyReview("test");
  const next = engine.addFix(review, { actor: "erin", description: "出典を確認", now: "2026-01-01T00:00:00Z" });
  assert.equal(next.status, "pending_review");
  assert.equal(next.fixes.length, 1);
  assert.equal(next.fixes[0].resolved, false);
});

test("isPublishable: approved かつ evaluation.status!==FAIL なら true", () => {
  let review = engine.createEmptyReview("test");
  review = engine.approve(review, { reviewer: "alice", now: "2026-01-01T00:00:00Z" });
  const result = engine.isPublishable(review, { status: "PASS", score: 90 });
  assert.equal(result.publishable, true);
  assert.deepEqual(result.reasons, []);
});

test("isPublishable: approvedでもevaluation.status===FAILならfalse", () => {
  let review = engine.createEmptyReview("test");
  review = engine.approve(review, { reviewer: "alice", now: "2026-01-01T00:00:00Z" });
  const result = engine.isPublishable(review, { status: "FAIL", score: 10 });
  assert.equal(result.publishable, false);
  assert.ok(result.reasons.some((r) => r.includes("FAIL")));
});

test("isPublishable: pending_reviewのままならfalse", () => {
  const review = engine.createEmptyReview("test");
  const result = engine.isPublishable(review, { status: "PASS" });
  assert.equal(result.publishable, false);
});

// Task36: report.meta.generated_at と review.reviewed_at の整合性チェック
// （承認後にreport.jsonが再生成されていないかの検証）

test("isPublishable（Task36）: generated_atがreviewed_atより後（再生成後）ならfalse", () => {
  let review = engine.createEmptyReview("test");
  review = engine.approve(review, { reviewer: "alice", now: "2026-01-01T00:00:00Z" });
  const report = { meta: { generated_at: "2026-01-02T00:00:00Z" } }; // 承認の後に再生成された
  const result = engine.isPublishable(review, { status: "PASS" }, report);
  assert.equal(result.publishable, false);
  assert.ok(result.reasons.some((r) => r.includes("再生成された可能性")));
});

test("isPublishable（Task36）: generated_atがreviewed_atより前（通常の承認済みケース）ならtrue", () => {
  let review = engine.createEmptyReview("test");
  review = engine.approve(review, { reviewer: "alice", now: "2026-01-02T00:00:00Z" });
  const report = { meta: { generated_at: "2026-01-01T00:00:00Z" } }; // 承認より前に生成された内容をレビューした
  const result = engine.isPublishable(review, { status: "PASS" }, report);
  assert.equal(result.publishable, true);
  assert.deepEqual(result.reasons, []);
});

test("isPublishable（Task36）: generated_atとreviewed_atが同時刻ならtrue（後に再生成されたとは言えないため許可する設計）", () => {
  let review = engine.createEmptyReview("test");
  review = engine.approve(review, { reviewer: "alice", now: "2026-01-01T00:00:00Z" });
  const report = { meta: { generated_at: "2026-01-01T00:00:00Z" } };
  const result = engine.isPublishable(review, { status: "PASS" }, report);
  assert.equal(result.publishable, true);
  assert.deepEqual(result.reasons, []);
});

test("isPublishable（Task36）: review.reviewed_atがnullの場合、reportが渡されていてもfalse", () => {
  // approve()を経ていないreview（reviewed_atはnullだがstatusを手動でapprovedにした異常系）でも
  // 安全側（false）になることを確認する。通常のpending_reviewはstatusチェック側で既にfalseになる。
  const review = { ...engine.createEmptyReview("test"), status: "approved", reviewed_at: null };
  const report = { meta: { generated_at: "2026-01-01T00:00:00Z" } };
  const result = engine.isPublishable(review, { status: "PASS" }, report);
  assert.equal(result.publishable, false);
  assert.ok(result.reasons.some((r) => r.includes("reviewed_at")));
});

test("isPublishable（Task36）: generated_at/reviewed_atが不正な日時文字列なら安全側でfalse", () => {
  let review = engine.createEmptyReview("test");
  review = engine.approve(review, { reviewer: "alice", now: "2026-01-01T00:00:00Z" });
  const report = { meta: { generated_at: "not-a-date" } };
  const result = engine.isPublishable(review, { status: "PASS" }, report);
  assert.equal(result.publishable, false);
  assert.ok(result.reasons.some((r) => r.includes("日時形式が不正")));
});

test("isPublishable（Task36）: reportを渡さない既存の呼び出し方は従来どおり動作する（後方互換性）", () => {
  let review = engine.createEmptyReview("test");
  review = engine.approve(review, { reviewer: "alice", now: "2026-01-01T00:00:00Z" });
  const result = engine.isPublishable(review, { status: "PASS" }); // 第3引数なし
  assert.equal(result.publishable, true);
  assert.deepEqual(result.reasons, []);
});

test("getHistory: approve→reject→requestRevisionの順序が保たれる", () => {
  let review = engine.createEmptyReview("test");
  review = engine.approve(review, { reviewer: "a", now: "2026-01-01T00:00:00Z" });
  review = engine.reject(review, { reviewer: "b", now: "2026-01-02T00:00:00Z" });
  review = engine.requestRevision(review, { reviewer: "c", now: "2026-01-03T00:00:00Z" });
  const history = engine.getHistory(review);
  assert.deepEqual(
    history.map((h) => h.action),
    ["approved", "rejected", "revision_requested"]
  );
});
