/**
 * generator.test.js — Task18: generate-company-report.jsのエンドツーエンド統合テスト。
 * 実際にhttps://example.com（IANA予約の安全な公開テストドメイン）へHTTP取得を行うため、
 * ネットワーク環境によっては失敗しうる（実ネットワークI/Oを伴う唯一のテスト）。
 *
 * 【Task19】このファイル内の他のテストは、実ネットワークテストの成否に依存しないよう
 * 意図的に分離している（以前は3件目のテストが1件目の副作用＝生成されたreport.jsonを
 * 読み直す設計だったため、1件目がスキップ・失敗すると3件目も道連れで失敗していた。
 * 3件目はfixtures/good.jsonを使う形に変更し、独立して実行できるようにした）。
 *
 * テスト名は network-test-names.js の NETWORK_TEST_NAME と一致させている
 * （run-all-tests.jsがCI環境でこのテストのみ非ブロッキング扱いにするための対応表）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { generateCompanyReport, slugFromUrl } = require("../generate-company-report");
const { validateReport } = require("../validate-report");
const { readJson } = require("../shared/json-file");
const { REPORT_FIXTURES_DIR } = require("../shared/paths");
const { NETWORK_TEST_NAME } = require("./network-test-names");

test(NETWORK_TEST_NAME, { timeout: 30000 }, async () => {
  const { report, evaluation, validation, slug, paths } = await generateCompanyReport("https://example.com");

  assert.equal(slug, "example.com");
  assert.equal(report.meta.schema_version, "2.4");
  assert.ok(report.company_profile.name);
  assert.ok(Array.isArray(report.source_pages) && report.source_pages.length > 0);
  assert.ok(report.free_opportunity.title);
  assert.ok(report.evaluation, "report.evaluationがトップレベルに存在するはず");
  assert.equal(evaluation.score, report.evaluation.score);
  assert.equal(validation.ok, true, `Validatorはpassするはず: ${JSON.stringify(validation.errors)}`);

  assert.ok(fs.existsSync(paths.contextPath));
  assert.ok(fs.existsSync(paths.reportPath));
  assert.ok(fs.existsSync(paths.evaluationMdPath));
});

test("slugFromUrl: ホスト名からファイルシステム安全な文字列を作る（ネットワーク不要）", () => {
  assert.equal(slugFromUrl("https://example.com"), "example.com");
  assert.equal(slugFromUrl("https://example.com/path?query=1"), "example.com");
  assert.equal(slugFromUrl("not-a-valid-url"), "unknown-company");
});

test("validateReport: fixtures/good.jsonがPASSする（ネットワーク不要、上記の実HTTPテストとは独立）", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  const result = validateReport(report);
  assert.equal(result.ok, true);
});
