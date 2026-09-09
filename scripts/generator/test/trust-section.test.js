/**
 * trust-section.test.js — Phase56 STEP1
 * CTA 直前の Trust / Micro Proof（登録不要 / 無料 / 確認済み / 停止可能）。
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const P = require(path.join(__dirname, "..", "..", "..", "website", "aor", "assets", "js", "preview-ui.js"));
const { loadReport } = require("./fixtures/aor-reports");

const js = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "website", "aor", "assets", "js", "report-preview.js"),
  "utf-8"
);
const css = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "website", "aor", "assets", "css", "preview-conversion.css"),
  "utf-8"
);

test("trustItems: 4 項目（登録不要 / 無料で閲覧 / 確認 / 停止可能）", () => {
  const items = P.trustItems(loadReport("kscope.co.jp"));
  assert.equal(items.length, 4);
  const labels = items.map((i) => i.label).join(" ");
  assert.match(labels, /登録不要/);
  assert.match(labels, /無料/);
  assert.match(labels, /停止/);
});

test("trustItems: approved は「人間が確認済み」、pending は「レビュー中」", () => {
  const approved = P.trustItems({ human_review: { status: "approved" } });
  assert.ok(approved.some((i) => /確認済み/.test(i.label)));
  const pending = P.trustItems({ human_review: { status: "pending_review" } });
  assert.ok(pending.some((i) => /レビュー中/.test(i.label)));
});

test("trustItems: human_review 欠落でもクラッシュしない", () => {
  assert.equal(P.trustItems({}).length, 4);
  assert.equal(P.trustItems(undefined).length, 4);
});

test("renderTrust は renderCtaBottom の直前に呼ばれる", () => {
  const iTrust = js.indexOf("renderTrust(");
  const iCta = js.indexOf("renderCtaBottom(");
  const iLocked = js.indexOf("renderLockedThemes(");
  assert.ok(iLocked < iTrust && iTrust < iCta);
});

test("trust-strip の CSS がある（flex-wrap で 375px でも崩れない）", () => {
  assert.match(css, /\.trust-strip\s*\{[\s\S]*?flex-wrap:\s*wrap/);
});
