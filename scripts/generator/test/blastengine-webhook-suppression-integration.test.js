/**
 * blastengine-webhook-suppression-integration.test.js — PJ2 AOR Phase47 STEP3:
 * blastengine Webhook処理（leads/process-blastengine-event.js）を、実際のInitial/Weekly
 * 送信処理（leads/send-initial-report.js・leads/send-weekly-report.js）と接続した
 * ローカル統合テスト。
 *
 * 【このファイルの目的】process-blastengine-event.test.js（Phase47 STEP1/STEP2）は
 * 「delivery_status/historyが正しく更新されるか」「isDeliveryBlocked()がtrueを返すか」を
 * 単体レベルで検証済みだが、それだけでは「実際にInitial/Weeklyの送信処理がそのLeadを
 * 除外する」ことまでは確認できていなかった（Phase47 STEP3 STEP7で明示的に要求された
 * ギャップ）。本ファイルはこの一気通貫（webhook受信→Lead状態更新→実際の送信関数が
 * skipする）を、send-initial-report.test.js・send-weekly-report.test.jsと同じ
 * 依存性注入パターン（options.sendEmailを常にネットワーク非依存のダミー関数へ差し替え）で
 * 検証する。実blastengine・実AWS・実ネットワーク接続は一切行わない。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { sendInitialReportForLead } = require("../leads/send-initial-report");
const { sendWeeklyReportForLead } = require("../leads/send-weekly-report");
const { processBlastengineEvent } = require("../leads/process-blastengine-event");
const { createLead, readLead, updateLead, appendHistory, isDeliveryBlocked, LEADS_DIR } = require("../leads/lead-store");
const publishedStore = require("../published-store");
const { AOR_DATA_DIR } = require("../publish-report");

const TEST_SLUG_PREFIX = "test-blastengine-suppression-integration-";

/** @param {string} leadId */
function cleanupLead(leadId) {
  fs.rmSync(path.join(LEADS_DIR, `${leadId}.json`), { force: true });
}

/** @param {string} slug */
function cleanupPublishedAorData(slug) {
  fs.rmSync(path.join(AOR_DATA_DIR, `${slug}.json`), { force: true });
}

/** @param {string} slug */
function cleanupPublishedStore(slug) {
  fs.rmSync(path.join(AOR_DATA_DIR, `${slug}.json`), { force: true });
}

/** website/aor/data/<slug>.json相当。send-initial-report.jsのisPublished()が参照する。 */
function publishForInitial(slug) {
  fs.mkdirSync(AOR_DATA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(AOR_DATA_DIR, `${slug}.json`),
    JSON.stringify({ company_profile: { name: "テスト株式会社" } }),
    "utf-8"
  );
}

/** published-store.js経由。send-weekly-report.jsのloadPublished()が参照する。 */
async function publishForWeekly(slug, generatedAt) {
  await publishedStore.savePublished(slug, {
    meta: { generated_at: generatedAt },
    company_profile: { name: "テスト株式会社" },
  });
}

function sampleParams(overrides = {}) {
  return {
    email: `blastengine-suppression-integration-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`,
    company_url: "https://blastengine-suppression-integration.example",
    source: "テスト",
    collection_method: "public_website",
    ...overrides,
  };
}

/**
 * blastengine公式マニュアル構造（events[].event.{type,datetime,detail}）の1イベントを組み立てる
 * （Phase48 STEP12。process-blastengine-event.test.jsのblastengineEvent()と同じ考え方）。
 * @param {{type:string, mailaddress:string, delivery_id:string, error_code?:string, error_message?:string}} flat
 */
function nestedBlastengineEvent(flat) {
  return {
    event: {
      type: flat.type,
      datetime: flat.datetime || "2026-08-28T10:00:00+09:00",
      detail: {
        mailaddress: flat.mailaddress,
        subject: flat.subject || "AI Opportunity Report",
        error_code: flat.error_code || null,
        error_message: flat.error_message || null,
        delivery_id: flat.delivery_id,
        insert_codes: flat.insert_codes || null,
      },
    },
  };
}

/** ネットワークを一切使わないダミーのsendEmail()代替（send-initial-report.test.jsと同型）。 */
function fakeSendEmail(messageId) {
  const calls = [];
  const fn = async (params) => {
    calls.push(params);
    return { messageId };
  };
  return { fn, calls };
}

/** テスト実行に必要な最小限のAOR_SITE_BASE_URLをセットし、t.after()で元に戻す。 */
function withSiteConfig(t) {
  const original = process.env.AOR_SITE_BASE_URL;
  process.env.AOR_SITE_BASE_URL = "https://aor.example.invalid";
  t.after(() => {
    if (original === undefined) delete process.env.AOR_SITE_BASE_URL;
    else process.env.AOR_SITE_BASE_URL = original;
  });
}

// ---------------------------------------------------------------------------
// 一気通貫: Initial実送信（mock）→ blastengine HARDERROR/DROP Webhook → Weekly送信が除外される
// ---------------------------------------------------------------------------

test("統合: Initial送信でdelivery_idが記録される→blastengine HARDERROR→Weekly送信はisDeliveryBlocked()によりskipされる（実際にsendEmailが呼ばれない）", async (t) => {
  withSiteConfig(t);
  const created = await createLead(sampleParams());
  const slug = `${TEST_SLUG_PREFIX}${created.lead_id.slice(0, 12)}`;
  t.after(() => {
    cleanupLead(created.lead_id);
    cleanupPublishedAorData(slug);
    cleanupPublishedStore(slug);
  });
  await updateLead(created.lead_id, { company_slug: slug, status: "report_generated", delivery_approval_status: "approved" });
  publishForInitial(slug);

  // 1. Initial送信（mock）: 実際のsendInitialReportForLead()を、blastengine-client.jsの
  //    代わりにダミーのsendEmailで呼ぶ。戻り値のmessageId（=blastengineのdelivery_id相当）が
  //    実際にLeadのinitial_report_sent historyへ記録されることを、この後のWebhook処理が
  //    利用する（findLeadByInitialSendMessageId()経由）。
  const initialSend = fakeSendEmail("integration-delivery-id-1");
  const initialResult = await sendInitialReportForLead(created.lead_id, { sendEmail: initialSend.fn });
  assert.equal(initialResult.ok, true);
  assert.equal(initialSend.calls.length, 1, "Initial送信の時点ではsendEmailが呼ばれるはず");

  const afterInitial = await readLead(created.lead_id);
  assert.equal(afterInitial.status, "initial_report_sent");
  assert.equal(afterInitial.delivery_status, "active");

  // 2. blastengine HARDERROR Webhookを実際に処理する（実ネットワーク接続なし）。
  const webhookResults = await processBlastengineEvent({
    events: [
      nestedBlastengineEvent({
        type: "HARDERROR",
        mailaddress: afterInitial.email,
        delivery_id: "integration-delivery-id-1",
        error_code: "550",
        error_message: "mailbox unavailable",
      }),
    ],
  });
  assert.equal(webhookResults[0].ok, true);
  assert.equal(webhookResults[0].leadId, created.lead_id);

  const afterWebhook = await readLead(created.lead_id);
  assert.equal(afterWebhook.delivery_status, "bounced");
  assert.equal(isDeliveryBlocked(afterWebhook), true);

  // 3. Weekly配信の前提条件（consent・公開済みreport）を満たした状態にした上で、
  //    実際にsendWeeklyReportForLead()を呼び、isDeliveryBlocked()ゲートによって
  //    skipされる（sendEmailが一切呼ばれない）ことを確認する。
  await updateLead(created.lead_id, { weekly_report_consent: true });
  await publishForWeekly(slug, "2026-08-29T00:00:00.000Z");

  const weeklySend = fakeSendEmail("should-not-be-used");
  const weeklyResult = await sendWeeklyReportForLead(created.lead_id, { sendEmail: weeklySend.fn });

  assert.equal(weeklyResult.ok, false);
  assert.equal(weeklyResult.skipped, true);
  assert.match(weeklyResult.error, /delivery_statusが"bounced"のため送信対象外です/);
  assert.equal(weeklySend.calls.length, 0, "bouncedのLeadに対してsendEmailが実際に呼ばれてはならない");
});

test("統合: DROPも同様にWeekly送信をskipさせる", async (t) => {
  withSiteConfig(t);
  const created = await createLead(sampleParams());
  const slug = `${TEST_SLUG_PREFIX}${created.lead_id.slice(0, 12)}`;
  t.after(() => {
    cleanupLead(created.lead_id);
    cleanupPublishedAorData(slug);
    cleanupPublishedStore(slug);
  });
  await updateLead(created.lead_id, { company_slug: slug, status: "report_generated", delivery_approval_status: "approved" });
  publishForInitial(slug);

  const initialSend = fakeSendEmail("integration-delivery-id-drop");
  await sendInitialReportForLead(created.lead_id, { sendEmail: initialSend.fn });

  await processBlastengineEvent({
    events: [
      nestedBlastengineEvent({ type: "DROP", mailaddress: created.email, delivery_id: "integration-delivery-id-drop" }),
    ],
  });

  await updateLead(created.lead_id, { weekly_report_consent: true });
  await publishForWeekly(slug, "2026-08-29T00:00:00.000Z");

  const weeklySend = fakeSendEmail("should-not-be-used");
  const weeklyResult = await sendWeeklyReportForLead(created.lead_id, { sendEmail: weeklySend.fn });

  assert.equal(weeklyResult.skipped, true);
  assert.equal(weeklySend.calls.length, 0);
});

test("統合: SOFTERRORはWeekly送信をblockしない（delivery_statusが変化しないため、他の条件を満たせば通常どおり送信される）", async (t) => {
  withSiteConfig(t);
  const created = await createLead(sampleParams());
  const slug = `${TEST_SLUG_PREFIX}${created.lead_id.slice(0, 12)}`;
  t.after(() => {
    cleanupLead(created.lead_id);
    cleanupPublishedAorData(slug);
    cleanupPublishedStore(slug);
  });
  await updateLead(created.lead_id, { company_slug: slug, status: "report_generated", delivery_approval_status: "approved" });
  publishForInitial(slug);

  const initialSend = fakeSendEmail("integration-delivery-id-soft");
  await sendInitialReportForLead(created.lead_id, { sendEmail: initialSend.fn });

  await processBlastengineEvent({
    events: [
      nestedBlastengineEvent({ type: "SOFTERROR", mailaddress: created.email, delivery_id: "integration-delivery-id-soft" }),
    ],
  });

  const afterWebhook = await readLead(created.lead_id);
  assert.equal(afterWebhook.delivery_status, "active", "SOFTERRORはdelivery_statusを変更しないはず");

  await updateLead(created.lead_id, { weekly_report_consent: true });
  await publishForWeekly(slug, "2026-08-29T00:00:00.000Z");

  const weeklySend = fakeSendEmail("weekly-message-id-after-softerror");
  const weeklyResult = await sendWeeklyReportForLead(created.lead_id, { sendEmail: weeklySend.fn });

  assert.equal(weeklyResult.ok, true, "SOFTERROR後もdelivery_statusはactiveのままのため、他の条件を満たせば通常どおり送信されるはず");
  assert.equal(weeklySend.calls.length, 1);
});

test("統合: bouncedになったLeadは、たとえstatus/company_slug/承認等Initial送信の他条件を満たしていてもInitial送信自体がskipされる（isDeliveryBlocked()ゲートの実効性確認）", async (t) => {
  withSiteConfig(t);
  const created = await createLead(sampleParams());
  const slug = `${TEST_SLUG_PREFIX}${created.lead_id.slice(0, 12)}`;
  t.after(() => {
    cleanupLead(created.lead_id);
    cleanupPublishedAorData(slug);
  });
  // 【前提の注記】Initial送信は本来1回のみ（一度sentになるとstatusがreport_generatedへ
  // 戻ることはない）ため、「同一Leadが一度Initial送信された後、再度report_generated状態で
  // bounced化される」という状況は実運用では稀（例: 何らかの理由でstatusが差し戻された場合）。
  // ここではisDeliveryBlocked()ゲート自体が、他の全条件を満たしていても確実に送信をblockする
  // ことを確認するため、あえてreport_generated状態のままdelivery_status:"bounced"を設定する
  // （STEP7が求める「実際の送信処理が除外することの確認」に対する最小の再現手順）。
  await updateLead(created.lead_id, {
    company_slug: slug,
    status: "report_generated",
    delivery_approval_status: "approved",
    delivery_status: "bounced",
  });
  publishForInitial(slug);

  const initialSend = fakeSendEmail("should-not-be-used-initial");
  const result = await sendInitialReportForLead(created.lead_id, { sendEmail: initialSend.fn });

  assert.equal(result.skipped, true);
  assert.match(result.error, /delivery_statusが"bounced"のため送信対象外です/);
  assert.equal(initialSend.calls.length, 0, "bouncedのLeadに対してInitial送信のsendEmailが実際に呼ばれてはならない");
});

// ---------------------------------------------------------------------------
// 同一emailの複数Lead: bouncedの伝播範囲が実際のWeekly送信結果にも反映されることの確認
// ---------------------------------------------------------------------------

test("統合: 同一emailで複数Leadが存在する場合、blastengineでbouncedになったLeadのみWeekly送信がskipされ、他のLeadは通常どおり送信される", async (t) => {
  withSiteConfig(t);
  const email = `blastengine-suppression-integration-multi-${Date.now()}@example.invalid`;

  const createdA = await createLead(sampleParams({ email, company_url: "https://company-a-integration.example" }));
  const slugA = `${TEST_SLUG_PREFIX}a-${createdA.lead_id.slice(0, 8)}`;
  const createdB = await createLead(sampleParams({ email, company_url: "https://company-b-integration.example" }));
  const slugB = `${TEST_SLUG_PREFIX}b-${createdB.lead_id.slice(0, 8)}`;
  t.after(() => {
    cleanupLead(createdA.lead_id);
    cleanupLead(createdB.lead_id);
    cleanupPublishedAorData(slugA);
    cleanupPublishedAorData(slugB);
    cleanupPublishedStore(slugA);
    cleanupPublishedStore(slugB);
  });

  await updateLead(createdA.lead_id, { company_slug: slugA, status: "report_generated", delivery_approval_status: "approved" });
  await updateLead(createdB.lead_id, { company_slug: slugB, status: "report_generated", delivery_approval_status: "approved" });
  publishForInitial(slugA);
  publishForInitial(slugB);

  const initialSendA = fakeSendEmail("multi-integration-delivery-a");
  const initialSendB = fakeSendEmail("multi-integration-delivery-b");
  await sendInitialReportForLead(createdA.lead_id, { sendEmail: initialSendA.fn });
  await sendInitialReportForLead(createdB.lead_id, { sendEmail: initialSendB.fn });

  // Lead Aのdelivery_idのみHARDERRORを受信する。
  await processBlastengineEvent({
    events: [nestedBlastengineEvent({ type: "HARDERROR", mailaddress: email, delivery_id: "multi-integration-delivery-a" })],
  });

  await updateLead(createdA.lead_id, { weekly_report_consent: true });
  await updateLead(createdB.lead_id, { weekly_report_consent: true });
  await publishForWeekly(slugA, "2026-08-29T00:00:00.000Z");
  await publishForWeekly(slugB, "2026-08-29T00:00:00.000Z");

  const weeklySendA = fakeSendEmail("weekly-a-should-not-be-used");
  const weeklySendB = fakeSendEmail("weekly-b-message-id");
  const weeklyResultA = await sendWeeklyReportForLead(createdA.lead_id, { sendEmail: weeklySendA.fn });
  const weeklyResultB = await sendWeeklyReportForLead(createdB.lead_id, { sendEmail: weeklySendB.fn });

  assert.equal(weeklyResultA.skipped, true, "bouncedになったLead Aはskipされるはず");
  assert.equal(weeklySendA.calls.length, 0);
  assert.equal(weeklyResultB.ok, true, "同一emailだが別company_urlのLead Bは影響を受けず、通常どおり送信されるはず");
  assert.equal(weeklySendB.calls.length, 1);
});
