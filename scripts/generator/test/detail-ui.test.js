/**
 * detail-ui.test.js — website/aor-admin/public/assets/js/detail.js の純粋関数
 * （escapeHtml/fmtDate/listItems/renderEvidence/renderHistory/renderComments/renderFixes/
 * computeLastUpdatedAt/publishableBlock/publishBlock）を Node からユニットテストする
 * （Phase62 STEP1: v1→v2 migration）。
 * jobs-ui / list-ui と同じ方針（module.exports 経由、DOM 非依存）。
 *
 * detail.js は Phase62 STEP1 で IIFE + module.exports 構造へ移行された（Task14/23/24/38時点の
 * 実装ロジック・API呼び出し・DOM構造は変更していない）。DOM/windowに触れる
 * getCompanyId/showToast/render/wireActions はブラウザ専用のため module.exports に含まれず、
 * ここでは静的検証（ソースコード上の対応関係の確認）のみ行う（jobs-ui.test.js の
 * retry/cancel wiring テストと同じ方針）。
 *
 * detail.html は Phase61 STEP4で確定した「NOT APPLICABLE」（Health Badge/app.js/status.js/
 * system-status-bar対象外）を維持していることも確認する。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const DETAIL_JS_PATH = path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "assets", "js", "detail.js");
const DETAIL_HTML_PATH = path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "detail.html");

const detailUi = require(DETAIL_JS_PATH);
const detailJsSource = fs.readFileSync(DETAIL_JS_PATH, "utf8");
const detailHtml = fs.readFileSync(DETAIL_HTML_PATH, "utf8");

// ===========================================================================
// module.exports / no browser initialization / no global leakage
// ===========================================================================

test("module.exports: 必要な純粋関数がすべてexportされている", () => {
  for (const name of [
    "escapeHtml",
    "fmtDate",
    "listItems",
    "renderEvidence",
    "renderHistory",
    "renderComments",
    "renderFixes",
    "computeLastUpdatedAt",
    "publishableBlock",
    "publishBlock",
  ]) {
    assert.equal(typeof detailUi[name], "function", `${name} がexportされていない`);
  }
});

test("module.exports: DOM/API副作用を持つ関数はexportされていない", () => {
  assert.equal(detailUi.getCompanyId, undefined);
  assert.equal(detailUi.showToast, undefined);
  assert.equal(detailUi.render, undefined);
  assert.equal(detailUi.wireActions, undefined);
});

test("Node環境でrequireしてもdocument/windowを要求せず、API呼び出しを発生させない", () => {
  assert.equal(typeof document, "undefined", "Node環境でdocumentはundefinedのはず");
  assert.equal(typeof window, "undefined", "Node環境でwindowはundefinedのはず");
  assert.ok(detailUi, "requireが正常に完了している");
});

test("Node環境ではdetail.jsの内部識別子がglobalへ漏れない（IIFE化の確認）", () => {
  assert.equal(typeof globalThis.escapeHtml, "undefined");
  assert.equal(typeof globalThis.fmtDate, "undefined");
  assert.equal(typeof globalThis.listItems, "undefined");
  assert.equal(typeof globalThis.renderEvidence, "undefined");
  assert.equal(typeof globalThis.renderHistory, "undefined");
  assert.equal(typeof globalThis.renderComments, "undefined");
  assert.equal(typeof globalThis.renderFixes, "undefined");
  assert.equal(typeof globalThis.computeLastUpdatedAt, "undefined");
  assert.equal(typeof globalThis.publishableBlock, "undefined");
  assert.equal(typeof globalThis.publishBlock, "undefined");
  assert.equal(typeof globalThis.getCompanyId, "undefined");
  assert.equal(typeof globalThis.showToast, "undefined");
  assert.equal(typeof globalThis.render, "undefined");
  assert.equal(typeof globalThis.wireActions, "undefined");
});

// ===========================================================================
// Utility — escapeHtml
// ===========================================================================

test("escapeHtml: <, >, &, \", ' をエスケープする", () => {
  assert.equal(detailUi.escapeHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(detailUi.escapeHtml("a & b"), "a &amp; b");
  assert.equal(detailUi.escapeHtml('"quoted"'), "&quot;quoted&quot;");
  assert.equal(detailUi.escapeHtml("it's"), "it&#39;s");
});

test("escapeHtml: null/undefinedは空文字になる（既存フォールバック）", () => {
  assert.equal(detailUi.escapeHtml(null), "");
  assert.equal(detailUi.escapeHtml(undefined), "");
});

// ===========================================================================
// Formatting — fmtDate
// ===========================================================================

test("fmtDate: 正常値はja-JPロケール文字列、null/undefined/空/無効値は既存仕様どおり", () => {
  assert.equal(detailUi.fmtDate(null), "—");
  assert.equal(detailUi.fmtDate(undefined), "—");
  assert.equal(detailUi.fmtDate(""), "—");
  assert.match(detailUi.fmtDate("2026-09-05T00:00:00Z"), /2026/);
  assert.equal(detailUi.fmtDate("not-a-date"), "Invalid Date");
});

// ===========================================================================
// Rendering — listItems
// ===========================================================================

test("listItems: 空/未定義は既存の空状態表示、値がある場合はul/liで列挙されエスケープされる", () => {
  assert.match(detailUi.listItems(null), /（なし）/);
  assert.match(detailUi.listItems([]), /（なし）/);
  const html = detailUi.listItems(["良い点1", "<script>alert(1)</script>"], "list-warn");
  assert.match(html, /class="plain-list list-warn"/);
  assert.match(html, /<li>良い点1<\/li>/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

// ===========================================================================
// Rendering — renderEvidence
// ===========================================================================

test("renderEvidence: 空/未定義は既存の（なし）表示", () => {
  assert.equal(detailUi.renderEvidence(null, []), "（なし）");
  assert.equal(detailUi.renderEvidence([], []), "（なし）");
});

test("renderEvidence: source_idからsource_pagesのlabelを引いて表示し、無ければsource_idをそのまま表示する", () => {
  const html = detailUi.renderEvidence(
    [
      { source_id: "s1", quote: "引用1" },
      { source_id: "s2", quote: "引用2" },
    ],
    [{ id: "s1", label: "経済産業省ニュース" }]
  );
  assert.match(html, /\[s1\] 経済産業省ニュース/);
  assert.match(html, /引用1/);
  assert.match(html, /\[s2\] s2/);
  assert.match(html, /引用2/);
});

test("renderEvidence: XSS安全性 — labelとquoteがエスケープされる", () => {
  const html = detailUi.renderEvidence(
    [{ source_id: "s1", quote: `<img src=x onerror=alert(1)>` }],
    [{ id: "s1", label: `<script>alert(2)</script>` }]
  );
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(html, /<script>alert\(2\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

// ===========================================================================
// Rendering — renderHistory / renderComments / renderFixes
// ===========================================================================

test("renderHistory: 空/未定義は既存の（履歴なし）表示", () => {
  assert.match(detailUi.renderHistory(null), /（履歴なし）/);
  assert.match(detailUi.renderHistory([]), /（履歴なし）/);
});

test("renderHistory: 新しい順（reverse）で表示し、from_status→to_statusとcommentが既存仕様どおり表示される", () => {
  const html = detailUi.renderHistory([
    { at: "2026-01-01T00:00:00Z", actor: "alice", action: "approve", from_status: "pending_review", to_status: "approved" },
    { at: "2026-01-02T00:00:00Z", actor: "bob", action: "comment", comment: "コメント本文" },
  ]);
  const idxBob = html.indexOf("bob");
  const idxAlice = html.indexOf("alice");
  assert.ok(idxBob !== -1 && idxAlice !== -1 && idxBob < idxAlice, "reverse()により新しいエントリが先に表示されるはず");
  assert.match(html, /pending_review → approved/);
  assert.match(html, /コメント本文/);
});

test("renderHistory: XSS安全性 — actor/action/commentがエスケープされる", () => {
  const html = detailUi.renderHistory([{ at: "2026-01-01T00:00:00Z", actor: `<script>alert(1)</script>`, action: "x", comment: `<img src=x onerror=alert(2)>` }]);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x onerror=alert\(2\)>/);
});

test("renderComments: 空/未定義は既存の（コメントなし）表示、通常時はat/actor/textが表示される", () => {
  assert.match(detailUi.renderComments(null), /（コメントなし）/);
  assert.match(detailUi.renderComments([]), /（コメントなし）/);
  const html = detailUi.renderComments([{ at: "2026-01-01T00:00:00Z", actor: "alice", text: "確認しました" }]);
  assert.match(html, /alice/);
  assert.match(html, /確認しました/);
});

test("renderComments: XSS安全性 — actor/textがエスケープされる", () => {
  const html = detailUi.renderComments([{ at: "2026-01-01T00:00:00Z", actor: `<script>alert(1)</script>`, text: `<img src=x onerror=alert(2)>` }]);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x onerror=alert\(2\)>/);
});

test("renderFixes: 空/未定義は既存の（修正指示なし）表示、resolved有無で既存文言が切り替わる", () => {
  assert.match(detailUi.renderFixes(null), /（修正指示なし）/);
  assert.match(detailUi.renderFixes([]), /（修正指示なし）/);
  const resolved = detailUi.renderFixes([{ at: "2026-01-01T00:00:00Z", actor: "alice", resolved: true, description: "直しました" }]);
  assert.match(resolved, /解決済み/);
  const unresolved = detailUi.renderFixes([{ at: "2026-01-01T00:00:00Z", actor: "bob", resolved: false, description: "未修正" }]);
  assert.match(unresolved, /未解決/);
});

test("renderFixes: XSS安全性 — actor/descriptionがエスケープされる", () => {
  const html = detailUi.renderFixes([{ at: "2026-01-01T00:00:00Z", actor: `<script>alert(1)</script>`, resolved: false, description: `<img src=x onerror=alert(2)>` }]);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x onerror=alert\(2\)>/);
});

// ===========================================================================
// computeLastUpdatedAt
// ===========================================================================

test("computeLastUpdatedAt: reviewed_at/history/comments/fixesすべて空ならnull", () => {
  assert.equal(detailUi.computeLastUpdatedAt({}), null);
  assert.equal(detailUi.computeLastUpdatedAt({ reviewed_at: null, history: [], comments: [], fixes: [] }), null);
});

test("computeLastUpdatedAt: reviewed_at/history/comments/fixesのうち最も新しいタイムスタンプを返す", () => {
  const review = {
    reviewed_at: "2026-01-01T00:00:00Z",
    history: [{ at: "2026-01-02T00:00:00Z" }],
    comments: [{ at: "2026-01-05T00:00:00Z" }],
    fixes: [{ at: "2026-01-03T00:00:00Z" }],
  };
  assert.equal(detailUi.computeLastUpdatedAt(review), "2026-01-05T00:00:00Z");
});

test("computeLastUpdatedAt: reviewed_atのみの場合はそれを返す（Task13/14の既知の制約どおり）", () => {
  assert.equal(detailUi.computeLastUpdatedAt({ reviewed_at: "2026-02-01T00:00:00Z" }), "2026-02-01T00:00:00Z");
});

// ===========================================================================
// Rendering — publishableBlock / publishBlock
// ===========================================================================

test("publishableBlock: publishable=trueは○配信可能、reasonsは表示されない", () => {
  const html = detailUi.publishableBlock(true, ["理由A"]);
  assert.match(html, /○ 配信可能/);
  assert.doesNotMatch(html, /理由A/);
});

test("publishableBlock: publishable=falseは×配信不可、reasonsがlist-warnで表示される", () => {
  const html = detailUi.publishableBlock(false, ["承認されていません"]);
  assert.match(html, /× 配信不可/);
  assert.match(html, /class="plain-list list-warn"/);
  assert.match(html, /承認されていません/);
});

test("publishBlock: 未公開時は「公開する」ボタンのみ表示され、公開取消ボタンは表示されない", () => {
  const html = detailUi.publishBlock(true, false);
  assert.match(html, /未公開/);
  assert.match(html, /id="btn-publish" >公開する</);
  assert.doesNotMatch(html, /btn-unpublish/);
});

test("publishBlock: publishable=falseは公開ボタンがdisabledになり、承認が必要な旨のヒントが出る", () => {
  const html = detailUi.publishBlock(false, false);
  assert.match(html, /id="btn-publish" disabled>公開する</);
  assert.match(html, /承認済み（publishable=○）にならないと公開できません。/);
});

test("publishBlock: 公開済み時は「再公開する」ラベルになり、公開取消ボタンが表示される（publishableに関わらず押せる）", () => {
  const published = detailUi.publishBlock(true, true);
  assert.match(published, /公開済み（website\/aor\/data\/に反映済み）/);
  assert.match(published, /再公開する（最新内容で上書き）/);
  assert.match(published, /id="btn-unpublish" class="secondary">公開を取り消す</);

  const publishedButUnapproved = detailUi.publishBlock(false, true);
  assert.doesNotMatch(publishedButUnapproved, /id="btn-unpublish"[^>]*disabled/);
  assert.match(publishedButUnapproved, /id="btn-unpublish" class="secondary">公開を取り消す</);
});

// ===========================================================================
// Query Parameter（静的検証。getCompanyIdは非公開のため実行はしない）
// ===========================================================================

test("Query Parameter: getCompanyId()がURLSearchParams(window.location.search)からcompanyを取得する既存実装のまま維持されている（静的検証）", () => {
  assert.match(detailJsSource, /function getCompanyId\(\)/);
  assert.match(detailJsSource, /new URLSearchParams\(window\.location\.search\)\.get\("company"\)/);
});

test("Error/Fallback: company未指定時のエラーメッセージが既存仕様のまま維持されている（静的検証）", () => {
  assert.match(detailJsSource, /\?company=&lt;id&gt; を指定してください。/);
  assert.match(detailJsSource, /読み込みに失敗しました: \$\{escapeHtml\(err\.message\)\}/);
});

// ===========================================================================
// Review Actions wiring（静的検証。DOM実行はしない）
// ===========================================================================

test("Review Actions wiring: approve/reject/reviseがdata-actionとAdminApiへ既存どおり対応している（静的検証）", () => {
  assert.match(detailJsSource, /function wireActions\(id\)/);
  assert.match(detailJsSource, /if \(action === "approve"\) await AdminApi\.approve\(id, \{ comment \}\)/);
  assert.match(detailJsSource, /else if \(action === "reject"\) await AdminApi\.reject\(id, \{ comment \}\)/);
  assert.match(detailJsSource, /await AdminApi\.revise\(id, \{ comment, fixes:/);
});

test("Review Actions wiring: comment/fix追加がAdminApi.comment/AdminApi.fixへ既存どおり対応している（静的検証）", () => {
  assert.match(detailJsSource, /AdminApi\.comment\(id, \{ text \}\)/);
  assert.match(detailJsSource, /AdminApi\.fix\(id, \{ description \}\)/);
});

test("Review Actions wiring: publish/unpublishがAdminApi.publish/AdminApi.unpublishへ既存どおり対応している（静的検証）", () => {
  assert.match(detailJsSource, /AdminApi\.publish\(id\)/);
  assert.match(detailJsSource, /AdminApi\.unpublish\(id\)/);
  assert.match(detailJsSource, /getElementById\("btn-publish"\)/);
  assert.match(detailJsSource, /getElementById\("btn-unpublish"\)/);
});

// ===========================================================================
// HTML Contract（detail.html）
// ===========================================================================

test("detail.html: 既存の主要DOM要素が存在する", () => {
  assert.match(detailHtml, /<main id="detail-container">/);
  assert.match(detailHtml, /id="toast"/);
  assert.match(detailHtml, /id="user-label"/);
});

test("detail.html: script読み込み順序が api.js → detail.js のまま（app.js/status.jsは追加されていない）", () => {
  const iApi = detailHtml.indexOf('<script src="/assets/js/api.js"></script>');
  const iDetail = detailHtml.indexOf('<script src="/assets/js/detail.js"></script>');
  assert.ok(iApi !== -1 && iDetail !== -1, "必要なscript読み込みが揃っていない");
  assert.ok(iApi < iDetail, "script順序が api.js → detail.js になっていない");
  assert.doesNotMatch(detailHtml, /<script src="\/assets\/js\/app\.js">/);
  assert.doesNotMatch(detailHtml, /<script src="\/assets\/js\/status\.js">/);
});

test("detail.html: Navigationリンク（Review Dashboard / Jobs / ログアウト / 一覧に戻る）が既存のまま変更されていない", () => {
  assert.match(detailHtml, /<h1><a href="\/index\.html"[^>]*>Review Dashboard<\/a> ／ 詳細<\/h1>/);
  assert.match(detailHtml, /<a href="\/jobs\.html">Jobs<\/a>/);
  assert.match(detailHtml, /<a href="\/logout">ログアウト<\/a>/);
  assert.match(detailHtml, /<a href="\/index\.html">← 一覧に戻る<\/a>/);
});

test("detail.html: Phase61 STEP4のNOT APPLICABLE判定どおり、Health Badge/app.js/status.js/system-status-bar/live-indicatorが存在しない", () => {
  assert.doesNotMatch(detailHtml, /admin-operational-health-badge/);
  assert.doesNotMatch(detailHtml, /assets\/js\/app\.js/);
  assert.doesNotMatch(detailHtml, /assets\/js\/status\.js/);
  assert.doesNotMatch(detailHtml, /system-status-bar/);
  assert.doesNotMatch(detailHtml, /live-indicator/);
});
