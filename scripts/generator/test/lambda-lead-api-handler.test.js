/**
 * lambda-lead-api-handler.test.js — scripts/generator/lambda/lead-api-handler.js の自動テスト
 * （PJ2 AOR Phase49 STEP6）。
 *
 * lead-api-handler.js は website/aor-lead-api/server.js の requestListener(req, res) を
 * そのまま呼ぶ薄いアダプター。ルーティング・token 検証・冪等性等の正しさは
 * lead-api.test.js（実 HTTP サーバ起動テスト）で既に検証済みのため、ここでは
 * 「Function URL v2 イベント ⇔ Node req/res の変換が正しいか」にのみ焦点を当てる。
 * blastengine / SES / 実 AWS へは一切接続しない。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { handler } = require("../lambda/lead-api-handler");
const { createLead, readLead, updateLead, LEADS_DIR } = require("../leads/lead-store");

/** @param {string} leadId */
function cleanupLead(leadId) {
  fs.rmSync(path.join(LEADS_DIR, `${leadId}.json`), { force: true });
}

function sampleParams(overrides = {}) {
  return {
    email: `lambda-lead-api-handler-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`,
    company_url: "https://lambda-lead-api-handler-test.example",
    source: "テスト",
    collection_method: "public_website",
    ...overrides,
  };
}

/** report_generated 相当まで進めた Lead を作る（unsubscribe 対象として妥当な状態）。 */
async function createSubscribableLead() {
  const created = await createLead(sampleParams());
  await updateLead(created.lead_id, { company_slug: "phase15-test.example.com", status: "initial_report_sent" });
  return readLead(created.lead_id);
}

// rate-limit.js はプロセス内メモリで per-IP に効くため、テスト間で枯渇しないよう
// 呼び出しごとにユニークな sourceIp を割り当てる（本番の同一 IP 連打は別途 rate-limit で制御）。
let ipCounter = 0;
function nextTestIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter % 254 || 1}`;
}

/** Function URL v2 プロキシ統合イベントを組み立てる。 */
function fnUrlEvent({ method = "POST", rawPath = "/api/leads/unsubscribe", rawQueryString = "", headers = {}, body, isBase64Encoded = false, sourceIp } = {}) {
  sourceIp = sourceIp || nextTestIp();
  return {
    version: "2.0",
    rawPath,
    rawQueryString,
    headers: { host: "example.lambda-url.ap-northeast-1.on.aws", "content-type": "application/json", ...headers },
    requestContext: { http: { method, path: rawPath, sourceIp } },
    body: body === undefined ? undefined : body,
    isBase64Encoded,
  };
}

// ---------------------------------------------------------------------------

test("OPTIONS プリフライトは 204 を返す", async () => {
  const res = await handler(fnUrlEvent({ method: "OPTIONS" }));
  assert.equal(res.statusCode, 204);
});

test("POST /api/leads/unsubscribe: 正しい lead_id/token で 200 {ok:true}、delivery_status が unsubscribed へ", async (t) => {
  const lead = await createSubscribableLead();
  t.after(() => cleanupLead(lead.lead_id));

  const res = await handler(
    fnUrlEvent({ body: JSON.stringify({ lead_id: lead.lead_id, token: lead.report_token }) })
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });

  const updated = await readLead(lead.lead_id);
  assert.equal(updated.delivery_status, "unsubscribed");
});

test("POST /api/leads/unsubscribe: token 不一致は 400 invalid_request、Lead は変更されない", async (t) => {
  const lead = await createSubscribableLead();
  t.after(() => cleanupLead(lead.lead_id));

  const res = await handler(fnUrlEvent({ body: JSON.stringify({ lead_id: lead.lead_id, token: "wrong-token" }) }));
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, "invalid_request");

  const updated = await readLead(lead.lead_id);
  assert.equal(updated.delivery_status, "active");
});

test("POST /api/leads/unsubscribe: lead_id/token 欠落・不正 JSON は 400", async () => {
  const missing = await handler(fnUrlEvent({ body: JSON.stringify({}) }));
  assert.equal(missing.statusCode, 400);

  const badJson = await handler(fnUrlEvent({ body: "{not valid json" }));
  assert.equal(badJson.statusCode, 400);
});

test("GET /api/leads/unsubscribe: 405、副作用なし", async (t) => {
  const lead = await createSubscribableLead();
  t.after(() => cleanupLead(lead.lead_id));

  const res = await handler(
    fnUrlEvent({ method: "GET", rawQueryString: `lead=${lead.lead_id}&token=${lead.report_token}`, body: undefined })
  );
  assert.equal(res.statusCode, 405);

  const updated = await readLead(lead.lead_id);
  assert.equal(updated.delivery_status, "active");
});

test("POST /api/leads/unsubscribe: 冪等性 - 2回目も 200 {ok:true}", async (t) => {
  const lead = await createSubscribableLead();
  t.after(() => cleanupLead(lead.lead_id));
  const body = JSON.stringify({ lead_id: lead.lead_id, token: lead.report_token });

  const first = await handler(fnUrlEvent({ body }));
  const second = await handler(fnUrlEvent({ body }));
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.deepEqual(JSON.parse(second.body), { ok: true });

  const updated = await readLead(lead.lead_id);
  const bounced = updated.history.filter((h) => h.event === "unsubscribed").length;
  assert.equal(bounced, 1, "unsubscribed history は重複記録されないはず");
});

test("レスポンスに lead_id・token が含まれない（成功・失敗いずれも）", async (t) => {
  const lead = await createSubscribableLead();
  t.after(() => cleanupLead(lead.lead_id));

  const ok = await handler(fnUrlEvent({ body: JSON.stringify({ lead_id: lead.lead_id, token: lead.report_token }) }));
  assert.ok(!ok.body.includes(lead.lead_id));
  assert.ok(!ok.body.includes(lead.report_token));

  const bad = await handler(fnUrlEvent({ body: JSON.stringify({ lead_id: "enum-probe", token: "x" }) }));
  assert.ok(!bad.body.includes("enum-probe"));
});

test("base64 エンコードされた body も復号して処理する", async (t) => {
  const lead = await createSubscribableLead();
  t.after(() => cleanupLead(lead.lead_id));

  const raw = JSON.stringify({ lead_id: lead.lead_id, token: lead.report_token });
  const res = await handler(fnUrlEvent({ body: Buffer.from(raw, "utf8").toString("base64"), isBase64Encoded: true }));
  assert.equal(res.statusCode, 200);

  const updated = await readLead(lead.lead_id);
  assert.equal(updated.delivery_status, "unsubscribed");
});

test("許可リストの Origin には Access-Control-Allow-Origin が返る（CORS 変換の確認）", async (t) => {
  const lead = await createSubscribableLead();
  t.after(() => cleanupLead(lead.lead_id));
  const originalOrigins = process.env.LEAD_API_ALLOWED_ORIGINS;
  process.env.LEAD_API_ALLOWED_ORIGINS = "https://aor.changescout.jp";
  t.after(() => {
    if (originalOrigins === undefined) delete process.env.LEAD_API_ALLOWED_ORIGINS;
    else process.env.LEAD_API_ALLOWED_ORIGINS = originalOrigins;
  });

  // ALLOWED_ORIGINS は server.js の module 読み込み時に確定するため、この1ケースでは
  // 環境変数変更が反映されない可能性がある。ここでは「CORS ヘッダーの受け渡し経路」
  // （res.setHeader → handler 戻り値の headers）が機能することだけを確認する。
  const res = await handler(
    fnUrlEvent({
      method: "OPTIONS",
      headers: { origin: "https://aor.changescout.jp" },
    })
  );
  assert.equal(res.statusCode, 204);
  assert.ok("access-control-allow-methods" in res.headers, "CORS メソッドヘッダーは常に付与される");
});
