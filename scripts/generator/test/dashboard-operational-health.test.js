/**
 * dashboard-operational-health.test.js — Phase58 STEP9。
 *
 * Backend: website/aor-admin/server.js の operationalHealthStatus() / buildOperationalHealthChecks()
 *   （純粋関数。classification 別件数 → success/warning/danger の固定マッピングと、
 *    Health Checks（5件・順序固定）の組み立てのみ。deploy reconciliation は再実行しない）。
 * UI:      website/aor-admin/public/assets/js/dashboard.js の renderOperationalHealthCard()。
 *
 * どちらも「表示・整形」だけを担い、publishable / freshness / review の判定はしない。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const server = require(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "server.js"));
const ui = require(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "assets", "js", "dashboard.js"));

const { operationalHealthStatus, buildOperationalHealthChecks } = server;

// ===========================================================================
// API — operationalHealthStatus（§3 固定マッピング）
// ===========================================================================

test("Case1: stale=0 orphan=0 → success", () => {
  assert.equal(operationalHealthStatus(0, 0), "success");
});

test("Case2: stale>0 orphan=0 → warning", () => {
  assert.equal(operationalHealthStatus(1, 0), "warning");
  assert.equal(operationalHealthStatus(5, 0), "warning");
});

test("Case3: orphan>0（stale=0）→ danger", () => {
  assert.equal(operationalHealthStatus(0, 1), "danger");
});

test("Case4: stale>0 かつ orphan>0 → danger（orphan が優先）", () => {
  assert.equal(operationalHealthStatus(3, 2), "danger");
});

test("Case5: legacy summary fallback（undefined/null 入力でも例外を投げず success 扱い）", () => {
  assert.equal(operationalHealthStatus(undefined, undefined), "success");
  assert.equal(operationalHealthStatus(null, null), "success");
  assert.equal(operationalHealthStatus(), "success");
});

// ===========================================================================
// API — buildOperationalHealthChecks（§6 固定順序・5件）
// ===========================================================================

test("buildOperationalHealthChecks: 順序固定・5件（§6）", () => {
  const checks = buildOperationalHealthChecks({ published_stale: 0, published_orphan: 0, deploy_ready: true, has_unreadable: false, deploy_configured: true });
  assert.equal(checks.length, 5);
  assert.deepEqual(
    checks.map((c) => c.id),
    ["published-artifacts", "deploy-readiness", "public-report-contract", "dashboard-aggregates", "deployment-configuration"]
  );
  assert.deepEqual(
    checks.map((c) => c.title),
    ["Published Artifact Health", "Deploy Readiness", "Public Report Contract", "Dashboard Aggregates", "Deployment Configuration"]
  );
});

test("buildOperationalHealthChecks: healthy（全て success）", () => {
  const checks = buildOperationalHealthChecks({ published_stale: 0, published_orphan: 0, deploy_ready: true, has_unreadable: false, deploy_configured: true });
  assert.deepEqual(
    checks.map((c) => c.status),
    ["success", "success", "success", "success", "success"]
  );
  assert.match(checks[0].detail, /No stale or orphan/);
});

test("buildOperationalHealthChecks: stale あり → published-artifacts / deploy-readiness が warning、他は影響されない", () => {
  const checks = buildOperationalHealthChecks({ published_stale: 2, published_orphan: 0, deploy_ready: false, has_unreadable: false, deploy_configured: true });
  assert.equal(checks[0].status, "warning");
  assert.match(checks[0].detail, /2 stale published artifacts detected\./);
  assert.equal(checks[1].status, "warning");
  assert.equal(checks[2].status, "success"); // public-report-contract は has_unreadable のみに依存
  assert.equal(checks[4].status, "success"); // deployment-configuration は deploy_configured のみに依存
});

test("buildOperationalHealthChecks: orphan あり → published-artifacts が danger。deploy-readiness は warning のまま（成功/警告の二値）", () => {
  const checks = buildOperationalHealthChecks({ published_stale: 0, published_orphan: 1, deploy_ready: false, has_unreadable: false, deploy_configured: true });
  assert.equal(checks[0].status, "danger");
  assert.equal(checks[1].status, "warning");
});

test("buildOperationalHealthChecks: has_unreadable → public-report-contract が danger", () => {
  const checks = buildOperationalHealthChecks({ published_stale: 0, published_orphan: 0, deploy_ready: true, has_unreadable: true, deploy_configured: true });
  assert.equal(checks[2].status, "danger");
  assert.match(checks[2].detail, /could not be parsed/);
});

test("buildOperationalHealthChecks: deploy_configured=false → deployment-configuration が warning", () => {
  const checks = buildOperationalHealthChecks({ published_stale: 0, published_orphan: 0, deploy_ready: true, has_unreadable: false, deploy_configured: false });
  assert.equal(checks[4].status, "warning");
  assert.match(checks[4].detail, /dry-run only/);
});

test("buildOperationalHealthChecks: legacy（空 input）でも例外を投げず 5 件返す", () => {
  const checks = buildOperationalHealthChecks({});
  assert.equal(checks.length, 5);
  assert.equal(checks[0].status, "success");
  const checksUndefined = buildOperationalHealthChecks(undefined);
  assert.equal(checksUndefined.length, 5);
});

// ===========================================================================
// Dashboard UI — renderOperationalHealthCard
// ===========================================================================

const CHECKS_OK = [
  { id: "published-artifacts", status: "success", title: "Published Artifact Health", detail: "No stale or orphan published artifacts detected." },
  { id: "deploy-readiness", status: "success", title: "Deploy Readiness", detail: "Deployment is not blocked by published artifact health." },
  { id: "public-report-contract", status: "success", title: "Public Report Contract", detail: "OK" },
  { id: "dashboard-aggregates", status: "success", title: "Dashboard Aggregates", detail: "OK" },
  { id: "deployment-configuration", status: "success", title: "Deployment Configuration", detail: "Configured" },
];
const CHECKS_WARN = [
  { id: "published-artifacts", status: "warning", title: "Published Artifact Health", detail: "1 stale published artifact detected." },
  { id: "deploy-readiness", status: "warning", title: "Deploy Readiness", detail: "Deployment is blocked until stale published artifacts are resolved." },
  { id: "public-report-contract", status: "success", title: "Public Report Contract", detail: "OK" },
  { id: "dashboard-aggregates", status: "success", title: "Dashboard Aggregates", detail: "OK" },
  { id: "deployment-configuration", status: "warning", title: "Deployment Configuration", detail: "Not configured" },
];
const CHECKS_DANGER = [
  { id: "published-artifacts", status: "danger", title: "Published Artifact Health", detail: "1 orphan published artifact detected." },
  { id: "deploy-readiness", status: "warning", title: "Deploy Readiness", detail: "Deployment is blocked until stale published artifacts are resolved." },
  { id: "public-report-contract", status: "success", title: "Public Report Contract", detail: "OK" },
  { id: "dashboard-aggregates", status: "success", title: "Dashboard Aggregates", detail: "OK" },
  { id: "deployment-configuration", status: "success", title: "Deployment Configuration", detail: "Configured" },
];

test("CaseA: deploy_ready=true → 'Ready for Deploy ✅'（緑）、remediation リンクなし", () => {
  const html = ui.renderOperationalHealthCard({
    ok: true,
    status: "success",
    summary: { published_stale: 0, published_orphan: 0, recommended_republish: 0, recommended_unpublish: 0, deploy_blocked: false, deploy_ready: true },
    checks: CHECKS_OK,
  });
  assert.match(html, /Ready for Deploy/);
  assert.match(html, /✅/);
  assert.match(html, /dash-alert tone-good/);
  assert.ok(!html.includes("Deployment Blocked"));
  assert.ok(!html.includes("View remediation plan"), "件数0（ready）ならリンクを出さない");
});

test("CaseB: deploy_blocked=true → 'Deployment Blocked ⚠️'（黄。赤ではない）", () => {
  const html = ui.renderOperationalHealthCard({
    ok: true,
    status: "warning",
    summary: { published_stale: 1, published_orphan: 0, recommended_republish: 1, recommended_unpublish: 0, deploy_blocked: true, deploy_ready: false },
    checks: CHECKS_WARN,
  });
  assert.match(html, /Deployment Blocked/);
  assert.match(html, /⚠️/);
  assert.match(html, /dash-alert tone-warn/);
  assert.ok(!html.includes("dash-alert tone-bad"), "Deploy Readiness バナー自体は赤にしない（§4: 黄）");
});

test("CaseC: Health Checks（warning）— 5件・順序固定・バッジ表示", () => {
  const html = ui.renderOperationalHealthCard({
    ok: true,
    status: "warning",
    summary: { published_stale: 1, published_orphan: 0, recommended_republish: 1, recommended_unpublish: 0, deploy_blocked: true, deploy_ready: false },
    checks: CHECKS_WARN,
  });
  const order = ["Published Artifact Health", "Deploy Readiness", "Public Report Contract", "Dashboard Aggregates", "Deployment Configuration"];
  let lastIdx = -1;
  for (const title of order) {
    const idx = html.indexOf(title);
    assert.ok(idx > lastIdx, `${title} の順序が正しくない`);
    lastIdx = idx;
  }
  assert.match(html, /status-pill status-needs_revision">🟡 warning</);
});

test("CaseD: Health Checks（danger）— published-artifacts が danger バッジ", () => {
  const html = ui.renderOperationalHealthCard({
    ok: true,
    status: "danger",
    summary: { published_stale: 0, published_orphan: 1, recommended_republish: 0, recommended_unpublish: 1, deploy_blocked: true, deploy_ready: false },
    checks: CHECKS_DANGER,
  });
  assert.match(html, /status-pill status-rejected">🔴 danger</);
  // danger 行に Published Artifact Health が乗る
  const dangerRow = html.slice(html.indexOf("🔴 danger"), html.indexOf("🔴 danger") + 120);
  assert.ok(dangerRow.includes("Published Artifact Health"));
});

test("CaseE: remediation link — operations.html#published-artifact-health、件数ありのときだけ", () => {
  const blocked = ui.renderOperationalHealthCard({
    ok: true,
    status: "warning",
    summary: { published_stale: 1, published_orphan: 0, recommended_republish: 1, recommended_unpublish: 0, deploy_blocked: true, deploy_ready: false },
    checks: CHECKS_WARN,
  });
  assert.match(blocked, /<a href="operations\.html#published-artifact-health">View remediation plan →<\/a>/);

  const ready = ui.renderOperationalHealthCard({
    ok: true,
    status: "success",
    summary: { published_stale: 0, published_orphan: 0, recommended_republish: 0, recommended_unpublish: 0, deploy_blocked: false, deploy_ready: true },
    checks: CHECKS_OK,
  });
  assert.ok(!ready.includes("View remediation plan"));
});

test("UI: 件数のみ表示（一覧表示は禁止）— items 配列を渡しても Card 内に個社行を出さない", () => {
  const html = ui.renderOperationalHealthCard({
    ok: true,
    status: "warning",
    summary: { published_stale: 1, published_orphan: 0, recommended_republish: 1, recommended_unpublish: 0, deploy_blocked: true, deploy_ready: false },
    checks: CHECKS_WARN,
    operational_health: { items: [{ slug: "example.com", state: "published_stale" }], stale_count: 1, orphan_count: 0 },
  });
  assert.ok(!html.includes("<table"), "Operational Health Card は件数のみ。テーブル/一覧は出さない");
  assert.ok(!html.includes("example.com"), "個社 slug は Card に出さない");
  assert.match(html, /Stale/); // カウントラベルは出る
});

test("UI: legacy（status フィールドなし）は Card 自体を描画しない", () => {
  assert.equal(ui.renderOperationalHealthCard(undefined), "");
  assert.equal(ui.renderOperationalHealthCard(null), "");
  assert.equal(ui.renderOperationalHealthCard({ generated_at: "x", operational_health: { items: [], stale_count: 0, orphan_count: 0 } }), "");
});

test("UI: {status:'error'} は section error として表示", () => {
  assert.match(ui.renderOperationalHealthCard({ status: "error", message: "boom" }), /dash-section-error/);
});

test("UI: renderDashboard — Operational Health（新カード）は Report Summary の後、Operational Health Detail の前、System Health の前", () => {
  const payload = {
    summary: { generated_at: "2026-09-11T00:00:00Z", lead_summary: {}, delivery_summary: {}, suppression_summary: {} },
    reports: { generated: 1, approved: 1, published_backend: 1, web_deployed: 1, deploy_pending: 0, pending_slugs: [] },
    health: { ses: {}, lambda: {}, cloudfront: {}, blastengine: {} },
    operationalHealth: {
      ok: true,
      status: "warning",
      summary: { published_stale: 1, published_orphan: 0, recommended_republish: 1, recommended_unpublish: 0, deploy_blocked: true, deploy_ready: false },
      checks: CHECKS_WARN,
      operational_health: { items: [{ slug: "example.com", state: "published_stale", reason: "x", published_at: null }], stale_count: 1, orphan_count: 0 },
    },
  };
  const html = ui.renderDashboard(payload);
  assert.match(html, /Operational Health(?!\sDetail)/); // 新カードの見出し
  const iReport = html.indexOf("Report Summary");
  const iCard = html.indexOf(">Operational Health<");
  const iDetail = html.indexOf("Operational Health Detail");
  const iSystem = html.indexOf("System Health");
  assert.ok(iReport < iCard, "Operational Health Card は Report Summary の後");
  assert.ok(iCard < iDetail, "Operational Health Card は Operational Health Detail の前");
  assert.ok(iDetail < iSystem, "Operational Health Detail は System Health の前（既存順序を維持）");
});

test("UI: renderDashboard — legacy operationalHealth（新フィールドなし）でも既存部分は正常表示", () => {
  const html = ui.renderDashboard({
    summary: { generated_at: "2026-09-11T00:00:00Z", lead_summary: {}, delivery_summary: {}, suppression_summary: {} },
    reports: { generated: 1, approved: 1, published_backend: 1, web_deployed: 1, deploy_pending: 0, pending_slugs: [] },
    health: { ses: {}, lambda: {}, cloudfront: {}, blastengine: {} },
    operationalHealth: { generated_at: "x", operational_health: { items: [], stale_count: 0, orphan_count: 0 } },
  });
  assert.ok(!html.includes(">Operational Health<"), "legacy では新カードのセクション自体が無い");
  assert.match(html, /Report Summary/);
  assert.match(html, /System Health/);
  assert.ok(!html.includes("undefined") && !html.includes("NaN"));
});
