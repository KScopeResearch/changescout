/**
 * aor-admin-leads.test.js — website/aor-admin/server.js のLeads API（PJ2 AOR:
 * Candidate/Approved分離仕様のAdmin UI承認機能）の自動テスト。
 *
 * 「PJ2 AOR — ベータ版システム完成（管理画面からの承認機能実装）指示書」に基づく
 * GET /api/leads・POST /api/leads/:lead_id/delivery-approval を検証する。
 * server.jsはmodule top-levelで副作用（envCheck判定・非同期startServer()実行）を持つ
 * 設計のため、aor-admin-load-company.test.jsと同じ手法（child_processで一時起動し、
 * 実HTTPで疎通確認する）を踏襲する。実AWS（SES/S3）へは一切接続しない。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const { createLead, readLead, updateLead, appendHistory, LEADS_DIR } = require("../leads/lead-store");
const { sendInitialReportForLead } = require("../leads/send-initial-report");
const { AOR_DATA_DIR } = require("../publish-report");

const SERVER_PATH = path.join(__dirname, "..", "..", "..", "website", "aor-admin", "server.js");
const ADMIN_USER = "aor-admin-leads-test";
const ADMIN_PASSWORD = "aor-admin-leads-test-password";
const TEST_SLUG_PREFIX = "test-aor-admin-leads-";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {number} port @param {string} method @param {string} pathName
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
    const req = http.request({ host: "localhost", port, path: pathName, method, headers, timeout: 5000 }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    if (payload) req.write(payload);
    req.end();
  });
}

/** @param {string|string[]} setCookieHeader */
function extractSidCookie(setCookieHeader) {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  return raw.split(";")[0];
}

/** @param {{port:number}} config @returns {Promise<{child:import('child_process').ChildProcess, port:number}>} */
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
    },
    stdio: "pipe",
  });

  let exited = false;
  child.once("exit", () => {
    exited = true;
  });

  let ready = false;
  for (let i = 0; i < 40; i += 1) {
    if (exited) break;
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

/** @param {number} port @returns {Promise<{cookie:string, csrfToken:string}>} */
async function login(port) {
  const sessionRes = await httpRequest(port, "GET", "/api/session", { auth: `${ADMIN_USER}:${ADMIN_PASSWORD}` });
  assert.equal(sessionRes.status, 200);
  const cookie = extractSidCookie(sessionRes.headers["set-cookie"]);
  const { csrf_token: csrfToken } = JSON.parse(sessionRes.body);
  return { cookie, csrfToken };
}

/** @param {string} leadId */
function cleanupLead(leadId) {
  fs.rmSync(path.join(LEADS_DIR, `${leadId}.json`), { force: true });
}

/** @param {string} slug */
function cleanupPublished(slug) {
  fs.rmSync(path.join(AOR_DATA_DIR, `${slug}.json`), { force: true });
}

function sampleParams(overrides = {}) {
  return {
    email: "aor-admin-leads-test@example.invalid",
    company_url: "https://aor-admin-leads-test.example",
    source: "テスト",
    collection_method: "public_website",
    ...overrides,
  };
}

const PORT = 4630;

test("GET /api/leads: 未認証は401", async () => {
  const { child } = await startServer({ port: PORT });
  try {
    const res = await httpRequest(PORT, "GET", "/api/leads");
    assert.equal(res.status, 401);
  } finally {
    child.kill();
  }
});

test("GET /api/leads: 収集済みLeadが一覧に含まれ、pendingのまま。report_tokenは含まれない", async (t) => {
  const { child } = await startServer({ port: PORT });
  t.after(() => child.kill());

  const created = await createLead(sampleParams({ email: "aor-admin-leads-list-test@example.invalid" }));
  t.after(() => cleanupLead(created.lead_id));

  const { cookie } = await login(PORT);
  const res = await httpRequest(PORT, "GET", "/api/leads", { cookie });
  assert.equal(res.status, 200);
  const leads = JSON.parse(res.body);
  assert.ok(Array.isArray(leads));

  const found = leads.find((l) => l.lead_id === created.lead_id);
  assert.ok(found, "作成したLeadが一覧に含まれるはず");
  assert.equal(found.delivery_approval_status, "pending", "収集されただけでは自動承認されないはず");
  assert.equal(found.email, created.email, "承認判断のためemailは表示されるはず（認証済み管理画面のため）");
  assert.equal(found.report_token, undefined, "report_tokenはレスポンスに含めないはず");
});

test("POST /api/leads/:lead_id/delivery-approval: approvedへ変更でき、historyにreviewer付きで記録される", async (t) => {
  const { child } = await startServer({ port: PORT });
  t.after(() => child.kill());

  const created = await createLead(sampleParams({ email: "aor-admin-leads-approve-test@example.invalid" }));
  t.after(() => cleanupLead(created.lead_id));

  const { cookie, csrfToken } = await login(PORT);
  const res = await httpRequest(PORT, "POST", `/api/leads/${created.lead_id}/delivery-approval`, {
    cookie,
    csrfToken,
    body: { status: "approved", comment: "公式サイト掲載の窓口アドレス、営業お断り記載なしを確認" },
  });

  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.lead.delivery_approval_status, "approved");
  assert.equal(body.lead.report_token, undefined);

  const reloaded = await readLead(created.lead_id);
  assert.equal(reloaded.delivery_approval_status, "approved");
  const historyEntry = reloaded.history.find((h) => h.event === "delivery_approved");
  assert.ok(historyEntry, "delivery_approvedイベントが記録されるはず");
  assert.equal(historyEntry.metadata.reviewer, ADMIN_USER, "reviewerは認証済みセッションのusernameのはず（bodyの値を信用しない）");
  assert.equal(historyEntry.metadata.comment, "公式サイト掲載の窓口アドレス、営業お断り記載なしを確認");
});

test("POST /api/leads/:lead_id/delivery-approval: rejectedへ変更できる", async (t) => {
  const { child } = await startServer({ port: PORT });
  t.after(() => child.kill());

  const created = await createLead(sampleParams({ email: "aor-admin-leads-reject-test@example.invalid" }));
  t.after(() => cleanupLead(created.lead_id));

  const { cookie, csrfToken } = await login(PORT);
  const res = await httpRequest(PORT, "POST", `/api/leads/${created.lead_id}/delivery-approval`, {
    cookie,
    csrfToken,
    body: { status: "rejected" },
  });

  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).lead.delivery_approval_status, "rejected");

  const reloaded = await readLead(created.lead_id);
  assert.equal(reloaded.delivery_approval_status, "rejected");
  assert.ok(reloaded.history.some((h) => h.event === "delivery_rejected"));
});

test("POST /api/leads/:lead_id/delivery-approval: 既に同じstatusの場合はhistoryを重複追記しない（べき等）", async (t) => {
  const { child } = await startServer({ port: PORT });
  t.after(() => child.kill());

  const created = await createLead(sampleParams({ email: "aor-admin-leads-idempotent-test@example.invalid" }));
  t.after(() => cleanupLead(created.lead_id));

  const { cookie, csrfToken } = await login(PORT);
  const first = await httpRequest(PORT, "POST", `/api/leads/${created.lead_id}/delivery-approval`, {
    cookie,
    csrfToken,
    body: { status: "approved" },
  });
  assert.equal(first.status, 200);

  const second = await httpRequest(PORT, "POST", `/api/leads/${created.lead_id}/delivery-approval`, {
    cookie,
    csrfToken,
    body: { status: "approved" },
  });
  assert.equal(second.status, 200);

  const reloaded = await readLead(created.lead_id);
  assert.equal(
    reloaded.history.filter((h) => h.event === "delivery_approved").length,
    1,
    "2回目の同一statusへの変更ではhistoryが増えないはず"
  );
});

test("POST /api/leads/:lead_id/delivery-approval: statusが不正な場合は400、Leadは変更されない", async (t) => {
  const { child } = await startServer({ port: PORT });
  t.after(() => child.kill());

  const created = await createLead(sampleParams({ email: "aor-admin-leads-invalid-status-test@example.invalid" }));
  t.after(() => cleanupLead(created.lead_id));

  const { cookie, csrfToken } = await login(PORT);
  const res = await httpRequest(PORT, "POST", `/api/leads/${created.lead_id}/delivery-approval`, {
    cookie,
    csrfToken,
    body: { status: "pending" }, // 承認/却下ボタンのみが対象のため、pendingへ戻す遷移は今回未対応
  });

  assert.equal(res.status, 400);
  assert.equal((await readLead(created.lead_id)).delivery_approval_status, "pending");
});

test("POST /api/leads/:lead_id/delivery-approval: 存在しないlead_idは404", async (t) => {
  const { child } = await startServer({ port: PORT });
  t.after(() => child.kill());

  const { cookie, csrfToken } = await login(PORT);
  const res = await httpRequest(PORT, "POST", `/api/leads/${"0".repeat(64)}/delivery-approval`, {
    cookie,
    csrfToken,
    body: { status: "approved" },
  });
  assert.equal(res.status, 404);
});

test("POST /api/leads/:lead_id/delivery-approval: CSRFトークンが無いと403", async (t) => {
  const { child } = await startServer({ port: PORT });
  t.after(() => child.kill());

  const created = await createLead(sampleParams({ email: "aor-admin-leads-csrf-test@example.invalid" }));
  t.after(() => cleanupLead(created.lead_id));

  const { cookie } = await login(PORT);
  const res = await httpRequest(PORT, "POST", `/api/leads/${created.lead_id}/delivery-approval`, {
    cookie,
    body: { status: "approved" },
  });
  assert.equal(res.status, 403);
  assert.equal((await readLead(created.lead_id)).delivery_approval_status, "pending");
});

// ---------------------------------------------------------------------------
// E2E: Candidate生成 → 管理画面での承認（本物のHTTP経由） → SES送信ゲート通過
// ---------------------------------------------------------------------------

test("E2E: pendingのままではSES送信ゲートで弾かれ、管理画面API経由でapprovedにした直後にゲートを通過する", async (t) => {
  const { child } = await startServer({ port: PORT });
  t.after(() => child.kill());

  const original = process.env.AOR_SITE_BASE_URL;
  process.env.AOR_SITE_BASE_URL = "https://aor.example.invalid";
  t.after(() => {
    if (original === undefined) delete process.env.AOR_SITE_BASE_URL;
    else process.env.AOR_SITE_BASE_URL = original;
  });

  // Step 1: Candidate生成（import-leads.js/create-lead-from-email.jsが辿る経路と同じ、
  // createLead()経由。delivery_approval_statusは自動的にpending）。
  const created = await createLead(sampleParams({ email: "aor-admin-leads-e2e-test@example.invalid" }));
  const slug = `${TEST_SLUG_PREFIX}${created.lead_id.slice(0, 12)}`;
  await updateLead(created.lead_id, { company_slug: slug, status: "report_generated" });
  await appendHistory(created.lead_id, "report_generated", { slug });
  t.after(() => {
    cleanupLead(created.lead_id);
    cleanupPublished(slug);
  });
  fs.mkdirSync(AOR_DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(AOR_DATA_DIR, `${slug}.json`), JSON.stringify({ company_profile: { name: "E2Eテスト株式会社" } }), "utf-8");

  const fakeSendEmail = async () => ({ messageId: "e2e-ses-message-id" });

  // Step 2: pendingのままではSESゲートで弾かれることを確認する
  const beforeApproval = await sendInitialReportForLead(created.lead_id, { sendEmail: fakeSendEmail });
  assert.equal(beforeApproval.ok, false);
  assert.equal(beforeApproval.skipped, true);
  assert.match(beforeApproval.error, /delivery_approval_status/);

  // Step 3: 管理画面のAPI（本物のHTTP経由）でapprovedへ変更する
  const { cookie, csrfToken } = await login(PORT);
  const approvalRes = await httpRequest(PORT, "POST", `/api/leads/${created.lead_id}/delivery-approval`, {
    cookie,
    csrfToken,
    body: { status: "approved" },
  });
  assert.equal(approvalRes.status, 200);
  assert.equal(JSON.parse(approvalRes.body).lead.delivery_approval_status, "approved");

  // Step 4: 承認直後にSES送信ゲートを通過し、送信されることを確認する
  const afterApproval = await sendInitialReportForLead(created.lead_id, { sendEmail: fakeSendEmail });
  assert.equal(afterApproval.ok, true, "承認直後はSES送信ゲートを通過するはず");
  assert.equal(afterApproval.messageId, "e2e-ses-message-id");
  assert.equal((await readLead(created.lead_id)).status, "initial_report_sent");
});
