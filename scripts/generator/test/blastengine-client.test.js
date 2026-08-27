/**
 * blastengine-client.test.js — scripts/generator/leads/blastengine-client.js の自動テスト。
 *
 * 実際のblastengine APIへは一切接続しない。sendEmail()のネットワーク呼び出し部分は
 * fetchImplの差し替え（DI）でモックする（ses-client.jsのcredentialProviderと同じ
 * 依存性注入パターン）。認証トークン生成（buildAuthToken）は決定的なPure Functionとして
 * ネットワーク非依存で検証する。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const blastengineClient = require("../leads/blastengine-client");

const ENV_VARS = ["BLASTENGINE_USER_ID", "BLASTENGINE_API_KEY", "BLASTENGINE_FROM", "BLASTENGINE_REPLY_TO"];

/** @returns {Object} 現在のblastengine関連環境変数のスナップショット */
function snapshotEnv() {
  const snap = {};
  ENV_VARS.forEach((name) => (snap[name] = process.env[name]));
  return snap;
}

/** @param {Object} snap */
function restoreEnv(snap) {
  ENV_VARS.forEach((name) => {
    if (snap[name] === undefined) delete process.env[name];
    else process.env[name] = snap[name];
  });
}

function setConfiguredEnv() {
  process.env.BLASTENGINE_USER_ID = "test-user-id";
  process.env.BLASTENGINE_API_KEY = "test-api-key";
  process.env.BLASTENGINE_FROM = "aor-report@changescout.jp";
}

// ---------------------------------------------------------------------------
// isConfigured() / missingEnvVars()
// ---------------------------------------------------------------------------

test("missingEnvVars: 必須環境変数が全て揃っている場合は空配列", (t) => {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  setConfiguredEnv();

  assert.deepEqual(blastengineClient.missingEnvVars(), []);
  assert.equal(blastengineClient.isConfigured(), true);
});

test("missingEnvVars: 未設定の必須環境変数（USER_ID/API_KEY/FROM）を列挙する", (t) => {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  delete process.env.BLASTENGINE_USER_ID;
  delete process.env.BLASTENGINE_API_KEY;
  delete process.env.BLASTENGINE_FROM;

  const missing = blastengineClient.missingEnvVars();
  assert.ok(missing.includes("BLASTENGINE_USER_ID"));
  assert.ok(missing.includes("BLASTENGINE_API_KEY"));
  assert.ok(missing.includes("BLASTENGINE_FROM"));
  assert.equal(blastengineClient.isConfigured(), false);
});

test("missingEnvVars: BLASTENGINE_REPLY_TOは任意項目のため未設定でも必須リストに含まれない", (t) => {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  setConfiguredEnv();
  delete process.env.BLASTENGINE_REPLY_TO;

  assert.deepEqual(blastengineClient.missingEnvVars(), []);
});

// ---------------------------------------------------------------------------
// escapeHtml()
// ---------------------------------------------------------------------------

test("escapeHtml: HTML特殊文字をエスケープする", () => {
  assert.equal(
    blastengineClient.escapeHtml(`<a href="x">&'</a>`),
    "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;"
  );
});

// ---------------------------------------------------------------------------
// buildAuthToken()（Pure Function、決定的であることのみ検証。実際のAPI認証仕様は
// 公式ドキュメントでの検証が別途必要。blastengine-client.js冒頭の「要検証事項」参照）
// ---------------------------------------------------------------------------

test("buildAuthToken: 同じuserId・apiKeyからは常に同じトークンを生成する（決定的）", () => {
  const token1 = blastengineClient.buildAuthToken("user123", "key456");
  const token2 = blastengineClient.buildAuthToken("user123", "key456");
  assert.equal(token1, token2);
  assert.equal(typeof token1, "string");
  assert.ok(token1.length > 0);
});

test("buildAuthToken: userIdまたはapiKeyが異なれば異なるトークンになる", () => {
  const base = blastengineClient.buildAuthToken("user123", "key456");
  assert.notEqual(blastengineClient.buildAuthToken("other-user", "key456"), base);
  assert.notEqual(blastengineClient.buildAuthToken("user123", "other-key"), base);
});

// ---------------------------------------------------------------------------
// buildRequestHeaders()
// ---------------------------------------------------------------------------

test("buildRequestHeaders: Content-TypeとBearerトークンを含む", () => {
  const headers = blastengineClient.buildRequestHeaders("dummy-token");
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers["Authorization"], "Bearer dummy-token");
});

// ---------------------------------------------------------------------------
// buildSendEmailBody()
// ---------------------------------------------------------------------------

test("buildSendEmailBody: to/from/subject/text_part/html_partを正しく組み立てる", () => {
  const body = blastengineClient.buildSendEmailBody({
    to: "recipient@example.com",
    from: "aor-report@changescout.jp",
    subject: "件名テスト",
    text: "本文テキスト",
    html: "<p>本文HTML</p>",
  });
  assert.equal(body.to, "recipient@example.com");
  assert.deepEqual(body.from, { email: "aor-report@changescout.jp" });
  assert.equal(body.subject, "件名テスト");
  assert.equal(body.text_part, "本文テキスト");
  assert.equal(body.html_part, "<p>本文HTML</p>");
  assert.equal(body.encode, "UTF-8");
});

test("buildSendEmailBody: fromNameを指定した場合はfrom.nameを含む", () => {
  const body = blastengineClient.buildSendEmailBody({
    to: "recipient@example.com",
    from: "aor-report@changescout.jp",
    fromName: "AI Opportunity Report 運営事務局",
    subject: "s",
    text: "t",
    html: "<p>h</p>",
  });
  assert.deepEqual(body.from, { email: "aor-report@changescout.jp", name: "AI Opportunity Report 運営事務局" });
});

test("buildSendEmailBody: replyToを指定した場合はreply_toフィールドを含む（公式フィールド名、Phase45 STEP3Cで確認）", () => {
  const body = blastengineClient.buildSendEmailBody({
    to: "recipient@example.com",
    from: "aor-report@changescout.jp",
    replyTo: "reply@changescout.jp",
    subject: "s",
    text: "t",
    html: "<p>h</p>",
  });
  assert.deepEqual(body.reply_to, { email: "reply@changescout.jp" });
});

test("buildSendEmailBody: replyTo未指定の場合はreply_toフィールドを含まない", () => {
  const body = blastengineClient.buildSendEmailBody({
    to: "recipient@example.com",
    from: "aor-report@changescout.jp",
    subject: "s",
    text: "t",
    html: "<p>h</p>",
  });
  assert.equal("reply_to" in body, false);
});

test("buildSendEmailBody: unsubscribe指定時はlist_unsubscribeフィールドを組み立てる（公式フィールド名、Phase45 STEP3Cで確認）", () => {
  const body = blastengineClient.buildSendEmailBody({
    to: "recipient@example.com",
    from: "aor-report@changescout.jp",
    subject: "s",
    text: "t",
    html: "<p>h</p>",
    unsubscribe: { url: "https://aor.example.jp/unsubscribe.html?lead=l1&token=t1", mailto: "aor-report@changescout.jp" },
  });
  assert.deepEqual(body.list_unsubscribe, {
    mailto: "aor-report@changescout.jp",
    url: "https://aor.example.jp/unsubscribe.html?lead=l1&token=t1",
  });
});

test("buildSendEmailBody: unsubscribe.urlのみ（mailto省略）の場合はurlのみのlist_unsubscribeになる", () => {
  const body = blastengineClient.buildSendEmailBody({
    to: "recipient@example.com",
    from: "aor-report@changescout.jp",
    subject: "s",
    text: "t",
    html: "<p>h</p>",
    unsubscribe: { url: "https://aor.example.jp/unsubscribe.html?lead=l1&token=t1" },
  });
  assert.deepEqual(body.list_unsubscribe, { url: "https://aor.example.jp/unsubscribe.html?lead=l1&token=t1" });
});

test("buildSendEmailBody: unsubscribe未指定・空オブジェクトの場合はlist_unsubscribeフィールドを含めない", () => {
  const bodyNoUnsub = blastengineClient.buildSendEmailBody({
    to: "recipient@example.com",
    from: "aor-report@changescout.jp",
    subject: "s",
    text: "t",
    html: "<p>h</p>",
  });
  assert.equal("list_unsubscribe" in bodyNoUnsub, false);

  const bodyEmptyUnsub = blastengineClient.buildSendEmailBody({
    to: "recipient@example.com",
    from: "aor-report@changescout.jp",
    subject: "s",
    text: "t",
    html: "<p>h</p>",
    unsubscribe: {},
  });
  assert.equal("list_unsubscribe" in bodyEmptyUnsub, false);
});

// ---------------------------------------------------------------------------
// callSendEmail()（低レベル、リトライ・タイムアウト無し。fetchImplモックのみ使用）
// ---------------------------------------------------------------------------

test("callSendEmail: 成功時、delivery_id(数値)を文字列化したmessageIdを返す", async (t) => {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  setConfiguredEnv();

  const fakeFetch = async (url, init) => {
    assert.equal(url, "https://app.engn.jp/api/v1/deliveries/transaction");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["Content-Type"], "application/json");
    assert.match(init.headers["Authorization"], /^Bearer .+/);
    return { ok: true, json: async () => ({ delivery_id: 987654 }) };
  };

  const result = await blastengineClient.callSendEmail(
    { to: "recipient@example.com", subject: "s", text_part: "t", html_part: "<p>h</p>" },
    undefined,
    { fetchImpl: fakeFetch }
  );

  assert.equal(result.messageId, "987654");
  assert.equal(typeof result.messageId, "string");
});

test("callSendEmail: HTTPエラー時、公式エラー形式（error_messages.main）からメッセージを抽出しstatusCode/retryableを設定する", async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 503,
    text: async () => JSON.stringify({ error_messages: { main: ["temporarily unavailable", "please retry later"] } }),
  });

  await assert.rejects(
    () => blastengineClient.callSendEmail({ to: "x@example.com" }, undefined, { fetchImpl: fakeFetch }),
    (err) => {
      assert.match(err.message, /temporarily unavailable/);
      assert.match(err.message, /please retry later/);
      assert.equal(err.code, null, "公式ドキュメントに機械可読なcodeフィールドの記載が無いため常にnull");
      assert.equal(err.statusCode, 503);
      assert.equal(err.retryable, true, "5xxはretryable扱いのはず");
      return true;
    }
  );
});

test("callSendEmail: 4xx（429以外）はretryable:falseになる", async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ error_messages: { main: ["bad request"] } }),
  });

  await assert.rejects(
    () => blastengineClient.callSendEmail({ to: "x@example.com" }, undefined, { fetchImpl: fakeFetch }),
    (err) => {
      assert.match(err.message, /bad request/);
      assert.equal(err.statusCode, 400);
      assert.equal(err.retryable, false);
      return true;
    }
  );
});

test("callSendEmail: 429（レート制限）はretryable:trueになる（公式仕様: 500req/min）", async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 429,
    text: async () => JSON.stringify({ error_messages: { main: ["rate limit exceeded"] } }),
  });

  await assert.rejects(
    () => blastengineClient.callSendEmail({ to: "x@example.com" }, undefined, { fetchImpl: fakeFetch }),
    (err) => {
      assert.equal(err.statusCode, 429);
      assert.equal(err.retryable, true);
      return true;
    }
  );
});

test("callSendEmail: レスポンスにdelivery_idが含まれない場合は明確なエラーになる", async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({}) });

  await assert.rejects(
    () => blastengineClient.callSendEmail({ to: "x@example.com" }, undefined, { fetchImpl: fakeFetch }),
    /delivery_id/
  );
});

// ---------------------------------------------------------------------------
// sendEmail()（環境変数チェック＋callSendEmail経由の成功パスをfetchImplモックで検証）
// ---------------------------------------------------------------------------

test("sendEmail: 環境変数未設定時は送信を試みず明確なエラーを投げる", async (t) => {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  delete process.env.BLASTENGINE_USER_ID;
  delete process.env.BLASTENGINE_API_KEY;
  delete process.env.BLASTENGINE_FROM;

  await assert.rejects(
    () => blastengineClient.sendEmail({ to: "x@example.com", subject: "s", text: "t", html: "<p>h</p>" }),
    /環境変数が設定されていません/
  );
});

test("sendEmail: fetchImplモック経由で成功時にmessageId(文字列)を返す", async (t) => {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  setConfiguredEnv();

  const fakeFetch = async () => ({ ok: true, json: async () => ({ delivery_id: 42 }) });

  const result = await blastengineClient.sendEmail(
    { to: "recipient@example.com", subject: "件名", text: "text", html: "<p>html</p>" },
    { fetchImpl: fakeFetch }
  );

  assert.equal(result.messageId, "42");
  assert.equal(typeof result.messageId, "string");
});
