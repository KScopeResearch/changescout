/**
 * security.test.js — Task23: セキュリティ関連の自動テスト。
 *
 * 対象（Task23完了報告「⑦追加テスト内容」参照）:
 *   1. secretがログに出ない（job-runner.js: writeHistory()のredactSecrets()適用）
 *   2. 未認証API拒否（website/aor-admin/server.js）
 *   3. CSRF拒否（同上）
 *
 * 2・3はwebsite/aor-admin/server.jsを子プロセスとして一時ポートで起動して確認する
 * （run-all-tests.jsのcheckDashboardSmoke()と同じ方式。既存の認証済み200・未認証401の
 * 確認自体はrun-all-tests.jsのDashboard確認ですでに行っているが、あちらはCLIの
 * 品質ゲート用であり、node:testのテストスイートとしては独立に存在しなかったため追加する。
 * CSRF拒否のテストはこれまでどこにも自動テストが無かった）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const { redactSecrets } = require("../shared/redact");
const { GENERATOR_DIR, OUTPUT_DIR } = require("../shared/paths");
const { readJson, writeJson } = require("../shared/json-file");
const engine = require("../review/review-engine");

// ---------------------------------------------------------------------------
// 1. secretがログに出ない（job-runner.js統合テスト）
// ---------------------------------------------------------------------------

test("job-runner: providerのエラーメッセージに含まれる秘密情報らしき文字列は、job-history.jsonlにredactされた形でのみ記録される", async () => {
  const runner = require("../jobs/job-runner");
  const store = require("../jobs/job-store");
  const engine = require("../jobs/job-engine");
  const { readJsonLines } = require("../shared/json-file");

  const FAKE_SECRET = "sk-THIS-IS-A-FAKE-SECRET-1234567890";
  const original = engine.execute;
  engine.execute = async (type, params) => {
    if (type !== "test-secret-in-error") return original(type, params);
    // 実providerのエラーメッセージ（外部APIのレスポンス本文をそのまま含む）を模したエラー。
    throw new Error(`OpenAI API エラー: HTTP 401 Incorrect API key provided: ${FAKE_SECRET}`);
  };
  engine.JOB_TYPES.push("test-secret-in-error"); // enqueue()の型検証を通すため（jobs.test.jsと同じ手法）

  try {
    const job = runner.enqueue("test-secret-in-error", {}, { maxAttempts: 1 });
    await new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const j = store.getJob(job.id);
        if (j && j.status === "failed") return resolve(j);
        if (Date.now() - start > 10000) return reject(new Error("timeout"));
        setTimeout(check, 50);
      };
      check();
    });

    const lastEntry = readJsonLines(runner.HISTORY_PATH).slice(-1)[0];
    assert.equal(lastEntry.job_id, job.id);
    assert.ok(!lastEntry.error.includes(FAKE_SECRET), "job-history.jsonlに秘密情報がそのまま記録されてはならない");
    assert.ok(lastEntry.error.includes("[REDACTED]"), "秘密情報はredactSecrets()により[REDACTED]に置き換えられているはず");
  } finally {
    engine.execute = original;
  }
});

test("redactSecrets: 単体でも秘密情報を除去する（上記の統合テストが依存する前提の再確認）", () => {
  const out = redactSecrets("Incorrect API key provided: sk-THIS-IS-A-FAKE-SECRET-1234567890");
  assert.ok(!out.includes("1234567890"));
});

// ---------------------------------------------------------------------------
// 2・3. 未認証API拒否・CSRF拒否（website/aor-admin/server.jsを一時ポートで起動）
// ---------------------------------------------------------------------------

const TEST_PORT = 4602; // run-all-tests.js（4601）・通常運用（4600）と衝突しない専用ポート
const ADMIN_USER = "security-test-admin";
const ADMIN_PASSWORD = "security-test-password";

/**
 * @param {{path:string, method?:string, auth?:string, cookie?:string, headers?:Object, body?:string, port?:number}} options
 * @returns {Promise<{status:number, headers:Object, body:string}>}
 */
function httpRequest(options) {
  return new Promise((resolve, reject) => {
    const headers = { ...(options.headers || {}) };
    if (options.auth) headers.Authorization = `Basic ${Buffer.from(options.auth).toString("base64")}`;
    if (options.cookie) headers.Cookie = options.cookie;
    if (options.body) headers["Content-Type"] = "application/json";

    const req = http.request(
      {
        host: "localhost",
        port: options.port || TEST_PORT, // Task41: レート制限テストで別ポートのサーバーを使うために追加
        path: options.path,
        method: options.method || "GET",
        headers,
        timeout: 3000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    if (options.body) req.write(options.body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("website/aor-admin/server.js: 未認証アクセスは401、認証済みは200、POSTはCSRFトークン無しだと403", async (t) => {
  const serverPath = path.join(GENERATOR_DIR, "..", "..", "website", "aor-admin", "server.js");
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, ADMIN_USER, ADMIN_PASSWORD, ADMIN_PORT: String(TEST_PORT) },
    stdio: "pipe",
  });
  let serverErrorOutput = "";
  child.stderr.on("data", (chunk) => (serverErrorOutput += chunk.toString()));
  t.after(() => child.kill());

  // 起動待ち（最大5秒）。/api/healthは認証不要のためこれで起動確認する。
  let ready = false;
  for (let i = 0; i < 25; i++) {
    await sleep(200);
    try {
      const res = await httpRequest({ path: "/api/health" });
      if (res.status === 200 || res.status === 503) {
        ready = true;
        break;
      }
    } catch (e) {
      // まだ起動していない
    }
  }
  assert.ok(ready, `テスト用サーバーが起動しませんでした: ${serverErrorOutput}`);

  // 2. 未認証API拒否
  const unauth = await httpRequest({ path: "/api/reports" });
  assert.equal(unauth.status, 401);
  assert.match(unauth.headers["www-authenticate"] || "", /Basic/);

  // Basic認証でセッションCookie・CSRFトークンを取得する
  const authed = await httpRequest({ path: "/api/session", auth: `${ADMIN_USER}:${ADMIN_PASSWORD}` });
  assert.equal(authed.status, 200);
  const session = JSON.parse(authed.body);
  assert.ok(session.csrf_token);

  const setCookieHeader = authed.headers["set-cookie"];
  assert.ok(setCookieHeader && setCookieHeader.length, "ログイン成功時にSet-Cookieが返るはず");
  const sidCookie = setCookieHeader[0].split(";")[0]; // "sid=..."

  // Cookieのみで（Basic認証なしで）認証済みとして扱われることを確認
  const withCookie = await httpRequest({ path: "/api/reports", cookie: sidCookie });
  assert.equal(withCookie.status, 200);

  // 3. CSRF拒否: 有効なセッションCookieはあるが、X-CSRF-Tokenヘッダーが無いPOSTは403
  const postWithoutCsrf = await httpRequest({
    path: "/api/comment/example.com",
    method: "POST",
    cookie: sidCookie,
    body: JSON.stringify({ text: "csrf無しテスト" }),
  });
  assert.equal(postWithoutCsrf.status, 403);

  // 正しいCSRFトークンを付ければ通る（company not foundの404にはなりうるが、403にはならない）
  const postWithCsrf = await httpRequest({
    path: "/api/comment/no-such-company",
    method: "POST",
    cookie: sidCookie,
    headers: { "X-CSRF-Token": session.csrf_token },
    body: JSON.stringify({ text: "csrf有りテスト" }),
  });
  assert.notEqual(postWithCsrf.status, 403);
});

// ---------------------------------------------------------------------------
// ログイン試行レート制限（Task41）
// ---------------------------------------------------------------------------

/** @param {number} port @param {import("node:test").TestContext} t @returns {Promise<void>} */
async function startTestServer(port, t) {
  const serverPath = path.join(GENERATOR_DIR, "..", "..", "website", "aor-admin", "server.js");
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, ADMIN_USER, ADMIN_PASSWORD, ADMIN_PORT: String(port) },
    stdio: "pipe",
  });
  let serverErrorOutput = "";
  child.stderr.on("data", (chunk) => (serverErrorOutput += chunk.toString()));
  t.after(() => child.kill());

  let ready = false;
  for (let i = 0; i < 25; i++) {
    await sleep(200);
    try {
      const res = await httpRequest({ path: "/api/health", port });
      if (res.status === 200 || res.status === 503) {
        ready = true;
        break;
      }
    } catch (e) {
      // まだ起動していない
    }
  }
  assert.ok(ready, `テスト用サーバーが起動しませんでした: ${serverErrorOutput}`);
}

test("ログイン試行レート制限（Task41）: 閾値未満の失敗では正しい認証情報で通常どおりログインできる", async (t) => {
  const port = 4603;
  await startTestServer(port, t);

  // 2回失敗（閾値5回未満）
  for (let i = 0; i < 2; i++) {
    const res = await httpRequest({ path: "/api/reports", auth: `${ADMIN_USER}:wrong-password`, port });
    assert.equal(res.status, 401);
  }

  // ブロックされておらず、正しい認証情報でログインできることを確認する
  const ok = await httpRequest({ path: "/api/reports", auth: `${ADMIN_USER}:${ADMIN_PASSWORD}`, port });
  assert.equal(ok.status, 200, "閾値未満の失敗ではブロックされないはず");
});

test("ログイン試行レート制限（Task41）: 閾値回数（5回）失敗するとブロックされ、正しい認証情報でも拒否される", async (t) => {
  const port = 4604;
  await startTestServer(port, t);

  for (let i = 0; i < 5; i++) {
    const res = await httpRequest({ path: "/api/reports", auth: `${ADMIN_USER}:wrong-password`, port });
    assert.equal(res.status, 401);
  }

  // ブロック中は正しい認証情報でも401になる
  const blocked = await httpRequest({ path: "/api/reports", auth: `${ADMIN_USER}:${ADMIN_PASSWORD}`, port });
  assert.equal(blocked.status, 401, "5回失敗後はブロックされ、正しい認証情報でも拒否されるはず");
});

// ---------------------------------------------------------------------------
// レート制限の内部ロジック（website/aor-admin/auth.jsを直接require、時刻を注入して
// 決定的にテストする。ブロック時間の実経過待ち（10分）はテストとして非現実的なため、
// review-engine.jsのapprove()等と同じ「nowを引数で注入できる」パターンを踏襲した）
// ---------------------------------------------------------------------------

const authModule = require(path.join(GENERATOR_DIR, "..", "..", "website", "aor-admin", "auth"));

test("auth.js（Task41）: 時間窓内で閾値回数（5回）失敗するとisBlocked()がtrueになる", () => {
  const ip = "203.0.113.1"; // TEST-NET-3（RFC5737、テスト専用の予約アドレス）
  const base = 1_700_000_000_000;
  for (let i = 0; i < 4; i++) {
    authModule.recordFailedAttempt(ip, base + i * 1000);
    assert.equal(authModule.isBlocked(ip, base + i * 1000), false, `${i + 1}回目ではまだブロックされないはず`);
  }
  authModule.recordFailedAttempt(ip, base + 4000); // 5回目
  assert.equal(authModule.isBlocked(ip, base + 4000), true, "5回目でブロックされるはず");
});

test("auth.js（Task41）: ブロック期間（10分）経過後はisBlocked()がfalseに戻る", () => {
  const ip = "203.0.113.2";
  const base = 1_700_000_000_000;
  for (let i = 0; i < 5; i++) {
    authModule.recordFailedAttempt(ip, base + i * 1000);
  }
  assert.equal(authModule.isBlocked(ip, base + 4000), true, "ブロック直後はtrue");
  const afterBlockMs = base + 4000 + authModule.RATE_LIMIT_BLOCK_MS + 1;
  assert.equal(authModule.isBlocked(ip, afterBlockMs), false, "ブロック期間経過後はfalseに戻るはず");
});

test("auth.js（Task41）: 時間窓（5分）を超えると失敗回数がリセットされる", () => {
  const ip = "203.0.113.3";
  const base = 1_700_000_000_000;
  for (let i = 0; i < 4; i++) {
    authModule.recordFailedAttempt(ip, base + i * 1000);
  }
  // 時間窓を超えてから5回目の失敗 → 新しい窓の1回目として扱われ、ブロックされないはず
  const afterWindowMs = base + authModule.RATE_LIMIT_WINDOW_MS + 1000;
  authModule.recordFailedAttempt(ip, afterWindowMs);
  assert.equal(authModule.isBlocked(ip, afterWindowMs), false, "時間窓超過でカウンタがリセットされ、ブロックされないはず");
});

test("auth.js（Task41）: clearFailedAttempts()で失敗履歴がクリアされる（認証成功時の挙動）", () => {
  const ip = "203.0.113.4";
  const base = 1_700_000_000_000;
  for (let i = 0; i < 4; i++) {
    authModule.recordFailedAttempt(ip, base + i * 1000);
  }
  authModule.clearFailedAttempts(ip);
  // クリア後は失敗回数が0から数え直しになるため、直後にもう4回失敗してもまだブロックされない
  for (let i = 0; i < 4; i++) {
    authModule.recordFailedAttempt(ip, base + 10000 + i * 1000);
  }
  assert.equal(authModule.isBlocked(ip, base + 13000), false, "クリア後は改めて閾値回数分の失敗が必要なはず");
});

// ---------------------------------------------------------------------------
// 一覧APIのメモリキャッシュ（Task46）
// scripts/generator/output/配下にテスト専用の一時会社ディレクトリを作り、
// GET /api/reportsがreportsCache経由で返る（＝毎回フルスキャンしない）ことと、
// fs.watchのデバウンス後にキャッシュが更新されることを確認する。
// テスト後は必ず一時ディレクトリを削除する（既存の実データには触れない）。
// ---------------------------------------------------------------------------

const CACHE_TEST_SLUG = "task46-cache-test.example.com";

function cleanupCacheTestCompany() {
  const dir = path.join(OUTPUT_DIR, CACHE_TEST_SLUG);
  fs.rmSync(dir, { recursive: true, force: true });
}

test("GET /api/reports（Task46）: 起動直後から一覧を取得でき、レスポンス形式は従来どおり（配列）", async (t) => {
  const port = 4605;
  await startTestServer(port, t);

  const res = await httpRequest({ path: "/api/session", auth: `${ADMIN_USER}:${ADMIN_PASSWORD}`, port });
  const sidCookie = res.headers["set-cookie"][0].split(";")[0];

  const reports = await httpRequest({ path: "/api/reports", cookie: sidCookie, port });
  assert.equal(reports.status, 200);
  const body = JSON.parse(reports.body);
  assert.ok(Array.isArray(body), "GET /api/reportsは従来どおり配列を返すはず");
});

test("GET /api/reports（Task46）: report.json追加直後はキャッシュ未更新のため反映されず、fs.watchのデバウンス後に反映される", async (t) => {
  cleanupCacheTestCompany();
  t.after(cleanupCacheTestCompany);

  const port = 4606;
  await startTestServer(port, t);

  const session = await httpRequest({ path: "/api/session", auth: `${ADMIN_USER}:${ADMIN_PASSWORD}`, port });
  const sidCookie = session.headers["set-cookie"][0].split(";")[0];

  // サーバー起動後に新しい会社ディレクトリを作成する（起動時のreportsCacheには含まれないはず）
  const fixture = readJson(path.join(GENERATOR_DIR, "fixtures", "good.json"));
  const dir = path.join(OUTPUT_DIR, CACHE_TEST_SLUG);
  fs.mkdirSync(dir, { recursive: true });
  const report = { ...fixture, id: CACHE_TEST_SLUG };
  writeJson(path.join(dir, "report.json"), report);
  let review = engine.createEmptyReview(report.id);
  review = engine.approve(review, { reviewer: "task46-tester" });
  writeJson(path.join(dir, "review.json"), review);

  // 直後（fs.watchのデバウンス300ms未満）: まだキャッシュは更新されていないはず
  const immediately = await httpRequest({ path: "/api/reports", cookie: sidCookie, port });
  const immediatelyBody = JSON.parse(immediately.body);
  assert.equal(
    immediatelyBody.some((c) => c.id === CACHE_TEST_SLUG),
    false,
    "作成直後はreportsCacheがまだ更新されていないため一覧に含まれないはず（毎回フルスキャンしていないことの確認）"
  );

  // デバウンス（300ms）を十分に超えて待つ
  await sleep(700);

  const after = await httpRequest({ path: "/api/reports", cookie: sidCookie, port });
  const afterBody = JSON.parse(after.body);
  assert.equal(
    afterBody.some((c) => c.id === CACHE_TEST_SLUG),
    true,
    "fs.watchのデバウンス後はreportsCacheが更新され、一覧に反映されるはず"
  );
});
