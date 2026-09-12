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

// ---------------------------------------------------------------------------
// Phase58 STEP6 — Published Stale / Published Orphan の表示（API 値をそのまま出す）
// ---------------------------------------------------------------------------

test("Case A: published_stale=0 / published_orphan=0 は 0 を表示し、警告アラートを出さない", () => {
  const html = ui.renderReportSummary({
    generated: 1, approved: 1, published_backend: 1,
    published_stale: 0, published_orphan: 0, stale_slugs: [], orphan_slugs: [],
    web_deployed: 1, deploy_pending: 0, pending_slugs: [],
  });
  assert.match(html, /Published Stale/);
  assert.match(html, /Published Orphan/);
  // 既存 metric も引き続き表示
  assert.match(html, /Generated/);
  assert.match(html, /Approved/);
  assert.match(html, /Published \(Backend\)/);
  assert.ok(!html.includes("dash-alert"), "stale/orphan=0 で警告アラートは出さない");
});

test("Case B: published_stale=1 は警告 + stale_slugs 一覧、orphan は 0", () => {
  const html = ui.renderReportSummary({
    generated: 3, approved: 2, published_backend: 2,
    published_stale: 1, published_orphan: 0, stale_slugs: ["example.com"], orphan_slugs: [],
    web_deployed: null, deploy_pending: null, pending_slugs: [],
  });
  assert.match(html, /Published Stale/);
  assert.match(html, /dash-alert/);
  assert.match(html, /Published Stale/);
  assert.match(html, /1 件/);
  assert.match(html, /example\.com/);
  // orphan のアラートは出ない
  assert.ok(!html.includes("Published Orphan） です") && !/Orphan.*orphan\.example/.test(html));
});

test("Case C: published_orphan=1 は警告 + orphan_slugs 一覧、stale は 0", () => {
  const html = ui.renderReportSummary({
    generated: 2, approved: 2, published_backend: 3,
    published_stale: 0, published_orphan: 1, stale_slugs: [], orphan_slugs: ["orphan.example"],
    web_deployed: null, deploy_pending: null, pending_slugs: [],
  });
  assert.match(html, /Published Orphan/);
  assert.match(html, /dash-alert/);
  assert.match(html, /1 件/);
  assert.match(html, /orphan\.example/);
  // stale のスラッグ列挙は無い
  assert.ok(!html.includes("<li>example.com</li>"));
});

test("Case D: stale ×2 / orphan ×1 が正しくカウント・列挙され取り違えない", () => {
  const html = ui.renderReportSummary({
    generated: 5, approved: 3, published_backend: 4,
    published_stale: 2, published_orphan: 1,
    stale_slugs: ["a.example", "b.example"], orphan_slugs: ["c.example"],
    web_deployed: null, deploy_pending: null, pending_slugs: [],
  });
  assert.match(html, /2 件/);
  assert.match(html, /1 件/);
  assert.match(html, /<li>a\.example<\/li>/);
  assert.match(html, /<li>b\.example<\/li>/);
  assert.match(html, /<li>c\.example<\/li>/);
  // stale アラートに c.example が混ざらない / orphan アラートに a.example が混ざらない
  const staleAlert = html.slice(html.indexOf("Published Stale"), html.indexOf("Published Orphan", html.indexOf("Published Stale")));
  assert.ok(!staleAlert.includes("c.example"), "stale 一覧に orphan slug が混入している");
});

test("Case E: 新フィールドを持たない legacy summary でも undefined/NaN/null を誤表示しない", () => {
  const html = ui.renderReportSummary({
    generated: 2, approved: 1, published_backend: 1, web_deployed: 7, deploy_pending: 0, pending_slugs: [],
  });
  assert.match(html, /Published Stale/);
  assert.match(html, /Published Orphan/);
  assert.ok(!html.includes("undefined"), "undefined を画面に出さない");
  assert.ok(!html.includes("NaN"), "NaN を画面に出さない");
  // legacy（未提供）は "—" で表示、警告アラートは出さない
  assert.ok(!/Published Stale.*dash-alert/s.test(html) || !html.includes("dash-alert"));
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

// ---------------------------------------------------------------------------
// Phase59 — renderOperationalHealthDetail（stale / orphan の対象会社テーブル・表示専用）
// API（operational_health）の値をそのまま描画する。UI は state / publishable /
// review / freshness / evaluation を一切再判定しない。
// ---------------------------------------------------------------------------

test("OpHealth Case A: healthy（items 空）は Empty State。テーブルを出さない", () => {
  const html = ui.renderOperationalHealthDetail({ items: [], stale_count: 0, orphan_count: 0 });
  assert.match(html, /No stale or orphan published artifacts detected\./);
  assert.match(html, /dash-alert tone-good/);
  assert.ok(!html.includes("<table"), "Empty State でテーブルを出してはいけない");
  assert.ok(!html.includes("undefined") && !html.includes("NaN"));
});

test("OpHealth Case B: published_stale 1件 → テーブル1行 / tone-warn / Published Stale / Published At", () => {
  const html = ui.renderOperationalHealthDetail({
    items: [
      { slug: "example.com", company_name: "Example Inc", state: "published_stale", reason: "freshness fail", published_at: "2026-09-10T12:37:06.000Z" },
    ],
    stale_count: 1,
    orphan_count: 0,
  });
  assert.match(html, /Review these published artifacts before the next deployment\./);
  assert.match(html, /<table[^>]*class="dash-table"/);
  assert.match(html, /🟡 Published Stale/);
  assert.match(html, /tone-warn/);
  assert.match(html, /Example Inc/);
  assert.match(html, /example\.com/);
  assert.match(html, /freshness fail/);
  assert.match(html, /2026-09-10/); // YYYY-MM-DD（時刻部分は出さない）
  assert.ok(!html.includes("12:37:06"), "日付のみ表示（時刻は出さない）");
  // 1 行だけ
  assert.equal((html.match(/<tr>/g) || []).length, 2, "ヘッダ1 + データ1 = 2");
});

test("OpHealth Case C: published_orphan 1件 → tone-bad / Published Orphan / published_at 無しは —", () => {
  const html = ui.renderOperationalHealthDetail({
    items: [{ slug: "orphan.example", company_name: null, state: "published_orphan", reason: "current report/review not found", published_at: null }],
    stale_count: 0,
    orphan_count: 1,
  });
  assert.match(html, /🔴 Published Orphan/);
  assert.match(html, /tone-bad/);
  assert.match(html, /orphan\.example/);
  assert.match(html, /<td>—<\/td>/); // published_at null → —
});

test("OpHealth Case D: stale ×2 + orphan ×1 → 3行 / 順序維持 / slug・company・reason 取り違えなし", () => {
  const html = ui.renderOperationalHealthDetail({
    items: [
      { slug: "a.example", company_name: "Alpha", state: "published_stale", reason: "review not approved", published_at: "2026-01-02T03:04:05.000Z" },
      { slug: "b.example", company_name: "Bravo", state: "published_stale", reason: "evaluation FAIL", published_at: null },
      { slug: "c.example", company_name: null, state: "published_orphan", reason: "current report/review not found", published_at: null },
    ],
    stale_count: 2,
    orphan_count: 1,
  });
  assert.equal((html.match(/<tr>/g) || []).length, 4, "ヘッダ1 + データ3");
  // 順序: a → b → c
  const iA = html.indexOf("a.example");
  const iB = html.indexOf("b.example");
  const iC = html.indexOf("c.example");
  assert.ok(iA < iB && iB < iC, "行の順序が API の items 順どおり");
  // reason が取り違えられていない
  assert.ok(html.indexOf("review not approved") < html.indexOf("evaluation FAIL"));
  // Alpha の行に Bravo が混ざらない（各行を分離して確認）
  const rowA = html.slice(html.indexOf("<td>Alpha"), html.indexOf("<td>Bravo"));
  assert.ok(!rowA.includes("b.example") && !rowA.includes("evaluation FAIL"));
});

test("OpHealth Case E: company_name が無い行は Company 列に slug を表示", () => {
  const html = ui.renderOperationalHealthDetail({
    items: [{ slug: "no-name.example", company_name: null, state: "published_stale", reason: "x", published_at: null }],
    stale_count: 1,
    orphan_count: 0,
  });
  // Company セル = slug
  assert.match(html, /<td>no-name\.example<\/td>\s*<td>no-name\.example<\/td>/);
});

test("OpHealth Case F: legacy payload（operational_health なし）はセクション非表示・エラーなし", () => {
  assert.equal(ui.renderOperationalHealthDetail(undefined), "");
  assert.equal(ui.renderOperationalHealthDetail(null), "");
  // renderDashboard 全体でも、operationalHealth を渡さなければ Operational Health Detail は出ない
  const html = ui.renderDashboard({ summary: SAMPLE_SUMMARY, reports: SAMPLE_REPORTS, health: SAMPLE_HEALTH });
  assert.ok(!html.includes("Operational Health Detail"), "legacy 時はセクション自体を描画しない");
  assert.ok(!html.includes("undefined") && !html.includes("NaN"));
  // 既存セクションは正常
  assert.match(html, /Report Summary/);
  assert.match(html, /System Health/);
});

test("OpHealth: セクションエラー（{status:'error'}）は section error として表示（テーブルは出さない）", () => {
  const html = ui.renderOperationalHealthDetail({ status: "error", message: "S3 outage" });
  assert.match(html, /dash-section-error/);
  assert.ok(!html.includes("<table"));
});

test("renderDashboard: operationalHealth（API レスポンス形状）を渡すと Operational Health Detail セクションが出る", () => {
  const html = ui.renderDashboard({
    summary: SAMPLE_SUMMARY,
    reports: SAMPLE_REPORTS,
    health: SAMPLE_HEALTH,
    operationalHealth: {
      generated_at: "2026-09-11T00:00:00.000Z",
      operational_health: {
        items: [{ slug: "example.com", company_name: "Example Inc", state: "published_stale", reason: "freshness fail", published_at: "2026-09-10T12:00:00.000Z" }],
        stale_count: 1,
        orphan_count: 0,
      },
    },
  });
  assert.match(html, /Operational Health Detail/);
  assert.match(html, /example\.com/);
  assert.match(html, /🟡 Published Stale/);
  // Report Summary の後・System Health の前
  assert.ok(html.indexOf("Report Summary") < html.indexOf("Operational Health Detail"));
  assert.ok(html.indexOf("Operational Health Detail") < html.indexOf("System Health"));
});

// ---------------------------------------------------------------------------
// Phase58 STEP7 — Published Stale / Orphan アラートに Operations への導線
// ---------------------------------------------------------------------------

test("STEP7: published_stale>0 のアラートに 'View details in Operations →' リンクが付く", () => {
  const html = ui.renderReportSummary({
    generated: 3, approved: 2, published_backend: 2,
    published_stale: 1, published_orphan: 0, stale_slugs: ["example.com"], orphan_slugs: [],
    web_deployed: null, deploy_pending: null, pending_slugs: [],
  });
  assert.match(html, /View details in Operations →/);
  assert.match(html, /href="operations\.html#published-artifact-health"/);
});

test("STEP7: published_orphan>0 のアラートにも Operations 導線が付く", () => {
  const html = ui.renderReportSummary({
    generated: 2, approved: 2, published_backend: 3,
    published_stale: 0, published_orphan: 1, stale_slugs: [], orphan_slugs: ["orphan.example"],
    web_deployed: null, deploy_pending: null, pending_slugs: [],
  });
  const links = html.match(/operations\.html#published-artifact-health/g) || [];
  assert.equal(links.length, 1, "orphan アラートに1つだけ導線が付く");
});

test("STEP7: stale=0 / orphan=0 のときは Operations 導線を出さない", () => {
  const html = ui.renderReportSummary({
    generated: 1, approved: 1, published_backend: 1,
    published_stale: 0, published_orphan: 0, stale_slugs: [], orphan_slugs: [],
    web_deployed: 1, deploy_pending: 0, pending_slugs: [],
  });
  assert.ok(!html.includes("View details in Operations"));
  assert.ok(!html.includes("published-artifact-health"));
});

// ===========================================================================
// Phase59 STEP5 — Published Artifact Audit（Audit Card / Audit Summary 描画確認）
// 詳細な行別ステータス判定は dashboard-operational-health.test.js 側で検証済み。
// ここでは renderOperationalHealthCard / renderPublishedArtifactAuditSummary が
// 正しく描画・非描画を切り替えることのみ確認する。
// ===========================================================================

function opHealthOk(overrides) {
  return Object.assign(
    {
      ok: true,
      status: "success",
      summary: {
        published_stale: 0, published_orphan: 0, recommended_republish: 0, recommended_unpublish: 0,
        deploy_blocked: false, deploy_ready: true,
        generated_reports: 9, approved_reports: 5, published_reports: 4,
      },
      checks: [],
    },
    overrides || {}
  );
}

test("Audit Card描画: Operational Health Card に Published Artifact Audit の件数（Generated/Approved/Published Reports）が出る", () => {
  const html = ui.renderOperationalHealthCard(opHealthOk());
  assert.match(html, /Published Artifact Audit/);
  assert.match(html, /Generated Reports/);
  assert.match(html, /Approved Reports/);
  assert.match(html, /Published Reports/);
});

test("Audit Summary描画: renderPublishedArtifactAuditSummary は 4 行の Check テーブルを返す", () => {
  const html = ui.renderPublishedArtifactAuditSummary(opHealthOk());
  const rows = ["Generated reports reviewed", "Approved reports published", "Published artifacts synchronized", "Deploy reconciliation clean"];
  for (const label of rows) {
    assert.match(html, new RegExp(`<td>${label}</td>`));
  }
  assert.ok(!html.includes("example.com"), "slug 一覧は出さない（件数/判定のみ）");
});

test("legacy fallback: generated_reports 等が無い旧レスポンスでは Audit Card 拡張も Audit Summary も出ない", () => {
  const legacy = {
    ok: true,
    status: "success",
    summary: { published_stale: 0, published_orphan: 0, recommended_republish: 0, recommended_unpublish: 0, deploy_blocked: false, deploy_ready: true },
    checks: [],
  };
  const card = ui.renderOperationalHealthCard(legacy);
  assert.ok(!card.includes("Published Artifact Audit"));
  assert.equal(ui.renderPublishedArtifactAuditSummary(legacy), "");
});

test("warning表示: published_stale>0（status=warning）は Audit Card が tone-warn、Audit Summary の synchronized 行が warning", () => {
  const data = opHealthOk({
    status: "warning",
    summary: {
      published_stale: 1, published_orphan: 0, recommended_republish: 1, recommended_unpublish: 0,
      deploy_blocked: true, deploy_ready: false,
      generated_reports: 9, approved_reports: 5, published_reports: 4,
    },
  });
  const card = ui.renderOperationalHealthCard(data);
  assert.match(card, /dash-alert tone-warn">Some published artifacts are stale\./);
  const summaryHtml = ui.renderPublishedArtifactAuditSummary(data);
  assert.match(summaryHtml, /<td>Published artifacts synchronized<\/td><td><span class="status-pill status-needs_revision">🟡 warning<\/span><\/td>/);
});

test("danger表示: published_orphan>0（status=danger）は Audit Card が tone-bad、Audit Summary の synchronized 行が danger", () => {
  const data = opHealthOk({
    status: "danger",
    summary: {
      published_stale: 0, published_orphan: 1, recommended_republish: 0, recommended_unpublish: 1,
      deploy_blocked: true, deploy_ready: false,
      generated_reports: 9, approved_reports: 5, published_reports: 4,
    },
  });
  const card = ui.renderOperationalHealthCard(data);
  assert.match(card, /dash-alert tone-bad">Some published artifacts are orphaned\./);
  const summaryHtml = ui.renderPublishedArtifactAuditSummary(data);
  assert.match(summaryHtml, /<td>Published artifacts synchronized<\/td><td><span class="status-pill status-rejected">🔴 danger<\/span><\/td>/);
});

// ===========================================================================
// Phase59 STEP9 — Admin Dashboard Consistency Audit
// Operational Health API の summary 値のみを表示する（再計算禁止・独自判定禁止）。
// ===========================================================================

test("Case A: Ready表示（stale/orphan=0・status=success・deploy_ready=true）→ 緑Banner・Checklist全項目success", () => {
  const html = ui.renderConsistencyAudit(opHealthOk());
  assert.match(html, /dash-alert tone-good">Dashboard state is fully synchronized\./);
  assert.match(html, /<span class="dash-metric-value">Yes<\/span>|dash-metric-value">Yes</); // Deploy Ready = Yes
  const order = [
    "Dashboard summary loaded",
    "Deploy readiness synchronized",
    "Published artifact counts synchronized",
    "Dashboard audit synchronized",
    "Operations audit synchronized",
    "Reports audit synchronized",
  ];
  for (const label of order) {
    assert.match(html, new RegExp(`<strong>${label}</strong>`));
  }
  assert.ok(!html.includes("🟡") && !html.includes("🔴"), "Ready 状態では warning/danger バッジが出ない");
});

test("Case B: Warning表示（published_stale>0・status=warning）→ 黄Banner・synchronized系チェックがwarning", () => {
  const data = opHealthOk({
    status: "warning",
    summary: {
      published_stale: 1, published_orphan: 0, recommended_republish: 1, recommended_unpublish: 0,
      deploy_blocked: true, deploy_ready: false,
      generated_reports: 9, approved_reports: 5, published_reports: 4,
    },
  });
  const html = ui.renderConsistencyAudit(data);
  assert.match(html, /dash-alert tone-warn">Dashboard synchronization requires remediation before deployment\./);
  const warnCount = (html.match(/🟡 warning/g) || []).length;
  assert.equal(warnCount, 5, "generated_reports存在チェック以外の5項目がwarning");
});

test("Case C: Danger表示（published_orphan>0・status=danger）→ 赤Banner・synchronized系チェックがdanger", () => {
  const data = opHealthOk({
    status: "danger",
    summary: {
      published_stale: 0, published_orphan: 1, recommended_republish: 0, recommended_unpublish: 1,
      deploy_blocked: true, deploy_ready: false,
      generated_reports: 9, approved_reports: 5, published_reports: 4,
    },
  });
  const html = ui.renderConsistencyAudit(data);
  assert.match(html, /dash-alert tone-bad">Dashboard synchronization detected orphan published artifacts\./);
  const dangerCount = (html.match(/🔴 danger/g) || []).length;
  assert.equal(dangerCount, 5, "generated_reports存在チェック以外の5項目がdanger");
});

test("Case D: Legacy（summary/generated_reports/status が無い）→ Consistency Audit セクション非表示", () => {
  assert.equal(ui.renderConsistencyAudit(undefined), "");
  assert.equal(ui.renderConsistencyAudit(null), "");
  assert.equal(ui.renderConsistencyAudit({ ok: true, status: "success", summary: { deploy_ready: true } }), "", "generated_reports 等が無ければ legacy");
  assert.equal(ui.renderConsistencyAudit({ ok: true, summary: opHealthOk().summary }), "", "status が無ければ legacy");
  assert.equal(ui.renderConsistencyAudit({ generated_at: "x", operational_health: { items: [], stale_count: 0, orphan_count: 0 } }), "");

  const html = ui.renderDashboard({
    summary: { generated_at: "2026-09-11T00:00:00Z", lead_summary: {}, delivery_summary: {}, suppression_summary: {} },
    reports: { generated: 1, approved: 1, published_backend: 1, web_deployed: 1, deploy_pending: 0, pending_slugs: [] },
    health: { ses: {}, lambda: {}, cloudfront: {}, blastengine: {} },
    operationalHealth: { generated_at: "x", operational_health: { items: [], stale_count: 0, orphan_count: 0 } },
  });
  assert.ok(!html.includes("Admin Dashboard Consistency Audit"));
  assert.match(html, /Report Summary/);
  assert.match(html, /System Health/);
});

test("Case E: Counts表示 — Generated/Approved/Published Reports・Stale/Orphan・Deploy Ready がそのまま出る（再計算なし）", () => {
  const html = ui.renderConsistencyAudit(opHealthOk());
  assert.match(html, /dash-metric-value">9<\/div><div class="dash-metric-label">Generated Reports/);
  assert.match(html, /dash-metric-value">5<\/div><div class="dash-metric-label">Approved Reports/);
  assert.match(html, /dash-metric-value">4<\/div><div class="dash-metric-label">Published Reports/);
  assert.match(html, /dash-metric-value">0<\/div><div class="dash-metric-label">Published Stale/);
  assert.match(html, /dash-metric-value">0<\/div><div class="dash-metric-label">Published Orphan/);
  assert.match(html, /dash-metric-value">Yes<\/div><div class="dash-metric-label">Deploy Ready/);
});

test("Case F: Checklist表示 — 6項目固定、順序固定、slug 一覧は出さない", () => {
  const html = ui.renderConsistencyAudit(opHealthOk());
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
  assert.ok((html.match(/<li>/g) || []).length === 6, "チェックリストは6項目固定");
  assert.ok(!html.includes("example.com") && !html.includes("ab-i.jp"), "slug 一覧は出さない");
});

test("Case G: Banner色切替 — success/warning/danger の3状態で文言とtoneクラスが切り替わる", () => {
  const ready = ui.renderConsistencyAudit(opHealthOk());
  const warn = ui.renderConsistencyAudit(opHealthOk({ status: "warning", summary: { published_stale: 1, published_orphan: 0, recommended_republish: 1, recommended_unpublish: 0, deploy_blocked: true, deploy_ready: false, generated_reports: 9, approved_reports: 5, published_reports: 4 } }));
  const danger = ui.renderConsistencyAudit(opHealthOk({ status: "danger", summary: { published_stale: 0, published_orphan: 1, recommended_republish: 0, recommended_unpublish: 1, deploy_blocked: true, deploy_ready: false, generated_reports: 9, approved_reports: 5, published_reports: 4 } }));
  assert.match(ready, /tone-good/);
  assert.match(warn, /tone-warn/);
  assert.match(danger, /tone-bad/);
  assert.ok(!ready.includes("tone-warn") && !ready.includes("tone-bad"));
  assert.ok(!warn.includes("tone-good") && !warn.includes("tone-bad"));
  assert.ok(!danger.includes("tone-good") && !danger.includes("tone-warn"));
});

test("Case H: undefined / NaN なし — legacy・実データ相当（9/5/4）いずれのケースでも undefined/NaN 文字列を出さない。表示順序は Operational Health の後・Operational Health Detail の前", () => {
  const legacyHtml = ui.renderDashboard({
    summary: { generated_at: "2026-09-11T00:00:00Z", lead_summary: {}, delivery_summary: {}, suppression_summary: {} },
    reports: { generated: 1, approved: 1, published_backend: 1, web_deployed: 1, deploy_pending: 0, pending_slugs: [] },
    health: { ses: {}, lambda: {}, cloudfront: {}, blastengine: {} },
    operationalHealth: { generated_at: "x", operational_health: { items: [], stale_count: 0, orphan_count: 0 } },
  });
  assert.ok(!legacyHtml.includes("undefined") && !legacyHtml.includes("NaN"));

  const withAuditHtml = ui.renderDashboard({
    summary: { generated_at: "2026-09-11T00:00:00Z", lead_summary: {}, delivery_summary: {}, suppression_summary: {} },
    reports: { generated: 9, approved: 5, published_backend: 4, web_deployed: 10, deploy_pending: 0, pending_slugs: [] },
    health: { ses: {}, lambda: {}, cloudfront: {}, blastengine: {} },
    operationalHealth: Object.assign({}, opHealthOk(), { operational_health: { items: [], stale_count: 0, orphan_count: 0 } }),
  });
  assert.ok(!withAuditHtml.includes("undefined") && !withAuditHtml.includes("NaN"));
  assert.match(withAuditHtml, /Admin Dashboard Consistency Audit/);

  // §5: 表示順序 — Operational Health の後、Operational Health Detail の前（既存順序は変更しない）。
  const iOpHealth = withAuditHtml.indexOf(">Operational Health<");
  const iConsistency = withAuditHtml.indexOf("Admin Dashboard Consistency Audit");
  const iDetail = withAuditHtml.indexOf("Operational Health Detail");
  const iSystem = withAuditHtml.indexOf("System Health");
  assert.ok(iOpHealth < iConsistency, "Consistency Audit は Operational Health の後");
  assert.ok(iConsistency < iDetail, "Consistency Audit は Operational Health Detail の前");
  assert.ok(iDetail < iSystem, "Operational Health Detail は System Health の前（既存順序を維持）");
});
