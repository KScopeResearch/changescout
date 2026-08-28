/**
 * lambda-blastengine-webhook-handler.test.js —
 * scripts/generator/leads/lambda-blastengine-webhook-handler.js の自動テスト
 * （PJ2 AOR Phase47 STEP1）。
 *
 * lambda-blastengine-webhook-handler.jsは既存のprocessBlastengineEvent()
 * （leads/process-blastengine-event.js）をそのまま呼ぶ薄いadapterである。
 * blastengineイベント処理自体の正しさはprocess-blastengine-event.test.jsで既に
 * 検証済みのため、ここでは重複させない。本テストは「HTTPトランスポート層として
 * 正しくメソッド確認・Basic認証・JSON parse・HTTPステータスを扱っているか」にのみ
 * 焦点を当てる。実blastengine接続・実AWSへは一切接続しない。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { handler, isAuthorized } = require("../leads/lambda-blastengine-webhook-handler");
const processBlastengineEventModule = require("../leads/process-blastengine-event");

const WEBHOOK_USER = "webhook-test-user";
const WEBHOOK_PASSWORD = "webhook-test-password";

function basicAuthHeader(user, password) {
  return `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
}

/** @param {import('node:test').TestContext} t 環境変数をテスト用に固定し、t.after()で元に戻す */
function withWebhookCredentials(t) {
  const originalUser = process.env.BLASTENGINE_WEBHOOK_USER;
  const originalPassword = process.env.BLASTENGINE_WEBHOOK_PASSWORD;
  process.env.BLASTENGINE_WEBHOOK_USER = WEBHOOK_USER;
  process.env.BLASTENGINE_WEBHOOK_PASSWORD = WEBHOOK_PASSWORD;
  t.after(() => {
    process.env.BLASTENGINE_WEBHOOK_USER = originalUser;
    process.env.BLASTENGINE_WEBHOOK_PASSWORD = originalPassword;
  });
}

/** @param {Function} fakeFn @returns {Function} 元へ戻す関数 */
function stubProcessBlastengineEvent(fakeFn) {
  const original = processBlastengineEventModule.processBlastengineEvent;
  processBlastengineEventModule.processBlastengineEvent = fakeFn;
  return () => {
    processBlastengineEventModule.processBlastengineEvent = original;
  };
}

function makeEvent({ method = "POST", authorization, body } = {}) {
  return {
    requestContext: { http: { method } },
    headers: authorization ? { authorization } : {},
    body: body === undefined ? "" : body,
  };
}

// ---------------------------------------------------------------------------
// isAuthorized() — Basic認証の単体テスト
// ---------------------------------------------------------------------------

test("isAuthorized: 正しいuser/passwordならtrue", (t) => {
  withWebhookCredentials(t);
  assert.equal(isAuthorized(basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASSWORD)), true);
});

test("isAuthorized: 誤ったpasswordならfalse", (t) => {
  withWebhookCredentials(t);
  assert.equal(isAuthorized(basicAuthHeader(WEBHOOK_USER, "wrong-password")), false);
});

test("isAuthorized: Authorizationヘッダーが無い/Basic形式でない場合はfalse", (t) => {
  withWebhookCredentials(t);
  assert.equal(isAuthorized(null), false);
  assert.equal(isAuthorized(undefined), false);
  assert.equal(isAuthorized("Bearer sometoken"), false);
});

test("isAuthorized: 環境変数（BLASTENGINE_WEBHOOK_USER/PASSWORD）が未設定の場合は常にfalse（fail closed）", () => {
  const originalUser = process.env.BLASTENGINE_WEBHOOK_USER;
  const originalPassword = process.env.BLASTENGINE_WEBHOOK_PASSWORD;
  delete process.env.BLASTENGINE_WEBHOOK_USER;
  delete process.env.BLASTENGINE_WEBHOOK_PASSWORD;
  try {
    assert.equal(isAuthorized(basicAuthHeader("anyone", "anything")), false);
  } finally {
    if (originalUser === undefined) delete process.env.BLASTENGINE_WEBHOOK_USER;
    else process.env.BLASTENGINE_WEBHOOK_USER = originalUser;
    if (originalPassword === undefined) delete process.env.BLASTENGINE_WEBHOOK_PASSWORD;
    else process.env.BLASTENGINE_WEBHOOK_PASSWORD = originalPassword;
  }
});

// ---------------------------------------------------------------------------
// handler() — HTTPトランスポート層の統合テスト（processBlastengineEvent()はモック）
// ---------------------------------------------------------------------------

test("handler: POST成功時は200 {ok:true, results}を返す", async (t) => {
  withWebhookCredentials(t);
  const restore = stubProcessBlastengineEvent(async () => [{ ok: true, leadId: "lead-1", event: "email_bounced" }]);
  t.after(restore);

  const res = await handler(
    makeEvent({ authorization: basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASSWORD), body: JSON.stringify({ events: [] }) })
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, results: [{ ok: true, leadId: "lead-1", event: "email_bounced" }] });
});

test("handler: GET（未対応メソッド）は405になる", async (t) => {
  withWebhookCredentials(t);
  const res = await handler(makeEvent({ method: "GET" }));
  assert.equal(res.statusCode, 405);
  assert.equal(JSON.parse(res.body).ok, false);
});

test("handler: Basic認証失敗は401になり、processBlastengineEvent()は呼ばれない", async (t) => {
  withWebhookCredentials(t);
  const calls = [];
  const restore = stubProcessBlastengineEvent(async () => {
    calls.push(true);
    return [];
  });
  t.after(restore);

  const res = await handler(
    makeEvent({ authorization: basicAuthHeader(WEBHOOK_USER, "wrong-password"), body: JSON.stringify({ events: [] }) })
  );
  assert.equal(res.statusCode, 401);
  assert.equal(calls.length, 0, "認証失敗時は業務ロジックを一切呼んではならない");
});

test("handler: Authorizationヘッダー自体が無い場合も401になる", async (t) => {
  withWebhookCredentials(t);
  const res = await handler(makeEvent({ body: JSON.stringify({ events: [] }) }));
  assert.equal(res.statusCode, 401);
});

test("handler: 不正なJSONボディは400になる", async (t) => {
  withWebhookCredentials(t);
  const res = await handler(
    makeEvent({ authorization: basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASSWORD), body: "{not valid json" })
  );
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).ok, false);
});

test("handler: JSONとしては妥当だがpayload形状が不正（events配列が無い）の場合は400になる", async (t) => {
  withWebhookCredentials(t);
  const res = await handler(
    makeEvent({ authorization: basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASSWORD), body: JSON.stringify({ foo: "bar" }) })
  );
  assert.equal(res.statusCode, 400);
});

test("handler: レスポンスにmailaddress・Authorizationヘッダーの値が一切含まれない（PII非漏洩）", async (t) => {
  withWebhookCredentials(t);
  const restore = stubProcessBlastengineEvent(async () => [
    { ok: false, error: "該当するLeadが見つかりません（delivery_id: 12345）" },
  ]);
  t.after(restore);

  const authHeader = basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASSWORD);
  const res = await handler(makeEvent({ authorization: authHeader, body: JSON.stringify({ events: [] }) }));
  assert.ok(!res.body.includes(authHeader), "レスポンスボディにAuthorizationヘッダーの値を含めてはならない");
  assert.ok(!res.body.includes(WEBHOOK_PASSWORD), "レスポンスボディにパスワードを含めてはならない");
});

test("handler: console出力（stdout）にAuthorizationヘッダーの値・パスワードが一切出力されない", async (t) => {
  withWebhookCredentials(t);
  const restore = stubProcessBlastengineEvent(async () => [{ ok: true, leadId: "lead-1", event: "email_bounced" }]);
  t.after(restore);

  const originalWrite = process.stdout.write;
  let captured = "";
  process.stdout.write = (chunk, ...args) => {
    captured += chunk.toString();
    return originalWrite.apply(process.stdout, [chunk, ...args]);
  };

  const authHeader = basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASSWORD);
  try {
    await handler(makeEvent({ authorization: authHeader, body: JSON.stringify({ events: [] }) }));
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.ok(!captured.includes(WEBHOOK_PASSWORD), "stdoutにパスワードが出力されてはならない");
  assert.ok(!captured.includes(authHeader), "stdoutにAuthorizationヘッダーの値が出力されてはならない");
});
