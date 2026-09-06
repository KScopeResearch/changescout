/**
 * suppression-ui.test.js — website/aor-admin/public/assets/js/suppressions.js の純粋関数
 * （Phase52 STEP7）。dashboard-ui / leads-ui / deliveries-ui と同じ方針。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ui = require(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "assets", "js", "suppressions.js"));

function row(o = {}) {
  return Object.assign(
    {
      lead_id: "L1",
      email: "info@example.co.jp",
      company_slug: "example.co.jp",
      company_url: "https://example.co.jp",
      delivery_status: "bounced",
      delivery_approval_status: "approved",
      reason: "bounce",
      provider: "ses",
      source_event: "email_bounced",
      blocked_at: "2026-09-05T00:57:31.997Z",
      metadata: { bounce_type: "Permanent" },
      timeline: [
        { at: "2026-09-04T00:00:00Z", event: "initial_report_sent", metadata: { message_id: "m1" } },
        { at: "2026-09-05T00:57:31.997Z", event: "email_bounced", metadata: { bounce_type: "Permanent" } },
      ],
    },
    o
  );
}

const SAMPLE = [
  row({ lead_id: "L1", email: "a@alpha.co.jp", reason: "unsubscribe", provider: "user", source_event: "unsubscribed", delivery_status: "unsubscribed", blocked_at: "2026-09-05T03:00:00Z" }),
  row({ lead_id: "L2", email: "b@beta.co.jp", reason: "harderror", provider: "blastengine", source_event: "email_bounced(HARDERROR)", delivery_status: "bounced", blocked_at: "2026-09-05T04:00:00Z" }),
  row({ lead_id: "L3", email: "c@gamma.co.jp", reason: "complaint", provider: "ses", source_event: "email_complaint", delivery_status: "suppressed", blocked_at: "2026-09-05T05:00:00Z" }),
];

const SUMMARY = { total: 3, unsubscribe: 1, bounce: 0, complaint: 1, harderror: 1, drop: 0, manual: 0 };

test("fmtDateTime: ISO→整形、null→—、無効値素通し", () => {
  assert.match(ui.fmtDateTime("2026-09-05T00:57:31.997Z"), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(ui.fmtDateTime(null), "—");
  assert.equal(ui.fmtDateTime("nope"), "nope");
});

test("renderSummary: Backend 値をそのまま（total 含む7項目）、error は警告表示", () => {
  const html = ui.renderSummary(SUMMARY);
  for (const label of ["Total", "Unsubscribe", "Bounce", "Complaint", "Hard Error", "Drop", "Manual"]) {
    assert.ok(html.includes(label), `${label} が無い`);
  }
  assert.match(html, />3</); // total
  assert.match(ui.renderSummary({ status: "error", message: "down" }), /dash-section-error/);
});

test("reasonBadge: canonical 6理由をそのまま表示（存在しない理由を作らない）", () => {
  for (const r of ["unsubscribe", "bounce", "complaint", "harderror", "drop", "manual"]) {
    assert.match(ui.reasonBadge(r), new RegExp(">" + r + "<"));
  }
});

test("providerBadge: SES/blastengine/User/Manual/Unknown を別クラスで", () => {
  assert.match(ui.providerBadge("ses"), /provider-ses/);
  assert.match(ui.providerBadge("blastengine"), /provider-blastengine/);
  assert.match(ui.providerBadge("user"), /provider-user/);
  assert.match(ui.providerBadge("manual"), /provider-manual/);
  assert.match(ui.providerBadge("weird"), /provider-unknown/);
  assert.match(ui.providerBadge("ses"), />SES</);
  assert.match(ui.providerBadge("user"), />User</);
});

test("matchesSearch: email / company / company_slug / lead_id 部分一致、大小無視", () => {
  const r = row({ email: "Foo@Bar.jp", company_slug: "bar.jp", lead_id: "ABC123" });
  assert.equal(ui.matchesSearch(r, ""), true);
  assert.equal(ui.matchesSearch(r, "abc123"), true);
  assert.equal(ui.matchesSearch(r, "bar.jp"), true);
  assert.equal(ui.matchesSearch(r, "zzz"), false);
});

test("matchesFilters: reason/provider/approval/delivery_status を厳密一致、all は無条件", () => {
  const r = row({ reason: "harderror", provider: "blastengine", delivery_approval_status: "pending", delivery_status: "bounced" });
  assert.equal(ui.matchesFilters(r, { reason: "all", provider: "all", approval: "all", delivery_status: "all" }), true);
  assert.equal(ui.matchesFilters(r, { reason: "harderror", provider: "blastengine", approval: "pending", delivery_status: "bounced" }), true);
  assert.equal(ui.matchesFilters(r, { reason: "bounce" }), false);
  assert.equal(ui.matchesFilters(r, { provider: "ses" }), false);
  assert.equal(ui.matchesFilters(r, { delivery_status: "suppressed" }), false);
  assert.equal(ui.matchesFilters(row({ delivery_approval_status: undefined }), { approval: "pending" }), false);
});

test("renderTableRegion: 全件 / 検索 / フィルタ / 2種の空状態", () => {
  const all = ui.renderTableRegion(SAMPLE, { search: "", reason: "all", provider: "all", approval: "all", delivery_status: "all" });
  assert.equal(all.total, 3);
  assert.equal(all.shown, 3);
  assert.match(all.html, /<th>reason<\/th>/);
  assert.match(all.html, /<th>source event<\/th>/);

  const searched = ui.renderTableRegion(SAMPLE, { search: "beta" });
  assert.equal(searched.shown, 1);

  const filtered = ui.renderTableRegion(SAMPLE, { reason: "harderror" });
  assert.equal(filtered.shown, 1);
  assert.match(filtered.html, /b@beta\.co\.jp/);

  assert.match(ui.renderTableRegion([], {}).html, /送信停止対象はありません/);
  const noMatch = ui.renderTableRegion(SAMPLE, { search: "zzz" });
  assert.match(noMatch.html, /条件に一致する送信停止対象はありません/);
  assert.equal(noMatch.total, 3);
});

test("renderTableRegion: expandedKey の行に詳細（Suppression Timeline 含む）", () => {
  const key = ui.rowKey(SAMPLE[1]);
  const r = ui.renderTableRegion(SAMPLE, { search: "", reason: "all", provider: "all", approval: "all", delivery_status: "all", expandedKey: key });
  assert.match(r.html, /suppression-detail-row/);
  assert.match(r.html, /Suppression Timeline/);
  assert.match(r.html, /initial_report_sent/);
  assert.match(r.html, /email_bounced/);
});

test("countText: 全件・部分・0", () => {
  assert.equal(ui.countText(3, 3), "3 件");
  assert.equal(ui.countText(1, 3), "1 / 3 件表示");
  assert.equal(ui.countText(0, 0), "0 件");
});

test("renderControls: 検索欄・4フィルタ群・件数、search 値をエスケープ", () => {
  const html = ui.renderControls({ search: "<b>x</b>", reason: "bounce", provider: "ses", approval: "pending", delivery_status: "bounced" });
  assert.match(html, /id="suppressions-search"/);
  assert.match(html, /data-reason="bounce"/);
  assert.match(html, /data-provider="ses"/);
  assert.match(html, /data-approval="pending"/);
  assert.match(html, /data-delivery_status="bounced"/);
  assert.match(html, /id="suppressions-table-region"/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
});

test("renderPage: Summary + List セクション", () => {
  const html = ui.renderPage({ summary: SUMMARY }, { reason: "all", provider: "all", approval: "all", delivery_status: "all" });
  assert.match(html, /Suppression Summary/);
  assert.match(html, /Suppression List/);
  assert.match(html, /Total/);
});

test("timelineHtml: ISO 原文とローカル表示の両方を出す。空は専用文言", () => {
  const html = ui.timelineHtml([{ at: "2026-09-05T00:57:31.997Z", event: "email_bounced", metadata: { bounce_type: "Permanent" } }]);
  assert.match(html, /2026-09-05T00:57:31\.997Z/); // ISO 原文
  assert.match(html, /2026-09-05 \d{2}:\d{2}:\d{2}/); // ローカル
  assert.match(ui.timelineHtml([]), /配信停止関連のイベントはありません/);
});

test("XSS: email/company/reason/provider/source_event/metadata/timeline の悪性文字列をエスケープ", () => {
  const evil = "<script>alert(1)</script>";
  const r = row({
    lead_id: "x1",
    email: evil,
    company_slug: evil,
    company_url: '"><img src=x onerror=alert(1)>',
    reason: evil,
    provider: evil,
    source_event: evil,
    delivery_status: evil,
    metadata: { k: evil, nested: { a: evil } },
    timeline: [{ at: "2026-09-05T00:00:00Z", event: evil, metadata: { x: evil } }],
  });

  const tr = ui.suppressionRow(r);
  assert.doesNotMatch(tr, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(tr, /<img /);
  assert.match(tr, /&lt;script&gt;/);

  const detail = ui.detailHtml(r);
  assert.doesNotMatch(detail, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(detail, /<img /);

  assert.doesNotMatch(ui.metadataTable(r.metadata), /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(ui.timelineHtml(r.timeline), /<script>alert\(1\)<\/script>/);

  const region = ui.renderTableRegion([r], { search: "", reason: "all", provider: "all", approval: "all", delivery_status: "all", expandedKey: ui.rowKey(r) });
  assert.doesNotMatch(region.html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(region.html, /<img /);
});
