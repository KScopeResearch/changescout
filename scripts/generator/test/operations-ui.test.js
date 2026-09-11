/**
 * operations-ui.test.js — website/aor-admin/public/assets/js/operations.js（Phase52 STEP10）。
 * 純粋関数（レンダリング・操作可否・エラー分類）を Node からテストする。
 * mutation の実行フロー（fetch）はブラウザ配線側のため、ここでは可否判定・確認文・
 * エラー分類・XSS・secret 非表示を検証する。実 mutation は行わない。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ui = require(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "assets", "js", "operations.js"));

function rep(o = {}) {
  return Object.assign(
    { id: "example.com", company_name: "Example Inc", review_status: "approved", publishable: true, published: false },
    o
  );
}

const DASHBOARD = {
  lead_summary: { total: 5, pending_approval: 2 },
  report_summary: { generated: 3, approved: 2, published_backend: 2, web_deployed: 3, deploy_pending: 1, pending_slugs: ["beta.co.jp"] },
};
const HEALTH = { status: "ok", uptime: 100, version: "aor-admin/phase1-task21", checks: { auth: true } };

test("publishability: Backend の publishable / published だけで判定（独自ルールなし）", () => {
  assert.deepEqual(ui.publishability({ publishable: true, published: false }), { canPublish: true, canUnpublish: false, blockedByReview: false });
  assert.deepEqual(ui.publishability({ publishable: true, published: true }), { canPublish: false, canUnpublish: true, blockedByReview: false });
  assert.deepEqual(ui.publishability({ publishable: false, published: false }), { canPublish: false, canUnpublish: false, blockedByReview: true });
  assert.deepEqual(ui.publishability({ publishable: false, published: true }), { canPublish: false, canUnpublish: true, blockedByReview: false });
});

test("opButton: canPublish→Publish、canUnpublish→Unpublish(danger)、blocked→publishable=false 表示", () => {
  assert.match(ui.opButton(rep({ publishable: true, published: false })), /data-op="publish"/);
  assert.match(ui.opButton(rep({ publishable: true, published: true })), /data-op="unpublish"/);
  assert.match(ui.opButton(rep({ publishable: true, published: true })), /class="danger"/);
  assert.match(ui.opButton(rep({ publishable: false, published: false })), /publishable=false/);
});

test("opButton: submittingKey が一致する行は disabled + 進行中ラベル（二重送信防止）", () => {
  const html = ui.opButton(rep({ id: "x", publishable: true, published: false }), "x");
  assert.match(html, /disabled/);
  assert.match(html, /Publishing…/);
});

test("mutationErrorMessage: HTTP status を区別（401/403/404/409/429/500/400）", () => {
  assert.match(ui.mutationErrorMessage({ status: 401 }), /セッション/);
  assert.match(ui.mutationErrorMessage({ status: 403 }), /権限/);
  assert.match(ui.mutationErrorMessage({ status: 404 }), /見つかりません/);
  assert.match(ui.mutationErrorMessage({ status: 409, message: "state changed" }), /状態が変更されています/);
  assert.match(ui.mutationErrorMessage({ status: 429 }), /多すぎ/);
  assert.match(ui.mutationErrorMessage({ status: 500 }), /サーバーエラー/);
  assert.match(ui.mutationErrorMessage({ status: 400, message: "not publishable" }), /操作できませんでした: not publishable/);
});

test("renderSystemStatus: read-only サマリ。1 API error でも他を healthy 扱いしない", () => {
  const html = ui.renderSystemStatus({ health: HEALTH, dashboard: DASHBOARD, reports: [rep(), rep({ review_status: "pending_review" })] });
  assert.match(html, /Pending Review/);
  assert.match(html, />1</); // pending review = 1
  assert.match(html, /Pending Lead Approval/);
  assert.match(html, /Deploy Pending/);

  const degraded = ui.renderSystemStatus({ health: { status: "error", message: "x" }, dashboard: { status: "error" }, reports: [] });
  assert.match(degraded, /unknown/);
});

test("renderActionableLinks: 既存画面への導線のみ。Deploy は API なしと明記（重複実装しない）", () => {
  const html = ui.renderActionableLinks({ dashboard: DASHBOARD, reports: [rep({ review_status: "needs_revision" })] });
  assert.match(html, /href="\/index\.html"/);
  assert.match(html, /href="\/leads\.html"/);
  assert.match(html, /href="\/jobs\.html"/);
  assert.match(html, /Deploy API は存在しません/);
});

test("renderPublishTable: 各行に company/slug/review/publishable/published/operation", () => {
  const html = ui.renderPublishTable([rep({ id: "a", publishable: true, published: false }), rep({ id: "b", publishable: false, published: false })]);
  assert.match(html, /<th>operation<\/th>/);
  assert.match(html, /data-op="publish"/);
  assert.match(html, /publishable=false/);
  assert.match(ui.renderPublishTable([]), /レポートはありません/);
});

test("renderConfirmDialog: 対象・操作・副作用を明示。publish/unpublish で文言が変わる", () => {
  const pub = ui.renderConfirmDialog({ action: "publish", slug: "example.com", company: "Example Inc" });
  assert.match(pub, /このレポートを公開します/);
  assert.match(pub, /Example Inc/);
  assert.match(pub, /example\.com/);
  assert.match(pub, /data-modal-confirm/);
  assert.match(pub, /data-modal-cancel/);

  const unpub = ui.renderConfirmDialog({ action: "unpublish", slug: "example.com", company: "Example Inc" });
  assert.match(unpub, /公開を取り消します/);
  assert.match(unpub, /閲覧できなくなる/);

  assert.equal(ui.renderConfirmDialog(null), "");
});

test("XSS: company / slug / review_status を一覧・確認ダイアログの両方でエスケープ（§37/§38）", () => {
  const evil = "<script>alert(1)</script>";
  const attr = '"><img src=x onerror=alert(1)>';

  const table = ui.renderPublishTable([rep({ id: attr, company_name: evil, review_status: evil })]);
  assert.doesNotMatch(table, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(table, /<img /);

  const dialog = ui.renderConfirmDialog({ action: "publish", slug: attr, company: evil });
  assert.doesNotMatch(dialog, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(dialog, /<img /);
  assert.match(dialog, /&lt;script&gt;/);

  const full = ui.renderOperations({ health: HEALTH, dashboard: DASHBOARD, reports: [rep({ id: attr, company_name: evil })] }, {});
  assert.doesNotMatch(full, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(full, /<img /);
});

test("secret leakage: mutation error message に混じった secret 断片をそのまま出さない", () => {
  // api.js の Error は err.message にサーバー由来テキストを持つ。ここでは 400 の message を
  // そのまま連結せず esc する（HTML 実行はされない）。secret 完全除去は System UI の redact 責務だが、
  // 少なくとも HTML としては解釈されないことを確認する。
  const msg = ui.mutationErrorMessage({ status: 400, message: '<img src=x onerror=alert(1)> token=SECRET' });
  assert.doesNotMatch(msg, /<img /);
});

test("renderOperations: 全セクション（System Status / Publish table / 他画面導線）を含む", () => {
  const html = ui.renderOperations({ health: HEALTH, dashboard: DASHBOARD, reports: [rep()] }, {});
  assert.match(html, /System Status/);
  assert.match(html, /Report Publish \/ Unpublish/);
  assert.match(html, /他の操作（既存画面へ）/);
});

// ---------------------------------------------------------------------------
// Phase58 STEP10 — Deploy Readiness カード（renderDeployReadiness）
// GET /api/dashboard/operational-health の summary をそのまま表示する。
// publishable / isPublished / stale / orphan / review.status / evaluation の判定は行わない。
// ---------------------------------------------------------------------------

function opHealthPayload(summary) {
  return { operationalHealth: { ok: true, generated_at: "2026-09-11T00:00:00Z", summary } };
}

test("Case A: deploy_ready=true → Ready 表示・Alert なし", () => {
  const html = ui.renderDeployReadiness(
    opHealthPayload({ deploy_ready: true, deploy_blocked: false, published_stale: 0, published_orphan: 0, recommended_republish: 0, recommended_unpublish: 0 })
  );
  assert.match(html, /Deploy Readiness/);
  assert.match(html, /Deploy Ready/);
  assert.match(html, />Yes</);
  assert.match(html, /tone-ok">Yes/);
  assert.ok(!html.includes("dash-alert"), "Ready のときは Warning Alert を出さない");
  assert.ok(!html.includes("View Published Artifact Remediation Plan"));
});

test("Case B: deploy_ready=false / stale=1 → Warning Alert・stale件数・remediationリンク", () => {
  const html = ui.renderDeployReadiness(
    opHealthPayload({ deploy_ready: false, deploy_blocked: true, published_stale: 1, published_orphan: 0, recommended_republish: 1, recommended_unpublish: 0 })
  );
  assert.match(html, />No</);
  assert.match(html, /dash-alert tone-warn/);
  assert.match(html, /Deployment is currently blocked\./);
  assert.match(html, /Resolve stale or orphan published artifacts before running deploy-aor-web\.js\./);
  assert.match(html, /<a href="#published-artifact-health">View Published Artifact Remediation Plan<\/a>/);
  // stale 件数が表示される（Alert 内 + フィールド行）
  const staleCount = (html.match(/>1</g) || []).length;
  assert.ok(staleCount >= 1);
});

test("Case C: deploy_ready=false / orphan=1 → Danger 表示（赤）・orphan件数", () => {
  const html = ui.renderDeployReadiness(
    opHealthPayload({ deploy_ready: false, deploy_blocked: true, published_stale: 0, published_orphan: 1, recommended_republish: 0, recommended_unpublish: 1 })
  );
  assert.match(html, /tone-bad">No/); // Deploy Ready が赤
  assert.match(html, /value tone-bad">1/); // Published Orphan が赤
  assert.match(html, /dash-alert tone-bad/); // Alert 自体も赤（orphan 存在）
  assert.match(html, /Published Orphan/);
});

test("Case D: legacy summary（deploy_ready 等が無い）→ — 表示、Alert なし、Link なし", () => {
  const htmlEmptySummary = ui.renderDeployReadiness(opHealthPayload({}));
  const htmlNoOpHealth = ui.renderDeployReadiness({});
  const htmlSectionError = ui.renderDeployReadiness({ operationalHealth: { status: "error", message: "boom" } });
  for (const html of [htmlEmptySummary, htmlNoOpHealth, htmlSectionError]) {
    assert.match(html, /Deploy Readiness/);
    assert.match(html, />—</);
    assert.ok(!html.includes("dash-alert"), "legacy では Alert を出さない");
    assert.ok(!html.includes("View Published Artifact Remediation Plan"), "legacy では Link を出さない");
    assert.ok(!html.includes("undefined") && !html.includes("NaN"));
  }
});

test("Case E: stale=2 orphan=3 → 件数表示のみ（slug 一覧は出さない）", () => {
  const html = ui.renderDeployReadiness(
    opHealthPayload({ deploy_ready: false, deploy_blocked: true, published_stale: 2, published_orphan: 3, recommended_republish: 1, recommended_unpublish: 2 })
  );
  assert.match(html, /value tone-warn">2/); // Published Stale
  assert.match(html, /value tone-bad">3/); // Published Orphan
  assert.ok(!html.includes("<table"), "Deploy Readiness カードにテーブル（slug 一覧）を出さない");
  assert.ok(!html.includes("<li>"), "Deploy Readiness カードに slug の list-item も出さない");
  assert.ok(!html.includes(".example") && !html.includes(".co.jp"), "slug らしき文字列を含まない");
});

test("renderOperations: Deploy Readiness カードが最上部（他の既存カードより前）に出る", () => {
  const payload = {
    health: HEALTH,
    dashboard: DASHBOARD,
    reports: [rep()],
    remediationPlan: { ok: true, summary: { published_stale: 0, published_orphan: 0, recommended_republish: 0, recommended_unpublish: 0 }, items: [] },
    operationalHealth: { ok: true, summary: { deploy_ready: true, deploy_blocked: false, published_stale: 0, published_orphan: 0, recommended_republish: 0, recommended_unpublish: 0 } },
  };
  const html = ui.renderOperations(payload, {});
  const iDeploy = html.indexOf("Deploy Readiness");
  const iSystem = html.indexOf("System Status");
  const iRemSummary = html.indexOf("Published Artifact Remediation Summary");
  assert.ok(html.startsWith('<section class="card"><h2>Deploy Readiness</h2>'), "Deploy Readiness セクションが HTML の先頭にある");
  assert.ok(iDeploy < iSystem, "Deploy Readiness は System Status より前");
  assert.ok(iDeploy < iRemSummary, "Deploy Readiness は既存 Remediation Summary より前");
});

test("renderOperations: operationalHealth 未取得（legacy）でも他セクションは壊れない", () => {
  const html = ui.renderOperations({ health: HEALTH, dashboard: DASHBOARD, reports: [rep()] }, {});
  assert.match(html, /Deploy Readiness/);
  assert.match(html, /System Status/);
  assert.match(html, /Report Publish \/ Unpublish/);
  assert.ok(!html.includes("undefined") && !html.includes("NaN"));
});
