/**
 * dashboard-reports.test.js — Phase59 STEP7。
 *
 * website/aor-admin/public/assets/js/reports.js の Published Artifact Status / Audit Summary
 * カードが、Dashboard Reports 集計（dashboardAggregates.collectReportSummary()）および
 * Operational Health status（server.js の operationalHealthStatus()）の実際のフィールド形状・
 * 判定結果と整合していることを確認する（read-only。server 起動なし・DI のみ）。
 *
 * ここでは新しい判定ロジックは書かない。既存の集計/判定関数の出力を reports.js の描画関数へ
 * そのまま渡し、legacy 判定に落ちずに正しく描画されること・status 文字列が Audit Summary の
 * synchronized / reconciliation 行へそのまま反映されることだけを確認する。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const server = require(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "server.js"));
const dashboardAggregates = require("../shared/dashboard-aggregates");
const reportsUi = require(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "assets", "js", "reports.js"));

test("整合確認1: collectReportSummary() の generated/approved/published_backend が Published Artifact Status カードの generated_reports/approved_reports/published_reports 表示にそのまま反映される", () => {
  const reportsCache = [
    { id: "a.jp", review_status: "approved", published: true, publishable: true },
    { id: "b.jp", review_status: "pending_review", published: false, publishable: false },
  ];
  const summary = dashboardAggregates.collectReportSummary({ reportsCache, publishedBackendSlugs: ["a.jp"] });

  // /api/dashboard/reports 形状（reports.js の renderOverview が使う既存フィールド名）
  assert.equal(typeof summary.generated, "number");
  assert.equal(typeof summary.approved, "number");
  assert.equal(typeof summary.published_backend, "number");

  // server.js の buildOperationalHealthStatusSection() は generated_reports=collectReportSummary().generated
  // 等として additive に転記する契約（Phase59 STEP5）。ここではその契約通りの形を組み立て、
  // reports.js 側が正しいフィールド名（*_reports）で参照できることを確認する。
  const status = server.operationalHealthStatus(summary.published_stale, summary.published_orphan);
  const operationalHealth = {
    ok: true,
    status,
    summary: {
      published_stale: summary.published_stale,
      published_orphan: summary.published_orphan,
      deploy_ready: summary.published_stale === 0 && summary.published_orphan === 0,
      deploy_blocked: !(summary.published_stale === 0 && summary.published_orphan === 0),
      generated_reports: summary.generated,
      approved_reports: summary.approved,
      published_reports: summary.published_backend,
    },
  };

  const html = reportsUi.renderPublishedArtifactStatus(operationalHealth);
  assert.notEqual(html, "", "フィールド名が一致していれば legacy 判定に落ちず描画される");
  assert.match(html, new RegExp('dash-metric-value">' + summary.generated + '</div><div class="dash-metric-label">Generated Reports'));
  assert.match(html, new RegExp('dash-metric-value">' + summary.approved + '</div><div class="dash-metric-label">Approved Reports'));
  assert.match(html, new RegExp('dash-metric-value">' + summary.published_backend + '</div><div class="dash-metric-label">Published Reports'));
  assert.ok(!html.includes("undefined") && !html.includes("NaN"));
});

test("整合確認2: server.js の operationalHealthStatus()（success/warning/danger）が Audit Summary の synchronized / reconciliation 行へそのまま反映される", () => {
  const readyStatus = server.operationalHealthStatus(0, 0);
  const warnStatus = server.operationalHealthStatus(1, 0);
  const dangerStatus = server.operationalHealthStatus(0, 1);
  assert.equal(readyStatus, "success");
  assert.equal(warnStatus, "warning");
  assert.equal(dangerStatus, "danger");

  const base = { generated_reports: 9, approved_reports: 5, published_reports: 4, published_stale: 0, published_orphan: 0 };
  const readyHtml = reportsUi.renderPublishedArtifactAuditSummary({ ok: true, status: readyStatus, summary: base });
  const warnHtml = reportsUi.renderPublishedArtifactAuditSummary({ ok: true, status: warnStatus, summary: Object.assign({}, base, { published_stale: 1 }) });
  const dangerHtml = reportsUi.renderPublishedArtifactAuditSummary({ ok: true, status: dangerStatus, summary: Object.assign({}, base, { published_orphan: 1 }) });

  assert.match(readyHtml, /<td>Published artifacts synchronized<\/td><td><span class="status-pill status-approved">success<\/span><\/td>/);
  assert.match(warnHtml, /<td>Published artifacts synchronized<\/td><td><span class="status-pill status-needs_revision">warning<\/span><\/td>/);
  assert.match(dangerHtml, /<td>Published artifacts synchronized<\/td><td><span class="status-pill status-rejected">danger<\/span><\/td>/);
  // 「Generated reports reviewed」「Approved reports published」は generated/approved/published の
  // 等値比較のみ（9≠5≠4 なのでいずれも warning）。status（success/warning/danger）とは独立。
  for (const html of [readyHtml, warnHtml, dangerHtml]) {
    assert.match(html, /<td>Generated reports reviewed<\/td><td><span class="status-pill status-needs_revision">warning<\/span><\/td>/);
    assert.match(html, /<td>Approved reports published<\/td><td><span class="status-pill status-needs_revision">warning<\/span><\/td>/);
  }
});
