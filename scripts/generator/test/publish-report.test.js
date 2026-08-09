/**
 * publish-report.test.js — Task24: publish-report.jsの自動テスト。
 * Task25でパストラバーサル対策（validateSlug()）のテストを追加。
 *
 * scripts/generator/output/配下に一時的なテスト用会社ディレクトリを作り、
 * publishReport()の挙動（未承認は拒否・承認済みは公開・report.json/review.jsonを
 * 一切書き換えない）を確認する。テスト後は必ず一時ディレクトリ・公開先ファイルを
 * 削除する（既存のexample.com等、実データには触れない）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { publishReport, isPublished, publishedPathFor, validateSlug, AOR_DATA_DIR } = require("../publish-report");
const { readJson, writeJson } = require("../shared/json-file");
const { OUTPUT_DIR } = require("../shared/paths");
const engine = require("../review/review-engine");

const FIXTURE_REPORT = readJson(path.join(__dirname, "..", "fixtures", "good.json"));

/** @param {string} slug @param {Object} [reviewOverride] */
function setupCompany(slug, reviewOverride) {
  const dir = path.join(OUTPUT_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  const report = { ...FIXTURE_REPORT, id: slug };
  writeJson(path.join(dir, "report.json"), report);
  if (reviewOverride) {
    writeJson(path.join(dir, "review.json"), reviewOverride);
  }
  return { dir, report };
}

/** @param {string} slug */
function cleanupCompany(slug) {
  const dir = path.join(OUTPUT_DIR, slug);
  fs.rmSync(dir, { recursive: true, force: true });
  const published = publishedPathFor(slug);
  fs.rmSync(published, { force: true });
}

test("publishReport: review.jsonが無い（pending_review相当）場合は公開を拒否する", () => {
  const slug = "test-publish-no-review";
  cleanupCompany(slug);
  setupCompany(slug);
  try {
    const result = publishReport(slug);
    assert.equal(result.ok, false);
    assert.match(result.error, /公開できません/);
    assert.equal(isPublished(slug), false);
    assert.equal(fs.existsSync(publishedPathFor(slug)), false);
  } finally {
    cleanupCompany(slug);
  }
});

test("publishReport: needs_revisionの場合は公開を拒否する", () => {
  const slug = "test-publish-needs-revision";
  cleanupCompany(slug);
  const { report } = setupCompany(slug);
  let review = engine.createEmptyReview(report.id);
  review = engine.approve(review, { reviewer: "tester" });
  review = engine.requestRevision(review, { reviewer: "tester", comment: "要修正" });
  writeJson(path.join(OUTPUT_DIR, slug, "review.json"), review);
  try {
    const result = publishReport(slug);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some((r) => r.includes("approved")));
    assert.equal(isPublished(slug), false);
  } finally {
    cleanupCompany(slug);
  }
});

test("publishReport: 承認済み（approved）は公開に成功し、内容がそのままコピーされる", () => {
  const slug = "test-publish-approved";
  cleanupCompany(slug);
  const { report } = setupCompany(slug);
  let review = engine.createEmptyReview(report.id);
  review = engine.approve(review, { reviewer: "tester" });
  writeJson(path.join(OUTPUT_DIR, slug, "review.json"), review);

  try {
    const result = publishReport(slug);
    assert.equal(result.ok, true);
    assert.equal(isPublished(slug), true);

    const published = readJson(result.publishedPath);
    assert.deepEqual(published, report, "公開されたJSONはreport.jsonの内容と完全に一致するはず（変換・加工しない）");
  } finally {
    cleanupCompany(slug);
  }
});

test("publishReport: report.json・review.jsonを一切書き換えない", () => {
  const slug = "test-publish-no-mutation";
  cleanupCompany(slug);
  const { report } = setupCompany(slug);
  let review = engine.createEmptyReview(report.id);
  review = engine.approve(review, { reviewer: "tester" });
  writeJson(path.join(OUTPUT_DIR, slug, "review.json"), review);

  const reportPath = path.join(OUTPUT_DIR, slug, "report.json");
  const reviewPath = path.join(OUTPUT_DIR, slug, "review.json");
  const reportBefore = fs.readFileSync(reportPath, "utf-8");
  const reviewBefore = fs.readFileSync(reviewPath, "utf-8");

  try {
    const result = publishReport(slug);
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(reportPath, "utf-8"), reportBefore, "report.jsonが変更されてはならない");
    assert.equal(fs.readFileSync(reviewPath, "utf-8"), reviewBefore, "review.jsonが変更されてはならない");
  } finally {
    cleanupCompany(slug);
  }
});

test("publishReport: evaluation.status===FAILの場合はreview.statusがapprovedでも公開を拒否する", () => {
  const slug = "test-publish-eval-fail";
  cleanupCompany(slug);
  const dir = path.join(OUTPUT_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  const report = { ...FIXTURE_REPORT, id: slug, evaluation: { ...FIXTURE_REPORT.evaluation, status: "FAIL" } };
  writeJson(path.join(dir, "report.json"), report);
  let review = engine.createEmptyReview(report.id);
  review = engine.approve(review, { reviewer: "tester" });
  writeJson(path.join(dir, "review.json"), review);

  try {
    const result = publishReport(slug);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some((r) => r.includes("FAIL")));
  } finally {
    cleanupCompany(slug);
  }
});

test("publishReport: 存在しないslugはエラーメッセージ付きで失敗する", () => {
  const result = publishReport("test-publish-does-not-exist-at-all");
  assert.equal(result.ok, false);
  assert.match(result.error, /report\.json/);
});

test("isPublished: 公開前はfalse、publishReport()成功後はtrue", () => {
  const slug = "test-publish-isPublished-flag";
  cleanupCompany(slug);
  const { report } = setupCompany(slug);
  let review = engine.createEmptyReview(report.id);
  review = engine.approve(review, { reviewer: "tester" });
  writeJson(path.join(OUTPUT_DIR, slug, "review.json"), review);

  try {
    assert.equal(isPublished(slug), false);
    publishReport(slug);
    assert.equal(isPublished(slug), true);
  } finally {
    cleanupCompany(slug);
  }
});

// ---------------------------------------------------------------------------
// パストラバーサル対策（Task25の本番公開前セキュリティ監査で発見・修正）
// ---------------------------------------------------------------------------

test("validateSlug: 正常なslug（英数字・ドット・ハイフン）はokを返す", () => {
  assert.equal(validateSlug("example.com").ok, true);
  assert.equal(validateSlug("company-01-manufacturing").ok, true);
  assert.equal(validateSlug("sakuraba-seimitsu.example.jp").ok, true);
});

test("validateSlug: 空文字・undefinedはNGを返す", () => {
  assert.equal(validateSlug("").ok, false);
  assert.equal(validateSlug(undefined).ok, false);
});

test("validateSlug: '..'を含むslugは形式・文字種に関わらずNGを返す", () => {
  const payloads = [
    "..",
    "../test",
    "..\\test",
    "..\\..\\Windows\\System32\\drivers\\etc\\hosts",
    "..%2ftest",
    "%2e%2e%2f",
  ];
  payloads.forEach((slug) => {
    assert.equal(validateSlug(slug).ok, false, `拒否されるべき: ${JSON.stringify(slug)}`);
  });
});

test("validateSlug: 絶対パス・スラッシュ・バックスラッシュを含むslugはNGを返す", () => {
  const payloads = ["/absolute/path", "C:\\Windows\\System32", "a/b", "a\\b"];
  payloads.forEach((slug) => {
    assert.equal(validateSlug(slug).ok, false, `拒否されるべき: ${JSON.stringify(slug)}`);
  });
});

test("publishReport: パストラバーサルを狙ったslugは、report.jsonの有無に関わらず拒否され、OUTPUT_DIR・AOR_DATA_DIR外へは一切アクセスしない", () => {
  const maliciousSlugs = ["..\\..\\Windows\\System32\\drivers\\etc\\hosts", "../../../../etc/passwd", ".."];
  maliciousSlugs.forEach((slug) => {
    const result = publishReport(slug);
    assert.equal(result.ok, false, `拒否されるべき: ${JSON.stringify(slug)}`);
    assert.match(result.error, /不正なslug/);
  });
});

test("publishReport: 公開先パスは常にAOR_DATA_DIR直下に収まる（正常系での再確認）", () => {
  const slug = "test-publish-path-containment";
  cleanupCompany(slug);
  const { report } = setupCompany(slug);
  let review = engine.createEmptyReview(report.id);
  review = engine.approve(review, { reviewer: "tester" });
  writeJson(path.join(OUTPUT_DIR, slug, "review.json"), review);

  try {
    const result = publishReport(slug);
    assert.equal(result.ok, true);
    const resolvedDir = path.dirname(path.resolve(result.publishedPath));
    assert.equal(resolvedDir, path.resolve(AOR_DATA_DIR));
  } finally {
    cleanupCompany(slug);
  }
});
