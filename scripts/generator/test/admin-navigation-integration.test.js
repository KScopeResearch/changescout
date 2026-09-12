/**
 * admin-navigation-integration.test.js — Phase59 STEP11。
 *
 * website/aor-admin/public/{dashboard,operations,reports,system}.html の4画面すべてに
 * #admin-operational-health-badge コンテナと app.js の <script> 読み込みが配線されていること、
 * および app.js の描画関数がそのコンテナへ正しくバッジを挿入する（legacy では挿入しない）ことを
 * 確認する。
 *
 * 【テスト方針】このリポジトリのテストスイートは jsdom 等のブラウザ環境を持たない（node --test
 * のみ、DOM 非依存）。そのため:
 *   1. 静的 HTML ファイルをそのまま読み込み、コンテナ div と <script src="/assets/js/app.js">
 *      の存在をテキストレベルで確認する（実際に配線されているかどうかの確認）。
 *   2. app.js の renderNavigationHealthInto() を、innerHTML のみを持つ簡易オブジェクト
 *      （DOM のスタブ）に対して呼び出し、バッジが実際に挿入される／legacy では挿入されない
 *      ことを確認する（DOM 実行環境が無くても検証できる範囲での「統合」確認）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public");
const nav = require(path.join(PUBLIC_DIR, "assets", "js", "app.js"));

const PAGES = [
  { name: "Dashboard", file: "dashboard.html" },
  { name: "Operations", file: "operations.html" },
  { name: "Reports", file: "reports.html" },
  { name: "System", file: "system.html" },
];

function readPage(file) {
  return fs.readFileSync(path.join(PUBLIC_DIR, file), "utf8");
}

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

for (const page of PAGES) {
  test(`${page.name} header: #admin-operational-health-badge コンテナが存在する`, () => {
    const html = readPage(page.file);
    assert.match(html, /<div id="admin-operational-health-badge"><\/div>/, `${page.file} にコンテナが無い`);
  });

  test(`${page.name} header: app.js が <script> 読み込みされている（AdminApi/status.js より後、ページ固有スクリプトより前）`, () => {
    const html = readPage(page.file);
    const iApi = html.indexOf('<script src="/assets/js/api.js"></script>');
    const iApp = html.indexOf('<script src="/assets/js/app.js"></script>');
    assert.ok(iApi !== -1, `${page.file} に api.js の読み込みが無い`);
    assert.ok(iApp !== -1, `${page.file} に app.js の読み込みが無い`);
    assert.ok(iApi < iApp, "app.js は api.js より後に読み込まれる（AdminApi が定義済みであること）");
  });

  test(`${page.name} header: 既存ナビリンク（Dashboard/Reports/Operations/System/ログアウト等）の文言・順序・hrefは変更されていない`, () => {
    const html = readPage(page.file);
    const links = [
      '<a href="/dashboard.html">Dashboard</a>',
      '<a href="/index.html">Reviews</a>',
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
      const idx = html.indexOf(link);
      assert.ok(idx !== -1, `${page.file} にリンク ${link} が見つからない`);
      assert.ok(idx > lastIdx, `${page.file} のリンク順序が変わっている: ${link}`);
      lastIdx = idx;
    }
    // コンテナはログアウトリンクより後（最後のナビリンクの直後）
    const iLogout = html.indexOf('<a href="/logout">ログアウト</a>');
    const iContainer = html.indexOf('<div id="admin-operational-health-badge"></div>');
    assert.ok(iLogout < iContainer, "コンテナは最後のナビリンク（ログアウト）の直後にある");
  });
}

test("badgeがrenderされる: renderNavigationHealthInto はコンテナへバッジ（success/warning/danger）を実際に挿入する", () => {
  const readyContainer = { innerHTML: "" };
  assert.equal(nav.renderNavigationHealthInto(readyContainer, opHealth()), true);
  assert.match(readyContainer.innerHTML, /🟢 Healthy/);
  assert.match(readyContainer.innerHTML, /admin-health-popover/);

  const warnContainer = { innerHTML: "" };
  assert.equal(nav.renderNavigationHealthInto(warnContainer, opHealth({ deploy_ready: false, deploy_blocked: true, published_stale: 1 }, "warning")), true);
  assert.match(warnContainer.innerHTML, /🟡 Attention/);

  const dangerContainer = { innerHTML: "" };
  assert.equal(nav.renderNavigationHealthInto(dangerContainer, opHealth({ deploy_ready: false, deploy_blocked: true, published_orphan: 1 }, "danger")), true);
  assert.match(dangerContainer.innerHTML, /🔴 Blocked/);
});

test("legacyでは存在しない: renderNavigationHealthInto は legacy レスポンス（summary/status/generated_reports 欠落）でコンテナを空のままにする", () => {
  const cases = [
    {},
    { ok: true, status: "success", summary: { deploy_ready: true } }, // generated_reports なし
    { ok: true, summary: opHealth().summary }, // status なし
    { status: "error", message: "boom" },
    null,
    undefined,
  ];
  for (const legacyPayload of cases) {
    const container = { innerHTML: "<span>should be cleared</span>" };
    const inserted = nav.renderNavigationHealthInto(container, legacyPayload);
    assert.equal(inserted, false, `legacy payload=${JSON.stringify(legacyPayload)} で false を返すべき`);
    assert.equal(container.innerHTML, "", `legacy payload=${JSON.stringify(legacyPayload)} でコンテナが空でない`);
  }
});
