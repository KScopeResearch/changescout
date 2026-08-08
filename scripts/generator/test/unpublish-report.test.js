/**
 * unpublish-report.test.js — Task38: unpublish-report.jsの自動テスト。
 * publish-report.test.jsと同じ構成（scripts/generator/output/配下に一時ディレクトリを
 * 作り、テスト後は必ず削除する。既存のexample.com等、実データには触れない）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { publishReport } = require("../publish-report");
const { unpublishReport, isPublished, publishedPathFor, AOR_DATA_DIR } = require("../unpublish-report");
const { readJson, writeJson } = require("../shared/json-file");
const { OUTPUT_DIR } = require("../shared/paths");
const engine = require("../review/review-engine");

const FIXTURE_REPORT = readJson(path.join(__dirname, "..", "fixtures", "good.json"));

/** @param {string} slug */
function setupApprovedCompany(slug) {
  const dir = path.join(OUTPUT_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  const report = { ...FIXTURE_REPORT, id: slug };
  writeJson(path.join(dir, "report.json"), report);
  let review = engine.createEmptyReview(report.id);
  review = engine.approve(review, { reviewer: "tester" });
  writeJson(path.join(dir, "review.json"), review);
  return { dir, report };
}

/** @param {string} slug */
function cleanupCompany(slug) {
  const dir = path.join(OUTPUT_DIR, slug);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(publishedPathFor(slug), { force: true });
}

test("unpublishReport: 公開済みのslugは取り消しに成功し、ファイルが削除される", () => {
  const slug = "test-unpublish-published";
  cleanupCompany(slug);
  setupApprovedCompany(slug);
  try {
    publishReport(slug);
    assert.equal(isPublished(slug), true, "前提: 公開済みであること");

    const result = unpublishReport(slug);
    assert.equal(result.ok, true);
    assert.equal(result.alreadyUnpublished, false);
    assert.equal(isPublished(slug), false);
    assert.equal(fs.existsSync(publishedPathFor(slug)), false);
  } finally {
    cleanupCompany(slug);
  }
});

test("unpublishReport: 未公開のslugに対しては冪等にok:true・alreadyUnpublished:trueを返す（エラーにしない）", () => {
  const slug = "test-unpublish-not-published";
  cleanupCompany(slug);
  try {
    assert.equal(isPublished(slug), false, "前提: 未公開であること");
    const result = unpublishReport(slug);
    assert.equal(result.ok, true);
    assert.equal(result.alreadyUnpublished, true);
  } finally {
    cleanupCompany(slug);
  }
});

test("unpublishReport: report.json・review.jsonを一切変更しない", () => {
  const slug = "test-unpublish-no-mutation";
  cleanupCompany(slug);
  setupApprovedCompany(slug);
  try {
    publishReport(slug);

    const reportPath = path.join(OUTPUT_DIR, slug, "report.json");
    const reviewPath = path.join(OUTPUT_DIR, slug, "review.json");
    const reportBefore = fs.readFileSync(reportPath, "utf-8");
    const reviewBefore = fs.readFileSync(reviewPath, "utf-8");

    const result = unpublishReport(slug);
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(reportPath, "utf-8"), reportBefore, "report.jsonが変更されてはならない");
    assert.equal(fs.readFileSync(reviewPath, "utf-8"), reviewBefore, "review.jsonが変更されてはならない");
  } finally {
    cleanupCompany(slug);
  }
});

test("unpublishReport: 取り消し後に再度publishReport()で公開できる", () => {
  const slug = "test-unpublish-then-republish";
  cleanupCompany(slug);
  setupApprovedCompany(slug);
  try {
    publishReport(slug);
    assert.equal(isPublished(slug), true);

    unpublishReport(slug);
    assert.equal(isPublished(slug), false);

    const result = publishReport(slug);
    assert.equal(result.ok, true);
    assert.equal(isPublished(slug), true);
  } finally {
    cleanupCompany(slug);
  }
});

// ---------------------------------------------------------------------------
// パストラバーサル対策（publish-report.jsのTask25対策をそのまま再利用していることの確認）
// ---------------------------------------------------------------------------

test("unpublishReport: パストラバーサルを狙ったslugは拒否され、AOR_DATA_DIR外へは一切アクセスしない", () => {
  const maliciousSlugs = ["..\\..\\Windows\\System32\\drivers\\etc\\hosts", "../../../../etc/passwd", ".."];
  maliciousSlugs.forEach((slug) => {
    const result = unpublishReport(slug);
    assert.equal(result.ok, false, `拒否されるべき: ${JSON.stringify(slug)}`);
    assert.match(result.error, /不正なslug/);
  });
});

test("unpublishReport: 取り消し対象パスは常にAOR_DATA_DIR直下に収まる（正常系での再確認）", () => {
  const slug = "test-unpublish-path-containment";
  cleanupCompany(slug);
  setupApprovedCompany(slug);
  try {
    publishReport(slug);
    const result = unpublishReport(slug);
    assert.equal(result.ok, true);
    const resolvedDir = path.dirname(path.resolve(result.unpublishedPath));
    assert.equal(resolvedDir, path.resolve(AOR_DATA_DIR));
  } finally {
    cleanupCompany(slug);
  }
});
