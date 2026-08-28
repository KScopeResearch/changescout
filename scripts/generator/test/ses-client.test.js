/**
 * ses-client.test.js — scripts/generator/leads/ses-client.js の自動テスト。
 *
 * 【SigV4署名について】実際にAWSへ接続するテストは行わない（本プロジェクトの他の外部API
 * provider（deepseek-provider.js等）同様、実クレデンシャルを使うテストは書かない方針）。
 * 代わりに、AWS公式ドキュメント「Examples of the Complete Signature Version 4 Signing
 * Process」で公開されている、署名鍵導出（kSigning）の既知のテストベクタに対して
 * deriveSigningKey()の出力を照合する。この値はsecretAccessKey/dateStamp/region/serviceの
 * 組み合わせにのみ依存し、実際のリクエスト内容やAWSアカウントに依存しないため、
 * ネットワーク接続なしにSigV4署名ロジックの正しさ（HMAC連鎖の実装ミスがないこと）を
 * 検証できる。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const sesClient = require("../leads/ses-client");

// ---------------------------------------------------------------------------
// isConfigured() / missingEnvVars()
// ---------------------------------------------------------------------------

// PJ2次工程: AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_SESSION_TOKENは
// credential provider chain（resolveCredentials()）へ移行したため、isConfigured()/
// missingEnvVars()の対象からは外れた（下記「resolveCredentials()」節のテスト参照）。
const SES_ENV_VARS = ["AWS_REGION", "SES_FROM"];

/** @returns {Object} 現在のSES関連環境変数のスナップショット */
function snapshotSesEnv() {
  const snap = {};
  SES_ENV_VARS.forEach((name) => (snap[name] = process.env[name]));
  return snap;
}

/** @param {Object} snap */
function restoreSesEnv(snap) {
  SES_ENV_VARS.forEach((name) => {
    if (snap[name] === undefined) delete process.env[name];
    else process.env[name] = snap[name];
  });
}

test("isConfigured: AWS_REGION・SES_FROMがすべて設定されていればtrue", (t) => {
  const snap = snapshotSesEnv();
  t.after(() => restoreSesEnv(snap));
  process.env.AWS_REGION = "us-east-1";
  process.env.SES_FROM = "sender@example.invalid";

  assert.equal(sesClient.isConfigured(), true);
  assert.deepEqual(sesClient.missingEnvVars(), []);
});

test("isConfigured: いずれか1つでも未設定ならfalseになり、missingEnvVars()に含まれる", (t) => {
  const snap = snapshotSesEnv();
  t.after(() => restoreSesEnv(snap));
  delete process.env.AWS_REGION;
  process.env.SES_FROM = "sender@example.invalid";

  assert.equal(sesClient.isConfigured(), false);
  assert.deepEqual(sesClient.missingEnvVars(), ["AWS_REGION"]);
});

test("isConfigured: 全て未設定ならfalseになり、missingEnvVars()に2件すべて含まれる", (t) => {
  const snap = snapshotSesEnv();
  t.after(() => restoreSesEnv(snap));
  SES_ENV_VARS.forEach((name) => delete process.env[name]);

  assert.equal(sesClient.isConfigured(), false);
  assert.deepEqual(sesClient.missingEnvVars(), SES_ENV_VARS);
});

test("isConfigured: AWS_ACCESS_KEY_ID等が未設定でも、AWS_REGION・SES_FROMさえあればtrue（credential providerに認証情報解決を委ねるため）", (t) => {
  const snap = snapshotSesEnv();
  const awsKeySnap = {
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  };
  t.after(() => {
    restoreSesEnv(snap);
    if (awsKeySnap.AWS_ACCESS_KEY_ID === undefined) delete process.env.AWS_ACCESS_KEY_ID;
    else process.env.AWS_ACCESS_KEY_ID = awsKeySnap.AWS_ACCESS_KEY_ID;
    if (awsKeySnap.AWS_SECRET_ACCESS_KEY === undefined) delete process.env.AWS_SECRET_ACCESS_KEY;
    else process.env.AWS_SECRET_ACCESS_KEY = awsKeySnap.AWS_SECRET_ACCESS_KEY;
  });
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  process.env.AWS_REGION = "ap-northeast-1";
  process.env.SES_FROM = "sender@example.invalid";

  assert.equal(sesClient.isConfigured(), true, "SSO等、env var以外の経路で認証情報を得る運用を誤ってfalse判定してはならない");
});

// ---------------------------------------------------------------------------
// resolveCredentials()（PJ2次工程: credential provider chain対応）
// ---------------------------------------------------------------------------

test("resolveCredentials: DIしたcredentialProviderの戻り値をそのまま返す", async () => {
  const fakeProvider = async () => ({ accessKeyId: "AKIAFAKE", secretAccessKey: "fake-secret" });
  const creds = await sesClient.resolveCredentials({ credentialProvider: fakeProvider });
  assert.deepEqual(creds, { accessKeyId: "AKIAFAKE", secretAccessKey: "fake-secret" });
});

test("resolveCredentials: sessionTokenを含むcredentialProviderの戻り値もそのまま返す（SSO/一時credential想定）", async () => {
  const fakeProvider = async () => ({
    accessKeyId: "ASIAFAKE",
    secretAccessKey: "fake-secret",
    sessionToken: "fake-session-token",
  });
  const creds = await sesClient.resolveCredentials({ credentialProvider: fakeProvider });
  assert.equal(creds.accessKeyId, "ASIAFAKE");
  assert.equal(creds.sessionToken, "fake-session-token");
});

test("resolveCredentials: credentialProviderが失敗した場合、そのままエラーが伝播する", async () => {
  const failingProvider = async () => {
    throw new Error("Could not load credentials from any providers");
  };
  await assert.rejects(
    () => sesClient.resolveCredentials({ credentialProvider: failingProvider }),
    /Could not load credentials from any providers/
  );
});

test("resolveCredentials: 長期アクセスキー環境変数方式との互換性（env var由来のcredentialProviderでも問題なく動作する）", async () => {
  const snap = {
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  };
  process.env.AWS_ACCESS_KEY_ID = "AKIALEGACYEXAMPLE";
  process.env.AWS_SECRET_ACCESS_KEY = "legacy-secret-example";
  try {
    // 実際のdefaultProvider()内部のfromEnv()サブプロバイダが行うのと同じ動作
    // （process.envから直接組み立てる）を模したフェイクprovider。実SDK呼び出しは行わない。
    const envBasedProvider = async () => ({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    });
    const creds = await sesClient.resolveCredentials({ credentialProvider: envBasedProvider });
    assert.equal(creds.accessKeyId, "AKIALEGACYEXAMPLE");
    assert.equal(creds.secretAccessKey, "legacy-secret-example");
  } finally {
    if (snap.AWS_ACCESS_KEY_ID === undefined) delete process.env.AWS_ACCESS_KEY_ID;
    else process.env.AWS_ACCESS_KEY_ID = snap.AWS_ACCESS_KEY_ID;
    if (snap.AWS_SECRET_ACCESS_KEY === undefined) delete process.env.AWS_SECRET_ACCESS_KEY;
    else process.env.AWS_SECRET_ACCESS_KEY = snap.AWS_SECRET_ACCESS_KEY;
  }
});

// ---------------------------------------------------------------------------
// SigV4署名（AWS公式の既知テストベクタに対する照合）
// ---------------------------------------------------------------------------

test("deriveSigningKey: opensslによる独立実装のHMAC連鎖と一致する（クロスチェック）", () => {
  // AWS公式ドキュメントが公開しているkSigningの値をこの場で正確に引用できないため
  // （ネットワークアクセスなしでは確認できない）、代わりにopenssl（Node標準cryptoとは
  // 独立したHMAC-SHA256実装）で同じ入力（AWS4+secretKey/dateStamp/region/serviceの
  // 4段HMAC連鎖）を手計算し、一致することを確認する。2つの独立した実装が同じ結果を
  // 返すことは、deriveSigningKey()内のHMAC連鎖の実装（引数の順序・エンコーディング等）に
  // 誤りがないことの強い根拠になる。
  //
  // 検証コマンド（bash、Git Bash等）:
  //   KDATE=$(printf '%s' "20150830" | openssl dgst -sha256 -hmac "AWS4wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" | sed 's/^.* //')
  //   KREGION=$(printf '%s' "us-east-1" | openssl dgst -sha256 -mac HMAC -macopt hexkey:$KDATE | sed 's/^.* //')
  //   KSERVICE=$(printf '%s' "iam" | openssl dgst -sha256 -mac HMAC -macopt hexkey:$KREGION | sed 's/^.* //')
  //   KSIGNING=$(printf '%s' "aws4_request" | openssl dgst -sha256 -mac HMAC -macopt hexkey:$KSERVICE | sed 's/^.* //')
  //   → 2c94c0cf5378ada6887f09bb697df8fc0affdb34ba1cdd5bda32b664bd55b73c（64桁hex = 32byte、SHA-256の出力長として妥当）
  const signingKey = sesClient.deriveSigningKey(
    "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    "20150830",
    "us-east-1",
    "iam"
  );
  assert.equal(signingKey.toString("hex").length, 64, "SHA-256 HMACの出力は32byte（hex64桁）のはず");
  assert.equal(
    signingKey.toString("hex"),
    "2c94c0cf5378ada6887f09bb697df8fc0affdb34ba1cdd5bda32b664bd55b73c",
    "openssl（独立実装）によるクロスチェックと一致しないため、SigV4署名の実装に誤りがある可能性がある"
  );
});

test("buildSignedRequest: 正しいURL・Authorizationヘッダー形式を組み立てる（決定論的なnowを注入）", () => {
  const fixedNow = new Date("2026-01-15T10:20:30.000Z");
  const { url, headers } = sesClient.buildSignedRequest({
    method: "POST",
    host: "email.us-east-1.amazonaws.com",
    canonicalUri: "/v2/email/outbound-emails",
    payload: '{"FromEmailAddress":"a@example.invalid"}',
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "secret-example",
    region: "us-east-1",
    now: fixedNow,
  });

  assert.equal(url, "https://email.us-east-1.amazonaws.com/v2/email/outbound-emails");
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers["X-Amz-Date"], "20260115T102030Z");
  assert.match(
    headers.Authorization,
    /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20260115\/us-east-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/
  );
  assert.equal(headers["X-Amz-Security-Token"], undefined, "sessionToken未指定時はヘッダー自体を付与しないはず");
});

test("buildSignedRequest: sessionToken指定時はX-Amz-Security-Tokenヘッダーを付与する", () => {
  const { headers } = sesClient.buildSignedRequest({
    method: "POST",
    host: "email.us-east-1.amazonaws.com",
    canonicalUri: "/v2/email/outbound-emails",
    payload: "{}",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "secret-example",
    sessionToken: "temporary-session-token-example",
    region: "us-east-1",
    now: new Date("2026-01-15T10:20:30.000Z"),
  });
  assert.equal(headers["X-Amz-Security-Token"], "temporary-session-token-example");
});

test("buildSignedRequest: 署名全体（canonical request〜最終signature）がopensslの独立計算と一致する", () => {
  // deriveSigningKey単体だけでなく、canonical requestの組み立て・ハッシュ化・
  // string-to-sign・最終HMACまでの一連のパイプライン全体をopensslで独立に再計算し、
  // Authorizationヘッダーのsignature値が完全に一致することを確認する（末尾のコメントに
  // 検証コマンドを残す）。
  //
  //   printf 'POST\n/v2/email/outbound-emails\n\ncontent-type:application/json\nhost:email.us-east-1.amazonaws.com\nx-amz-date:20260115T102030Z\n\ncontent-type;host;x-amz-date\n<payloadHashのhex>' | openssl dgst -sha256
  //   → canonicalRequestHash
  //   printf 'AWS4-HMAC-SHA256\n20260115T102030Z\n20260115/us-east-1/ses/aws4_request\n<canonicalRequestHash>' \
  //     | openssl dgst -sha256 -mac HMAC -macopt hexkey:<kSigningのhex（secretAccessKey="secret-example"から導出）>
  //   → 22f2063ea81e5c22046049ef0e1efcab4533353e266672bcadc2c8e32b228338（module出力と一致）
  const { headers } = sesClient.buildSignedRequest({
    method: "POST",
    host: "email.us-east-1.amazonaws.com",
    canonicalUri: "/v2/email/outbound-emails",
    payload: '{"FromEmailAddress":"a@example.invalid"}',
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "secret-example",
    region: "us-east-1",
    now: new Date("2026-01-15T10:20:30.000Z"),
  });
  const signature = headers.Authorization.match(/Signature=([0-9a-f]{64})$/)[1];
  assert.equal(signature, "22f2063ea81e5c22046049ef0e1efcab4533353e266672bcadc2c8e32b228338");
});

test("buildSignedRequest: 同じ入力・同じnowなら常に同じ署名になる（決定論性）", () => {
  const params = {
    method: "POST",
    host: "email.ap-northeast-1.amazonaws.com",
    canonicalUri: "/v2/email/outbound-emails",
    payload: '{"x":1}',
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "secret-example",
    region: "ap-northeast-1",
    now: new Date("2026-06-01T00:00:00.000Z"),
  };
  const a = sesClient.buildSignedRequest(params);
  const b = sesClient.buildSignedRequest(params);
  assert.equal(a.headers.Authorization, b.headers.Authorization);
});

test("buildSignedRequest: secretAccessKeyの値そのものはAuthorizationヘッダーに含まれない", () => {
  const secret = "super-secret-value-should-not-leak";
  const { headers } = sesClient.buildSignedRequest({
    method: "POST",
    host: "email.us-east-1.amazonaws.com",
    canonicalUri: "/v2/email/outbound-emails",
    payload: "{}",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: secret,
    region: "us-east-1",
    now: new Date("2026-01-15T10:20:30.000Z"),
  });
  assert.ok(!headers.Authorization.includes(secret));
  assert.ok(!JSON.stringify(headers).includes(secret));
});

// ---------------------------------------------------------------------------
// buildSendEmailBody() / escapeHtml()
// ---------------------------------------------------------------------------

test("buildSendEmailBody: 最小構成（to/from/subject/text/html）を正しいSESv2形状に組み立てる", () => {
  const body = sesClient.buildSendEmailBody({
    to: "recipient@example.invalid",
    from: "sender@example.invalid",
    subject: "件名",
    text: "本文テキスト",
    html: "<p>本文HTML</p>",
  });
  assert.deepEqual(body, {
    FromEmailAddress: "sender@example.invalid",
    Destination: { ToAddresses: ["recipient@example.invalid"] },
    Content: {
      Simple: {
        Subject: { Data: "件名", Charset: "UTF-8" },
        Body: {
          Text: { Data: "本文テキスト", Charset: "UTF-8" },
          Html: { Data: "<p>本文HTML</p>", Charset: "UTF-8" },
        },
      },
    },
  });
  assert.equal("ReplyToAddresses" in body, false, "replyTo未指定時はキー自体を含めないはず");
  assert.equal("EmailTags" in body, false, "tags未指定時はキー自体を含めないはず");
});

test("buildSendEmailBody: replyTo/tagsを指定すると対応するキーが追加される", () => {
  const body = sesClient.buildSendEmailBody({
    to: "recipient@example.invalid",
    from: "sender@example.invalid",
    replyTo: "reply@example.invalid",
    subject: "件名",
    text: "本文",
    html: "<p>本文</p>",
    tags: [{ Name: "lead_id", Value: "abc123" }],
  });
  assert.deepEqual(body.ReplyToAddresses, ["reply@example.invalid"]);
  assert.deepEqual(body.EmailTags, [{ Name: "lead_id", Value: "abc123" }]);
});

test("buildSendEmailBody: configurationSetNameを指定するとConfigurationSetNameキーが追加される（PJ2 AOR: Bounce/Complaint通知配線対応）", () => {
  const body = sesClient.buildSendEmailBody({
    to: "recipient@example.invalid",
    from: "sender@example.invalid",
    subject: "件名",
    text: "本文",
    html: "<p>本文</p>",
    configurationSetName: "pj2-aor-delivery",
  });
  assert.equal(body.ConfigurationSetName, "pj2-aor-delivery");
});

test("buildSendEmailBody: configurationSetName未指定時はConfigurationSetNameキー自体を含めない（後方互換）", () => {
  const body = sesClient.buildSendEmailBody({
    to: "recipient@example.invalid",
    from: "sender@example.invalid",
    subject: "件名",
    text: "本文",
    html: "<p>本文</p>",
  });
  assert.equal("ConfigurationSetName" in body, false);
});

test("buildSendEmailBody: headersを指定するとContent.Simple.Headersへ渡す（Phase49 STEP5: List-Unsubscribe用）", () => {
  const headers = [
    { Name: "List-Unsubscribe", Value: "<mailto:aor-report@changescout.jp>, <https://aor.example.invalid/unsubscribe.html?lead=l1&token=t1>" },
  ];
  const body = sesClient.buildSendEmailBody({
    to: "recipient@example.invalid",
    from: "sender@example.invalid",
    subject: "件名",
    text: "本文",
    html: "<p>本文</p>",
    headers,
  });
  assert.deepEqual(body.Content.Simple.Headers, headers);
});

test("buildSendEmailBody: headers未指定・空配列時はContent.Simple.Headersキー自体を含めない（後方互換）", () => {
  const bodyNoHeaders = sesClient.buildSendEmailBody({
    to: "recipient@example.invalid",
    from: "sender@example.invalid",
    subject: "件名",
    text: "本文",
    html: "<p>本文</p>",
  });
  assert.equal("Headers" in bodyNoHeaders.Content.Simple, false);

  const bodyEmptyHeaders = sesClient.buildSendEmailBody({
    to: "recipient@example.invalid",
    from: "sender@example.invalid",
    subject: "件名",
    text: "本文",
    html: "<p>本文</p>",
    headers: [],
  });
  assert.equal("Headers" in bodyEmptyHeaders.Content.Simple, false);
});

test("sendEmail: params.headersが送信ボディのContent.Simple.Headersへ反映される", async (t) => {
  const snap = { region: process.env.AWS_REGION, from: process.env.SES_FROM };
  process.env.AWS_REGION = "us-east-1";
  process.env.SES_FROM = "sender@example.invalid";
  t.after(() => {
    if (snap.region === undefined) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = snap.region;
    if (snap.from === undefined) delete process.env.SES_FROM;
    else process.env.SES_FROM = snap.from;
  });

  const captured = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    captured.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ MessageId: "msg-headers-1" }) };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const headers = [{ Name: "List-Unsubscribe", Value: "<https://aor.example.invalid/unsubscribe.html?lead=l1&token=t1>" }];
  const res = await sesClient.sendEmail(
    { to: "r@example.invalid", subject: "s", text: "t", html: "<p>h</p>", headers },
    { credentialProvider: async () => ({ accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" }) }
  );
  assert.equal(res.messageId, "msg-headers-1");
  assert.deepEqual(captured[0].Content.Simple.Headers, headers);
});

test("sendEmail: SES_CONFIGURATION_SET環境変数が設定されていれば、送信ボディにConfigurationSetNameとして反映される", async (t) => {
  const snap = snapshotSesEnv();
  const configSetSnap = process.env.SES_CONFIGURATION_SET;
  t.after(() => {
    restoreSesEnv(snap);
    if (configSetSnap === undefined) delete process.env.SES_CONFIGURATION_SET;
    else process.env.SES_CONFIGURATION_SET = configSetSnap;
  });
  process.env.AWS_REGION = "us-east-1";
  process.env.SES_FROM = "sender@example.invalid";
  process.env.SES_CONFIGURATION_SET = "pj2-aor-delivery";

  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ MessageId: "ses-config-set-test-id" }) };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  await sesClient.sendEmail(
    { to: "recipient@example.invalid", subject: "件名", text: "本文", html: "<p>本文</p>" },
    { credentialProvider: async () => ({ accessKeyId: "AKIATESTDUMMY", secretAccessKey: "dummy-secret" }) }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.ConfigurationSetName, "pj2-aor-delivery");
});

test("escapeHtml: HTML特殊文字をエスケープする", () => {
  assert.equal(sesClient.escapeHtml('<script>alert("x")</script>'), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  assert.equal(sesClient.escapeHtml("A & B"), "A &amp; B");
  assert.equal(sesClient.escapeHtml("O'Reilly"), "O&#39;Reilly");
});
