/**
 * dashboard-consistency.test.js — Phase59 STEP9。
 *
 * website/aor-admin/public/assets/js/dashboard.js の「Admin Dashboard Consistency Audit」
 * セクション（renderConsistencyAudit）が、Dashboard Reports 集計（dashboardAggregates.
 * collectReportSummary()）および Operational Health status（server.js の operationalHealthStatus()）
 * の実際のフィールド形状・判定結果と整合していることを確認する（read-only。server 起動なし・DI のみ）。
 *
 * ここでは新しい判定ロジックは書かない。既存の集計/判定関数の出力を dashboard.js の描画関数へ
 * そのまま渡し、legacy 判定に落ちずに正しく描画されること・status 文字列が Checklist の各行へ
 * そのまま反映されることだけを確認する。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const server = require(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "server.js"));
const dashboardAggregates = require("../shared/dashboard-aggregates");
const dashboardUi = require(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "assets", "js", "dashboard.js"));

test("summary整合: collectReportSummary() の generated/approved/published_backend が Consistency Audit の generated_reports/approved_reports/published_reports 表示にそのまま反映される", () => {
  const reportsCache = [
    { id: "a.jp", review_status: "approved", published: true, publishable: true },
    { id: "b.jp", review_status: "pending_review", published: false, publishable: false },
  ];
  const summary = dashboardAggregates.collectReportSummary({ reportsCache, publishedBackendSlugs: ["a.jp"] });

  assert.equal(typeof summary.generated, "number");
  assert.equal(typeof summary.approved, "number");
  assert.equal(typeof summary.published_backend, "number");

  const status = server.operationalHealthStatus(summary.published_stale, summary.published_orphan);
  const deployReady = summary.published_stale === 0 && summary.published_orphan === 0;
  const operationalHealth = {
    ok: true,
    status,
    summary: {
      published_stale: summary.published_stale,
      published_orphan: summary.published_orphan,
      deploy_ready: deployReady,
      deploy_blocked: !deployReady,
      generated_reports: summary.generated,
      approved_reports: summary.approved,
      published_reports: summary.published_backend,
    },
  };

  const html = dashboardUi.renderConsistencyAudit(operationalHealth);
  assert.notEqual(html, "", "フィールド名が一致していれば legacy 判定に落ちず描画される");
  assert.match(html, new RegExp('dash-metric-value">' + summary.generated + '</div><div class="dash-metric-label">Generated Reports'));
  assert.match(html, new RegExp('dash-metric-value">' + summary.approved + '</div><div class="dash-metric-label">Approved Reports'));
  assert.match(html, new RegExp('dash-metric-value">' + summary.published_backend + '</div><div class="dash-metric-label">Published Reports'));
  assert.match(html, new RegExp('dash-metric-value">' + (deployReady ? "Yes" : "No") + '</div><div class="dash-metric-label">Deploy Ready'));
  assert.ok(!html.includes("undefined") && !html.includes("NaN"));
});

test("status整合: server.js の operationalHealthStatus()（success/warning/danger）が Checklist の synchronized 系5行へそのまま反映される", () => {
  const readyStatus = server.operationalHealthStatus(0, 0);
  const warnStatus = server.operationalHealthStatus(1, 0);
  const dangerStatus = server.operationalHealthStatus(0, 1);
  assert.equal(readyStatus, "success");
  assert.equal(warnStatus, "warning");
  assert.equal(dangerStatus, "danger");

  const base = { generated_reports: 9, approved_reports: 5, published_reports: 4, published_stale: 0, published_orphan: 0, deploy_ready: true, deploy_blocked: false };
  const readyHtml = dashboardUi.renderConsistencyAudit({ ok: true, status: readyStatus, summary: base });
  const warnHtml = dashboardUi.renderConsistencyAudit({ ok: true, status: warnStatus, summary: Object.assign({}, base, { published_stale: 1, deploy_ready: false, deploy_blocked: true }) });
  const dangerHtml = dashboardUi.renderConsistencyAudit({ ok: true, status: dangerStatus, summary: Object.assign({}, base, { published_orphan: 1, deploy_ready: false, deploy_blocked: true }) });

  assert.equal((readyHtml.match(/🟢 success/g) || []).length, 6, "readyは6項目すべてsuccess（1項目目のexistenceチェック含む）");
  assert.equal((warnHtml.match(/🟡 warning/g) || []).length, 5, "warnは synchronized 系5項目がwarning");
  assert.equal((dangerHtml.match(/🔴 danger/g) || []).length, 5, "dangerは synchronized 系5項目がdanger");
});

test("checklist順序: 6項目が固定順序で出力される（Dashboard summary loaded → Deploy readiness → Published artifact counts → Dashboard audit → Operations audit → Reports audit）", () => {
  const data = { ok: true, status: "success", summary: { generated_reports: 9, approved_reports: 5, published_reports: 4, published_stale: 0, published_orphan: 0, deploy_ready: true, deploy_blocked: false } };
  const html = dashboardUi.renderConsistencyAudit(data);
  const order = [
    "Dashboard summary loaded",
    "Deploy readiness synchronized",
    "Published artifact counts synchronized",
    "Dashboard audit synchronized",
    "Operations audit synchronized",
    "Reports audit synchronized",
  ];
  let lastIdx = -1;
  for (const label of order) {
    const idx = html.indexOf(label);
    assert.ok(idx > lastIdx, `${label} の順序が正しくない`);
    lastIdx = idx;
  }
});

test("legacyレスポンス: summary/generated_reports/status のいずれかが欠けていれば Consistency Audit セクションを描画しない", () => {
  assert.equal(dashboardUi.renderConsistencyAudit(undefined), "");
  assert.equal(dashboardUi.renderConsistencyAudit(null), "");
  assert.equal(dashboardUi.renderConsistencyAudit({}), "");
  assert.equal(dashboardUi.renderConsistencyAudit({ ok: true, status: "success", summary: { deploy_ready: true } }), "", "generated_reports 等が無ければ legacy");
  assert.equal(dashboardUi.renderConsistencyAudit({ ok: true, summary: { generated_reports: 9, approved_reports: 5, published_reports: 4 } }), "", "status が無ければ legacy");
  assert.equal(dashboardUi.renderConsistencyAudit({ status: "error", message: "boom" }).includes("dash-section-error"), true);
});
