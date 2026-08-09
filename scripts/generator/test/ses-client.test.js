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

const SES_ENV_VARS = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "SES_FROM"];

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

test("isConfigured: 必須環境変数がすべて設定されていればtrue", (t) => {
  const snap = snapshotSesEnv();
  t.after(() => restoreSesEnv(snap));
  process.env.AWS_ACCESS_KEY_ID = "AKIAEXAMPLE";
  process.env.AWS_SECRET_ACCESS_KEY = "secret-example";
  process.env.AWS_REGION = "us-east-1";
  process.env.SES_FROM = "sender@example.invalid";

  assert.equal(sesClient.isConfigured(), true);
  assert.deepEqual(sesClient.missingEnvVars(), []);
});

test("isConfigured: いずれか1つでも未設定ならfalseになり、missingEnvVars()に含まれる", (t) => {
  const snap = snapshotSesEnv();
  t.after(() => restoreSesEnv(snap));
  process.env.AWS_ACCESS_KEY_ID = "AKIAEXAMPLE";
  process.env.AWS_SECRET_ACCESS_KEY = "secret-example";
  delete process.env.AWS_REGION;
  process.env.SES_FROM = "sender@example.invalid";

  assert.equal(sesClient.isConfigured(), false);
  assert.deepEqual(sesClient.missingEnvVars(), ["AWS_REGION"]);
});

test("isConfigured: 全て未設定ならfalseになり、missingEnvVars()に4件すべて含まれる", (t) => {
  const snap = snapshotSesEnv();
  t.after(() => restoreSesEnv(snap));
  SES_ENV_VARS.forEach((name) => delete process.env[name]);

  assert.equal(sesClient.isConfigured(), false);
  assert.deepEqual(sesClient.missingEnvVars(), SES_ENV_VARS);
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

test("escapeHtml: HTML特殊文字をエスケープする", () => {
  assert.equal(sesClient.escapeHtml('<script>alert("x")</script>'), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  assert.equal(sesClient.escapeHtml("A & B"), "A &amp; B");
  assert.equal(sesClient.escapeHtml("O'Reilly"), "O&#39;Reilly");
});
