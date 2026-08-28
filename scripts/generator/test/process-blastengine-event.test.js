/**
 * process-blastengine-event.test.js — scripts/generator/leads/process-blastengine-event.js
 * の自動テスト（PJ2 AOR Phase47 STEP1で新設、STEP2でLead特定方法をmailaddressベースから
 * delivery_idベースへ変更したことに伴い、I/O結合テスト群を全面的に書き換えた）。
 *
 * blastengineへの実接続は行わない。Webhookペイロードのfixtureを直接
 * processBlastengineEvent()へ渡して検証する（process-ses-event.test.jsと同じ、
 * 各テストが作成したLeadをt.after()で個別に削除する方式）。
 *
 * 【PJ2 AOR Phase47 STEP2】Lead特定はsend-initial-report.jsが送信成功時に記録する
 * "initial_report_sent"のmetadata.message_id（=blastengineのdelivery_id）を介して行う
 * ため、テストのfixtureも「Leadを作成し、任意のdelivery_idをmessage_idとして記録する」
 * createSentLeadWithDeliveryId()を介して用意する（process-blastengine-event.js本体の
 * ヘッダコメント参照）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  processBlastengineEvent,
  parseBlastengineEvent,
  deliveryStatusForType,
  buildEventMetadata,
  hasAlreadyRecordedEvent,
} = require("../leads/process-blastengine-event");
const { createLead, readLead, updateLead, appendHistory, isDeliveryBlocked, LEADS_DIR } = require("../leads/lead-store");

/** @param {string} leadId */
function cleanupLead(leadId) {
  fs.rmSync(path.join(LEADS_DIR, `${leadId}.json`), { force: true });
}

function sampleParams(overrides = {}) {
  return {
    email: `process-blastengine-event-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`,
    company_url: "https://process-blastengine-event-test.example",
    source: "テスト",
    collection_method: "public_website",
    ...overrides,
  };
}

/**
 * status:"initial_report_sent"（blastengineイベントが発生しうる、送信済みのLead）を、
 * 指定したdeliveryId（send-initial-report.jsのmetadata.message_id相当）を紐付けて作成する。
 * @param {string} deliveryId
 * @param {Object} [overrides]
 * @returns {Promise<Object>}
 */
async function createSentLeadWithDeliveryId(deliveryId, overrides = {}) {
  const created = await createLead(sampleParams(overrides));
  await updateLead(created.lead_id, { status: "initial_report_sent" });
  await appendHistory(created.lead_id, "initial_report_sent", { message_id: deliveryId });
  return readLead(created.lead_id);
}

/**
 * blastengine公式マニュアル構造（events[].event.{type,datetime,detail}）の1イベントを組み立てる。
 * 引数・overridesは論理的にflat（type/datetime/mailaddress/subject/error_code/error_message/
 * delivery_id/insert_codes）で受け取り、公式のネスト構造へ振り分ける。
 * overrideで undefined を渡した場合はそのキーを「欠落」として扱う（必須フィールド欠落テスト用）。
 * @param {string} type @param {string} mailaddress @param {Object} [overrides]
 */
function blastengineEvent(type, mailaddress, overrides = {}) {
  const flat = {
    type,
    datetime: "2026-08-28T10:00:00+09:00",
    mailaddress,
    subject: "AI Opportunity Report",
    delivery_id: "12345",
    error_code: null,
    error_message: null,
    insert_codes: null,
    ...overrides,
  };
  return {
    event: {
      type: flat.type,
      datetime: flat.datetime,
      detail: {
        mailaddress: flat.mailaddress,
        subject: flat.subject,
        error_code: flat.error_code,
        error_message: flat.error_message,
        delivery_id: flat.delivery_id,
        insert_codes: flat.insert_codes,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// parseBlastengineEvent() — Pure Function単体
// ---------------------------------------------------------------------------

test("parseBlastengineEvent: DROPイベントを正常に正規化する", () => {
  const result = parseBlastengineEvent({ events: [blastengineEvent("DROP", "user@example.invalid")] });
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "DROP");
  assert.equal(result[0].mailaddress, "user@example.invalid");
  assert.equal(result[0].delivery_id, "12345");
});

test("parseBlastengineEvent: HARDERRORイベントを正常に正規化する", () => {
  const result = parseBlastengineEvent({
    events: [blastengineEvent("HARDERROR", "user@example.invalid", { error_code: "550", error_message: "mailbox unavailable" })],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "HARDERROR");
  assert.equal(result[0].error_code, "550");
  assert.equal(result[0].error_message, "mailbox unavailable");
});

test("parseBlastengineEvent: SOFTERRORイベントを正常に正規化する", () => {
  const result = parseBlastengineEvent({ events: [blastengineEvent("SOFTERROR", "user@example.invalid")] });
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "SOFTERROR");
});

test("parseBlastengineEvent: payload自体が無い/オブジェクトでない場合は例外", () => {
  assert.throws(() => parseBlastengineEvent(undefined));
  assert.throws(() => parseBlastengineEvent(null));
  assert.throws(() => parseBlastengineEvent("not-an-object"));
  assert.throws(() => parseBlastengineEvent([]));
});

test("parseBlastengineEvent: events配列が無い場合は例外（eventsなし）", () => {
  assert.throws(() => parseBlastengineEvent({}), /events配列がありません/);
  assert.throws(() => parseBlastengineEvent({ events: "not-an-array" }), /events配列がありません/);
});

test("parseBlastengineEvent: eventsが空配列の場合は空配列を返す（エラーにしない、eventなし）", () => {
  const result = parseBlastengineEvent({ events: [] });
  assert.deepEqual(result, []);
});

test("parseBlastengineEvent: 個々のevent要素がオブジェクトでない場合は例外", () => {
  assert.throws(() => parseBlastengineEvent({ events: [null] }), /events\[0\]がオブジェクトではありません/);
  assert.throws(() => parseBlastengineEvent({ events: ["not-an-object"] }), /events\[0\]がオブジェクトではありません/);
});

test("parseBlastengineEvent: detail配下の任意項目（subject/error_code/error_message/insert_codes）が無くても正常に処理する", () => {
  const result = parseBlastengineEvent({
    events: [
      {
        event: {
          type: "DROP",
          datetime: "2026-08-28T10:00:00+09:00",
          detail: {
            mailaddress: "user@example.invalid",
            delivery_id: "999",
            // subject/error_code/error_message/insert_codesはいずれも未指定
          },
        },
      },
    ],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].subject, null);
  assert.equal(result[0].error_code, null);
  assert.equal(result[0].error_message, null);
  assert.equal(result[0].insert_codes, null);
});

test("parseBlastengineEvent: delivery_idが数値でもString()で正規化される（公式マニュアルの例は数値）", () => {
  const result = parseBlastengineEvent({
    events: [
      {
        event: {
          type: "DROP",
          datetime: "2026-08-28T10:00:00+09:00",
          detail: { mailaddress: "user@example.invalid", delivery_id: 123, insert_codes: [] },
        },
      },
    ],
  });
  assert.equal(result[0].delivery_id, "123");
  assert.equal(typeof result[0].delivery_id, "string");
});

test("parseBlastengineEvent: events[i].event が無い場合は例外（event欠落）", () => {
  assert.throws(
    () => parseBlastengineEvent({ events: [{ notEvent: {} }] }),
    /events\[0\]\.eventがオブジェクトではありません/
  );
});

test("parseBlastengineEvent: events[i].event.detail が無い場合は例外（detail欠落）", () => {
  assert.throws(
    () => parseBlastengineEvent({ events: [{ event: { type: "DROP", datetime: "2026-08-28T10:00:00+09:00" } }] }),
    /events\[0\]\.event\.detailがオブジェクトではありません/
  );
});

test("parseBlastengineEvent: 必須フィールド欠落は例外（type/datetime/detail.mailaddress/detail.delivery_id）", () => {
  assert.throws(
    () => parseBlastengineEvent({ events: [blastengineEvent("DROP", "user@example.invalid", { type: undefined })] }),
    /events\[0\]\.event\.typeが必須です/
  );
  assert.throws(
    () => parseBlastengineEvent({ events: [blastengineEvent("DROP", "user@example.invalid", { datetime: undefined })] }),
    /events\[0\]\.event\.datetimeが必須です/
  );
  assert.throws(
    () => parseBlastengineEvent({ events: [blastengineEvent("DROP", "user@example.invalid", { mailaddress: undefined })] }),
    /events\[0\]\.event\.detail\.mailaddressが必須です/
  );
  assert.throws(
    () => parseBlastengineEvent({ events: [blastengineEvent("DROP", "user@example.invalid", { delivery_id: undefined })] }),
    /events\[0\]\.event\.detail\.delivery_idが必須です/
  );
});

test("parseBlastengineEvent: 例外メッセージにmailaddress（PII）を含めない", () => {
  try {
    parseBlastengineEvent({ events: [blastengineEvent("DROP", "pii-should-not-leak@example.invalid", { delivery_id: undefined })] });
    assert.fail("例外が投げられるはず");
  } catch (e) {
    assert.ok(!e.message.includes("pii-should-not-leak@example.invalid"), "例外メッセージにmailaddressを含めてはならない");
  }
});

test("parseBlastengineEvent: 1リクエストに複数イベントが含まれる場合、全件を配列として返す", () => {
  const result = parseBlastengineEvent({
    events: [blastengineEvent("DROP", "a@example.invalid"), blastengineEvent("HARDERROR", "b@example.invalid")],
  });
  assert.equal(result.length, 2);
  assert.equal(result[0].mailaddress, "a@example.invalid");
  assert.equal(result[1].mailaddress, "b@example.invalid");
});

// ---------------------------------------------------------------------------
// deliveryStatusForType() / buildEventMetadata() — Pure Function単体
// ---------------------------------------------------------------------------

test("deliveryStatusForType: HARDERROR/DROPはbounced、SOFTERROR/未知typeはnull", () => {
  assert.equal(deliveryStatusForType("HARDERROR"), "bounced");
  assert.equal(deliveryStatusForType("DROP"), "bounced");
  assert.equal(deliveryStatusForType("SOFTERROR"), null);
  assert.equal(deliveryStatusForType("UNKNOWN_TYPE"), null);
});

test("buildEventMetadata: providerとevent_typeを含み、mailaddressを含まない", () => {
  const metadata = buildEventMetadata({
    type: "HARDERROR",
    datetime: "2026-08-28T10:00:00+09:00",
    error_code: "550",
    error_message: "mailbox unavailable",
    delivery_id: "12345",
  });
  assert.equal(metadata.provider, "blastengine");
  assert.equal(metadata.event_type, "HARDERROR");
  assert.equal(metadata.delivery_id, "12345");
  assert.equal("mailaddress" in metadata, false);
});

// ---------------------------------------------------------------------------
// hasAlreadyRecordedEvent() — Pure Function単体（PJ2 AOR Phase47 STEP2で新設）
// ---------------------------------------------------------------------------

test("hasAlreadyRecordedEvent: delivery_id/error_code/datetimeが全て一致する既存historyがあればtrue", () => {
  const lead = {
    history: [
      { event: "email_bounced", metadata: { delivery_id: "1", error_code: "550", datetime: "2026-08-28T10:00:00+09:00" } },
    ],
  };
  assert.equal(
    hasAlreadyRecordedEvent(lead, { delivery_id: "1", error_code: "550", datetime: "2026-08-28T10:00:00+09:00" }),
    true
  );
});

test("hasAlreadyRecordedEvent: delivery_id/error_code/datetimeのいずれかが異なればfalse", () => {
  const base = { delivery_id: "1", error_code: "550", datetime: "2026-08-28T10:00:00+09:00" };
  const lead = { history: [{ event: "email_bounced", metadata: base }] };
  assert.equal(hasAlreadyRecordedEvent(lead, { ...base, delivery_id: "2" }), false);
  assert.equal(hasAlreadyRecordedEvent(lead, { ...base, error_code: "551" }), false);
  assert.equal(hasAlreadyRecordedEvent(lead, { ...base, datetime: "2026-08-28T11:00:00+09:00" }), false);
});

test("hasAlreadyRecordedEvent: historyが空/未定義の場合はfalse", () => {
  assert.equal(hasAlreadyRecordedEvent({ history: [] }, { delivery_id: "1", error_code: null, datetime: null }), false);
  assert.equal(hasAlreadyRecordedEvent({}, { delivery_id: "1", error_code: null, datetime: null }), false);
  assert.equal(hasAlreadyRecordedEvent(null, { delivery_id: "1", error_code: null, datetime: null }), false);
});

test("hasAlreadyRecordedEvent: event名が'email_bounced'以外のhistoryエントリは対象外", () => {
  const lead = {
    history: [
      { event: "initial_report_sent", metadata: { delivery_id: "1", error_code: null, datetime: null } },
    ],
  };
  assert.equal(hasAlreadyRecordedEvent(lead, { delivery_id: "1", error_code: null, datetime: null }), false);
});

// ---------------------------------------------------------------------------
// processBlastengineEvent() — I/O込みの結合テスト（単一Lead、基本の状態遷移）
// ---------------------------------------------------------------------------

test("processBlastengineEvent: HARDERRORでdelivery_statusがbouncedになる（delivery_idでLeadを特定）", async (t) => {
  const lead = await createSentLeadWithDeliveryId("delivery-harderror-1");
  t.after(() => cleanupLead(lead.lead_id));

  const results = await processBlastengineEvent({
    events: [blastengineEvent("HARDERROR", lead.email, { delivery_id: "delivery-harderror-1" })],
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].leadId, lead.lead_id);

  const updated = await readLead(lead.lead_id);
  assert.equal(updated.delivery_status, "bounced");
});

test("processBlastengineEvent: DROPでdelivery_statusがbouncedになる", async (t) => {
  const lead = await createSentLeadWithDeliveryId("delivery-drop-1");
  t.after(() => cleanupLead(lead.lead_id));

  await processBlastengineEvent({ events: [blastengineEvent("DROP", lead.email, { delivery_id: "delivery-drop-1" })] });

  const updated = await readLead(lead.lead_id);
  assert.equal(updated.delivery_status, "bounced");
});

test("processBlastengineEvent: SOFTERRORではdelivery_statusが変化しない（状態維持）", async (t) => {
  const lead = await createSentLeadWithDeliveryId("delivery-softerror-1");
  t.after(() => cleanupLead(lead.lead_id));
  assert.equal(lead.delivery_status, "active");

  await processBlastengineEvent({ events: [blastengineEvent("SOFTERROR", lead.email, { delivery_id: "delivery-softerror-1" })] });

  const updated = await readLead(lead.lead_id);
  assert.equal(updated.delivery_status, "active", "SOFTERRORはdelivery_statusを変更しないはず");
});

test("processBlastengineEvent: 既にunsubscribedのLeadはHARDERRORが届いてもunsubscribedのまま（unsubscribed保護）", async (t) => {
  const lead = await createSentLeadWithDeliveryId("delivery-unsub-1");
  t.after(() => cleanupLead(lead.lead_id));
  await updateLead(lead.lead_id, { delivery_status: "unsubscribed" });

  await processBlastengineEvent({ events: [blastengineEvent("HARDERROR", lead.email, { delivery_id: "delivery-unsub-1" })] });

  const updated = await readLead(lead.lead_id);
  assert.equal(updated.delivery_status, "unsubscribed", "unsubscribedはいかなるメールイベントでも上書きしないはず");
});

test("processBlastengineEvent: 未知のtype（unknown）ではdelivery_statusが変化しないが、historyには記録される", async (t) => {
  const lead = await createSentLeadWithDeliveryId("delivery-unknown-1");
  t.after(() => cleanupLead(lead.lead_id));

  const results = await processBlastengineEvent({
    events: [blastengineEvent("BOGUS_TYPE", lead.email, { delivery_id: "delivery-unknown-1" })],
  });
  assert.equal(results[0].ok, true);

  const updated = await readLead(lead.lead_id);
  assert.equal(updated.delivery_status, "active", "未知のtypeはdelivery_statusを変更しないはず");
  assert.equal(updated.history.filter((h) => h.event === "email_bounced").length, 1, "未知typeでもhistoryへは記録されるはず");
  assert.equal(updated.history.find((h) => h.event === "email_bounced").metadata.event_type, "BOGUS_TYPE");
});

test("processBlastengineEvent: 該当するdelivery_idのLeadが存在しない場合はok:falseを返し、例外にしない。エラーメッセージにmailaddressを含めない", async (t) => {
  const results = await processBlastengineEvent({
    events: [blastengineEvent("HARDERROR", "no-such-lead-exists@example.invalid", { delivery_id: "no-such-delivery-id" })],
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.ok(!results[0].error.includes("no-such-lead-exists@example.invalid"), "エラーメッセージにmailaddressを含めてはならない");
});

test("processBlastengineEvent: historyのmetadataにprovider/event_type/datetime/error_code/error_message/delivery_idが記録され、mailaddressは含まれない", async (t) => {
  const lead = await createSentLeadWithDeliveryId("abc123");
  t.after(() => cleanupLead(lead.lead_id));

  await processBlastengineEvent({
    events: [
      blastengineEvent("HARDERROR", lead.email, { error_code: "550", error_message: "mailbox unavailable", delivery_id: "abc123" }),
    ],
  });

  const updated = await readLead(lead.lead_id);
  const entry = updated.history.find((h) => h.event === "email_bounced");
  assert.ok(entry);
  assert.deepEqual(entry.metadata, {
    provider: "blastengine",
    event_type: "HARDERROR",
    datetime: "2026-08-28T10:00:00+09:00",
    error_code: "550",
    error_message: "mailbox unavailable",
    delivery_id: "abc123",
  });
});

// ---------------------------------------------------------------------------
// 冪等性（PJ2 AOR Phase47 STEP2、STEP7指示書の1〜8番に対応）
// ---------------------------------------------------------------------------

test("冪等性1: 同一Webhookを2回処理してもhistoryが1件だけ記録される", async (t) => {
  const lead = await createSentLeadWithDeliveryId("idem-1");
  t.after(() => cleanupLead(lead.lead_id));
  const event = blastengineEvent("HARDERROR", lead.email, { delivery_id: "idem-1" });

  await processBlastengineEvent({ events: [event] });
  await processBlastengineEvent({ events: [event] });

  const updated = await readLead(lead.lead_id);
  assert.equal(updated.history.filter((h) => h.event === "email_bounced").length, 1);
});

test("冪等性2: 同一Webhookを3回処理しても状態が壊れない（delivery_statusはbouncedのまま）", async (t) => {
  const lead = await createSentLeadWithDeliveryId("idem-2");
  t.after(() => cleanupLead(lead.lead_id));
  const event = blastengineEvent("HARDERROR", lead.email, { delivery_id: "idem-2" });

  await processBlastengineEvent({ events: [event] });
  await processBlastengineEvent({ events: [event] });
  const results = await processBlastengineEvent({ events: [event] });

  assert.equal(results[0].ok, true);
  assert.equal(results[0].duplicate, true, "2回目以降はduplicate:trueを返すはず");
  const updated = await readLead(lead.lead_id);
  assert.equal(updated.delivery_status, "bounced");
});

test("冪等性3: 同一delivery_idでもerror_codeが異なれば別イベントとして両方記録される", async (t) => {
  const lead = await createSentLeadWithDeliveryId("idem-3");
  t.after(() => cleanupLead(lead.lead_id));

  await processBlastengineEvent({
    events: [blastengineEvent("HARDERROR", lead.email, { delivery_id: "idem-3", error_code: "550" })],
  });
  await processBlastengineEvent({
    events: [blastengineEvent("HARDERROR", lead.email, { delivery_id: "idem-3", error_code: "551" })],
  });

  const updated = await readLead(lead.lead_id);
  assert.equal(updated.history.filter((h) => h.event === "email_bounced").length, 2, "error_codeが異なれば別イベントとして記録されるはず");
});

test("冪等性4: delivery_idが異なるイベントは別イベントとして処理される（別Leadを指すため、片方はLead未検出になる）", async (t) => {
  const lead = await createSentLeadWithDeliveryId("idem-4-a");
  t.after(() => cleanupLead(lead.lead_id));

  const resultsA = await processBlastengineEvent({ events: [blastengineEvent("HARDERROR", lead.email, { delivery_id: "idem-4-a" })] });
  const resultsB = await processBlastengineEvent({ events: [blastengineEvent("HARDERROR", lead.email, { delivery_id: "idem-4-b" })] });

  assert.equal(resultsA[0].ok, true);
  assert.equal(resultsB[0].ok, false, "紐付くLeadが無いdelivery_idは、たとえ同じmailaddressでもLead未検出として扱われるはず");
});

test("冪等性5: error_codeが異なるイベントはhistoryのmetadataにもそれぞれ正しく反映される", async (t) => {
  const lead = await createSentLeadWithDeliveryId("idem-5");
  t.after(() => cleanupLead(lead.lead_id));

  await processBlastengineEvent({
    events: [blastengineEvent("HARDERROR", lead.email, { delivery_id: "idem-5", error_code: "550" })],
  });
  await processBlastengineEvent({
    events: [blastengineEvent("HARDERROR", lead.email, { delivery_id: "idem-5", error_code: "552" })],
  });

  const updated = await readLead(lead.lead_id);
  const errorCodes = updated.history.filter((h) => h.event === "email_bounced").map((h) => h.metadata.error_code);
  assert.deepEqual(errorCodes.sort(), ["550", "552"]);
});

test("冪等性6: event.datetimeが異なるイベントは別イベントとして両方記録される", async (t) => {
  const lead = await createSentLeadWithDeliveryId("idem-6");
  t.after(() => cleanupLead(lead.lead_id));

  await processBlastengineEvent({
    events: [blastengineEvent("SOFTERROR", lead.email, { delivery_id: "idem-6", datetime: "2026-08-28T10:00:00+09:00" })],
  });
  await processBlastengineEvent({
    events: [blastengineEvent("SOFTERROR", lead.email, { delivery_id: "idem-6", datetime: "2026-08-28T20:00:00+09:00" })],
  });

  const updated = await readLead(lead.lead_id);
  assert.equal(updated.history.filter((h) => h.event === "email_bounced").length, 2, "datetimeが異なれば別イベント（例: 再試行）として記録されるはず");
});

test("冪等性7: Lead未検出時は複数回処理しても例外にならず、常にok:falseを返す（Lead自体が作られることもない）", async (t) => {
  const event = blastengineEvent("HARDERROR", "no-such-lead@example.invalid", { delivery_id: "idem-7-no-lead" });
  const results1 = await processBlastengineEvent({ events: [event] });
  const results2 = await processBlastengineEvent({ events: [event] });

  assert.equal(results1[0].ok, false);
  assert.equal(results2[0].ok, false);
});

test("冪等性: DROPの同一Webhookを2回処理してもhistoryは1件だけ（全イベント種別での網羅確認、Phase47 STEP3）", async (t) => {
  const lead = await createSentLeadWithDeliveryId("idem-drop-1");
  t.after(() => cleanupLead(lead.lead_id));
  const event = blastengineEvent("DROP", lead.email, { delivery_id: "idem-drop-1" });

  await processBlastengineEvent({ events: [event] });
  const results = await processBlastengineEvent({ events: [event] });

  assert.equal(results[0].duplicate, true);
  const updated = await readLead(lead.lead_id);
  assert.equal(updated.history.filter((h) => h.event === "email_bounced").length, 1);
  assert.equal(updated.delivery_status, "bounced");
});

test("冪等性: SOFTERRORの同一Webhookを2回処理してもhistoryは1件だけ（delivery_statusを変更しないイベント種別でも冪等化が効くことの確認、Phase47 STEP3）", async (t) => {
  const lead = await createSentLeadWithDeliveryId("idem-soft-1");
  t.after(() => cleanupLead(lead.lead_id));
  const event = blastengineEvent("SOFTERROR", lead.email, { delivery_id: "idem-soft-1" });

  // 1回目: 未処理 → history追加
  const first = await processBlastengineEvent({ events: [event] });
  assert.equal(first[0].duplicate, undefined, "1回目はduplicateフラグが立たないはず");

  // 2回目: 同一Webhook → 処理済み判定 → 状態変更なし・history追加なし
  const second = await processBlastengineEvent({ events: [event] });
  assert.equal(second[0].ok, true);
  assert.equal(second[0].duplicate, true, "2回目はduplicateフラグが立つはず");

  const updated = await readLead(lead.lead_id);
  assert.equal(updated.history.filter((h) => h.event === "email_bounced").length, 1, "SOFTERRORでもhistoryは1件だけのはず");
  assert.equal(updated.delivery_status, "active", "SOFTERRORはそもそもdelivery_statusを変更しないため、2回処理後もactiveのままのはず");
});

test("冪等性8: unknown typeのイベントも同一Webhookを2回処理すればhistoryは1件だけになる", async (t) => {
  const lead = await createSentLeadWithDeliveryId("idem-8");
  t.after(() => cleanupLead(lead.lead_id));
  const event = blastengineEvent("SOME_FUTURE_TYPE", lead.email, { delivery_id: "idem-8" });

  await processBlastengineEvent({ events: [event] });
  await processBlastengineEvent({ events: [event] });

  const updated = await readLead(lead.lead_id);
  assert.equal(updated.history.filter((h) => h.event === "email_bounced").length, 1);
  assert.equal(updated.delivery_status, "active", "unknown typeはdelivery_statusを変更しないはず（重複処理後も同様）");
});

// ---------------------------------------------------------------------------
// 同一emailの複数Lead（PJ2 AOR Phase47 STEP2、STEP7指示書の9〜15番に対応）
// ---------------------------------------------------------------------------

/**
 * 同一emailで異なるcompany_url（P0-1確定仕様のとおり複数Leadを許容）のLeadを、
 * それぞれ別のdelivery_idと紐付けて2件作成する。
 * @returns {Promise<{email:string, leadA:Object, leadB:Object}>}
 */
async function createTwoLeadsWithSameEmail() {
  const email = `process-blastengine-event-multi-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`;
  const leadA = await createSentLeadWithDeliveryId("multi-lead-a", { email, company_url: "https://company-a.example" });
  const leadB = await createSentLeadWithDeliveryId("multi-lead-b", { email, company_url: "https://company-b.example" });
  return { email, leadA, leadB };
}

test("複数Lead9: 同一emailに複数Leadが存在する状態を作成できる（前提条件の確認）", async (t) => {
  const { email, leadA, leadB } = await createTwoLeadsWithSameEmail();
  t.after(() => cleanupLead(leadA.lead_id));
  t.after(() => cleanupLead(leadB.lead_id));

  assert.equal(leadA.email, email);
  assert.equal(leadB.email, email);
  assert.notEqual(leadA.lead_id, leadB.lead_id);
});

test("複数Lead10: HARDERRORはdelivery_idが一致するLeadのみをbouncedにし、同一emailの他Leadには影響しない", async (t) => {
  const { leadA, leadB } = await createTwoLeadsWithSameEmail();
  t.after(() => cleanupLead(leadA.lead_id));
  t.after(() => cleanupLead(leadB.lead_id));

  await processBlastengineEvent({
    events: [blastengineEvent("HARDERROR", leadA.email, { delivery_id: "multi-lead-a" })],
  });

  const updatedA = await readLead(leadA.lead_id);
  const updatedB = await readLead(leadB.lead_id);
  assert.equal(updatedA.delivery_status, "bounced", "delivery_idが一致するLead Aはbouncedになるはず");
  assert.equal(updatedB.delivery_status, "active", "同一emailのLead Bはactiveのまま変化しないはず（Lead単位のSuppression）");
});

test("複数Lead11: DROPも同様にdelivery_idが一致するLeadのみをbouncedにする", async (t) => {
  const { leadA, leadB } = await createTwoLeadsWithSameEmail();
  t.after(() => cleanupLead(leadA.lead_id));
  t.after(() => cleanupLead(leadB.lead_id));

  await processBlastengineEvent({ events: [blastengineEvent("DROP", leadB.email, { delivery_id: "multi-lead-b" })] });

  const updatedA = await readLead(leadA.lead_id);
  const updatedB = await readLead(leadB.lead_id);
  assert.equal(updatedA.delivery_status, "active", "Lead Aへは影響しないはず");
  assert.equal(updatedB.delivery_status, "bounced");
});

test("複数Lead12: unsubscribedのLeadが同一email内に混在していても、他方のLeadへのHARDERROR処理には影響しない", async (t) => {
  const { leadA, leadB } = await createTwoLeadsWithSameEmail();
  t.after(() => cleanupLead(leadA.lead_id));
  t.after(() => cleanupLead(leadB.lead_id));
  await updateLead(leadA.lead_id, { delivery_status: "unsubscribed" });

  // Lead A（unsubscribed）宛のHARDERRORは上書きしない
  await processBlastengineEvent({ events: [blastengineEvent("HARDERROR", leadA.email, { delivery_id: "multi-lead-a" })] });
  // Lead B（active）宛のHARDERRORは通常どおりbouncedになる
  await processBlastengineEvent({ events: [blastengineEvent("HARDERROR", leadB.email, { delivery_id: "multi-lead-b" })] });

  const updatedA = await readLead(leadA.lead_id);
  const updatedB = await readLead(leadB.lead_id);
  assert.equal(updatedA.delivery_status, "unsubscribed", "unsubscribedはHARDERRORで上書きされないはず");
  assert.equal(updatedB.delivery_status, "bounced", "Lead Bは通常どおりbouncedになるはず（Lead Aの状態に影響されない）");
});

test("複数Lead13: 複数イベントを1リクエストで処理した後も、各Leadの状態はそれぞれ独立して整合する", async (t) => {
  const { leadA, leadB } = await createTwoLeadsWithSameEmail();
  t.after(() => cleanupLead(leadA.lead_id));
  t.after(() => cleanupLead(leadB.lead_id));

  const results = await processBlastengineEvent({
    events: [
      blastengineEvent("HARDERROR", leadA.email, { delivery_id: "multi-lead-a" }),
      blastengineEvent("SOFTERROR", leadB.email, { delivery_id: "multi-lead-b" }),
    ],
  });

  assert.equal(results[0].leadId, leadA.lead_id);
  assert.equal(results[1].leadId, leadB.lead_id);

  const updatedA = await readLead(leadA.lead_id);
  const updatedB = await readLead(leadB.lead_id);
  assert.equal(updatedA.delivery_status, "bounced");
  assert.equal(updatedB.delivery_status, "active");
  assert.equal(updatedA.history.filter((h) => h.event === "email_bounced").length, 1);
  assert.equal(updatedB.history.filter((h) => h.event === "email_bounced").length, 1);
});

test("複数Lead14: Initial送信対象判定（isDeliveryBlocked）は、bouncedになったLeadのみtrueを返す", async (t) => {
  const { leadA, leadB } = await createTwoLeadsWithSameEmail();
  t.after(() => cleanupLead(leadA.lead_id));
  t.after(() => cleanupLead(leadB.lead_id));

  await processBlastengineEvent({ events: [blastengineEvent("HARDERROR", leadA.email, { delivery_id: "multi-lead-a" })] });

  const updatedA = await readLead(leadA.lead_id);
  const updatedB = await readLead(leadB.lead_id);
  assert.equal(isDeliveryBlocked(updatedA), true, "bouncedになったLead Aは送信対象から除外されるはず");
  assert.equal(isDeliveryBlocked(updatedB), false, "同一emailのLead Bは引き続き送信対象のままのはず");
});

test("複数Lead15: Weekly送信対象判定も同じisDeliveryBlocked()を参照するため、Initial判定と一致する（send-weekly-report.jsと同じゲート）", async (t) => {
  const { leadA, leadB } = await createTwoLeadsWithSameEmail();
  t.after(() => cleanupLead(leadA.lead_id));
  t.after(() => cleanupLead(leadB.lead_id));

  await processBlastengineEvent({ events: [blastengineEvent("DROP", leadA.email, { delivery_id: "multi-lead-a" })] });

  const updatedA = await readLead(leadA.lead_id);
  const updatedB = await readLead(leadB.lead_id);
  // send-weekly-report.jsもsend-initial-report.jsも同一のisDeliveryBlocked()をそのまま
  // 参照しているため（lead-store.js）、Initial/Weeklyで判定が食い違うことは構造上ありえない。
  assert.equal(isDeliveryBlocked(updatedA), true);
  assert.equal(isDeliveryBlocked(updatedB), false);
});
