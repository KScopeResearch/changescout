/**
 * navigation-ui.test.js — website/aor-admin/public/assets/js/app.js（Phase59 STEP10）。
 * dashboard-ui / operations-ui / reports-ui / system-ui と同じ方針（module.exports 経由、
 * DOM 非依存）。Operational Health Navigation Badge / Tooltip / Summary の描画のみを確認する。
 *
 * app.js はこの STEP 時点ではまだどの HTML ページにも <script> 配線されていない
 * 純粋関数ユーティリティであり、ここでは関数の入出力のみを検証する。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const nav = require(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "assets", "js", "app.js"));

function opHealth(summaryOverrides, status) {
  return {
    ok: true,
    generated_at: "2026-09-12T00:00:00Z",
    status: status || "success",
    summary: Object.assign(
      {
        deploy_ready: true,
        deploy_blocked: false,
        published_stale: 0,
        published_orphan: 0,
        recommended_republish: 0,
        recommended_unpublish: 0,
        generated_reports: 9,
        approved_reports: 5,
        published_reports: 4,
      },
      summaryOverrides || {}
    ),
    checks: [],
  };
}

test("Case A: Healthy Badge表示 — status=success → 🟢 Healthy", () => {
  const html = nav.renderHealthBadge(opHealth());
  assert.match(html, /🟢 Healthy/);
  assert.match(html, /class="nav-health-badge"/);
});

test("Case B: Warning Badge表示 — status=warning → 🟡 Attention", () => {
  const html = nav.renderHealthBadge(opHealth({ deploy_ready: false, deploy_blocked: true, published_stale: 1 }, "warning"));
  assert.match(html, /🟡 Attention/);
});

test("Case C: Danger Badge表示 — status=danger → 🔴 Blocked", () => {
  const html = nav.renderHealthBadge(opHealth({ deploy_ready: false, deploy_blocked: true, published_orphan: 1 }, "danger"));
  assert.match(html, /🔴 Blocked/);
});

test("Case D: Tooltip success — 静的文言がtitle属性に入る", () => {
  const html = nav.renderHealthBadge(opHealth());
  assert.match(html, /title="Published artifacts are synchronized and deployment is not blocked\."/);
});

test("Case E: Tooltip warning — 静的文言がtitle属性に入る", () => {
  const html = nav.renderHealthBadge(opHealth({ deploy_ready: false, deploy_blocked: true, published_stale: 1 }, "warning"));
  assert.match(html, /title="Published artifacts require remediation before deployment\."/);
});

test("Case F: Tooltip danger — 静的文言がtitle属性に入る", () => {
  const html = nav.renderHealthBadge(opHealth({ deploy_ready: false, deploy_blocked: true, published_orphan: 1 }, "danger"));
  assert.match(html, /title="Deployment is blocked due to orphan published artifacts\."/);
});

test("Case G: Legacyレスポンス — summary/status/generated_reportsのいずれかが無ければBadge・Summary・Tooltipとも非表示", () => {
  assert.equal(nav.renderHealthBadge(undefined), "");
  assert.equal(nav.renderHealthBadge(null), "");
  assert.equal(nav.renderHealthBadge({}), "");
  assert.equal(nav.renderHealthBadge({ ok: true, status: "success", summary: { deploy_ready: true } }), "", "generated_reports が無ければ legacy");
  assert.equal(nav.renderHealthBadge({ ok: true, summary: opHealth().summary }), "", "status が無ければ legacy");
  assert.equal(nav.renderHealthBadge({ status: "error", message: "boom" }), "");

  assert.equal(nav.renderNavigationHealthSummary(undefined), "");
  assert.equal(nav.renderNavigationHealthSummary({ ok: true, status: "success", summary: { deploy_ready: true } }), "");

  assert.equal(nav.renderNavigationHealth(undefined), "");
  assert.equal(nav.renderNavigationHealth({ ok: true, status: "success", summary: { deploy_ready: true } }), "");
});

test("Case H: undefined / NaN なし — legacy・実データ相当（9/5/4）いずれのケースでも undefined/NaN 文字列を出さない", () => {
  const legacy = nav.renderNavigationHealth({});
  assert.equal(legacy, "");

  const withData = nav.renderNavigationHealth(opHealth());
  assert.ok(!withData.includes("undefined") && !withData.includes("NaN"));
  assert.match(withData, /Deploy Ready: Yes/);
  assert.match(withData, /Published Stale: 0/);
  assert.match(withData, /Published Orphan: 0/);

  // published_stale/published_orphan が null（未取得）でも 0 表示にフォールバックし NaN を出さない
  const nullish = nav.renderNavigationHealthSummary(opHealth({ published_stale: null, published_orphan: null }));
  assert.ok(!nullish.includes("undefined") && !nullish.includes("NaN"));
  assert.match(nullish, /Published Stale: 0/);
  assert.match(nullish, /Published Orphan: 0/);
});
