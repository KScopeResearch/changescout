/**
 * navigation-ui.test.js — website/aor-admin/public/assets/js/app.js（Phase59 STEP10）。
 * dashboard-ui / operations-ui / reports-ui / system-ui と同じ方針（module.exports 経由、
 * DOM 非依存）。Operational Health Navigation Badge / Tooltip / Summary の描画のみを確認する。
 *
 * app.js はこの STEP 時点ではまだどの HTML ページにも <script> 配線されていない
 * 純粋関数ユーティリティであり、ここでは関数の入出力のみを検証する。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const nav = require(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "assets", "js", "app.js"));

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

test("Case A: Healthy Badge表示 — status=success → 🟢 Healthy", () => {
  const html = nav.renderHealthBadge(opHealth());
  assert.match(html, /🟢 Healthy/);
  assert.match(html, /class="nav-health-badge"/);
});

test("Case B: Warning Badge表示 — status=warning → 🟡 Attention", () => {
  const html = nav.renderHealthBadge(opHealth({ deploy_ready: false, deploy_blocked: true, published_stale: 1 }, "warning"));
  assert.match(html, /🟡 Attention/);
});

test("Case C: Danger Badge表示 — status=danger → 🔴 Blocked", () => {
  const html = nav.renderHealthBadge(opHealth({ deploy_ready: false, deploy_blocked: true, published_orphan: 1 }, "danger"));
  assert.match(html, /🔴 Blocked/);
});

test("Case D: Tooltip success — 静的文言がtitle属性に入る", () => {
  const html = nav.renderHealthBadge(opHealth());
  assert.match(html, /title="Published artifacts are synchronized and deployment is not blocked\."/);
});

test("Case E: Tooltip warning — 静的文言がtitle属性に入る", () => {
  const html = nav.renderHealthBadge(opHealth({ deploy_ready: false, deploy_blocked: true, published_stale: 1 }, "warning"));
  assert.match(html, /title="Published artifacts require remediation before deployment\."/);
});

test("Case F: Tooltip danger — 静的文言がtitle属性に入る", () => {
  const html = nav.renderHealthBadge(opHealth({ deploy_ready: false, deploy_blocked: true, published_orphan: 1 }, "danger"));
  assert.match(html, /title="Deployment is blocked due to orphan published artifacts\."/);
});

test("Case G: Legacyレスポンス — summary/status/generated_reportsのいずれかが無ければBadge・Summary・Tooltipとも非表示", () => {
  assert.equal(nav.renderHealthBadge(undefined), "");
  assert.equal(nav.renderHealthBadge(null), "");
  assert.equal(nav.renderHealthBadge({}), "");
  assert.equal(nav.renderHealthBadge({ ok: true, status: "success", summary: { deploy_ready: true } }), "", "generated_reports が無ければ legacy");
  assert.equal(nav.renderHealthBadge({ ok: true, summary: opHealth().summary }), "", "status が無ければ legacy");
  assert.equal(nav.renderHealthBadge({ status: "error", message: "boom" }), "");

  assert.equal(nav.renderNavigationHealthSummary(undefined), "");
  assert.equal(nav.renderNavigationHealthSummary({ ok: true, status: "success", summary: { deploy_ready: true } }), "");

  assert.equal(nav.renderNavigationHealth(undefined), "");
  assert.equal(nav.renderNavigationHealth({ ok: true, status: "success", summary: { deploy_ready: true } }), "");
});

test("Case H: undefined / NaN なし — legacy・実データ相当（9/5/4）いずれのケースでも undefined/NaN 文字列を出さない", () => {
  const legacy = nav.renderNavigationHealth({});
  assert.equal(legacy, "");

  const withData = nav.renderNavigationHealth(opHealth());
  assert.ok(!withData.includes("undefined") && !withData.includes("NaN"));
  assert.match(withData, /Deploy Ready: Yes/);
  assert.match(withData, /Published Stale: 0/);
  assert.match(withData, /Published Orphan: 0/);

  // published_stale/published_orphan が null（未取得）でも 0 表示にフォールバックし NaN を出さない
  const nullish = nav.renderNavigationHealthSummary(opHealth({ published_stale: null, published_orphan: null }));
  assert.ok(!nullish.includes("undefined") && !nullish.includes("NaN"));
  assert.match(nullish, /Published Stale: 0/);
  assert.match(nullish, /Published Orphan: 0/);
});

// ===========================================================================
// Phase59 STEP11 — Navigation Health Badge Wiring（HTML配線 + Popover + API失敗時の安全性）
// ===========================================================================

test("STEP11 Case A: success badge — renderNavigationHealthInto がコンテナへバッジを挿入する", () => {
  const container = { innerHTML: "" };
  const inserted = nav.renderNavigationHealthInto(container, opHealth());
  assert.equal(inserted, true);
  assert.match(container.innerHTML, /🟢 Healthy/);
});

test("STEP11 Case B: warning badge — renderNavigationHealthInto がコンテナへ warning バッジを挿入する", () => {
  const container = { innerHTML: "" };
  const inserted = nav.renderNavigationHealthInto(container, opHealth({ deploy_ready: false, deploy_blocked: true, published_stale: 1 }, "warning"));
  assert.equal(inserted, true);
  assert.match(container.innerHTML, /🟡 Attention/);
});

test("STEP11 Case C: danger badge — renderNavigationHealthInto がコンテナへ danger バッジを挿入する", () => {
  const container = { innerHTML: "" };
  const inserted = nav.renderNavigationHealthInto(container, opHealth({ deploy_ready: false, deploy_blocked: true, published_orphan: 1 }, "danger"));
  assert.equal(inserted, true);
  assert.match(container.innerHTML, /🔴 Blocked/);
});

test("STEP11 Case D: tooltip — renderNavigationHealthInto 挿入後の HTML に title 属性の静的文言がそのまま残る", () => {
  const container = { innerHTML: "" };
  nav.renderNavigationHealthInto(container, opHealth({ deploy_ready: false, deploy_blocked: true, published_stale: 1 }, "warning"));
  assert.match(container.innerHTML, /title="Published artifacts require remediation before deployment\."/);
});

test("STEP11 Case E: summary values — Popover の中身（Deploy Ready / Published Stale / Published Orphan）が既存 field-row/field/label/value マークアップで出る", () => {
  const html = nav.renderNavigationHealthPopover(opHealth({ published_stale: 2, published_orphan: 1, deploy_ready: false, deploy_blocked: true }, "danger"));
  assert.match(html, /<div class="card">/);
  assert.match(html, /<div class="field-row">/);
  assert.match(html, /<div class="label">Deploy Ready<\/div><div class="value">No<\/div>/);
  assert.match(html, /<div class="label">Published Stale<\/div><div class="value">2<\/div>/);
  assert.match(html, /<div class="label">Published Orphan<\/div><div class="value">1<\/div>/);
});

test("STEP11 Case F: legacy hidden — summary/status/generated_reports のいずれかが無ければ renderNavigationHealthInto は container を空にし false を返す", () => {
  const c1 = { innerHTML: "<span>old</span>" };
  assert.equal(nav.renderNavigationHealthInto(c1, {}), false);
  assert.equal(c1.innerHTML, "");

  const c2 = { innerHTML: "<span>old</span>" };
  assert.equal(nav.renderNavigationHealthInto(c2, { ok: true, status: "success", summary: { deploy_ready: true } }), false);
  assert.equal(c2.innerHTML, "");

  assert.equal(nav.renderNavigationHealthPopover({}), "");
  assert.equal(nav.renderNavigationHealthInto(null, opHealth()), false, "container 自体が無い場合も例外を投げない");
});

test("STEP11 Case G: api failure hidden — initNavigationHealth は AdminApi 失敗時に例外を投げず container を空にする", async () => {
  const container = { innerHTML: "<span>old</span>" };
  const fakeDocument = { getElementById: (id) => (id === "admin-operational-health-badge" ? container : null) };
  const fakeAdminApi = { getDashboardOperationalHealth: () => Promise.reject(new Error("network error")) };

  global.document = fakeDocument;
  global.AdminApi = fakeAdminApi;
  try {
    assert.doesNotThrow(() => nav.initNavigationHealth());
    // Promise の catch が走るまで1tick待つ
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(container.innerHTML, "", "API失敗時はバッジを非表示のまま終了する");
  } finally {
    delete global.document;
    delete global.AdminApi;
  }
});

test("STEP11 Case G-2: api失敗以外にも、コンテナが無いページ・AdminApi未定義でも例外を投げない", () => {
  global.document = { getElementById: () => null };
  try {
    assert.doesNotThrow(() => nav.initNavigationHealth());
  } finally {
    delete global.document;
  }

  global.document = { getElementById: () => ({ innerHTML: "" }) };
  delete global.AdminApi;
  try {
    assert.doesNotThrow(() => nav.initNavigationHealth());
  } finally {
    delete global.document;
  }
});

test("STEP11 Case H: popover values — success/warning/danger いずれでも Popover は summary の値をそのまま表示する（独自計算なし）", () => {
  const readyHtml = nav.renderNavigationHealthPopover(opHealth());
  assert.match(readyHtml, /<div class="label">Deploy Ready<\/div><div class="value">Yes<\/div>/);
  assert.match(readyHtml, /<div class="label">Published Stale<\/div><div class="value">0<\/div>/);
  assert.match(readyHtml, /<div class="label">Published Orphan<\/div><div class="value">0<\/div>/);

  const warnHtml = nav.renderNavigationHealthPopover(opHealth({ published_stale: 3, deploy_ready: false, deploy_blocked: true }, "warning"));
  assert.match(warnHtml, /<div class="label">Deploy Ready<\/div><div class="value">No<\/div>/);
  assert.match(warnHtml, /<div class="label">Published Stale<\/div><div class="value">3<\/div>/);

  assert.ok(!readyHtml.includes("undefined") && !readyHtml.includes("NaN"));
  assert.ok(!warnHtml.includes("undefined") && !warnHtml.includes("NaN"));
});

// ===========================================================================
// Phase59 STEP12 — Navigation Consistency Finalization
// ===========================================================================

test("STEP12-B: deploy_ready / published_stale / published_orphan のいずれかが欠落していても Badge/Summary/Popover を完全に非表示にする", () => {
  function withoutField(field) {
    const data = opHealth();
    delete data.summary[field];
    return data;
  }
  for (const field of ["deploy_ready", "published_stale", "published_orphan"]) {
    const data = withoutField(field);
    assert.equal(nav.renderHealthBadge(data), "", `${field} 欠落時に Badge が非表示にならない`);
    assert.equal(nav.renderNavigationHealthSummary(data), "", `${field} 欠落時に Summary が非表示にならない`);
    assert.equal(nav.renderNavigationHealthPopover(data), "", `${field} 欠落時に Popover が非表示にならない`);
    assert.equal(nav.isLegacy(data), true, `${field} 欠落時に isLegacy が true を返さない`);
  }
});

test("STEP12-C: initNavigationHealth は AdminApi.getDashboardOperationalHealth() を1回だけ呼ぶ", async () => {
  let callCount = 0;
  const container = { innerHTML: "" };
  global.document = { getElementById: (id) => (id === "admin-operational-health-badge" ? container : null) };
  global.AdminApi = {
    getDashboardOperationalHealth: () => {
      callCount++;
      return Promise.resolve(opHealth());
    },
  };
  try {
    nav.initNavigationHealth();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(callCount, 1, "Navigation Health wiring は API を1回だけ呼ぶべき");
    assert.match(container.innerHTML, /🟢 Healthy/);
  } finally {
    delete global.document;
    delete global.AdminApi;
  }
});

test("STEP12-E: API由来の値（published_stale等）にHTML/scriptが混じっていてもエスケープされ、DOM注入されない", () => {
  const evil = opHealth({ published_stale: "<script>alert(1)</script>" });
  const summaryHtml = nav.renderNavigationHealthSummary(evil);
  const popoverHtml = nav.renderNavigationHealthPopover(evil);
  assert.doesNotMatch(summaryHtml, /<script>alert\(1\)<\/script>/);
  assert.match(summaryHtml, /&lt;script&gt;/);
  assert.doesNotMatch(popoverHtml, /<script>alert\(1\)<\/script>/);
  assert.match(popoverHtml, /&lt;script&gt;/);

  // status は固定マッピングのキー参照のみに使われるため、未知/悪性値は単にバッジ非表示になる
  const evilStatus = opHealth();
  evilStatus.status = "<script>alert(2)</script>";
  assert.equal(nav.renderHealthBadge(evilStatus), "", "未知の status 値は固定マッピングに無いため非表示（判定ロジックの追加なし）");
});

test("STEP13-F: 未知/不正な status（文字列だが success/warning/danger 以外）は Badge/Summary/Popover とも一貫して非表示になる", () => {
  function withStatus(status) {
    const data = opHealth();
    data.status = status;
    return data;
  }
  for (const status of ["unknown", "unexpected string", "SUCCESS", "", "Success", "warn", "error"]) {
    const data = withStatus(status);
    assert.equal(nav.isLegacy(data), true, `status=${JSON.stringify(status)} は legacy 扱いになるべき`);
    assert.equal(nav.renderHealthBadge(data), "", `status=${JSON.stringify(status)} で Badge が非表示にならない`);
    assert.equal(nav.renderNavigationHealthSummary(data), "", `status=${JSON.stringify(status)} で Summary が非表示にならない`);
    assert.equal(nav.renderNavigationHealthPopover(data), "", `status=${JSON.stringify(status)} で Popover が非表示にならない（STEP13-F 発見の不整合の回帰確認）`);
  }
  // 非文字列 status（number/null/undefined）でも例外なく legacy 扱いになる
  for (const status of [123, null, undefined, {}, []]) {
    const data = withStatus(status);
    assert.doesNotThrow(() => nav.renderNavigationHealthPopover(data));
    assert.equal(nav.renderNavigationHealthPopover(data), "");
  }
  // 既知の status は引き続き正常に表示される（過剰に厳しくなっていないことの確認）
  for (const status of ["success", "warning", "danger"]) {
    const data = withStatus(status);
    assert.notEqual(nav.renderHealthBadge(data), "", `status=${status} は表示されるべき`);
  }
});
