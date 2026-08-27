/**
 * unsubscribe-lead.test.js — scripts/generator/leads/unsubscribe-lead.js の自動テスト。
 *
 * PJ2 AOR Phase 42。lead-store.test.js / import-leads.test.js と同じく、実際のLeadファイル
 * （scripts/generator/logs/leads/）を作成するため、各テストで作成したlead_idのみを
 * t.after()で個別に削除する（既存データには一切触れない）。既定のfilesystemバックエンドの
 * ままであり、AWSへは一切接続しない。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { unsubscribeLead, findAllLeadsByEmail, EMAIL_PATTERN, unsubscribeLeadByToken } = require("../leads/unsubscribe-lead");
const { createLead, readLead, LEADS_DIR, isDeliveryBlocked } = require("../leads/lead-store");

/** @param {string} leadId */
function cleanupLead(leadId) {
  fs.rmSync(path.join(LEADS_DIR, `${leadId}.json`), { force: true });
}

function sampleParams(overrides = {}) {
  return {
    email: "unsubscribe-test@example.invalid",
    company_url: "https://example.com",
    source: "公式サイトのお問い合わせページ",
    collection_method: "public_website",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1〜2. 正常系: 対象Leadをunsubscribedにできる
// ---------------------------------------------------------------------------

test("unsubscribeLead: 正常なemailで対象Leadをunsubscribedにできる", async (t) => {
  const email = "unsubscribe-normal@example.invalid";
  const lead = await createLead(sampleParams({ email }));
  t.after(() => cleanupLead(lead.lead_id));

  const result = await unsubscribeLead(email);

  assert.equal(result.ok, true);
  assert.equal(result.code, "unsubscribed");
  assert.equal(result.leadAfter.delivery_status, "unsubscribed");

  const reloaded = await readLead(lead.lead_id);
  assert.equal(reloaded.delivery_status, "unsubscribed", "実際に保存先へ反映されているはず");
  assert.equal(
    reloaded.history[reloaded.history.length - 1].event,
    "unsubscribed",
    "既存のappendHistory()経由でhistoryへ記録されるはず"
  );
});

// ---------------------------------------------------------------------------
// 3. 存在しないemail
// ---------------------------------------------------------------------------

test("unsubscribeLead: 存在しないemailでは何も変更せずnot_foundを返す", async (t) => {
  const result = await unsubscribeLead("no-such-lead-exists@example.invalid");
  assert.equal(result.ok, false);
  assert.equal(result.code, "not_found");
});

// ---------------------------------------------------------------------------
// 4. email不正形式
// ---------------------------------------------------------------------------

test("EMAIL_PATTERN: 不正形式のemailを拒否する（CLIのmain()が事前チェックに使う）", () => {
  assert.equal(EMAIL_PATTERN.test("not-an-email"), false);
  assert.equal(EMAIL_PATTERN.test("valid@example.com"), true);
});

// ---------------------------------------------------------------------------
// 5. 既にunsubscribedの場合の冪等性
// ---------------------------------------------------------------------------

test("unsubscribeLead: 既にunsubscribedの場合は変更せずalready_unsubscribedを返す", async (t) => {
  const email = "unsubscribe-already@example.invalid";
  const lead = await createLead(sampleParams({ email }));
  t.after(() => cleanupLead(lead.lead_id));

  const first = await unsubscribeLead(email);
  assert.equal(first.code, "unsubscribed");
  const afterFirst = await readLead(lead.lead_id);
  const historyLengthAfterFirst = afterFirst.history.length;

  const second = await unsubscribeLead(email);
  assert.equal(second.ok, true);
  assert.equal(second.code, "already_unsubscribed");

  const afterSecond = await readLead(lead.lead_id);
  assert.equal(afterSecond.delivery_status, "unsubscribed");
  assert.equal(
    afterSecond.history.length,
    historyLengthAfterFirst,
    "2回目の実行ではhistoryへ追記されない（不要な状態変更をしない）はず"
  );
});

// ---------------------------------------------------------------------------
// 6. 複数Leadが存在する場合の安全動作
// ---------------------------------------------------------------------------

test("unsubscribeLead: 同一emailで複数Leadが存在する場合、いずれも変更せずambiguousを返す", async (t) => {
  const email = "unsubscribe-ambiguous@example.invalid";
  const leadA = await createLead(sampleParams({ email, company_url: "https://company-a.example" }));
  const leadB = await createLead(sampleParams({ email, company_url: "https://company-b.example" }));
  t.after(() => {
    cleanupLead(leadA.lead_id);
    cleanupLead(leadB.lead_id);
  });

  const matches = await findAllLeadsByEmail(email);
  assert.equal(matches.length, 2, "前提: 同一emailでcompany_urlが異なる2件のLeadが実在するはず");

  const result = await unsubscribeLead(email);
  assert.equal(result.ok, false);
  assert.equal(result.code, "ambiguous");
  assert.equal(result.candidates.length, 2);

  const reloadedA = await readLead(leadA.lead_id);
  const reloadedB = await readLead(leadB.lead_id);
  assert.equal(reloadedA.delivery_status, "active", "候補Aは変更されていないはず");
  assert.equal(reloadedB.delivery_status, "active", "候補Bは変更されていないはず");
});

// ---------------------------------------------------------------------------
// 7. 送信側isDeliveryBlocked()がunsubscribed Leadを除外すること
// ---------------------------------------------------------------------------

test("unsubscribeLead後、既存のisDeliveryBlocked()がtrueを返す（送信対象から除外される）", async (t) => {
  const email = "unsubscribe-blocks-delivery@example.invalid";
  const lead = await createLead(sampleParams({ email }));
  t.after(() => cleanupLead(lead.lead_id));

  assert.equal(isDeliveryBlocked(lead), false, "変更前は配信対象のはず");

  const result = await unsubscribeLead(email);
  assert.equal(isDeliveryBlocked(result.leadAfter), true, "unsubscribeLead後は配信ブロック対象になるはず");

  const reloaded = await readLead(lead.lead_id);
  assert.equal(isDeliveryBlocked(reloaded), true, "保存先から読み直しても配信ブロック対象のはず");
});

// ---------------------------------------------------------------------------
// 8. unsubscribeLeadByToken: URL経由の配信停止（共通Unsubscribe基盤、Phase45 STEP3A）
// ---------------------------------------------------------------------------

test("unsubscribeLeadByToken: 正しいlead_id・report_tokenで対象Leadをunsubscribedにできる", async (t) => {
  const lead = await createLead(sampleParams({ email: "unsubscribe-token-normal@example.invalid" }));
  t.after(() => cleanupLead(lead.lead_id));

  const result = await unsubscribeLeadByToken(lead.lead_id, lead.report_token);

  assert.equal(result.ok, true);
  assert.equal(result.code, "unsubscribed");
  assert.equal(result.leadAfter.delivery_status, "unsubscribed");

  const reloaded = await readLead(lead.lead_id);
  assert.equal(reloaded.delivery_status, "unsubscribed", "実際に保存先へ反映されているはず");
  assert.equal(
    reloaded.history[reloaded.history.length - 1].event,
    "unsubscribed",
    "reply-based経路と同じappendHistory()経由でhistoryへ記録されるはず"
  );
});

test("unsubscribeLeadByToken: tokenが一致しない場合は何も変更せずinvalid_tokenを返す", async (t) => {
  const lead = await createLead(sampleParams({ email: "unsubscribe-token-mismatch@example.invalid" }));
  t.after(() => cleanupLead(lead.lead_id));

  const result = await unsubscribeLeadByToken(lead.lead_id, "wrong-token-value");

  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_token");

  const reloaded = await readLead(lead.lead_id);
  assert.equal(reloaded.delivery_status, "active", "token不一致時は変更されないはず");
});

test("unsubscribeLeadByToken: 存在しないlead_idではnot_foundを返す", async () => {
  const result = await unsubscribeLeadByToken("0".repeat(64), "any-token");
  assert.equal(result.ok, false);
  assert.equal(result.code, "not_found");
});

test("unsubscribeLeadByToken: 既にunsubscribedの場合は冪等にalready_unsubscribedを返す（historyへ追記しない）", async (t) => {
  const lead = await createLead(sampleParams({ email: "unsubscribe-token-idempotent@example.invalid" }));
  t.after(() => cleanupLead(lead.lead_id));

  const first = await unsubscribeLeadByToken(lead.lead_id, lead.report_token);
  assert.equal(first.code, "unsubscribed");
  const afterFirst = await readLead(lead.lead_id);

  const second = await unsubscribeLeadByToken(lead.lead_id, lead.report_token);
  assert.equal(second.ok, true);
  assert.equal(second.code, "already_unsubscribed");

  const afterSecond = await readLead(lead.lead_id);
  assert.equal(afterSecond.history.length, afterFirst.history.length, "2回目はhistoryへ追記されないはず");
});
