/**
 * lambda-ses-event-handler.test.js — scripts/generator/lambda/ses-event-handler.js の自動テスト。
 *
 * ses-event-handler.js は既存のprocessSesEvent()（leads/process-ses-event.js）をそのまま
 * 呼ぶ薄いadapterである。processSesEvent()自体のロジック（delivery_status反映等）は
 * process-ses-event.test.jsで既に検証済みのため、ここでは重複させない。本テストは
 * 「adapterとして正しくSNSレコードを解釈し、processSesEvent()へ委譲しているか」にのみ
 * 焦点を当てる（processSesEventModule配下の関数を差し替えたテストが中心）。実SNS・実AWSへは
 * 一切接続しない。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { handler, processOneRecord } = require("../lambda/ses-event-handler");
const processSesEventModule = require("../leads/process-ses-event");

/** @param {Function} fakeFn @returns {Function} 元へ戻す関数 */
function stubProcessSesEvent(fakeFn) {
  const original = processSesEventModule.processSesEvent;
  processSesEventModule.processSesEvent = fakeFn;
  return () => {
    processSesEventModule.processSesEvent = original;
  };
}

/** @param {Object} sesEvent @returns {{Sns:{Message:string}}} */
function snsRecord(sesEvent) {
  return { EventSource: "aws:sns", Sns: { Message: JSON.stringify(sesEvent) } };
}

// ---------------------------------------------------------------------------
// 入力形状の検証
// ---------------------------------------------------------------------------

test("ses-event-handler: event.Recordsが無い場合は例外を投げる", async () => {
  await assert.rejects(() => handler({}), /event\.Records/);
  await assert.rejects(() => handler({ Records: "not-an-array" }), /event\.Records/);
});

test("ses-event-handler: Records:[]（空配列）はresults:[]を返す（例外にしない）", async () => {
  const result = await handler({ Records: [] });
  assert.deepEqual(result, { results: [] });
});

// ---------------------------------------------------------------------------
// processOneRecord(): SNSレコード1件の解釈
// ---------------------------------------------------------------------------

test("processOneRecord: Sns.Messageが無いレコードはok:falseを返す（processSesEventは呼ばれない）", async () => {
  const calls = [];
  const restore = stubProcessSesEvent(async (e) => {
    calls.push(e);
    return { ok: true };
  });
  try {
    const result = await processOneRecord({ Sns: {} });
    assert.equal(result.ok, false);
    assert.match(result.error, /Sns\.Message/);
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test("processOneRecord: Sns.Messageが不正なJSONの場合はok:falseを返す（processSesEventは呼ばれない）", async () => {
  const calls = [];
  const restore = stubProcessSesEvent(async (e) => {
    calls.push(e);
    return { ok: true };
  });
  try {
    const result = await processOneRecord({ Sns: { Message: "{not-json" } });
    assert.equal(result.ok, false);
    assert.match(result.error, /不正なJSON/);
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test("processOneRecord: 正常なSESイベントJSONはparseされてprocessSesEvent()へそのまま渡される", async () => {
  const calls = [];
  const restore = stubProcessSesEvent(async (e) => {
    calls.push(e);
    return { ok: true, leadId: "lead-1", event: "email_bounced" };
  });
  try {
    const sesEvent = { eventType: "Bounce", mail: { tags: { lead_id: ["lead-1"] } }, bounce: { bounceType: "Permanent" } };
    const result = await processOneRecord(snsRecord(sesEvent));
    assert.deepEqual(calls, [sesEvent]);
    assert.deepEqual(result, { ok: true, leadId: "lead-1", event: "email_bounced" });
  } finally {
    restore();
  }
});

test("processOneRecord: processSesEvent()が例外を投げた場合もok:falseへ変換し、例外を伝播させない", async () => {
  const restore = stubProcessSesEvent(async () => {
    throw new Error("S3一時障害を模したエラー");
  });
  try {
    const result = await processOneRecord(snsRecord({ eventType: "Delivery", mail: { tags: { lead_id: ["lead-1"] } } }));
    assert.equal(result.ok, false);
    assert.match(result.error, /S3一時障害を模したエラー/);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// handler(): 複数Recordsの一括処理
// ---------------------------------------------------------------------------

test("handler: 複数Recordsを順に処理し、1件の失敗が他のレコードの処理を止めない", async () => {
  const seen = [];
  const restore = stubProcessSesEvent(async (sesEvent) => {
    seen.push(sesEvent.eventType);
    if (sesEvent.eventType === "Complaint") {
      throw new Error("模擬エラー");
    }
    return { ok: true, leadId: "lead-x", event: "email_delivered" };
  });
  try {
    const event = {
      Records: [
        snsRecord({ eventType: "Delivery", mail: { tags: { lead_id: ["lead-1"] } } }),
        snsRecord({ eventType: "Complaint", mail: { tags: { lead_id: ["lead-2"] } } }),
        snsRecord({ eventType: "Bounce", mail: { tags: { lead_id: ["lead-3"] } } }),
      ],
    };
    const result = await handler(event);

    assert.deepEqual(seen, ["Delivery", "Complaint", "Bounce"], "3件とも処理が試みられるはず（Complaintの失敗で止まらない）");
    assert.equal(result.results.length, 3);
    assert.equal(result.results[0].ok, true);
    assert.equal(result.results[1].ok, false);
    assert.match(result.results[1].error, /模擬エラー/);
    assert.equal(result.results[2].ok, true);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 実際のprocessSesEvent()との統合確認（差し替えなし。process-ses-event.test.jsとの重複は
// 最小限にとどめ、「adapter経由でも実際にLeadへ反映される」ことだけを1本確認する）
// ---------------------------------------------------------------------------

test("handler: 差し替えなしで実際にprocessSesEvent()を呼び、Leadのdelivery_statusへ反映される（Bounce）", async (t) => {
  const { createLead, readLead, LEADS_DIR } = require("../leads/lead-store");
  const fs = require("fs");
  const path = require("path");

  const created = await createLead({
    email: "lambda-ses-event-handler-test@example.invalid",
    company_url: "https://lambda-ses-event-handler-test.example",
    source: "テスト",
    collection_method: "public_website",
  });
  t.after(() => fs.rmSync(path.join(LEADS_DIR, `${created.lead_id}.json`), { force: true }));

  const event = {
    Records: [
      snsRecord({
        eventType: "Bounce",
        mail: { messageId: "ses-msg-1", tags: { lead_id: [created.lead_id] } },
        bounce: { bounceType: "Permanent", bounceSubType: "General" },
      }),
    ],
  };

  const result = await handler(event);
  assert.equal(result.results[0].ok, true);

  const updated = await readLead(created.lead_id);
  assert.equal(updated.delivery_status, "bounced");
  assert.ok(updated.history.some((h) => h.event === "email_bounced"));
});
