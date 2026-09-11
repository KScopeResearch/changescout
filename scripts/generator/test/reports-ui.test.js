/**
 * reports-ui.test.js — website/aor-admin/public/assets/js/reports.js（Phase52 STEP8）。
 * dashboard-ui / leads-ui / deliveries-ui / suppression-ui と同じ方針（module.exports、DOM 非依存）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ui = require(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "assets", "js", "reports.js"));

function rep(o = {}) {
  return Object.assign(
    {
      id: "example.com",
      company_name: "Example Inc",
      review_status: "approved",
      evaluation_status: "PASS",
      evaluation_score: 91,
      evaluation_grade: "A",
      publishable: true,
      published: true,
    },
    o
  );
}

// GET /api/dashboard/reports の実測形状
const SUMMARY = {
  generated_at: "2026-09-06T00:00:00Z",
  generated: 3,
  approved: 2,
  published_backend: 2,
  web_deployed: 1,
  deploy_pending: 1,
  pending_slugs: ["beta.co.jp"],
};

const REPORTS = [
  rep({ id: "example.com", company_name: "Example Inc", review_status: "approved", publishable: true, published: true }),
  rep({ id: "beta.co.jp", company_name: "Beta LLC", review_status: "needs_revision", evaluation_status: "REVIEW", publishable: false, published: true }),
  rep({ id: "gamma.jp", company_name: "Gamma", review_status: "pending_review", evaluation_status: "FAIL", publishable: false, published: false }),
];

test("fmtDateTime: ISO→整形、null→—", () => {
  assert.match(ui.fmtDateTime("2026-09-06T00:00:00Z"), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(ui.fmtDateTime(null), "—");
});

test("renderOverview: Backend 値をそのまま。deploy_pending>0 で pending_slugs を一覧表示", () => {
  const html = ui.renderOverview(SUMMARY);
  assert.match(html, /Generated/);
  assert.match(html, /Published \(Backend\)/);
  assert.match(html, /Web Deployed/);
  assert.match(html, /Deploy Pending/);
  assert.match(html, /dash-alert/);
  assert.match(html, /beta\.co\.jp/); // pending_slugs をそのまま出す
  assert.match(ui.renderOverview({ status: "error", message: "down" }), /dash-section-error/);
});

test("renderOverview: deploy_pending=0 は警告を出さない / web_deployed=null は — 表示", () => {
  assert.doesNotMatch(ui.renderOverview({ generated: 1, approved: 1, published_backend: 1, web_deployed: 3, deploy_pending: 0, pending_slugs: [] }), /dash-alert/);
  const nullWeb = ui.renderOverview({ generated: 1, approved: 1, published_backend: 1, web_deployed: null, deploy_pending: null, pending_slugs: [] });
  assert.doesNotMatch(nullWeb, /dash-alert/);
});

test("deployStateOf: Backend の pending_slugs / web_deployed を使うだけ（frontend 差集合なし）", () => {
  assert.equal(ui.deployStateOf(rep({ id: "beta.co.jp", published: true }), SUMMARY), "pending");
  assert.equal(ui.deployStateOf(rep({ id: "example.com", published: true }), SUMMARY), "deployed");
  assert.equal(ui.deployStateOf(rep({ id: "example.com", published: true }), { ...SUMMARY, web_deployed: null }), "unknown");
  assert.equal(ui.deployStateOf(rep({ id: "example.com", published: true }), { status: "error", message: "x" }), "unknown");
  // backend 未公開のレポートは Web デプロイ対象外
  assert.equal(ui.deployStateOf(rep({ id: "example.com", published: false }), SUMMARY), "not_published");
});

test("matchesSearch: id / company_name 部分一致（大小無視）", () => {
  const r = rep({ id: "Example.com", company_name: "Beta LLC" });
  assert.equal(ui.matchesSearch(r, ""), true);
  assert.equal(ui.matchesSearch(r, "example"), true);
  assert.equal(ui.matchesSearch(r, "beta"), true);
  assert.equal(ui.matchesSearch(r, "zzz"), false);
});

test("matchesFilters: review / publishable / published / deploy をそれぞれ厳密に", () => {
  const r = rep({ id: "beta.co.jp", review_status: "needs_revision", publishable: false, published: true });
  assert.equal(ui.matchesFilters(r, { review: "all", publishable: "all", published: "all", deploy: "all" }, SUMMARY), true);
  assert.equal(ui.matchesFilters(r, { review: "needs_revision" }, SUMMARY), true);
  assert.equal(ui.matchesFilters(r, { review: "approved" }, SUMMARY), false);
  assert.equal(ui.matchesFilters(r, { publishable: "yes" }, SUMMARY), false);
  assert.equal(ui.matchesFilters(r, { publishable: "no" }, SUMMARY), true);
  assert.equal(ui.matchesFilters(r, { published: "no" }, SUMMARY), false);
  assert.equal(ui.matchesFilters(r, { deploy: "pending" }, SUMMARY), true);
  assert.equal(ui.matchesFilters(r, { deploy: "deployed" }, SUMMARY), false);
});

test("renderTableRegion: 全件 / 検索 / filter / 2種の空状態", () => {
  const all = ui.renderTableRegion(REPORTS, SUMMARY, { search: "", review: "all", publishable: "all", published: "all", deploy: "all" }, {});
  assert.equal(all.total, 3);
  assert.equal(all.shown, 3);
  assert.match(all.html, /<th>web deploy<\/th>/);
  assert.match(all.html, /Beta LLC/);

  const searched = ui.renderTableRegion(REPORTS, SUMMARY, { search: "gamma" }, {});
  assert.equal(searched.shown, 1);

  const filtered = ui.renderTableRegion(REPORTS, SUMMARY, { deploy: "pending" }, {});
  assert.equal(filtered.shown, 1);
  assert.match(filtered.html, /Beta LLC/);

  assert.match(ui.renderTableRegion([], SUMMARY, {}, {}).html, /レポートはありません/);
  const noMatch = ui.renderTableRegion(REPORTS, SUMMARY, { search: "zzz" }, {});
  assert.match(noMatch.html, /条件に一致するレポートはありません/);
  assert.equal(noMatch.total, 3);
});

test("renderTableRegion: expandedId + detailCache 未取得 → 詳細読み込み中プレースホルダ", () => {
  const r = ui.renderTableRegion(REPORTS, SUMMARY, { expandedId: "example.com", search: "", review: "all", publishable: "all", published: "all", deploy: "all" }, {});
  assert.match(r.html, /report-detail-row/);
  assert.match(r.html, /詳細を読み込み中/);
});

test("detailHtml: 詳細レスポンスを表示。URL は生成しないと明記。metaTable に report.meta", () => {
  const detail = {
    id: "example.com",
    report: {
      meta: { schema_version: "2.4", generated_at: "2026-09-06T06:11:34.456Z", pipeline_version: "phase1-generator-v0.3-llm" },
      company_profile: { name: "Example Inc", domain: "example.com", industry_label: "中小企業" },
      evaluation: { status: "PASS", score: 91, grade: "A", improvements: ["human_reviewが未着手です"] },
    },
    review: { status: "approved", reviewer: "ops-1", reviewed_at: "2026-09-06T07:00:00Z", comments: [{}, {}], fixes: [{ resolved: false }, { resolved: true }], history: [{ at: "t", actor: "ops-1", action: "approved", to_status: "approved" }] },
    publishable: true,
    publishable_reasons: [],
    published: true,
  };
  const html = ui.detailHtml(rep({ id: "example.com" }), detail, SUMMARY);
  assert.match(html, /2026-09-06T06:11:34\.456Z/); // generated_at 原文
  assert.match(html, /phase1-generator-v0\.3-llm/);
  assert.match(html, /ops-1/);
  assert.match(html, /1 \/ 2/); // unresolved fixes / total
  assert.match(html, /URL は frontend で生成しません|Preview \/ Published URL/);
  assert.match(html, /Deployed/); // example.com は pending_slugs に無い

  // error / loading
  assert.match(ui.detailHtml(rep(), { error: "HTTP 500" }, SUMMARY), /詳細を読み込めませんでした: HTTP 500/);
  assert.match(ui.detailHtml(rep(), null, SUMMARY), /詳細を読み込み中/);
});

test("countText: 全件・部分・0", () => {
  assert.equal(ui.countText(3, 3), "3 件");
  assert.equal(ui.countText(1, 3), "1 / 3 件表示");
  assert.equal(ui.countText(0, 0), "0 件");
});

test("renderControls: 検索欄・4 フィルタ群・件数、search 値をエスケープ", () => {
  const html = ui.renderControls({ search: "<b>x</b>", review: "approved", publishable: "yes", published: "no", deploy: "pending" });
  assert.match(html, /id="reports-search"/);
  assert.match(html, /data-review="approved"/);
  assert.match(html, /data-publishable="yes"/);
  assert.match(html, /data-published="no"/);
  assert.match(html, /data-deploy="pending"/);
  assert.match(html, /id="reports-table-region"/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
});

test("renderPage: Report Summary + Reports セクション", () => {
  const html = ui.renderPage({ summary: SUMMARY }, { review: "all", publishable: "all", published: "all", deploy: "all" });
  assert.match(html, /Report Summary/);
  assert.match(html, />Reports</);
});

test("XSS: company_name / id / meta / pending_slugs / evaluation の悪性文字列をエスケープ", () => {
  const evil = "<script>alert(1)</script>";
  const badSummary = { generated: 1, approved: 1, published_backend: 1, web_deployed: 0, deploy_pending: 1, pending_slugs: [evil] };
  const overview = ui.renderOverview(badSummary);
  assert.doesNotMatch(overview, /<script>alert\(1\)<\/script>/);
  assert.match(overview, /&lt;script&gt;/);

  const r = rep({ id: evil, company_name: '"><img src=x onerror=alert(1)>', evaluation_status: evil, evaluation_grade: evil });
  const row = ui.reportRow(r, SUMMARY);
  assert.doesNotMatch(row, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(row, /<img /);

  const detail = ui.detailHtml(r, {
    id: evil,
    report: { meta: { note: evil }, company_profile: { name: evil, domain: evil }, evaluation: { status: evil, improvements: [evil] } },
    review: { status: "approved", reviewer: evil, history: [{ at: "t", actor: evil, action: evil }], fixes: [], comments: [] },
    publishable: false,
    publishable_reasons: [evil],
    published: false,
  }, SUMMARY);
  assert.doesNotMatch(detail, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(detail, /<img /);
  assert.match(detail, /&lt;script&gt;/);

  assert.doesNotMatch(ui.metaTable({ k: evil }), /<script>alert\(1\)<\/script>/);
});

// ===========================================================================
// Phase59 STEP7 — Published Artifact Status / Audit Summary
// AdminApi.getDashboardOperationalHealth() の生レスポンスを、再計算せずそのまま表示する。
// ===========================================================================

function opHealth(summaryOverrides, status) {
  return {
    ok: true,
    generated_at: "2026-09-11T00:00:00Z",
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
        approved_reports: 9,
        published_reports: 9,
      },
      summaryOverrides || {}
    ),
    checks: [],
  };
}

test("Case A: Ready（stale/orphan=0・status=success）→ Banner緑・Audit Summary全項目success", () => {
  const data = opHealth();
  const statusHtml = ui.renderPublishedArtifactStatus(data);
  assert.match(statusHtml, /dash-alert tone-good">All published artifacts are synchronized\./);

  const summaryHtml = ui.renderPublishedArtifactAuditSummary(data);
  assert.match(summaryHtml, /<td>Generated reports reviewed<\/td><td><span class="status-pill status-approved">success<\/span><\/td>/);
  assert.match(summaryHtml, /<td>Approved reports published<\/td><td><span class="status-pill status-approved">success<\/span><\/td>/);
  assert.match(summaryHtml, /<td>Published artifacts synchronized<\/td><td><span class="status-pill status-approved">success<\/span><\/td>/);
  assert.match(summaryHtml, /<td>Deploy reconciliation clean<\/td><td><span class="status-pill status-approved">success<\/span><\/td>/);
});

test("Case B: Warning（published_stale>0・status=warning）→ Banner黄・synchronized/reconciliation行がwarning", () => {
  const data = opHealth({ deploy_ready: false, deploy_blocked: true, published_stale: 1, recommended_republish: 1 }, "warning");
  const statusHtml = ui.renderPublishedArtifactStatus(data);
  assert.match(statusHtml, /dash-alert tone-warn">Published artifacts require remediation before deployment\./);

  const summaryHtml = ui.renderPublishedArtifactAuditSummary(data);
  assert.match(summaryHtml, /<td>Published artifacts synchronized<\/td><td><span class="status-pill status-needs_revision">warning<\/span><\/td>/);
  assert.match(summaryHtml, /<td>Deploy reconciliation clean<\/td><td><span class="status-pill status-needs_revision">warning<\/span><\/td>/);
});

test("Case C: Danger（published_orphan>0・status=danger）→ Banner赤・synchronized/reconciliation行がdanger", () => {
  const data = opHealth({ deploy_ready: false, deploy_blocked: true, published_orphan: 1, recommended_unpublish: 1 }, "danger");
  const statusHtml = ui.renderPublishedArtifactStatus(data);
  assert.match(statusHtml, /dash-alert tone-bad">Orphan published artifacts detected\./);

  const summaryHtml = ui.renderPublishedArtifactAuditSummary(data);
  assert.match(summaryHtml, /<td>Published artifacts synchronized<\/td><td><span class="status-pill status-rejected">danger<\/span><\/td>/);
  assert.match(summaryHtml, /<td>Deploy reconciliation clean<\/td><td><span class="status-pill status-rejected">danger<\/span><\/td>/);
});

test("Case D: Legacy（summary/generated_reports/status が無い）→ Published Artifact Status カード非表示", () => {
  assert.equal(ui.renderPublishedArtifactStatus(undefined), "");
  assert.equal(ui.renderPublishedArtifactStatus(null), "");
  assert.equal(ui.renderPublishedArtifactStatus({}), "");
  assert.equal(ui.renderPublishedArtifactStatus({ ok: true, status: "success", summary: { deploy_ready: true } }), "", "generated_reports 等が無ければ legacy");
  assert.equal(ui.renderPublishedArtifactStatus({ ok: true, summary: opHealth().summary }), "", "status が無ければ legacy");
  assert.equal(ui.renderPublishedArtifactStatus({ status: "error", message: "boom" }), "");

  assert.equal(ui.renderPublishedArtifactAuditSummary(undefined), "");
  assert.equal(ui.renderPublishedArtifactAuditSummary({}), "");
  assert.equal(ui.renderPublishedArtifactAuditSummary({ ok: true, status: "success", summary: { deploy_ready: true } }), "");

  // Reports 一覧自体は operationalHealth 欠落でも従来通り描画される。
  const html = ui.renderPage({ summary: SUMMARY }, { review: "all", publishable: "all", published: "all", deploy: "all" });
  assert.match(html, /Report Summary/);
  assert.match(html, />Reports</);
  assert.ok(!html.includes("Published Artifact Status"));
  assert.ok(!html.includes("Published Artifact Audit Summary"));
});

test("Case E: Summary数値表示 — Generated/Approved/Published Reports と Stale/Orphan がそのまま出る（再計算なし）", () => {
  const data = opHealth({ generated_reports: 9, approved_reports: 5, published_reports: 4, published_stale: 0, published_orphan: 0 });
  const html = ui.renderPublishedArtifactStatus(data);
  assert.match(html, /dash-metric-value">9<\/div><div class="dash-metric-label">Generated Reports/);
  assert.match(html, /dash-metric-value">5<\/div><div class="dash-metric-label">Approved Reports/);
  assert.match(html, /dash-metric-value">4<\/div><div class="dash-metric-label">Published Reports/);
  assert.match(html, /dash-metric-value">0<\/div><div class="dash-metric-label">Published Stale/);
  assert.match(html, /dash-metric-value">0<\/div><div class="dash-metric-label">Published Orphan/);
});

test("Case F: Banner切替 — success/warning/danger の3状態で文言とtoneクラスが切り替わる", () => {
  const ready = ui.renderPublishedArtifactStatus(opHealth());
  const warn = ui.renderPublishedArtifactStatus(opHealth({ published_stale: 1 }, "warning"));
  const danger = ui.renderPublishedArtifactStatus(opHealth({ published_orphan: 1 }, "danger"));
  assert.match(ready, /tone-good/);
  assert.match(warn, /tone-warn/);
  assert.match(danger, /tone-bad/);
  assert.ok(!ready.includes("tone-warn") && !ready.includes("tone-bad"));
  assert.ok(!warn.includes("tone-good") && !warn.includes("tone-bad"));
  assert.ok(!danger.includes("tone-good") && !danger.includes("tone-warn"));
});

test("Case G: Audit Summary判定 — generated!=approved / approved!=published を個別に検出（独自判定なし・比較のみ）", () => {
  const genVsApproved = ui.renderPublishedArtifactAuditSummary(opHealth({ generated_reports: 9, approved_reports: 5, published_reports: 5 }));
  assert.match(genVsApproved, /<td>Generated reports reviewed<\/td><td><span class="status-pill status-needs_revision">warning<\/span><\/td>/);
  assert.match(genVsApproved, /<td>Approved reports published<\/td><td><span class="status-pill status-approved">success<\/span><\/td>/);

  const approvedVsPublished = ui.renderPublishedArtifactAuditSummary(opHealth({ generated_reports: 9, approved_reports: 5, published_reports: 4 }));
  assert.match(approvedVsPublished, /<td>Generated reports reviewed<\/td><td><span class="status-pill status-needs_revision">warning<\/span><\/td>/);
  assert.match(approvedVsPublished, /<td>Approved reports published<\/td><td><span class="status-pill status-needs_revision">warning<\/span><\/td>/);
});

test("Case H: undefined / NaN 表示禁止 — legacy・0値いずれのケースでも undefined/NaN 文字列を出さない", () => {
  const legacy = ui.renderPage({ summary: SUMMARY }, { review: "all", publishable: "all", published: "all", deploy: "all" });
  assert.ok(!legacy.includes("undefined") && !legacy.includes("NaN"));

  const withAudit = ui.renderPage(
    { summary: SUMMARY, operationalHealth: opHealth({ generated_reports: 9, approved_reports: 5, published_reports: 4 }) },
    { review: "all", publishable: "all", published: "all", deploy: "all" }
  );
  assert.ok(!withAudit.includes("undefined") && !withAudit.includes("NaN"));
  assert.match(withAudit, /Published Artifact Status/);
  assert.match(withAudit, /Published Artifact Audit Summary/);
});
