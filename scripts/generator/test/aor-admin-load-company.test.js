/**
 * aor-admin-load-company.test.js — website/aor-admin/server.jsのloadCompany()
 * backend化（PJ2 AOR Phase B-5）の自動テスト。
 *
 * 【なぜHTTPレベルのテストか】server.jsはmodule top-levelでenvCheck判定・非同期の
 * startServer()実行という副作用を持つ設計であり（既存の設計、今回のPhase B-5では
 * 変更しない）、require()で直接loadCompany()を取り出すテストは起動タイミングの
 * 扱いが煩雑になる。既存のrun-all-tests.jsのcheckDashboardSmoke()と同じ手法
 * （child_processでserver.jsを一時起動し、実HTTPで疎通確認する）を踏襲する。
 *
 * 【backend統合の証明方法】loadCompany()内部でreportStore.loadReport()/
 * reviewStore.loadReview()が実際に使われている（直接filesystemを読んでいない）ことを、
 * プロセス内でのspy注入ではなく、REPORT_STORE_BACKEND/REVIEW_STORE_BACKENDに
 * 意図的に未知の値を設定したサーバーインスタンスを別途起動し、その場合に応答が
 * 変化する（＝backend選択が効いている）ことで証明する。もしloadCompany()が
 * report.json/review.jsonを直接fsで読んでいたら、これらの環境変数を変えても
 * 応答は変化しないはずである。
 *
 * 【PJ2 AOR Phase B-6追記】review側（REVIEW_STORE_BACKEND）は、不正な値でも個別company
 * 取得だけが失敗し一覧取得自体は無傷のため、「200のまま中身が変わる」ことで証明できる。
 * 一方report側（REPORT_STORE_BACKEND）は、Phase B-6でcompany-index.jsのsource:"report"
 * 一覧取得も同じ環境変数を尊重するようになった結果、不正な値は起動時の
 * reportsCache初期化自体を失敗させ、サーバーが起動しなくなる（report一覧取得は
 * server.jsの起動シーケンスの一部であり、review一覧取得はそもそも存在しないため、
 * 両者で証明方法が非対称になる）。そのためreport側は「起動自体が失敗すること」を
 * もってbackend選択が効いている証拠とする。
 *
 * 既存データ（example.com等）には一切書き込まない。テスト専用のslug
 * （"test-aor-admin-load-company-poc"）をOUTPUT_DIR配下に作成し、テスト後に削除する。
 * 実AWSへは一切接続しない（REPORT_STORE_BACKEND/REVIEW_STORE_BACKENDに"s3"は使わず、
 * 意図的に無効な値"dynamodb"だけを使う）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const { OUTPUT_DIR } = require("../shared/paths");
const { saveReport } = require("../report-store");

const SERVER_PATH = path.join(__dirname, "..", "..", "..", "website", "aor-admin", "server.js");
const TEST_SLUG = "test-aor-admin-load-company-poc";
const ADMIN_USER = "aor-admin-load-company-test";
const ADMIN_PASSWORD = "aor-admin-load-company-test-password";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {number} port
 * @param {string} method
 * @param {string} pathName
 * @param {{auth?:string, cookie?:string, csrfToken?:string, body?:Object}} [options]
 * @returns {Promise<{status:number, headers:Object, body:string}>}
 */
function httpRequest(port, method, pathName, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (options.auth) headers.Authorization = `Basic ${Buffer.from(options.auth).toString("base64")}`;
    if (options.cookie) headers.Cookie = options.cookie;
    if (options.csrfToken) headers["X-CSRF-Token"] = options.csrfToken;
    let payload;
    if (options.body !== undefined) {
      payload = JSON.stringify(options.body);
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = http.request(
      { host: "localhost", port, path: pathName, method, headers, timeout: 5000 },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    if (payload) req.write(payload);
    req.end();
  });
}

/** Set-Cookieヘッダーから `sid=...` 部分だけを取り出す（後続リクエストのCookieヘッダー用）。 */
function extractSidCookie(setCookieHeader) {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  return raw.split(";")[0]; // "sid=xxxxx"
}

/**
 * @param {{port:number, env?:Object}} config
 * @returns {Promise<{child:import('child_process').ChildProcess, port:number}>}
 */
async function startServer(config) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: {
      ...process.env,
      ADMIN_USER,
      ADMIN_PASSWORD,
      ADMIN_PORT: String(config.port),
      JOB_SCHEDULER_ENABLED: "false",
      LLM_PROVIDER: "mock",
      SEARCH_PROVIDER: "mock",
      ...config.env,
    },
    stdio: "pipe",
  });

  // PJ2 AOR Phase B-6: 不正なREPORT_STORE_BACKEND等を指定した場合、サーバーは
  // 起動直後（reportsCache初期化失敗）にprocess.exitCode=1で終了する。この「起動しない」
  // ケースを固定回数のポーリング（従来: 30回×200ms=6秒）だけで待つと、並列実行時の
  // システム負荷次第で「本当は起動しているが応答がたまたま間に合わない」ケースと
  // 「本当に起動に失敗した」ケースを区別できず、テストがflakyになる。
  // childプロセスのexitイベントも同時に監視し、どちらが先に起きるかで判定することで、
  // 「起動失敗」を待つテストが無駄にタイムアウトいっぱい待つことも防ぐ。
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });

  let ready = false;
  for (let i = 0; i < 40; i += 1) {
    if (exited) break; // 起動に失敗して既にプロセスが終了している場合は待たずに諦める
    await sleep(200);
    try {
      await httpRequest(config.port, "GET", "/api/health");
      ready = true;
      break;
    } catch (e) {
      // まだ起動していない
    }
  }
  if (!ready) {
    child.kill();
    throw new Error(`サーバーが起動しませんでした（port ${config.port}）`);
  }
  return { child, port: config.port };
}

/** @param {string} slug */
function cleanupSlugDir(slug) {
  fs.rmSync(path.join(OUTPUT_DIR, slug), { recursive: true, force: true });
}

function sampleReport(overrides = {}) {
  return {
    id: `generated-${TEST_SLUG}`,
    meta: { schema_version: "2.4", generated_at: "2026-01-01T00:00:00.000Z", pipeline_version: "phase1-generator-v0.3-llm" },
    company_profile: { name: "PJ2 AOR Phase B-5テスト株式会社" },
    source_pages: [],
    free_opportunity: { summary: "test" },
    locked_opportunities: [],
    paid_analysis: {},
    evaluation: { score: 90, grade: "A", status: "PASS" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 通常backend（filesystem、既定）での回帰確認
// ---------------------------------------------------------------------------

test("server.js Phase B-5: report/review backend化後もDashboard API・review workflow・SSEが従来どおり動作する", async (t) => {
  cleanupSlugDir(TEST_SLUG);
  t.after(() => cleanupSlugDir(TEST_SLUG));

  await saveReport(TEST_SLUG, sampleReport());
  // review.jsonはあえて作らない（review未存在時のcreateEmptyReview()フォールバックを確認するため）。

  const port = 4620;
  const { child } = await startServer({ port });
  t.after(() => child.kill());

  try {
    // 未認証は401のまま
    const unauth = await httpRequest(port, "GET", "/api/reports");
    assert.equal(unauth.status, 401);

    // セッション確立（Basic認証 → Set-Cookie + csrf_token）
    const sessionRes = await httpRequest(port, "GET", "/api/session", { auth: `${ADMIN_USER}:${ADMIN_PASSWORD}` });
    assert.equal(sessionRes.status, 200);
    const cookie = extractSidCookie(sessionRes.headers["set-cookie"]);
    const { csrf_token: csrfToken } = JSON.parse(sessionRes.body);
    assert.ok(csrfToken);

    // GET /api/reports: 一覧にテスト対象slugが含まれる（レスポンス形式は従来どおりの配列）
    const reportsRes = await httpRequest(port, "GET", "/api/reports", { cookie });
    assert.equal(reportsRes.status, 200);
    const reports = JSON.parse(reportsRes.body);
    assert.ok(Array.isArray(reports));
    const summary = reports.find((r) => r.id === TEST_SLUG);
    assert.ok(summary, "一覧にテスト対象companyが含まれるはず");
    assert.equal(summary.review_status, "pending_review", "review.json未存在時はpending_review相当のはず");

    // GET /api/report/:slug: report/review/publishable/validationを含む既存レスポンス形式
    const reportDetail = await httpRequest(port, "GET", `/api/report/${TEST_SLUG}`, { cookie });
    assert.equal(reportDetail.status, 200);
    const detailBody = JSON.parse(reportDetail.body);
    assert.equal(detailBody.id, TEST_SLUG);
    assert.equal(detailBody.report.company_profile.name, "PJ2 AOR Phase B-5テスト株式会社");
    assert.equal(detailBody.review.status, "pending_review");
    assert.equal(typeof detailBody.publishable, "boolean");
    assert.ok(detailBody.validation && detailBody.validation.report && detailBody.validation.review);

    // GET /api/status/:slug
    const statusRes = await httpRequest(port, "GET", `/api/status/${TEST_SLUG}`, { cookie });
    assert.equal(statusRes.status, 200);
    assert.equal(JSON.parse(statusRes.body).review.status, "pending_review");

    // POST /api/comment/:slug: review workflow（保存→再読み込み）が壊れていないこと
    const commentRes = await httpRequest(port, "POST", `/api/comment/${TEST_SLUG}`, {
      cookie,
      csrfToken,
      body: { text: "Phase B-5テスト用コメント" },
    });
    assert.equal(commentRes.status, 200);
    const commentBody = JSON.parse(commentRes.body);
    assert.equal(commentBody.review.comments.length, 1);
    assert.equal(commentBody.review.comments[0].text, "Phase B-5テスト用コメント");

    // コメントが実際に永続化され、再読み込みでも反映されていること（loadCompany()の
    // 読み込み側がreviewStore経由で正しく最新状態を返すことの確認）
    const statusAfterComment = await httpRequest(port, "GET", `/api/status/${TEST_SLUG}`, { cookie });
    const reviewAfterComment = JSON.parse(statusAfterComment.body).review;
    assert.equal(reviewAfterComment.comments.length, 1);

    // POST /api/approve/:slug: publishable判定ロジック（review-engine.js）が従来どおり機能する
    const approveRes = await httpRequest(port, "POST", `/api/approve/${TEST_SLUG}`, { cookie, csrfToken, body: {} });
    assert.equal(approveRes.status, 200);
    const approveBody = JSON.parse(approveRes.body);
    assert.equal(approveBody.review.status, "approved");
    assert.equal(approveBody.publishable, true, "evaluation.status=PASSかつapprovedならpublishableのはず");

    // SSE /api/events: 初回送信内容が配列JSONのままであること
    const sseData = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: "localhost", port, path: "/api/events", method: "GET", headers: { Cookie: cookie }, timeout: 3000 },
        (res) => {
          res.once("data", (chunk) => {
            resolve(chunk.toString());
            req.destroy();
          });
        }
      );
      req.on("error", (err) => {
        if (err.code === "ECONNRESET") return; // req.destroy()後の想定内エラー
        reject(err);
      });
      req.end();
    });
    assert.ok(sseData.startsWith("data: "));
    const ssePayload = JSON.parse(sseData.slice("data: ".length).trim());
    assert.ok(Array.isArray(ssePayload));
  } finally {
    child.kill();
  }
});

// ---------------------------------------------------------------------------
// backend選択が実際に効いていることの証明（直接filesystem読み込みへの先祖返りがないこと）
// ---------------------------------------------------------------------------

test("server.js Phase B-5〜B-6: REPORT_STORE_BACKENDへ不正な値を設定すると、report一覧取得(company-index.js経由)がstartup時に失敗し、サーバー自体が起動しない", async () => {
  // PJ2 AOR Phase B-6で、company-index.jsのlistCompanySlugs({source:"report"})が
  // REPORT_STORE_BACKEND環境変数を尊重するようになった（Phase B-5時点では常に
  // filesystemだった）。server.jsのstartServer()は起動時に
  // `reportsCache = await listCompanySummaries()`（内部でlistCompanySlugs({source:"report"})
  // を呼ぶ）をtry/catchなしで実行するため、不正なREPORT_STORE_BACKENDは
  // reportsCache初期化自体を失敗させ、サーバーが起動しなくなる
  // （`startServer().catch(...)`がprocess.exitCode=1にする、既存の起動シーケンス。
  // server.js自体は今回変更していない）。
  //
  // これはPhase B-5時点の「個別company取得（reportStore.loadReport()）だけが404になり、
  // 一覧取得自体は無傷」という挙動からの意図した変化である
  // （Phase B-5時点のテストはこの前提が崩れたため、Phase B-6でこのテストへ置き換えた）。
  // 「起動しなくなること」自体が、company-index.jsのbackend選択が実際にサーバーの
  // 起動シーケンスまで一貫して効いていることの証拠になる（もしlistCompanySlugsが
  // REPORT_STORE_BACKENDを無視していたら、起動は従来どおり成功したはず）。
  const port = 4621;
  await assert.rejects(
    () => startServer({ port, env: { REPORT_STORE_BACKEND: "dynamodb" } }),
    /サーバーが起動しませんでした/
  );
});

test("server.js Phase B-5: review.jsonの読み込みはreviewStore経由（REVIEW_STORE_BACKENDの変更が応答に反映される）", async (t) => {
  cleanupSlugDir(TEST_SLUG);
  t.after(() => cleanupSlugDir(TEST_SLUG));
  await saveReport(TEST_SLUG, sampleReport());

  // 通常backendのサーバーでまず承認済みreview.jsonを作っておく
  const normalPort = 4622;
  const normalServer = await startServer({ port: normalPort });
  try {
    const sessionRes = await httpRequest(normalPort, "GET", "/api/session", { auth: `${ADMIN_USER}:${ADMIN_PASSWORD}` });
    const cookie = extractSidCookie(sessionRes.headers["set-cookie"]);
    const { csrf_token: csrfToken } = JSON.parse(sessionRes.body);
    const approveRes = await httpRequest(normalPort, "POST", `/api/approve/${TEST_SLUG}`, { cookie, csrfToken, body: {} });
    assert.equal(JSON.parse(approveRes.body).review.status, "approved");
  } finally {
    normalServer.child.kill();
  }

  // REVIEW_STORE_BACKENDに未知の値を与えた別インスタンスで同じslugを見ると、
  // 実在するreview.json（approved）を読めず、reviewStore.loadReview()の
  // 「読み込み失敗→createEmptyReview()相当」フォールバック（loadCompany()内のtry/catch）
  // により、review.statusがpending_review（未承認）に戻って見えるはず。
  // もしloadCompany()が直接fsでreview.jsonを読んでいたら、この環境変数は無視されて
  // 従来どおりapprovedのまま返ってしまう。
  const brokenPort = 4623;
  const brokenServer = await startServer({ port: brokenPort, env: { REVIEW_STORE_BACKEND: "dynamodb" } });
  t.after(() => {
    brokenServer.child.kill();
    cleanupSlugDir(TEST_SLUG);
  });

  try {
    const sessionRes = await httpRequest(brokenPort, "GET", "/api/session", { auth: `${ADMIN_USER}:${ADMIN_PASSWORD}` });
    const cookie = extractSidCookie(sessionRes.headers["set-cookie"]);

    const statusRes = await httpRequest(brokenPort, "GET", `/api/status/${TEST_SLUG}`, { cookie });
    assert.equal(statusRes.status, 200, "reportは正常に読めるためcompany自体は見つかるはず");
    const review = JSON.parse(statusRes.body).review;
    assert.equal(
      review.status,
      "pending_review",
      "reviewStore経由でなければ本来approvedのまま返ってしまうはずの箇所"
    );
  } finally {
    brokenServer.child.kill();
  }
});
