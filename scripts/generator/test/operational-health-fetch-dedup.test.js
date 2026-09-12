/**
 * operational-health-fetch-dedup.test.js — Phase61 STEP2。
 *
 * dashboard.html / operations.html / reports.html / system.html の4画面で発生していた
 * GET /api/dashboard/operational-health の二重fetch（ページ固有Health Cardが1回、
 * Navigation Health Badge（app.js）が1回）を解消したことを確認する。
 *
 * 対策: app.js に fetchOperationalHealthOnce()（同一ページ読み込み中のfetchをメモ化する
 * 薄いラッパー）を追加し、4画面それぞれの load() が呼ぶ AdminApi.getDashboardOperationalHealth()
 * を fetchOperationalHealthShared()（NavigationHealth.fetchOperationalHealthOnce() があれば
 * それを使い、無ければ従来どおり AdminApi を直接呼ぶフォールバック）に置き換えた。
 *
 * 【テスト方針】load() 自体はDOM専用のため module.exports に含めていない（既存パターンと同じ）。
 * そのためここでは、実際に「同一ページ読み込み中に発火する2箇所の呼び出し」を模した形で
 * fetchOperationalHealthShared()（ページ側）と NavigationHealth.fetchOperationalHealthOnce()
 * （app.js側）を両方呼び出し、実際の AdminApi 呼び出し回数を stub でカウントして検証する。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const APP_JS_PATH = require.resolve(path.join("..", "..", "..", "website", "aor-admin", "public", "assets", "js", "app.js"));
const PAGE_JS_PATHS = {
  dashboard: require.resolve(path.join("..", "..", "..", "website", "aor-admin", "public", "assets", "js", "dashboard.js")),
  operations: require.resolve(path.join("..", "..", "..", "website", "aor-admin", "public", "assets", "js", "operations.js")),
  reports: require.resolve(path.join("..", "..", "..", "website", "aor-admin", "public", "assets", "js", "reports.js")),
  system: require.resolve(path.join("..", "..", "..", "website", "aor-admin", "public", "assets", "js", "system.js")),
};

function freshRequire(modulePath) {
  delete require.cache[modulePath];
  return require(modulePath);
}

function healthPayload(status) {
  return {
    ok: true,
    status: status || "success",
    summary: {
      deploy_ready: status !== "danger" && status !== "warning",
      deploy_blocked: status === "danger" || status === "warning",
      published_stale: status === "warning" ? 1 : 0,
      published_orphan: status === "danger" ? 1 : 0,
      recommended_republish: 0,
      recommended_unpublish: 0,
      generated_reports: 9,
      approved_reports: 5,
      published_reports: 4,
    },
  };
}

/** AdminApi.getDashboardOperationalHealth() の呼び出し回数をカウントする stub を作る。 */
function makeCountingAdminApi(payload) {
  var calls = 0;
  return {
    calls: function () {
      return calls;
    },
    getDashboardOperationalHealth: function () {
      calls++;
      return Promise.resolve(payload);
    },
  };
}

for (const page of ["dashboard", "operations", "reports", "system"]) {
  test(`${page}.js: 同一ページ読み込み中は AdminApi.getDashboardOperationalHealth() が1回だけ呼ばれる（Navigation Badge分とページ固有Health Card分を共有）`, async () => {
    const stub = makeCountingAdminApi(healthPayload("success"));
    global.AdminApi = stub;
    try {
      const appUi = freshRequire(APP_JS_PATH);
      global.NavigationHealth = appUi;
      const pageUi = freshRequire(PAGE_JS_PATHS[page]);

      // 実際のブラウザでは script 読み込み順序（api.js→status.js→app.js→page.js）により
      // app.js の initNavigationHealth() がページ固有 JS の load() より先に発火する。
      // ここではその「ほぼ同時に2箇所から呼ばれる」状況を、app.js 側 → ページ側の順で
      // 再現する。
      const navPromise = appUi.fetchOperationalHealthOnce();
      const pagePromise = pageUi.fetchOperationalHealthShared();

      const [navResult, pageResult] = await Promise.all([navPromise, pagePromise]);

      assert.equal(stub.calls(), 1, `${page}.js: AdminApi.getDashboardOperationalHealth() は1回だけ呼ばれるべき`);
      assert.deepEqual(navResult, pageResult, "Navigation Badge とページ固有Health Cardは同じ結果を共有するべき");
      assert.deepEqual(navResult, healthPayload("success"));
    } finally {
      delete global.AdminApi;
      delete global.NavigationHealth;
    }
  });
}

test("fetchOperationalHealthShared: NavigationHealth が無い場合は AdminApi を直接呼ぶ（後方互換フォールバック）", async () => {
  const stub = makeCountingAdminApi(healthPayload("success"));
  global.AdminApi = stub;
  try {
    // NavigationHealth を定義しない（app.js が読み込まれていない状況を模す）
    const dashboardUi = freshRequire(PAGE_JS_PATHS.dashboard);
    const result = await dashboardUi.fetchOperationalHealthShared();
    assert.equal(stub.calls(), 1);
    assert.deepEqual(result, healthPayload("success"));
  } finally {
    delete global.AdminApi;
  }
});

test("Shared fetch: 各状態（healthy/warning/danger）を取得しても、Navigation Badgeとページ固有Health Cardが同じ結果を受け取る", async () => {
  for (const status of ["success", "warning", "danger"]) {
    const stub = makeCountingAdminApi(healthPayload(status));
    global.AdminApi = stub;
    try {
      const appUi = freshRequire(APP_JS_PATH);
      global.NavigationHealth = appUi;
      const dashboardUi = freshRequire(PAGE_JS_PATHS.dashboard);

      const [navResult, pageResult] = await Promise.all([appUi.fetchOperationalHealthOnce(), dashboardUi.fetchOperationalHealthShared()]);
      assert.equal(stub.calls(), 1, `status=${status}: 呼び出しは1回のはず`);
      assert.deepEqual(navResult, pageResult);
      assert.equal(navResult.status, status);

      // 両者が実際に同じデータで正しく描画できることも確認する（既存の isLegacy/renderHealthBadge を利用）。
      assert.equal(appUi.isLegacy(navResult), false, `status=${status} は既知の値なので legacy 扱いにならないはず`);
      const badge = appUi.renderHealthBadge(navResult);
      assert.notEqual(badge, "", `status=${status} のバッジは表示されるはず`);
    } finally {
      delete global.AdminApi;
      delete global.NavigationHealth;
    }
  }
});

test("Shared fetch: API失敗時は Navigation Badge・ページ固有Health Card 双方が既存どおりの失敗として扱う（片方だけエラーになる不整合が無い）", async () => {
  var calls = 0;
  global.AdminApi = {
    getDashboardOperationalHealth: function () {
      calls++;
      return Promise.reject(new Error("network error"));
    },
  };
  try {
    const appUi = freshRequire(APP_JS_PATH);
    global.NavigationHealth = appUi;
    const dashboardUi = freshRequire(PAGE_JS_PATHS.dashboard);

    const navPromise = appUi.fetchOperationalHealthOnce();
    const pagePromise = dashboardUi.fetchOperationalHealthShared();

    const results = await Promise.allSettled([navPromise, pagePromise]);
    assert.equal(calls, 1, "失敗時も呼び出しは1回だけのはず");
    assert.equal(results[0].status, "rejected");
    assert.equal(results[1].status, "rejected");
    assert.equal(results[0].reason.message, "network error");
    assert.equal(results[1].reason.message, "network error");
  } finally {
    delete global.AdminApi;
    delete global.NavigationHealth;
  }
});

test("Shared fetch: legacy/malformed レスポンスでも Navigation Badge は非表示、ページ固有側も同じ生データを受け取る", async () => {
  const legacyPayload = { ok: true, status: "success", summary: { deploy_ready: true } }; // generated_reports 等が無い
  const stub = makeCountingAdminApi(legacyPayload);
  global.AdminApi = stub;
  try {
    const appUi = freshRequire(APP_JS_PATH);
    global.NavigationHealth = appUi;
    const systemUi = freshRequire(PAGE_JS_PATHS.system);

    const [navResult, pageResult] = await Promise.all([appUi.fetchOperationalHealthOnce(), systemUi.fetchOperationalHealthShared()]);
    assert.equal(stub.calls(), 1);
    assert.deepEqual(navResult, pageResult);
    assert.equal(appUi.isLegacy(navResult), true, "generated_reports 等が無ければ legacy 扱いになるはず");
    assert.equal(appUi.renderHealthBadge(navResult), "", "legacy レスポンスでは Badge を表示しない");
  } finally {
    delete global.AdminApi;
    delete global.NavigationHealth;
  }
});

test("後続の呼び出し（Refreshボタン相当）ではキャッシュが再利用されず、新しい fetch が行われる", async () => {
  const stub = makeCountingAdminApi(healthPayload("success"));
  global.AdminApi = stub;
  try {
    const appUi = freshRequire(APP_JS_PATH);
    await appUi.fetchOperationalHealthOnce(); // 初回ロード相当
    assert.equal(stub.calls(), 1);

    await appUi.fetchOperationalHealthOnce(); // Refreshボタン等による再読み込み相当
    assert.equal(stub.calls(), 2, "1回目が解決した後の呼び出しは新しくfetchするべき（Refreshで最新値が取れなくなる回帰を防ぐ）");
  } finally {
    delete global.AdminApi;
  }
});

// ===========================================================================
// D: 他5ページ（index/leads/deliveries/suppressions/jobs）は元々 Navigation Health の
// 1回fetchのみで、ページ固有の Operational Health 取得を持たない（本STEPで変更もしていない）。
// ===========================================================================

test("index/leads/deliveries/suppressions/jobs のJSは元々 AdminApi.getDashboardOperationalHealth() を呼んでいない（Navigation Health Badgeの1回fetchのみ）", () => {
  const fs = require("fs");
  for (const name of ["list", "leads", "deliveries", "suppressions", "jobs"]) {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "assets", "js", name + ".js"),
      "utf8"
    );
    assert.ok(!src.includes("AdminApi.getDashboardOperationalHealth"), `${name}.js は Operational Health を直接fetchしていないはず（Navigation Badgeの1回のみ）`);
  }
});
