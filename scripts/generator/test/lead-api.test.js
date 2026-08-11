/**
 * lead-api.test.js — website/aor-lead-api/server.jsの自動テスト（PJ2 第1実装で新設、
 * 第2実装でCORS許可リスト・ハニーポットのテストを追加、P0-2でLead保存先の
 * lead-store.js移行・重複（resubmitted）テストを追加）。
 *
 * security.test.js（website/aor-admin/server.jsの子プロセス起動テスト）と同じ方式で、
 * website/aor-lead-api/server.jsを一時ポートで起動してHTTPレベルの動作を確認する。
 * 加えて、rate-limit.jsの内部ロジック（auth.jsのTask41テストと同じ、時刻注入パターン）
 * と、validateEmail()/validateConsent()の単体テストも含む。
 *
 * 【P0-2で変更】Lead本体の保存先はleads.jsonl（廃止）からlead-store.js管理下の
 * scripts/generator/logs/leads/<lead_id>.jsonへ移行した。POST /api/leadsは
 * company_slugからcompany_url解決のためcompany-context-store.jsのcompany_context.jsonを
 * 参照するため、成功が期待されるテストは事前にsetupCompanyContextFixture()で
 * company_context.jsonフィクスチャを用意する（scripts/generator/output/配下、
 * company-context-store.test.jsと同じ「テスト専用slug・テスト後に必ず削除」方式）。
 *
 * 【最重要】「PIIがどのログにも漏れない」ことの検証（テストケース群の最後にまとめて実施）:
 * 実在しないダミーのメールアドレス（例のためRFC 2606予約ドメインを使用）でリードを
 * 登録し、Lead本体（leads/<lead_id>.json）以外のどこにもそのメール文字列が出現しないことを、
 * leads-audit.jsonl・サーバーの標準出力/標準エラー出力の両方に対して確認する。
 *
 * 本ファイルが作成するLead・company_contextフィクスチャは、company_slugを必ず
 * "test-lead-api-"で始める値にし、各テストのt.after()で個別に削除する
 * （unpublish-report.test.js・company-context-store.test.jsのsetup/cleanup方式を踏襲。
 * 実データには一切触れない）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const { GENERATOR_DIR, OUTPUT_DIR } = require("../shared/paths");
const { readJsonLines } = require("../shared/json-file");
const { createLead, readLead, updateLead, findLeadByEmailAndCompanyUrl, LEADS_DIR } = require("../leads/lead-store");
const { saveCompanyContext } = require("../company-context-store");

const SERVER_PATH = path.join(GENERATOR_DIR, "..", "..", "website", "aor-lead-api", "server.js");
const leadApi = require(path.join(GENERATOR_DIR, "..", "..", "website", "aor-lead-api", "server"));
const { LEADS_PATH, LEADS_AUDIT_PATH, validateEmail, validateConsent, LEAD_SOURCE, LEAD_COLLECTION_METHOD } = leadApi;

const TEST_SLUG_PREFIX = "test-lead-api-";

/**
 * POST /api/leadsが要求するcompany_slug→company_url解決（company-context-store.js経由）の
 * テスト用フィクスチャ。generate-company-report.jsのslugFromUrl()と対称になるよう、
 * デフォルトのinput_urlはhostnameがslugそのものになる値にしている（本番でslugが
 * slugFromUrl(company_url)から決定的に導出されるのと同じ対応関係をテストでも保つため）。
 * @param {string} slug
 * @param {string} [inputUrl]
 */
async function setupCompanyContextFixture(slug, inputUrl) {
  await saveCompanyContext(slug, {
    input_url: inputUrl || `https://${slug}`,
    generated_at: "2026-01-01T00:00:00.000Z",
    industry_hint: "テスト",
    company_fetch_ok: true,
    company_fetch_error: null,
    pipeline_stats: { fetched_total: 0, normalized_total: 0, duplicates_removed: 0, after_dedupe: 0, selected_for_ai: 0, max_sources_for_ai: 20 },
    sources: [],
  });
}

/** @param {string} slug */
function cleanupCompanyContextFixture(slug) {
  fs.rmSync(path.join(OUTPUT_DIR, slug), { recursive: true, force: true });
}

/** @param {string} leadId */
function cleanupLeadFile(leadId) {
  fs.rmSync(path.join(LEADS_DIR, `${leadId}.json`), { force: true });
}

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

test("POST /api/leads: 正常な入力は201になり、lead-store.jsの正式なLeadとして保存される（P0-2）", async (t) => {
  const port = 4701;
  await startTestServer(port, t);

  const slug = `${TEST_SLUG_PREFIX}example`;
  const email = "lead-api-test@example.invalid";
  const companyUrl = `https://${slug}`;
  await setupCompanyContextFixture(slug, companyUrl);
  t.after(() => cleanupCompanyContextFixture(slug));

  const res = await httpRequest({
    path: "/api/leads",
    method: "POST",
    port,
    body: JSON.stringify({
      email,
      company_slug: slug,
      consent: true,
      captured_at: "2000-01-01T00:00:00.000Z", // クライアント指定値、無視されるはず
      unexpected_field: "honeypot-candidate", // 保存されないはず
    }),
  });
  assert.equal(res.status, 201);
  assert.deepEqual(JSON.parse(res.body), { ok: true }, "レスポンスは{ok:true}のみ（lead_id/report_token/emailを含まない）");
  assert.ok(!res.body.includes(email), "レスポンスにemailが含まれてはならない");

  const lead = await findLeadByEmailAndCompanyUrl(email, companyUrl);
  assert.ok(lead, "lead-store.js管理下にLeadが作成されるはず");
  t.after(() => cleanupLeadFile(lead.lead_id));

  assert.equal(lead.email, email);
  assert.equal(lead.company_url, companyUrl);
  assert.equal(lead.source, LEAD_SOURCE);
  assert.equal(lead.collection_method, LEAD_COLLECTION_METHOD);
  assert.equal(lead.status, "collected");
  assert.notEqual(lead.collected_at, "2000-01-01T00:00:00.000Z", "collected_atはサーバー側で生成され、クライアント指定値は無視されるはず");
  assert.equal(lead.history.filter((h) => h.event === "collected").length, 1);
  assert.equal("consent" in lead, false, "consentはLead本体に保存しない（P0-2設計確認事項）");
});

test("POST /api/leads: consentがfalse/未指定だと400になり、Leadが作成されない", async (t) => {
  const port = 4702;
  await startTestServer(port, t);

  const email = "lead-api-test-consent-check@example.invalid";
  const companyUrl = `https://${TEST_SLUG_PREFIX}example`;

  const res1 = await httpRequest({ path: "/api/leads", method: "POST", port, body: validBody({ email, consent: false }) });
  assert.equal(res1.status, 400);

  const res2 = await httpRequest({ path: "/api/leads", method: "POST", port, body: validBody({ email, consent: "true" }) });
  assert.equal(res2.status, 400, "文字列'true'は拒否されるはず");

  const lead = await findLeadByEmailAndCompanyUrl(email, companyUrl);
  assert.equal(lead, null, "consent検証で拒否された場合、Leadは作成されないはず");
});

test("POST /api/leads: 不正な形式のemailは400になる", async (t) => {
  const port = 4703;
  await startTestServer(port, t);

  const res = await httpRequest({ path: "/api/leads", method: "POST", port, body: validBody({ email: "not-an-email" }) });
  assert.equal(res.status, 400);
});

test("POST /api/leads: 不正なcompany_slug（パストラバーサル試行を含む）は400になる", async (t) => {
  const port = 4704;
  await startTestServer(port, t);

  const res = await httpRequest({ path: "/api/leads", method: "POST", port, body: validBody({ company_slug: "../../etc" }) });
  assert.equal(res.status, 400);
});

test("POST /api/leads: company_context.jsonが存在しないcompany_slug（未知の企業）は400になる（合成URLは作らない）", async (t) => {
  const port = 4715;
  await startTestServer(port, t);

  const res = await httpRequest({
    path: "/api/leads",
    method: "POST",
    port,
    body: validBody({ company_slug: `${TEST_SLUG_PREFIX}unknown-company` }),
  });
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// Lead重複（email×company_slug）: P0-1で確定した仕様（lead-store.jsのcreateLead()に
// 委譲するのみで、server.js側に独自のduplicate判定は一切実装しない）をHTTP経由で確認する。
// ---------------------------------------------------------------------------

test("POST /api/leads: 同一email×同一company_slugを再POSTしても新規Leadは増えず、resubmitted historyが記録され201になる", async (t) => {
  const port = 4716;
  await startTestServer(port, t);

  const slug = `${TEST_SLUG_PREFIX}dup-same`;
  const email = "lead-api-test-dup-same@example.invalid";
  const companyUrl = `https://${slug}`;
  await setupCompanyContextFixture(slug, companyUrl);
  t.after(() => cleanupCompanyContextFixture(slug));

  const first = await httpRequest({ path: "/api/leads", method: "POST", port, body: JSON.stringify({ email, company_slug: slug, consent: true }) });
  assert.equal(first.status, 201);

  const firstLead = await findLeadByEmailAndCompanyUrl(email, companyUrl);
  assert.ok(firstLead);
  t.after(() => cleanupLeadFile(firstLead.lead_id));

  const second = await httpRequest({ path: "/api/leads", method: "POST", port, body: JSON.stringify({ email, company_slug: slug, consent: true }) });
  assert.equal(second.status, 201, "重複時も正常処理として201を返すはず");
  assert.deepEqual(JSON.parse(second.body), { ok: true });

  const secondLead = await findLeadByEmailAndCompanyUrl(email, companyUrl);
  assert.equal(secondLead.lead_id, firstLead.lead_id, "新規Leadは作られず、同一Leadのままのはず");

  const resubmittedEvents = secondLead.history.filter((h) => h.event === "resubmitted");
  assert.equal(resubmittedEvents.length, 1, "resubmitted historyが1件記録されるはず");
});

test("POST /api/leads: 同一email×別company_slugは別Leadとして新規作成される", async (t) => {
  const port = 4717;
  await startTestServer(port, t);

  const email = "lead-api-test-dup-diffslug@example.invalid";
  const slugA = `${TEST_SLUG_PREFIX}dup-diffslug-a`;
  const slugB = `${TEST_SLUG_PREFIX}dup-diffslug-b`;
  const urlA = `https://${slugA}`;
  const urlB = `https://${slugB}`;
  await setupCompanyContextFixture(slugA, urlA);
  await setupCompanyContextFixture(slugB, urlB);
  t.after(() => cleanupCompanyContextFixture(slugA));
  t.after(() => cleanupCompanyContextFixture(slugB));

  const resA = await httpRequest({ path: "/api/leads", method: "POST", port, body: JSON.stringify({ email, company_slug: slugA, consent: true }) });
  assert.equal(resA.status, 201);
  const leadA = await findLeadByEmailAndCompanyUrl(email, urlA);
  assert.ok(leadA);
  t.after(() => cleanupLeadFile(leadA.lead_id));

  const resB = await httpRequest({ path: "/api/leads", method: "POST", port, body: JSON.stringify({ email, company_slug: slugB, consent: true }) });
  assert.equal(resB.status, 201);
  const leadB = await findLeadByEmailAndCompanyUrl(email, urlB);
  assert.ok(leadB);
  t.after(() => cleanupLeadFile(leadB.lead_id));

  assert.notEqual(leadA.lead_id, leadB.lead_id, "company_slugが異なるため別Leadが作成されるはず");
});

test("POST /api/leads: 別email×同一company_slugは別Leadとして新規作成される", async (t) => {
  const port = 4718;
  await startTestServer(port, t);

  const slug = `${TEST_SLUG_PREFIX}dup-diffemail`;
  const companyUrl = `https://${slug}`;
  await setupCompanyContextFixture(slug, companyUrl);
  t.after(() => cleanupCompanyContextFixture(slug));

  const emailA = "lead-api-test-dup-diffemail-a@example.invalid";
  const emailB = "lead-api-test-dup-diffemail-b@example.invalid";

  const resA = await httpRequest({ path: "/api/leads", method: "POST", port, body: JSON.stringify({ email: emailA, company_slug: slug, consent: true }) });
  assert.equal(resA.status, 201);
  const leadA = await findLeadByEmailAndCompanyUrl(emailA, companyUrl);
  assert.ok(leadA);
  t.after(() => cleanupLeadFile(leadA.lead_id));

  const resB = await httpRequest({ path: "/api/leads", method: "POST", port, body: JSON.stringify({ email: emailB, company_slug: slug, consent: true }) });
  assert.equal(resB.status, 201);
  const leadB = await findLeadByEmailAndCompanyUrl(emailB, companyUrl);
  assert.ok(leadB);
  t.after(() => cleanupLeadFile(leadB.lead_id));

  assert.notEqual(leadA.lead_id, leadB.lead_id, "emailが異なるため別Leadが作成されるはず");
});

test("POST /api/leads: 保存失敗（lead-store.jsのcreateLead()が例外を投げる）は500になる", async (t) => {
  const port = 4719;
  // LEAD_STORE_S3_BUCKET未設定のままLEAD_STORE_BACKEND=s3を指定し、createLead()内部の
  // getBackend().listLeads()/writeLead()がresolveConfig()で同期的に例外を投げる状態を作る
  // （実AWSへは一切接続しない。leads/backends/s3-backend.jsの既存のガード節を利用するだけ）。
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, LEAD_API_PORT: String(port), LEAD_STORE_BACKEND: "s3" },
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

  const slug = `${TEST_SLUG_PREFIX}store-failure`;
  const companyUrl = `https://${slug}`;
  // company-context-storeはCOMPANY_CONTEXT_STORE_BACKEND（未設定=filesystem）を使うため、
  // LEAD_STORE_BACKEND=s3の影響を受けず、通常どおりfilesystemフィクスチャで解決できる。
  await setupCompanyContextFixture(slug, companyUrl);
  t.after(() => cleanupCompanyContextFixture(slug));

  const res = await httpRequest({
    path: "/api/leads",
    method: "POST",
    port,
    body: JSON.stringify({ email: "lead-api-test-store-failure@example.invalid", company_slug: slug, consent: true }),
  });
  assert.equal(res.status, 500);
  assert.equal(JSON.parse(res.body).ok, false);
});

test("GET /api/leads は405、未知のパスは404、OPTIONSは204を返す", async (t) => {
  const port = 4705;
  await startTestServer(port, t);

  const getRes = await httpRequest({ path: "/api/leads", method: "GET", port });
  assert.equal(getRes.status, 405);

  const notFoundRes = await httpRequest({ path: "/api/unknown", method: "GET", port });
  assert.equal(notFoundRes.status, 404);

  const optionsRes = await httpRequest({ path: "/api/leads", method: "OPTIONS", port });
  assert.equal(optionsRes.status, 204);
});

// ---------------------------------------------------------------------------
// CORS許可リスト（PJ2 第2実装）
// ---------------------------------------------------------------------------

test("CORS: 既定の許可リストに含まれるOriginにはAccess-Control-Allow-Originが返り、含まれないOriginには付与されない", async (t) => {
  const port = 4708;
  await startTestServer(port, t); // LEAD_API_ALLOWED_ORIGINS未指定 → 既定値 http://localhost:8123 のみ許可

  const allowed = await httpRequest({
    path: "/api/leads",
    method: "OPTIONS",
    port,
    headers: { Origin: "http://localhost:8123" },
  });
  assert.equal(allowed.headers["access-control-allow-origin"], "http://localhost:8123");

  const disallowed = await httpRequest({
    path: "/api/leads",
    method: "OPTIONS",
    port,
    headers: { Origin: "https://evil.example.com" },
  });
  assert.equal(disallowed.headers["access-control-allow-origin"], undefined, "許可リスト外のOriginにはヘッダーを付与しないはず");
});

test("CORS: LEAD_API_ALLOWED_ORIGINS環境変数（カンマ区切り）で許可Originを追加できる", async (t) => {
  const port = 4709;
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, LEAD_API_PORT: String(port), LEAD_API_ALLOWED_ORIGINS: "https://aor.example.jp, https://www.aor.example.jp" },
    stdio: "pipe",
  });
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
  assert.ok(ready);

  const res = await httpRequest({ path: "/api/leads", method: "OPTIONS", port, headers: { Origin: "https://aor.example.jp" } });
  assert.equal(res.headers["access-control-allow-origin"], "https://aor.example.jp");

  // 環境変数で明示的に指定した場合、既定値（localhost:8123）は上書きされ許可されなくなる
  const defaultOriginRes = await httpRequest({ path: "/api/leads", method: "OPTIONS", port, headers: { Origin: "http://localhost:8123" } });
  assert.equal(defaultOriginRes.headers["access-control-allow-origin"], undefined);
});

test("CORS: 非ブラウザ相当のリクエスト（Originヘッダー無し）は許可リストに関わらず通常どおり処理される", async (t) => {
  const port = 4710;
  await startTestServer(port, t);

  const slug = `${TEST_SLUG_PREFIX}example`;
  const companyUrl = `https://${slug}`;
  await setupCompanyContextFixture(slug, companyUrl);
  t.after(() => cleanupCompanyContextFixture(slug));

  const email = "lead-api-test-cors@example.invalid";
  const res = await httpRequest({ path: "/api/leads", method: "POST", port, body: validBody({ email }) });
  assert.equal(res.status, 201, "Originヘッダーが無いリクエストはCORSの対象外であり、通常どおり処理されるはず");

  const lead = await findLeadByEmailAndCompanyUrl(email, companyUrl);
  assert.ok(lead);
  t.after(() => cleanupLeadFile(lead.lead_id));
});

test("POST /api/leads: レート制限（5回目でブロック設定、6回目以降は429）", async (t) => {
  const port = 4706;
  await startTestServer(port, t);

  const slug = `${TEST_SLUG_PREFIX}example`;
  const companyUrl = `https://${slug}`;
  await setupCompanyContextFixture(slug, companyUrl);
  t.after(() => cleanupCompanyContextFixture(slug));

  for (let i = 0; i < 5; i++) {
    const email = `lead-api-test-ratelimit-${i}@example.invalid`;
    const res = await httpRequest({
      path: "/api/leads",
      method: "POST",
      port,
      body: validBody({ email }),
    });
    assert.equal(res.status, 201, `${i + 1}回目は成功するはず`);
    const lead = await findLeadByEmailAndCompanyUrl(email, companyUrl);
    assert.ok(lead);
    t.after(() => cleanupLeadFile(lead.lead_id));
  }

  const blocked = await httpRequest({ path: "/api/leads", method: "POST", port, body: validBody() });
  assert.equal(blocked.status, 429, "6回目はレート制限で拒否されるはず");
});

// ---------------------------------------------------------------------------
// ハニーポット（PJ2 第2実装）
// ---------------------------------------------------------------------------

test("ハニーポット: hp_websiteに値が入っていると、保存されずに本物の成功と同じ201が返る", async (t) => {
  const port = 4711;
  await startTestServer(port, t);

  const slug = `${TEST_SLUG_PREFIX}honeypot`;
  const email = "lead-api-test-honeypot@example.invalid";
  // ハニーポット判定は他の検証（company_slug解決を含む）より先に行われるため、
  // company_context.jsonフィクスチャは不要（存在しないslugのままでよい）。
  const res = await httpRequest({
    path: "/api/leads",
    method: "POST",
    port,
    body: JSON.stringify({
      email,
      company_slug: slug,
      consent: true,
      hp_website: "http://bot-filled-this-field.example",
    }),
  });
  assert.equal(res.status, 201, "botに検知を悟らせないため、本物の成功と同じ201を返すはず");
  assert.equal(JSON.parse(res.body).ok, true);

  const lead = await findLeadByEmailAndCompanyUrl(email, `https://${slug}`);
  assert.equal(lead, null, "ハニーポット検知時はLeadが作成されないはず");

  const auditRecords = readJsonLines(LEADS_AUDIT_PATH).filter((r) => r.action === "lead_honeypot_triggered");
  assert.ok(auditRecords.length >= 1, "leads-audit.jsonlにlead_honeypot_triggeredが記録されるはず");
});

test("ハニーポット: hp_websiteが空文字・未指定の場合は通常どおり処理される（正規ユーザーへの影響なし）", async (t) => {
  const port = 4712;
  await startTestServer(port, t);

  const slug = `${TEST_SLUG_PREFIX}nohp`;
  const companyUrl = `https://${slug}`;
  await setupCompanyContextFixture(slug, companyUrl);
  t.after(() => cleanupCompanyContextFixture(slug));

  const email = "lead-api-test-nohp@example.invalid";
  const res = await httpRequest({
    path: "/api/leads",
    method: "POST",
    port,
    body: JSON.stringify({ email, company_slug: slug, consent: true, hp_website: "" }),
  });
  assert.equal(res.status, 201);

  const lead = await findLeadByEmailAndCompanyUrl(email, companyUrl);
  assert.ok(lead);
  t.after(() => cleanupLeadFile(lead.lead_id));
});

test("PII非漏洩確認: 登録したメールアドレスはLead本体（leads/<lead_id>.json）以外（leads-audit.jsonl・サーバーのstdout/stderr）に一切出現しない", async (t) => {
  const snapshot = snapshotLeadFiles();
  t.after(() => restoreLeadFiles(snapshot));
  const port = 4707;
  const output = await startTestServer(port, t);

  const secretEmail = "pii-leak-check-9f3a7c@example.invalid";
  const slug = `${TEST_SLUG_PREFIX}pii-check`;
  const companyUrl = `https://${slug}`;
  await setupCompanyContextFixture(slug, companyUrl);
  t.after(() => cleanupCompanyContextFixture(slug));

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

  // Lead本体には保存されているはず（保存先そのものなので出現して当然）
  const lead = await findLeadByEmailAndCompanyUrl(secretEmail, companyUrl);
  assert.ok(lead);
  assert.equal(lead.email, secretEmail);
  t.after(() => cleanupLeadFile(lead.lead_id));

  // leads-audit.jsonlには出現してはならない
  const auditRaw = fs.existsSync(LEADS_AUDIT_PATH) ? fs.readFileSync(LEADS_AUDIT_PATH, "utf-8") : "";
  assert.ok(!auditRaw.includes(secretEmail), "leads-audit.jsonlにメールアドレスが漏洩している");
  const auditRecords = readJsonLines(LEADS_AUDIT_PATH).filter((r) => r.company_slug === slug);
  assert.ok(auditRecords.some((r) => r.action === "lead_captured" && r.success === true));
  assert.ok(auditRecords.some((r) => r.action === "lead_rejected" && r.success === false));

  // leads.jsonl（P0-2以降の新規追記は無いはず）にも出現してはならない
  const leadsJsonlRaw = fs.existsSync(LEADS_PATH) ? fs.readFileSync(LEADS_PATH, "utf-8") : "";
  assert.ok(!leadsJsonlRaw.includes(secretEmail), "leads.jsonlにメールアドレスが漏洩している（新規追記されないはず）");

  // サーバーの標準出力・標準エラー出力にも出現してはならない
  assert.ok(!output.stdout.includes(secretEmail), "サーバーのstdoutにメールアドレスが漏洩している");
  assert.ok(!output.stderr.includes(secretEmail), "サーバーのstderrにメールアドレスが漏洩している");
});

test("POST /api/leads: 成功しても leads.jsonl へ新規追記されない（P0-2でLead保存先はlead-store.jsへ移行）", async (t) => {
  const port = 4713;
  await startTestServer(port, t);

  const before = fs.existsSync(LEADS_PATH) ? fs.readFileSync(LEADS_PATH, "utf-8") : null;

  const slug = `${TEST_SLUG_PREFIX}no-jsonl-write`;
  const companyUrl = `https://${slug}`;
  await setupCompanyContextFixture(slug, companyUrl);
  t.after(() => cleanupCompanyContextFixture(slug));

  const email = "lead-api-test-no-jsonl-write@example.invalid";
  const res = await httpRequest({
    path: "/api/leads",
    method: "POST",
    port,
    body: JSON.stringify({ email, company_slug: slug, consent: true }),
  });
  assert.equal(res.status, 201);

  const lead = await findLeadByEmailAndCompanyUrl(email, companyUrl);
  assert.ok(lead);
  t.after(() => cleanupLeadFile(lead.lead_id));

  const after = fs.existsSync(LEADS_PATH) ? fs.readFileSync(LEADS_PATH, "utf-8") : null;
  assert.equal(after, before, "POST /api/leadsの成功でleads.jsonlの内容が変化してはならない（新規追記されないはず）");
});

// ---------------------------------------------------------------------------
// Phase4-A/B API（PJ2 Phase4-A/B、今回追加）:
//   POST /api/leads/:lead_id/paid-report-request ・
//   POST /api/leads/:lead_id/weekly-report-consent
//
// lead-store.test.js/process-validated.test.jsと同じ方式で、各テストが作成したLeadを
// t.after()で個別に削除する（leads.jsonl/leads-audit.jsonlのようなスナップショット方式は、
// Lead本体は1件1ファイルのため不要）。
// ---------------------------------------------------------------------------

const PHASE4_TEST_EMAIL_DOMAIN = "example.invalid"; // RFC 2606予約、実在しない

/** @param {Object} [overrides] @returns {Promise<Object>} 作成したLead */
async function createTestLead(overrides = {}) {
  return createLead({
    email: `phase4-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}@${PHASE4_TEST_EMAIL_DOMAIN}`,
    company_url: "https://phase4-api-test.example",
    source: "テスト",
    collection_method: "public_website",
    ...overrides,
  });
}

/** @param {string} leadId */
function cleanupLead(leadId) {
  fs.rmSync(path.join(LEADS_DIR, `${leadId}.json`), { force: true });
}

const PHASE4_ACTION_CASES = [
  {
    action: "paid-report-request",
    field: "paid_report_requested",
    atField: "paid_report_requested_at",
    event: "paid_report_requested",
    label: "Phase4-A",
  },
  {
    action: "weekly-report-consent",
    field: "weekly_report_consent",
    atField: "weekly_report_consent_at",
    event: "weekly_report_consent",
    label: "Phase4-B",
  },
];

PHASE4_ACTION_CASES.forEach(({ action, field, atField, event, label }, idx) => {
  const port = 4720 + idx * 10; // A: 4720-4728 / B: 4730-4738（既存テストの4701-4712とも衝突しない）

  test(`${label} (${action}): 正常なlead_id/report_tokenで201になり、Lead JSONが正しく更新される`, async (t) => {
    await startTestServer(port, t);
    const lead = await createTestLead();
    t.after(() => cleanupLead(lead.lead_id));

    const res = await httpRequest({
      path: `/api/leads/${lead.lead_id}/${action}`,
      method: "POST",
      port,
      body: JSON.stringify({ report_token: lead.report_token }),
    });
    assert.equal(res.status, 201);
    assert.deepEqual(JSON.parse(res.body), { ok: true });

    const updated = await readLead(lead.lead_id);
    assert.equal(updated[field], true);
    assert.equal(typeof updated[atField], "string");
    assert.ok(updated[atField].length > 0);
  });

  test(`${label} (${action}): historyへ${event}イベントが1件追加される`, async (t) => {
    await startTestServer(port + 1, t);
    const lead = await createTestLead();
    t.after(() => cleanupLead(lead.lead_id));

    await httpRequest({
      path: `/api/leads/${lead.lead_id}/${action}`,
      method: "POST",
      port: port + 1,
      body: JSON.stringify({ report_token: lead.report_token }),
    });

    const updated = await readLead(lead.lead_id);
    const matchingEvents = updated.history.map((h) => h.event).filter((e) => e === event);
    assert.deepEqual(matchingEvents, [event], "1件だけ追加されるはず");
  });

  test(`${label} (${action}): 存在しないlead_idは404になる`, async (t) => {
    await startTestServer(port + 2, t);

    const res = await httpRequest({
      path: `/api/leads/${"0".repeat(64)}/${action}`,
      method: "POST",
      port: port + 2,
      body: JSON.stringify({ report_token: "dummy" }),
    });
    assert.equal(res.status, 404);
    assert.equal(JSON.parse(res.body).ok, false);
  });

  test(`${label} (${action}): report_tokenが一致しない場合は403になり、Leadは更新されない`, async (t) => {
    await startTestServer(port + 3, t);
    const lead = await createTestLead();
    t.after(() => cleanupLead(lead.lead_id));

    const res = await httpRequest({
      path: `/api/leads/${lead.lead_id}/${action}`,
      method: "POST",
      port: port + 3,
      body: JSON.stringify({ report_token: "wrong-token" }),
    });
    assert.equal(res.status, 403);

    const unchanged = await readLead(lead.lead_id);
    assert.equal(unchanged[field], false);
    assert.equal(unchanged[atField], null);
    assert.equal(unchanged.history.some((h) => h.event === event), false);
  });

  test(`${label} (${action}): report_tokenが未指定の場合は403になる`, async (t) => {
    await startTestServer(port + 4, t);
    const lead = await createTestLead();
    t.after(() => cleanupLead(lead.lead_id));

    const res = await httpRequest({
      path: `/api/leads/${lead.lead_id}/${action}`,
      method: "POST",
      port: port + 4,
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 403);
  });

  test(`${label} (${action}): report_tokenが空文字の場合は403になる`, async (t) => {
    await startTestServer(port + 5, t);
    const lead = await createTestLead();
    t.after(() => cleanupLead(lead.lead_id));

    const res = await httpRequest({
      path: `/api/leads/${lead.lead_id}/${action}`,
      method: "POST",
      port: port + 5,
      body: JSON.stringify({ report_token: "" }),
    });
    assert.equal(res.status, 403);
  });

  test(`${label} (${action}): 不正なJSONボディは400になる`, async (t) => {
    await startTestServer(port + 6, t);
    const lead = await createTestLead();
    t.after(() => cleanupLead(lead.lead_id));

    const res = await httpRequest({
      path: `/api/leads/${lead.lead_id}/${action}`,
      method: "POST",
      port: port + 6,
      body: "{not valid json",
    });
    assert.equal(res.status, 400);
  });

  test(`${label} (${action}): 既にtrueの状態で再実行しても壊れない（べき等、_at/historyは変化しない）`, async (t) => {
    await startTestServer(port + 7, t);
    const lead = await createTestLead();
    t.after(() => cleanupLead(lead.lead_id));

    const first = await httpRequest({
      path: `/api/leads/${lead.lead_id}/${action}`,
      method: "POST",
      port: port + 7,
      body: JSON.stringify({ report_token: lead.report_token }),
    });
    assert.equal(first.status, 201);
    const afterFirst = await readLead(lead.lead_id);

    await sleep(50); // _atが「変わっていない」ことの確認に意味を持たせるための待機

    const second = await httpRequest({
      path: `/api/leads/${lead.lead_id}/${action}`,
      method: "POST",
      port: port + 7,
      body: JSON.stringify({ report_token: lead.report_token }),
    });
    assert.equal(second.status, 201, "2回目も201を返す（false→true, true→trueを許容）");

    const afterSecond = await readLead(lead.lead_id);
    assert.equal(afterSecond[field], true);
    assert.equal(afterSecond[atField], afterFirst[atField], "_atは最初にtrueになった時刻のまま変わらないはず");
    assert.deepEqual(
      afterSecond.history.map((h) => h.event).filter((e) => e === event),
      [event],
      "historyには重複して追記されないはず"
    );
  });

  test(`${label} (${action}): レスポンスにemail・report_tokenが一切含まれない（成功・403・404いずれも）`, async (t) => {
    await startTestServer(port + 8, t);
    const lead = await createTestLead();
    t.after(() => cleanupLead(lead.lead_id));

    const successRes = await httpRequest({
      path: `/api/leads/${lead.lead_id}/${action}`,
      method: "POST",
      port: port + 8,
      body: JSON.stringify({ report_token: lead.report_token }),
    });
    assert.ok(!successRes.body.includes(lead.email));
    assert.ok(!successRes.body.includes(lead.report_token));

    const forbiddenRes = await httpRequest({
      path: `/api/leads/${lead.lead_id}/${action}`,
      method: "POST",
      port: port + 8,
      body: JSON.stringify({ report_token: "wrong" }),
    });
    assert.ok(!forbiddenRes.body.includes(lead.email));
    assert.ok(!forbiddenRes.body.includes(lead.report_token));

    const notFoundRes = await httpRequest({
      path: `/api/leads/${"f".repeat(64)}/${action}`,
      method: "POST",
      port: port + 8,
      body: JSON.stringify({ report_token: "irrelevant" }),
    });
    assert.ok(!notFoundRes.body.includes(lead.email));
  });
});

test("Phase4-A（paid-report-request）を実行しても、weekly_report_consentは変化しない", async (t) => {
  const port = 4790;
  await startTestServer(port, t);
  const lead = await createTestLead();
  t.after(() => cleanupLead(lead.lead_id));

  const res = await httpRequest({
    path: `/api/leads/${lead.lead_id}/paid-report-request`,
    method: "POST",
    port,
    body: JSON.stringify({ report_token: lead.report_token }),
  });
  assert.equal(res.status, 201);

  const updated = await readLead(lead.lead_id);
  assert.equal(updated.paid_report_requested, true);
  assert.equal(updated.weekly_report_consent, false, "Aを実行してもBの属性は変化しないはず");
  assert.equal(updated.weekly_report_consent_at, null);
  assert.equal(updated.history.some((h) => h.event === "weekly_report_consent"), false);
});

test("Phase4-B（weekly-report-consent）を実行しても、paid_report_requestedは変化しない", async (t) => {
  const port = 4791;
  await startTestServer(port, t);
  const lead = await createTestLead();
  t.after(() => cleanupLead(lead.lead_id));

  const res = await httpRequest({
    path: `/api/leads/${lead.lead_id}/weekly-report-consent`,
    method: "POST",
    port,
    body: JSON.stringify({ report_token: lead.report_token }),
  });
  assert.equal(res.status, 201);

  const updated = await readLead(lead.lead_id);
  assert.equal(updated.weekly_report_consent, true);
  assert.equal(updated.paid_report_requested, false, "Bを実行してもAの属性は変化しないはず");
  assert.equal(updated.paid_report_requested_at, null);
  assert.equal(updated.history.some((h) => h.event === "paid_report_requested"), false);
});

test("Phase4-A/B: status/delivery_statusは一切変更されない（statusがinitial_report_sent等であっても）", async (t) => {
  const port = 4792;
  await startTestServer(port, t);
  const lead = await createTestLead();
  t.after(() => cleanupLead(lead.lead_id));
  await updateLead(lead.lead_id, { status: "initial_report_sent" });

  const res = await httpRequest({
    path: `/api/leads/${lead.lead_id}/paid-report-request`,
    method: "POST",
    port,
    body: JSON.stringify({ report_token: lead.report_token }),
  });
  assert.equal(res.status, 201);

  const updated = await readLead(lead.lead_id);
  assert.equal(updated.status, "initial_report_sent", "statusは変更されないはず");
  assert.equal(updated.delivery_status, "active", "delivery_statusも変更されないはず");
});

test('Phase4-A/B: status:"rejected"のLeadに対しても、statusを勝手にvalidated等へ戻さない', async (t) => {
  const port = 4793;
  await startTestServer(port, t);
  const lead = await createTestLead();
  t.after(() => cleanupLead(lead.lead_id));
  await updateLead(lead.lead_id, { status: "rejected" });

  const res = await httpRequest({
    path: `/api/leads/${lead.lead_id}/weekly-report-consent`,
    method: "POST",
    port,
    body: JSON.stringify({ report_token: lead.report_token }),
  });
  assert.equal(res.status, 201);

  const updated = await readLead(lead.lead_id);
  assert.equal(updated.status, "rejected", "statusはrejectedのまま変わらないはず");
  assert.equal(updated.weekly_report_consent, true, "Phase4-B自体は成功するはず");
});
