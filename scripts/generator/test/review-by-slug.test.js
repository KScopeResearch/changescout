/**
 * review-by-slug.test.js — scripts/generator/review/review-by-slug.js の自動テスト。
 *
 * REPORT_STORE_BACKEND / REVIEW_STORE_BACKEND を設定せず（既定 filesystem）、
 * OUTPUT_DIR/<slug>/ 配下の report.json / review.json を使う。既存データに触れないよう
 * テスト専用 slug（"test-review-by-slug-*"）のみを使い、t.after() でディレクトリごと削除する。
 *
 * 状態遷移そのもの（approve/reject の Pure Function）の回帰は review.test.js が担保するため、
 * ここでは「slug をキーに backend 経由で読み書きできること」「ガードが効くこと」だけを検証する。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { approveBySlug, rejectBySlug, loadForSlug, parseFlags } = require("../review/review-by-slug");
const reportStore = require("../report-store");
const reviewStore = require("../review/review-store");
const { OUTPUT_DIR } = require("../shared/paths");

let counter = 0;
function freshSlug() {
  counter += 1;
  return `test-review-by-slug-${process.pid}-${counter}`;
}

function cleanupSlug(slug) {
  fs.rmSync(path.join(OUTPUT_DIR, slug), { recursive: true, force: true });
}

/** @param {string} slug @returns {Promise<void>} */
async function seedReport(slug) {
  await reportStore.saveReport(slug, {
    id: `report-${slug}`,
    schema_version: "2.4",
    company_profile: { name: `Test ${slug}` },
    evaluation: { status: "PASS" },
  });
}

test("parseFlags: --key=value のみ解釈し、位置引数は無視する", () => {
  assert.deepEqual(parseFlags(["--reviewer=alice", "--comment=looks good", "positional"]), {
    reviewer: "alice",
    comment: "looks good",
  });
  assert.deepEqual(parseFlags([]), {});
});

test("approveBySlug: report が無ければ ok:false（review は作られない）", async (t) => {
  const slug = freshSlug();
  t.after(() => cleanupSlug(slug));

  const result = await approveBySlug(slug, { reviewer: "alice" });
  assert.equal(result.ok, false);
  assert.match(result.error, /report が見つかりません/);

  // review.json も作られていないこと
  const review = await reviewStore.loadReview(slug);
  assert.equal(review.status, "pending_review", "空の初期状態のまま（保存されていない）");
});

test("approveBySlug: reviewer が無ければ ok:false", async (t) => {
  const slug = freshSlug();
  t.after(() => cleanupSlug(slug));
  await seedReport(slug);

  const result = await approveBySlug(slug, {});
  assert.equal(result.ok, false);
  assert.match(result.error, /reviewer/);
});

test("approveBySlug: slug が空文字なら ok:false", async () => {
  const result = await approveBySlug("", { reviewer: "alice" });
  assert.equal(result.ok, false);
  assert.match(result.error, /slug/);
});

test("approveBySlug: report があり reviewer 指定なら review.status を approved にして backend へ保存する", async (t) => {
  const slug = freshSlug();
  t.after(() => cleanupSlug(slug));
  await seedReport(slug);

  const result = await approveBySlug(slug, { reviewer: "alice", comment: "OK" });
  assert.equal(result.ok, true);
  assert.equal(result.status, "approved");

  // 別プロセス/別呼び出しから backend 経由で読み直しても approved
  const persisted = await reviewStore.loadReview(slug);
  assert.equal(persisted.status, "approved");
  assert.equal(persisted.reviewer, "alice");

  // 物理ファイルが OUTPUT_DIR/<slug>/review.json に存在する（既存 filesystem レイアウトと一致）
  assert.ok(fs.existsSync(path.join(OUTPUT_DIR, slug, "review.json")));
});

test("rejectBySlug: review.status を rejected にする", async (t) => {
  const slug = freshSlug();
  t.after(() => cleanupSlug(slug));
  await seedReport(slug);

  const result = await rejectBySlug(slug, { reviewer: "bob", comment: "要修正" });
  assert.equal(result.ok, true);
  assert.equal(result.status, "rejected");
  assert.equal((await reviewStore.loadReview(slug)).status, "rejected");
});

test("loadForSlug: report が無いときは report=null / review=空の初期状態を返す", async (t) => {
  const slug = freshSlug();
  t.after(() => cleanupSlug(slug));

  const { report, review } = await loadForSlug(slug);
  assert.equal(report, null);
  assert.equal(review.status, "pending_review");
});
