/**
 * system-session-fetch-dedup.test.js — Phase61 STEP3。
 *
 * system.html / system.js で発生していた GET /api/session の二重fetch
 * （init() が #user-label 表示用に1回、load() が Promise.allSettled 内でさらに1回）を
 * 解消したことを確認する。
 *
 * 対策: init() が取得した /api/session の Promise を load(sessionResult) へ渡し、
 * load() 側は resolveSessionPromise(sessionResult) でそれが thenable なら再利用し、
 * そうでなければ（Refresh ボタンの click ハンドラから直接呼ばれた場合 = DOM の Event
 * オブジェクトが渡る、または省略された場合）従来どおり新しく AdminApi.getSession() を呼ぶ。
 * これにより、初回ページロードでは /api/session が1回だけ呼ばれ、Refresh 押下時は
 * 最新のセッション状態を取り直す（古いセッション結果を固定してしまわない）。
 *
 * 【テスト方針】init()/load() は DOM に依存するため、Phase59 STEP11 の
 * initNavigationHealth() テストと同じ手法（global.document / global.AdminApi の
 * スタブ化）で検証する。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const SYSTEM_JS_PATH = require.resolve(path.join("..", "..", "..", "website", "aor-admin", "public", "assets", "js", "system.js"));

function freshRequire(modulePath) {
  delete require.cache[modulePath];
  return require(modulePath);
}

/** id → 簡易DOM要素 の map を持つ document スタブを作る。 */
function makeFakeDocument() {
  var elements = {};
  function elFor(id) {
    if (!elements[id]) {
      elements[id] = {
        id: id,
        textContent: "",
        innerHTML: "",
        disabled: false,
        _listeners: {},
        setAttribute: function () {},
        removeAttribute: function () {},
        addEventListener: function (type, handler) {
          this._listeners[type] = handler;
        },
      };
    }
    return elements[id];
  }
  return {
    elements: elements,
    getElementById: function (id) {
      // 既知のシステム画面のDOM要素のみ返す（他は無し扱い）
      if (["user-label", "system-refresh", "system-container"].indexOf(id) !== -1) return elFor(id);
      return null;
    },
  };
}

/** AdminApi の最小スタブ（getSession の呼び出し回数をカウントする）。 */
function makeAdminApiStub(overrides) {
  var sessionCalls = 0;
  var base = {
    sessionCalls: function () {
      return sessionCalls;
    },
    getSession: function () {
      sessionCalls++;
      return Promise.resolve({ username: "admin" });
    },
    getHealth: function () {
      return Promise.resolve({ status: "ok", checks: { auth: true } });
    },
    getDashboardHealth: function () {
      return Promise.resolve({ ses: {}, lambda: {}, cloudfront: {}, blastengine: {} });
    },
    getDashboardReports: function () {
      return Promise.resolve({ generated: 9, approved: 5, published_backend: 4, web_deployed: 10, deploy_pending: 0, pending_slugs: [] });
    },
    getDashboardOperationalHealth: function () {
      return Promise.resolve({
        ok: true,
        status: "success",
        summary: { deploy_ready: true, deploy_blocked: false, published_stale: 0, published_orphan: 0, generated_reports: 9, approved_reports: 5, published_reports: 4 },
      });
    },
  };
  return Object.assign(base, overrides || {});
}

test("A: init() の通常初期化フローで /api/session は1回だけ呼ばれる（user-label と load() 側で共有）", async () => {
  var fakeDocument = makeFakeDocument();
  var stub = makeAdminApiStub();
  global.document = fakeDocument;
  global.AdminApi = stub;
  try {
    const systemUi = freshRequire(SYSTEM_JS_PATH);
    await systemUi.init();
    assert.equal(stub.sessionCalls(), 1, "init()の通常フローでは/api/sessionは1回だけ呼ばれるべき");
    assert.equal(fakeDocument.elements["user-label"].textContent, "admin でログイン中");
    // load() 側の描画にも同じセッション由来の情報が反映されていること（renderSystem経由）
    assert.match(fakeDocument.elements["system-container"].innerHTML, /admin/, "load()側の描画にも同じsession結果が反映されているはず");
  } finally {
    delete global.document;
    delete global.AdminApi;
  }
});

test("B: Shared result — init()が取得したPromiseとload()が使う値は同一のsessionレスポンスに由来する", async () => {
  var fakeDocument = makeFakeDocument();
  var capturedSessions = [];
  var stub = makeAdminApiStub({
    getSession: function () {
      var value = { username: "shared-user-" + capturedSessions.length };
      capturedSessions.push(value);
      return Promise.resolve(value);
    },
  });
  global.document = fakeDocument;
  global.AdminApi = stub;
  try {
    const systemUi = freshRequire(SYSTEM_JS_PATH);
    await systemUi.init();
    assert.equal(capturedSessions.length, 1, "getSessionの実呼び出しは1回のみのはず");
    assert.equal(fakeDocument.elements["user-label"].textContent, "shared-user-0 でログイン中");
    assert.match(fakeDocument.elements["system-container"].innerHTML, /shared-user-0/);
  } finally {
    delete global.document;
    delete global.AdminApi;
  }
});

test("C: Failure — /api/session が失敗しても既存のfallback（user-label更新スキップ・load()はsession欄を{}扱い）が維持される", async () => {
  var fakeDocument = makeFakeDocument();
  var stub = makeAdminApiStub({
    getSession: function () {
      return Promise.reject(new Error("認証エラー: セッション切れ"));
    },
  });
  global.document = fakeDocument;
  global.AdminApi = stub;
  try {
    const systemUi = freshRequire(SYSTEM_JS_PATH);
    await assert.doesNotReject(() => systemUi.init(), "session失敗時も例外を投げず続行するはず");
    // session失敗時はエラー内のtryブロックが早期に例外を投げるため、user-labelへのアクセス自体が
    // 発生しない（既存仕様。#user-label要素は"admin でログイン中"のような更新をされない）。
    var userLabelEl = fakeDocument.elements["user-label"];
    assert.ok(!userLabelEl || userLabelEl.textContent === "", "session失敗時はuser-labelを更新しない（既存仕様）");
    // load()側は authFailed 判定により「セッションの有効期限が切れています」表示になる（既存仕様）
    assert.match(fakeDocument.elements["system-container"].innerHTML, /セッションの有効期限が切れています/);
  } finally {
    delete global.document;
    delete global.AdminApi;
  }
});

test("D: Refresh相当（load()をsessionResultなしで再実行）では新しく/api/sessionを取得し直す（永続キャッシュにしない）", async () => {
  var fakeDocument = makeFakeDocument();
  var stub = makeAdminApiStub();
  global.document = fakeDocument;
  global.AdminApi = stub;
  try {
    const systemUi = freshRequire(SYSTEM_JS_PATH);
    await systemUi.init();
    assert.equal(stub.sessionCalls(), 1, "初回ロードは1回");

    // Refreshボタンのクリックハンドラは load を引数なしで呼ぶ（addEventListenerの元設計と同じ想定）
    await systemUi.load();
    assert.equal(stub.sessionCalls(), 2, "Refresh相当の再実行では新しくfetchし直すはず（古いsessionを固定しない）");
  } finally {
    delete global.document;
    delete global.AdminApi;
  }
});

test("D-2: load() がDOMのclickイベント相当の非thenable値を受け取っても、誤ってそれをsession Promiseとして扱わず新規fetchする", async () => {
  var fakeDocument = makeFakeDocument();
  var stub = makeAdminApiStub();
  global.document = fakeDocument;
  global.AdminApi = stub;
  try {
    const systemUi = freshRequire(SYSTEM_JS_PATH);
    var fakeClickEvent = { type: "click", target: {} }; // Promiseではない
    await systemUi.load(fakeClickEvent);
    assert.equal(stub.sessionCalls(), 1, "非thenableな引数は無視して新規fetchするはず");
    assert.doesNotThrow(() => {}, "Event相当のオブジェクトをPromiseとして扱ってエラーにならない");
  } finally {
    delete global.document;
    delete global.AdminApi;
  }
});

test("resolveSessionPromise: thenableならそのまま返し、非thenable/未指定ならAdminApi.getSession()を呼ぶ", async () => {
  var stub = makeAdminApiStub();
  global.AdminApi = stub;
  try {
    const systemUi = freshRequire(SYSTEM_JS_PATH);
    var existingPromise = Promise.resolve({ username: "x" });
    assert.equal(systemUi.resolveSessionPromise(existingPromise), existingPromise, "thenableはそのまま再利用されるはず");
    assert.equal(stub.sessionCalls(), 0, "thenableを渡した場合は新規fetchしないはず");

    await systemUi.resolveSessionPromise(undefined);
    assert.equal(stub.sessionCalls(), 1, "未指定なら新規fetchするはず");

    await systemUi.resolveSessionPromise({ notAPromise: true });
    assert.equal(stub.sessionCalls(), 2, "非thenableオブジェクトなら新規fetchするはず");
  } finally {
    delete global.AdminApi;
  }
});

test("No regression: Operational Health / Health Checks 等の既存描画は本STEPの変更で壊れていない", async () => {
  var fakeDocument = makeFakeDocument();
  var stub = makeAdminApiStub();
  global.document = fakeDocument;
  global.AdminApi = stub;
  try {
    const systemUi = freshRequire(SYSTEM_JS_PATH);
    await systemUi.init();
    var html = fakeDocument.elements["system-container"].innerHTML;
    assert.match(html, /Application/);
    assert.match(html, /Health Checks/);
    assert.match(html, /Report Pipeline/);
    assert.match(html, /Published Artifact Health/);
    assert.ok(!html.includes("undefined") && !html.includes("NaN"));
  } finally {
    delete global.document;
    delete global.AdminApi;
  }
});
