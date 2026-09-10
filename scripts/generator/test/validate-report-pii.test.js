/**
 * validate-report-pii.test.js — Phase56 STEP9-D（P4 バックストップ）
 *
 * company-context.js の sanitizeSources()（LLM へ渡す前の除去）が第一防衛線。
 * validate-report.js の checkResidualPii() は「sanitize が漏れた場合に Publish を止める」
 * error 判定。street-level 住所（登記上の本店所在地等）のみを対象にし、
 * 都道府県・市区町村レベルの言及は許容する。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { validateReport } = require("../validate-report");
const { readJson } = require("../shared/json-file");
const { REPORT_FIXTURES_DIR } = require("../shared/paths");

function loadGood() {
  return readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
}

test("checkResidualPii: why_company に街区住所が残っていると error（HOLD）", () => {
  const report = loadGood();
  report.free_opportunity.why_company =
    "同社は飲食DX支援の実績を持つ。gBizINFOによれば本店所在地は東京都千代田区外神田３丁目６番５号である。";
  const result = validateReport(report);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => e.includes("街区レベルの住所")),
    JSON.stringify(result.errors)
  );
});

test("checkResidualPii: evidence.quote の街区住所も error", () => {
  const report = loadGood();
  report.free_opportunity.evidence[0].quote = "本店所在地 東京都千代田区外神田3-6-5";
  const result = validateReport(report);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("街区レベルの住所")), JSON.stringify(result.errors));
});

test("checkResidualPii: 都道府県・市区町村レベルの言及だけなら error にしない（過剰HOLD防止）", () => {
  const report = loadGood();
  report.free_opportunity.why_now =
    "千代田区の飲食店では人手不足が深刻で、東京都内のインバウンド需要が回復している。";
  report.free_opportunity.why_company = "同社は東京23区を中心に店舗経営を経験してきた。";
  const result = validateReport(report);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("checkResidualPii: 変更なしの good.json は従来どおり PASS", () => {
  const result = validateReport(loadGood());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});
