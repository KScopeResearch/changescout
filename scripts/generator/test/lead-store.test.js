/**
 * lead-store.test.js — scripts/generator/leads/lead-store.js の自動テスト。
 *
 * 「PJ2 Leadライフサイクル 実装仕様 最終確定」に基づくLead管理モジュール（第1弾:
 * データモデルの基盤のみ）の単体テスト。Phase1 CSV取り込み・Phase2接続・SES送信・
 * Phase4 APIはこのモジュールの責務ではないため、ここではテストしない。
 *
 * unpublish-report.test.js等と同じく、実際のディレクトリ（scripts/generator/logs/leads/）
 * にファイルを作成するが、各テストで作成したlead_idのファイルのみをt.after()で
 * 個別に削除する（既存データには一切触れない）。
 *
 * 【PJ2次工程】lead-store.jsのバックエンド抽象化（filesystem/S3切り替え）に伴い、
 * createLead/readLead/updateLead/appendHistory/listLeads/findLeadByEmailが非同期に
 * なったため、本ファイルの全テストをasync/awaitへ変更した（LEAD_STORE_BACKENDを
 * 明示設定していないため、本ファイルは既定のfilesystemバックエンドに対するテストの
 * ままであり、AWSへは一切接続しない）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  VALID_STATUSES,
  VALID_DELIVERY_STATUSES,
  LEADS_DIR,
  createLead,
  readLead,
  updateLead,
  appendHistory,
  listLeads,
  findLeadByEmail,
  isDeliveryBlocked,
} = require("../leads/lead-store");

/** @param {string} leadId */
function cleanupLead(leadId) {
  const filePath = path.join(LEADS_DIR, `${leadId}.json`);
  fs.rmSync(filePath, { force: true });
}

function sampleParams(overrides = {}) {
  return {
    email: "lead-store-test@example.invalid",
    company_url: "https://example.com",
    source: "公式サイトのお問い合わせページ",
    collection_method: "public_website",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createLead
// ---------------------------------------------------------------------------

test("createLead: 正常に作成でき、lead_id・report_tokenが発番される", async (t) => {
  const lead = await createLead(sampleParams());
  t.after(() => cleanupLead(lead.lead_id));

  assert.ok(lead.lead_id, "lead_idが発番されるはず");
  assert.ok(lead.report_token, "report_tokenが発番されるはず");
  assert.notEqual(lead.lead_id, lead.report_token, "lead_idとreport_tokenは別の値のはず");
  assert.equal(lead.lead_id.length, 64, "crypto.randomBytes(32).toString('hex')は64文字のはず");
  assert.match(lead.lead_id, /^[0-9a-f]{64}$/, "16進数文字列のはず");
});

test("createLead: 初期値が仕様どおりになっている", async (t) => {
  const lead = await createLead(sampleParams());
  t.after(() => cleanupLead(lead.lead_id));

  assert.equal(lead.company_slug, null);
  assert.equal(lead.status, "collected");
  assert.equal(lead.paid_report_requested, false);
  assert.equal(lead.paid_report_requested_at, null);
  assert.equal(lead.weekly_report_consent, false);
  assert.equal(lead.weekly_report_consent_at, null);
  assert.equal(lead.delivery_status, "active");
  assert.equal(lead.history.length, 1);
  assert.equal(lead.history[0].event, "collected");
  assert.ok(lead.history[0].at);
});

test("createLead: JSONファイルとして実際に保存される", async (t) => {
  const lead = await createLead(sampleParams());
  t.after(() => cleanupLead(lead.lead_id));

  const filePath = path.join(LEADS_DIR, `${lead.lead_id}.json`);
  assert.ok(fs.existsSync(filePath), "ファイルが作成されているはず");
  const onDisk = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  assert.equal(onDisk.lead_id, lead.lead_id);
  assert.equal(onDisk.email, lead.email);
});

test("createLead: 必須項目が欠けている場合は例外を投げる", async () => {
  await assert.rejects(() => createLead({ company_url: "https://example.com", source: "x", collection_method: "x" }));
  await assert.rejects(() => createLead({ email: "a@example.invalid", source: "x", collection_method: "x" }));
});

// ---------------------------------------------------------------------------
// readLead
// ---------------------------------------------------------------------------

test("readLead: 正常に取得できる", async (t) => {
  const created = await createLead(sampleParams());
  t.after(() => cleanupLead(created.lead_id));

  const read = await readLead(created.lead_id);
  assert.deepEqual(read, created);
});

test("readLead: 存在しないlead_idはnullを返す", async () => {
  const result = await readLead("0".repeat(64));
  assert.equal(result, null);
});

test("readLead: 不正なlead_id（パストラバーサル試行）は例外を投げる", async () => {
  await assert.rejects(() => readLead("../../etc/passwd"));
  await assert.rejects(() => readLead(".."));
});

// ---------------------------------------------------------------------------
// updateLead
// ---------------------------------------------------------------------------

test("updateLead: statusを変更できる", async (t) => {
  const created = await createLead(sampleParams());
  t.after(() => cleanupLead(created.lead_id));

  const updated = await updateLead(created.lead_id, { status: "validated" });
  assert.equal(updated.status, "validated");
  assert.equal((await readLead(created.lead_id)).status, "validated", "保存内容にも反映されているはず");
});

test("updateLead: company_slugを設定できる", async (t) => {
  const created = await createLead(sampleParams());
  t.after(() => cleanupLead(created.lead_id));

  const updated = await updateLead(created.lead_id, { company_slug: "example.com", status: "report_generated" });
  assert.equal(updated.company_slug, "example.com");
});

test("updateLead: delivery_statusを変更できる", async (t) => {
  const created = await createLead(sampleParams());
  t.after(() => cleanupLead(created.lead_id));

  const updated = await updateLead(created.lead_id, { delivery_status: "unsubscribed" });
  assert.equal(updated.delivery_status, "unsubscribed");
});

test("updateLead: 不正なstatusは拒否される（保存されない）", async (t) => {
  const created = await createLead(sampleParams());
  t.after(() => cleanupLead(created.lead_id));

  await assert.rejects(() => updateLead(created.lead_id, { status: "no-such-status" }));
  assert.equal((await readLead(created.lead_id)).status, "collected", "拒否された更新は反映されていないはず");
});

test("updateLead: 不正なdelivery_statusは拒否される（保存されない）", async (t) => {
  const created = await createLead(sampleParams());
  t.after(() => cleanupLead(created.lead_id));

  await assert.rejects(() => updateLead(created.lead_id, { delivery_status: "no-such-status" }));
  assert.equal((await readLead(created.lead_id)).delivery_status, "active", "拒否された更新は反映されていないはず");
});

// ---------------------------------------------------------------------------
// appendHistory
// ---------------------------------------------------------------------------

test("appendHistory: イベントを追加できる", async (t) => {
  const created = await createLead(sampleParams());
  t.after(() => cleanupLead(created.lead_id));

  const updated = await appendHistory(created.lead_id, "validated");
  assert.equal(updated.history.length, 2);
  assert.equal(updated.history[1].event, "validated");
});

test("appendHistory: timestampが記録される", async (t) => {
  const created = await createLead(sampleParams());
  t.after(() => cleanupLead(created.lead_id));

  const updated = await appendHistory(created.lead_id, "validated");
  assert.ok(updated.history[1].at);
  assert.doesNotThrow(() => new Date(updated.history[1].at).toISOString());
});

test("appendHistory: metadataを付与できる", async (t) => {
  const created = await createLead(sampleParams());
  t.after(() => cleanupLead(created.lead_id));

  const updated = await appendHistory(created.lead_id, "initial_report_sent", { message_id: "ses-123" });
  assert.deepEqual(updated.history[1].metadata, { message_id: "ses-123" });
});

test('appendHistory: "initial_report_failed"を記録できる（PJ2 Phase3で発見: VALID_STATUSESには元々含まれていたが、対応するイベント名がVALID_EVENTSに未登録だった。send-initial-report.jsが送信失敗時にhistoryへ記録できるよう追加した）', async (t) => {
  const created = await createLead(sampleParams());
  t.after(() => cleanupLead(created.lead_id));

  const updated = await appendHistory(created.lead_id, "initial_report_failed", { error: "dummy" });
  assert.deepEqual(updated.history[1].metadata, { error: "dummy" });
});

test("appendHistory: 未知のイベント名は拒否される", async (t) => {
  const created = await createLead(sampleParams());
  t.after(() => cleanupLead(created.lead_id));

  await assert.rejects(() => appendHistory(created.lead_id, "no-such-event"));
});

test("appendHistory: 既存historyを保持したまま追加される（複数回）", async (t) => {
  const created = await createLead(sampleParams());
  t.after(() => cleanupLead(created.lead_id));

  await appendHistory(created.lead_id, "validated");
  await appendHistory(created.lead_id, "report_generated");
  const final = await appendHistory(created.lead_id, "initial_report_queued");

  assert.equal(final.history.length, 4);
  assert.deepEqual(
    final.history.map((h) => h.event),
    ["collected", "validated", "report_generated", "initial_report_queued"]
  );
});

// ---------------------------------------------------------------------------
// findLeadByEmail
// ---------------------------------------------------------------------------

test("findLeadByEmail: 一致するLeadを取得できる", async (t) => {
  const email = "find-by-email-test@example.invalid";
  const created = await createLead(sampleParams({ email }));
  t.after(() => cleanupLead(created.lead_id));

  const found = await findLeadByEmail(email);
  assert.ok(found);
  assert.equal(found.lead_id, created.lead_id);
});

test("findLeadByEmail: 前後空白・大文字小文字を正規化して比較する", async (t) => {
  const created = await createLead(sampleParams({ email: "Mixed-Case@Example.Invalid" }));
  t.after(() => cleanupLead(created.lead_id));

  const found = await findLeadByEmail("  mixed-case@example.invalid  ");
  assert.ok(found);
  assert.equal(found.lead_id, created.lead_id);
});

test("findLeadByEmail: 存在しないemailはnullを返す", async () => {
  const found = await findLeadByEmail("no-such-lead-store-test@example.invalid");
  assert.equal(found, null);
});

test("findLeadByEmail: 複数Leadが存在してもクラッシュせず1件返す（重複はcreateLeadの外側で防ぐ想定）", async (t) => {
  const email = "duplicate-email-test@example.invalid";
  const lead1 = await createLead(sampleParams({ email }));
  const lead2 = await createLead(sampleParams({ email }));
  t.after(() => {
    cleanupLead(lead1.lead_id);
    cleanupLead(lead2.lead_id);
  });

  const found = await findLeadByEmail(email);
  assert.ok(found);
  assert.ok([lead1.lead_id, lead2.lead_id].includes(found.lead_id));
});

// ---------------------------------------------------------------------------
// rejected再利用
// ---------------------------------------------------------------------------

test("rejected再利用: rejectedなLeadを再取得できる", async (t) => {
  const created = await createLead(sampleParams());
  t.after(() => cleanupLead(created.lead_id));
  await updateLead(created.lead_id, { status: "rejected" });

  const read = await readLead(created.lead_id);
  assert.equal(read.status, "rejected");
});

test("rejected再利用: 同一lead_idのまま再検証してvalidatedへ進められる（新規lead_idは発番しない）", async (t) => {
  const created = await createLead(sampleParams());
  t.after(() => cleanupLead(created.lead_id));
  await updateLead(created.lead_id, { status: "rejected" });

  const revalidated = await updateLead(created.lead_id, { status: "validated" });
  assert.equal(revalidated.lead_id, created.lead_id, "lead_idは変わらないはず");
  assert.equal(revalidated.status, "validated");
});

test("rejected再利用: status=rejectedだけでは配信ブロックと判定しない", async (t) => {
  const created = await createLead(sampleParams());
  t.after(() => cleanupLead(created.lead_id));
  const rejected = await updateLead(created.lead_id, { status: "rejected" });

  assert.equal(isDeliveryBlocked(rejected), false, "rejectedのみではブロックしないはず（delivery_statusはactiveのまま）");
});

test("rejected再利用: delivery_statusがunsubscribed/bounced/suppressedの場合は再利用（配信）不可と判定する", async (t) => {
  const created = await createLead(sampleParams());
  t.after(() => cleanupLead(created.lead_id));

  const unsubscribed = await updateLead(created.lead_id, { delivery_status: "unsubscribed" });
  assert.equal(isDeliveryBlocked(unsubscribed), true);

  const bounced = await updateLead(created.lead_id, { delivery_status: "bounced" });
  assert.equal(isDeliveryBlocked(bounced), true);

  const suppressed = await updateLead(created.lead_id, { delivery_status: "suppressed" });
  assert.equal(isDeliveryBlocked(suppressed), true);

  const active = await updateLead(created.lead_id, { delivery_status: "active" });
  assert.equal(isDeliveryBlocked(active), false);
});

// ---------------------------------------------------------------------------
// 定数のエクスポート確認（仕様どおりの値であることの回帰確認）
// ---------------------------------------------------------------------------

test("VALID_STATUSES / VALID_DELIVERY_STATUSES が仕様どおりである", () => {
  assert.deepEqual(VALID_STATUSES, [
    "collected",
    "validated",
    "rejected",
    "report_generated",
    "initial_report_queued",
    "initial_report_sent",
    "initial_report_failed",
  ]);
  assert.deepEqual(VALID_DELIVERY_STATUSES, ["active", "unsubscribed", "bounced", "suppressed"]);
});

test("listLeads: 作成したLeadが一覧に含まれる", async (t) => {
  const created = await createLead(sampleParams());
  t.after(() => cleanupLead(created.lead_id));

  const all = await listLeads();
  assert.ok(all.some((l) => l.lead_id === created.lead_id));
});
