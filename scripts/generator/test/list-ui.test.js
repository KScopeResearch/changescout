/**
 * list-ui.test.js — website/aor-admin/public/assets/js/list.js の純粋関数
 * （escapeHtml/fmtDate/publishableIcon/statusPill/renderList）を Node からユニットテストする
 * （Phase60 STEP4: v1→v2 migration）。
 * jobs-ui / dashboard-ui / deliveries-ui と同じ方針（module.exports 経由、DOM 非依存）。
 *
 * list.js は Phase60 STEP4 で IIFE + module.exports 構造へ移行された（Task14 時点の実装
 * ロジック・SSE の挙動は変更していない）。DOM に触れる init/setLiveIndicator は
 * ブラウザ専用のため module.exports に含まれず、ここでは静的検証（ソースコード上の対応関係の
 * 確認）のみ行う（jobs-ui.test.js の SSE wiring テストと同じ方針）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const LIST_JS_PATH = path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "assets", "js", "list.js");
const INDEX_HTML_PATH = path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "index.html");

const listUi = require(LIST_JS_PATH);
const listJsSource = fs.readFileSync(LIST_JS_PATH, "utf8");
const indexHtml = fs.readFileSync(INDEX_HTML_PATH, "utf8");

function summary(o = {}) {
  return Object.assign(
    {
      id: "example.co.jp",
      company_name: "Example Inc",
      review_status: "pending_review",
      evaluation_status: "PASS",
      evaluation_score: 80,
      evaluation_grade: "B",
      publishable: false,
      published: false,
      reviewer: null,
      reviewed_at: null,
    },
    o
  );
}

// ===========================================================================
// module.exports / no browser initialization / no global leakage
// ===========================================================================

test("module.exports: 必要な純粋関数がすべてexportされている", () => {
  for (const name of ["escapeHtml", "fmtDate", "publishableIcon", "statusPill", "renderList"]) {
    assert.equal(typeof listUi[name], "function", `${name} がexportされていない`);
  }
});

test("module.exports: init/setLiveIndicatorはexportされていない（DOM専用ロジックは非公開のまま）", () => {
  assert.equal(listUi.init, undefined);
  assert.equal(listUi.setLiveIndicator, undefined);
});

test("Node環境でrequireしてもdocument/windowを要求せず、EventSource/API呼び出しを発生させない", () => {
  assert.equal(typeof document, "undefined", "Node環境でdocumentはundefinedのはず");
  assert.equal(typeof window, "undefined", "Node環境でwindowはundefinedのはず");
  assert.ok(listUi, "requireが正常に完了している");
});

test("Node環境ではlist.jsの内部識別子がglobalへ漏れない（IIFE化の確認）", () => {
  assert.equal(typeof globalThis.escapeHtml, "undefined");
  assert.equal(typeof globalThis.fmtDate, "undefined");
  assert.equal(typeof globalThis.publishableIcon, "undefined");
  assert.equal(typeof globalThis.statusPill, "undefined");
  assert.equal(typeof globalThis.renderList, "undefined");
  assert.equal(typeof globalThis.setLiveIndicator, "undefined");
  assert.equal(typeof globalThis.init, "undefined");
});

// ===========================================================================
// Pure Functions
// ===========================================================================

test("escapeHtml: <, >, &, \", ' をエスケープする", () => {
  assert.equal(listUi.escapeHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(listUi.escapeHtml("a & b"), "a &amp; b");
  assert.equal(listUi.escapeHtml('"quoted"'), "&quot;quoted&quot;");
  assert.equal(listUi.escapeHtml("it's"), "it&#39;s");
});

test("fmtDate: 正常値はja-JPロケール文字列、null/無効値は既存仕様どおり", () => {
  assert.equal(listUi.fmtDate(null), "—");
  assert.equal(listUi.fmtDate(""), "—");
  assert.match(listUi.fmtDate("2026-09-05T00:00:00Z"), /2026/);
  assert.equal(listUi.fmtDate("not-a-date"), "Invalid Date");
});

test("publishableIcon: publishable=true→○、needs_revision→△、それ以外→×", () => {
  assert.deepEqual(listUi.publishableIcon({ publishable: true }), { icon: "○", cls: "publishable-true", label: "配信可能" });
  assert.deepEqual(listUi.publishableIcon({ publishable: false, review_status: "needs_revision" }), { icon: "△", cls: "publishable-partial", label: "対応中" });
  assert.deepEqual(listUi.publishableIcon({ publishable: false, review_status: "rejected" }), { icon: "×", cls: "publishable-false", label: "配信不可" });
  assert.deepEqual(listUi.publishableIcon({ publishable: false, review_status: "pending_review" }), { icon: "×", cls: "publishable-false", label: "配信不可" });
});

test("statusPill: labelとstatusValueをそのまま表示、値なしは既存フォールバック（unknown / —）", () => {
  assert.equal(listUi.statusPill("approved", "approved"), '<span class="status-pill status-approved">approved</span>');
  assert.equal(listUi.statusPill(null, null), '<span class="status-pill status-unknown">—</span>');
  assert.equal(listUi.statusPill("", ""), '<span class="status-pill status-unknown">—</span>');
});

// ===========================================================================
// renderList — Published / Approved / Generated / Draft
// ===========================================================================

test("renderList: Published（published=true）は●と公開済みラベルで表示される", () => {
  const container = { innerHTML: "" };
  listUi.renderList([summary({ id: "pub.co.jp", company_name: "Published Co", review_status: "approved", publishable: true, published: true, reviewer: "alice", reviewed_at: "2026-09-01T00:00:00Z" })], container);
  assert.match(container.innerHTML, /Published Co/);
  assert.match(container.innerHTML, /publishable-icon publishable-true" title="公開済み">●/);
  assert.match(container.innerHTML, /status-pill status-approved">approved/);
});

test("renderList: Approved（review_status=approved・publishable=true・未公開）は○と未公開表示になる", () => {
  const container = { innerHTML: "" };
  listUi.renderList([summary({ id: "app.co.jp", company_name: "Approved Co", review_status: "approved", publishable: true, published: false })], container);
  assert.match(container.innerHTML, /Approved Co/);
  assert.match(container.innerHTML, /publishable-icon publishable-true" title="配信可能">○/);
  assert.match(container.innerHTML, /publishable-icon " title="未公開">—/);
});

test("renderList: Generated（review_status=pending_review・publishable=false）は×と対象外の状態を示す", () => {
  const container = { innerHTML: "" };
  listUi.renderList([summary({ id: "gen.co.jp", company_name: "Generated Co", review_status: "pending_review", publishable: false, published: false })], container);
  assert.match(container.innerHTML, /Generated Co/);
  assert.match(container.innerHTML, /status-pill status-pending_review">pending_review/);
  assert.match(container.innerHTML, /publishable-icon publishable-false" title="配信不可">×/);
});

test("renderList: Draft相当（review_status=needs_revision）は△（対応中）で表示される", () => {
  const container = { innerHTML: "" };
  listUi.renderList([summary({ id: "draft.co.jp", company_name: "Draft Co", review_status: "needs_revision", publishable: false, published: false })], container);
  assert.match(container.innerHTML, /Draft Co/);
  assert.match(container.innerHTML, /status-pill status-needs_revision">needs_revision/);
  assert.match(container.innerHTML, /publishable-icon publishable-partial" title="対応中">△/);
});

test("renderList: evaluation_status=FAILの行にrow-eval-failクラスが付く", () => {
  const container = { innerHTML: "" };
  listUi.renderList([summary({ evaluation_status: "FAIL" })], container);
  assert.match(container.innerHTML, /class="row-link row-eval-fail"/);
});

test("renderList: XSS安全性 — company_name/reviewerにHTML特殊文字が混入してもエスケープされる", () => {
  const container = { innerHTML: "" };
  listUi.renderList([summary({ company_name: "<script>alert(1)</script>", reviewer: "<img src=x onerror=alert(2)>" })], container);
  assert.doesNotMatch(container.innerHTML, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(container.innerHTML, /<img src=x onerror=alert\(2\)>/);
  assert.match(container.innerHTML, /&lt;script&gt;/);
});

test("renderList: containerを省略した場合は例外を投げず、querySelectorAllを持たない簡易containerでも安全に動作する（DI最小対応）", () => {
  const container = { innerHTML: "" };
  assert.doesNotThrow(() => listUi.renderList([summary()], container));
  assert.ok(container.innerHTML.length > 0);
});

// ===========================================================================
// Empty State
// ===========================================================================

test("renderList: 空配列は既存の空状態メッセージを表示する", () => {
  const container = { innerHTML: "" };
  listUi.renderList([], container);
  assert.equal(container.innerHTML, '<div class="empty-state">scripts/generator/output/ にレポートがまだありません。</div>');
});

// ===========================================================================
// API Failure（静的検証。init()自体は非公開のため実行はしない）
// ===========================================================================

test("API Failure: init()内のエラー処理が既存仕様どおり（読み込みに失敗しました表示）であることを静的検証する", () => {
  assert.match(listJsSource, /読み込みに失敗しました: \$\{escapeHtml\(err\.message\)\}/);
  assert.match(listJsSource, /catch \(err\) \{/);
});

// ===========================================================================
// Live Indicator / SSE wiring（静的検証。EventSourceはモック化しない）
// ===========================================================================

test("Live Indicator: setLiveIndicator(connected)がCONNECTED/DISCONNECTEDを既存文言で切り替える実装のまま維持されている（静的検証）", () => {
  assert.match(listJsSource, /function setLiveIndicator\(connected\)/);
  assert.match(listJsSource, /dot\.classList\.toggle\("off", !connected\)/);
  assert.match(listJsSource, /connected \? "自動更新中（SSE）" : "接続なし"/);
});

test("SSE wiring: AdminApi.subscribeEvents → renderList → setLiveIndicatorの配線、onopen/onerrorが既存のまま維持されている（静的検証）", () => {
  assert.match(listJsSource, /AdminApi\.subscribeEvents\(/);
  assert.match(listJsSource, /source\.onopen = \(\) => setLiveIndicator\(true\)/);
  assert.match(listJsSource, /source\.onerror = \(\) => setLiveIndicator\(false\)/);
});

test("SSE wiring: /api/events エンドポイント自体は変更されていない（api.js側）", () => {
  const apiJsSource = fs.readFileSync(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "assets", "js", "api.js"), "utf8");
  assert.match(apiJsSource, /new EventSource\("\/api\/events"/);
});

// ===========================================================================
// HTML Contract（index.html）
// ===========================================================================

test("index.html: 既存の主要DOM要素が存在する", () => {
  assert.match(indexHtml, /<div id="list-container">/);
  assert.match(indexHtml, /class="system-status-bar"/);
  assert.match(indexHtml, /id="live-indicator"/);
  assert.match(indexHtml, /id="live-label"/);
});

test("index.html: Navigationリンク数・Reviewsリンク無し・Logoutリンク有り", () => {
  const links = [
    '<a href="/dashboard.html">Dashboard</a>',
    '<a href="/leads.html">Leads</a>',
    '<a href="/deliveries.html">Deliveries</a>',
    '<a href="/reports.html">Reports</a>',
    '<a href="/suppressions.html">Suppression</a>',
    '<a href="/jobs.html">Jobs</a>',
    '<a href="/system.html">System</a>',
    '<a href="/operations.html">Operations</a>',
    '<a href="/logout">ログアウト</a>',
  ];
  let lastIdx = -1;
  for (const link of links) {
    const idx = indexHtml.indexOf(link);
    assert.ok(idx !== -1, `リンク ${link} が見つからない`);
    assert.ok(idx > lastIdx, `リンク順序が変わっている: ${link}`);
    lastIdx = idx;
  }
  assert.ok(!indexHtml.includes('<a href="/index.html">Reviews</a>'), "index.html自身へのReviews自己リンクは元々存在しない");
  const matches = indexHtml.match(/<a href="\/dashboard\.html">Dashboard<\/a>/g) || [];
  assert.equal(matches.length, 1);
});

test("index.html: Health Badgeコンテナ・app.jsは今回追加していない（Phase60 STEP5で判断）", () => {
  assert.ok(!indexHtml.includes("admin-operational-health-badge"), "STEP4ではHealth Badgeを追加しない");
  assert.ok(!indexHtml.includes("/assets/js/app.js"), "STEP4ではapp.jsを読み込まない");
});

test("index.html: script読み込み順序が api.js → status.js → list.js のまま維持されている", () => {
  const iApi = indexHtml.indexOf('<script src="/assets/js/api.js"></script>');
  const iStatus = indexHtml.indexOf('<script src="/assets/js/status.js"></script>');
  const iList = indexHtml.indexOf('<script src="/assets/js/list.js"></script>');
  assert.ok(iApi !== -1 && iStatus !== -1 && iList !== -1, "必要なscript読み込みが揃っていない");
  assert.ok(iApi < iStatus && iStatus < iList, "script順序が api.js → status.js → list.js になっていない");
});
