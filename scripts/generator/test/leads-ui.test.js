/**
 * leads-ui.test.js — website/aor-admin/public/assets/js/leads.js の純粋関数
 * （レンダリング・検索・フィルタ）を Node からユニットテストする（Phase52 STEP5）。
 *
 * leads.js は module.exports へ関数を公開している（ブラウザ実行時は無視され init() も
 * 呼ばれない）。DOM・fetch には依存しない。ブラウザ実 UI・API 疎通は run-all-tests.js の
 * 「Leads確認」と手動確認で担保する。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ui = require(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "assets", "js", "leads.js"));

function lead(o = {}) {
  return Object.assign(
    {
      lead_id: "abc123",
      email: "info@example.co.jp",
      company_url: "https://example.co.jp",
      company_slug: "example.co.jp",
      status: "collected",
      delivery_status: "active",
      delivery_approval_status: "pending",
      collected_at: "2026-09-05T00:56:24.398Z",
      weekly_report_consent: false,
      paid_report_requested: false,
      last_weekly_sent_report_generated_at: null,
      history: [],
    },
    o
  );
}

const SAMPLE = [
  lead({ lead_id: "l1", email: "a@alpha.co.jp", company_url: "https://alpha.co.jp", company_slug: "alpha.co.jp", delivery_status: "active", delivery_approval_status: "approved" }),
  lead({ lead_id: "l2", email: "b@beta.co.jp", company_url: "https://beta.co.jp", company_slug: "beta.co.jp", delivery_status: "bounced", delivery_approval_status: "pending",
    history: [{ at: "2026-09-05T00:57:31.997Z", event: "email_bounced", metadata: { bounce_type: "Permanent" } }] }),
  lead({ lead_id: "l3", email: "c@gamma.co.jp", company_url: "https://gamma.co.jp", company_slug: "gamma.co.jp", delivery_status: "unsubscribed", delivery_approval_status: undefined }),
];

test("fmtDate: null は — 、無効値は素通し", () => {
  assert.equal(ui.fmtDate(null), "—");
  assert.equal(ui.fmtDate("not-a-date"), "not-a-date");
  assert.match(ui.fmtDate("2026-09-05T00:56:24.398Z"), /2026/);
});

test("matchesSearch: email / company_url / company_slug の部分一致、大小無視、空は全一致", () => {
  const l = lead({ email: "Info@Example.co.jp", company_url: "https://Example.co.jp", company_slug: "example.co.jp" });
  assert.equal(ui.matchesSearch(l, ""), true);
  assert.equal(ui.matchesSearch(l, "example"), true);
  assert.equal(ui.matchesSearch(l, "INFO@"), true);
  assert.equal(ui.matchesSearch(l, "nomatch"), false);
});

test("matchesFilters: approval / delivery はサーバー生値と厳密一致、all は無条件", () => {
  const l = lead({ delivery_status: "bounced", delivery_approval_status: "pending" });
  assert.equal(ui.matchesFilters(l, { approval: "all", delivery: "all" }), true);
  assert.equal(ui.matchesFilters(l, { approval: "pending", delivery: "bounced" }), true);
  assert.equal(ui.matchesFilters(l, { approval: "approved", delivery: "all" }), false);
  assert.equal(ui.matchesFilters(l, { approval: "all", delivery: "active" }), false);
  // 旧 Lead（approval undefined）は "pending" フィルタに一致しない（値を捏造しない）
  assert.equal(ui.matchesFilters(lead({ delivery_approval_status: undefined }), { approval: "pending" }), false);
});

test("latestHistory: 後方から最初に一致した event エントリを返す", () => {
  const l = lead({
    history: [
      { at: "t1", event: "initial_report_queued", metadata: {} },
      { at: "t2", event: "initial_report_sent", metadata: {} },
      { at: "t3", event: "email_delivered", metadata: {} },
    ],
  });
  assert.equal(ui.latestHistory(l, ["initial_report_sent", "initial_report_failed"]).at, "t2");
  assert.equal(ui.latestHistory(l, ["weekly_report_sent"]), null);
});

test("deliveryBadge / approvalBadge: 値をそのまま表示。undefined approval は未設定表記", () => {
  assert.match(ui.deliveryBadge("suppressed"), /status-rejected/);
  assert.match(ui.deliveryBadge("active"), /status-approved/);
  assert.match(ui.approvalBadge(undefined), /未設定/);
  assert.match(ui.approvalBadge("approved"), /status-approved/);
});

test("renderTableRegion: 全件表示。shown/total を返す", () => {
  const r = ui.renderTableRegion(SAMPLE, { search: "", approval: "all", delivery: "all" });
  assert.equal(r.total, 3);
  assert.equal(r.shown, 3);
  assert.match(r.html, /a@alpha\.co\.jp/);
  assert.match(r.html, /<th>delivery_status<\/th>/);
});

test("renderTableRegion: 検索で絞り込み", () => {
  const r = ui.renderTableRegion(SAMPLE, { search: "beta", approval: "all", delivery: "all" });
  assert.equal(r.shown, 1);
  assert.match(r.html, /b@beta\.co\.jp/);
  assert.doesNotMatch(r.html, /alpha\.co\.jp/);
});

test("renderTableRegion: delivery フィルタで絞り込み", () => {
  const r = ui.renderTableRegion(SAMPLE, { search: "", approval: "all", delivery: "unsubscribed" });
  assert.equal(r.shown, 1);
  assert.match(r.html, /c@gamma\.co\.jp/);
});

test("renderTableRegion: 0 件（未収集）と 0 件（条件不一致）を区別する", () => {
  const empty = ui.renderTableRegion([], { search: "", approval: "all", delivery: "all" });
  assert.match(empty.html, /Leadがまだ収集されていません/);

  const noMatch = ui.renderTableRegion(SAMPLE, { search: "zzz", approval: "all", delivery: "all" });
  assert.match(noMatch.html, /条件に一致するLeadはありません/);
  assert.equal(noMatch.total, 3);
  assert.equal(noMatch.shown, 0);
});

test("renderTableRegion: expandedId の行に詳細（history タイムライン含む）を挿入", () => {
  const r = ui.renderTableRegion(SAMPLE, { search: "", approval: "all", delivery: "all", expandedId: "l2" });
  assert.match(r.html, /lead-detail-row/);
  assert.match(r.html, /email_bounced/);
  assert.match(r.html, /最新の配信停止イベント/);
});

test("countText: 全件・部分・0 件の表記", () => {
  assert.equal(ui.countText(3, 3), "3 件");
  assert.equal(ui.countText(1, 3), "1 / 3 件表示");
  assert.equal(ui.countText(0, 0), "0 件");
});

test("XSS: email / company / slug / status / history metadata の悪性文字列はエスケープされる", () => {
  const evil = '<script>alert(1)</script>';
  const l = lead({
    lead_id: "x1",
    email: evil,
    company_url: '"><img src=x onerror=alert(1)>',
    company_slug: evil,
    status: evil,
    delivery_status: evil,
    notes: evil,
    history: [{ at: "2026-09-05T00:00:00Z", event: evil, metadata: { x: evil } }],
  });

  const row = ui.leadRow(l);
  assert.doesNotMatch(row, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(row, /<img /); // 属性値の "> ブレイクアウトが起きていない
  assert.match(row, /&lt;script&gt;/);

  const detail = ui.detailHtml(l);
  assert.doesNotMatch(detail, /<script>alert\(1\)<\/script>/);
  assert.match(detail, /&lt;script&gt;/);

  const timeline = ui.historyTimeline(l);
  assert.doesNotMatch(timeline, /<script>alert\(1\)<\/script>/);

  const region = ui.renderTableRegion([l], { search: "", approval: "all", delivery: "all", expandedId: "x1" });
  assert.doesNotMatch(region.html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(region.html, /<img /);
});

test("renderControls: 検索欄・両フィルタ群・件数プレースホルダを含む。search 値もエスケープ", () => {
  const html = ui.renderControls({ search: '<b>x</b>', approval: "pending", delivery: "bounced" });
  assert.match(html, /id="leads-search"/);
  assert.match(html, /data-approval="pending"/);
  assert.match(html, /data-delivery="bounced"/);
  assert.match(html, /id="leads-count"/);
  assert.match(html, /id="leads-table-region"/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
});
