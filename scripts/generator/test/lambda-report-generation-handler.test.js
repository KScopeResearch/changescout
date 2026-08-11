/**
 * lambda-report-generation-handler.test.js — scripts/generator/lambda/report-generation-handler.js
 * の自動テスト。
 *
 * report-generation-handler.js は既存のgenerateCompanyReport()（generate-company-report.js）を
 * そのまま呼ぶ薄いadapterである。generateCompanyReport()自体（実HTTP取得・LLM分析・
 * company-context-store.js/report-store.jsへの保存）の正しさはgenerator.test.js
 * （ネットワーク依存、run-all-tests.js側で非ブロッキング扱い）・report-store.test.js・
 * company-context-store.test.jsで既に検証済みのため、ここでは重複させない。本テストは
 * 「adapterとして正しく委譲・入力検証・戻り値整形しているか」にのみ焦点を当てる
 * （generateCompanyReportModule.generateCompanyReportを差し替えたテストが中心）。
 * 実HTTP取得・実AWSへは一切接続しない。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { handler } = require("../lambda/report-generation-handler");
const generateCompanyReportModule = require("../generate-company-report");

/** @param {Function} fakeFn @returns {Function} 元の関数へ戻す関数 */
function stubGenerateCompanyReport(fakeFn) {
  const original = generateCompanyReportModule.generateCompanyReport;
  generateCompanyReportModule.generateCompanyReport = fakeFn;
  return () => {
    generateCompanyReportModule.generateCompanyReport = original;
  };
}

// ---------------------------------------------------------------------------
// 必須入力不足・不正入力
// ---------------------------------------------------------------------------

test("report-generation-handler: event.company_urlが無い場合は例外を投げる（generateCompanyReport()は呼ばれない）", async (t) => {
  const calls = [];
  const restore = stubGenerateCompanyReport(async (...args) => {
    calls.push(args);
    throw new Error("呼ばれてはならない");
  });
  t.after(restore);

  await assert.rejects(() => handler({}), /event.company_url.*必須/);
  assert.equal(calls.length, 0);
});

test("report-generation-handler: event.company_urlが文字列でない場合は例外を投げる", async (t) => {
  const restore = stubGenerateCompanyReport(async () => {
    throw new Error("呼ばれてはならない");
  });
  t.after(restore);

  await assert.rejects(() => handler({ company_url: 123 }), /event.company_url.*必須/);
  await assert.rejects(() => handler(null), /event.company_url.*必須/);
});

// ---------------------------------------------------------------------------
// 正常系: generateCompanyReport()への委譲・戻り値の整形
// ---------------------------------------------------------------------------

test("report-generation-handler: event.company_urlをgenerateCompanyReport()へそのまま渡す", async (t) => {
  const calls = [];
  const restore = stubGenerateCompanyReport(async (companyUrl) => {
    calls.push(companyUrl);
    return { slug: "example.com", report: {}, evaluation: {}, validation: { ok: true }, context: {}, outDir: "x", paths: {} };
  });
  t.after(restore);

  await handler({ company_url: "https://example.com" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0], "https://example.com");
});

test("report-generation-handler: 成功時、generateCompanyReport()の戻り値をそのままok:true付きで返す", async (t) => {
  const fakeResult = {
    slug: "example.com",
    report: { id: "r1" },
    evaluation: { score: 90 },
    validation: { ok: true, errors: [], warnings: [] },
    context: { input_url: "https://example.com" },
    outDir: "/tmp/example.com",
    paths: { reportPath: "/tmp/example.com/report.json" },
  };
  const restore = stubGenerateCompanyReport(async () => fakeResult);
  t.after(restore);

  const result = await handler({ company_url: "https://example.com" });

  assert.equal(result.ok, true);
  assert.equal(result.slug, "example.com");
  assert.deepEqual(result.report, fakeResult.report);
  assert.deepEqual(result.evaluation, fakeResult.evaluation);
  assert.deepEqual(result.validation, fakeResult.validation);
  assert.deepEqual(result.paths, fakeResult.paths);
});

// ---------------------------------------------------------------------------
// generateCompanyReport()自体が投げた例外はそのまま伝播させる（握りつぶさない。
// Lambda呼び出し元がEventBridge等のretry/DLQ判断に使えるようにするため）
// ---------------------------------------------------------------------------

test("report-generation-handler: generateCompanyReport()が例外を投げた場合はそのまま伝播する", async (t) => {
  const restore = stubGenerateCompanyReport(async () => {
    throw new Error("想定外のエラー（例: report-store.jsのS3接続失敗、LLM analysis失敗等）");
  });
  t.after(restore);

  await assert.rejects(() => handler({ company_url: "https://example.com" }), /想定外のエラー/);
});
