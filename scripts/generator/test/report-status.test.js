/**
 * report-status.test.js — website/aor-admin/public/assets/js/report-status.js（Phase52 STEP8）。
 * Dashboard（dashboard.js）と Reports（reports.js）が参照する共通 Report status ユーティリティ。
 * dashboard.js の公開 API が同じ結果を返す（＝共通化されている）ことも検証する。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const rs = require(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "assets", "js", "report-status.js"));
const dashUi = require(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "assets", "js", "dashboard.js"));

test("deployPendingTone: null→dim / >0→warn / 0→ok", () => {
  assert.equal(rs.deployPendingTone(null), "dim");
  assert.equal(rs.deployPendingTone(undefined), "dim");
  assert.equal(rs.deployPendingTone(0), "ok");
  assert.equal(rs.deployPendingTone(3), "warn");
});

test("dashboard.js は report-status.js に一本化されている（同じ入力で同じ結果）", () => {
  for (const n of [null, undefined, 0, 1, 5]) {
    assert.equal(dashUi.deployPendingTone(n), rs.deployPendingTone(n), `deployPendingTone(${n})`);
  }
  assert.equal(dashUi.isSectionError({ status: "error" }), rs.isSectionError({ status: "error" }));
  assert.equal(dashUi.isSectionError({ status: "Deployed" }), rs.isSectionError({ status: "Deployed" }));
  assert.equal(dashUi.isSectionError(null), rs.isSectionError(null));
});

test("isSectionError: {status:'error'} のみ true", () => {
  assert.equal(rs.isSectionError({ status: "error", message: "x" }), true);
  assert.equal(rs.isSectionError({ status: "Deployed" }), false);
  assert.equal(rs.isSectionError({ generated: 3 }), false);
  assert.equal(rs.isSectionError(null), false);
});

test("reviewStatusClass: 各 review.status → 既存 status-pill クラス", () => {
  assert.equal(rs.reviewStatusClass("approved"), "status-approved");
  assert.equal(rs.reviewStatusClass("rejected"), "status-rejected");
  assert.equal(rs.reviewStatusClass("needs_revision"), "status-needs_revision");
  assert.equal(rs.reviewStatusClass("pending_review"), "status-pending_review");
  assert.equal(rs.reviewStatusClass(undefined), "status-pending_review");
});

test("reportDeployState: Backend の pending_slugs 配列を membership check するだけ（差集合再計算なし）", () => {
  // web_deployed が null（Web 一覧が取れていない）→ unknown
  assert.equal(rs.reportDeployState("company-a", ["company-a"], null), "unknown");
  assert.equal(rs.reportDeployState("company-a", ["company-a"], undefined), "unknown");
  // pending_slugs に含まれる → pending
  assert.equal(rs.reportDeployState("company-a", ["company-a", "company-b"], 5), "pending");
  // 含まれない → deployed
  assert.equal(rs.reportDeployState("company-c", ["company-a", "company-b"], 5), "deployed");
  // pending_slugs が配列でない → deployed（membership false 扱い）
  assert.equal(rs.reportDeployState("company-a", null, 5), "deployed");
});

test("deployStateLabel: 各 state → ラベルとトーン", () => {
  assert.deepEqual(rs.deployStateLabel("pending"), { label: "Deploy Pending", tone: "warn" });
  assert.deepEqual(rs.deployStateLabel("deployed"), { label: "Deployed", tone: "ok" });
  assert.deepEqual(rs.deployStateLabel("not_published"), { label: "Not Published", tone: "dim" });
  assert.deepEqual(rs.deployStateLabel("unknown"), { label: "Unknown", tone: "dim" });
});
