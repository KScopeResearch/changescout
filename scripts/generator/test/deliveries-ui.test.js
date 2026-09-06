/**
 * deliveries-ui.test.js — website/aor-admin/public/assets/js/deliveries.js の純粋関数
 * （レンダリング・検索・フィルタ）を Node からユニットテストする（Phase52 STEP6）。
 * dashboard-ui / leads-ui と同じ方針（module.exports 経由、DOM 非依存）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ui = require(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "assets", "js", "deliveries.js"));

function row(o = {}) {
  return Object.assign(
    {
      lead_id: "L1",
      email: "info@example.co.jp",
      company_slug: "example.co.jp",
      company_url: "https://example.co.jp",
      delivery_status: "active",
      delivery_approval_status: "approved",
      at: "2026-09-05T00:57:31.997Z",
      event: "initial_report_sent",
      type: "initial",
      provider: "blastengine",
      outcome: "sent",
      metadata: { message_id: "m1" },
    },
    o
  );
}

const SAMPLE = [
  row({ lead_id: "L1", email: "a@alpha.co.jp", type: "initial", provider: "blastengine", outcome: "sent", event: "initial_report_sent", at: "2026-09-05T03:00:00Z" }),
  row({ lead_id: "L1", email: "a@alpha.co.jp", type: "initial", provider: "blastengine", outcome: "bounced", event: "email_bounced", at: "2026-09-05T04:00:00Z", delivery_status: "bounced",
    metadata: { provider: "blastengine", event_type: "HARDERROR" } }),
  row({ lead_id: "L2", email: "b@beta.co.jp", type: "weekly", provider: "ses", outcome: "delivered", event: "email_delivered", at: "2026-09-05T05:00:00Z" }),
];

const SUMMARY = { initial_sent: 1, initial_failed: 0, weekly_sent: 1, weekly_failed: 0, delivered: 1, bounced: 1, complaints: 0, last_24h: { delivered: 1, bounced: 1, complaints: 0 } };

test("fmtDateTime: ISO→YYYY-MM-DD HH:mm:ss、null→—、無効値素通し", () => {
  assert.match(ui.fmtDateTime("2026-09-05T00:57:31.997Z"), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(ui.fmtDateTime(null), "—");
  assert.equal(ui.fmtDateTime("nope"), "nope");
});

test("providerBadge: SES=provider-ses / blastengine=provider-blastengine、別々に表示", () => {
  const ses = ui.providerBadge("ses");
  const be = ui.providerBadge("blastengine");
  assert.match(ses, /provider-ses/);
  assert.match(ses, />SES</);
  assert.match(be, /provider-blastengine/);
  assert.match(be, />blastengine</);
  assert.notEqual(ses, be);
  assert.match(ui.providerBadge(null), /provider-unknown/);
});

test("typeLabel: initial→Initial Report / weekly→Weekly Report / null→—。再定義しない", () => {
  assert.equal(ui.typeLabel("initial"), "Initial Report");
  assert.equal(ui.typeLabel("weekly"), "Weekly Report");
  assert.equal(ui.typeLabel(null), "—");
});

test("outcomeBadge: delivered/bounced/complaint を別クラスで（failed にまとめない）", () => {
  assert.match(ui.outcomeBadge("delivered"), /status-approved/);
  assert.match(ui.outcomeBadge("bounced"), /status-rejected/);
  assert.match(ui.outcomeBadge("complaint"), /status-rejected/);
  assert.match(ui.outcomeBadge("bounced"), />bounced</);
  assert.match(ui.outcomeBadge("complaint"), />complaint</);
});

test("renderOverview: Backend の summary 値をそのまま表示、error セクションは警告", () => {
  const html = ui.renderOverview(SUMMARY);
  assert.match(html, /Initial Sent/);
  assert.match(html, /Weekly Sent/);
  assert.match(html, /Bounced/);
  assert.match(html, /Complaints/);
  assert.match(html, /Last 24 Hours/);
  assert.match(ui.renderOverview({ status: "error", message: "x down" }), /dash-section-error/);
});

test("matchesSearch: email/lead_id/company_slug/company_url 部分一致、大小無視", () => {
  const r = row({ email: "Foo@Bar.jp", lead_id: "ABC123", company_slug: "bar.jp" });
  assert.equal(ui.matchesSearch(r, ""), true);
  assert.equal(ui.matchesSearch(r, "abc123"), true);
  assert.equal(ui.matchesSearch(r, "bar.jp"), true);
  assert.equal(ui.matchesSearch(r, "zzz"), false);
});

test("matchesFilters: type/provider/outcome/approval を厳密一致、all は無条件", () => {
  const r = row({ type: "weekly", provider: "ses", outcome: "delivered", delivery_approval_status: "approved" });
  assert.equal(ui.matchesFilters(r, { type: "all", provider: "all", outcome: "all", approval: "all" }), true);
  assert.equal(ui.matchesFilters(r, { type: "weekly", provider: "ses", outcome: "delivered", approval: "approved" }), true);
  assert.equal(ui.matchesFilters(r, { type: "initial" }), false);
  assert.equal(ui.matchesFilters(r, { provider: "blastengine" }), false);
  assert.equal(ui.matchesFilters(r, { outcome: "bounced" }), false);
  // 旧 Lead（approval undefined）は "pending" フィルタに一致しない
  assert.equal(ui.matchesFilters(row({ delivery_approval_status: undefined }), { approval: "pending" }), false);
});

test("renderTableRegion: 全件 / 検索 / フィルタ / 空状態の区別", () => {
  const all = ui.renderTableRegion(SAMPLE, { search: "", type: "all", provider: "all", outcome: "all", approval: "all" });
  assert.equal(all.total, 3);
  assert.equal(all.shown, 3);
  assert.match(all.html, /<th>provider<\/th>/);

  const searched = ui.renderTableRegion(SAMPLE, { search: "beta", type: "all", provider: "all", outcome: "all", approval: "all" });
  assert.equal(searched.shown, 1);
  assert.match(searched.html, /b@beta\.co\.jp/);

  const filtered = ui.renderTableRegion(SAMPLE, { search: "", type: "all", provider: "ses", outcome: "all", approval: "all" });
  assert.equal(filtered.shown, 1);

  const noData = ui.renderTableRegion([], {});
  assert.match(noData.html, /配信履歴がありません/);

  const noMatch = ui.renderTableRegion(SAMPLE, { search: "zzz" });
  assert.match(noMatch.html, /条件に一致する配信はありません/);
  assert.equal(noMatch.total, 3);
});

test("renderTableRegion: expandedKey の行に詳細（この Lead のタイムライン含む）", () => {
  const key = ui.rowKey(SAMPLE[0]);
  const r = ui.renderTableRegion(SAMPLE, { search: "", type: "all", provider: "all", outcome: "all", approval: "all", expandedKey: key });
  assert.match(r.html, /delivery-detail-row/);
  assert.match(r.html, /この Lead の配信タイムライン/);
  // L1 の 2 イベントがタイムラインに出る
  assert.match(r.html, /initial_report_sent/);
  assert.match(r.html, /email_bounced/);
});

test("countText: 全件・部分・0", () => {
  assert.equal(ui.countText(3, 3), "3 件");
  assert.equal(ui.countText(1, 3), "1 / 3 件表示");
  assert.equal(ui.countText(0, 0), "0 件");
});

test("renderControls: 検索欄・4 フィルタ群・件数プレースホルダ、search 値をエスケープ", () => {
  const html = ui.renderControls({ search: "<b>x</b>", type: "initial", provider: "ses", outcome: "bounced", approval: "pending" });
  assert.match(html, /id="deliveries-search"/);
  assert.match(html, /data-type="initial"/);
  assert.match(html, /data-provider="ses"/);
  assert.match(html, /data-outcome="bounced"/);
  assert.match(html, /data-approval="pending"/);
  assert.match(html, /id="deliveries-table-region"/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
});

test("renderPage: Overview + Delivery List セクション", () => {
  const html = ui.renderPage({ summary: SUMMARY }, { type: "all", provider: "all", outcome: "all", approval: "all" });
  assert.match(html, /Delivery Overview/);
  assert.match(html, /Delivery List/);
  assert.match(html, /Initial Sent/);
});

test("XSS: email/company/lead_id/provider/outcome/event/metadata の悪性文字列をエスケープ", () => {
  const evil = "<script>alert(1)</script>";
  const r = row({
    lead_id: "x1",
    email: evil,
    company_url: '"><img src=x onerror=alert(1)>',
    company_slug: evil,
    provider: evil,
    outcome: evil,
    event: evil,
    type: evil,
    delivery_status: evil,
    metadata: { evil_key: evil, nested: { a: evil } },
  });

  const tr = ui.deliveryRow(r);
  assert.doesNotMatch(tr, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(tr, /<img /);
  assert.match(tr, /&lt;script&gt;/);

  const detail = ui.detailHtml(r, [r]);
  assert.doesNotMatch(detail, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(detail, /<img /);

  const mt = ui.metadataTable(r.metadata);
  assert.doesNotMatch(mt, /<script>alert\(1\)<\/script>/);

  const region = ui.renderTableRegion([r], { search: "", type: "all", provider: "all", outcome: "all", approval: "all", expandedKey: ui.rowKey(r) });
  assert.doesNotMatch(region.html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(region.html, /<img /);
});
