/**
 * process-ses-event.test.js — scripts/generator/leads/process-ses-event.js の自動テスト。
 *
 * AWS/SESへの実接続は行わない。SESイベントJSONのfixtureを直接processSesEvent()へ渡して
 * 検証する（lead-store.test.js/process-validated.test.jsと同じ、各テストが作成した
 * Leadをt.after()で個別に削除する方式）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  processSesEvent,
  parseSesEvent,
  mapEventTypeToLeadEvent,
  deliveryStatusForEvent,
  buildEventMetadata,
  extractLeadIdTag,
} = require("../leads/process-ses-event");
const { createLead, readLead, updateLead, appendHistory, LEADS_DIR } = require("../leads/lead-store");

/** @param {string} leadId */
function cleanupLead(leadId) {
  fs.rmSync(path.join(LEADS_DIR, `${leadId}.json`), { force: true });
}

function sampleParams(overrides = {}) {
  return {
    email: "process-ses-event-test@example.invalid",
    company_url: "https://process-ses-event-test.example",
    source: "テスト",
    collection_method: "public_website",
    ...overrides,
  };
}

/**
 * status:"initial_report_sent"（SESイベントが発生しうる、送信済みのLead）を作成する。
 * @param {Object} [overrides]
 * @returns {Object}
 */
function createSentLead(overrides = {}) {
  const created = createLead(sampleParams(overrides));
  updateLead(created.lead_id, { status: "initial_report_sent" });
  appendHistory(created.lead_id, "initial_report_sent", { message_id: "ses-initial-send-dummy" });
  return readLead(created.lead_id);
}

/** @param {string} leadId @param {Object} [overrides] */
function sesEvent(eventType, leadId, overrides = {}) {
  const detailKey = eventType.charAt(0).toLowerCase() + eventType.slice(1);
  const base = {
    eventType,
    mail: {
      timestamp: "2026-01-15T10:00:00.000Z",
      messageId: `ses-message-id-${eventType.toLowerCase()}`,
      tags: leadId ? { lead_id: [leadId] } : {},
    },
  };
  if (overrides.mail) Object.assign(base.mail, overrides.mail);
  const detail = { ...(overrides.detail || {}) };
  base[detailKey] = detail;
  return base;
}

// ---------------------------------------------------------------------------
// Pure Functions単体
// ---------------------------------------------------------------------------

test("mapEventTypeToLeadEvent: 5種類のeventTypeを正しく変換する", () => {
  assert.equal(mapEventTypeToLeadEvent("Delivery"), "email_delivered");
  assert.equal(mapEventTypeToLeadEvent("Open"), "email_opened");
  assert.equal(mapEventTypeToLeadEvent("Click"), "email_clicked");
  assert.equal(mapEventTypeToLeadEvent("Bounce"), "email_bounced");
  assert.equal(mapEventTypeToLeadEvent("Complaint"), "email_complaint");
});

test("mapEventTypeToLeadEvent: 未知・不正な値はnullを返す", () => {
  assert.equal(mapEventTypeToLeadEvent("Send"), null);
  assert.equal(mapEventTypeToLeadEvent("Reject"), null);
  assert.equal(mapEventTypeToLeadEvent(""), null);
  assert.equal(mapEventTypeToLeadEvent(undefined), null);
  assert.equal(mapEventTypeToLeadEvent(123), null);
});

test("extractLeadIdTag: tags.lead_id配列の1件目を取り出す", () => {
  assert.equal(extractLeadIdTag({ lead_id: ["abc123"] }), "abc123");
});

test("extractLeadIdTag: tagsが無い/配列でない/空配列/空文字はnullを返す", () => {
  assert.equal(extractLeadIdTag(null), null);
  assert.equal(extractLeadIdTag({}), null);
  assert.equal(extractLeadIdTag({ lead_id: "not-an-array" }), null);
  assert.equal(extractLeadIdTag({ lead_id: [] }), null);
  assert.equal(extractLeadIdTag({ lead_id: [""] }), null);
});

test("deliveryStatusForEvent: bounced/complaintのみdelivery_status遷移先を返す", () => {
  assert.equal(deliveryStatusForEvent("email_bounced"), "bounced");
  assert.equal(deliveryStatusForEvent("email_complaint"), "suppressed");
  assert.equal(deliveryStatusForEvent("email_delivered"), null);
  assert.equal(deliveryStatusForEvent("email_opened"), null);
  assert.equal(deliveryStatusForEvent("email_clicked"), null);
});

test("buildEventMetadata: email_openedはmessage_id/user_agent/ip_addressを含む", () => {
  const metadata = buildEventMetadata("email_opened", {
    messageId: "mid-1",
    detail: { userAgent: "Mozilla/5.0", ipAddress: "203.0.113.1" },
  });
  assert.deepEqual(metadata, { message_id: "mid-1", user_agent: "Mozilla/5.0", ip_address: "203.0.113.1" });
});

test("buildEventMetadata: email_clickedはmessage_id/urlを含む", () => {
  const metadata = buildEventMetadata("email_clicked", {
    messageId: "mid-2",
    detail: { link: "https://aor.example.invalid/report-preview.html" },
  });
  assert.deepEqual(metadata, { message_id: "mid-2", url: "https://aor.example.invalid/report-preview.html" });
});

test("buildEventMetadata: email_bouncedはmessage_id/bounce_type/bounce_sub_typeを含む", () => {
  const metadata = buildEventMetadata("email_bounced", {
    messageId: "mid-3",
    detail: { bounceType: "Permanent", bounceSubType: "General" },
  });
  assert.deepEqual(metadata, { message_id: "mid-3", bounce_type: "Permanent", bounce_sub_type: "General" });
});

test("buildEventMetadata: email_delivered/report_token・email等の不要な情報は含まない", () => {
  const metadata = buildEventMetadata("email_delivered", { messageId: "mid-4", detail: {} });
  assert.deepEqual(metadata, { message_id: "mid-4" });
  assert.ok(!("email" in metadata));
  assert.ok(!("report_token" in metadata));
});

test("parseSesEvent: 正常なBounceイベントを正しく正規化する", () => {
  const result = parseSesEvent(sesEvent("Bounce", "lead-id-abc", { detail: { bounceType: "Permanent" } }));
  assert.equal(result.ok, true);
  assert.equal(result.leadEvent, "email_bounced");
  assert.equal(result.leadId, "lead-id-abc");
  assert.equal(result.messageId, "ses-message-id-bounce");
  assert.equal(result.detail.bounceType, "Permanent");
});

test("parseSesEvent: オブジェクトでない入力はok:falseになる", () => {
  assert.equal(parseSesEvent(null).ok, false);
  assert.equal(parseSesEvent(undefined).ok, false);
  assert.equal(parseSesEvent("not-an-object").ok, false);
  assert.equal(parseSesEvent(123).ok, false);
  assert.equal(parseSesEvent([]).ok, false);
});

test("parseSesEvent: 未知のeventTypeはok:falseになる", () => {
  const result = parseSesEvent({ eventType: "Send", mail: { tags: { lead_id: ["x"] } } });
  assert.equal(result.ok, false);
  assert.match(result.error, /未知のeventType/);
});

test("parseSesEvent: mailフィールドが無い場合はok:falseになる", () => {
  const result = parseSesEvent({ eventType: "Delivery" });
  assert.equal(result.ok, false);
});

test("parseSesEvent: message tagにlead_idが無い場合はok:falseになる", () => {
  const result = parseSesEvent({ eventType: "Delivery", mail: { tags: {} } });
  assert.equal(result.ok, false);
  assert.match(result.error, /lead_id/);
});

// ---------------------------------------------------------------------------
// processSesEvent(): 5種類のイベント正常系
// ---------------------------------------------------------------------------

test("email_delivered: historyに追加され、status/delivery_statusは変更されない", (t) => {
  const lead = createSentLead();
  t.after(() => cleanupLead(lead.lead_id));

  const result = processSesEvent(sesEvent("Delivery", lead.lead_id));
  assert.equal(result.ok, true);
  assert.equal(result.event, "email_delivered");

  const updated = readLead(lead.lead_id);
  assert.equal(updated.status, "initial_report_sent", "statusは変わらないはず");
  assert.equal(updated.delivery_status, "active", "delivery_statusは変わらないはず");
  const entry = updated.history.find((h) => h.event === "email_delivered");
  assert.ok(entry, "email_deliveredイベントが記録されるはず");
  assert.equal(entry.metadata.message_id, "ses-message-id-delivery");
});

test("email_opened: historyに追加され、UA/IPがmetadataに保存される。status/delivery_statusは変更されない", (t) => {
  const lead = createSentLead();
  t.after(() => cleanupLead(lead.lead_id));

  const result = processSesEvent(
    sesEvent("Open", lead.lead_id, { detail: { userAgent: "Mozilla/5.0 (Test)", ipAddress: "203.0.113.5" } })
  );
  assert.equal(result.ok, true);

  const updated = readLead(lead.lead_id);
  assert.equal(updated.status, "initial_report_sent");
  assert.equal(updated.delivery_status, "active");
  const entry = updated.history.find((h) => h.event === "email_opened");
  assert.deepEqual(entry.metadata, {
    message_id: "ses-message-id-open",
    user_agent: "Mozilla/5.0 (Test)",
    ip_address: "203.0.113.5",
  });
});

test("email_clicked: historyに追加され、URLがmetadataに保存される。status/delivery_statusは変更されない", (t) => {
  const lead = createSentLead();
  t.after(() => cleanupLead(lead.lead_id));

  const clickedUrl = "https://aor.example.invalid/report-preview.html?company=s&lead=l&token=t";
  const result = processSesEvent(sesEvent("Click", lead.lead_id, { detail: { link: clickedUrl } }));
  assert.equal(result.ok, true);

  const updated = readLead(lead.lead_id);
  assert.equal(updated.status, "initial_report_sent");
  assert.equal(updated.delivery_status, "active");
  const entry = updated.history.find((h) => h.event === "email_clicked");
  assert.equal(entry.metadata.url, clickedUrl);
  assert.equal(entry.metadata.message_id, "ses-message-id-click");
});

test("email_bounced: historyに追加され、delivery_statusがbouncedになる。statusは変更されない", (t) => {
  const lead = createSentLead();
  t.after(() => cleanupLead(lead.lead_id));

  const result = processSesEvent(
    sesEvent("Bounce", lead.lead_id, { detail: { bounceType: "Permanent", bounceSubType: "General" } })
  );
  assert.equal(result.ok, true);

  const updated = readLead(lead.lead_id);
  assert.equal(updated.status, "initial_report_sent", "statusは変わらないはず");
  assert.equal(updated.delivery_status, "bounced");
  const entry = updated.history.find((h) => h.event === "email_bounced");
  assert.deepEqual(entry.metadata, {
    message_id: "ses-message-id-bounce",
    bounce_type: "Permanent",
    bounce_sub_type: "General",
  });
});

test("email_complaint: historyに追加され、delivery_statusがsuppressedになる。statusは変更されない", (t) => {
  const lead = createSentLead();
  t.after(() => cleanupLead(lead.lead_id));

  const result = processSesEvent(sesEvent("Complaint", lead.lead_id, { detail: { complaintFeedbackType: "abuse" } }));
  assert.equal(result.ok, true);

  const updated = readLead(lead.lead_id);
  assert.equal(updated.status, "initial_report_sent");
  assert.equal(updated.delivery_status, "suppressed");
  const entry = updated.history.find((h) => h.event === "email_complaint");
  assert.deepEqual(entry.metadata, { message_id: "ses-message-id-complaint", complaint_feedback_type: "abuse" });
});

// ---------------------------------------------------------------------------
// 不正・未知イベントへの対応
// ---------------------------------------------------------------------------

test("未知のevent_type: Leadを変更せず、ok:falseを返す", (t) => {
  const lead = createSentLead();
  t.after(() => cleanupLead(lead.lead_id));
  const before = readLead(lead.lead_id);

  const result = processSesEvent(sesEvent("Send", lead.lead_id));
  assert.equal(result.ok, false);

  assert.deepEqual(readLead(lead.lead_id), before, "Leadは一切変更されないはず");
});

test("存在しないlead_id: Leadを作成せず、ok:falseを返す", () => {
  const nonExistentId = "f".repeat(64);
  const result = processSesEvent(sesEvent("Delivery", nonExistentId));
  assert.equal(result.ok, false);
  assert.equal(readLead(nonExistentId), null, "存在しないLeadが作成されてはいけない");
});

test("存在しないlead_id: 他の既存Leadには影響しない", (t) => {
  const lead = createSentLead();
  t.after(() => cleanupLead(lead.lead_id));
  const before = readLead(lead.lead_id);

  processSesEvent(sesEvent("Delivery", "f".repeat(64)));

  assert.deepEqual(readLead(lead.lead_id), before, "無関係なLeadは変更されないはず");
});

test("不正な形式のlead_id（validateSlug失敗）: クラッシュせずok:falseを返す", () => {
  assert.doesNotThrow(() => {
    const result = processSesEvent(sesEvent("Delivery", "../../etc/passwd"));
    assert.equal(result.ok, false);
  });
});

[
  { name: "null", value: null },
  { name: "文字列", value: "not-an-object" },
  { name: "空オブジェクト", value: {} },
  { name: "mailが文字列", value: { eventType: "Delivery", mail: "not-an-object" } },
  { name: "eventTypeが無い", value: { mail: { tags: { lead_id: ["x"] } } } },
  { name: "tagsが無い", value: { eventType: "Delivery", mail: {} } },
].forEach(({ name, value }) => {
  test(`不正なイベント構造（${name}）: クラッシュせずok:falseを返す`, () => {
    assert.doesNotThrow(() => {
      const result = processSesEvent(value);
      assert.equal(result.ok, false);
    });
  });
});

// ---------------------------------------------------------------------------
// terminal delivery_status（勝手にactiveへ戻さない・unsubscribedは変更しない）
// ---------------------------------------------------------------------------

test("delivery_status:unsubscribedのLeadは、email_bouncedイベントでもdelivery_statusが変更されない（historyは記録される）", (t) => {
  const lead = createSentLead();
  t.after(() => cleanupLead(lead.lead_id));
  updateLead(lead.lead_id, { delivery_status: "unsubscribed" });

  const result = processSesEvent(sesEvent("Bounce", lead.lead_id, { detail: { bounceType: "Permanent" } }));
  assert.equal(result.ok, true);

  const updated = readLead(lead.lead_id);
  assert.equal(updated.delivery_status, "unsubscribed", "unsubscribedはメールイベントで変更されないはず");
  assert.ok(updated.history.some((h) => h.event === "email_bounced"), "history自体は記録されるはず");
});

test("delivery_status:unsubscribedのLeadは、email_complaintイベントでも変更されない", (t) => {
  const lead = createSentLead();
  t.after(() => cleanupLead(lead.lead_id));
  updateLead(lead.lead_id, { delivery_status: "unsubscribed" });

  processSesEvent(sesEvent("Complaint", lead.lead_id));

  assert.equal(readLead(lead.lead_id).delivery_status, "unsubscribed");
});

test("delivery_status:bouncedのLeadに再度email_bouncedイベントが来ても、bouncedのまま（activeへ戻らない）", (t) => {
  const lead = createSentLead();
  t.after(() => cleanupLead(lead.lead_id));
  updateLead(lead.lead_id, { delivery_status: "bounced" });

  const result = processSesEvent(sesEvent("Bounce", lead.lead_id));
  assert.equal(result.ok, true);
  assert.equal(readLead(lead.lead_id).delivery_status, "bounced");
});

test("delivery_status:suppressedのLeadにemail_openedイベントが来ても、suppressedのまま（activeへ戻らない）", (t) => {
  const lead = createSentLead();
  t.after(() => cleanupLead(lead.lead_id));
  updateLead(lead.lead_id, { delivery_status: "suppressed" });

  const result = processSesEvent(sesEvent("Open", lead.lead_id));
  assert.equal(result.ok, true);
  assert.equal(readLead(lead.lead_id).delivery_status, "suppressed", "email_openedはdelivery_statusを変更しないはず");
});

// ---------------------------------------------------------------------------
// 重複イベント（同一イベントを何度処理してもLead状態を壊さない）
// ---------------------------------------------------------------------------

test("同一のemail_bouncedイベントを2回処理しても、delivery_statusは壊れずbouncedのまま", (t) => {
  const lead = createSentLead();
  t.after(() => cleanupLead(lead.lead_id));

  const event = sesEvent("Bounce", lead.lead_id, { detail: { bounceType: "Permanent" } });
  const first = processSesEvent(event);
  const second = processSesEvent(event);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true, "2回目もエラーにはならない（べき等）");
  assert.equal(readLead(lead.lead_id).delivery_status, "bounced", "2回処理してもbouncedのまま壊れないはず");
});

test("同一のemail_openedイベントを2回処理しても、statusは壊れず、SES再送によるクラッシュは起きない", (t) => {
  const lead = createSentLead();
  t.after(() => cleanupLead(lead.lead_id));

  const event = sesEvent("Open", lead.lead_id);
  const first = processSesEvent(event);
  const second = processSesEvent(event);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(readLead(lead.lead_id).status, "initial_report_sent", "statusは変わらないはず");
  assert.equal(readLead(lead.lead_id).delivery_status, "active", "delivery_statusも変わらないはず");
});
