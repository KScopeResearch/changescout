/**
 * admin-health-navigation.test.js — Phase59 STEP10。
 *
 * website/aor-admin/public/assets/js/app.js の Operational Health Navigation Badge / Summary が、
 * Dashboard Reports 集計（dashboardAggregates.collectReportSummary()）および Operational Health
 * status（server.js の operationalHealthStatus()）の実際のフィールド形状・判定結果と
 * 整合していることを確認する（read-only。server 起動なし・DI のみ）。
 *
 * ここでは新しい判定ロジックは書かない。既存の集計/判定関数の出力を app.js の描画関数へ
 * そのまま渡し、legacy 判定に落ちずに正しく描画されること・status 文字列がバッジへそのまま
 * 反映されることだけを確認する。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const server = require(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "server.js"));
const dashboardAggregates = require("../shared/dashboard-aggregates");
const nav = require(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "assets", "js", "app.js"));

test("status整合: server.js の operationalHealthStatus()（success/warning/danger）が Navigation Badge の表示文言・Tooltipへそのまま反映される", () => {
  const readyStatus = server.operationalHealthStatus(0, 0);
  const warnStatus = server.operationalHealthStatus(1, 0);
  const dangerStatus = server.operationalHealthStatus(0, 1);
  assert.equal(readyStatus, "success");
  assert.equal(warnStatus, "warning");
  assert.equal(dangerStatus, "danger");

  const base = { generated_reports: 9, approved_reports: 5, published_reports: 4, published_stale: 0, published_orphan: 0, deploy_ready: true, deploy_blocked: false };
  const readyHtml = nav.renderHealthBadge({ ok: true, status: readyStatus, summary: base });
  const warnHtml = nav.renderHealthBadge({ ok: true, status: warnStatus, summary: Object.assign({}, base, { published_stale: 1, deploy_ready: false, deploy_blocked: true }) });
  const dangerHtml = nav.renderHealthBadge({ ok: true, status: dangerStatus, summary: Object.assign({}, base, { published_orphan: 1, deploy_ready: false, deploy_blocked: true }) });

  assert.match(readyHtml, /🟢 Healthy/);
  assert.match(warnHtml, /🟡 Attention/);
  assert.match(dangerHtml, /🔴 Blocked/);
  assert.equal(nav.STATUS_TOOLTIP[readyStatus], "Published artifacts are synchronized and deployment is not blocked.");
  assert.equal(nav.STATUS_TOOLTIP[warnStatus], "Published artifacts require remediation before deployment.");
  assert.equal(nav.STATUS_TOOLTIP[dangerStatus], "Deployment is blocked due to orphan published artifacts.");
});

test("summary整合: collectReportSummary() から導出した deploy_ready/published_stale/published_orphan が Navigation Health Summary へそのまま反映される", () => {
  const reportsCache = [
    { id: "a.jp", review_status: "approved", published: true, publishable: true },
    { id: "b.jp", review_status: "pending_review", published: false, publishable: false },
  ];
  const summary = dashboardAggregates.collectReportSummary({ reportsCache, publishedBackendSlugs: ["a.jp"] });
  const deployReady = summary.published_stale === 0 && summary.published_orphan === 0;
  const status = server.operationalHealthStatus(summary.published_stale, summary.published_orphan);

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

  const html = nav.renderNavigationHealthSummary(operationalHealth);
  assert.notEqual(html, "", "フィールド名が一致していれば legacy 判定に落ちず描画される");
  assert.match(html, new RegExp("Deploy Ready: " + (deployReady ? "Yes" : "No")));
  assert.match(html, new RegExp("Published Stale: " + summary.published_stale));
  assert.match(html, new RegExp("Published Orphan: " + summary.published_orphan));
  assert.ok(!html.includes("undefined") && !html.includes("NaN"));
});

test("navigation順序: Admin共通ナビゲーションの想定順序（Dashboard/Reports/Operations/System → Operational Health）で Navigation Health が最後尾に追加される設計になっている", () => {
  // app.js はこの STEP 時点では HTML への配線を持たないため、ここでは「既存4項目の後ろに
  // 追加する」という設計意図を、renderNavigationHealth() が単独の末尾要素として完結した
  // HTML（他のナビ項目を含まない・順序制御用の属性を持たない独立コンポーネント）を返すことで
  // 間接的に確認する。実際の DOM 挿入順序は HTML 配線時に「最後に appendChild する」ことで
  // 保証する想定（本 STEP のスコープ外）。
  const html = nav.renderNavigationHealth({ ok: true, status: "success", summary: { generated_reports: 9, approved_reports: 5, published_reports: 4, published_stale: 0, published_orphan: 0, deploy_ready: true, deploy_blocked: false } });
  assert.match(html, /^<span class="nav-health">/, "Navigation Health は独立した単一要素として返される（既存ナビ項目のマークアップを含まない）");
  assert.ok(!html.includes("Dashboard") && !html.includes("Reports") && !html.includes("Operations") && !html.includes("System"), "既存ナビ項目のラベル文字列を含まない＝既存順序を書き換えない設計");
});

test("legacyレスポンス: summary/status/generated_reports のいずれかが欠けていれば Navigation Health を描画しない", () => {
  assert.equal(nav.renderNavigationHealth(undefined), "");
  assert.equal(nav.renderNavigationHealth(null), "");
  assert.equal(nav.renderNavigationHealth({}), "");
  assert.equal(nav.renderNavigationHealth({ ok: true, status: "success", summary: { deploy_ready: true } }), "", "generated_reports が無ければ legacy");
  assert.equal(nav.renderNavigationHealth({ ok: true, summary: { generated_reports: 9, approved_reports: 5, published_reports: 4 } }), "", "status が無ければ legacy");
  assert.equal(nav.renderNavigationHealth({ status: "error", message: "boom" }), "");
});
