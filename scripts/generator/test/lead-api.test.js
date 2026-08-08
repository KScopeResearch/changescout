/**
 * lead-api.test.js — PJ2 第1実装: website/aor-lead-api/server.jsの自動テスト。
 *
 * security.test.js（website/aor-admin/server.jsの子プロセス起動テスト）と同じ方式で、
 * website/aor-lead-api/server.jsを一時ポートで起動してHTTPレベルの動作を確認する。
 * 加えて、rate-limit.jsの内部ロジック（auth.jsのTask41テストと同じ、時刻注入パターン）
 * と、validateEmail()/validateConsent()の単体テストも含む。
 *
 * 【最重要】「PIIがどのログにも漏れない」ことの検証（テストケース群の最後にまとめて実施）:
 * 実在しないダミーのメールアドレス（例のためRFC 2606予約ドメインを使用）でリードを
 * 登録し、leads.jsonl以外のどこにもそのメール文字列が出現しないことを、
 * leads-audit.jsonl・サーバーの標準出力/標準エラー出力の両方に対して確認する。
 *
 * 本ファイルが追記するleads.jsonl/leads-audit.jsonlの行は、company_slugを必ず
 * "test-lead-api-"で始める値にし、テスト前後でその接頭辞の行だけを取り除く
 * （unpublish-report.test.jsのsetup/cleanup方式を踏襲。実データには一切触れない）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const { GENERATOR_DIR } = require("../shared/paths");
const { readJsonLines } = require("../shared/json-file");

const SERVER_PATH = path.join(GENERATOR_DIR, "..", "..", "website", "aor-lead-api", "server.js");
const leadApi = require(path.join(GENERATOR_DIR, "..", "..", "website", "aor-lead-api", "server"));
const { LEADS_PATH, LEADS_AUDIT_PATH, validateEmail, validateConsent } = leadApi;

const TEST_SLUG_PREFIX = "test-lead-api-";

/**
 * テスト実行前のleads.jsonl/leads-audit.jsonlの内容をスナップショットし、テスト後に
 * バイト単位で復元するためのヘルパー。company_slugでの内容フィルタ方式だと、不正slug・
 * レート制限ブロック時のようにcompany_slugがnullで記録される行（意図的な仕様）を
 * 取りこぼすため、スナップショット方式にしている（unpublish-report.test.jsのような
 * ディレクトリ単位のsetup/cleanupと同じ「テスト前後で実データに触れない」原則を、
 * 追記型JSON Linesファイルに合わせた形で適用したもの）。
 * @returns {{leadsExisted:boolean, leads:string, auditExisted:boolean, audit:string}}
 */
function snapshotLeadFiles() {
  return {
    leadsExisted: fs.existsSync(LEADS_PATH),
    leads: fs.existsSync(LEADS_PATH) ? fs.readFileSync(LEADS_PATH, "utf-8") : "",
    auditExisted: fs.existsSync(LEADS_AUDIT_PATH),
    audit: fs.existsSync(LEADS_AUDIT_PATH) ? fs.readFileSync(LEADS_AUDIT_PATH, "utf-8") : "",
  };
}

/** @param {{leadsExisted:boolean, leads:string, auditExisted:boolean, audit:string}} snapshot */
function restoreLeadFiles(snapshot) {
  if (snapshot.leadsExisted) fs.writeFileSync(LEADS_PATH, snapshot.leads, "utf-8");
  else fs.rmSync(LEADS_PATH, { force: true });
  if (snapshot.auditExisted) fs.writeFileSync(LEADS_AUDIT_PATH, snapshot.audit, "utf-8");
  else fs.rmSync(LEADS_AUDIT_PATH, { force: true });
}

// ---------------------------------------------------------------------------
// 単体テスト: validateEmail() / validateConsent()
// ---------------------------------------------------------------------------

test("validateEmail: 正常な形式のメールアドレスはokになる", () => {
  assert.equal(validateEmail("user@example.com").ok, true);
});

test("validateEmail: 空・未指定・非文字列はエラーになる", () => {
  assert.equal(validateEmail("").ok, false);
  assert.equal(validateEmail(undefined).ok, false);
  assert.equal(validateEmail(null).ok, false);
  assert.equal(validateEmail(12345).ok, false);
});

test("validateEmail: @やドメインのドットが無い形式はエラーになる", () => {
  assert.equal(validateEmail("not-an-email").ok, false);
  assert.equal(validateEmail("user@nodot").ok, false);
  assert.equal(validateEmail("@example.com").ok, false);
});

test("validateEmail: 254文字を超える長さはエラーになる", () => {
  const longLocal = "a".repeat(250);
  assert.equal(validateEmail(`${longLocal}@example.com`).ok, false);
});

test("validateConsent: 厳密なboolean trueのみokになる", () => {
  assert.equal(validateConsent(true).ok, true);
  assert.equal(validateConsent(false).ok, false);
  assert.equal(validateConsent("true").ok, false);
  assert.equal(validateConsent(1).ok, false);
  assert.equal(validateConsent(undefined).ok, false);
});

// ---------------------------------------------------------------------------
// 単体テスト: rate-limit.js（時刻注入パターン、auth.jsのTask41テストと同じ方式）
// ---------------------------------------------------------------------------

const rateLimit = require(path.join(GENERATOR_DIR, "..", "..", "website", "aor-lead-api", "rate-limit"));

test("rate-limit.js: 時間窓内で閾値回数（5回）に達するとisBlocked()がtrueになる", () => {
  const ip = "198.51.100.1"; // TEST-NET-2（RFC5737、テスト専用の予約アドレス）
  const base = 1_700_000_000_000;
  for (let i = 0; i < 4; i++) {
    rateLimit.recordRequest(ip, base + i * 1000);
    assert.equal(rateLimit.isBlocked(ip, base + i * 1000), false, `${i + 1}回目ではまだブロックされないはず`);
  }
  rateLimit.recordRequest(ip, base + 4000); // 5回目
  assert.equal(rateLimit.isBlocked(ip, base + 4000), true, "5回目でブロックされるはず");
});

test("rate-limit.js: ブロック期間（30分）経過後はisBlocked()がfalseに戻る", () => {
  const ip = "198.51.100.2";
  const base = 1_700_000_000_000;
  for (let i = 0; i < 5; i++) {
    rateLimit.recordRequest(ip, base + i * 1000);
  }
  assert.equal(rateLimit.isBlocked(ip, base + 4000), true, "ブロック直後はtrue");
  const afterBlockMs = base + 4000 + rateLimit.BLOCK_MS + 1;
  assert.equal(rateLimit.isBlocked(ip, afterBlockMs), false, "ブロック期間経過後はfalseに戻るはず");
});

test("rate-limit.js: 時間窓（10分）を超えるとリクエスト回数がリセットされる", () => {
  const ip = "198.51.100.3";
  const base = 1_700_000_000_000;
  for (let i = 0; i < 4; i++) {
    rateLimit.recordRequest(ip, base + i * 1000);
  }
  const afterWindowMs = base + rateLimit.WINDOW_MS + 1000;
  rateLimit.recordRequest(ip, afterWindowMs);
  assert.equal(rateLimit.isBlocked(ip, afterWindowMs), false, "時間窓超過でカウンタがリセットされ、ブロックされないはず");
});

// ---------------------------------------------------------------------------
// HTTP統合テスト: website/aor-lead-api/server.jsを一時ポートで起動して確認する
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {{path:string, method?:string, headers?:Object, body?:string, port:number}} options
 * @returns {Promise<{status:number, headers:Object, body:string}>}
 */
function httpRequest(options) {
  return new Promise((resolve, reject) => {
    const headers = { ...(options.headers || {}) };
    if (options.body) headers["Content-Type"] = "application/json";
    const req = http.request(
      { host: "localhost", port: options.port, path: options.path, method: options.method || "GET", headers, timeout: 3000 },
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

/**
 * @param {number} port
 * @param {import("node:test").TestContext} t
 * @returns {Promise<{stdout:string, stderr:string}>} 起動中に蓄積されたstdout/stderrへの参照（PII非漏洩確認用）
 */
async function startTestServer(port, t) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, LEAD_API_PORT: String(port) },
    stdio: "pipe",
  });
  const output = { stdout: "", stderr: "" };
  child.stdout.on("data", (chunk) => (output.stdout += chunk.toString()));
  child.stderr.on("data", (chunk) => (output.stderr += chunk.toString()));
  t.after(() => child.kill());

  let ready = false;
  for (let i = 0; i < 25; i++) {
    await sleep(200);
    try {
      const res = await httpRequest({ path: "/api/leads", method: "OPTIONS", port });
      if (res.status === 204) {
        ready = true;
        break;
      }
    } catch (e) {
      // まだ起動していない
    }
  }
  assert.ok(ready, `テスト用サーバーが起動しませんでした: ${output.stderr}`);
  return output;
}

function validBody(overrides = {}) {
  return JSON.stringify({
    email: "lead-api-test@example.invalid", // RFC 2606予約ドメイン、実在しない
    company_slug: `${TEST_SLUG_PREFIX}example`,
    consent: true,
    ...overrides,
  });
}

test("POST /api/leads: 正常な入力は201になり、4フィールドのみがleads.jsonlへ保存される", async (t) => {
  const snapshot = snapshotLeadFiles();
  t.after(() => restoreLeadFiles(snapshot));
  const port = 4701;
  await startTestServer(port, t);

  const res = await httpRequest({
    path: "/api/leads",
    method: "POST",
    port,
    body: JSON.stringify({
      email: "lead-api-test@example.invalid",
      company_slug: `${TEST_SLUG_PREFIX}example`,
      consent: true,
      captured_at: "2000-01-01T00:00:00.000Z", // クライアント指定値、無視されるはず
      unexpected_field: "honeypot-candidate", // 保存されないはず
    }),
  });
  assert.equal(res.status, 201);
  assert.equal(JSON.parse(res.body).ok, true);

  const stored = readJsonLines(LEADS_PATH).filter((r) => r.company_slug === `${TEST_SLUG_PREFIX}example`);
  assert.equal(stored.length, 1);
  const record = stored[0];
  assert.deepEqual(Object.keys(record).sort(), ["captured_at", "company_slug", "consent", "email"]);
  assert.equal(record.email, "lead-api-test@example.invalid");
  assert.equal(record.consent, true);
  assert.notEqual(record.captured_at, "2000-01-01T00:00:00.000Z", "captured_atはサーバー側で生成され、クライアント指定値は無視されるはず");
});

test("POST /api/leads: consentがfalse/未指定だと400になり保存されない", async (t) => {
  const snapshot = snapshotLeadFiles();
  t.after(() => restoreLeadFiles(snapshot));
  const port = 4702;
  await startTestServer(port, t);

  const res1 = await httpRequest({ path: "/api/leads", method: "POST", port, body: validBody({ consent: false }) });
  assert.equal(res1.status, 400);

  const res2 = await httpRequest({ path: "/api/leads", method: "POST", port, body: validBody({ consent: "true" }) });
  assert.equal(res2.status, 400, "文字列'true'は拒否されるはず");

  const stored = readJsonLines(LEADS_PATH).filter((r) => r.company_slug === `${TEST_SLUG_PREFIX}example`);
  assert.equal(stored.length, 0);
});

test("POST /api/leads: 不正な形式のemailは400になる", async (t) => {
  const snapshot = snapshotLeadFiles();
  t.after(() => restoreLeadFiles(snapshot));
  const port = 4703;
  await startTestServer(port, t);

  const res = await httpRequest({ path: "/api/leads", method: "POST", port, body: validBody({ email: "not-an-email" }) });
  assert.equal(res.status, 400);
});

test("POST /api/leads: 不正なcompany_slug（パストラバーサル試行を含む）は400になる", async (t) => {
  const snapshot = snapshotLeadFiles();
  t.after(() => restoreLeadFiles(snapshot));
  const port = 4704;
  await startTestServer(port, t);

  const res = await httpRequest({ path: "/api/leads", method: "POST", port, body: validBody({ company_slug: "../../etc" }) });
  assert.equal(res.status, 400);
});

test("GET /api/leads は405、未知のパスは404、OPTIONSは204でCORSヘッダーを返す", async (t) => {
  const port = 4705;
  await startTestServer(port, t);

  const getRes = await httpRequest({ path: "/api/leads", method: "GET", port });
  assert.equal(getRes.status, 405);

  const notFoundRes = await httpRequest({ path: "/api/unknown", method: "GET", port });
  assert.equal(notFoundRes.status, 404);

  const optionsRes = await httpRequest({
    path: "/api/leads",
    method: "OPTIONS",
    port,
    headers: { Origin: "https://example.com" },
  });
  assert.equal(optionsRes.status, 204);
  assert.equal(optionsRes.headers["access-control-allow-origin"], "https://example.com");
});

test("POST /api/leads: レート制限（5回目でブロック設定、6回目以降は429）", async (t) => {
  const snapshot = snapshotLeadFiles();
  t.after(() => restoreLeadFiles(snapshot));
  const port = 4706;
  await startTestServer(port, t);

  for (let i = 0; i < 5; i++) {
    const res = await httpRequest({
      path: "/api/leads",
      method: "POST",
      port,
      body: validBody({ email: `lead-api-test-${i}@example.invalid` }),
    });
    assert.equal(res.status, 201, `${i + 1}回目は成功するはず`);
  }

  const blocked = await httpRequest({ path: "/api/leads", method: "POST", port, body: validBody() });
  assert.equal(blocked.status, 429, "6回目はレート制限で拒否されるはず");
});

test("PII非漏洩確認: 登録したメールアドレスはleads.jsonl以外（leads-audit.jsonl・サーバーのstdout/stderr）に一切出現しない", async (t) => {
  const snapshot = snapshotLeadFiles();
  t.after(() => restoreLeadFiles(snapshot));
  const port = 4707;
  const output = await startTestServer(port, t);

  const secretEmail = "pii-leak-check-9f3a7c@example.invalid";
  const slug = `${TEST_SLUG_PREFIX}pii-check`;

  // 成功ケースと、あえて失敗させるケース（バリデーションエラー時のログ経路も確認するため）の両方を送る
  const okRes = await httpRequest({
    path: "/api/leads",
    method: "POST",
    port,
    body: JSON.stringify({ email: secretEmail, company_slug: slug, consent: true }),
  });
  assert.equal(okRes.status, 201);

  const failRes = await httpRequest({
    path: "/api/leads",
    method: "POST",
    port,
    body: JSON.stringify({ email: secretEmail, company_slug: slug, consent: false }),
  });
  assert.equal(failRes.status, 400);

  await sleep(200); // stdout/stderrのflushを待つ

  // leads.jsonlには保存されているはず（保存先そのものなので出現して当然）
  const leadRecords = readJsonLines(LEADS_PATH).filter((r) => r.company_slug === slug);
  assert.equal(leadRecords.length, 1);
  assert.equal(leadRecords[0].email, secretEmail);

  // leads-audit.jsonlには出現してはならない
  const auditRaw = fs.existsSync(LEADS_AUDIT_PATH) ? fs.readFileSync(LEADS_AUDIT_PATH, "utf-8") : "";
  assert.ok(!auditRaw.includes(secretEmail), "leads-audit.jsonlにメールアドレスが漏洩している");
  const auditRecords = readJsonLines(LEADS_AUDIT_PATH).filter((r) => r.company_slug === slug);
  assert.ok(auditRecords.some((r) => r.action === "lead_captured" && r.success === true));
  assert.ok(auditRecords.some((r) => r.action === "lead_rejected" && r.success === false));

  // サーバーの標準出力・標準エラー出力にも出現してはならない
  assert.ok(!output.stdout.includes(secretEmail), "サーバーのstdoutにメールアドレスが漏洩している");
  assert.ok(!output.stderr.includes(secretEmail), "サーバーのstderrにメールアドレスが漏洩している");
});
