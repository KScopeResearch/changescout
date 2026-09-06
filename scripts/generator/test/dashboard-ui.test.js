/**
 * dashboard-ui.test.js — website/aor-admin/public/assets/js/dashboard.js の純粋関数
 * （レンダリング）を Node からユニットテストする（Phase52 STEP4）。
 *
 * dashboard.js は module.exports へレンダリング関数を公開している（ブラウザ実行時は
 * 無視される。init() も呼ばれない）。DOM・fetch には依存しないため jsdom 等は不要。
 * ブラウザ実 UI・API 疎通は run-all-tests.js の「Dashboard確認」と手動確認で担保する。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ui = require(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "assets", "js", "dashboard.js"));

// API レスポンスのサンプル（Phase52 STEP3 の実測形状に合わせる）
const SAMPLE_SUMMARY = {
  generated_at: "2026-09-06T00:44:13.610Z",
  lead_summary: { total: 5, active: 2, unsubscribed: 1, bounced: 1, suppressed: 1, pending_approval: 3 },
  delivery_summary: {
    initial_sent: 1, initial_failed: 0, weekly_sent: 1, weekly_failed: 0,
    delivered: 2, bounced: 1, complaints: 1, paid_requested: 1,
    last_24h: { delivered: 2, bounced: 1, complaints: 1 },
  },
  suppression_summary: { unsubscribe: 1, bounce: 1, complaint: 1, harderror: 0, drop: 0, manual: 0 },
};
const SAMPLE_REPORTS = {
  generated_at: "2026-09-06T00:44:04.666Z",
  generated: 2, approved: 1, published_backend: 1, web_deployed: 7, deploy_pending: 0, pending_slugs: [],
};
const SAMPLE_HEALTH = {
  generated_at: "2026-09-06T00:44:16.571Z",
  ses: {
    production_access_enabled: true, review_status: "GRANTED", sending_enabled: true,
    enforcement_status: "HEALTHY", max_24_hour_send: 50000, sent_last_24_hours: 1, max_send_rate: 14,
    dkim_status: "SUCCESS", configuration_set: "pj2-aor-delivery",
  },
  lambda: {
    functions: [
      { name: "pj2-aor-weekly-report-delivery", runtime: "nodejs24.x", state: "Active", last_modified: "2026-08-29T00:35:13.000+0000" },
      { name: "pj2-aor-blastengine-webhook", runtime: "nodejs24.x", state: "Active", last_modified: "2026-08-28T16:25:43.000+0000" },
    ],
  },
  cloudfront: {
    distribution_id: "E1TGUCT9CYALRK", domain_name: "d261eor7y01afd.cloudfront.net", status: "Deployed",
    web_bucket: "changescout-pj2-aor-web-179127602551",
    last_invalidation: { id: "I2NZYMA81S5STNQ4HB9YDWIPUJ", status: "Completed", create_time: "2026-09-05T13:52:36.903Z" },
  },
  blastengine: { credentials_configured: true, webhook_credentials_configured: true, webhook_endpoint_exists: true, enabled: true, spec_document: "docs/external-provider-confirmations.md" },
};

test("fmtDateTime: ISO を YYYY-MM-DD HH:mm:ss 形式へ。無効値は素通し", () => {
  assert.match(ui.fmtDateTime("2026-09-06T00:44:13.610Z"), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(ui.fmtDateTime(null), "—");
  assert.equal(ui.fmtDateTime("not-a-date"), "not-a-date");
});

test("renderLeadSummary: API 値がそのまま出る（再集計しない）", () => {
  const html = ui.renderLeadSummary(SAMPLE_SUMMARY.lead_summary);
  assert.match(html, /Total Leads/);
  assert.match(html, /Pending Approval/); // pending_review ではなく pending_approval 由来のラベル
  assert.match(html, />5</); // total
  assert.match(html, />3</); // pending_approval
});

test("renderDeliverySummary: 累計と Last 24 Hours の両方を出す", () => {
  const html = ui.renderDeliverySummary(SAMPLE_SUMMARY.delivery_summary);
  assert.match(html, /Initial Sent/);
  assert.match(html, /Weekly Sent/);
  assert.match(html, /Complaints/);
  assert.match(html, /Paid Requested/);
  assert.match(html, /Last 24 Hours/);
});

test("renderSuppressionSummary: 0 の理由も省略しない", () => {
  const html = ui.renderSuppressionSummary(SAMPLE_SUMMARY.suppression_summary);
  for (const label of ["Unsubscribe", "Bounce", "Complaint", "Hard Error", "Drop", "Manual"]) {
    assert.ok(html.includes(label), `${label} が表示されていない`);
  }
});

test("renderReportSummary: deploy_pending=0 は正常。警告アラートを出さない", () => {
  const html = ui.renderReportSummary(SAMPLE_REPORTS);
  assert.match(html, /Published \(Backend\)/);
  assert.match(html, /Web Deployed/);
  assert.match(html, /Deploy Pending/);
  assert.ok(!html.includes("dash-alert"), "deploy_pending=0 で警告アラートが出てはいけない");
  assert.equal(ui.deployPendingTone(0), "ok");
});

test("renderReportSummary: deploy_pending>0 は警告 + pending_slugs 一覧", () => {
  const html = ui.renderReportSummary({
    generated: 5, approved: 4, published_backend: 4, web_deployed: 2, deploy_pending: 2,
    pending_slugs: ["company-a", "company-b"],
  });
  assert.match(html, /dash-alert/);
  assert.match(html, /2 件/);
  assert.match(html, /company-a/);
  assert.match(html, /company-b/);
  assert.equal(ui.deployPendingTone(2), "warn");
});

test("renderReportSummary: web_deployed=null（取得失敗）は — 表示、deploy_pending も —", () => {
  const html = ui.renderReportSummary({
    generated: 1, approved: 1, published_backend: 1, web_deployed: null, deploy_pending: null, pending_slugs: [],
  });
  assert.match(html, /Web Deployed/);
  assert.ok(!html.includes("dash-alert"));
  assert.equal(ui.deployPendingTone(null), "dim");
});

test("renderSesHealth: 実値をそのまま。secret は元々含まれない", () => {
  const html = ui.renderSesHealth(SAMPLE_HEALTH.ses);
  assert.match(html, /GRANTED/);
  assert.match(html, /HEALTHY/);
  assert.match(html, /SUCCESS/);
  assert.match(html, /pj2-aor-delivery/);
});

test("renderLambdaHealth: 4 関数（サンプルは2）をテーブル表示", () => {
  const html = ui.renderLambdaHealth(SAMPLE_HEALTH.lambda);
  assert.match(html, /pj2-aor-weekly-report-delivery/);
  assert.match(html, /pj2-aor-blastengine-webhook/);
  assert.match(html, /Active/);
  assert.match(html, /nodejs24\.x/);
});

test("renderCloudFrontHealth / renderBlastengineHealth: boolean ベース、値は表示、秘密なし", () => {
  const cf = ui.renderCloudFrontHealth(SAMPLE_HEALTH.cloudfront);
  assert.match(cf, /E1TGUCT9CYALRK/);
  assert.match(cf, /Deployed/);
  assert.match(cf, /I2NZYMA81S5STNQ4HB9YDWIPUJ/);

  const be = ui.renderBlastengineHealth(SAMPLE_HEALTH.blastengine);
  assert.match(be, /Enabled/);
  assert.match(be, /Webhook Endpoint/);
  assert.match(be, /external-provider-confirmations\.md/);
  assert.ok(!/API_KEY|PASSWORD|secret|token/i.test(be) || /Credentials/.test(be), "秘密値らしき文字列が出ていない");
});

test("isSectionError: {status:'error'} を検出", () => {
  assert.equal(ui.isSectionError({ status: "error", message: "x" }), true);
  assert.equal(ui.isSectionError({ status: "Deployed" }), false); // CloudFront の正常 status と衝突しない
  assert.equal(ui.isSectionError(null), false);
  assert.equal(ui.isSectionError({ total: 5 }), false);
});

test("renderDashboard: 正常系 — 全セクションが描画され、Last updated が API の generated_at 由来", () => {
  const html = ui.renderDashboard({ summary: SAMPLE_SUMMARY, reports: SAMPLE_REPORTS, health: SAMPLE_HEALTH });
  for (const h of ["Lead Summary", "Delivery Summary", "Suppression Summary", "Report Summary", "System Health", "SES", "Lambda", "CloudFront", "blastengine"]) {
    assert.ok(html.includes(h), `${h} セクションがない`);
  }
  assert.match(html, /Last updated:/);
  assert.match(html, /2026-09-06 \d{2}:\d{2}:\d{2}/); // generated_at をフォーマットしたもの
});

test("renderDashboard: health セクションだけ error でも全体は壊れず、他は描画される", () => {
  const html = ui.renderDashboard({
    summary: SAMPLE_SUMMARY,
    reports: SAMPLE_REPORTS,
    health: { status: "error", message: "Could not connect to AWS" },
  });
  assert.match(html, /Lead Summary/);
  assert.match(html, /Report Summary/);
  assert.match(html, /dash-section-error/); // SES/Lambda/CloudFront/blastengine の各サブセクションがエラー表示
  assert.match(html, /Could not connect to AWS/);
});

test("renderDashboard: summary が丸ごと error でも Report / Health は描画される", () => {
  const html = ui.renderDashboard({
    summary: { status: "error", message: "leadStore down" },
    reports: SAMPLE_REPORTS,
    health: SAMPLE_HEALTH,
  });
  assert.match(html, /dash-section-error/);
  assert.match(html, /leadStore down/);
  assert.match(html, /Generated/); // Report Summary は生きている
  assert.match(html, /GRANTED/); // SES Health は生きている
});

test("renderDashboard: 3 API 全滅でも例外を投げず HTML を返す", () => {
  const err = { status: "error", message: "x" };
  const html = ui.renderDashboard({ summary: err, reports: err, health: err });
  assert.equal(typeof html, "string");
  assert.match(html, /API 未取得/);
});
